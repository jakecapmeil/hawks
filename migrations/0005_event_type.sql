-- Event category (practice / meet / other), used to color-code events on the calendar
ALTER TABLE events ADD COLUMN type TEXT NOT NULL DEFAULT 'practice' CHECK (type IN ('practice','meet','other'));
