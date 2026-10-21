-- Which course a run was on, as Hawky read it from the run and that day's
-- calendar: 'vc' (Van Cortlandt), 'xc' (another cross-country course),
-- 'flat' (road, track, anywhere flat) or '' (not read: the rules decide).
ALTER TABLE workouts ADD COLUMN course TEXT DEFAULT '';
-- Fitness States and PRs are worked out again on the next read.
UPDATE fitness_states SET computed_at = 0;
