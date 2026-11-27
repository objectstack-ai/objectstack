/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37801 — in the document face (the record page, a readonly form
 * field) a rich-content value draws its top three heading levels one step
 * smaller than `prose-sm` does, and keeps them heading ELEMENTS.
 *
 * `prose-sm` draws an `h1` at 30 px inside one field of a record page. The
 * document face now carries `prose-h1:text-lg prose-h2:text-base
 * prose-h3:text-sm`. The elements stay `h1`–`h6`, because a `?section=` link
 * finds a cited section by its heading element; the cell face, which draws no
 * heading element (objectstack#36344, objectstack#36452), is unchanged.
 *
 * jsdom does no layout, so these pins read the element and class contract the
 * sizes rest on; the pixel readings are in the pull request.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, with the SAME specifier `MarkdownCellRenderer`'s `React.lazy`
// factory uses, so the lazy chunk is resolved before any assertion runs.
import '../widgets/MarkdownContent.js';
import { getCellRenderer, resolveCellRendererType } from '../index';
import { RICH_TEXT_CELL_FACE_CLASS, RICH_TEXT_DOCUMENT_CLASS } from '../widgets/richTextDisplay';

const HEADING_SIZES = ['prose-h1:text-lg', 'prose-h2:text-base', 'prose-h3:text-sm'];

afterEach(() => cleanup());

async function renderFace(type: 'markdown' | 'html' | 'richtext', value: string, props: { inGridColumn?: boolean } = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const utils = render(<Renderer value={value} field={{ type } as any} {...props} />);
  const marker = type === 'markdown' ? '[data-markdown-face]' : '[data-html-face]';
  const face = await waitFor(() => {
    const el = utils.container.querySelector<HTMLElement>(marker);
    if (!el) throw new Error(`${type} body not rendered yet`);
    return el;
  });
  return { ...utils, face };
}

const MARKDOWN = ['# One', '## Two', '### Three', '#### Four'].join('\n\n');
const HTML = '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>';

describe('objectstack#37801 — the document face draws h1–h3 one step smaller, as heading elements', () => {
  it('markdown: h1–h4 are still h1–h4, under the smaller heading sizes', async () => {
    const { face } = await renderFace('markdown', MARKDOWN);
    expect(face).toHaveAttribute('data-markdown-face', 'document');
    expect(face.querySelector('h1')).toHaveTextContent('One');
    expect(face.querySelector('h2')).toHaveTextContent('Two');
    expect(face.querySelector('h3')).toHaveTextContent('Three');
    expect(face.querySelector('h4')).toHaveTextContent('Four');
    expect(face).toHaveClass('prose', 'prose-sm', ...HEADING_SIZES);
  });

  for (const type of ['html', 'richtext'] as const) {
    it(`${type}: h1–h4 are still h1–h4, under the same heading sizes as markdown`, async () => {
      const { face } = await renderFace(type, HTML);
      expect(face).toHaveAttribute('data-html-face', 'document');
      for (const [tag, text] of [['h1', 'One'], ['h2', 'Two'], ['h3', 'Three'], ['h4', 'Four']]) {
        expect(face.querySelector(tag)).toHaveTextContent(text);
      }
      const md = await renderFace('markdown', MARKDOWN);
      expect(face.className).toBe(md.face.className);
    });
  }

  it('the document face is the shared typography plus the heading sizes, and nothing of the cell face', () => {
    const tokens = RICH_TEXT_DOCUMENT_CLASS.split(/\s+/);
    expect(tokens).toEqual(expect.arrayContaining(HEADING_SIZES));
    expect(tokens).not.toContain('text-[length:inherit]');
    expect(tokens).not.toContain('leading-[inherit]');
  });

  it('CONTROL — the cell face class is byte-for-byte what it was, with no heading size', () => {
    expect(RICH_TEXT_CELL_FACE_CLASS).toBe(
      'prose prose-sm max-w-none dark:prose-invert break-words text-[length:inherit] leading-[inherit]',
    );
  });

  it('CONTROL — in a grid column markdown and html draw no heading element and no heading size', async () => {
    const md = await renderFace('markdown', MARKDOWN, { inGridColumn: true });
    const html = await renderFace('html', HTML, { inGridColumn: true });
    for (const face of [md.face, html.face]) {
      expect(face.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
      expect(face.className).toBe(RICH_TEXT_CELL_FACE_CLASS);
      for (const size of HEADING_SIZES) expect(face).not.toHaveClass(size);
    }
  });
});
