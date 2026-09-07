// Client-side "Save fixtures as Word doc" export (2026-09-07, Ben's
// request) — gives admins a printable hard copy of a competition's group
// fixtures, laid out by Round/Court exactly as they appear on screen (see
// scheduleFixturesByCourt in competitionStandings.ts). Covers every group
// in the competition, not just whichever one is currently selected in the
// on-screen group switcher.
//
// Built by hand-writing the OOXML WordprocessingML parts rather than
// pulling in a docx-generation library (e.g. the `docx` npm package):
// this sandbox has no npm registry access to add a new dependency, and the
// document itself is simple enough — headings and paragraphs, no tables or
// images — that hand-writing the XML is a few dozen lines. See
// zipWriter.ts for the accompanying from-scratch ZIP container; a .docx
// file is just a ZIP archive of a handful of small XML parts.

import { buildZip } from "./zipWriter";
import { scheduleFixturesByCourt } from "./competitionStandings";
import type { CompetitionGroupRow, CompetitionMatchRow, CompetitionRow } from "../types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(
  text: string,
  opts: { bold?: boolean; size?: number; center?: boolean; spacingBefore?: number } = {}
): string {
  const { bold, size, center, spacingBefore } = opts;
  const rPr = `${bold ? "<w:b/>" : ""}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""}`;
  const pPr = `${center ? '<w:jc w:val="center"/>' : ""}${spacingBefore ? `<w:spacing w:before="${spacingBefore}"/>` : ""}`;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(
    text
  )}</w:t></w:r></w:p>`;
}

export type FixtureMatch = CompetitionMatchRow & {
  matches: { team_a_score: number; team_b_score: number } | null;
};

export function buildFixturesDocxBlob(
  competition: CompetitionRow,
  groups: CompetitionGroupRow[],
  matches: FixtureMatch[],
  teamLabel: (id: string) => string
): Blob {
  const paragraphs: string[] = [];
  paragraphs.push(paragraph(competition.name, { bold: true, size: 32, center: true }));
  paragraphs.push(
    paragraph(
      `Group fixtures — exported ${new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
      { center: true, spacingBefore: 80 }
    )
  );

  const scoreText = (m: FixtureMatch) => (m.matches ? ` (${m.matches.team_a_score}–${m.matches.team_b_score})` : "");

  for (const g of groups) {
    const groupMatches = matches.filter((m) => m.group_id === g.id);
    if (groupMatches.length === 0) continue;
    paragraphs.push(paragraph(g.name, { bold: true, size: 26, spacingBefore: 360 }));

    const scheduled = scheduleFixturesByCourt(groupMatches, g.start_court ?? 0, g.court_count ?? 0);
    const isScheduled = scheduled.some((m) => m.printedRound != null);

    if (isScheduled) {
      const byRound = new Map<number, typeof scheduled>();
      for (const m of scheduled) {
        const key = m.printedRound ?? 0;
        const list = byRound.get(key) ?? [];
        list.push(m);
        byRound.set(key, list);
      }
      const rounds = [...byRound.keys()].sort((a, b) => a - b);
      for (const round of rounds) {
        paragraphs.push(paragraph(`Round ${round}`, { bold: true, spacingBefore: 200 }));
        for (const m of byRound.get(round)!) {
          const courtLabel = m.court != null ? `Court ${m.court}: ` : "";
          paragraphs.push(paragraph(`${courtLabel}${teamLabel(m.team_a_id)} vs ${teamLabel(m.team_b_id)}${scoreText(m)}`));
        }
      }
    } else {
      for (const m of groupMatches) {
        paragraphs.push(paragraph(`${teamLabel(m.team_a_id)} vs ${teamLabel(m.team_b_id)}${scoreText(m)}`));
      }
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join(
    ""
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const encoder = new TextEncoder();
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml) },
    { name: "_rels/.rels", data: encoder.encode(rootRelsXml) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
  ]);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
