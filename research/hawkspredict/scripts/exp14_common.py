"""Shared helpers for exp14 (new data, synthetic data, retraining of Lite and Research).
rows_full(df)  -> Research-style rows (FEATS3 + COURSE) from a results4-style table, built in parallel by athlete chunks
rows_lite(df)  -> Lite rows (LITE_FEATS) with a 730-day history window, as build_lite.py
Both keep `athlete_id`, `date`, `y` (log seconds), `target_m`. Windows match the original pipeline."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import multiprocessing as mp
import numpy as np, pandas as pd
import model as M
from build3 import extra_feats, FEATS3
from build4 import COURSE, course_features
from lite import lite_feats, LITE_FEATS

M.WINDOW = 730
HIST = 730

def _full_chunk(df):
    rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True); first = g.date.iloc[0]
        for i in range(1, len(g)):
            t = g.iloc[i]; h = g.iloc[:i]
            h = h[(t.date - h.date).dt.days.between(1, HIST)]
            if not len(h): continue
            r = M.feats_for(h, t.m, t.surf, t.male, t.altitude, t.temperature, t.date)
            if not np.isfinite(r['base']): continue
            r.update(extra_feats(h, t.m, t.surf, t.date, first))
            r.update(elev_km=t.elev_km, athlete_id=aid, date=t.date, y=np.log(t.sec), meet_id=t.meet_id, series_id=t.series_id,
                     event=t.event_name, target_m=t.m, surf_s=t.surf)
            rows.append(r)
    return pd.DataFrame(rows)

def _lite_chunk(df):
    rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True); dts = g.date.values; ms = g.m.values; sc = g.sec.values; sf = g.surf.values; ml = g.male.values
        for i in range(1, len(g)):
            age = (dts[i] - dts[:i]).astype('timedelta64[D]').astype(int); k = np.where((age >= 1) & (age <= HIST))[0]
            if not len(k): continue
            r = lite_feats(ms[k], sc[k], sf[k], ms[i], sf[i], ml[i])
            if not np.isfinite(r['base']): continue
            r.update(athlete_id=aid, date=dts[i], target_m=ms[i], y=float(np.log(sc[i])))
            rows.append(r)
    return pd.DataFrame(rows)

def _parallel(fn, df, procs=8):
    df = df.sort_values(['athlete_id', 'date']).reset_index(drop=True)
    ids = df.athlete_id.unique(); parts = [df[df.athlete_id.isin(c)] for c in np.array_split(ids, procs * 4)]
    with mp.get_context('fork').Pool(procs) as p: out = p.map(fn, parts)
    return pd.concat([o for o in out if len(o)], ignore_index=True)

def rows_full(df):
    X = _parallel(_full_chunk, df)
    X = course_features(X.reset_index(drop=True))
    return X

def rows_lite(df):
    return _parallel(_lite_chunk, df)

# ---- Lite model from its exported JSON ----
def lite_predict_json(art, L):
    """Residual (log seconds over `base`) from the exported Lite trees, row by row (fine for a few thousand rows)."""
    F = L[art['feats']].values.astype(float); out = np.full(len(L), art['init'])
    for t in art['trees']:
        f, th, lf, rt, v, mgl = t['f'], t['t'], t['l'], t['r'], t['v'], t['mgl']
        for r in range(len(L)):
            n = 0
            while f[n] >= 0:
                x = F[r, f[n]]
                n = lf[n] if ((np.isnan(x) and mgl[n]) or (not np.isnan(x) and x <= th[n])) else rt[n]
            out[r] += v[n]
    return out
