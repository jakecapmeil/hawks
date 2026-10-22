"""Feature-group ablation on the dev pool (5-fold by athlete). Final test untouched."""
from common import *
from build3 import EXTRA
S = sys.argv[1]; set_log(S)
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True); R = (P.y - P.base).values; Y = P.y.values
folds = list(GroupKFold(5).split(P, groups=P.athlete_id)); FULL = FEATS3 + COURSE
GROUPS = {
 'weather inputs (alt, temp)': ['alt', 'temp'], 'course elevation': ['elev_km'], 'course-difficulty (prior meets)': COURSE,
 'personal exponent (k_ind, base_slope, span, n_buckets)': ['k_ind', 'base_slope', 'span', 'n_buckets'],
 'recency + trend + volatility': ['base_rec', 'best_60d', 'last_lp', 'last_gap', 'trend100', 'vol'],
 'same-surface baseline': ['best_samesurf', 'n_samesurf'], 'season + experience (doy, career_days)': ['sin_doy', 'cos_doy', 'career_days'],
 'per-distance projections (p400..p21097)': [c for c in FEATS3 if c.startswith('p') and c[1:].isdigit()],
 'counts (n_prior, n_results, days_last)': ['n_prior', 'n_results', 'days_last'],
}
def cv(feats):
    o = np.zeros(len(P))
    for tr, te in folds: o[te] = HGB(**HGB_FAST).fit(P.iloc[tr][feats], R[tr]).predict(P.iloc[te][feats])
    return mae(Y, P.base.values + o), o
log('\n## exp9: feature-group ablation (dev pool, 5-fold by athlete, fast tuned trees)\n| removed group | MAE | change vs full | 95% CI of change |\n|---|---|---|---|')
full, of = cv(FULL); log(f'| (none, full model) | {full:.3f}% | | |')
for name, cols in GROUPS.items():
    keep = [c for c in FULL if c not in cols]; m, o = cv(keep)
    ci = boot_ci(Y, P.base.values + o, P.base.values + of, P.athlete_id.values)
    log(f'| {name} | {m:.3f}% | {m-full:+.3f} | {ci[0]:+.3f} to {ci[1]:+.3f} |')
