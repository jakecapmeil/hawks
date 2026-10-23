"""Fit/score helpers shared by the exp14 sweeps. Research here is the v1 feature set (FEATS3 + COURSE) on fast HGB trees, the Lite model is
the shipped 21-feature set at the shipped size (150 trees x 15 leaves, absolute-error loss, labels only); both predict log-seconds residual over `base`."""
from exp14_common import *
from common import HGB, HGB_FAST, mae, boot_ci, GroupKFold

FE = FEATS3 + COURSE
LITE_CFG = dict(loss='absolute_error', min_samples_leaf=60, l2_regularization=1.0, random_state=0, max_iter=150, max_leaf_nodes=15, learning_rate=0.1)

def load_nrcd(S):
    X4 = pd.read_pickle(f'{S}/rows4.pkl'); L = pd.read_pickle(f'{S}/lite730.pkl'); L['date'] = pd.to_datetime(L['date'])
    key = ['athlete_id', 'date', 'target_m']
    L = L.merge(X4[key + ['pool', 'final_test']], on=key, how='inner')
    return X4[X4.pool].reset_index(drop=True), X4[X4.final_test].reset_index(drop=True), L[L.pool].reset_index(drop=True), L[L.final_test].reset_index(drop=True)

def fit_r(X, w=None, cfg=HGB_FAST):
    return HGB(**cfg).fit(X[FE], (X.y - X.base).values, sample_weight=w)

def fit_l(L, w=None, cfg=LITE_CFG):
    return HGB(**cfg).fit(L[LITE_FEATS], (L.y - L.base).values, sample_weight=w)

def pred_r(m, X): return X.base.values + m.predict(X[FE])
def pred_l(m, L): return L.base.values + m.predict(L[LITE_FEATS])

def oof(P, extra, kind, wextra=1.0, folds=5, seed_groups=None):
    """GroupKFold OOF on pool P (by athlete); `extra` rows (never evaluated) are added to every training fold. kind: 'r' or 'l'."""
    fit, pred = (fit_r, pred_r) if kind == 'r' else (fit_l, pred_l)
    out = np.zeros(len(P))
    for tr, te in GroupKFold(folds).split(P, groups=P.athlete_id.values):
        T = P.iloc[tr] if extra is None or not len(extra) else pd.concat([P.iloc[tr], extra], ignore_index=True)
        w = None if extra is None or not len(extra) else np.r_[np.ones(len(tr)), np.full(len(extra), wextra)]
        out[te] = pred(fit(T, w), P.iloc[te])
    return out
