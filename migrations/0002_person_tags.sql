-- Health/training status tags a person has set for themselves
CREATE TABLE IF NOT EXISTS person_tags (
  person_id TEXT NOT NULL,
  tag       TEXT NOT NULL CHECK (tag IN ('healthy','sick','injured','cross_training')),
  PRIMARY KEY (person_id, tag),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
