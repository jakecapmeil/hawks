-- Personal records, JSON: {"1600": {"time": "5:12", "date": "2026-05-07", "meet": "..."}, ...}
ALTER TABLE people ADD COLUMN prs TEXT DEFAULT '{}';
