import { useEffect, useState } from "react";
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
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

export default function Notices({ isAdmin }: { isAdmin: boolean }) {
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // showForm/editingId/title/body live in one sessionStorage-backed draft
  // — see useDraft.ts — so the form survives a tab reload (Android's
  // file-picker hand-off, backgrounded-tab discard on Safari/Chrome)
  // instead of silently losing what was typed. Attachments can't be
  // persisted this way (a File can't survive a reload), so if one WAS in
  // progress when the tab reloads, it needs re-picking — see the restore
  // effect below for how existingAttachments gets its data back on an
  // edit-in-progress reload.
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Some browsers (e.g. non-Safari on a HEIC upload) can't decode certain
  // image types — track failures per attachment and fall back to a plain
  // download link rather than showing a broken-image icon.
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  // How many notices to show before a "Show more" button appears — keeps
  // the page from growing indefinitely as notices pile up over time.
  const PAGE_SIZE = 6;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function load() {
    setLoading(true);
    supabase
      .from("notices")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setNotices((data ?? []) as NoticeRow[]);
        setLoading(false);
        setVisibleCount(PAGE_SIZE);
      });
  }

  useEffect(load, []);

  // If a tab reload happened mid-edit (the case this whole draft system
  // exists for), the restored draft has editingId + title/body back, but
  // existingAttachments was only ever in-memory — this re-populates it
  // from the notice's last-saved attachments once the list has loaded.
  // Any newly-picked-but-not-yet-uploaded file is still lost, same as any
  // reload mid-upload always was; there's no way around that for a raw
  // File reference.
  useEffect(() => {
    if (!editingId || notices.length === 0) return;
    const notice = notices.find((n) => n.id === editingId);
    if (notice) setExistingAttachments(attachmentsFor(notice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, notices]);

  function openCreateForm() {
    setDraft({ showForm: "1", editingId: "", title: "", body: "" });
    setExistingAttachments([]);
    setRemovedPaths(new Set());
    setNewFiles([]);
    setSaveError(null);
  }

  function openEditForm(notice: NoticeRow) {
    setDraft({ showForm: "1", editingId: notice.id, title: notice.title, body: notice.body ?? "" });
    setExistingAttachments(attachmentsFor(notice));
    setRemovedPaths(new Set());
    setNewFiles([]);
    setSaveError(null);
  }

  function resetForm() {
    clearDraft();
    setExistingAttachments([]);
    setRemovedPaths(new Set());
    setNewFiles([]);
  }

  function handleFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    setNewFiles((prev) => [...prev, ...chosen]);
    // Reset the input so choosing the same file again later still fires a
    // change event.
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
      const { error } = await supabase.from("notices").insert({
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        attachments,
        created_by: userId,
      });

      if (error) {
        setSaveError(error.message);
        setSaving(false);
        return;
      }
    }

    resetForm();
    setSaving(false);
    load();
  }

  async function handleDelete(notice: NoticeRow) {
    if (!confirm("Remove this notice?")) return;
    const paths = attachmentsFor(notice).map((a) => a.path);
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

  function fileUrl(path: string) {
    return supabase.storage.from("notices").getPublicUrl(path).data.publicUrl;
  }

  if (loading) return <p>Loading notices…</p>;
  if (error) return <p className="error">{error}</p>;

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
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={3}
            style={{ fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }}
          />

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

      <div className="card" style={{ marginTop: 16 }}>
        {notices.length === 0 && <p className="stat-meta">No notices yet.</p>}
        {notices.slice(0, visibleCount).map((n) => (
          <div className="match-row" key={n.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="notice-title">{n.title}</div>
                <div className="meta">{formatDate(n.created_at)}</div>
              </div>
              {isAdmin && (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => openEditForm(n)}
                    style={{
                      marginTop: 0,
                      width: "auto",
                      background: "transparent",
                      color: "var(--navy-500)",
                      padding: "4px 8px",
                      fontSize: "0.78rem",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(n)}
                    style={{
                      marginTop: 0,
                      width: "auto",
                      background: "transparent",
                      color: "var(--danger)",
                      padding: "4px 8px",
                      fontSize: "0.78rem",
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            {n.body && (
              <p className="rich-text" style={{ margin: "8px 0 0" }}>
                {linkify(n.body)}
              </p>
            )}
            {attachmentsFor(n).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {attachmentsFor(n).map((a) =>
                  isImageFile(a.name) && !thumbFailed.has(a.path) ? (
                    <button
                      key={a.path}
                      type="button"
                      onClick={() => setLightbox({ src: fileUrl(a.path), alt: a.name })}
                      style={{ margin: 0, padding: 0, width: "auto", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <img
                        src={fileUrl(a.path)}
                        alt={a.name}
                        loading="lazy"
                        onError={() => setThumbFailed((prev) => new Set(prev).add(a.path))}
                        style={{
                          width: 96,
                          height: 96,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          display: "block",
                        }}
                      />
                    </button>
                  ) : (
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
                  )
                )}
              </div>
            )}
          </div>
        ))}
        {notices.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            style={{
              marginTop: 12,
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
    </div>
  );
}
