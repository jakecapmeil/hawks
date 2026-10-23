"""Does a heart-rate fitness trend predict how a runner's later hard effort compares with their earlier best effort? Real data, many runners.
Input: the per-run table from fitrec_summarize.py (FitRec / Endomondo, academic use only; the table is never committed).
Targets: a hard standard-distance run (5K or 10K, pace 10%+ faster than the runner's recent median, 85%+ of max HR).
Baseline: the best Riegel-equivalent earlier effort (3-22 km, 14-180 days before). Heart-rate trend: log change in the runner's
heart-rate fitness (the same formula Fitness States and the race card use) between the 8 weeks before the baseline and before the target.
Users are split in halves; the offset is learned on one half and scored on the other, so nothing is fitted on the scored runners.
Usage: fitrec_hr_check.py <runs.csv>"""
import sys
import numpy as np
import pandas as pd

R = pd.read_csv(sys.argv[1]).sort_values(['user', 't0']).reset_index(drop=True)
DAY = 86400
R['pace'] = R.dur_s / R.dist_km                                   # sec per km
R = R[(R.pace > 150) & (R.pace < 600) & (R.avg_hr > 80)].copy()
R['hrmax'] = R.groupby('user').max_hr.transform(lambda s: min(220, s.quantile(0.98)))
R['grade'] = (R.gain_m / R.dist_km).fillna(0)
vo2 = lambda v: -4.6 + 0.182258 * v + 0.000104 * v * v
phr = R.avg_hr / R.hrmax
valid = (R.dist_km >= 4) & (R.dur_s >= 1200) & phr.between(0.65, 0.93) & (R.grade < 20) & (R.hrmax >= 175)
v = R.dist_km * 1000 / (R.dur_s / 60)
R['hrfit'] = np.where(valid, np.log(vo2(v) / ((phr - 0.37) / 0.64)), np.nan)
print(f'runs {len(R)}, users {R.user.nunique()}, runs usable for heart-rate fitness {valid.sum()}')

rows = []
for u, g in R.groupby('user'):
    if len(g) < 40: continue
    t = g.t0.values; d = g.dist_km.values; p = g.pace.values; hf = g.hrfit.values; ph = (g.avg_hr / g.hrmax).values; gr = g.grade.values; dur = g.dur_s.values
    def fit_at(T):
        m = (t >= T - 56 * DAY) & (t < T) & ~np.isnan(hf)
        return (np.median(hf[m]), m.sum()) if m.sum() >= 4 else (np.nan, 0)
    for j in range(20, len(g)):
        if not ((4.85 <= d[j] <= 5.15) or (9.7 <= d[j] <= 10.3)) or ph[j] < 0.85 or gr[j] >= 20: continue
        if p[j] > 0.90 * np.median(p[j - 20:j]): continue
        e = (t < t[j] - 14 * DAY) & (t >= t[j] - 180 * DAY) & (d >= 3) & (d <= 22) & (gr < 20)
        if e.sum() < 3: continue
        idx = np.where(e)[0]
        eq = dur[idx] * (d[j] / d[idx]) ** 1.06                      # earlier efforts, Riegel-scaled to the target distance, seconds
        b = idx[np.argmin(eq)]
        now, n1 = fit_at(t[j]); then, n0 = fit_at(t[b])
        if np.isnan(now) or np.isnan(then): continue
        rows.append(dict(user=u, r=np.log(dur[j] / eq.min()), delta=now - then, days=(t[j] - t[b]) / DAY))
X = pd.DataFrame(rows)
print(f'targets: {len(X)} from {X.user.nunique()} runners')
if len(X) < 50: sys.exit('too few targets')

def err(r, adj): return 100 * np.abs(np.expm1(r + adj))              # r = log(actual / baseline); adjusted prediction = baseline * exp(c - adj)
users = X.user.unique(); rng = np.random.default_rng(0)
half = dict(zip(users, rng.integers(0, 2, len(users)))); X['h'] = X.user.map(half)
print('| shrink | MAE with offset only | MAE with HR trend | change | 95% CI |\n|---|---|---|---|---|')
for s in (0.0, 0.25, 0.5, 1.0):
    a_err = np.zeros(len(X)); b_err = np.zeros(len(X))
    for k in (0, 1):
        tr, te = X.h != k, X.h == k
        c = X.r[tr].median(); X.loc[te, 'rc'] = X.r[te] - c
        a_err[te.values] = err(X.r[te].values - c, 0.0)
        b_err[te.values] = err(X.r[te].values - c, -s * X.delta[te].clip(-0.12, 0.12).values)  # fitter now (delta>0) -> predicted faster
    diff = pd.DataFrame({'u': X.user, 'd': b_err - a_err}).groupby('u').d.agg(['sum', 'count'])
    boots = [(lambda i: diff['sum'].values[i].sum() / diff['count'].values[i].sum())(rng.integers(0, len(diff), len(diff))) for _ in range(500)]
    print(f'| {s:.2f} | {a_err.mean():.2f}% | {b_err.mean():.2f}% | {b_err.mean() - a_err.mean():+.2f} | {np.percentile(boots, 2.5):+.2f} to {np.percentile(boots, 97.5):+.2f} |')
xs = X.delta.clip(-0.12, 0.12) - X.delta.clip(-0.12, 0.12).mean(); ys = X.r - X.r.mean()
slope = (xs * ys).sum() / (xs ** 2).sum()
sl = []
g = X.assign(x=xs, y=ys).groupby('user')[['x', 'y']].apply(lambda d: pd.Series({'xy': (d.x * d.y).sum(), 'xx': (d.x ** 2).sum()}))
for _ in range(500):
    i = rng.integers(0, len(g), len(g)); sl.append(g.xy.values[i].sum() / g.xx.values[i].sum())
print(f'slope of log(actual/baseline) on the heart-rate fitness change: {slope:+.2f} (95% CI {np.percentile(sl, 2.5):+.2f} to {np.percentile(sl, 97.5):+.2f}); the correction assumes about -{0.25:.2f} to -1')
print(f'correlation {np.corrcoef(X.delta.clip(-0.12, 0.12), X.r)[0, 1]:+.3f}; median gap between baseline and target {X.days.median():.0f} days')
