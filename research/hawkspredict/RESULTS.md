
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
