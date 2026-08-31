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
    } else {
      plainRun.push(line);
      i++;
    }
  }
  flushPlain();

  return blocks;
}
