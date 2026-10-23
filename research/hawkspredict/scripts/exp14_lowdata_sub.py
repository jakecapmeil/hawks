"""Two more synthetic-data questions, Lite only, 5-fold by NRCD athlete (generator and copies built from the training athletes of each fold):
 (1) 'sub'  history-subsampling copies of REAL targets: the same target race with a random 1-3 of the athlete's earlier results as inputs (the website
            often has only one or two PRs). Real labels, only the inputs are thinned. Scored overall and on held-out rows with <= 2 prior results.
 (2) 'low'  low-data regime: only a fraction (10%, 25%) of the training athletes are real; the generator is fitted on that fraction alone and its
            athletes are added at 1x, 4x, 8x (own mode). Does synthetic data stand in for missing real data?
Usage: exp14_lowdata_sub.py <scratch> <folds comma list>  Output: <scratch>/sweep/lowsub_f<k>.npz"""
import os, sys, time
from exp14_fit import *
from exp14_synth import fit_gen, gen

S, FOLDS = sys.argv[1], [int(f) for f in sys.argv[2].split(',')]
R4 = pd.read_pickle(f'{S}/results4.pkl'); P, F, PL, FL = load_nrcd(S)
fold_of = {}
for k, (tr, te) in enumerate(GroupKFold(5).split(P, groups=P.athlete_id.values)):
    for a in P.athlete_id.values[te]: fold_of[a] = k

def _sub_chunk(args):
    df, copies, seed = args; rng = np.random.default_rng(seed); rows = []
    for aid, g in df.groupby('athlete_id', sort=False):
        if len(g) < 2: continue
        g = g.reset_index(drop=True); dts = g.date.values; ms = g.m.values; sc = g.sec.values; sf = g.surf.values; ml = g.male.values
        for i in range(1, len(g)):
            age = (dts[i] - dts[:i]).astype('timedelta64[D]').astype(int); k = np.where((age >= 1) & (age <= 730))[0]
            if not len(k): continue
            for _ in range(copies):
                s = min(len(k), int(rng.choice([1, 2, 3]))); kk = rng.choice(k, s, replace=False)
                r = lite_feats(ms[kk], sc[kk], sf[kk], ms[i], sf[i], ml[i])
                if not np.isfinite(r['base']): continue
                r.update(athlete_id=aid, date=dts[i], target_m=ms[i], y=float(np.log(sc[i]))); rows.append(r)
    return pd.DataFrame(rows)

def sub_rows(df, copies, seed=0):
    df = df.sort_values(['athlete_id', 'date']).reset_index(drop=True); ids = df.athlete_id.unique()
    parts = [(df[df.athlete_id.isin(c)], copies, seed + j) for j, c in enumerate(np.array_split(ids, 32))]
    with mp.get_context('fork').Pool(8) as p: out = p.map(_sub_chunk, parts)
    return pd.concat([o for o in out if len(o)], ignore_index=True)

for fold in FOLDS:
    t0 = time.time(); tr_a = set(a for a in P.athlete_id.unique() if fold_of[a] != fold)
    trn = PL[PL.athlete_id.isin(tr_a)]; ev = PL[~PL.athlete_id.isin(tr_a)]; res = {'y': ev.y.values, 'athlete': ev.athlete_id.values, 'sparse': (ev.n_results.values <= 2)}
    def cell(name, X, w=None):
        res[name] = pred_l(fit_l(X, w), ev); sp = res['sparse']
        print(f'  [fold {fold}] {name}: MAE {mae(ev.y.values, res[name]):.3f}%  sparse(<=2 prior) {mae(ev.y.values[sp], res[name][sp]):.3f}%  ({time.time()-t0:.0f}s)', flush=True)
    cell('real', trn)
    # (1) sub
    sb = sub_rows(R4[R4.athlete_id.isin(tr_a)], 3, seed=fold * 1000)
    for ratio in (0.5, 1, 2, 3):
        n = int(ratio * len(trn)); cell(f'sub_x{ratio:g}', pd.concat([trn, sb.iloc[:n]], ignore_index=True))
    # (2) low-data
    rng = np.random.default_rng(fold)
    for frac in (0.1, 0.25):
        keep = set(rng.choice(sorted(tr_a), int(frac * len(tr_a)), replace=False)); small = trn[trn.athlete_id.isin(keep)]
        cell(f'low{frac:g}_real', small)
        G = fit_gen(R4[R4.athlete_id.isin(keep)])
        syn = rows_lite(gen(G, int(8 * len(small) / 4.5), 'own', 'resample', seed=fold * 7 + 1, start_id=40_000_000))
        for ratio in (1, 4, 8):
            n = int(ratio * len(small)); cell(f'low{frac:g}_syn_x{ratio}', pd.concat([small, syn.iloc[:n]], ignore_index=True))
        cell(f'low{frac:g}_syn_only_x8', syn.iloc[:int(8 * len(small))])
    np.savez(f'{S}/sweep/lowsub_f{fold}.npz', **res)
