
## exp6: noise floor and course difficulty (pool, 5-fold by athlete)
| setting | MAE | time |
|---|---|---|
| v3 features | 3.655% | 50s |
| v3 + course-difficulty features (prior meets, same series) | 3.642% | 49s |
| rows with >=20 prior same-series results (47% of rows): v3 / +course | 3.823% / 3.779% | |

| residual variance explained by... | share | groups | rows |
|---|---|---|---|
| meet-day x event (all) | 8.3% | 1282 | 61040 |
| meet-day x event, cross country only | 10.1% | 682 | 41012 |
| meet-day x event, track/indoor only | 3.0% | 582 | 18850 |
| the athlete (persistent bias) | 7.0% | 7288 | 58375 |

residual sd (log time): 0.056

## exp7: fair comparison (tuning athletes 19784 rows, evaluation athletes 46745 rows)

| model | learned numbers | MAE on evaluation athletes | 95% CI (athlete bootstrap) | paired diff vs best Riegel |
|---|---|---|---|---|
| Riegel (nearest result) | 1 | 5.564% (defined on 100%) | 5.49-5.64 | +0.00 to +0.00 |
| Riegel (weighted mix) | 1 | 5.578% (defined on 100%) | 5.51-5.65 | -0.00 to +0.03 |
| Personal-exponent Riegel | 1 | 5.507% (defined on 100%) | 5.44-5.58 | -0.08 to -0.04 |
| VDOT (Daniels) | 2 | 6.799% (defined on 100%) | 6.68-6.93 | +1.14 to +1.32 |
| Cameron | 2 | 4.892% (defined on 100%) | 4.82-4.96 | -0.70 to -0.65 |
| Critical speed (2-param) | 0-2 | covers only 47% of rows | | |
| Low-rank completion (rank 2) | 2 | 9.318% (defined on 100%) | 9.20-9.48 | +3.63 to +3.91 |

tuning HGB ...
  tune HGB #1 {'max_iter': 600, 'learning_rate': 0.1, 'max_leaf_nodes': 15, 'min_samples_leaf': 60, 'l2_regularization': 0.0} -> 3.915% (16s)
  tune HGB #2 {'max_iter': 1000, 'learning_rate': 0.1, 'max_leaf_nodes': 31, 'min_samples_leaf': 60, 'l2_regularization': 5.0} -> 3.888% (26s)
  tune HGB #3 {'max_iter': 1000, 'learning_rate': 0.1, 'max_leaf_nodes': 15, 'min_samples_leaf': 60, 'l2_regularization': 0.0} -> 3.911% (28s)
  tune HGB #4 {'max_iter': 300, 'learning_rate': 0.06, 'max_leaf_nodes': 15, 'min_samples_leaf': 120, 'l2_regularization': 0.0} -> 4.003% (12s)

## exp8a: per-athlete fine-tuning, tested on later races of the same NRCD athlete (pool, out-of-fold)

within-athlete sd 0.0570, between-athlete bias sd 0.0197 (log time)
rows with at least one earlier race by the same athlete: 52907 (80%)
| earlier races of that athlete | rows | no correction | shrunk bias (ours) | full bias (no shrinkage) | shrunk vs none, 95% CI |
|---|---|---|---|---|---|
| 1 | 9544 | 3.846% | 3.850% | 5.548% | -0.008 to +0.016 |
| 2 | 7366 | 3.717% | 3.732% | 4.687% | -0.005 to +0.033 |
| 3-4 | 10561 | 3.624% | 3.639% | 4.197% | -0.004 to +0.033 |
| 5+ | 25436 | 3.264% | 3.270% | 3.467% | -0.008 to +0.020 |
| all | 52907 | 3.504% | 3.512% | 4.158% | +0.001 to +0.017 |

## exp8b: learning curve (train on a fraction of training athletes, fixed evaluation athletes)
| fraction of training athletes | training rows | MAE | 95% CI |
|---|---|---|---|
  tune HGB #5 {'max_iter': 1000, 'learning_rate': 0.06, 'max_leaf_nodes': 63, 'min_samples_leaf': 120, 'l2_regularization': 5.0} -> 3.896% (157s)
| 10% | 4,723 | 4.141% | 4.04-4.24 |
| 25% | 11,419 | 3.976% | 3.88-4.07 |
| 50% | 23,476 | 3.802% | 3.70-3.89 |
| 100% | 46,728 | 3.707% | 3.61-3.80 |

log-log slope of error vs training rows: -0.050  -> doubling the data changes error by -3.4%
last step (50% -> 100%): 3.802% -> 3.707%
  tune HGB #6 {'max_iter': 300, 'learning_rate': 0.1, 'max_leaf_nodes': 63, 'min_samples_leaf': 60, 'l2_regularization': 1.0} -> 3.893% (72s)

## Lite model (website): 66529 pool rows, 2594 final-test rows, 21 date-free features

teacher (dated features, 400 x 31 leaves) out-of-fold MAE 3.642%  (111s)
| size (trees x leaves) | learned numbers | MAE dev (labels) | MAE dev (distilled) |
|---|---|---|---|
| 20 x 4 | 200 | 4.513% | 4.550% |
| 40 x 7 | 760 | 4.332% | 4.351% |
| 80 x 7 | 1,520 | 4.256% | 4.271% |
| 80 x 15 | 3,440 | 4.184% | 4.186% |
| HGB (tuned) | 79,443 | 3.623% | 3.58-3.68 | -1.98 to -1.90 |  (207s) cfg {'max_iter': 1000, 'learning_rate': 0.1, 'max_leaf_nodes': 31, 'min_samples_leaf': 60, 'l2_regularization': 5.0}
tuning CatBoost ...
  tune CatBoost #1 {'iterations': 400, 'depth': 8, 'learning_rate': 0.1, 'l2_leaf_reg': 5.0} -> 3.926% (14s)
  tune CatBoost #2 {'iterations': 800, 'depth': 4, 'learning_rate': 0.05, 'l2_leaf_reg': 5.0} -> 3.962% (7s)
  tune CatBoost #3 {'iterations': 400, 'depth': 6, 'learning_rate': 0.05, 'l2_leaf_reg': 1.0} -> 3.980% (6s)
  tune CatBoost #4 {'iterations': 400, 'depth': 6, 'learning_rate': 0.1, 'l2_leaf_reg': 10.0} -> 3.918% (6s)
| 150 x 15 | 6,450 | 4.170% | 4.163% |
  tune CatBoost #5 {'iterations': 400, 'depth': 8, 'learning_rate': 0.05, 'l2_leaf_reg': 1.0} -> 3.948% (14s)
  tune CatBoost #6 {'iterations': 800, 'depth': 4, 'learning_rate': 0.1, 'l2_leaf_reg': 5.0} -> 3.908% (7s)
| CatBoost (tuned) | 16,000 | 3.701% | 3.66-3.75 | -1.91 to -1.82 |  (25s) cfg {'iterations': 800, 'depth': 4, 'learning_rate': 0.1, 'l2_leaf_reg': 5.0}
tuning MLP ...
  tune MLP #1 {'hidden': [32, 32], 'lr': 0.001, 'wd': 0.0001, 'epochs': 20} -> 4.359% (3s)
  tune MLP #2 {'hidden': [128, 128], 'lr': 0.002, 'wd': 0.001, 'epochs': 30} -> 4.359% (5s)
  tune MLP #3 {'hidden': [128, 128, 128], 'lr': 0.001, 'wd': 1e-05, 'epochs': 30} -> 4.652% (8s)
  tune MLP #4 {'hidden': [32, 32], 'lr': 0.002, 'wd': 0.001, 'epochs': 30} -> 4.403% (2s)
  tune MLP #5 {'hidden': [64, 64], 'lr': 0.001, 'wd': 0.001, 'epochs': 20} -> 4.293% (2s)
| 250 x 15 | 10,750 | 4.157% | 4.152% |
| MLP (tuned) | 8,129 | 3.969% | 3.92-4.02 | -1.64 to -1.55 |  (11s) cfg {'hidden': [64, 64], 'lr': 0.001, 'wd': 0.001, 'epochs': 20}
tuning Transformer ...
  tune Transformer #1 {'d': 32, 'layers': 3, 'lr': 0.002, 'epochs': 10} -> 4.256% (115s)
  tune Transformer #2 {'d': 64, 'layers': 2, 'lr': 0.002, 'epochs': 10} -> 4.229% (132s)
| 400 x 31 | 18,837 | 4.146% | 4.127% |

knee (smallest model within 0.05 points of the best, 4.127%): {'max_iter': 150, 'max_leaf_nodes': 15, 'learning_rate': 0.1}, 6,450 numbers, distilled=True

FINAL TEST (athlete-disjoint, last season; touched once): Lite 4.375% [4.10, 4.68] vs nearest-result Riegel 5.763%  (paired diff -1.55 to -1.23)
80% interval coverage on final test: 78.1% (target 80%), mean half-width 6.1% of time
high-school pairs (dev set, n=51): Lite 2.03% vs Riegel 3.01%
sensitivity, same final-test races with up-to-1500-day histories: Lite 4.404% vs Riegel 5.810%  (n=2594)
exported pace_lite.json: 177 KB, 150 trees
python tree-walk vs sklearn predict, max abs diff over 60 rows: 0.00e+00
parity cases written: 200
  tune Transformer #3 {'d': 32, 'layers': 3, 'lr': 0.001, 'epochs': 10} -> 4.354% (86s)

## exp9: feature-group ablation (dev pool, 5-fold by athlete, fast tuned trees)
| removed group | MAE | change vs full | 95% CI of change |
|---|---|---|---|
| (none, full model) | 3.642% | | |
| weather inputs (alt, temp) | 3.701% | +0.059 | +0.053 to +0.066 |
| Transformer (tuned) | 72,385 | 4.066% | 4.02-4.12 | -1.54 to -1.45 |  (520s) cfg {'d': 64, 'layers': 2, 'lr': 0.002, 'epochs': 10}
paired CatBoost minus HGB: +0.067 to +0.090 MAE points
paired MLP minus HGB: +0.329 to +0.365 MAE points
paired Transformer minus HGB: +0.421 to +0.466 MAE points
| course elevation | 3.638% | -0.004 | -0.009 to +0.000 |

## HawksPredict-Research v1: final model

dev evaluation athletes: HGB 3.623%, CatBoost 3.701%, Blend HGB+CatBoost 3.627% -> finalist: **HGB**
interval calibration: raw coverage on calibration athletes 76.1%, conformal adjustment +0.46% of log-time

### FINAL TEST: athlete-disjoint, last season (2594 races, 674 runners; touched once)

| model | MAE | 95% CI | paired diff vs nearest-result Riegel |
|---|---|---|---|
| **HawksPredict-Research (HGB)** | **3.626%** | 3.40-3.88 | -2.35 to -1.94 |
| Riegel (nearest result) | 5.763% | 5.42-6.18 | +0.00 to +0.00 |
| Riegel (weighted mix) | 5.772% | 5.46-6.15 | -0.08 to +0.08 |
| Personal-exponent Riegel | 5.720% | 5.36-6.18 | -0.11 to +0.04 |
| VDOT (Daniels) | 7.703% | 7.28-8.16 | +1.53 to +2.32 |
| Cameron | 5.299% | 4.99-5.70 | -0.56 to -0.37 |
| Critical speed (2-param) | 6.936% | 6.48-7.45 | +0.88 to +1.46 |
| Low-rank completion (rank 3, tuned) | 5.464% | 5.16-5.75 | -0.49 to -0.09 |

Research model vs Cameron (best published formula here), paired: -1.88 to -1.50 MAE points
bias (mean signed error): -0.34%;  median abs error 2.42%
80% interval coverage: 79.3%, mean half-width 5.6% of time

| slice | races | research MAE | Riegel MAE | 80% coverage |
|---|---|---|---|---|
| cross country | 1361 | 3.89% | 6.32% | 82% |
| outdoor track | 710 | 3.38% | 5.01% | 77% |
| indoor track | 491 | 3.11% | 5.23% | 76% |
| target <= 1700 m | 849 | 3.24% | 5.23% | 76% |
| 1700-4100 m | 156 | 3.16% | 4.31% | 78% |
| 4100-7000 m | 743 | 3.96% | 5.97% | 80% |
| > 7000 m | 846 | 3.81% | 6.38% | 82% |
| 1 distance in history | 680 | 4.00% | 6.93% | 79% |
| 2 distances | 561 | 4.09% | 6.14% | 77% |
| 3+ distances | 1353 | 3.25% | 5.02% | 80% |
| women | 1691 | 3.38% | 5.25% | 78% |
| men | 903 | 4.08% | 6.73% | 82% |

high-school 1600->3200 pairs (dev set, n=51): research 1.85%, Riegel 3.01%, 80% coverage 96%
saved hawks_predict_research.pkl
| course-difficulty (prior meets) | 3.655% | +0.013 | +0.007 to +0.019 |
| personal exponent (k_ind, base_slope, span, n_buckets) | 3.649% | +0.007 | +0.000 to +0.013 |
| recency + trend + volatility | 3.734% | +0.092 | +0.081 to +0.103 |
| same-surface baseline | 3.636% | -0.006 | -0.013 to +0.000 |
| season + experience (doy, career_days) | 3.662% | +0.020 | +0.015 to +0.028 |
| per-distance projections (p400..p21097) | 3.775% | +0.133 | +0.121 to +0.145 |
| counts (n_prior, n_results, days_last) | 3.642% | -0.000 | -0.005 to +0.006 |

## Power of 10 zero-shot test (lifetime bests; no ids/dates/ages): 266553 athletes with >= 2 of the 10 events

60000 leave-one-event-out tasks
| model | error (leave-one-event-out) | 95% CI (bootstrap by athlete row) |
|---|---|---|
| **HawksPredict-Lite** | **5.55%** | 5.48-5.62 |
| Riegel (nearest result) | 6.41% | 6.32-6.49 |
| Riegel (weighted mix) | 6.37% | 6.28-6.45 |
| Personal-exponent Riegel | 6.79% | 6.69-6.88 |
| VDOT (Daniels) | 7.26% | 7.16-7.36 |
| Cameron | 5.55% | 5.47-5.62 |
| Critical speed (2-param) | 8.52% | 8.38-8.64 |
| Low-rank completion (rank 3, tuned) | 6.01% | 5.93-6.09 |

Lite vs Cameron, paired: -0.04 to +0.04 points

| slice | tasks | Lite | Riegel | Cameron |
|---|---|---|---|---|
| hidden event 400 | 1037 | 8.08% | 15.41% | 8.27% |
| hidden event 800 | 2347 | 6.41% | 10.25% | 6.23% |
| hidden event 1000 | 192 | 5.93% | 8.19% | 6.18% |
| hidden event 1500 | 2155 | 4.46% | 7.19% | 5.11% |
| hidden event Mile | 851 | 5.04% | 5.22% | 4.96% |
| hidden event 3000 | 1194 | 4.10% | 5.14% | 4.66% |
| hidden event 5000 | 6966 | 5.66% | 6.04% | 5.64% |
| hidden event 10000 | 6657 | 5.34% | 5.36% | 5.30% |
| hidden event 5M | 2421 | 4.67% | 4.67% | 4.66% |
| hidden event HM | 6231 | 5.99% | 5.75% | 5.76% |
| 1 other event(s) known | 7464 | 7.31% | 8.79% | 7.16% |
| 2 other event(s) known | 9155 | 5.34% | 6.25% | 5.51% |
| 3+ other events known | 13432 | 4.72% | 5.19% | 4.69% |
| slower runners (< 4.5 m/s average) | 21016 | 5.88% | 6.07% | 5.81% |
| club runners (4.5-5.5 m/s) | 6080 | 4.37% | 5.78% | 4.53% |
| fast (5.5-7 m/s) | 2516 | 5.09% | 9.04% | 5.45% |
| elite-level (> 7 m/s) | 439 | 8.86% | 16.16% | 7.88% |

## HawksPredict vs the website's current PR-based estimate (same PR-only inputs)

Tasks where the website gives no estimate at all (only 400/800 PRs): 1096, dropped for everyone.
Inputs: each runner's fastest result per website PR event (400, 800, mile/1600, 3000/3200, 5K) in the 730 days before the race.
Website = src/fitness.js `computeFitness` run unchanged (VDOT, recency weights, speed index, critical-speed blend). Its low-mileage penalty on 10K/half is removed (no mileage in NRCD) and its XC credit (x1.025) applied to cross-country targets. Targets between website events are scaled by Riegel 1.06.


### FROZEN TEST subset (never in training): 1041 races, 321 runners
| model | error | 95% CI | paired diff vs website |
|---|---|---|---|
| Website today (Fitness States, PR-only) | 4.849% | 4.25-5.63 | +0.00 to +0.00 |
| Riegel from nearest PR | 4.780% | 4.23-5.49 | -0.42 to +0.31 |
| Cameron | 4.317% | 3.77-4.98 | -0.89 to -0.17 |
| **HawksPredict-Lite** (same PR inputs) | 4.149% | 3.65-4.75 | -1.07 to -0.31 |
| **HawksPredict-Research** (same PR inputs) | 4.036% | 3.57-4.64 | -1.23 to -0.43 |
| HawksPredict-Research (all results, for reference) | 3.493% | 3.11-3.89 | -1.86 to -0.93 |

### dev sample (pool; slightly optimistic for the models, which were cross-validated on it): 6063 races, 2909 runners
| model | error | 95% CI | paired diff vs website |
|---|---|---|---|
| Website today (Fitness States, PR-only) | 5.082% | 4.86-5.29 | +0.00 to +0.00 |
| Riegel from nearest PR | 4.759% | 4.59-4.92 | -0.52 to -0.16 |
| Cameron | 3.880% | 3.75-4.00 | -1.38 to -1.04 |
| **HawksPredict-Lite** (same PR inputs) | 3.619% | 3.50-3.73 | -1.64 to -1.28 |
| **HawksPredict-Research** (same PR inputs) | 3.420% | 3.30-3.51 | -1.86 to -1.48 |
| HawksPredict-Research (all results, for reference) | 2.523% | 2.43-2.61 | -2.74 to -2.36 |

Frozen-test slices
| slice | races | website | Lite | Research |
|---|---|---|---|---|
| track / indoor targets | 942 | 4.55% | 3.85% | 3.75% |
| cross-country targets | 75 | 7.72% | 7.19% | 6.67% |
| target <= 1700 m | 623 | 4.86% | 3.77% | 3.72% |
| 3000-3300 m | 134 | 4.40% | 3.61% | 3.54% |
| 5000 m | 267 | 5.00% | 5.20% | 4.94% |
| 1 PR as input | 253 | 5.45% | 4.91% | 4.82% |
| 2 PRs | 332 | 4.65% | 4.10% | 4.01% |
| 3+ PRs | 456 | 4.66% | 3.76% | 3.63% |

Dev-sample slices (more races)
| slice | races | website | Lite | Research |
|---|---|---|---|---|
| track / indoor targets | 5144 | 4.98% | 3.37% | 3.19% |
| cross-country targets | 662 | 5.32% | 4.72% | 4.37% |
| target <= 1700 m | 3628 | 5.40% | 3.41% | 3.22% |
| 5000 m | 1560 | 4.29% | 3.94% | 3.66% |
| half marathon | 210 | 6.28% | 5.55% | 5.52% |
| 1 PR as input | 2104 | 5.98% | 4.33% | 4.09% |
| 3+ PRs | 1933 | 4.71% | 3.13% | 2.87% |

bias (mean signed error) on frozen test: website +2.03%, Lite -1.31%, Research -1.10%

## exp10: learning from the other models' correct answers (dev pool, 5-fold by athlete)
(parameter-free models computed in 2s)

  fold 1/5 done (93s)
  fold 2/5 done (186s)
  fold 3/5 done (295s)
  fold 4/5 done (387s)
  fold 5/5 done (475s)
| variant | MAE | change vs current | 95% CI of change |
|---|---|---|---|
| A current HawksPredict-Research features | 3.642% | +0.000 | +0.000 to +0.000 |
| B + other models' predictions as inputs (stacking) | 3.607% | -0.035 | -0.044 to -0.027 |
| C retrain with extra weight on rows where another model beat us | 4.408% | +0.766 | +0.739 to +0.797 |
| E both | 4.428% | +0.786 | +0.759 to +0.820 |

rows where some other model beats ours: 51% (as expected from noise: with 5 models picked per row, an oracle would be right that often); an oracle that always picks the best model per row would score 2.58% (not achievable: it needs the answer)

## HawksPredict-Research v1.1 (stacked with other models) on the frozen test (touched once)
| model | MAE | 95% CI | paired change vs v1 |
|---|---|---|---|
| v1 | 3.626% | 3.40-3.88 | +0.000 to +0.000 |
| v1.1 (+ Cameron, VDOT, critical speed, low-rank as inputs) | 3.562% | 3.35-3.80 | -0.128 to -0.007 |

## Power of 10 raw file: junior proxy test (no ages exist; juniors = has an age-group-event entry)

### junior-flagged athletes: 18992 leave-one-event-out tasks from 7002 athletes
| model | error | 95% CI |
|---|---|---|
| HawksPredict-Lite | 6.58% | 6.46-6.71 |
| Cameron | 6.93% | 6.80-7.07 |
| Riegel (nearest) | 12.00% | 11.80-12.20 |
| Low-rank completion | 6.33% | 6.23-6.45 |
Lite vs Cameron paired: -0.39 to -0.31
  hidden 800: n=6471  Lite 6.26%  Cameron 6.75%  Riegel 11.40%
  hidden 1500: n=5428  Lite 5.32%  Cameron 5.96%  Riegel 9.85%
  hidden Mile: n=703  Lite 5.38%  Cameron 5.51%  Riegel 6.28%
  hidden 3000: n=1323  Lite 5.63%  Cameron 5.30%  Riegel 7.43%

### all other athletes, same events (control): 19968 leave-one-event-out tasks from 15157 athletes
| model | error | 95% CI |
|---|---|---|
| HawksPredict-Lite | 4.75% | 4.68-4.83 |
| Cameron | 4.97% | 4.89-5.05 |
| Riegel (nearest) | 7.31% | 7.20-7.42 |
| Low-rank completion | 5.04% | 4.97-5.11 |
Lite vs Cameron paired: -0.25 to -0.18
  hidden 800: n=5614  Lite 5.00%  Cameron 5.16%  Riegel 8.45%
  hidden 1500: n=5532  Lite 4.14%  Cameron 4.69%  Riegel 6.65%
  hidden Mile: n=1345  Lite 4.30%  Cameron 4.20%  Riegel 4.71%
  hidden 3000: n=3087  Lite 4.14%  Cameron 4.01%  Riegel 5.22%

## exp11: Power of 10 as a prior (264271 athletes, rank 3, ridge 0.5)

rows with a Power of 10 prediction: 87%; Power of 10 prior alone, MAE 4.90% (Riegel-type base on same rows 5.52%)
| split seed | current features | + Power of 10 prior | change | 95% CI of change |
|---|---|---|---|---|
| 1 | 3.640% | 3.630% | -0.009 | -0.018 to -0.001 |

## exp11: Power of 10 as a prior (264271 athletes, rank 3, ridge 0.5)

rows with a Power of 10 prediction: 87%; Power of 10 prior alone, MAE 4.90% (Riegel-type base on same rows 5.52%)
| split seed | current features | + Power of 10 prior | change | 95% CI of change |
|---|---|---|---|---|
| 2 | 3.644% | 3.634% | -0.010 | -0.018 to -0.002 |

## exp12: BMClab training logs -> marathon day (2019) (added 2026-10-22)
Real training logs paired with real marathon days. Source: Figshare 16620238 (CC BY 4.0), daily 2019 file (sha256 0445cd42…c740). Marathon day = the
40-44.5 km activity on the race date of the athlete's listed 2019 major; target is the device time scaled to 42.195 km; features are the 16 weeks before.
15,874 athletes list a 2019 major; 14,137 marathon days (13,620 athletes) have 15+ runs in the prior 16 weeks. Script: `scripts/exp12_bmclab_training.py`.
| predictor | n | error (MAE %) | 95% CI |
|---|---|---|---|
| median time | 14,137 | 15.47 | 15.27 to 15.67 |
| Riegel from best 8-25 km training run | 14,116 | 8.25 | 8.15 to 8.36 |
| training volume and pace only (10 features) | 14,137 | 6.65 | 6.55 to 6.75 |
| training + best-effort Riegel | 14,137 | 6.34 | 6.24 to 6.44 |
Training features added to best-effort + sex + age: -1.01 points (95% CI -1.08 to -0.94). Caveats: marathon only (the Hawks race 800 m-5K), device times,
"races" found by rule, amateurs; no personal bests in this set, so it does not say how much training adds on top of Lite.

## Hawks runs -> simulator constants, and the heart-rate power analysis (2026-10-22)
Pooled from 551 clean runs of the 4 athletes with synced training (no per-athlete values kept): log pace falls 0.084-0.095 per +0.10 of max HR; heat adds 0.020 per 10 F of
(temperature + dew point - 120); climb adds 0.094 per 100 ft/mi; single-run SD of heart-rate fitness 12.6%; monthly median SD 6.7% (upper bound on noise).
`scripts/synth_hr_power.py` simulates runs with those constants and a swept coupling c (share of a true fitness change that shows in the heart-rate trend; unknowable from our data).
| coupling c | corr(HR trend, true change) | effect of the shipped correction (+ = worse) |
|---|---|---|
| 0.00 | 0.00 | +0.26 points |
| 0.25 | +0.12 | +0.20 |
| 0.50 | +0.27 | +0.12 |
| 1.00 | +0.46 | -0.02 |
Even with perfect coupling the 8-week heart-rate trend has noise comparable to the signal, so a half-strength correction does not help in this simulator; a quarter-strength one gains at most 0.1 point and costs 0.14 if there is no link.
The best strength depends entirely on c, so fine-tuning on synthetic rows would only encode the assumption. This is a power analysis, not evidence.

### exp12 follow-up: train on five majors, test on the sixth (2026-10-22)
| held-out | n | best-effort + sex/age | + training | change (95% CI) |
|---|---|---|---|---|
| Berlin | 4,060 | 7.36 | 6.41 | -0.95 (-1.08 to -0.82) |
| Boston | 4,104 | 7.38 | 6.65 | -0.73 (-0.86 to -0.59) |
| Chicago | 792 | 8.65 | 7.39 | -1.26 (-1.67 to -0.93) |
| London | 2,151 | 6.80 | 5.90 | -0.90 (-1.06 to -0.75) |
| New York | 2,378 | 7.87 | 6.76 | -1.11 (-1.30 to -0.94) |
| Tokyo | 652 | 8.21 | 7.11 | -1.10 (-1.43 to -0.80) |
The training-log gain holds on every race the model never saw (0.7 to 1.3 points), so it is not an artefact of one course or one day's weather.

## FitRec: does the heart-rate trend predict a later hard effort? (2026-10-22)
Source: Kaggle `tientd95/fitrec-dataset` (mirror of UCSD FitRec / Endomondo; academic use only, licence listed unknown; `endomondoHR.json.zip` sha256 0e4b4aca…cdd3). 253,020 workouts -> 20,581 usable runs from 607 users
(10,527 with heart-rate fitness). `scripts/fitrec_summarize.py`, `scripts/fitrec_hr_check.py`. Targets: hard 5K/10K runs (pace 10%+ faster than recent median, 85%+ of max HR) with an earlier best-effort baseline and
heart-rate fitness measured in both 8-week windows: 88 targets from 30 runners (before: 43 from 4). Offset learned on one half of the runners, scored on the other.
| shrink | MAE offset only | MAE with HR trend | change | 95% CI |
|---|---|---|---|---|
| 0.25 | 5.55% | 5.76% | +0.21 | -0.12 to +0.57 |
| 0.50 | 5.55% | 6.12% | +0.57 | -0.05 to +1.26 |
| 1.00 | 5.55% | 7.33% | +1.78 | +0.53 to +2.99 |
Slope of log(actual/baseline) on the heart-rate fitness change: -0.21 (95% CI -0.49 to +0.08), correlation -0.16. The sign is right (fitter by heart rate -> later effort faster) but the link is weak, so any correction
makes errors larger. This matches the simulation (quarter strength is the break-even edge). The heart-rate layer is not supported; keep raw HawksPredict-Lite as the headline.

## exp13: HawksPredict-Short, events Lite was not trained on (2026-10-23)
athletes 25523 (World Athletics 15202, NRCD 10321); athletes with marks per event:
| event | athletes |
|---|---|
| 100 | 4543 |
| 200 | 4356 |
| 300 | 609 |
| 400 | 4187 |
| 600 | 133 |
| 800 | 5919 |
| 1000 | 755 |
| 1500 | 5737 |
| 1609 | 5586 |
| 3000 | 3473 |
| 5000 | 4723 |
| S2000 | 501 |
| S3000 | 2577 |

### In-between formula vs real marks (log-log interpolation of the neighbours; Riegel k=1.06 from one neighbour)
| target | neighbours | n | interpolation | Riegel from lower | Riegel from upper | mean bias of interpolation |
|---|---|---|---|---|---|---|
| 600 | 400, 800 | 11 | 1.83% | 7.10% | 2.10% | -1.83% |
| 1000 | 800, 1500 | 352 | 1.82% | 3.46% | 2.13% | -1.63% |
| 300 | 200, 400 | 195 | 1.16% | 4.12% | 2.12% | -0.61% |
| 1609 | 1500, 3000 | 924 | 2.07% | 2.27% | 3.80% | -0.06% |

### Pair models, 5-fold by athlete (28890 held-out predictions; 1-3 other events known)
interval inflation factor from cross-validation: 0.92
| target | n | HawksPredict-Short | nearest-event Riegel | 80% interval coverage | elite (WA) | collegiate (NRCD) |
|---|---|---|---|---|---|---|
| 100 | 2544 | 1.56% (free slope 1.28%) | 2.79% | 80% | 1.56% (n=2544) | - (n=0) |
| 200 | 3128 | 1.51% (free slope 1.36%) | 3.52% | 79% | 1.51% (n=3128) | - (n=0) |
| 300 | 442 | 1.17% (free slope 1.04%) | 2.82% | 76% | 1.17% (n=442) | - (n=0) |
| 400 | 2141 | 3.60% (free slope 3.47%) | 10.82% | 77% | 1.50% (n=1037) | 5.56% (n=1104) |
| 600 | 96 | 0.95% (free slope 0.95%) | 2.43% | 72% | 0.95% (n=96) | - (n=0) |
| 800 | 4051 | 3.12% (free slope 3.12%) | 7.33% | 80% | 1.10% (n=1024) | 3.80% (n=3027) |
| 1000 | 684 | 1.27% (free slope 1.27%) | 3.20% | 86% | 0.96% (n=570) | 2.81% (n=114) |
| 1500 | 4578 | 2.49% (free slope 2.45%) | 4.25% | 81% | 1.25% (n=1664) | 3.19% (n=2914) |
| 1609 | 3990 | 2.95% (free slope 2.95%) | 4.53% | 79% | 0.90% (n=738) | 3.42% (n=3252) |
| 3000 | 2920 | 2.29% (free slope 2.26%) | 3.28% | 81% | 1.18% (n=1209) | 3.07% (n=1711) |
| 5000 | 3099 | 2.48% (free slope 2.42%) | 3.80% | 81% | 1.34% (n=1305) | 3.31% (n=1794) |
| S2000 | 400 | 1.89% (free slope 1.50%) | 3.35% | 77% | 1.89% (n=400) | - (n=0) |
| S3000 | 656 | 2.07% (free slope 2.07%) | 4.93% | 77% | 2.07% (n=656) | - (n=0) |

### Does training on formula-made in-between marks help? Target 600 m, tested on real 600 m marks
real 600 m marks with a 400 and an 800 (test): 11
| method | error |
|---|---|
| log-log interpolation, no training | 1.83% |
| pair model trained on formula-made 600 marks (400 + 800 athletes) | 1.14% |
| pair model trained on both | 1.56% |
formula-made 600 m marks added for the final fit: 1007 (real 600 m marks: 133)

exported 80 pair models, 12 KB

Reading the tables: these are personal best -> personal best predictions (an athlete's other all-time marks predict the target mark), so errors are not comparable with Lite's race-to-race 4.4%; they show the shape of the relationships, not race-day accuracy.
Elite sprinters span a narrow range, so a free log-log slope is flattened and gave a 63 s 400 m runner an 11.0 s 100 m; sprint and steeple pairs therefore use a fixed slope of 1 (a constant ratio) and cost only 0.1-0.5 points in cross-validation.
No non-elite 100 m/200 m data exists in anything we hold, so those rows carry extra uncertainty (4% added log-SD) and are the least trustworthy; the card says so.
The in-between idea works: log-log interpolation of the two neighbours predicts a real 1000 m to 1.8%, a 300 m to 1.2% and a mile to 2.1%, but it is consistently 1.6-1.8% too fast, so formula-made 600 m marks add that bias back.
Only 133 athletes have a real 600 m mark (11 with 400 and 800), so the 600 m model is trained mostly on formula-made marks and is the least tested row.

## exp14: Ontario high-school finals, elite marks, and synthetic athletes (2026-10-22/23)
Scripts: `exp14_ingest.py`, `exp14_baseline.py`, `exp14_data_step.py`, `exp14_synth.py`, `exp14_synth_sweep.py`, `exp14_lowdata_sub.py`, `exp14_sub_ont.py`, `exp14_research_final.py`, `exp15_short_v2.py`. All sweeps use the NRCD pool (athlete-grouped 5-fold) and the **Ontario holdout**: half of the 4,999 Ontario runners (seed 20261022), never trained on, 2,757 races from 1,092 runners with a 400 m-or-longer history. Ontario dates are approximated (year, day, WECSSAA before OFSAA); only their order matters. The finals are one championship weekend, so cross-event prediction there is easier than predicting a race weeks away; read Ontario numbers as "same-weekend, other-event" accuracy.

### Baseline: the shipped models on real teenagers (no new training)
| model | MAE | 95% CI | paired vs nearest-result Riegel |
|---|---|---|---|
| Riegel (nearest result) | 5.801% | 5.58-6.06 | |
| HawksPredict-Lite v1 (NRCD only) | 3.454% | 3.35-3.59 | -2.55 to -2.16 |
| HawksPredict-Research v1.1 (NRCD only) | 3.710% | 3.60-3.82 | -2.30 to -1.89 |
Both models transfer from college club runners to high-school finalists. Lite beats Research there (Research uses dates and course features that do not exist for these races).

### Which extra real data helps? (Lite: shipped size, labels only; Research: v1 feature set, fast trees)
| training data | Lite NRCD dev | Lite Ontario holdout | Research NRCD dev | Research Ontario holdout |
|---|---|---|---|---|
| NRCD only | 4.170% | 3.368% | 3.642% | 3.540% |
| + Ontario train half | 4.170% (-0.004 to +0.006) | **2.858% (-0.566 to -0.452)** | 3.636% (-0.012 to -0.000) | **2.805% (-0.808 to -0.654)** |
| + 66k elite dated marks (weight 1) | 4.217% (+0.040 to +0.054) | 3.620% (+0.197 to +0.301) | 3.690% (+0.040 to +0.056) | 3.894% (+0.287 to +0.422) |
| + elite (weight 0.3) | 4.182% (+0.007 to +0.018) | 3.559% | 3.648% | 3.873% |
| + Ontario + elite (0.3) | 4.183% | 3.010% | 3.648% | 2.876% |
Teen finals help the teen test by 0.5-0.8 points and cost nothing on college runners. Elite top-list marks hurt both: a list of best marks is a truncated, best-effort sample. They were not used anywhere (Short keeps the World Athletics lists it was already fitted on).

### Retrained models (same recipes as the shipped ones; Ontario train half added to the pool)
| model | frozen NRCD test | Ontario holdout |
|---|---|---|
| Lite v1 (NRCD only, as shipped) | 4.375% | 3.454% [3.35, 3.59] |
| Lite + Ontario train half (distilled, 150 x 15) | 4.380% [4.12, 4.69] | **2.887% [2.79, 3.01]** (paired -0.629 to -0.507) |
| Research v1.1 (NRCD only, reproduced) | 3.562% [3.35, 3.80], 80% coverage 79.5% | 3.710% [3.60, 3.82], coverage 74.9% |
| Research + Ontario train half | 3.558% [3.34, 3.79], coverage 79.0% | **2.688% [2.58, 2.80]**, coverage 82.2% |
The shipped candidates (Lite v1.1, Research all-Ontario) were refit on both Ontario halves: Lite frozen test 4.386% [4.12, 4.69], Research 3.601% [3.39, 3.84]; their Ontario numbers are in-sample and are not reported. On teen-like inputs Lite v1.1 moves predicted times by 1.7% on average (about 1% faster for 400-1500 m and 1% slower for 3000 m); on college-like inputs by 0.3%.
**The frozen NRCD test has now been scored 8 times** (Lite, Research v1, v1.1, and these retrains and reproductions). Treat its numbers as development-level, not as a clean one-shot; the Ontario holdout has been scored once per model.

### HawksPredict-Short on real teenagers (exp14_short_ont.py, exp15_short_v2.py)
Leave-one-event-out within a runner-year, sources are the runner's other Ontario events, the lines were never fitted on this data (v1):
| target | n | v1 MAE | 80% coverage |
|---|---|---|---|
| 100 m | 697 | 2.10% | 96% |
| 200 m | 1020 | 2.28% | 94% |
| 400 m | 1087 | 2.97% | 73% |
| 800 m | 1649 | 3.06% | 82% |
| 1500 m | 2026 | 2.67% | 81% |
| 3000 m | 1374 | 3.67% | 68% |
The 100 m and 200 m rows, which had no non-elite validation, are accurate to about 2% (same-weekend marks; expect more when the PR is months old) and their ranges are wider than they need to be, which is the safe direction. Refitting the pair lines with the Ontario train half added (v1.1; pair SDs floored at v1's, no pairs v1 lacked), scored on the holdout runners: all targets 2.86% -> 2.55%, 3000 m 3.53% -> 2.59%, 80% coverage 81% -> 86%. On 20% of the World Athletics / NRCD athletes held out of both fits the change is within +-0.03 points per event.

### Do the gains survive months-old inputs? (exp14_crossyear.py, exp15_short_v2.py) 
The Ontario finals are a weekend apart, but the site predicts from PRs that can be months old. Rebuilding the Ontario holdout so every input result is at least 150 days older than the target (1,788 races, 700 runners, median 2 inputs):
| Lite | MAE | change vs v1 (95% CI) | 80% coverage / half-width |
|---|---|---|---|
| v1 (NRCD only, shipped) | 3.581% | | 73.4% / 5.2% |
| v1.1-train-half (trained on same-weekend Ontario rows) | 3.201% | -0.448 to -0.323 | 78.0% / 5.1% |
| refit here: NRCD only | 3.646% | +0.029 to +0.094 | |
| refit here: + Ontario same-weekend rows | 3.228% | -0.434 to -0.288 | |
| refit here: + Ontario rows built cross-year | 3.179% | -0.473 to -0.333 | |
Lite's gain holds (about -0.4), and its 80% ranges get closer to 80% (73.4% -> 78.0% cross-year, 77.8% -> 83.1% same-weekend). HawksPredict-Short with sources from earlier years only (best mark per other event, no age allowance, which the site adds through its own source uncertainty): v1 lines 3.97% overall, v1.1 lines 3.86% (100 m 3.38% -> 3.18%, 200 m 3.59% -> 3.45%, 400 m 4.28% -> 3.92%, 800 m 4.77% -> 4.56%, 1500 m 3.71% -> 3.67%, 3000 m 3.75% -> 3.92%); the 80% ranges cover only 68-70% there because teenagers improve a lot between seasons and a year-old best is slow.

### Synthetic athletes: what happens as the amount grows?
**Generator** (`exp14_synth.py`, fitted on training athletes only). Each synthetic athlete borrows the schedule (dates, events, surfaces, meets) of a real training athlete and gets `ln t = A + E[sex,event] + u[surface] + d*ln(dist/5000) + tau*years + c[meet] + e`: a level, a personal slope and trend, the real mean event curve, the real (shrunk) meet-day effects, and noise resampled from the real leftover residuals. Mode *own*: a real athlete's own level and slopes plus a random shift (a perturbed copy). Mode *pop*: level and slopes drawn from the fitted population (a person who exists nowhere in the data). The slope spreads are scaled to match the real residual spread (empirical-Bayes deflation alone gave about zero; the raw spread was too wide). Realism check on held-out real athletes: real rows are scored 5.64% by nearest-result Riegel and 3.70% by a real-trained Research model; own-mode rows 5.86% / 4.08%, pop-mode 6.41% / 4.77%, i.e. a little harder than reality.
**Lite, synthetic added to every training fold, scored on held-out NRCD athletes (66,529 races, 5 folds); change vs real-only 4.170%:**
| synthetic added | own, weight 1 | own, weight 0.25 | pop, weight 1 | pop, weight 0.25 |
|---|---|---|---|---|
| 0.5x real rows | +0.004 to +0.015 | | +0.021 to +0.034 | |
| 1x | +0.013 to +0.027 | | +0.045 to +0.060 | |
| 2x | +0.027 to +0.042 | -0.006 to +0.006 | +0.076 to +0.095 | +0.011 to +0.022 |
| 4x | +0.042 to +0.058 | +0.002 to +0.015 | +0.112 to +0.134 | +0.034 to +0.048 |
| 8x | +0.054 to +0.073 | +0.017 to +0.032 | +0.143 to +0.165 | +0.062 to +0.080 |
| synthetic only, 8x (no real athletes) | +0.082 to +0.103 (4.262%) | | +0.201 to +0.227 (4.384%) | |
More synthetic data is steadily worse. A model trained on synthetic athletes alone comes within 0.1-0.2 points of one trained on real athletes, which says the generator copies the real structure well, and also that it adds no information: it is made from the same athletes.
**Same Lite, trained on all of NRCD plus synthetic, scored on the Ontario holdout (3.368% real-only):** a small low-weight dose helps a little (own 2x w0.25 3.266%, -0.136 to -0.065; pop 2x w0.25 3.257%, -0.146 to -0.081); weight-1 and large amounts are neutral to worse (pop 4x w1 +0.018 to +0.110); synthetic-only 3.448% / 3.426%. Real Ontario rows give -0.5. Synthetic data nudges a model toward a different population only slightly; real data from that population is what matters.
**Research (v1 features, fast trees), same sweep on folds 0-2 only (39,918 races; the Lite sweep used all 5 folds); change vs real-only 3.627%:** own w1: 0.5x +0.005 to +0.023, 1x +0.014 to +0.035, 2x +0.037 to +0.061, 4x +0.057 to +0.083, 8x +0.069 to +0.099; own w0.25 at 2x/4x/8x is neutral (-0.013 to +0.005 / -0.012 to +0.009 / -0.004 to +0.020); pop w1 1x +0.065 to +0.091, 8x +0.214 to +0.255; synthetic only 3.793% (own) and 4.003% (pop). Same shape as Lite, steeper for pop. On the Ontario holdout (real-only 3.540%, one fit per cell) the Research results are noisy and not monotone in the amount (own 0.5x/1x -0.27/-0.28, own 8x w0.25 +0.10 to +0.20, pop 1x +0.15 to +0.25): differences of about 0.2 are within the fit-to-fit scatter of that table, so the only safe reading is that synthetic data from NRCD does not reliably move a model toward high-school runners, while real Ontario rows moved it by -0.8.
**Low-data regime** (only 10% or 25% of the training athletes are real, generator fitted on that fraction alone, own mode): at 10% real the loss against full real data is +0.175 to +0.212; adding 4-8x synthetic recovers 0.03-0.04 of that (4.345% -> 4.310%) and 0.12 on inputs with at most two prior results. At 25% real, synthetic does nothing (x1) or hurts (x4, x8).
**History-subsampling copies** (the same real target with 1-3 earlier results as inputs): x3 gives -0.033 to -0.015 on NRCD dev (sparse-input slice -0.05), but on the Ontario holdout NRCD copies hurt (+0.142 to +0.216 on top of NRCD + Ontario train); only copies of Ontario rows help (-0.074 to -0.022). Not adopted.

### Data-quality note
In `results4.pkl` 7,173 of 27,343 NRCD athlete ids carry both M and F labels across their rows (about half the rows). Not investigated; they may be id collisions or races entered in the other sex's event. The models use the row's own label so nothing breaks, but athlete-level analyses should not assume one sex per id.

## exp16-18: training vs PRs, event-to-event relationships, weather and age (2026-10-23)
Scripts: `exp16_train_effort.py`, `fitrec_hr_check.py` (rerun on the Strava set), `exp17_event_mvn.py`, `exp17_equiv_tables.py`, `exp18_conditions_age.py`.

### Training vs "what the PR says": 1,082 hard 5K/10K efforts from 148 runners
Data: Strava running-races set (116 athletes, 42k runs) plus the FitRec runs table. A hard effort = a 5K or 10K run 8% or more faster than the runner's median of their previous 20 runs. Baseline = their best earlier effort (3-22 km, 14-180 days back) Riegel-scaled to the distance. r = ln(actual / baseline); median gap to the baseline 79 days. These are hard runs, not certified races, and the baseline can itself be a hard training run.
- Taken at face value an earlier best overstates the runner by a median 5.5% (r median +0.055, sd 0.116). Predicting with it directly is wrong by 10.9% on average; a constant offset brings that to 9.0%.
- Association of r (positive = slower than the earlier best implies) with the 8 weeks before: **efforts in the last 4 weeks vs the earlier best +0.34 (0.27 to 0.41)**; days since the earlier best +0.18 (0.13 to 0.24); volume change since the earlier best -0.13 (-0.19 to -0.06; more volume than at the time of the PR means faster than it implies); longest run +0.11; hard-run share +0.10; days since a hard run -0.08; weekly km +0.06 (CI includes 0); change in hard share -0.01.
- Leave-runners-out error: all training features 7.62% (vs 9.04% constant offset; -1.42, CI -2.19 to -0.78); **without the last-4-weeks evidence only 8.77% (-0.27, CI -0.65 to +0.11)**. Volume, frequency, long-run and intensity features add almost nothing once recent running evidence is in. What carries information about current form is recent hard running, then how old the PR is. Consistent with the site's design (every run searched for races) and with using training volume mainly for long events: in the BMClab marathon data (exp12) volume and pace features add -1.0 point.
- Heart-rate check repeated on the Strava runners (122 targets, 58 runners; maximum HR is not in that file, so it is 1.1 x the athlete's 99th percentile of run-average HR): the heart-rate trend correction makes things worse at every strength (+0.48 points at 0.25, CI +0.20 to +0.73), slope -0.20 (CI -0.49 to +0.09). With FitRec's 88 efforts this is two independent datasets without a benefit.

### Event-to-event relationships
A single multivariate normal over ln(time) at 13 events, fitted by EM on athletes with any subset of events (World Athletics + NRCD + Ontario train; two sexes mixed, sex inferred from the times), conditioned on whatever the athlete has, **lost to HawksPredict-Short's pair lines**: 3.04% vs 2.34% on held-out World Athletics / NRCD athletes, 3.48% vs 2.55% on Ontario holdout same-year (400 m 5.4% vs 2.7%: the 400 behaves differently for sprinters and distance runners, which one Gaussian cannot express). It was slightly better on 100 m for elite athletes (1.53% vs 1.81%) and equal for 800-3000 m on Ontario. Not adopted; a mixture of athlete types is the next thing to try.
The pair lines (sex averaged, exact PRs, 80% range) give these equivalents:
| 400 m | 600 m | | 800 m | mile | | 800 m | 1500 m |
|---|---|---|---|---|---|---|---|
| 52.0 | 1:27.4 (1:22.6-1:32.5) | | 1:52 | 4:12.8 (3:57.3-4:29.3) | | 1:52 | 3:51.5 (3:40.5-4:03.0) |
| 56.0 | 1:33.9 (1:28.8-1:39.4) | | 2:02 | 4:33.0 (4:16.3-4:50.8) | | 2:02 | 4:11.7 (3:59.8-4:24.2) |
| 1:00.0 | 1:40.5 (1:35.0-1:46.3) | | 2:12 | 4:53.0 (4:35.1-5:12.1) | | 2:12 | 4:31.9 (4:19.0-4:45.4) |
| 1:04.0 | 1:47.0 (1:41.2-1:53.3) | | 2:22 | 5:12.9 (4:53.7-5:33.3) | | 2:22 | 4:52.0 (4:38.2-5:06.5) |
| 1:08.0 | 1:53.6 (1:47.3-2:00.2) | | 2:36 | 5:40.5 (5:19.6-6:02.7) | | 2:36 | 5:20.2 (5:05.0-5:36.1) |
| 1:14.0 | 2:03.4 (1:56.6-2:10.5) | | 2:52 | 6:11.7 (5:49.0-6:35.9) | | 2:52 | 5:52.3 (5:35.6-6:09.8) |
| 1:20.0 | 2:13.1 (2:05.8-2:20.9) | | 3:10 | 6:46.5 (6:21.6-7:13.0) | | 3:10 | 6:28.4 (6:10.0-6:47.6) |
(`exp17_equiv_tables.py` prints more pairs.) A second known event narrows the range a lot for the 600 (e.g. 400 62 s and 800 138 s give 100.1 s with the pair lines).

### Weather, altitude, wind and age (residuals of models that never saw them)
- **Heat, Ontario holdout (spring track, 2,757 races, temperature + dew point 84-143 F):** residual vs temperature + dew point shows no effect for 400-1500 m (slope per +10 F above 100: 400-800 m -0.03%, 1500 m +0.07%, CIs about +-0.4), and **+0.37% per 10 F for 3000 m (CI +0.07 to +0.81)**. The app's Hadley chart gives about 0.5% per 10 F near 115 F for continuous running and half that for reps up to a mile: consistent with the 3000 m and with the shorter events.
- **Heat, NRCD (Lite out-of-fold residual by air temperature, no dew point):** cross country +0.6% (<40 F), -0.6% (40-50), +0.2% (50-60), +1.9% (60-70), +2.2% (70-80), +3.9% (80+). Roughly 0.2% per degree Fahrenheit above 60, in line with the app's chart (sum of temperature and dew point 140 is 3%) and with published estimates (0.3-0.4% per degree C outside 10-17.5 C). Track/road rows are too few and noisy to say anything.
- **Altitude (NRCD):** no clean pattern (<500 ft +1.1%, 500-1000 +0.1%, 1000-2000 +1.0%, 2000-4000 +1.9%, 4000+ n=13); confounded with course and conference. Not usable as is.
- **Wind on sprints (Ontario 100/200 m, Short v1.1 residual, tailwind positive):** 100 m -0.52% per +1 m/s (about 6 hundredths; n=371, wind -3.8 to +10.0 m/s), 200 m -0.31% per +1 m/s (about 8 hundredths; n=258). The wind reading is a single value per race, so this is a lower bound on the true effect.
- **Age, Ontario (grade category and sex):** Lite v1.1 residuals are within +-1% in every cell (Junior boys -1.03%, Senior girls +0.27%, Novice about 0); errors 2.5-3.1% in all. **Age, World Athletics pair-line residuals by age at the mark:** flat within about 0.5 points for 100->200, 200->400, 800->1500, 800->mile; 1500->5000 drifts from -1.3% (19-22) to -0.3% (31+). In these data age adds no precision beyond what the times already say. Grade is a coarse age proxy and the lists are adults, so this does not exclude an age effect in 12-16 year olds, for whom no exact ages exist in any dataset found.
- **Heart rate:** no benefit in two real datasets (above).

## exp19: a recent-form adjustment to PR-based estimates (2026-10-23)
Script: `exp19_recent_form.py` (on the exp16 table; the race-like split is in the text below). Question: should an old best effort be moved by its age, by what the last four weeks of running show (`rec` = ln of the best 5K-equivalent among 3-22 km runs in the last 28 days over the earlier best's 5K-equivalent; positive = recent running slower), or by the change in weekly volume since it was set? Linear least-absolute-deviation fits, leave-runners-out (5 folds x 5 repeats), 1,071 hard 5K/10K efforts, 147 runners (Strava 869 efforts, FitRec 202).
| adjustment | MAE | change vs constant offset (95% CI) |
|---|---|---|
| constant offset | 9.05% | |
| PR age only | 8.94% | -0.11 (-0.23 to +0.00) |
| last 4 weeks only | 8.05% | **-1.00 (-1.49 to -0.59)** |
| age + last 4 weeks | 8.06% | -0.99 (-1.44 to -0.53) |
| age + last 4 weeks + volume change | 8.06% | -0.99 (-1.40 to -0.53) |
The gain comes entirely from the last-4-weeks term (Strava -1.14, FitRec -0.38, 5K -0.41, 10K -1.16); age and volume change add nothing once it is in. Fit: r = 0.008 + 0.57 x rec (symmetric: 0.565 above, 0.581 below zero). Calibrated out of fold: predicted r quintiles +0.010 / +0.032 / +0.059 / +0.090 / +0.149 against realised medians +0.023 / +0.036 / +0.048 / +0.070 / +0.161.
**But the gain is about effort, not fitness.** Splitting the targets by how hard the run was relative to the runner's usual pace:
| target | n efforts / runners | constant offset | + last 4 weeks | change (95% CI) | slope on rec | r at rec = 0 |
|---|---|---|---|---|---|---|
| 8-14% faster than usual | 472 / 125 | 8.57% | 6.67% | -1.90 (-2.61 to -1.28) | +0.70 | +0.054 |
| 14-20% faster | 261 / 100 | 8.45% | 7.11% | -1.34 (-2.17 to -0.70) | +0.58 | +0.009 |
| **20%+ faster (race-like)** | **338 / 85** | **6.40%** | **6.17%** | **-0.23 (-0.56 to +0.06)** | **+0.22 (0.12 to 0.37)** | **-0.020** |
For race-like efforts the earlier best was already about right (median r 0.000, IQR -0.041 to +0.046) and the recent-form term does not significantly help. Runners who have been running hard lately also choose to run hard when they run a "hard effort" at all; that is most of the apparent signal. Using only recent hard runs (pace 5%+ faster than usual) as the evidence gives the same picture (slope +0.63 over all hard efforts).
**Decision: do not ship a visible adjustment.** For race predictions the expected effect is small (slope about 0.2 x a typical gap of 7% = about 1.5%, not significantly better than none) and the intercept is not identified from non-certified efforts. The prediction log scores the shipped model against real race results (the first batch is the Oct 24 Borough Championships); the form term should be tested there as a logged-only variant before it affects any number a runner sees.
**Hawks data: not run.** The read of the production workouts table was blocked by the session's permission check, so the sanity check on the four athletes with synced runs (about 7 race-like efforts, far too few to decide anything) is still to do.
