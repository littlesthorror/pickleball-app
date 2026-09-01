-- Grandfathers the "Rollercoaster" badge for players who earned it under
-- the old >100-point-swing threshold, before it's raised to >200 (Ben:
-- "a few people have that already... I think the number needs to be a bit
-- higher... please can the people who have earned it already not lose
-- it"). See src/lib/badges.ts for the threshold change itself.
--
-- These 10 all currently qualify under the old rule (biggestSwing > 100)
-- but not the new one (> 200) — the two players above 200 (Stephen
-- Coloma, Paul Browne) keep earning it via the normal computed path, so
-- don't need a row here. Values taken from actual match_participant_ratings
-- on 2026-09-01, the club's first logged session. granted_by = Ben
-- Franklin's own player id.
insert into public.legacy_badges (player_id, emoji, label, description, achieved_at, granted_by)
values
  ('19b7b84f-7961-4abb-889b-64b1022575fd', '🎢', 'Rollercoaster', 'Your rating swung by 167 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('2ccf1caf-2071-43f2-b83e-ab6ce881b229', '🎢', 'Rollercoaster', 'Your rating swung by 157 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('f32f2c4c-a85f-40e1-97bd-d313c82ceca8', '🎢', 'Rollercoaster', 'Your rating swung by 147 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('9274f08c-8a38-4a49-8c45-8eb4afa913d7', '🎢', 'Rollercoaster', 'Your rating swung by 139 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('afcd4b08-0421-499d-a026-2889eca9b6b5', '🎢', 'Rollercoaster', 'Your rating swung by 131 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('82ee46f1-69dc-4562-bb13-0dcf26cd8fea', '🎢', 'Rollercoaster', 'Your rating swung by 124 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('d38113b8-01b4-4f2f-9da6-acefa6ea0f59', '🎢', 'Rollercoaster', 'Your rating swung by 118 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('1b062f1e-6517-40e6-8634-0f3cd0b7e0ec', '🎢', 'Rollercoaster', 'Your rating swung by 118 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('957337b7-77e5-4fdc-a54b-c57834d7eeb9', '🎢', 'Rollercoaster', 'Your rating swung by 111 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102'),
  ('3ff628ee-8ea0-47bd-97cc-009c1dbbe9d0', '🎢', 'Rollercoaster', 'Your rating swung by 104 points in September 2026 alone.', '2026-09-01', '25a8d2ff-c437-4c17-95f4-9f4973629102');
