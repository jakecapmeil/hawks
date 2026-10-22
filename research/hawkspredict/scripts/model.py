"""Pretrain on NRCD: predict log(time) of a target race from the athlete's prior results.

Model = Riegel baseline + gradient-boosted residual. Evaluated on held-out athletes
and on a forward-in-time split (train before CUT, test after).
"""
import sys, pickle
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

K = 1.06
REFS = [400, 800, 1500, 3000, 5000, 6000, 8000, 21097.5]   # reference distances (m); nearby events bucketed
BUCKET = {400: 400, 800: 800, 1000: 800, 1500: 1500, 1600: 1500, 1609.34: 1500, 3000: 3000, 3200: 3000, 3218.69: 3000,
          5000: 5000, 6000: 6000, 8000: 8000, 10000: 8000, 21097.5: 21097.5}
SURF = {'xc': 0, 'track': 1, 'indoor': 2, 'road': 3}
WINDOW = 400  # days of history

def riegel(t, d_from, d_to, k=K):
    return t * (d_to / d_from) ** k

def feats_for(hist, target_m, surf, male, alt=np.nan, temp=np.nan, t_date=None):
    """hist: rows (date, surf, m, sec) of results strictly before the target, within WINDOW days."""
    row = {'log_d': np.log(target_m), 'surf': SURF[surf], 'male': male, 'alt': alt, 'temp': temp, 'n_prior': len(hist)}
    preds, w = [], []
    for r in REFS:
        row[f'p{int(r)}'] = np.nan
    if len(hist):
        row['days_last'] = (t_date - hist.date.max()).days
        h = hist.copy()
        h['ref'] = h.m.map(BUCKET)
        # best time per bucket, converted to the bucket's own distance
        for ref, g in h.groupby('ref'):
            adj = g.sec * (ref / g.m) ** K
            i = adj.idxmin()
            base = float(adj[i])
            p = riegel(base, ref, target_m)
            row[f'p{int(ref)}'] = np.log(p)
            preds.append(np.log(p)); w.append(1 / (0.15 + abs(np.log(target_m / ref))))
        row['base'] = float(np.average(preds, weights=w))
        row['base_near'] = preds[int(np.argmax(w))]
        row['base_best'] = float(np.min(preds))
    else:
        row['days_last'] = np.nan; row['base'] = np.nan; row['base_near'] = np.nan; row['base_best'] = np.nan
    return row

def build(df, max_rows=None, seed=0):
    df = df.sort_values(['athlete_id', 'date']).reset_index(drop=True)
    rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True)
        for i in range(1, len(g)):
            t = g.iloc[i]
            h = g.iloc[:i]
            h = h[(t.date - h.date).dt.days.between(1, WINDOW)]
            if not len(h): continue
            r = feats_for(h, t.m, t.surf, t.male, t.altitude, t.temperature, t.date)
            r.update(athlete_id=aid, date=t.date, y=np.log(t.sec))
            rows.append(r)
    out = pd.DataFrame(rows)
    return out

FEATS = ['log_d', 'surf', 'male', 'alt', 'temp', 'n_prior', 'days_last', 'base', 'base_near', 'base_best'] + [f'p{int(r)}' for r in REFS]

def fit(X, seed=0):
    m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=40,
                                      l2_regularization=1.0, random_state=seed)
    m.fit(X[FEATS], X.y - X.base)
    return m

def predict(m, X):
    return X.base + m.predict(X[FEATS])

def report(name, y, p):
    e = np.abs(np.expm1(p - y))   # relative error in time
    return f'{name:28s} MAE {100*e.mean():.2f}%  median {100*np.median(e):.2f}%  p90 {100*np.quantile(e, .9):.2f}%'

if __name__ == '__main__':
    S = sys.argv[1]
    df = pd.read_pickle(f'{S}/results.pkl')
    X = build(df)
    X.to_pickle(f'{S}/rows.pkl')
    print(len(X), 'rows', X.athlete_id.nunique(), 'athletes')
    X = X.dropna(subset=['base']).reset_index(drop=True)

    # (a) held-out athletes
    rng = np.random.default_rng(0)
    ath = X.athlete_id.unique(); rng.shuffle(ath)
    test_ath = set(ath[: len(ath) // 5])
    te = X.athlete_id.isin(test_ath)
    m = fit(X[~te])
    print('--- held-out athletes ---')
    print(report('Riegel nearest', X[te].y, X[te].base_near))
    print(report('Riegel weighted mix', X[te].y, X[te].base))
    print(report('Pretrained GBM', X[te].y, predict(m, X[te])))
    # (b) forward in time
    cut = pd.Timestamp('2025-08-01')
    tr, tf = X.date < cut, X.date >= cut
    m2 = fit(X[tr])
    print('--- forward in time (train < 2025-08, test after) ---')
    print(report('Riegel nearest', X[tf].y, X[tf].base_near))
    print(report('Riegel weighted mix', X[tf].y, X[tf].base))
    print(report('Pretrained GBM', X[tf].y, predict(m2, X[tf])))
    # by target distance, forward split
    Z = X[tf].copy(); Z['gbm'] = predict(m2, Z)
    print('--- forward split by target distance ---')
    for d, g in Z.groupby(Z.log_d.round(2)):
        if len(g) < 200: continue
        print(f'{np.exp(d):7.0f} m n={len(g):5d}', report('', g.y, g.base).strip(), '| GBM', f'{100*np.abs(np.expm1(g.gbm-g.y)).mean():.2f}%')
    final = fit(X)
    pickle.dump(final, open(f'{S}/pretrained.pkl', 'wb'))
