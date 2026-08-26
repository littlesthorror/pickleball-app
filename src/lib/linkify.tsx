import type { ReactNode } from "react";

// Turns plain-text URLs (http/https or bare "www.") into clickable links,
// and a small set of markdown-style markers into bold/italic text — all in
// one pass, styled via the .rich-text rules in index.css. Used for FAQ
// answers, notice bodies, and event descriptions — admins just type
// **bold**, *italic* / _italic_, or paste a link; no rich-text editor
// needed. Bold added 2026-08-27 at Ben's request ("formatting options to
// Notices, e.g. bold/italicise") — kept as plain regex rather than pulling
// in a markdown library, matching how linkify itself was already built.
//
// One deliberate limitation: a single stray "*" or "_" (not part of a
// pair) won't get treated as formatting — the patterns require the
// opening and closing marker on the same line, so an unmatched marker is
// just left as a literal character rather than accidentally swallowing
// the rest of the text looking for a partner.
// The (?!\*) after the single-asterisk italic closer stops it from
// mis-firing on a stray "*" that appears earlier on the same line as a
// real **bold** pair — without it, a sentence like "3 * 4 but **12** is
// bold" would greedily treat everything between the stray "*" and the
// first "*" of "**12**" as italic. Confirmed against that exact case plus
// bullet-style lines starting with "* " (common in notice bodies) before
// shipping.
const TOKEN_PATTERN =
  /(https?:\/\/[^\s]+|www\.[^\s]+)|\*\*([^\n]+?)\*\*|\*([^\n*]+?)\*(?!\*)|_([^\n_]+?)_/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const regex = new RegExp(TOKEN_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const [, urlToken, boldContent, italicStarContent, italicUnderscoreContent] = match;

    if (urlToken) {
      let url = urlToken;
      let trailing = "";
      const trailMatch = url.match(TRAILING_PUNCTUATION);
      if (trailMatch) {
        trailing = trailMatch[0];
        url = url.slice(0, url.length - trailing.length);
      }
      const href = url.startsWith("http") ? url : `https://${url}`;
      nodes.push(
        <a key={`link-${key++}`} href={href} target="_blank" rel="noreferrer">
          {url}
        </a>
      );
      if (trailing) nodes.push(trailing);
    } else if (boldContent !== undefined) {
      nodes.push(<strong key={`bold-${key++}`}>{boldContent}</strong>);
    } else if (italicStarContent !== undefined || italicUnderscoreContent !== undefined) {
      nodes.push(<em key={`italic-${key++}`}>{italicStarContent ?? italicUnderscoreContent}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
