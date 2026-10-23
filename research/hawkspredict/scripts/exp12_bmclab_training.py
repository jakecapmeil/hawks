"""Does training volume/intensity help predict a race time? Real training logs -> real marathon day.
BMClab long-distance running dataset (Figshare 16620238, CC BY 4.0): one row per athlete-day for 2019, 36k athletes, with the
major marathons each athlete ran. The marathon day is found as the activity of 40-44.5 km on the race date, so the target is a
real finish time (device time, not official). Features come from the 16 weeks before. 5-fold CV by athlete.
Compared: median time, Riegel from the best 8-25 km effort, training volume only, and everything together.
Usage: exp12_bmclab_training.py <scratch dir containing bmclab_raw/>"""
from common import *
S = sys.argv[1]; set_log(S)
DATES = {'BOSTON': '2019-04-15', 'LONDON': '2019-04-28', 'BERLIN': '2019-09-29', 'CHICAGO': '2019-10-13', 'NEW YORK': '2019-11-03', 'TOKYO': '2019-03-03'}
MARA = 42.195
d = pd.read_parquet(f'{S}/bmclab_raw/run_ww_2019_d.parquet')
d['datetime'] = pd.to_datetime(d.datetime)
print(d.major.str.split(',').explode().str.strip().str.replace(r' \d{4}$', '', regex=True).value_counts().head(12).to_dict())
rows = []
race_of = {}
for a, m in d.drop_duplicates('athlete')[['athlete', 'major']].values:
    for tok in str(m).split(','):
        tok = tok.strip()
        for city, day in DATES.items():
            if tok == f'{city} 2019': race_of.setdefault(a, []).append((city, pd.Timestamp(day)))
log(f'\n## exp12: BMClab training logs -> marathon day (2019)\nathletes listing a 2019 major: {len(race_of)}')
d = d[d.athlete.isin(race_of)].sort_values(['athlete', 'datetime'])
for a, g in d.groupby('athlete'):
    g = g.set_index('datetime')
    for city, day in race_of[a]:
        w = g.loc[day - pd.Timedelta(days=1): day + pd.Timedelta(days=1)]
        w = w[(w.distance >= 40) & (w.distance <= 44.5) & (w.duration > 120) & (w.duration < 420)]
        if len(w) != 1: continue
        r = w.iloc[0]
        pre = g.loc[day - pd.Timedelta(days=112): day - pd.Timedelta(days=1)]
        runs = pre[pre.distance >= 1.0]
        if len(runs) < 15: continue
        pace = runs.duration / runs.distance                                  # min per km
        wk = pre.distance.resample('7D').sum()
        eff = runs[(runs.distance >= 8) & (runs.distance <= 25) & (pace > 2.6) & (pace < 8)]
        best = (eff.duration * (MARA / eff.distance) ** 1.06).min() if len(eff) else np.nan  # Riegel to marathon, min
        last6 = pre.loc[day - pd.Timedelta(days=42):]
        rows.append(dict(athlete=a, race=city, y=np.log(r.duration * 60 * (MARA / r.distance) ** 1.06), male=float(r.gender == 'M'),
                         age=['18 - 34', '35 - 54', '55 +'].index(r.age_group) if r.age_group in ('18 - 34', '35 - 54', '55 +') else np.nan,
                         wk_mean=wk.mean(), wk_max=wk.max(), wk_last6=last6.distance.sum() / 6, longest=runs.distance.max(),
                         long_n=(runs.distance >= 25).sum(), runs_wk=len(runs) / 16, pace_med=pace.median(), pace_p10=pace.quantile(0.1),
                         best_riegel=np.log(best * 60) if best == best else np.nan, n_eff=len(eff)))
X = pd.DataFrame(rows)
log(f'marathon days found with 15+ runs in the prior 16 weeks: {len(X)} ({X.athlete.nunique()} athletes); median finish {np.exp(X.y.median()) / 3600:.2f} h')
FE_TRAIN = ['male', 'age', 'wk_mean', 'wk_max', 'wk_last6', 'longest', 'long_n', 'runs_wk', 'pace_med', 'pace_p10']
FE_ALL = FE_TRAIN + ['best_riegel', 'n_eff']
def cv(feats, seed=1):
    ath = X.athlete.unique(); rng = np.random.default_rng(seed); fold = dict(zip(ath, rng.integers(0, 5, len(ath)))); f = X.athlete.map(fold).values
    oof = np.zeros(len(X))
    for k in range(5):
        tr, te = f != k, f == k
        oof[te] = HGB(loss='absolute_error', max_iter=200, learning_rate=0.06, max_leaf_nodes=8, min_samples_leaf=40, l2_regularization=1.0, random_state=0).fit(X.loc[tr, feats], X.y[tr]).predict(X.loc[te, feats])
    return oof
y = X.y.values; med = np.full(len(X), np.median(y))
ok = X.best_riegel.notna().values
log('| predictor | n | error (MAE %) | 95% CI |\n|---|---|---|---|')
def row(name, p, m=None):
    m = np.ones(len(y), bool) if m is None else m
    ci = boot_ci(y[m], p[m], None, X.athlete.values[m]); log(f'| {name} | {m.sum()} | {mae(y[m], p[m]):.2f} | {ci[0]:.2f} to {ci[1]:.2f} |')
row('median time', med)
row('Riegel from best 8-25 km effort (rows with one)', X.best_riegel.values, ok)
row('median time (same rows)', med, ok)
for name, fs in [('training volume and pace only', FE_TRAIN), ('training + best-effort Riegel', FE_ALL)]:
    p = np.mean([cv(fs, s) for s in (1, 2, 3)], 0); row(name, p)
    if name.startswith('training +'): row(name + ' (rows with a best effort)', p, ok)
a = np.mean([cv(FE_TRAIN + ['best_riegel'], s) for s in (1, 2, 3)], 0)
b = np.mean([cv(['male', 'age', 'best_riegel'], s) for s in (1, 2, 3)], 0)
ci = boot_ci(y, a, b, X.athlete.values); log(f'\ntraining features added to best-effort + sex/age: {mae(y, a) - mae(y, b):+.2f} points (95% CI {ci[0]:+.2f} to {ci[1]:+.2f})')
