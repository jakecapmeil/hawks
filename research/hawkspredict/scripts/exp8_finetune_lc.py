"""(a) Does per-athlete shrunk-bias fine-tuning help on NRCD athletes? (b) learning curve: does more data still help?"""
from common import *
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True); FE = FEATS3 + COURSE
R = (P.y - P.base).values; Y = P.y.values
log('\n## exp8a: per-athlete fine-tuning, tested on later races of the same NRCD athlete (pool, out-of-fold)\n')
oof = np.zeros(len(P))
for tr, te in GroupKFold(5).split(P, groups=P.athlete_id): oof[te] = HGB(**HGB_FAST).fit(P.iloc[tr][FE], R[tr]).predict(P.iloc[te][FE])
pred = P.base.values + oof; res = Y - pred
within = P.assign(res=res).groupby('athlete_id').res.var().mean()
am = P.assign(res=res).groupby('athlete_id').res.agg(['mean', 'count']); am = am[am['count'] >= 3]
tau2 = max(float(am['mean'].var() - within / am['count'].mean()), 1e-6)
log(f'within-athlete sd {np.sqrt(within):.4f}, between-athlete bias sd {np.sqrt(tau2):.4f} (log time)')
D = P[['athlete_id', 'date']].copy(); D['res'] = res; D['i'] = np.arange(len(P))
out = {k: np.full(len(P), np.nan) for k in ('n', 'shrunk', 'full')}
for aid, g in D.groupby('athlete_id'):
    g = g.sort_values('date'); r = g.res.values; d = g.date.values; ii = g.i.values
    for j in range(1, len(g)):
        prior = r[:j][d[:j] < d[j]]                       # strictly earlier races only
        n = len(prior)
        if n == 0: continue
        w = tau2 / (tau2 + within / n)
        out['n'][ii[j]] = n; out['shrunk'][ii[j]] = w * prior.mean(); out['full'][ii[j]] = prior.mean()
ok = ~np.isnan(out['n']); n = out['n'][ok]
base_mae = mae(Y[ok], pred[ok]); log(f'rows with at least one earlier race by the same athlete: {ok.sum()} ({100*ok.mean():.0f}%)')
log('| earlier races of that athlete | rows | no correction | shrunk bias (ours) | full bias (no shrinkage) | shrunk vs none, 95% CI |\n|---|---|---|---|---|---|')
for name, sel in [('1', n == 1), ('2', n == 2), ('3-4', (n >= 3) & (n <= 4)), ('5+', n >= 5), ('all', n >= 1)]:
    idx = np.where(ok)[0][sel]; y = Y[idx]
    ci = boot_ci(y, pred[idx] + out['shrunk'][idx], pred[idx], P.athlete_id.values[idx])
    log(f"| {name} | {len(idx)} | {mae(y, pred[idx]):.3f}% | {mae(y, pred[idx]+out['shrunk'][idx]):.3f}% | {mae(y, pred[idx]+out['full'][idx]):.3f}% | {ci[0]:+.3f} to {ci[1]:+.3f} |")

log('\n## exp8b: learning curve (train on a fraction of training athletes, fixed evaluation athletes)\n| fraction of training athletes | training rows | MAE | 95% CI |\n|---|---|---|---|')
rng = np.random.default_rng(3); ath = np.sort(P.athlete_id.unique()); rng.shuffle(ath)
ev = set(ath[: int(.3 * len(ath))]); trn = ath[int(.3 * len(ath)):]
em = P.athlete_id.isin(ev).values; Ei = np.where(em)[0]
pts = []
for frac in (0.1, 0.25, 0.5, 1.0):
    sub = set(trn[: int(frac * len(trn))]); Ti = np.where(P.athlete_id.isin(sub).values)[0]
    p = P.base.values[Ei] + HGB(**HGB_FAST).fit(P.iloc[Ti][FE], R[Ti]).predict(P.iloc[Ei][FE])
    ci = boot_ci(Y[Ei], p, None, P.athlete_id.values[Ei]); m = mae(Y[Ei], p); pts.append((len(Ti), m))
    log(f'| {int(frac*100)}% | {len(Ti):,} | {m:.3f}% | {ci[0]:.2f}-{ci[1]:.2f} |')
x = np.log([a for a, _ in pts]); yv = np.log([b for _, b in pts]); slope = np.polyfit(x, yv, 1)[0]
log(f'\nlog-log slope of error vs training rows: {slope:.3f}  -> doubling the data changes error by {100*(2**slope-1):+.1f}%')
log(f'last step (50% -> 100%): {pts[-2][1]:.3f}% -> {pts[-1][1]:.3f}%')
