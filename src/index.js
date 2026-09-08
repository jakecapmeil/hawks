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
  const [people, away, comments, events, rsvps, personTags, posts] = await Promise.all([
    db.prepare('SELECT id, name, color, phone, email FROM people').all(),
    db.prepare('SELECT person_id, date FROM away_days').all(),
    db.prepare('SELECT date, person_id, text FROM comments').all(),
    db.prepare('SELECT id, date, title, time, description, type, kind, auto FROM events').all(),
    db.prepare('SELECT event_id, person_id, status FROM rsvps').all(),
    db.prepare('SELECT person_id, tag FROM person_tags').all(),
    db.prepare('SELECT id, person_id, text, header, created_at FROM posts').all(),
  ]);

  const awayMap = {};
  for (const row of away.results) {
    (awayMap[row.person_id] ??= []).push(row.date);
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
      desc: row.description,
      type: row.type,
      kind: row.kind || '',
      auto: !!row.auto,
    });
  }

  const rsvpsMap = {};
  for (const row of rsvps.results) {
    (rsvpsMap[row.event_id] ??= {})[row.person_id] = row.status;
  }

  const tagsMap = {};
  for (const row of personTags.results) {
    (tagsMap[row.person_id] ??= []).push(row.tag);
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
    away: awayMap,
    comments: commentsMap,
    events: eventsMap,
    rsvps: rsvpsMap,
    tags: tagsMap,
    posts: postsList,
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

async function toggleAway(db, body) {
  const personId = str(body?.personId, 100);
  const date = str(body?.date, 20);
  if (!personId || !date) return json({ error: 'Missing personId or date' }, 400);

  const existing = await db.prepare('SELECT 1 FROM away_days WHERE person_id = ? AND date = ?').bind(personId, date).first();
  if (existing) {
    await db.prepare('DELETE FROM away_days WHERE person_id = ? AND date = ?').bind(personId, date).run();
    return json({ away: false });
  }
  await db.prepare('INSERT INTO away_days (person_id, date) VALUES (?, ?)').bind(personId, date).run();
  return json({ away: true });
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
  const desc = str(body?.desc, 2000);
  const type = VALID_EVENT_TYPES.includes(body?.type) ? body.type : 'practice';
  const kind = normalizeKind(type, body?.kind);
  if (!date || !title) return json({ error: 'Missing date or title' }, 400);

  const id = 'e_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO events (id, date, title, time, description, type, kind) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, date, title, time, desc, type, kind).run();

  return json({ event: { id, date, title, time, desc, type, kind, auto: false } });
}

const VALID_TAGS = ['sick', 'injured', 'cross_training'];

async function toggleTag(db, body) {
  const personId = str(body?.personId, 100);
  const tag = str(body?.tag, 30);
  if (!personId || !VALID_TAGS.includes(tag)) return json({ error: 'Missing personId or invalid tag' }, 400);

  const existing = await db.prepare('SELECT 1 FROM person_tags WHERE person_id = ? AND tag = ?').bind(personId, tag).first();
  if (existing) {
    await db.prepare('DELETE FROM person_tags WHERE person_id = ? AND tag = ?').bind(personId, tag).run();
    return json({ active: false });
  }
  await db.prepare('INSERT INTO person_tags (person_id, tag) VALUES (?, ?)').bind(personId, tag).run();
  return json({ active: true });
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
    db.prepare('DELETE FROM away_days WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM comments WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM rsvps WHERE person_id = ?').bind(personId),
    db.prepare('DELETE FROM person_tags WHERE person_id = ?').bind(personId),
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
  const desc = str(body?.desc, 2000);
  const type = VALID_EVENT_TYPES.includes(body?.type) ? body.type : 'practice';
  const kind = normalizeKind(type, body?.kind);
  if (!eventId || !title) return json({ error: 'Missing eventId or title' }, 400);

  await db.prepare(
    'UPDATE events SET title = ?, time = ?, description = ?, type = ?, kind = ? WHERE id = ?'
  ).bind(title, time, desc, type, kind, eventId).run();

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

  // The formatter only fills open weekday slots. A day with a hand-made event
  // on it — a meet, a one-off practice, anything — keeps what it has, and a
  // day that already holds a generated practice is left alone so re-applying a
  // week is a no-op rather than a source of duplicates.
  const occupied = new Set();
  const alreadyGenerated = new Set();
  for (const row of existing.results) {
    if (row.auto) alreadyGenerated.add(row.date);
    else occupied.add(row.date);
  }

  const created = [];
  const stmts = [];
  WEEK_TEMPLATE.forEach((t, i) => {
    const date = dates[i];
    if (occupied.has(date) || alreadyGenerated.has(date)) return;
    const id = 'e_' + crypto.randomUUID();
    created.push({ id, date, title: t.title, time, desc: '', type: 'practice', kind: t.kind, auto: true });
    stmts.push(db.prepare(
      "INSERT INTO events (id, date, title, time, description, type, kind, auto) VALUES (?, ?, ?, ?, '', 'practice', ?, 1)"
    ).bind(id, date, t.title, time, t.kind));
  });

  if (stmts.length) await db.batch(stmts);
  return json({ created, skipped: dates.filter(d => occupied.has(d)) });
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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname === '/api/state' && request.method === 'GET') {
        return json(await getState(env.DB));
      }

      if (request.method === 'POST') {
        const body = await readBody(request);
        if (body === null) return json({ error: 'Invalid JSON body' }, 400);

        if (pathname === '/api/people') return await upsertPerson(env.DB, body);
        if (pathname === '/api/away/toggle') return await toggleAway(env.DB, body);
        if (pathname === '/api/comment') return await saveComment(env.DB, body);
        if (pathname === '/api/events') return await createEvent(env.DB, body);
        if (pathname === '/api/rsvp') return await saveRsvp(env.DB, body);
        if (pathname === '/api/tags/toggle') return await toggleTag(env.DB, body);
        if (pathname === '/api/posts') return await createPost(env.DB, body);
        if (pathname === '/api/people/delete') return await deletePerson(env.DB, body);
        if (pathname === '/api/posts/delete') return await deletePost(env.DB, body);
        if (pathname === '/api/events/update') return await updateEvent(env.DB, body);
        if (pathname === '/api/events/delete') return await deleteEvent(env.DB, body);
        if (pathname === '/api/schedule/week/apply') return await applyWeekTemplate(env.DB, body);
        if (pathname === '/api/schedule/week/clear') return await clearWeekTemplate(env.DB, body);
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }

    return new Response('Not found', { status: 404 });
  },
};
