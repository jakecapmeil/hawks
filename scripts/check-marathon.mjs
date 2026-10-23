// Proves the JavaScript HawksPredict-Marathon matches the Python it was trained in.
// Usage: node scripts/check-marathon.mjs path/to/marathon_parity.json   (written by research/hawkspredict/scripts/exp20_marathon.py)
import { readFileSync } from 'node:fs';
import { marathonFeatures, marathonLogSeconds } from '../src/marathon.js';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let worstF = 0;
let worstY = 0;
for (const c of cases) {
  const days = c.days.map((off, i) => ({ off, km: c.km[i], min: c.min[i] }));
  const f = marathonFeatures(days);
  for (const [k, v] of Object.entries(c.feats)) {
    const a = f[k];
    if (v === null || Number.isNaN(a)) { if (!(v === null && Number.isNaN(a))) worstF = Infinity; continue; }
    worstF = Math.max(worstF, Math.abs(a - v) / Math.max(1, Math.abs(v)));
  }
  worstY = Math.max(worstY, Math.abs(marathonLogSeconds(f) - c.y));
}
console.log(`${cases.length} cases | max relative feature diff ${worstF.toExponential(2)} | max |log-seconds diff| ${worstY.toExponential(2)}`);
if (worstF > 1e-9 || worstY > 1e-9) { console.error('JS and Python disagree'); process.exit(1); }
console.log('parity ok');
