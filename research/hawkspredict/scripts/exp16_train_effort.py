"""Does recent training explain why a hard 5K/10K comes out faster or slower than the athlete's earlier best effort implies?
Real run histories (Strava 'running races' set, 116 athletes; FitRec/Endomondo runs table, ~1,100 users) -> hard efforts at 5K / 10K.
Target r = ln(actual time / best earlier effort Riegel-scaled to the same distance), earlier efforts 3-22 km, 14-180 days back (r < 0: faster than the earlier best implies).
Training features come from the 8 weeks before the target (volume, frequency, longest run, hard-run share, days since a hard run, evidence from the last 4 weeks,
change in volume since the earlier best). Leave-athletes-out CV; compared with a constant offset. Usage: exp16_train_effort.py <strava csv> <fitrec_runs.csv>"""
import sys
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold

DAY = 86400.0
def load(strava, fitrec):
    s = pd.read_csv(strava, sep=';'); s.columns = ['user', 'gender', 'ts', 'dist_m', 'dur_s', 'gain_m', 'avg_hr']
    s['t0'] = pd.to_datetime(s.ts, format='%d/%m/%Y %H:%M', errors='coerce').astype('int64') / 1e9; s['dist_km'] = s.dist_m / 1000; s['src'] = 'strava'
    s['user'] = 's' + s.user.astype(str)
    f = pd.read_csv(fitrec); f = f[f.sport == 'run'] if 'sport' in f else f; f['user'] = 'f' + f.user.astype(str); f['src'] = 'fitrec'
    cols = ['user', 'src', 't0', 'dist_km', 'dur_s', 'avg_hr', 'gain_m']
    R = pd.concat([s[cols], f[cols]], ignore_index=True).dropna(subset=['t0', 'dist_km', 'dur_s'])
    R['pace'] = R.dur_s / R.dist_km
    R = R[(R.pace > 150) & (R.pace < 600) & (R.dist_km >= 1.0) & (R.dist_km < 60)].sort_values(['user', 't0']).reset_index(drop=True)
    R['grade'] = (R.gain_m / R.dist_km).fillna(0)
    return R

def build(R):
    rows = []
    for u, g in R.groupby('user', sort=False):
        if len(g) < 60: continue
        t = g.t0.values; d = g.dist_km.values; p = g.pace.values; dur = g.dur_s.values; gr = g.grade.values
        rel = np.full(len(g), np.nan)                                            # pace relative to the median of the previous 20 runs (<1 = faster than usual)
        for j in range(20, len(g)): rel[j] = p[j] / np.median(p[j - 20:j])
        def window(T0, T1):
            return np.where((t >= T0) & (t < T1))[0]
        def feats(T, k=56):
            w = window(T - k * DAY, T)
            if len(w) < 6: return None
            hard = w[(rel[w] <= 0.95) & (d[w] >= 2.0)]
            last_hard = (T - t[hard].max()) / DAY if len(hard) else k
            e4 = w[(t[w] >= T - 28 * DAY) & (d[w] >= 3) & (d[w] <= 22) & (gr[w] < 20)]
            return dict(km_wk=d[w].sum() / (k / 7), runs_wk=len(w) / (k / 7), longest=d[w].max(), hard_share=len(hard) / len(w), n_hard=len(hard), last_hard=last_hard,
                        e4=np.log(dur[e4] * (5.0 / d[e4]) ** 1.06).min() if len(e4) else np.nan,
                        e4h=np.log(dur[e4[rel[e4] <= 0.95]] * (5.0 / d[e4[rel[e4] <= 0.95]]) ** 1.06).min() if (len(e4) and (rel[e4] <= 0.95).any()) else np.nan)
        for j in range(20, len(g)):
            if not ((4.85 <= d[j] <= 5.15) or (9.7 <= d[j] <= 10.3)) or gr[j] >= 20 or not (rel[j] <= 0.92): continue
            e = np.where((t < t[j] - 14 * DAY) & (t >= t[j] - 180 * DAY) & (d >= 3) & (d <= 22) & (gr < 20))[0]
            if len(e) < 3: continue
            eq = dur[e] * (d[j] / d[e]) ** 1.06; b = e[int(np.argmin(eq))]
            now, then = feats(t[j]), feats(t[b])
            if now is None or then is None: continue
            eq5 = np.log(eq.min() * (5.0 / d[j]) ** 1.06)
            rows.append(dict(user=u, r=np.log(dur[j] / eq.min()), dist=10 if d[j] > 7 else 5, days_gap=(t[j] - t[b]) / DAY, n_cand=len(e),
                             km_wk=now['km_wk'], runs_wk=now['runs_wk'], longest=now['longest'], hard_share=now['hard_share'], n_hard=now['n_hard'], last_hard=now['last_hard'],
                             d_vol=np.log((now['km_wk'] + 1) / (then['km_wk'] + 1)), d_hard=now['hard_share'] - then['hard_share'], d_long=np.log(now['longest'] / then['longest']),
                             recent_vs_best=now['e4'] - eq5 if now['e4'] == now['e4'] else np.nan,
                             recent_hard=now['e4h'] - eq5 if now['e4h'] == now['e4h'] else np.nan, rel_t=rel[j]))
    return pd.DataFrame(rows)

if __name__ == '__main__':
    R = load(sys.argv[1], sys.argv[2]); X = build(R)
    print(f'runs {len(R)}, users {R.user.nunique()}; hard 5K/10K efforts with an earlier best: {len(X)} from {X.user.nunique()} runners (5K {int((X.dist == 5).sum())}, 10K {int((X.dist == 10).sum())}); median gap to the earlier best {X.days_gap.median():.0f} days')
    print(f'r = ln(actual / earlier-best-implied): median {np.median(X.r):+.3f}, sd {X.r.std():.3f}   (negative = faster than the earlier best implies)')
    F = ['km_wk', 'runs_wk', 'longest', 'hard_share', 'n_hard', 'last_hard', 'd_vol', 'd_hard', 'd_long', 'recent_vs_best', 'days_gap']
    rng = np.random.default_rng(0); users = X.user.unique()
    print('\n| feature | Spearman with r | 95% CI (users resampled) |\n|---|---|---|')
    rk = X[F + ['r']].rank()
    for f in F:
        m = X[f].notna().values; c = np.corrcoef(rk.loc[m, f], rk.loc[m, 'r'])[0, 1]; bs = []
        grp = {u: np.where((X.user.values == u) & m)[0] for u in users}
        for _ in range(300):
            ii = np.concatenate([grp[u] for u in rng.choice(users, len(users))]); bs.append(np.corrcoef(rk[f].values[ii], rk['r'].values[ii])[0, 1])
        print(f'| {f} | {c:+.3f} | {np.percentile(bs, 2.5):+.3f} to {np.percentile(bs, 97.5):+.3f} |')
    def err(r): return 100 * np.abs(np.expm1(r))
    ok = X[F].notna().all(axis=1).values; Z = X[ok].reset_index(drop=True); y = Z.r.values; g = Z.user.values
    print(f'\nleave-runners-out error of the predicted time (rows with every feature: {len(Z)}):\n| model | MAE | change vs constant offset (95% CI) |\n|---|---|---|')
    base = np.zeros(len(Z)); out = {k: np.zeros(len(Z)) for k in ('ridge', 'trees', 'ridge_noevidence')}
    Fn = [f for f in F if f != 'recent_vs_best']
    for tr, te in GroupKFold(5).split(Z, groups=g):
        base[te] = np.median(y[tr])
        mu, sd = Z.loc[tr, F].mean(), Z.loc[tr, F].std() + 1e-9
        out['ridge'][te] = RidgeCV(alphas=np.logspace(-1, 3, 12)).fit((Z.loc[tr, F] - mu) / sd, y[tr]).predict((Z.loc[te, F] - mu) / sd)
        mu2, sd2 = Z.loc[tr, Fn].mean(), Z.loc[tr, Fn].std() + 1e-9
        out['ridge_noevidence'][te] = RidgeCV(alphas=np.logspace(-1, 3, 12)).fit((Z.loc[tr, Fn] - mu2) / sd2, y[tr]).predict((Z.loc[te, Fn] - mu2) / sd2)
        out['trees'][te] = HGB(loss='absolute_error', max_iter=120, learning_rate=0.05, max_leaf_nodes=6, min_samples_leaf=25, l2_regularization=2.0, random_state=0).fit(Z.loc[tr, F], y[tr]).predict(Z.loc[te, F])
    def pc(a, b):
        df = pd.DataFrame({'u': g, 'd': err(y - a) - err(y - b)}).groupby('u').d.agg(['sum', 'count']); bs = []
        for _ in range(500):
            i = rng.integers(0, len(df), len(df)); bs.append(df['sum'].values[i].sum() / df['count'].values[i].sum())
        return np.percentile(bs, [2.5, 97.5])
    print(f'| zero offset (earlier best taken at face value) | {err(y).mean():.2f}% | |\n| constant offset | {err(y - base).mean():.2f}% | |')
    for k, nm in (('ridge', 'ridge on all training features'), ('ridge_noevidence', 'ridge, without the last-4-weeks evidence'), ('trees', 'small trees on all')):
        ci = pc(out[k], base); print(f'| {nm} | {err(y - out[k]).mean():.2f}% | {err(y - out[k]).mean() - err(y - base).mean():+.2f} ({ci[0]:+.2f} to {ci[1]:+.2f}) |')
    X.to_pickle(sys.argv[3]) if len(sys.argv) > 3 else None
