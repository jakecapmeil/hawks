-- Hawky runs the plan day to day. The coach's plan stays the base; a
-- plan_changes row replaces one day (the latest active row per date wins).
-- source: 'hawky' (chat), 'auto' (readiness rules), 'athlete' (kept the plan).
CREATE TABLE IF NOT EXISTS plan_changes (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,          -- Easy, Workout, Long run, Race, Shakeout, Cross-train, Off
  miles      REAL,
  detail     TEXT DEFAULT '',
  reason     TEXT DEFAULT '',
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_changes_person_date ON plan_changes(person_id, date);

-- Plan level moves (rank 1-6 = 30-60 mpw). Hawky levels a runner up only
-- through the readiness gates in src/hawky.js, never more than two levels
-- above coach_rank (the rank the coach chose), and the coach sees every move.
CREATE TABLE IF NOT EXISTS level_changes (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL,
  from_rank  INTEGER,
  to_rank    INTEGER,
  reason     TEXT DEFAULT '',
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
ALTER TABLE people ADD COLUMN coach_rank INTEGER;
UPDATE people SET coach_rank = plan_rank WHERE plan_rank IS NOT NULL;

-- Daily wellness from the watch through intervals.icu (Garmin sends resting
-- HR, HRV and sleep when the runner wears it overnight).
CREATE TABLE IF NOT EXISTS wellness (
  person_id   TEXT NOT NULL,
  date        TEXT NOT NULL,
  resting_hr  REAL,
  hrv         REAL,
  sleep_hours REAL,
  sleep_score REAL,
  PRIMARY KEY (person_id, date),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- When a body mark or health status was last set. Only recent ones (body
-- marks within 7 days, sick/injured within 14) change the plan by themselves;
-- older ones are something Hawky asks about. Existing rows stay NULL (old).
ALTER TABLE body_marks ADD COLUMN updated_at INTEGER;
ALTER TABLE people ADD COLUMN health_updated_at INTEGER;
