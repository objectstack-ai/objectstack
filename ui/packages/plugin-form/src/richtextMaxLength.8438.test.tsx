/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8438 — an authored ceiling on a rich-content field must be
 * VISIBLE, not only enforced at submit. The card measured it spelled
 * `max_length`; objectui#11070 retired that spelling (every reader reads the
 * spec's `maxLength` alone), so the definitions below declare `maxLength`.
 *
 * ## Pinned by behaviour, deliberately
 *
 * The card and its triage both ruled out the obvious pin: ⛔ asserting that
 * `'richtext'` appears in some list. That is the 假绿 objectui#4250 named and
 * objectui#4831 warned about — and this card is why. Re-measured on the
 * branch base, the two lists the card pointed at could not have carried the
 * cap at all:
 *
 *  - `ObjectForm`'s `text | textarea | markdown | html` guard writes
 *    `formField.maxLength`; a registered widget reads `formField.field`. A
 *    literal-only fix there would have been green and inert.
 *  - `EmbeddableForm`'s `DEFAULT_MAX_LENGTH` did deliver 5000 for `markdown`
 *    and `html` — and `RichTextField` read the key nowhere, so it died there.
 *
 * So every assertion below reads the DOM the person actually gets: the native
 * stop, the counter, and the id the control names in `aria-describedby`.
 *
 * ## The ablations these must survive
 *
 * Both are one-shot proofs, run on the fix commit and recorded in the PR:
 *
 *  - delete the `maxLength` read in `RichTextField` ⇒ BOTH suites red;
 *  - delete `richtext` from `RICH_TEXT_CELL_RENDERERS` (THE table the
 *    `EmbeddableForm` default is now derived from) ⇒ the default-cap suite red.
 *
 * ## The controls
 *
 * `markdown` and `html` are asserted beside `richtext` because they are the
 * SAME widget: a fix that reached only the third key would leave the asymmetry
 * this card is about. A rich field with NO authored cap, and a type outside
 * the table, are the negative controls — without them a widget that rendered a
 * counter unconditionally, or a cap table that answered every type, would pass.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';

import { ObjectForm } from './ObjectForm';
import { EmbeddableForm, applyDefaultMaxLengths } from './EmbeddableForm';

registerAllFields();

/** The three registry keys `RichTextField` serves, with distinct caps. */
const AUTHORED_CAPS = { md: 222, htm: 333, rich: 444 } as const;

const docSchema = {
  name: 'doc',
  fields: {
    // The sibling that has always worked — a live control, not a claim.
    note: { type: 'textarea', label: 'Note', maxLength: 111 },
    md: { type: 'markdown', label: 'MD', maxLength: AUTHORED_CAPS.md },
    htm: { type: 'html', label: 'HTML', maxLength: AUTHORED_CAPS.htm },
    rich: { type: 'richtext', label: 'Rich', maxLength: AUTHORED_CAPS.rich },
  },
};

const makeObjectDataSource = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(docSchema),
  create: vi.fn(),
  update: vi.fn(),
  findOne: vi.fn(),
});

const makeEmbeddableDataSource = () => ({
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: '1', ...d })),
  update: vi.fn(),
  delete: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(async () => ({ data: [], total: 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

/** The control the person types into, by field name. */
async function editorFor(container: HTMLElement, name: string): Promise<HTMLTextAreaElement> {
  return waitFor(() => {
    const el = container.querySelector(`textarea[name="${name}"]`) as HTMLTextAreaElement | null;
    if (!el) throw new Error(`textarea[name="${name}"] not rendered`);
    return el;
  });
}

/**
 * The accessible half of the cap: what a screen reader would actually read out
 * for this control, i.e. the text of the nodes its `aria-describedby` NAMES.
 *
 * Resolving the ids (rather than asserting the id string) is the point — an
 * `aria-describedby` that names a node which does not exist announces nothing,
 * and that is the failure this family of bugs actually takes.
 *
 * ⚠️ Unresolvable ids are dropped rather than failed on: `<FormControl>` names
 * its `-form-item-description` id unconditionally, including for fields that
 * render no description, so a dangling entry is present on this repo's happy
 * path and is not this card's subject.
 */
function describedText(el: HTMLTextAreaElement): string {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => el.ownerDocument.getElementById(id))
    .filter((n): n is HTMLElement => Boolean(n))
    .map((n) => n.textContent || '')
    .join(' ');
}

describe('objectui#8438 — ObjectForm: an authored maxLength is visible on a rich-content field', () => {
  it.each([
    ['richtext', 'rich', AUTHORED_CAPS.rich],
    ['markdown', 'md', AUTHORED_CAPS.md],
    ['html', 'htm', AUTHORED_CAPS.htm],
  ])('%s: the native stop, the counter and the description all carry the cap', async (_type, name, cap) => {
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'doc', mode: 'create' } as any}
        dataSource={makeObjectDataSource() as any}
      />,
    );

    const editor = await editorFor(container, name);
    // 1. the native stop
    expect(editor.getAttribute('maxlength')).toBe(String(cap));
    // 2. the visible counter, showing this field's own ceiling
    const counter = await waitFor(() => {
      const found = Array.from(container.querySelectorAll('[data-testid="richtext-character-count"]'))
        .find((n) => (n.textContent || '').includes(String(cap)));
      if (!found) throw new Error(`no counter naming ${cap}`);
      return found;
    });
    expect(counter.textContent).toContain(`0/${cap}`);
    // 3. the announcement — a real node, naming the ceiling
    expect(describedText(editor)).toContain(String(cap));
  });

  it('the sibling textarea widget is unchanged', async () => {
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'doc', mode: 'create' } as any}
        dataSource={makeObjectDataSource() as any}
      />,
    );
    const note = await editorFor(container, 'note');
    expect(note.getAttribute('maxlength')).toBe('111');
  });

  it('CONTROL — a rich-content field with no authored cap gets no stop and no counter', async () => {
    // Rendered ALONE, so "no counter anywhere in this form" is a statement
    // about this field. A widget that rendered the counter unconditionally, or
    // a cap resolved from something other than the authored key, fails here.
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'doc',
        fields: { uncapped: { type: 'richtext', label: 'Uncapped' } },
      }),
      create: vi.fn(),
      update: vi.fn(),
      findOne: vi.fn(),
    };
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'doc', mode: 'create' } as any}
        dataSource={ds as any}
      />,
    );
    const uncapped = await editorFor(container, 'uncapped');
    expect(uncapped.getAttribute('maxlength')).toBeNull();
    expect(container.querySelectorAll('[data-testid="richtext-character-count"]')).toHaveLength(0);
    expect(uncapped.getAttribute('aria-describedby') || '').not.toContain('charcount');
  });
});

describe('objectui#8438 — EmbeddableForm: the hardened default cap covers every rich-content key', () => {
  it.each([
    ['richtext', 'rich'],
    ['markdown', 'md'],
    ['html', 'htm'],
  ])('%s: an uncapped public-form field is capped at the long-text default', async (type, name) => {
    const { container } = render(
      <EmbeddableForm
        config={{
          objectName: 'lead',
          customFields: [{ name, label: name, type }] as any,
        } as any}
        dataSource={makeEmbeddableDataSource() as any}
      />,
    );
    const editor = await editorFor(container, name);
    expect(editor.getAttribute('maxlength')).toBe('5000');
    expect(describedText(editor)).toContain('5000');
  });

  it('an AUTHORED cap still wins over the default', () => {
    const out = applyDefaultMaxLengths([{ name: 'rich', type: 'richtext', maxLength: 40 } as any]);
    expect((out![0] as any).maxLength).toBe(40);
  });

  it('CONTROL — a type outside the rich-content table gets no long-text default', () => {
    const out = applyDefaultMaxLengths([
      { name: 'n', type: 'number' } as any,
      { name: 'j', type: 'json' } as any,
    ]);
    expect((out![0] as any).maxLength).toBeUndefined();
    expect((out![1] as any).maxLength).toBeUndefined();
  });
});
