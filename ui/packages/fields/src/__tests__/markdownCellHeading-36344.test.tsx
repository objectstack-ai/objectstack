/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36344 — a markdown value that starts with a heading, drawn in a
 * grid column, keeps the row the height of every other row.
 *
 * The grid clamps a rich-content cell to one line, but the line was the
 * heading's: `prose-sm` draws an `h1` at heading size, so the cell showed a
 * truncated H1 and the row grew. In a grid column (`inGridColumn`) the cell
 * now draws its value in the `cell` face: no heading element, the heading as
 * a bold line, and the body at the cell's own font size and line height.
 * Every other caller keeps the `document` face and its heading elements.
 *
 * jsdom does no layout, so these pins read the element and class contract the
 * row height rests on; the pixel readings are in the pull request.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, with the SAME specifier `MarkdownCellRenderer`'s `React.lazy`
// factory uses, so the lazy chunk is resolved before any assertion runs.
import '../widgets/MarkdownContent.js';
import { getCellRenderer, resolveCellRendererType } from '../index';

const HEADING_VALUE = '# Heading\n\nBody with **bold** text';
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

afterEach(() => cleanup());

/** Resolve the way every read surface does, then settle past the Suspense fallback. */
async function renderMarkdown(value: string, props: { inGridColumn?: boolean } = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type: 'markdown' }) || 'markdown');
  const utils = render(<Renderer value={value} field={{ type: 'markdown' } as any} {...props} />);
  const face = await waitFor(() => {
    const el = utils.container.querySelector<HTMLElement>('[data-markdown-face]');
    if (!el) throw new Error('markdown body not rendered yet');
    return el;
  });
  return { ...utils, face };
}

describe('objectstack#36344 — a markdown heading in a grid cell is drawn at the cell size', () => {
  it('in a grid column: no heading element, the heading is a bold line, the body inherits the cell size', async () => {
    const { face } = await renderMarkdown(HEADING_VALUE, { inGridColumn: true });

    expect(face).toHaveAttribute('data-markdown-face', 'cell');
    expect(face.querySelector(HEADINGS)).toBeNull();

    const heading = face.querySelector<HTMLElement>('[data-markdown-heading]');
    expect(heading?.tagName).toBe('P');
    expect(heading).toHaveTextContent('Heading');
    expect(heading).toHaveClass('font-semibold');

    // The body takes the cell's own font size and line height, so the line
    // the grid's one-line clamp shows is a line of the cell's text.
    expect(face).toHaveClass('text-[length:inherit]', 'leading-[inherit]');

    // The rest of the value is still formatted, not flattened to source text.
    expect(face.querySelector('strong')).toHaveTextContent('bold');
    expect(face.textContent).not.toContain('#');
  });

  it('in a grid column: every heading level is drawn the same way', async () => {
    const value = ['# one', '## two', '### three', '#### four', '##### five', '###### six'].join('\n\n');
    const { face } = await renderMarkdown(value, { inGridColumn: true });
    expect(face.querySelector(HEADINGS)).toBeNull();
    expect(face.querySelectorAll('[data-markdown-heading]')).toHaveLength(6);
  });

  it('CONTROL — outside a grid column (the record page) the heading element and its size stay', async () => {
    const { face } = await renderMarkdown(HEADING_VALUE);

    expect(face).toHaveAttribute('data-markdown-face', 'document');
    expect(face.querySelector('h1')).toHaveTextContent('Heading');
    expect(face.querySelector('[data-markdown-heading]')).toBeNull();
    expect(face).toHaveClass('prose', 'prose-sm');
    expect(face).not.toHaveClass('text-[length:inherit]');
    expect(face).not.toHaveClass('leading-[inherit]');
  });
});

/**
 * objectstack#36452 — the same face for the `html` and `richtext` cell. Both
 * types read through `HtmlCellRenderer`, which drew a stored `<h1>` as a
 * heading element in every caller, so a list row holding one grew to the
 * heading's line height (45 px against 36 px in Chromium; readings in the
 * pull request). In a grid column it now draws the sanitized tree with the
 * markdown cell's face; outside one the heading element stays.
 */
const HTML_HEADING_VALUE = '<h1>Heading</h1><p>Body with <strong>bold</strong> text</p><script>alert(1)</script>';

async function renderHtml(type: 'html' | 'richtext', value: string, props: { inGridColumn?: boolean } = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const utils = render(<Renderer value={value} field={{ type } as any} {...props} />);
  const face = await waitFor(() => {
    const el = utils.container.querySelector<HTMLElement>('[data-html-face]');
    if (!el) throw new Error('html body not rendered yet');
    return el;
  });
  return { ...utils, face };
}

describe('objectstack#36452 — an html or richtext heading in a grid cell is drawn at the cell size', () => {
  for (const type of ['html', 'richtext'] as const) {
    it(`${type} in a grid column: no heading element, the heading is a bold line, the body inherits the cell size`, async () => {
      const { face } = await renderHtml(type, HTML_HEADING_VALUE, { inGridColumn: true });

      expect(face).toHaveAttribute('data-html-face', 'cell');
      expect(face.querySelector(HEADINGS)).toBeNull();

      const heading = face.querySelector<HTMLElement>('[data-html-heading]');
      expect(heading?.tagName).toBe('P');
      expect(heading).toHaveTextContent('Heading');
      expect(heading).toHaveClass('font-semibold');
      expect(face).toHaveClass('prose', 'prose-sm', 'text-[length:inherit]', 'leading-[inherit]');

      // Sanitisation is the same in this face: the script is gone, the rest formatted.
      expect(face.querySelector('script')).toBeNull();
      expect(face.textContent).not.toContain('alert');
      expect(face.querySelector('strong')).toHaveTextContent('bold');
    });
  }

  it('html in a grid column: every heading level is drawn the same way', async () => {
    const value = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => `<${tag}>${tag}</${tag}>`).join('');
    const { face } = await renderHtml('html', value, { inGridColumn: true });
    expect(face.querySelector(HEADINGS)).toBeNull();
    expect(face.querySelectorAll('[data-html-heading]')).toHaveLength(6);
  });

  it('the markdown and html cells draw a heading with the same element and classes', async () => {
    const md = await renderMarkdown('# Heading', { inGridColumn: true });
    const mdHeading = md.face.querySelector<HTMLElement>('[data-markdown-heading]');
    const html = await renderHtml('html', '<h1>Heading</h1>', { inGridColumn: true });
    const htmlHeading = html.face.querySelector<HTMLElement>('[data-html-heading]');
    expect(htmlHeading?.tagName).toBe(mdHeading?.tagName);
    expect(htmlHeading?.className).toBe(mdHeading?.className);
    expect(html.face.className).toBe(md.face.className);
  });

  for (const type of ['html', 'richtext'] as const) {
    it(`CONTROL — ${type} outside a grid column (the record page, a readonly form) keeps the heading element`, async () => {
      const { face } = await renderHtml(type, HTML_HEADING_VALUE);

      expect(face).toHaveAttribute('data-html-face', 'document');
      expect(face.querySelector('h1')).toHaveTextContent('Heading');
      expect(face.querySelector('[data-html-heading]')).toBeNull();
      expect(face).toHaveClass('prose', 'prose-sm');
      expect(face).not.toHaveClass('text-[length:inherit]');
      expect(face).not.toHaveClass('leading-[inherit]');
      expect(face.querySelector('script')).toBeNull();
    });
  }
});
