import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import { linkify } from "../lib/linkify";
import { useDraft } from "../lib/useDraft";
import type { FaqItem } from "../types";

const FAQ_DRAFT_KEY = "sideline-draft-faq";

// Matches youtube.com/watch?v=, youtube.com/embed/, youtube.com/shorts/,
// and youtu.be/ links (with or without a scheme/www.) and captures the
// 11-character video ID — enough to build both a thumbnail and an embed
// URL without needing to call the YouTube API.
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

// FAQ images reuse the existing "notices" storage bucket under an faq/
// prefix, same approach as Events posters — its RLS is already "admins
// can write, anyone can read", no need for a dedicated bucket.
function imageUrl(path: string) {
  const { data } = supabase.storage.from("notices").getPublicUrl(path);
  return data.publicUrl;
}

// Simple accordion — click a question to expand its answer. Admins get an
// inline form above the list plus edit/delete on each item; everyone else
// just reads. Answers can include a YouTube link (rendered as a
// click-to-play thumbnail) and/or one attached image (click to enlarge).
export default function FAQ({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // showForm/editingId/question/answer/sortOrder all live in one
  // sessionStorage-backed draft — see useDraft.ts — so the form survives
  // a tab reload (Android's file-picker hand-off, backgrounded-tab
  // discard on Safari/Chrome) instead of silently losing what was typed.
  const [draft, setDraft, clearDraft] = useDraft(FAQ_DRAFT_KEY, {
    showForm: "",
    editingId: "",
    question: "",
    answer: "",
    sortOrder: "0",
  });
  const showForm = draft.showForm === "1";
  const editingId = draft.editingId || null;

  // Image attachment is a File object, which can't survive sessionStorage
  // — kept as ordinary state instead, same limitation/pattern as the
  // poster upload on Events.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImagePath, setExistingImagePath] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    supabase
      .from("faq_items")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setItems((data ?? []) as FaqItem[]);
        setLoading(false);
      });
  }

  useEffect(load, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLightboxUrl(null);
        setVideoId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // If a reload happens mid-edit, existingImagePath can't have survived —
  // it's File-bucket state, not draft state. Re-derive it from the
  // matching item once the list has loaded, same pattern as Notices.tsx's
  // attachment restore and Events.tsx's poster restore.
  useEffect(() => {
    if (!editingId || items.length === 0) return;
    const item = items.find((i) => i.id === editingId);
    if (item) setExistingImagePath(item.image_path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, items]);

  function closeForm() {
    clearDraft();
    setExistingImagePath(null);
    setImageFile(null);
    setRemoveImage(false);
    setSaveError(null);
  }

  function startAdd() {
    setDraft({ showForm: "1", editingId: "", question: "", answer: "", sortOrder: "0" });
    setExistingImagePath(null);
    setImageFile(null);
    setRemoveImage(false);
    setSaveError(null);
  }

  function startEdit(item: FaqItem) {
    setDraft({
      showForm: "1",
      editingId: item.id,
      question: item.question,
      answer: item.answer,
      sortOrder: String(item.sort_order),
    });
    setExistingImagePath(item.image_path);
    setImageFile(null);
    setRemoveImage(false);
    setSaveError(null);
  }

  function handleImageChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (file) {
      setImageFile(file);
      setRemoveImage(false);
    }
  }

  async function handleSave() {
    if (!draft.question.trim() || !draft.answer.trim()) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      question: draft.question.trim(),
      answer: draft.answer.trim(),
      sort_order: Number(draft.sortOrder) || 0,
    };

    let itemId = editingId;

    if (editingId) {
      const { error } = await supabase.from("faq_items").update(payload).eq("id", editingId);
      if (error) {
        setSaveError(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("faq_items")
        .insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id ?? null })
        .select("id")
        .single();
      if (error || !inserted) {
        setSaveError(error?.message ?? "Couldn't add the question.");
        setSaving(false);
        return;
      }
      itemId = inserted.id;
    }

    if (imageFile && itemId) {
      const ext = imageFile.name.split(".").pop() || "jpg";
      // A fresh, unique path per upload rather than overwriting the same
      // one — see the identical comment on Events.tsx's poster upload for
      // why (avoids a stale cached image after replacing it).
      const path = `faq/${itemId}/image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, imageFile);
      if (uploadError) {
        setSaveError(`Saved, but the image failed to upload: ${uploadError.message}`);
        setSaving(false);
        load();
        return;
      }
      await supabase.from("faq_items").update({ image_path: path }).eq("id", itemId);
      if (existingImagePath && existingImagePath !== path) {
        await supabase.storage.from("notices").remove([existingImagePath]);
      }
    } else if (removeImage && itemId) {
      await supabase.from("faq_items").update({ image_path: null }).eq("id", itemId);
      if (existingImagePath) {
        await supabase.storage.from("notices").remove([existingImagePath]);
      }
    }

    closeForm();
    setSaving(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this FAQ item?")) return;
    const { error } = await supabase.from("faq_items").delete().eq("id", id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    load();
  }

  if (loading) return <p>Loading FAQ…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>FAQ</h1>
        {isAdmin && (
          <button style={{ marginTop: 0, width: "auto", padding: "8px 16px" }} onClick={startAdd}>
            Add question
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <label style={{ marginTop: 0 }}>Question</label>
          <input
            type="text"
            value={draft.question}
            onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Answer</label>
          <textarea
            value={draft.answer}
            onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))}
            rows={4}
            style={{ fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }}
          />
          <p className="stat-meta" style={{ marginTop: -6 }}>
            Paste a YouTube link anywhere in the answer and it'll show as a tap-to-play thumbnail.
          </p>

          <label>Order (lower shows first, optional)</label>
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Image (optional)</label>
          {existingImagePath && !removeImage && !imageFile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <img
                src={imageUrl(existingImagePath)}
                alt=""
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
              />
              <span className="link-action" role="button" tabIndex={0} onClick={() => setRemoveImage(true)}>
                Remove image
              </span>
            </div>
          )}
          {imageFile && <p className="stat-meta" style={{ marginTop: 0 }}>Selected: {imageFile.name}</p>}
          <input type="file" accept="image/*" onChange={handleImageChange} />

          {saveError && <p className="error">{saveError}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={saving || !draft.question.trim() || !draft.answer.trim()}
              onClick={handleSave}
              style={{ flex: 1 }}
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add question"}
            </button>
            <button
              onClick={closeForm}
              style={{ flex: 1, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {items.length === 0 && <p className="stat-meta">No FAQ items yet.</p>}
        {items.map((item) => {
          const youtubeIds = openId === item.id ? extractYouTubeIds(item.answer) : [];
          return (
            <div className="match-row" key={item.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => setOpenId(openId === item.id ? null : item.id)}
              >
                <div className="opponent">{item.question}</div>
                <span className="stat-meta">{openId === item.id ? "−" : "+"}</span>
              </div>
              {openId === item.id && (
                <div style={{ marginTop: 8 }}>
                  <p className="rich-text" style={{ margin: 0 }}>{linkify(item.answer)}</p>

                  {youtubeIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                      {youtubeIds.map((id) => (
                        <div
                          key={id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setVideoId(id)}
                          style={{
                            position: "relative",
                            width: 160,
                            aspectRatio: "16 / 9",
                            borderRadius: 8,
                            overflow: "hidden",
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

                  {item.image_path && (
                    <img
                      src={imageUrl(item.image_path)}
                      alt=""
                      onClick={() => setLightboxUrl(imageUrl(item.image_path!))}
                      style={{
                        marginTop: 10,
                        maxWidth: "100%",
                        maxHeight: 200,
                        borderRadius: 8,
                        cursor: "zoom-in",
                        display: "block",
                      }}
                    />
                  )}

                  {isAdmin && (
                    <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                      <button
                        onClick={() => startEdit(item)}
                        style={{ marginTop: 0, width: "auto", background: "transparent", color: "var(--navy-500)", padding: 0, fontSize: "0.78rem", fontWeight: 600 }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{ marginTop: 0, width: "auto", background: "transparent", color: "var(--danger)", padding: 0, fontSize: "0.78rem", fontWeight: 600 }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="" className="lightbox-image" onClick={(ev) => ev.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>
            ×
          </button>
        </div>
      )}

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
          <button className="lightbox-close" onClick={() => setVideoId(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
