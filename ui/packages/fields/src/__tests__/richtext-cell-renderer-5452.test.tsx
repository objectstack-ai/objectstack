/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5452: a POPULATED `richtext` field rendered as a completely empty
 * cell. `richtext` stores HTML — that is what the showcase seed carries
 * (`examples/app-showcase/src/data/seed/index.ts`, `f_richtext`) and what
 * `content/docs/data-modeling/field-type-decision-tree.mdx` documents
 * ("Formatted content with HTML/WYSIWYG"). The display registry nevertheless
 * dispatched it to `MarkdownCellRenderer`, whose sanitizing GFM pipeline drops
 * raw HTML — and since a richtext value is ENTIRELY HTML, everything was
 * dropped and the cell came out blank. Failure direction is the bad one: no
 * error, no fallback, no console warning, so a populated field reads as an
 * empty field.
 *
 * Two things are pinned here, and they pull in opposite directions on purpose:
 *
 *  1. `richtext` / `html` / `markdown` each render NON-EMPTY content for a
 *     populated value of their own shape. That is the class-level pin — the
 *     defect was silent invisibility, and only a non-emptiness assertion
 *     catches it again for a sibling type.
 *
 *  2. `markdown` still DROPS raw HTML. The card's load-bearing constraint is
 *     that this must not be "fixed" by loosening the markdown pipeline to pass
 *     raw HTML through, which would change every `markdown` cell's trust
 *     boundary. So the markdown renderer is pinned on the same HTML bytes that
 *     `richtext` must now render: markdown renders them as nothing, and that
 *     is correct for markdown.
 *
 * Every case resolves its renderer through `getCellRenderer` — the display
 * resolver the grid, the kanban card, the gallery, the related list AND the
 * record detail page all call — rather than importing a renderer directly, so
 * these fail on the registry entry regressing, not merely on a formatter
 * changing.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

/** The showcase seed's own richtext specimen, byte for byte. */
const SEED_RICHTEXT = '<p>Rich <strong>text</strong></p>';

/** A markdown-shaped value — the control the issue measured alongside it. */
const SEED_MARKDOWN = '**bold** and _em_';

/** What a WYSIWYG editor actually emits, beyond the seed's two tags. */
const WYSIWYG_DOCUMENT = [
  '<h2>Heading</h2>',
  '<p>Body with <strong>bold</strong>, <em>em</em> and a ',
  '<a href="https://objectstack.ai">link</a>.</p>',
  '<ul><li>one</li><li>two</li></ul>',
  '<blockquote>quoted</blockquote>',
].join('');

/** Resolve + render exactly the way `DetailSection` builds a read-mode value. */
function renderThroughDisplayRegistry(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(<Renderer value={value as any} field={{ type } as any} />);
}

/**
 * Render and settle. `MarkdownCellRenderer` is lazy-loaded behind a `Suspense`
 * whose fallback shows the first 80 raw characters — so a synchronous read of
 * `container.textContent` sees the RAW STRING and reads as "not empty" for the
 * very defect this file exists to pin. Waiting for the rendered `div.prose`
 * (both the markdown and the HTML renderer produce one) is what makes the
 * assertion look at the settled cell body instead of the fallback.
 */
async function renderRichCell(type: string, value: unknown) {
  const utils = renderThroughDisplayRegistry(type, value);
  const prose = await waitFor(() => {
    const el = utils.container.querySelector('div.prose');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  return { ...utils, prose };
}

describe('rich-content cell renderers (objectui#5452)', () => {
  describe('a populated value never renders as an empty cell', () => {
    it.each([
      ['richtext', SEED_RICHTEXT, 'Rich text'],
      ['html', SEED_RICHTEXT, 'Rich text'],
      ['markdown', SEED_MARKDOWN, 'bold and em'],
    ])('%s', async (type, value, expected) => {
      const { prose } = await renderRichCell(type, value);
      expect(prose.textContent?.trim()).not.toBe('');
      expect(prose.textContent?.replace(/\s+/g, ' ').trim()).toBe(expected);
    });
  });

  it('renders `richtext` the way it renders `html` for the SAME stored bytes', async () => {
    const rich = await renderRichCell('richtext', SEED_RICHTEXT);
    const html = await renderRichCell('html', SEED_RICHTEXT);

    // The issue's control: same bytes, neighbouring declared types. Before the
    // fix the richtext side of this pair was empty while the html side was not.
    expect(rich.prose.innerHTML).toBe(html.prose.innerHTML);
    expect(rich.prose.querySelector('strong')?.textContent).toBe('text');
  });

  it('keeps the markup a WYSIWYG editor legitimately emits', async () => {
    const { prose } = await renderRichCell('richtext', WYSIWYG_DOCUMENT);

    for (const selector of ['h2', 'p', 'strong', 'em', 'ul', 'li', 'blockquote']) {
      expect(prose.querySelector(selector)).not.toBeNull();
    }
    expect(prose.querySelector('a')?.getAttribute('href')).toBe('https://objectstack.ai');
  });

  it('still sanitizes a richtext value — the display path is not a trust hole', async () => {
    const hostile =
      '<p>ok</p><script>alert(1)</script>' +
      '<img src="x" onerror="alert(2)">' +
      '<a href="javascript:alert(3)">go</a>';
    const { prose } = await renderRichCell('richtext', hostile);

    expect(prose.querySelector('script')).toBeNull();
    expect(prose.innerHTML).not.toContain('onerror');
    // A dropped `href` reads `null`; a rewritten one must not name the scheme.
    expect(prose.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect(prose.textContent).toContain('ok');
  });

  describe("the markdown pipeline's trust boundary is unchanged", () => {
    it('drops raw HTML in a `markdown` value — the same bytes richtext now renders', async () => {
      const { prose } = await renderRichCell('markdown', SEED_RICHTEXT);

      // Correct for `markdown`, and the reason #5452 is not a one-character
      // change: making this pass raw HTML through would move every markdown
      // cell's trust boundary.
      expect(prose.querySelector('strong')).toBeNull();
      expect(prose.textContent?.trim()).toBe('');
    });

    it('still formats markdown-shaped input', async () => {
      const { prose } = await renderRichCell('markdown', SEED_MARKDOWN);

      expect(prose.querySelector('strong')?.textContent).toBe('bold');
      expect(prose.querySelector('em')?.textContent).toBe('em');
    });
  });
});
