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
