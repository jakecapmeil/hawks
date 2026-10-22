"""v4 rows: v3 features + meet ids + leak-free course-difficulty features + frozen split flags."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
import model as M
from build3 import extra_feats, FEATS3

M.WINDOW = 730
TEST_FRAC, TEST_FROM, SEED = 0.2, pd.Timestamp('2025-08-01'), 20261021

def build(df):
    df = df.sort_values(['athlete_id', 'date']).reset_index(drop=True)
    rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True); first = g.date.iloc[0]
        for i in range(1, len(g)):
            t = g.iloc[i]; h = g.iloc[:i]
            h = h[(t.date - h.date).dt.days.between(1, M.WINDOW)]
            if not len(h): continue
            r = M.feats_for(h, t.m, t.surf, t.male, t.altitude, t.temperature, t.date)
            if not np.isfinite(r['base']): continue
            r.update(extra_feats(h, t.m, t.surf, t.date, first))
            r.update(elev_km=t.elev_km, athlete_id=aid, date=t.date, y=np.log(t.sec), meet_id=t.meet_id, series_id=t.series_id,
                     event=t.event_name, target_m=t.m, surf_s=t.surf)
            rows.append(r)
    return pd.DataFrame(rows)

def course_features(X, k=30.0, lag_days=3):
    """For each row: shrunk mean Riegel-residual of EARLIER meets in the same series (and same series+event)."""
    X = X.copy(); X['r0'] = X.y - X.base
    for name, keys in (('cb_series', ['series_id']), ('cb_event', ['series_id', 'event'])):
        out = np.full(len(X), np.nan); cnt = np.zeros(len(X))
        for _, g in X.dropna(subset=['series_id']).groupby(keys):
            g = g.sort_values('date'); d = g.date.values.astype('datetime64[D]').astype(np.int64)
            cs = np.r_[0.0, np.cumsum(g.r0.values)]
            j = np.searchsorted(d, d - lag_days, side='left')          # rows strictly earlier than this meet
            n = j.astype(float); s = cs[j]
            out[X.index.get_indexer(g.index)] = np.where(n > 0, s / (n + k), np.nan); cnt[X.index.get_indexer(g.index)] = n
        X[name] = out; X[name + '_n'] = cnt
    return X

def split_flags(X):
    rng = np.random.default_rng(SEED)
    ath = np.sort(X.athlete_id.unique()); test_ath = set(rng.choice(ath, int(len(ath) * TEST_FRAC), replace=False))
    X['test_athlete'] = X.athlete_id.isin(test_ath)
    X['final_test'] = X.test_athlete & (X.date >= TEST_FROM)     # athlete-disjoint AND last season: touched once per finalist
    X['pool'] = ~X.test_athlete                                   # all selection happens here (nested GroupKFold)
    return X

COURSE = ['cb_series', 'cb_series_n', 'cb_event', 'cb_event_n']
if __name__ == '__main__':
    S = sys.argv[1]
    X = build(pd.read_pickle(f'{S}/results4.pkl'))
    X = course_features(X.reset_index(drop=True)); X = split_flags(X)
    X.to_pickle(f'{S}/rows4.pkl')
    print(len(X), 'rows | pool', int(X.pool.sum()), '| final test', int(X.final_test.sum()), 'rows from', X[X.final_test].athlete_id.nunique(), 'athletes')
