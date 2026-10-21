-- Conditions behind each run: air temperature and dew point at the time of
-- the run (Open-Meteo, NYC), so heat and hills count in difficulty and in
-- Fitness States. weather_checked = 1 once a reading was found.
-- hr_effort is the heart-rate-only effort (1-10) used for plan matching;
-- effort is the difficulty shown to runners (heart rate plus heat and hills).
-- metrics holds display-only numbers from the watch (JSON: grade-adjusted
-- pace, decoupling, HR zones, stride, calories, ...).
ALTER TABLE workouts ADD COLUMN temp_f REAL;
ALTER TABLE workouts ADD COLUMN dew_point_f REAL;
ALTER TABLE workouts ADD COLUMN weather_checked INTEGER DEFAULT 0;
ALTER TABLE workouts ADD COLUMN hr_effort INTEGER;
ALTER TABLE workouts ADD COLUMN metrics TEXT DEFAULT '';
-- Fitness States are worked out again with the new course and weather
-- credits on the next read.
UPDATE fitness_states SET computed_at = 0;
