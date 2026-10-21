// Hawky in Claude. Each runner's own Claude pulls their runs from whatever
// activity connector they have (COROS, Strava, or a Garmin one) and logs them
// here through a per-person MCP endpoint (/mcp/coach/<coach_token>). Claude
// only labels each run and writes a short note; the numbers (effort, load,
// plan match) are worked out here so every run is scored the same way no
// matter whose Claude sent it. The built-in Hawky (gemini.js) uses the same
// scoring.
import { PLANS, CLASS_YEAR_RANK, PLAN_VARIANTS } from './plans.js';
import { logTools, callLogTool, LogError, getDays, fiveKFor, getPrs, PR_EVENTS } from './log.js';
import { getFitness } from './fitness.js';
import { trackMiles } from './workouts.js';
import { BODY_PARTS } from './body.js';

// Health, training status and the body map, as Hawky reads them.
export async function bodyStatus(db, personId) {
  const [p, marks] = await Promise.all([
    db.prepare('SELECT health_status, training_status FROM people WHERE id = ?').bind(personId).first(),
    db.prepare('SELECT part, status FROM body_marks WHERE person_id = ?').bind(personId).all(),
  ]);
  return {
    health: p?.health_status || 'healthy',
    training: p?.training_status || '',
    marked: marks.results.map((m) => ({ part: m.part, name: BODY_PARTS[m.part] || m.part, status: m.status })),
  };
}

export class CoachError extends Error {}

const TZ = 'America/New_York';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CATEGORIES = ['easy', 'recovery', 'long', 'workout', 'race', 'shakeout', 'crosstrain'];
const HARD = new Set(['workout', 'race']);
const DEFAULT_MAX_HR = 200;
export const SOURCES = ['coros', 'strava', 'garmin', 'intervals'];

// Shown to Claude in get_coach_context so it labels runs the same way the
// scoring below expects.
export const COACH_RUBRIC = `How Hawks scores a run (the server does the math; you pick the category and write the note):

CATEGORY — pick one per activity:
- easy: steady conversational run, avg HR under ~80% of max HR
- recovery: very easy and short (usually under 4 mi), avg HR under ~72% of max
- long: the longest run of the week, usually Sunday, 8+ mi, mostly easy effort
- workout: intervals, tempo, hills, fartlek or progression — look for laps or pace that swing between fast and slow, or avg HR 82%+ for a steady tempo. Warm-up and cool-down inside the same activity still count as the workout.
- race: a meet or time trial (name says race/meet/XC/5k, or it falls on a meet day at near-max HR)
- shakeout: short (2-3 mi) easy run the day before or the morning of a race
- crosstrain: bike, swim, elliptical, walk, hike, lift — anything that isn't a run

EFFORT (1-10) comes from avg HR as a share of the runner's max HR (the highest max HR seen in their logged runs, 200 until known): under 65% = 2, 65-72% = 3, 72-78% = 4, 78-83% = 5, 83-87% = 6, 87-90% = 7, 90-93% = 8, 93-96% = 9, over 96% = 10. With no HR it falls back on the category.

LOAD = moving minutes x intensity (effort 1-3 = 1, 4-5 = 1.5, 6 = 2, 7 = 2.5, 8 = 3, 9-10 = 4). A 45-minute easy run is about 45-70; a hard workout is about 120-200.

PLAN MATCH (0-100) compares the run to that day's plan:
- Type, 50 pts: the right kind of run for the day (easy/long/shakeout on easy days, workout/race on workout and race days). Going hard on an easy day gets 15. Running on an off day gets 25 (crosstraining on an off day gets the full 50).
- Distance, 50 pts: 50 x (1 - miss/planned), where a miss within 10% counts as on target.
- Easy-day guard: an easy, recovery or long run at effort 6+ loses 15 more (easy days should be easy).
Hawks shows plan match per DAY, not per activity: a warm-up, workout and cool-down saved separately are one session and are judged together against the day's plan (On plan / Close / Off plan, with the reason).

BODY: body (in get_coach_context) is the runner's health status and body map (parts marked sore or pain). Check in on marked parts, and on easy days after a hard week ask how their legs feel. Pain that lasts or gets worse goes to their coach or a doctor; never diagnose.

SESSIONS: activities less than ~75 min apart are one session. Write ONE report per session on its main activity (the workout, race or longest run) and leave the warm-up/cool-down summaries empty.

YOUR NOTE (summary, 2-4 sentences, on the session's main activity): what the session was, how it compared to the plan, how the reps or pace compared to the runner's Fitness States paces, and one useful coaching point (pacing, HR drift, cadence under ~165 spm, too fast on an easy day, a strong workout). Be honest but encouraging, like a good high school XC coach.

TRACK: if a session was on a track (the watch says track run, the name says track, or the reps land on 200/400/800/1600 marks on flat ground), send surface "track". Report track reps as 200/400/800/1200/1600 m (round to the nearest 100 m, a mile is 1600 m) and track mileage in eighths of a mile. No elevation on the track.

FITNESS STATES: fitness (in get_coach_context) holds the runner's current estimates for 400 to half marathon, VO2max estimate, recent mileage and pace zones. Use those paces for every workout target. Never invent a pace that isn't from there or from the library.

DAILY LOG (log_day) — after logging runs, write one log_day per date like a coach's log: status (as_planned, harder, easier, missed, adjusted, rest), types, planned (the plan's session), day_line (one sentence on the whole day), summary (dose and pace vs prescription, HR drift, conditions), split_reps for reps, coach_note (what you'd change for the next days and why), load_note (rolling read on the last 7-10 days). Miles, minutes and difficulty come from the synced runs; don't send them for days with runs. A planned run day with no activity is "missed".

WORKOUT LIBRARY — when suggesting or adjusting a workout, pick it with find_workouts (filter by the race they're training for, phase, level and time available) and give paces from get_workout. Set library_id on the run and the day so get_workout_history can compare it next time. Judge improvement by comparing the same workout over time, not single runs.`;

const r = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n));

function num(v, { min = 0, max = 1e7 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function clip(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

export function todayInTz(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStartOf(dateKey) {
  const dow = new Date(dateKey + 'T12:00:00Z').getUTCDay();
  return addDays(dateKey, dow === 0 ? -6 : 1 - dow);
}

export function planFor(person) {
  const rank = PLANS[person.plan_rank] ? person.plan_rank : (CLASS_YEAR_RANK[person.class_year] ?? null);
  if (!rank) return null;
  return PLAN_VARIANTS[person.id]?.[rank] || PLANS[rank];
}

// Race week when a meet is within the next 6 days, same as the Training tab.
export async function meetDates(db, from, to) {
  const rows = await db.prepare("SELECT date FROM events WHERE type = 'meet' AND date >= ? AND date <= ?").bind(from, to).all();
  return rows.results.map((x) => x.date);
}

export function plannedFor(plan, dateKey, meets) {
  if (!plan) return null;
  const week = meets.some((m) => m >= dateKey && m <= addDays(dateKey, 6)) ? 1 : 0;
  const dayName = DAY_NAMES[new Date(dateKey + 'T12:00:00Z').getUTCDay()];
  const day = plan.days.find((d) => d.day === dayName);
  const cell = day?.cells[week];
  if (!cell) return null;
  const miles = parseFloat(cell.miles) || 0;
  return { type: cell.type, miles, detail: cell.miles, shoes: cell.shoes, notes: cell.notes, week: plan.weeks[week]?.name };
}

async function maxHrFor(db, personId) {
  const row = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(personId).first();
  return row?.m && row.m >= 160 ? row.m : DEFAULT_MAX_HR;
}

const EFFORT_STEPS = [[0.65, 2], [0.72, 3], [0.78, 4], [0.83, 5], [0.87, 6], [0.90, 7], [0.93, 8], [0.96, 9]];
const CATEGORY_EFFORT = { recovery: 2, easy: 4, shakeout: 3, long: 5, crosstrain: 4, workout: 7, race: 9 };

function effortOf(w, maxHr) {
  if (!w.avg_hr) return CATEGORY_EFFORT[w.category] ?? 4;
  const pct = w.avg_hr / maxHr;
  for (const [cut, e] of EFFORT_STEPS) if (pct < cut) return e;
  return 10;
}

function loadOf(w, effort) {
  const minutes = (w.moving_sec ?? w.elapsed_sec ?? 0) / 60;
  const factor = effort <= 3 ? 1 : effort <= 5 ? 1.5 : effort === 6 ? 2 : effort === 7 ? 2.5 : effort === 8 ? 3 : 4;
  return r(minutes * factor);
}

function planScoreOf(w, effort, planned) {
  if (!planned) return null;
  const t = planned.type.toLowerCase();
  const plannedHard = t === 'workout' || t === 'race';
  const plannedOff = t === 'off' || planned.miles === 0;
  let typePts;
  if (plannedOff) typePts = w.category === 'crosstrain' ? 50 : 25;
  else if (plannedHard) typePts = HARD.has(w.category) ? 50 : (w.category === 'crosstrain' ? 10 : 25);
  else typePts = HARD.has(w.category) ? 15 : (w.category === 'crosstrain' ? 20 : 50);

  let distPts = 50;
  if (!plannedOff && planned.miles > 0 && w.category !== 'crosstrain') {
    const miss = Math.abs((w.distance_mi ?? 0) - planned.miles) / planned.miles;
    distPts = miss <= 0.1 ? 50 : Math.max(0, 50 * (1 - miss));
  } else if (!plannedOff && w.category === 'crosstrain') {
    distPts = 20;
  }

  let score = typePts + distPts;
  if (['easy', 'recovery', 'long'].includes(w.category) && effort >= 6) score -= 15;
  return Math.max(0, Math.min(100, r(score)));
}

function gradeOf(score) {
  if (score === null) return '';
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

// Some services count one foot (84), others both (168). Runners never run
// under ~120 steps/min, so anything below that is one-foot and gets doubled.
function cadenceSpm(c) {
  if (c === null) return null;
  return r(c < 120 ? c * 2 : c);
}

// Work reps: [{ m, s, hr }], kept small.
function cleanLaps(v) {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return ''; } }
  if (!Array.isArray(arr)) return '';
  const out = arr.slice(0, 40).map((l) => ({ m: r(num(l?.m, { max: 20000 })), s: Math.round((num(l?.s, { max: 7200 }) || 0) * 10) / 10, hr: r(num(l?.hr, { min: 30, max: 250 })) }))
    .filter((l) => l.m && l.s);
  return out.length ? JSON.stringify(out) : '';
}

function cleanWorkout(raw) {
  const date = clip(raw?.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CoachError('Each workout needs date as YYYY-MM-DD (the local start date)');
  // The column is still called strava_id; other sources are stored as
  // "coros:<id>" / "garmin:<id>" so ids from different services never collide.
  const source = SOURCES.includes(raw?.source) ? raw.source : 'strava';
  const rawId = clip(raw?.activity_id ?? raw?.strava_id, 40);
  if (!rawId) throw new CoachError(`Workout on ${date} is missing activity_id`);
  const strava_id = source === 'strava' ? rawId : `${source}:${rawId}`;
  const category = clip(raw?.category, 20).toLowerCase();
  if (!CATEGORIES.includes(category)) throw new CoachError(`Workout ${strava_id}: category must be one of ${CATEGORIES.join(', ')}`);
  const surface = raw?.surface === 'track' ? 'track' : '';
  const gpsMi = num(raw.raw_distance_mi ?? raw.distance_mi, { max: 200 });
  const gpsElev = r(num(raw.elev_gain_ft, { max: 50000 }));
  return {
    strava_id, date, category, surface,
    raw_distance_mi: gpsMi,
    raw_elev_ft: gpsElev,
    name: clip(raw.name, 200),
    sport: clip(raw.sport, 40) || 'Run',
    // On the track: miles in eighths (200 m) and no elevation.
    distance_mi: surface ? (num(raw.distance_mi, { max: 200 }) != null ? trackMiles(num(raw.distance_mi, { max: 200 })) : null) : num(raw.distance_mi, { max: 200 }),
    moving_sec: r(num(raw.moving_sec, { max: 86400 })),
    elapsed_sec: r(num(raw.elapsed_sec, { max: 172800 })),
    avg_hr: r(num(raw.avg_hr, { min: 30, max: 250 })),
    max_hr: r(num(raw.max_hr, { min: 30, max: 250 })),
    avg_cadence: cadenceSpm(num(raw.avg_cadence, { max: 260 })),
    elev_gain_ft: surface ? 0 : gpsElev,
    start_local: /^\d{1,2}:\d{2}$/.test(clip(raw.start_local, 5)) ? clip(raw.start_local, 5).padStart(5, '0') : '',
    laps: cleanLaps(raw.laps),
    summary: clip(raw.summary, 1000),
    library_id: clip(raw.library_id, 60),
  };
}

function toPublic(row) {
  const pace = row.distance_mi && row.moving_sec ? row.moving_sec / row.distance_mi : null;
  return {
    strava_id: row.strava_id, date: row.date, name: row.name, sport: row.sport, category: row.category,
    distance_mi: row.distance_mi, moving_sec: row.moving_sec, elapsed_sec: row.elapsed_sec,
    pace_per_mi: pace ? `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')}` : null,
    avg_hr: row.avg_hr, max_hr: row.max_hr, avg_cadence: row.avg_cadence, elev_gain_ft: row.elev_gain_ft,
    planned_type: row.planned_type, planned_miles: row.planned_miles,
    effort: row.effort, load: row.load, plan_score: row.plan_score, rating: row.rating, summary: row.summary,
  };
}

async function listWorkouts(db, personId, from, to) {
  const rows = await db.prepare(
    'SELECT * FROM workouts WHERE person_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, created_at DESC'
  ).bind(personId, from, to).all();
  return rows.results.map(toPublic);
}

// This week (Mon-Sun): planned vs done per day, plus totals.
async function weekSummary(db, person, today) {
  const start = weekStartOf(today);
  const end = addDays(start, 6);
  const plan = planFor(person);
  const meets = await meetDates(db, start, addDays(end, 6));
  const done = await listWorkouts(db, person.id, start, end);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const planned = plannedFor(plan, date, meets);
    days.push({
      date, day: DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()],
      planned: planned ? { type: planned.type, miles: planned.miles, detail: planned.detail, notes: planned.notes } : null,
      logged: done.filter((w) => w.date === date).map((w) => ({ category: w.category, miles: w.distance_mi })),
    });
  }
  const miles = done.filter((w) => w.category !== 'crosstrain').reduce((s, w) => s + (w.distance_mi || 0), 0);
  const scored = done.filter((w) => w.plan_score !== null);
  const plannedMiles = days.reduce((s, d) => s + (d.planned?.miles || 0), 0);
  return {
    week_of: start,
    week_type: plannedFor(plan, start, meets)?.week ?? null,
    planned_miles: plannedMiles,
    miles_done: Math.round(miles * 10) / 10,
    load: done.reduce((s, w) => s + (w.load || 0), 0),
    avg_plan_score: scored.length ? r(scored.reduce((s, w) => s + w.plan_score, 0) / scored.length) : null,
    days,
  };
}

export async function personForToken(db, token) {
  if (!token || token.length < 20) return null;
  return await db.prepare('SELECT id, name, first_name, class_year, plan_rank FROM people WHERE coach_token = ?').bind(token).first();
}

// What Hawky needs from Fitness States, without the bookkeeping.
export function compactFitness(f) {
  if (!f || !f.vdot) return { note: f?.note || 'No fitness data yet', weekly_miles_last_4_weeks: f?.mpw ?? null };
  return {
    vo2max: f.vo2max,
    vo2max_source: f.vo2max_source,
    race_fitness_vdot: f.vdot,
    fitness_score: f.fitness_score ? { fitness: f.fitness_score.fitness, fatigue: f.fitness_score.fatigue, form: f.fitness_score.form, change_4wk: f.fitness_score.change_4wk } : null,
    confidence: f.confidence,
    based_on: f.sources.map((s) => s.label),
    race_estimates: Object.fromEntries(f.estimates.map((e) => [e.label, e.time])),
    paces_per_mile: Object.fromEntries(f.zones.map((z) => [z.label, z.per_mile])),
    weekly_miles_last_4_weeks: f.mpw,
    weekly_miles_4_weeks_before: f.mpw_prev,
    profile: f.profile,
    trend: f.trend || null,
  };
}

export async function getCoachContext(db, person) {
  const today = todayInTz();
  const prsNow = await getPrs(db, person.id);
  const logged = await db.prepare(
    'SELECT strava_id FROM workouts WHERE person_id = ? AND date >= ?'
  ).bind(person.id, addDays(today, -30)).all();
  return {
    athlete: person.first_name || person.name,
    today,
    timezone: TZ,
    has_plan: !!planFor(person),
    max_hr_used: await maxHrFor(db, person.id),
    this_week: await weekSummary(db, person, today),
    recent_workouts: await listWorkouts(db, person.id, addDays(today, -14), today),
    already_logged: SOURCES.reduce((o, src) => {
      o[src] = logged.results.map((x) => x.strava_id)
        .filter((id) => (src === 'strava' ? !id.includes(':') : id.startsWith(src + ':')))
        .map((id) => (src === 'strava' ? id : id.slice(src.length + 1)));
      return o;
    }, {}),
    prs: await getPrs(db, person.id),
    missing_prs: PR_EVENTS.filter((e) => !(e in prsNow)),
    five_k_time: (await fiveKFor(db, person.id)) || null,
    fitness: compactFitness(await getFitness(db, person.id, today)),
    body: await bodyStatus(db, person.id),
    training_log_last_14_days: await getDays(db, person.id, addDays(today, -13), today),
    rubric: COACH_RUBRIC,
  };
}

// The same run can arrive twice: once from the intervals.icu sync and once
// from the runner's own Claude reading COROS or Strava. If a run from another
// source matches on date and distance (1.5%, or 0.02 mi on short jogs), reuse
// its row so the newer write updates it in place. Moving time only has to be
// within 25% (or elapsed time within 5%): Strava and Garmin count pauses
// differently, so moving time often differs by 10-20% for the very same run.
async function mergeDuplicates(db, personId, clean) {
  const dates = [...new Set(clean.map((w) => w.date))];
  if (!dates.length) return;
  const rows = (await db.prepare(
    `SELECT strava_id, date, distance_mi, COALESCE(raw_distance_mi, distance_mi) AS gps_mi, moving_sec, elapsed_sec, avg_hr, max_hr, avg_cadence, elev_gain_ft FROM workouts WHERE person_id = ? AND date IN (${dates.map(() => '?').join(',')})`
  ).bind(personId, ...dates).all()).results;
  const srcOf = (id) => (id.includes(':') ? id.split(':')[0] : 'strava');
  const sameDistance = (a, b) => a && b && Math.abs(a - b) <= Math.max(0.02, 0.015 * Math.max(a, b));
  const sameTime = (a, b) => !a || !b || Math.abs(a - b) / Math.max(a, b) <= 0.25;
  // Some Strava runs were logged with elapsed time as moving time.
  const sameElapsed = (a, b) => a && b && Math.abs(a - b) <= Math.max(5, 0.05 * Math.max(a, b));
  for (const w of clean) {
    if (rows.some((r) => r.strava_id === w.strava_id)) continue;
    const twin = rows.find((r) => r.date === w.date && srcOf(r.strava_id) !== srcOf(w.strava_id)
      && sameDistance(r.gps_mi, w.raw_distance_mi ?? w.distance_mi)
      && (sameTime(r.moving_sec, w.moving_sec) || sameElapsed(r.elapsed_sec, w.elapsed_sec) || sameElapsed(r.moving_sec, w.elapsed_sec))
      && !clean.some((o) => o !== w && o.strava_id === r.strava_id));
    if (twin) w.strava_id = twin.strava_id;
  }
  // Score with the best numbers we have: fill gaps from the stored row.
  for (const w of clean) {
    const row = rows.find((r) => r.strava_id === w.strava_id);
    if (!row) continue;
    for (const k of ['distance_mi', 'moving_sec', 'elapsed_sec', 'avg_hr', 'max_hr', 'avg_cadence', 'elev_gain_ft']) {
      if (w[k] === null || w[k] === undefined) w[k] = row[k];
    }
  }
}

export async function logWorkouts(db, person, list) {
  if (!Array.isArray(list) || !list.length) throw new CoachError('workouts must be a non-empty array');
  if (list.length > 60) throw new CoachError('Send at most 60 workouts per call');
  const clean = list.map(cleanWorkout);
  await mergeDuplicates(db, person.id, clean);

  // Max HR can come from this batch too, so a first sync is scored sensibly.
  const batchMax = Math.max(0, ...clean.map((w) => w.max_hr || 0));
  const knownMax = await maxHrFor(db, person.id);
  const maxHr = knownMax === DEFAULT_MAX_HR ? (batchMax >= 160 ? batchMax : DEFAULT_MAX_HR) : Math.max(knownMax, batchMax);

  const dates = clean.map((w) => w.date).sort();
  const meets = await meetDates(db, dates[0], addDays(dates[dates.length - 1], 6));
  const plan = planFor(person);
  const now = Date.now();
  const results = [];
  const stmts = clean.map((w) => {
    const planned = plannedFor(plan, w.date, meets);
    const effort = effortOf(w, maxHr);
    const load = loadOf(w, effort);
    const plan_score = planScoreOf(w, effort, planned);
    const rating = gradeOf(plan_score);
    results.push({ strava_id: w.strava_id, date: w.date, category: w.category, planned: planned ? `${planned.type} ${planned.detail}` : null, effort, load, plan_score });
    return db.prepare(
      `INSERT INTO workouts (id, person_id, strava_id, date, name, sport, category, distance_mi, moving_sec, elapsed_sec,
         avg_hr, max_hr, avg_cadence, elev_gain_ft, planned_type, planned_miles, effort, plan_score, load, rating, summary, library_id, start_local, laps,
         surface, raw_distance_mi, raw_elev_ft, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, strava_id) DO UPDATE SET
         date=excluded.date, name=COALESCE(NULLIF(excluded.name, ''), name), sport=excluded.sport, category=excluded.category,
         distance_mi=COALESCE(excluded.distance_mi, distance_mi), moving_sec=COALESCE(excluded.moving_sec, moving_sec),
         elapsed_sec=COALESCE(excluded.elapsed_sec, elapsed_sec),
         avg_hr=COALESCE(excluded.avg_hr, avg_hr), max_hr=COALESCE(excluded.max_hr, max_hr),
         avg_cadence=COALESCE(excluded.avg_cadence, avg_cadence), elev_gain_ft=COALESCE(excluded.elev_gain_ft, elev_gain_ft),
         planned_type=excluded.planned_type, planned_miles=excluded.planned_miles, effort=excluded.effort,
         plan_score=excluded.plan_score, load=excluded.load, rating=excluded.rating,
         summary=COALESCE(NULLIF(excluded.summary, ''), summary), library_id=COALESCE(NULLIF(excluded.library_id, ''), library_id),
         start_local=COALESCE(NULLIF(excluded.start_local, ''), start_local), laps=COALESCE(NULLIF(excluded.laps, ''), laps),
         surface=CASE WHEN excluded.surface = 'track' THEN 'track' ELSE surface END,
         raw_distance_mi=COALESCE(excluded.raw_distance_mi, raw_distance_mi), raw_elev_ft=COALESCE(excluded.raw_elev_ft, raw_elev_ft),
         updated_at=excluded.updated_at`
    ).bind(
      'w_' + crypto.randomUUID(), person.id, w.strava_id, w.date, w.name, w.sport, w.category, w.distance_mi,
      w.moving_sec, w.elapsed_sec, w.avg_hr, w.max_hr, w.avg_cadence, w.elev_gain_ft,
      planned?.type ?? '', planned?.miles ?? null, effort, plan_score, load, rating, w.summary, w.library_id, w.start_local, w.laps,
      w.surface, w.raw_distance_mi, w.raw_elev_ft, now, now
    );
  });
  await db.batch(stmts);
  return { logged: results, max_hr_used: maxHr, this_week: await weekSummary(db, person, todayInTz()) };
}

export async function getMyWorkouts(db, person, args) {
  const today = todayInTz();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(args?.from || '') ? args.from : addDays(today, -30);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(args?.to || '') ? args.to : today;
  return { from, to, workouts: await listWorkouts(db, person.id, from, to) };
}

// For the web app's Training tab.
export async function workoutsForApp(db, personId) {
  const person = await db.prepare('SELECT id, name, first_name, class_year, plan_rank, coach_token FROM people WHERE id = ?').bind(personId).first();
  if (!person) return null;
  const today = todayInTz();
  return {
    connected: !!person.coach_token,
    this_week: await weekSummary(db, person, today),
    workouts: await listWorkouts(db, personId, addDays(today, -28), today),
  };
}

// Admin MCP: everyone's week, for "who's putting in the work".
export async function teamTraining(db, days) {
  const n = Number.isInteger(days) && days >= 1 && days <= 60 ? days : 7;
  const today = todayInTz();
  const people = (await db.prepare('SELECT id, name, first_name, class_year, plan_rank, coach_token FROM people ORDER BY name').all()).results;
  const out = [];
  for (const p of people) {
    const week = await weekSummary(db, p, today);
    out.push({
      name: p.name,
      connected: !!p.coach_token,
      week: { planned_miles: week.planned_miles, miles_done: week.miles_done, load: week.load, avg_plan_score: week.avg_plan_score, days_run: week.days.filter((d) => d.logged.length).length },
      workouts: await listWorkouts(db, p.id, addDays(today, -(n - 1)), today),
    });
  }
  return { today, week_of: weekStartOf(today), people: out };
}

export async function issueCoachToken(db, personId, regenerate) {
  const row = await db.prepare('SELECT coach_token FROM people WHERE id = ?').bind(personId).first();
  if (!row) return null;
  if (row.coach_token && !regenerate) return row.coach_token;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('UPDATE people SET coach_token = ? WHERE id = ?').bind(token, personId).run();
  return token;
}

export const COACH_TOOLS = [
  {
    name: 'get_coach_context',
    description: "Start here every time. Returns who you're coaching, today's date, this week's Hawks training plan day by day (planned type and miles) with what's already logged, the last 14 days of logged runs, the activity ids already logged per source (skip those), the runner's PRs, their Fitness States (race estimates, VO2max estimate, mileage and pace zones) and the scoring rubric to follow when picking categories.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'log_workouts',
    description: 'Save activities from the runner\'s COROS, Strava or Garmin connector to Hawks. Send the raw numbers, local start time, your category, work laps if it was a workout, and one session report on the main activity of each session; Hawks works out effort (1-10), training load and plan match, saves it to the Training log, and returns the scores plus the updated week. Re-sending the same source + activity_id updates it.',
    inputSchema: {
      type: 'object',
      required: ['workouts'],
      properties: {
        workouts: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          items: {
            type: 'object',
            required: ['source', 'activity_id', 'date', 'category'],
            properties: {
              source: { type: 'string', enum: SOURCES, description: 'Which connector the activity came from' },
              activity_id: { type: 'string', description: "The activity's id in that service" },
              date: { type: 'string', description: 'Local start date, YYYY-MM-DD' },
              name: { type: 'string', description: 'Activity title' },
              sport: { type: 'string', description: 'Sport type, e.g. Run, TrailRun, Ride, Swim, Workout' },
              category: { type: 'string', enum: CATEGORIES },
              distance_mi: { type: 'number', description: 'Miles (meters / 1609.34, km x 0.6214)' },
              moving_sec: { type: 'integer' },
              elapsed_sec: { type: 'integer' },
              avg_hr: { type: 'integer' },
              max_hr: { type: 'integer' },
              avg_cadence: { type: 'integer', description: 'Average cadence as the connector reports it; Hawks doubles one-foot values (under 120) automatically.' },
              elev_gain_ft: { type: 'integer', description: 'Feet (meters x 3.281)' },
              start_local: { type: 'string', description: 'Local start time HH:MM (groups warm-up, workout and cool-down into one session)' },
              surface: { type: 'string', enum: ['track', ''], description: '"track" for sessions run on a track: Hawks rounds reps to 100 m and miles to eighths, and drops elevation' },
              laps: { type: 'array', description: 'Work reps only (not warm-up/recovery): meters, seconds, avg HR', items: { type: 'object', properties: { m: { type: 'number' }, s: { type: 'number' }, hr: { type: 'number' } }, required: ['m', 's'] } },
              summary: { type: 'string', description: 'Session report (2-4 sentences) on the main activity of the session; empty for warm-ups and cool-downs' },
              library_id: { type: 'string', description: 'Workout library id if this run was a library workout (see find_workouts)' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_my_workouts',
    description: 'Logged workouts with their scores between two dates (default: the last 30 days). Use it for weekly reviews or questions like "how was my week?".',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
];

COACH_TOOLS.push(...logTools(false));

export async function callCoachTool(db, person, name, args) {
  try {
    const out = await callLogTool(db, person.id, name, args || {}, todayInTz());
    if (out !== undefined) return out;
  } catch (err) {
    throw err instanceof LogError ? new CoachError(err.message) : err;
  }
  switch (name) {
    case 'get_coach_context': return await getCoachContext(db, person);
    case 'log_workouts': return await logWorkouts(db, person, args?.workouts);
    case 'get_my_workouts': return await getMyWorkouts(db, person, args);
    default: throw new CoachError(`Unknown tool: ${name}`);
  }
}
