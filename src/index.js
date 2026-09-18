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
              out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes
       FROM people`
    ).all(),
    db.prepare('SELECT person_id, date, status FROM availability_overrides').all(),
    db.prepare('SELECT date, person_id, text FROM comments').all(),
    db.prepare('SELECT id, date, title, time, end_time, description, type, kind, auto, location FROM events').all(),
    db.prepare('SELECT event_id, person_id, status FROM rsvps').all(),
    db.prepare('SELECT person_id, part, status FROM body_marks').all(),
    db.prepare('SELECT id, person_id, text, header, created_at FROM posts').all(),
    db.prepare('SELECT id, name, address, kind FROM locations').all(),
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

  const result = await db.prepare('UPDATE people SET health_status = ? WHERE id = ?').bind(status, personId).run();
  if (!result.meta.changes) return json({ error: 'Unknown person' }, 400);
  return json({ ok: true });
}

const VALID_TRAINING_STATUS = ['resting', 'running', 'crosstraining'];

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
      `INSERT INTO body_marks (person_id, part, status) VALUES (?, ?, ?)
       ON CONFLICT(person_id, part) DO UPDATE SET status=excluded.status`
    ).bind(personId, part, next).run();
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
  if (!date || !title) return json({ error: 'Missing date or title' }, 400);

  const id = 'e_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO events (id, date, title, time, end_time, description, type, kind, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, date, title, time, endTime, desc, type, kind, location).run();

  return json({ event: { id, date, title, time, endTime, desc, type, kind, location, auto: false } });
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

  await db.prepare(
    'UPDATE events SET title = ?, time = ?, end_time = ?, description = ?, type = ?, kind = ?, location = ? WHERE id = ?'
  ).bind(title, time, endTime, desc, type, kind, location, eventId).run();

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

const MCP_TOOLS = [
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
        type: { type: 'string', enum: ['practice', 'meet', 'other'], description: 'defaults to practice' },
        kind: { type: 'string', enum: ['easy', 'workout', 'long_run'], description: 'only used when type is practice' },
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
];

class McpToolError extends Error {}

async function mcpGetRoster(db) {
  const rows = await db.prepare(
    `SELECT id, name, phone, email, first_name, class_year, track_id, date_entered, borough,
            home_address, out_mon, out_tue, out_wed, out_thu, out_fri, personal_notes,
            default_status, health_status, training_status
     FROM people ORDER BY name`
  ).all();
  return rows.results;
}

async function mcpListEvents(db, args) {
  const from = str(args?.from, 20);
  const to = str(args?.to, 20);
  const conds = [];
  const binds = [];
  if (from) { conds.push('date >= ?'); binds.push(from); }
  if (to) { conds.push('date <= ?'); binds.push(to); }
  let query = 'SELECT id, date, title, time, end_time, description, type, kind, location FROM events';
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY date, time';
  const rows = await db.prepare(query).bind(...binds).all();
  return rows.results.map(r => ({
    id: r.id, date: r.date, title: r.title, time: r.time, endTime: r.end_time,
    desc: r.description, type: r.type, kind: r.kind, location: r.location,
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

async function callMcpTool(name, args, env, ctx) {
  const db = env.DB;
  const a = args || {};
  switch (name) {
    case 'get_roster':
      return await mcpGetRoster(db);
    case 'list_events':
      return await mcpListEvents(db, a);
    case 'create_event': {
      const res = await createEvent(db, a);
      const data = await res.json();
      if (!res.ok) throw new McpToolError(data.error || 'create_event failed');
      return data;
    }
    case 'update_person':
      return await mcpUpdatePerson(db, a, env, ctx);
    case 'create_post': {
      const res = await createPost(db, a);
      const data = await res.json();
      if (!res.ok) throw new McpToolError(data.error || 'create_post failed');
      return data;
    }
    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}

async function handleMcp(request, env, ctx) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.MCP_AUTH_TOKEN || token !== env.MCP_AUTH_TOKEN) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401);
  }

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
        serverInfo: { name: 'hawks-calendar', version: '1.0.0' },
      });
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'ping') return respond({});
    if (method === 'tools/list') return respond({ tools: MCP_TOOLS });
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      try {
        const data = await callMcpTool(name, toolArgs, env, ctx);
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
    db.prepare('SELECT id, date, title, time, end_time, description, type, kind, location FROM events ORDER BY date, time').all(),
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

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname === '/api/state' && request.method === 'GET') {
        return json(await getState(env.DB));
      }

      if (pathname === '/mcp' && request.method === 'POST') {
        return await handleMcp(request, env, ctx);
      }
      if (pathname === '/mcp' && request.method === 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
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
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }

    return new Response('Not found', { status: 404 });
  },
};
