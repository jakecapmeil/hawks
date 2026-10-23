// HawksPredict-Marathon: a marathon time (with an 80% range) from the 16 weeks of running before today.
// Trained on 2019 marathon days from the BMClab long-distance running dataset (CC BY 4.0) paired with each runner's
// training logs; marathonmodel.json holds the trees. The feature code mirrors research/hawkspredict/scripts/exp20_marathon.py
// exactly; scripts/check-marathon.mjs proves the two agree.
//
//   predictMarathon(workouts, '2026-10-23') -> { sec, lo, hi, feats, run_days } | null   (null with fewer than 15 running days)
//   workouts: [{ date: 'YYYY-MM-DD', distance_mi, moving_sec, category }]

import MODEL from './marathonmodel.json' with { type: 'json' };

const MARA = 42.195;
const KM_PER_MI = 1.609344;
export const MARATHON_INFO = { name: MODEL.name, version: MODEL.version };

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
// numpy's default (linear) quantile
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (pos - lo) : s[lo];
};

// days: [{ off (days before the race, 1..112), km, min }] one entry per running day
export function marathonFeatures(days) {
  const run = days.filter((d) => d.km >= 1.0);
  if (run.length < 15) return null;
  const pace = run.map((d) => d.min / d.km);
  const wk = new Array(16).fill(0);
  for (const d of days) wk[Math.floor((d.off - 1) / 7)] += d.km;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const eff = run.map((d, i) => d.km >= 8 && d.km <= 25 && pace[i] > 2.6 && pace[i] < 8);
  const riegel = run.map((d) => d.min * Math.pow(MARA / d.km, 1.06));
  const bestOf = (flags) => {
    let best = Infinity;
    run.forEach((d, i) => { if (flags(d, i) && riegel[i] < best) best = riegel[i]; });
    return best === Infinity ? NaN : Math.log(best * 60);
  };
  const longIdx = run.map((d, i) => (d.km >= 16 ? i : -1)).filter((i) => i >= 0);
  return {
    wk_mean: sum(wk) / 16,
    wk_max: Math.max(...wk),
    wk_last6: sum(wk.slice(0, 6)) / 6,
    longest: Math.max(...run.map((d) => d.km)),
    long_n: run.filter((d) => d.km >= 25).length,
    long16_n: longIdx.length,
    runs_wk: run.length / 16,
    weeks_active: wk.filter((x) => x > 0).length,
    pace_med: median(pace),
    pace_p10: quantile(pace, 0.1),
    pace_long: longIdx.length ? median(longIdx.map((i) => pace[i])) : NaN,
    best_riegel: bestOf((d, i) => eff[i]),
    n_eff: eff.filter(Boolean).length,
    best_recent: bestOf((d, i) => eff[i] && d.off <= 42),
    vol_trend: (sum(wk.slice(0, 6)) / 6) / Math.max(sum(wk.slice(6)) / 10, 1.0),
  };
}

export function marathonLogSeconds(f) {
  let s = MODEL.init;
  for (const t of MODEL.trees) {
    let n = 0;
    while (t.f[n] >= 0) {
      const x = f[MODEL.feats[t.f[n]]];
      n = (Number.isNaN(x) && t.mgl[n]) || (!Number.isNaN(x) && x <= t.t[n]) ? t.l[n] : t.r[n];
    }
    s += t.v[n];
  }
  return s;
}

const dayNumber = (key) => Math.floor(Date.parse(key + 'T12:00:00Z') / 86400000);

export function predictMarathon(workouts, today) {
  const t0 = dayNumber(today);
  const byDay = new Map();
  for (const w of workouts) {
    if (!(w.distance_mi > 0 && w.moving_sec > 0) || w.category === 'crosstrain') continue;
    const off = t0 - dayNumber(w.date);
    if (off < 1 || off > 112) continue;
    const d = byDay.get(off) || { off, km: 0, min: 0 };
    d.km += w.distance_mi * KM_PER_MI;
    d.min += w.moving_sec / 60;
    byDay.set(off, d);
  }
  const f = marathonFeatures([...byDay.values()]);
  if (!f) return null;
  const g = Number.isNaN(f.best_riegel) ? 'g0' : f.wk_mean < 40 ? 'g1' : f.wk_mean < 70 ? 'g2' : 'g3';
  const iv = MODEL.interval[g] || MODEL.interval.g1;
  const mu = marathonLogSeconds(f);
  return { sec: Math.exp(mu), lo: Math.exp(mu + iv[0]), hi: Math.exp(mu + iv[1]), feats: f, run_days: [...byDay.values()].filter((d) => d.km >= 1).length };
}
