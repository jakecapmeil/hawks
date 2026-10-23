# What is left to do

As of 2026-10-23, `main` = `9dd2fc2`. Everything below is either not built, built but never tried on a real account, or a research question we could not close. Nothing here is a promise; the order is a recommendation.

Legend: **You** = needs something only the owner can do (a login, a file, a decision). **Me** = can be done in a session without outside help.

## 1. Tried only against stand-ins (do first, small)

These shipped without anyone seeing them work on a real account.

| Item | What was tested | What is missing | Who |
|---|---|---|---|
| Plan to watch (`src/planpush.js`) | A fake intervals.icu: create, update in place, never touch other events, drop removed days, read-back check (`scripts/check-planpush.mjs`) | One real Preview + Send from a connected account. Confirm intervals.icu turns the text into steps, that Garmin or COROS then shows pace targets, and that rest steps and repeats look right. The step syntax comes from forum posts and the API spec, not from a test | You send once, then tell me the message; I fix the format |
| Marathon row (`src/marathon.js`) | JS matches Python on 200 cases; whole fitness path on a stub database | A real athlete's row on the live site (needs 15 running days). The roster tool returns minors' contact details, so I did not use it | You look; or a test athlete |
| Runners like you, Heat/hills, Taper (`src/cohorts.js`, `src/calculators.js`) | Unit checks and the live endpoints | Seeing the card in a browser at phone width; first real use | Me (browser pass), then you |
| Race fitness Edit mode, distance ordering | Local test earlier; sort function tested | Click-through on the live site | Me |
| Lite v1.1 / Short v1.1 numbers for real athletes | Parity with Python; stub test | A look at 2-3 real athletes' rows before and after (times should move about 1-2% for teen inputs) | You |

## 2. Scoring the model on real races (the Oct 24 Borough Championships and after)

- Forecasts for Oct 24 are locked under Lite **v1**. The prediction log is keyed by model name, so views after the v1.1 deploy created **v1.1 rows next to them**. Scoring must compare like with like and say which rows it used.
- Needs from **You**: the real results (athlete, event, time). Then **Me**: score v1 vs v1.1 vs Riegel, 80% range coverage, and the heart-rate "adjusted" log column (it has been logged but not shown since the heart-rate layer was removed from the card).
- This also becomes the first **fresh, one-shot test set** from the actual population. The NRCD frozen test has been scored 8 times and should be treated as a development set from now on. Keep this one untouched until a model is final.
- Add a recurring job to score every meet's log automatically (currently a manual script).

## 3. Recent-form adjustment (decided not to ship; what would change that)

- Result so far (exp19): recent running evidence cut error about 1 point on hard efforts, but only 0.23 (not significant) on race-like efforts; Hawks data (12 efforts) gave no support.
- Next step is a **logged-only** variant: compute the form term at prediction time and store it beside the prediction (like the heart-rate layer), then score it on real races. Needs a migration for the extra column and ~1 session.
- Needs several meets of data before any decision. Do not show it to runners until then.

## 4. Kailo rebuild: what exists and what does not

Built: marathon predictor, calculators (heat/hills, taper), runners-like-you, plan-to-watch push, distance ordering, 100 m to half marathon predictions with ranges, free Garmin/COROS sync via intervals.icu, Claude connector, Hawky coach with guardrails.

| Kailo feature | Hawks status | Plan |
|---|---|---|
| Built-in AI chat over your data | Hawky (`src/hawky.js`, `src/gemini.js`) already chats and edits single plan days; the connector lets a runner's own Claude read their data. The gap analysis was started and interrupted | Write the spec: what questions it should answer (fitness, predictions, why a day was changed, what-if), what data it can read, cost per message, rate limits, privacy (minors) and guardrails. Then decide between extending Hawky or exposing a read tool set |
| Auto-push of plan changes | Push is manual | When Hawky changes a day, or the plan week rolls over, re-send the next 14 days automatically for athletes who opted in. Needs an "auto-send" toggle and a cron entry |
| Course-specific race pacing | Not built | Needs a course file (GPX) and an elevation-aware pacing function; heat/hill cost already exists. Medium |
| Live spectator tracking (Kailo Live) | Not feasible free | Needs a native app streaming GPS. Skip unless an app is planned |
| Strava / Apple Health import | Not built | Strava needs API approval and does not allow storing/serving data freely; Apple Health needs a native app. Intervals.icu covers Garmin and COROS. Skip for now |
| Readiness / daily recommendation | Hawky readiness and wellness (HRV, resting HR from intervals.icu) exist | Check whether it is shown clearly; no new model needed |
| Clubs map, XC rankings, meet simulator (Kailo "KPACE") | Not built | Hawks has meets and a team view. A meet simulator (predict team score from predicted times) is plausible; not scoped |
| Pricing/paywall | Not applicable | The point is free |

Marathon-specific gaps: the model ignores PRs (it reads training only), course, weather, taper; its 80% range is about ±10%; trained on adults who log runs on one site, so it is least reliable for teenage runners; no sex/age input because the roster has none. If a marathon blend with the half-marathon PR estimate is wanted it needs paired PR + training + marathon data, which we do not have.

## 5. Data still wanted (and who can get it)

| Data | Why | Status |
|---|---|---|
| Van Cortlandt race + another race within 14 days, same athlete | The 5.5% Van Cortlandt factor is a coaches' rule of thumb; about 100 pairs would pin it to about 1 point | No public file. **You** may have PSAL/borough results, or the team's own history; send files and I build the pairing. Athletic.net, MileSplit and TFRRS are HTML-only and their terms or past takedown demands rule out scraping |
| Season-best career data for teenagers (800/1500/5000, ages 12-19) | The only way to test an age effect where it matters; none found | Italian runners born 1988 (arXiv 2206.12716, 369 runners): authors say "write to us" - **You** (or I draft the email). Norwegian federation youth data (135k season bests) - ask the authors |
| Training + track race results for middle distance | The training-to-PR link for the events Hawks runs | Nothing public found. The Hawks app itself is the dataset: more athletes connecting intervals.icu, and every race logged. Four athletes have synced runs today |
| Nature 2020 "Human running performance from real-world big data" | Possible large training+PR dataset | Page sits behind a login from the command line. **You** open it and read the data-availability statement |
| More teenage cross-event data | Ontario finals were the only real teen source | Look for other state/provincial championship results published as open data |

## 6. Research questions left open

- **Event relationships by athlete type.** A single Gaussian over 13 events lost to the pair lines (3.04% vs 2.34%); the 400 m is the failure. Try a mixture of types (sprinter, middle, distance) and compare on the same holdouts.
- **Short model validation for sprints** is on Ontario finals only (about 2% at 100/200 on same-weekend marks; 3.4% from earlier-year marks). 100/200 ranges are intentionally wide. Test again when Hawks has real sprint PRs and meet results.
- **Lite retraining with formula-made in-between marks** was done for Short only. Whether it helps Lite is untested; expected small.
- **Lite 80% ranges** cover 78% on college data, 78% on teens one year out; consider a refit of the interval table from teen residuals.
- **Synthetic data**: concluded (more is worse on real athletes; a small low-weight dose helps slightly on a new population). Open: a generator fitted to Hawks athletes once there are enough of them; synthetic data for the training-to-race link, which no real data covers.
- **Heart rate** has no demonstrated benefit in three real datasets (FitRec 88 efforts, Strava 122, simulator). Revisit only with a design that measures heart rate under race effort.
- **Age**: no measurable effect in the data we have, but nothing covers ages 12-16 at exact age. Cannot be settled without new data.
- **NRCD sex labels**: 26% of athlete ids carry both M and F across rows. Not investigated.
- **Elite marks hurt** Lite and Research; do not add top-list data to them.

## 7. Engineering and hygiene

- **No automated test run in CI.** The checks are scripts (`scripts/check-*.mjs`). Add one npm script that runs all of them and gate pushes to main on it.
- **Page script is one 200 KB inline block** in `index.html`; every change is a syntax-check-and-hope. A browser smoke test (open each page, click Edit, run each calculator) would catch layout and runtime errors the unit checks cannot.
- **Model files are bundled**: `pacemodel.json` 177 KB, `marathonmodel.json` 91 KB, plus short/cohort JSON. Fine now; watch worker size if more models are added.
- **Migrations are manual.** Auto-deploy does not run them; the notes in this repo say so, but a deploy script that applies pending migrations after a push would remove the risk of a mismatch.
- **Cached fitness states** are reset by a migration whenever a model changes. A model-version key in the cache would make that automatic.
- **Research (Python) models** (`research/hawkspredict/models/*.pkl`, gitignored) are not deployed and not versioned. Decide whether Research should ever serve anything.
- **Privacy**: the repo is public and Hawks data involves minors. Keep outputs aggregate-only; forecasts are gitignored; add a pre-commit check that rejects names in committed markdown.
- **Prediction log growth**: one row per person-event-race-model; fine for now.

## 8. Writing it up

- A paper and a public benchmark were both wanted ("later in the line", see `PUBLISHING.md`). What exists: NRCD benchmark, Lite/Research/Short, the Ontario transfer result, the synthetic-data study, the negative results (heart rate, elite data, Gaussian event model, form adjustment). What would make it publishable: a fresh held-out test from Hawks (section 2), a clean benchmark release of the NRCD rows (licence CC-BY-4.0 allows it) with the evaluation script, and the Ontario holdout split definition.
- Keep `RESULTS.md` as the lab notebook; draft the paper's tables from it, not from memory.

## Suggested order

1. You: send one real watch push; look at one real athlete's rows; hand over Oct 24 results.
2. Me: browser smoke pass over every new screen; score the Oct 24 log (v1 vs v1.1 vs Riegel); write the chat spec.
3. Me + You: Van Cortlandt pairs from whatever results files exist.
4. Me: logged-only recent-form column; auto-push of plan changes; test script + CI gate.
5. Later: event-type mixture model; course pacing; meet simulator; paper.
