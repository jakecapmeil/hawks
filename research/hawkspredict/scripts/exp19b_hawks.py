"""Apply the exp19 recent-form term, fitted on Strava/FitRec only, to the Hawks athletes' own runs. Aggregate output only (no athlete ids or per-athlete rows are printed).
Usage: exp19b_hawks.py <wrangler json export of workouts> <exp16 table pkl>"""
import sys, json
import numpy as np, pandas as pd
from sklearn.linear_model import QuantileRegressor
from exp16_train_effort import build
raw = json.load(open(sys.argv[1])); rows = raw[0]['results'] if isinstance(raw, list) else raw['results']
w = pd.DataFrame(rows); print(f'{len(w)} runs, {w.person_id.nunique()} athletes in the export')
w['user'] = 'h' + w.person_id.astype(str); w['t0'] = pd.to_datetime(w.date).astype('int64') / 1e9; w['dist_km'] = w.distance_mi * 1.609344; w['dur_s'] = w.moving_sec.astype(float)
w['gain_m'] = w.elev_gain_ft * 0.3048; w['pace'] = w.dur_s / w.dist_km
w = w[(w.pace > 150) & (w.pace < 600) & (w.dist_km >= 1.0) & (w.dist_km < 60)].sort_values(['user', 't0']).reset_index(drop=True); w['grade'] = (w.gain_m / w.dist_km).fillna(0)
print('athletes with >= 60 runs:', int((w.groupby('user').size() >= 60).sum()), '| runs per such athlete (median):', int(w.groupby('user').size()[lambda s: s >= 60].median()) if (w.groupby('user').size() >= 60).any() else 0)
H = build(w)
print(f'hard 5K/10K-ish efforts with an earlier best and 8 weeks of history: {len(H)} from {H.user.nunique() if len(H) else 0} athletes')
if len(H) == 0: sys.exit()
H = H.dropna(subset=['recent_vs_best']); H['rec'] = H.recent_vs_best.clip(-0.15, 0.30); err = lambda r: 100 * np.abs(np.expm1(r))
X = pd.read_pickle(sys.argv[2]).dropna(subset=['recent_vs_best']); X['rec'] = X.recent_vs_best.clip(-0.15, 0.30)
m = QuantileRegressor(quantile=0.5, alpha=0, solver='highs').fit(X[['rec']], X.r); c0 = float(np.median(X.r))
print(f'\nHawks efforts used: {len(H)}; r (ln actual / earlier best) median {H.r.median():+.3f}, IQR {H.r.quantile(.25):+.3f} to {H.r.quantile(.75):+.3f}; Strava/FitRec median {c0:+.3f}')
for nm, g in (('all hard efforts', H), ('race-like (20%+ faster than usual)', H[H.rel_t <= 0.80])):
    if len(g) == 0: continue
    p_form = m.predict(g[['rec']])
    print(f'{nm}: n={len(g)} ({g.user.nunique()} athletes) | earlier best at face value {err(g.r).mean():.2f}% | + constant offset from Strava/FitRec {err(g.r - c0).mean():.2f}% | + form term (slope {m.coef_[0]:.2f}) {err(g.r - p_form).mean():.2f}% | correlation of r with rec {np.corrcoef(g.rec, g.r)[0, 1]:+.2f}')
print(f'median rec among Hawks efforts {H.rec.median():+.3f} (Strava/FitRec {X.rec.median():+.3f}); share with no hard run in the last 4 weeks: {100 * H.recent_hard.isna().mean():.0f}%')
