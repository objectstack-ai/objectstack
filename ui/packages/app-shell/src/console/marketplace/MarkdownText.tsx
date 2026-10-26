/**
 * Tiny CommonMark-subset renderer for marketplace READMEs.
 *
 * Covers what app authors actually write in their README field:
 *   • `#`, `##`, `###` headings
 *   • Blank-line-separated paragraphs
 *   • `- ` / `* ` bulleted lists (single level)
 *   • `1. ` numbered lists (single level)
 *   • `**bold**`, `*italic*`, `` `code` ``, `[text](url)` inline
 *   • Triple-backtick fenced code blocks
 *
 * Deliberately NOT a full Markdown engine — we want zero new deps and
 * predictable output. If a README really needs tables or images, the
 * publisher can host their own docs and link via `homepage_url`.
 *
 * Raw HTML (objectui#12146) is recognised by CommonMark's own grammar — the
 * "HTML blocks" section's seven start conditions and the "Raw HTML" section's
 * inline forms — and then skipped: neither rendered (a README is third-party
 * content) nor printed as literal text. It is what react-markdown's `skipHtml`
 * option does over a full CommonMark tree, done by this renderer's own parser
 * because there is no engine underneath it to hand the option to. The inline half —
 * `**bold**`, `*italic*`, `` `code` ``, `[text](url)` and inline raw HTML —
 * is `@object-ui/components`' `renderInlineMarkdown` (objectui#12778), shared
 * with `element:text`. The source is
 * never pre-filtered: HTML inside a code span or a fenced block is code, and
 * prints as before.
 */

import { RAW_HTML_CLOSING_TAG, RAW_HTML_OPEN_TAG, renderInlineMarkdown } from '@object-ui/components';

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol' | 'code' | 'html';
  text?: string;
  items?: string[];
  lang?: string;
}

// ── CommonMark raw-HTML grammar ─────────────────────────────────────────────
// The open and closing tag come from `@object-ui/components`, where the inline
// "Raw HTML" pass that shares them lives; the block rules below build on them.

/** Condition 6's tag names. */
const BLOCK_TAG_NAMES = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col',
  'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr',
  'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol',
  'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'title', 'tr', 'track', 'ul',
].join('|');

interface HtmlBlockRule {
  start: RegExp;
  /** The line that closes the block (inclusive), or `'blank'`: it runs until a blank line. */
  end: RegExp | 'blank';
  /** Conditions 1–6 can interrupt a paragraph; condition 7 cannot. */
  interruptsParagraph: boolean;
}

/** "HTML blocks": the seven start conditions, in the spec's order, each with its end condition. */
const HTML_BLOCK_RULES: HtmlBlockRule[] = [
  { start: /^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i, end: /<\/(?:pre|script|style|textarea)>/i, interruptsParagraph: true },
  { start: /^ {0,3}<!--/, end: /-->/, interruptsParagraph: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interruptsParagraph: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interruptsParagraph: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interruptsParagraph: true },
  { start: new RegExp(`^ {0,3}<\\/?(?:${BLOCK_TAG_NAMES})(?:[ \\t>]|\\/>|$)`, 'i'), end: 'blank', interruptsParagraph: true },
  {
    start: new RegExp(`^ {0,3}(?!<\\/?(?:pre|script|style|textarea)(?:[\\s/>]|$))(?:${RAW_HTML_OPEN_TAG}|${RAW_HTML_CLOSING_TAG})[ \\t]*$`, 'i'),
    end: 'blank',
    interruptsParagraph: false,
  },
];

function htmlBlockRule(line: string): HtmlBlockRule | null {
  return HTML_BLOCK_RULES.find((rule) => rule.start.test(line)) ?? null;
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', text: buf.join('\n'), lang });
      continue;
    }

    // Raw HTML block: consumed through its end condition and kept as a node
    // the renderer skips.
    const html = htmlBlockRule(line);
    if (html) {
      if (html.end === 'blank') {
        while (i < lines.length && lines[i].trim()) i++;
      } else {
        const end = html.end;
        while (i < lines.length) {
          const closes = end.test(lines[i]);
          i++;
          if (closes) break;
        }
      }
      blocks.push({ type: 'html' });
      continue;
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push({ type: (`h${level}` as 'h1' | 'h2' | 'h3'), text: h[2].trim() });
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Blank line → flush
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (collect until blank / heading / list)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !htmlBlockRule(lines[i])?.interruptsParagraph
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: buf.join(' ') });
  }
  return blocks;
}

// Inline pass: the one inline renderer `element:text` uses too
// (objectui#12778), with this card's look. A README is third-party content, so
// every link opens a new tab, and a link whose scheme is not `http:`, `https:`,
// `mailto:` or `tel:` prints as its text.
const README_INLINE = {
  classNames: {
    code: 'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]',
    strong: 'font-semibold text-foreground',
    link: 'text-violet-600 underline-offset-2 hover:underline dark:text-violet-400',
  },
  newTab: 'all',
} as const;

function renderInline(input: string): React.ReactNode {
  return renderInlineMarkdown(input, README_INLINE);
}

export function MarkdownText({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={`flex flex-col gap-4 text-sm leading-relaxed text-foreground/90 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
            return <h2 key={i} className="mt-2 text-xl font-bold tracking-tight">{renderInline(b.text ?? '')}</h2>;
          case 'h2':
            return <h3 key={i} className="mt-3 text-base font-semibold tracking-tight">{renderInline(b.text ?? '')}</h3>;
          case 'h3':
            return <h4 key={i} className="mt-2 text-sm font-semibold tracking-tight text-foreground/80">{renderInline(b.text ?? '')}</h4>;
          case 'p':
            return <p key={i}>{renderInline(b.text ?? '')}</p>;
          case 'ul':
            return (
              <ul key={i} className="ml-1 flex list-none flex-col gap-1.5">
                {(b.items ?? []).map((it, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden="true" className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500/70" />
                    <span>{renderInline(it)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="ml-5 flex list-decimal flex-col gap-1.5 marker:text-muted-foreground">
                {(b.items ?? []).map((it, j) => (
                  <li key={j} className="pl-1">{renderInline(it)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                <code className="font-mono">{b.text}</code>
              </pre>
            );
          case 'html':
            // Skipped: neither rendered nor printed (objectui#12146).
            return null;
        }
        return null;
      })}
    </div>
  );
}
