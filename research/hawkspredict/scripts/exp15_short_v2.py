"""HawksPredict-Short with real teenagers: refit the event-pair lines on World Athletics marks + NRCD PBs + the Ontario high-school runners (train half),
then score on the Ontario holdout runners (leave-one-event-out within a runner-year) against the current v1 lines.
Pair SDs never go below v1's: Ontario finals are marks from one championship weekend, so their scatter is smaller than PB-to-PB scatter at other times.
Usage: exp15_short_v2.py <scratch dir (wa_raw, results4.pkl, results_ont.pkl)> <v1 shortmodel.json (git show 3ff2e1b:src/shortmodel.json)> <out dir>"""
import json, os, sys
import numpy as np, pandas as pd
S, V1PATH, OUT = sys.argv[1:4]
Z = 1.2816
WA = {'100 Metres': '100', '200 Metres': '200', '300 Metres': '300', '400 Metres': '400', '600 Metres': '600', '800 Metres': '800', '1000 Metres': '1000',
      '1500 Metres': '1500', 'One Mile': '1609', '3000 Metres': '3000', '5000 Metres': '5000', '2000 Metres Steeplechase': 'S2000', '3000 Metres Steeplechase': 'S3000'}
METERS = {'100': 100, '200': 200, '300': 300, '400': 400, '600': 600, '800': 800, '1000': 1000, '1500': 1500, '1609': 1609.344, '3000': 3000, '5000': 5000, 'S2000': 2000, 'S3000': 3000}
EV = list(METERS); V1 = json.load(open(V1PATH)); V1P = {(p['s'], p['t']): p for p in V1['pairs']}

d = pd.read_csv(f'{S}/wa_raw/data.csv', sep=';', low_memory=False).rename(columns={'Mark [meters or seconds]': 'mark'})
d = d[d.Event.isin(WA)].copy(); d['ev'] = d.Event.map(WA); d['w'] = pd.to_numeric(d.Wind.astype(str).str.replace(',', '.'), errors='coerce')
d = d[~(d.ev.isin(['100', '200']) & (d.w > 2.0))]; d['mark'] = pd.to_numeric(d.mark, errors='coerce'); d = d[d.mark > 5]
d['aid'] = 'w' + (d.Competitor + '|' + d.DOB.astype(str) + '|' + d.Sex).factorize()[0].astype(str)
wa = d.groupby(['aid', 'ev']).agg(t=('mark', 'min'), male=('Sex', lambda s: float(s.iloc[0] == 'male'))).reset_index(); wa['src'] = 'wa'
r = pd.read_pickle(f'{S}/results4.pkl'); r = r[r.surf.isin(['track', 'indoor'])]; nm = {400: '400', 800: '800', 1000: '1000', 1500: '1500', 3000: '3000', 5000: '5000'}
rr = r[r.m.round().isin(nm) | np.isclose(r.m, 1609.34) | np.isclose(r.m, 1600)].copy()
rr['ev'] = np.where(np.isclose(rr.m, 1609.34) | np.isclose(rr.m, 1600), '1609', rr.m.round().map(nm)); rr['t'] = np.where(np.isclose(rr.m, 1600), rr.sec * (1609.344 / 1600) ** 1.06, rr.sec)
nr = rr.groupby(['athlete_id', 'ev']).agg(t=('t', 'min'), male=('male', 'first')).reset_index().rename(columns={'athlete_id': 'aid'}); nr['aid'] = 'n' + nr.aid.astype(str); nr['src'] = 'nrcd'
o = pd.read_pickle(f'{S}/results_ont.pkl'); ot = o[~o.holdout]; oh = o[o.holdout]
on = ot.groupby(['athlete_id', 'm']).agg(t=('sec', 'min'), male=('male', 'first')).reset_index(); on['ev'] = on.m.astype(int).astype(str); on['aid'] = 'o' + on.athlete_id.astype(str); on['src'] = 'ont'
on = on[['aid', 'ev', 't', 'male', 'src']]

def table(parts):
    A = pd.concat(parts); A['lt'] = np.log(A.t); P = A.pivot_table(index='aid', columns='ev', values='lt')
    return P, A.groupby('aid').agg(male=('male', 'first'), src=('src', 'first')).loc[P.index]
SPR = lambda e: e in ('100', '200', '300') or e.startswith('S')
def fit_pairs(P, info, minn=100):
    M = {}
    for s in EV:
        for t in EV:
            if s == t or s not in P or t not in P: continue
            m = P[[s, t]].dropna()
            if len(m) < (30 if ('600' in (s, t) or 'S2000' in (s, t)) else minn): continue
            mal = info.loc[m.index, 'male'].values
            if SPR(s) or SPR(t):
                z = m[t].values - m[s].values; Z2 = np.c_[np.ones(len(m)), mal]; cc, *_ = np.linalg.lstsq(Z2, z, rcond=None); coef = np.array([cc[0], 1.0, cc[1]]); res = z - Z2 @ cc
            else:
                X = np.c_[np.ones(len(m)), m[s].values, mal]; coef, *_ = np.linalg.lstsq(X, m[t].values, rcond=None); res = m[t].values - X @ coef
            M[(s, t)] = (coef, float(res.std()), len(m))
    return M

# ---- data variants: v1 data vs + Ontario train
# 600 m is rare, so athletes with a 400 and an 800 and no 600 get a formula-made 600 (log-log interpolation + 1.7% bias + noise), exactly as exp13 did
def add_600(P):
    rng = np.random.default_rng(0); need = P['400'].notna() & P['800'].notna() & P['600'].isna(); P = P.copy()
    P.loc[need, '600'] = P.loc[need, '400'] + (P.loc[need, '800'] - P.loc[need, '400']) * (np.log(600) - np.log(400)) / (np.log(800) - np.log(400)) + 0.017 + rng.normal(0, 0.012, int(need.sum()))
    return P
P1, I1 = table([wa, nr]); P2, I2 = table([wa, nr, on]); P1, P2 = add_600(P1), add_600(P2)
M1 = fit_pairs(P1, I1); M2 = fit_pairs(P2, I2)
M2f = {k: (c, max(sd, V1P[k]['sd']), n) for k, (c, sd, n) in M2.items() if k in V1P}      # SD floor at v1's; no pairs v1 did not have

def one(M, src, target, male, infl):
    near = sorted([s for s in src if s[0] != target and (s[0], target) in M], key=lambda s: abs(np.log(METERS[s[0]] / METERS[target])))[:3]
    if not near: return None
    sw = sp = 0.0
    for ev, sec in near:
        (a, b, c), sd, n = M[(ev, target)]; w = 1 / sd ** 2; sw += w; sp += w * (a + b * np.log(sec) + c * male)
    return sp / sw, np.sqrt(1 / sw) * infl
def short_any(M, src, target, infl, extra):
    a, b = one(M, src, target, 0, infl), one(M, src, target, 1, infl)
    if not a or not b: return None
    mu = (a[0] + b[0]) / 2; ex = extra.get(target, 0); sd = np.sqrt(((a[1] + b[1]) / 2) ** 2 + ((a[0] - b[0]) / 2) ** 2 + ex * ex)
    return np.exp(mu), np.exp(mu - Z * sd), np.exp(mu + Z * sd)

oh = oh.copy(); oh['yr'] = oh.date.dt.year; KEY = lambda m: str(int(m)); INF = V1['infl']; EXTRA = V1['extra_sd']
def score(M, tag):
    rows = []
    for (aid, yr), g in oh.groupby(['athlete_id', 'yr']):
        g = g.drop_duplicates('m')
        if len(g) < 2: continue
        for _, t in g.iterrows():
            src = [(KEY(q.m), q.sec) for _, q in g.iterrows() if q.m != t.m]
            p = short_any(M, src, KEY(t.m), INF, EXTRA)
            if p: rows.append(dict(target=int(t.m), err=100 * abs(p[0] / t.sec - 1), cov=p[1] <= t.sec <= p[2], half=100 * (p[2] - p[1]) / 2 / t.sec, bias=100 * (p[0] / t.sec - 1)))
    R = pd.DataFrame(rows)
    return R
# ---- does adding Ontario cost anything on the elite / collegiate athletes the lines were first fitted on? 20% of those athletes held out of both fits
rng = np.random.default_rng(5); idx = np.array([i for i in P1.index]); ev = set(rng.choice(idx, int(0.2 * len(idx)), replace=False))
tr1 = P1.index.difference(list(ev)); tr2 = P2.index.difference(list(ev))
Ma = fit_pairs(P1.loc[tr1], I1.loc[tr1]); Mb = fit_pairs(P2.loc[tr2], I2.loc[tr2])
def loo(M, P, info, ids):
    out = {}
    for aid in ids:
        row = P.loc[aid]; have = [e for e in EV if not np.isnan(row[e])]
        for t in have:
            src = [(e, float(np.exp(row[e]))) for e in have if e != t]
            if not src: continue
            one_ = one(M, src, t, info.loc[aid, 'male'], 1.0)
            if one_: out.setdefault(t, []).append(abs(np.expm1(one_[0] - row[t])))
    return {t: 100 * float(np.mean(v)) for t, v in out.items()}, {t: len(v) for t, v in out.items()}
ids = sorted(ev); ra, na = loo(Ma, P1, I1, ids); rb, _ = loo(Mb, P2, I2, ids)
print('Held-out World Athletics / NRCD athletes (20%), leave-one-event-out MAE:\n| target | n | v1 data | + Ontario train |\n|---|---|---|---|')
for t in EV:
    if t in ra: print(f'| {t} | {na[t]} | {ra[t]:.2f}% | {rb[t]:.2f}% |')
print()
print('| event pairs fitted | v1 data | + Ontario train |\n|---|---|---|\n' + f'| pairs | {len(M1)} | {len(M2)} |')
print(f'athletes: v1 {len(P1)}, + Ontario {len(P2)} (Ontario train runners {len(on.aid.unique())})\n')
print('Ontario holdout, leave-one-event-out (same-year events as sources):\n| target | n | v1 lines MAE | + Ontario lines MAE | + Ontario, SD floor 80% cov | v1 80% cov | + Ontario half-width |\n|---|---|---|---|---|---|---|')
R1, R2, R3 = score(M1, 'v1'), score(M2, 'o'), score(M2f, 'of')
for t in sorted(R1.target.unique()):
    a, b, c = R1[R1.target == t], R2[R2.target == t], R3[R3.target == t]
    print(f'| {t} m | {len(a)} | {a.err.mean():.2f}% | {b.err.mean():.2f}% | {100*c["cov"].mean():.0f}% | {100*a["cov"].mean():.0f}% | {c.half.mean():.1f}% |')
print(f'| all | {len(R1)} | {R1.err.mean():.2f}% | {R2.err.mean():.2f}% | {100*R3["cov"].mean():.0f}% | {100*R1["cov"].mean():.0f}% | {R3.half.mean():.1f}% |')
os.makedirs(OUT, exist_ok=True)
art = dict(V1); art.update(version='v1.1', pairs=[dict(s=s, t=t, a=float(c[0]), b=float(c[1]), c=float(c[2]), sd=sd, n=n) for (s, t), (c, sd, n) in M2f.items()],
          trained_on=V1['trained_on'] + ' and the training half of the Ontario high-school championship finalists (Mendeley Data 7rxh2z7vrc, CC BY 4.0)')
json.dump(art, open(f'{OUT}/shortmodel_v11.json', 'w'), separators=(',', ':')); print('wrote', f'{OUT}/shortmodel_v11.json', len(art['pairs']), 'pairs')
