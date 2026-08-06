import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { linkify } from "../lib/linkify";
import type { FaqItem } from "../types";

// Simple accordion — click a question to expand its answer. Admins get an
// inline form above the list plus edit/delete on each item; everyone else
// just reads.
export default function FAQ({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  function startAdd() {
    setEditingId(null);
    setQuestion("");
    setAnswer("");
    setSortOrder("0");
    setShowForm(true);
  }

  function startEdit(item: FaqItem) {
    setEditingId(item.id);
    setQuestion(item.question);
    setAnswer(item.answer);
    setSortOrder(String(item.sort_order));
    setShowForm(true);
  }

  async function handleSave() {
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      question: question.trim(),
      answer: answer.trim(),
      sort_order: Number(sortOrder) || 0,
    };

    const { error } = editingId
      ? await supabase.from("faq_items").update(payload).eq("id", editingId)
      : await supabase.from("faq_items").insert({
          ...payload,
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        });

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setShowForm(false);
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
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Answer</label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            style={{ fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }}
          />

          <label>Order (lower shows first, optional)</label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          {saveError && <p className="error">{saveError}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={saving || !question.trim() || !answer.trim()}
              onClick={handleSave}
              style={{ flex: 1 }}
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add question"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{ flex: 1, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {items.length === 0 && <p className="stat-meta">No FAQ items yet.</p>}
        {items.map((item) => (
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
        ))}
      </div>
    </div>
  );
}
