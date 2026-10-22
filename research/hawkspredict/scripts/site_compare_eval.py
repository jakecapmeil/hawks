"""HawksPredict-Lite and -Research vs the website's current PR-based estimate, on identical PR-only inputs."""
from common import *
import json, pickle
from lite import lite_feats
from build3 import extra_feats
from baselines import cameron_pred
S = sys.argv[1]; set_log(S); M.WINDOW = 730
sel = pd.read_pickle(f'{S}/site_sel.pkl'); keep = dict(pickle.load(open(f'{S}/site_keep.pkl', 'rb')))
est = {e['i']: e for e in json.load(open(f'{S}/site_est.json'))}
K = 1.06
TGT = {400: ('400', 1.0), 800: ('800', 1.0), 1500: ('1600', (1500 / 1600) ** K), 1600: ('1600', 1.0), 1609.34: ('1600', (1609.34 / 1600) ** K), 3000: ('3200', (3000 / 3200) ** K),
       3200: ('3200', 1.0), 3218.69: ('3200', (3218.69 / 3200) ** K), 5000: ('5K', 1.0), 10000: ('10K', 1.0), 21097.5: ('half', 1.0)}
rows = []; lite_rows = []; res_rows = []; no_est = 0
for i, used in keep.items():
    r = sel.loc[i]; e = est[i]['est']; key, sc = TGT[r.target_m]
    if key not in e: no_est += 1; continue          # the website shows no estimate (e.g. only 400/800 PRs)
    site = e[key] * sc
    if key == '10K': site /= 1 + 0.0375           # remove the low-mileage penalty (no mileage in NRCD)
    if key == 'half': site /= 1.09
    if r.surf_s == 'xc': site *= 1.025            # the site's own cross-country credit
    ms = [u[0] for u in used]; sc_ = [u[1] for u in used]; sf = [u[2] for u in used]
    lf = lite_feats(ms, sc_, sf, r.target_m, r.surf_s, r.male); lf['target_m'] = r.target_m; lite_rows.append(lf)
    h = pd.DataFrame([(u[3], u[2], u[0], u[1]) for u in used], columns=['date', 'surf', 'm', 'sec'])
    f = M.feats_for(h, r.target_m, r.surf_s, r.male, r.alt, r.temp, r.date); f.update(extra_feats(h, r.target_m, r.surf_s, r.date, h.date.min()))
    f['elev_km'] = r.elev_km
    for c in COURSE: f[c] = r[c]
    res_rows.append(f)
    rows.append(dict(i=i, y=r.y, site=np.log(site), athlete=r.athlete_id, split=r.split, surf=r.surf_s, tm=r.target_m, nb=len(used), n_all=r.n_buckets))
T = pd.DataFrame(rows); L = pd.DataFrame(lite_rows); Rr = pd.DataFrame(res_rows)
art = json.load(open(f'{S}/pace_lite.json')); M_ = L[art['feats']].values.astype(float); res = np.full(len(L), art['init'])
for t in art['trees']:
    f_ = np.array(t['f']); th = np.array(t['t']); l_ = np.array(t['l']); r_ = np.array(t['r']); v_ = np.array(t['v']); mg = np.array(t['mgl']); node = np.zeros(len(L), int)
    for _ in range(40):
        feat = f_[node]; leaf = feat < 0
        if leaf.all(): break
        x = M_[np.arange(len(L)), np.where(leaf, 0, feat)]; left = np.where(np.isnan(x), mg[node] == 1, x <= th[node])
        node = np.where(leaf, node, np.where(left, l_[node], r_[node]))
    res += v_[node]
T['lite'] = L.base.values + res; T['riegel'] = L.base_near.values; T['cameron'] = cameron_pred(L)
RM = pickle.load(open(f'{S}/hawks_predict_research.pkl', 'rb')); FE = RM['feats']
T['research'] = Rr.base.values + RM['hgb'].predict(Rr[FE])
full = sel.loc[T.i.values]; T['research_full'] = full.base.values + RM['hgb'].predict(full[FE])
T['cameron'] = np.where(np.isfinite(T.cameron), T.cameron, T.riegel)
log("\n## HawksPredict vs the website's current PR-based estimate (same PR-only inputs)\n")
log(f'Tasks where the website gives no estimate at all (only 400/800 PRs): {no_est}, dropped for everyone.')
log("Inputs: each runner's fastest result per website PR event (400, 800, mile/1600, 3000/3200, 5K) in the 730 days before the race.")
log("Website = src/fitness.js `computeFitness` run unchanged (VDOT, recency weights, speed index, critical-speed blend). Its low-mileage penalty on 10K/half is removed (no mileage in NRCD) and its XC credit (x1.025) applied to cross-country targets. Targets between website events are scaled by Riegel 1.06.\n")
for split, nm in [('final_test', 'FROZEN TEST subset (never in training)'), ('pool_sample', 'dev sample (pool; slightly optimistic for the models, which were cross-validated on it)')]:
    D = T[T.split == split].reset_index(drop=True)
    log(f'\n### {nm}: {len(D)} races, {D.athlete.nunique()} runners\n| model | error | 95% CI | paired diff vs website |\n|---|---|---|---|')
    for col, lab in [('site', 'Website today (Fitness States, PR-only)'), ('riegel', 'Riegel from nearest PR'), ('cameron', 'Cameron'), ('lite', '**HawksPredict-Lite** (same PR inputs)'),
                     ('research', '**HawksPredict-Research** (same PR inputs)'), ('research_full', 'HawksPredict-Research (all results, for reference)')]:
        ci = boot_ci(D.y.values, D[col].values, None, D.athlete.values); d = boot_ci(D.y.values, D[col].values, D.site.values, D.athlete.values) if col != 'site' else (0, 0)
        log(f'| {lab} | {mae(D.y.values, D[col].values):.3f}% | {ci[0]:.2f}-{ci[1]:.2f} | {d[0]:+.2f} to {d[1]:+.2f} |')
D = T[T.split == 'final_test']
def table(title, D, specs):
    log(f'\n{title}\n| slice | races | website | Lite | Research |\n|---|---|---|---|---|')
    for nm, m in specs:
        d = D[m]
        if len(d) >= 40: log(f"| {nm} | {len(d)} | {mae(d.y.values, d.site.values):.2f}% | {mae(d.y.values, d.lite.values):.2f}% | {mae(d.y.values, d.research.values):.2f}% |")
table('Frozen-test slices', D, [('track / indoor targets', D.surf.isin(['track', 'indoor'])), ('cross-country targets', D.surf == 'xc'), ('target <= 1700 m', D.tm <= 1700),
      ('3000-3300 m', (D.tm >= 3000) & (D.tm <= 3300)), ('5000 m', D.tm == 5000), ('10000 m', D.tm == 10000), ('1 PR as input', D.nb == 1), ('2 PRs', D.nb == 2), ('3+ PRs', D.nb >= 3)])
D2 = T[T.split == 'pool_sample']
table('Dev-sample slices (more races)', D2, [('track / indoor targets', D2.surf.isin(['track', 'indoor'])), ('cross-country targets', D2.surf == 'xc'), ('target <= 1700 m', D2.tm <= 1700),
      ('5000 m', D2.tm == 5000), ('10000 m', D2.tm == 10000), ('half marathon', D2.tm == 21097.5), ('1 PR as input', D2.nb == 1), ('3+ PRs', D2.nb >= 3)])
log(f'\nbias (mean signed error) on frozen test: website {100*np.mean(np.expm1(D.site-D.y)):+.2f}%, Lite {100*np.mean(np.expm1(D.lite-D.y)):+.2f}%, Research {100*np.mean(np.expm1(D.research-D.y)):+.2f}%')
T.to_pickle(f'{S}/site_compare_out.pkl')
