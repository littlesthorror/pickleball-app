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
    draw: false,
    teammate_name: "Partner",
    opponent_names: "Opp A & Opp B",
    game_number: 1,
    teammate_pre_rating: null,
    opponent_min_pre_rating: null,
    opponent_combined_pre_rating: null,
    teammate_game_number: null,
    opponent_min_game_number: null,
    opponent_combined_game_number: null,
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

  it("awards games-12 at exactly 12 games, not games-25", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      row({ game_number: i + 1, played_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const badges = computeBadges(history, 12, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "games-12")).toBeTruthy();
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

  it("awards bracket-buster only when both you and your partner were outrated, and all 4 players had 25+ games", () => {
    const buster = row({
      won: true,
      pre_rating: 1400,
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
      game_number: 25,
      teammate_game_number: 25,
      opponent_min_game_number: 25,
    });
    const badges = computeBadges([buster], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "bracket-buster")).toBeTruthy();

    const notBuster = row({
      won: true,
      pre_rating: 1460, // you were rated HIGHER than the weaker opponent
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
      game_number: 25,
      teammate_game_number: 25,
      opponent_min_game_number: 25,
    });
    const badges2 = computeBadges([notBuster], 1, "2026-01-01T00:00:00Z");
    expect(badges2.find((x) => x.id === "bracket-buster")).toBeUndefined();

    // Ratings look like a genuine upset, but someone hasn't hit 25 games yet.
    const tooNew = row({
      won: true,
      pre_rating: 1400,
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
      game_number: 25,
      teammate_game_number: 25,
      opponent_min_game_number: 24,
    });
    const badges3 = computeBadges([tooNew], 1, "2026-01-01T00:00:00Z");
    expect(badges3.find((x) => x.id === "bracket-buster")).toBeUndefined();
  });

  it("awards giant-slayer tiers only for upset wins where all 4 players had 25+ games (same floor as bracket-buster)", () => {
    const qualifyingUpset = {
      won: true,
      pre_rating: 1400,
      teammate_pre_rating: 1420,
      opponent_min_pre_rating: 1450,
      game_number: 25,
      teammate_game_number: 25,
      opponent_min_game_number: 25,
    };
    const tooNewUpset = { ...qualifyingUpset, opponent_min_game_number: 24 };

    // 2 qualifying + 1 too-new -> only 2 count, so tier-3 shouldn't fire yet.
    const history = [
      row({ ...qualifyingUpset, played_at: "2026-01-01T00:00:00Z" }),
      row({ ...qualifyingUpset, played_at: "2026-01-02T00:00:00Z" }),
      row({ ...tooNewUpset, played_at: "2026-01-03T00:00:00Z" }),
    ];
    const badges = computeBadges(history, 3, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "giant-slayer-3")).toBeUndefined();

    // A 3rd qualifying upset should push it over the tier-3 threshold.
    const history4 = [...history, row({ ...qualifyingUpset, played_at: "2026-01-04T00:00:00Z" })];
    const badges4 = computeBadges(history4, 4, "2026-01-01T00:00:00Z");
    expect(badges4.find((x) => x.id === "giant-slayer-3")).toBeTruthy();
  });

  it("awards point-hoarder once 1000+ total points are scored", () => {
    const history = Array.from({ length: 100 }, (_, i) => row({ own_score: 10, opponent_score: 5, game_number: i + 1 }));
    const badges = computeBadges(history, 100, "2026-01-01T00:00:00Z");
    const b = badges.find((x) => x.id === "point-hoarder");
    expect(b).toBeTruthy();
    expect(b!.description).toMatch(/1000/);
  });

  // Draw handling (2026-09-09) — the club plays fixed 9-minute games, so a
  // tied score is a legitimate result, not a data error. A draw must not
  // be silently treated as a loss by badges that key off `!h.won`.
  it("does not treat a draw as a loss for jekyll-hyde (win + draw with same partner, same day)", () => {
    const history = [
      row({ won: true, own_score: 11, opponent_score: 5, teammate_name: "Partner", played_at: "2026-09-08T10:00:00Z" }),
      row({ won: false, draw: true, own_score: 8, opponent_score: 8, teammate_name: "Partner", played_at: "2026-09-08T11:00:00Z" }),
    ];
    const badges = computeBadges(history, 2, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "jekyll-hyde")).toBeUndefined();
  });

  it("does not treat a draw as a loss for rematch (draw then win isn't a rematch)", () => {
    const history = [
      row({ won: false, draw: true, own_score: 8, opponent_score: 8, opponent_names: "Opp A & Opp B", played_at: "2026-09-08T10:00:00Z" }),
      row({ won: true, own_score: 11, opponent_score: 5, opponent_names: "Opp A & Opp B", played_at: "2026-09-08T11:00:00Z" }),
    ];
    const badges = computeBadges(history, 2, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "rematch")).toBeUndefined();
  });

  // Second batch of new badges (2026-09-09). All are non-retroactive (see
  // SECOND_BATCH_INTRODUCED_AT in badges.ts), so every test row here uses a
  // played_at after that cutoff — a row dated earlier wouldn't count.
  it("awards early-bird at 15 games before midday, not 14", () => {
    const morning14 = Array.from({ length: 14 }, (_, i) =>
      row({ played_at: `2026-09-10T08:00:00Z`, game_number: i + 1 })
    );
    const badges14 = computeBadges(morning14, 14, "2026-01-01T00:00:00Z");
    expect(badges14.find((x) => x.id === "early-bird")).toBeUndefined();

    const morning15 = [...morning14, row({ played_at: "2026-09-10T08:00:00Z", game_number: 15 })];
    const badges15 = computeBadges(morning15, 15, "2026-01-01T00:00:00Z");
    expect(badges15.find((x) => x.id === "early-bird")).toBeTruthy();
  });

  it("does not count afternoon games toward early-bird", () => {
    const afternoonGames = Array.from({ length: 15 }, (_, i) =>
      row({ played_at: `2026-09-10T14:00:00Z`, game_number: i + 1 })
    );
    const badges = computeBadges(afternoonGames, 15, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "early-bird")).toBeUndefined();
  });

  it("awards fair-and-square on the first draw, and peacemaker at 10 draws", () => {
    const nineDraws = Array.from({ length: 9 }, (_, i) =>
      row({ draw: true, won: false, own_score: 8, opponent_score: 8, played_at: `2026-09-10T0${i}:00:00Z`, game_number: i + 1 })
    );
    const badges9 = computeBadges(nineDraws, 9, "2026-01-01T00:00:00Z");
    expect(badges9.find((x) => x.id === "fair-and-square")).toBeTruthy();
    expect(badges9.find((x) => x.id === "peacemaker")).toBeUndefined();

    const tenDraws = [...nineDraws, row({ draw: true, won: false, own_score: 8, opponent_score: 8, played_at: "2026-09-10T10:00:00Z", game_number: 10 })];
    const badges10 = computeBadges(tenDraws, 10, "2026-01-01T00:00:00Z");
    expect(badges10.find((x) => x.id === "peacemaker")).toBeTruthy();
  });

  it("awards hat-trick after 3 separate days with 3+ wins each, not before", () => {
    const twoHatTrickDays = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T10:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T11:00:00Z" }),
      row({ won: true, played_at: "2026-09-11T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-11T10:00:00Z" }),
      row({ won: true, played_at: "2026-09-11T11:00:00Z" }),
    ];
    const badges2 = computeBadges(twoHatTrickDays, 6, "2026-01-01T00:00:00Z");
    expect(badges2.find((x) => x.id === "hat-trick-3")).toBeUndefined();

    const thirdHatTrickDay = [
      ...twoHatTrickDays,
      row({ won: true, played_at: "2026-09-12T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-12T10:00:00Z" }),
      row({ won: true, played_at: "2026-09-12T11:00:00Z" }),
    ];
    const badges3 = computeBadges(thirdHatTrickDay, 9, "2026-01-01T00:00:00Z");
    expect(badges3.find((x) => x.id === "hat-trick-3")).toBeTruthy();
  });

  it("only counts wins toward hat-trick, not losses or draws in the same day", () => {
    const mixedDay = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T10:00:00Z" }),
      row({ won: false, played_at: "2026-09-10T11:00:00Z" }),
      row({ won: false, draw: true, own_score: 8, opponent_score: 8, played_at: "2026-09-10T12:00:00Z" }),
    ];
    const badges = computeBadges(mixedDay, 4, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "hat-trick-3")).toBeUndefined();
  });

  it("awards old-guard only for a win against a pair with 200+ combined games", () => {
    const win = row({ won: true, opponent_combined_game_number: 200, played_at: "2026-09-10T00:00:00Z" });
    const badges = computeBadges([win], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "old-guard")).toBeTruthy();

    const shortOfIt = row({ won: true, opponent_combined_game_number: 199, played_at: "2026-09-10T00:00:00Z" });
    const badges2 = computeBadges([shortOfIt], 1, "2026-01-01T00:00:00Z");
    expect(badges2.find((x) => x.id === "old-guard")).toBeUndefined();

    const lostAnyway = row({ won: false, opponent_combined_game_number: 250, played_at: "2026-09-10T00:00:00Z" });
    const badges3 = computeBadges([lostAnyway], 1, "2026-01-01T00:00:00Z");
    expect(badges3.find((x) => x.id === "old-guard")).toBeUndefined();
  });

  it("awards grudge-match at 15 games against the same opponent pair, any outcome", () => {
    const fourteenGames = Array.from({ length: 14 }, (_, i) =>
      row({ won: i % 2 === 0, opponent_names: "Rival A / Rival B", played_at: `2026-09-${10 + (i % 10)}T00:00:00Z`, game_number: i + 1 })
    );
    const badges14 = computeBadges(fourteenGames, 14, "2026-01-01T00:00:00Z");
    expect(badges14.find((x) => x.id === "grudge-match")).toBeUndefined();

    const fifteenGames = [...fourteenGames, row({ won: false, opponent_names: "Rival A / Rival B", played_at: "2026-09-20T00:00:00Z", game_number: 15 })];
    const badges15 = computeBadges(fifteenGames, 15, "2026-01-01T00:00:00Z");
    expect(badges15.find((x) => x.id === "grudge-match")).toBeTruthy();
  });

  it("awards the-specialist for 90%+ win rate over 15+ games with one partner, not below either threshold", () => {
    // 14 games at 100% shouldn't qualify — under the 15-game floor.
    const fourteenPerfect = Array.from({ length: 14 }, (_, i) =>
      row({ won: true, teammate_name: "Ace", played_at: `2026-09-${10 + (i % 10)}T00:00:00Z`, game_number: i + 1 })
    );
    const badges14 = computeBadges(fourteenPerfect, 14, "2026-01-01T00:00:00Z");
    expect(badges14.find((x) => x.id === "the-specialist")).toBeUndefined();

    // 15 games, 13 wins (~86.7%) clears the game floor but not the rate.
    const fifteenBelowRate = [
      ...Array.from({ length: 13 }, (_, i) => row({ won: true, teammate_name: "Ace", played_at: `2026-09-${10 + (i % 10)}T00:00:00Z`, game_number: i + 1 })),
      row({ won: false, teammate_name: "Ace", played_at: "2026-09-20T00:00:00Z", game_number: 14 }),
      row({ won: false, teammate_name: "Ace", played_at: "2026-09-21T00:00:00Z", game_number: 15 }),
    ];
    const badgesRate = computeBadges(fifteenBelowRate, 15, "2026-01-01T00:00:00Z");
    expect(badgesRate.find((x) => x.id === "the-specialist")).toBeUndefined();

    // 15 games, 14 wins (~93.3%) clears both.
    const fifteenQualifying = [
      ...Array.from({ length: 14 }, (_, i) => row({ won: true, teammate_name: "Ace", played_at: `2026-09-${10 + (i % 10)}T00:00:00Z`, game_number: i + 1 })),
      row({ won: false, teammate_name: "Ace", played_at: "2026-09-21T00:00:00Z", game_number: 15 }),
    ];
    const badgesQualifying = computeBadges(fifteenQualifying, 15, "2026-01-01T00:00:00Z");
    expect(badgesQualifying.find((x) => x.id === "the-specialist")).toBeTruthy();
  });

  it("awards ride-or-die as a 50-win tier on top of the existing 25-win partner badge", () => {
    const wins25 = Array.from({ length: 25 }, (_, i) =>
      row({ won: true, teammate_name: "Partner", game_number: i + 1, played_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const badges25 = computeBadges(wins25, 25, "2026-01-01T00:00:00Z");
    expect(badges25.find((x) => x.id === "partner-25-wins")).toBeTruthy();
    expect(badges25.find((x) => x.id === "ride-or-die")).toBeUndefined();

    const wins49 = Array.from({ length: 49 }, (_, i) =>
      row({ won: true, teammate_name: "Partner", game_number: i + 1, played_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const badges49 = computeBadges(wins49, 49, "2026-01-01T00:00:00Z");
    expect(badges49.find((x) => x.id === "ride-or-die")).toBeUndefined();

    const wins50 = [...wins49, row({ won: true, teammate_name: "Partner", game_number: 50, played_at: "2026-02-01T00:00:00Z" })];
    const badges50 = computeBadges(wins50, 50, "2026-01-01T00:00:00Z");
    expect(badges50.find((x) => x.id === "ride-or-die")).toBeTruthy();
    expect(badges50.find((x) => x.id === "partner-25-wins")).toBeTruthy();
  });

  // Third batch of quirky score-pattern badges (2026-09-09). Non-retroactive
  // (see THIRD_BATCH_INTRODUCED_AT in badges.ts) — every row here is dated
  // after that cutoff.
  it("awards unlucky-for-some only for a 13-0 win, not a similar score", () => {
    const win = row({ won: true, own_score: 13, opponent_score: 0, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([win], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "unlucky-for-some")).toBeTruthy();

    const closeButNo = row({ won: true, own_score: 13, opponent_score: 1, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([closeButNo], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "unlucky-for-some")).toBeUndefined();
  });

  it("awards golden-point only for an 11-9 win", () => {
    const win = row({ won: true, own_score: 11, opponent_score: 9, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([win], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "golden-point")).toBeTruthy();

    const buzzerBeaterInstead = row({ won: true, own_score: 11, opponent_score: 10, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([buzzerBeaterInstead], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "golden-point")).toBeUndefined();
  });

  it("awards nil-by-mouth for an 11-0 win, alongside (not instead of) clean-sweep", () => {
    const win = row({ won: true, own_score: 11, opponent_score: 0, played_at: "2026-09-10T00:00:00Z" });
    const badges = computeBadges([win], 1, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "nil-by-mouth")).toBeTruthy();
    expect(badges.find((x) => x.id === "clean-sweep")).toBeTruthy();

    const biggerShutout = row({ won: true, own_score: 15, opponent_score: 0, played_at: "2026-09-10T00:00:00Z" });
    const badges2 = computeBadges([biggerShutout], 1, "2026-01-01T00:00:00Z");
    expect(badges2.find((x) => x.id === "nil-by-mouth")).toBeUndefined();
    expect(badges2.find((x) => x.id === "clean-sweep")).toBeTruthy();
  });

  it("awards double-digits only for a win margin of exactly 10", () => {
    const exact = row({ won: true, own_score: 15, opponent_score: 5, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([exact], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "double-digits")).toBeTruthy();

    const margin9 = row({ won: true, own_score: 15, opponent_score: 6, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([margin9], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "double-digits")).toBeUndefined();

    const margin11 = row({ won: true, own_score: 15, opponent_score: 4, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([margin11], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "double-digits")).toBeUndefined();
  });

  it("awards mirror-match for the same win margin twice in one day, not once or across different days", () => {
    const onceOnly = [row({ won: true, own_score: 13, opponent_score: 8, played_at: "2026-09-10T09:00:00Z" })];
    expect(computeBadges(onceOnly, 1, "2026-01-01T00:00:00Z").find((x) => x.id === "mirror-match")).toBeUndefined();

    const differentMargins = [
      row({ won: true, own_score: 13, opponent_score: 8, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, own_score: 11, opponent_score: 9, played_at: "2026-09-10T10:00:00Z" }),
    ];
    expect(computeBadges(differentMargins, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "mirror-match")).toBeUndefined();

    const sameMarginDifferentDays = [
      row({ won: true, own_score: 13, opponent_score: 8, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, own_score: 15, opponent_score: 10, played_at: "2026-09-11T09:00:00Z" }),
    ];
    expect(computeBadges(sameMarginDifferentDays, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "mirror-match")).toBeUndefined();

    const sameMarginSameDay = [
      row({ won: true, own_score: 13, opponent_score: 8, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, own_score: 15, opponent_score: 10, played_at: "2026-09-10T11:00:00Z" }),
    ];
    const badges = computeBadges(sameMarginSameDay, 2, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "mirror-match")).toBeTruthy();
  });

  // Fourth batch (2026-09-09) — 19 badges added to round the total out to
  // 100. Non-retroactive (see FOURTH_BATCH_INTRODUCED_AT in badges.ts).
  it("awards three-peat only for 3 consecutive wins vs the same pair, reset by a loss", () => {
    const brokenStreak = [
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T10:00:00Z" }),
      row({ won: false, opponent_names: "Rival", played_at: "2026-09-10T11:00:00Z" }),
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T12:00:00Z" }),
    ];
    expect(computeBadges(brokenStreak, 4, "2026-01-01T00:00:00Z").find((x) => x.id === "three-peat")).toBeUndefined();

    const unbrokenStreak = [
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T10:00:00Z" }),
      row({ won: true, opponent_names: "Rival", played_at: "2026-09-10T11:00:00Z" }),
    ];
    expect(computeBadges(unbrokenStreak, 3, "2026-01-01T00:00:00Z").find((x) => x.id === "three-peat")).toBeTruthy();
  });

  it("awards untouchable only for a perfect 5+ game record vs one pair", () => {
    const oneLoss = [
      ...Array.from({ length: 4 }, (_, i) => row({ won: true, opponent_names: "Rival", played_at: `2026-09-1${i}T09:00:00Z` })),
      row({ won: false, opponent_names: "Rival", played_at: "2026-09-15T09:00:00Z" }),
    ];
    expect(computeBadges(oneLoss, 5, "2026-01-01T00:00:00Z").find((x) => x.id === "untouchable")).toBeUndefined();

    const perfectFive = Array.from({ length: 5 }, (_, i) => row({ won: true, opponent_names: "Rival", played_at: `2026-09-1${i}T09:00:00Z` }));
    expect(computeBadges(perfectFive, 5, "2026-01-01T00:00:00Z").find((x) => x.id === "untouchable")).toBeTruthy();
  });

  it("awards nightcap for winning the last game of a 3+ game session, not a 2-game one", () => {
    const twoGameDay = [
      row({ won: false, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T10:00:00Z" }),
    ];
    expect(computeBadges(twoGameDay, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "nightcap")).toBeUndefined();

    const threeGameDayLostLast = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T10:00:00Z" }),
      row({ won: false, played_at: "2026-09-10T11:00:00Z" }),
    ];
    expect(computeBadges(threeGameDayLostLast, 3, "2026-01-01T00:00:00Z").find((x) => x.id === "nightcap")).toBeUndefined();

    const threeGameDayWonLast = [
      row({ won: false, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: false, played_at: "2026-09-10T10:00:00Z" }),
      row({ won: true, played_at: "2026-09-10T11:00:00Z" }),
    ];
    expect(computeBadges(threeGameDayWonLast, 3, "2026-01-01T00:00:00Z").find((x) => x.id === "nightcap")).toBeTruthy();
  });

  it("awards taste-of-everything only once a win, loss, AND draw all land in the same DAY (not just the same month)", () => {
    const justWinAndLossSameDay = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: false, played_at: "2026-09-10T10:00:00Z" }),
    ];
    expect(
      computeBadges(justWinAndLossSameDay, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "taste-of-everything")
    ).toBeUndefined();

    // All three results, but spread across different days in the same
    // month — should NOT count now that it's day-scoped, not month-scoped.
    const allThreeDifferentDays = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: false, played_at: "2026-09-11T09:00:00Z" }),
      row({ won: false, draw: true, own_score: 8, opponent_score: 8, played_at: "2026-09-12T09:00:00Z" }),
    ];
    expect(
      computeBadges(allThreeDifferentDays, 3, "2026-01-01T00:00:00Z").find((x) => x.id === "taste-of-everything")
    ).toBeUndefined();

    // All three results in one single day — should count.
    const allThreeSameDay = [
      row({ won: true, played_at: "2026-09-10T09:00:00Z" }),
      row({ won: false, played_at: "2026-09-10T10:00:00Z" }),
      row({ won: false, draw: true, own_score: 8, opponent_score: 8, played_at: "2026-09-10T11:00:00Z" }),
    ];
    expect(computeBadges(allThreeSameDay, 3, "2026-01-01T00:00:00Z").find((x) => x.id === "taste-of-everything")).toBeTruthy();
  });

  it("awards podium-regular at 3 Top-3 monthly finishes, layered on top of the existing top3-finish badge", () => {
    const monthlyFinishes = [
      { yearMonth: "2026-01", rank: 2 },
      { yearMonth: "2026-02", rank: 1 },
    ];
    const badges2 = computeBadges([], 0, "2026-01-01T00:00:00Z", monthlyFinishes);
    expect(badges2.find((x) => x.id === "top3-finish")).toBeTruthy();
    expect(badges2.find((x) => x.id === "podium-regular")).toBeUndefined();

    const monthlyFinishes3 = [...monthlyFinishes, { yearMonth: "2026-03", rank: 3 }];
    const badges3 = computeBadges([], 0, "2026-01-01T00:00:00Z", monthlyFinishes3);
    expect(badges3.find((x) => x.id === "podium-regular")).toBeTruthy();
  });

  it("awards the-apprentice for playing with 6 different established partners while still provisional (lowered from 10)", () => {
    const fivePartners = Array.from({ length: 5 }, (_, i) =>
      row({
        game_number: i + 1,
        teammate_name: `Veteran ${i}`,
        teammate_game_number: 20,
        played_at: `2026-09-1${i}T09:00:00Z`,
      })
    );
    expect(computeBadges(fivePartners, 5, "2026-01-01T00:00:00Z").find((x) => x.id === "the-apprentice")).toBeUndefined();

    const sixPartners = [
      ...fivePartners,
      row({ game_number: 6, teammate_name: "Veteran 5", teammate_game_number: 20, played_at: "2026-09-16T09:00:00Z" }),
    ];
    const badges = computeBadges(sixPartners, 6, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "the-apprentice")).toBeTruthy();

    // Same shape, but the "partner" is also provisional — shouldn't count.
    const gamesWithProvisionalPartner = sixPartners.map((g) => ({ ...g, teammate_game_number: 5 }));
    const badgesProvisional = computeBadges(gamesWithProvisionalPartner, 6, "2026-01-01T00:00:00Z");
    expect(badgesProvisional.find((x) => x.id === "the-apprentice")).toBeUndefined();
  });

  it("distinguishes on-the-up (net monthly gain) from rollercoaster (monthly range), and requires 25+ lifetime games", () => {
    // Rating goes 1500 -> 1650 -> 1500 within one month: a big RANGE (150)
    // but zero NET change, so on-the-up should not fire even though the
    // swing is large. game_number 25/26 so the games-floor isn't the
    // reason it's withheld here.
    const upThenDown = [
      row({ pre_rating: 1500, post_rating: 1650, game_number: 25, played_at: "2026-09-10T09:00:00Z" }),
      row({ pre_rating: 1650, post_rating: 1500, game_number: 26, played_at: "2026-09-11T09:00:00Z" }),
    ];
    expect(computeBadges(upThenDown, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "on-the-up")).toBeUndefined();

    // Rating climbs steadily by 120 net within one month, but entirely
    // within the player's first 24 games — shouldn't count.
    const steadyClimbTooEarly = [
      row({ pre_rating: 1500, post_rating: 1560, game_number: 1, played_at: "2026-09-10T09:00:00Z" }),
      row({ pre_rating: 1560, post_rating: 1620, game_number: 2, played_at: "2026-09-11T09:00:00Z" }),
    ];
    expect(computeBadges(steadyClimbTooEarly, 2, "2026-01-01T00:00:00Z").find((x) => x.id === "on-the-up")).toBeUndefined();

    // Same 120-point climb, but from game 25 onward — should count.
    const steadyClimb = [
      row({ pre_rating: 1500, post_rating: 1560, game_number: 25, played_at: "2026-09-10T09:00:00Z" }),
      row({ pre_rating: 1560, post_rating: 1620, game_number: 26, played_at: "2026-09-11T09:00:00Z" }),
    ];
    const badges = computeBadges(steadyClimb, 26, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "on-the-up")).toBeTruthy();
  });

  it("awards one-dozen only for a 12-0 win", () => {
    const win = row({ won: true, own_score: 12, opponent_score: 0, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([win], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "one-dozen")).toBeTruthy();

    const closeButNo = row({ won: true, own_score: 12, opponent_score: 1, played_at: "2026-09-10T00:00:00Z" });
    expect(computeBadges([closeButNo], 1, "2026-01-01T00:00:00Z").find((x) => x.id === "one-dozen")).toBeUndefined();
  });

  it("requires 25+ lifetime games before century-club points start counting", () => {
    // 25 games at 10 points each (own_score) = 250 points, but every game
    // is BEFORE the 25-game floor (game_number 1-25 means the 25th game
    // itself qualifies — use game_number capped at 24 to stay under it).
    const tooEarly = Array.from({ length: 24 }, (_, i) =>
      row({ own_score: 20, opponent_score: 5, game_number: i + 1, played_at: `2026-09-${10 + (i % 10)}T00:00:00Z` })
    );
    expect(computeBadges(tooEarly, 24, "2026-01-01T00:00:00Z").find((x) => x.id === "century-club")).toBeUndefined();

    // Same volume of points, but starting from game_number 25.
    const eligible = Array.from({ length: 10 }, (_, i) =>
      row({ own_score: 20, opponent_score: 5, game_number: 25 + i, played_at: `2026-09-${10 + (i % 10)}T00:00:00Z` })
    );
    const badges = computeBadges(eligible, 10, "2026-01-01T00:00:00Z");
    expect(badges.find((x) => x.id === "century-club")).toBeTruthy();
  });
});
