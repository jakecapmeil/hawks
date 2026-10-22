-- Fitness States now come from HawksPredict-Lite (race results -> every event, with a range).
-- Cached estimates are worked out again on the next read.
UPDATE fitness_states SET computed_at = 0;
