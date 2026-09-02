import type { ReactNode } from "react";
import { linkify } from "./linkify";

// Adds a lightweight "table" block on top of linkify()'s existing inline
// **bold** / *italic* / __underline__ / link handling — added 2026-08-31
// after Ben asked for a way to lay out side-by-side lists (e.g. two teams
// competitions' rosters) in a notice rather than one long flat list.
//
// No new editor UI, same philosophy as linkify(): admins just type
// pipe-separated cells, one row per line —
//
//   +50s Teams | +18 Teams
//   Adam W & Astrid P | Airo O & Eric O
//   Chris A & Patrick N | Ben P & Kate L
//
// Two or more consecutive lines containing at least one "|" are treated as
// a table (first line = header row); everything else renders exactly as
// before. Requiring 2+ consecutive lines (not just 1) keeps a stray "|"
// typed in an ordinary sentence from accidentally turning into a
// one-row table. Cell contents still run through linkify(), so bold/
// italic/links keep working inside table cells too.
//
// A second block type, added the same day at Ben's follow-up request: a
// plain "- one item per line" list (2+ consecutive lines starting with
// "- ") renders as a classic single-column bulleted list — the common
// case (a handful of announcement points). Once a list gets long enough
// that a single column would run the page on for a while (12+ items — e.g.
// a 30-pair roster), it automatically switches to the auto-flowing
// multi-column layout instead, via the .rich-list--flow modifier (see
// index.css) so the browser decides 1/2/3 columns based on available
// width rather than the admin having to plan a layout or pick a different
// syntax for "long list" vs "short list". Changed 2026-09-02 from a 3+
// line / always-flowing design at Ben's request for "a classic bulleted
// list" — 2 lines is enough to intend a list (matches the table block's
// own 2-line bar just below), and most real notices are short enough that
// they were rendering as a cramped multi-column layout instead of a
// normal list.
const LIST_LINE = /^-\s+\S/;
const LIST_FLOW_THRESHOLD = 12;

export function renderRichBody(text: string): ReactNode[] {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let plainRun: string[] = [];
  let key = 0;

  function flushPlain() {
    if (plainRun.length === 0) return;
    blocks.push(<p key={`p-${key++}`}>{linkify(plainRun.join("\n"))}</p>);
    plainRun = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes("|") && (lines[i + 1]?.includes("|") ?? false)) {
      flushPlain();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines.map((l) => {
        const cells = l.split("|").map((c) => c.trim());
        if (cells[0] === "") cells.shift();
        if (cells[cells.length - 1] === "") cells.pop();
        return cells;
      });
      const [headerRow, ...bodyRows] = rows;
      blocks.push(
        <div key={`table-${key++}`} className="rich-table-wrap">
          <table className="rich-table">
            <thead>
              <tr>
                {headerRow.map((cell, ci) => (
                  <th key={ci}>{linkify(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{linkify(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (LIST_LINE.test(line) && LIST_LINE.test(lines[i + 1] ?? "")) {
      flushPlain();
      const items: string[] = [];
      while (i < lines.length && LIST_LINE.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ""));
        i++;
      }
      const flowing = items.length >= LIST_FLOW_THRESHOLD;
      blocks.push(
        <ul key={`list-${key++}`} className={`rich-list${flowing ? " rich-list--flow" : ""}`}>
          {items.map((item, ii) => (
            <li key={ii}>{linkify(item)}</li>
          ))}
        </ul>
      );
    } else {
      plainRun.push(line);
      i++;
    }
  }
  flushPlain();

  return blocks;
}
