-- Personal tab: extended contact/school fields per person, plus locations
-- and approximate travel-time estimates used for "getting there" planning.

ALTER TABLE people ADD COLUMN first_name    TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN class_year    TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN track_id      TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN date_entered  TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN borough       TEXT DEFAULT '';
ALTER TABLE people ADD COLUMN home_address  TEXT DEFAULT '';
-- School period a person is out of class each weekday (6-11ish); NULL = unknown/not out early.
ALTER TABLE people ADD COLUMN out_mon INTEGER;
ALTER TABLE people ADD COLUMN out_tue INTEGER;
ALTER TABLE people ADD COLUMN out_wed INTEGER;
ALTER TABLE people ADD COLUMN out_thu INTEGER;
ALTER TABLE people ADD COLUMN out_fri INTEGER;
ALTER TABLE people ADD COLUMN personal_notes TEXT DEFAULT '';

-- Practice and meet locations. Two Van Cortlandt rows on purpose: the XC
-- course (Tortoise and the Hare) and the track & field meeting point are
-- different spots in the same park.
CREATE TABLE IF NOT EXISTS locations (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  address TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('practice','meet'))
);

-- Approximate one-way travel time from a person's home to a location, split
-- by daypart since weekday-afternoon transit differs a lot from weekend-morning.
-- Rows are seed estimates the coach or athlete can correct by hand later.
CREATE TABLE IF NOT EXISTS travel_estimates (
  person_id   TEXT NOT NULL,
  location_id TEXT NOT NULL,
  daypart     TEXT NOT NULL CHECK (daypart IN ('weekday_practice','weekend_meet')),
  minutes     INTEGER NOT NULL,
  note        TEXT DEFAULT '',
  PRIMARY KEY (person_id, location_id, daypart),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO locations (id, name, address, kind) VALUES
  ('loc_vc_tortoise_hare', 'Van Cortlandt Park (Tortoise & Hare course)', 'Broadway & W 240th St, Bronx, NY 10463', 'practice'),
  ('loc_vc_track',         'Van Cortlandt Park - Track & Field',          'Van Cortlandt Park Track, Bronx, NY 10471', 'meet'),
  ('loc_riverbank',        'Riverbank State Park Track',                  '679 Riverside Dr, New York, NY 10031', 'practice'),
  ('loc_mccarren',         'McCarren Park',                               '776 Lorimer St, Brooklyn, NY 11222', 'practice'),
  ('loc_cp_reservoir',     'Central Park Reservoir',                      'Central Park Reservoir, New York, NY 10024', 'practice'),
  ('loc_cp_great_hill',    'Central Park Great Hill',                     'Great Hill, Central Park, New York, NY 10025', 'practice'),
  ('loc_cunningham',       'Cunningham Park (Queens)',                    '196-20 Union Tpke, Fresh Meadows, NY 11366', 'meet'),
  ('loc_prospect',         'Prospect Park (Brooklyn)',                    'Prospect Park, Brooklyn, NY 11215', 'meet');
