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
    db.prepare('SELECT id, date, title, time, description FROM events').all(),
    db.prepare('SELECT event_id, person_id, status FROM rsvps').all(),
    db.prepare('SELECT person_id, tag FROM person_tags').all(),
    db.prepare('SELECT id, person_id, text, created_at FROM posts').all(),
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

  const postsList = posts.results.map(row => ({
    id: row.id,
    personId: row.person_id,
    text: row.text,
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

async function createPost(db, body) {
  const personId = str(body?.personId, 100);
  const text = str(body?.text, 2000);
  if (!personId || !text) return json({ error: 'Missing personId or text' }, 400);

  const id = 'post_' + crypto.randomUUID();
  const createdAt = Date.now();
  await db.prepare(
    'INSERT INTO posts (id, person_id, text, created_at) VALUES (?, ?, ?, ?)'
  ).bind(id, personId, text, createdAt).run();

  return json({ post: { id, personId, text, createdAt } });
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
        if (pathname === '/api/events/delete') return await deleteEvent(env.DB, body);
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }

    return new Response('Not found', { status: 404 });
  },
};
