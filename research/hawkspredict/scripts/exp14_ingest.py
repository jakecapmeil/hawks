"""Two new real-result sources -> results4-style tables (no names are kept).
  results_ont.pkl   Ontario / Windsor-Essex high-school championship finalists 2013-2026, 100-3000 m
                    (Mendeley Data 7rxh2z7vrc, CC BY 4.0). Real teenagers: the closest data we have to the Hawks.
  results_elite.pkl dated personal-progress marks of 8,381 elite runners, 100-10000 m
                    (Kaggle beridzeg45/runners-dataset, scraped from alltime-athletics.com lists; licence 'other').
Usage: exp14_ingest.py <scratch dir> <ds dir>   (<ds dir> holds mendeley_youth/speed.csv and runners-dataset/runners.csv)
The Ontario runners are split in half once (seed below); the holdout half is never trained on and is the high-school test."""
import sys
import numpy as np, pandas as pd

S, DS = sys.argv[1], sys.argv[2]
SEED = 20261022
COLS = ['athlete_id', 'male', 'date', 'surf', 'm', 'sec', 'altitude', 'temperature', 'elev_km', 'meet_id', 'series_id', 'event_name']

def robust_keep(df, by):
    """Drop times more than 5 robust SDs (of log time) from the median of their event and sex: typos, DQs, walkers."""
    lt = np.log(df.sec)
    med = lt.groupby([df[c] for c in by]).transform('median')
    mad = (lt - med).abs().groupby([df[c] for c in by]).transform('median') * 1.4826
    return df[(lt - med).abs() <= 5 * mad]

# ---- Ontario high school ----
d = pd.read_csv(f'{DS}/mendeley_youth/speed.csv', encoding='latin-1',
                usecols=['Competition', 'Year', 'Day', 'Temp_Celsius', 'Humidity', 'Wind', 'Gender', 'Event', 'Category', 'Time_Sec', 'RunnerID'])
d = d.dropna(subset=['Time_Sec', 'RunnerID', 'Day'])
n0 = len(d)
bad = set(d.groupby('RunnerID').Gender.nunique().loc[lambda s: s > 1].index)          # RunnerID is keyed by name: two people share an ID
bad |= set(d.groupby(['RunnerID', 'Year', 'Competition', 'Event']).size().loc[lambda s: s > 1].reset_index().RunnerID)
d = d[~d.RunnerID.isin(bad)].copy()
d['sec'] = d.Time_Sec.astype(float); d['male'] = (d.Gender == 'Men').astype(int); d['m'] = d.Event.astype(float)
d = robust_keep(d, ['m', 'male'])
base = pd.to_datetime(d.Year.astype(int).astype(str) + '-05-10') + pd.to_timedelta(np.where(d.Competition == 'OFSAA', 21, 0) + d.Day.astype(int), unit='D')
o = pd.DataFrame({'athlete_id': 10_000_000 + d.RunnerID.astype(int), 'male': d.male, 'date': base, 'surf': 'track', 'm': d.m, 'sec': d.sec,
                  'altitude': np.nan, 'temperature': d.Temp_Celsius * 9 / 5 + 32, 'elev_km': np.nan,
                  'meet_id': 10_000 + d.Year.astype(int) * 2 + (d.Competition == 'OFSAA').astype(int), 'series_id': np.nan,
                  'event_name': d.Event.astype(str) + 'm', 'category': d.Category, 'humidity': pd.to_numeric(d.Humidity, errors='coerce'), 'wind': pd.to_numeric(d.Wind, errors='coerce')})
o = o.sort_values(['athlete_id', 'date', 'm']).drop_duplicates(['athlete_id', 'date', 'm']).reset_index(drop=True)
ids = np.sort(o.athlete_id.unique()); rng = np.random.default_rng(SEED)
hold = set(rng.choice(ids, len(ids) // 2, replace=False)); o['holdout'] = o.athlete_id.isin(hold)
o.to_pickle(f'{S}/results_ont.pkl')
print(f'Ontario: {n0} rows -> {len(o)} kept; {o.athlete_id.nunique()} runners ({len(hold)} holdout); dropped {len(bad)} colliding runner ids')
print('  by event:', o.m.value_counts().sort_index().astype(int).to_dict(), '| runners with 2+ events:', int((o.groupby('athlete_id').m.nunique() >= 2).sum()))

# ---- elite dated marks ----
e = pd.read_csv(f'{DS}/runners-dataset/runners.csv')
e['m'] = e.Discipline.str.extract(r'(\d+)')[0].astype(float)
def secs(t):
    try: return float(t)
    except (TypeError, ValueError):
        s = 0.0
        for x in str(t).split(':'): s = s * 60 + float(x)
        return s
e['sec'] = e.Time.map(lambda t: secs(t) if pd.notna(t) else np.nan)
e['date'] = pd.to_datetime(e.Date, errors='coerce'); e = e.dropna(subset=['sec', 'date', 'Runner'])
e['male'] = (e.Gender == 'men').astype(int)
e = robust_keep(e, ['m', 'male'])
e['athlete_id'] = 20_000_000 + pd.factorize(e.Runner + '|' + e.Gender)[0]                # name used only to link marks; not kept
el = pd.DataFrame({'athlete_id': e.athlete_id, 'male': e.male, 'date': e.date, 'surf': 'track', 'm': e.m, 'sec': e.sec, 'altitude': np.nan,
                   'temperature': np.nan, 'elev_km': np.nan, 'meet_id': -1, 'series_id': np.nan, 'event_name': e.Discipline})
el = el.sort_values(['athlete_id', 'date', 'm']).drop_duplicates(['athlete_id', 'date', 'm']).reset_index(drop=True)
el.to_pickle(f'{S}/results_elite.pkl')
print(f'Elite: {len(el)} marks, {el.athlete_id.nunique()} athletes, dates {el.date.min().date()} to {el.date.max().date()}; '
      f'athletes with 2+ dated marks: {int((el.groupby("athlete_id").size() >= 2).sum())}')
print('  by event:', el.m.value_counts().sort_index().astype(int).to_dict())
