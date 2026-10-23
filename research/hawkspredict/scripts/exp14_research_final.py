"""HawksPredict-Research (point model stacked with Cameron / VDOT / critical speed / low-rank, as v1.1) retrained on the rows in <dir>/rows4.pkl
(NRCD pool + any added pool rows), plus conformalised 80% quantile intervals; scores the frozen NRCD test and the Ontario holdout runners.
Usage: exp14_research_final.py <dir with rows4.pkl, exp7.pkl> <scratch (v1.1 pickle, ont_rows_full.pkl)> <label>"""
import sys, pickle
from exp14_common import *
from common import HGB, mae, boot_ci, log, set_log
from baselines import cameron_pred, vdot_pred, cs_pred, LowRank
D2, S, LABEL = sys.argv[1:4]
X = pd.read_pickle(f'{D2}/rows4.pkl'); FE = FEATS3 + COURSE; STK = ['d_cam', 'd_vdot', 'd_cs', 'd_lmc']
ch = pickle.load(open(f'{D2}/exp7.pkl', 'rb'))['chosen']['HGB']
P0 = X[X.pool].reset_index(drop=True); T = X[X.final_test].reset_index(drop=True)
rng = np.random.default_rng(7); ath = np.sort(P0.athlete_id.unique()); rng.shuffle(ath); cal = set(ath[: int(0.15 * len(ath))])
cm = P0.athlete_id.isin(cal).values; Ptr = P0[~cm].reset_index(drop=True); Pcal = P0[cm].reset_index(drop=True)
lr = LowRank().fit(Ptr)
def stack(D):
    D = D.copy(); D['d_cam'] = cameron_pred(D) - D.base; D['d_vdot'] = vdot_pred(D) - D.base; D['d_cs'] = cs_pred(D) - D.base; D['d_lmc'] = lr.predict(D) - D.base; return D
Str, Sc, Ts = stack(Ptr), stack(Pcal), stack(T)
m = HGB(loss='absolute_error', early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0, **ch).fit(Str[FE + STK], (Str.y - Str.base).values)
qkw = dict(ch); qkw.pop('max_iter', None); qkw.update(max_iter=400)
lo_m = HGB(loss='quantile', quantile=0.1, random_state=0, **qkw).fit(Str[FE + STK], (Str.y - Str.base).values); hi_m = HGB(loss='quantile', quantile=0.9, random_state=0, **qkw).fit(Str[FE + STK], (Str.y - Str.base).values)
yc = Sc.y.values; lo = Sc.base.values + lo_m.predict(Sc[FE + STK]); hi = Sc.base.values + hi_m.predict(Sc[FE + STK]); adj = float(np.quantile(np.maximum(lo - yc, yc - hi), 0.8 * (1 + 1 / len(yc))))
def run(D, name):
    p = D.base.values + m.predict(D[FE + STK]); l = D.base.values + lo_m.predict(D[FE + STK]) - adj; h = D.base.values + hi_m.predict(D[FE + STK]) + adj
    return p, 100 * np.mean((D.y.values >= l) & (D.y.values <= h)), 100 * np.mean((np.exp(h) - np.exp(l)) / np.exp(D.y.values)) / 2
pT, covT, hwT = run(Ts, 'test'); y, a = T.y.values, T.athlete_id.values
print(f'## Research retrain [{LABEL}]: pool rows {len(P0)} (train {len(Ptr)}, calibration {len(Pcal)})')
ci = boot_ci(y, pT, None, a); print(f'FROZEN NRCD TEST ({len(T)} races): {mae(y, pT):.3f}% [{ci[0]:.2f}, {ci[1]:.2f}]  80% coverage {covT:.1f}%, half-width {hwT:.1f}%')
oh = pd.read_pickle(f'{S}/ont_rows_full.pkl'); oh = oh[oh.holdout].reset_index(drop=True); pO, covO, hwO = run(stack(oh), 'ont')
ci = boot_ci(oh.y.values, pO, None, oh.athlete_id.values); print(f'ONTARIO HOLDOUT ({len(oh)} races): {mae(oh.y.values, pO):.3f}% [{ci[0]:.2f}, {ci[1]:.2f}]  80% coverage {covO:.1f}%, half-width {hwO:.1f}%')
np.save(f'{D2}/research_{LABEL}_test_pred.npy', pT)
pickle.dump(dict(model=m, lo=lo_m, hi=hi_m, adj=adj, lr=lr, feats=FE + STK, label=LABEL), open(f'{D2}/hawks_predict_research_{LABEL}.pkl', 'wb'))
