"""Junior-proxy test on the raw Power of 10 file. Juniors = athletes with an entry in any age-group event column (U13..U20).
That group is biased toward hurdlers and multi-eventers, so it is a proxy, not a random sample of high-school runners."""
from common import *
import json, re
from lite import lite_feats
from baselines import all_baselines
S = sys.argv[1]; set_log(S); rng = np.random.default_rng(9)
cols = [c.strip() for c in open(f'{S}/po10_big/cols.txt').read().split('\n') if c.strip()]
jr = [c for c in cols if re.search(r'U1[3-9]|U20|IU1', c)]
EV = {'400': 400, '800': 800, '1000': 1000, '1500': 1500, 'Mile': 1609.34, '3000': 3000, '5000': 5000}
pk = f'{S}/po10_junior_subset.pkl'
if not os.path.exists(pk):
    d = pd.read_csv(f'{S}/po10_big/ex/raw_data.csv', usecols=list(EV) + jr, low_memory=False)
    d['junior'] = d[jr].notna().any(axis=1); d = d[list(EV) + ['junior']]
    d = d[d[list(EV)].notna().sum(axis=1) >= 2].reset_index(drop=True); d.to_pickle(pk)
D0 = pd.read_pickle(pk)
for k, m in EV.items(): D0.loc[(m / D0[k] > 10.5) | (m / D0[k] < 2.0), k] = np.nan
art = json.load(open(f'{S}/pace_lite.json'))
def walk(X):
    M_ = X[art['feats']].values.astype(float); res = np.full(len(X), art['init'])
    for t in art['trees']:
        f_ = np.array(t['f']); th = np.array(t['t']); l_ = np.array(t['l']); r_ = np.array(t['r']); v_ = np.array(t['v']); mg = np.array(t['mgl']); node = np.zeros(len(X), int)
        for _ in range(40):
            feat = f_[node]; leaf = feat < 0
            if leaf.all(): break
            x = M_[np.arange(len(X)), np.where(leaf, 0, feat)]; left = np.where(np.isnan(x), mg[node] == 1, x <= th[node])
            node = np.where(leaf, node, np.where(left, l_[node], r_[node]))
        res += v_[node]
    return X.base.values + res
def run(D, label, n=40000):
    V = D[list(EV)].values.astype(float); names = list(EV); idx = np.argwhere(~np.isnan(V)); pick = idx[rng.choice(len(idx), min(n, len(idx)), replace=False)]; rows = []
    for r, c in pick:
        oth = [(EV[names[j]], V[r, j]) for j in range(len(names)) if j != c and not np.isnan(V[r, j])]
        if not oth: continue
        f = lite_feats([o[0] for o in oth], [o[1] for o in oth], ['track'] * len(oth), EV[names[c]], 'track', 1)
        if not np.isfinite(f['base']): continue
        f.update(target_m=EV[names[c]], y=float(np.log(V[r, c])), event=names[c], row=r, n_other=len(oth)); rows.append(f)
    X = pd.DataFrame(rows); half = X.row.isin(set(rng.choice(X.row.unique(), len(X.row.unique()) // 2, replace=False))).values
    B = all_baselines(X[~half], X[half]); Xe = X[~half].reset_index(drop=True); pl = walk(Xe); y = Xe.y.values; a = Xe.row.values
    ref = B['Riegel (nearest result)'].values; cam = B['Cameron'].values
    log(f'\n### {label}: {len(Xe)} leave-one-event-out tasks from {Xe.row.nunique()} athletes\n| model | error | 95% CI |\n|---|---|---|')
    for nm, p in [('HawksPredict-Lite', pl), ('Cameron', cam), ('Riegel (nearest)', ref), ('Low-rank completion', np.where(np.isfinite(B.iloc[:, -1].values), B.iloc[:, -1].values, ref))]:
        ci = boot_ci(y, p, None, a); log(f'| {nm} | {mae(y, p):.2f}% | {ci[0]:.2f}-{ci[1]:.2f} |')
    d = boot_ci(y, pl, cam, a); log(f'Lite vs Cameron paired: {d[0]:+.2f} to {d[1]:+.2f}')
    for e in ('800', '1500', 'Mile', '3000'):
        m = (Xe.event == e).values
        if m.sum() >= 100: log(f'  hidden {e}: n={int(m.sum())}  Lite {mae(y[m], pl[m]):.2f}%  Cameron {mae(y[m], cam[m]):.2f}%  Riegel {mae(y[m], ref[m]):.2f}%')
log('\n## Power of 10 raw file: junior proxy test (no ages exist; juniors = has an age-group-event entry)')
run(D0[D0.junior].reset_index(drop=True), 'junior-flagged athletes')
run(D0[~D0.junior].reset_index(drop=True), 'all other athletes, same events (control)')
