import type { ReactNode } from "react";

// Turns plain-text URLs (http/https or bare "www.") into clickable links,
// and a small set of markdown-style markers into bold/italic/underline
// text — all in one pass, styled via the .rich-text rules in index.css.
// Used for FAQ answers, notice bodies, and event descriptions — admins
// just type **bold**, *italic* / _italic_, __underline__, or paste a
// link; no rich-text editor needed. Bold/italic added 2026-08-27,
// underline added 2026-08-28 (both at Ben's request) — kept as plain
// regex rather than pulling in a markdown library, matching how linkify
// itself was already built.
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
// shipping. Underline (__..__) is checked before single-underscore italic
// for the same reason bold is checked before italic — otherwise
// "__underline__" would get parsed as italic-wrapping-an-underscore
// instead. The (?!_) after the single-underscore closer stops it
// mis-firing on the boundary of a double-underscore pair.
const TOKEN_PATTERN =
  /(https?:\/\/[^\s]+|www\.[^\s]+)|\*\*([^\n]+?)\*\*|\*([^\n*]+?)\*(?!\*)|__([^\n]+?)__|_([^\n_]+?)_(?!_)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

// Long pasted links (tracking params, deep paths, etc.) read as a wall of
// noise and wrap badly on mobile — Ben's request 2026-08-28: "automatically
// shorten long URLs". This only tidies the visible link *text*; the href
// underneath is always the real, full URL, so nothing about where the link
// actually goes changes. Strips the scheme/"www." (redundant once it's
// rendered as a link) and truncates with an ellipsis past MAX_DISPLAY_LEN,
// same "prefix + …" approach used elsewhere in the app (see fitText in
// seasonWrappedImage.ts) rather than pulling in a real URL-shortening
// service for what's purely a display concern.
const MAX_DISPLAY_LEN = 34;

function displayForUrl(raw: string) {
  const stripped = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (stripped.length <= MAX_DISPLAY_LEN) return stripped;
  return `${stripped.slice(0, MAX_DISPLAY_LEN - 1)}…`;
}

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

    const [, urlToken, boldContent, italicStarContent, underlineContent, italicUnderscoreContent] = match;

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
        <a key={`link-${key++}`} href={href} target="_blank" rel="noreferrer" title={url}>
          {displayForUrl(url)}
        </a>
      );
      if (trailing) nodes.push(trailing);
    } else if (boldContent !== undefined) {
      nodes.push(<strong key={`bold-${key++}`}>{boldContent}</strong>);
    } else if (underlineContent !== undefined) {
      nodes.push(<u key={`underline-${key++}`}>{underlineContent}</u>);
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
