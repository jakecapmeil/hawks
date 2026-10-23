"""Events HawksPredict-Lite was not trained on: 100, 200, 300, 600, 1000 and the steeplechases (2000 m, 3000 m).
Data: World Athletics all-time top lists (Kaggle mexwell/world-athletics-database; each athlete's best mark per event, elite only)
plus the NRCD collegiate PBs (track and indoor) for the middle-distance pairs.
Model ("HawksPredict-Short"): for every ordered pair of events a log-log line  ln t_target = a + b ln t_source + c male  with its residual SD;
a prediction from several known events is the inverse-variance average, with an interval from the combined SD (inflated and widened for
extrapolation, calibrated by cross-validation). Everything is scored on real marks held out by athlete.
Also tests the 'logical in-between' idea: 600 m from the athlete's 400 m and 800 m (log-log interpolation) against real 600 m marks,
and whether training on formula-made 600 m marks beats training on the real ones.
Usage: exp13_short_events.py <scratch dir (has wa_raw/data.csv and results4.pkl)> <out dir for short_model.json>"""
import json, os, sys
import numpy as np, pandas as pd

S, OUT = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(0)
WA = {'100 Metres': '100', '200 Metres': '200', '300 Metres': '300', '400 Metres': '400', '600 Metres': '600', '800 Metres': '800',
      '1000 Metres': '1000', '1500 Metres': '1500', 'One Mile': '1609', '3000 Metres': '3000', '5000 Metres': '5000',
      '2000 Metres Steeplechase': 'S2000', '3000 Metres Steeplechase': 'S3000'}
METERS = {'100': 100, '200': 200, '300': 300, '400': 400, '600': 600, '800': 800, '1000': 1000, '1500': 1500, '1609': 1609.344, '3000': 3000,
          '5000': 5000, 'S2000': 2000, 'S3000': 3000}
EV = list(METERS)
def log(s=''): print(s, flush=True)

# ---- data: one best mark per athlete and event
d = pd.read_csv(f'{S}/wa_raw/data.csv', sep=';', low_memory=False).rename(columns={'Mark [meters or seconds]': 'mark'})
d = d[d.Event.isin(WA)].copy(); d['ev'] = d.Event.map(WA)
d['w'] = pd.to_numeric(d.Wind.astype(str).str.replace(',', '.'), errors='coerce')
d = d[~(d.ev.isin(['100', '200']) & (d.w > 2.0))]
d['mark'] = pd.to_numeric(d.mark, errors='coerce'); d = d[d.mark > 5]
d['aid'] = 'w' + (d.Competitor + '|' + d.DOB.astype(str) + '|' + d.Sex).factorize()[0].astype(str)
wa = d.groupby(['aid', 'ev']).agg(t=('mark', 'min'), male=('Sex', lambda s: float(s.iloc[0] == 'male'))).reset_index(); wa['src'] = 'wa'
r = pd.read_pickle(f'{S}/results4.pkl'); r = r[r.surf.isin(['track', 'indoor'])]
nm = {400: '400', 800: '800', 1000: '1000', 1500: '1500', 3000: '3000', 5000: '5000'}
rr = r[r.m.round().isin(nm) | np.isclose(r.m, 1609.34) | np.isclose(r.m, 1600)].copy()
rr['ev'] = np.where(np.isclose(rr.m, 1609.34) | np.isclose(rr.m, 1600), '1609', rr.m.round().map(nm))
rr['t'] = np.where(np.isclose(rr.m, 1600), rr.sec * (1609.344 / 1600) ** 1.06, rr.sec)
nr = rr.groupby(['athlete_id', 'ev']).agg(t=('t', 'min'), male=('male', 'first')).reset_index().rename(columns={'athlete_id': 'aid'})
nr['aid'] = 'n' + nr.aid.astype(str); nr['src'] = 'nrcd'
A = pd.concat([wa, nr]); A['lt'] = np.log(A.t)
P = A.pivot_table(index='aid', columns='ev', values='lt'); info = A.groupby('aid').agg(male=('male', 'first'), src=('src', 'first')).loc[P.index]
log(f'## exp13 short events\nathletes {len(P)} (World Athletics {int((info.src == "wa").sum())}, NRCD {int((info.src == "nrcd").sum())}); athletes with marks per event:')
log('| event | athletes |\n|---|---|\n' + '\n'.join(f'| {e} | {int(P[e].notna().sum())} |' for e in EV))

# ---- 1. the logical in-between test: 600 from 400 and 800
def interp(a, b, ma, mb, m): return a + (b - a) * (np.log(m) - np.log(ma)) / (np.log(mb) - np.log(ma))
log('\n### In-between formula vs real marks (log-log interpolation of the neighbours; Riegel k=1.06 from one neighbour)')
log('| target | neighbours | n | interpolation | Riegel from lower | Riegel from upper | mean bias of interpolation |\n|---|---|---|---|---|---|---|')
for t, lo, hi in [('600', '400', '800'), ('1000', '800', '1500'), ('300', '200', '400'), ('1609', '1500', '3000')]:
    m = P[[t, lo, hi]].dropna()
    if len(m) < 8: continue
    y = m[t].values; pi = interp(m[lo].values, m[hi].values, METERS[lo], METERS[hi], METERS[t])
    pl = m[lo].values + 1.06 * (np.log(METERS[t]) - np.log(METERS[lo])); pu = m[hi].values + 1.06 * (np.log(METERS[t]) - np.log(METERS[hi]))
    mae = lambda p: f'{100 * np.mean(np.abs(np.expm1(p - y))):.2f}%'
    log(f'| {t} | {lo}, {hi} | {len(m)} | {mae(pi)} | {mae(pl)} | {mae(pu)} | {100 * np.mean(np.expm1(pi - y)):+.2f}% |')

# ---- 2. pair models, cross-validated by athlete
SPRINTISH = lambda e: e in ('100', '200', '300', '400') or e.startswith('S')
def fit_pairs(Ptr, itr, minn=100, hybrid=True):
    # 600 m is rare in the top lists, so its pairs are allowed fewer athletes
    M = {}
    for s in EV:
        for t in EV:
            if s == t: continue
            m = Ptr[[s, t]].dropna()
            if len(m) < (30 if ('600' in (s, t) or 'S2000' in (s, t)) else minn): continue
            X = np.c_[np.ones(len(m)), m[s].values, itr.loc[m.index, 'male'].values]
            if hybrid and (SPRINTISH(s) or SPRINTISH(t)) and (s in ('100', '200', '300') or t in ('100', '200', '300') or s.startswith('S') or t.startswith('S')):
                # Elite sprinters span a narrow range, so a free slope is flattened (regression dilution) and fails on slower runners.
                # Fix the slope at 1 (a constant ratio between the two events) and fit the offset and the sex shift.
                z = m[t].values - m[s].values; Z2 = np.c_[np.ones(len(m)), itr.loc[m.index, 'male'].values]
                cc, *_ = np.linalg.lstsq(Z2, z, rcond=None); coef = np.array([cc[0], 1.0, cc[1]]); res = z - Z2 @ cc
            else:
                coef, *_ = np.linalg.lstsq(X, m[t].values, rcond=None); res = m[t].values - X @ coef
            M[(s, t)] = (coef, float(res.std()), len(m))
    return M
def predict(M, known, t, male, infl, extra=0.0):
    ps, ws = [], []
    for s, y in known.items():
        if (s, t) in M:
            (a, b, c), sd, n = M[(s, t)]; ps.append(a + b * y + c * male); ws.append(1 / sd ** 2)
    if not ps: return None
    w = np.array(ws); mu = float((np.array(ps) * w).sum() / w.sum()); sd = float(np.sqrt(1 / w.sum()) * infl)
    return mu, float(np.sqrt(sd ** 2 + extra ** 2))
folds = rng.integers(0, 5, len(P)); idx = np.arange(len(P))
cases = []                                                              # (athlete row, target, known dict) - fixed subsets so methods compare on the same cases
for i in range(len(P)):
    row = P.iloc[i]; have = [e for e in EV if not np.isnan(row[e])]
    for t in have:
        others = [e for e in have if e != t]
        if not others: continue
        k = int(rng.integers(1, min(3, len(others)) + 1)); sel = list(rng.choice(others, k, replace=False))
        cases.append((i, t, {e: row[e] for e in sel}))
log(f'\n### Pair models, 5-fold by athlete ({len(cases)} held-out predictions; 1-3 other events known)')
by_t = {t: [] for t in EV}; by_free = {t: [] for t in EV}
for k in range(5):
    tr = folds != k; M = fit_pairs(P[tr], info[tr]); Mf = fit_pairs(P[tr], info[tr], hybrid=False)
    for i, t, kn in cases:
        if folds[i] != k: continue
        mal = info.male.iloc[i]
        pr = predict(M, kn, t, mal, 1.0)
        if pr is None: continue
        y = P.iloc[i][t]; src = info.src.iloc[i]
        near = min(kn, key=lambda e: abs(np.log(METERS[e]) - np.log(METERS[t]))); rg = kn[near] + 1.06 * (np.log(METERS[t]) - np.log(METERS[near]))
        by_t[t].append((y, pr[0], pr[1], rg, src, len(kn)))
        pf = predict(Mf, kn, t, mal, 1.0)
        if pf: by_free[t].append((y, pf[0]))
# calibrate the interval inflation once, on all held-out cases
allr = [(y - mu) / sd for t in EV for (y, mu, sd, *_ ) in by_t[t]]
infl = float(np.quantile(np.abs(allr), 0.8) / 1.2816)
log(f'interval inflation factor from cross-validation: {infl:.2f}')
log('| target | n | HawksPredict-Short | nearest-event Riegel | 80% interval coverage | elite (WA) | collegiate (NRCD) |\n|---|---|---|---|---|---|---|')
tab = {}
for t in EV:
    v = by_t[t]
    if len(v) < 30: continue
    y = np.array([x[0] for x in v]); mu = np.array([x[1] for x in v]); sd = np.array([x[2] for x in v]) * infl; rg = np.array([x[3] for x in v]); src = np.array([x[4] for x in v])
    e = lambda p, m=slice(None): f'{100 * np.mean(np.abs(np.expm1(p[m] - y[m]))):.2f}%' if len(y[m]) else '-'
    cov = np.mean(np.abs(y - mu) <= 1.2816 * sd)
    fr = by_free[t]; free_mae = float(np.mean([abs(np.expm1(mu_ - y_)) for y_, mu_ in fr])) if fr else None
    tab[t] = dict(free_slope_mae=free_mae, n=len(y), mae=float(np.mean(np.abs(np.expm1(mu - y)))), riegel=float(np.mean(np.abs(np.expm1(rg - y)))), cov=float(cov))
    log(f'| {t} | {len(y)} | {e(mu)} (free slope {100 * free_mae:.2f}%) | {e(rg)} | {100 * cov:.0f}% | {e(mu, src == "wa")} (n={int((src == "wa").sum())}) | {e(mu, src == "nrcd")} (n={int((src == "nrcd").sum())}) |')

# ---- 3. synthetic in-between marks: do they help the 600?
log('\n### Does training on formula-made in-between marks help? Target 600 m, tested on real 600 m marks')
real600 = P.index[P['600'].notna() & P['400'].notna() & P['800'].notna()]
if len(real600) >= 8:
    tr_ids = P.index.difference(real600)
    cand = P.loc[tr_ids]; cand = cand[cand['400'].notna() & cand['800'].notna()]
    syn = cand.copy(); syn['600'] = interp(syn['400'].values, syn['800'].values, 400, 800, 600) + rng.normal(0, 0.012, len(syn))
    out = []
    for name, base in [('real 600 marks only (none outside the test set)', P.loc[tr_ids]), ('formula-made 600 marks (400 + 800 athletes)', syn), ('both', pd.concat([P.loc[tr_ids], syn]))]:
        base = base.copy()
        if name.startswith('real'):
            out.append((name, None)); continue
        ii = pd.concat([info.loc[tr_ids], info.loc[syn.index]]) if name == 'both' else info.loc[syn.index]
        ii = ii[~ii.index.duplicated()]; base = base[~base.index.duplicated()]
        M = fit_pairs(base, ii.loc[base.index], minn=40)
        errs = []
        for aid in real600:
            kn = {e: P.loc[aid, e] for e in ('400', '800')}; pr = predict(M, kn, '600', info.loc[aid, 'male'], 1.0)
            if pr: errs.append(abs(np.expm1(pr[0] - P.loc[aid, '600'])))
        out.append((name, 100 * float(np.mean(errs))))
    yy = P.loc[real600]; ip = interp(yy['400'].values, yy['800'].values, 400, 800, 600); ie = 100 * float(np.mean(np.abs(np.expm1(ip - yy['600'].values))))
    log(f'real 600 m marks with a 400 and an 800 (test): {len(real600)}\n| method | error |\n|---|---|\n| log-log interpolation, no training | {ie:.2f}% |')
    for n, v in out:
        if v is not None: log(f'| pair model trained on {n} | {v:.2f}% |')

# ---- 4. final models on everything, export
# 600 m is too rare in the top lists (133 athletes), so athletes with a 400 and an 800 and no 600 get a formula-made 600:
# log-log interpolation plus the +1.7% the interpolation is too fast by (mean of its bias on real 600 m and 1000 m marks).
BIAS = 0.017
need = P['400'].notna() & P['800'].notna() & P['600'].isna()
Psyn = P.copy(); Psyn.loc[need, '600'] = interp(P.loc[need, '400'].values, P.loc[need, '800'].values, 400, 800, 600) + BIAS + rng.normal(0, 0.012, int(need.sum()))
log(f'formula-made 600 m marks added for the final fit: {int(need.sum())} (real 600 m marks: {int(P["600"].notna().sum())})')
M = fit_pairs(Psyn, info)
art = dict(name='HawksPredict-Short', version='v1', infl=infl, events={e: METERS[e] for e in EV}, extra_sd={'100': 0.04, '200': 0.04, '300': 0.03, '600': 0.025},   # added log-SD where the training marks do not cover the athletes it is used for (non-elite sprinters; formula-made 600s)
           
           pairs=[dict(s=s, t=t, a=float(c[0]), b=float(c[1]), c=float(c[2]), sd=sd, n=n) for (s, t), (c, sd, n) in M.items()],
           trained_on='World Athletics all-time top lists (best mark per athlete and event; elite) and NRCD collegiate PBs (CC-BY-4.0)',
           cv=tab)
os.makedirs(OUT, exist_ok=True)
json.dump(art, open(f'{OUT}/short_model.json', 'w'), separators=(',', ':'))
log(f'\nexported {len(art["pairs"])} pair models, {os.path.getsize(f"{OUT}/short_model.json") / 1024:.0f} KB')
