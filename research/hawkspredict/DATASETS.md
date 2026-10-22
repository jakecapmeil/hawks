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
