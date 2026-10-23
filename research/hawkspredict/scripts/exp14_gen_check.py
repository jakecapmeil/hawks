"""Realism check of the synthetic generator: fit on 80% of pool athletes, generate, and compare with held-out real athletes on (a) the nearest-result
Riegel error, (b) the spread of the residual, (c) a real-trained model's error."""
import sys, time
from exp14_fit import *
from exp14_synth import fit_gen, gen
S = sys.argv[1]
R4 = pd.read_pickle(f'{S}/results4.pkl'); P, F, PL, FL = load_nrcd(S)
pa = np.sort(P.athlete_id.unique()); rng = np.random.default_rng(1); rng.shuffle(pa); tr_a, ev_a = set(pa[: int(.8 * len(pa))]), set(pa[int(.8 * len(pa)):])
Rtr = R4[R4.athlete_id.isin(tr_a)]; t0 = time.time(); G = fit_gen(Rtr)
print(f'fit_gen {time.time()-t0:.0f}s: {len(G["ids"])} athletes with latents; esd {G["esd"]:.4f}; pop male mean {np.round(G["pop"][1]["mean"],3)} sd {np.round(G["pop"][1]["sd"],3)}; female mean {np.round(G["pop"][0]["mean"],3)} sd {np.round(G["pop"][0]["sd"],3)}')
Xtr = P[P.athlete_id.isin(tr_a)]; Xev = P[P.athlete_id.isin(ev_a)]
m = fit_r(Xtr); print(f'real-trained Research: train-athletes in-sample {mae(Xtr.y.values, pred_r(m, Xtr)):.2f}%  held-out real athletes {mae(Xev.y.values, pred_r(m, Xev)):.2f}%  | Riegel nearest: train {mae(Xtr.y.values, Xtr.base_near.values):.2f}% eval {mae(Xev.y.values, Xev.base_near.values):.2f}%')
for mode in ('own', 'pop'):
    for noise in ('resample', 'gauss'):
        t0 = time.time(); syn = gen(G, 2500, mode, noise, seed=3); Xs = rows_full(syn)
        print(f'{mode:3s}/{noise:8s}: {len(Xs)} rows in {time.time()-t0:.0f}s | Riegel nearest {mae(Xs.y.values, Xs.base_near.values):.2f}% | real-trained Research {mae(Xs.y.values, pred_r(m, Xs)):.2f}% | '
              f'resid sd (y-base) syn {np.std(Xs.y-Xs.base):.4f} real {np.std(Xev.y-Xev.base):.4f} | mean base-bias syn {np.mean(Xs.y-Xs.base):+.4f} real {np.mean(Xev.y-Xev.base):+.4f} | n_results median {Xs.n_results.median():.0f} vs {Xev.n_results.median():.0f}')
