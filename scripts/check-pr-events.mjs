// Fails when the places that list PR events disagree: the server's PR_EVENTS
// (log.js), the fitness PR_METERS, the estimate rows, and the PR form in
// index.html. Run: npm run check
import { readFileSync } from 'node:fs';
import { PR_EVENTS } from '../src/log.js';
import { PR_METERS, PR_FOR_ESTIMATE, EVENTS } from '../src/fitness.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const client = JSON.parse(html.match(/const PR_EVENTS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const problems = [];
if (!same(PR_EVENTS, client)) problems.push(`index.html PR_EVENTS ${client} differs from log.js ${PR_EVENTS}`);
if (!same(PR_EVENTS, Object.keys(PR_METERS))) problems.push(`fitness PR_METERS ${Object.keys(PR_METERS)} differs from PR_EVENTS ${PR_EVENTS}`);
for (const e of PR_EVENTS) if (!html.includes(`'${e}':'`) && !html.includes(`'${e}':`)) problems.push(`PR form has no placeholder for ${e}`);
// Any estimate row at a distance we keep a PR for must be compared with it.
const rows = [...EVENTS.map((e) => [e.key, e.m]), ['vc5k', 5000], ['vc2.5', 2.5 * 1609.344]];
for (const [k, m] of rows) {
  if (Object.values(PR_METERS).some((pm) => Math.abs(pm - m) < 1) && !(k in PR_FOR_ESTIMATE)) problems.push(`estimate row ${k} has a PR event at its distance but no PR_FOR_ESTIMATE entry`);
}
for (const [k, e] of Object.entries(PR_FOR_ESTIMATE)) if (!PR_EVENTS.includes(e)) problems.push(`PR_FOR_ESTIMATE ${k} -> unknown PR event ${e}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`PR events agree: ${PR_EVENTS.join(', ')}`);
