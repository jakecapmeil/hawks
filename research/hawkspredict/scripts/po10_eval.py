"""Zero-shot test of HawksPredict-Lite on The Power of 10 lifetime-best matrix (UK athletes, all ages and abilities).
Task: hide one event's best, predict it from the athlete's other bests. No ids, dates or ages exist in this file."""
from common import *
import json
from lite import lite_feats, LITE_FEATS
from baselines import all_baselines
S = sys.argv[1]; set_log(S); rng = np.random.default_rng(5)
D = pd.read_csv(f'{S}/po10_raw/ex/unbiased_clean.csv')
EV = {'400': 400, '800': 800, '1000': 1000, '1500': 1500, 'Mile': 1609.34, '3000': 3000, '5000': 5000, '10000': 10000, '5M': 8046.7, 'HM': 21097.5}
SURFACE = lambda m: 'track' if m <= 10000 and m != 8046.7 else 'road'
D = D[list(EV)].astype(float); D = D.where((D > 0) & (D < 1e5))
# plausibility: speed between 2 and 10.5 m/s
for k, m in EV.items(): D.loc[(m / D[k] > 10.5) | (m / D[k] < 2.0), k] = np.nan
cnt = D.notna().sum(1); D = D[cnt >= 2].reset_index(drop=True)
log(f'\n## Power of 10 zero-shot test (lifetime bests; no ids/dates/ages): {len(D)} athletes with >= 2 of the {len(EV)} events\n')
tasks = []
V = D.values; names = list(EV)
idx = np.argwhere(~np.isnan(V))
pick = idx[rng.choice(len(idx), min(60000, len(idx)), replace=False)]
rows = []
for r, c in pick:
    others = [(EV[names[j]], V[r, j], SURFACE(EV[names[j]])) for j in range(len(names)) if j != c and not np.isnan(V[r, j])]
    if not others: continue
    tm = EV[names[c]]; f = lite_feats([o[0] for o in others], [o[1] for o in others], [o[2] for o in others], tm, SURFACE(tm), 1)
    if not np.isfinite(f['base']): continue
    f['target_m'] = tm; f['y'] = float(np.log(V[r, c])); f['event'] = names[c]; f['n_other'] = len(others); f['row'] = r; rows.append(f)
X = pd.DataFrame(rows); log(f'{len(X)} leave-one-event-out tasks')

art = json.load(open(f'{S}/pace_lite.json')); FI = {k: i for i, k in enumerate(art['feats'])}
M_ = X[art['feats']].values.astype(float); res = np.full(len(X), art['init'])
for t in art['trees']:
    f_ = np.array(t['f']); th = np.array(t['t']); l_ = np.array(t['l']); r_ = np.array(t['r']); v_ = np.array(t['v']); mg = np.array(t['mgl'])
    node = np.zeros(len(X), int)
    for _ in range(40):
        feat = f_[node]; leaf = feat < 0
        if leaf.all(): break
        x = M_[np.arange(len(X)), np.where(leaf, 0, feat)]
        left = np.where(np.isnan(x), mg[node] == 1, x <= th[node])
        node = np.where(leaf, node, np.where(left, l_[node], r_[node]))
    res += v_[node]
pl = X.base.values + res
# baselines; low-rank fitted on a disjoint half of the athletes
half = X.row.isin(set(rng.choice(X.row.unique(), len(X.row.unique()) // 2, replace=False))).values
B = all_baselines(X[~half], X[half]); Xe = X[~half].reset_index(drop=True); ple = pl[~half]; y = Xe.y.values
ref = B['Riegel (nearest result)'].values
log('| model | error (leave-one-event-out) | 95% CI (bootstrap by athlete row) |\n|---|---|---|')
a = Xe.row.values
ci = boot_ci(y, ple, None, a); log(f'| **HawksPredict-Lite** | **{mae(y, ple):.2f}%** | {ci[0]:.2f}-{ci[1]:.2f} |')
for col in B.columns:
    p = B[col].values; ok = np.isfinite(p)
    if ok.mean() < 0.5: continue
    pp = np.where(ok, p, ref); c2 = boot_ci(y, pp, None, a); log(f'| {col} | {mae(y, pp):.2f}% | {c2[0]:.2f}-{c2[1]:.2f} |')
d = boot_ci(y, ple, B['Cameron'].values, a); log(f'\nLite vs Cameron, paired: {d[0]:+.2f} to {d[1]:+.2f} points')
log('\n| slice | tasks | Lite | Riegel | Cameron |\n|---|---|---|---|---|')
def sl(name, m):
    if m.sum() < 100: return
    log(f"| {name} | {int(m.sum())} | {mae(y[m], ple[m]):.2f}% | {mae(y[m], ref[m]):.2f}% | {mae(y[m], B['Cameron'].values[m]):.2f}% |")
for e in names: sl(f'hidden event {e}', (Xe.event == e).values)
for n in (1, 2, 3): sl(f'{n} other event(s) known' if n < 3 else '3+ other events known', (Xe.n_other == n).values if n < 3 else (Xe.n_other >= 3).values)
sec = np.exp(y)
v_ = Xe.target_m.values / sec
for lo_, hi_, nm in [(2, 4.5, 'slower runners (< 4.5 m/s average)'), (4.5, 5.5, 'club runners (4.5-5.5 m/s)'), (5.5, 7, 'fast (5.5-7 m/s)'), (7, 11, 'elite-level (> 7 m/s)')]: sl(nm, (v_ >= lo_) & (v_ < hi_))
