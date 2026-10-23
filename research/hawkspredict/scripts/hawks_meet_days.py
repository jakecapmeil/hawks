"""On each meet date, which synced Hawks athletes logged a high-effort run? Prints anonymised, per-date counts and effort numbers only.
Usage: hawks_meet_days.py <workouts.csv> <dates.txt>   (dates.txt: one 'YYYY-MM-DD label' per line)"""
import sys
import numpy as np
import pandas as pd

w = pd.read_csv(sys.argv[1])
dates = [l.split(None, 1) for l in open(sys.argv[2]).read().strip().splitlines()]
ids = {k: f'a{i}' for i, k in enumerate(sorted(w.person_id.unique()))}
w['a'] = w.person_id.map(ids)
w = w[(w.sport == 'Run') & (w.distance_mi > 0.3)].copy()
w['hrmax'] = w.groupby('person_id').max_hr.transform('max')
w['phr'] = w.avg_hr / w.hrmax
w['pace'] = w.moving_sec / 60 / w.distance_mi
print('hr_effort / effort ranges:', w.hr_effort.min(), w.hr_effort.max(), w.effort.min(), w.effort.max())
print('effort quantiles over all runs:', w.effort.quantile([.5, .75, .9]).tolist(), ' hr_effort:', w.hr_effort.quantile([.5, .75, .9]).tolist())
hi_e, hi_h = w.effort.quantile(.9), w.hr_effort.quantile(.9)
tot = 0
for d, label in dates:
    day = w[w.date == d]
    if day.empty:
        print(f'{d} {label[:34]:34} no synced runs'); continue
    syn = day.person_id.nunique()
    hi = day[(day.category == 'race') | (day.effort >= hi_e) | (day.hr_effort >= hi_h)]
    tot += hi.a.nunique()
    desc = '; '.join(f'{r.a} {r.category} {r.distance_mi:.1f}mi {r.pace:.1f}min/mi hrE={r.hr_effort} E={r.effort}' for r in hi.itertuples())
    print(f'{d} {label[:34]:34} synced {syn}, high-effort {hi.a.nunique()}  {desc}')
print('athlete-days with a high-effort run on a meet date:', tot)
