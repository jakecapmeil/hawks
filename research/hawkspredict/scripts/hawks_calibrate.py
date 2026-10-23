"""Pooled statistics from the Hawks runs (heart rate, pace, heat, hills), used only to set the simulator's constants.
Reads a local export of the app's workouts table. Prints pooled numbers only; no per-athlete values, nothing is written to the repo.
Usage: hawks_calibrate.py <workouts.csv>"""
import sys
import numpy as np
import pandas as pd

w = pd.read_csv(sys.argv[1])
w = w[(w.sport == 'Run') & (w.category != 'crosstrain') & (w.distance_mi >= 1.0) & (w.moving_sec > 300) & w.avg_hr.between(90, 210)].copy()
w['pace'] = w.moving_sec / 60 / w.distance_mi                               # min per mile
w = w[w.pace.between(4.5, 14)]
w['gain_per_mi'] = w.elev_gain_ft.fillna(0) / w.distance_mi
w = w[w.gain_per_mi < 400]
w['hrmax'] = w.groupby('person_id').max_hr.transform('max')
w['phr'] = w.avg_hr / w.hrmax
w['lp'] = np.log(w.pace)
print(f'clean runs: {len(w)} from {w.person_id.nunique()} athletes; with temperature {w.temp_f.notna().sum()}')

# within-athlete demeaned regressions of log pace
def demean(c): return w[c] - w.groupby('person_id')[c].transform('mean')
d = pd.DataFrame({'lp': demean('lp'), 'phr': demean('phr')})
b = (d.phr * d.lp).sum() / (d.phr ** 2).sum()
print(f'log pace per +0.10 of max HR (within athlete): {b * 0.1:+.3f}   residual SD of log pace {np.std(d.lp - b * d.phr):.3f}')
t = w[w.temp_f.notna() & w.dew_point_f.notna()].copy()
t['hot'] = np.clip(t.temp_f + t.dew_point_f - 120, 0, None)
X = np.c_[t.phr - t.groupby('person_id').phr.transform('mean'), t.hot, t.gain_per_mi / 100, np.ones(len(t))]
y = t.lp - t.groupby('person_id').lp.transform('mean')
coef = np.linalg.lstsq(X, y, rcond=None)[0]
print(f'on runs with weather ({len(t)}): log pace per +0.10 max HR {coef[0] * 0.1:+.3f}; per 10 F of (temp+dew-120) above 0 {coef[1] * 10:+.4f}; per +100 ft/mi of climb {coef[2]:+.4f}')
# how steady is a runner's HR-based fitness number from run to run?
ok = w[(w.distance_mi >= 2.5) & (w.moving_sec >= 1200) & w.phr.between(0.65, 0.93) & (w.gain_per_mi < 150)]
vo2 = lambda v: -4.6 + 0.182258 * v + 0.000104 * v * v
v = ok.distance_mi * 1609.344 / (ok.moving_sec / 60)
fit = vo2(v) / ((ok.phr - 0.37) / 0.64)
lf = np.log(fit)
within = lf - lf.groupby(ok.person_id).transform('mean')
print(f'single-run log HR-fitness: within-athlete SD {within.std():.3f} ({ok.shape[0]} runs); between-athlete SD {lf.groupby(ok.person_id).mean().std():.3f}')
ok = ok.assign(lf=lf, month=ok.date.str[:7])
mm = ok.groupby(['person_id', 'month']).lf.agg(['median', 'count'])
mm = mm[mm['count'] >= 4]['median']
dm = (mm - mm.groupby(level=0).transform('mean'))
print(f'monthly median log HR-fitness: within-athlete SD {dm.std():.3f} over {len(mm)} athlete-months (this includes real fitness change, so it is an upper bound on measurement noise)')
print(f'median runs per athlete per 8 weeks: {w.groupby("person_id").size().median() * 56 / max(1, (pd.to_datetime(w.date).max() - pd.to_datetime(w.date).min()).days):.0f}')
