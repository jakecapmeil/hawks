"""Weather, altitude and age: what do they do to a time, measured on residuals of models that never saw them?
 A. Ontario holdout (spring track): Lite v1.1-train-half residuals vs temperature + dew point (the quantity the app's Hadley chart uses), by event group; wind on 100/200.
 B. NRCD (cross country and track): out-of-fold Lite residuals vs temperature, and vs altitude.
 C. Age: Ontario residuals by grade category and sex (Lite and Short v1.1); World Athletics pair-line residuals by the age of the mark.
Residual r = ln(actual) - ln(predicted); r > 0 means slower than predicted.   Usage: exp18_conditions_age.py <scratch> <repo root>"""
import sys, json
import exp14_common as C
from exp14_fit import *

S, ROOT = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(0)
def f_(c): return c * 9 / 5 + 32
def dew_c(t, rh):
    g = np.log(np.clip(rh, 1, 100) / 100) + 17.62 * t / (243.12 + t); return 243.12 * g / (17.62 - g)
HEAT = [[100, 0], [110, 0.005], [120, 0.01], [130, 0.02], [140, 0.03], [150, 0.045], [160, 0.06], [170, 0.08], [180, 0.1], [200, 0.14]]
def hadley(x): return float(np.interp(x, [h[0] for h in HEAT], [h[1] for h in HEAT]))
def cluster_ci(df, col, key, n=400):
    """CI of the mean of `col` resampling clusters `key`."""
    g = df.groupby(key)[col].agg(['sum', 'count']); s, c = g['sum'].values, g['count'].values; k = len(g); bs = []
    for _ in range(n):
        i = rng.integers(0, k, k); bs.append(s[i].sum() / max(c[i].sum(), 1))
    return np.percentile(bs, [2.5, 97.5])

# ---------------- A. Ontario
o_all = pd.read_pickle(f'{S}/results_ont.pkl'); o = o_all[o_all.m >= 400]
XL = pd.read_pickle(f'{S}/ont_rows_lite.pkl'); H = XL[XL.holdout].reset_index(drop=True)
H['r'] = H.y - (H.base + C.lite_predict_json(json.load(open(f'{S}/aug_train/pace_lite.json')), H))
k = o[['athlete_id', 'date', 'm', 'temperature', 'humidity', 'wind', 'category', 'meet_id']].rename(columns={'m': 'target_m'})
H = H.merge(k, on=['athlete_id', 'date', 'target_m'], how='left')
H['tc'] = (H.temperature - 32) * 5 / 9; H['dc'] = dew_c(H.tc, H.humidity); H['sumF'] = H.temperature + f_(H.dc)
H['grp'] = np.where(H.target_m <= 800, '400-800 m', np.where(H.target_m <= 1500, '1500 m', '3000 m'))
print(f'## A. Ontario holdout: {len(H)} races; temperature {H.tc.min():.0f} to {H.tc.max():.0f} C, temperature + dew point {H.sumF.min():.0f} to {H.sumF.max():.0f} F')
bins = [0, 90, 100, 110, 120, 200]; lab = ['<90', '90-100', '100-110', '110-120', '120+']; H['bin'] = pd.cut(H.sumF, bins, labels=lab)
print('\nResidual (% slower than Lite predicts, mean) by temperature + dew point:\n| group | ' + ' | '.join(lab) + ' | slope per +10 F above 100 (95% CI by meet) | Hadley chart says (continuous) |\n|---|' + '---|' * (len(lab) + 2))
for gname, gg in list(H.groupby('grp')) + [('all', H)]:
    cells = []
    for b in lab:
        s = gg[gg.bin == b]; cells.append(f'{100 * np.expm1(s.r.mean()):+.2f}% (n={len(s)})' if len(s) >= 15 else f'n={len(s)}')
    z = gg.dropna(subset=['sumF']).copy(); z['x'] = np.maximum(z.sumF - 100, 0) / 10; z['rc'] = z.r - z.r.mean()
    slope = (z.x - z.x.mean()).pipe(lambda a: (a * z.rc).sum() / (a ** 2).sum())
    bs = []; mk = z.groupby('meet_id').indices
    keys = list(mk)
    for _ in range(300):
        ii = np.concatenate([mk[q] for q in rng.choice(keys, len(keys))]); zz = z.iloc[ii]; a = zz.x - zz.x.mean(); bs.append((a * (zz.r - zz.r.mean())).sum() / (a ** 2).sum())
    print(f'| {gname} | ' + ' | '.join(cells) + f' | {100 * slope:+.2f}% ({100 * np.percentile(bs, 2.5):+.2f} to {100 * np.percentile(bs, 97.5):+.2f}) | {100 * (hadley(120) - hadley(110)):.1f}% per 10 F near 115 |')
print('\nWind on sprints (Short v1.1 residual; wind in m/s, tailwind positive):')
sp = o_all[(o_all.m <= 200) & o_all.wind.notna()].copy()
if len(sp):
    SH = json.load(open(f'{ROOT}/src/shortmodel.json')); PAIRS = {f"{p['s']}>{p['t']}": p for p in SH['pairs']}
    oo = o_all.copy(); oo['yr'] = oo.date.dt.year; rows = []
    for (aid, yr), g in oo[oo.holdout].groupby(['athlete_id', 'yr']):
        g = g.drop_duplicates('m')
        for _, t in g[g.m <= 200].iterrows():
            if pd.isna(t.wind): continue
            src = [q for _, q in g.iterrows() if q.m != t.m and q.m >= 200 and f"{int(q.m)}>{int(t.m)}" in PAIRS]
            if not src: continue
            q = min(src, key=lambda q: abs(np.log(q.m / t.m))); p = PAIRS[f"{int(q.m)}>{int(t.m)}"]
            rows.append(dict(m=t.m, wind=t.wind, r=np.log(t.sec) - (p['a'] + p['b'] * np.log(q.sec) + p['c'] * t.male)))
    W = pd.DataFrame(rows)
    for m, g in W.groupby('m'):
        wc = g.wind - g.wind.mean(); sl = (wc * (g.r - g.r.mean())).sum() / (wc ** 2).sum()
        print(f'  {int(m)} m: n={len(g)}, wind {g.wind.min():+.1f} to {g.wind.max():+.1f}; time changes {100 * sl:+.2f}% per +1 m/s of tailwind ({100 * sl * np.exp(np.log(12.2 if m == 100 else 25.2)):+.0f} hundredths of a second at the median time)')

# ---------------- B. NRCD
P, F, PL, FL = load_nrcd(S)
PL = PL.copy(); PL['p'] = oof(PL, None, 'l'); PL['r'] = PL.y - PL.p
X4 = P[['athlete_id', 'date', 'target_m', 'temp', 'alt', 'surf_s']].copy(); X4['date'] = pd.to_datetime(X4.date)
Z = PL.merge(X4, on=['athlete_id', 'date', 'target_m'], how='left')
print(f'\n## B. NRCD out-of-fold Lite residuals: {len(Z)} races; with temperature {int(Z.temp.notna().sum())}, with altitude {int(Z.alt.notna().sum())}')
tb = [0, 40, 50, 60, 70, 80, 120]; tl = ['<40', '40-50', '50-60', '60-70', '70-80', '80+']
Z['tbin'] = pd.cut(Z.temp, tb, labels=tl)
print('\nMean residual by air temperature (F; no dew point in this data):\n| surface | ' + ' | '.join(tl) + ' |\n|---|' + '---|' * len(tl))
for sname, g in (('cross country', Z[Z.surf_s == 'xc']), ('track/indoor', Z[Z.surf_s.isin(['track', 'indoor'])]), ('road', Z[Z.surf_s == 'road'])):
    cells = []
    for b in tl:
        s = g[g.tbin == b]; cells.append(f'{100 * np.expm1(s.r.mean()):+.2f}% (n={len(s)})' if len(s) >= 30 else f'n={len(s)}')
    print(f'| {sname} | ' + ' | '.join(cells) + ' |')
ab = [-1, 500, 1000, 2000, 4000, 12000]; al = ['<500 ft', '500-1000', '1000-2000', '2000-4000', '4000+']; Z['abin'] = pd.cut(Z.alt, ab, labels=al)
print('\nMean residual by altitude (as recorded; cross country and track together):\n| ' + ' | '.join(al) + ' |\n|' + '---|' * len(al) + '\n| ' + ' | '.join(f'{100 * np.expm1(Z[Z.abin == b].r.mean()):+.2f}% (n={int((Z.abin == b).sum())})' for b in al) + ' |')

# ---------------- C. Age
print('\n## C. Age')
H['cat'] = H.category.astype(str)
print('Ontario holdout, Lite v1.1-train-half residual by grade category and sex (mean % slower than predicted; MAE):\n| category | sex | n | mean residual | MAE |\n|---|---|---|---|---|')
for (c, sx), g in H.groupby(['cat', 'male']):
    if len(g) >= 40: print(f'| {c} | {"male" if sx else "female"} | {len(g)} | {100 * np.expm1(g.r.mean()):+.2f}% | {100 * np.abs(np.expm1(g.r)).mean():.2f}% |')
wa = pd.read_csv(f'{S}/ds/world-athletics-all-time-rankings/world-athletics_all-time-top-lists.csv', low_memory=False,
                 usecols=['event_name', 'mark', 'competitor', 'date_of_birth', 'age', 'gender', 'age_category', 'environment', 'wind'])
EVN = {'100-metres': '100', '200-metres': '200', '400-metres': '400', '800-metres': '800', '1500-metres': '1500', 'one-mile': '1609', '3000-metres': '3000', '5000-metres': '5000'}
wa = wa[(wa.environment == 'outdoor') & wa.event_name.isin(EVN)].copy(); wa['ev'] = wa.event_name.map(EVN)
def _sec(t):
    try: return float(t)
    except (TypeError, ValueError):
        try:
            v = 0.0
            for x in str(t).split(':'): v = v * 60 + float(x)
            return v
        except ValueError: return np.nan
wa['mark'] = wa.mark.map(_sec); wa = wa.dropna(subset=['mark', 'age'])
wa['aid'] = (wa.competitor + '|' + wa.date_of_birth.astype(str) + '|' + wa.gender).factorize()[0]
best = wa.sort_values('mark').drop_duplicates(['aid', 'ev']); piv = best.pivot(index='aid', columns='ev', values='mark'); age = best.pivot(index='aid', columns='ev', values='age'); sexm = best.groupby('aid').gender.first().eq('men')
SH = json.load(open(f'{ROOT}/src/shortmodel.json')); PAIRS = {f"{p['s']}>{p['t']}": p for p in SH['pairs']}
print('\nWorld Athletics all-time lists (outdoor; best marks): pair-line residual (% slower than the line says) by the athlete\'s age at the TARGET mark, true sex known:\n| pair | age <19 | 19-22 | 23-26 | 27-30 | 31+ | n |\n|---|---|---|---|---|---|---|')
ab2 = [0, 19, 23, 27, 31, 80]
for s_, t_ in (('400', '800'), ('800', '1500'), ('1500', '5000'), ('800', '1609'), ('100', '200'), ('200', '400')):
    if f'{s_}>{t_}' not in PAIRS: continue
    p = PAIRS[f'{s_}>{t_}']; m = piv[[s_, t_]].dropna().join(age[t_].rename('age')).join(sexm.rename('male'));
    res = np.log(m[t_]) - (p['a'] + p['b'] * np.log(m[s_]) + p['c'] * m.male.astype(float)); m['res'] = res; m['ab'] = pd.cut(m.age, ab2, labels=False)
    cells = [f"{100 * np.expm1(m[m.ab == i].res.mean()):+.2f}%" if (m.ab == i).sum() >= 30 else '-' for i in range(5)]
    print(f'| {s_} -> {t_} | ' + ' | '.join(cells) + f' | {len(m)} |')
