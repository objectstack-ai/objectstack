import React from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { RICH_TEXT_SANITIZE_SCHEMA } from './sanitizedHtml.js';
import {
  RICH_TEXT_CELL_FACE_CLASS,
  RICH_TEXT_DOCUMENT_CLASS,
  cellFaceHeadings,
  type RichTextFace,
} from './richTextDisplay.js';

/**
 * The two faces a markdown value is drawn in — the rich-content faces of
 * `./richTextDisplay.tsx`, shared with the `html` / `richtext` pipeline
 * (objectstack#36344, objectstack#36452).
 */
export type MarkdownFace = RichTextFace;

/**
 * The remark plugins a markdown value is parsed with: GitHub Flavored Markdown.
 * `./markdownHeadings.ts` reads the drawn headings through the same list, so a
 * reader of the face and the face never disagree on what is a heading.
 */
export const MARKDOWN_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm];

/** The rehype plugins the parsed value is drawn through: sanitized, against the `html` / `richtext` schema. */
export const MARKDOWN_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [[rehypeSanitize, RICH_TEXT_SANITIZE_SCHEMA]];

/** In the cell face no heading element is drawn (see `cellFaceHeadings`). */
const CELL_COMPONENTS: Components = cellFaceHeadings('data-markdown-heading');

/**
 * Heavy markdown renderer, split into its own module so it can be lazy-loaded
 * by the cell/detail renderers (react-markdown pulls in ~100-200 KB). GitHub
 * Flavored Markdown + sanitization (defense against XSS in stored content),
 * against the same schema the `html` / `richtext` pipeline uses.
 */
export default function MarkdownContent({ value, face = 'document' }: { value: string; face?: MarkdownFace }) {
  const cell = face === 'cell';
  return (
    <div className={cell ? RICH_TEXT_CELL_FACE_CLASS : RICH_TEXT_DOCUMENT_CLASS} data-markdown-face={face}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={cell ? CELL_COMPONENTS : undefined}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
