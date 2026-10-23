"""Do the Ontario gains survive when the inputs are months old (as PRs are on the site)? Lite rows are rebuilt with every input result at least MIN_AGE days
older than the target (a previous season: the Ontario finals are a year apart). Scores, on the Ontario holdout runners: Lite v1 (NRCD only), Lite v1.1
(Ontario same-weekend rows in training), and a Lite trained with Ontario rows built the same cross-year way. Also interval coverage from the JSON tables.
Usage: exp14_crossyear.py <scratch> [min age days, default 150]"""
import sys, json
import exp14_common as C
from exp14_fit import *
S = sys.argv[1]; C.MIN_AGE = int(sys.argv[2]) if len(sys.argv) > 2 else 150
o = pd.read_pickle(f'{S}/results_ont.pkl'); o = o[o.m >= 400]
XL = C.rows_lite(o).merge(o[['athlete_id', 'holdout']].drop_duplicates(), on='athlete_id')
OtX, OhX = XL[~XL.holdout].reset_index(drop=True), XL[XL.holdout].reset_index(drop=True)
P, F, PL, FL = load_nrcd(S)
print(f'cross-year Ontario rows (inputs >= {C.MIN_AGE} days old): train {len(OtX)}, holdout {len(OhX)} races from {OhX.athlete_id.nunique()} runners; median inputs {OhX.n_results.median():.0f}')
y, a = OhX.y.values, OhX.athlete_id.values
def cover(art, D, p):
    def grp(nb, d): return f"{int(min(nb, 3))}|{0 if d <= 1700 else 1 if d <= 4100 else 2 if d <= 7000 else 3}"
    g = [grp(n, d) for n, d in zip(D.n_buckets.fillna(0), D.target_m)]; t = art['interval']
    lo = np.array([p[i] + t.get(g[i], t['1|0'])[0] for i in range(len(D))]); hi = np.array([p[i] + t.get(g[i], t['1|0'])[1] for i in range(len(D))])
    return 100 * np.mean((D.y.values >= lo) & (D.y.values <= hi)), 100 * np.mean((np.exp(hi) - np.exp(lo)) / np.exp(D.y.values)) / 2
v1 = json.load(open(f'{S}/pace_lite.json')); v11 = json.load(open(f'{S}/aug_train/pace_lite.json'))
res = {}
res['Lite v1 (NRCD only, shipped)'] = (OhX.base.values + C.lite_predict_json(v1, OhX), v1)
res['Lite v1.1-train-half (Ontario same-weekend rows)'] = (OhX.base.values + C.lite_predict_json(v11, OhX), v11)
res['Lite fit here: NRCD only'] = (pred_l(fit_l(PL), OhX), None)
res['Lite fit here: + Ontario same-weekend rows'] = (pred_l(fit_l(pd.concat([PL, pd.read_pickle(f"{S}/ont_rows_lite.pkl").query("not holdout").drop(columns=["holdout"])], ignore_index=True)), OhX), None)
res['Lite fit here: + Ontario cross-year rows'] = (pred_l(fit_l(pd.concat([PL, OtX.drop(columns=['holdout'])], ignore_index=True)), OhX), None)
base = res['Lite v1 (NRCD only, shipped)'][0]
print('| Lite | Ontario holdout MAE, inputs >= 150 days old | change vs v1 (95% CI) | 80% coverage / half-width |\n|---|---|---|---|')
for k, (p, art) in res.items():
    d = boot_ci(y, p, base, a) if p is not base else (0, 0); cv = cover(art, OhX, p) if art else (float('nan'), float('nan'))
    print(f'| {k} | {mae(y, p):.3f}% | {d[0]:+.3f} to {d[1]:+.3f} | {cv[0]:.1f}% / {cv[1]:.1f}% |')
XS = pd.read_pickle(f'{S}/ont_rows_lite.pkl'); HS = XS[XS.holdout].reset_index(drop=True)
for k, art in (('v1', v1), ('v1.1-train-half', v11)):
    p = HS.base.values + C.lite_predict_json(art, HS); cv = cover(art, HS, p); print(f'same-weekend holdout interval, {k}: coverage {cv[0]:.1f}%, half-width {cv[1]:.1f}%')
