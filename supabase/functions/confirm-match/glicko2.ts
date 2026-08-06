// Standard single-opponent Glicko-2 algorithm (Mark Glickman's spec).
// This part is NOT the risky bit — the math below is the well-established
// textbook version. The 2v2 team-split question (see index.ts) has been
// resolved by reading the club's old spreadsheet's Apps Script source.

const GLICKO2_SCALE = 173.7178;
const TAU = 0.5; // reasonable default; controls how fast volatility can change

export interface Glicko2Player {
  rating: number; // Glicko (not Glicko-2) scale, e.g. 1500
  rd: number; // Glicko (not Glicko-2) scale, e.g. 350
  volatility: number; // e.g. 0.06
}

function toGlicko2Scale(p: Glicko2Player) {
  return {
    mu: (p.rating - 1500) / GLICKO2_SCALE,
    phi: p.rd / GLICKO2_SCALE,
    sigma: p.volatility,
  };
}

function fromGlicko2Scale(mu: number, phi: number, sigma: number): Glicko2Player {
  return {
    rating: mu * GLICKO2_SCALE + 1500,
    rd: phi * GLICKO2_SCALE,
    volatility: sigma,
  };
}

function g(phi: number) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muOpponent: number, phiOpponent: number) {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

/**
 * Updates one player's rating after a single game against one opponent.
 *
 * `score` is a number from 0 to 1 — NOT restricted to win(1)/loss(0). The
 * club's existing spreadsheet encodes margin of victory by using each team's
 * raw score as a fraction of the game's total points (e.g. an 11-5 win is
 * score = 11/16 = 0.6875, confirmed by reading the sheet's Apps Script
 * source on 2026-08-04). Glicko-2's math works the same way with a
 * fractional score as with a binary one, so this preserves that behavior.
 */
export function updateRating(
  player: Glicko2Player,
  opponent: Glicko2Player,
  score: number
): Glicko2Player {
  const { mu, phi, sigma } = toGlicko2Scale(player);
  const { mu: muOpp, phi: phiOpp } = toGlicko2Scale(opponent);

  const gPhiOpp = g(phiOpp);
  const e = E(mu, muOpp, phiOpp);
  const v = 1 / (gPhiOpp * gPhiOpp * e * (1 - e));
  const delta = v * gPhiOpp * (score - e);

  // Iteratively solve for new volatility (Illinois algorithm, per the
  // Glicko-2 paper).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * gPhiOpp * (score - e);

  return fromGlicko2Scale(newMu, newPhi, newSigma);
}
