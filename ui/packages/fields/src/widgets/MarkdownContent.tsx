import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from './markdownHeadings.js';
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
 * The plugin lists this face draws with, and the reader of the headings it
 * draws, which runs the same lists (objectstack#37562). They live in
 * `./markdownHeadings.ts` and are answered from here, so the one module the
 * package loads on demand for markdown is this one: a module both loaded on
 * demand and imported statically would not leave the eager chunk.
 */
export { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS, drawnMarkdownHeadings } from './markdownHeadings.js';

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
