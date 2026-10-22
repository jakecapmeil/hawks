# HawksPredict: app use cases, research plan, model choice, data plan (2026-10-21)

## 1. Where it stands
- Trained on NRCD (83k athlete-race rows, 16k collegiate runners). Held-out error 3.55-3.8% vs 5.6% for Riegel.
- Validated out-of-domain on 51 real high-school 1600 -> 3200 pairs: 1.83% (Riegel 3.01%).
- 80% prediction ranges, conformal-calibrated (coverage 80% on held-out collegiate; 78% on the high-school pairs).
- Untested where it matters most: the Hunter team (2 of 22 athletes have synced runs, one race each).

## 2. Model family benchmark (held-out athletes, same features, one split, error bar about +-0.05 points)
| Model | Learned numbers | MAE |
|---|---|---|
| Riegel, one exponent | 1 | 5.67% |
| Ridge (linear) | 51 | 4.55% |
| Trees, tiny | 760 | 4.27% |
| MLP 32x32 (a "perceptron") | 2,721 | 4.04% |
| Trees, small | 6,450 | 3.97% |
| Transformer over result history (d=32) | 18,785 | 4.01% |
| MLP 128x128 | 23,169 | 3.99% |
| Trees, medium | 36,400 | 3.83% |
| Transformer (d=64, 3 layers) | 81,089 | 3.96% |
| MLP 256x256x256 | 144,897 | 3.97% |
| Trees, large | 280,500 | 3.76% |

Reading: everything converges near 3.8-4.0%. The limit is information (a runner has few results), not model
capacity. Going from 6.5k to 280k parameters (43x) buys 0.21 points. Trees win slightly at every size; the
transformer and bigger MLPs add nothing. This matches Grinsztajn et al., NeurIPS 2022 (trees beat deep nets on
medium tabular data): https://arxiv.org/pdf/2207.08815

## 3. Use cases in the Hawks app
### Works today (needs only PRs / recent race results)
1. Race predictor card on each athlete: predicted time + 80% range for any event (400 m to ~10 K, XC 5K, VC 2.5 mi).
   Replaces the single VDOT estimate in src/fitness.js with an estimate that learns each runner's own endurance.
2. Equivalent performances: "your 4:53 mile is about an 18:30 5K".
3. Meet entry help: predicted time and range per athlete for each event; "who is likely to score".
4. PR odds: probability that a given race beats the current PR (from the range).
5. Bad-day / hidden-fitness flag: a race far outside the 80% range, in either direction, goes to the coach.
6. Stale-data flag: ranges widen with sparse or old results, so the app can say "update PRs" instead of guessing.
7. Hawky coach tool: predict_race(person, event, date) next to the existing log and fitness tools.
8. Workout pace tables: feed the model's 5K into the pace library instead of the self-entered 5K.

### Needs more data before it works
- Day-of prediction from temperature, hills and sleep (see section 5).
- Anyone with no race result (6+ of 22 roster entries have no PRs): needs a training-only fitness model, which needs
  paired training-and-race data that does not exist in open form.
- Course effects beyond a hill feature (Van Cortlandt is not in NRCD; two backtest points say the model runs about
  1-2% fast there).
- Freshmen/sophomore growth: no age or grade input.
- Half marathon and marathon: NRCD is mostly <= 10 K.
- Placing / team-scoring prediction: needs opponent data.

### Engineering note
The app runs on Cloudflare Workers (JavaScript). The 480k-number model is several MB; the 6.5k-number "small trees"
version is about 50 KB of JSON and evaluates in microseconds. The accuracy-vs-size result above is therefore a
product requirement, not just a research nicety.

## 4. Research angle (honest version)
Prior art, so we do not overclaim:
- Blythe & Kiraly, local matrix completion, about 2% relative error on UK athletes: https://arxiv.org/pdf/1505.01147
- Emig & Peltonen, Nature Communications 2020, two-parameter model on about 14,000 wearable users, about 2% marathon
  error: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7538888/
- Smyth & Cunningham, case-based reasoning on London Marathon: https://ijcai.org/proceedings/2018/754
- Commercial: Garmin's predictor is optimistic for half marathoners (dissertation, under 10% MAPE):
  https://scholarworks.gsu.edu/kin_health_diss/51

"Most accurate in the world" is not a claim we can support and not the right goal. Defensible contributions:
1. An open benchmark: race-time prediction on open collegiate and high-school data, with physics formulas
   (Riegel, VDOT, critical speed, Cameron) and learned models (ridge, trees, MLP, transformer) compared on
   accuracy vs parameters vs latency. We have the first draft of this table already.
2. Calibrated uncertainty: conformal intervals for race prediction, with coverage reported by distance and domain.
   Rare in this literature.
3. Domain transfer: collegiate-trained model on high-school pairs (1.83% vs Riegel 3.01%).
4. Small-team personalization: empirical-Bayes shrinkage of per-athlete bias, estimated from NRCD (between-athlete
   bias sd about 1.9-2.4% vs within-athlete sd about 5.5%), tested as teams accumulate data.
What a paper would still need: reimplement Blythe-Kiraly and Emig-Peltonen baselines and run them on the same
splits; five-fold results with confidence intervals for every row; temporal and by-distance splits; an
ablation of every feature; a larger high-school test set (Power of 10 junior age groups, see section 6);
a pre-registered Hunter test (prediction log) so at least one result is truly out of sample.

## 5. Weather, hills, sleep (same-day prediction)
Level 1, now: physics adjustment on top of the flat-course prediction. The app already has heat and hill costs
(src/conditions.js). Cost: a few hours. Accuracy: unvalidated.
Level 2: learn the weather effect from NRCD (weather exists for about 13% of rows, 2023 on). Reasonable, modest gain.
Level 3: sleep, HRV, mileage, HR. No open data links these to race outcomes in runners. It has to come from Hawks:
log prediction vs actual at every race, plus sleep and training load from the watch sync. About 22 athletes x 6-8
races per season is about 150 labelled observations per year, enough for a small correction model after about
two seasons. Start collecting now; this is the real long-term moat.

## 6. Data
### Used
NRCD (CC-BY-4.0, 4.6 MB); Kaggle high-school pairs (CC0).
### Worth downloading next (needs your OK; Kaggle token works)
- The Power of 10, UK athletics: cleaned subsets 20 MB each (raw file 848 MB). Athlete-level track results with age
  groups; junior age groups are the closest open match to high school. License listed as unknown.
  https://www.kaggle.com/datasets/goprogram/thepowerof10/data
- World Athletics top lists (50-90 MB): elite only, useful as a stress test, not training.
### Adult/marathon scale (works for scaling-law checks, not for our distances)
Ultra-marathon 828 MB (1.6M athletes); runningwithrock marathons 25-116 MB; Boston 2015-17; Berlin; London; NYC; Comrades.
### Training data without race labels
Figshare/Kaggle long-distance training 2019-20 (10.7M records, 36k athletes, about 1 GB+); Endomondo/FitRec
(academic use only); small single-runner Strava/Garmin sets already downloaded.
### Blocked or unavailable
Athletic.net (returns 403 to scripts), MileSplit/DyeStat (terms), the Emig-Peltonen data (not public), PSAL meet
archives (PDF/HTML, would need manual export).
### Small extras
Figshare wearable HRV + sleep diary set (not runners).

## 7. AI-generated (synthetic) data
- Never in the test set. Never as a stand-in for real race results: a model trained on a generator's assumptions
  learns the generator (evaluation circularity).
- Fine for: (a) physics-based augmentation, e.g. simulate runners from a critical-speed or Riegel family with
  random exponents to pre-train the shape of the curve; (b) privacy-safe demos; (c) stress tests.
- Research on mixing: synthetic only degrades models, but real plus synthetic can stay stable
  (https://arxiv.org/pdf/2503.03150).
- LLM-written labels or race times are worse than useless: they hallucinate plausible-looking numbers.
- The Kaggle "Run Club Marathon Performance" set is synthetic; excluded.

## 8. Suggested order of work
1. Package "HawksPredict-Lite" (small trees, about 6.5k numbers) as JSON + a JS evaluator; add a race predictor card
   behind a flag, with the range shown.
2. Prediction log table in D1: prediction, actual, athlete, event, conditions. This is the dataset the research needs.
3. Download Power of 10 junior data; rebuild the high-school validation on a larger set.
4. Reimplement the two published baselines and run the benchmark with confidence intervals.
5. Weather Level 1 (physics), then Level 2 from NRCD.
