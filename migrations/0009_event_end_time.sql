-- Events can optionally carry an end time alongside their start time.
ALTER TABLE events ADD COLUMN end_time TEXT DEFAULT '';
