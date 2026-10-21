// intervals.icu sync: Garmin and COROS both sync to intervals.icu for free,
// and its API lets Hawks pull those runs (with laps) without Claude, Strava or
// any subscription. Each runner pastes their athlete id and API key once.
//
// The key is AES-GCM encrypted with a key derived from MCP_AUTH_TOKEN (a
// Worker secret) and is never returned to a browser.
//
// Runs get a rule-based category first (the math), then Hawky (Gemini), if
// it's set up, refines the category and writes one report per session.
// Scoring is the same logWorkouts path Hawky in Claude uses. Old history is
// imported in chunks with rules only, so it never spends the AI quota.
import { logWorkouts, todayInTz, COACH_RUBRIC } from './coach.js';
import { saveDay, sessionsOf } from './log.js';
import { reportSessions, AiError } from './gemini.js';
import { recomputeFitness } from './fitness.js';

export class IntervalsError extends Error {}

const API = 'https://intervals.icu/api/v1'; // ICU_API_BASE overrides it for local testing
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Treadmill']);
const FIRST_SYNC_DAYS = 28;
const MAX_LAP_FETCHES = 8; // Workers cap subrequests per invocation
const IMPORT_WINDOW_DAYS = 90;
const IMPORT_LAP_FETCHES = 20;
const IMPORT_MAX_YEARS = 6;
const AI_REPORT_DAYS = 10; // only recent sessions get an AI report
export const SYNC_CRON = '17 * * * *';
const PEOPLE_PER_CRON = 3;

// ------------------------------------------------------------------ crypto

async function aesKey(env) {
  if (!env.MCP_AUTH_TOKEN) throw new IntervalsError('Server is missing its secret; ask the admin.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MCP_AUTH_TOKEN), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('hawks-intervals'), info: new TextEncoder().encode('icu-key-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}

async function decrypt(env, blob) {
  const [iv, ct] = String(blob || '').split('.');
  if (!iv || !ct) throw new IntervalsError('Not connected');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ------------------------------------------------------------------ API

async function icu(apiKey, path, env) {
  const res = await fetch((env?.ICU_API_BASE || API) + path, { headers: { Authorization: 'Basic ' + btoa('API_KEY:' + apiKey), Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new IntervalsError('intervals.icu rejected the API key or athlete id.');
  if (res.status === 404) throw new IntervalsError('intervals.icu athlete not found. Check the athlete id (it looks like i12345).');
  if (!res.ok) throw new IntervalsError(`intervals.icu error ${res.status}`);
  return res.json();
}

const athletePath = (id) => `/athlete/${encodeURIComponent(id)}`;

export async function connect(env, personId, athleteId, apiKey) {
  const id = String(athleteId || '').trim();
  const key = String(apiKey || '').trim();
  if (!/^i?\d{1,12}$/.test(id)) throw new IntervalsError('Athlete id looks like i12345 (Settings on intervals.icu, under your name).');
  if (key.length < 10 || key.length > 200) throw new IntervalsError('Paste the API key from intervals.icu Settings → Developer Settings.');
  const me = await icu(key, athletePath(id), env);
  const person = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
  if (!person) throw new IntervalsError('Unknown person');
  await env.DB.prepare("UPDATE people SET icu_athlete = ?, icu_key_enc = ?, icu_synced_at = NULL, icu_status = ?, icu_import_cursor = '', icu_import_done = 0 WHERE id = ?")
    .bind(id, await encrypt(env, key), 'connected', personId).run();
  return { connected: true, athlete: id, name: me?.name || '' };
}

export async function disconnect(env, personId) {
  await env.DB.prepare("UPDATE people SET icu_athlete = '', icu_key_enc = '', icu_synced_at = NULL, icu_status = '', icu_import_cursor = '', icu_import_done = 0 WHERE id = ?").bind(personId).run();
  return { connected: false };
}

export async function status(db, personId) {
  const row = await db.prepare('SELECT icu_athlete, icu_key_enc, icu_synced_at, icu_status, icu_import_cursor, icu_import_done FROM people WHERE id = ?').bind(personId).first();
  if (!row) return null;
  return {
    connected: !!row.icu_key_enc, athlete: row.icu_athlete || '', synced_at: row.icu_synced_at || null, status: row.icu_status || '',
    import_done: !!row.icu_import_done, import_cursor: String(row.icu_import_cursor || '').split('|')[0] || null,
  };
}

// ------------------------------------------------------------------ math

function fmtPace(secPerMile) {
  if (!secPerMile || !Number.isFinite(secPerMile)) return null;
  const s = Math.round(secPerMile);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTime(sec) {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// WORK intervals -> "800m 2:45 (5:32/mi, 178)" style splits.
function splitsFrom(intervals) {
  const work = (intervals || []).filter((i) => i.type === 'WORK' && i.distance > 50 && i.moving_time > 0);
  if (work.length < 2) return { work: [], text: '', laps: [] };
  const laps = work.slice(0, 40).map((i) => ({ m: Math.round(i.distance), s: i.moving_time, hr: i.average_heartrate ? Math.round(i.average_heartrate) : null }));
  const text = work.slice(0, 20).map((i) => {
    const m = Math.round(i.distance);
    const dist = m >= 1500 && Math.abs(m - 1609) < 40 ? '1 mi' : `${m}m`;
    const hr = i.average_heartrate ? `, ${Math.round(i.average_heartrate)}` : '';
    return `${dist} ${fmtTime(i.moving_time)} (${fmtPace(i.moving_time / (i.distance / 1609.344))}/mi${hr})`;
  }).join('; ');
  return { work, text, laps };
}

// The pre-built, no-AI classifier: HR share of max, structure and distance.
function ruleCategory(a, work, maxHr, longest) {
  if (!RUN_TYPES.has(a.type)) return 'crosstrain';
  const miles = (a.distance || 0) / 1609.344;
  const hrPct = a.average_heartrate ? a.average_heartrate / maxHr : null;
  if (/race|meet|xc|5k|champ|invitational/i.test(a.name || '') && (hrPct ?? 0) > 0.86) return 'race';
  if (work.length >= 3) return 'workout';
  if (hrPct !== null && hrPct >= 0.86 && miles >= 2) return 'workout';
  if (miles >= 7 && miles >= longest * 0.9) return 'long';
  if (miles <= 3.2 && hrPct !== null && hrPct < 0.72) return 'recovery';
  return 'easy';
}

function dayTypes(category, work) {
  const t = { easy: ['easy'], recovery: ['recovery'], long: ['long'], race: ['race'], shakeout: ['shakeout'], crosstrain: ['crosstrain'] }[category];
  if (t) return t;
  if (!work.length) return ['tempo'];
  const avg = work.reduce((s, i) => s + i.distance, 0) / work.length;
  return avg <= 450 ? ['track'] : avg >= 1400 ? ['threshold'] : ['intervals'];
}

// ------------------------------------------------------------------ sync

const WORKOUT_NAME = /\d\s*x|x\s*\d|rep|interval|tempo|workout|track|fartlek|threshold|hill|cruise|ladder|progression|race|meet|xc|\bk\b/i;

// Whether an activity's laps are worth a fetch: a workout, not auto-laps on
// an easy run.
function wantsLaps(a, maxHr) {
  const n = a.icu_lap_count || 0;
  if (!RUN_TYPES.has(a.type) || n < 2 || n > 60) return false;
  const hrPct = a.average_heartrate ? a.average_heartrate / maxHr : 0;
  return WORKOUT_NAME.test(a.name || '') || hrPct >= 0.8 || !!a.interval_summary?.length;
}

const timeOf = (a) => (String(a.start_date_local || '').match(/T(\d{2}:\d{2})/) || [])[1] || '';
const dateOf = (a) => String(a.start_date_local || '').slice(0, 10);

// Pull activities between two dates and log them. `ai` turns on Hawky's
// session reports for recent sessions.
async function importRange(env, person, key, { oldest, newest, ai: useAi, lapBudget }) {
  const db = env.DB;
  const today = todayInTz();
  const acts = await icu(key, `${athletePath(person.icu_athlete)}/activities?oldest=${oldest}&newest=${newest}`, env);
  const all = Array.isArray(acts) ? acts : [];
  // Strava-sourced activities come back as stubs (Strava doesn't let
  // intervals.icu share them), so only real files are used.
  const skippedStrava = all.filter((a) => a?.source === 'STRAVA').length;
  const usable = all.filter((a) => a && a.id && a.distance > 0 && a.moving_time > 0 && a.source !== 'STRAVA');

  const ids = usable.map((a) => `intervals:${a.id}`);
  const logged = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    (await db.prepare(`SELECT strava_id FROM workouts WHERE person_id = ? AND strava_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(person.id, ...chunk).all()).results.forEach((r) => logged.add(r.strava_id));
  }
  const fresh = usable.filter((a) => !logged.has(`intervals:${a.id}`));
  if (!fresh.length) return { imported: 0, checked: usable.length, total: all.length, skipped_strava: skippedStrava };

  const maxRow = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(person.id).first();
  const maxHr = Math.max(maxRow?.m || 0, ...fresh.map((a) => a.max_heartrate || 0)) || 200;

  // Longest run per week decides what counts as a "long" run.
  const weekLongest = new Map();
  for (const a of usable) {
    const wk = dateOf(a).slice(0, 8) + String(Math.floor(Number(dateOf(a).slice(8)) / 7));
    weekLongest.set(wk, Math.max(weekLongest.get(wk) || 0, a.distance / 1609.344));
  }

  let lapFetches = 0;
  const runs = [];
  // Most likely workouts get their laps first.
  const order = [...fresh].sort((x, y) => Number(wantsLaps(y, maxHr)) - Number(wantsLaps(x, maxHr)) || String(y.start_date_local).localeCompare(String(x.start_date_local)));
  for (const a of order) {
    let work = [];
    let splits = '';
    let laps = [];
    if (wantsLaps(a, maxHr) && lapFetches < lapBudget) {
      lapFetches++;
      try {
        const iv = await icu(key, `/activity/${encodeURIComponent(a.id)}/intervals`, env);
        ({ work, text: splits, laps } = splitsFrom(iv?.icu_intervals));
      } catch { /* laps are a nice-to-have */ }
    }
    const date = dateOf(a);
    const wk = date.slice(0, 8) + String(Math.floor(Number(date.slice(8)) / 7));
    runs.push({ a, work, splits, laps, date, start: timeOf(a), category: ruleCategory(a, work, maxHr, weekLongest.get(wk) || 0) });
  }
  runs.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));

  // Hawky: one report per session (warm-up + workout + cool-down together)
  // for recent days. Failures fall back to the rule-based labels.
  let ai = null;
  let aiNote = '';
  const recentFrom = todayInTz(new Date(Date.now() - AI_REPORT_DAYS * 86400000));
  const recent = runs.filter((r) => r.date >= recentFrom);
  if (recent.length && useAi) {
    const pseudo = recent.map((r) => ({
      strava_id: String(r.a.id), date: r.date, category: r.category, distance_mi: r.a.distance / 1609.344,
      moving_sec: r.a.moving_time, elapsed_sec: r.a.elapsed_time, start_local: r.start, name: r.a.name || '',
    }));
    const byDate = new Map();
    pseudo.forEach((p) => byDate.set(p.date, [...(byDate.get(p.date) || []), p]));
    const sessions = [];
    for (const [date, list] of byDate) {
      for (const sess of sessionsOf(list)) {
        sessions.push({
          key: sess.key, date,
          activities: sess.activities.map((x) => {
            const r = recent.find((y) => String(y.a.id) === x.id);
            return {
              id: x.id, start: r.start, name: r.a.name || '', type: r.a.type, rule_category: r.category,
              miles: Math.round(r.a.distance / 16.09344) / 100, minutes: Math.round(r.a.moving_time / 60),
              pace: fmtPace(r.a.moving_time / (r.a.distance / 1609.344)), avg_hr: r.a.average_heartrate || null, max_hr: r.a.max_heartrate || null,
              laps: r.splits || null, athlete_note: (r.a.description || '').slice(0, 300) || null,
            };
          }),
        });
      }
    }
    try {
      ai = await reportSessions(env, db, person, sessions, { rubric: COACH_RUBRIC, maxHr, today });
    } catch (err) {
      aiNote = err instanceof AiError ? err.message : 'AI unavailable';
    }
  }
  const catById = new Map();
  const reportById = new Map();
  for (const sess of ai?.sessions || []) {
    for (const x of sess.activities || []) if (x?.id && x?.category) catById.set(String(x.id), x.category);
    if (sess.main_id && sess.report) reportById.set(String(sess.main_id), sess.report);
  }

  const rows = runs.map((r) => ({
    source: 'intervals', activity_id: String(r.a.id), date: r.date, name: r.a.name || '', sport: r.a.type,
    category: catById.get(String(r.a.id)) || r.category,
    distance_mi: Math.round(r.a.distance / 16.09344) / 100, moving_sec: r.a.moving_time, elapsed_sec: r.a.elapsed_time,
    avg_hr: r.a.average_heartrate, max_hr: r.a.max_heartrate, avg_cadence: r.a.average_cadence,
    elev_gain_ft: r.a.total_elevation_gain != null ? Math.round(r.a.total_elevation_gain * 3.281) : null,
    start_local: r.start, laps: r.laps,
    summary: reportById.get(String(r.a.id)) || '',
  }));
  let imported = 0;
  for (let i = 0; i < rows.length; i += 60) {
    imported += (await logWorkouts(db, person, rows.slice(i, i + 60))).logged.length;
  }

  // Workouts also go on the day log with their rep splits; Hawky's day lines too.
  for (const r of runs) {
    if (!r.splits) continue;
    const existing = await db.prepare('SELECT splits FROM training_days WHERE person_id = ? AND date = ?').bind(person.id, r.date).first();
    if (existing?.splits) continue;
    await saveDay(db, person.id, r.date, { splits: r.splits, types: dayTypes(catById.get(String(r.a.id)) || r.category, r.work) });
  }
  for (const d of ai?.days || []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d?.date || '') && d.line) await saveDay(db, person.id, d.date, { day_line: d.line });
  }
  return { imported, checked: usable.length, total: all.length, skipped_strava: skippedStrava, ai: !!ai, ai_note: aiNote || undefined };
}

async function loadPerson(env, personId) {
  const person = await env.DB.prepare(
    'SELECT id, name, first_name, class_year, plan_rank, icu_athlete, icu_key_enc, icu_synced_at, icu_import_cursor, icu_import_done FROM people WHERE id = ?'
  ).bind(personId).first();
  if (!person?.icu_key_enc) throw new IntervalsError('Not connected to intervals.icu');
  return person;
}

async function fail(env, person, err) {
  const msg = err instanceof IntervalsError ? err.message : 'Sync failed';
  if (!(err instanceof IntervalsError)) console.error('intervals sync', person.id, err);
  await env.DB.prepare('UPDATE people SET icu_status = ? WHERE id = ?').bind('error: ' + msg, person.id).run();
  return err instanceof IntervalsError ? err : new IntervalsError(msg);
}

function stravaNote(res) {
  return res.skipped_strava && !res.checked
    ? `${res.skipped_strava} ${res.skipped_strava === 1 ? 'activity' : 'activities'} came from Strava, which doesn't share runs with intervals.icu. Connect Garmin or COROS directly in intervals.icu.`
    : '';
}

export async function syncPerson(env, personId, { days } = {}) {
  const db = env.DB;
  const person = await loadPerson(env, personId);
  const today = todayInTz();
  try {
    const key = await decrypt(env, person.icu_key_enc);
    const lastSyncDay = person.icu_synced_at ? todayInTz(new Date(person.icu_synced_at - 3 * 86400000)) : null;
    const oldest = days ? todayInTz(new Date(Date.now() - days * 86400000)) : (lastSyncDay || todayInTz(new Date(Date.now() - FIRST_SYNC_DAYS * 86400000)));
    const res = await importRange(env, person, key, { oldest, newest: today, ai: true, lapBudget: MAX_LAP_FETCHES });
    const note = [res.ai_note, stravaNote(res)].filter(Boolean).join(' ');
    await db.prepare('UPDATE people SET icu_synced_at = ?, icu_status = ? WHERE id = ?').bind(Date.now(), note ? `ok (${note})` : 'ok', person.id).run();
    if (res.imported) await recomputeFitness(db, person.id, today);
    return { ...res, note: note || undefined };
  } catch (err) {
    throw await fail(env, person, err);
  }
}

// Full history, newest to oldest, one window per call. The page calls this
// until done; the cron also advances it so nobody has to wait on the page.
// Cursor format: "<oldest date reached>|<empty windows in a row>".
export async function importHistory(env, personId, { lapBudget = IMPORT_LAP_FETCHES } = {}) {
  const db = env.DB;
  const person = await loadPerson(env, personId);
  const today = todayInTz();
  if (person.icu_import_done) return { done: true, imported: 0, cursor: String(person.icu_import_cursor || '').split('|')[0] || null };
  try {
    const key = await decrypt(env, person.icu_key_enc);
    const [cur, emptyRaw] = String(person.icu_import_cursor || '').split('|');
    const newest = /^\d{4}-\d{2}-\d{2}$/.test(cur || '') ? cur : today;
    const oldestD = new Date(newest + 'T12:00:00Z');
    oldestD.setUTCDate(oldestD.getUTCDate() - IMPORT_WINDOW_DAYS);
    const oldest = oldestD.toISOString().slice(0, 10);
    const res = await importRange(env, person, key, { oldest, newest, ai: false, lapBudget });
    const empty = res.total === 0 ? Number(emptyRaw || 0) + 1 : 0;
    const tooOld = oldest < todayInTz(new Date(Date.now() - IMPORT_MAX_YEARS * 365 * 86400000));
    const done = empty >= 3 || tooOld;
    const cursor = oldest;
    await db.prepare('UPDATE people SET icu_import_cursor = ?, icu_import_done = ? WHERE id = ?').bind(`${cursor}|${empty}`, done ? 1 : 0, person.id).run();
    if (res.imported || done) await recomputeFitness(db, person.id, today);
    return { ...res, done, cursor, note: stravaNote(res) || undefined };
  } catch (err) {
    throw await fail(env, person, err);
  }
}

// Cron: a few connected people per run, least recently synced first, so the
// whole team cycles through without hitting per-invocation fetch limits
// (each sync is at most 1 + 8 lap fetches + 1 AI call). Then one history
// window for one person whose import isn't finished, with a smaller lap budget.
const CRON_IMPORT_LAPS = 8;
export async function syncDue(env) {
  const due = (await env.DB.prepare(
    "SELECT id FROM people WHERE icu_key_enc != '' ORDER BY COALESCE(icu_synced_at, 0) ASC LIMIT ?"
  ).bind(PEOPLE_PER_CRON).all()).results;
  const out = [];
  for (const p of due) {
    try { out.push({ id: p.id, ...(await syncPerson(env, p.id)) }); } catch (err) { out.push({ id: p.id, error: err.message }); }
  }
  const pending = await env.DB.prepare(
    "SELECT id FROM people WHERE icu_key_enc != '' AND COALESCE(icu_import_done, 0) = 0 ORDER BY COALESCE(icu_synced_at, 0) DESC LIMIT 1"
  ).first();
  if (pending) {
    try { out.push({ id: pending.id, import: await importHistory(env, pending.id, { lapBudget: CRON_IMPORT_LAPS }) }); } catch (err) { out.push({ id: pending.id, import_error: err.message }); }
  }
  return out;
}
