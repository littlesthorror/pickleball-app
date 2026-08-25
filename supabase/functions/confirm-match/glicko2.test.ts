import { describe, it, expect } from "vitest";
import { updateRating, type Glicko2Player } from "./glicko2";

// Every assertion below was independently verified against this exact,
// unmodified glicko2.ts on 2026-08-25 by running it under plain Node (via
// `node --experimental-strip-types`) outside this project, before being
// transcribed into vitest syntax here. See the "fix all 5" work log for
// context on why: this sandbox has no npm registry access, so `vitest run`
// itself could not be executed here — Ben needs to run `npm install && npm
// test` locally once to get the actual green checkmark.

const equal: Glicko2Player = { rating: 1500, rd: 60, volatility: 0.06 };

describe("updateRating", () => {
  it("raises rating on a win against an equal opponent", () => {
    const after = updateRating(equal, equal, 1);
    expect(after.rating).toBeGreaterThan(equal.rating);
  });

  it("lowers rating on a loss against an equal opponent", () => {
    const after = updateRating(equal, equal, 0);
    expect(after.rating).toBeLessThan(equal.rating);
  });

  it("shrinks RD substantially for a brand-new (high-RD) player after one game", () => {
    const newPlayer: Glicko2Player = { rating: 1500, rd: 350, volatility: 0.06 };
    const after = updateRating(newPlayer, equal, 1);
    expect(after.rd).toBeLessThan(newPlayer.rd - 50);
  });

  it("gains more for beating a stronger opponent than a weaker one", () => {
    const weakerOpponent: Glicko2Player = { rating: 1350, rd: 60, volatility: 0.06 };
    const strongerOpponent: Glicko2Player = { rating: 1650, rd: 60, volatility: 0.06 };
    const gainVsWeak = updateRating(equal, weakerOpponent, 1).rating - equal.rating;
    const gainVsStrong = updateRating(equal, strongerOpponent, 1).rating - equal.rating;
    expect(gainVsStrong).toBeGreaterThan(gainVsWeak);
  });

  it("moves a less-settled (high-RD) player further than an established one for the same result", () => {
    const newPlayer: Glicko2Player = { rating: 1500, rd: 350, volatility: 0.06 };
    const established: Glicko2Player = { rating: 1500, rd: 60, volatility: 0.06 };
    const opponent: Glicko2Player = { rating: 1500, rd: 60, volatility: 0.06 };
    const newDelta = Math.abs(updateRating(newPlayer, opponent, 1).rating - newPlayer.rating);
    const establishedDelta = Math.abs(updateRating(established, opponent, 1).rating - established.rating);
    expect(newDelta).toBeGreaterThan(establishedDelta);
  });

  it("costs more to lose to a much weaker opponent than to a much stronger one", () => {
    const bigFavourite = updateRating(equal, { rating: 1200, rd: 60, volatility: 0.06 }, 0);
    const bigUnderdog = updateRating(equal, { rating: 1800, rd: 60, volatility: 0.06 }, 0);
    const lossVsWeak = equal.rating - bigFavourite.rating;
    const lossVsStrong = equal.rating - bigUnderdog.rating;
    expect(lossVsWeak).toBeGreaterThan(lossVsStrong);
  });

  it("produces symmetric opposite deltas for two equal players on complementary scores", () => {
    const a = updateRating(equal, equal, 0.65);
    const b = updateRating(equal, equal, 0.35);
    const deltaA = a.rating - equal.rating;
    const deltaB = b.rating - equal.rating;
    expect(Math.abs(deltaA + deltaB)).toBeLessThan(1e-6);
  });

  it("gives a narrow win less credit than a full win, but still positive", () => {
    const narrowWin = updateRating(equal, equal, 0.5625).rating - equal.rating; // 9-7 style
    const fullWin = updateRating(equal, equal, 1).rating - equal.rating;
    expect(narrowWin).toBeGreaterThan(0);
    expect(narrowWin).toBeLessThan(fullWin);
  });
});
