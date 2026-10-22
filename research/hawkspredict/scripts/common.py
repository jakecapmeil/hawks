import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.model_selection import GroupKFold
import model as M
from build3 import FEATS3
from build4 import COURSE

LOG = None
def set_log(S):
    global LOG; LOG = f'{S}/results_log.md'
def log(line):
    print(line, flush=True)
    if LOG: open(LOG, 'a').write(line + '\n')

rel = lambda y, p: np.abs(np.expm1(p - y))
def mae(y, p): return 100 * rel(y, p).mean()

def boot_ci(y, pa, pb=None, athletes=None, n=300, seed=0):
    """Athlete-clustered bootstrap CI for MAE of pa (or of pa - pb, paired)."""
    rng = np.random.default_rng(seed); ea = rel(y, pa) * 100
    e = ea if pb is None else ea - rel(y, pb) * 100
    df = pd.DataFrame({'a': athletes, 'e': e}).groupby('a').e.agg(['sum', 'count'])
    s, c = df['sum'].values, df['count'].values; k = len(df); out = []
    for _ in range(n):
        i = rng.integers(0, k, k); out.append(s[i].sum() / c[i].sum())
    return np.percentile(out, [2.5, 97.5])

HGB_FAST = dict(loss='absolute_error', max_iter=400, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=60,
                l2_regularization=1.0, random_state=0)
