/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The one inline Markdown renderer (objectui#12778): `**bold**`, `*italic*`,
 * `` `code` `` and `[text](url)`, drawn as React elements, never as an HTML
 * string. Two surfaces read it: `element:text`, whose spec declares its
 * `content` as "Text or Markdown content", and the console's marketplace
 * README renderer (`MarkdownText` in `@object-ui/app-shell`), which owns the
 * block half (headings, lists, fences) and hands each block's text here.
 *
 * Raw HTML (objectui#12146) is recognised by CommonMark's "Raw HTML" grammar
 * and skipped: neither rendered nor printed. The grammar pieces are exported
 * because `MarkdownText`'s "HTML blocks" rules are spelled from the same open
 * and closing tag.
 *
 * A link keeps its `href` only for `http:`, `https:`, `mailto:` and `tel:`, or
 * for a scheme-less reference (a path, a query, a fragment). Anything else —
 * `javascript:`, `data:`, `vbscript:`, in any case — prints its text with no
 * anchor. React 19 blocks `javascript:` URLs itself; this check does not lean
 * on that, and refuses the other schemes too. An `href` carrying whitespace or a control
 * character is refused outright, because browsers strip those before reading
 * the scheme (`java\tscript:` runs as `javascript:`).
 *
 * Emphasis follows CommonMark's flanking rule in its simplest form: the
 * delimiter run may not sit against whitespace on its inner side, so a lone
 * `*` or `2 * 3 * 4` prints as typed. A code span is a single backtick pair;
 * a run of two or more backticks (a fence typed into inline text) prints as
 * typed.
 */

import * as React from 'react';

// ── CommonMark raw-HTML grammar ─────────────────────────────────────────────
// Spelled from the spec's definitions, piece by piece, so each can be checked
// against its section: a tag name, an attribute, an open tag, a closing tag.
const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTE_VALUE = `(?:[^"'=<>\`\\s]+|'[^']*'|"[^"]*")`;
const ATTRIBUTE = `(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*${ATTRIBUTE_VALUE})?)`;
/** CommonMark "open tag", as a RegExp source. */
export const RAW_HTML_OPEN_TAG = `<${TAG_NAME}${ATTRIBUTE}*\\s*\\/?>`;
/** CommonMark "closing tag", as a RegExp source. */
export const RAW_HTML_CLOSING_TAG = `<\\/${TAG_NAME}\\s*>`;

/** "Raw HTML": an open or closing tag, a comment, a processing instruction, a declaration or a CDATA section. */
const INLINE_HTML = new RegExp(
  [
    RAW_HTML_OPEN_TAG,
    RAW_HTML_CLOSING_TAG,
    '<!-->',
    '<!--->',
    '<!--[\\s\\S]*?-->',
    '<\\?[\\s\\S]*?\\?>',
    '<![A-Za-z][^>]*>',
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
  ].join('|'),
);

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * The `href` a Markdown link may carry, or `null` when it may not carry one.
 * Allow-list, not deny-list: a scheme this does not name is refused.
 */
export function safeLinkHref(raw: string): string | null {
  if (!raw || /\s/.test(raw) || hasControlCharacter(raw)) return null;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(raw);
  if (scheme) return SAFE_SCHEMES.has(`${scheme[1].toLowerCase()}:`) ? raw : null;
  // No scheme: a path (`/pricing`, `./a`, `docs/x`), a query or a fragment.
  // A colon before any `/`, `?` or `#` would make the browser read a scheme
  // the regex above did not, so it is refused rather than guessed at.
  const firstColon = raw.indexOf(':');
  if (firstColon !== -1) {
    const firstDelimiter = raw.search(/[/?#]/);
    if (firstDelimiter === -1 || firstColon < firstDelimiter) return null;
  }
  return raw;
}

export interface InlineMarkdownOptions {
  /** Classes for the drawn elements; each defaults to none. */
  classNames?: { code?: string; strong?: string; em?: string; link?: string };
  /**
   * Which links open in a new tab (`target="_blank" rel="noopener noreferrer"`):
   * `'all'`, or `'external'` — `http:` / `https:` and protocol-relative URLs,
   * leaving a same-site path, `mailto:` and `tel:` in the same tab.
   */
  newTab?: 'all' | 'external';
}

function opensInNewTab(href: string, newTab: InlineMarkdownOptions['newTab']): boolean {
  if (newTab === 'all') return true;
  return /^(?:https?:)?\/\//i.test(href);
}

/**
 * Renders one run of text through the inline subset. Every pattern is tried
 * at each step and the earliest match wins, so the order below only breaks
 * ties at the same position.
 */
export function renderInlineMarkdown(input: string, options: InlineMarkdownOptions = {}): React.ReactNode {
  const { classNames = {}, newTab = 'external' } = options;
  const out: React.ReactNode[] = [];
  let remaining = input;
  const patterns: { re: RegExp; render: (m: RegExpExecArray) => React.ReactNode }[] = [
    { re: /(?<!`)`([^`]+)`(?!`)/, render: (m) => <code className={classNames.code}>{m[1]}</code> },
    { re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/, render: (m) => <strong className={classNames.strong}>{m[1]}</strong> },
    { re: /\*([^*\s](?:[^*]*[^*\s])?)\*/, render: (m) => <em className={classNames.em}>{m[1]}</em> },
    {
      re: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (m) => {
        const href = safeLinkHref(m[2]);
        // Refused: the link's text prints, the destination does not.
        if (href === null) return m[1];
        return opensInNewTab(href, newTab) ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={classNames.link}>{m[1]}</a>
        ) : (
          <a href={href} className={classNames.link}>{m[1]}</a>
        );
      },
    },
    // Inline raw HTML: matched so it is consumed, rendered as nothing.
    { re: INLINE_HTML, render: () => null },
  ];

  while (remaining) {
    let bestIdx = -1;
    let bestMatch: RegExpExecArray | null = null;
    let bestPattern: (typeof patterns)[number] | null = null;
    for (const p of patterns) {
      const m = p.re.exec(remaining);
      if (m && (bestIdx === -1 || m.index < bestIdx)) {
        bestIdx = m.index;
        bestMatch = m;
        bestPattern = p;
      }
    }
    if (!bestMatch || !bestPattern) {
      out.push(remaining);
      break;
    }
    if (bestIdx > 0) out.push(remaining.slice(0, bestIdx));
    out.push(bestPattern.render(bestMatch));
    remaining = remaining.slice(bestIdx + bestMatch[0].length);
  }
  return <>{out.map((n, i) => <React.Fragment key={i}>{n}</React.Fragment>)}</>;
}
