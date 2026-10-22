// HawksPredict-Lite: a small tree model that predicts a race time (with an 80%
// range) from an athlete's earlier results. Trained on NRCD collegiate results
// (CC-BY-4.0); pacemodel.json holds the trees. Features use only distance, time
// and surface, never dates, so undated PRs work. The feature code mirrors
// research/hawkspredict/scripts/lite.py exactly; scripts/check-pacemodel.mjs proves the two agree.
//
//   predictRace([{ m: 4023.4, sec: 875, surf: 'xc' }, ...], { m: 5000, surf: 'xc', male: 1 })
//     -> { sec, lo, hi, base, buckets }   (null when there is nothing to go on)

import MODEL from './pacemodel.json' with { type: 'json' };

const K = 1.06;
const REFS = [400, 800, 1500, 3000, 5000, 6000, 8000, 21097.5];
const LREFS = REFS.map(Math.log);
const SURF = { xc: 0, track: 1, indoor: 2, road: 3 };

const bucketOf = (m) => {
  let best = 0;
  for (let i = 1; i < REFS.length; i++) if (Math.abs(LREFS[i] - Math.log(m)) < Math.abs(LREFS[best] - Math.log(m))) best = i;
  return best;
};

// results: [{ m: meters, sec, surf }]  target: { m, surf, male }
export function liteFeatures(results, target) {
  const f = {};
  for (const k of MODEL.feats) f[k] = NaN;
  const lt = Math.log(target.m);
  f.log_d = lt;
  f.surf = SURF[target.surf] ?? 0;
  f.male = target.male ? 1 : 0;
  f.n_results = results.length;
  if (!results.length) return f;
  const bk = results.map((r) => bucketOf(r.m));
  const buckets = [...new Set(bk)].sort((a, b) => a - b);
  const preds = [];
  const ws = [];
  for (const b of buckets) {
    const ref = REFS[b];
    let adj = Infinity;
    results.forEach((r, i) => { if (bk[i] === b) adj = Math.min(adj, r.sec * Math.pow(ref / r.m, K)); });
    const p = Math.log(adj * Math.pow(target.m / ref, K));
    f['p' + Math.trunc(ref)] = p;
    preds.push(p);
    ws.push(1 / (0.15 + Math.abs(Math.log(target.m / ref))));
  }
  let sw = 0;
  let sp = 0;
  let near = 0;
  preds.forEach((p, i) => { sw += ws[i]; sp += p * ws[i]; if (ws[i] > ws[near]) near = i; });
  f.base = sp / sw;
  f.base_near = preds[near];
  f.base_best = Math.min(...preds);
  // each bucket's fastest raw result gives the athlete's own endurance slope
  const xs = [];
  const ys = [];
  for (const b of buckets) {
    let j = -1;
    results.forEach((r, i) => { if (bk[i] === b && (j < 0 || r.sec < results[j].sec)) j = i; });
    xs.push(Math.log(results[j].m));
    ys.push(Math.log(results[j].sec));
  }
  f.n_buckets = xs.length;
  if (xs.length >= 2) {
    const span = Math.max(...xs) - Math.min(...xs);
    f.span = span;
    if (span >= 0.4) {
      const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
      const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      xs.forEach((x, i) => { sxy += (x - xm) * (ys[i] - ym); sxx += (x - xm) * (x - xm); });
      const k = Math.min(Math.max(sxy / sxx, 0.95), 1.25);
      f.k_ind = k;
      let i = 0;
      xs.forEach((x, n) => { if (Math.abs(x - lt) < Math.abs(xs[i] - lt)) i = n; });
      f.base_slope = ys[i] + k * (lt - xs[i]);
    }
  }
  let ns = 0;
  let bs = Infinity;
  for (const r of results) {
    if (r.surf !== target.surf) continue;
    ns++;
    bs = Math.min(bs, Math.log(r.sec) + K * (lt - Math.log(r.m)));
  }
  f.n_samesurf = ns;
  if (ns) f.best_samesurf = bs;
  return f;
}

function walk(tree, x) {
  let n = 0;
  while (tree.f[n] >= 0) {
    const v = x[tree.f[n]];
    const left = Number.isNaN(v) ? tree.mgl[n] === 1 : v <= tree.t[n];
    n = left ? tree.l[n] : tree.r[n];
  }
  return tree.v[n];
}

// Predicted log-seconds minus the baseline (the model's correction)
export function residual(f) {
  const x = MODEL.feats.map((k) => f[k]);
  let s = MODEL.init;
  for (const t of MODEL.trees) s += walk(t, x);
  return s;
}

const distGroup = (m) => (m <= 1700 ? 0 : m <= 4100 ? 1 : m <= 7000 ? 2 : 3);

export function predictRace(results, target) {
  const clean = (results || []).filter((r) => r && r.m > 0 && r.sec > 0);
  const f = liteFeatures(clean, target);
  if (!Number.isFinite(f.base)) return null;
  const logSec = f.base + residual(f);
  const key = `${Math.min(f.n_buckets || 0, 3)}|${distGroup(target.m)}`;
  const [q10, q90] = MODEL.interval[key] || MODEL.interval['1|0'];
  return { sec: Math.exp(logSec), lo: Math.exp(logSec + q10), hi: Math.exp(logSec + q90), base: Math.exp(f.base), buckets: f.n_buckets };
}

export const PACE_MODEL_INFO = { name: MODEL.name, version: MODEL.version, params: MODEL.params, trainedOn: MODEL.trained_on };

// The roster has no sex field: average the male and female predictions and keep the wider range.
export function predictRaceAny(results, target) {
  const a = predictRace(results, { ...target, male: 0 });
  const b = predictRace(results, { ...target, male: 1 });
  if (!a || !b) return null;
  return { sec: Math.sqrt(a.sec * b.sec), lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), buckets: a.buckets };
}
