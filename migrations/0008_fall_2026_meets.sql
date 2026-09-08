-- Fall 2026 meet schedule. Ids are deterministic and the insert is OR IGNORE,
-- so re-running this migration can never create duplicate meets.
INSERT OR IGNORE INTO events (id, date, title, time, description, type, kind, auto) VALUES
  ('e_m26_0919_regis',        '2026-09-19', 'Regis Invitational',                   '',         '',                                   'meet', '', 0),
  ('e_m26_0921_gp2_queens',   '2026-09-21', 'Grand Prix #2 - Queens',               '4:15 PM',  'Cunningham Park',                    'meet', '', 0),
  ('e_m26_0922_gp2_bxmn',     '2026-09-22', 'Grand Prix #2 - Bronx/Manhattan',      '4:15 PM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_0926_group_run',    '2026-09-26', 'Group Run',                            '9:00 AM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_0928_gp3_bxmn',     '2026-09-28', 'Grand Prix #3 - Bronx/Manhattan',      '4:15 PM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1003_marty_lewis',  '2026-10-03', 'Marty Lewis',                          '9:00 AM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1005_gp4_bxmn',     '2026-10-05', 'Grand Prix #4 - Bronx/Manhattan',      '4:15 PM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1006_gp4_bklyn',    '2026-10-06', 'Grand Prix #4 - Brooklyn',             '4:15 PM',  'Prospect Park',                      'meet', '', 0),
  ('e_m26_1010_manhattan',    '2026-10-10', 'Manhattan Invitational',               '',         '',                                   'meet', '', 0),
  ('e_m26_1013_fs_boro',      '2026-10-13', 'F/S Borough Champs - Bronx/Manhattan', '4:15 PM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1019_gp5_bxmn',     '2026-10-19', 'Grand Prix #5 - Bronx/Manhattan',      '4:15 PM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1024_boro_champs',  '2026-10-24', 'Borough Championships',                '9:00 AM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1031_fs_city',      '2026-10-31', 'Frosh/Soph City Championships',        '9:00 AM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0),
  ('e_m26_1107_city_champs',  '2026-11-07', 'City Championships',                   '9:00 AM',  'Van Cortlandt Park - Track & Field', 'meet', '', 0);
