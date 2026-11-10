// "Print score slips" export (2026-11-10, Ben's request) — fills the club's
// printed tournament score slips (4 per A4 page, cut along the dotted lines)
// with a competition's group-stage fixtures: GROUP (with Round/Court when the
// group has a court layout) and both team names are pre-filled; MATCH TIME,
// SCORE and WINNER are left blank to write in by hand.
//
// Built as a print-ready HTML page in a new window rather than a PDF: no PDF
// library is needed, and the browser's print dialog already offers "Save as
// PDF" as well as printing straight to paper.

import { scheduleFixturesByCourt } from "./competitionStandings";
import type { CompetitionGroupRow, CompetitionMatchRow } from "../types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Slip = { group: string; round: number | null; court: number | null; team1: string; team2: string };

function buildSlips(
  groups: CompetitionGroupRow[],
  matches: CompetitionMatchRow[],
  teamLabel: (id: string) => string
): Slip[] {
  const slips: Slip[] = [];
  for (const g of groups) {
    const groupMatches = matches.filter((m) => m.group_id === g.id);
    if (groupMatches.length === 0) continue;
    const scheduled = scheduleFixturesByCourt(groupMatches, g.start_court ?? 0, g.court_count ?? 0);
    const isScheduled = scheduled.some((m) => m.printedRound != null);
    const ordered = isScheduled
      ? [...scheduled].sort(
          (a, b) => (a.printedRound ?? 0) - (b.printedRound ?? 0) || (a.court ?? 0) - (b.court ?? 0)
        )
      : scheduled;
    for (const m of ordered) {
      slips.push({
        group: g.name,
        round: isScheduled ? m.printedRound ?? null : null,
        court: m.court ?? null,
        team1: teamLabel(m.team_a_id),
        team2: teamLabel(m.team_b_id),
      });
    }
  }
  return slips;
}

function badge(s: Slip): string {
  const lines = [s.round != null ? `<div><span>ROUND</span> ${s.round}</div>` : "", s.court != null ? `<div><span>COURT</span> ${s.court}</div>` : ""].join("");
  return lines ? `<div class="badge">${lines}</div>` : "";
}

function slipHtml(s: Slip, logoUrl: string): string {
  return `<div class="slip">
  <div class="head"><img src="${esc(logoUrl)}" alt=""><div class="titles"><div class="t1">HUNTINGDON PICKLEBALL</div><div class="t2">TOURNAMENT SCORE SLIP</div></div>${badge(s)}</div>
  <div class="meta"><span class="lbl">GROUP:</span><span class="line g">${esc(s.group)}</span><span class="lbl">MATCH TIME:</span><span class="line t"></span></div>
  <table>
    <tr><th>TEAM NAMES</th><th class="c">SCORE</th><th class="c">WINNER</th></tr>
    <tr><td><span class="tl">Team 1:</span> ${esc(s.team1)}</td><td class="c"><i></i></td><td class="c"><i></i></td></tr>
    <tr><td><span class="tl">Team 2:</span> ${esc(s.team2)}</td><td class="c"><i></i></td><td class="c"><i></i></td></tr>
  </table>
  <div class="cut">Cut along dotted line</div>
</div>`;
}

const CSS = `
@page { size: A4 portrait; margin: 6mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: #111; }
.page { page-break-after: always; height: 285mm; display: grid; grid-template-rows: repeat(4, 1fr); }
.page:last-child { page-break-after: auto; }
.slip { border: 1px dashed #777; padding: 3mm 5mm 1.5mm; display: flex; flex-direction: column; justify-content: space-between; }
.head { display: flex; align-items: center; gap: 4mm; border-bottom: 1px solid #333; padding-bottom: 2mm; }
.head img { width: 17mm; height: 17mm; object-fit: contain; }
.titles { flex: 1; text-align: center; margin-right: 17mm; }
.head { position: relative; }
.badge { position: absolute; right: 0; top: 0; border: 1.5px solid #333; border-radius: 2mm; padding: 1mm 3mm; text-align: center; font-weight: 700; font-size: 14pt; line-height: 1.25; }
.badge span { font-size: 7pt; letter-spacing: .08em; margin-right: 1mm; }
.t1 { font-weight: 700; font-size: 14pt; }
.t2 { font-weight: 700; font-size: 8.5pt; margin-top: 1mm; }
.meta { display: flex; align-items: flex-end; gap: 3mm; font-size: 9pt; }
.lbl { font-weight: 700; white-space: nowrap; }
.line { border-bottom: 1px solid #333; height: 5mm; }
.g { flex: 1.3; font-size: 9pt; padding-left: 1mm; line-height: 5mm; white-space: nowrap; overflow: hidden; }
.t { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 11pt; }
th, td { border: 1px solid #333; padding: 0 2.5mm; height: 8.5mm; }
th { font-size: 9pt; }
td.c, th.c { width: 34mm; text-align: center; }
td i { display: block; border-bottom: 1px solid #333; width: 24mm; margin: 0 auto; height: 5mm; }
.tl { font-size: 9pt; color: #444; margin-right: 1.5mm; }
.cut { text-align: right; font-size: 6.5pt; font-style: italic; color: #555; }
`;

/** Opens a print-ready page of score slips. Returns false if the window was blocked. */
export function openScoreSlipsPrint(
  groups: CompetitionGroupRow[],
  matches: CompetitionMatchRow[],
  teamLabel: (id: string) => string
): boolean {
  const slips = buildSlips(groups, matches, teamLabel);
  if (slips.length === 0) return false;
  const logoUrl = `${window.location.origin}/logo.png`;
  const pages: string[] = [];
  for (let i = 0; i < slips.length; i += 4) {
    const chunk = slips.slice(i, i + 4);
    pages.push(`<div class="page">${chunk.map((s) => slipHtml(s, logoUrl)).join("")}</div>`);
  }
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Score slips</title><style>${CSS}</style></head><body>${pages.join(
      ""
    )}<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body></html>`
  );
  w.document.close();
  return true;
}
