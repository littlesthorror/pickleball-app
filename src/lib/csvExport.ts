// Tiny client-side CSV builder + download trigger (2026-08-28) — added for
// My Account's "export my match history" button and reused by the GDPR
// "download my data" export. Deliberately hand-rolled rather than pulling
// in a CSV library for something this small: quote any field containing a
// comma, quote, or newline (doubling embedded quotes, standard CSV
// escaping), everything else passes through as-is.
function escapeCsvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(escapeCsvField).join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))];
  // Leading BOM so Excel (still the most likely opener) detects UTF-8
  // rather than guessing a legacy codepage and mangling any accented
  // names.
  return `﻿${lines.join("\n")}`;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
