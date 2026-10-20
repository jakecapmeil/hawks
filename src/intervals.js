// intervals.icu sync: Garmin and COROS both sync to intervals.icu for free,
// and its API lets Hawks pull those runs (with laps) without Claude, Strava or
// any subscription. Each runner pastes their athlete id and API key once.
//
// The key is AES-GCM encrypted with a key derived from MCP_AUTH_TOKEN (a
// Worker secret) and is never returned to a browser.
//
// Runs get a rule-based category first (the math), then Gemini, if it's set
// up, refines the category and writes the note. Scoring is the same
// logWorkouts path Claude Coach uses.
import { logWorkouts, todayInTz, COACH_RUBRIC } from './coach.js';
import { saveDay } from './log.js';
import { classifyRuns, AiError } from './gemini.js';

export class IntervalsError extends Error {}

const API = 'https://intervals.icu/api/v1'; // ICU_API_BASE overrides it for local testing
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Treadmill']);
const FIRST_SYNC_DAYS = 28;
const MAX_LAP_FETCHES = 8; // Workers cap subrequests per invocation
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
  await env.DB.prepare('UPDATE people SET icu_athlete = ?, icu_key_enc = ?, icu_synced_at = NULL, icu_status = ? WHERE id = ?')
    .bind(id, await encrypt(env, key), 'connected', personId).run();
  return { connected: true, athlete: id, name: me?.name || '' };
}

export async function disconnect(env, personId) {
  await env.DB.prepare("UPDATE people SET icu_athlete = '', icu_key_enc = '', icu_synced_at = NULL, icu_status = '' WHERE id = ?").bind(personId).run();
  return { connected: false };
}

export async function status(db, personId) {
  const row = await db.prepare('SELECT icu_athlete, icu_key_enc, icu_synced_at, icu_status FROM people WHERE id = ?').bind(personId).first();
  if (!row) return null;
  return { connected: !!row.icu_key_enc, athlete: row.icu_athlete || '', synced_at: row.icu_synced_at || null, status: row.icu_status || '' };
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
  if (work.length < 2) return { work: [], text: '' };
  const text = work.slice(0, 20).map((i) => {
    const m = Math.round(i.distance);
    const dist = m >= 1500 && Math.abs(m - 1609) < 40 ? '1 mi' : `${m}m`;
    const hr = i.average_heartrate ? `, ${Math.round(i.average_heartrate)}` : '';
    return `${dist} ${fmtTime(i.moving_time)} (${fmtPace(i.moving_time / (i.distance / 1609.344))}/mi${hr})`;
  }).join('; ');
  return { work, text };
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

export async function syncPerson(env, personId, { days } = {}) {
  const db = env.DB;
  const person = await db.prepare('SELECT id, name, first_name, class_year, plan_rank, icu_athlete, icu_key_enc, icu_synced_at FROM people WHERE id = ?').bind(personId).first();
  if (!person?.icu_key_enc) throw new IntervalsError('Not connected to intervals.icu');
  const today = todayInTz();
  try {
    const key = await decrypt(env, person.icu_key_enc);
    const lastSyncDay = person.icu_synced_at ? todayInTz(new Date(person.icu_synced_at - 3 * 86400000)) : null;
    const oldest = days ? todayInTz(new Date(Date.now() - days * 86400000)) : (lastSyncDay || todayInTz(new Date(Date.now() - FIRST_SYNC_DAYS * 86400000)));
    const acts = await icu(key, `${athletePath(person.icu_athlete)}/activities?oldest=${oldest}&newest=${today}`, env);
    // Strava-sourced activities come back as stubs (Strava doesn't allow
    // intervals.icu to share them), so only real files are used.
    const usable = (Array.isArray(acts) ? acts : []).filter((a) => a && a.id && a.distance > 0 && a.moving_time > 0 && a.source !== 'STRAVA');

    const ids = usable.map((a) => `intervals:${a.id}`);
    const logged = new Set(ids.length ? (await db.prepare(
      `SELECT strava_id FROM workouts WHERE person_id = ? AND strava_id IN (${ids.map(() => '?').join(',')})`
    ).bind(person.id, ...ids).all()).results.map((r) => r.strava_id) : []);
    const fresh = usable.filter((a) => !logged.has(`intervals:${a.id}`));
    if (!fresh.length) {
      await db.prepare("UPDATE people SET icu_synced_at = ?, icu_status = 'ok' WHERE id = ?").bind(Date.now(), person.id).run();
      return { imported: 0, checked: usable.length };
    }

    const maxRow = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(person.id).first();
    const maxHr = Math.max(maxRow?.m || 0, ...fresh.map((a) => a.max_heartrate || 0)) || 200;
    const longest = Math.max(...usable.map((a) => a.distance / 1609.344));

    let lapFetches = 0;
    const runs = [];
    for (const a of fresh.slice(0, 40)) {
      let work = [];
      let splits = '';
      if (RUN_TYPES.has(a.type) && (a.icu_lap_count || 0) > 1 && lapFetches < MAX_LAP_FETCHES) {
        lapFetches++;
        try {
          const iv = await icu(key, `/activity/${encodeURIComponent(a.id)}/intervals`, env);
          ({ work, text: splits } = splitsFrom(iv?.icu_intervals));
        } catch { /* laps are a nice-to-have */ }
      }
      runs.push({ a, work, splits, category: ruleCategory(a, work, maxHr, longest), date: String(a.start_date_local || '').slice(0, 10) });
    }

    // Gemini refines the label and writes the note; failures fall back to the rules.
    let ai = null;
    let aiNote = '';
    try {
      ai = await classifyRuns(env, db, person, runs.map((r) => ({
        id: String(r.a.id), date: r.date, name: r.a.name || '', type: r.a.type, rule_category: r.category,
        miles: Math.round(r.a.distance / 16.09344) / 100, minutes: Math.round(r.a.moving_time / 60),
        pace: fmtPace(r.a.moving_time / (r.a.distance / 1609.344)), avg_hr: r.a.average_heartrate || null, max_hr: r.a.max_heartrate || null,
        laps: r.splits || null, athlete_note: (r.a.description || '').slice(0, 300) || null,
      })), { rubric: COACH_RUBRIC, maxHr, today });
    } catch (err) {
      aiNote = err instanceof AiError ? err.message : 'AI unavailable';
    }
    const byId = new Map((ai || []).map((x) => [String(x.id), x]));

    const result = await logWorkouts(db, person, runs.map((r) => {
      const g = byId.get(String(r.a.id));
      return {
        source: 'intervals', activity_id: String(r.a.id), date: r.date, name: r.a.name || '', sport: r.a.type,
        category: g?.category || r.category,
        distance_mi: Math.round(r.a.distance / 16.09344) / 100, moving_sec: r.a.moving_time, elapsed_sec: r.a.elapsed_time,
        avg_hr: r.a.average_heartrate, max_hr: r.a.max_heartrate, avg_cadence: r.a.average_cadence,
        elev_gain_ft: r.a.total_elevation_gain != null ? Math.round(r.a.total_elevation_gain * 3.281) : null,
        summary: g?.summary || '',
      };
    }));

    // Workouts also go on the day log with their rep splits.
    for (const r of runs) {
      if (!r.splits) continue;
      const g = byId.get(String(r.a.id));
      const existing = await db.prepare('SELECT splits FROM training_days WHERE person_id = ? AND date = ?').bind(person.id, r.date).first();
      if (existing?.splits) continue;
      await saveDay(db, person.id, r.date, { splits: r.splits, types: dayTypes(g?.category || r.category, r.work) });
    }

    await db.prepare("UPDATE people SET icu_synced_at = ?, icu_status = ? WHERE id = ?").bind(Date.now(), aiNote ? `ok (${aiNote})` : 'ok', person.id).run();
    return { imported: result.logged.length, checked: usable.length, ai: !!ai, ai_note: aiNote || undefined, logged: result.logged };
  } catch (err) {
    const msg = err instanceof IntervalsError ? err.message : 'Sync failed';
    if (!(err instanceof IntervalsError)) console.error('intervals sync', person.id, err);
    await db.prepare('UPDATE people SET icu_status = ? WHERE id = ?').bind('error: ' + msg, person.id).run();
    throw err instanceof IntervalsError ? err : new IntervalsError(msg);
  }
}

// Cron: a few connected people per run, least recently synced first, so the
// whole team cycles through without hitting per-invocation fetch limits.
export async function syncDue(env) {
  const due = (await env.DB.prepare(
    "SELECT id FROM people WHERE icu_key_enc != '' ORDER BY COALESCE(icu_synced_at, 0) ASC LIMIT ?"
  ).bind(PEOPLE_PER_CRON).all()).results;
  const out = [];
  for (const p of due) {
    try { out.push({ id: p.id, ...(await syncPerson(env, p.id)) }); } catch (err) { out.push({ id: p.id, error: err.message }); }
  }
  return out;
}
