-- intervals.icu link (Garmin/COROS -> intervals.icu -> Hawks). The API key is
-- AES-GCM encrypted (key derived from a Worker secret) and never sent to
-- browsers; /api/state does not select these columns.
ALTER TABLE people ADD COLUMN icu_athlete TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN icu_key_enc TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN icu_synced_at INTEGER;
ALTER TABLE people ADD COLUMN icu_status TEXT DEFAULT '';

-- Per-person daily cap on Gemini calls, so one person can't use up the
-- free-tier quota for the whole team.
CREATE TABLE IF NOT EXISTS ai_usage (
  person_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  calls     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, date)
);
