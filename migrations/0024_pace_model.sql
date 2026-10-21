-- intervals.icu's critical speed model of the runner's pace curve (CS in
-- m/s, D' in meters, fit r2), refreshed each sync. Fitness States use it for
-- 1600-5K when the fit is good.
CREATE TABLE IF NOT EXISTS pace_models (
  person_id  TEXT PRIMARY KEY,
  cs         REAL NOT NULL,
  d_prime    REAL NOT NULL,
  r2         REAL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
