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
  const [people, away, comments, events, rsvps, personTags] = await Promise.all([
    db.prepare('SELECT id, name, color, phone, email FROM people').all(),
    db.prepare('SELECT person_id, date FROM away_days').all(),
    db.prepare('SELECT date, person_id, text FROM comments').all(),
    db.prepare('SELECT id, date, title, time, description FROM events').all(),
    db.prepare('SELECT event_id, person_id, status FROM rsvps').all(),
    db.prepare('SELECT person_id, tag FROM person_tags').all(),
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

  return { people: people.results, away: awayMap, comments: commentsMap, events: eventsMap, rsvps: rsvpsMap, tags: tagsMap };
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

async function createEvent(db, body) {
  const date = str(body?.date, 20);
  const title = str(body?.title, 200);
  const time = str(body?.time, 40);
  const desc = str(body?.desc, 2000);
  if (!date || !title) return json({ error: 'Missing date or title' }, 400);

  const id = 'e_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO events (id, date, title, time, description) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, date, title, time, desc).run();

  return json({ event: { id, date, title, time, desc } });
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
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }

    return new Response('Not found', { status: 404 });
  },
};
