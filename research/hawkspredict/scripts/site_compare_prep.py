"""Build tasks for the website's own estimator: PR-only inputs, each event's fastest result in the 730 days before the race."""
import os, sys, json, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
S = sys.argv[1]; rng = np.random.default_rng(11)
X = pd.read_pickle(f'{S}/rows4.pkl'); R = pd.read_pickle(f'{S}/results4.pkl').sort_values(['athlete_id', 'date'])
K = 1.06
# NRCD distance -> (website PR event, scale factor to that event's distance)
PR_MAP = {400: ('400', 1.0), 800: ('800', 1.0), 1500: ('1600', (1600 / 1500) ** K), 1600: ('1600', 1.0), 1609.34: ('1600', 1600 / 1609.344),
          3000: ('3200', (3200 / 3000) ** K), 3200: ('3200', 1.0), 3218.69: ('3200', 3200 / 3218.69), 5000: ('5K', 1.0)}
# NRCD target distance -> (website estimate key, scale from estimate to the target distance)
TGT_MAP = {400: ('400', 1.0), 800: ('800', 1.0), 1500: ('1600', (1500 / 1600) ** K), 1600: ('1600', 1.0), 1609.34: ('1600', (1609.34 / 1600) ** K),
           3000: ('3200', (3000 / 3200) ** K), 3200: ('3200', 1.0), 3218.69: ('3200', (3218.69 / 3200) ** K), 5000: ('5K', 1.0),
           10000: ('10K', 1.0), 21097.5: ('half', 1.0)}
F = X[X.final_test]; P = X[X.pool & X.target_m.isin(TGT_MAP)].sample(9000, random_state=3)
sel = pd.concat([F[F.target_m.isin(TGT_MAP)].assign(split='final_test'), P.assign(split='pool_sample')]).reset_index(drop=True)
byath = {a: g for a, g in R.groupby('athlete_id')}
tasks = []; keep = []
for i, r in sel.iterrows():
    g = byath[r.athlete_id]; h = g[(g.date < r.date) & ((r.date - g.date).dt.days <= 730)]
    h = h[h.m.isin(PR_MAP)]
    if not len(h): continue
    prs = {}; used = []
    for (ev, mult), gg in h.assign(ev=h.m.map(lambda m: PR_MAP[m][0]), mult=h.m.map(lambda m: PR_MAP[m][1])).groupby(['ev', 'mult']):
        pass
    h = h.assign(ev=h.m.map(lambda m: PR_MAP[m][0]), t=h.sec * h.m.map(lambda m: PR_MAP[m][1]))
    for ev, gg in h.groupby('ev'):
        j = gg.t.idxmin(); row = gg.loc[j]
        key = 'XC 5K' if (ev == '5K' and row.surf == 'xc') else ev
        if key in prs and prs[key]['_t'] <= row.t: continue
        prs[key] = {'time': float(row.t), 'date': str(row.date.date()), 'meet': 'NRCD course' if key == 'XC 5K' else '', '_t': float(row.t)}
        used.append((float(row.m), float(row.sec), row.surf, row.date))
    tasks.append(dict(i=int(i), today=str((r.date - pd.Timedelta(days=1)).date()), prs={k: {a: b for a, b in v.items() if a != '_t'} for k, v in prs.items()}))
    keep.append((i, used))
json.dump(tasks, open(f'{S}/site_tasks.json', 'w'))
sel.to_pickle(f'{S}/site_sel.pkl'); pickle.dump(keep, open(f'{S}/site_keep.pkl', 'wb'))
print(len(tasks), 'tasks', sel.split.value_counts().to_dict())
