/**
 * Tiny CommonMark-subset renderer for marketplace READMEs.
 *
 * Covers what app authors actually write in their README field:
 *   • `#`, `##`, `###` headings
 *   • Blank-line-separated paragraphs
 *   • `- ` / `* ` bulleted lists (single level)
 *   • `1. ` numbered lists (single level)
 *   • `**bold**`, `*italic*`, `` `code` ``, `[text](url)` inline
 *   • `![alt](src)` images, linked or not: drawn only from an absolute
 *     `https:` URL, else left out (a repository-relative path such as
 *     `LICENSE` names nothing the console can load). A linked image keeps
 *     its anchor only for an absolute `http(s):` destination, for the same
 *     reason. Image syntax inside a code span stays code.
 *   • GFM pipe tables (header row, delimiter row, body rows), each in its
 *     own horizontal scroller
 *   • Thematic breaks (`---`, `***`, `___`) between blocks
 *   • Triple-backtick fenced code blocks
 *   • `>` blockquotes: consecutive `>` lines, their content parsed as blocks
 *     (so a quote nests lists, code and further quotes). A GitHub alert —
 *     `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` on the
 *     quote's first line — renders as the same plain quote with the marker
 *     dropped. CommonMark's lazy continuation (an unprefixed line continuing a
 *     quoted paragraph) is not read: an unprefixed line ends the quote.
 *
 * Deliberately NOT a full Markdown engine — we want zero new deps and
 * predictable output.
 *
 * Width: the README fits its column. Long words wrap; only a fenced block and
 * a table scroll, each inside itself. The column itself must be allowed to
 * shrink below its content (`min-w-0` on the grid cell that holds it).
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

import { Fragment, type ReactNode } from 'react';
import { RAW_HTML_CLOSING_TAG, RAW_HTML_OPEN_TAG, renderInlineMarkdown } from '@object-ui/components';

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol' | 'code' | 'html' | 'quote' | 'table' | 'hr';
  text?: string;
  items?: string[];
  lang?: string;
  /** A blockquote's content, parsed as blocks. */
  children?: Block[];
  /** A table's header cells, its body rows (each padded to the header's count) and per-column alignment. */
  table?: { head: string[]; rows: string[][]; align: TableAlign[] };
}

// ── Thematic breaks ─────────────────────────────────────────────────────────

/** Three or more `-`, `*` or `_`, alone on the line, spaces allowed between them. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** CommonMark's setext underline: under a paragraph line it is not a rule. */
const SETEXT_UNDERLINE = /^ {0,3}-+[ \t]*$/;

// ── GFM pipe tables ─────────────────────────────────────────────────────────

type TableAlign = 'left' | 'center' | 'right' | null;

/** A delimiter row: `---`, `:--`, `--:` or `:-:` cells between pipes. */
const TABLE_DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A row's cells: the outer pipes dropped, split on every pipe not escaped as `\|`. */
function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** A table starts where a line holding a pipe sits above a delimiter row with the same cell count. */
function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const delimiter = lines[i + 1];
  if (!head?.includes('|') || delimiter === undefined || !TABLE_DELIMITER_ROW.test(delimiter)) return false;
  if (!delimiter.includes('|') && !head.trim().startsWith('|')) return false;
  return tableCells(head).length === tableCells(delimiter).length;
}

/** A line that opens a heading, a fence, a quote or a rule, which ends a table. */
function startsOtherBlock(line: string): boolean {
  return /^#{1,3}\s+/.test(line) || line.startsWith('```') || QUOTE_LINE.test(line) || THEMATIC_BREAK.test(line);
}

function tableAlign(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

// ── Blockquotes ─────────────────────────────────────────────────────────────

/** A blockquote line: up to three spaces of indent, then `>`. */
const QUOTE_LINE = /^ {0,3}>/;
/** The quote marker and the one optional space after it. */
const QUOTE_MARKER = /^ {0,3}> ?/;
/**
 * GitHub's alert marker, alone on a quote's first line. GitHub matches the
 * five types case-insensitively; anything else in brackets stays text.
 */
const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;

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

    // Blockquote: the run of `>` lines, unprefixed, parsed as its own blocks.
    // A GitHub alert's marker line is dropped, leaving a plain quote.
    if (QUOTE_LINE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE_MARKER, ''));
        i++;
      }
      if (ALERT_MARKER.test(inner[0])) inner.shift();
      blocks.push({ type: 'quote', children: parseBlocks(inner.join('\n')) });
      continue;
    }

    // Thematic break, before the bullet list: `* * *` is a rule, not an item.
    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // GFM pipe table: the header, the delimiter row, then every following line
    // that holds a pipe, up to a blank line.
    if (isTableStart(lines, i)) {
      const head = tableCells(line);
      const align = tableCells(lines[i + 1]).map(tableAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !startsOtherBlock(lines[i])) {
        const cells = tableCells(lines[i]);
        rows.push(head.map((_, c) => cells[c] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', table: { head, rows, align } });
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
      !QUOTE_LINE.test(lines[i]) &&
      !htmlBlockRule(lines[i])?.interruptsParagraph &&
      !isTableStart(lines, i) &&
      // `***` and `___` end a paragraph; a `---` line under one stays its text, as before.
      !(THEMATIC_BREAK.test(lines[i]) && !SETEXT_UNDERLINE.test(lines[i]))
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

// ── Images ──────────────────────────────────────────────────────────────────
// Matched here, before the shared inline pass, which has no image rule: an
// image is a request the viewer's browser makes to a third party, so the rule
// stays this card's. A destination may hold one level of balanced parentheses.

const DESTINATION = '((?:[^()\\s]|\\([^()\\s]*\\))+)';
const IMAGE = `!\\[([^\\]]*)\\]\\(${DESTINATION}(?:\\s+"[^"]*")?\\)`;
/** A linked image, `[![alt](src)](href)`, or a bare image, `![alt](src)`; a code span is matched so it is skipped. */
const IMAGE_OR_CODE = new RegExp(`(?<!\`)\`[^\`]+\`(?!\`)|\\[${IMAGE}\\]\\(${DESTINATION}\\)|${IMAGE}`);

/** An absolute URL with the given schemes, or `null`: a relative path resolves against the console, not the repository. */
function absoluteUrl(raw: string, schemes: readonly string[]): string | null {
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    return schemes.includes(new URL(raw).protocol) ? raw : null;
  } catch {
    return null;
  }
}

function readmeImage(alt: string, rawSrc: string): ReactNode {
  const src = absoluteUrl(rawSrc, ['https:']);
  if (src === null) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="inline-block h-auto max-w-full align-middle"
    />
  );
}

function renderInline(input: string): ReactNode {
  const out: ReactNode[] = [];
  let text = '';
  let remaining = input;
  for (let m = IMAGE_OR_CODE.exec(remaining); m; m = IMAGE_OR_CODE.exec(remaining)) {
    const [whole, linkedAlt, linkedSrc, href, alt, src] = m;
    text += remaining.slice(0, m.index);
    remaining = remaining.slice(m.index + whole.length);
    if (whole.startsWith('`')) {
      text += whole;
      continue;
    }
    if (text) out.push(renderInlineMarkdown(text, README_INLINE));
    text = '';
    if (linkedSrc === undefined) {
      out.push(readmeImage(alt, src));
      continue;
    }
    const image = readmeImage(linkedAlt, linkedSrc);
    const target = image === null ? null : absoluteUrl(href, ['https:', 'http:']);
    out.push(
      target === null ? image : (
        <a href={target} target="_blank" rel="noopener noreferrer" className={README_INLINE.classNames.link}>{image}</a>
      ),
    );
  }
  text += remaining;
  if (text) out.push(renderInlineMarkdown(text, README_INLINE));
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

/**
 * The two places a package's Markdown is read: `base` is the About card's
 * README, `compact` the Versions panel's release notes — a narrow side column
 * in muted small print, where README-sized headings would outweigh the
 * version they annotate.
 */
type MarkdownSize = 'base' | 'compact';

const SIZE_CLASSES: Record<MarkdownSize, { root: string; stack: string; h1: string; h2: string; h3: string }> = {
  base: {
    root: 'text-sm leading-relaxed text-foreground/90',
    stack: 'gap-4',
    h1: 'mt-2 text-xl font-bold tracking-tight',
    h2: 'mt-3 text-base font-semibold tracking-tight',
    h3: 'mt-2 text-sm font-semibold tracking-tight text-foreground/80',
  },
  compact: {
    root: 'text-xs leading-relaxed text-muted-foreground',
    stack: 'gap-2',
    h1: 'text-sm font-semibold tracking-tight text-foreground',
    h2: 'text-xs font-semibold tracking-tight text-foreground',
    h3: 'text-xs font-medium tracking-tight text-foreground/80',
  },
};

const ALIGN_CLASSES: Record<NonNullable<TableAlign>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function renderBlocks(blocks: Block[], size: MarkdownSize): ReactNode[] {
  const cls = SIZE_CLASSES[size];
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'h1':
        return <h2 key={i} className={cls.h1}>{renderInline(b.text ?? '')}</h2>;
      case 'h2':
        return <h3 key={i} className={cls.h2}>{renderInline(b.text ?? '')}</h3>;
      case 'h3':
        return <h4 key={i} className={cls.h3}>{renderInline(b.text ?? '')}</h4>;
      case 'p':
        return <p key={i}>{renderInline(b.text ?? '')}</p>;
      case 'ul':
        return (
          <ul key={i} className="ml-1 flex list-none flex-col gap-1.5">
            {(b.items ?? []).map((it, j) => (
              <li key={j} className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500/70" />
                <span className="min-w-0">{renderInline(it)}</span>
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
      case 'table': {
        const { head, rows, align } = b.table!;
        const alignClass = (c: number) => ALIGN_CLASSES[align[c] ?? 'left'];
        return (
          <div key={i} className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse">
              <thead className="bg-muted/40">
                <tr>
                  {head.map((cell, c) => (
                    <th key={c} className={`border-b px-3 py-2 font-semibold text-foreground ${alignClass(c)}`}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} className="border-b last:border-b-0">
                    {row.map((cell, c) => (
                      <td key={c} className={`px-3 py-2 align-top ${alignClass(c)}`}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'hr':
        return <hr key={i} className="border-border" />;
      case 'quote':
        return (
          <blockquote key={i} className={`flex flex-col ${cls.stack} border-l-2 border-violet-500/40 pl-4 text-muted-foreground`}>
            {renderBlocks(b.children ?? [], size)}
          </blockquote>
        );
      case 'html':
        // Skipped: neither rendered nor printed (objectui#12146).
        return null;
    }
    return null;
  });
}

export function MarkdownText({ source, className, size = 'base' }: { source: string; className?: string; size?: MarkdownSize }) {
  const cls = SIZE_CLASSES[size];
  return (
    <div className={`flex min-w-0 flex-col break-words ${cls.stack} ${cls.root} ${className ?? ''}`}>
      {renderBlocks(parseBlocks(source), size)}
    </div>
  );
}
