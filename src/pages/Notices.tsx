import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import { linkify } from "../lib/linkify";
import { useDraft } from "../lib/useDraft";
import Lightbox from "../components/Lightbox";
import type { NoticeAttachment, NoticeRow } from "../types";

const NOTICE_DRAFT_KEY = "sideline-draft-notice";

// Named "Notices" rather than "Notifications" in the UI — this is a posted
// noticeboard (notes + files like team sheets), not push notifications, so
// the clearer label avoids people expecting a phone alert.
//
// Relative-time formatting for the card meta line ("Today", "2 days ago"),
// matching Ben's mockup — falls back to a plain date beyond a week so old
// notices don't read as "41 days ago". Added 2026-08-28 alongside the
// card redesign; the old absolute-date formatDate() is gone since nothing
// else in this file used it.
function formatRelative(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"];

function isImageFile(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

// Old notices only ever had one attachment, stored in file_path/file_name
// rather than the newer attachments array — this normalizes either shape
// into a single list so the rest of the component doesn't need to care.
function attachmentsFor(notice: NoticeRow): NoticeAttachment[] {
  if (notice.attachments?.length) return notice.attachments;
  if (notice.file_path) return [{ path: notice.file_path, name: notice.file_name ?? "attachment" }];
  return [];
}

// Matches youtube.com/watch?v=, youtube.com/embed/, youtube.com/shorts/,
// and youtu.be/ links (with or without a scheme/www.) and captures the
// 11-character video ID — mirrors the same pattern used in FAQ.tsx for
// video answers. Added 2026-08-28 at Ben's request for YouTube links in
// notices.
const YOUTUBE_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/gi;

function extractYouTubeIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(YOUTUBE_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      ids.push(match[1]);
    }
  }
  return ids;
}

export default function Notices({ isAdmin }: { isAdmin: boolean }) {
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // showForm/editingId/title/body live in one sessionStorage-backed draft
  // — see useDraft.ts — so the form survives a tab reload (Android's
  // file-picker hand-off, backgrounded-tab discard on Safari/Chrome)
  // instead of silently losing what was typed. Attachments/cover image
  // can't be persisted this way (a File can't survive a reload), so if one
  // WAS in progress when the tab reloads, it needs re-picking — see the
  // restore effect below for how existingAttachments/existingCoverPath get
  // their data back on an edit-in-progress reload.
  const [draft, setDraft, clearDraft] = useDraft(NOTICE_DRAFT_KEY, {
    showForm: "",
    editingId: "",
    title: "",
    body: "",
  });
  const showForm = draft.showForm === "1";
  const editingId = draft.editingId || null;
  // Attachments already saved on the notice being edited (only relevant
  // when editingId is set) — marked for removal rather than deleted right
  // away, so cancelling the edit doesn't lose anything.
  const [existingAttachments, setExistingAttachments] = useState<NoticeAttachment[]>([]);
  const [removedPaths, setRemovedPaths] = useState<Set<string>>(new Set());
  // Newly chosen files not yet uploaded.
  const [newFiles, setNewFiles] = useState<File[]>([]);
  // Optional headline/cover image — separate from attachments, uploaded
  // after the notice row exists (same pattern as Events' poster image).
  // Added 2026-08-28.
  const [existingCoverPath, setExistingCoverPath] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Some browsers (e.g. non-Safari on a HEIC upload) can't decode certain
  // image types — track failures per attachment and fall back to a plain
  // download link rather than showing a broken-image icon.
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  // How many notices to show before a "Show more" button appears — keeps
  // the page from growing indefinitely as notices pile up over time.
  const PAGE_SIZE = 6;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function load() {
    setLoading(true);
    supabase
      .from("notices")
      .select("*, players(display_name)")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setNotices((data ?? []) as unknown as NoticeRow[]);
        setLoading(false);
        setVisibleCount(PAGE_SIZE);
      });
  }

  useEffect(load, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVideoId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // If a tab reload happened mid-edit (the case this whole draft system
  // exists for), the restored draft has editingId + title/body back, but
  // existingAttachments/existingCoverPath were only ever in-memory — this
  // re-populates them from the notice's last-saved data once the list has
  // loaded. Any newly-picked-but-not-yet-uploaded file is still lost, same
  // as any reload mid-upload always was; there's no way around that for a
  // raw File reference.
  useEffect(() => {
    if (!editingId || notices.length === 0) return;
    const notice = notices.find((n) => n.id === editingId);
    if (notice) {
      setExistingAttachments(attachmentsFor(notice));
      setExistingCoverPath(notice.cover_path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, notices]);

  function openCreateForm() {
    setDraft({ showForm: "1", editingId: "", title: "", body: "" });
    setExistingAttachments([]);
    setRemovedPaths(new Set());
    setNewFiles([]);
    setExistingCoverPath(null);
    setCoverFile(null);
    setRemoveCover(false);
    setSaveError(null);
  }

  function openEditForm(notice: NoticeRow) {
    setDraft({ showForm: "1", editingId: notice.id, title: notice.title, body: notice.body ?? "" });
    setExistingAttachments(attachmentsFor(notice));
    setRemovedPaths(new Set());
    setNewFiles([]);
    setExistingCoverPath(notice.cover_path);
    setCoverFile(null);
    setRemoveCover(false);
    setSaveError(null);
  }

  function resetForm() {
    clearDraft();
    setExistingAttachments([]);
    setRemovedPaths(new Set());
    setNewFiles([]);
    setExistingCoverPath(null);
    setCoverFile(null);
    setRemoveCover(false);
  }

  function handleFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    setNewFiles((prev) => [...prev, ...chosen]);
    // Reset the input so choosing the same file again later still fires a
    // change event.
    e.target.value = "";
  }

  function handleCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setRemoveCover(false);
    }
    e.target.value = "";
  }

  function toggleRemoveExisting(path: string) {
    setRemovedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function removeNewFile(index: number) {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Wraps the current text selection in the body textarea with the given
  // markers (e.g. "**" for bold, "*" for italic) — a lightweight
  // formatting toolbar so admins don't need to know the markdown-style
  // syntax linkify() renders (see lib/linkify.tsx). Falls back to wrapping
  // an empty pair of markers with the cursor left in between if nothing is
  // selected, same as most simple markdown editors.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  function wrapSelection(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const value = draft.body;
    const selected = value.slice(start, end);
    const newValue = value.slice(0, start) + marker + selected + marker + value.slice(end);
    setDraft((d) => ({ ...d, body: newValue }));
    requestAnimationFrame(() => {
      el.focus();
      const newStart = start + marker.length;
      const newEnd = newStart + selected.length;
      el.setSelectionRange(newStart, newEnd);
    });
  }

  async function handleSave() {
    if (!draft.title.trim()) return;
    setSaving(true);
    setSaveError(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;

    const uploaded: NoticeAttachment[] = [];
    for (const f of newFiles) {
      const ext = f.name.split(".").pop() || "dat";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, f);
      if (uploadError) {
        setSaveError(uploadError.message);
        setSaving(false);
        return;
      }
      uploaded.push({ path, name: f.name });
    }

    const keptExisting = existingAttachments.filter((a) => !removedPaths.has(a.path));
    const attachments = [...keptExisting, ...uploaded];

    let noticeId = editingId;

    if (editingId) {
      const { error } = await supabase
        .from("notices")
        .update({ title: draft.title.trim(), body: draft.body.trim() || null, attachments })
        .eq("id", editingId);

      if (error) {
        setSaveError(error.message);
        setSaving(false);
        return;
      }

      const toRemove = existingAttachments.filter((a) => removedPaths.has(a.path)).map((a) => a.path);
      if (toRemove.length > 0) {
        await supabase.storage.from("notices").remove(toRemove);
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("notices")
        .insert({
          title: draft.title.trim(),
          body: draft.body.trim() || null,
          attachments,
          created_by: userId,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        setSaveError(error?.message ?? "Couldn't post the notice.");
        setSaving(false);
        return;
      }
      noticeId = inserted.id;
    }

    // Headline/cover image — uploaded after the notice row exists so the
    // storage path can be scoped under the notice's own id, same pattern
    // as Events' poster image. A fresh, unique filename per upload (rather
    // than always overwriting the same path) so browsers don't keep
    // showing a cached original after a replacement.
    if (coverFile && noticeId) {
      const ext = coverFile.name.split(".").pop() || "jpg";
      const path = `notices/${noticeId}/cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, coverFile);
      if (uploadError) {
        setSaveError(`Notice saved, but the headline image failed to upload: ${uploadError.message}`);
        setSaving(false);
        load();
        return;
      }
      await supabase.from("notices").update({ cover_path: path }).eq("id", noticeId);
      if (existingCoverPath && existingCoverPath !== path) {
        await supabase.storage.from("notices").remove([existingCoverPath]);
      }
    } else if (removeCover && noticeId) {
      await supabase.from("notices").update({ cover_path: null }).eq("id", noticeId);
      if (existingCoverPath) {
        await supabase.storage.from("notices").remove([existingCoverPath]);
      }
    }

    resetForm();
    setSaving(false);
    load();
  }

  async function handleDelete(notice: NoticeRow) {
    if (!confirm("Remove this notice?")) return;
    const paths = attachmentsFor(notice).map((a) => a.path);
    if (notice.cover_path) paths.push(notice.cover_path);
    if (paths.length > 0) {
      await supabase.storage.from("notices").remove(paths);
    }
    const { error } = await supabase.from("notices").delete().eq("id", notice.id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    load();
  }

  async function togglePinned(notice: NoticeRow) {
    const { error } = await supabase.from("notices").update({ pinned: !notice.pinned }).eq("id", notice.id);
    if (error) {
      alert(`Couldn't update: ${error.message}`);
      return;
    }
    load();
  }

  function fileUrl(path: string) {
    return supabase.storage.from("notices").getPublicUrl(path).data.publicUrl;
  }

  if (loading) return <p>Loading notices…</p>;
  if (error) return <p className="error">{error}</p>;

  const actionBtnStyle = {
    marginTop: 0,
    width: "auto" as const,
    background: "transparent",
    padding: "4px 8px",
    fontSize: "0.78rem",
    fontWeight: 600,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>Notices</h1>
        {isAdmin && (
          <button
            style={{ marginTop: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => (showForm ? resetForm() : openCreateForm())}
          >
            {showForm ? "Cancel" : "Post notice"}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>{editingId ? "Edit notice" : "New notice"}</h2>

          <label style={{ marginTop: 0 }}>Title</label>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="e.g. Saturday team sheet"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Note (optional)</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => wrapSelection("**")}
              title="Bold"
              style={{ width: "auto", marginTop: 0, padding: "4px 12px", fontWeight: 700 }}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => wrapSelection("*")}
              title="Italic"
              style={{ width: "auto", marginTop: 0, padding: "4px 12px", fontStyle: "italic" }}
            >
              i
            </button>
          </div>
          <textarea
            ref={bodyRef}
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={6}
            style={{ fontFamily: "inherit", fontSize: "1rem", resize: "vertical", minHeight: 140 }}
          />
          <p className="stat-meta" style={{ marginTop: 4 }}>
            Select some text and tap B or i to format it, or type **bold** / *italic* yourself. Paste a YouTube link
            anywhere and it'll show as a tap-to-play thumbnail.
          </p>

          <label>Headline image (optional)</label>
          {existingCoverPath && !removeCover && !coverFile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <img
                src={fileUrl(existingCoverPath)}
                alt=""
                style={{ width: 96, height: 54, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
              />
              <span className="link-action" role="button" tabIndex={0} onClick={() => setRemoveCover(true)}>
                Remove
              </span>
            </div>
          )}
          {coverFile && (
            <p className="stat-meta" style={{ marginTop: 0 }}>
              Selected: {coverFile.name}
            </p>
          )}
          <input type="file" accept="image/*" onChange={handleCoverChange} />
          <p className="stat-meta" style={{ marginTop: 4 }}>
            Shown as a banner across the top of the card — separate from the attachments below.
          </p>

          <label>Attachments (optional)</label>
          <input type="file" multiple onChange={handleFilesChosen} />

          {existingAttachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {existingAttachments.map((a) => {
                const removed = removedPaths.has(a.path);
                return (
                  <div
                    key={a.path}
                    style={{
                      opacity: removed ? 0.45 : 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "4px 8px",
                      fontSize: "0.78rem",
                    }}
                  >
                    <span>
                      {isImageFile(a.name) ? "🖼️" : "📎"} {a.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleRemoveExisting(a.path)}
                      style={{
                        marginTop: 0,
                        width: "auto",
                        padding: "2px 6px",
                        fontSize: "0.7rem",
                        background: "transparent",
                        color: removed ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {removed ? "Undo" : "Remove"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {newFiles.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {newFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "4px 8px",
                    fontSize: "0.78rem",
                  }}
                >
                  <span>
                    {isImageFile(f.name) ? "🖼️" : "📎"} {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeNewFile(i)}
                    style={{
                      marginTop: 0,
                      width: "auto",
                      padding: "2px 6px",
                      fontSize: "0.7rem",
                      background: "transparent",
                      color: "var(--danger)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {saveError && <p className="error">{saveError}</p>}

          <button disabled={saving || !draft.title.trim()} onClick={handleSave}>
            {saving ? (editingId ? "Saving…" : "Posting…") : editingId ? "Save changes" : "Post notice"}
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {notices.length === 0 && (
          <p className="card stat-meta" style={{ margin: 0 }}>
            No notices yet.
          </p>
        )}
        {notices.slice(0, visibleCount).map((n) => {
          const atts = attachmentsFor(n);
          const imageAtts = atts.filter((a) => isImageFile(a.name) && !thumbFailed.has(a.path));
          const fileAtts = atts.filter((a) => !isImageFile(a.name) || thumbFailed.has(a.path));
          const youtubeIds = n.body ? extractYouTubeIds(n.body) : [];
          return (
            <div key={n.id} className={`card notice-card${n.pinned ? " notice-card-pinned" : ""}`}>
              {n.cover_path && <img className="notice-cover" src={fileUrl(n.cover_path)} alt="" />}
              <div className={n.pinned ? "notice-card-body-pinned" : undefined} style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    {n.pinned && <div className="pin-badge">📌 Pinned</div>}
                    <div className="notice-title">{n.title}</div>
                    <div className="meta">
                      {formatRelative(n.created_at)} · {n.players?.display_name ?? "Admin"}
                    </div>
                  </div>
                  {isAdmin && (
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 2, flexShrink: 0 }}>
                      <button onClick={() => togglePinned(n)} style={{ ...actionBtnStyle, color: "var(--orange-600)" }}>
                        {n.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button onClick={() => openEditForm(n)} style={{ ...actionBtnStyle, color: "var(--navy-500)" }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(n)} style={{ ...actionBtnStyle, color: "var(--danger)" }}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {n.body && (
                  <p className="rich-text" style={{ margin: "10px 0 0" }}>
                    {linkify(n.body)}
                  </p>
                )}

                {youtubeIds.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                    {youtubeIds.map((id) => (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        aria-label="Play video"
                        onClick={() => setVideoId(id)}
                        style={{
                          position: "relative",
                          width: 160,
                          aspectRatio: "16 / 9",
                          borderRadius: 8,
                          overflow: "hidden",
                          border: "1px solid var(--border)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.28)",
                          }}
                        >
                          <span
                            style={{
                              width: 0,
                              height: 0,
                              borderTop: "9px solid transparent",
                              borderBottom: "9px solid transparent",
                              borderLeft: "14px solid #fff",
                              marginLeft: 3,
                            }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {imageAtts.length > 0 && (
                  <div className="notice-photo-grid">
                    {imageAtts.map((a) => (
                      <button
                        key={a.path}
                        type="button"
                        className="notice-photo-thumb"
                        onClick={() => setLightbox({ src: fileUrl(a.path), alt: a.name })}
                      >
                        <img
                          src={fileUrl(a.path)}
                          alt={a.name}
                          loading="lazy"
                          onError={() => setThumbFailed((prev) => new Set(prev).add(a.path))}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {fileAtts.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {fileAtts.map((a) => (
                      <span
                        key={a.path}
                        className="link-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => window.open(fileUrl(a.path), "_blank", "noopener,noreferrer")}
                        style={{ display: "inline-block", fontWeight: 600, fontSize: "0.85rem" }}
                      >
                        📎 {a.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {notices.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            style={{
              marginTop: 0,
              background: "transparent",
              color: "var(--navy-500)",
              border: "1px solid var(--border)",
            }}
          >
            Show more ({notices.length - visibleCount} more)
          </button>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}

      {videoId && (
        <div className="lightbox-overlay" onClick={() => setVideoId(null)}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ width: "min(92vw, 720px)", aspectRatio: "16 / 9" }}>
            <iframe
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
              title="YouTube video"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }}
            />
          </div>
          <button className="lightbox-close" onClick={() => setVideoId(null)} aria-label="Close">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
