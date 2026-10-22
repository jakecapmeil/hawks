"""Train HawksPredict on its mistakes, using the other models: (B) stack their predictions as inputs,
(C) mistake-weighted retraining where another model was right, (E) both. Dev pool only, nested so no weight uses a test fold."""
from common import *
from baselines import cameron_pred, vdot_pred, cs_pred, LowRank
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True); FE = FEATS3 + COURSE
R = (P.y - P.base).values; Y = P.y.values; A = P.athlete_id.values
t0 = time.time()
cam, vd, cs = cameron_pred(P), vdot_pred(P), cs_pred(P)
log(f'\n## exp10: learning from the other models\' correct answers (dev pool, 5-fold by athlete)\n(parameter-free models computed in {time.time()-t0:.0f}s)\n')
def add_stack(D, lmc):
    D = D.copy()
    D['d_cam'] = cam_[D.index] - D.base; D['d_vdot'] = vd_[D.index] - D.base; D['d_cs'] = cs_[D.index] - D.base; D['d_lmc'] = lmc - D.base
    return D
cam_, vd_, cs_ = pd.Series(cam, index=P.index), pd.Series(vd, index=P.index), pd.Series(cs, index=P.index)
STK = ['d_cam', 'd_vdot', 'd_cs', 'd_lmc']
folds = list(GroupKFold(5).split(P, groups=A))
def fit(D, feats, w=None, idx=None):
    return HGB(**HGB_FAST).fit(D[feats], (D.y - D.base).values, sample_weight=w)
def others_err(D, lmc):
    cols = np.column_stack([np.abs(np.expm1(cam_[D.index].values - D.y.values)), np.abs(np.expm1(vd_[D.index].values - D.y.values)),
                            np.abs(np.expm1(cs_[D.index].values - D.y.values)), np.abs(np.expm1(lmc - D.y.values)), np.abs(np.expm1(D.base_near.values - D.y.values))])
    return np.nanmin(np.where(np.isfinite(cols), cols, np.nan), axis=1)
oofA, oofB, oofC, oofE = [np.zeros(len(P)) for _ in range(4)]
for k, (tr, te) in enumerate(folds):
    Ptr, Pte = P.iloc[tr], P.iloc[te]
    lr = LowRank().fit(Ptr); lm_tr, lm_te = lr.predict(Ptr), lr.predict(Pte)
    Str, Ste = add_stack(Ptr, lm_tr), add_stack(Pte, lm_te)
    oofA[te] = fit(Ptr, FE).predict(Pte[FE])
    oofB[te] = fit(Str, FE + STK).predict(Ste[FE + STK])
    # mistake weights from an inner out-of-fold pass on the training rows only
    inner = np.zeros(len(Ptr))
    for a, b in GroupKFold(3).split(Ptr, groups=Ptr.athlete_id):
        inner[b] = fit(Ptr.iloc[a], FE).predict(Ptr.iloc[b][FE])
    ours = np.abs(np.expm1((Ptr.base.values + inner) - Ptr.y.values)); best_other = others_err(Ptr, lm_tr)
    gap = np.clip(ours - np.nan_to_num(best_other, nan=1e9), 0, None)          # how much better some other model was, where it was
    w = 1 + 3.0 * gap / (gap[gap > 0].mean() if (gap > 0).any() else 1)
    oofC[te] = fit(Ptr, FE, w=w).predict(Pte[FE])
    oofE[te] = fit(Str, FE + STK, w=w).predict(Ste[FE + STK])
    log(f'  fold {k+1}/5 done ({time.time()-t0:.0f}s)')
base_mae = mae(Y, P.base.values + oofA)
log('| variant | MAE | change vs current | 95% CI of change |\n|---|---|---|---|')
for nm, o in [('A current HawksPredict-Research features', oofA), ('B + other models\' predictions as inputs (stacking)', oofB),
              ('C retrain with extra weight on rows where another model beat us', oofC), ('E both', oofE)]:
    p = P.base.values + o; ci = boot_ci(Y, p, P.base.values + oofA, A) if nm[0] != 'A' else (0, 0)
    log(f'| {nm} | {mae(Y, p):.3f}% | {mae(Y, p)-base_mae:+.3f} | {ci[0]:+.3f} to {ci[1]:+.3f} |')
ours = np.abs(np.expm1(P.base.values + oofA - Y)); bo = others_err(P, LowRank().fit(P).predict(P))
log(f'\nrows where some other model beats ours: {100*np.mean(bo < ours):.0f}% (as expected from noise: with 5 models picked per row, an oracle would be right that often); an oracle that always picks the best model per row would score {np.nanmean(np.minimum(ours, bo))*100:.2f}% (not achievable: it needs the answer)')
