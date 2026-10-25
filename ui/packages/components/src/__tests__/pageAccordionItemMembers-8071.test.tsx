/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:accordion.items` — the MEMBER SHAPE of one panel definition
 * (objectui#8071).
 *
 * The member pin for this key: which member of an authored item becomes which
 * part of the rendered accordion. `PageAccordionRenderer`
 * (`renderers/layout/containers.tsx`) reads exactly four members off each
 * element of `items` — `label`, `icon`, `collapsed`, `children` — and the
 * registration publishes that set verbatim
 * (`[{ label, icon?, collapsed?, children }] — collapsed: false opens a panel
 * by default`). Nothing asserted the mapping AS A SET before this file.
 *
 * What already existed, read end to end before this pin was written rather
 * than trusted on its greps: `page-accordion-icon.test.tsx` (objectui#4721)
 * pins ONE member, `icon`, and pins it well — per-item forwarding, a positive
 * control where only some panels declare one, and the no-icon case. It asserts
 * nothing about `label`, `collapsed` or `children`, and would not fail if those
 * three swapped roles. So `icon` is covered narrowly below rather than
 * re-litigated, and the members this file exists for are the other three.
 *
 * The `collapsed` member is the one with real semantics to get wrong, and the
 * renderer's reading is STRICTLY `=== false`:
 *
 *     const defaultOpen = itemsWithValue.filter((it) => it.collapsed === false)
 *
 * so `collapsed: false` OPENS a panel, while `collapsed: true` AND an omitted
 * `collapsed` both leave it shut. That is the inverse of how the member name
 * reads at a glance, which is exactly why it is pinned: an "obvious" edit to
 * `!it.collapsed` would open every panel that never mentioned the key.
 *
 * The single/multiple split is asserted too, because `allowMultiple` changes
 * what the SAME `collapsed` members mean: single mode takes `defaultOpen[0]`
 * (the FIRST opener wins, later ones are dropped), multiple mode takes them
 * all. A pin that only ever rendered one open panel could not tell the two
 * readings apart.
 *
 * Radix unmounts a closed panel's content, so "open" is asserted as the panel
 * BODY being in the document — the same observation `page-tabs-*` suites make
 * of an inactive tab, and one that cannot be satisfied by a header alone.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

vi.mock('../lib/lazy-icon', () => ({
  LazyIcon: ({ name, className }: { name?: string; className?: string }) => (
    <svg data-testid="accordion-item-icon" data-name={name} className={className} />
  ),
}));

afterEach(() => cleanup());

const textChild = (content: string) => [{ type: 'element:text', properties: { content } }];

const renderAccordion = (items: any[], rest: Record<string, unknown> = {}) =>
  render(<SchemaRenderer schema={{ type: 'page:accordion', id: 'acc', items, ...rest } as never} />);

describe('page:accordion items — member shape (objectui#8071)', () => {
  it('`label` becomes the panel trigger and `children` becomes that panel BODY', () => {
    // The two structural members, asserted against each other so a renderer
    // that painted the wrong one cannot pass: the label text is a trigger, the
    // child text is the panel content, and `collapsed: false` is what puts the
    // body in the document at all.
    const { getByRole, getByText } = renderAccordion([
      { label: 'Details', collapsed: false, children: textChild('DETAILS BODY') },
      { label: 'Notes', children: textChild('NOTES BODY') },
    ]);

    // `label` -> the trigger's accessible name.
    expect(getByRole('button', { name: /Details/i })).toBeTruthy();
    expect(getByRole('button', { name: /Notes/i })).toBeTruthy();
    // `children` -> the open panel's body. NOT the label, and not a sibling of it.
    expect(getByText('DETAILS BODY')).toBeTruthy();
  });

  it('`collapsed: false` opens a panel; `collapsed: true` and an OMITTED collapsed both stay shut', () => {
    // The `=== false` reading, pinned against the two ways a panel stays
    // closed. The omitted-key arm is the half an `!it.collapsed` edit breaks.
    const { queryByText } = renderAccordion([
      { label: 'Open me', collapsed: false, children: textChild('OPEN BODY') },
      { label: 'Explicitly shut', collapsed: true, children: textChild('SHUT BODY') },
      { label: 'Says nothing', children: textChild('SILENT BODY') },
    ]);

    expect(queryByText('OPEN BODY')).not.toBeNull();
    expect(queryByText('SHUT BODY')).toBeNull();
    // The control that separates "reads `=== false`" from "reads truthiness":
    // an item with no `collapsed` at all must behave like `collapsed: true`.
    expect(queryByText('SILENT BODY')).toBeNull();
  });

  it('every panel stays shut when NO item declares `collapsed: false` (the default)', () => {
    // Non-vacuity for the assertion above: without this, a renderer that opened
    // nothing ever would satisfy both "shut" rows for the wrong reason.
    const { queryByText, getByRole } = renderAccordion([
      { label: 'Alpha', children: textChild('ALPHA BODY') },
      { label: 'Beta', children: textChild('BETA BODY') },
    ]);

    expect(getByRole('button', { name: /Alpha/i })).toBeTruthy();
    expect(queryByText('ALPHA BODY')).toBeNull();
    expect(queryByText('BETA BODY')).toBeNull();
  });

  it('single mode opens only the FIRST `collapsed: false` panel', () => {
    // `defaultValue={defaultOpen[0]}` — later openers are dropped, because a
    // Radix `type="single"` accordion holds one value.
    const { queryByText } = renderAccordion([
      { label: 'First', collapsed: false, children: textChild('FIRST BODY') },
      { label: 'Second', collapsed: false, children: textChild('SECOND BODY') },
    ]);

    expect(queryByText('FIRST BODY')).not.toBeNull();
    expect(queryByText('SECOND BODY')).toBeNull();
  });

  it('`allowMultiple` opens EVERY `collapsed: false` panel — same items, different reading', () => {
    // The same two items as the row above, so the only variable is
    // `allowMultiple`. This is what makes the previous row a statement about
    // single mode rather than about `collapsed`.
    const { queryByText } = renderAccordion(
      [
        { label: 'First', collapsed: false, children: textChild('FIRST BODY') },
        { label: 'Second', collapsed: false, children: textChild('SECOND BODY') },
        { label: 'Third', children: textChild('THIRD BODY') },
      ],
      { allowMultiple: true },
    );

    expect(queryByText('FIRST BODY')).not.toBeNull();
    expect(queryByText('SECOND BODY')).not.toBeNull();
    // …and `allowMultiple` does not open panels that never asked to be open.
    expect(queryByText('THIRD BODY')).toBeNull();
  });

  it('`icon` rides on the same item as its label, per panel', () => {
    // Narrow on purpose — `page-accordion-icon.test.tsx` (objectui#4721) is the
    // pin for this member and is not duplicated here. This row exists so the
    // member SET this file states is complete: four members, four assertions.
    const { getAllByTestId } = renderAccordion([
      { label: 'Details', icon: 'user', children: textChild('DETAILS BODY') },
      { label: 'Notes', children: textChild('NOTES BODY') },
    ]);

    const icons = getAllByTestId('accordion-item-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('data-name')).toBe('user');
  });
});
