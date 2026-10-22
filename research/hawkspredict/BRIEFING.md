# HawksPredict briefing (2026-10-21)

Two models predict a race time, with an 80% range, from an athlete's earlier results.

| | **HawksPredict-Lite v1** | **HawksPredict-Research v1.1** |
|---|---|---|
| For | the Hawks website | the research write-up |
| Size | 6,450 numbers, 66 KB gzipped, about 30 microseconds a prediction | about 80,000 numbers plus three formulas, Python only |
| Needs | distances, times and surfaces (no dates) | dates, full history, earlier meets on the course |
| Error on the frozen test* | **4.38%** | **3.56%** |
| 80% range covers | 78% | 79% |

*2,594 races by 674 runners never seen in training, last season, collegiate club results, scored once.

## Update 2026-10-22: Lite now drives Fitness States
`computeFitness` (`src/fitness.js`) no longer blends VDOT, critical speed and speed-index. Race-quality efforts (races, PRs, a typed 5K only when nothing newer exists; last 730 days; credited back to a flat cool course)
go into HawksPredict-Lite, which gives every event from 400 m to the half with an 80% range. VDOT (aerobic zones) is read off its 1600/3200/5K times. Workout paces, Hawky and the coach all read this.
- **Check:** the old website column rerun with the new code scores 4.02% on the frozen subset, identical to Lite (paired -0.08 to +0.08), versus 4.85% before; the runners with only 400/800 PRs now get estimates too.
- **Kept from the old method:** the mileage slowdown on 10K/half, the Van Cortlandt x1.055 course rows, Garmin VO2max matching, and a training-only estimate for runners with no race or PR at all (labelled as such).
- **Trade-off:** Lite takes the fastest result per distance in two years, with no recency fade, so someone back from injury or a layoff reads faster than they are. Heart rate is not applied (unvalidated; card and log only).
- **Trend:** the "5K down Xs" line skips comparisons across the cutover (2026-10-22); the history sparkline mixes the two methods before it.

## Where they stand (same frozen test)
| Method | Error |
|---|---|
| HawksPredict-Research v1.1 | **3.56%** |
| HawksPredict-Lite | 4.38% |
| Cameron formula | 5.30% |
| Low-rank completion (Blythe-Kiraly style, ours) | 5.46% |
| Riegel | 5.76% |
| Critical speed | 6.94% |
| VDOT (Daniels) | 7.70% |

Best published formula (Cameron) vs Research: 1.5 to 1.9 points better. A rough floor from the data is 3.3-3.4%, because about 85% of
the leftover error is a runner's own day-to-day variability. Equal-effort tuning: trees beat CatBoost, a perceptron and a transformer.

## Against the website's current PR estimate
Same inputs for everyone: each runner's fastest result per website PR event in the previous two years. The website column is
`src/fitness.js` run unchanged (its mileage penalty removed, since there is no mileage in the data).

| 1,041 frozen-test races | Error | Paired difference vs website |
|---|---|---|
| Website today | 4.85% | |
| Cameron | 4.32% | -0.89 to -0.17 |
| **Lite** | **4.15%** | **-1.07 to -0.31** |
| **Research** | **4.04%** | **-1.23 to -0.43** |
| Research given all results, not just PRs | 3.49% | -1.86 to -0.93 |

On a larger 6,063-race dev sample: website 5.08%, Lite 3.62%, Research 3.42%. The website runs about 2% slow on average; both models run
about 1% fast. The website gives no estimate at all when the only PRs are 400 m and 800 m (13% of the test tasks). At 5000 m the website
is level with the models (5.00% vs Lite 5.20%, Research 4.94%).
What this does not show: the website normally also uses watch runs, heart rate, critical-speed fits and mileage, which these inputs leave out.

## Strengths
- **Both:** clearly beat the website, Riegel, VDOT and Cameron on collegiate race-to-race prediction; carry over to the 51 real
  high-school 1600->3200 pairs (Lite 2.03%, Research 1.85%, Riegel 3.01%); give honest ranges.
- **Lite:** tiny and instant; works with undated PRs; same code runs in the Worker (parity test: 200 cases, zero difference).
- **Research:** uses recency, trend and volatility, course history and the other formulas; best accuracy; tested more thoroughly.

## Weaknesses
- **Both:** trained on collegiate club runners, not high school; nothing validated on the Hunter team (two athletes have synced runs);
  Van Cortlandt is not in the training data and backtests say the model runs 1-2% fast there; no weather, sleep, heart rate or
  day-of adjustment; no estimate for an athlete with no results; the leftover day-to-day noise cannot be predicted.
- **Lite:** 0.8 points less accurate than Research; no recency or trend; weak on the 400 m and for elite times; on lifetime-best
  completion (Power of 10, all ages) it only ties Cameron (5.55% each).
- **Research:** needs dates and full history; too big for the Worker; the gain of v1.1 over v1 is small (0.06 points).
- **Website estimate (for contrast):** knows training runs, heart rate, mileage and course factors, which these models do not.

## Extra tests since last time
- **Junior proxy** (Power of 10 athletes with a junior age-group event entry; biased toward hurdlers): Lite 6.58% vs Cameron 6.93%
  (paired -0.39 to -0.31), but a low-rank model fitted to that group scores 6.33%. Control group: Lite 4.75%, Cameron 4.97%.
- **Learning from the other models:** feeding their predictions in as inputs helps slightly (v1 3.63% -> v1.1 3.56%). Retraining with
  extra weight on races another model got right made things much worse (+0.77 points): those are mostly luck.

## Recommended next steps
1. Add a race-predictor card using Lite, plus a prediction log, so real Hunter results score it.
2. Get the rest of the team connected to the watch sync; the personalised and training-based work needs that data.
3. For publication: a bigger high-school test, the two published methods run from their authors' code, several splits.
