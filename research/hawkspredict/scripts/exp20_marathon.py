"""HawksPredict-Marathon: a marathon time from the 16 weeks of training before it (what Kailo sells), trained on real data.
BMClab long-distance running dataset (Figshare 16620238, CC BY 4.0), 2019 daily file: one row per athlete-day (km, minutes). Marathon day = the 40-44.5 km day on the race date of a
2019 major the athlete listed (Boston, London, Berlin, Chicago, New York, Tokyo); target = ln(device finish seconds scaled to 42.195 km). Features use only days before the race.
Features are computed from a list of (days before race, km, minutes) so the JavaScript port can reproduce them exactly from the Hawks workouts table.
Evaluation: 15% of athletes held out once (final), 5-fold by athlete on the rest, and train-on-five-majors/test-on-the-sixth. Also exports the model (JSON) and parity cases.
Usage: exp20_marathon.py <scratch dir with bmclab_raw/run_ww_2019_d.parquet> <out dir>"""
import os, sys, json
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.model_selection import GroupKFold
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import boot_ci, mae

S, OUT = (sys.argv[1:3] + ['', ''])[:2]          # importable by other scripts (exp21) for features()
MARA = 42.195
DATES = {'BOSTON': '2019-04-15', 'LONDON': '2019-04-28', 'BERLIN': '2019-09-29', 'CHICAGO': '2019-10-13', 'NEW YORK': '2019-11-03', 'TOKYO': '2019-03-03'}
FEATS = ['wk_mean', 'wk_max', 'wk_last6', 'longest', 'long_n', 'long16_n', 'runs_wk', 'weeks_active', 'pace_med', 'pace_p10', 'pace_long', 'best_riegel', 'n_eff', 'best_recent', 'vol_trend']

def features(days, km, mn):
    """days: days before the race (1..112); km, mn: that day's total distance and minutes. Returns the feature dict or None (fewer than 15 running days)."""
    days, km, mn = map(np.asarray, (days, km, mn))
    run = km >= 1.0
    if run.sum() < 15: return None
    d, k, m = days[run], km[run], mn[run]; pace = m / k                                  # min per km
    wk = np.zeros(16)
    for di, ki in zip(days, km): wk[(int(di) - 1) // 7] += ki                         # week 0 = the 7 days before the race
    eff = (k >= 8) & (k <= 25) & (pace > 2.6) & (pace < 8)
    riegel = m * (MARA / k) ** 1.06                                                   # minutes, Riegel to the marathon
    recent = eff & (d <= 42)
    longd = k >= 16
    return dict(wk_mean=wk.mean(), wk_max=wk.max(), wk_last6=wk[:6].sum() / 6, longest=k.max(), long_n=int((k >= 25).sum()), long16_n=int(longd.sum()),
                runs_wk=len(k) / 16, weeks_active=int((wk > 0).sum()), pace_med=float(np.median(pace)), pace_p10=float(np.quantile(pace, 0.1)),
                pace_long=float(np.median(pace[longd])) if longd.any() else np.nan,
                best_riegel=float(np.log(riegel[eff].min() * 60)) if eff.any() else np.nan, n_eff=int(eff.sum()),
                best_recent=float(np.log(riegel[recent].min() * 60)) if recent.any() else np.nan, vol_trend=float(wk[:6].sum() / 6 / max(wk[6:].sum() / 10, 1.0)))

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    d = pd.read_parquet(f'{S}/bmclab_raw/run_ww_2019_d.parquet'); d['datetime'] = pd.to_datetime(d.datetime)
    race_of = {}
    for a, m in d.drop_duplicates('athlete')[['athlete', 'major']].values:
        for tok in str(m).split(','):
            for city, day in DATES.items():
                if tok.strip() == f'{city} 2019': race_of.setdefault(a, []).append((city, pd.Timestamp(day)))
    d = d[d.athlete.isin(race_of)].sort_values(['athlete', 'datetime']); rows = []; raw = {}
    for a, g in d.groupby('athlete'):
        g = g.set_index('datetime')
        for city, day in race_of[a]:
            w = g.loc[day - pd.Timedelta(days=1): day + pd.Timedelta(days=1)]; w = w[(w.distance >= 40) & (w.distance <= 44.5) & (w.duration > 120) & (w.duration < 420)]
            if len(w) != 1: continue
            r = w.iloc[0]; pre = g.loc[day - pd.Timedelta(days=112): day - pd.Timedelta(days=1)]
            off = ((day - pre.index.normalize()).days).values
            f = features(off, pre.distance.values, pre.duration.values)
            if f is None: continue
            f.update(athlete=a, race=city, y=float(np.log(r.duration * 60 * (MARA / r.distance) ** 1.06)), male=float(r.gender == 'M'),
                     age=['18 - 34', '35 - 54', '55 +'].index(r.age_group) if r.age_group in ('18 - 34', '35 - 54', '55 +') else np.nan)
            rows.append(f); raw[(a, city)] = (off.tolist(), pre.distance.values.tolist(), pre.duration.values.tolist())
    X = pd.DataFrame(rows); print(f'{len(X)} marathon days, {X.athlete.nunique()} athletes; median finish {np.exp(X.y.median()) / 3600:.2f} h', flush=True)
    rng = np.random.default_rng(20261023); ath = np.sort(X.athlete.unique()); hold = set(rng.choice(ath, int(0.15 * len(ath)), replace=False))
    X['hold'] = X.athlete.isin(hold); P = X[~X.hold].reset_index(drop=True); T = X[X.hold].reset_index(drop=True)
    CFG = dict(loss='absolute_error', max_iter=150, learning_rate=0.06, max_leaf_nodes=8, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
    BASE = ['wk_mean', 'wk_max', 'wk_last6', 'longest', 'long_n', 'runs_wk', 'pace_med', 'pace_p10', 'best_riegel', 'n_eff']          # the exp12 set, no sex or age
    SETS = {'exp12 features (no sex/age)': BASE, '+ sex and age': BASE + ['male', 'age'], 'all new features (no sex/age)': FEATS, 'all new features + sex and age': FEATS + ['male', 'age']}
    def cv(feats, D, seed=1):
        oof = np.zeros(len(D)); f = D.athlete.map(dict(zip(D.athlete.unique(), np.random.default_rng(seed).integers(0, 5, D.athlete.nunique())))).values
        for k in range(5): oof[f == k] = HGB(**CFG).fit(D.loc[f != k, feats], D.y[f != k]).predict(D.loc[f == k, feats])
        return oof
    print(f'\n5-fold by athlete on the development athletes ({len(P)} races)\n| features | MAE | 95% CI |\n|---|---|---|', flush=True)
    res = {}
    for nm, fs in SETS.items():
        o = np.mean([cv(fs, P, s) for s in (1, 2, 3)], 0); res[nm] = o; ci = boot_ci(P.y.values, o, None, P.athlete.values); print(f'| {nm} | {mae(P.y.values, o):.2f}% | {ci[0]:.2f}-{ci[1]:.2f} |', flush=True)
    ok = P.best_riegel.notna().values
    print(f'| Riegel from the best 8-25 km day (rows with one, n={ok.sum()}) | {mae(P.y.values[ok], P.best_riegel.values[ok]):.2f}% | |')
    # shipped choice: all new features, no sex/age (the app does not store sex or age)
    fs = FEATS; o = res['all new features (no sex/age)']
    # leave-one-major-out
    print('\nTrain on five majors, test on the sixth (shipped features)\n| held-out | n | MAE | exp12 features |\n|---|---|---|---|')
    for city in sorted(X.race.unique()):
        te = (P.race == city).values
        if te.sum() < 200: continue
        pa = HGB(**CFG).fit(P.loc[~te, fs], P.y[~te]).predict(P.loc[te, fs]); pb = HGB(**CFG).fit(P.loc[~te, BASE], P.y[~te]).predict(P.loc[te, BASE])
        print(f'| {city} | {te.sum()} | {mae(P.y.values[te], pa):.2f}% | {mae(P.y.values[te], pb):.2f}% |')
    # final model on all development athletes; intervals from out-of-fold residuals by group
    m = HGB(**CFG).fit(P[fs], P.y)
    def grp(df): return np.where(df.n_eff.values == 0, 'g0', np.where(df.wk_mean.values < 40, 'g1', np.where(df.wk_mean.values < 70, 'g2', 'g3')))
    gP = grp(P); res_oof = P.y.values - o; tab = {}
    for g in sorted(set(gP)):
        s = gP == g; tab[g] = [float(np.quantile(res_oof[s], 0.1)), float(np.quantile(res_oof[s], 0.9)), int(s.sum())]
    pt = m.predict(T[fs]); gT = grp(T); lo = np.array([pt[i] + tab[gT[i]][0] for i in range(len(T))]); hi = np.array([pt[i] + tab[gT[i]][1] for i in range(len(T))])
    ci = boot_ci(T.y.values, pt, None, T.athlete.values)
    print(f'\nFINAL (held-out athletes, scored once): {mae(T.y.values, pt):.2f}% [{ci[0]:.2f}, {ci[1]:.2f}] on {len(T)} races; 80% interval coverage {100 * np.mean((T.y.values >= lo) & (T.y.values <= hi)):.1f}%, mean half-width {100 * np.mean((np.exp(hi) - np.exp(lo)) / np.exp(T.y.values)) / 2:.1f}%')
    okT = T.best_riegel.notna().values; print(f'  Riegel from the best 8-25 km day on the same rows (n={okT.sum()}): {mae(T.y.values[okT], T.best_riegel.values[okT]):.2f}%; shipped model on those rows {mae(T.y.values[okT], pt[okT]):.2f}%')
    print('  by volume group (weekly km: none-quality/<40/40-70/70+):', {g: f'{mae(T.y.values[gT == g], pt[gT == g]):.2f}% (n={int((gT == g).sum())})' for g in sorted(set(gT))})
    trees = []
    for p in m._predictors:
        nd = p[0].nodes
        trees.append(dict(f=[int(x) if lf == 0 else -1 for x, lf in zip(nd['feature_idx'], nd['is_leaf'])], t=[min(float(x), 1e308) for x in nd['num_threshold']], l=[int(x) for x in nd['left']],
                          r=[int(x) for x in nd['right']], v=[float(x) for x in nd['value']], mgl=[int(x) for x in nd['missing_go_to_left']]))
    art = dict(name='HawksPredict-Marathon', version='v1', feats=fs, init=float(np.asarray(m._baseline_prediction).ravel()[0]), trees=trees, interval=tab,
               trained_on='BMClab long-distance running 2019 (Figshare 16620238, CC BY 4.0): 2019 major marathon days with the 16 weeks of training before them', note='log seconds of the marathon (no baseline)')
    json.dump(art, open(f'{OUT}/marathon_model.json', 'w'), separators=(',', ':')); print(f'exported {os.path.getsize(f"{OUT}/marathon_model.json") / 1024:.0f} KB, {len(trees)} trees')
    # python tree-walk vs sklearn, and JS parity cases (raw day lists in, expected features and log-seconds out)
    def walk(frow):
        s = art['init']
        for t in trees:
            n = 0
            while t['f'][n] >= 0:
                x = frow[t['f'][n]]; n = t['l'][n] if ((np.isnan(x) and t['mgl'][n]) or (not np.isnan(x) and x <= t['t'][n])) else t['r'][n]
            s += t['v'][n]
        return s
    sub = T.sample(200, random_state=0); mx = max(abs(walk(r[fs].values.astype(float)) - m.predict(r[fs].to_frame().T.astype(float))[0]) for _, r in sub.head(60).iterrows())
    print(f'python tree-walk vs sklearn, max abs diff over 60 rows: {mx:.2e}')
    cases = []
    for _, r in sub.iterrows():
        off, km, mn = raw[(r.athlete, r.race)]
        cases.append(dict(days=off, km=km, min=mn, feats={k: (None if np.isnan(r[k]) else float(r[k])) for k in fs}, y=walk(r[fs].values.astype(float))))
    json.dump(cases, open(f'{OUT}/marathon_parity.json', 'w')); print('parity cases written:', len(cases))
