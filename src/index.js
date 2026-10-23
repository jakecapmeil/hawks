import { PLANS, CLASS_YEAR_RANK, PLAN_VARIANTS } from './plans.js';
import { logTools, callLogTool, LogError, getLog, saveDay, setDayTrack, libraryMeta, setFiveK, fiveKFor, setPrs, getPrs } from './log.js';
import { WORKOUTS, WORKOUT_GROUPS, workoutGroup, workoutTargets, personalWorkout } from './workouts.js';
import { todayInTz, getCoachContext, compactFitness } from './coach.js';
import { connect as icuConnect, disconnect as icuDisconnect, status as icuStatus, syncPerson, importHistory, syncDue, IntervalsError, SYNC_CRON } from './intervals.js';
import { getFitness, recomputeFitness, fitnessHistory } from './fitness.js';
import { pushPlan, planWorkouts } from './planpush.js';
import { racePredictions } from './racepredict.js';
import { BODY_PARTS } from './body.js';
import { hawkyState, applyPlanChange, resetPlanDay, changeLevel, healthSummary, PlanError } from './hawky.js';
import { aiEnabled, askCoach, AiError } from './gemini.js';
import { COACH_TOOLS, callCoachTool, personForToken, workoutsForApp, issueCoachToken, teamTraining } from './coach.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getState(db) {
  const [people, overrides, comments, events, rsvps, bodyMarks, posts, locations, travelEstimates] = await Promise.all([
    db.prepare(
      `SELECT id, name, color, phone, email, default_status, health_status, training_status,
              first_name, class_year, track_id, date_entered, borough, home_address,
              out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes, prs
       FROM people`
    ).all(),
    db.prepare('SELECT person_id, date, status FROM availability_overrides').all(),
    db.prepare('SELECT date, person_id, text FROM comments').all(),
    db.prepare('SELECT id, date, title, time, end_time, description, type, kind, auto, location, location_id, checklist, results FROM events').all(),
    db.prepare('SELECT event_id, person_id, status FROM rsvps').all(),
    db.prepare('SELECT person_id, part, status FROM body_marks').all(),
    db.prepare('SELECT id, person_id, text, header, created_at FROM posts').all(),
    db.prepare('SELECT id, name, address, kind, lat, lng FROM locations').all(),
    db.prepare('SELECT person_id, location_id, daypart, minutes, note FROM travel_estimates').all(),
  ]);

  const overridesMap = {};
  for (const row of overrides.results) {
    (overridesMap[row.person_id] ??= {})[row.date] = row.status;
  }

  const commentsMap = {};
  for (const row of comments.results) {
    (commentsMap[row.date] ??= {})[row.person_id] = row.text;
  }

  const eventsMap = {};
  for (const row of events.results) {
    (eventsMap[row.date] ??= []).push({
      id: row.id,
      date: row.date,
      title: row.title,
      time: row.time,
      endTime: row.end_time || '',
      desc: row.description,
      type: row.type,
      kind: row.kind || '',
      auto: !!row.auto,
      location: row.location || '',
      locationId: row.location_id || '',
      checklist: row.checklist || '',
      results: row.results || '',
    });
  }

  const rsvpsMap = {};
  for (const row of rsvps.results) {
    (rsvpsMap[row.event_id] ??= {})[row.person_id] = row.status;
  }

  const bodyMap = {};
  for (const row of bodyMarks.results) {
    (bodyMap[row.person_id] ??= {})[row.part] = row.status;
  }

  const postsList = posts.results.map(row => ({
    id: row.id,
    personId: row.person_id,
    text: row.text,
    header: row.header || '',
    createdAt: row.created_at,
  }));

  return {
    people: people.results,
    overrides: overridesMap,
    comments: commentsMap,
    events: eventsMap,
    rsvps: rsvpsMap,
    body: bodyMap,
    posts: postsList,
    locations: locations.results,
    travelEstimates: travelEstimates.results,
  };
}

async function upsertPerson(db, body) {
  const id = str(body?.id, 100);
  const name = str(body?.name, 100);
  const color = str(body?.color, 20) || '#7a4fae';
  const phone = str(body?.phone, 40);
  const email = str(body?.email, 200);
  if (!id || !name) return json({ error: 'Missing id or name' }, 400);

  await db.prepare(
    `INSERT INTO people (id, name, color, phone, email) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, phone=excluded.phone, email=excluded.email`
  ).bind(id, name, color, phone, email).run();

  return json({ ok: true });
}

const VALID_CLASS_YEARS = ['', 'Freshman', 'Sophomore', 'Junior', 'Senior'];

function outPeriod(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

async function upsertPersonal(db, body, env, ctx) {
  const personId = str(body?.personId, 100);
  if (!personId) return json({ error: 'Missing personId' }, 400);

  const firstName = str(body?.firstName, 100);
  const classYear = VALID_CLASS_YEARS.includes(body?.classYear) ? body.classYear : '';
  const trackId = str(body?.trackId, 40);
  const dateEntered = str(body?.dateEntered, 20);
  const borough = str(body?.borough, 60);
  const homeAddress = str(body?.homeAddress, 300);
  const outMon = outPeriod(body?.outMon);
  const outTue = outPeriod(body?.outTue);
  const outWed = outPeriod(body?.outWed);
  const outThu = outPeriod(body?.outThu);
  const outFri = outPeriod(body?.outFri);
  const personalNotes = str(body?.personalNotes, 2000);

  const result = await db.prepare(
    `UPDATE people SET first_name = ?, class_year = ?, track_id = ?, date_entered = ?, borough = ?,
       home_address = ?, out_mon = ?, out_tue = ?, out_wed = ?, out_thu = ?, out_fri = ?, personal_notes = ?
     WHERE id = ?`
  ).bind(firstName, classYear, trackId, dateEntered, borough, homeAddress, outMon, outTue, outWed, outThu, outFri, personalNotes, personId).run();

  if (!result.meta.changes) return json({ error: 'Unknown person' }, 400);
  if (ctx) ctx.waitUntil(syncPersonToSheet(db, personId, env).catch(err => console.error('sheet sync failed', err)));
  return json({ ok: true });
}

// Fire-and-forget push of one person's row to the coach's Google Sheet via a
// bound Apps Script web app. Absent config, this is simply a no-op — the
// Personal tab always writes to D1 first and never depends on the sheet.
async function syncPersonToSheet(db, personId, env) {
  if (!env?.SHEETS_SYNC_URL || !env?.SHEETS_SYNC_SECRET) return;
  const person = await db.prepare(
    `SELECT id, name, first_name, class_year, track_id, date_entered, phone, email, borough,
            home_address, out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes
     FROM people WHERE id = ?`
  ).bind(personId).first();
  if (!person) return;

  await fetch(env.SHEETS_SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.SHEETS_SYNC_SECRET, person }),
  });
}

const VALID_DAYPARTS = ['weekday_practice', 'weekend_meet'];

async function upsertTravelEstimate(db, body) {
  const personId = str(body?.personId, 100);
  const locationId = str(body?.locationId, 100);
  const daypart = str(body?.daypart, 30);
  const minutes = parseInt(body?.minutes, 10);
  const note = str(body?.note, 300);
  if (!personId || !locationId || !VALID_DAYPARTS.includes(daypart) || !Number.isFinite(minutes) || minutes < 0) {
    return json({ error: 'Missing or invalid fields' }, 400);
  }

  await db.prepare(
    `INSERT INTO travel_estimates (person_id, location_id, daypart, minutes, note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(person_id, location_id, daypart) DO UPDATE SET minutes=excluded.minutes, note=excluded.note`
  ).bind(personId, locationId, daypart, minutes, note).run();

  return json({ ok: true });
}

// Driving distance from a person's home to a location, via Google's Distance
// Matrix API, cached in D1 since it costs real money per call. Cache keys on
// the origin address too — if someone updates their home address the old
// row is just a miss, not a silent stale answer.
const DISTANCE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

async function getDistance(db, params, env) {
  const personId = str(params.get('personId'), 100);
  const locationId = str(params.get('locationId'), 100);
  if (!personId || !locationId) return json({ error: 'Missing personId or locationId' }, 400);

  const person = await db.prepare('SELECT home_address FROM people WHERE id = ?').bind(personId).first();
  const location = await db.prepare('SELECT address FROM locations WHERE id = ?').bind(locationId).first();
  if (!person || !location) return json({ error: 'Unknown personId or locationId' }, 400);
  const origin = (person.home_address || '').trim();
  if (!origin) return json({ configured: true, available: false, reason: 'no_home_address' });

  const cached = await db.prepare(
    'SELECT miles, drive_minutes, origin_address, updated_at FROM distance_cache WHERE person_id = ? AND location_id = ?'
  ).bind(personId, locationId).first();
  const fresh = cached && cached.origin_address === origin && (Date.now() - cached.updated_at) < DISTANCE_CACHE_MAX_AGE_MS;
  if (fresh) return json({ configured: true, available: true, miles: cached.miles, driveMinutes: cached.drive_minutes, cached: true });

  if (!env.GOOGLE_MAPS_API_KEY) {
    // No key set up: fall back to a stale cache entry if we have one, else say so.
    if (cached) return json({ configured: true, available: true, miles: cached.miles, driveMinutes: cached.drive_minutes, cached: true, stale: true });
    return json({ configured: false, available: false });
  }

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', origin);
  url.searchParams.set('destinations', location.address);
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url);
  const data = await res.json();
  const element = data?.rows?.[0]?.elements?.[0];
  if (!res.ok || data.status !== 'OK' || !element || element.status !== 'OK') {
    if (cached) return json({ configured: true, available: true, miles: cached.miles, driveMinutes: cached.drive_minutes, cached: true, stale: true });
    return json({ configured: true, available: false, reason: 'lookup_failed' });
  }

  const miles = element.distance.value / 1609.344;
  const driveMinutes = Math.round(element.duration.value / 60);
  await db.prepare(
    `INSERT INTO distance_cache (person_id, location_id, origin_address, miles, drive_minutes, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, location_id) DO UPDATE SET origin_address=excluded.origin_address, miles=excluded.miles, drive_minutes=excluded.drive_minutes, updated_at=excluded.updated_at`
  ).bind(personId, locationId, origin, miles, driveMinutes, Date.now()).run();

  return json({ configured: true, available: true, miles, driveMinutes, cached: false });
}

async function toggleAvailability(db, body) {
  const personId = str(body?.personId, 100);
  const date = str(body?.date, 20);
  if (!personId || !date) return json({ error: 'Missing personId or date' }, 400);

  const person = await db.prepare('SELECT default_status FROM people WHERE id = ?').bind(personId).first();
  if (!person) return json({ error: 'Unknown person' }, 400);

  const existing = await db.prepare('SELECT status FROM availability_overrides WHERE person_id = ? AND date = ?').bind(personId, date).first();
  const current = existing ? existing.status : person.default_status;
  const next = current === 'available' ? 'unavailable' : 'available';

  if (next === person.default_status) {
    await db.prepare('DELETE FROM availability_overrides WHERE person_id = ? AND date = ?').bind(personId, date).run();
  } else {
    await db.prepare(
      `INSERT INTO availability_overrides (person_id, date, status) VALUES (?, ?, ?)
       ON CONFLICT(person_id, date) DO UPDATE SET status=excluded.status`
    ).bind(personId, date, next).run();
  }
  return json({ status: next });
}

const VALID_DEFAULT_STATUS = ['available', 'unavailable'];

async function setDefaultStatus(db, body) {
  const personId = str(body?.personId, 100);
  const status = str(body?.status, 20);
  if (!personId || !VALID_DEFAULT_STATUS.includes(status)) return json({ error: 'Missing personId or invalid status' }, 400);

  const result = await db.prepare('UPDATE people SET default_status = ? WHERE id = ?').bind(status, personId).run();
  if (!result.meta.changes) return json({ error: 'Unknown person' }, 400);
  return json({ ok: true });
}

const VALID_HEALTH_STATUS = ['healthy', 'injured', 'sick'];

async function setHealthStatus(db, body) {
  const personId = str(body?.personId, 100);
  const status = str(body?.status, 20);
  if (!personId || !VALID_HEALTH_STATUS.includes(status)) return json({ error: 'Missing personId or invalid status' }, 400);

  const result = await db.prepare('UPDATE people SET health_status = ?, health_updated_at = ? WHERE id = ?').bind(status, Date.now(), personId).run();
  if (!result.meta.changes) return json({ error: 'Unknown person' }, 400);
  return json({ ok: true });
}

const VALID_TRAINING_STATUS = ['resting', 'running', 'crosstraining'];

// The plan a person should see. Deliberately returns only the plan: no rank,
// and nothing that says which of the six it is.
async function getPlan(db, params) {
  const personId = str(params.get('personId'), 100);
  const grade = str(params.get('grade'), 20);
  let rank = null;
  if (personId) {
    const row = await db.prepare('SELECT class_year, plan_rank FROM people WHERE id = ?').bind(personId).first();
    if (row) rank = PLANS[row.plan_rank] ? row.plan_rank : (CLASS_YEAR_RANK[row.class_year] ?? null);
  } else if (grade) {
    rank = CLASS_YEAR_RANK[grade] ?? null;
  }
  if (!rank) return new Response(JSON.stringify({ error: 'no_plan' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  let plan = (personId && PLAN_VARIANTS[personId]?.[rank]) || PLANS[rank];
  // The runner's own rep targets next to each menu workout, from Fitness States.
  const fitness = personId ? await getFitness(db, personId, todayInTz()) : null;
  if (fitness?.vo2r) {
    plan = JSON.parse(JSON.stringify(plan));
    for (const sec of plan.ref.sessions) sec.targets = sec.items.map((item) => workoutTargets({ main: item, paces: item, type: 'vo2' }, fitness));
  }
  return new Response(JSON.stringify(plan), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// --- Plan ranks (MCP only: ranks are secret, so there is no public endpoint) ---

function parseRank(raw) {
  if (raw === null || raw === undefined) return null;
  const rank = Number(raw);
  if (!(Number.isInteger(rank) && rank >= 1 && rank <= 6)) throw new McpToolError('rank must be an integer 1-6, or null to use the class-year default');
  return rank;
}

// Accepts an id, a full or first name, or a unique piece of a name.
async function resolvePerson(db, ref) {
  const q = str(ref, 100).toLowerCase();
  if (!q) throw new McpToolError('Missing person');
  const rows = (await db.prepare('SELECT id, name, first_name, class_year, plan_rank FROM people').all()).results;
  let hits = rows.filter((r) => r.id.toLowerCase() === q);
  if (!hits.length) hits = rows.filter((r) => r.name.toLowerCase() === q || (r.first_name || '').toLowerCase() === q);
  if (!hits.length) hits = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (hits.length !== 1) {
    throw new McpToolError(hits.length ? `"${ref}" matches ${hits.map((h) => h.name).join(', ')}; be more specific or use the id` : `No one matches "${ref}"`);
  }
  return hits[0];
}

function planSummary(row) {
  const explicit = PLANS[row.plan_rank] ? row.plan_rank : null;
  const effective = explicit ?? CLASS_YEAR_RANK[row.class_year] ?? null;
  return {
    id: row.id,
    name: row.name,
    class_year: row.class_year || '',
    rank: explicit,
    effective_rank: effective,
    source: explicit ? 'rank' : effective ? 'class year' : 'none',
    weekly_miles: effective ? PLANS[effective].weeks[0].miles : null,
    custom_shoes: !!(effective && PLAN_VARIANTS[row.id]?.[effective]),
  };
}

async function mcpSetRanks(db, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new McpToolError('changes must be a non-empty list');
  const resolved = [];
  for (const c of changes) {
    const row = await resolvePerson(db, c?.person ?? c?.personId);
    resolved.push({ row, rank: parseRank(c?.rank) });
  }
  // What the coach sets is the new baseline Hawky levels from.
  await db.batch(resolved.map(({ row, rank }) => db.prepare('UPDATE people SET plan_rank = ?, coach_rank = ? WHERE id = ?').bind(rank, rank, row.id)));
  return resolved.map(({ row, rank }) => ({ ...planSummary({ ...row, plan_rank: rank }), previous_rank: row.plan_rank ?? null }));
}

async function mcpGetPlans(db) {
  const rows = (await db.prepare('SELECT id, name, first_name, class_year, plan_rank FROM people ORDER BY name').all()).results;
  return {
    plans: Object.entries(PLANS).map(([rank, p]) => ({
      rank: Number(rank),
      weekly_miles: p.weeks.map((w) => w.miles),
      class_year_default: Object.keys(CLASS_YEAR_RANK).filter((y) => CLASS_YEAR_RANK[y] === Number(rank)),
    })),
    people: rows.map(planSummary),
  };
}

async function setTrainingStatus(db, body) {
  const personId = str(body?.personId, 100);
  const status = str(body?.status, 20);
  if (!personId || !VALID_TRAINING_STATUS.includes(status)) return json({ error: 'Missing personId or invalid status' }, 400);

  const result = await db.prepare('UPDATE people SET training_status = ? WHERE id = ?').bind(status, personId).run();
  if (!result.meta.changes) return json({ error: 'Unknown person' }, 400);
  return json({ ok: true });
}

const BODY_MARK_CYCLE = { none: 'sore', sore: 'pain', pain: 'none' };

async function toggleBodyMark(db, body) {
  const personId = str(body?.personId, 100);
  const part = str(body?.part, 40);
  if (!personId || !part) return json({ error: 'Missing personId or part' }, 400);

  const existing = await db.prepare('SELECT status FROM body_marks WHERE person_id = ? AND part = ?').bind(personId, part).first();
  const current = existing ? existing.status : 'none';
  const next = BODY_MARK_CYCLE[current];

  if (next === 'none') {
    await db.prepare('DELETE FROM body_marks WHERE person_id = ? AND part = ?').bind(personId, part).run();
  } else {
    await db.prepare(
      `INSERT INTO body_marks (person_id, part, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, part) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`
    ).bind(personId, part, next, Date.now()).run();
  }
  return json({ status: next });
}

async function saveComment(db, body) {
  const date = str(body?.date, 20);
  const personId = str(body?.personId, 100);
  const text = str(body?.text, 2000);
  if (!date || !personId) return json({ error: 'Missing date or personId' }, 400);

  if (text) {
    await db.prepare(
      `INSERT INTO comments (date, person_id, text) VALUES (?, ?, ?)
       ON CONFLICT(date, person_id) DO UPDATE SET text=excluded.text`
    ).bind(date, personId, text).run();
  } else {
    await db.prepare('DELETE FROM comments WHERE date = ? AND person_id = ?').bind(date, personId).run();
  }
  return json({ ok: true });
}

const VALID_EVENT_TYPES = ['practice', 'meet', 'other'];

// Practice sub-type. Only meaningful for type 'practice'; '' means unspecified.
const VALID_EVENT_KINDS = ['', 'easy', 'workout', 'long_run'];

function normalizeKind(type, rawKind) {
  if (type !== 'practice') return '';
  return VALID_EVENT_KINDS.includes(rawKind) ? rawKind : '';
}

async function createEvent(db, body) {
  const date = str(body?.date, 20);
  const title = str(body?.title, 200);
  const time = str(body?.time, 40);
  const endTime = str(body?.endTime, 40);
  const desc = str(body?.desc, 2000);
  const location = str(body?.location, 200);
  const type = VALID_EVENT_TYPES.includes(body?.type) ? body.type : 'practice';
  const kind = normalizeKind(type, body?.kind);
  const locationId = str(body?.locationId, 100) || null;
  const checklist = str(body?.checklist, 1000);
  if (!date || !title) return json({ error: 'Missing date or title' }, 400);

  const id = 'e_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO events (id, date, title, time, end_time, description, type, kind, location, location_id, checklist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, date, title, time, endTime, desc, type, kind, location, locationId, checklist).run();

  return json({ event: { id, date, title, time, endTime, desc, type, kind, location, locationId: locationId || '', checklist, results: '', auto: false } });
}

async function createPost(db, body) {
  const personId = str(body?.personId, 100);
  const text = str(body?.text, 2000);
  const header = str(body?.header, 80);
  if (!personId || !text) return json({ error: 'Missing personId or text' }, 400);

  const id = 'post_' + crypto.randomUUID();
  const createdAt = Date.now();
  await db.prepare(
    'INSERT INTO posts (id, person_id, text, header, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, personId, text, header, createdAt).run();

  return json({ post: { id, personId, text, header, createdAt } });
}

async function deletePerson(db, body) {
  const personId = str(body?.personId, 100);
  if (!personId) return json({ error: 'Missing personId' }, 400);

  await db.batch([
    db.prepare('DELETE FROM availability_overrides WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM comments WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM rsvps WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM body_marks WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM workouts WHERE person_id = ?').bind(personId),
    db.prepare('UPDATE posts SET person_id = NULL WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM people WHERE id = ?').bind(personId),
  ]);

  return json({ ok: true });
}

async function deletePost(db, body) {
  const postId = str(body?.postId, 100);
  if (!postId) return json({ error: 'Missing postId' }, 400);

  await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
  return json({ ok: true });
}

async function updateEvent(db, body) {
  const eventId = str(body?.eventId, 100);
  const title = str(body?.title, 200);
  const time = str(body?.time, 40);
  const endTime = str(body?.endTime, 40);
  const desc = str(body?.desc, 2000);
  const location = str(body?.location, 200);
  const type = VALID_EVENT_TYPES.includes(body?.type) ? body.type : 'practice';
  const kind = normalizeKind(type, body?.kind);
  if (!eventId || !title) return json({ error: 'Missing eventId or title' }, 400);

  // location_id, checklist, and results are merge-style, not full-replace:
  // most callers (the admin edit form, MCP update_event) don't send them,
  // and a blind full-replace would silently wipe them on every unrelated edit.
  const needsCurrent = body?.locationId === undefined || body?.checklist === undefined || body?.results === undefined;
  const current = needsCurrent
    ? await db.prepare('SELECT location_id, checklist, results FROM events WHERE id = ?').bind(eventId).first()
    : null;

  const locationId = body?.locationId !== undefined ? (str(body.locationId, 100) || null) : (current ? current.location_id : null);
  const checklist = body?.checklist !== undefined ? str(body.checklist, 1000) : (current ? current.checklist : '');
  const results = body?.results !== undefined ? str(body.results, 2000) : (current ? current.results : '');

  await db.prepare(
    'UPDATE events SET title = ?, time = ?, end_time = ?, description = ?, type = ?, kind = ?, location = ?, location_id = ?, checklist = ?, results = ? WHERE id = ?'
  ).bind(title, time, endTime, desc, type, kind, location, locationId, checklist, results, eventId).run();

  return json({ ok: true });
}

async function deleteEvent(db, body) {
  const eventId = str(body?.eventId, 100);
  if (!eventId) return json({ error: 'Missing eventId' }, 400);

  await db.batch([
    db.prepare('DELETE FROM rsvps WHERE event_id = ?').bind(eventId),
    db.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
  ]);

  return json({ ok: true });
}

async function saveRsvp(db, body) {
  const eventId = str(body?.eventId, 100);
  const personId = str(body?.personId, 100);
  const status = str(body?.status, 20) || 'unknown';
  if (!eventId || !personId) return json({ error: 'Missing eventId or personId' }, 400);

  if (status === 'unknown') {
    await db.prepare('DELETE FROM rsvps WHERE event_id = ? AND person_id = ?').bind(eventId, personId).run();
  } else {
    await db.prepare(
      `INSERT INTO rsvps (event_id, person_id, status) VALUES (?, ?, ?)
       ON CONFLICT(event_id, person_id) DO UPDATE SET status=excluded.status`
    ).bind(eventId, personId, status).run();
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Traditional week formatter
//
// The team's default rhythm: easy Monday, workout Tuesday, easy Wednesday,
// workout Thursday, easy Friday. The admin panel ticks a week into this shape
// and un-ticks it back out. Generated rows carry auto = 1 so un-ticking only
// ever removes what the formatter itself created.
// ---------------------------------------------------------------------------

const WEEK_TEMPLATE = [
  { offset: 0, kind: 'easy',    title: 'Easy Run' },
  { offset: 1, kind: 'workout', title: 'Workout' },
  { offset: 2, kind: 'easy',    title: 'Easy Run' },
  { offset: 3, kind: 'workout', title: 'Workout' },
  { offset: 4, kind: 'easy',    title: 'Easy Run' },
];

const DEFAULT_PRACTICE_TIME = '4:00 PM';

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Returns the Monday key, or null if the input isn't a valid Monday.
function parseWeekStart(raw) {
  const weekStart = str(raw, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const d = new Date(weekStart + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 1) return null;
  return weekStart;
}

async function applyWeekTemplate(db, body) {
  const weekStart = parseWeekStart(body?.weekStart);
  if (!weekStart) return json({ error: 'weekStart must be a Monday in YYYY-MM-DD form' }, 400);
  const time = str(body?.time, 40) || DEFAULT_PRACTICE_TIME;

  const dates = WEEK_TEMPLATE.map(t => addDays(weekStart, t.offset));
  const existing = await db.prepare(
    'SELECT date, type, auto FROM events WHERE date >= ? AND date <= ?'
  ).bind(dates[0], dates[dates.length - 1]).all();


  // The rhythm goes onto all five weekdays, always. A day can hold more than
  // one event, so anything already scheduled stays exactly where it is and the
  // generated practice sits alongside it. The only thing that blocks a day is
  // a practice this tool already generated there, so re-applying a week is a
  // no-op rather than a source of duplicates.
  const alreadyGenerated = new Set();
  for (const row of existing.results) {
    if (row.auto) alreadyGenerated.add(row.date);
  }

  const created = [];
  const stmts = [];
  WEEK_TEMPLATE.forEach((t, i) => {
    const date = dates[i];
    if (alreadyGenerated.has(date)) return;
    const id = 'e_' + crypto.randomUUID();
    created.push({ id, date, title: t.title, time, desc: '', type: 'practice', kind: t.kind, auto: true });
    stmts.push(db.prepare(
      "INSERT INTO events (id, date, title, time, description, type, kind, auto) VALUES (?, ?, ?, ?, '', 'practice', ?, 1)"
    ).bind(id, date, t.title, time, t.kind));
  });

  if (stmts.length) await db.batch(stmts);
  return json({ created });
}

async function clearWeekTemplate(db, body) {
  const weekStart = parseWeekStart(body?.weekStart);
  if (!weekStart) return json({ error: 'weekStart must be a Monday in YYYY-MM-DD form' }, 400);

  const rows = await db.prepare(
    'SELECT id FROM events WHERE auto = 1 AND date >= ? AND date <= ?'
  ).bind(weekStart, addDays(weekStart, 4)).all();

  const ids = rows.results.map(r => r.id);
  if (ids.length) {
    const holes = ids.map(() => '?').join(',');
    await db.batch([
      db.prepare(`DELETE FROM rsvps WHERE event_id IN (${holes})`).bind(...ids),
      db.prepare(`DELETE FROM events WHERE id IN (${holes})`).bind(...ids),
    ]);
  }
  return json({ removed: ids });
}

// ---------------------------------------------------------------------------
// MCP server — lets Claude (Chat, Cowork, Code) read and write the same D1
// data the web app uses, over the stateless Streamable HTTP transport
// (single POST endpoint, JSON responses, no SSE/session state needed for a
// tool set this small).
// ---------------------------------------------------------------------------

const MCP_TOOLS_BASE = [
  {
    name: 'get_roster',
    description: "List everyone on the Hawks roster with their contact info, school info, home address, and out-periods.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_events',
    description: 'List calendar events (practices, meets, other), optionally filtered to a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD. Omit for no lower bound.' },
        to: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Omit for no upper bound.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event (practice, meet, or other).',
    inputSchema: {
      type: 'object',
      required: ['date', 'title'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        title: { type: 'string' },
        time: { type: 'string', description: 'e.g. "4:00 PM"' },
        endTime: { type: 'string', description: 'e.g. "5:30 PM", optional' },
        desc: { type: 'string', description: 'optional details' },
        location: { type: 'string', description: 'e.g. "Van Cortlandt Park" or a full address, optional' },
        locationId: { type: 'string', description: "A known venue's id (from get_state's locations list), optional. Links the event to that venue so the Meets tab can show travel time and distance." },
        type: { type: 'string', enum: ['practice', 'meet', 'other'], description: 'defaults to practice' },
        kind: { type: 'string', enum: ['easy', 'workout', 'long_run'], description: 'only used when type is practice' },
        checklist: { type: 'string', description: 'optional "what to bring" note shown on the Meets tab, e.g. "Spikes + singlet"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_person',
    description: "Add a new person to the roster. Returns the new person's id — pass that to update_person afterward to fill in school/personal info, since this only sets the basics.",
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Full display name, e.g. "Chengyuan Cai"' },
        phone: { type: 'string' },
        email: { type: 'string' },
        color: { type: 'string', description: 'Optional hex color for their calendar chip, e.g. "#7a4fae"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_person',
    description: "Update one person's contact, school, or personal info. Only the fields you pass are changed — everything else keeps its current value.",
    inputSchema: {
      type: 'object',
      required: ['personId'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        phone: { type: 'string' },
        email: { type: 'string' },
        firstName: { type: 'string' },
        classYear: { type: 'string', enum: ['Freshman', 'Sophomore', 'Junior', 'Senior'] },
        trackId: { type: 'string' },
        dateEntered: { type: 'string', description: 'YYYY-MM-DD' },
        borough: { type: 'string' },
        homeAddress: { type: 'string' },
        outMon: { type: 'integer', description: 'School period (1-12) they leave early on Monday' },
        outTue: { type: 'integer' },
        outWed: { type: 'integer' },
        outThu: { type: 'integer' },
        outFri: { type: 'integer' },
        personalNotes: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_event',
    description: 'Edit an existing calendar event. All fields except eventId are replaced wholesale, so pass the values that should stay the same too (get them from list_events first).',
    inputSchema: {
      type: 'object',
      required: ['eventId', 'title'],
      properties: {
        eventId: { type: 'string', description: 'Event id, from list_events' },
        title: { type: 'string' },
        time: { type: 'string', description: 'e.g. "4:00 PM"' },
        endTime: { type: 'string', description: 'e.g. "5:30 PM", optional' },
        desc: { type: 'string', description: 'optional details' },
        location: { type: 'string', description: 'e.g. "Van Cortlandt Park" or a full address, optional' },
        locationId: { type: 'string', description: "A known venue's id (from get_state's locations list), optional. Omit to leave the current link (if any) unchanged." },
        type: { type: 'string', enum: ['practice', 'meet', 'other'], description: 'defaults to practice' },
        kind: { type: 'string', enum: ['easy', 'workout', 'long_run'], description: 'only used when type is practice' },
        checklist: { type: 'string', description: 'Optional "what to bring" note shown on the Meets tab. Omit to leave unchanged.' },
        results: { type: 'string', description: 'Optional results/placements to log after the meet happens, shown on the Meets tab. Omit to leave unchanged.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_event',
    description: "Permanently delete a calendar event and everyone's RSVPs to it. To move an event to a different date, delete it and create_event a replacement — there is no in-place date change.",
    inputSchema: {
      type: 'object',
      required: ['eventId'],
      properties: {
        eventId: { type: 'string', description: 'Event id, from list_events' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_post',
    description: 'Post a team announcement, visible on the Calendar tab.',
    inputSchema: {
      type: 'object',
      required: ['personId', 'text'],
      properties: {
        personId: { type: 'string', description: 'Who the post is from' },
        text: { type: 'string' },
        header: { type: 'string', description: 'optional short title' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_post',
    description: 'Permanently delete a team announcement.',
    inputSchema: {
      type: 'object',
      required: ['postId'],
      properties: {
        postId: { type: 'string', description: "Post id, from get_state's posts list" },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_person',
    description: "Permanently remove someone from the roster, along with their RSVPs, availability overrides, comments, and body marks. Their past posts are kept but unattributed. This cannot be undone — confirm the name and personId with the user before calling.",
    inputSchema: {
      type: 'object',
      required: ['personId'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_plans',
    description: "Everyone's hidden training-plan ranking: the explicit rank (null = none set), the rank they actually get (explicit, else the class-year default), where it came from, weekly miles, and whether they have a custom-shoe variant. Also lists the six plans (1=30, 2=35, 3=40, 4=45, 5=50, 6=60 miles/week).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_rank',
    description: "Set one person's hidden training-plan ranking (1-6 by weekly mileage: 1=30, 2=35, 3=40, 4=45, 5=50, 6=60 miles; class-year defaults: Freshman=2, Sophomore=3, Junior=5, Senior=6). Takes effect the next time their Training tab loads. Pass null to go back to the class-year plan. Never shown to anyone in the app.",
    inputSchema: {
      type: 'object',
      required: ['person', 'rank'],
      properties: {
        person: { type: 'string', description: 'Name (first or full, or a unique part of it) or id' },
        rank: { type: ['integer', 'null'], minimum: 1, maximum: 6 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_ranks',
    description: 'Set several people\'s hidden training-plan rankings at once, e.g. after a meet when a few people move up. All names are resolved first, so a typo changes nothing. Each rank is 1-6, or null for the class-year default.',
    inputSchema: {
      type: 'object',
      required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['person', 'rank'],
            properties: {
              person: { type: 'string', description: 'Name (first or full, or a unique part of it) or id' },
              rank: { type: ['integer', 'null'], minimum: 1, maximum: 6 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_default_status',
    description: "Set a person's default availability (used on any day without a specific override).",
    inputSchema: {
      type: 'object',
      required: ['personId', 'status'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        status: { type: 'string', enum: ['available', 'unavailable'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_health_status',
    description: "Set a person's health status.",
    inputSchema: {
      type: 'object',
      required: ['personId', 'status'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        status: { type: 'string', enum: ['healthy', 'injured', 'sick'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_training_status',
    description: "Set a person's current training status.",
    inputSchema: {
      type: 'object',
      required: ['personId', 'status'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        status: { type: 'string', enum: ['resting', 'running', 'crosstraining'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_availability',
    description: "Set whether a person is available on one specific date, overriding their default status for that day only. Pass status 'default' to clear the override and fall back to their usual default.",
    inputSchema: {
      type: 'object',
      required: ['personId', 'date', 'status'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string', enum: ['available', 'unavailable', 'default'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_body_mark',
    description: "Set the injury/soreness mark for one body part on a person. 'none' clears it.",
    inputSchema: {
      type: 'object',
      required: ['personId', 'part', 'status'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        part: { type: 'string', description: 'Body part key, e.g. "left_knee", "right_hamstring"' },
        status: { type: 'string', enum: ['none', 'sore', 'pain'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'save_comment',
    description: "Set (or clear, with empty text) the coach's comment on a person for a specific date.",
    inputSchema: {
      type: 'object',
      required: ['date', 'personId', 'text'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        personId: { type: 'string', description: "The person's id, from get_roster" },
        text: { type: 'string', description: 'Empty string clears the comment' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'save_rsvp',
    description: "Set a person's RSVP status for an event. Status 'unknown' clears the RSVP.",
    inputSchema: {
      type: 'object',
      required: ['eventId', 'personId', 'status'],
      properties: {
        eventId: { type: 'string', description: 'Event id, from list_events' },
        personId: { type: 'string', description: "The person's id, from get_roster" },
        status: { type: 'string', enum: ['available', 'unavailable', 'unknown'], description: '"available" means coming, "unavailable" means not coming' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_travel_estimate',
    description: "Set someone's estimated one-way travel time to a location, for either weekday practices or weekend meets. Location ids come from get_state's locations list.",
    inputSchema: {
      type: 'object',
      required: ['personId', 'locationId', 'daypart', 'minutes'],
      properties: {
        personId: { type: 'string', description: "The person's id, from get_roster" },
        locationId: { type: 'string', description: "Location id, from get_state's locations list" },
        daypart: { type: 'string', enum: ['weekday_practice', 'weekend_meet'] },
        minutes: { type: 'integer', description: 'One-way travel time in minutes' },
        note: { type: 'string', description: 'optional, e.g. "by subway"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'apply_week_template',
    description: "Fill in the team's standard weekday rhythm (easy/workout/easy/workout/easy, Mon-Fri) for one week, skipping any weekday that already has an auto-generated practice. Existing manually-created events are left alone and the rhythm is added alongside them.",
    inputSchema: {
      type: 'object',
      required: ['weekStart'],
      properties: {
        weekStart: { type: 'string', description: 'The Monday that starts the week, YYYY-MM-DD' },
        time: { type: 'string', description: 'Practice time for all five days, defaults to "4:00 PM"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'clear_week_template',
    description: 'Remove the auto-generated weekday practices (from apply_week_template) for one week. Manually-created events are never touched by this.',
    inputSchema: {
      type: 'object',
      required: ['weekStart'],
      properties: {
        weekStart: { type: 'string', description: 'The Monday that starts the week, YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_hawky_changes',
    description: "Everything Hawky changed for the team in the last N days (default 30): plan level moves (with the weekly miles before and after, and why) and single-day plan changes (what the plan said, what Hawky set, why). Use it to review or undo Hawky's decisions; set_ranks overrides any level.",
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 120 } }, additionalProperties: false },
  },
  {
    name: 'get_team_training',
    description: "Training for the whole team: for each person, whether they've connected Hawky in Claude, this week's miles vs plan, load, average plan score (0-100), days run, and their scored runs over the last N days (default 7). Use it to see who's putting in the work.",
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 60 } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_state',
    description: 'Full snapshot of everything the app tracks: roster, availability overrides, daily comments, events, RSVPs, body marks, announcements, locations, and travel estimates. Use this when you need more than get_roster/list_events give you — e.g. RSVPs, comments, body marks, posts, or location ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const MCP_TOOLS = [...MCP_TOOLS_BASE, ...logTools(true)];

class McpToolError extends Error {}

async function mcpGetRoster(db) {
  const rows = await db.prepare(
    `SELECT id, name, phone, email, first_name, class_year, track_id, date_entered, borough,
            home_address, out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes,
            default_status, health_status, training_status, plan_rank
     FROM people ORDER BY name`
  ).all();
  return rows.results;
}

async function mcpAddPerson(db, args) {
  const name = str(args?.name, 100);
  if (!name) throw new McpToolError('Missing name');
  const id = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const res = await upsertPerson(db, { id, name, color: args?.color, phone: args?.phone, email: args?.email });
  const data = await res.json();
  if (!res.ok) throw new McpToolError(data.error || 'add_person failed');
  return { id, name };
}

async function mcpListEvents(db, args) {
  const from = str(args?.from, 20);
  const to = str(args?.to, 20);
  const conds = [];
  const binds = [];
  if (from) { conds.push('date >= ?'); binds.push(from); }
  if (to) { conds.push('date <= ?'); binds.push(to); }
  let query = 'SELECT id, date, title, time, end_time, description, type, kind, location, location_id, checklist, results FROM events';
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY date, time';
  const rows = await db.prepare(query).bind(...binds).all();
  return rows.results.map(r => ({
    id: r.id, date: r.date, title: r.title, time: r.time, endTime: r.end_time,
    desc: r.description, type: r.type, kind: r.kind, location: r.location, locationId: r.location_id || '',
    checklist: r.checklist || '', results: r.results || '',
  }));
}

async function mcpUpdatePerson(db, args, env, ctx) {
  const personId = str(args?.personId, 100);
  if (!personId) throw new McpToolError('Missing personId');

  const current = await db.prepare(
    `SELECT phone, email, first_name, class_year, track_id, date_entered, borough,
            home_address, out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes
     FROM people WHERE id = ?`
  ).bind(personId).first();
  if (!current) throw new McpToolError('Unknown personId');

  const phone = args.phone !== undefined ? str(args.phone, 40) : current.phone;
  const email = args.email !== undefined ? str(args.email, 200) : current.email;
  const firstName = args.firstName !== undefined ? str(args.firstName, 100) : current.first_name;
  const classYear = args.classYear !== undefined
    ? (VALID_CLASS_YEARS.includes(args.classYear) ? args.classYear : '')
    : current.class_year;
  const trackId = args.trackId !== undefined ? str(args.trackId, 40) : current.track_id;
  const dateEntered = args.dateEntered !== undefined ? str(args.dateEntered, 20) : current.date_entered;
  const borough = args.borough !== undefined ? str(args.borough, 60) : current.borough;
  const homeAddress = args.homeAddress !== undefined ? str(args.homeAddress, 300) : current.home_address;
  const outMon = args.outMon !== undefined ? outPeriod(args.outMon) : current.out_mon;
  const outTue = args.outTue !== undefined ? outPeriod(args.outTue) : current.out_tue;
  const outWed = args.outWed !== undefined ? outPeriod(args.outWed) : current.out_wed;
  const outThu = args.outThu !== undefined ? outPeriod(args.outThu) : current.out_thu;
  const outFri = args.outFri !== undefined ? outPeriod(args.outFri) : current.out_fri;
  const personalNotes = args.personalNotes !== undefined ? str(args.personalNotes, 2000) : current.personal_notes;

  await db.prepare(
    `UPDATE people SET phone=?, email=?, first_name=?, class_year=?, track_id=?, date_entered=?, borough=?,
       home_address=?, out_mon=?, out_tue=?, out_wed=?, out_thu=?, out_fri=?, personal_notes=?
     WHERE id=?`
  ).bind(phone, email, firstName, classYear, trackId, dateEntered, borough, homeAddress,
         outMon, outTue, outWed, outThu, outFri, personalNotes, personId).run();

  if (ctx) ctx.waitUntil(syncPersonToSheet(db, personId, env).catch(err => console.error('sheet sync failed', err)));
  return { ok: true };
}

const VALID_BODY_MARK_STATUS = ['none', 'sore', 'pain'];

// Deterministic counterpart to the admin UI's toggleBodyMark cycle: sets the
// mark to exactly the status passed, rather than advancing none->sore->pain.
async function mcpSetBodyMark(db, args) {
  const personId = str(args?.personId, 100);
  const part = str(args?.part, 40);
  const status = str(args?.status, 20);
  if (!personId || !part) throw new McpToolError('Missing personId or part');
  if (!VALID_BODY_MARK_STATUS.includes(status)) throw new McpToolError('Invalid status');

  if (status === 'none') {
    await db.prepare('DELETE FROM body_marks WHERE person_id = ? AND part = ?').bind(personId, part).run();
  } else {
    await db.prepare(
      `INSERT INTO body_marks (person_id, part, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, part) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`
    ).bind(personId, part, status, Date.now()).run();
  }
  return { status };
}

// Deterministic counterpart to the admin UI's toggleAvailability: sets the
// override to exactly the status passed (or clears it for 'default'), rather
// than flipping whatever is currently there.
async function mcpSetAvailability(db, args) {
  const personId = str(args?.personId, 100);
  const date = str(args?.date, 20);
  const status = str(args?.status, 20);
  if (!personId || !date) throw new McpToolError('Missing personId or date');
  if (!['available', 'unavailable', 'default'].includes(status)) throw new McpToolError('Invalid status');

  const person = await db.prepare('SELECT default_status FROM people WHERE id = ?').bind(personId).first();
  if (!person) throw new McpToolError('Unknown personId');

  const effective = status === 'default' ? person.default_status : status;
  if (effective === person.default_status) {
    await db.prepare('DELETE FROM availability_overrides WHERE person_id = ? AND date = ?').bind(personId, date).run();
  } else {
    await db.prepare(
      `INSERT INTO availability_overrides (person_id, date, status) VALUES (?, ?, ?)
       ON CONFLICT(person_id, date) DO UPDATE SET status=excluded.status`
    ).bind(personId, date, effective).run();
  }
  return { status: effective };
}

async function unwrapJson(res, fallbackError) {
  const data = await res.json();
  if (!res.ok) throw new McpToolError(data.error || fallbackError);
  return data;
}

async function callMcpTool(name, args, env, ctx) {
  const db = env.DB;
  const a = args || {};
  switch (name) {
    case 'get_roster':
      return await mcpGetRoster(db);
    case 'list_events':
      return await mcpListEvents(db, a);
    case 'get_state':
      return await getState(db);
    case 'create_event':
      return await unwrapJson(await createEvent(db, a), 'create_event failed');
    case 'update_event':
      return await unwrapJson(await updateEvent(db, a), 'update_event failed');
    case 'add_person':
      return await mcpAddPerson(db, a);
    case 'delete_event':
      return await unwrapJson(await deleteEvent(db, a), 'delete_event failed');
    case 'update_person':
      return await mcpUpdatePerson(db, a, env, ctx);
    case 'delete_person':
      return await unwrapJson(await deletePerson(db, a), 'delete_person failed');
    case 'get_plans':
      return await mcpGetPlans(db);
    case 'get_hawky_changes': {
      const since = Date.now() - (Number.isInteger(a.days) ? a.days : 30) * 86400000;
      const [levels, days] = await Promise.all([
        db.prepare('SELECT p.name, l.from_rank, l.to_rank, l.reason, l.source, l.created_at FROM level_changes l JOIN people p ON p.id = l.person_id WHERE l.created_at >= ? ORDER BY l.created_at DESC').bind(since).all(),
        db.prepare("SELECT p.name, c.date, c.type, c.miles, c.detail, c.reason, c.source, c.cleared FROM plan_changes c JOIN people p ON p.id = c.person_id WHERE c.created_at >= ? AND c.source != 'athlete' ORDER BY c.date DESC").bind(since).all(),
      ]);
      return {
        level_changes: levels.results.map((l) => ({ ...l, from_miles: PLANS[l.from_rank]?.weeks[0].miles, to_miles: PLANS[l.to_rank]?.weeks[0].miles, when: new Date(l.created_at).toISOString().slice(0, 10) })),
        day_changes: days.results.map((d) => ({ ...d, undone: !!d.cleared })),
      };
    }
    case 'get_team_training':
      return await teamTraining(db, a.days);
    case 'set_rank':
      return (await mcpSetRanks(db, [{ person: a.person ?? a.personId, rank: a.rank }]))[0];
    case 'set_ranks':
      return await mcpSetRanks(db, a.changes);
    case 'set_default_status':
      return await unwrapJson(await setDefaultStatus(db, a), 'set_default_status failed');
    case 'set_health_status':
      return await unwrapJson(await setHealthStatus(db, a), 'set_health_status failed');
    case 'set_training_status':
      return await unwrapJson(await setTrainingStatus(db, a), 'set_training_status failed');
    case 'set_availability':
      return await mcpSetAvailability(db, a);
    case 'set_body_mark':
      return await mcpSetBodyMark(db, a);
    case 'save_comment':
      return await unwrapJson(await saveComment(db, a), 'save_comment failed');
    case 'save_rsvp':
      return await unwrapJson(await saveRsvp(db, a), 'save_rsvp failed');
    case 'create_post':
      return await unwrapJson(await createPost(db, a), 'create_post failed');
    case 'delete_post':
      return await unwrapJson(await deletePost(db, a), 'delete_post failed');
    case 'upsert_travel_estimate':
      return await unwrapJson(await upsertTravelEstimate(db, a), 'upsert_travel_estimate failed');
    case 'apply_week_template':
      return await unwrapJson(await applyWeekTemplate(db, a), 'apply_week_template failed');
    case 'clear_week_template':
      return await unwrapJson(await clearWeekTemplate(db, a), 'clear_week_template failed');
    default: {
      if (logTools(true).some((t) => t.name === name)) {
        const personId = name === 'find_workouts' ? null : (await resolvePerson(db, a.person)).id;
        try {
          return await callLogTool(db, personId, name, a, todayInTz());
        } catch (err) {
          throw err instanceof LogError ? new McpToolError(err.message) : err;
        }
      }
      throw new McpToolError(`Unknown tool: ${name}`);
    }
  }
}

async function handleMcp(request, env, ctx) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.MCP_AUTH_TOKEN || token !== env.MCP_AUTH_TOKEN) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401);
  }
  return await serveMcp(request, 'hawks-calendar', MCP_TOOLS, (name, args) => callMcpTool(name, args, env, ctx));
}

// Hawky in Claude: one runner's own Claude, scoped to just their workouts. The
// token is in the path because claude.ai custom connectors can't send headers.
async function handleCoachMcp(request, env, token) {
  const person = await personForToken(env.DB, token);
  if (!person) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unknown Hawky link. Get a new one from Hawks > You > Settings.' } }, 401);
  return await serveMcp(request, 'hawky', [...WATCH_TOOLS, ...COACH_TOOLS], (name, args) =>
    (WATCH_TOOLS.some((t) => t.name === name) ? callWatchTool(env, person, name, args || {}) : callCoachTool(env.DB, person, name, args)));
}

// Watch setup through Hawky, so the runner's own Claude can do the Hawks side
// of the setup: connect intervals.icu with the id and key the runner pastes,
// pull their history, and show their Fitness States. Making the intervals.icu
// account and linking Garmin there still needs the runner's own logins.
const WATCH_TOOLS = [
  {
    name: 'watch_status',
    description: "Whether this runner's watch (Garmin/COROS via intervals.icu) is connected to Hawks, when it last synced, and whether their full history has been imported. Call it at the start of setup.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'connect_watch',
    description: "Connect the runner's intervals.icu account to Hawks with the athlete id (looks like i12345) and API key they paste from intervals.icu Settings > Developer Settings. Hawks checks them, stores the key encrypted, and syncs the last 4 weeks. After this, call sync_watch with full_history until done.",
    inputSchema: { type: 'object', required: ['athlete_id', 'api_key'], properties: { athlete_id: { type: 'string' }, api_key: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'sync_watch',
    description: 'Pull new runs from the watch now. With full_history: true it imports about 3 months of older history per call, newest first; keep calling until done is true (usually 3-8 calls). Then call get_fitness.',
    inputSchema: { type: 'object', properties: { full_history: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'get_plan_status',
    description: "Today's and tomorrow's session as the runner should run them (the coach's plan, or a change Hawky made, or Hawky's readiness adjustment), this week day by day, readiness and health (resting HR, HRV, sleep, feel, body map, load), and the runner's plan level with whether they're ready to move up.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'change_plan_day',
    description: "Change one day of the runner's plan (today to 13 days out) when they can't do it as planned or it should change. Hawks enforces the limits (no big mileage jumps, no back-to-back hard days, week within 10% of plan) and says why if it refuses. reset: true puts the day back to the coach's plan.",
    inputSchema: {
      type: 'object', required: ['date'],
      properties: {
        date: { type: 'string' }, type: { type: 'string', enum: ['Easy', 'Recovery', 'Workout', 'Long run', 'Race', 'Shakeout', 'Cross-train', 'Off'] },
        miles: { type: 'number' }, detail: { type: 'string' }, reason: { type: 'string' }, reset: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'change_level',
    description: 'Move the runner up a plan level (only when get_plan_status says ready) or down one (injury, illness, exhaustion). Explain it in weekly miles.',
    inputSchema: { type: 'object', required: ['direction', 'reason'], properties: { direction: { type: 'string', enum: ['up', 'down'] }, reason: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'get_fitness',
    description: "The runner's Fitness States: current race estimates from 400 m to half marathon, VO2max estimate, weekly mileage, pace zones and what they're based on. Recalculated fresh.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function callWatchTool(env, person, name, args) {
  try {
    if (name === 'watch_status') return await icuStatus(env.DB, person.id);
    if (name === 'connect_watch') {
      const res = await icuConnect(env, person.id, args.athlete_id, args.api_key);
      const sync = await syncPerson(env, person.id);
      return { ...res, synced: sync, next: 'Call sync_watch with full_history: true until done.' };
    }
    if (name === 'sync_watch') {
      if (args.full_history) return await importHistory(env, person.id);
      return await syncPerson(env, person.id);
    }
    if (name === 'get_fitness') return compactFitness(await recomputeFitness(env.DB, person.id, todayInTz()));
    if (name === 'get_plan_status') return await hawkyState(env.DB, person.id);
    if (name === 'change_plan_day' || name === 'change_level') {
      const full = await env.DB.prepare('SELECT id, name, first_name, class_year, plan_rank, coach_rank, health_status, health_updated_at, training_status FROM people WHERE id = ?').bind(person.id).first();
      if (name === 'change_level') return await changeLevel(env.DB, full, args.direction, args.reason, todayInTz(), await healthSummary(env.DB, full, todayInTz()));
      if (args.reset) { await resetPlanDay(env.DB, person.id, args.date, false); return { reset: args.date }; }
      return await applyPlanChange(env.DB, full, args, 'hawky');
    }
  } catch (err) {
    if (err instanceof IntervalsError || err instanceof PlanError) throw new McpToolError(err.message);
    throw err;
  }
  throw new McpToolError(`Unknown tool: ${name}`);
}

async function serveMcp(request, serverName, tools, call) {
  let rpc;
  try {
    rpc = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const { id, method, params } = rpc || {};
  const isNotification = id === undefined;
  const respond = (result) => isNotification ? new Response(null, { status: 202 }) : json({ jsonrpc: '2.0', id, result });
  const respondErr = (code, message) => isNotification ? new Response(null, { status: 202 }) : json({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    if (method === 'initialize') {
      return respond({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: '1.0.0' },
      });
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'ping') return respond({});
    if (method === 'tools/list') return respond({ tools });
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      try {
        const data = await call(name, toolArgs);
        return respond({ content: [{ type: 'text', text: JSON.stringify(data) }] });
      } catch (err) {
        return respond({ content: [{ type: 'text', text: err.message || 'Tool failed' }], isError: true });
      }
    }
    return respondErr(-32601, `Method not found: ${method}`);
  } catch (err) {
    console.error(err);
    return respondErr(-32603, 'Internal error');
  }
}

// ---------------------------------------------------------------------------
// Per-person .ics calendar feed — subscribe once in Google Calendar (Settings
// > Add calendar > From URL) and it stays live from then on. No Google OAuth
// needed since this is a read-only published feed, same no-auth model as the
// rest of the app.
// ---------------------------------------------------------------------------

function parseTimeToHM(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function icsDateStamp(ymd, hm) {
  const bare = ymd.replace(/-/g, '');
  if (!hm) return { value: bare, allDay: true };
  const hh = String(hm.h).padStart(2, '0');
  const mm = String(hm.min).padStart(2, '0');
  return { value: `${bare}T${hh}${mm}00`, allDay: false };
}

async function buildIcsFeed(db, personId) {
  const person = await db.prepare('SELECT id, name FROM people WHERE id = ?').bind(personId).first();
  if (!person) return null;

  const [eventsRes, rsvpsRes, locsRes, travelRes] = await Promise.all([
    db.prepare("SELECT id, date, title, time, end_time, description, type, kind, location FROM events WHERE type = 'meet' ORDER BY date, time").all(),
    db.prepare('SELECT event_id, status FROM rsvps WHERE person_id = ?').bind(personId).all(),
    db.prepare('SELECT id, name, kind FROM locations').all(),
    db.prepare('SELECT location_id, daypart, minutes FROM travel_estimates WHERE person_id = ?').bind(personId).all(),
  ]);

  const rsvpByEvent = {};
  for (const r of rsvpsRes.results) rsvpByEvent[r.event_id] = r.status;
  const locByName = {};
  for (const l of locsRes.results) locByName[l.name.toLowerCase()] = l;
  const travelByLocDaypart = {};
  for (const t of travelRes.results) travelByLocDaypart[`${t.location_id}:${t.daypart}`] = t.minutes;

  const typeLabel = { practice: 'Practice', meet: 'Meet', other: 'Event' };
  const rsvpLabel = { available: 'Coming', unavailable: 'Not coming' };

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Hawks Calendar//EN',
    `X-WR-CALNAME:${icsEscape(person.name)} — Hawks XC/Track`,
    'X-WR-TIMEZONE:America/New_York',
  ];

  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  for (const ev of eventsRes.results) {
    const start = parseTimeToHM(ev.time);
    const end = parseTimeToHM(ev.end_time);
    const dtStart = icsDateStamp(ev.date, start);

    const descParts = [];
    if (ev.description) descParts.push(ev.description);
    const status = rsvpByEvent[ev.id];
    descParts.push(`RSVP: ${status ? rsvpLabel[status] || status : 'No response yet'}`);
    const loc = ev.location ? locByName[ev.location.toLowerCase()] : null;
    if (loc) {
      const daypart = loc.kind === 'meet' ? 'weekend_meet' : 'weekday_practice';
      const minutes = travelByLocDaypart[`${loc.id}:${daypart}`];
      if (minutes) descParts.push(`~${minutes} min from home (approximate, transit)`);
    }

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@hawks-calendar`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (dtStart.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dtStart.value}`);
    } else {
      lines.push(`DTSTART;TZID=America/New_York:${dtStart.value}`);
      const dtEnd = end ? icsDateStamp(ev.date, end) : null;
      if (dtEnd && !dtEnd.allDay) {
        lines.push(`DTEND;TZID=America/New_York:${dtEnd.value}`);
      } else {
        const hh = String((start.h + 1) % 24).padStart(2, '0');
        lines.push(`DTEND;TZID=America/New_York:${ev.date.replace(/-/g, '')}T${hh}${String(start.min).padStart(2, '0')}00`);
      }
    }
    lines.push(icsFold(`SUMMARY:${icsEscape(`${typeLabel[ev.type] || 'Event'}: ${ev.title}`)}`));
    if (ev.location) lines.push(icsFold(`LOCATION:${icsEscape(ev.location)}`));
    lines.push(icsFold(`DESCRIPTION:${descParts.map(icsEscape).join('\\n')}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Meet-day reminder email, sent to everyone RSVP'd "available" for a meet
// happening today, with their own time-to-arrive if it's on file.
//
// SHIPPED DISABLED ON PURPOSE. This can email every RSVP'd student
// unattended, so it must not be able to fire without the coach's explicit
// go-ahead on recipients, timing, and channel:
//   1. `scheduled` only runs this for MEET_REMINDER_CRON, and that schedule
//      is NOT registered in wrangler.jsonc (the only registered cron is the
//      intervals.icu sync). Cloudflare never fires it until a human adds it.
//   2. Even if it were somehow invoked, it no-ops without RESEND_API_KEY,
//      which is not set.
// Both guards must be deliberately removed/added by a human before this can
// send anything.
const MEET_REMINDER_CRON = '0 11 * * *';

async function sendMeetDayReminders(env) {
  if (!env.RESEND_API_KEY) return { sent: 0, reason: 'not_configured' };

  const todayNY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const db = env.DB;
  const meets = await db.prepare(
    "SELECT id, title, time, location, location_id FROM events WHERE type = 'meet' AND date = ?"
  ).bind(todayNY).all();
  if (!meets.results.length) return { sent: 0, reason: 'no_meets_today' };

  let sent = 0;
  for (const meet of meets.results) {
    const attendees = await db.prepare(
      `SELECT p.name, p.email, p.id FROM rsvps r JOIN people p ON p.id = r.person_id
       WHERE r.event_id = ? AND r.status = 'available' AND p.email != ''`
    ).bind(meet.id).all();

    for (const person of attendees.results) {
      let etaLine = '';
      if (meet.location_id) {
        const est = await db.prepare(
          "SELECT minutes FROM travel_estimates WHERE person_id = ? AND location_id = ? AND daypart = 'weekend_meet'"
        ).bind(person.id, meet.location_id).first();
        if (est) etaLine = `\n\nYour estimated travel time: ~${est.minutes} min.`;
      }
      const body = `Reminder: ${meet.title} today${meet.time ? ' at ' + meet.time : ''}.${meet.location ? '\n' + meet.location : ''}${etaLine}`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM || 'Hawks Calendar <onboarding@resend.dev>',
          to: person.email,
          subject: `Today: ${meet.title}`,
          text: body,
        }),
      });
      if (res.ok) sent++;
    }
  }
  return { sent };
}

// Splits belong to the session: they're the work laps of its main activity.
async function saveSessionSplits(db, body) {
  const personId = str(body?.personId, 100);
  const id = str(body?.strava_id, 60);
  const reps = (Array.isArray(body?.reps) ? body.reps : []).slice(0, 40)
    .map((r) => ({ m: Math.round(Number(r?.m)), s: Math.round(Number(r?.s) * 10) / 10, hr: r?.hr ? Math.round(Number(r.hr)) : null, rest: str(r?.rest, 12) }))
    .filter((r) => r.m >= 50 && r.m <= 20000 && r.s > 0 && r.s < 7200);
  const res = await db.prepare('UPDATE workouts SET laps = ? WHERE person_id = ? AND strava_id = ?').bind(reps.length ? JSON.stringify(reps) : '', personId, id).run();
  if (!res.meta.changes) return json({ error: 'Unknown session' }, 404);
  await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(personId).run();
  return json({ ok: true, reps });
}

// What Hawky heard in the chat, checked and saved: a day's feel, sleep and a
// note; body map changes; health status. Returns short labels for the page.
async function applyHawkySaves(db, personId, out) {
  const saved = [];
  const today = todayInTz();
  const log = out?.log;
  if (log && /^\d{4}-\d{2}-\d{2}$/.test(log.date || '') && log.date <= today && log.date >= todayInTz(new Date(Date.now() - 14 * 86400000))) {
    const fields = {};
    const feel = Math.round(Number(log.feel));
    if (feel >= 1 && feel <= 10) { fields.feel = feel; saved.push(`feel ${feel}/10`); }
    const sleep = Number(log.sleep_hours);
    if (sleep > 0 && sleep <= 16) { fields.sleep_hours = Math.round(sleep * 2) / 2; saved.push(`${fields.sleep_hours} h sleep`); }
    const note = str(log.note, 300);
    if (note) {
      const row = await db.prepare('SELECT notes FROM training_days WHERE person_id = ? AND date = ?').bind(personId, log.date).first();
      if (!(row?.notes || '').includes(note)) { fields.notes = str(row?.notes ? `${row.notes}\n${note}` : note, 2000); saved.push('a note'); }
    }
    if (Object.keys(fields).length) {
      await saveDay(db, personId, log.date, fields);
      const label = new Date(log.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      saved.splice(0, saved.length, `${saved.join(', ')} on ${label}`);
    }
  }
  for (const b of Array.isArray(out?.body) ? out.body.slice(0, 6) : []) {
    if (!BODY_PARTS[b?.part] || !['sore', 'pain', 'none'].includes(b?.status)) continue;
    if (b.status === 'none') await db.prepare('DELETE FROM body_marks WHERE person_id = ? AND part = ?').bind(personId, b.part).run();
    else await db.prepare('INSERT INTO body_marks (person_id, part, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, part) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(personId, b.part, b.status, Date.now()).run();
    saved.push(`${BODY_PARTS[b.part]}: ${b.status === 'none' ? 'cleared' : b.status}`);
  }
  if (['healthy', 'injured', 'sick'].includes(out?.health_status)) {
    await db.prepare('UPDATE people SET health_status = ?, health_updated_at = ? WHERE id = ?').bind(out.health_status, Date.now(), personId).run();
    saved.push(`status: ${out.health_status}`);
  }
  // Plan and level changes go through Hawky's guardrails; a refusal comes
  // back marked "!" so the page can show why.
  const person = (out?.plan_change || out?.level_change)
    ? await db.prepare('SELECT id, name, first_name, class_year, plan_rank, coach_rank, health_status, health_updated_at, training_status FROM people WHERE id = ?').bind(personId).first()
    : null;
  if (out?.plan_change && person) {
    try {
      const c = await applyPlanChange(db, person, out.plan_change, 'hawky');
      const label = new Date(c.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      saved.push(`plan for ${label}: ${c.type}${c.miles ? ` ${c.miles} mi` : ''}`);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      saved.push(`!${err.message}`);
    }
  }
  if (out?.level_change && person) {
    try {
      const health = await healthSummary(db, person, today);
      const m = await changeLevel(db, person, out.level_change.direction, out.level_change.reason, today, health);
      saved.push(`plan level: ${m.from_miles} → ${m.to_miles} mi a week`);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      saved.push(`!${err.message}`);
    }
  }
  return saved;
}

// Team mileage: weekly totals for the last 8 weeks and each athlete's week.
// Synced runs count; hand-logged miles count on days with no synced runs.
async function teamMileage(db) {
  const today = todayInTz();
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  const shift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const weekStart = shift(today, dow === 0 ? -6 : 1 - dow);
  const from = shift(weekStart, -7 * 7);
  const [people, runs, manual] = await Promise.all([
    db.prepare("SELECT id, name, color, class_year, health_status, training_status, icu_key_enc != '' AS watch FROM people ORDER BY name").all(),
    db.prepare("SELECT person_id, date, SUM(distance_mi) AS mi FROM workouts WHERE date >= ? AND category != 'crosstrain' GROUP BY person_id, date").bind(from).all(),
    db.prepare('SELECT person_id, date, manual_miles AS mi FROM training_days WHERE date >= ? AND manual_miles > 0').bind(from).all(),
  ]);
  const byPerson = new Map();
  const put = (pid, date, mi, synced) => {
    if (!byPerson.has(pid)) byPerson.set(pid, new Map());
    const m = byPerson.get(pid);
    if (synced || !m.has(date)) m.set(date, { mi, synced });
  };
  runs.results.forEach((r) => put(r.person_id, r.date, r.mi || 0, true));
  manual.results.forEach((r) => { const m = byPerson.get(r.person_id); if (!m?.get(r.date)?.synced) put(r.person_id, r.date, r.mi, false); });
  const weekIdx = (date) => Math.floor((Date.parse(date + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / (7 * 86400000));
  const round = (n) => Math.round(n * 10) / 10;
  const weeks = Array.from({ length: 8 }, (_, i) => ({ week_of: shift(from, i * 7), miles: 0, athletes: 0 }));
  const athletes = people.results.map((p) => {
    const perWeek = Array(8).fill(0);
    let daysThisWeek = 0;
    for (const [date, d] of byPerson.get(p.id) || []) {
      const i = weekIdx(date);
      if (i < 0 || i > 7) continue;
      perWeek[i] += d.mi;
      if (i === 7 && d.mi > 0) daysThisWeek++;
    }
    perWeek.forEach((mi, i) => { weeks[i].miles += mi; if (mi > 0) weeks[i].athletes++; });
    return {
      id: p.id, name: p.name, color: p.color, class_year: p.class_year || '', health: p.health_status, training: p.training_status, watch: !!p.watch,
      this_week: round(perWeek[7]), last_week: round(perWeek[6]), avg4: round((perWeek[3] + perWeek[4] + perWeek[5] + perWeek[6]) / 4), days_this_week: daysThisWeek,
      weeks: perWeek.map(round),
    };
  });
  weeks.forEach((w) => { w.miles = round(w.miles); });
  return { today, week_of: weekStart, weeks, athletes, this_week: weeks[7].miles, last_week: weeks[6].miles };
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === SYNC_CRON) {
      ctx.waitUntil(syncDue(env).catch(err => console.error('intervals sync failed', err)));
    } else if (event.cron === MEET_REMINDER_CRON) {
      ctx.waitUntil(sendMeetDayReminders(env).catch(err => console.error('meet-day reminder failed', err)));
    }
  },

  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);
    const { pathname } = reqUrl;

    try {
      if (pathname === '/api/state' && request.method === 'GET') {
        return json(await getState(env.DB));
      }

      if (pathname === '/api/plan/export' && request.method === 'GET') {
        // Dry run: the next days of the plan as the intervals.icu workouts that would be sent. Nothing leaves Hawks.
        const personId = str(reqUrl.searchParams.get('personId'), 100);
        const person = await env.DB.prepare('SELECT id, name, first_name, class_year, plan_rank FROM people WHERE id = ?').bind(personId).first();
        if (!person) return json({ error: 'Unknown person' }, 404);
        const today = todayInTz();
        const fitness = await getFitness(env.DB, personId, today);
        if (!fitness?.zones?.length) return json({ error: 'Add a race or PR first so Hawks can set your paces.' }, 400);
        const days = Math.min(Math.max(Number(reqUrl.searchParams.get('days')) || 14, 1), 28);
        return json({ workouts: await planWorkouts(env.DB, person, fitness, today, days) });
      }

      if (pathname === '/api/plan' && request.method === 'GET') {
        return await getPlan(env.DB, reqUrl.searchParams);
      }

      if (pathname === '/api/distance' && request.method === 'GET') {
        return await getDistance(env.DB, reqUrl.searchParams, env);
      }

      if (pathname === '/mcp' && request.method === 'POST') {
        return await handleMcp(request, env, ctx);
      }
      if (pathname === '/mcp' && request.method === 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }

      const coachMatch = pathname.match(/^\/mcp\/coach\/([a-f0-9]{20,64})$/);
      if (coachMatch && request.method === 'POST') {
        return await handleCoachMcp(request, env, coachMatch[1]);
      }
      if (coachMatch) {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }

      if (pathname === '/api/log' && request.method === 'GET') {
        const p = reqUrl.searchParams;
        try {
          const personId = str(p.get('personId'), 100);
          const data = await getLog(env.DB, personId, str(p.get('from'), 10), str(p.get('to'), 10));
          return json({ ...data, five_k_time: await fiveKFor(env.DB, personId) });
        } catch (err) {
          if (err instanceof LogError) return json({ error: err.message }, 400);
          throw err;
        }
      }

      if (pathname === '/api/intervals/status' && request.method === 'GET') {
        const st = await icuStatus(env.DB, str(reqUrl.searchParams.get('personId'), 100));
        return st ? json({ ...st, ai: aiEnabled(env) }) : json({ error: 'Unknown person' }, 404);
      }

      if (pathname === '/api/library' && request.method === 'GET') {
        const personId = str(reqUrl.searchParams.get('personId'), 100);
        const person = personId ? await env.DB.prepare('SELECT id, class_year, plan_rank FROM people WHERE id = ?').bind(personId).first() : null;
        const fitness = person ? await getFitness(env.DB, personId, todayInTz()) : null;
        // Each workout written for this runner: their plan level's variant,
        // the session in words and goal splits from their Fitness States.
        const rank = person ? (PLANS[person.plan_rank] ? Number(person.plan_rank) : CLASS_YEAR_RANK[person.class_year] ?? null) : null;
        return json({
          ...libraryMeta(),
          groups: WORKOUT_GROUPS,
          workouts: WORKOUTS.map((w) => ({ ...w, group: workoutGroup(w), personal: personalWorkout(w, fitness?.vo2r ? fitness : null, rank) })),
          fitness,
          five_k_time: person ? await fiveKFor(env.DB, personId) : '',
          prs: person ? await getPrs(env.DB, personId) : {},
        });
      }

      if (pathname === '/api/fitness' && request.method === 'GET') {
        const personId = str(reqUrl.searchParams.get('personId'), 100);
        const person = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
        if (!person) return json({ error: 'Unknown person' }, 404);
        return json({ fitness: await getFitness(env.DB, personId, todayInTz()), history: await fitnessHistory(env.DB, personId) });
      }

      if (pathname === '/api/predict' && request.method === 'GET') {
        const personId = str(reqUrl.searchParams.get('personId'), 100);
        const person = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
        if (!person) return json({ error: 'Unknown person' }, 404);
        try { return json(await racePredictions(env, personId, todayInTz())); } catch (e) { return json({ enabled: false, error: String(e?.message || e) }); }
      }

      if (pathname === '/api/hawky' && request.method === 'GET') {
        try {
          return json(await hawkyState(env.DB, str(reqUrl.searchParams.get('personId'), 100)));
        } catch (err) {
          if (err instanceof PlanError) return json({ error: err.message }, 400);
          throw err;
        }
      }

      if (pathname === '/api/team' && request.method === 'GET') {
        return json(await teamMileage(env.DB));
      }

      if (pathname === '/api/workouts' && request.method === 'GET') {
        const data = await workoutsForApp(env.DB, str(reqUrl.searchParams.get('personId'), 100));
        return data ? json(data) : json({ error: 'Unknown person' }, 404);
      }

      const icsMatch = pathname.match(/^\/api\/calendar\/([^/]+)\.ics$/);
      if (icsMatch && request.method === 'GET') {
        const feed = await buildIcsFeed(env.DB, icsMatch[1]);
        if (!feed) return new Response('Not found', { status: 404 });
        return new Response(feed, {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="hawks-calendar.ics"',
          },
        });
      }

      if (request.method === 'POST') {
        const body = await readBody(request);
        if (body === null) return json({ error: 'Invalid JSON body' }, 400);

        if (pathname === '/api/people') return await upsertPerson(env.DB, body);
        if (pathname === '/api/availability/toggle') return await toggleAvailability(env.DB, body);
        if (pathname === '/api/people/default-status') return await setDefaultStatus(env.DB, body);
        if (pathname === '/api/people/health-status') return await setHealthStatus(env.DB, body);
        if (pathname === '/api/people/training-status') return await setTrainingStatus(env.DB, body);
        if (pathname === '/api/body/toggle') return await toggleBodyMark(env.DB, body);
        if (pathname === '/api/comment') return await saveComment(env.DB, body);
        if (pathname === '/api/events') return await createEvent(env.DB, body);
        if (pathname === '/api/rsvp') return await saveRsvp(env.DB, body);
        if (pathname === '/api/posts') return await createPost(env.DB, body);
        if (pathname === '/api/people/delete') return await deletePerson(env.DB, body);
        if (pathname === '/api/posts/delete') return await deletePost(env.DB, body);
        if (pathname === '/api/events/update') return await updateEvent(env.DB, body);
        if (pathname === '/api/events/delete') return await deleteEvent(env.DB, body);
        if (pathname === '/api/schedule/week/apply') return await applyWeekTemplate(env.DB, body);
        if (pathname === '/api/schedule/week/clear') return await clearWeekTemplate(env.DB, body);
        if (pathname === '/api/people/personal') return await upsertPersonal(env.DB, body, env, ctx);
        if (pathname === '/api/travel-estimate') return await upsertTravelEstimate(env.DB, body);
        if (pathname === '/api/plan/reset') {
          await resetPlanDay(env.DB, str(body.personId, 100), str(body.date, 10), body.keep === true);
          return json(await hawkyState(env.DB, str(body.personId, 100)));
        }
        if (pathname === '/api/log/session-splits') return await saveSessionSplits(env.DB, body);
        if (pathname === '/api/log/day' || pathname === '/api/log/track' || pathname === '/api/people/5k' || pathname === '/api/people/prs' || pathname === '/api/fitness/refresh') {
          const personId = str(body.personId, 100);
          try {
            if (pathname === '/api/log/track') {
              const day = await setDayTrack(env.DB, personId, str(body.date, 10), body.track === true);
              await env.DB.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(personId).run();
              return json(day);
            }
            if (pathname === '/api/fitness/refresh') return json({ fitness: await recomputeFitness(env.DB, personId, todayInTz()) });
            if (pathname === '/api/people/prs') {
              const out = await setPrs(env.DB, personId, body.prs);
              return json({ ...out, fitness: await recomputeFitness(env.DB, personId, todayInTz()) });
            }
            if (pathname === '/api/people/5k') {
              const out = await setFiveK(env.DB, personId, body.time);
              return json({ ...out, fitness: await recomputeFitness(env.DB, personId, todayInTz()) });
            }
            // Watch days are locked: their miles, minutes, runs and difficulty
            // come from the synced activities.
            const date = str(body.date, 10);
            const fields = { ...(body.fields || {}) };
            const synced = await env.DB.prepare('SELECT 1 FROM workouts WHERE person_id = ? AND date = ? LIMIT 1').bind(personId, date).first();
            if (synced) ['manual_miles', 'minutes', 'runs', 'difficulty'].forEach((k) => delete fields[k]);
            const day = await saveDay(env.DB, personId, date, fields);
            if ('split_reps' in fields || 'manual_miles' in fields) await env.DB.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(personId).run();
            return json(day);
          } catch (err) {
            if (err instanceof LogError) return json({ error: err.message }, 400);
            throw err;
          }
        }
        if (pathname.startsWith('/api/intervals/') || pathname === '/api/coach/ask') {
          const personId = str(body.personId, 100);
          try {
            if (pathname === '/api/intervals/connect') return json(await icuConnect(env, personId, body.athleteId, body.apiKey));
            if (pathname === '/api/intervals/disconnect') return json(await icuDisconnect(env, personId));
            if (pathname === '/api/intervals/push-plan') return json(await pushPlan(env, personId, { days: body.days }));
            if (pathname === '/api/intervals/sync') return json(await syncPerson(env, personId, { days: body.days === 60 ? 60 : undefined, backfill: true }));
            if (pathname === '/api/intervals/import') return json(await importHistory(env, personId));
            if (pathname === '/api/coach/ask') {
              const person = await env.DB.prepare('SELECT id, name, first_name, class_year, plan_rank FROM people WHERE id = ?').bind(personId).first();
              if (!person) return json({ error: 'Unknown person' }, 400);
              const { rubric, already_logged, ...context } = await getCoachContext(env.DB, person);
              context.workout_library = WORKOUTS.map((w) => ({ id: w.id, name: w.name, type: w.type, races: w.races, min: w.total_min, level: w.level, main: w.main }));
              // Older history, compact: every session with splits or a library
              // workout, and 16 weeks of weekly totals.
              const past = await getLog(env.DB, personId, todayInTz(new Date(Date.now() - 112 * 86400000)), todayInTz());
              context.weekly_totals_16_weeks = past.weeks;
              const sessions = (await env.DB.prepare(
                "SELECT date, library_id, splits, summary, difficulty FROM training_days WHERE person_id = ? AND (library_id != '' OR splits != '') ORDER BY date"
              ).bind(personId).all()).results;
              context.all_workout_sessions = sessions.map((d) => ({ date: d.date, workout: d.library_id || null, splits: d.splits || null, summary: (d.summary || '').slice(0, 200), difficulty: d.difficulty }));
              const state = await hawkyState(env.DB, personId);
              context.plan = { today: state.today, tomorrow: state.tomorrow, week: state.week, level: state.level, changes: state.changes };
              context.health = state.health;
              const history = Array.isArray(body.history) ? body.history : [{ role: 'user', text: body.question }];
              const out = await askCoach(env, env.DB, person, history, context, todayInTz(), BODY_PARTS);
              const saved = await applyHawkySaves(env.DB, personId, out);
              return json({ answer: String(out?.answer || ''), saved: saved.filter((x) => !x.startsWith('!')), refused: saved.filter((x) => x.startsWith('!')).map((x) => x.slice(1)) });
            }
          } catch (err) {
            if (err instanceof IntervalsError || err instanceof AiError) return json({ error: err.message }, 400);
            throw err;
          }
        }
        if (pathname === '/api/coach/link') {
          const token = await issueCoachToken(env.DB, str(body.personId, 100), body.regenerate === true);
          return token ? json({ url: `${reqUrl.origin}/mcp/coach/${token}` }) : json({ error: 'Unknown person' }, 400);
        }
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }

    return new Response('Not found', { status: 404 });
  },
};
