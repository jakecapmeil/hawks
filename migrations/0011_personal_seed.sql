-- Seed personal info + travel estimates for the 5 roster members whose home
-- address is currently known (from the coach's roster sheet). Matched by
-- real D1 person id, not by name text. Everyone else stays blank until they
-- (or the coach) fill in their own Personal tab.

UPDATE people SET
  first_name = 'Jake', class_year = 'Junior', track_id = '6322', date_entered = '2026-09-10',
  borough = 'Brooklyn', home_address = '88 1st Place #1F, Brooklyn, NY 11231',
  out_mon = 7, out_tue = 9, out_wed = 7, out_thu = 7, out_fri = 7,
  personal_notes = 'Captain - runs comms for practices/meet entries'
WHERE id = 'p_1786158555950_476'; -- Jake Capmeil

UPDATE people SET
  first_name = 'Jasper', class_year = 'Senior', track_id = '6321', date_entered = '2026-09-10',
  borough = 'Manhattan', home_address = '50 Park Terrace East 8L, New York, NY 10034',
  out_mon = 9, out_tue = 7, out_wed = 7, out_thu = 9, out_fri = 7,
  personal_notes = 'Captain'
WHERE id = 'p_1786200993531_26'; -- Jasper Graham

UPDATE people SET
  first_name = 'Lucien', class_year = 'Junior', track_id = '6328', date_entered = '2026-09-10',
  borough = 'Manhattan', home_address = '105 W 122nd St, New York, NY 10027',
  out_mon = 11, out_tue = 7, out_wed = 11, out_thu = 8, out_fri = 7,
  personal_notes = 'Captain ("Lulu"). 11th pd OCC = 3:30-5:20 M/W; also has a 9th pd class. Excused Mon+Wed per coach'
WHERE id = 'p_1786158900687_594'; -- Lucien Jaccon

UPDATE people SET
  first_name = 'Miles', class_year = 'Sophomore', track_id = '', date_entered = '2026-09-15',
  borough = 'Manhattan', home_address = '242 E 19th St # 8A, New York, NY 10003',
  out_mon = 9, out_tue = 9, out_wed = 9, out_thu = 8, out_fri = 9,
  personal_notes = '1st pd free every day except Fri (orchestra). Matches the unnamed Strings PF schedule screenshot'
WHERE id = 'p_1786208621328_621'; -- Miles Wu

UPDATE people SET
  first_name = 'Lowen', class_year = 'Junior', track_id = '6320', date_entered = '2026-09-07',
  borough = 'Manhattan', home_address = '1465 Park Ave, New York, NY 10029',
  out_mon = 9, out_tue = 7, out_wed = 9, out_thu = 7, out_fri = 9,
  personal_notes = 'Captain. 5K Challenge class Wed until 3:30'
WHERE id = 'p_1787847256351_308'; -- Lowen Zuo

-- Approximate one-way transit minutes, reasoned from NYC subway/bus geography
-- (not a live Maps lookup). Coach or athlete can correct any of these later
-- from the Personal tab without a migration.
INSERT OR IGNORE INTO travel_estimates (person_id, location_id, daypart, minutes) VALUES
  -- Jake Capmeil (Carroll Gardens, Brooklyn)
  ('p_1786158555950_476', 'loc_vc_tortoise_hare', 'weekday_practice', 80), ('p_1786158555950_476', 'loc_vc_tortoise_hare', 'weekend_meet', 90),
  ('p_1786158555950_476', 'loc_vc_track',         'weekday_practice', 80), ('p_1786158555950_476', 'loc_vc_track',         'weekend_meet', 90),
  ('p_1786158555950_476', 'loc_riverbank',        'weekday_practice', 65), ('p_1786158555950_476', 'loc_riverbank',        'weekend_meet', 75),
  ('p_1786158555950_476', 'loc_mccarren',         'weekday_practice', 30), ('p_1786158555950_476', 'loc_mccarren',         'weekend_meet', 45),
  ('p_1786158555950_476', 'loc_cp_reservoir',     'weekday_practice', 50), ('p_1786158555950_476', 'loc_cp_reservoir',     'weekend_meet', 60),
  ('p_1786158555950_476', 'loc_cp_great_hill',    'weekday_practice', 55), ('p_1786158555950_476', 'loc_cp_great_hill',    'weekend_meet', 65),
  ('p_1786158555950_476', 'loc_cunningham',       'weekday_practice', 80), ('p_1786158555950_476', 'loc_cunningham',       'weekend_meet', 95),
  ('p_1786158555950_476', 'loc_prospect',         'weekday_practice', 18), ('p_1786158555950_476', 'loc_prospect',         'weekend_meet', 22),

  -- Jasper Graham (Inwood, Manhattan)
  ('p_1786200993531_26', 'loc_vc_tortoise_hare', 'weekday_practice', 22), ('p_1786200993531_26', 'loc_vc_tortoise_hare', 'weekend_meet', 28),
  ('p_1786200993531_26', 'loc_vc_track',         'weekday_practice', 22), ('p_1786200993531_26', 'loc_vc_track',         'weekend_meet', 28),
  ('p_1786200993531_26', 'loc_riverbank',        'weekday_practice', 20), ('p_1786200993531_26', 'loc_riverbank',        'weekend_meet', 25),
  ('p_1786200993531_26', 'loc_mccarren',         'weekday_practice', 60), ('p_1786200993531_26', 'loc_mccarren',         'weekend_meet', 70),
  ('p_1786200993531_26', 'loc_cp_reservoir',     'weekday_practice', 38), ('p_1786200993531_26', 'loc_cp_reservoir',     'weekend_meet', 45),
  ('p_1786200993531_26', 'loc_cp_great_hill',    'weekday_practice', 33), ('p_1786200993531_26', 'loc_cp_great_hill',    'weekend_meet', 40),
  ('p_1786200993531_26', 'loc_cunningham',       'weekday_practice', 80), ('p_1786200993531_26', 'loc_cunningham',       'weekend_meet', 90),
  ('p_1786200993531_26', 'loc_prospect',         'weekday_practice', 65), ('p_1786200993531_26', 'loc_prospect',         'weekend_meet', 75),

  -- Lucien Jaccon (Harlem, 125th St, Manhattan)
  ('p_1786158900687_594', 'loc_vc_tortoise_hare', 'weekday_practice', 32), ('p_1786158900687_594', 'loc_vc_tortoise_hare', 'weekend_meet', 40),
  ('p_1786158900687_594', 'loc_vc_track',         'weekday_practice', 32), ('p_1786158900687_594', 'loc_vc_track',         'weekend_meet', 40),
  ('p_1786158900687_594', 'loc_riverbank',        'weekday_practice', 13), ('p_1786158900687_594', 'loc_riverbank',        'weekend_meet', 18),
  ('p_1786158900687_594', 'loc_mccarren',         'weekday_practice', 52), ('p_1786158900687_594', 'loc_mccarren',         'weekend_meet', 60),
  ('p_1786158900687_594', 'loc_cp_reservoir',     'weekday_practice', 22), ('p_1786158900687_594', 'loc_cp_reservoir',     'weekend_meet', 28),
  ('p_1786158900687_594', 'loc_cp_great_hill',    'weekday_practice', 13), ('p_1786158900687_594', 'loc_cp_great_hill',    'weekend_meet', 18),
  ('p_1786158900687_594', 'loc_cunningham',       'weekday_practice', 70), ('p_1786158900687_594', 'loc_cunningham',       'weekend_meet', 85),
  ('p_1786158900687_594', 'loc_prospect',         'weekday_practice', 48), ('p_1786158900687_594', 'loc_prospect',         'weekend_meet', 55),

  -- Miles Wu (Gramercy/Stuyvesant Town, Manhattan)
  ('p_1786208621328_621', 'loc_vc_tortoise_hare', 'weekday_practice', 60), ('p_1786208621328_621', 'loc_vc_tortoise_hare', 'weekend_meet', 70),
  ('p_1786208621328_621', 'loc_vc_track',         'weekday_practice', 60), ('p_1786208621328_621', 'loc_vc_track',         'weekend_meet', 70),
  ('p_1786208621328_621', 'loc_riverbank',        'weekday_practice', 45), ('p_1786208621328_621', 'loc_riverbank',        'weekend_meet', 55),
  ('p_1786208621328_621', 'loc_mccarren',         'weekday_practice', 32), ('p_1786208621328_621', 'loc_mccarren',         'weekend_meet', 42),
  ('p_1786208621328_621', 'loc_cp_reservoir',     'weekday_practice', 32), ('p_1786208621328_621', 'loc_cp_reservoir',     'weekend_meet', 38),
  ('p_1786208621328_621', 'loc_cp_great_hill',    'weekday_practice', 35), ('p_1786208621328_621', 'loc_cp_great_hill',    'weekend_meet', 40),
  ('p_1786208621328_621', 'loc_cunningham',       'weekday_practice', 60), ('p_1786208621328_621', 'loc_cunningham',       'weekend_meet', 70),
  ('p_1786208621328_621', 'loc_prospect',         'weekday_practice', 35), ('p_1786208621328_621', 'loc_prospect',         'weekend_meet', 42),

  -- Lowen Zuo (East Harlem, Manhattan)
  ('p_1787847256351_308', 'loc_vc_tortoise_hare', 'weekday_practice', 35), ('p_1787847256351_308', 'loc_vc_tortoise_hare', 'weekend_meet', 45),
  ('p_1787847256351_308', 'loc_vc_track',         'weekday_practice', 35), ('p_1787847256351_308', 'loc_vc_track',         'weekend_meet', 45),
  ('p_1787847256351_308', 'loc_riverbank',        'weekday_practice', 25), ('p_1787847256351_308', 'loc_riverbank',        'weekend_meet', 32),
  ('p_1787847256351_308', 'loc_mccarren',         'weekday_practice', 55), ('p_1787847256351_308', 'loc_mccarren',         'weekend_meet', 65),
  ('p_1787847256351_308', 'loc_cp_reservoir',     'weekday_practice', 15), ('p_1787847256351_308', 'loc_cp_reservoir',     'weekend_meet', 20),
  ('p_1787847256351_308', 'loc_cp_great_hill',    'weekday_practice', 10), ('p_1787847256351_308', 'loc_cp_great_hill',    'weekend_meet', 15),
  ('p_1787847256351_308', 'loc_cunningham',       'weekday_practice', 65), ('p_1787847256351_308', 'loc_cunningham',       'weekend_meet', 75),
  ('p_1787847256351_308', 'loc_prospect',         'weekday_practice', 48), ('p_1787847256351_308', 'loc_prospect',         'weekend_meet', 55);
