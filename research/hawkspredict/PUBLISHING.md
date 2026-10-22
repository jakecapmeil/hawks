# What to publish (2026-10-21)

## Is a mega-dataset worth it?
**No, not as a raw merge.** Reasons:
- Only NRCD (CC-BY-4.0) and the high-school times set (CC0) can be redistributed with attribution. The Power of 10 licence is unknown and the data is
  scraped from a site whose terms I could not read (searches returned nothing for it); do not redistribute. Other Kaggle sets: licence unverified here (the CLI metadata call returned nothing); check each page.
- The pieces do not merge into one table: NRCD is race-to-race with athlete ids and dates; Power of 10 is anonymous lifetime bests; the Kaggle HR logs are five individual runners with no races paired to them.
  A merged file would be a folder of unrelated tables, which is a catalogue, not a dataset.
- Hunter data covers minors and never goes public.
- Model-generated data: not worth publishing as a dataset (it only echoes the model). Fine as a clearly labelled simulation inside the paper, never mixed into a test set.

## What is worth publishing: a benchmark ("HawksBench" placeholder)
People do like benchmarks more than big files, because they settle arguments. No dedicated running-time benchmark turned up in one search
(Blythe & Kiraly 2016 and Emig & Peltonen 2020 each use their own data; Dash et al. 2024 has a 15-runner set on GitHub). Verify before claiming a first.
Contents, all runnable from a README:
1. Loader that downloads NRCD from Zenodo and builds the examples (prior results -> next race), with frozen athlete-disjoint + last-season splits.
2. Metrics: percent error, athlete-clustered bootstrap, 80% interval coverage.
3. Baselines: Riegel, Cameron, VDOT, critical speed, low-rank completion, the two HawksPredict models.
4. The noise-floor analysis (about 3.3-3.4% on this data): the part most likely to be cited.
5. Optional adapters for Power of 10 (user downloads it themselves).

## Paper outline (two options)
- **A. "Most accurate for its size":** accuracy vs parameters (6.5k numbers: 3.97%; 280k: 3.76%; Research about 80k: 3.56%), against formulas, a perceptron, a transformer and CatBoost; noise floor shows little headroom.
  Venues to check: Journal of Sports Analytics, PLOS ONE (where Blythe & Kiraly appeared), Scientific Reports. Claim only what the splits support.
- **B. Benchmark + noise-floor note:** shorter, cleaner, depends less on beating anyone.
Both need: head-to-head against the original authors' code for the published methods, several splits (done for the PO10 prior test), a prospective test (the prediction log), and a bigger high-school test.

## GitHub
Repo with the loader, splits, baselines, results tables, `BRIEFING.md`, MIT or Apache-2.0 code, data under its own licences with download scripts. Model weights for Lite are tiny (66 KB gzipped) and fine to include.
