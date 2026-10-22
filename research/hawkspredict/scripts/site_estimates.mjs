// Runs the website's real Fitness States code (src/fitness.js) on PR-only inputs. Usage: node site_estimates.mjs tasks.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { computeFitness, fmtTime } from '../../../src/fitness.js';
const tasks = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const t of tasks) {
  const prs = {};
  for (const [k, v] of Object.entries(t.prs)) prs[k] = { time: fmtTime(v.time, { tenths: true }), date: v.date, meet: v.meet };
  // fmtTime rounds to 0.1 s for short times and whole seconds above 180 s; pass exact seconds through the same text parser instead
  for (const [k, v] of Object.entries(t.prs)) { const s = v.time; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60; prs[k].time = h ? `${h}:${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}` : `${m}:${r.toFixed(2).padStart(5, '0')}`; }
  const f = computeFitness({ person: { prs: JSON.stringify(prs) }, workouts: [], days: [], maxHr: null, meets: new Set(), events: [], efforts: [], wellness: [], paceModel: null }, t.today);
  out.push({ i: t.i, est: Object.fromEntries((f.estimates || []).map((e) => [e.event, e.sec])), basis: f.basis, conf: f.confidence });
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(out.length, 'estimates; example', JSON.stringify(out[0]));
