# HawksPredict

Race-time prediction from an athlete's earlier results. Name is a placeholder; variants get suffixes.

| Variant | What it is | Where |
|---|---|---|
| **HawksPredict-Lite v1** | 150 small trees, 6,450 learned numbers, date-free features, 80% range. Runs in a Worker in about 30 microseconds. | `src/pacemodel.js`, `src/pacemodel.json` (66 KB gzipped) |
| **HawksPredict-Research v1** | Tuned gradient-boosted trees on the full feature set with calibrated 80% ranges. For the write-up. | scripts here (`final_research.py`); model file not committed |

Not wired into the app UI yet. Nothing here is deployed. Start with `BRIEFING.md` (one page: standings, comparison with the website's estimate, strengths and weaknesses).

Update: **HawksPredict-Research v1.1** adds Cameron, VDOT, critical-speed and low-rank predictions as inputs: 3.56% on the frozen test (v1: 3.63%, paired gain 0.007 to 0.128 points). Scripts: `exp10_learn_from_others.py`, `final_research_v11.py`; website comparison: `site_compare_*.py`, `site_estimates.mjs`; junior proxy: `po10_junior.py`.

## Update 2026-10-21 (plan: `PLAN_v2.md`)
- **Race predictor card** in the app (`src/racepredict.js`, `/api/predict`, `migrations/0027_prediction_log.sql`), HawksPredict-Lite on the runner's PRs with an
  80% range, next to the Fitness States number. Predictions for the next meet are stored (first one locked) so real results can score them.
- **Heart rate:** no dataset pairs heart rate with race results, so it is an experimental correction on top of Lite, not a model. Exploratory check
  on public logs: no measurable gain (0.00 points, CI -0.67 to +0.62, 43 races). Details and literature: `HEART_RATE.md`.
- **Power of 10 as a prior for Research** (`exp11_po10_prior.py`): a rank-3 model fitted on 264k Power of 10 athletes predicts 4.90% alone vs 5.52% for the
  plain projection on the same rows, but as extra inputs to Research it improves CV error by only 0.01 points (3.640 -> 3.630, 3.644 -> 3.634; CIs exclude 0 but the effect is negligible).
  Not worth the frozen-test score; Research stays v1.1 at 3.56%.
- **Mega-dataset and publishing:** `PUBLISHING.md`. Short answer: publish a benchmark (loaders, frozen splits, baselines, noise floor), not a merged file.
- **Data cleanup:** provenance and checksums in `DATASETS.md`; the Power of 10 files can be deleted (commands in the chat).

## Update 2026-10-22: Lite now drives Fitness States
`computeFitness` (`src/fitness.js`) no longer blends VDOT, critical speed and speed-index. Race-quality efforts (races, PRs, a typed 5K only when nothing newer exists; last 730 days; credited back to a flat cool course)
go into HawksPredict-Lite, which gives every event from 400 m to the half with an 80% range. VDOT (aerobic zones) is read off its 1600/3200/5K times. Workout paces, Hawky and the coach all read this.
- **Check:** the old website column rerun with the new code scores 4.02% on the frozen subset, identical to Lite (paired -0.08 to +0.08), versus 4.85% before; the runners with only 400/800 PRs now get estimates too.
- **Kept from the old method:** the mileage slowdown on 10K/half, the Van Cortlandt x1.055 course rows, Garmin VO2max matching, and a training-only estimate for runners with no race or PR at all (labelled as such).
- **Trade-off:** Lite takes the fastest result per distance in two years, with no recency fade, so someone back from injury or a layoff reads faster than they are. Heart rate is not applied (unvalidated; card and log only).
- **Trend:** the "5K down Xs" line skips comparisons across the cutover (2026-10-22); the history sparkline mixes the two methods before it.

## Headline numbers (frozen test set)
Test = 2,594 races by 674 runners who were never in training, all from the last season (2025-08 onward), scored once.
Error = mean absolute percent error of predicted finish time. CI = athlete-clustered bootstrap.

| Model | Error | 95% CI |
|---|---|---|
| **HawksPredict-Research** | **3.63%** | 3.40-3.88 |
| HawksPredict-Lite | 4.38% | 4.10-4.68 |
| Cameron formula | 5.30% | 4.99-5.70 |
| Low-rank completion (our reimplementation, tuned) | 5.46% | 5.16-5.75 |
| Riegel, nearest result | 5.76% | 5.42-6.18 |
| Critical speed (2-parameter) | 6.94% | 6.48-7.45 |
| VDOT (Daniels) | 7.70% | 7.28-8.16 |

Research vs Cameron, paired: 1.50 to 1.88 points better. 80% ranges cover 79.3% of races (Research) and 78.1% (Lite).
The 51 real high-school 1600->3200 pairs (used as a dev set, so not a clean test): Research 1.85%, Lite 2.03%, Riegel 3.01%.

## What the experiments found
1. **Model family:** after equal tuning budgets, boosted trees beat everything else. Paired gap vs HistGradientBoosting:
   CatBoost +0.07 to +0.09 points worse, MLP +0.33 to +0.37, transformer over the result history +0.42 to +0.47.
2. **Size vs accuracy:** past about 6,500 numbers, extra size buys little (6.5k numbers: 3.97%; 280k numbers: 3.76% on one split).
3. **Noise floor:** the meet-day (course, weather, field) explains about 8% of the leftover error variance (10% in cross country,
   3% on the track), a runner's persistent bias about 7%, and the remaining ~85% is that runner's day-to-day variability.
   That puts a floor of roughly 3.3-3.4% on this data. The Research model is at 3.63%.
4. **More data:** error falls about 3.4% per doubling of training data (50% -> 100%: 3.80% -> 3.71%). Slow, but real.
5. **Negative results (kept on purpose):** per-athlete bias fine-tuning does not help on NRCD athletes (shrunk correction is
   0.001 to 0.017 points worse); the course-difficulty feature built from earlier meets in the same series helps only 0.013 points;
   course elevation, recency weighting, an ExtraTrees blend and endurance-gap features gave nothing.
6. **Feature ablation (points of error added when removed):** per-distance projections 0.133, recency/trend/volatility 0.092,
   weather inputs 0.059, season and experience 0.020, course difficulty 0.013. Weather columns exist for only ~13% of rows
   and partly stand in for newer, better-documented seasons, so HawksPredict-Lite does not use them.

7. **A different test, a different answer:** on The Power of 10 (266k UK athletes; each row is one athlete's lifetime bests, no
   dates, ages or ids), hiding one event and predicting it from the athlete's other bests, HawksPredict-Lite scores 5.55%, the
   same as Cameron (paired difference -0.04 to +0.04) and better than Riegel (6.41%) and our low-rank baseline (6.01%). So the
   lead over Cameron seen on race-to-race collegiate data does not carry over to lifetime-best completion (the Blythe-Kiraly
   setting). Lite wins clearly on 1500 m and 3000 m and in the club-runner range; it loses on 400 m, elite-level runners and the half marathon.

## Limits you must keep in mind
- Trained on collegiate (club) results; only 51 high-school pairs, all 1600->3200, to check transfer.
- Nothing is validated on the Hunter team yet: two athletes have synced runs, one race each.
- Van Cortlandt is not in the training data. Two backtest points say the model runs 1-2% fast there.
- The meet-day effect cannot be known before a race, so it is not in the predictions; it is part of the error.
- Baselines are our reimplementations of published formulas (Daniels, Cameron, Blythe-Kiraly-style low rank, critical speed).
  Cameron's formula matches the high-school spreadsheet's Cameron column to under a second. No head-to-head against the
  authors' own code.
- Fold 0 and the high-school pairs guided some earlier choices; the final test was touched once per finalist.
- LightGBM was not installed (it needs `libomp` from Homebrew); scikit-learn's HistGradientBoosting is the same family.

## Data (all downloaded outside the repo)
- NRCD v2.1.0, CC-BY-4.0: https://zenodo.org/records/22077479
- Kaggle "Running Times Data for High School Students", CC0 (51 usable pairs).
- The Power of 10 cleaned subsets (Kaggle `goprogram/thepowerof10`, license unknown): anonymous lifetime-best matrix, so it
  cannot serve as a high-school test; used only for the zero-shot test above. Raw 848 MB file (which may carry ages) not downloaded.
- Other candidates are in `DATASETS.md`.

## Reproduce
```
python3 scripts/prep4.py <NRCD folder> results4.pkl
python3 scripts/build4.py <workdir>        # features, course-difficulty, frozen split
python3 scripts/exp6_noise.py <workdir>    # noise floor
python3 scripts/exp7_compare.py <workdir>  # tuned comparison, baselines
python3 scripts/exp8_finetune_lc.py <workdir>
python3 scripts/exp9_ablate.py <workdir>
python3 scripts/po10_eval.py <workdir>     # needs po10_raw/ex/unbiased_clean.csv
python3 scripts/final_research.py <workdir>
python3 scripts/build_lite.py <workdir> 730 lite730.pkl && python3 scripts/lite_train.py <workdir>
node scripts/check-pacemodel.mjs <workdir>/pace_lite_parity.json   # from the repo root; JS vs Python
```
`RESULTS.md` is the raw log (its first Low-rank row is the untuned version, superseded by the table above).
`PLAN.md` and the `forecast_*` files are earlier notes; `forecast_*` are the locked Oct 24 predictions to score after the race.

## To make this publishable
1. A larger high-school test. The cleaned Power of 10 files turned out to have no ages; the 848 MB raw file may, but needs your OK and a license check. State association or PSAL results are the other route.
2. A prospective Hunter test: log every prediction and its result in the app.
3. Reimplement Blythe-Kiraly and Emig-Peltonen properly and rerun on the same splits.
4. Several seeds and splits, not one frozen test, to show the ranking is stable.
5. Decide the claim: "most accurate for its size" (accuracy-vs-parameters curve plus the noise-floor analysis), not "most accurate".
