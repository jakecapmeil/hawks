// Fitness States: an up-to-date read on what each runner can race right now
// (400 through half marathon), a VO2max estimate and recent mileage. Every
// pace in Hawks (workout library, Hawky, the plan) comes from here.
//
// How it's worked out, best evidence first:
//   1. Max efforts: race results from the watch, PRs (with their dates) and a
//      self-entered "current 5K". Each is turned into a VDOT (Daniels &
//      Gilbert's oxygen-cost and time-to-exhaustion curves), weighted by
//      quality and by how recent it is.
//   2. Training: rep sessions (laps from the watch or the split builder) and
//      heart rate on steady runs (%HRmax -> %VO2max, Swain 1994). These are
//      submaximal, so they only move the number when the races are old:
//      fitter than your last race, or detrained since.
//   3. Per-distance shape. Critical speed (d = CS*t + D') fitted to recent
//      efforts of 2-20 min is accurate to ~1-2% from 1500 m to 10K, so it is
//      blended in there. It is poor for 800 m and below, so 400/800 come from
//      the 1600 estimate with short-distance exponents, pulled toward recent
//      400/800 PRs. A personal speed/endurance index (the athlete's own Riegel
//      exponent vs Daniels') shifts every distance.
//   4. Mileage: 10K and half estimates are slowed for low weekly mileage,
//      since VDOT alone over-predicts long races for low-volume runners.
import { parseReps } from './workouts.js';

const DAY = 86400000;
const MILE = 1609.344;

export const EVENTS = [
  { key: '400', label: '400m', m: 400 },
  { key: '800', label: '800m', m: 800 },
  { key: '1600', label: '1600m', m: 1600 },
  { key: '3200', label: '3200m', m: 3200 },
  { key: '5K', label: '5K', m: 5000 },
  { key: '10K', label: '10K', m: 10000 },
  { key: 'half', label: 'Half marathon', m: 21097.5 },
];

const PR_METERS = { '400': 400, '800': 800, '1600': 1600, '3200': 3200, '5K': 5000, 'XC 5K': 5000 };

// ------------------------------------------------------------------ Daniels

// Oxygen cost (ml/kg/min) of running at v metres/minute.
const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
// Fraction of VO2max sustainable for t minutes.
const pctAt = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

export function vdotOf(meters, sec) {
  if (!(meters > 0 && sec > 0)) return null;
  const t = sec / 60;
  return vo2At(meters / t) / pctAt(t);
}

// Race time (s) for a distance at a given VDOT. f(t) falls as t grows.
export function timeFor(vdot, meters) {
  let lo = meters / 1000, hi = meters / 40; // minutes
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vo2At(meters / mid) / pctAt(mid) > vdot) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

// Seconds per mile when running at `pct` of VDOT.
function paceAtPct(vdot, pct) {
  const a = 0.000104, b = 0.182258, c = -(4.6 + pct * vdot);
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (MILE / v) * 60;
}

// ------------------------------------------------------------------ helpers

export function parseTime(s) {
  const m = String(s || '').trim().match(/^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0) || null;
}

export function fmtTime(sec, { tenths = false } = {}) {
  if (!Number.isFinite(sec)) return '';
  if (sec < 60 && tenths) return sec.toFixed(1);
  const total = tenths && sec < 180 ? Math.round(sec * 10) / 10 : Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = tenths && sec < 180 ? s.toFixed(1).padStart(4, '0') : String(Math.round(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const fmtPace = (secPerMile) => fmtTime(secPerMile);
const ageDays = (date, today) => Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / DAY));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = (n) => Math.round(n * 10) / 10;
const recency = (age, halfLife) => Math.pow(0.5, age / halfLife);

// Snap a GPS distance to the race distance it probably was.
function snapDistance(m) {
  for (const d of [1600, MILE, 3200, 5000, 8000, 10000, 21097.5]) if (Math.abs(m - d) / d <= 0.04) return d;
  return m;
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ inputs

async function loadInputs(db, personId, today) {
  const since = addDays(today, -365);
  const [person, workouts, days, maxRow] = await Promise.all([
    db.prepare('SELECT id, prs, five_k_time, five_k_set_at FROM people WHERE id = ?').bind(personId).first(),
    db.prepare(
      `SELECT date, name, category, distance_mi, moving_sec, avg_hr, max_hr, elev_gain_ft, laps
       FROM workouts WHERE person_id = ? AND date >= ? ORDER BY date`
    ).bind(personId, since).all(),
    db.prepare(
      'SELECT date, manual_miles, splits, split_reps FROM training_days WHERE person_id = ? AND date >= ?'
    ).bind(personId, since).all(),
    db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(personId).first(),
  ]);
  return { person, workouts: workouts.results, days: days.results, maxHr: maxRow?.m || null };
}

function parsePrs(raw) {
  try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

// Miles per day over a window, from synced runs plus hand-logged days with none.
function milesBetween(workouts, days, from, to) {
  const runDays = new Set();
  let miles = 0;
  let longest = 0;
  for (const w of workouts) {
    if (w.date < from || w.date > to || w.category === 'crosstrain') continue;
    miles += w.distance_mi || 0;
    longest = Math.max(longest, w.distance_mi || 0);
    runDays.add(w.date);
  }
  for (const d of days) {
    if (d.date < from || d.date > to || runDays.has(d.date) || !d.manual_miles) continue;
    miles += d.manual_miles;
    longest = Math.max(longest, d.manual_miles);
  }
  return { miles, longest };
}

// Work reps for a day: the watch laps if there are any, else the split builder.
function repsOf(w, dayRow) {
  const out = [];
  try { for (const r of JSON.parse(w?.laps || '[]')) if (r.m > 0 && r.s > 0) out.push({ m: r.m, s: r.s }); } catch { /* ignore */ }
  if (out.length) return out;
  try { for (const r of JSON.parse(dayRow?.split_reps || '[]')) if (r.m > 0 && r.s > 0) out.push({ m: r.m, s: r.s }); } catch { /* ignore */ }
  if (out.length) return out;
  return parseReps(dayRow?.splits || '');
}

// ------------------------------------------------------------------ compute

export function computeFitness({ person, workouts, days, maxHr }, today) {
  const sources = [];
  const prs = parsePrs(person?.prs);

  // 1. Max efforts.
  for (const [event, v] of Object.entries(prs)) {
    const m = PR_METERS[event];
    const sec = parseTime(v?.time);
    if (!m || !sec) continue;
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(v?.date || '');
    const age = dated ? ageDays(v.date, today) : 240;
    // XC courses run slower than the track; count them about 2% faster.
    const t = event === 'XC 5K' ? sec * 0.98 : sec;
    sources.push({
      kind: 'pr', max: true, event, m, s: t, age, date: dated ? v.date : null,
      quality: (dated ? 0.9 : 0.5) * (event === 'XC 5K' ? 0.8 : 1),
      label: `${event} PR ${v.time}${v.meet ? ` (${v.meet})` : ''}`,
    });
  }
  const fiveK = parseTime(person?.five_k_time);
  if (fiveK) {
    // Entered before the date was recorded: assume about two months old.
    const age = person.five_k_set_at ? Math.round((Date.parse(today + 'T12:00:00Z') - person.five_k_set_at) / DAY) : 60;
    sources.push({ kind: 'manual', max: true, m: 5000, s: fiveK, age: Math.max(0, age), date: null, quality: 0.7, label: `Current 5K you entered (${person.five_k_time})` });
  }

  const hrMax = maxHr && maxHr >= 175 ? maxHr : null;
  for (const w of workouts) {
    if (w.category !== 'race' || !w.distance_mi || !w.moving_sec || w.distance_mi < 0.9) continue;
    // A "race" at easy heart rate was mislabelled (a jog, or a meet day warm-up).
    if (hrMax && w.avg_hr && w.avg_hr / hrMax < 0.85) continue;
    const m = snapDistance(w.distance_mi * MILE);
    sources.push({ kind: 'race', max: true, m, s: w.moving_sec, age: ageDays(w.date, today), date: w.date, quality: 1, label: `${w.name || 'Race'} ${fmtTime(w.moving_sec)}` });
  }

  // 2. Training: rep sessions.
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const seenDates = new Set();
  for (const w of workouts) {
    if (w.category !== 'workout' || seenDates.has(w.date)) continue;
    const reps = repsOf(w, dayByDate.get(w.date)).filter((r) => r.m >= 300 && r.m <= 3300);
    if (reps.length < 2) continue;
    seenDates.add(w.date);
    const work = reps.reduce((a, r) => a + r.m, 0);
    const secs = reps.reduce((a, r) => a + r.s, 0);
    // Reps with recovery are run faster than a continuous race of the same
    // total distance; treat the set as a race of 3/4 of the work.
    const eqM = Math.max(reps[0].m, work * 0.75);
    const eqS = (secs / work) * eqM;
    sources.push({ kind: 'reps', max: false, m: eqM, s: eqS, age: ageDays(w.date, today), date: w.date, quality: 0.45, label: `${reps.length} x ${Math.round(work / reps.length)}m on ${w.date}` });
  }
  for (const d of days) {
    if (seenDates.has(d.date)) continue;
    const reps = repsOf(null, d).filter((r) => r.m >= 300 && r.m <= 3300);
    if (reps.length < 2) continue;
    const work = reps.reduce((a, r) => a + r.m, 0);
    const secs = reps.reduce((a, r) => a + r.s, 0);
    const eqM = Math.max(reps[0].m, work * 0.75);
    sources.push({ kind: 'reps', max: false, m: eqM, s: (secs / work) * eqM, age: ageDays(d.date, today), date: d.date, quality: 0.4, label: `${reps.length} reps logged on ${d.date}` });
  }

  // Training: heart rate on steady runs. Needs a real observed max HR.
  const hrEst = [];
  if (hrMax) {
    for (const w of workouts) {
      if (!w.avg_hr || !w.distance_mi || !w.moving_sec || w.distance_mi < 2.5 || w.moving_sec < 1200) continue;
      if (!['easy', 'long', 'workout', 'recovery'].includes(w.category)) continue;
      if (w.laps && w.category === 'workout') continue; // intervals, not steady
      if ((w.elev_gain_ft || 0) / w.distance_mi > 80) continue;
      const age = ageDays(w.date, today);
      if (age > 56) continue;
      const pHr = w.avg_hr / hrMax;
      if (pHr < 0.65 || pHr > 0.93) continue;
      const pVo2 = (pHr - 0.37) / 0.64;
      const v = (w.distance_mi * MILE) / (w.moving_sec / 60);
      hrEst.push({ est: vo2At(v) / pVo2, age, date: w.date });
    }
  }
  if (hrEst.length >= 4) {
    const top = hrEst.map((x) => x.est).sort((a, b) => b - a).slice(0, Math.ceil(hrEst.length / 2));
    const med = top[Math.floor(top.length / 2)];
    const newest = hrEst.reduce((a, b) => (a.date > b.date ? a : b));
    sources.push({ kind: 'hr', max: false, vdot: med, age: newest.age, date: newest.date, quality: 0.35, label: `Heart rate on ${hrEst.length} steady runs (last 8 weeks)` });
  }

  for (const s of sources) {
    if (s.vdot === undefined) s.vdot = s.m >= 1500 ? vdotOf(s.m, s.s) : null;
    s.weight = s.quality * recency(s.age, s.max ? 75 : 30);
    // Fitness fades a little each month after the effort, and old results
    // are less certain anyway.
    if (s.vdot) s.eff = s.vdot * (1 - clamp((s.age - 28) * 0.0004, 0, 0.06));
  }

  const wmean = (list) => {
    const w = list.reduce((a, s) => a + s.weight, 0);
    return w > 0 ? { v: list.reduce((a, s) => a + s.eff * s.weight, 0) / w, w, age: list.reduce((a, s) => a + s.age * s.weight, 0) / w } : null;
  };
  const maxSrc = sources.filter((s) => s.max && s.eff);
  const M = wmean(maxSrc);
  // Rep sets far below race fitness were easy running the watch split into
  // "intervals", not a real session.
  const subSrc = sources.filter((s) => !s.max && s.eff && (!M || s.kind !== 'reps' || s.eff >= M.v - 8));
  const S = wmean(subSrc);
  for (const x of [...maxSrc, ...subSrc]) x.used = true;
  for (const x of sources) if (x.kind === 'pr' && !x.eff) x.used = true; // 400/800 PRs shape the short estimates

  // Mileage.
  const cur = milesBetween(workouts, days, addDays(today, -27), today);
  const prev = milesBetween(workouts, days, addDays(today, -55), addDays(today, -28));
  const mpw = round1(cur.miles / 4);
  const mpwPrev = round1(prev.miles / 4);

  let vdot = null;
  let basis = 'none';
  if (M) {
    vdot = M.v;
    basis = 'races';
    if (S) {
      // The older the races, the more training is allowed to move the number.
      const pull = clamp((M.age - 45) / 150, 0, 0.6);
      vdot += (S.v - vdot) * (S.v > vdot ? pull : pull * 0.5);
      if (pull > 0.05) basis = 'races+training';
    }
  } else if (S) {
    // Submax only: no race to anchor on, so it's an estimate of an estimate.
    vdot = S.v;
    basis = 'training';
  }

  if (!vdot) {
    return {
      as_of: today, basis, vdot: null, vo2max: null, confidence: 'none', mpw, mpw_prev: mpwPrev,
      longest_28d: round1(cur.longest), estimates: [], zones: [], cs: null, speed_index: null,
      sources: [], note: 'Add a PR or connect your watch so Hawks can estimate your fitness.',
    };
  }
  vdot = clamp(vdot, 20, 85);

  // 3a. Speed/endurance index: the athlete's own exponent between two max
  // efforts a reasonable distance apart vs the exponent Daniels implies.
  let speedIndex = 0;
  const shape = maxSrc.concat(sources.filter((s) => s.max && !s.eff)).filter((s) => s.age <= 400)
    .sort((a, b) => b.weight - a.weight);
  for (let i = 0; i < shape.length && !speedIndex; i++) {
    for (let j = i + 1; j < shape.length; j++) {
      const a = shape[i], b = shape[j];
      if (Math.max(a.m, b.m) / Math.min(a.m, b.m) < 1.9 || Math.abs(a.age - b.age) > 200) continue;
      const [lo, hi] = a.m < b.m ? [a, b] : [b, a];
      const kAth = Math.log(hi.s / lo.s) / Math.log(hi.m / lo.m);
      const loT = lo.m >= 1500 ? timeFor(vdot, lo.m) : shortFromMile(timeFor(vdot, 1600), lo.m);
      const kDan = Math.log(timeFor(vdot, hi.m) / loT) / Math.log(hi.m / lo.m);
      speedIndex = clamp(kAth - kDan, -0.06, 0.06);
      break;
    }
  }

  // 3b. Critical speed from recent efforts of 2-20 minutes.
  // Max efforts only: rep sets are submaximal and flatten the curve.
  const csPts = sources.filter((s) => s.max && s.kind !== 'manual' && s.m && s.s && s.age <= 180 && s.s >= 120 && s.s <= 1200);
  let cs = null;
  if (csPts.length >= 2 && Math.max(...csPts.map((p) => p.m)) / Math.min(...csPts.map((p) => p.m)) >= 1.5) {
    const n = csPts.length;
    const mt = csPts.reduce((a, p) => a + p.s, 0) / n;
    const md = csPts.reduce((a, p) => a + p.m, 0) / n;
    const sxy = csPts.reduce((a, p) => a + (p.s - mt) * (p.m - md), 0);
    const sxx = csPts.reduce((a, p) => a + (p.s - mt) ** 2, 0);
    const speed = sxx > 0 ? sxy / sxx : 0;
    const dPrime = md - speed * mt;
    if (speed > 2.5 && speed < 7 && dPrime > 0 && dPrime < 600) cs = { speed, dPrime };
  }

  const confFor = (meters) => {
    const near = maxSrc.filter((s) => Math.max(s.m, meters) / Math.min(s.m, meters) <= 2.2);
    if (near.some((s) => s.age <= 90 && s.kind !== 'manual')) return 'high';
    if (maxSrc.some((s) => s.age <= 365)) return 'medium';
    return 'low';
  };

  const est = {};
  const mileT = timeFor(vdot, 1600) * Math.pow(1600 / 5000, speedIndex);
  for (const e of EVENTS) {
    let t = e.m >= 1500 ? timeFor(vdot, e.m) * Math.pow(e.m / 5000, speedIndex) : shortFromMile(mileT, e.m);
    if (cs && e.m >= 1500 && e.m <= 5000) t = 0.7 * t + 0.3 * ((e.m - cs.dPrime) / cs.speed);
    // A recent race or PR at this exact distance is the best evidence there
    // is; the model is pulled toward it (strongly for 400/800, where the
    // aerobic models are weakest).
    for (const s of sources) {
      if (!s.max || s.kind === 'manual' || Math.abs(s.m - e.m) / e.m > 0.02) continue;
      const w = recency(s.age, 90) * (e.m < 1500 ? 1.5 : 1) * s.quality;
      t = (t + w * s.s * (e.m / s.m)) / (1 + w);
    }
    const raw = t;
    if (e.key === '10K') t *= 1 + clamp((25 - mpw) * 0.0015, 0, 0.05);
    if (e.key === 'half') t *= 1 + clamp((35 - mpw) * 0.003, 0, 0.09);
    est[e.key] = { ...e, sec: t, raw };
  }

  // Zones: race paces from the estimates, aerobic zones from VDOT (Daniels'
  // percentages: easy 62-70%, steady 81%, threshold 88%).
  // Training zones use fitness, not race-readiness: no mileage penalty.
  const perMile = (key) => (est[key].raw / est[key].m) * MILE;
  const zones = [
    { key: 'recovery', label: 'Recovery', sec: [paceAtPct(vdot, 0.62) + 25, paceAtPct(vdot, 0.57) + 40] },
    { key: 'easy', label: 'Easy', sec: [paceAtPct(vdot, 0.7), paceAtPct(vdot, 0.62)] },
    { key: 'steady', label: 'Steady', sec: paceAtPct(vdot, 0.81) },
    { key: 'tempo', label: 'Tempo (half pace)', sec: Math.min(perMile('half'), paceAtPct(vdot, 0.85)) },
    { key: 'threshold', label: 'Threshold', sec: paceAtPct(vdot, 0.88) },
    ...(cs ? [{ key: 'cv', label: 'Critical velocity', sec: MILE / cs.speed }] : []),
    { key: '10k', label: '10K pace', sec: perMile('10K') },
    { key: '5k', label: '5K pace', sec: perMile('5K') },
    { key: '3200', label: '3200 pace', sec: perMile('3200') },
    { key: 'mile', label: 'Mile pace', sec: perMile('1600') },
    { key: '800', label: '800 pace', sec: perMile('800') },
    { key: '400', label: '400 pace', sec: perMile('400') },
  ].map((z) => ({
    ...z,
    per_mile: Array.isArray(z.sec) ? `${fmtPace(z.sec[0])}-${fmtPace(z.sec[1])}` : fmtPace(z.sec),
    per_400: Array.isArray(z.sec) ? null : fmtTime((z.sec / MILE) * 400, { tenths: z.sec < 330 }),
  }));

  const real = maxSrc.filter((s) => s.kind !== 'manual');
  const overall = real.some((s) => s.age <= 90) ? 'high' : maxSrc.some((s) => s.age <= 365) ? 'medium' : 'low';
  return {
    as_of: today,
    basis,
    vdot: round1(vdot),
    vo2max: round1(vdot),
    confidence: overall,
    mpw, mpw_prev: mpwPrev, longest_28d: round1(cur.longest),
    estimates: EVENTS.map((e) => {
      const x = est[e.key];
      return {
        event: e.key, label: e.label, meters: e.m, sec: Math.round(x.sec * 10) / 10,
        time: fmtTime(x.sec, { tenths: e.m <= 800 }), pace_mi: fmtPace((x.sec / e.m) * MILE), confidence: confFor(e.m),
      };
    }),
    zones,
    cs: cs ? { per_mile: fmtPace(MILE / cs.speed), d_prime_m: Math.round(cs.dPrime) } : null,
    speed_index: round1(speedIndex * 100) / 100,
    profile: speedIndex > 0.012 ? 'speed' : speedIndex < -0.012 ? 'endurance' : 'balanced',
    sources: sources
      .filter((s) => s.used && s.weight > 0.02)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map((s) => ({ kind: s.kind, label: s.label, date: s.date, vdot: s.vdot ? round1(s.vdot) : null, weight: Math.round(s.weight * 100) / 100 })),
  };
}

// 400 and 800 from the mile: distance runners hold pace better over short
// races than a single Riegel exponent says, so the exponents are steeper.
function shortFromMile(mileSec, meters) {
  const t800 = mileSec * Math.pow(800 / 1600, 1.12);
  if (meters >= 800) return t800;
  return t800 * Math.pow(meters / 800, 1.15);
}

// ------------------------------------------------------------------ storage

export async function recomputeFitness(db, personId, today) {
  const inputs = await loadInputs(db, personId, today);
  if (!inputs.person) return null;
  const data = computeFitness(inputs, today);
  const fiveK = data.estimates.find((e) => e.event === '5K');
  // Trend: the 5K estimate four weeks ago, from history.
  const old = await db.prepare(
    'SELECT five_k_sec, vdot FROM fitness_history WHERE person_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).bind(personId, addDays(today, -28)).first();
  if (old && fiveK) {
    data.trend = { five_k_sec_change: Math.round(fiveK.sec - old.five_k_sec), vdot_change: round1(data.vdot - old.vdot), since: addDays(today, -28) };
  }
  await db.batch([
    db.prepare(
      `INSERT INTO fitness_states (person_id, computed_at, data) VALUES (?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data`
    ).bind(personId, Date.now(), JSON.stringify(data)),
    ...(data.vdot ? [db.prepare(
      `INSERT INTO fitness_history (person_id, date, vdot, five_k_sec, mpw) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id, date) DO UPDATE SET vdot = excluded.vdot, five_k_sec = excluded.five_k_sec, mpw = excluded.mpw`
    ).bind(personId, today, data.vdot, Math.round(fiveK.sec), data.mpw)] : []),
  ]);
  return data;
}

// Cached read; recomputes when older than six hours or on a new day.
export async function getFitness(db, personId, today, { fresh = false } = {}) {
  if (!fresh) {
    const row = await db.prepare('SELECT computed_at, data FROM fitness_states WHERE person_id = ?').bind(personId).first();
    if (row && Date.now() - row.computed_at < 6 * 3600 * 1000) {
      try {
        const data = JSON.parse(row.data);
        if (data.as_of === today) return data;
      } catch { /* recompute */ }
    }
  }
  return await recomputeFitness(db, personId, today);
}

export async function fitnessHistory(db, personId, days = 180) {
  const rows = await db.prepare(
    "SELECT date, vdot, five_k_sec, mpw FROM fitness_history WHERE person_id = ? AND date >= date('now', ?) ORDER BY date"
  ).bind(personId, `-${days} days`).all();
  return rows.results;
}

// Pace for a zone key as seconds per mile (midpoint for ranges).
export function zoneSec(fitness, key) {
  const z = fitness?.zones?.find((x) => x.key === key);
  if (!z) return null;
  return Array.isArray(z.sec) ? (z.sec[0] + z.sec[1]) / 2 : z.sec;
}
