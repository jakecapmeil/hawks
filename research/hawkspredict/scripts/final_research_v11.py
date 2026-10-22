"""HawksPredict-Research v1.1 = v1 + the other models' predictions as inputs (the only 'learn from others' variant that helped on dev).
Scored once on the frozen test, paired against v1."""
from common import *
import pickle
from baselines import cameron_pred, vdot_pred, cs_pred, LowRank
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); FE = FEATS3 + COURSE; STK = ['d_cam', 'd_vdot', 'd_cs', 'd_lmc']
ch = pickle.load(open(f'{S}/exp7.pkl', 'rb'))['chosen']['HGB']
P0 = X[X.pool].reset_index(drop=True); T = X[X.final_test].reset_index(drop=True)
rng = np.random.default_rng(7); ath = np.sort(P0.athlete_id.unique()); rng.shuffle(ath); cal = set(ath[: int(0.15 * len(ath))])
Ptr = P0[~P0.athlete_id.isin(cal).values].reset_index(drop=True)          # same training rows as v1
lr = LowRank().fit(Ptr)
def stack(D):
    D = D.copy(); D['d_cam'] = cameron_pred(D) - D.base; D['d_vdot'] = vdot_pred(D) - D.base; D['d_cs'] = cs_pred(D) - D.base; D['d_lmc'] = lr.predict(D) - D.base; return D
Str, Ts = stack(Ptr), stack(T)
m = HGB(loss='absolute_error', early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0, **ch).fit(Str[FE + STK], (Str.y - Str.base).values)
p11 = T.base.values + m.predict(Ts[FE + STK])
v1 = pickle.load(open(f'{S}/hawks_predict_research.pkl', 'rb')); p1 = T.base.values + v1['hgb'].predict(T[FE])
y = T.y.values; a = T.athlete_id.values
log('\n## HawksPredict-Research v1.1 (stacked with other models) on the frozen test (touched once)\n| model | MAE | 95% CI | paired change vs v1 |\n|---|---|---|---|')
for nm, p in [('v1', p1), ('v1.1 (+ Cameron, VDOT, critical speed, low-rank as inputs)', p11)]:
    ci = boot_ci(y, p, None, a); d = boot_ci(y, p, p1, a) if nm != 'v1' else (0, 0)
    log(f'| {nm} | {mae(y, p):.3f}% | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.3f} to {d[1]:+.3f} |')
pickle.dump(dict(model=m, lr=lr, feats=FE + STK), open(f'{S}/hawks_predict_research_v11.pkl', 'wb'))
