-- Free-text fields the coach fills in around a meet: what to bring
-- beforehand, and results/placements logged afterward. Both optional,
-- both just displayed on the Meets tab when present.
ALTER TABLE events ADD COLUMN checklist TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN results TEXT DEFAULT '';

-- Coordinates for the Meets tab's weather snippet (Open-Meteo, keyless).
-- Nullable: a location without coordinates just skips the weather card.
ALTER TABLE locations ADD COLUMN lat REAL;
ALTER TABLE locations ADD COLUMN lng REAL;

-- Resolved via Open-Meteo's geocoding API (keyless) against each venue's
-- park name; Central Park Reservoir/Great Hill and Prospect Park's exact
-- geocoder entries were unreliable, so those three use the well-documented
-- public centroid of the park they're in instead — plenty precise for a
-- same-day weather snippet.
UPDATE locations SET lat = 40.89788, lng = -73.88347 WHERE id = 'loc_vc_tortoise_hare';
UPDATE locations SET lat = 40.89788, lng = -73.88347 WHERE id = 'loc_vc_track';
UPDATE locations SET lat = 40.82556, lng = -73.95667 WHERE id = 'loc_riverbank';
UPDATE locations SET lat = 40.72121, lng = -73.95208 WHERE id = 'loc_mccarren';
UPDATE locations SET lat = 40.78232, lng = -73.96542 WHERE id = 'loc_cp_reservoir';
UPDATE locations SET lat = 40.78232, lng = -73.96542 WHERE id = 'loc_cp_great_hill';
UPDATE locations SET lat = 40.73594, lng = -73.76874 WHERE id = 'loc_cunningham';
UPDATE locations SET lat = 40.66020, lng = -73.96900 WHERE id = 'loc_prospect';
