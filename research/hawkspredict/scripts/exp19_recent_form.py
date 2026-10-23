"""Recent-form adjustment: how far should an old best effort be moved by (a) how old it is, (b) what the last four weeks of running say about it, (c) how much more or less
the athlete runs now than when they set it?   Built on the exp16 table (hard 5K/10K efforts vs the runner's earlier best; r = ln(actual / baseline)).
Candidate adjustments are linear least-absolute-deviation fits on a few features, scored leave-runners-out (5 folds, 5 repeats) against a constant offset.
Only the slope part would ever be applied (races are maximum efforts, these targets are not, so the intercept is not transferable): each model is also scored with the intercept re-fitted.
Usage: exp19_recent_form.py <exp16 table pkl>"""
import sys
import numpy as np, pandas as pd
from sklearn.linear_model import QuantileRegressor
from sklearn.model_selection import GroupKFold

X = pd.read_pickle(sys.argv[1]).dropna(subset=['recent_vs_best', 'd_vol']).reset_index(drop=True)
X['f_age'] = np.log1p(X.days_gap / 30)                       # age of the earlier best
X['rec'] = X.recent_vs_best.clip(-0.15, 0.30)                # last 4 weeks vs the earlier best (ln ratio at 5K-equivalent; > 0 = recent running slower)
X['rec_pos'] = X.rec.clip(lower=0); X['rec_neg'] = X.rec.clip(upper=0)
X['f_vol'] = X.d_vol.clip(-1.0, 1.0)
y = X.r.values; g = X.user.values
err = lambda r: 100 * np.abs(np.expm1(r))
MODELS = {'constant offset': [], 'PR age only': ['f_age'], 'last 4 weeks only': ['rec'], 'last 4 weeks, asymmetric': ['rec_pos', 'rec_neg'],
          'age + last 4 weeks': ['f_age', 'rec'], 'age + last 4 weeks, asymmetric': ['f_age', 'rec_pos', 'rec_neg'], 'age + last 4 weeks + volume change': ['f_age', 'rec', 'f_vol']}
def fit_pred(tr, te, cols):
    if not cols: return np.full(len(te), np.median(y[tr]))
    m = QuantileRegressor(quantile=0.5, alpha=0.0, solver='highs').fit(X.loc[tr, cols], y[tr]); return m.predict(X.loc[te, cols])
rng = np.random.default_rng(0); R = 5
oof = {k: np.zeros((R, len(X))) for k in MODELS}
users = X.user.unique()
for rep in range(R):
    perm = dict(zip(users, rng.permutation(len(users)) % 5)); fold = X.user.map(perm).values
    for k in range(5):
        tr, te = np.where(fold != k)[0], np.where(fold == k)[0]
        for name, cols in MODELS.items(): oof[name][rep, te] = fit_pred(tr, te, cols)
print(f'{len(X)} efforts from {X.user.nunique()} runners (5K {int((X.dist == 5).sum())}, 10K {int((X.dist == 10).sum())}; Strava {int(X.user.str.startswith("s").sum())} / FitRec {int(X.user.str.startswith("f").sum())} efforts)')
base = oof['constant offset']
def cluster(d):
    df = pd.DataFrame({'u': g, 'd': d}).groupby('u').d.agg(['sum', 'count']); bs = []
    for _ in range(500):
        i = rng.integers(0, len(df), len(df)); bs.append(df['sum'].values[i].sum() / df['count'].values[i].sum())
    return np.percentile(bs, [2.5, 97.5])
print('\n| adjustment | MAE | change vs constant offset (95% CI) | Strava runners | FitRec runners | 5K | 10K |\n|---|---|---|---|---|---|---|')
for name in MODELS:
    e = np.mean([err(y - oof[name][r]) for r in range(R)], 0); eb = np.mean([err(y - base[r]) for r in range(R)], 0); d = e - eb
    sub = lambda m: f'{(e[m].mean() - eb[m].mean()):+.2f}'
    ci = cluster(d) if name != 'constant offset' else (0, 0)
    print(f'| {name} | {e.mean():.2f}% | {d.mean():+.2f} ({ci[0]:+.2f} to {ci[1]:+.2f}) | {sub(X.user.str.startswith("s").values)} | {sub(X.user.str.startswith("f").values)} | {sub((X.dist == 5).values)} | {sub((X.dist == 10).values)} |')
# calibration: bin athletes by the model's predicted r and look at the realised r
best = 'age + last 4 weeks'; p = oof[best].mean(0)
q = pd.qcut(p, 5, labels=False, duplicates='drop')
print(f'\nCalibration of "{best}" (out-of-fold): realised r by predicted-r quintile\n| quintile | predicted r | realised median r | realised mean r | n |\n|---|---|---|---|---|')
for i in sorted(set(q)):
    m = q == i; print(f'| {i + 1} | {np.median(p[m]):+.3f} | {np.median(y[m]):+.3f} | {y[m].mean():+.3f} | {m.sum()} |')
# the full-sample fit, for the record
for name in ('age + last 4 weeks', 'age + last 4 weeks, asymmetric', 'age + last 4 weeks + volume change'):
    cols = MODELS[name]; m = QuantileRegressor(quantile=0.5, alpha=0.0, solver='highs').fit(X[cols], y)
    print(f'\nfit on all efforts, "{name}": intercept {m.intercept_:+.4f}; ' + ', '.join(f'{c} {v:+.4f}' for c, v in zip(cols, m.coef_)))
# piecewise view of the recent-evidence effect
X['recbin'] = pd.cut(X.recent_vs_best, [-1, -0.02, 0.02, 0.06, 0.10, 1], labels=['recent faster than the best', 'about equal (+-2%)', '2-6% slower', '6-10% slower', '10%+ slower'])
print('\nRealised r by what the last 4 weeks looked like (median, 25th-75th percentile):\n| last 4 weeks vs earlier best | n | median r | IQR |\n|---|---|---|---|')
for b, gg in X.groupby('recbin', observed=True): print(f'| {b} | {len(gg)} | {gg.r.median():+.3f} | {gg.r.quantile(.25):+.3f} to {gg.r.quantile(.75):+.3f} |')
X['agebin'] = pd.cut(X.days_gap, [0, 30, 60, 90, 120, 181], labels=['<=30 d', '31-60', '61-90', '91-120', '121-180'])
print('\n| age of the earlier best | n | median r | IQR |\n|---|---|---|---|')
for b, gg in X.groupby('agebin', observed=True): print(f'| {b} | {len(gg)} | {gg.r.median():+.3f} | {gg.r.quantile(.25):+.3f} to {gg.r.quantile(.75):+.3f} |')
X.to_pickle(sys.argv[1].replace('.pkl', '_form.pkl'))
