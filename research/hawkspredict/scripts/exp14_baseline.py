"""Score the current HawksPredict-Lite and -Research v1.1 (trained on NRCD only) on the Ontario high-school holdout runners.
Usage: exp14_baseline.py <scratch dir>   -> prints a table; writes ont_rows_full.pkl / ont_rows_lite.pkl (reused by later steps)"""
import sys, json, pickle
from exp14_common import *
from baselines import cameron_pred, vdot_pred, cs_pred
from common import mae, boot_ci
S = sys.argv[1]
o = pd.read_pickle(f'{S}/results_ont.pkl'); o4 = o[o.m >= 400].copy()           # Lite/Research cover 400 m and up
XF = rows_full(o4); XL = rows_lite(o4)
XF = XF.merge(o4[['athlete_id', 'holdout']].drop_duplicates(), on='athlete_id'); XL = XL.merge(o4[['athlete_id', 'holdout']].drop_duplicates(), on='athlete_id')
XF.to_pickle(f'{S}/ont_rows_full.pkl'); XL.to_pickle(f'{S}/ont_rows_lite.pkl')
print(f'Ontario rows (targets with a >=400 m history): {len(XF)} full, {len(XL)} lite; holdout rows {int(XF.holdout.sum())}')
H = XF[XF.holdout].reset_index(drop=True); HL = XL[XL.holdout].reset_index(drop=True)
y = H.y.values; a = H.athlete_id.values
lite = json.load(open(f'{S}/pace_lite.json')); pl = HL.base.values + lite_predict_json(lite, HL); yl = HL.y.values; al = HL.athlete_id.values
res = pickle.load(open(f'{S}/hawks_predict_research_v11.pkl', 'rb')); lr = res['lr']
D = H.copy(); D['d_cam'] = cameron_pred(D) - D.base; D['d_vdot'] = vdot_pred(D) - D.base; D['d_cs'] = cs_pred(D) - D.base; D['d_lmc'] = lr.predict(D) - D.base
pr = H.base.values + res['model'].predict(D[res['feats']])
print('| model | MAE | 95% CI | paired vs nearest-result Riegel |\n|---|---|---|---|')
for nm, p, yy, aa, near in [('Riegel (nearest result)', H.base_near.values, y, a, H.base_near.values), ('Lite (NRCD-trained)', pl, yl, al, HL.base_near.values),
                            ('Research v1.1 (NRCD-trained)', pr, y, a, H.base_near.values)]:
    ci = boot_ci(yy, p, None, aa); d = boot_ci(yy, p, near, aa) if nm != 'Riegel (nearest result)' else (0, 0)
    print(f'| {nm} | {mae(yy, p):.3f}% | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.2f} to {d[1]:+.2f} |')
print('signed bias (mean of exp(pred-y)-1): Riegel %+.2f%%, Lite %+.2f%%, Research %+.2f%%' % tuple(100 * np.mean(np.expm1(p - yy)) for p, yy in [(H.base_near.values, y), (pl, yl), (pr, y)]))
