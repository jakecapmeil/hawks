-- Hidden training-plan ranking (1-6). Never sent to browsers: it is not part of
-- /api/state, and /api/plan returns only the plan itself. NULL = fall back to
-- the plan for the person's class year.
ALTER TABLE people ADD COLUMN plan_rank INTEGER;
