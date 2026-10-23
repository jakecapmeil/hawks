"""Synthetic training logs (pace, heart rate, temperature, elevation) and a power analysis for the heart-rate correction.
The simulator's constants are pooled numbers from the Hawks runs (hawks_calibrate.py). The link between a real fitness change and the
heart-rate trend, `COUPLING`, cannot be estimated from any data we hold, so it is a swept parameter, including 0. Nothing here is
evidence that the correction helps; it says how many logged races would be needed to find out, and how much the answer depends on COUPLING.
Usage: synth_hr_power.py [out_dir]  (writes a small sample of synthetic runs, labelled synthetic, if out_dir is given)"""
import os, sys
import numpy as np
import pandas as pd

rng = np.random.default_rng(7)
# pooled constants from hawks_calibrate.py
SD_RUN = 0.126          # single-run SD of log HR-fitness within athlete (includes real day-to-day variation)
HEAT = 0.0203           # log pace per 10 F of (temp + dew point - 120) above zero
HILL = 0.0938           # log pace per 100 ft/mi of climb
RUNS_8WK = 23           # runs per 8-week window with heart rate
SD_G = 0.025            # SD of true fitness change between the newest result and race day (log)
SD_LITE_REST = 0.050    # the part of Lite's miss that is not fitness change (log SD; Lite MAE is about 4.4%)
CREDIT = 0.7            # share of heat/hill cost the estimator credits back correctly
SHRINK, CAP = 0.5, 0.03

vo2 = lambda v: -4.6 + 0.182258 * v + 0.000104 * v * v

def window(logF, hrmax, n, month):
    """One 8-week window of runs for a runner of true fitness exp(logF); returns the estimator's HR-fitness (median) or None."""
    est = []
    for _ in range(n):
        temp = 45 + 30 * np.sin((month - 3) / 12 * 2 * np.pi) + rng.normal(0, 8); dew = temp - rng.uniform(8, 30)
        hot = max(0.0, temp + dew - 120); climb = max(0.0, rng.gamma(2, 40))
        phr = rng.uniform(0.70, 0.88)
        # speed at which this runner holds that %HRmax, from the same Swain relation the app uses, plus effort noise and weather cost
        vo2_run = ((phr - 0.37) / 0.64) * np.exp(logF)
        v = (-0.182258 + np.sqrt(0.182258 ** 2 + 4 * 0.000104 * (vo2_run + 4.6))) / (2 * 0.000104)
        v *= np.exp(rng.normal(0, SD_RUN * 0.8)) / np.exp(HEAT * hot / 10 + HILL * climb / 100)
        credited = v * np.exp(CREDIT * (HEAT * hot / 10 + HILL * climb / 100))
        est.append(np.log(vo2(credited) / ((phr - 0.37) / 0.64)))
    return float(np.median(est))

def simulate(c, n_races, shrink=SHRINK, cap=CAP):
    g = rng.normal(0, SD_G, n_races)                                   # true fitness change (positive = fitter)
    rest = rng.normal(0, SD_LITE_REST, n_races)
    miss = -g + rest                                                    # log(actual / Lite): fitter than the PR -> faster than Lite
    h = np.empty(n_races)
    base_F = np.log(rng.uniform(45, 70, n_races))
    for i in range(n_races):
        then = window(base_F[i], 190, RUNS_8WK, 8); now = window(base_F[i] + c * g[i], 190, RUNS_8WK, 9)
        h[i] = now - then
    adj = np.clip(shrink * h, -cap, cap)
    err_raw = np.abs(np.expm1(miss)); err_adj = np.abs(np.expm1(miss + adj))   # adjusted time = Lite * exp(-adj) -> miss + adj
    return err_raw, err_adj, h, g

print('| coupling c | corr(HR trend, true change) | gain of shipped correction (points) | races needed for 80% power |\n|---|---|---|---|')
for c in (0.0, 0.25, 0.5, 1.0):
    er, ea, h, g = simulate(c, 4000)
    gain = 100 * (ea.mean() - er.mean()); corr = np.corrcoef(h, g)[0, 1] if c else 0.0
    need = None
    for n in (20, 30, 50, 80, 120, 200, 400, 800):
        hits = 0
        for _ in range(150):
            i = rng.integers(0, len(er), n); d = ea[i] - er[i]
            hits += (d.mean() < 0) and (abs(d.mean()) / (d.std(ddof=1) / np.sqrt(n)) > 1.96)
        if hits / 150 >= 0.8: need = n; break
    print(f'| {c:.2f} | {corr:+.2f} | {gain:+.2f} | {need if need else "> 800"} |')

print('\nBest shrink depends entirely on the unknown coupling (MAE points vs Lite alone, 4000 simulated races):')
print('| coupling c | shrink 0.25 | 0.5 | 1.0 | 2.0 |\n|---|---|---|---|---|')
for c in (0.0, 0.5, 1.0):
    cells = []
    for s in (0.25, 0.5, 1.0, 2.0):
        er, ea, _, _ = simulate(c, 3000, shrink=s, cap=0.06)
        cells.append(f'{100 * (ea.mean() - er.mean()):+.2f}')
    print(f'| {c:.2f} | ' + ' | '.join(cells) + ' |')

if len(sys.argv) > 1:
    os.makedirs(sys.argv[1], exist_ok=True)
    rows = []
    for a in range(30):
        F = np.log(rng.uniform(45, 70)); hrmax = rng.integers(185, 205)
        for d in range(56):
            if rng.random() > 0.45: continue
            month = 9 + d / 30; temp = 62 + 20 * np.sin((month - 3) / 12 * 2 * np.pi) + rng.normal(0, 8); dew = temp - rng.uniform(8, 30)
            climb = rng.gamma(2, 40); phr = rng.uniform(0.70, 0.88); mi = rng.uniform(3, 7)
            v = (-0.182258 + np.sqrt(0.182258 ** 2 + 4 * 0.000104 * (((phr - 0.37) / 0.64) * np.exp(F) + 4.6))) / (2 * 0.000104)
            v *= np.exp(rng.normal(0, SD_RUN * 0.8) - HEAT * max(0, temp + dew - 120) / 10 - HILL * climb / 100)
            rows.append(dict(synthetic=1, athlete=f's{a}', day=d, distance_mi=round(mi, 2), moving_sec=int(mi * 1609.344 / v * 60), avg_hr=int(phr * hrmax),
                             temp_f=round(temp, 1), dew_point_f=round(dew, 1), elev_gain_ft=int(climb * mi)))
    pd.DataFrame(rows).to_csv(os.path.join(sys.argv[1], 'synthetic_runs_sample.csv'), index=False)
    print(f'wrote {len(rows)} synthetic runs')
