-- HawksPredict-Marathon: a Marathon row (Edit mode) from the last 16 weeks of training. Recompute every cached fitness state.
UPDATE fitness_states SET computed_at = 0;
