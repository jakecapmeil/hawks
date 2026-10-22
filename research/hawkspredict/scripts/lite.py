"""Date-free, serve-time-only features for the website model. Mirrored 1:1 in src/pacemodel.js."""
import numpy as np
K = 1.06
REFS = [400.0, 800.0, 1500.0, 3000.0, 5000.0, 6000.0, 8000.0, 21097.5]
LREFS = np.log(np.array(REFS))
SURF = {'xc': 0, 'track': 1, 'indoor': 2, 'road': 3}
LITE_FEATS = ['log_d', 'surf', 'male', 'n_results', 'p400', 'p800', 'p1500', 'p3000', 'p5000', 'p6000', 'p8000', 'p21097',
              'base', 'base_near', 'base_best', 'n_buckets', 'k_ind', 'base_slope', 'span', 'best_samesurf', 'n_samesurf']

def bucket_of(m):
    return int(np.argmin(np.abs(LREFS - np.log(m))))

def lite_feats(ms, secs, surfs, target_m, tsurf, male):
    """ms, secs: arrays of prior results (meters, seconds); surfs: list of surface names."""
    lt = np.log(target_m); nan = float('nan')
    f = {k: nan for k in LITE_FEATS}
    f['log_d'] = lt; f['surf'] = float(SURF[tsurf]); f['male'] = float(male); f['n_results'] = float(len(ms))
    if len(ms) == 0: return f
    ms = np.asarray(ms, float); secs = np.asarray(secs, float)
    bk = np.array([bucket_of(m) for m in ms])
    preds, ws = [], []
    for b in sorted(set(bk)):
        sel = bk == b; ref = REFS[b]
        adj = secs[sel] * (ref / ms[sel]) ** K
        p = np.log(adj.min() * (target_m / ref) ** K)
        f[f'p{int(ref)}'] = p; preds.append(p); ws.append(1.0 / (0.15 + abs(np.log(target_m / ref))))
    preds = np.array(preds); ws = np.array(ws)
    f['base'] = float((preds * ws).sum() / ws.sum()); f['base_near'] = float(preds[int(np.argmax(ws))]); f['base_best'] = float(preds.min())
    # personal exponent from each bucket's fastest raw result
    xs, ys = [], []
    for b in sorted(set(bk)):
        idx = np.where(bk == b)[0]; j = idx[int(np.argmin(secs[idx]))]; xs.append(np.log(ms[j])); ys.append(np.log(secs[j]))
    xs = np.array(xs); ys = np.array(ys); f['n_buckets'] = float(len(xs))
    if len(xs) >= 2:
        span = xs.max() - xs.min(); f['span'] = float(span)
        if span >= 0.4:
            xm, ym = xs.mean(), ys.mean(); k = float(((xs - xm) * (ys - ym)).sum() / ((xs - xm) ** 2).sum())
            k = min(max(k, 0.95), 1.25); f['k_ind'] = k
            i = int(np.argmin(np.abs(xs - lt))); f['base_slope'] = float(ys[i] + k * (lt - xs[i]))
    ss = np.array([s == tsurf for s in surfs]); f['n_samesurf'] = float(ss.sum())
    if ss.any(): f['best_samesurf'] = float((np.log(secs[ss]) + K * (lt - np.log(ms[ss]))).min())
    return f
