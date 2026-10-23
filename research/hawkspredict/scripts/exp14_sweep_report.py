"""Summarise exp14_synth_sweep.py / exp14_lowdata_sub.py outputs: pooled out-of-fold MAE per cell with an athlete-bootstrap CI of the change vs real-only.
Usage: exp14_sweep_report.py <scratch> <l|r>"""
import sys, glob
import numpy as np
from common import mae, boot_ci
S, KIND = sys.argv[1:3]

def load(files):
    D = [np.load(f, allow_pickle=True) for f in files]
    names = [k for k in D[0].files if k not in ('y', 'athlete', 'n_real', 'sparse')]
    return {k: np.concatenate([d[k] for d in D if k in d.files]) for k in names}, np.concatenate([d['y'] for d in D]), np.concatenate([d['athlete'] for d in D]), np.concatenate([d['sparse'] for d in D]) if 'sparse' in D[0].files else None

def table(files, title, cells_filter=None):
    if not files: return
    P, y, a, sp = load(files); real = P['real']
    print(f'\n### {title}  ({len(y)} held-out races, {len(files)} fold(s))\n| training set | MAE | change vs real only (95% CI) |' + (' sparse-input MAE (<=2 prior) |' if sp is not None else '') + '\n|---|---|---|' + ('---|' if sp is not None else ''))
    order = ['real'] + sorted([k for k in P if k != 'real'], key=lambda k: (k.split('_x')[0], float(k.split('_x')[1].split('_')[0]) if '_x' in k and k.split('_x')[1].split('_')[0].replace('.', '').isdigit() else 0, k))
    for k in order:
        if len(P[k]) != len(y): continue
        d = boot_ci(y, P[k], real, a) if k != 'real' else (0, 0)
        extra = f' {mae(y[sp], P[k][sp]):.3f}% |' if sp is not None else ''
        print(f'| {k} | {mae(y, P[k]):.3f}% | {d[0]:+.3f} to {d[1]:+.3f} |{extra}')

nrcd = sorted(glob.glob(f'{S}/sweep/{KIND}_f[0-9].npz'))
table(nrcd, f'{"Lite" if KIND == "l" else "Research"}: synthetic athletes added to the training folds, scored on held-out NRCD athletes')
table(glob.glob(f'{S}/sweep/{KIND}_f-1.npz'), f'{"Lite" if KIND == "l" else "Research"}: synthetic athletes added to all of NRCD, scored on the Ontario holdout')
if KIND == 'l': table(sorted(glob.glob(f'{S}/sweep/lowsub_f*.npz')), 'Lite: history-subsampling copies and the low-data regime (NRCD folds)')
