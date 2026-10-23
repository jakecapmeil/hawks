// Runs src/cohorts.js on a synthetic runner: the goal-time comparison, the like-you cell and the error messages. Usage: node scripts/check-cohorts.mjs
import { cohortReport } from '../src/cohorts.js';
import { todayInTz } from '../src/coach.js';
const today = todayInTz(), t0 = Date.parse(today + 'T12:00:00Z');
const mk = (mpw, pace, lng) => { const w = []; for (let d = 1; d <= 112; d++) { const dow = d % 7; if (dow === 0) continue; const mi = dow === 6 ? lng : (mpw - lng) / 5; w.push({ date: new Date(t0 - d * 864e5).toISOString().slice(0, 10), distance_mi: mi, moving_sec: mi * pace * 60, category: 'easy' }); } return w; };
const db = (rows) => ({ prepare() { const q = { bind() { return q; }, async all() { return { results: rows }; } }; return q; } });
let r = await cohortReport(db(mk(35, 8.5, 13)), 'p', '3:30:00');
console.log(JSON.stringify({ you: r.you, predicted: r.predicted, like: r.like }));
console.log(r.goal.band, r.goal.finishers); for (const x of r.goal.rows) console.log(' ', x.label, '| you', x.you_text || x.you, '| typical', x.typical_text || x.typical, '| pct', x.you_percentile);
console.log((await cohortReport(db(mk(35, 8.5, 13)), 'p', '1:10:00')).goal_error);
console.log((await cohortReport(db(mk(35, 8.5, 13).slice(0, 8)), 'p', '')).error);
