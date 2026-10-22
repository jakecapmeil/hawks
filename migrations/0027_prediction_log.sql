-- HawksPredict race predictions, logged so real results can score the model.
-- The first prediction for a (person, event, race date, model) is kept: later
-- views never overwrite it (INSERT OR IGNORE), so scoring cannot leak.
-- raw_* is the model as trained (HawksPredict-Lite); adj_* adds the exploratory
-- heart-rate fitness adjustment, so the log shows whether that layer helps.
CREATE TABLE IF NOT EXISTS prediction_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   TEXT NOT NULL,
  event       TEXT NOT NULL,
  race_date   TEXT NOT NULL,
  model       TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  raw_sec     REAL NOT NULL,
  raw_lo      REAL NOT NULL,
  raw_hi      REAL NOT NULL,
  adj_sec     REAL,
  adj_lo      REAL,
  adj_hi      REAL,
  hr_delta    REAL,
  created_at  INTEGER NOT NULL,
  actual_sec  REAL,
  UNIQUE (person_id, event, race_date, model),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
