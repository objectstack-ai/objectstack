/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8580 — the rich-content renderers drew a childless container for
 * `[]` and the literal `[object Object]` for `{}`.
 *
 * Third part of the empty-array census. objectui#8481 moved the three
 * multi-value renderers whose output for `[]` was BLANK; objectui#8490 moved
 * the nine that FABRICATED a value. Re-measured by rendering all 53 registered
 * field types against `[]`, `{}`, `''` and `null` through `getCellRenderer`
 * on `7102b20d9`, this is what remained of the blank class:
 *
 * | field types    | renderer               | rendered for `[]`                                                     | rendered for `{}`             |
 * |----------------|------------------------|-----------------------------------------------------------------------|-------------------------------|
 * | markdown       | `MarkdownCellRenderer` | a childless DIV classed `prose` (Suspense fallback: a childless SPAN) | a P reading `[object Object]` |
 * | html, richtext | `HtmlCellRenderer`     | a childless DIV classed `prose`                                       | the text `[object Object]`    |
 *
 * Neither container carried padding, a border or a click target — `prose`
 * sets colour, font metrics and `max-width`, and the cell binds no handler —
 * so this is the objectui#8481 shape (nothing drawn where a placeholder
 * belongs, no accessible name), not the live-anchor shape of objectui#8490.
 *
 * ── Two defects, two rulings, decided separately ──────────────────────────
 * `@objectstack/spec` types all three fields as a plain string
 * (`STRING_VALUE_TYPES`; the write seam is `z.string()`), in the same value
 * class as `text` / `textarea` / `code`. Neither `[]` nor `{}` is a value of
 * that class, and the two are answered differently:
 *
 *   - `[]` → the shared `EmptyValue`. It holds no string and nothing to
 *     format; "No value" is TRUE of it, and it matches the twelve siblings
 *     the first two parts moved.
 *   - `{}` → NOT the affordance, and NOT `[object Object]`. The record is
 *     storing something, so "No value" would be false; `[object Object]` is
 *     `String()`'s artefact and no sibling prints it. The string class already
 *     has one answer for an object — `coerceToSafeValue`: the display name
 *     when the object carries one, `[Object]` otherwise — and the three rich
 *     types now take that answer and FORMAT it, exactly as `text` prints it.
 *     Pinned against `text` directly below, so the two cannot drift.
 *
 * Both rulings are one mechanism: test the coerced TEXT, not the raw value —
 * the reason every other text-like type already answered `[]` correctly.
 *
 * ── Why the POPULATED cases are the load-bearing ones ─────────────────────
 * The caricature is `EmptyValue` drawn unconditionally. It passes every `[]`
 * case in this file. What refuses it is the POPULATED block: real markdown
 * still renders its elements, real HTML still renders SANITISED — pinned to
 * the sanitiser's exact output bytes, so a repair that shortcut the populated
 * branch past the sanitizer fails on bytes, not on a count — and real
 * richtext still renders. Each was RUN against the caricature; the observed
 * failure sentences are recorded in the PR.
 *
 * ── Assertion order ───────────────────────────────────────────────────────
 * Each `[]` case asserts the defect's ABSENCE first ("must not render a
 * childless container") and the affordance's presence second, so the unfixed
 * tree and a harness that has lost the affordance's `data-slot` fail on two
 * different sentences. Both were observed.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, and with the SAME specifier `MarkdownCellRenderer`'s
// `React.lazy` factory uses (ESM caches by resolved path), so the markdown
// pipeline is resolved before any assertion waits on it — AGENTS.md 测试纪律.
import '../widgets/MarkdownContent.js';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

const RICH_TYPES = ['markdown', 'html', 'richtext'] as const;

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(<Renderer value={value as any} field={{ type, name: type } as any} />);
}

/** Let the (already imported) lazy markdown pipeline resolve its Suspense. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The shared "No value" affordance — a muted glyph carrying an aria-label. */
const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

/**
 * The defect's signature: an element that exists, occupies the cell and has
 * nothing inside it. Asserted structurally rather than by text, because its
 * whole problem is that it has no text to look for.
 */
function childlessContainers(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div, span')).filter(
    (el) =>
      el.childElementCount === 0 &&
      (el.textContent ?? '') === '' &&
      el.getAttribute('data-slot') !== 'empty-value',
  );
}

const textOf = (root: HTMLElement) => (root.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The showcase seed's own richtext specimen, byte for byte (objectui#5452). */
const SEED_RICHTEXT = '<p>Rich <strong>text</strong></p>';

/** Stored markup a display surface must not execute. */
const HOSTILE_HTML =
  '<p>ok</p><script>alert(1)</script>' +
  '<img src="x" onerror="alert(2)">' +
  '<a href="javascript:alert(3)">go</a>';

/** What the sanitizer makes of {@link HOSTILE_HTML} — the bytes, not a count. */
const HOSTILE_HTML_SANITISED = '<p>ok</p><img src="x"><a>go</a>';

/** What a WYSIWYG editor actually emits, beyond the seed's two tags. */
const WYSIWYG_DOCUMENT = [
  '<h2>Heading</h2>',
  '<p>Body with <strong>bold</strong>, <em>em</em> and a ',
  '<a href="https://objectstack.ai">link</a>.</p>',
  '<ul><li>one</li><li>two</li></ul>',
  '<blockquote>quoted</blockquote>',
].join('');

describe('objectui#8580 — a rich-content cell holding [] or {} says what it holds', () => {
  describe('THE DEFECT — [] renders the No-value affordance, not a childless container', () => {
    for (const type of RICH_TYPES) {
      it(`THE DEFECT — \`${type}\` holding [] renders the affordance, not a childless container`, async () => {
        const { container } = renderCell(type, []);

        // Defect-absence FIRST, read synchronously: on the unfixed tree this
        // is the sentence that fails (a childless `prose` DIV, or for
        // markdown the childless Suspense fallback SPAN). A harness that has
        // lost the affordance's `data-slot` passes it and fails below.
        expect(
          childlessContainers(container).length,
          `${type}: [] must not render a childless container (the objectui#8481 shape)`,
        ).toBe(0);
        expect(
          container.querySelector('div.prose'),
          `${type}: [] must not open a prose container with nothing to put in it`,
        ).toBeNull();
        expectAffordance(container, type);

        // And once the lazy markdown pipeline has had its turn: still nothing
        // but the affordance.
        await settle();
        expect(
          container.querySelector('div.prose'),
          `${type}: [] must not open a prose container once the pipeline settles`,
        ).toBeNull();
        expect(
          childlessContainers(container).length,
          `${type}: [] must not render a childless container once the pipeline settles`,
        ).toBe(0);
        expectAffordance(container, `${type} (settled)`);
      });
    }
  });

  describe("THE SECOND DEFECT — {} prints the string class's answer, not [object Object]", () => {
    for (const type of RICH_TYPES) {
      it(`THE SECOND DEFECT — \`${type}\` holding {} prints [Object], not [object Object], and not the affordance`, async () => {
        const { container } = renderCell(type, {});
        await settle();

        expect(
          textOf(container),
          `${type}: [object Object] is String()'s artefact, not a rendering`,
        ).not.toContain('[object Object]');
        expect(
          affordance(container),
          `${type}: {} is not "No value" — the record is storing something`,
        ).toBeNull();
        expect(
          textOf(container),
          `${type}: an object with no display name reads as the string class reads it`,
        ).toBe('[Object]');
      });
    }

    it('THE SECOND DEFECT — {} on a rich type reads exactly as it reads on `text` (the same spec value class)', async () => {
      const control = renderCell('text', {});
      const controlText = textOf(control.container);
      expect(controlText, 'control: `text` must print something for {}').not.toBe('');
      cleanup();

      for (const type of RICH_TYPES) {
        const { container } = renderCell(type, {});
        await settle();
        expect(textOf(container), `${type}: must print what \`text\` prints for {}`).toBe(controlText);
        cleanup();
      }
    });

    it('THE SECOND DEFECT — an object carrying a display name renders that name, as `text` does', async () => {
      const md = renderCell('markdown', { name: 'Ada Lovelace' });
      await settle();
      expect(textOf(md.container), 'markdown: an object with a name prints its name').toBe('Ada Lovelace');
      expect(affordance(md.container), 'markdown: a named object is not "No value"').toBeNull();
      cleanup();

      const html = renderCell('html', { label: 'Grace Hopper' });
      expect(textOf(html.container), 'html: an object with a label prints its label').toBe('Grace Hopper');
      expect(affordance(html.container), 'html: a labelled object is not "No value"').toBeNull();
    });
  });

  describe('POPULATED — these refuse an EMPTY-for-everything implementation', () => {
    it('POPULATED — real markdown still renders its elements', async () => {
      const { container } = renderCell('markdown', '**bold** and _em_');
      await settle();

      const prose = container.querySelector('div.prose');
      expect(prose, 'markdown: a populated value must still open its prose container').not.toBeNull();
      expect(prose?.querySelector('strong')?.textContent, 'markdown: **bold** must still render bold').toBe('bold');
      expect(prose?.querySelector('em')?.textContent, 'markdown: _em_ must still render emphasised').toBe('em');
      expect(affordance(container), 'markdown: a populated value must NOT render the affordance').toBeNull();
      expect(textOf(container), 'markdown: a populated string is never coerced to a placeholder').not.toContain('[Object]');
    });

    it('POPULATED — real html still renders SANITISED, byte for byte', () => {
      const { container } = renderCell('html', HOSTILE_HTML);

      const prose = container.querySelector('div.prose');
      expect(prose, 'html: a populated value must still open its prose container').not.toBeNull();
      // The bytes, not a count: this is what the sanitizer produces for the
      // hostile document, so a populated branch that stopped running through
      // it — or a sanitiser that changed — fails here on content.
      expect(prose?.innerHTML, 'html: the populated branch must still run through the sanitizer').toBe(HOSTILE_HTML_SANITISED);
      expect(prose?.querySelector('script'), 'html: script blocks must still be stripped').toBeNull();
      expect(affordance(container), 'html: a populated value must NOT render the affordance').toBeNull();
    });

    it('POPULATED — real richtext still renders SANITISED, byte for byte', () => {
      const { container } = renderCell('richtext', HOSTILE_HTML);

      const prose = container.querySelector('div.prose');
      expect(prose, 'richtext: a populated value must still open its prose container').not.toBeNull();
      expect(prose?.innerHTML, 'richtext: the populated branch must still run through the sanitizer').toBe(HOSTILE_HTML_SANITISED);
      expect(affordance(container), 'richtext: a populated value must NOT render the affordance').toBeNull();
    });

    it('POPULATED — real richtext still renders the markup a WYSIWYG editor emits', () => {
      const { container } = renderCell('richtext', WYSIWYG_DOCUMENT);

      const prose = container.querySelector('div.prose');
      expect(prose, 'richtext: a document must still open its prose container').not.toBeNull();
      for (const selector of ['h2', 'p', 'strong', 'em', 'ul', 'li', 'blockquote']) {
        expect(prose?.querySelector(selector), `richtext: a document must still render its ${selector}`).not.toBeNull();
      }
      expect(prose?.querySelector('a')?.getAttribute('href'), 'richtext: a real link still links').toBe('https://objectstack.ai');
      expect(affordance(container), 'richtext: a document must NOT render the affordance').toBeNull();
    });

    it('POPULATED — `html` and `richtext` still render the SAME bytes for the same stored value (objectui#5452)', () => {
      const html = renderCell('html', SEED_RICHTEXT);
      const htmlBytes = html.container.querySelector('div.prose')?.innerHTML;
      // Pin the bytes as REAL before comparing them: on the caricature both
      // sides are `undefined`, and `undefined` equals `undefined`.
      expect(
        typeof htmlBytes === 'string' && htmlBytes.includes('<strong>text</strong>'),
        'html: the seed specimen must still render its bytes',
      ).toBe(true);
      cleanup();
      const rich = renderCell('richtext', SEED_RICHTEXT);
      expect(rich.container.querySelector('div.prose')?.innerHTML, 'richtext must render as html does').toBe(htmlBytes);
      expect(rich.container.querySelector('strong')?.textContent, 'the seed specimen still renders its bold').toBe('text');
    });

    it('POPULATED — a ONE-entry array is a value: it formats its one entry', async () => {
      // Refuses an over-correction spelled `Array.isArray` rather than "is
      // there anything to format": `['**bold**']` coerces to the string and
      // formats exactly as the scalar does (the objectui#8490 email ruling).
      const { container } = renderCell('markdown', ['**bold**']);
      await settle();
      expect(container.querySelector('strong')?.textContent, 'markdown: a one-entry array formats its entry').toBe('bold');
      expect(affordance(container), 'markdown: a one-entry array must NOT render the affordance').toBeNull();
    });
  });

  describe('THE BOUNDARY — what this change deliberately does and does not sweep', () => {
    it("THE BOUNDARY — '' and null still render the affordance (unchanged)", () => {
      for (const type of RICH_TYPES) {
        for (const [label, value] of [["''", ''], ['null', null]] as const) {
          const { container } = renderCell(type, value);
          expectAffordance(container, `${type} holding ${label}`);
          expect(childlessContainers(container).length, `${type} holding ${label}: no childless container`).toBe(0);
          cleanup();
        }
      }
    });

    it("THE BOUNDARY — [''] has nothing to format either: the test is on the coerced text", () => {
      for (const type of RICH_TYPES) {
        const { container } = renderCell(type, ['']);
        expectAffordance(container, `${type} holding ['']`);
        expect(container.querySelector('div.prose'), `${type} holding ['']: no prose container`).toBeNull();
        cleanup();
      }
    });

    it('THE BOUNDARY — a whitespace-only string is a string value and is NOT swept in', () => {
      // Declared, not incidental: the spec's value class is "a plain string"
      // and `TextCellRenderer` draws one too. Trimming it into the affordance
      // would be a second ruling this change does not make.
      for (const type of RICH_TYPES) {
        const { container } = renderCell(type, '   ');
        expect(affordance(container), `${type}: whitespace is a string value, not "No value"`).toBeNull();
        cleanup();
      }
    });

    it('THE BOUNDARY — a scalar number still prints (unchanged: `0` was never the affordance here)', () => {
      const { container } = renderCell('html', 0);
      expect(textOf(container), 'html: a stored 0 still prints').toBe('0');
      expect(affordance(container), 'html: a stored 0 is not "No value"').toBeNull();
    });
  });
});
