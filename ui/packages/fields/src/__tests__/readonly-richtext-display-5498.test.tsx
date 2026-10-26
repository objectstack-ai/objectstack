/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5498: a readonly `markdown` / `html` / `richtext` form field showed
 * the user the MARKUP SOURCE of their own content.
 *
 * `RichTextField`'s readonly early return rendered `{value}` as a React text
 * child, so a readonly markdown field displayed its asterisks and hashes and a
 * readonly richtext field displayed its tags. The same stored bytes render
 * FORMATTED on every other read surface — grid, kanban card, gallery, related
 * list, dashboard record panel, record detail read mode — because they all
 * dispatch through `getCellRenderer`. One field, two readings, depending only
 * on which surface the user happened to be looking at.
 *
 * ## Why this file exists at all
 *
 * `readonly-host-plumbing-e2e.test.tsx` already renders the readonly branch of
 * all 34 registered types and was green throughout — it asserts ACCESSIBILITY
 * PLUMBING (accessible name, `aria-describedby` ownership) and nothing about
 * what the branch DISPLAYS. That is exactly why this stayed invisible, so the
 * durable half of the fix is a display pin, and it lives here rather than as
 * one more assertion there: that file's subject is the host↔widget contract,
 * this one's is what a user sees.
 *
 * ## What is pinned, and the two negative controls
 *
 * The positive pin is per type, through the REAL form renderer: the formatted
 * elements are present AND the source characters are gone (both halves — a
 * pipeline that renders nothing at all satisfies "no asterisks" too, which is
 * the objectui#5452 failure read from the other side). Then the cross-surface
 * assertion: the form's readonly output is compared, byte for byte, against
 * what `getCellRenderer` produces for the same value — the invariant being
 * restored, stated directly rather than inferred from two separate snapshots.
 *
 * The controls are what keep the fix from being "render everything as HTML":
 *
 *  1. a readonly PLAIN TEXT field still shows its value literally, markup
 *     characters and all — nothing else moved;
 *  2. the html/richtext path is the sanitizing renderer, demonstrably: script
 *     blocks, inline handlers and `javascript:` URLs are stripped from what a
 *     readonly FORM field renders, not just from a grid cell.
 *
 * The widgets are registered raw rather than through `registerAllFields()`,
 * whose `React.lazy` loaders put an unbounded module load inside a bounded
 * `findBy` window — this repo's known flake generator (AGENTS.md 测试纪律,
 * objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';
// Module scope, and with the SAME specifier `MarkdownCellRenderer` uses in its
// `React.lazy` factory (ESM caches by resolved path), so the markdown pipeline
// is already resolved when the assertions run. In a hook or left implicit it
// would be an unbounded module load racing a bounded `waitFor` — AGENTS.md
// 测试纪律.
import '../widgets/MarkdownContent.js';

import { RichTextField } from '../widgets/RichTextField';
import { TextField } from '../widgets/TextField';
import { getCellRenderer, resolveCellRendererType, MarkdownCellRenderer, HtmlCellRenderer } from '../index';
import { richTextCellRenderer } from '../widgets/richTextDisplay';

/** The showcase seed's own richtext specimen, byte for byte (objectui#5452). */
const SEED_RICHTEXT = '<p>Rich <strong>text</strong></p>';

/** A markdown value carrying both of the source characters the issue names. */
const SEED_MARKDOWN = '# Heading\n\n**bold** and _em_';

/** Stored markup that a display surface must not execute. */
const HOSTILE_HTML =
  '<p>ok</p><script>alert(1)</script>' +
  '<img src="x" onerror="alert(2)">' +
  '<a href="javascript:alert(3)">go</a>';

beforeAll(() => {
  ComponentRegistry.register('markdown', RichTextField as any, { namespace: 'field', skipFallback: true });
  ComponentRegistry.register('html', RichTextField as any, { namespace: 'field', skipFallback: true });
  ComponentRegistry.register('richtext', RichTextField as any, { namespace: 'field', skipFallback: true });
  ComponentRegistry.register('text', TextField as any, { namespace: 'field', skipFallback: true });
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fieldName = (type: string) => `f_${type}`;

/** The real form renderer hosting one field — the reproduction. */
function renderForm(type: string, value: unknown, opts: { readonly?: boolean } = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        defaultValues: { [fieldName(type)]: value },
        fields: [
          {
            name: fieldName(type),
            label: `Label ${type}`,
            type,
            ...(opts.readonly === false ? {} : { readonly: true }),
          },
        ],
      }}
    />,
  );
}

const item = (type: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-field="${fieldName(type)}"]`);
  if (!el) throw new Error(`no form item rendered for field "${fieldName(type)}"`);
  return el;
};

/**
 * The settled rich-content body of a readonly form field.
 *
 * Waiting for `div.prose` — which both pipelines produce — rather than reading
 * `textContent` synchronously is what makes the assertion look at the rendered
 * content instead of `MarkdownCellRenderer`'s Suspense fallback, whose fallback
 * shows the first 80 RAW characters and therefore reads as "not empty" for the
 * very defect this file pins (the objectui#5452 harness makes the same move).
 */
async function readonlyProse(type: string, value: unknown): Promise<HTMLElement> {
  renderForm(type, value);
  return waitFor(() => {
    const el = item(type).querySelector<HTMLElement>('div.prose');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

/** Render the same value the way the grid / detail page / kanban card does. */
async function cellProse(type: string, value: unknown): Promise<HTMLElement> {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const utils = render(<Renderer value={value as any} field={{ type } as any} />);
  return waitFor(() => {
    const el = utils.container.querySelector<HTMLElement>('div.prose');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe('a readonly rich-content form field renders formatted, not its source (objectui#5498)', () => {
  it('markdown: the heading and emphasis are rendered, the hashes and asterisks are gone', async () => {
    const prose = await readonlyProse('markdown', SEED_MARKDOWN);

    expect(prose.querySelector('h1')?.textContent).toBe('Heading');
    expect(prose.querySelector('strong')?.textContent).toBe('bold');
    expect(prose.querySelector('em')?.textContent).toBe('em');
    // The defect, stated as the user saw it.
    expect(prose.textContent).not.toContain('**');
    expect(prose.textContent).not.toContain('# ');
  });

  it.each([['html'], ['richtext']])(
    '%s: the tags are rendered as elements, not shown as text',
    async (type) => {
      const prose = await readonlyProse(type, SEED_RICHTEXT);

      expect(prose.querySelector('strong')?.textContent).toBe('text');
      expect(prose.textContent?.replace(/\s+/g, ' ').trim()).toBe('Rich text');
      // The defect, stated as the user saw it.
      expect(prose.textContent).not.toContain('<strong>');
      expect(prose.textContent).not.toContain('<p>');
    },
  );

  it.each([
    ['markdown', SEED_MARKDOWN],
    ['html', SEED_RICHTEXT],
    ['richtext', SEED_RICHTEXT],
  ])(
    '%s: the readonly form renders exactly what every other read surface renders',
    async (type, value) => {
      // The invariant this card restores, asserted directly: the form's
      // readonly branch and `getCellRenderer` — the resolver the grid, kanban
      // card, gallery, related list, dashboard panel and detail read mode all
      // call — are the same rendering for the same bytes.
      const form = await readonlyProse(type, value);
      const cell = await cellProse(type, value);

      expect(form.innerHTML).toBe(cell.innerHTML);
    },
  );
});

describe('negative controls — nothing else became a markup renderer (objectui#5498)', () => {
  it('a readonly plain-text field still shows its value literally, markup characters and all', async () => {
    const literal = '**not bold** and <b>not bold either</b>';
    renderForm('text', literal);

    const el = item('text');
    // No pipeline ran: no rendered rich-content body, and the source survives
    // character for character. `text` is not a rich-content type, and the fix
    // must not have made it one.
    expect(el.querySelector('div.prose')).toBeNull();
    expect(el.querySelector('strong')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain(literal);
  });

  it.each([['html'], ['richtext']])(
    '%s: the readonly form field renders through the SANITIZING pipeline',
    async (type) => {
      const prose = await readonlyProse(type, HOSTILE_HTML);

      // Stripped.
      expect(prose.querySelector('script')).toBeNull();
      expect(prose.innerHTML).not.toContain('alert(1)');
      expect(prose.innerHTML).not.toContain('onerror');
      // A dropped `href` reads `null`; a rewritten one must not name the scheme.
      expect(prose.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
      // …and the benign content around it survived, so the assertion above is
      // not passing because the whole value was dropped.
      expect(prose.textContent).toContain('ok');
      expect(prose.querySelector('a')?.textContent).toBe('go');
    },
  );
});

describe('the discriminator: the editable surface names no syntax at all (objectui#5498, objectui#12110)', () => {
  /**
   * The trap this card names. `field.format` is declared on `date`/`datetime`/
   * `time`/`phone`/`auto_number` and on NO rich-content type, so the old
   * `richField?.format || 'markdown'` read `undefined` for every real field and
   * answered `markdown` for all three types — which is why an `html` field's
   * header read "Format: markdown". Branching the DISPLAY on that same value
   * would have routed html and richtext through the markdown pipeline, which
   * drops raw HTML and renders a populated value as nothing.
   *
   * The header was asserted here because it was where the wrong discriminator
   * was VISIBLE. objectui#12110 (ruled B) removed it from every surface, so
   * each type's label is now asserted ABSENT from the editable form item: the
   * type is read only where it does work, by the readonly display above. The
   * textarea read first keeps the absence a reading of a rendered editor, not
   * of an empty item.
   */
  it.each([
    ['markdown', 'Format: markdown'],
    ['html', 'Format: html'],
    ['richtext', 'Format: html'],
  ])('%s: the editable item draws no "%s" header', (type, label) => {
    renderForm(type, '', { readonly: false });

    expect(item(type).querySelector('textarea')).not.toBeNull();
    expect(item(type).textContent).not.toContain(label);
    expect(item(type).textContent).not.toContain('Rich text editor (basic)');
  });
});

describe('the readonly display is looked up, never created during render (objectui#5498)', () => {
  /**
   * The claim `RichTextField`'s scoped `react-hooks/static-components` disable
   * makes, pinned rather than asserted in a comment.
   *
   * The rule fires on `<Display …/>` because it cannot see through the table
   * lookup — the same dispatch lints clean in `DetailSection` only because it
   * sits inside an IIFE there. Whether that is a rule limitation or a real
   * remount is a measurement, and objectui#5348 is why it has to be MEASURED:
   * three inline components shipped to `main` because this rule family bails
   * out silently on large components, remounting every row on a timer and
   * swallowing clicks. So both halves are checked here — the reference the
   * widget renders, and the DOM node that comes out of it.
   */
  it.each([['markdown'], ['html'], ['richtext']])(
    '%s: the lookup returns one stable module-scope component, not a fresh one per call',
    (type) => {
      const first = richTextCellRenderer(type);
      const second = richTextCellRenderer(type);

      expect(first).toBeDefined();
      // Reference identity across calls — what "not created during render" means.
      expect(second).toBe(first);
      // …and the reference IS the module-scope renderer the package exports,
      // not a wrapper around it.
      expect(first === MarkdownCellRenderer || first === HtmlCellRenderer).toBe(true);
      // …and it is the same component `getCellRenderer` resolves, which is the
      // one-table claim: the readonly form branch and every other read surface
      // index the same entry.
      expect(first).toBe(getCellRenderer(type));
    },
  );

  it('a non rich-content type resolves to no pipeline at all', () => {
    // The fallback is a real branch, not a theoretical one: it is what a host
    // passing no metadata, or a `widget:` override on a foreign type, lands on.
    expect(richTextCellRenderer('text')).toBeUndefined();
    expect(richTextCellRenderer('')).toBeUndefined();
  });

  it('the rendered node survives a re-render — nothing remounts', async () => {
    const Form = ComponentRegistry.get('form')!;
    const schema = (label: string) => ({
      type: 'form',
      mode: 'create',
      showSubmit: false,
      showCancel: false,
      defaultValues: { [fieldName('html')]: SEED_RICHTEXT },
      fields: [{ name: fieldName('html'), label, type: 'html', readonly: true }],
    });

    const { rerender } = render(<Form schema={schema('Label html') as any} />);
    const before = await waitFor(() => {
      const el = item('html').querySelector<HTMLElement>('div.prose');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // A real re-render: new schema object, changed label.
    rerender(<Form schema={schema('Label html renamed') as any} />);
    const after = item('html').querySelector<HTMLElement>('div.prose');

    // The SAME DOM node instance. A component constructed during render would
    // be a new element type each pass, so React would unmount and remount the
    // subtree — "reset their state each time they are created", the exact words
    // of the rule this pins.
    expect(after).toBe(before);
  });
});
