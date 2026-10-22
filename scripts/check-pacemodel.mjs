// Proves the JavaScript Hawk Pace Lite matches the Python it was trained in.
// Usage: node scripts/check-pacemodel.mjs path/to/pace_lite_parity.json
// (the parity file is written by research/lite_train.py: raw results in,
// expected log-seconds out).
import { readFileSync } from 'node:fs';
import { liteFeatures, residual } from '../src/pacemodel.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/check-pacemodel.mjs <pace_lite_parity.json>'); process.exit(2); }
const cases = JSON.parse(readFileSync(file, 'utf8'));
let worst = 0;
let worstBase = 0;
for (const c of cases) {
  const f = liteFeatures(c.results, c.target);
  worstBase = Math.max(worstBase, Math.abs(f.base - c.base));
  worst = Math.max(worst, Math.abs(residual(f) - c.resid));
}
console.log(`${cases.length} cases | max |base diff| ${worstBase.toExponential(2)} | max |residual diff| ${worst.toExponential(2)}`);
if (worst > 1e-9 || worstBase > 1e-9) { console.error('JS and Python disagree'); process.exit(1); }
console.log('parity ok');
