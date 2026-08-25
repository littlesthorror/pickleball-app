# How Sideline's rating system works

*A plain-English explainer for the head coach and players — comparing the old club scoring system to the one Sideline uses now.*

## Do both players on a team get the same rating change?

Yes. After a match, the two players on a team are treated as a single unit — their team's "rating" is just the average of their two individual ratings — and whatever change that team earns or loses is applied **identically to both players**. A 1200-rated player and a 1600-rated player teaming up will move by the exact same number of points as each other after that match, even though they started very differently rated.

## The old system, recapped

| Team's score | Points earned |
|---|---|
| 0 | 0 |
| 1–3 | 1 |
| 4–6 | 2 |
| 7–10 | 3 |
| 11–14 | 4 |
| 15–19 | 5 |
| 20+ | 6 |

Plus **+1 for a win**.

## Does this still stand in essence?

Broadly, yes — the core idea hasn't changed: **scoring more points earns you more, and winning is worth extra.** That principle carries straight through.

What's changed is how finely it's measured, and what else gets factored in.

**The old system** used a fixed lookup table (7 buckets) and a flat rate of movement for every player, every game — a brand new player and a 200-game veteran both moved by exactly the same amount for the same result. It also didn't take into account who you were playing — beating a much stronger team scored exactly the same as beating a much weaker one, as long as the margin was similar.

**The new system** replaces the 7-bucket table with a continuous measure — your team's actual score as a fraction of the game's total points (an 11–5 win is scored as 11 ÷ 16 = 0.6875, rather than being rounded into a "7–10 → 3 points" bucket). And instead of a flat rate, the *size* of the rating swing is worked out dynamically from two things:

1. **How surprising the result was.** Beating a team rated well above you swings your rating more than beating a team rated below you — the old system had no way to account for this at all.
2. **How settled your rating is.** New players' ratings move quickly at first, so the system can find their true level fast, then settle down and move more gradually once they're established (around 12 games in).

## Why the new system is better

- **It rewards beating good opposition**, not just running up the score. Two 11–3 wins aren't treated the same if one was against the club's best pair and the other wasn't.
- **It's fairer to new players.** Nobody has to "wait their turn" at a flat rate — the system corrects itself quickly for someone whose true level isn't yet known, then stabilises.
- **It's more precise**, since every point of margin counts rather than being rounded into one of 7 buckets.
- **It knows what it doesn't know.** The system tracks a confidence measure (called RD) alongside the rating itself, which is why newer players are shown as "still establishing" rather than being ranked outright from game one.

In short: the same basic spirit as the original system (bigger wins count more, winning always counts), just measured continuously instead of in buckets, and adjusted for who you actually beat rather than just by how much.
