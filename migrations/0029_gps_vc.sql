-- Whether a run's GPS start was inside Van Cortlandt Park: 1 yes, 0 no,
-- NULL unknown (no GPS). Decides which runs get the Van Cortlandt course
-- adjustment, ahead of names, calendar and Hawky's guess.
ALTER TABLE workouts ADD COLUMN gps_vc INTEGER;
