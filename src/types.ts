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
}

export interface PlayerStatus extends Player {
  rating: number;
  rd: number;
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
