import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from lite import lite_feats, LITE_FEATS
S, WINDOW, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3]
df = pd.read_pickle(f'{S}/results4.pkl').sort_values(['athlete_id', 'date']).reset_index(drop=True)
rows = []
for aid, g in df.groupby('athlete_id', sort=False):
    if len(g) < 2: continue
    g = g.reset_index(drop=True); dts = g.date.values; ms = g.m.values; sc = g.sec.values; sf = g.surf.values
    for i in range(1, len(g)):
        age = (dts[i] - dts[:i]).astype('timedelta64[D]').astype(int); k = np.where((age >= 1) & (age <= WINDOW))[0]
        if not len(k): continue
        r = lite_feats(ms[k], sc[k], sf[k], ms[i], sf[i], g.male.values[i])
        if not np.isfinite(r['base']): continue
        r.update(athlete_id=aid, date=dts[i], target_m=ms[i], y=float(np.log(sc[i]))); rows.append(r)
X = pd.DataFrame(rows); X.to_pickle(OUT); print(len(X), 'lite rows, window', WINDOW)
