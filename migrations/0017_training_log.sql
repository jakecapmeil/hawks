-- Daily training log (one row per person per day), like the XC Coach Log in
-- Notion. Miles and run count come from logged Strava workouts when there are
-- any; manual_miles/runs cover days logged by hand.
CREATE TABLE IF NOT EXISTS training_days (
  person_id    TEXT NOT NULL,
  date         TEXT NOT NULL,
  manual_miles REAL,
  minutes      REAL,
  runs         INTEGER,
  difficulty   INTEGER,               -- 1-10, how hard the day felt
  types        TEXT DEFAULT '[]',     -- JSON array, e.g. ["easy","strides"]
  status       TEXT DEFAULT '',       -- as_planned, harder, easier, missed, adjusted, rest
  planned      TEXT DEFAULT '',
  library_id   TEXT DEFAULT '',       -- workout library id when a library session was run
  splits       TEXT DEFAULT '',       -- rep splits, e.g. "6:47, 6:33, 6:24, 5:57"
  summary      TEXT DEFAULT '',       -- what actually happened
  coach_note   TEXT DEFAULT '',       -- what was changed and why
  load_note    TEXT DEFAULT '',       -- rolling read on the last 7-10 days
  feel         INTEGER,               -- 1-5
  sleep_hours  REAL,
  strength     INTEGER DEFAULT 0,
  notes        TEXT DEFAULT '',
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (person_id, date),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
ALTER TABLE workouts ADD COLUMN library_id TEXT DEFAULT '';
-- Current 5K fitness (mm:ss), drives the workout library's pace table.
ALTER TABLE people ADD COLUMN five_k_time TEXT DEFAULT '';
