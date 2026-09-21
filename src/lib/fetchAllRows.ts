// Fetches every row of a query, looping past PostgREST's default 1000-row
// cap (added 2026-09-21, after this silently truncated player_match_history
// on Club Stats — the club now has 1000+ history rows, so a plain
// `.select("*")` was quietly dropping whatever came after row 1000. Rows
// beyond the cap come back missing with no error, so this had been failing
// silently rather than throwing — the first visible symptom was a
// recently-risen top-5 player having no data points on the trajectory
// chart, because almost all of their games were the ones getting dropped.
//
// Usage: pass a function that applies `.range(from, to)` to your own query
// builder (with an `.order(...)` already applied — required for range
// pagination to return stable, non-overlapping pages) and returns it.
//
//   const { data, error } = await fetchAllRows<Row>((from, to) =>
//     supabase.from("player_match_history").select("*").order("played_at").range(from, to)
//   );
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const all: T[] = [];
  let from = 0;

  // Bounded loop (not a bare `while (true)`) — a broken `.range()`
  // implementation that always echoes the same page back should eventually
  // give up rather than fetch forever. 200 pages is 200,000 rows, far more
  // than this club will hit for a very long time.
  for (let page = 0; page < 200; page++) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error: error.message };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: all, error: null };
}
