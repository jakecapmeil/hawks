// Gemini, built into Hawks (free tier). Two jobs, both optional: if
// GEMINI_API_KEY isn't set, synced runs keep their rule-based category and
// Ask Coach is hidden.
//   1. classifyRuns: label runs synced from intervals.icu and write the short
//      coaching note, following the same rubric Claude Coach uses.
//   2. askCoach: answer a runner's question from their plan, log and the
//      workout library.
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
        maxOutputTokens: maxTokens,
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
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new AiError('The AI returned nothing.');
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('The AI returned malformed JSON.');
  }
}

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: ['easy', 'recovery', 'long', 'workout', 'race', 'shakeout', 'crosstrain'] },
          summary: { type: 'string' },
        },
        required: ['id', 'category', 'summary'],
      },
    },
  },
  required: ['runs'],
};

// runs: [{ id, date, planned, rule_category, miles, minutes, pace, avg_hr, max_hr, laps }]
export async function classifyRuns(env, db, person, runs, { rubric, maxHr, today }) {
  if (!aiEnabled(env) || !runs.length) return null;
  await spend(db, person.id, today);
  const out = await generate(env, {
    system: `You are a high school cross country coach labelling a runner's synced workouts. Follow this rubric exactly; only the CATEGORY and YOUR NOTE parts are your job.\n\n${rubric}`,
    prompt: `Runner: ${person.first_name || person.name}. Max HR used: ${maxHr}.\nFor each run, return its id, one category, and a 1-3 sentence note. rule_category is a math-based guess; change it only when the laps, HR or plan clearly say otherwise.\n\n${JSON.stringify(runs)}`,
    schema: RUN_SCHEMA,
    maxTokens: 300 + runs.length * 160,
  });
  return Array.isArray(out?.runs) ? out.runs : null;
}

export async function askCoach(env, db, person, question, context, today) {
  if (!aiEnabled(env)) throw new AiError('AI is not set up for this app.');
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw new AiError('Ask a question first.');
  await spend(db, person.id, today);
  return await generate(env, {
    system: `You are the Hawks cross country team's assistant coach, talking to one high school runner. Be specific, encouraging and brief (under 200 words). Base answers on their data below: training plan, log, PRs, paces and the team's workout library. When suggesting a workout, prefer one from the library and give their paces. Never give medical diagnoses: for pain that lasts or gets worse, tell them to talk to their coach or a doctor. If the data doesn't answer the question, say so.`,
    prompt: `Today is ${today}.\n\nRUNNER DATA:\n${JSON.stringify(context)}\n\nQUESTION: ${q}`,
    maxTokens: 700,
  });
}
