"""HawksPredict-Research: the best model we can make. Train on the pool, calibrate intervals on held-out pool athletes,
then score the frozen final test ONCE."""
from common import *
import pickle
from catboost import CatBoostRegressor
from baselines import all_baselines
from build3 import extra_feats
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); FE = FEATS3 + COURSE
E7 = pickle.load(open(f'{S}/exp7.pkl', 'rb')); ch = E7['chosen']; oofs = E7['oofs']
P0 = X[X.pool].reset_index(drop=True); T = X[X.final_test].reset_index(drop=True)
# choose the finalist on the dev evaluation athletes (exp7 out-of-fold predictions), never on the final test
rng = np.random.default_rng(1); ath = np.sort(P0.athlete_id.unique()); rng.shuffle(ath); T_ath = set(ath[: int(0.3 * len(ath))])
En = np.where(~P0.athlete_id.isin(T_ath).values)[0]; yE = P0.y.values[En]
cands = {'HGB': oofs['HGB'], 'CatBoost': oofs['CatBoost'], 'Blend HGB+CatBoost': 0.5 * oofs['HGB'] + 0.5 * oofs['CatBoost']}
dev = {k: mae(yE, v) for k, v in cands.items()}
pick = min(dev, key=dev.get)
log('\n## HawksPredict-Research v1: final model\n\ndev evaluation athletes: ' + ', '.join(f'{k} {v:.3f}%' for k, v in dev.items()) + f' -> finalist: **{pick}**')

# calibration athletes (15% of pool) are held out of training and used only to set the interval width
rng = np.random.default_rng(7); ath = np.sort(P0.athlete_id.unique()); rng.shuffle(ath); cal = set(ath[: int(0.15 * len(ath))])
cm = P0.athlete_id.isin(cal).values; Ptr = P0[~cm].reset_index(drop=True); Pcal = P0[cm].reset_index(drop=True)
Rtr = (Ptr.y - Ptr.base).values

def fit_point(kind):
    if kind in ('HGB', 'Blend HGB+CatBoost'):
        c = ch['HGB']; h = HGB(loss='absolute_error', early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0, **c).fit(Ptr[FE], Rtr)
    if kind in ('CatBoost', 'Blend HGB+CatBoost'):
        cb = CatBoostRegressor(loss_function='MAE', verbose=0, thread_count=os.cpu_count(), random_seed=0, **ch['CatBoost']).fit(Ptr[FE], Rtr)
    return {'HGB': lambda D: h.predict(D[FE]), 'CatBoost': lambda D: cb.predict(D[FE]),
            'Blend HGB+CatBoost': lambda D: 0.5 * h.predict(D[FE]) + 0.5 * cb.predict(D[FE])}[kind], (h if kind != 'CatBoost' else None), (cb if kind != 'HGB' else None)
predict, hgb_m, cat_m = fit_point(pick)

# interval models: quantile trees with the tuned HGB shape, calibrated by conformalised quantile regression on the calibration athletes
qkw = dict(ch['HGB']); qkw.pop('max_iter', None); qkw.update(max_iter=400)
lo_m = HGB(loss='quantile', quantile=0.1, random_state=0, **qkw).fit(Ptr[FE], Rtr); hi_m = HGB(loss='quantile', quantile=0.9, random_state=0, **qkw).fit(Ptr[FE], Rtr)
yc = Pcal.y.values; lo = Pcal.base.values + lo_m.predict(Pcal[FE]); hi = Pcal.base.values + hi_m.predict(Pcal[FE])
adj = float(np.quantile(np.maximum(lo - yc, yc - hi), 0.8 * (1 + 1 / len(yc))))
log(f'interval calibration: raw coverage on calibration athletes {100*np.mean((yc>=lo)&(yc<=hi)):.1f}%, conformal adjustment {100*adj:+.2f}% of log-time')

# ---------------- FINAL TEST (touched once) ----------------
yT = T.y.values; aT = T.athlete_id.values; pT = T.base.values + predict(T)
loT = T.base.values + lo_m.predict(T[FE]) - adj; hiT = T.base.values + hi_m.predict(T[FE]) + adj
B = all_baselines(T, P0)
ref = B['Riegel (nearest result)'].values
ci = boot_ci(yT, pT, None, aT)
log(f'\n### FINAL TEST: athlete-disjoint, last season ({len(T)} races, {T.athlete_id.nunique()} runners; touched once)\n')
log('| model | MAE | 95% CI | paired diff vs nearest-result Riegel |\n|---|---|---|---|')
log(f'| **HawksPredict-Research ({pick})** | **{mae(yT, pT):.3f}%** | {ci[0]:.2f}-{ci[1]:.2f} | {boot_ci(yT, pT, ref, aT)[0]:+.2f} to {boot_ci(yT, pT, ref, aT)[1]:+.2f} |')
for col in B.columns:
    p = B[col].values; ok = np.isfinite(p)
    if ok.mean() < 0.5: log(f'| {col} | defined on only {ok.mean()*100:.0f}% of rows | | |'); continue
    pp = np.where(ok, p, ref); c2 = boot_ci(yT, pp, None, aT); d = boot_ci(yT, pp, ref, aT)
    log(f'| {col} | {mae(yT, pp):.3f}% | {c2[0]:.2f}-{c2[1]:.2f} | {d[0]:+.2f} to {d[1]:+.2f} |')
cam = np.where(np.isfinite(B['Cameron'].values), B['Cameron'].values, ref); d = boot_ci(yT, pT, cam, aT)
log(f'\nResearch model vs Cameron (best published formula here), paired: {d[0]:+.2f} to {d[1]:+.2f} MAE points')
log(f'bias (mean signed error): {100*np.mean(np.expm1(pT-yT)):+.2f}%;  median abs error {100*np.median(rel(yT, pT)):.2f}%')
log(f'80% interval coverage: {100*np.mean((yT>=loT)&(yT<=hiT)):.1f}%, mean half-width {100*np.mean((np.exp(hiT)-np.exp(loT))/np.exp(yT))/2:.1f}% of time')
log('\n| slice | races | research MAE | Riegel MAE | 80% coverage |\n|---|---|---|---|---|')
def sl(name, mask):
    if mask.sum() < 30: return
    log(f'| {name} | {int(mask.sum())} | {mae(yT[mask], pT[mask]):.2f}% | {mae(yT[mask], ref[mask]):.2f}% | {100*np.mean((yT[mask]>=loT[mask])&(yT[mask]<=hiT[mask])):.0f}% |')
for nm, mk in [('cross country', (T.surf_s == 'xc').values), ('outdoor track', (T.surf_s == 'track').values), ('indoor track', (T.surf_s == 'indoor').values),
               ('target <= 1700 m', (T.target_m <= 1700).values), ('1700-4100 m', ((T.target_m > 1700) & (T.target_m <= 4100)).values),
               ('4100-7000 m', ((T.target_m > 4100) & (T.target_m <= 7000)).values), ('> 7000 m', (T.target_m > 7000).values),
               ('1 distance in history', (T.n_buckets == 1).values), ('2 distances', (T.n_buckets == 2).values), ('3+ distances', (T.n_buckets >= 3).values),
               ('women', (T.male == 0).values), ('men', (T.male == 1).values)]: sl(nm, mk)

# the lite model on the very same races
L = pd.read_pickle(f'{S}/lite730.pkl')
# ---------------- high-school pairs (dev set) ----------------
D = pd.Timestamp; M.WINDOW = 730
d = pd.read_csv(f'{S}/kaggle_raw/running-times-data-for-high-school-students/Running - Sheet1.csv'); d.columns = ['lab','t1','t2','a','v','r','c','av','mi','df','x']
d['t1'] = pd.to_numeric(d.t1, errors='coerce'); d['t2'] = pd.to_numeric(d.t2, errors='coerce'); d = d.dropna(subset=['t1', 't2'])
rows = []
for t1 in d.t1:
    h = pd.DataFrame([(D('2026-01-01'), 'track', 1609.34, t1)], columns=['date', 'surf', 'm', 'sec'])
    f = M.feats_for(h, 3200, 'track', 1, np.nan, np.nan, D('2026-01-20')); f.update(extra_feats(h, 3200, 'track', D('2026-01-20'), D('2026-01-01')))
    f['elev_km'] = np.nan
    for k in COURSE: f[k] = np.nan
    rows.append(f)
H = pd.DataFrame(rows); ph = np.exp(H.base.values + predict(H)); lo_h = np.exp(H.base.values + lo_m.predict(H[FE]) - adj); hi_h = np.exp(H.base.values + hi_m.predict(H[FE]) + adj)
log(f'\nhigh-school 1600->3200 pairs (dev set, n={len(d)}): research {100*np.mean(np.abs(ph/d.t2.values-1)):.2f}%, Riegel {100*np.mean(np.abs(np.exp(H.base.values)/d.t2.values-1)):.2f}%, '
    f'80% coverage {100*np.mean((d.t2.values>=lo_h)&(d.t2.values<=hi_h)):.0f}%')
pickle.dump(dict(pick=pick, hgb=hgb_m, cat=cat_m, lo=lo_m, hi=hi_m, adj=adj, feats=FE), open(f'{S}/hawks_predict_research.pkl', 'wb'))
log('saved hawks_predict_research.pkl')
