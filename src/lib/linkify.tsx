import type { ReactNode } from "react";

// Turns plain-text URLs (http/https or bare "www.") inside a block of text
// into clickable links, styled via the .rich-text a rule in index.css.
// Used for FAQ answers and notice bodies — admins just type or paste a
// link, no markdown syntax required.
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const regex = new RegExp(URL_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    let url = match[0];
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

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
