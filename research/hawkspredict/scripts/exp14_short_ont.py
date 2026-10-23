"""Does HawksPredict-Short hold up on real teenagers? Ontario championship finalists, leave-one-event-out: for each runner-year, hide one
of their events (100, 200, 400, 800, 1500 or 3000 m) and predict it from the other events they ran that year. Short was never fitted on this data.
Usage: exp14_short_ont.py <scratch> <repo root>"""
import sys, json
import numpy as np, pandas as pd
S, ROOT = sys.argv[1], sys.argv[2]
M = json.load(open(f'{ROOT}/src/shortmodel.json')); Z = 1.2816
PAIRS = {f"{p['s']}>{p['t']}": p for p in M['pairs']}
KEY = {100: '100', 200: '200', 400: '400', 800: '800', 1500: '1500', 3000: '3000'}

def one(src, target, male):
    tm = M['events'][target]
    near = sorted([s for s in src if s[0] != target and f'{s[0]}>{target}' in PAIRS], key=lambda s: abs(np.log(M['events'][s[0]] / tm)))[:3]
    if not near: return None
    sw = sp = 0.0
    for ev, sec in near:
        p = PAIRS[f'{ev}>{target}']; w = 1 / p['sd'] ** 2; sw += w; sp += w * (p['a'] + p['b'] * np.log(sec) + p['c'] * male)
    return sp / sw, np.sqrt((np.sqrt(1 / sw) * M['infl']) ** 2)

def short_any(src, target):
    a, b = one(src, target, 0), one(src, target, 1)
    if not a or not b: return None
    mu = (a[0] + b[0]) / 2; ex = M['extra_sd'].get(target, 0)
    sd = np.sqrt(((a[1] + b[1]) / 2) ** 2 + ((a[0] - b[0]) / 2) ** 2 + ex * ex)
    return np.exp(mu), np.exp(mu - Z * sd), np.exp(mu + Z * sd)

o = pd.read_pickle(f'{S}/results_ont.pkl'); o['yr'] = o.date.dt.year
rows = []
for (aid, yr), g in o.groupby(['athlete_id', 'yr']):
    g = g.drop_duplicates('m')
    if len(g) < 2: continue
    for i, t in g.iterrows():
        src = [(KEY[int(r.m)], r.sec) for _, r in g.iterrows() if r.m != t.m]
        p = short_any(src, KEY[int(t.m)])
        if p: rows.append(dict(target=int(t.m), male=int(t.male), actual=t.sec, pred=p[0], lo=p[1], hi=p[2], nsrc=len(src), near=min(abs(np.log(r.m / t.m)) for _, r in g.iterrows() if r.m != t.m), holdout=bool(t.holdout)))
R = pd.DataFrame(rows); R['err'] = 100 * np.abs(R.pred / R.actual - 1); R['bias'] = 100 * (R.pred / R.actual - 1); R['cov'] = (R.actual >= R.lo) & (R.actual <= R.hi)
R['half'] = 100 * (R.hi - R.lo) / 2 / R.actual
print(f'{len(R)} leave-one-event-out predictions from {R.shape[0]} runner-year-events')
print('| target | n | MAE | bias (pred above actual = +) | 80% coverage | mean half-width | median years-apart |\n|---|---|---|---|---|---|---|')
for t, g in R.groupby('target'):
    print(f'| {t} m | {len(g)} | {g.err.mean():.2f}% | {g.bias.mean():+.2f}% | {100*g["cov"].mean():.0f}% | {g.half.mean():.1f}% | |')
print(f'| all | {len(R)} | {R.err.mean():.2f}% | {R.bias.mean():+.2f}% | {100*R["cov"].mean():.0f}% | {R.half.mean():.1f}% | |')
print('\nby nearest-source distance (log ratio): ', {f'<{b}': (round(float(R[(R.near < b) & (R.near >= a)].err.mean()), 2), int(((R.near < b) & (R.near >= a)).sum())) for a, b in [(0, 0.4), (0.4, 0.8), (0.8, 1.2), (1.2, 9)]})
R.to_pickle(f'{S}/short_ont_eval.pkl')
