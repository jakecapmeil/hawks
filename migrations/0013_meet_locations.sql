-- Links a calendar event to a known location, so the Meets tab can look up
-- travel-time estimates and computed distance without re-parsing free-text
-- location strings. Nullable: events can still carry only a free-text label.
ALTER TABLE events ADD COLUMN location_id TEXT REFERENCES locations(id);

-- Cached driving distance from a person's home to a location, computed via
-- Google Distance Matrix on demand (not seeded, and not free, hence caching).
-- Keyed on the origin address too so a stale row is detected and recomputed
-- if someone updates their home address, rather than silently reused.
CREATE TABLE IF NOT EXISTS distance_cache (
  person_id      TEXT NOT NULL,
  location_id    TEXT NOT NULL,
  origin_address TEXT NOT NULL,
  miles          REAL NOT NULL,
  drive_minutes  INTEGER,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (person_id, location_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- Backfill location_id for the meets currently on the calendar whose
-- location/description text clearly names one of the seeded venues (the
-- coach's own text). New meets get linked going forward via the admin form.
UPDATE events SET location_id = 'loc_vc_tortoise_hare'
  WHERE id IN ('e_m26_0919_regis', 'e_m26_0922_gp2_bxmn');
UPDATE events SET location_id = 'loc_vc_track'
  WHERE id IN ('e_m26_0926_group_run', 'e_m26_0928_gp3_bxmn', 'e_m26_1003_marty_lewis',
               'e_m26_1005_gp4_bxmn', 'e_m26_1013_fs_boro', 'e_m26_1019_gp5_bxmn',
               'e_m26_1024_boro_champs', 'e_m26_1031_fs_city', 'e_m26_1107_city_champs');
