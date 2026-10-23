"""What happens as the amount of synthetic training data grows? Synthetic athletes (exp14_synth.py) are fitted on and generated from the TRAINING
athletes of each fold only; scoring is on real held-out NRCD athletes (5-fold by athlete) and, in the 'full' run (fold -1), on the Ontario holdout runners.
Cells: synthetic mode (own / pop) x amount (0.5, 1, 2, 4, 8 x the real training rows) x synthetic weight (1, 0.25), plus real only and synthetic only.
Usage: exp14_synth_sweep.py <scratch> <kind l|r> <folds comma list, -1 = full pool -> Ontario holdout> [ratios]   Output: <scratch>/sweep/<kind>_f<fold>.npz"""
import os, sys, time, pickle
from exp14_fit import *
from exp14_synth import fit_gen, gen

S, KIND, FOLDS = sys.argv[1], sys.argv[2], [int(f) for f in sys.argv[3].split(',')]
RATIOS = [float(r) for r in (sys.argv[4] if len(sys.argv) > 4 else '0.5,1,2,4,8').split(',')]
os.makedirs(f'{S}/sweep', exist_ok=True)
R4 = pd.read_pickle(f'{S}/results4.pkl'); P, F, PL, FL = load_nrcd(S)
XF = pd.read_pickle(f'{S}/ont_rows_full.pkl'); XL = pd.read_pickle(f'{S}/ont_rows_lite.pkl')
OhF, OhL = XF[XF.holdout].reset_index(drop=True), XL[XL.holdout].reset_index(drop=True)
ath = np.sort(P.athlete_id.unique()); fold_of = {}
for k, (tr, te) in enumerate(GroupKFold(5).split(P, groups=P.athlete_id.values)):
    for a in P.athlete_id.values[te]: fold_of[a] = k
fit, pred, Real, FEAT = (fit_r, pred_r, P, 'full') if KIND == 'r' else (fit_l, pred_l, PL, 'lite')
builder = rows_full if KIND == 'r' else rows_lite

def synth_rows(fold, mode, G, need_rows):
    """Cached synthetic rows for this fold/mode (enough for the largest ratio)."""
    fn = f'{S}/sweep/syn_{KIND}_{mode}_f{fold}.pkl'
    if os.path.exists(fn):
        X = pd.read_pickle(fn)
        if len(X) >= need_rows: return X
    out, n, seed = [], 0, 100 * (fold + 2) + (mode == 'pop')
    while n < need_rows:
        X = builder(gen(G, 3000, mode, 'resample', seed=seed, start_id=30_000_000 + seed * 10_000)); out.append(X); n += len(X); seed += 1
    X = pd.concat(out, ignore_index=True); X.to_pickle(fn); return X

for fold in FOLDS:
    t0 = time.time()
    if fold >= 0:
        tr_a = np.array([a for a in ath if fold_of[a] != fold]); ev = Real[Real.athlete_id.map(fold_of) == fold]; trn = Real[Real.athlete_id.map(fold_of) != fold]
    else:
        tr_a = ath; ev = OhF if KIND == 'r' else OhL; trn = Real
    G = fit_gen(R4[R4.athlete_id.isin(set(tr_a))])
    res = {'y': ev.y.values, 'athlete': ev.athlete_id.values, 'n_real': len(trn)}
    def cell(name, X, w):
        res[name] = pred(fit(X, w), ev); print(f'  [{KIND} fold {fold}] {name}: MAE {mae(ev.y.values, res[name]):.3f}%  ({time.time()-t0:.0f}s)', flush=True)
    cell('real', trn, None)
    for mode in ('own', 'pop'):
        syn = synth_rows(fold, mode, G, int(max(RATIOS) * len(trn)))
        for ratio in RATIOS:
            n = int(ratio * len(trn)); sub = syn.iloc[:n]
            for w in ((1.0, 0.25) if ratio >= 2 else (1.0,)):
                cell(f'{mode}_x{ratio:g}_w{w:g}', pd.concat([trn, sub], ignore_index=True), np.r_[np.ones(len(trn)), np.full(len(sub), w)])
        cell(f'{mode}_only_x{max(RATIOS):g}', syn.iloc[:int(max(RATIOS) * len(trn))], None)
    np.savez(f'{S}/sweep/{KIND}_f{fold}.npz', **{k: v for k, v in res.items()})
