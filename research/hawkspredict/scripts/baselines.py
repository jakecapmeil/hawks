"""Published / physics baselines computed from the bucket-best features (same inputs the learned models get).

Each returns predicted log-seconds for the target race, NaN where it cannot be computed.
"""
import numpy as np, pandas as pd

K = 1.06
REFS = [400, 800, 1500, 3000, 5000, 6000, 8000, 21097.5]
PCOLS = [f'p{int(r)}' for r in REFS]

def bucket_logtime(X):
    """Recover each athlete's best log-time at each bucket distance from the stored Riegel projections."""
    lt = np.log(X.target_m.values)[:, None]
    P = X[PCOLS].values
    return P - K * (lt - np.log(np.array(REFS))[None, :])          # log seconds at the bucket distance

def vdot_from(d, t_sec):
    v = d / (t_sec / 60.0)
    vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
    tm = t_sec / 60.0
    pct = 0.8 + 0.1894393 * np.exp(-0.012778 * tm) + 0.2989558 * np.exp(-0.1932605 * tm)
    return vo2 / pct

def time_from_vdot(vd, d):
    lo = np.full(vd.shape, d / 450.0 * 60.0 * 0.6); hi = np.full(vd.shape, d / 60.0 * 60.0 * 3.0)   # seconds
    for _ in range(40):                                               # bisection: vdot is decreasing in time
        mid = (lo + hi) / 2; f = vdot_from(d, mid) > vd
        lo = np.where(f, mid, lo); hi = np.where(f, hi, mid)
    return (lo + hi) / 2

def vdot_pred(X):
    LT = bucket_logtime(X); T = np.exp(LT); out = np.full(len(X), np.nan)
    V = np.full(T.shape, np.nan)
    for j, r in enumerate(REFS):
        ok = ~np.isnan(T[:, j]); V[ok, j] = vdot_from(r, T[ok, j])
    best = np.nanmax(np.where(np.isnan(V), -np.inf, V), axis=1); has = np.isfinite(best)
    for dist in np.unique(X.target_m.values):
        idx = np.where(has & (X.target_m.values == dist))[0]
        if len(idx): out[idx] = np.log(time_from_vdot(best[idx], dist))
    return out

def cameron_pred(X):
    f = lambda D: 13.49681 - 0.000030363 * D + 835.7114 / D ** 0.7905
    LT = bucket_logtime(X); P = X[PCOLS].values; tgt = X.target_m.values
    # nearest available bucket
    dist = np.abs(np.log(np.array(REFS))[None, :] - np.log(tgt)[:, None]); dist = np.where(np.isnan(LT), np.inf, dist)
    j = dist.argmin(1); ok = np.isfinite(dist.min(1))
    d1 = np.array(REFS)[j]; t1 = np.exp(LT[np.arange(len(X)), j])
    t2 = t1 * (tgt * f(d1)) / (d1 * f(tgt))
    return np.where(ok, np.log(t2), np.nan)

def cs_pred(X):
    """Two-parameter critical speed: d = CS*t + D' fit through the athlete's bucket bests."""
    LT = bucket_logtime(X); out = np.full(len(X), np.nan); tgt = X.target_m.values; R = np.array(REFS)
    for i in range(len(X)):
        ok = ~np.isnan(LT[i]) & (R >= 800) & (R <= 10000)
        if ok.sum() < 2: continue
        d = R[ok]; t = np.exp(LT[i, ok])
        if np.log(d.max() / d.min()) < 0.4: continue
        A = np.c_[t, np.ones_like(t)]; cs, dp = np.linalg.lstsq(A, d, rcond=None)[0]
        dp = float(np.clip(dp, 0.0, 400.0))
        cs = float(np.clip((d / t).mean() if cs <= 0 else cs, 2.0, 9.0))
        tt = (tgt[i] - dp) / cs
        if tt > 0: out[i] = np.log(tt)
    return out

class LowRank:
    """Blythe-Kiraly-style low-rank completion on the athlete x distance matrix; components fit on training rows only."""
    def __init__(self, rank=3, lam=1e-3, iters=25):      # rank/lam chosen on the tuning athletes only
        self.rank, self.lam, self.iters = rank, lam, iters
    def fit(self, X):
        LT = bucket_logtime(X); Z = LT - np.log(np.array(REFS))[None, :]            # log seconds per metre
        Z = Z[(~np.isnan(Z)).sum(1) >= 2][:60000]
        self.mu = np.nanmean(Z, 0); self.mu = np.where(np.isnan(self.mu), np.nanmean(self.mu), self.mu)
        F = np.where(np.isnan(Z), self.mu[None, :], Z) - self.mu
        mask = ~np.isnan(Z)
        for _ in range(self.iters):                                               # iterative SVD imputation
            U, s, Vt = np.linalg.svd(F, full_matrices=False)
            low = (U[:, :self.rank] * s[:self.rank]) @ Vt[:self.rank]
            F = np.where(mask, Z - self.mu, low)
        self.W = Vt[:self.rank].T * (s[:self.rank] / np.sqrt(len(F)))[None, :]       # (8, rank)
        return self
    def predict(self, X):
        LT = bucket_logtime(X); Z = LT - np.log(np.array(REFS))[None, :]
        tgt = X.target_m.values; out = np.full(len(X), np.nan)
        tb = np.array([int(np.argmin(np.abs(np.log(np.array(REFS)) - np.log(t)))) for t in tgt])
        pat = (~np.isnan(Z)); keys = pat @ (1 << np.arange(len(REFS)))
        for kk in np.unique(keys):
            idx = np.where(keys == kk)[0]; obs = pat[idx[0]]
            if obs.sum() < 1: continue
            Wo = self.W[obs]; A = Wo.T @ Wo + self.lam * np.eye(self.rank)
            Zc = Z[np.ix_(idx, np.where(obs)[0])] - self.mu[obs][None, :]
            C = np.linalg.solve(A, Wo.T @ Zc.T)                                    # (rank, n)
            zhat = (self.mu[None, :] + (self.W @ C).T)                             # (n, 8)
            zt = zhat[np.arange(len(idx)), tb[idx]]
            out[idx] = zt + np.log(np.array(REFS)[tb[idx]]) + K * (np.log(tgt[idx]) - np.log(np.array(REFS)[tb[idx]]))
        return out

def all_baselines(X, train_for_lmc):
    B = pd.DataFrame(index=X.index)
    B['Riegel (nearest result)'] = X.base_near
    B['Riegel (weighted mix)'] = X.base
    B['Personal-exponent Riegel'] = X.base_slope.fillna(X.base_near)
    B['VDOT (Daniels)'] = vdot_pred(X)
    B['Cameron'] = cameron_pred(X)
    B['Critical speed (2-param)'] = cs_pred(X)
    lr = LowRank().fit(train_for_lmc)
    B['Low-rank completion (rank 3, tuned)'] = lr.predict(X)
    return B
