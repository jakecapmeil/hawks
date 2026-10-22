"""NRCD -> results4.pkl: individual running results with meet/series ids (fastest same-day result kept)."""
import glob, sys
import numpy as np, pandas as pd
RAW = glob.glob(sys.argv[1] + '/*/joined.csv')[0]
SER = glob.glob(sys.argv[1] + '/*/meet_series_member.csv')[0]
OUT = sys.argv[2]
METERS = {'400m': 400, '800m': 800, '1000m': 1000, '1500m': 1500, '1600m': 1600, 'Mile': 1609.34, '3000m': 3000, '3200m': 3200,
          '2 Mile': 3218.69, '5000m': 5000, '6000m': 6000, '8000m': 8000, '10000m': 10000, 'Half Marathon': 21097.5}
def parse(t):
    if not isinstance(t, str): return np.nan
    try: p = [float(x) for x in t.split(':')]
    except ValueError: return np.nan
    s = 0
    for x in p: s = s * 60 + x
    return s
df = pd.read_csv(RAW, low_memory=False, usecols=['sport_name', 'event_name', 'start_date', 'athlete_id', 'gender', 'result_time',
                 'relay_split', 'altitude', 'temperature', 'elevation_gain', 'estimated_course_distance', 'meet_id'])
df = df[df.relay_split.isna() & df.athlete_id.notna() & df.event_name.isin(METERS)]
df['m'] = df.event_name.map(METERS); df['sec'] = df.result_time.map(parse); df['date'] = pd.to_datetime(df.start_date)
df = df.dropna(subset=['sec', 'date']); v = df.m / df.sec; df = df[(v > 2.0) & (v < 10.5)]
df['surf'] = df.sport_name.map({'Cross Country': 'xc', 'Outdoor Track': 'track', 'Indoor Track': 'indoor', 'Road Race': 'road'})
df['athlete_id'] = df.athlete_id.astype(int); df['male'] = (df.gender == 'M').astype(int)
df = df.sort_values(['athlete_id', 'date', 'event_name', 'sec']).drop_duplicates(['athlete_id', 'date', 'event_name'], keep='first')
df['elev_km'] = df.elevation_gain / (df.estimated_course_distance / 1000)
ser = pd.read_csv(SER).drop_duplicates('meet_id')
df = df.merge(ser, on='meet_id', how='left')
df = df[['athlete_id', 'male', 'date', 'surf', 'm', 'sec', 'altitude', 'temperature', 'elev_km', 'meet_id', 'series_id', 'event_name']].reset_index(drop=True)
df.to_pickle(OUT)
print(len(df), 'results,', df.athlete_id.nunique(), 'athletes,', df.series_id.notna().mean().round(3), 'share with a meet series')
