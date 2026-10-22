"""Exploratory: does the change in heart-rate fitness since a runner's last race explain Lite's miss on the next race?
Five single-runner public logs, race-like efforts detected by rule. Not a validation."""
import sys, json, numpy as np, pandas as pd
sys.argv = [sys.argv[0]] + sys.argv[1:]
S = sys.argv[1]
sys.path.insert(0, '.'); sys.argv = [sys.argv[0], S + '/kaggle_raw']
import hr_load; D = hr_load.D
from lite import lite_feats
art = json.load(open(f'{S}/pace_lite.json'))
def lite_pred(f):
    x = np.array([f[k] for k in art['feats']], float); r = art['init']
    for t in art['trees']:
        f_ = np.array(t['f']); th = np.array(t['t']); l_ = np.array(t['l']); r_ = np.array(t['r']); v_ = np.array(t['v']); mg = np.array(t['mgl']); n = 0
        while f_[n] >= 0:
            xv = x[f_[n]]; left = (mg[n] == 1) if np.isnan(xv) else xv <= th[n]; n = l_[n] if left else r_[n]
        r += v_[n]
    return f['base'] + r
def vo2at(v): return -4.6 + 0.182258 * v + 0.000104 * v * v
STD = [1.609, 3.0, 3.2, 5.0, 8.0, 10.0, 21.0975]
rows = []
for rn, d in D.groupby('runner'):
    d = d.reset_index(drop=True); med = d.pace.median()
    d['race'] = [any(abs(x.km / k - 1) < 0.03 for k in STD) and x.pace < med * 0.88 for _, x in d.iterrows()]
    hrmax = d.mx.max() if d.mx.notna().any() else (d.hr.quantile(0.995) * 1.08 if d.hr.notna().any() else np.nan)
    if not np.isfinite(hrmax): continue
    def fit(t):
        w = d[(~d.race) & d.hr.notna() & (d.date < t) & (d.date >= t - pd.Timedelta(days=56)) & (d.km >= 4) & (d.sec >= 1200)]
        w = w[(w.hr / hrmax >= 0.65) & (w.hr / hrmax <= 0.93) & ((w.elev.fillna(0) / w.km) <= 28)]
        if len(w) < 4: return np.nan
        p = w.hr / hrmax; v = 1000 * w.km / (w.sec / 60); return float(np.median(vo2at(v) / ((p - 0.37) / 0.64)))
    R = d[d.race].reset_index(drop=True)
    for i in range(1, len(R)):
        e = R.iloc[i]; pri = R.iloc[:i]; pri = pri[(e.date - pri.date).dt.days <= 730]
        if not len(pri): continue
        m = lambda km: km * 1000
        f = lite_feats([m(k) for k in pri.km], list(pri.sec), ['road'] * len(pri), m(e.km), 'road', 1.0)
        lp = lite_pred(f); last = pri.iloc[-1]
        fe, fr = fit(e.date), fit(last.date)
        rows.append(dict(runner=rn, date=e.date, km=e.km, ln_y=np.log(e.sec), lite=lp, gap_days=(e.date - last.date).days, dhr=np.log(fe / fr) if np.isfinite(fe) and np.isfinite(fr) else np.nan))
T = pd.DataFrame(rows); T['miss'] = T.ln_y - T.lite
print(f'race-like targets with a prior race: {len(T)}; with an HR-fitness change: {T.dhr.notna().sum()}; runners: {T[T.dhr.notna()].runner.nunique()}')
U = T[T.dhr.notna()].reset_index(drop=True)
if len(U) >= 8:
    rng = np.random.default_rng(0)
    def mae(x): return 100 * np.mean(np.abs(np.expm1(x)))
    adj = U.lite - np.clip(0.5 * U.dhr, -0.03, 0.03); raw_e = (U.ln_y - U.lite).values; adj_e = (U.ln_y - adj).values
    sl = lambda df: np.polyfit(df.dhr, df.miss, 1)[0]
    ath = U.runner.unique(); bs = []; ds = []
    for _ in range(2000):
        ix = np.concatenate([U.index[U.runner == a].values for a in rng.choice(ath, len(ath))])
        if len(ix) < 5: continue
        ds.append(mae(raw_e[ix]) - mae(adj_e[ix]))
        try: bs.append(sl(U.loc[ix]))
        except Exception: pass
    print(f'n={len(U)} MAE raw Lite {mae(raw_e):.2f}%  HR-adjusted (50% shrink, cap 3%) {mae(adj_e):.2f}%  gain {np.mean(ds):+.2f} pts, 95% CI {np.percentile(ds,2.5):+.2f} to {np.percentile(ds,97.5):+.2f}')
    print(f'slope of miss on HR-fitness change: {sl(U):+.2f} (expected negative if HR helps; CI {np.percentile(bs,2.5):+.2f} to {np.percentile(bs,97.5):+.2f})')
    print('corr(miss, dhr) =', round(float(np.corrcoef(U.miss, U.dhr)[0, 1]), 3), '| per runner n:', U.runner.value_counts().to_dict())
print('median |miss| raw Lite on all targets:', round(mae(T.miss.values), 2), '%  bias:', round(100 * np.mean(np.expm1(T.miss)), 2), '%')
