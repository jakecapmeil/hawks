# Running dataset catalog (from web search; Kaggle pages not opened, sizes/licenses unverified unless noted)

## A. Race results (PR / event-time model)
| Dataset | Source | Content | Verified |
|---|---|---|---|
| NRCD v2.1.0 | Zenodo 22077479 | ~129k collegiate XC/track/road results, athlete IDs | CC-BY-4.0, 4.6 MB (API checked) |
| Ultra-marathon records | Kaggle aiaiaidavid/the-big-dataset-of-ultra-marathon-running | 7.46M results, 1.64M athletes, anonymised IDs | no |
| 2023 / 2024 Marathon Results | Kaggle runningwithrock | ~429k runners / 641 races (2023) | no |
| 2010-2019 Fall Marathons | Kaggle runningwithrock | ~2M results, 100 races | no |
| NYC Marathon (all years) | Kaggle runningwithrock/nyc-marathon-results-all-years | net time, age | no |
| Berlin 1974-2019 | Kaggle aiaiaidavid/berlin-marathons-data | time, sex, age, + weather | no |
| London Marathon | Kaggle kevinegan/london-marathon-results | results | no |
| Comrades 1921-2019 | Kaggle suugaku/comrades-marathon-results | ~41 MB CSV | no |
| Boston 2015-17 w/ 5K splits | Kaggle rojour/boston-results | splits every 5K | no |
| Boston 2023, 2024 splits+weather | Kaggle mexwell, runningwithrock | splits, weather | no |
| Boston qualifiers / cutoff | Kaggle runningwithrock | results | no |
| Marathon-Results (top 100) | Kaggle frankcorrigan/marathonresults | small | no |

Repeat runners across races matter most (need athlete ID to build "past PRs -> future PR"):
NRCD and ultra-marathon have IDs; most marathon sets do not.

## B. Training data at scale (mileage model)
| Dataset | Source | Content |
|---|---|---|
| Long-distance running 2019-20 | Figshare 16620238 / Kaggle mexwell | 10.7M records, 36k athletes; distance, duration, age group, gender, country. NO HR/elevation |

## C. Training data with HR / elevation (small)
Kaggle: Cardio Activities (deependraverma13), PMData, Garmin Half-Marathon Training Log (zhannazemska),
Strava Activity Data (jairusmartinez), Strava Running Activity Data (ajitjadhav1), Strava data (purpleyupi, ~1.5k runs/200 runners),
Running Log Insight (jeffreybraun, CC0, 1 runner), Running and Heart Rate Data (mcandocia).
GitHub: firefly-cpp/sports-activity-dataset-collections (GPX/TCX).
arXiv 2509.05961 (12 anonymous runners public logs).

## D. Paired training -> race
Kaggle girardi69/marathon-time-predictions (CC0, Garmin/Strava, 2 variables, finish time binned into 4 groups).
Nothing else found. Team data is the only rich paired set.

## Access
Kaggle needs an API token (kaggle.json). Not installed, no token on this machine.

## Provenance record (downloaded 2026-10-20/21, into the session scratchpad; none is in the repo)
| File | Source | Licence | sha256 |
|---|---|---|---|
| nrcd.zip (NRCD v2.1.0) | https://zenodo.org/records/22077479 | CC-BY-4.0 | 23d773929d4c75f3fc9d8b94b88a83606bd2f6fe2228fa9938610527fea87487 |
| unbiased.csv, unbiased_clean.csv (Power of 10 cleaned) | Kaggle `goprogram/thepowerof10` | unknown, not redistributable | 321b990c...7305, 90866f67...d454 |
| raw_data.csv, 848 MB (Power of 10 raw; no ages, dates or ids) | same | unknown, not redistributable | da8cf89f6bfb56b9c1089c8d07c7275020470b9820a771b06304537447ecea2d |
| 7 small Kaggle sets (high-school times, cardio-activities, Garmin half log, running-log-insight, two Strava sets, marathon-time-predictions) | Kaggle | high-school set CC0 and running-log-insight CC0 (earlier listing); the rest unverified (CLI metadata returned nothing) | per file in the scratchpad |

Everything the experiments need after deletion is in `rows4.pkl`/`results4.pkl` (derived from NRCD) and the exported Lite model; re-download links above rebuild the rest.

## Update 2026-10-22: second scour
| Dataset | Status | Notes |
|---|---|---|
| BMClab long-distance running 2019-20 (Figshare 16620238) | USED (exp12) | CC BY 4.0, daily files 154 MB each; athletes list the majors they ran, so marathon days are found by rule. 2019 daily sha256 0445cd42281d7c8710552239e3f721dae48d8d77b99bc98fb7a8530a2bc8c740, 2020 daily e635707a3390886be03955803fefb9b3f28296706e69ab286f5c583d1eebe429. No heart rate. |
| FitRec / Endomondo (UCSD McAuley lab) | USED via Kaggle mirror tientd95/fitrec-dataset (exp: fitrec_hr_check) | Heart rate + speed + altitude + weather, 1,104 users / 253k workouts, academic use only, no redistribution. The Google Drive links returned 404 from the command line; needs a manual download. Would allow `hr_check.py` across ~1,000 runners instead of 4. |
| GoldenCheetah OpenData (OSF 6hfpz, GitHub GoldenCheetah/OpenData) | NOT CHECKED | Per-second HR, cadence, power, distance, altitude, no GPS; mostly cyclists. Run share unknown. |
| KIRun | NOT CHECKED | 48 outdoor runners with heart rate, no race results. |
| Hawks app data (4 athletes with synced workouts, 840 runs, 1 race) | USED for constants only | Private (minors); never leaves the local machine; no race targets, so it cannot train or score a race model. |
| PARROTAO (arXiv 2508.21785) | NOT VERIFIED | 42,576 sessions from 113 recreational athletes (Coros, Garmin, Huawei, 2022-2025), heart rate. The arXiv page states no data release. |
| Multi-athlete FIT study (UB thesis, hdl.handle.net/2445/230452) | NOT VERIFIED | 8,246 sessions from 102 athletes (MyAlbatross platform); thesis PDF only, no dataset link seen. |
| Multi-sensor running dataset (Univ. of Twente) | NOT CHECKED | 12 runners, 3 sessions each, IMU + HR + GPS. Too small to matter. |
| FitRec on Kaggle (chiragksharma/fitrec-datasets) | NOT CHECKED | Mirror of the UCSD data; Kaggle login needed; same academic-use-only terms. |
| parkrun | NO PUBLIC DATASET FOUND | Only scrapers; check parkrun's terms before any bulk collection. |

### Hawks meet days (2026-10-22, anonymised)
Of 12 fall-2026 meet dates with synced runs, 11 athlete-days have a high-effort run (top-decile effort or heart-rate effort, or tagged race); about 7 look like real races (2.4-3.2 mi at 5.3-6.5 min/mi, one 5 mi). The app's `category` is unreliable on those days
(races tagged easy or workout, one 4.9 min/mi run tagged easy). Spring 2026 and indoor 2026 dates (City: Feb 21 and May 24; Bronx boro May 10) have almost no synced runs because syncing started late for most athletes.
Seven efforts from 4 athletes cannot fine-tune or score a model; they are the seed of the prediction log. Script: `scripts/hawks_meet_days.py`.

FitRec was downloaded with the user's Kaggle token (2.0 GB zip, 6.6 GB json), reduced to a 20,722-row run table with `fitrec_summarize.py`, and the raw files deleted. The table stays local (academic use only, no redistribution).
Also seen and not used: London Marathon 2018-23 (Zenodo 10960982) and Marathon Data 2000-2019 (Zenodo 6959864) are marathon-only and keyed by runner name, so linking repeat runners would mean identifying people by name.
