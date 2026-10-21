// Hawky, the team's built-in AI coach (Gemini free tier). Two jobs, both
// optional: if GEMINI_API_KEY isn't set, synced runs keep their rule-based
// category and Ask Hawky is hidden.
//   1. reportSessions: label runs synced from intervals.icu and write one
//      report per session (warm-up + workout + cool-down together) plus a
//      one-line summary per day, following the same rubric Hawky in Claude uses.
//   2. askCoach: answer a runner's question from their plan, log, Fitness
//      States and the workout library.
// Each person gets AI_DAILY_CAP calls a day so nobody burns the team's quota.

export class AiError extends Error {}

const DEFAULT_MODEL = 'gemini-flash-latest';
const AI_DAILY_CAP = 25;

export function aiEnabled(env) {
  return !!env.GEMINI_API_KEY;
}

async function spend(db, personId, today) {
  const row = await db.prepare(
    `INSERT INTO ai_usage (person_id, date, calls) VALUES (?, ?, 1)
     ON CONFLICT(person_id, date) DO UPDATE SET calls = calls + 1
     RETURNING calls`
  ).bind(personId, today).first();
  if (row.calls > AI_DAILY_CAP) throw new AiError(`Daily AI limit reached (${AI_DAILY_CAP}). Try again tomorrow.`);
}

async function generate(env, { system, prompt, schema, maxTokens = 1024 }) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  // GEMINI_API_BASE overrides the endpoint for local testing.
  const base = env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        // Thinking models spend part of this budget reasoning before they
        // answer, so it's set well above the visible answer length.
        maxOutputTokens: maxTokens + 4096,
        ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
      },
    }),
  });
  if (res.status === 429) throw new AiError('The AI is busy (free-tier rate limit). Try again in a minute.');
  if (!res.ok) {
    console.error('gemini error', res.status, (await res.text()).slice(0, 500));
    throw new AiError('The AI request failed.');
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (cand?.finishReason === 'MAX_TOKENS' && schema) throw new AiError('The AI ran out of room; try again.');
  if (!text) throw new AiError('The AI returned nothing.');
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('The AI returned malformed JSON.');
  }
}

const SESSION_SCHEMA = {
  type: 'object',
  properties: {
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          main_id: { type: 'string', description: 'id of the main activity (the workout, race or longest run)' },
          report: { type: 'string' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                category: { type: 'string', enum: ['easy', 'recovery', 'long', 'workout', 'race', 'shakeout', 'crosstrain'] },
                course: { type: 'string', enum: ['vc', 'xc', 'flat'], description: 'Where it was run: vc = Van Cortlandt Park, xc = another cross-country course, flat = road, track or anywhere flat' },
              },
              required: ['id', 'category', 'course'],
            },
          },
        },
        required: ['key', 'main_id', 'report', 'activities'],
      },
    },
    days: {
      type: 'array',
      items: { type: 'object', properties: { date: { type: 'string' }, line: { type: 'string' } }, required: ['date', 'line'] },
    },
  },
  required: ['sessions', 'days'],
};

// sessions: [{ key, date, activities: [{ id, start, name, rule_category, miles, minutes, pace, avg_hr, laps }] }]
export async function reportSessions(env, db, person, sessions, { rubric, maxHr, today, body, calendar = [] }) {
  if (!aiEnabled(env) || !sessions.length) return null;
  await spend(db, person.id, today);
  const acts = sessions.reduce((n, x) => n + x.activities.length, 0);
  const out = await generate(env, {
    system: `You are Hawky, the Hawks cross country team's AI coach, reviewing a high school runner's synced training. Follow this rubric exactly; only the CATEGORY and the session REPORT are your job.\n\n${rubric}`,
    prompt: `Runner: ${person.first_name || person.name}. Max HR used: ${maxHr}.${body ? `\nBody right now: ${JSON.stringify(body)} (mention it if a session ran on something marked sore or pain).` : ''}
Activities are already grouped into sessions (warm-up, workout and cool-down saved separately are ONE session). For each session return:
- main_id: the main activity (the workout, race or longest run)
- activities: every activity id with one category (warm-ups/cool-downs around a workout are "easy"). rule_category is a math-based guess; change it only when laps, HR or the name clearly say otherwise.
- course for every activity: "vc" when it was run at Van Cortlandt Park (the team's home course: hilly, gravel and grass, the 2.5 mi high school course and the 5K), "xc" for another cross-country course, otherwise "flat". Clues: the name or the athlete's note naming the park (Van Cortlandt, VC, Vannie, the Tortoise and Hare), a calendar event that day at Van Cortlandt for a race or workout (see calendar), a race-effort run of 2.5 mi or 5K with real climbing (elev_ft well over 20 per mile) in the Bronx. A track, road or a flat easy run is "flat". When unsure, "flat".
- report: 2-4 sentences on the whole session: what it was, the reps or pace vs what it should have been, and one thing to focus on.
Then for each date, one "line": a single plain sentence summing up the day (e.g. "Solid 6x800 averaging 2:46 with an easy double in the evening.").

${calendar.length ? `Team calendar on these days: ${JSON.stringify(calendar)}\n\n` : ''}${JSON.stringify(sessions)}`,
    schema: SESSION_SCHEMA,
    maxTokens: 300 + sessions.length * 220 + acts * 30,
  });
  return out && Array.isArray(out.sessions) ? out : null;
}

// What Hawky can save from a chat: how a day felt, sleep, a note, body map
// changes and health status. The server checks every value before saving.
const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    log: {
      type: 'object',
      description: 'Only when the runner told you how a day felt, how they slept, or something worth noting about a day.',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD of the day they mean' },
        feel: { type: 'integer', description: '1 (awful) to 10 (great)' },
        sleep_hours: { type: 'number' },
        note: { type: 'string', description: 'Short note in their words, e.g. "legs heavy on the last 2 reps"' },
      },
    },
    body: {
      type: 'array',
      description: 'Only when the runner says a body part is sore, painful, or better now.',
      items: {
        type: 'object',
        properties: { part: { type: 'string', description: 'A part id from body_parts' }, status: { type: 'string', enum: ['sore', 'pain', 'none'] } },
        required: ['part', 'status'],
      },
    },
    health_status: { type: 'string', enum: ['healthy', 'injured', 'sick'], description: 'Only when the runner says they are sick, injured, or better.' },
    plan_change: {
      type: 'object',
      description: "Change one day of the plan (today to 13 days out), when the runner can't do it as planned or you decide it should change.",
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        type: { type: 'string', enum: ['Easy', 'Recovery', 'Workout', 'Long run', 'Race', 'Shakeout', 'Cross-train', 'Off'] },
        miles: { type: 'number' },
        detail: { type: 'string', description: 'The session, e.g. "5 x 1K at 3:53 with 2 min jog" or "40 min easy bike"' },
        reason: { type: 'string', description: 'One sentence the runner will see' },
      },
      required: ['date', 'type', 'reason'],
    },
    level_change: {
      type: 'object',
      description: "Move the runner's plan up or down one level. Up only when level.ready is true; down when injury, illness or exhaustion calls for it.",
      properties: { direction: { type: 'string', enum: ['up', 'down'] }, reason: { type: 'string' } },
      required: ['direction', 'reason'],
    },
  },
  required: ['answer'],
};

// history: [{ role: 'user' | 'hawky', text }], oldest first, ending with the
// runner's new message.
export async function askCoach(env, db, person, history, context, today, bodyParts) {
  if (!aiEnabled(env)) throw new AiError('AI is not set up for this app.');
  const turns = (Array.isArray(history) ? history : []).slice(-12)
    .map((m) => ({ role: m?.role === 'hawky' ? 'Hawky' : 'Runner', text: String(m?.text || '').trim().slice(0, 1000) }))
    .filter((m) => m.text);
  if (!turns.length || turns[turns.length - 1].role !== 'Runner') throw new AiError('Ask a question first.');
  await spend(db, person.id, today);
  return await generate(env, {
    system: `You are Hawky, the Hawks cross country team's AI coach, chatting with one high school runner. Be specific, warm and brief (under 150 words), like a good coach checking in.

Base answers on their data below: training plan, log, how each day felt and how they slept, body (health status and body map: parts marked sore or pain), PRs, Fitness States (race estimates, VO2max estimate, mileage, pace zones) and the team's workout library. Every pace you give must come from their Fitness States paces. When suggesting a workout, prefer one from the library, lay it out as warm-up / main set with rep targets / cool-down, and give each rep's target time.

CHECK IN like a coach. If a recent run day has no feel or sleep logged, or a body part is marked sore or pain, ask about it, one short question at a time, at the end of your answer (e.g. "How did the 6x800 feel, 1 to 10?" or "Is the left calf still sore?"). Let soreness and how they feel change your advice: back off when something hurts or they're tired.

YOU RUN THEIR PLAN DAY TO DAY. The coach's weekly plan (plan.week) is the base and the goal is to follow it. Change a day (plan_change) when the runner says they can't do it (busy, sick, hurt, wiped out), when readiness or the body map says so, or to move a workout to a better day. Prefer moving or shrinking over skipping; keep two easy days between hard ones; never add mileage to make up for a missed day. Hawks rejects changes outside the plan's limits and tells you why, so stay close to the plan. Explain every change in one sentence. plan.today is what they'll see on the Plan tab (plan.tomorrow under it).

LEVELS. plan.level shows their weekly mileage and whether they're ready for the next level (ready plus the gates). If ready is true, you can tell them and level them up (level_change up). If they're injured, sick or exhausted for more than a few days, you can move them down. Talk in weekly miles, never level numbers.

SAVE what they tell you. When the runner says how a day felt, how they slept, or something about a day, fill log (feel 1-10 where 10 is great; pick the date they mean, default today or the most recent run). When they say a body part is sore, painful or better, fill body with the matching id from body_parts ("none" clears it). When they say they're sick, injured or better, set health_status. Mention briefly in your answer what you saved. Never save anything they didn't say.

Never give medical diagnoses: for pain that lasts or gets worse, tell them to talk to their coach or a doctor. If the data doesn't answer the question, say so.`,
    prompt: `Today is ${today}.\n\nRUNNER DATA:\n${JSON.stringify(context)}\n\nbody_parts (id: name): ${JSON.stringify(bodyParts)}\n\nCONVERSATION:\n${turns.map((m) => `${m.role}: ${m.text}`).join('\n')}\n\nReply as Hawky to the runner's last message.`,
    schema: CHAT_SCHEMA,
    maxTokens: 900,
  });
}
