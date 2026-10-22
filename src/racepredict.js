// Race predictor card: HawksPredict-Lite on the runner's PRs, plus an
// exploratory heart-rate fitness adjustment, logged for the next meet.
// Behind env.HAWKS_PREDICT === '1'.
import { predictRace, PACE_MODEL_INFO } from './pacemodel.js';
import { getPrs } from './log.js';
import { PR_METERS, parseTime, fmtTime, getFitness } from './fitness.js';
import { heatCost, hillCost } from './conditions.js';

const DAY = 86400000;
const MILE = 1609.344;
const TARGETS = [
  { key: '800', label: '800m', m: 800, surf: 'track' },
  { key: '1600', label: '1600m', m: 1600, surf: 'track' },
  { key: '3200', label: '3200m', m: 3200, surf: 'track' },
  { key: '5K', label: '5K', m: 5000, surf: 'track' },
  { key: 'XC 5K', label: 'XC 5K', m: 5000, surf: 'xc' },
  { key: 'VC 2.5 mi', label: '2.5 mi at Van Cortlandt', m: 2.5 * MILE, surf: 'xc' },
];
const XC_EVENTS = new Set(['XC 5K', 'VC 2.5 mi']);
// The heart-rate layer is exploratory: half the fitness change, never more than 3%.
const HR_SHRINK = 0.5;
const HR_CAP = 0.03;

const ageDays = (date, today) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / DAY);
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

// Median heart-rate fitness (VDOT-like) of steady runs in the 56 days before asOf.
// Same recipe as Fitness States: Swain %HRmax -> %VO2max, read at the pace the
// run was worth on flat ground in cool weather.
function hrFitness(workouts, hrMax, asOf) {
  const from = addDays(asOf, -56);
  const est = [];
  for (const w of workouts) {
    if (w.date >= asOf || w.date < from) continue;
    if (!w.avg_hr || !w.distance_mi || !w.moving_sec || w.distance_mi < 2.5 || w.moving_sec < 1200) continue;
    if (!['easy', 'long', 'workout', 'recovery'].includes(w.category)) continue;
    if (w.laps && w.category === 'workout') continue;
    if ((w.elev_gain_ft || 0) / w.distance_mi > 150) continue;
    const pHr = w.avg_hr / hrMax;
    if (pHr < 0.65 || pHr > 0.93) continue;
    const worth = (1 + heatCost(w.temp_f, w.dew_point_f)) * (1 + (w.surface === 'track' ? 0 : hillCost(w.elev_gain_ft, w.distance_mi)));
    const v = ((w.distance_mi * MILE) / (w.moving_sec / 60)) * worth;
    est.push(vo2At(v) / ((pHr - 0.37) / 0.64));
  }
  if (est.length < 4) return null;
  est.sort((a, b) => a - b);
  return { fit: est[Math.floor(est.length / 2)], n: est.length };
}

export async function racePredictions(env, personId, today) {
  if (env.HAWKS_PREDICT !== '1') return { enabled: false };
  const db = env.DB;
  const prs = await getPrs(db, personId);
  const inputs = [];
  for (const [event, v] of Object.entries(prs)) {
    const sec = parseTime(v?.time);
    const m = PR_METERS[event];
    if (!sec || !m) continue;
    if (v.date && ageDays(v.date, today) > 730) continue; // Lite was trained on the previous two years
    inputs.push({ event, m, sec, surf: XC_EVENTS.has(event) ? 'xc' : 'track', date: v.date || null });
  }
  const model = { name: PACE_MODEL_INFO.name, version: PACE_MODEL_INFO.version };
  if (!inputs.length) return { enabled: true, model, predictions: [], reason: 'Add a PR (or two) and HawksPredict can predict your other events.' };

  // Exploratory heart-rate layer: fitness now vs. fitness when the newest PR was set.
  let hr = null;
  const newest = inputs.filter((i) => i.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const maxRow = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(personId).first();
  const hrMax = maxRow?.m >= 175 ? maxRow.m : null;
  if (hrMax && newest) {
    const { results: workouts } = await db.prepare(
      `SELECT date, category, distance_mi, moving_sec, avg_hr, elev_gain_ft, laps, surface, temp_f, dew_point_f
       FROM workouts WHERE person_id = ? AND date >= ? AND date <= ?`
    ).bind(personId, addDays(newest.date, -56), today).all();
    const now = hrFitness(workouts, hrMax, addDays(today, 1));
    const then = hrFitness(workouts, hrMax, newest.date);
    if (now && then) {
      const delta = Math.log(now.fit / then.fit);
      const applied = Math.max(-HR_CAP, Math.min(HR_CAP, HR_SHRINK * delta));
      hr = { delta_pct: Math.round(delta * 1000) / 10, applied_pct: Math.round(applied * 1000) / 10, runs_now: now.n, runs_then: then.n, since: newest.date, factor: Math.exp(-applied) };
    }
  }

  let fitness = null;
  try { fitness = await getFitness(db, personId, today); } catch { /* the card still works without it */ }
  const siteBy = new Map((fitness?.estimates || []).map((e) => [e.event, e]));
  const vc = (fitness?.course_estimates || []).find((c) => c.key === 'vc2.5');
  if (vc) siteBy.set('VC 2.5 mi', vc);

  const predictions = [];
  for (const t of TARGETS) {
    // The roster has no sex field and the model takes one: average the two runs, keep the wider range.
    const a = predictRace(inputs, { m: t.m, surf: t.surf, male: 0 });
    const b = predictRace(inputs, { m: t.m, surf: t.surf, male: 1 });
    if (!a || !b) continue;
    const r = { sec: Math.sqrt(a.sec * b.sec), lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), buckets: a.buckets };
    const site = siteBy.get(t.key);
    predictions.push({
      event: t.key, label: t.label, buckets: r.buckets,
      raw: { sec: r.sec, lo: r.lo, hi: r.hi, time: fmtTime(r.sec), lo_time: fmtTime(r.lo), hi_time: fmtTime(r.hi) },
      adjusted: hr ? { sec: r.sec * hr.factor, lo: r.lo * hr.factor, hi: r.hi * hr.factor, time: fmtTime(r.sec * hr.factor), lo_time: fmtTime(r.lo * hr.factor), hi_time: fmtTime(r.hi * hr.factor) } : null,
      site: site ? { time: site.time, sec: site.sec } : null,
      pr: prs[t.key]?.time || null,
    });
  }

  // Lock the first prediction for the next meet (within two weeks).
  const meet = await db.prepare("SELECT date, title FROM events WHERE type = 'meet' AND date >= ? AND date <= ? ORDER BY date LIMIT 1").bind(today, addDays(today, 14)).first();
  if (meet && predictions.length) {
    const hash = hashOf(inputs.map((i) => `${i.event}=${i.sec}`).sort().join('|'));
    const modelTag = `${model.name} ${model.version}`;
    await db.batch(predictions.map((p) => db.prepare(
      `INSERT OR IGNORE INTO prediction_log (person_id, event, race_date, model, inputs_hash, raw_sec, raw_lo, raw_hi, adj_sec, adj_lo, adj_hi, hr_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(personId, p.event, meet.date, modelTag, hash, p.raw.sec, p.raw.lo, p.raw.hi, p.adjusted?.sec ?? null, p.adjusted?.lo ?? null, p.adjusted?.hi ?? null, hr?.delta_pct ?? null, Date.now())));
  }
  return { enabled: true, model, predictions, hr: hr && { ...hr, factor: undefined }, next_meet: meet ? { date: meet.date, title: meet.title } : null };
}
