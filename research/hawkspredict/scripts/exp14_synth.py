"""Synthetic athletes built from real ones, for the 'what happens with a lot of synthetic data' study.

fit_gen(results)  learns, from TRAINING athletes only:
    ln t_ij = A_i + E[sex, event] + u[surface] + d_i * x_j + tau_i * years_ij + c[meet] + e_ij        (x_j = ln(dist/5000))
  E: mean event curve (per sex), u: surface offset, c: shrunk meet effect (course/day difficulty), e: what is left (kept as an empirical pool),
  and the spread of the athlete-level pieces (A_i, d_i, tau_i) per sex.
gen(model, n, mode)  makes n synthetic athletes: each borrows a real training athlete's schedule (dates, events, surfaces, meets), draws new
  athlete-level pieces, adds the real meet effects, and draws fresh e from the pool.
    mode 'own'  : the borrowed athlete's own (A, d, tau) plus a random ability shift (sd 0.05) and slope shift: a perturbed copy
    mode 'pop'  : (A, d, tau) drawn from the fitted population distribution: a new athlete who exists nowhere in the data
    noise 'resample' (default) draws e from the pool; 'gauss' draws it normal with the same sd
Nothing here sees evaluation athletes; call fit_gen on the training fold only."""
import numpy as np, pandas as pd

X5000 = np.log(5000.0)
SLOPE_SCALE = 0.5

def _ols_ath(x, yr, r, ridge=(0.0, 4.0, 4.0)):
    """Per-athlete least squares of residual r on [1, x, yr] with a ridge on the slopes (columns x, yr); returns coefs and sampling variances."""
    cols = [np.ones_like(x)]
    if np.ptp(x) >= 0.4 and len(x) >= 4: cols.append(x - 0)           # d_i identified only with a real distance spread
    else: cols.append(None)
    cols.append(yr if (np.ptp(yr) >= 0.25 and len(x) >= 4) else None)
    use = [c is not None for c in cols]
    M = np.column_stack([c for c in cols if c is not None]); lam = np.diag([r_ for r_, u in zip(ridge, use) if u])
    A = M.T @ M + lam * 1e-3
    b = np.linalg.solve(A, M.T @ r)
    out = np.full(3, np.nan); out[np.array(use)] = b
    var = np.full(3, np.nan); dof = max(len(x) - len(b), 1)
    var[np.array(use)] = np.diag(np.linalg.inv(A)) * float(((r - M @ b) ** 2).sum() / dof)     # sampling variance of each coefficient
    return np.r_[out, var]

def fit_gen(df):
    d = df.copy().reset_index(drop=True)
    d['lnt'] = np.log(d.sec); d['x'] = np.log(d.m) - X5000
    d['ev'] = d.male.astype(str) + '|' + d.m.round(0).astype(int).astype(str)
    d['yr'] = (d.date - d.groupby('athlete_id').date.transform('min')).dt.days / 365.25
    d['sg'] = d.surf
    # backfit: athlete level A, event offsets E (per sex), surface offsets u
    E = d.groupby('ev').lnt.mean() - d.lnt.mean(); u = pd.Series(0.0, index=d.sg.unique())
    for _ in range(5):
        res = d.lnt - d.ev.map(E) - d.sg.map(u)
        A = res.groupby(d.athlete_id).transform('mean')
        E = (d.lnt - A - d.sg.map(u)).groupby(d.ev).mean()
        u = (d.lnt - A - d.ev.map(E)).groupby(d.sg).mean(); u -= u.mean()
    d['A0'] = A
    r = (d.lnt - d.ev.map(E) - d.sg.map(u))
    # athlete-level slopes
    recs = []
    for aid, g in d.groupby('athlete_id', sort=False):
        if len(g) < 3: continue
        o = _ols_ath(g.x.values, g.yr.values, r.loc[g.index].values)
        recs.append((aid, g.male.iloc[0], *o))
    L = pd.DataFrame(recs, columns=['athlete_id', 'male', 'A', 'dl', 'tau', 'vA', 'vdl', 'vtau'])
    pop = {}
    for sx in (0, 1):
        s = L[L.male == sx]
        mean = np.array([s.A.mean(), s.dl.mean(skipna=True), s.tau.mean(skipna=True)])
        # spread of the true athlete-level pieces = spread of the estimates minus their average sampling variance (empirical Bayes)
        # The slopes' empirical-Bayes spread comes out ~0 (estimates from 3-6 races are mostly noise) and the raw spread is too wide, so the
        # slope spreads are the raw ones times SLOPE_SCALE, set so synthetic residual spread (y - Riegel base) matches the real athletes' (0.074 -> 0.086).
        sd = np.array([np.sqrt(max(s.A.var() - s.vA.mean(), 1e-6)), SLOPE_SCALE * s.dl.std(skipna=True), SLOPE_SCALE * s.tau.std(skipna=True)])
        ok = s[['A', 'dl', 'tau']].dropna()
        corr = np.corrcoef(ok.values.T) if len(ok) > 50 else np.eye(3)
        pop[sx] = dict(mean=np.nan_to_num(mean), sd=np.nan_to_num(sd), corr=np.nan_to_num(corr))
    L = L.set_index('athlete_id')
    # meet effects (shrunk) and the leftover pool
    lat = d.athlete_id.map(L.A).fillna(d.A0) + d.athlete_id.map(L.dl).fillna(0) * d.x + d.athlete_id.map(L.tau).fillna(0) * d.yr
    rr = r - lat
    k = 3.0; g = rr.groupby(d.meet_id); c = (g.sum() / (g.count() + k)); c[c.index < 0] = 0.0
    e = (rr - d.meet_id.map(c).fillna(0)).values
    pool = {sg: e[(d.sg.isin(['xc', 'road']) == (sg == 'off')).values] for sg in ('off', 'trk')}
    return dict(E=E, u=u, A=L.A.to_dict(), dl=L.dl.to_dict(), tau=L.tau.to_dict(), pop=pop, c=c.to_dict(), pool=pool, esd=float(np.std(e)),
                df=d[['athlete_id', 'male', 'date', 'surf', 'm', 'sec', 'altitude', 'temperature', 'elev_km', 'meet_id', 'series_id', 'event_name', 'x', 'yr', 'ev']],
                ids=L.index.values, mu_dl=float(np.nanmean(L.dl)), A0=d.groupby('athlete_id').A0.first().to_dict())

def gen(G, n, mode='pop', noise='resample', seed=0, start_id=30_000_000, min_len=3):
    """n synthetic athletes (vectorised over each athlete's schedule; arrays are cut from the borrowed athlete's rows)."""
    rng = np.random.default_rng(seed)
    if 'sched' not in G:                                                    # per-athlete row slices, built once
        d = G['df'].sort_values(['athlete_id', 'date'], kind='stable').reset_index(drop=True)
        G['df'] = d; G['Er'] = d.ev.map(G['E']).values; G['ur'] = d.surf.map(G['u']).values; G['cr'] = d.meet_id.map(G['c']).fillna(0).values
        G['off'] = d.surf.isin(['xc', 'road']).values
        b = np.r_[0, np.flatnonzero(np.diff(d.athlete_id.values)) + 1, len(d)]
        G['sched'] = [(d.athlete_id.iloc[s], s, e) for s, e in zip(b[:-1], b[1:]) if e - s >= min_len]
    d, sched = G['df'], G['sched']; parts, aid_col = [], []
    pools = G['pool']; x = d.x.values; yr = d.yr.values; male = d.male.values
    for i in range(n):
        a, s, e = sched[rng.integers(len(sched))]
        sx = int(male[s]); P = G['pop'][sx]
        if mode == 'pop':
            z = rng.multivariate_normal(np.zeros(3), P['corr']); A, dl, tau = P['mean'] + z * P['sd']
        else:
            A = G['A'].get(a, G['A0'][a]) + rng.normal(0, 0.05); dl = G['dl'].get(a, np.nan); tau = G['tau'].get(a, np.nan)
            dl = rng.normal(P['mean'][1], 0.3 * P['sd'][1]) if np.isnan(dl) else dl + rng.normal(0, 0.15 * P['sd'][1])
            if np.isnan(tau): tau = rng.normal(P['mean'][2], 0.3 * P['sd'][2])
        if noise == 'resample':
            off = G['off'][s:e]; ee = np.where(off, pools['off'][rng.integers(len(pools['off']), size=e - s)], pools['trk'][rng.integers(len(pools['trk']), size=e - s)])
        else:
            ee = rng.normal(0, G['esd'], e - s)
        parts.append(A + G['Er'][s:e] + G['ur'][s:e] + dl * x[s:e] + tau * yr[s:e] + G['cr'][s:e] + ee)
        aid_col.append(np.full(e - s, start_id + i)); parts[-1] = np.exp(parts[-1])
        sched_rows = np.arange(s, e); aid_col[-1] = (aid_col[-1], sched_rows)
    rows = np.concatenate([r for _, r in aid_col]); out = d.iloc[rows][['male', 'date', 'surf', 'm', 'altitude', 'temperature', 'elev_km', 'meet_id', 'series_id', 'event_name']].reset_index(drop=True)
    out.insert(0, 'athlete_id', np.concatenate([a for a, _ in aid_col])); out['sec'] = np.concatenate(parts)
    return out[['athlete_id', 'male', 'date', 'surf', 'm', 'sec', 'altitude', 'temperature', 'elev_km', 'meet_id', 'series_id', 'event_name']]
