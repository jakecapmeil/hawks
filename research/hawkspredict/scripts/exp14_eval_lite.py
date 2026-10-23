"""Score exported Lite JSON files on the Ontario holdout runners. Usage: exp14_eval_lite.py <scratch> <label=json> ..."""
import sys, json
from exp14_common import *
from common import mae, boot_ci
S = sys.argv[1]; XL = pd.read_pickle(f'{S}/ont_rows_lite.pkl'); H = XL[XL.holdout].reset_index(drop=True)
y, a = H.y.values, H.athlete_id.values; base = None
print(f'Ontario holdout: {len(H)} races, {H.athlete_id.nunique()} runners\n| model | MAE | 95% CI | change vs first (95% CI) |\n|---|---|---|---|')
for arg in sys.argv[2:]:
    lab, path = arg.split('=', 1); p = H.base.values + lite_predict_json(json.load(open(path)), H)
    if base is None: base = p
    ci = boot_ci(y, p, None, a); d = boot_ci(y, p, base, a) if p is not base else (0, 0)
    print(f'| {lab} | {mae(y, p):.3f}% | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.3f} to {d[1]:+.3f} |')
    for m, g in H.groupby(H.target_m.round()): print(f'|  . {int(m)} m | {mae(g.y.values, p[g.index]):.2f}% (n={len(g)}) | | |') if lab.endswith('*') else None
