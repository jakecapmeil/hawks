"""v3 features: personal Riegel exponent, recency/trend, volatility, same-surface baseline, seasonality."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
import model as M

K = M.K
SURFN = {'xc': 0, 'track': 1, 'indoor': 2, 'road': 3}

def extra_feats(h, target_m, surf, t_date, first_date):
    """h: DataFrame (date, surf, m, sec) of prior results within the window (non-empty)."""
    lt = np.log(target_m)
    m = h.m.values; sec = h.sec.values
    age = (t_date - h.date).dt.days.values.astype(float)
    lp = np.log(sec) + K * (lt - np.log(m))                 # each result Riegel-projected to the target distance
    f = {}
    d = np.abs(lt - np.log(m))
    w = np.exp(-age / 90.0) / (0.15 + d)
    f['base_rec'] = float(np.average(lp, weights=w))        # recency + distance weighted mean (not just the best)
    recent = age <= 60
    f['best_60d'] = float(lp[recent].min()) if recent.any() else np.nan
    f['best_all'] = float(lp.min())
    j = int(np.argmin(age)); f['last_lp'] = float(lp[j]); f['last_gap'] = float(age[j])
    ss = (h.surf.values == surf)
    f['best_samesurf'] = float(lp[ss].min()) if ss.any() else np.nan
    f['n_samesurf'] = int(ss.sum())
    # personal exponent from bucket bests
    hb = pd.DataFrame({'ref': h.m.map(M.BUCKET).values, 'lm': np.log(m), 'ls': np.log(sec)})
    pts = hb.loc[hb.groupby('ref').ls.idxmin()]
    f['n_buckets'] = len(pts)
    f['k_ind'] = np.nan; f['base_slope'] = np.nan; f['span'] = np.nan
    if len(pts) >= 2:
        x = pts.lm.values; y = pts.ls.values
        span = x.max() - x.min(); f['span'] = float(span)
        if span >= 0.4:
            k = np.polyfit(x, y, 1)[0]
            k = float(np.clip(k, 0.95, 1.25)); f['k_ind'] = k
            i = int(np.argmin(np.abs(x - lt)))
            f['base_slope'] = float(y[i] + k * (lt - x[i]))
    # trend in Riegel-equivalent performance
    f['trend100'] = np.nan; f['vol'] = np.nan
    if len(h) >= 3 and age.max() - age.min() >= 45:
        s = np.polyfit(-age, lp, 1)[0] * 100              # change in log-time per 100 days (negative = improving)
        f['trend100'] = float(np.clip(s, -0.2, 0.2))
    if len(h) >= 3:
        f['vol'] = float(lp.std())
    doy = t_date.dayofyear / 365.25 * 2 * np.pi
    f['sin_doy'] = float(np.sin(doy)); f['cos_doy'] = float(np.cos(doy))
    f['career_days'] = float((t_date - first_date).days)
    f['n_results'] = len(h)
    return f

def build(df):
    df = df.sort_values(['athlete_id', 'date']).reset_index(drop=True)
    rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True)
        first = g.date.iloc[0]
        for i in range(1, len(g)):
            t = g.iloc[i]
            h = g.iloc[:i]
            h = h[(t.date - h.date).dt.days.between(1, M.WINDOW)]
            if not len(h): continue
            r = M.feats_for(h, t.m, t.surf, t.male, t.altitude, t.temperature, t.date)
            r.update(extra_feats(h, t.m, t.surf, t.date, first))
            r.update(elev_km=t.elev_km, athlete_id=aid, date=t.date, y=np.log(t.sec))
            rows.append(r)
    return pd.DataFrame(rows)

EXTRA = ['base_rec', 'best_60d', 'best_all', 'last_lp', 'last_gap', 'best_samesurf', 'n_samesurf', 'n_buckets', 'k_ind',
         'base_slope', 'span', 'trend100', 'vol', 'sin_doy', 'cos_doy', 'career_days', 'n_results']
FEATS3 = M.FEATS + ['elev_km'] + EXTRA

if __name__ == '__main__':
    S = sys.argv[1]
    M.WINDOW = 730
    X = build(pd.read_pickle(f'{S}/results2.pkl'))
    X = X.dropna(subset=['base']).reset_index(drop=True)
    X.to_pickle(f'{S}/rows3.pkl')
    print(len(X), 'rows,', len(FEATS3), 'features')
