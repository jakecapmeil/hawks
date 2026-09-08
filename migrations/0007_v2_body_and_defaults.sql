-- V2: global always/never-free default per person, health/training status, body map marks

ALTER TABLE people ADD COLUMN default_status TEXT NOT NULL DEFAULT 'available' CHECK (default_status IN ('available','unavailable'));
ALTER TABLE people ADD COLUMN health_status TEXT NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy','injured','sick'));
ALTER TABLE people ADD COLUMN training_status TEXT NOT NULL DEFAULT 'resting' CHECK (training_status IN ('resting','running','crosstraining'));

-- Explicit per-day exceptions to a person's default_status (replaces away_days,
-- which only ever meant "unavailable"; now an override can go either direction).
CREATE TABLE IF NOT EXISTS availability_overrides (
  person_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('available','unavailable')),
  PRIMARY KEY (person_id, date),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

INSERT INTO availability_overrides (person_id, date, status)
  SELECT person_id, date, 'unavailable' FROM away_days;

DROP TABLE away_days;

-- Per-body-part soreness/pain markers ("grey" = no row = fine)
CREATE TABLE IF NOT EXISTS body_marks (
  person_id TEXT NOT NULL,
  part      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('sore','pain')),
  PRIMARY KEY (person_id, part),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- health_status is single-valued, but the old person_tags let someone have
-- both 'sick' and 'injured' checked at once. That combination can't survive
-- the move to a single status, so this is an intentional, documented choice
-- rather than an accidental order-dependent overwrite: injured wins, since
-- it's typically the status that needs more explicit coach follow-up.
UPDATE people SET health_status = 'sick' WHERE id IN (SELECT person_id FROM person_tags WHERE tag = 'sick');
UPDATE people SET health_status = 'injured' WHERE id IN (SELECT person_id FROM person_tags WHERE tag = 'injured');
UPDATE people SET training_status = 'crosstraining' WHERE id IN (SELECT person_id FROM person_tags WHERE tag = 'cross_training');

DROP TABLE person_tags;
