// Mirrors the tables/views in supabase/migrations/

export interface Player {
  id: string;
  display_name: string;
  date_joined: string;
  is_admin: boolean;
  is_active: boolean;
  avatar_url: string | null;
  date_of_birth: string | null;
  date_of_birth_visible: boolean;
  profile_completed: boolean;
  profile_visible: boolean;
  // Optional honorary title an admin can set (e.g. "Club Coach", "Club
  // Secretary") — purely a display label, no bearing on actual permissions.
  role_title: string | null;
  dark_mode: boolean;
  notify_new_events: boolean;
  notify_new_notices: boolean;
  notify_badge_earned: boolean;
  notify_rank_change: boolean;
  // Admin-created "dummy" account (2026-09-01) for a member who's
  // reluctant to sign up themselves — the underlying auth login is
  // permanently disabled (see create-placeholder-player edge function),
  // this just flags it for a small "Guest" tag in the UI. See
  // 0057_add_placeholder_players.sql.
  is_placeholder: boolean;
  // "Hide my rating number from my own dashboard" (2026-09-01) — purely a
  // self-facing preference for anyone who doesn't want to see their own
  // number, separate from profile_visible (which controls whether OTHERS
  // can see them on the leaderboard). See 0060_add_hide_own_rating.sql.
  hide_own_rating: boolean;
}

// Emergency contact + medical info (2026-08-28) — moved 2026-08-31 out of
// `players` into their own table (see
// 0056_lock_down_medical_and_emergency_contact_info.sql). These used to be
// plain columns on `players`, which has a "readable by any logged-in
// member" RLS policy — meaning any member could read another member's
// medical info/emergency contact directly via the API, even though the UI
// only ever showed it to admins. Postgres RLS can't restrict individual
// columns, only rows, so the real fix was giving these their own table
// with its own RLS ("the player themselves, or an admin" — see the
// migration). Fetched separately from PlayerStatus now: Profile.tsx fetches
// its own row, AdminManagement.tsx fetches all rows (both allowed by the
// same RLS policy, since is_admin() short-circuits the row check for
// admins).
export interface PlayerPrivateInfo {
  player_id: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_info: string | null;
  updated_at: string;
}

export interface PlayerStatus extends Player {
  rating: number;
  rd: number;
  // Added 2026-08-29 (see 0054_add_volatility_to_player_status_view.sql) —
  // needed client-side for the Match Entry "Impact preview", which mirrors
  // confirm-match's exact Glicko-2 math rather than an approximation.
  volatility: number;
  games_played: number;
  reset_at: string | null;
  is_provisional: boolean;
}

export interface LeaderboardRow extends PlayerStatus {
  // Null means the player joined less than 30 days ago — no meaningful
  // "30 days ago" rating to compare against yet.
  delta_30d: number | null;
}

export interface PlayerMatchHistoryRow {
  player_id: string;
  match_id: string;
  played_at: string;
  team: "a" | "b";
  pre_rating: number;
  pre_rd: number;
  post_rating: number;
  post_rd: number;
  rating_delta: number;
  own_score: number;
  opponent_score: number;
  won: boolean;
  teammate_name: string;
  opponent_names: string;
  game_number: number;
  // Added 2026-08-11 for the "Bracket Buster" badge — your partner's own
  // pre-game rating, and the LOWER of the two opponents' pre-game
  // ratings (all that's needed to check whether both opponents outrated
  // both of you).
  teammate_pre_rating: number | null;
  opponent_min_pre_rating: number | null;
}

export type MatchStatus = "pending" | "confirmed" | "disputed";

export interface NewMatchInput {
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  team_a_score: number;
  team_b_score: number;
}

// 'trophy' = navy background, for competitions/tournaments/ladders.
// 'social' = orange background, for socials/coaching/casual sessions.
// Shown in place of a real poster until one's been uploaded.
export type EventPosterPlaceholder = "trophy" | "social";

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  location: string | null;
  // Path within the "notices" storage bucket (reused rather than a
  // dedicated bucket) — e.g. "events/<id>/poster-<ts>-<rand>.jpg". Null
  // if no poster has been uploaded for this event.
  poster_path: string | null;
  created_by: string | null;
  created_at: string;
  // All added 2026-08-15 for the ticket-style event detail popup.
  format: string | null;
  hosted_by: string | null;
  external_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  poster_placeholder: EventPosterPlaceholder | null;
  // Added 2026-08-25 — lets an admin leave the "I'm in" RSVP button off
  // entirely for events where attendance tracking doesn't make sense
  // (e.g. a plain announcement). Defaults true so existing events keep
  // behaving exactly as before.
  rsvp_enabled: boolean;
  // Added 2026-08-28 — admin opt-in per event for the auto-refreshed
  // weather forecast (see lib/weather.ts). Off by default since not every
  // event is outdoors.
  weather_enabled: boolean;
  // Added 2026-08-28 — admin "save the date" entries. Enforced server-side
  // by RLS (see 0047_add_private_events.sql), not just hidden in the UI —
  // a non-admin's Supabase query for events simply never returns these
  // rows at all.
  is_private: boolean;
}

// Admin-granted "legacy badge" (2026-08-28) — see 0049_add_legacy_badges.sql
// for why this exists: the one deliberate exception to every other badge
// being purely computed from stored data, for real achievements (e.g. an
// old club competition) that predate this app's own records.
export interface LegacyBadgeRow {
  id: string;
  player_id: string;
  emoji: string;
  label: string;
  description: string;
  achieved_at: string;
  granted_by: string | null;
  created_at: string;
}

// Partner-finder board (2026-08-28) — see 0051_add_partner_requests.sql.
// Deliberately a Dashboard widget only, not a dedicated page/nav tab (Ben's
// explicit preference).
export interface PartnerRequestRow {
  id: string;
  player_id: string;
  note: string;
  play_date: string | null;
  play_time: string | null;
  created_at: string;
  // Only present when queried with the `players(display_name, avatar_url)`
  // embed — who posted this request.
  players?: { display_name: string; avatar_url: string | null } | null;
}

export interface PartnerRequestInterestRow {
  id: string;
  request_id: string;
  player_id: string;
  created_at: string;
  // Only present when queried with the `players(display_name)` embed.
  players?: { display_name: string } | null;
}

export interface EventRsvpRow {
  id: string;
  event_id: string;
  player_id: string;
  status: "going" | "waitlist";
  created_at: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  // Added 2026-08-25 for optional image attachments on FAQ answers — path
  // within the "notices" storage bucket (reused, same as Notices/Events),
  // e.g. "faq/<id>/image-<ts>-<rand>.jpg". Null if no image was attached.
  image_path: string | null;
}

export interface NoticeAttachment {
  path: string;
  name: string;
}

export interface NoticeRow {
  id: string;
  title: string;
  body: string | null;
  // Legacy single-attachment fields — superseded by `attachments` below,
  // kept only so old rows aren't missing data. New code should read/write
  // `attachments` instead.
  file_path: string | null;
  file_name: string | null;
  attachments: NoticeAttachment[];
  created_by: string | null;
  created_at: string;
  // Auto-maintained by a DB trigger (0052_add_notices_updated_at.sql) — bumped
  // on any edit (title/body/attachments/cover/pin/poll). Starts equal to
  // created_at for a brand-new post. Shown as a subtle "Updated ..." note,
  // only when it meaningfully differs from created_at. Added 2026-08-28.
  updated_at: string;
  // Pins a notice to the top of the board, above unpinned ones (still
  // newest-first within each group). Added 2026-08-27.
  pinned: boolean;
  // Optional headline/banner image, separate from `attachments` — shown as
  // a 16:9 cover at the top of the card. Path within the "notices" storage
  // bucket, e.g. "notices/<id>/cover-<ts>-<rand>.jpg". Added 2026-08-28 for
  // the redesigned card layout.
  cover_path: string | null;
  // Only present when queried with the `players(display_name)` embed —
  // who posted this notice, shown in the card's meta line. Optional since
  // some queries (e.g. right after an insert) won't have joined it.
  players?: { display_name: string } | null;
  // Admin poll (2026-08-28) — optional yes/no or multiple-choice poll
  // attached to a notice, toggled per-post. poll_question/poll_options are
  // only meaningful when poll_enabled is true.
  poll_enabled: boolean;
  poll_question: string | null;
  poll_options: string[];
}

export interface NoticePollVote {
  id: string;
  notice_id: string;
  player_id: string;
  option_index: number;
  created_at: string;
}

// Competitions (2026-08-26) — fixed-team doubles, group stage followed by
// a knockout bracket. Every competition_matches row also has a real row in
// `matches` once played (via match_id), so ratings flow through the same
// Glicko-2 pipeline as any normal game; standings here are plain
// win/loss/points-difference, football-table style.
export type CompetitionStatus = "setup" | "groups" | "knockout" | "completed";

// "standard" = 2 points for a win, 0 for a loss (as it's always worked).
// "social" = 2 points for a win, plus the losing team still picks up 1
// point if they scored more than 6 in the game — rewards a competitive
// loss instead of a blowout. Chosen per-competition at creation. Added
// 2026-08-26.
export type ScoringSystem = "standard" | "social";

export interface CompetitionRow {
  id: string;
  name: string;
  event_date: string | null;
  status: CompetitionStatus;
  advance_per_group: number;
  scoring_system: ScoringSystem;
  // When true, group-stage fixtures are generated as a double round robin
  // — every team plays every other team in its group twice instead of
  // once. Chosen at creation, alongside scoring_system. Added 2026-08-27
  // at Ben's request ("we normally have teams play each other twice").
  double_round_robin: boolean;
  created_by: string | null;
  created_at: string;
}

export interface CompetitionTeamRow {
  id: string;
  competition_id: string;
  team_name: string | null;
  player1_id: string;
  player2_id: string;
  created_at: string;
}

export interface CompetitionGroupRow {
  id: string;
  competition_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface CompetitionGroupTeamRow {
  id: string;
  group_id: string;
  team_id: string;
  created_at: string;
}

export type KnockoutRound = "quarterfinal" | "semifinal" | "third_place" | "final";

export interface CompetitionMatchRow {
  id: string;
  competition_id: string;
  group_id: string | null;
  knockout_round: KnockoutRound | null;
  knockout_slot: number | null;
  team_a_id: string;
  team_b_id: string;
  match_id: string | null;
  winner_team_id: string | null;
  // Which meeting between this pair this is within the group stage (1 or
  // 2) — only meaningful when the competition is a double round robin;
  // always 1 for a single round robin or a knockout match. Added
  // 2026-08-27.
  leg: number;
  created_at: string;
}

export interface CompetitionResultRow {
  id: string;
  competition_id: string;
  team_id: string;
  placement: number;
  created_at: string;
}

// The Quarterly Cup (2026-09-02) — a standalone fixed-team doubles
// mini-league, deliberately separate from both Competitions (no knockout
// stage, just a flat table) and the main Season leaderboard. See
// 0062_add_quarterly_cup_schema.sql. Every game played here is ALSO a real
// row in `matches` (via quarterly_cup_matches.match_id), so it feeds the
// same Glicko-2 engine as any normal club match — this page is only
// responsible for team/fixture bookkeeping and simple win/loss/points
// standings, not ratings. Unlike Competitions, results and fixtures here
// are fully public — no participant-only RLS.
export type QuarterlyCupStatus = "setup" | "active" | "completed";

export interface QuarterlyCupRow {
  id: string;
  name: string;
  status: QuarterlyCupStatus;
  scoring_system: ScoringSystem;
  double_round_robin: boolean;
  // Only meaningful when mirror_season_end is false.
  end_date: string | null;
  // When true, the finish date always comes live from the current
  // Season's last day (see lib/seasons.ts's getSeasonEndInfo) instead of
  // end_date.
  mirror_season_end: boolean;
  winner_team_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface QuarterlyCupTeamRow {
  id: string;
  cup_id: string;
  team_name: string | null;
  player1_id: string;
  player2_id: string;
  created_at: string;
}

export interface QuarterlyCupMatchRow {
  id: string;
  cup_id: string;
  team_a_id: string;
  team_b_id: string;
  leg: number;
  match_id: string | null;
  winner_team_id: string | null;
  created_at: string;
}
