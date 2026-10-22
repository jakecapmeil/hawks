"""Noise floor + course-difficulty feature. Pool only (final test untouched)."""
from common import *
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True)
R = (P.y - P.base).values
folds = list(GroupKFold(5).split(P, groups=P.athlete_id))
def cv(feats, name):
    oof = np.zeros(len(P)); t = time.time()
    for tr, te in folds: oof[te] = HGB(**HGB_FAST).fit(P.iloc[tr][feats], R[tr]).predict(P.iloc[te][feats])
    p = P.base.values + oof; m = mae(P.y.values, p)
    log(f'| {name} | {m:.3f}% | {time.time()-t:.0f}s |'); return oof
log('\n## exp6: noise floor and course difficulty (pool, 5-fold by athlete)\n| setting | MAE | time |\n|---|---|---|')
oA = cv(FEATS3, 'v3 features')
oB = cv(FEATS3 + COURSE, 'v3 + course-difficulty features (prior meets, same series)')
has = (P.cb_series_n >= 20).values
log(f'| rows with >=20 prior same-series results ({has.mean()*100:.0f}% of rows): v3 / +course | {mae(P.y.values[has], P.base.values[has]+oA[has]):.3f}% / {mae(P.y.values[has], P.base.values[has]+oB[has]):.3f}% | |')
# variance decomposition of out-of-fold residuals (log-time)
P['res'] = P.y - (P.base + oB)
def icc(df, key, minn):
    g = df.groupby(key).res.agg(['mean', 'count', 'var']).dropna(); g = g[g['count'] >= minn]
    k = len(g); N = g['count'].sum(); n0 = (N - (g['count'] ** 2).sum() / N) / (k - 1)
    grand = (g['mean'] * g['count']).sum() / N
    msb = (g['count'] * (g['mean'] - grand) ** 2).sum() / (k - 1); msw = ((g['count'] - 1) * g['var']).sum() / (N - k)
    return max((msb - msw) / (msb + (n0 - 1) * msw), 0), k, N, msw
log('\n| residual variance explained by... | share | groups | rows |\n|---|---|---|---|')
tot = P.res.var()
for name, key, minn, d in [('meet-day x event (all)', ['meet_id', 'target_m'], 8, P),
                           ('meet-day x event, cross country only', ['meet_id', 'target_m'], 8, P[P.surf_s == 'xc']),
                           ('meet-day x event, track/indoor only', ['meet_id', 'target_m'], 8, P[P.surf_s.isin(['track', 'indoor'])]),
                           ('the athlete (persistent bias)', ['athlete_id'], 3, P)]:
    v, k, N, _ = icc(d, key, minn); log(f'| {name} | {100*v:.1f}% | {k} | {N} |')
log(f'\nresidual sd (log time): {np.sqrt(tot):.3f}')
