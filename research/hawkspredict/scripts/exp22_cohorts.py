"""'Runners like you' tables from the BMClab marathon days (as exp20). Aggregate numbers only; no athlete rows are written.
 goal bins : by finish time, the 10/25/50/75/90th percentiles of what those finishers trained in the 16 weeks before (weekly miles, last-6-week miles, longest run, runs of 10+ miles,
             running days a week, median pace per mile)
 like bins : weekly miles x median training pace cells -> the 10/25/50/75/90th percentiles of finish time
Cells and bins with fewer than 30 runners are merged or dropped. Output: cohorts.json (shipped as src/cohorts.json).
Usage: exp22_cohorts.py <scratch dir with bmclab_raw/> <out json>"""
import sys, os, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp20_marathon import features, DATES, MARA
S, OUT = sys.argv[1:3]
KM = 1.609344
d = pd.read_parquet(f'{S}/bmclab_raw/run_ww_2019_d.parquet'); d['datetime'] = pd.to_datetime(d.datetime)
race_of = {}
for a, m in d.drop_duplicates('athlete')[['athlete', 'major']].values:
    for tok in str(m).split(','):
        for city, day in DATES.items():
            if tok.strip() == f'{city} 2019': race_of.setdefault(a, []).append((city, pd.Timestamp(day)))
d = d[d.athlete.isin(race_of)].sort_values(['athlete', 'datetime']); rows = []
for a, g in d.groupby('athlete'):
    g = g.set_index('datetime')
    for city, day in race_of[a]:
        w = g.loc[day - pd.Timedelta(days=1): day + pd.Timedelta(days=1)]; w = w[(w.distance >= 40) & (w.distance <= 44.5) & (w.duration > 120) & (w.duration < 420)]
        if len(w) != 1: continue
        r = w.iloc[0]; pre = g.loc[day - pd.Timedelta(days=112): day - pd.Timedelta(days=1)]
        f = features(((day - pre.index.normalize()).days).values, pre.distance.values, pre.duration.values)
        if f is None: continue
        rows.append(dict(sec=float(r.duration * 60 * (MARA / r.distance) ** 1.06), wk_mi=f['wk_mean'] / KM, last6_mi=f['wk_last6'] / KM, longest_mi=f['longest'] / KM, long10=f['long16_n'],
                         days_wk=f['runs_wk'], pace_mi=f['pace_med'] * KM))
X = pd.DataFrame(rows)
print(f'{len(X)} marathon days')
PCT = [10, 25, 50, 75, 90]
q = lambda s: [round(float(np.percentile(s, p)), 2) for p in PCT]
# goal bins: ~4% wide steps in finish time from 2:30 to 6:30
edges = [2.5 * 3600]
while edges[-1] < 6.5 * 3600: edges.append(edges[-1] * 1.04)
goal = []
for lo, hi in zip(edges[:-1], edges[1:]):
    s = X[(X.sec >= lo) & (X.sec < hi)]
    if len(s) < 30: continue
    goal.append(dict(lo=round(lo), hi=round(hi), n=int(len(s)), finish_med=round(float(s.sec.median())), wk_mi=q(s.wk_mi), last6_mi=q(s.last6_mi), longest_mi=q(s.longest_mi),
                     long10=q(s.long10), days_wk=q(s.days_wk), pace_mi=q(s.pace_mi)))
# like cells: weekly miles x pace
wb = [0, 20, 30, 40, 50, 60, 200]; pb = [0, 8.0, 9.0, 10.0, 11.0, 99]
X['w'] = pd.cut(X.wk_mi, wb, labels=False); X['p'] = pd.cut(X.pace_mi, pb, labels=False)
cells = []
for (w, p), s in X.groupby(['w', 'p']):
    if len(s) < 30: continue
    cells.append(dict(w=int(w), p=int(p), n=int(len(s)), finish=[round(float(np.percentile(s.sec, x))) for x in PCT]))
art = dict(name='runners-like-you', source='BMClab long-distance running 2019 (Figshare 16620238, CC BY 4.0): 2019 major marathon days and the 16 weeks of training before them',
           pct=PCT, goal=goal, like=dict(weekly_miles_edges=wb, pace_edges=pb, cells=cells), n=int(len(X)))
json.dump(art, open(OUT, 'w'), separators=(',', ':')); print(f'{len(goal)} goal bins, {len(cells)} like cells -> {OUT} ({os.path.getsize(OUT) / 1024:.1f} KB)')
for g in goal[::3]: print(f"  {g['lo'] // 3600}:{g['lo'] % 3600 // 60:02d}-{g['hi'] // 3600}:{g['hi'] % 3600 // 60:02d} n={g['n']} weekly miles median {g['wk_mi'][2]}, longest {g['longest_mi'][2]}, pace {g['pace_mi'][2]}")
