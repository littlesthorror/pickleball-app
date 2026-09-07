// Shared "Show more (N more)" / "Show less" pagination control (2026-09-07,
// Ben's request — "can Show more and Show less be more uniform looking
// across the site"). Before this, every page that paginated a list
// (Leaderboard x4, Notices, AdminManagement, Events x2, Dashboard x3)
// hand-rolled its own copy of the same button + link pair inline, and they'd
// quietly drifted apart — e.g. some set `marginTop: 0` on the button and
// some didn't, so the gap above it varied page to page, and Dashboard's
// Badges card used a totally different single-button-that-relabels-itself
// pattern instead of a separate "Show less" link like everywhere else. This
// component is the one place that pattern lives now, so every instance of
// it looks and behaves identically and can't drift again.
export function ShowMoreLess({
  hasMore,
  expanded,
  moreCount,
  onShowMore,
  onShowLess,
}: {
  // Whether there's anything currently hidden that a "Show more" tap would reveal.
  hasMore: boolean;
  // Whether we're past the initial page size, i.e. a "Show less" link should be offered.
  expanded: boolean;
  // How many additional items "Show more" would reveal — shown in the button label.
  moreCount: number;
  onShowMore: () => void;
  onShowLess: () => void;
}) {
  if (!hasMore && !expanded) return null;
  return (
    <div className="show-more-row">
      {hasMore && (
        <button type="button" className="show-more-btn" onClick={onShowMore}>
          Show more ({moreCount} more)
        </button>
      )}
      {expanded && (
        <span className="link-action" role="button" tabIndex={0} onClick={onShowLess}>
          Show less
        </span>
      )}
    </div>
  );
}
