import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import { renderRichBody } from "../lib/richBody";
import { useDraft } from "../lib/useDraft";
import Lightbox from "../components/Lightbox";
import { compressImageFile } from "../lib/imageCompress";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import type { NoticeAttachment, NoticePollVote, NoticeRow } from "../types";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";

const NOTICE_DRAFT_KEY = "sideline-draft-notice";

// On some Android phones, tapping "Files" in the attachment/cover-image
// picker and choosing something from Google Drive causes Chrome to reload
// the tab under memory pressure while the file is being fetched from the
// cloud — the same underlying issue useDraft.ts was built around, except
// there's no fixing this part: a picked File object can't survive a real
// page reload, so the attachment is just gone, with no error and no clue
// why. This key is "armed" in sessionStorage the instant either file input
// is opened and cleared the instant its change event actually fires — so
// if the marker is still sitting there on the next page load, a reload
// happened mid-pick, and the admin gets a clear explanation instead of a
// silent failure. Added 2026-08-29 after an admin on Android/Samsung kept
// hitting this specifically via Attachments > Files > Google Drive.
const FILE_PICKER_ARMED_KEY = "sideline-notice-filepicker-armed";

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

// True once a notice has actually been edited after posting — compares
// with a minute of slack rather than exact equality, since created_at and
// updated_at are set by two separate `now()` calls (column default vs. the
// trigger) a few milliseconds apart on insert.
function wasEdited(n: NoticeRow) {
  return new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 60_000;
}

// Shown as the card banner when a notice has no headline image of its
// own — the club badge, so every notice still gets a real, on-brand
// cover rather than a blank/missing top. Lives in public/ so Vite serves
// it as a static asset at this exact path. Added 2026-08-27 at Ben's
// request; object-fit: cover on .notice-cover crops it to 16:9.
const DEFAULT_COVER_URL = "/notice-default-cover.jpg";

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

// Renders a poll's question, options (with live vote counts/percentages
// once results are visible), and lets the signed-in player cast or change
// their vote. Kept as its own component since it has real interaction
// state (which option is being submitted) separate from the rest of the
// card. Results are shown to everyone immediately — Ben's polls are things
// like "best night for socials", not secret ballots, so there's no reason
// to hide the running tally from someone who hasn't voted yet.
function NoticePoll({
  notice,
  playerId,
  votes,
  onVote,
}: {
  notice: NoticeRow;
  playerId: string;
  votes: NoticePollVote[];
  onVote: (noticeId: string, optionIndex: number) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const myVote = votes.find((v) => v.player_id === playerId);
  const totalVotes = votes.length;

  async function handleVote(optionIndex: number) {
    if (submitting || optionIndex === myVote?.option_index) return;
    setSubmitting(true);
    await onVote(notice.id, optionIndex);
    setSubmitting(false);
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "rgba(10, 26, 51, 0.02)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--heading)", marginBottom: 8 }}>
        📊 {notice.poll_question}
      </div>
      {notice.poll_options.map((option, i) => {
        const optionVotes = votes.filter((v) => v.option_index === i);
        const count = optionVotes.length;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const selected = myVote?.option_index === i;
        // Who voted for this option — shown to everyone, same as the
        // running tally itself (see the comment on NoticePoll above: these
        // are things like "best night for socials", not secret ballots).
        const voterNames = optionVotes
          .map((v) => v.players?.display_name ?? "Unknown")
          .sort((a, b) => a.localeCompare(b));
        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => handleVote(i)}
            style={{
              position: "relative",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: selected ? "1.5px solid var(--orange-600)" : "1px solid var(--border)",
              cursor: submitting ? "default" : "pointer",
              overflow: "hidden",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${pct}%`,
                background: selected ? "var(--orange-100)" : "rgba(10, 26, 51, 0.05)",
                transition: "width 0.2s ease",
              }}
            />
            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <span style={{ fontWeight: selected ? 700 : 500 }}>
                {selected ? "✓ " : ""}
                {option}
              </span>
              <span className="stat-meta" style={{ margin: 0 }}>
                {count} · {pct}%
              </span>
            </div>
            {voterNames.length > 0 && (
              <div className="stat-meta" style={{ position: "relative", marginTop: 4, marginBottom: 0, fontSize: "0.72rem" }}>
                {voterNames.join(", ")}
              </div>
            )}
          </div>
        );
      })}
      <p className="stat-meta" style={{ marginTop: 8, marginBottom: 0 }}>
        {totalVotes} vote{totalVotes === 1 ? "" : "s"} so far{myVote ? " · tap another option to change yours" : ""}
      </p>
    </div>
  );
}

export default function Notices({ isAdmin, playerId }: { isAdmin: boolean; playerId: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Poll votes for every poll-enabled notice currently loaded, keyed by
  // notice id — fetched alongside the notices themselves in load() rather
  // than per-card, so opening the page doesn't fire N extra queries.
  const [pollVotes, setPollVotes] = useState<Map<string, NoticePollVote[]>>(new Map());

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
    // Poll fields (2026-08-28) — pollOptionsJson holds a JSON-stringified
    // string[] since useDraft is deliberately string-only (see its own
    // comment); parsed/re-stringified around every edit below.
    pollEnabled: "",
    pollQuestion: "",
    pollOptionsJson: "",
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
  // The New/Edit notice form renders near the top of the page, above the
  // notice list — on a phone, tapping "Post notice" or a notice's "Edit"
  // link while scrolled down (past several notices) opened the form
  // off-screen above the fold with no visual cue it had even appeared, so
  // it looked like nothing happened. Scrolling it into view automatically
  // (2026-08-28) makes the jump obvious instead of silent. See the
  // matching fix + comment in Events.tsx's admin form.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  // The video overlay is rendered inline below (Lightbox.tsx locks scroll
  // itself for the image lightbox) — see useBodyScrollLock for why this
  // matters on mobile.
  useBodyScrollLock(!!videoId);
  // See FILE_PICKER_ARMED_KEY above — set on mount if a file picker was
  // opened but the page reloaded before its change event ever fired.
  const [filePickerReloadWarning, setFilePickerReloadWarning] = useState(false);
  // How many notices to show before a "Show more" button appears — keeps
  // the page from growing indefinitely as notices pile up over time.
  // Reduced from 6 to 3 (2026-08-28) at Ben's request, to keep the page
  // feeling less crowded.
  const PAGE_SIZE = 3;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function load() {
    setLoading(true);
    supabase
      .from("notices")
      .select("*, players(display_name)")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as unknown as NoticeRow[];
        setNotices(rows);
        setLoading(false);
        setVisibleCount(PAGE_SIZE);

        const pollNoticeIds = rows.filter((n) => n.poll_enabled).map((n) => n.id);
        if (pollNoticeIds.length === 0) {
          setPollVotes(new Map());
          return;
        }
        supabase
          .from("notice_poll_votes")
          .select("*, players(display_name)")
          .in("notice_id", pollNoticeIds)
          .then(({ data: voteRows, error: voteError }) => {
            if (voteError || !voteRows) return;
            const byNotice = new Map<string, NoticePollVote[]>();
            for (const v of voteRows as NoticePollVote[]) {
              const list = byNotice.get(v.notice_id) ?? [];
              list.push(v);
              byNotice.set(v.notice_id, list);
            }
            setPollVotes(byNotice);
          });
      });
  }

  async function handleVote(noticeId: string, optionIndex: number) {
    const { error } = await supabase
      .from("notice_poll_votes")
      .upsert({ notice_id: noticeId, player_id: playerId, option_index: optionIndex }, { onConflict: "notice_id,player_id" });
    if (error) {
      toast.error(`Couldn't record your vote: ${error.message}`);
      return;
    }
    const { data: voteRows } = await supabase
      .from("notice_poll_votes")
      .select("*, players(display_name)")
      .eq("notice_id", noticeId);
    setPollVotes((prev) => {
      const next = new Map(prev);
      next.set(noticeId, (voteRows ?? []) as NoticePollVote[]);
      return next;
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

  // Runs once on mount — if a file picker was armed but never fired its
  // change event, the page reloaded mid-pick (see FILE_PICKER_ARMED_KEY).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(FILE_PICKER_ARMED_KEY) === "1") {
        setFilePickerReloadWarning(true);
        sessionStorage.removeItem(FILE_PICKER_ARMED_KEY);
      }
    } catch {
      // Storage unavailable — nothing to detect, fail quiet.
    }
  }, []);

  function armFilePicker() {
    try {
      sessionStorage.setItem(FILE_PICKER_ARMED_KEY, "1");
    } catch {
      // ignore
    }
  }

  function disarmFilePicker() {
    try {
      sessionStorage.removeItem(FILE_PICKER_ARMED_KEY);
    } catch {
      // ignore
    }
    setFilePickerReloadWarning(false);
  }

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
    setDraft({ showForm: "1", editingId: "", title: "", body: "", pollEnabled: "", pollQuestion: "", pollOptionsJson: "" });
    setExistingAttachments([]);
    setRemovedPaths(new Set());
    setNewFiles([]);
    setExistingCoverPath(null);
    setCoverFile(null);
    setRemoveCover(false);
    setSaveError(null);
  }

  function openEditForm(notice: NoticeRow) {
    setDraft({
      showForm: "1",
      editingId: notice.id,
      title: notice.title,
      body: notice.body ?? "",
      pollEnabled: notice.poll_enabled ? "1" : "",
      pollQuestion: notice.poll_question ?? "",
      pollOptionsJson: JSON.stringify(notice.poll_options?.length ? notice.poll_options : ["", ""]),
    });
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
    disarmFilePicker();
  }

  function handleFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    // The change event firing at all — even with an empty selection, e.g.
    // the picker was cancelled — means no reload happened this time.
    disarmFilePicker();
    const chosen = Array.from(e.target.files ?? []);
    setNewFiles((prev) => [...prev, ...chosen]);
    // Reset the input so choosing the same file again later still fires a
    // change event.
    e.target.value = "";
  }

  function handleCoverChange(e: ChangeEvent<HTMLInputElement>) {
    disarmFilePicker();
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

  // Inserts a ready-to-edit block skeleton at the cursor — shared by the
  // "Table" and "List" toolbar buttons below. See lib/richBody.tsx for how
  // "|" lines become a <table> and "- " lines become an auto-flowing
  // <ul>; these buttons just save admins from typing the syntax from
  // scratch. A blank line before the block keeps it from merging with
  // whatever text (if any) already precedes the cursor — richBody.tsx
  // only treats *consecutive* matching lines as a block, so running
  // straight into an existing line that happens to contain "|" or start
  // with "-" could otherwise swallow it.
  function insertTemplate(template: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const value = draft.body;
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const newValue = value.slice(0, start) + prefix + template + value.slice(end);
    setDraft((d) => ({ ...d, body: newValue }));
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + prefix.length;
      el.setSelectionRange(selStart, selStart + template.length);
    });
  }

  function insertTableTemplate() {
    insertTemplate("Column A | Column B\nRow 1 | Row 1\nRow 2 | Row 2");
  }

  function insertListTemplate() {
    insertTemplate("- Item 1\n- Item 2\n- Item 3");
  }

  async function handleSave() {
    if (!draft.title.trim()) return;
    setSaving(true);
    setSaveError(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;

    const uploaded: NoticeAttachment[] = [];
    for (const f of newFiles) {
      // Downscale+re-encode photo attachments before upload (2026-08-28) —
      // a raw phone photo can be several MB at 3-4000px, none of which is
      // needed for a noticeboard thumbnail/lightbox. Non-image files (and
      // GIFs/SVGs) pass through untouched — see lib/imageCompress.ts.
      let compressed: File;
      try {
        compressed = await compressImageFile(f);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't process one of the attachments.");
        setSaving(false);
        return;
      }
      const ext = compressed.name.split(".").pop() || "dat";
      const path = `${crypto.randomUUID()}.${ext}`;
      // cacheControl: uploads get a unique path already, so it's safe to
      // tell browsers/CDN to cache it hard rather than the 1hr default —
      // cuts repeat egress for members re-visiting a notice (2026-08-29,
      // part of the fix for Supabase's Fair Use Policy bandwidth email).
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, compressed, { cacheControl: "31536000" });
      if (uploadError) {
        setSaveError(uploadError.message);
        setSaving(false);
        return;
      }
      uploaded.push({ path, name: f.name });
    }

    const keptExisting = existingAttachments.filter((a) => !removedPaths.has(a.path));
    const attachments = [...keptExisting, ...uploaded];

    // Poll fields — only meaningful when the toggle is on, and only kept
    // if there are at least 2 non-blank options (anything less isn't a
    // real poll).
    const pollEnabled = draft.pollEnabled === "1";
    let pollOptions: string[] = [];
    if (pollEnabled) {
      try {
        pollOptions = (JSON.parse(draft.pollOptionsJson || "[]") as string[]).map((o) => o.trim()).filter(Boolean);
      } catch {
        pollOptions = [];
      }
    }
    const pollActuallyEnabled = pollEnabled && !!draft.pollQuestion.trim() && pollOptions.length >= 2;
    const pollPayload = {
      poll_enabled: pollActuallyEnabled,
      poll_question: pollActuallyEnabled ? draft.pollQuestion.trim() : null,
      poll_options: pollActuallyEnabled ? pollOptions : [],
    };

    let noticeId = editingId;

    if (editingId) {
      const { error } = await supabase
        .from("notices")
        .update({ title: draft.title.trim(), body: draft.body.trim() || null, attachments, ...pollPayload })
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
          ...pollPayload,
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
      let compressedCover: File;
      try {
        compressedCover = await compressImageFile(coverFile);
      } catch (err) {
        setSaveError(`Notice saved, but the headline image couldn't be uploaded: ${err instanceof Error ? err.message : "unknown error"}`);
        setSaving(false);
        load();
        return;
      }
      const ext = compressedCover.name.split(".").pop() || "jpg";
      const path = `notices/${noticeId}/cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, compressedCover, { cacheControl: "31536000" });
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
    toast.success(editingId ? "Notice updated" : "Notice posted");
  }

  async function handleDelete(notice: NoticeRow) {
    if (!(await confirm("Remove this notice?", { danger: true }))) return;
    const paths = attachmentsFor(notice).map((a) => a.path);
    if (notice.cover_path) paths.push(notice.cover_path);
    if (paths.length > 0) {
      await supabase.storage.from("notices").remove(paths);
    }
    const { error } = await supabase.from("notices").delete().eq("id", notice.id);
    if (error) {
      toast.error(`Couldn't delete: ${error.message}`);
      return;
    }
    load();
  }

  async function togglePinned(notice: NoticeRow) {
    const { error } = await supabase.from("notices").update({ pinned: !notice.pinned }).eq("id", notice.id);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      return;
    }
    load();
  }

  function fileUrl(path: string) {
    return supabase.storage.from("notices").getPublicUrl(path).data.publicUrl;
  }

  // "Share" a story out to WhatsApp/Messages/etc. via the device's native
  // share sheet (2026-09-02, Ben's request) — text + link rather than a
  // rendered image (see ShareCard.tsx for that pattern instead), since a
  // story's body can be long-form and doesn't compress down to a fixed
  // card layout the way a player's stats do. The link uses the existing
  // "#notices" hash the app already supports for deep-linking a specific
  // tab (see App.tsx — originally built for push notifications), so it
  // actually lands the recipient on the News page, not just the app's
  // default screen.
  async function shareNotice(notice: NoticeRow) {
    const plainExcerpt = (notice.body ?? "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/^-\s+/gm, "")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    const excerpt = plainExcerpt.length > 140 ? `${plainExcerpt.slice(0, 140).trimEnd()}…` : plainExcerpt;
    const url = `${window.location.origin}${window.location.pathname}#notices`;
    const text = [notice.title, excerpt, "— via Sideline (Huntingdon Pickleball)"].filter(Boolean).join("\n\n");

    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: notice.title, text, url });
      } catch (err) {
        // AbortError just means they closed the share sheet — not a failure.
        if (err instanceof Error && err.name !== "AbortError") {
          toast.error(err.message);
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast.success("Copied to clipboard — paste it wherever you'd like to share it.");
    } catch {
      toast.error("Couldn't share or copy — your browser may not support either.");
    }
  }

  if (loading) return <PageLoading label="Loading news…" />;
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
        <h1 style={{ marginBottom: 0 }}>News</h1>
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
        <div ref={formRef} className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>{editingId ? "Edit notice" : "New notice"}</h2>

          {filePickerReloadWarning && (
            <div
              style={{
                background: "var(--orange-100)",
                color: "var(--orange-600)",
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: "0.85rem",
                lineHeight: 1.5,
              }}
            >
              <strong>That file didn't attach.</strong> Your browser reloaded partway through picking it —
              a known issue on some Android phones when choosing a file from Google Drive. Your title and note
              are safe, but the file needs picking again. It tends to happen with larger files, so try a
              smaller one, or pick from Photos/Gallery instead of Files if it keeps happening.
              <div>
                <button
                  type="button"
                  onClick={() => setFilePickerReloadWarning(false)}
                  style={{
                    marginTop: 8,
                    width: "auto",
                    padding: "4px 12px",
                    fontSize: "0.78rem",
                    background: "transparent",
                    color: "var(--orange-600)",
                    border: "1px solid var(--orange-600)",
                  }}
                >
                  Got it
                </button>
              </div>
            </div>
          )}

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
            <button
              type="button"
              onClick={() => wrapSelection("__")}
              title="Underline"
              style={{ width: "auto", marginTop: 0, padding: "4px 12px", textDecoration: "underline" }}
            >
              U
            </button>
            <button
              type="button"
              onClick={insertTableTemplate}
              title="Insert table"
              style={{ width: "auto", marginTop: 0, padding: "4px 12px" }}
            >
              Table
            </button>
            <button
              type="button"
              onClick={insertListTemplate}
              title="Insert list"
              style={{ width: "auto", marginTop: 0, padding: "4px 12px" }}
            >
              List
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
            Select some text and tap B, i or U to format it, or type **bold** / *italic* / __underline__ yourself.
            Paste a YouTube link anywhere and it'll show as a tap-to-play thumbnail. Tap "Table" for a side-by-side
            list — the first line becomes the header, and each line after is a row, with columns separated by "|".
            Tap "List" for a bulleted list — each line starts with "- ". A short list renders as a normal
            single-column list; a long one (12+ items, e.g. a roster) automatically flows into columns instead.
          </p>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={draft.pollEnabled === "1"}
              onChange={(e) => {
                const checked = e.target.checked;
                setDraft((d) => ({
                  ...d,
                  pollEnabled: checked ? "1" : "",
                  pollOptionsJson: checked && !d.pollOptionsJson ? JSON.stringify(["", ""]) : d.pollOptionsJson,
                }));
              }}
              style={{ width: "auto" }}
            />
            Add a poll to this notice
          </label>

          {draft.pollEnabled === "1" && (
            <div style={{ marginTop: 10, marginBottom: 10 }}>
              <label style={{ marginTop: 0 }}>Poll question</label>
              <input
                type="text"
                value={draft.pollQuestion}
                onChange={(e) => setDraft((d) => ({ ...d, pollQuestion: e.target.value }))}
                placeholder="e.g. Best night for the social?"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              />

              <label>Options</label>
              {(() => {
                let options: string[] = [];
                try {
                  options = JSON.parse(draft.pollOptionsJson || "[]");
                } catch {
                  options = ["", ""];
                }
                return (
                  <>
                    {options.map((opt, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const next = [...options];
                            next[i] = e.target.value;
                            setDraft((d) => ({ ...d, pollOptionsJson: JSON.stringify(next) }));
                          }}
                          placeholder={`Option ${i + 1}`}
                          style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
                        />
                        {options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = options.filter((_, idx) => idx !== i);
                              setDraft((d) => ({ ...d, pollOptionsJson: JSON.stringify(next) }));
                            }}
                            style={{ width: "auto", marginTop: 0, padding: "4px 10px", background: "transparent", color: "var(--danger)" }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    {options.length < 6 && (
                      <span
                        className="link-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setDraft((d) => ({ ...d, pollOptionsJson: JSON.stringify([...options, ""]) }))}
                        style={{ fontSize: "0.82rem" }}
                      >
                        + Add option
                      </span>
                    )}
                  </>
                );
              })()}
              <p className="stat-meta" style={{ marginTop: 6 }}>
                Needs a question and at least 2 options to actually show — results are visible to everyone as
                soon as they vote.
              </p>
            </div>
          )}

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
          <input type="file" accept="image/*" onClick={armFilePicker} onChange={handleCoverChange} />
          <p className="stat-meta" style={{ marginTop: 4 }}>
            Shown as a banner across the top of the card — separate from the attachments below. If you don't add
            one, the club badge is shown instead.
          </p>

          <label>Photo attachment (optional)</label>
          <input type="file" accept="image/*" multiple onClick={armFilePicker} onChange={handleFilesChosen} />
          <p className="stat-meta" style={{ marginTop: 4 }}>
            Opens your phone's Photos/Gallery — add as many as you like. Use this instead of Files below if
            attaching keeps failing on your phone (a known issue on some Android/Samsung phones when picking a
            file from the Files app or Google Drive — Gallery isn't affected).
          </p>

          <label>File attachment (optional)</label>
          <input type="file" multiple onClick={armFilePicker} onChange={handleFilesChosen} />
          <p className="stat-meta" style={{ marginTop: 4 }}>
            For non-photo files (team sheets, PDFs, etc.) — opens the Files app.
          </p>

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
            No news yet.
          </p>
        )}
        {notices.slice(0, visibleCount).map((n) => {
          const atts = attachmentsFor(n);
          const imageAtts = atts.filter((a) => isImageFile(a.name) && !thumbFailed.has(a.path));
          const fileAtts = atts.filter((a) => !isImageFile(a.name) || thumbFailed.has(a.path));
          const youtubeIds = n.body ? extractYouTubeIds(n.body) : [];
          return (
            <div key={n.id} className={`card notice-card${n.pinned ? " notice-card-pinned" : ""}`}>
              <img
                className={`notice-cover${n.cover_path ? "" : " notice-cover-default"}`}
                src={n.cover_path ? fileUrl(n.cover_path) : DEFAULT_COVER_URL}
                alt=""
              />
              <div className={n.pinned ? "notice-card-body-pinned" : undefined} style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    {n.pinned && <div className="pin-badge">📌 Pinned</div>}
                    <div className="notice-title">{n.title}</div>
                    <div className="notice-meta">
                      {formatRelative(n.created_at)} · Posted by {n.players?.display_name ?? "Admin"}
                      {wasEdited(n) && <> · <span style={{ opacity: 0.75 }}>Updated {formatRelative(n.updated_at)}</span></>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2, flexShrink: 0, marginLeft: "auto" }}>
                    <button onClick={() => shareNotice(n)} style={{ ...actionBtnStyle, color: "var(--sky-600)" }}>
                      Share
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => togglePinned(n)} style={{ ...actionBtnStyle, color: "var(--orange-600)" }}>
                          {n.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button onClick={() => openEditForm(n)} style={{ ...actionBtnStyle, color: "var(--navy-500)" }}>
                          Edit
                        </button>
                        <button onClick={() => handleDelete(n)} style={{ ...actionBtnStyle, color: "var(--danger)" }}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {n.body && (
                  <div className="rich-text" style={{ margin: "10px 0 0" }}>
                    {renderRichBody(n.body)}
                  </div>
                )}

                {n.poll_enabled && n.poll_options.length >= 2 && (
                  <NoticePoll notice={n} playerId={playerId} votes={pollVotes.get(n.id) ?? []} onVote={handleVote} />
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
