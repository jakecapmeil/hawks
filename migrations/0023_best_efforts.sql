-- Garmin's own VO2max (from the watch's FIT data) and intervals.icu's
-- fitness (CTL, 42-day load) and fatigue (ATL, 7-day load), from wellness.
ALTER TABLE wellness ADD COLUMN vo2max REAL;
ALTER TABLE wellness ADD COLUMN ctl REAL;
ALTER TABLE wellness ADD COLUMN atl REAL;

-- Fastest efforts at standard distances inside any run (intervals.icu's pace
-- curve over the last year), refreshed on every sync. Fitness States and the
-- PR search read these alongside whole runs.
CREATE TABLE IF NOT EXISTS best_efforts (
  person_id   TEXT NOT NULL,
  meters      INTEGER NOT NULL,
  sec         REAL NOT NULL,
  date        TEXT,
  activity_id TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (person_id, meters),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
