# HawksPredict plan v2 (2026-10-21)

Deciding constraint: **no dataset we hold pairs heart rate with later race results.** The Kaggle logs are ~5 individual runners
(cardio-activities, Garmin half log, running-log-insight, two Strava sets); `MarathonData.csv` has no heart rate; NRCD and
Power of 10 have none. A learned HR model is not possible. So HR is a *correction layer on top of Lite*, not a new model.

## 1. Heart-rate layer (tier 1)
- The website already turns steady-run HR into a VDOT (`src/fitness.js`, Swain %HRmax -> %VO2max, heat/hill adjusted). Reuse it.
- Layer = change in HR-derived fitness between the dates of the races Lite used and today, converted to a time factor
  (time ∝ VDOT^-1 approx.), shrunk (apply 50%) and capped (±3%).
- Raw Lite stays the headline; the HR-adjusted time is shown and logged next to it. The prediction log decides whether the
  layer helps, on real Hunter races.
- Exploratory retrospective check on the single-runner logs that have HR + pace + distance. Expect tens of races; report with a CI,
  call it exploratory, never validated.
- Literature: wearable VO2max (Firstbeat) is ~4-7% MAPE vs lab and depends heavily on max-HR input (15 bpm error -> 7-9% VO2max error);
  no source found showing a fixed-pace HR trend predicts race time directly. So shrink hard.
- The app's `effort` (1-10) is %HRmax + heat + hills; it describes a run, not fitness. It is not a second layer. Use `hr_effort`/avg HR only through the layer above.

## 2. Weather and elevation (tier 2)
- No retraining. `src/conditions.js` already has heat/dew-point, hill, Van Cortlandt (VC 1.055) and XC (1.025) factors; apply after the model.
- Ablation gain from weather columns is 0.06 points and they cover ~13% of rows; little to gain.

## 3. Race-predictor card + prediction log
- Behind a flag. Migration: athlete, event, race date, model version, inputs hash, raw Lite time + range, HR-adjusted time + range, created_at.
- First prediction per (athlete, event, race date) is locked (INSERT OR IGNORE) so scoring cannot leak.
- Sits next to Fitness States as "HawksPredict", with the website number shown as the current estimate; no silent disagreement.
- No push, no remote migration without asking; if asked, run remote D1 migrations in the same turn (memory rule).

## 4. Research model
- At most ONE more frozen-test score. Finalist chosen on pool CV only.
- Levers: seed/split ensembles; Power of 10 low-rank factors as a prior/feature (fit on PO10 only, evaluated in NRCD pool CV).
- If nothing beats the pool-CV CI, say so and stop.

## 5. Data: deletion, mega-set, publishing
- Before deleting: record source URL, date, sha256 in DATASETS.md; keep derived files the scripts need. I give the user `rm` commands; I do not delete.
- Redistributable: NRCD (CC-BY-4.0), high-school set (CC0). Verify each Kaggle licence with metadata. Power of 10 licence unknown: do not redistribute.
- Hunter data (minors) never goes public. Model-generated data is not worth publishing as a dataset.
- Publish a **benchmark**: loaders, frozen splits, metrics, baselines, noise-floor analysis; download scripts for non-redistributable sources.
- Paper framing: "most accurate for its size, near the noise floor".
- Existing work to cite/compare: Blythe & Kiraly 2016 (PLOS ONE), Emig & Peltonen 2020 (Nat. Commun.), Dash et al. 2024 (small benchmark, 15 runners),
  Dai et al. 2025 (Front. Sports Act. Living, smartwatch accuracy), Ruiz-Mayo 2016. No dedicated running benchmark found in Sci Data / NeurIPS D&B (one search; verify).

## Order
plan -> HR feasibility check -> card + log -> PO10 transfer experiment -> one bounded Research attempt -> publishing write-up -> deletion commands.
