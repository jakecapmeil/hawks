-- Roster of people using the calendar
CREATE TABLE IF NOT EXISTS people (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT ''
);

-- Dates a person has marked themselves unavailable
CREATE TABLE IF NOT EXISTS away_days (
  person_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  PRIMARY KEY (person_id, date),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Per-person notes on a given day
CREATE TABLE IF NOT EXISTS comments (
  date      TEXT NOT NULL,
  person_id TEXT NOT NULL,
  text      TEXT NOT NULL,
  PRIMARY KEY (date, person_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Calendar events
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  time        TEXT DEFAULT '',
  description TEXT DEFAULT ''
);

-- Per-person RSVP status for an event ('unknown' is represented by no row)
CREATE TABLE IF NOT EXISTS rsvps (
  event_id  TEXT NOT NULL,
  person_id TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('available','unavailable')),
  PRIMARY KEY (event_id, person_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
