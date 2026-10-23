-- HawksPredict-Short adds 100, 200, 600, 1000 and steeple estimates to Fitness States: recompute everyone on next read.
UPDATE fitness_states SET computed_at = 0;
