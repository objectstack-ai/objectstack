import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { RICH_TEXT_SANITIZE_SCHEMA } from './sanitizedHtml.js';

/**
 * The two faces a markdown value is drawn in.
 *
 * - `document` — a full-size display (the record page, a readonly form field):
 *   headings keep their heading elements and the typography scale's sizes.
 * - `cell` — one cell of a grid column, whose row is one line of the cell's own
 *   text (objectstack#36344). A heading is drawn as a bold line at the cell's
 *   text size, not as a heading element, and the body inherits the cell's font
 *   size and line height, so a value that starts with `# Heading` keeps the row
 *   the height of every other row.
 */
export type MarkdownFace = 'document' | 'cell';

const DOCUMENT_CLASS = 'prose prose-sm max-w-none dark:prose-invert break-words';

/** The cell face: the same typography, at the size and line height of the cell around it. */
export const MARKDOWN_CELL_FACE_CLASS = `${DOCUMENT_CLASS} text-[length:inherit] leading-[inherit]`;

function CellHeading({ children }: { children?: React.ReactNode }) {
  return <p className="font-semibold" data-markdown-heading="">{children}</p>;
}

/**
 * In the cell face no heading element is drawn: a heading inside a table cell
 * is drawn at heading size by the typography scale, and it would also add one
 * entry per row to the page's heading outline.
 */
const CELL_COMPONENTS: Components = {
  h1: CellHeading,
  h2: CellHeading,
  h3: CellHeading,
  h4: CellHeading,
  h5: CellHeading,
  h6: CellHeading,
};

/**
 * Heavy markdown renderer, split into its own module so it can be lazy-loaded
 * by the cell/detail renderers (react-markdown pulls in ~100-200 KB). GitHub
 * Flavored Markdown + sanitization (defense against XSS in stored content),
 * against the same schema the `html` / `richtext` pipeline uses.
 */
export default function MarkdownContent({ value, face = 'document' }: { value: string; face?: MarkdownFace }) {
  const cell = face === 'cell';
  return (
    <div className={cell ? MARKDOWN_CELL_FACE_CLASS : DOCUMENT_CLASS} data-markdown-face={face}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, RICH_TEXT_SANITIZE_SCHEMA]]}
        components={cell ? CELL_COMPONENTS : undefined}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
