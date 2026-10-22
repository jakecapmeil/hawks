"""Use The Power of 10 (266k UK athletes, lifetime bests) as a prior for HawksPredict-Research.
A rank-3 low-rank model of log time by event is fitted on Power of 10 only (disjoint from NRCD athletes). For each NRCD row the
athlete's per-distance projections are read as bests at the 8 reference events, the latent vector is solved by ridge, and the
model's prediction for the target distance becomes two new features. Compared by 5-fold CV by athlete on the dev pool, on three
different athlete splits, against the same features without it. The frozen test is not touched."""
from common import *
S = sys.argv[1]; set_log(S)
K = 1.06
PO = {'400': 400, '800': 800, '1500': 1500, '3000': 3000, '5000': 5000, '5M': 8046.7, '10000': 10000, 'HM': 21097.5}
NAMES = list(PO); DIST = np.array([PO[k] for k in NAMES])
D = pd.read_csv(f'{S}/po10_raw/ex/unbiased_clean.csv')[NAMES].astype(float)
D = D.where((D > 0) & (D < 1e5))
for k, m in PO.items(): D.loc[(m / D[k] > 10.5) | (m / D[k] < 2.0), k] = np.nan
D = D[D.notna().sum(1) >= 2].reset_index(drop=True)
L = np.log(D.values) - K * (np.log(DIST) - np.log(1500))[None, :]       # times scaled to a common 1500 m reference (Riegel)
mu = np.nanmean(L, 0); Z = L - mu; M = ~np.isnan(Z); Z = np.nan_to_num(Z)
RANK, LAM = 3, 0.5
rng = np.random.default_rng(0); V = rng.normal(0, 0.1, (len(NAMES), RANK)); U = np.zeros((len(Z), RANK))
def solve_rows(Z, M, V, lam):
    out = np.zeros((len(Z), V.shape[1])); pats = np.packbits(M, axis=1).ravel()
    for p in np.unique(pats):
        rows = np.where(pats == p)[0]; m = M[rows[0]]
        if not m.any(): continue
        Vm = V[m]; out[rows] = np.linalg.solve(Vm.T @ Vm + lam * np.eye(V.shape[1]), Vm.T @ Z[np.ix_(rows, np.where(m)[0])].T).T
    return out
for it in range(12):
    U = solve_rows(Z, M, V, LAM)
    for j in range(len(NAMES)):
        o = M[:, j]; Uo = U[o]; V[j] = np.linalg.solve(Uo.T @ Uo + LAM * np.eye(RANK), Uo.T @ Z[o, j])
log(f'\n## exp11: Power of 10 as a prior ({len(Z)} athletes, rank {RANK}, ridge {LAM})\n')
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True); FE = FEATS3 + COURSE
REFCOL = {400: 'p400', 800: 'p800', 1500: 'p1500', 3000: 'p3000', 5000: 'p5000', 8000: 'p8000', 21097.5: 'p21097'}
POIDX = {400: 0, 800: 1, 1500: 2, 3000: 3, 5000: 4, 8000: 5, 21097.5: 7}
lt = np.log(P.target_m.values)
obs = np.full((len(P), len(NAMES)), np.nan)
for ref, col in REFCOL.items():
    at_ref = P[col].values - K * (lt - np.log(ref))                      # best log time at the reference distance
    obs[:, POIDX[ref]] = at_ref - K * (np.log(ref) - np.log(1500)) - mu[POIDX[ref]]
Mo = ~np.isnan(obs); Zo = np.nan_to_num(obs)
Uo = solve_rows(Zo, Mo, V, 1.0)
pred_ev = Uo @ V.T + mu[None, :]                                         # 1500 m-scaled log times, every event
near = np.abs(np.log(DIST)[None, :] - lt[:, None]).argmin(1)
po_lr = pred_ev[np.arange(len(P)), near] + K * (np.log(DIST[near]) - np.log(1500)) + K * (lt - np.log(DIST[near]))
P['po_lr'] = np.where(Mo.sum(1) >= 1, po_lr, np.nan); P['po_d'] = P.po_lr - P.base
log(f'rows with a Power of 10 prediction: {P.po_lr.notna().mean():.0%}; Power of 10 prior alone, MAE {mae(P.y.values[P.po_lr.notna()], P.po_lr.values[P.po_lr.notna()]):.2f}% (Riegel-type base on same rows {mae(P.y.values[P.po_lr.notna()], P.base.values[P.po_lr.notna()]):.2f}%)')
NEW = ['po_lr', 'po_d']
def cv(seed, feats):
    ath = P.athlete_id.unique(); rng = np.random.default_rng(seed); fold = dict(zip(ath, rng.integers(0, 5, len(ath)))); f = P.athlete_id.map(fold).values
    oof = np.zeros(len(P))
    for k in range(5):
        tr, te = f != k, f == k
        oof[te] = HGB(**HGB_FAST).fit(P.loc[tr, feats], (P.y - P.base).values[tr]).predict(P.loc[te, feats])
    return P.base.values + oof
log('| split seed | current features | + Power of 10 prior | change | 95% CI of change |\n|---|---|---|---|---|')
for seed in [int(x) for x in (sys.argv[2].split(",") if len(sys.argv) > 2 else "1,2,3".split(","))]:
    a = cv(seed, FE); b = cv(seed, FE + NEW); ci = boot_ci(P.y.values, b, a, P.athlete_id.values)
    log(f'| {seed} | {mae(P.y.values, a):.3f}% | {mae(P.y.values, b):.3f}% | {mae(P.y.values, b) - mae(P.y.values, a):+.3f} | {ci[0]:+.3f} to {ci[1]:+.3f} |')
