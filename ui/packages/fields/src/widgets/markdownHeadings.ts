/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The headings a markdown value's `document` face draws (objectstack#37562).
 *
 * The value is run through the face's own pipeline: react-markdown with
 * `MARKDOWN_REMARK_PLUGINS` and `MARKDOWN_REHYPE_PLUGINS`, the lists
 * `./MarkdownContent.tsx` draws with, declared here once for both, and the
 * tree is read after the last of them, so the headings answered are the
 * ones drawn, by construction: a setext heading, one inside a quote, a list item
 * or a footnote, and the `Footnotes` label the footnote section draws are
 * answered; a raw heading tag, a heading-shaped line in code and a line the
 * parse reads as something else are not.
 *
 * Loaded on demand through `./MarkdownContent.tsx` (`loadDrawnMarkdownHeadings`
 * in the package index), so react-markdown stays in the lazy chunk the face
 * lives in.
 */
import Markdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { RICH_TEXT_SANITIZE_SCHEMA } from './sanitizedHtml.js';

/** The remark plugins a markdown value is parsed with: GitHub Flavored Markdown. */
export const MARKDOWN_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm];

/** The rehype plugins the parsed value is drawn through: sanitized, against the `html` / `richtext` schema. */
export const MARKDOWN_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [[rehypeSanitize, RICH_TEXT_SANITIZE_SCHEMA]];

/** One drawn heading: its text as the face draws it, and where it starts in the value (none for a heading the pipeline adds). */
export interface DrawnMarkdownHeading {
  text: string;
  start: number | undefined;
}

/** The part of a drawn tree's node this reader looks at. */
interface DrawnNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: DrawnNode[];
  position?: { start?: { offset?: number } };
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textOf(node: DrawnNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** The headings `value` draws in the markdown `document` face, in document order. */
export function drawnMarkdownHeadings(value: string): DrawnMarkdownHeading[] {
  let drawn: DrawnNode | undefined;
  const readTree = () => (tree: DrawnNode) => {
    drawn = tree;
  };
  // `Markdown` holds no hooks: called as a function it runs the face's
  // pipeline once, and `readTree` sees the tree after every plugin the face uses.
  Markdown({ children: value, remarkPlugins: MARKDOWN_REMARK_PLUGINS, rehypePlugins: [...MARKDOWN_REHYPE_PLUGINS, readTree] });
  const out: DrawnMarkdownHeading[] = [];
  const walk = (node: DrawnNode): void => {
    if (node.type === 'element' && node.tagName && HEADING_TAGS.has(node.tagName)) {
      out.push({ text: textOf(node), start: node.position?.start?.offset });
      return;
    }
    node.children?.forEach(walk);
  };
  if (drawn) walk(drawn);
  return out;
}
