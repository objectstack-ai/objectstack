/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordDetailDrawer`'s empty `<dd>` draws the shared `EmptyValue`
 * (objectui#8504).
 *
 * ## The defect
 *
 * The drill-to-record drawer spelled its own placeholder — `<span
 * className="text-muted-foreground/60">—</span>` — with no `data-slot`, no
 * `aria-label` and none of the shared component's `select-none` /
 * `no-underline` / `pointer-events-none`. A screen reader walking the
 * definition list heard a label ("Stage") followed by a naked punctuation mark.
 *
 * Its own neighbours already had the real thing: `renderFieldValue` hands empty
 * values back as `''` and the drawer's guard catches them, but a value that
 * survives to a type-aware cell renderer reaches that renderer's own empty
 * branch, which returns `EmptyValue`. Two visually-identical dashes in one
 * drawer, only one of them announced.
 *
 * ## Which case DISCRIMINATES — MEASURED, not predicted
 *
 * The caricature was RUN: the `<dd>` rewritten to `<EmptyValue />`
 * unconditionally, filled rows included. All three cases go red, on three
 * different assertions:
 *
 *   - `a field the record omits entirely` fails on "CONTROL: the filled sibling
 *     is still not a placeholder" — the one assertion here that fails BECAUSE a
 *     filled row gained a placeholder.
 *   - `NON-REGRESSION` fails one assertion earlier, on "the value reaches the
 *     row": the caricature also stops the drawer printing values, so its own
 *     `no placeholder` half is never reached.
 *   - `THE DEFECT` fails ONLY on its control. Its headline claim is equally
 *     true of a drawer that renders nothing, which is why the control is not
 *     optional.
 *
 * Reverting the fix turns `THE DEFECT` and the omitted-field case red on their
 * headline assertions and leaves `NON-REGRESSION` green.
 *
 * ## A deliberate visual change
 *
 * The retired span was `text-muted-foreground/60`; the shared component is
 * `text-muted-foreground/50`. That one step is adopted on purpose — the whole
 * point of a shared placeholder is that a drawer cannot show two different
 * dashes — and the glyph is unchanged.
 *
 * Assertions are scoped to ONE row's `<dd>` (objectui#8495).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

const schema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
  },
};

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

// The drawer is a `Sheet`, so its body lands in a portal OUTSIDE `container`.
// Reading `container` here returned null for every case — a harness bug that
// looks exactly like the component rendering nothing.
afterEach(cleanup);

function mount(record: Record<string, unknown>) {
  render(
    <RecordDetailDrawer
      record={record as any}
      objectName="opportunity"
      objectSchema={schema}
      onClose={vi.fn()}
    />,
  );
  const body = document.body.querySelector('[data-testid="record-detail-body"]') as HTMLElement;
  expect(body, 'the drawer body rendered').not.toBeNull();

  /** The value cell of the row labelled `label` — never a body-wide lookup. */
  const valueCell = (label: string): HTMLElement => {
    const dt = Array.from(body.querySelectorAll('dt')).find(
      (el) => (el.textContent ?? '').trim() === label,
    );
    expect(dt, `the "${label}" row is present`).toBeTruthy();
    const dd = (dt as HTMLElement).parentElement?.querySelector('dd');
    expect(dd, `the "${label}" row has a value cell`).toBeTruthy();
    return dd as HTMLElement;
  };
  return { valueCell };
}

describe('RecordDetailDrawer empty rows use the shared EmptyValue (objectui#8504)', () => {
  it('THE DEFECT — an empty row carries an accessible name', () => {
    const { valueCell } = mount({ id: 'opp-1', name: 'Acme Renewal', stage: '' });
    const placeholder = emptyIn(valueCell('Stage'));

    expect(placeholder, 'the empty row draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    expect((placeholder as HTMLElement).textContent, 'the glyph is unchanged').toBe('—');
    // CONTROL — without this, a drawer that renders no values at all passes above.
    expect(
      within(valueCell('Name')).queryByText('Acme Renewal'),
      'CONTROL: the sibling row rendered by value',
    ).not.toBeNull();
  });

  it('NON-REGRESSION — a FILLED row renders its value and NO placeholder', () => {
    const { valueCell } = mount({ id: 'opp-1', name: 'Acme Renewal', stage: 'Won' });
    const filled = valueCell('Stage');

    expect(within(filled).queryByText('Won'), 'the value reaches the row').not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a filled row carries NO placeholder').toBeNull();
  });

  it('a field the record omits entirely is empty too', () => {
    // `renderFieldValue` returns `''` for null/undefined, so a key present in
    // the schema but absent from the record takes the same branch.
    const { valueCell } = mount({ id: 'opp-1', name: 'Acme Renewal', stage: undefined });
    expect(emptyIn(valueCell('Stage')), 'an absent value is empty').not.toBeNull();
    expect(
      emptyIn(valueCell('Name')),
      'CONTROL: the filled sibling is still not a placeholder',
    ).toBeNull();
  });
});
