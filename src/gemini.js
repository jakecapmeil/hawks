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
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
              },
              required: ['id', 'category'],
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
export async function reportSessions(env, db, person, sessions, { rubric, maxHr, today }) {
  if (!aiEnabled(env) || !sessions.length) return null;
  await spend(db, person.id, today);
  const acts = sessions.reduce((n, x) => n + x.activities.length, 0);
  const out = await generate(env, {
    system: `You are Hawky, the Hawks cross country team's AI coach, reviewing a high school runner's synced training. Follow this rubric exactly; only the CATEGORY and the session REPORT are your job.\n\n${rubric}`,
    prompt: `Runner: ${person.first_name || person.name}. Max HR used: ${maxHr}.
Activities are already grouped into sessions (warm-up, workout and cool-down saved separately are ONE session). For each session return:
- main_id: the main activity (the workout, race or longest run)
- activities: every activity id with one category (warm-ups/cool-downs around a workout are "easy"). rule_category is a math-based guess; change it only when laps, HR or the name clearly say otherwise.
- report: 2-4 sentences on the whole session: what it was, the reps or pace vs what it should have been, and one thing to focus on.
Then for each date, one "line": a single plain sentence summing up the day (e.g. "Solid 6x800 averaging 2:46 with an easy double in the evening.").

${JSON.stringify(sessions)}`,
    schema: SESSION_SCHEMA,
    maxTokens: 300 + sessions.length * 220 + acts * 30,
  });
  return out && Array.isArray(out.sessions) ? out : null;
}

export async function askCoach(env, db, person, question, context, today) {
  if (!aiEnabled(env)) throw new AiError('AI is not set up for this app.');
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw new AiError('Ask a question first.');
  await spend(db, person.id, today);
  return await generate(env, {
    system: `You are Hawky, the Hawks cross country team's AI coach, talking to one high school runner. Be specific, encouraging and brief (under 200 words). Base answers on their data below: training plan, log, PRs, Fitness States (race estimates, VO2max estimate, mileage, pace zones) and the team's workout library. Every pace you give must come from their Fitness States paces. When suggesting a workout, prefer one from the library, lay it out as warm-up / main set with rep targets / cool-down, and give each rep's target time from their paces. Never give medical diagnoses: for pain that lasts or gets worse, tell them to talk to their coach or a doctor. If the data doesn't answer the question, say so.`,
    prompt: `Today is ${today}.\n\nRUNNER DATA:\n${JSON.stringify(context)}\n\nQUESTION: ${q}`,
    maxTokens: 700,
  });
}
