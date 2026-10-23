"""Reduce FitRec's raw endomondoHR.json (one Python-dict workout per line, per-sample speed km/h, heart rate, altitude m) to one row per run.
FitRec is academic-use-only and not redistributable, so only this derived table is kept locally (never committed).
Usage: unzip -p endomondoHR.json.zip | fitrec_summarize.py <out.csv>"""
import ast
import csv
import sys

import numpy as np

out = csv.writer(open(sys.argv[1], 'w', newline=''))
out.writerow(['user', 'sport', 't0', 'n', 'dur_s', 'dist_km', 'avg_hr', 'max_hr', 'hr_first_half', 'hr_second_half', 'gain_m', 'loss_m', 'speed_cv'])
n_in = n_out = 0
for line in sys.stdin:
    n_in += 1
    if n_in % 20000 == 0:
        print(n_in, n_out, file=sys.stderr, flush=True)
    try:
        d = ast.literal_eval(line)
        if d.get('sport') != 'run':
            continue
        ts = np.asarray(d['timestamp'], float); sp = np.asarray(d['speed'], float); hr = np.asarray(d['heart_rate'], float)
        alt = np.asarray(d.get('altitude', []), float)
        if len(ts) < 30 or len(sp) != len(ts) or len(hr) != len(ts):
            continue
        dt = np.diff(ts, prepend=ts[0]); dt[dt < 0] = 0; dt[dt > 60] = 0   # drop pauses
        dist = float((sp / 3.6 * dt).sum() / 1000); dur = float(dt.sum())
        ok = hr > 0
        if dur < 300 or dist < 0.5 or ok.sum() < 20:
            continue
        h = np.where(ok)[0]; half = h[len(h) // 2]
        da = np.diff(alt) if len(alt) == len(ts) else np.array([0.0])
        out.writerow([d['userId'], d['sport'], int(ts[0]), len(ts), round(dur), round(dist, 3), round(hr[ok].mean(), 1), int(hr.max()),
                      round(hr[:half][hr[:half] > 0].mean(), 1) if (hr[:half] > 0).any() else '', round(hr[half:][hr[half:] > 0].mean(), 1),
                      round(float(da[da > 0].sum()), 1), round(float(-da[da < 0].sum()), 1), round(float(sp[sp > 0].std() / sp[sp > 0].mean()), 3)])
        n_out += 1
    except Exception:
        continue
print('lines', n_in, 'runs kept', n_out, file=sys.stderr)
