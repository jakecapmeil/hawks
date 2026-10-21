-- Fitness States: per-athlete race estimates (400 to half marathon), VO2max
-- estimate and recent mileage, recomputed after every sync or PR change.
-- `data` is the whole computed object (see src/fitness.js); history keeps one
-- row per day so the trend can be charted.
CREATE TABLE IF NOT EXISTS fitness_states (
  person_id   TEXT PRIMARY KEY,
  computed_at INTEGER NOT NULL,
  data        TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fitness_history (
  person_id  TEXT NOT NULL,
  date       TEXT NOT NULL,
  vdot       REAL,
  five_k_sec INTEGER,
  mpw        REAL,
  PRIMARY KEY (person_id, date),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Full-history import from intervals.icu runs in chunks, newest to oldest.
-- icu_import_cursor is the oldest date imported so far; done = 1 once the
-- start of the athlete's history is reached.
ALTER TABLE people ADD COLUMN icu_import_cursor TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN icu_import_done INTEGER DEFAULT 0;

-- Start time (local, HH:MM) groups warm-up / workout / cool-down activities
-- into one session; laps holds the work reps as JSON [{m, s, hr}].
ALTER TABLE workouts ADD COLUMN start_local TEXT DEFAULT '';
ALTER TABLE workouts ADD COLUMN laps TEXT DEFAULT '';

-- Track sessions: surface = 'track' snaps distances to the lines (reps to
-- 100 m, miles to eighths) and drops elevation. The GPS numbers are kept in
-- raw_* so the "On the track" toggle can be undone.
ALTER TABLE workouts ADD COLUMN surface TEXT DEFAULT '';
ALTER TABLE workouts ADD COLUMN raw_distance_mi REAL;
ALTER TABLE workouts ADD COLUMN raw_elev_ft INTEGER;
ALTER TABLE training_days ADD COLUMN surface TEXT DEFAULT '';

-- Structured splits (JSON [{m, s, rest}]) behind the split builder; the
-- `splits` text column is kept in sync for Hawky and older clients.
-- day_line is Hawky's one-line summary of the whole day.
ALTER TABLE training_days ADD COLUMN split_reps TEXT DEFAULT '';
ALTER TABLE training_days ADD COLUMN day_line TEXT DEFAULT '';

-- When the self-entered "current 5K" was set, so it ages like any other result.
ALTER TABLE people ADD COLUMN five_k_set_at INTEGER;
