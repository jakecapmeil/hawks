-- Drop the "healthy" status tag; rebuild the table since SQLite can't ALTER a CHECK constraint
DELETE FROM person_tags WHERE tag = 'healthy';

CREATE TABLE person_tags_new (
  person_id TEXT NOT NULL,
  tag       TEXT NOT NULL CHECK (tag IN ('sick','injured','cross_training')),
  PRIMARY KEY (person_id, tag),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

INSERT INTO person_tags_new SELECT * FROM person_tags;
DROP TABLE person_tags;
ALTER TABLE person_tags_new RENAME TO person_tags;
