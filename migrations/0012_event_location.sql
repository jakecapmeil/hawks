-- Free-text location per event (e.g. "Van Cortlandt Park" or a full address),
-- so events can carry a place without forcing a match to the locations table.
ALTER TABLE events ADD COLUMN location TEXT DEFAULT '';
