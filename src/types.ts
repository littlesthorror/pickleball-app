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

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  location: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
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
}
