"""Load the single-runner HR logs into one frame: runner, date, km, sec, avg_hr, max_hr, elev_m."""
import pandas as pd, numpy as np, sys
K = sys.argv[1] if len(sys.argv) > 1 else 'kaggle_raw'
def hms(s):
    p = [float(x) for x in str(s).split(':')]
    if len(p)==1: return p[0]
    return p[0]*3600+p[1]*60+p[2] if len(p)==3 else p[0]*60+p[1]
out = []
c = pd.read_csv(f'{K}/cardio-activities/cardioActivities.csv'); c = c[c.Type=='Running']
out.append(pd.DataFrame(dict(runner='cardio', date=pd.to_datetime(c.Date).dt.normalize(), km=c['Distance (km)'], sec=c.Duration.map(hms), hr=c['Average Heart Rate (bpm)'], mx=np.nan, elev=c['Climb (m)'])))
g = pd.read_csv(f'{K}/garmin-activity-data-half-marathon-training-log/Activities_from_26_11_2024_to_04_05_2025.csv', encoding='utf-8-sig')
g = g[g['Activity Type']=='Running']; tcol = [x for x in g.columns if x.startswith('Time')]
out.append(pd.DataFrame(dict(runner='garmin', date=pd.to_datetime(g.Date, format='%d/%m/%Y'), km=g.Distance, sec=g[tcol[1]].map(hms), hr=pd.to_numeric(g['Avg HR'], errors='coerce'), mx=pd.to_numeric(g['Max HR'], errors='coerce'), elev=np.nan)))
r = pd.read_csv(f'{K}/running-log-insight/activity_log.csv'); r = r[r['Activity Type']=='Running']
out.append(pd.DataFrame(dict(runner='insight', date=pd.to_datetime(r.Date, format='%m/%d/%y %H:%M').dt.normalize(), km=pd.to_numeric(r.Distance.astype(str).str.replace(',',''),errors='coerce')*1.609344, sec=r.Time.map(hms), hr=pd.to_numeric(r['Avg HR'], errors='coerce'), mx=pd.to_numeric(r['Max HR'], errors='coerce'), elev=pd.to_numeric(r['Elev Gain'].astype(str).str.replace(',','').str.replace('--',''),errors='coerce')*0.3048)))
s = pd.read_csv(f'{K}/strava-data/strava_full_data.csv'); s = s[s.type=='Run']
out.append(pd.DataFrame(dict(runner='strava_full', date=pd.to_datetime(s.start_date_local).dt.normalize(), km=s.distance/1000, sec=s.moving_time.map(hms), hr=s.average_heartrate, mx=s.max_heartrate, elev=s.total_elevation_gain)))
s2 = pd.read_csv(f'{K}/strava-activity-data/strava_data.csv'); s2 = s2[s2.sport_type=='Run']
out.append(pd.DataFrame(dict(runner='strava_act', date=pd.to_datetime(s2.date).dt.normalize(), km=s2.distance, sec=s2.moving_time*60, hr=s2.average_heartrate, mx=np.nan, elev=s2.total_elevation_gain)))
D = pd.concat(out).dropna(subset=['km','sec']).query('km>0.8 and sec>200').sort_values(['runner','date']).reset_index(drop=True)
D['pace'] = D.sec/D.km
if __name__ == '__main__':
    print(D.groupby('runner').agg(n=('km','size'), hr_n=('hr','count'), first=('date','min'), last=('date','max'), km_med=('km','median')))
    # race-like: near standard distances & fast relative to runner's median pace
    STD = {5:5.0, 10:10.0, 21.0975:21.0975, 8:8.0, 3:3.0, 1.609:1.609, 3.2:3.2}
    for rn, d in D.groupby('runner'):
        med = d.pace.median(); n=0
        for _, x in d.iterrows():
            for k in STD:
                if abs(x.km/k-1)<0.03 and x.pace < med*0.88: n+=1; break
        print(rn, 'race-like (near std distance, >12% faster than median pace):', n)
