"""Do history-subsampling copies (real labels, 1-3 earlier results as inputs) help Lite on the Ontario teens, whose inputs are sparse?
Lite trained on NRCD pool + Ontario train half, with and without copies; scored on the Ontario holdout. Usage: exp14_sub_ont.py <scratch>"""
import sys
from exp14_fit import *
S = sys.argv[1]
R4 = pd.read_pickle(f'{S}/results4.pkl'); P, F, PL, FL = load_nrcd(S)
o = pd.read_pickle(f'{S}/results_ont.pkl'); o = o[o.m >= 400]; XL = pd.read_pickle(f'{S}/ont_rows_lite.pkl')
OtL, OhL = XL[~XL.holdout].reset_index(drop=True), XL[XL.holdout].reset_index(drop=True)
pool_a = set(P.athlete_id.unique()); sub_n = sub_rows(R4[R4.athlete_id.isin(pool_a)], 3, seed=11); sub_o = sub_rows(o[~o.holdout], 3, seed=12)
print(f'copies: NRCD {len(sub_n)} rows, Ontario-train {len(sub_o)} rows')
y, a = OhL.y.values, OhL.athlete_id.values; base = None
print('| Lite trained on | Ontario holdout MAE | change vs first (95% CI) | rows with <=2 prior results |\n|---|---|---|---|')
sp = OhL.n_results.values <= 2
for name, T in [('NRCD + Ontario train', pd.concat([PL, OtL])), ('+ NRCD copies x3', pd.concat([PL, OtL, sub_n])), ('+ NRCD copies x3 + Ontario copies x3', pd.concat([PL, OtL, sub_n, sub_o])), ('NRCD only', PL), ('NRCD + NRCD copies x3', pd.concat([PL, sub_n]))]:
    p = pred_l(fit_l(T.reset_index(drop=True)), OhL); base = p if base is None else base
    d = boot_ci(y, p, base, a) if p is not base else (0, 0)
    print(f'| {name} | {mae(y, p):.3f}% | {d[0]:+.3f} to {d[1]:+.3f} | {mae(y[sp], p[sp]):.3f}% (n={int(sp.sum())}) |', flush=True)
