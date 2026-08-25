import { describe, it, expect } from "vitest";
import { computeBadges } from "./badges";
import type { PlayerMatchHistoryRow } from "../types";

// Every assertion below was independently verified against this exact,
// unmodified badges.ts on 2026-08-25 by running it under plain Node (via
// `node --experimental-strip-types`) outside this project, before being
// transcribed into vitest syntax here. See the "fix all 5" work log for
// context on why: this sandbox has no npm registry access, so `vitest run`
// itself could not be executed here — Ben needs to run `npm install && npm
// test` locally once to get the actual green checkmark.

function row(overrides: Partial<PlayerMatchHistoryRow>): PlayerMatchHistoryRow {
  return {
    player_id: "p1",
    match_id: "m1",
    played_at: "2026-01-01T00:00:00Z",
    team: "a",
    pre_rating: 1500,
    pre_rd: 60,
    post_rating: 1500,
    post_rd: 60,
    rating_delta: 0,
    own_score: 11,
    opponent_score: 5,
    won: true,
    teammate_name: "Partner",
    opponent_names: "Opp A & Opp B",
    game_number: 1,
    teammate_pre_rating: null,
    opponent_min_pre_rating: null,
    ...overrides,
  };
}

describe("computeBadges", () => {
  it("returns no badges for no games", () => {
    expect(computeBadges([], 0, "2026-01-01T00:00:00Z")).toHaveLength(0);
  });

  it("awards first-win on any won game", () => {
    const badges = computeBadges([row({ won: true })], 1, "2026-01-01T00:00:00Z");
    const b = badges.find((x) => x.id === "first-win");
    expect(b).toBeTruthy();
    expect(b!.description).toMatch(/Opp A & Opp B/);
  });

  it("does not award first-win if the only game was a loss", () => {
    const badges = computeBadges([row({ won: false })], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "first-win")).toBeUndefined();
  });

  it("awards games-10 at exactly 10 games, not games-25", () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      row({ game_number: i + 1, played_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const badges = computeBadges(history, 10, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "games-10")).toBeTruthy();
    expect(badges.find((x) => x.id === "games-25")).toBeUndefined();
  });

  it("awards big-win for the biggest 15+ point margin", () => {
    const history = [
      row({ won: true, own_score: 11, opponent_score: 0, opponent_names: "Small margin" }), // 11 margin
      row({ won: true, own_score: 20, opponent_score: 2, opponent_names: "Big margin" }), // 18 margin
    ];
    const badges = computeBadges(history, 2, "2026-01-01T00:00:00Z");
    const b = badges.find((x) => x.id === "big-win");
    expect(b).toBeTruthy();
    expect(b!.description).toMatch(/Big margin/);
  });

  it("does not award big-win below the 15-point threshold", () => {
    const history = [row({ won: true, own_score: 11, opponent_score: 0 })]; // 11 margin
    const badges = computeBadges(history, 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "big-win")).toBeUndefined();
  });

  it("awards twenty-pointer at exactly 20, not 19", () => {
    const badges19 = computeBadges([row({ own_score: 19 })], 1, "2026-01-01T00:00:00Z");
    expect(badges19.find((x) => x.id === "twenty-pointer")).toBeUndefined();
    const badges20 = computeBadges([row({ own_score: 20 })], 1, "2026-01-01T00:00:00Z");
    expect(badges20.find((x) => x.id === "twenty-pointer")).toBeTruthy();
  });

  it("awards pickled only at own_score === 0", () => {
    const badges = computeBadges([row({ won: false, own_score: 0, opponent_score: 11 })], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "pickled")).toBeTruthy();
  });

  it("awards bracket-buster only when both you and your partner were outrated", () => {
    const buster = row({
      won: true,
      pre_rating: 1400,
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
    });
    const badges = computeBadges([buster], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "bracket-buster")).toBeTruthy();

    const notBuster = row({
      won: true,
      pre_rating: 1460, // you were rated HIGHER than the weaker opponent
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
    });
    const badges2 = computeBadges([notBuster], 1, "2026-01-01T00:00:00Z");
    expect(badges2.find((x) => x.id === "bracket-buster")).toBeUndefined();
  });

  it("awards point-hoarder once 1000+ total points are scored", () => {
    const history = Array.from({ length: 100 }, (_, i) => row({ own_score: 10, opponent_score: 5, game_number: i + 1 }));
    const badges = computeBadges(history, 100, "2026-01-01T00:00:00Z");
    const b = badges.find((x) => x.id === "point-hoarder");
    expect(b).toBeTruthy();
    expect(b!.description).toMatch(/1000/);
  });
});
