"""Does adding the Ontario high-school runners (train half) and the elite dated marks help? Scored on NRCD dev (5-fold by athlete) and the
Ontario holdout runners (never trained on). Usage: exp14_data_step.py <scratch dir>"""
import sys
from exp14_fit import *
S = sys.argv[1]
P, F, PL, FL = load_nrcd(S)                       # F / FL (frozen NRCD test) are not touched here
XF = pd.read_pickle(f'{S}/ont_rows_full.pkl'); XL = pd.read_pickle(f'{S}/ont_rows_lite.pkl')
if not __import__('os').path.exists(f'{S}/elite_rows_full.pkl'):
    el = pd.read_pickle(f'{S}/results_elite.pkl'); el = el[el.m >= 400]
    rows_full(el).to_pickle(f'{S}/elite_rows_full.pkl'); rows_lite(el).to_pickle(f'{S}/elite_rows_lite.pkl')
EF = pd.read_pickle(f'{S}/elite_rows_full.pkl'); EL = pd.read_pickle(f'{S}/elite_rows_lite.pkl')
OtF, OhF = XF[~XF.holdout].reset_index(drop=True), XF[XF.holdout].reset_index(drop=True)
OtL, OhL = XL[~XL.holdout].reset_index(drop=True), XL[XL.holdout].reset_index(drop=True)
print(f'NRCD pool {len(P)} | Ontario train {len(OtF)} holdout {len(OhF)} | elite {len(EF)} rows ({EF.athlete_id.nunique()} athletes)')
y, a = P.y.values, P.athlete_id.values
cfgs = [('NRCD only', None, None, 1), ('+ Ontario train', OtF, OtL, 1), ('+ elite (w=1)', EF, EL, 1), ('+ elite (w=0.3)', EF, EL, 0.3),
        ('+ Ontario + elite (w=0.3)', 'both', 'both', 0.3)]
for kind, nm in (('l', 'LITE'), ('r', 'RESEARCH')):
    print(f'\n### {nm}\n| training data | NRCD dev MAE | change vs NRCD only (95% CI) | Ontario holdout MAE | change vs NRCD only (95% CI) |\n|---|---|---|---|---|')
    base_o = base_p = None
    for name, ef, el_, w in cfgs:
        P_ = P if kind == 'r' else PL; yy, aa = P_.y.values, P_.athlete_id.values
        if isinstance(ef, str):
            ex = pd.concat([OtF.assign(_w=1.0), EF.assign(_w=0.3)], ignore_index=True) if kind == 'r' else pd.concat([OtL.assign(_w=1.0), EL.assign(_w=0.3)], ignore_index=True)
            wx = ex._w.values
        else:
            ex = None if ef is None else (ef if kind == 'r' else el_); wx = None if ex is None else np.full(len(ex), float(w))
        # OOF with per-row extra weights
        fit, pred = (fit_r, pred_r) if kind == 'r' else (fit_l, pred_l); out = np.zeros(len(P_))
        for tr, te in GroupKFold(5).split(P_, groups=aa):
            T = P_.iloc[tr] if ex is None else pd.concat([P_.iloc[tr], ex.drop(columns=['_w'], errors='ignore')], ignore_index=True)
            out[te] = pred(fit(T, None if ex is None else np.r_[np.ones(len(tr)), wx]), P_.iloc[te])
        T = P_ if ex is None else pd.concat([P_, ex.drop(columns=['_w'], errors='ignore')], ignore_index=True)
        m = fit(T, None if ex is None else np.r_[np.ones(len(P_)), wx])
        H = OhF if kind == 'r' else OhL; ph = pred(m, H)
        if base_o is None: base_o, base_p = out, ph
        d1 = boot_ci(yy, out, base_o, aa) if name != 'NRCD only' else (0, 0); d2 = boot_ci(H.y.values, ph, base_p, H.athlete_id.values) if name != 'NRCD only' else (0, 0)
        print(f'| {name} | {mae(yy, out):.3f}% | {d1[0]:+.3f} to {d1[1]:+.3f} | {mae(H.y.values, ph):.3f}% | {d2[0]:+.3f} to {d2[1]:+.3f} |', flush=True)
