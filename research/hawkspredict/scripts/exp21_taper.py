"""Does tapering show up in real marathon results? BMClab 2019 marathon days (as exp20). A model sees ONLY the training before the last 3 weeks (weeks 3-15), predicts the
finish time, and the leftover (actual - predicted) is compared with how deep the last three weeks' taper was: taper = mean km of weeks 0-2 over the mean of weeks 3-8.
Out-of-fold, by athlete. Caveat: a low last three weeks can also mean illness or injury (those runners ran slow for that reason, not because tapering hurts), so the deepest bins mix both.
Usage: exp21_taper.py <scratch dir with bmclab_raw/>"""
import sys, os
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp20_marathon import features, DATES, MARA
from common import boot_ci, mae
S = sys.argv[1]
d = pd.read_parquet(f'{S}/bmclab_raw/run_ww_2019_d.parquet'); d['datetime'] = pd.to_datetime(d.datetime)
race_of = {}
for a, m in d.drop_duplicates('athlete')[['athlete', 'major']].values:
    for tok in str(m).split(','):
        for city, day in DATES.items():
            if tok.strip() == f'{city} 2019': race_of.setdefault(a, []).append((city, pd.Timestamp(day)))
d = d[d.athlete.isin(race_of)].sort_values(['athlete', 'datetime']); rows = []
for a, g in d.groupby('athlete'):
    g = g.set_index('datetime')
    for city, day in race_of[a]:
        w = g.loc[day - pd.Timedelta(days=1): day + pd.Timedelta(days=1)]; w = w[(w.distance >= 40) & (w.distance <= 44.5) & (w.duration > 120) & (w.duration < 420)]
        if len(w) != 1: continue
        r = w.iloc[0]; pre = g.loc[day - pd.Timedelta(days=112): day - pd.Timedelta(days=1)]
        off = ((day - pre.index.normalize()).days).values; km = pre.distance.values; mn = pre.duration.values
        wk = np.zeros(16)
        for di, ki in zip(off, km): wk[(int(di) - 1) // 7] += ki
        earlier = off > 21                                                    # build-only view: nothing from the last three weeks
        f = features(off[earlier] - 21, km[earlier], mn[earlier])             # re-based so the build window is 13 weeks ending 3 weeks out
        if f is None or wk[3:9].mean() < 15: continue
        f.update(athlete=a, race=city, y=float(np.log(r.duration * 60 * (MARA / r.distance) ** 1.06)), taper=float(wk[:3].mean() / wk[3:9].mean()), t_week=float(wk[0] / wk[3:9].mean()),
                 vol=float(wk[3:9].mean())); rows.append(f)
X = pd.DataFrame(rows); print(f'{len(X)} marathon days, {X.athlete.nunique()} athletes (build volume at least 15 km a week)')
FE = ['wk_mean', 'wk_max', 'longest', 'long_n', 'long16_n', 'runs_wk', 'weeks_active', 'pace_med', 'pace_p10', 'pace_long', 'best_riegel', 'n_eff', 'vol']
CFG = dict(loss='absolute_error', max_iter=150, learning_rate=0.06, max_leaf_nodes=8, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
oof = np.zeros(len(X)); f = X.athlete.map(dict(zip(X.athlete.unique(), np.random.default_rng(1).integers(0, 5, X.athlete.nunique())))).values
for k in range(5): oof[f == k] = HGB(**CFG).fit(X.loc[f != k, FE], X.y[f != k]).predict(X.loc[f == k, FE])
X['res'] = X.y - oof
print(f'build-only model out of fold: MAE {mae(X.y.values, oof):.2f}%')
bins = [0, 0.4, 0.55, 0.7, 0.85, 1.0, 1.15, 5]; lab = ['<40%', '40-55%', '55-70%', '70-85%', '85-100%', '100-115%', '115%+']
X['tb'] = pd.cut(X.taper, bins, labels=lab)
print('\nLeftover time (positive = slower than the build-only model expects) by taper depth (mean km of the last 3 weeks / mean km of weeks 3-8):\n| last 3 weeks vs build | races | median leftover | mean leftover (95% CI by athlete) |\n|---|---|---|---|')
rng = np.random.default_rng(0)
for b in lab:
    g = X[X.tb == b]
    if len(g) < 30: continue
    ath = g.groupby('athlete').res.agg(['sum', 'count']); bs = [ath['sum'].values[i].sum() / ath['count'].values[i].sum() for i in (rng.integers(0, len(ath), len(ath)) for _ in range(300))]
    print(f'| {b} | {len(g)} | {100 * np.expm1(g.res.median()):+.2f}% | {100 * np.expm1(g.res.mean()):+.2f}% ({100 * np.expm1(np.percentile(bs, 2.5)):+.2f} to {100 * np.expm1(np.percentile(bs, 97.5)):+.2f}) |')
for lo, hi, name in ((0, 0.4, 'under 40%'), (0.4, 0.85, '40-85%')):
    pass
X['tw'] = pd.cut(X.t_week, [0, 0.25, 0.4, 0.55, 0.7, 0.9, 5], labels=['<25%', '25-40%', '40-55%', '55-70%', '70-90%', '90%+'])
print('\nBy the final week alone (race week km / build mean):\n| race week vs build | races | median leftover |\n|---|---|---|')
for b, g in X.groupby('tw', observed=True):
    if len(g) >= 30: print(f'| {b} | {len(g)} | {100 * np.expm1(g.res.median()):+.2f}% |')
