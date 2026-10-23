// Runs src/planpush.js against a fake intervals.icu: create, update in place, never touch events that are not ours, remove days that left the plan.
// Usage: node scripts/check-planpush.mjs

import { pushPlan } from '../src/planpush.js';

const env0 = { MCP_AUTH_TOKEN: 'test-secret-for-hkdf' };
// encrypt exactly as intervals.js does
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env0.MCP_AUTH_TOKEN), 'HKDF', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('hawks-intervals'), info: new TextEncoder().encode('icu-key-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('FAKEKEY1234567890'));
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const enc = `${b64(iv)}.${b64(ct)}`;
const today = new Date().toISOString().slice(0, 10), t0 = Date.parse(today + 'T12:00:00Z');
const wk = [];
for (let d = 1; d <= 300; d++) { const dow = d % 7; if (dow === 0) continue; const mi = dow === 6 ? 12 : 4.5; wk.push({ strava_id: 'x' + d, date: new Date(t0 - d * 864e5).toISOString().slice(0, 10), name: 'Run', category: 'easy', distance_mi: mi, raw_distance_mi: mi, moving_sec: mi * 8.6 * 60, elapsed_sec: mi * 8.8 * 60, avg_hr: 150, max_hr: 190, elev_gain_ft: 100, laps: null, surface: 'road', course: null, gps_vc: 0, load: 50, temp_f: 60, dew_point_f: 50 }); }
const prs = JSON.stringify({ '5K': { time: '19:30', date: today }, '1600': { time: '5:55', date: today } });
const db = { prepare(sql) { const q = { bind() { return q; },
  async first() { if (/icu_key_enc/.test(sql) && /FROM people/.test(sql)) return { id: 'p', icu_athlete: 'i999', icu_key_enc: enc, plan_rank: 3, class_year: 'Sophomore' }; if (/FROM people/.test(sql)) return { id: 'p', prs, five_k_time: '19:30', five_k_set_at: t0, plan_rank: 3, class_year: 'Sophomore', name: 'T', first_name: 'T' }; if (/MAX\(max_hr\)/.test(sql)) return { m: 190 }; return null; },
  async all() { if (/FROM workouts WHERE person_id/.test(sql) && !/best_efforts/.test(sql)) return { results: wk }; return { results: [] }; }, async run() { return {}; } }; return q; }, async batch() { return []; } };
// a fake intervals.icu
const store = new Map(); let nextId = 100; const log = [];
store.set(1, { id: 1, category: 'WORKOUT', external_id: 'someone-elses', start_date_local: today + 'T00:00:00', workout_doc: { steps: [1] } });   // not ours: must never be touched
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const m = init.method || 'GET'; const p = u.pathname.replace('/api/v1/athlete/i999', ''); log.push(`${m} ${p}${u.search}`);
  if (init.headers.Authorization !== 'Basic ' + btoa('API_KEY:FAKEKEY1234567890')) return new Response('no', { status: 401 });
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (m === 'GET' && p === '') return ok({ id: 'i999', icu_garmin_upload_workouts: true, coros_upload_workouts: false });
  if (m === 'GET' && p === '/events') return ok([...store.values()]);
  if (m === 'POST' && p === '/events') { const b = JSON.parse(init.body); const e = { ...b, id: nextId++, workout_doc: { steps: b.description.split('\n').filter((l) => l.startsWith('- ')) } }; store.set(e.id, e); return ok(e); }
  const mm = p.match(/^\/events\/(\d+)$/);
  if (mm && m === 'PUT') { const b = JSON.parse(init.body); const e = { ...store.get(+mm[1]), ...b, workout_doc: { steps: b.description.split('\n').filter((l) => l.startsWith('- ')) } }; store.set(e.id, e); return ok(e); }
  if (mm && m === 'DELETE') { store.delete(+mm[1]); return ok({}); }
  return new Response('?', { status: 404 });
};
const env = { ...env0, DB: db };
const a = await pushPlan(env, 'p', { days: 8 }); console.log('first push:', JSON.stringify({ ...a, note: a.note.slice(0, 40) }));
const b = await pushPlan(env, 'p', { days: 8 }); console.log('second push:', JSON.stringify({ sent: b.sent, created: b.created, updated: b.updated, deleted: b.deleted }));
console.log('events on calendar:', store.size, '(1 was not ours; still there:', store.has(1), ')');
// a day becomes rest: drop one of ours from the plan by shrinking the window
const c = await pushPlan(env, 'p', { days: 3 }); console.log('shorter window:', JSON.stringify({ sent: c.sent, created: c.created, updated: c.updated, deleted: c.deleted }), '| left:', store.size);
console.log('requests in the first push:', log.slice(0, 5).join(' ; '));
