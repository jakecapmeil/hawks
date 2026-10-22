# Heart rate, weather and elevation in HawksPredict (2026-10-21)

## What we could and could not test
No dataset we hold pairs heart rate with later race results. NRCD, Power of 10 and the high-school set have none; the Kaggle HR logs are five
individual runners. So a learned heart-rate model is not possible, and anything here is a hand-built correction, not a validated model.

## Design (shipped behind a flag)
HawksPredict-Lite predicts from PRs. On top, the card applies an experimental heart-rate fitness adjustment:
- Heart-rate fitness = median VDOT-like value of steady runs (2.5+ mi, 20+ min, 65-93% of max HR, flat enough, heat and hills credited back),
  the same recipe Fitness States already uses (Swain %HRmax -> %VO2max).
- Adjustment = half the change in that number between when the newest PR was set and now, capped at 3%.
- The raw Lite time and the adjusted time are both stored in `prediction_log` for each meet, first prediction locked, so real Hunter results will
  show whether the adjustment helps. Until then it is labelled experimental and the raw model is the reference.

## Retrospective check (exploratory, not validation)
`scripts/hr_check.py` on four public single-runner logs, race-like efforts found by rule (a standard distance run 12% faster than the runner's median pace):
- 43 targets (28 from one runner), 4 runners.
- Lite alone 5.61% error; with the heart-rate adjustment 5.59%; gain 0.00 points (95% CI -0.67 to +0.62).
- The slope of Lite's miss on heart-rate fitness change has the expected sign (-0.16, CI -0.62 to -0.02) but the correlation is weak (-0.09).
Reading: no evidence the layer helps, none that it hurts; far too few races to say. Race detection by rule is noisy (tempo runs included).

## Literature notes
- Wearable VO2max from heart rate vs speed (Firstbeat-style) is about 4-7% error against lab tests, and depends strongly on the max-HR input: a 15 bpm
  error moves VO2max error to roughly 7-9% (Firstbeat's own report; independent studies 4-7%). It is a weak proxy for race performance.
- No source found showing a fixed-pace heart-rate trend predicts race time directly. Deep-learning work using heart-rate zones on marathon data used simulated heart rate, so it shows nothing about real heart rate.

## Weather and elevation
Not retrained. `src/conditions.js` already credits heat (temperature plus dew point), hills, Van Cortlandt (x1.055) and other cross-country courses (x1.025).
In the NRCD ablation weather inputs added 0.06 points and cover about 13% of rows. Heat literature: Ely et al. 2007 (marathon slowdown grows with heat stress and is larger for slower runners).
The right way to use weather on race day is as a post-model factor, as the site does.

## What would settle it
Prediction log with 30-50 Hunter races where raw and adjusted times are both stored; compare the two with a paired test. Until then keep raw as the headline.
