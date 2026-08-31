// Replaces bare "Loading…" text with a small branded spinner — added
// 2026-08-31 as part of the same "clunky" polish pass as ConfirmDialog and
// Toast. A plain unstyled <p>Loading dashboard…</p> flashing up on every
// tab switch reads as unfinished; this matches the app's own look instead.
export default function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loading">
      <span className="page-loading-spinner" aria-hidden="true" />
      <span className="stat-meta" style={{ margin: 0 }}>
        {label}
      </span>
    </div>
  );
}
