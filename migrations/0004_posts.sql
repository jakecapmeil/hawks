-- Team posts (announcements). person_id intentionally has no foreign key:
-- posts can be authored by a real roster person OR the reserved 'coach'
-- pseudo-person, which is never stored in the people table.
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  person_id  TEXT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
