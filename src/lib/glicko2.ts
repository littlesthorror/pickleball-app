// Client-side mirror of supabase/functions/confirm-match/glicko2.ts's
// updateRating() — needed so Match Entry's "Impact preview" (added
// 2026-08-29, inspired by DUPR's Impact tool) can show the predicted
// rating swing for a hypothetical score without a network round-trip,
// same reasoning predict.ts already documents for the win-probability
// preview. This is the well-established textbook Glicko-2 algorithm (not
// the risky 2v2 team-split bit — that logic lives in src/lib/impact.ts,
// mirroring supabase/functions/confirm-match/index.ts instead).
//
// IMPORTANT: if the server-side glicko2.ts ever changes, mirror the change
// here too, or the preview will quietly drift from what actually gets
// applied when the match is submitted.

const GLICKO2_SCALE = 173.7178;
const TAU = 0.5;

export interface Glicko2Player {
  rating: number;
  rd: number;
  volatility: number;
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
