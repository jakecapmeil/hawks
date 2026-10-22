"""Website model ("HawksPredict-Lite"): date-free serve-time features, small trees, distilled from a bigger teacher, exported to JSON."""
from common import *
import json, pickle
from lite import LITE_FEATS, lite_feats
S = sys.argv[1]; set_log(S)
L = pd.read_pickle(f'{S}/lite730.pkl'); X4 = pd.read_pickle(f'{S}/rows4.pkl')
key = ['athlete_id', 'date', 'target_m']
L = L.merge(X4[key + ['pool', 'final_test'] + FEATS3 + COURSE].rename(columns=lambda c: c if c in key or c in ('pool', 'final_test') else 'x_' + c),
            on=key, how='inner')
L['date'] = pd.to_datetime(L['date']); P = L[L.pool].reset_index(drop=True); F = L[L.final_test].reset_index(drop=True)
R = (P.y - P.base).values; Y = P.y.values; A = P.athlete_id.values
log(f'\n## Lite model (website): {len(P)} pool rows, {len(F)} final-test rows, {len(LITE_FEATS)} date-free features\n')

# teacher: bigger model on the full (dated) feature set, out-of-fold on the pool
t0 = time.time(); TF = ['x_' + c for c in FEATS3 + COURSE]; teach = np.zeros(len(P))
for tr, te in GroupKFold(5).split(P, groups=A):
    teach[te] = HGB(**HGB_FAST).fit(P.iloc[tr][TF], R[tr]).predict(P.iloc[te][TF])
log(f'teacher (dated features, 400 x 31 leaves) out-of-fold MAE {mae(Y, P.base.values+teach):.3f}%  ({time.time()-t0:.0f}s)')

def count(m):
    t = [p[0] for p in m._predictors]; nodes = sum(len(x.nodes) for x in t); leaves = sum(int((x.nodes['is_leaf'] == 1).sum()) for x in t)
    return leaves + 2 * (nodes - leaves)
def fit(idx, c, target):
    return HGB(loss='absolute_error', min_samples_leaf=60, l2_regularization=1.0, random_state=0, **c).fit(P.iloc[idx][LITE_FEATS], target[idx])
CFGS = [(20, 4, .3), (40, 7, .15), (80, 7, .12), (80, 15, .12), (150, 15, .1), (250, 15, .08), (400, 31, .08)]
log('| size (trees x leaves) | learned numbers | MAE dev (labels) | MAE dev (distilled) |\n|---|---|---|---|')
res = []
folds = list(GroupKFold(5).split(P, groups=A)); mix = 0.5 * R + 0.5 * teach
for it, lv, lr in CFGS:
    c = dict(max_iter=it, max_leaf_nodes=lv, learning_rate=lr); o1 = np.zeros(len(P)); o2 = np.zeros(len(P)); npar = 0
    for tr, te in folds:
        m = fit(tr, c, R); o1[te] = m.predict(P.iloc[te][LITE_FEATS]); npar = count(m)
        o2[te] = fit(tr, c, mix).predict(P.iloc[te][LITE_FEATS])
    e1, e2 = mae(Y, P.base.values + o1), mae(Y, P.base.values + o2); res.append((npar, e1, e2, c, o1, o2))
    log(f'| {it} x {lv} | {npar:,} | {e1:.3f}% | {e2:.3f}% |')
best = min(min(r[1], r[2]) for r in res)
knee = next(r for r in res if min(r[1], r[2]) <= best + 0.05)
use_dist = knee[2] < knee[1]; cfg = knee[3]; oof = knee[5] if use_dist else knee[4]
log(f'\nknee (smallest model within 0.05 points of the best, {best:.3f}%): {cfg}, {knee[0]:,} numbers, distilled={use_dist}')

final = fit(np.arange(len(P)), cfg, mix if use_dist else R)
pf = F.base.values + final.predict(F[LITE_FEATS]); yf = F.y.values; af = F.athlete_id.values
ci = boot_ci(yf, pf, None, af); cr = boot_ci(yf, pf, F.base_near.values, af)
log(f'\nFINAL TEST (athlete-disjoint, last season; touched once): Lite {mae(yf, pf):.3f}% [{ci[0]:.2f}, {ci[1]:.2f}] vs nearest-result Riegel {mae(yf, F.base_near.values):.3f}%  (paired diff {cr[0]:+.2f} to {cr[1]:+.2f})')

# intervals: residual quantiles by (distinct distances in history x target distance group), from pool out-of-fold residuals
def grp(nb, d): return f"{int(min(nb, 3))}|{0 if d <= 1700 else 1 if d <= 4100 else 2 if d <= 7000 else 3}"
Pg = [grp(a, b) for a, b in zip(P.n_buckets.fillna(0), P.target_m)]; Fg = [grp(a, b) for a, b in zip(F.n_buckets.fillna(0), F.target_m)]
r = Y - (P.base.values + oof); tab = {}
for g in sorted(set(Pg)):
    sel = np.array([x == g for x in Pg]); tab[g] = [float(np.quantile(r[sel], .1)), float(np.quantile(r[sel], .9)), int(sel.sum())]
lo = np.array([pf[i] + tab.get(Fg[i], tab['1|0'])[0] for i in range(len(F))]); hi = np.array([pf[i] + tab.get(Fg[i], tab['1|0'])[1] for i in range(len(F))])
log(f'80% interval coverage on final test: {100*np.mean((yf>=lo)&(yf<=hi)):.1f}% (target 80%), mean half-width {100*np.mean((np.exp(hi)-np.exp(lo))/np.exp(yf))/2:.1f}% of time')

# the 51 high-school pairs (dev set)
d = pd.read_csv(f'{S}/kaggle_raw/running-times-data-for-high-school-students/Running - Sheet1.csv'); d.columns = ['lab','t1','t2','a','v','r','c','av','mi','df','x']
d['t1'] = pd.to_numeric(d.t1, errors='coerce'); d['t2'] = pd.to_numeric(d.t2, errors='coerce'); d = d.dropna(subset=['t1', 't2'])
fh = pd.DataFrame([lite_feats([1609.34], [t], ['track'], 3200, 'track', 1) for t in d.t1])
ph = np.exp(fh.base.values + final.predict(fh[LITE_FEATS])); ps = np.exp(fh.base.values)
log(f'high-school pairs (dev set, n={len(d)}): Lite {100*np.mean(np.abs(ph/d.t2.values-1)):.2f}% vs Riegel {100*np.mean(np.abs(ps/d.t2.values-1)):.2f}%')

# sensitivity: histories up to 1500 days (undated app PRs can be old)
if os.path.exists(f'{S}/lite1500.pkl'):
    L2 = pd.read_pickle(f'{S}/lite1500.pkl'); L2['date'] = pd.to_datetime(L2['date']); L2 = L2.merge(X4[key + ['final_test']], on=key)
    L2 = L2[L2.final_test].merge(F[key], on=key)
    p2 = L2.base.values + final.predict(L2[LITE_FEATS]); log(f'sensitivity, same final-test races with up-to-1500-day histories: Lite {mae(L2.y.values, p2):.3f}% vs Riegel {mae(L2.y.values, L2.base_near.values):.3f}%  (n={len(L2)})')

# export
m = final; trees = []
for p in m._predictors:
    nd = p[0].nodes
    trees.append(dict(f=[int(x) if lf == 0 else -1 for x, lf in zip(nd['feature_idx'], nd['is_leaf'])], t=[min(float(x), 1e308) for x in nd["num_threshold"]],
                      l=[int(x) for x in nd['left']], r=[int(x) for x in nd['right']], v=[float(x) for x in nd['value']],
                      mgl=[int(x) for x in nd['missing_go_to_left']]))
init = float(np.asarray(m._baseline_prediction).ravel()[0])
art = dict(name='HawksPredict-Lite', version='v1', feats=LITE_FEATS, init=init, trees=trees, interval=tab, params=int(knee[0]),
           trained_on='NRCD (CC-BY-4.0) collegiate results, 2003-2026', note='log-seconds residual over the weighted-Riegel baseline')
json.dump(art, open(f'{S}/pace_lite.json', 'w'), separators=(',', ':'))
log(f'exported pace_lite.json: {os.path.getsize(f"{S}/pace_lite.json")/1024:.0f} KB, {len(trees)} trees')

def py_predict(feat_row):
    s = init
    for t in trees:
        n = 0
        while t['f'][n] >= 0:
            x = feat_row[t['f'][n]]
            n = t['l'][n] if (np.isnan(x) and t['mgl'][n]) or (not np.isnan(x) and x <= t['t'][n]) else t['r'][n]
        s += t['v'][n]
    return s
sub = F.sample(300, random_state=0)
mx = max(abs(py_predict(r[LITE_FEATS].values.astype(float)) - m.predict(r[LITE_FEATS].to_frame().T.astype(float))[0]) for _, r in sub.head(60).iterrows())
log(f'python tree-walk vs sklearn predict, max abs diff over 60 rows: {mx:.2e}')
# parity cases for the JS port: raw inputs -> expected output
D4 = pd.read_pickle(f'{S}/results4.pkl').sort_values(['athlete_id', 'date']); cases = []
for _, r in sub.iterrows():
    h = D4[(D4.athlete_id == r.athlete_id) & (D4.date < r.date) & ((r.date - D4.date).dt.days <= 730)]
    if not len(h): continue
    tg = D4[(D4.athlete_id == r.athlete_id) & (D4.date == r.date) & (np.isclose(D4.m, r.target_m))].iloc[0]
    f = lite_feats(h.m.values, h.sec.values, h.surf.values, tg.m, tg.surf, tg.male)
    fr = np.array([f[k] for k in LITE_FEATS], float)
    cases.append(dict(results=[dict(m=float(a), sec=float(b), surf=s) for a, b, s in zip(h.m, h.sec, h.surf)],
                      target=dict(m=float(tg.m), surf=tg.surf, male=int(tg.male)), base=f['base'], resid=py_predict(fr),
                      nb=f['n_buckets'] if np.isfinite(f['n_buckets']) else 0))
json.dump(cases[:200], open(f'{S}/pace_lite_parity.json', 'w'))
pickle.dump(dict(cfg=cfg, tab=tab, params=knee[0]), open(f'{S}/lite_meta.pkl', 'wb'))
log(f'parity cases written: {len(cases[:200])}')
