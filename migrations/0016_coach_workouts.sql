-- Claude Coach: each person's own Claude reads their Strava through the Strava
-- connector, rates each run against their plan, and writes it here through
-- the per-person coach MCP endpoint (/mcp/coach/<coach_token>).
ALTER TABLE people ADD COLUMN coach_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_coach_token ON people(coach_token);

CREATE TABLE IF NOT EXISTS workouts (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL,
  strava_id    TEXT NOT NULL,
  date         TEXT NOT NULL,            -- YYYY-MM-DD, local start date
  name         TEXT DEFAULT '',
  sport        TEXT DEFAULT 'Run',
  category     TEXT NOT NULL,            -- easy, recovery, long, workout, race, shakeout, crosstrain
  distance_mi  REAL,
  moving_sec   INTEGER,
  elapsed_sec  INTEGER,
  avg_hr       INTEGER,
  max_hr       INTEGER,
  avg_cadence  INTEGER,
  elev_gain_ft INTEGER,
  planned_type  TEXT DEFAULT '',
  planned_miles REAL,
  effort       INTEGER,                  -- 1-10 difficulty
  plan_score   INTEGER,                  -- 0-100 how well it matched the plan
  load         INTEGER,                  -- training load points (see COACH_RUBRIC)
  rating       TEXT DEFAULT '',          -- A, B, C, D, F
  summary      TEXT DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (person_id, strava_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workouts_person_date ON workouts(person_id, date);
