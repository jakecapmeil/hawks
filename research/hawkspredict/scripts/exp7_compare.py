"""Fair family comparison. Tuning athletes (30% of pool) are disjoint from evaluation athletes (70% of pool).
Every learned family gets the same random-search budget on the tuning athletes, then 5-fold by athlete on the rest."""
from common import *
import pickle, torch, torch.nn as nn
from catboost import CatBoostRegressor
from baselines import all_baselines

torch.set_num_threads(os.cpu_count() or 4); torch.manual_seed(0)
S = sys.argv[1]; set_log(S); rng = np.random.default_rng(1)
X = pd.read_pickle(f'{S}/rows4.pkl'); P = X[X.pool].reset_index(drop=True)
FE = FEATS3 + COURSE
ath = np.sort(P.athlete_id.unique()); rng.shuffle(ath); T_ath = set(ath[: int(0.3 * len(ath))])
Tm = P.athlete_id.isin(T_ath).values; Tn, En = np.where(Tm)[0], np.where(~Tm)[0]
R = (P.y - P.base).values.astype(np.float32); Y = P.y.values
log(f'\n## exp7: fair comparison (tuning athletes {len(Tn)} rows, evaluation athletes {len(En)} rows)\n')

# ---------- sequences for the transformer (aligned to P by athlete/date/target) ----------
df = pd.read_pickle(f'{S}/results4.pkl').sort_values(['athlete_id', 'date']).reset_index(drop=True)
Lq = 24; key = {(a, d, m): i for i, (a, d, m) in enumerate(zip(P.athlete_id.values, P.date.values, P.target_m.values))}
seq = np.zeros((len(P), Lq, 8), np.float32); msk = np.ones((len(P), Lq), bool); qv = np.zeros((len(P), 9), np.float32)
for aid, g in df.groupby('athlete_id', sort=False):
    if len(g) < 2: continue
    g = g.reset_index(drop=True); dts = g.date.values; ms = g.m.values; sc = g.sec.values
    sf = g.surf.map({'xc': 0, 'track': 1, 'indoor': 2, 'road': 3}).values
    for i in range(1, len(g)):
        k = key.get((aid, dts[i], ms[i]))
        if k is None: continue
        age = (dts[i] - dts[:i]).astype('timedelta64[D]').astype(int); keep = np.where((age >= 1) & (age <= 730))[0][-Lq:]
        n = len(keep)
        if n == 0: continue
        seq[k, :n, 0] = np.log(ms[keep]) - 8.0; seq[k, :n, 1] = np.log(sc[keep] / ms[keep]) + 1.2
        for j, s in enumerate(sf[keep]): seq[k, j, 2 + s] = 1
        seq[k, :n, 6] = age[keep] / 365.0; seq[k, :n, 7] = 1.0; msk[k, :n] = False
        qv[k, 0] = np.log(ms[i]) - 8.0; qv[k, 1 + sf[i]] = 1; qv[k, 5] = g.male.values[i]
        e_ = g.elev_km.values[i]; qv[k, 6] = 0 if np.isnan(e_) else e_ / 50; qv[k, 7] = float(np.isnan(e_))
qv[:, 8] = (P.base.values - P.base.values[Tn].mean()).astype(np.float32)

# ---------- tabular matrix for the MLP ----------
Xn = P[FE].copy(); miss = Xn.isna().astype(np.float32); mu = Xn.iloc[Tn].mean(); sd = Xn.iloc[Tn].std() + 1e-9
Xn = ((Xn.fillna(mu) - mu) / sd).astype(np.float32); mcols = [c for c in miss.columns if miss[c].mean() > 0.001]
Zt = np.hstack([Xn.values, miss[mcols].values]).astype(np.float32)

def count_trees(m):
    t = [p[0] for p in m._predictors]; nodes = sum(len(x.nodes) for x in t); leaves = sum(int((x.nodes['is_leaf'] == 1).sum()) for x in t)
    return leaves + 2 * (nodes - leaves)

# ---------- family fit/predict functions: (train_idx, test_idx, cfg) -> (pred residual on test, n_params) ----------
def f_hgb(tr, te, c):
    m = HGB(loss='absolute_error', early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=0, **c).fit(P.iloc[tr][FE], R[tr])
    return m.predict(P.iloc[te][FE]), count_trees(m)
def f_cat(tr, te, c):
    m = CatBoostRegressor(loss_function='MAE', verbose=0, thread_count=os.cpu_count(), random_seed=0, **c).fit(P.iloc[tr][FE], R[tr])
    return m.predict(P.iloc[te][FE]), int(c['iterations'] * (2 ** c['depth'] * 1.0 + c['depth']))
def f_mlp(tr, te, c):
    layers, d = [], Zt.shape[1]
    for h in c['hidden']: layers += [nn.Linear(d, h), nn.ReLU()]; d = h
    net = nn.Sequential(*layers, nn.Linear(d, 1)); E = c['epochs']
    opt = torch.optim.AdamW(net.parameters(), lr=c['lr'], weight_decay=c['wd']); steps = E * int(np.ceil(len(tr) / 512))
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=c['lr'] * 1.5, total_steps=steps)
    Xt, Rt = torch.tensor(Zt[tr]), torch.tensor(R[tr])
    for _ in range(E):
        perm = torch.randperm(len(tr))
        for i in range(0, len(tr), 512):
            ix = perm[i:i + 512]; opt.zero_grad(); (net(Xt[ix]).squeeze(1) - Rt[ix]).abs().mean().backward(); opt.step(); sch.step()
    with torch.no_grad(): p = net(torch.tensor(Zt[te])).squeeze(1).numpy()
    return p, sum(q.numel() for q in net.parameters())
class Tiny(nn.Module):
    def __init__(s, d, layers):
        super().__init__(); s.tok = nn.Linear(8, d); s.qry = nn.Linear(9, d)
        s.enc = nn.TransformerEncoder(nn.TransformerEncoderLayer(d, 4, 2 * d, 0.0, batch_first=True), layers)
        s.out = nn.Sequential(nn.Linear(d, d), nn.ReLU(), nn.Linear(d, 1))
    def forward(s, sq, mk, qq):
        h = torch.cat([s.qry(qq).unsqueeze(1), s.tok(sq)], 1); m = torch.cat([torch.zeros(len(mk), 1, dtype=torch.bool), mk], 1)
        return s.out(s.enc(h, src_key_padding_mask=m)[:, 0]).squeeze(1)
def f_tf(tr, te, c):
    net = Tiny(c['d'], c['layers']); E = c['epochs']
    opt = torch.optim.AdamW(net.parameters(), lr=c['lr'], weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=c['lr'] * 1.5, total_steps=E * int(np.ceil(len(tr) / 512)))
    St, Mt, Qt, Rt = torch.tensor(seq[tr]), torch.tensor(msk[tr]), torch.tensor(qv[tr]), torch.tensor(R[tr])
    for _ in range(E):
        net.train(); perm = torch.randperm(len(tr))
        for i in range(0, len(tr), 512):
            ix = perm[i:i + 512]; opt.zero_grad(); (net(St[ix], Mt[ix], Qt[ix]) - Rt[ix]).abs().mean().backward(); opt.step(); sch.step()
    net.eval(); out = []
    with torch.no_grad():
        for i in range(0, len(te), 2048):
            ix = te[i:i + 2048]; out.append(net(torch.tensor(seq[ix]), torch.tensor(msk[ix]), torch.tensor(qv[ix])).numpy())
    return np.concatenate(out), sum(q.numel() for q in net.parameters())

SPACES = {
 'HGB': (f_hgb, lambda r: dict(max_iter=int(r.choice([300, 600, 1000])), learning_rate=float(r.choice([0.03, 0.06, 0.1])),
                               max_leaf_nodes=int(r.choice([15, 31, 63])), min_samples_leaf=int(r.choice([20, 60, 120])),
                               l2_regularization=float(r.choice([0, 1, 5])))),
 'CatBoost': (f_cat, lambda r: dict(iterations=int(r.choice([400, 800])), depth=int(r.choice([4, 6, 8])),
                                    learning_rate=float(r.choice([0.05, 0.1])), l2_leaf_reg=float(r.choice([1, 5, 10])))),
 'MLP': (f_mlp, lambda r: dict(hidden=[[32, 32], [64, 64], [128, 128], [128, 128, 128]][int(r.integers(4))], lr=float(r.choice([1e-3, 2e-3, 4e-3])),
                               wd=float(r.choice([1e-5, 1e-4, 1e-3])), epochs=int(r.choice([20, 30])))),
 'Transformer': (f_tf, lambda r: dict(d=int(r.choice([32, 64])), layers=int(r.choice([2, 3])), lr=float(r.choice([1e-3, 2e-3])), epochs=10)),
}
BUDGET = {'HGB': 6, 'CatBoost': 6, 'MLP': 5, 'Transformer': 3}

def tune(name):
    fn, sample = SPACES[name]; r = np.random.default_rng(hash(name) % 2 ** 32); best = (9e9, None); sub = Tn
    inner = list(GroupKFold(3).split(sub, groups=P.athlete_id.values[sub]))
    for t in range(BUDGET[name]):
        c = sample(r); t0 = time.time(); errs = []
        for a, b in inner:
            p, _ = fn(sub[a], sub[b], c); errs.append(mae(Y[sub[b]], P.base.values[sub[b]] + p))
        e = float(np.mean(errs)); log(f'  tune {name} #{t+1} {c} -> {e:.3f}% ({time.time()-t0:.0f}s)')
        if e < best[0]: best = (e, c)
    return best[1]

# ---------- baselines on the evaluation athletes ----------
B = all_baselines(P.iloc[En], P.iloc[Tn])
log('| model | learned numbers | MAE on evaluation athletes | 95% CI (athlete bootstrap) | paired diff vs best Riegel |\n|---|---|---|---|---|')
yE = Y[En]; aE = P.athlete_id.values[En]; ref = B['Riegel (nearest result)'].values
results = {}
for col in B.columns:
    p = B[col].values; ok = np.isfinite(p)
    if ok.mean() < 0.5: log(f'| {col} | 0-2 | covers only {ok.mean()*100:.0f}% of rows | | |'); continue
    pp = np.where(ok, p, ref)                                      # fall back to nearest-result Riegel where undefined
    ci = boot_ci(yE, pp, None, aE); d = boot_ci(yE, pp, ref, aE)
    log(f'| {col} | {1 if "Riegel" in col else 2} | {mae(yE, pp):.3f}% (defined on {ok.mean()*100:.0f}%) | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.2f} to {d[1]:+.2f} |')
    results[col] = pp
log('')
chosen = {}
oofs = {}
for name in ['HGB', 'CatBoost', 'MLP', 'Transformer']:
    log(f'tuning {name} ...'); c = tune(name); chosen[name] = c; fn = SPACES[name][0]
    oof = np.zeros(len(En)); npar = 0; t0 = time.time()
    for a, b in GroupKFold(5).split(En, groups=aE):
        p, npar = fn(En[a], En[b], c); oof[b] = p
    pr = P.base.values[En] + oof; oofs[name] = pr
    ci = boot_ci(yE, pr, None, aE); d = boot_ci(yE, pr, ref, aE)
    log(f'| {name} (tuned) | {npar:,} | {mae(yE, pr):.3f}% | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.2f} to {d[1]:+.2f} |  ({time.time()-t0:.0f}s) cfg {c}')
if 'HGB' in oofs:
    for n2 in ['CatBoost', 'MLP', 'Transformer']:
        d = boot_ci(yE, oofs[n2], oofs['HGB'], aE); log(f'paired {n2} minus HGB: {d[0]:+.3f} to {d[1]:+.3f} MAE points')
pickle.dump(dict(chosen=chosen, oofs=oofs, base=results), open(f'{S}/exp7.pkl', 'wb'))
