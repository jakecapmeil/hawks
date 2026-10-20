// Daily training log: one row per person per day, merged with whatever Claude
// Coach logged from Strava that day. Same idea as the XC Coach Log in Notion:
// planned vs actual, status, difficulty, notes, and a rolling load note.
import { WORKOUTS, WORKOUT_TYPES, RACES, PHASES, PACE_ZONES, pacesFrom5k, findWorkouts } from './workouts.js';

export class LogError extends Error {}

export const DAY_TYPES = ['easy', 'recovery', 'long', 'tempo', 'threshold', 'intervals', 'track', 'fartlek', 'hills', 'strides', 'race', 'shakeout', 'crosstrain', 'strength', 'rest'];
export const DAY_STATUSES = ['as_planned', 'harder', 'easier', 'missed', 'adjusted', 'rest'];

// Strava workout category -> day type.
const CATEGORY_TYPE = { easy: 'easy', recovery: 'recovery', long: 'long', workout: 'intervals', race: 'race', shakeout: 'shakeout', crosstrain: 'crosstrain' };

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

function numOrNull(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new LogError(`Value ${v} is out of range (${min}-${max})`);
  return n;
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseTypes(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(arr) ? arr.filter((t) => DAY_TYPES.includes(t)) : [];
  } catch {
    return [];
  }
}

function round1(n) {
  return Math.round(n * 100) / 100;
}

export async function getDays(db, personId, from, to) {
  if (!isDate(from) || !isDate(to)) throw new LogError('from and to must be YYYY-MM-DD');
  if (from > to) throw new LogError('from must be on or before to');
  const [days, runs] = await Promise.all([
    db.prepare('SELECT * FROM training_days WHERE person_id = ? AND date >= ? AND date <= ?').bind(personId, from, to).all(),
    db.prepare(
      'SELECT strava_id, date, name, category, distance_mi, moving_sec, avg_hr, effort, load, rating, library_id FROM workouts WHERE person_id = ? AND date >= ? AND date <= ? ORDER BY created_at'
    ).bind(personId, from, to).all(),
  ]);

  const byDate = new Map();
  const get = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, entry: null, runs: [] });
    return byDate.get(date);
  };
  days.results.forEach((d) => { get(d.date).entry = d; });
  runs.results.forEach((w) => { get(w.date).runs.push(w); });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ date, entry: e, runs: rs }) => {
    const running = rs.filter((w) => w.category !== 'crosstrain');
    const stravaMiles = running.reduce((s, w) => s + (w.distance_mi || 0), 0);
    const types = new Set(parseTypes(e?.types));
    rs.forEach((w) => types.add(CATEGORY_TYPE[w.category] || 'easy'));
    const maxEffort = rs.reduce((m, w) => Math.max(m, w.effort || 0), 0);
    return {
      date,
      miles: rs.length ? round1(stravaMiles) : (e?.manual_miles ?? null),
      minutes: rs.length ? Math.round(rs.reduce((s, w) => s + (w.moving_sec || 0), 0) / 60) : (e?.minutes ?? null),
      runs: rs.length ? running.length : (e?.runs ?? null),
      difficulty: e?.difficulty ?? (maxEffort || null),
      types: [...types],
      status: e?.status || '',
      planned: e?.planned || '',
      library_id: e?.library_id || rs.find((w) => w.library_id)?.library_id || '',
      splits: e?.splits || '',
      summary: e?.summary || '',
      coach_note: e?.coach_note || '',
      load_note: e?.load_note || '',
      feel: e?.feel ?? null,
      sleep_hours: e?.sleep_hours ?? null,
      strength: !!e?.strength,
      notes: e?.notes || '',
      load: rs.reduce((s, w) => s + (w.load || 0), 0) || null,
      strava: rs.map((w) => ({ strava_id: w.strava_id, name: w.name, category: w.category, miles: w.distance_mi, minutes: w.moving_sec ? Math.round(w.moving_sec / 60) : null, avg_hr: w.avg_hr, effort: w.effort, rating: w.rating })),
    };
  });
}

// Partial upsert: only the fields passed are changed.
const DAY_FIELDS = {
  manual_miles: (v) => numOrNull(v, 0, 100),
  minutes: (v) => numOrNull(v, 0, 1000),
  runs: (v) => { const n = numOrNull(v, 0, 10); return n === null ? null : Math.round(n); },
  difficulty: (v) => { const n = numOrNull(v, 1, 10); return n === null ? null : Math.round(n); },
  types: (v) => {
    if (!Array.isArray(v)) throw new LogError('types must be an array');
    const bad = v.filter((t) => !DAY_TYPES.includes(t));
    if (bad.length) throw new LogError(`Unknown type(s): ${bad.join(', ')}. Use: ${DAY_TYPES.join(', ')}`);
    return JSON.stringify([...new Set(v)]);
  },
  status: (v) => { const s = clip(v, 20); if (s && !DAY_STATUSES.includes(s)) throw new LogError(`status must be one of ${DAY_STATUSES.join(', ')}`); return s; },
  planned: (v) => clip(v, 500),
  library_id: (v) => { const s = clip(v, 60); if (s && !WORKOUTS.some((w) => w.id === s)) throw new LogError(`Unknown library workout "${s}"`); return s; },
  splits: (v) => clip(v, 500),
  summary: (v) => clip(v, 4000),
  coach_note: (v) => clip(v, 4000),
  load_note: (v) => clip(v, 4000),
  feel: (v) => { const n = numOrNull(v, 1, 5); return n === null ? null : Math.round(n); },
  sleep_hours: (v) => numOrNull(v, 0, 24),
  strength: (v) => (v ? 1 : 0),
  notes: (v) => clip(v, 2000),
};

export async function saveDay(db, personId, date, fields) {
  if (!isDate(date)) throw new LogError('date must be YYYY-MM-DD');
  const person = await db.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
  if (!person) throw new LogError('Unknown person');
  const cols = [];
  const vals = [];
  for (const [k, fn] of Object.entries(DAY_FIELDS)) {
    if (fields && k in fields) { cols.push(k); vals.push(fn(fields[k])); }
  }
  if (!cols.length) throw new LogError(`Nothing to save. Fields: ${Object.keys(DAY_FIELDS).join(', ')}`);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO training_days (person_id, date, ${cols.join(', ')}, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(person_id, date) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}, updated_at=excluded.updated_at`
  ).bind(personId, date, ...vals, now).run();
  return (await getDays(db, personId, date, date))[0];
}

// Mon-Sun weekly totals over a date range, for trends.
export function weeklyTotals(days) {
  const weeks = new Map();
  for (const d of days) {
    const dow = new Date(d.date + 'T12:00:00Z').getUTCDay();
    const start = addDays(d.date, dow === 0 ? -6 : 1 - dow);
    const w = weeks.get(start) || { week_of: start, miles: 0, run_days: 0, hard_days: 0, avg_difficulty: null, _diff: [] };
    w.miles = round1(w.miles + (d.miles || 0));
    if (d.miles) w.run_days += 1;
    if (d.types.some((t) => ['tempo', 'threshold', 'intervals', 'track', 'fartlek', 'hills', 'race'].includes(t))) w.hard_days += 1;
    if (d.difficulty) w._diff.push(d.difficulty);
    weeks.set(start, w);
  }
  return [...weeks.values()].map(({ _diff, ...w }) => ({ ...w, avg_difficulty: _diff.length ? round1(_diff.reduce((a, b) => a + b, 0) / _diff.length) : null }));
}

export async function getLog(db, personId, from, to) {
  const days = await getDays(db, personId, from, to);
  return { from, to, weeks: weeklyTotals(days), days };
}

// Every time this person ran a given library workout, oldest first, so Claude
// can compare splits and HR over the season.
export async function workoutHistory(db, personId, libraryId) {
  const w = WORKOUTS.find((x) => x.id === libraryId);
  if (!w) throw new LogError(`Unknown library workout "${libraryId}"`);
  const [days, runs] = await Promise.all([
    db.prepare('SELECT date FROM training_days WHERE person_id = ? AND library_id = ?').bind(personId, libraryId).all(),
    db.prepare('SELECT date FROM workouts WHERE person_id = ? AND library_id = ?').bind(personId, libraryId).all(),
  ]);
  const dates = [...new Set([...days.results, ...runs.results].map((r) => r.date))].sort();
  const out = [];
  for (const date of dates) out.push((await getDays(db, personId, date, date))[0]);
  return { workout: { id: w.id, name: w.name }, times_run: out.length, history: out };
}

export async function fiveKFor(db, personId) {
  const row = await db.prepare('SELECT five_k_time FROM people WHERE id = ?').bind(personId).first();
  return row?.five_k_time || '';
}

export async function setFiveK(db, personId, time) {
  const t = clip(time, 8);
  if (t && !pacesFrom5k(t)) throw new LogError('5K time must look like 19:25');
  const res = await db.prepare('UPDATE people SET five_k_time = ? WHERE id = ?').bind(t, personId).run();
  if (!res.meta.changes) throw new LogError('Unknown person');
  return { five_k_time: t, paces: pacesFrom5k(t) };
}

export function libraryMeta() {
  return { types: WORKOUT_TYPES, races: RACES, phases: PHASES, pace_zones: PACE_ZONES.map((z) => z.label), day_types: DAY_TYPES, statuses: DAY_STATUSES };
}

export function searchLibrary(args) {
  const list = findWorkouts(args || {});
  return {
    count: list.length,
    workouts: list.map((w) => ({ id: w.id, name: w.name, type: w.type, races: w.races, phase: w.phase, level: w.level, total_min: w.total_min, main: w.main, source: w.source })),
  };
}

export async function getLibraryWorkout(db, personId, id) {
  const w = WORKOUTS.find((x) => x.id === id);
  if (!w) throw new LogError(`Unknown library workout "${id}"`);
  const fiveK = personId ? await fiveKFor(db, personId) : '';
  return { ...w, your_paces: fiveK ? { five_k_time: fiveK, paces: pacesFrom5k(fiveK) } : 'Set a 5K time (set_5k_time) to get personal paces.' };
}

// ------------------------------------------------------------------ MCP tools

const DAY_PROPS = {
  manual_miles: { type: 'number', description: 'Total miles, only for days with no Strava runs (Strava runs are summed automatically)' },
  minutes: { type: 'number' },
  runs: { type: 'integer', description: 'Number of runs that day (doubles = 2)' },
  difficulty: { type: 'integer', minimum: 1, maximum: 10, description: 'How hard the day was, 1-10' },
  types: { type: 'array', items: { type: 'string', enum: DAY_TYPES } },
  status: { type: 'string', enum: [...DAY_STATUSES, ''] },
  planned: { type: 'string', description: 'The planned session, as prescribed' },
  library_id: { type: 'string', description: 'Workout library id, when the session was a library workout (lets you track progress on it)' },
  splits: { type: 'string', description: 'Rep splits, e.g. "6:47, 6:33, 6:24, 5:57"' },
  summary: { type: 'string', description: 'What actually happened: dose, pace, HR, conditions, how it felt' },
  coach_note: { type: 'string', description: 'What was changed for upcoming days and why' },
  load_note: { type: 'string', description: 'Standing read on the last 7-10 days, carried forward' },
  feel: { type: 'integer', minimum: 1, maximum: 5 },
  sleep_hours: { type: 'number' },
  strength: { type: 'boolean', description: 'Did strength/core work' },
  notes: { type: 'string', description: "The athlete's own notes" },
};

const FIND_PROPS = {
  type: { type: 'string', enum: Object.keys(WORKOUT_TYPES) },
  race: { type: 'string', enum: RACES, description: 'Race being prepared for' },
  phase: { type: 'string', enum: PHASES },
  level: { type: 'integer', minimum: 1, maximum: 3, description: 'Max difficulty level: 1 beginner (30-35 mpw), 2 intermediate (40-50), 3 advanced (55+)' },
  max_min: { type: 'integer', description: 'Longest total session length in minutes' },
  min_min: { type: 'integer' },
  q: { type: 'string', description: 'Text search' },
};

// `withPerson` adds a person argument for the admin MCP; the coach MCP is
// already scoped to one runner.
export function logTools(withPerson) {
  const person = withPerson ? { person: { type: 'string', description: 'Name or id' } } : {};
  const req = withPerson ? ['person'] : [];
  return [
    {
      name: 'get_training_log',
      description: `Daily training log${withPerson ? ' for one person' : ''} between two dates (default: last 28 days): miles, runs, difficulty, run types, status vs plan, planned session, splits, summary and coach notes per day, plus Mon-Sun weekly totals. Strava runs logged through Claude Coach are merged in automatically.`,
      inputSchema: { type: 'object', required: req, properties: { ...person, from: { type: 'string' }, to: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'log_day',
      description: 'Create or update one day of the training log. Only the fields you pass change. Use it after every coaching review: status vs plan, difficulty, summary of what happened, coach_note for any change you made, load_note for the rolling picture, and library_id if it was a library workout.',
      inputSchema: { type: 'object', required: [...req, 'date'], properties: { ...person, date: { type: 'string', description: 'YYYY-MM-DD' }, ...DAY_PROPS }, additionalProperties: false },
    },
    {
      name: 'find_workouts',
      description: `Search the Hawks workout library (${WORKOUTS.length} workouts built from the Hawks plans, past training logs and standard distance training). Filter by type (tempo, threshold, vo2, track, fartlek, hills, long, ...), race being trained for, season phase, level and session length. Use it whenever you suggest or swap a workout.`,
      inputSchema: { type: 'object', properties: FIND_PROPS, additionalProperties: false },
    },
    {
      name: 'get_workout',
      description: "Full details of one library workout: structure, paces, recovery, purpose, coaching cues and how to progress it, plus the runner's own paces when their 5K time is set.",
      inputSchema: { type: 'object', required: [...req, 'id'], properties: { ...person, id: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'get_workout_history',
      description: 'Every time this runner did a given library workout, oldest first, with splits, HR, difficulty and notes. Use it to judge improvement and set the next target.',
      inputSchema: { type: 'object', required: [...req, 'id'], properties: { ...person, id: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'set_5k_time',
      description: "Set the runner's current 5K fitness (race or equivalent, mm:ss). Returns their pace for every training zone. Update it after a race or time trial.",
      inputSchema: { type: 'object', required: [...req, 'time'], properties: { ...person, time: { type: 'string', description: 'e.g. 19:25' } }, additionalProperties: false },
    },
  ];
}

export async function callLogTool(db, personId, name, a, today) {
  switch (name) {
    case 'get_training_log': {
      const to = isDate(a.to) ? a.to : today;
      const from = isDate(a.from) ? a.from : addDays(to, -27);
      return await getLog(db, personId, from, to);
    }
    case 'log_day': {
      const { person, date, ...fields } = a;
      return await saveDay(db, personId, date, fields);
    }
    case 'find_workouts': return searchLibrary(a);
    case 'get_workout': return await getLibraryWorkout(db, personId, a.id);
    case 'get_workout_history': return await workoutHistory(db, personId, a.id);
    case 'set_5k_time': return await setFiveK(db, personId, a.time);
    default: return undefined;
  }
}
