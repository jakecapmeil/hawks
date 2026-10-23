"""How do an athlete's times at different distances relate (400 -> 600, 800 -> mile, ...), done properly: one multivariate normal over ln(time) at 13 events,
per sex, fitted by EM on athletes with ANY subset of events observed (World Athletics lists + NRCD PBs + Ontario high-school finals, train half).
Prediction = condition on the events the athlete has; the sex is not needed (a two-component mixture infers it from the times), the age of the marks can be added as
an extra coordinate. This replaces 'average of pair lines' (HawksPredict-Short), which treats errors of different sources as independent.
Scored on (1) Ontario holdout runners, leave-one-event-out in the same year, (2) the same with sources from earlier years only, (3) 20% held-out World Athletics / NRCD
athletes; compared with Short v1.1's pair-line method on exactly the same cases.   Also writes the 'what is X in the Y' tables.
Usage: exp17_event_mvn.py <scratch dir> <short v1.1 json (src/shortmodel.json)> [out md]"""
import sys, json
import numpy as np, pandas as pd

S, SHORT = sys.argv[1], sys.argv[2]
WA = {'100 Metres': '100', '200 Metres': '200', '300 Metres': '300', '400 Metres': '400', '600 Metres': '600', '800 Metres': '800', '1000 Metres': '1000',
      '1500 Metres': '1500', 'One Mile': '1609', '3000 Metres': '3000', '5000 Metres': '5000', '2000 Metres Steeplechase': 'S2000', '3000 Metres Steeplechase': 'S3000'}
METERS = {'100': 100, '200': 200, '300': 300, '400': 400, '600': 600, '800': 800, '1000': 1000, '1500': 1500, '1609': 1609.344, '3000': 3000, '5000': 5000, 'S2000': 2000, 'S3000': 3000}
EV = list(METERS); D = len(EV); IDX = {e: i for i, e in enumerate(EV)}

# ---------- data (same sources and filters as exp15)
d = pd.read_csv(f'{S}/wa_raw/data.csv', sep=';', low_memory=False).rename(columns={'Mark [meters or seconds]': 'mark'})
d = d[d.Event.isin(WA)].copy(); d['ev'] = d.Event.map(WA); d['w'] = pd.to_numeric(d.Wind.astype(str).str.replace(',', '.'), errors='coerce')
d = d[~(d.ev.isin(['100', '200']) & (d.w > 2.0))]; d['mark'] = pd.to_numeric(d.mark, errors='coerce'); d = d[d.mark > 5]
d['aid'] = 'w' + (d.Competitor + '|' + d.DOB.astype(str) + '|' + d.Sex).factorize()[0].astype(str)
wa = d.groupby(['aid', 'ev']).agg(t=('mark', 'min'), male=('Sex', lambda s: float(s.iloc[0] == 'male'))).reset_index(); wa['src'] = 'wa'
r = pd.read_pickle(f'{S}/results4.pkl'); r = r[r.surf.isin(['track', 'indoor'])]; nm = {400: '400', 800: '800', 1000: '1000', 1500: '1500', 3000: '3000', 5000: '5000'}
rr = r[r.m.round().isin(nm) | np.isclose(r.m, 1609.34) | np.isclose(r.m, 1600)].copy()
rr['ev'] = np.where(np.isclose(rr.m, 1609.34) | np.isclose(rr.m, 1600), '1609', rr.m.round().map(nm)); rr['t'] = np.where(np.isclose(rr.m, 1600), rr.sec * (1609.344 / 1600) ** 1.06, rr.sec)
nr = rr.groupby(['athlete_id', 'ev']).agg(t=('t', 'min'), male=('male', 'first')).reset_index().rename(columns={'athlete_id': 'aid'}); nr['aid'] = 'n' + nr.aid.astype(str); nr['src'] = 'nrcd'
o = pd.read_pickle(f'{S}/results_ont.pkl'); ot = o[~o.holdout]; oh = o[o.holdout].copy(); oh['yr'] = oh.date.dt.year
on = ot.groupby(['athlete_id', 'm']).agg(t=('sec', 'min'), male=('male', 'first')).reset_index(); on['ev'] = on.m.astype(int).astype(str); on['aid'] = 'o' + on.athlete_id.astype(str); on['src'] = 'ont'
on = on[['aid', 'ev', 't', 'male', 'src']]
A = pd.concat([wa, nr, on]); A['lt'] = np.log(A.t); P = A.pivot_table(index='aid', columns='ev', values='lt').reindex(columns=EV)
info = A.groupby('aid').agg(male=('male', 'first'), src=('src', 'first')).loc[P.index]
rng = np.random.default_rng(5); hold = set(rng.choice(P.index.values, int(0.2 * len(P)), replace=False))   # 20% of all athletes held out of every fit
trn = [a for a in P.index if a not in hold]
# formula-made 600 (log-log interpolation + 1.7%) for athletes with a 400 and an 800, exactly as Short's fit
def add600(Pm):
    Pm = Pm.copy(); g = np.random.default_rng(0); need = Pm['400'].notna() & Pm['800'].notna() & Pm['600'].isna()
    Pm.loc[need, '600'] = Pm.loc[need, '400'] + (Pm.loc[need, '800'] - Pm.loc[need, '400']) * (np.log(600) - np.log(400)) / (np.log(800) - np.log(400)) + 0.017 + g.normal(0, 0.012, int(need.sum()))
    return Pm
Ptr = add600(P.loc[trn]); itr = info.loc[trn]

# ---------- EM for a Gaussian with missing values
def em(X, iters=40, ridge=1e-5):
    n = len(X); M = ~np.isnan(X); mu = np.nanmean(X, 0); Xf = np.where(M, X, mu)
    S_ = np.cov(Xf.T) + ridge * np.eye(D); pats = {}
    for i in range(n): pats.setdefault(M[i].tobytes(), []).append(i)
    for it in range(iters):
        sx = np.zeros(D); sxx = np.zeros((D, D))
        for key, rows in pats.items():
            o_ = np.frombuffer(key, dtype=bool); m_ = ~o_; rows = np.array(rows); Xo = X[np.ix_(rows, np.where(o_)[0])]
            Z = np.tile(mu, (len(rows), 1)); C = np.zeros((D, D))
            if m_.any() and o_.any():
                Soo = S_[np.ix_(o_, o_)]; Smo = S_[np.ix_(m_, o_)]; K = Smo @ np.linalg.inv(Soo)
                Z[:, o_] = Xo; Z[:, m_] = mu[m_] + (Xo - mu[o_]) @ K.T
                C[np.ix_(m_, m_)] = S_[np.ix_(m_, m_)] - K @ Smo.T
            elif o_.any(): Z[:, o_] = Xo
            sx += Z.sum(0); sxx += Z.T @ Z + len(rows) * C
        mu = sx / n; S_ = sxx / n - np.outer(mu, mu) + ridge * np.eye(D)
    return mu, S_

fits = {}
for sx in (0, 1):
    Xs = Ptr[(itr.male == sx).values].values; fits[sx] = em(Xs); print(f'sex {sx}: {len(Xs)} athletes fitted', flush=True)

def mvn_predict(known, target, male=None):
    """known: {event: seconds}. Returns (median seconds, lo, hi) as a two-sex mixture unless male is given."""
    o_ = np.array([IDX[e] for e in known]); t = IDX[target]; x = np.log(np.array([known[e] for e in known])); comps = []
    for sx in ((0, 1) if male is None else (male,)):
        mu, S_ = fits[sx]; Soo = S_[np.ix_(o_, o_)]; K = S_[t, o_] @ np.linalg.inv(Soo)
        m = mu[t] + K @ (x - mu[o_]); v = S_[t, t] - K @ S_[o_, t]
        ll = -0.5 * ((x - mu[o_]) @ np.linalg.solve(Soo, x - mu[o_]) + np.linalg.slogdet(Soo)[1]); comps.append((ll, m, max(v, 1e-8)))
    if male is not None: m, v = comps[0][1], comps[0][2]
    else:
        l = np.array([c[0] for c in comps]); w = np.exp(l - l.max()); w /= w.sum()
        m = sum(wi * c[1] for wi, c in zip(w, comps)); v = sum(wi * (c[2] + (c[1] - m) ** 2) for wi, c in zip(w, comps))
    sd = np.sqrt(v); return float(np.exp(m)), float(np.exp(m - 1.2816 * sd)), float(np.exp(m + 1.2816 * sd))

# ---------- Short v1.1 pair method (as shipped)
SH = json.load(open(SHORT)); PAIRS = {f"{p['s']}>{p['t']}": p for p in SH['pairs']}
def short_pred(known, target):
    def one(male):
        near = sorted([e for e in known if f'{e}>{target}' in PAIRS], key=lambda e: abs(np.log(METERS[e] / METERS[target])))[:3]
        if not near: return None
        sw = sp = 0.0
        for e in near:
            p = PAIRS[f'{e}>{target}']; w = 1 / p['sd'] ** 2; sw += w; sp += w * (p['a'] + p['b'] * np.log(known[e]) + p['c'] * male)
        return sp / sw, np.sqrt(1 / sw) * SH['infl']
    a, b = one(0), one(1)
    if not a: return None
    mu = (a[0] + b[0]) / 2; ex = SH['extra_sd'].get(target, 0); sd = np.sqrt(((a[1] + b[1]) / 2) ** 2 + ((a[0] - b[0]) / 2) ** 2 + ex * ex)
    return float(np.exp(mu)), float(np.exp(mu - 1.2816 * sd)), float(np.exp(mu + 1.2816 * sd))

def report(title, cases):
    R = pd.DataFrame(cases); print(f'\n### {title} ({len(R)} cases)\n| target | n | pair lines (Short v1.1) MAE | cov | conditional Gaussian MAE | cov | half-width (Gaussian) |\n|---|---|---|---|---|---|---|')
    for t in EV:
        g = R[R.target == t]
        if len(g) < 25: continue
        print(f"| {t} | {len(g)} | {g.e_s.mean():.2f}% | {100*g.c_s.mean():.0f}% | {g.e_m.mean():.2f}% | {100*g.c_m.mean():.0f}% | {g.h_m.mean():.1f}% |")
    print(f'| all | {len(R)} | {R.e_s.mean():.2f}% | {100*R.c_s.mean():.0f}% | {R.e_m.mean():.2f}% | {100*R.c_m.mean():.0f}% | {R.h_m.mean():.1f}% |', flush=True)
def case(known, target, actual):
    s, m = short_pred(known, target), mvn_predict(known, target)
    if s is None: return None
    return dict(target=target, e_s=100 * abs(s[0] / actual - 1), c_s=s[1] <= actual <= s[2], e_m=100 * abs(m[0] / actual - 1), c_m=m[1] <= actual <= m[2], h_m=100 * (m[2] - m[1]) / 2 / actual)

# (1) Ontario holdout, same year;  (2) earlier years only
c1, c2 = [], []
for (aid, yr), g in oh.groupby(['athlete_id', 'yr']):
    g = g.drop_duplicates('m')
    for _, t in g.iterrows():
        kn = {str(int(q.m)): q.sec for _, q in g.iterrows() if q.m != t.m}
        if kn:
            c = case(kn, str(int(t.m)), t.sec); c1.append(c) if c else None
for aid, g in oh.groupby('athlete_id'):
    for yr, gy in g.groupby('yr'):
        prev = g[g.yr < yr]
        if not len(prev): continue
        best = prev.groupby('m').sec.min()
        for _, t in gy.drop_duplicates('m').iterrows():
            kn = {str(int(m)): s_ for m, s_ in best.items() if m != t.m}
            if kn:
                c = case(kn, str(int(t.m)), t.sec); c2.append(c) if c else None
report('Ontario holdout runners, other events from the same year as sources', c1)
report('Ontario holdout runners, sources from earlier years only', c2)
# (3) held-out World Athletics / NRCD athletes, all other events as sources
c3 = []
for aid in sorted(hold):
    row = P.loc[aid]; have = [e for e in EV if not np.isnan(row[e])]
    for t in have:
        kn = {e: float(np.exp(row[e])) for e in have if e != t}
        if kn:
            c = case(kn, t, float(np.exp(row[t]))); c3.append(c) if c else None
report('20% held-out World Athletics / NRCD athletes, all their other events as sources', c3)

# ---------- 'what is X in the Y' tables (sex inferred from the time; range 80%)
def table(src, tgt, times, fmt=lambda s: f'{int(s // 60)}:{s % 60:04.1f}' if s >= 60 else f'{s:.1f}'):
    print(f'\n**{src} m -> {tgt} m**\n| {src} m | expected {tgt} m | 80% range | pair-line method |\n|---|---|---|---|')
    for t in times:
        m = mvn_predict({src: t}, tgt); s = short_pred({src: t}, tgt)
        print(f'| {fmt(t)} | {fmt(m[0])} | {fmt(m[1])} to {fmt(m[2])} | {fmt(s[0]) if s else "-"} |')
print('\n## Equivalent-performance tables (conditional Gaussian, one known time)')
table('400', '600', [50, 54, 58, 62, 66, 72, 80]); table('800', '1609', [110, 120, 130, 140, 155, 170, 190]); table('400', '800', [50, 54, 58, 62, 66, 72, 80])
table('1609', '5000', [260, 290, 320, 350, 380, 420]); table('200', '400', [22, 24, 26, 28, 31, 34])
print('\nWith two known times (400 and 800 -> 600; 800 and 1500 -> mile):')
for k in ({'400': 56.0, '800': 128.0}, {'400': 62.0, '800': 138.0}, {'400': 62.0, '800': 160.0}):
    m = mvn_predict(k, '600'); s = short_pred(k, '600'); print(f'  400 {k["400"]}s, 800 {k["800"]}s -> 600: {m[0]:.1f}s ({m[1]:.1f}-{m[2]:.1f}); pair-line method {s[0]:.1f}s' if s else '')
for k in ({'800': 128.0, '1500': 262.0}, {'800': 140.0, '1500': 300.0}, {'800': 140.0, '1500': 330.0}):
    m = mvn_predict(k, '1609'); s = short_pred(k, '1609'); print(f'  800 {k["800"]}s, 1500 {k["1500"]}s -> mile: {m[0]:.1f}s ({m[1]:.1f}-{m[2]:.1f}); pair-line method {s[0]:.1f}s')
np.savez(f'{S}/mvn_fits.npz', mu0=fits[0][0], S0=fits[0][1], mu1=fits[1][0], S1=fits[1][1], events=np.array(EV))
