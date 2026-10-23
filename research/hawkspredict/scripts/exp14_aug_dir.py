"""Build a scratch directory whose rows4.pkl / lite730.pkl are the NRCD rows plus extra pool rows, so the unchanged lite_train.py,
final_research.py and final_research_v11.py retrain both shipped models on the larger set. The NRCD frozen test rows are untouched.
Usage: exp14_aug_dir.py <scratch> <new dir> <ont: none|train|all> [synth pickle prefix | -] """
import os, sys, shutil
import numpy as np, pandas as pd
S, S2, ONT = sys.argv[1:4]; SYN = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != '-' else None
os.makedirs(S2, exist_ok=True)
for f in ('results4.pkl', 'exp7.pkl', 'lite1500.pkl', 'kaggle_raw', 'nrcd_raw'):          # inputs only; outputs (pace_lite.json, ...) are written fresh in the new dir
    if os.path.exists(f'{S}/{f}') and not os.path.exists(f'{S2}/{f}'): os.symlink(f'{S}/{f}', f'{S2}/{f}')
X4 = pd.read_pickle(f'{S}/rows4.pkl'); L = pd.read_pickle(f'{S}/lite730.pkl')
add_f, add_l = [], []
if ONT != 'none':
    xf = pd.read_pickle(f'{S}/ont_rows_full.pkl'); xl = pd.read_pickle(f'{S}/ont_rows_lite.pkl')
    if ONT == 'train': xf, xl = xf[~xf.holdout], xl[~xl.holdout]
    add_f.append(xf.drop(columns=['holdout'])); add_l.append(xl.drop(columns=['holdout']))
if SYN:
    add_f.append(pd.read_pickle(f'{SYN}_full.pkl')); add_l.append(pd.read_pickle(f'{SYN}_lite.pkl'))
for a in add_f: a['test_athlete'] = False; a['final_test'] = False; a['pool'] = True
X4a = pd.concat([X4] + add_f, ignore_index=True)
for a in add_l: a['date'] = pd.to_datetime(a['date'])
La = pd.concat([L] + add_l, ignore_index=True)
X4a.to_pickle(f'{S2}/rows4.pkl'); La.to_pickle(f'{S2}/lite730.pkl')
print(f'{S2}: full rows {len(X4)} -> {len(X4a)} (pool {int(X4a.pool.sum())}, final test {int(X4a.final_test.sum())}); lite rows {len(L)} -> {len(La)}')
