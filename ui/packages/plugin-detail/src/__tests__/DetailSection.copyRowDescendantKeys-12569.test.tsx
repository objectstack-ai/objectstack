/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12569 — a copy-on-activate details row leaves a key aimed at an
 * interactive descendant to that descendant.
 *
 * ## The defect
 *
 * A read-only details row that offers copy is a `role="button"` with its own
 * tab stop, and its `onKeyDown` copied the row's raw value on Enter / Space
 * after calling `preventDefault`. A key event reaches that handler from inside
 * the row too, by bubbling, so Enter on a link drawn in the value cell (a
 * lookup's link to the referenced record) was cancelled and the row's value
 * landed on the clipboard instead: the link did not open. A mouse click never
 * had the problem, because the link's own click handler stops propagation
 * before the row's click handler runs (measured below).
 *
 * ## The rule pinned here
 *
 * The row acts on a key only when the key is aimed at the row itself. A key
 * aimed at a focusable descendant is the descendant's: not prevented, nothing
 * copied. Both row shapes carry the rule, the default row and the mobile
 * grouped-inset row, so every case runs in both.
 *
 * ## Reading the pins
 *
 * - `fireEvent.keyDown` returns `false` exactly when a handler called
 *   `preventDefault`, so its return value is the "was the descendant's
 *   activation cancelled" reading.
 * - "The link opens" is read through `user-event`, which follows a real
 *   browser here: Enter on a focused `a[href]` dispatches a click only when the
 *   keydown was not prevented. The click reaches the link's own handler, which
 *   hands the target to the host's `openRecord`.
 * - Every "nothing was copied" reading is ABSENCE-shaped, so each such case
 *   ends with Enter on the row itself in the same mounted tree and requires a
 *   copy: the spy is reachable and the row does carry the copy handler.
 *
 * ## Unchanged, and pinned as such
 *
 * Enter and Space on the row itself still copy (and still consume the key);
 * Escape is neither prevented nor copies; a mouse click on the inner link
 * opens the record and copies nothing; the default row's hover copy button
 * still copies exactly once from the keyboard; a row with no copy handler (an
 * inline-editable row) lets its link open, as before.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { RelatedRecordActionsProvider } from '@object-ui/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

const LINK_TEXT = 'ACC-000002 - Globex Industries';
/** The expanded lookup value the row holds; the copy writes it as JSON. */
const ACCOUNT_VALUE = { id: 'acc-2', name: LINK_TEXT };
const ACCOUNT_COPY = JSON.stringify(ACCOUNT_VALUE);

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;
const setWidth = (value: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, value });

const objectSchema = {
  fields: {
    // Read-only, so the row offers copy rather than in-place edit.
    account_id: { type: 'lookup', reference: 'account', readonly: true },
    // Editable: with `onEnterInlineEdit` supplied, the default row carries no
    // copy handler at all (the CONTROL for "a row without a copy handler").
    owner_id: { type: 'lookup', reference: 'sys_user' },
    name: { type: 'text' },
  },
};

const section = {
  title: 'Details',
  fields: [
    { name: 'account_id', label: 'Account' },
    { name: 'owner_id', label: 'Owner' },
    { name: 'name', label: 'Name' },
  ],
} as DetailViewSection;

const DATA = {
  account_id: ACCOUNT_VALUE,
  owner_id: { id: 'usr-7', name: 'Ada Lovelace' },
  name: 'Plain String Value',
};

let writeText: ReturnType<typeof vi.fn>;
let openRecord: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openRecord = vi.fn();
});

afterEach(() => {
  cleanup();
  setWidth(DESKTOP_WIDTH);
});

/**
 * Mount the section under a host that routes records. `userEvent.setup()`
 * installs its own clipboard stub, so the spy is installed AFTER it.
 */
function mount(options: { inlineEdit?: boolean } = {}) {
  const user = userEvent.setup();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const host = {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord,
  } as never;
  render(
    <RelatedRecordActionsProvider value={host}>
      <DetailSection
        section={section}
        data={DATA}
        objectSchema={objectSchema}
        onEnterInlineEdit={options.inlineEdit ? () => {} : undefined}
      />
    </RelatedRecordActionsProvider>,
  );
  return user;
}

/** The row's outer container (label element + value element), by its label. */
function rowContainer(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement as HTMLElement;
}

type Layout = {
  layout: string;
  width: number;
  /** The element carrying the row's click and key handlers. */
  row: (label: string) => HTMLElement;
};

const LAYOUTS: Layout[] = [
  {
    layout: 'default row',
    width: DESKTOP_WIDTH,
    row: (label) => rowContainer(label).lastElementChild as HTMLElement,
  },
  {
    layout: 'mobile grouped-inset row',
    width: MOBILE_WIDTH,
    row: (label) => rowContainer(label),
  },
];

/** The copy row holding the lookup link, proved to be one, and its link. */
function copyRowWithLink(layout: Layout) {
  const row = layout.row('Account');
  expect(row.getAttribute('role'), 'CONTROL: the Account row is a copy row').toBe('button');
  expect(row.getAttribute('tabindex'), 'CONTROL: the copy row has its own tab stop').toBe('0');
  const link = within(row).getByRole('link', { name: LINK_TEXT });
  expect(link.getAttribute('href')).toBe('/apps/demo/account/record/acc-2');
  return { row, link };
}

/** What reached the clipboard, counted at the spy. */
const payloads = () => writeText.mock.calls.map((call) => call[0]);

/** The positive control closing every absence-shaped case. */
function expectRowItselfStillCopies(row: HTMLElement) {
  writeText.mockClear();
  fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
  expect(payloads(), 'CONTROL: Enter on the row itself copies its value').toEqual([ACCOUNT_COPY]);
}

describe.each(LAYOUTS)('a copy-on-activate $layout (objectui#12569)', (layout) => {
  beforeEach(() => setWidth(layout.width));

  it('Enter on a link inside the row is not prevented and copies nothing', () => {
    mount();
    const { row, link } = copyRowWithLink(layout);

    const notPrevented = fireEvent.keyDown(link, { key: 'Enter', code: 'Enter' });
    expect(notPrevented, "the link's own activation is not cancelled").toBe(true);
    expect(payloads(), 'nothing reaches the clipboard').toEqual([]);

    expectRowItselfStillCopies(row);
  });

  it('Enter on a focused link inside the row opens the referenced record', async () => {
    const user = mount();
    const { row, link } = copyRowWithLink(layout);

    link.focus();
    expect(document.activeElement).toBe(link);
    await user.keyboard('{Enter}');

    expect(openRecord).toHaveBeenCalledTimes(1);
    expect(openRecord).toHaveBeenCalledWith('account', 'acc-2');
    expect(payloads(), 'nothing reaches the clipboard').toEqual([]);

    expectRowItselfStillCopies(row);
  });

  it('Space on a link inside the row is not prevented and copies nothing', () => {
    mount();
    const { row, link } = copyRowWithLink(layout);

    const notPrevented = fireEvent.keyDown(link, { key: ' ', code: 'Space' });
    expect(notPrevented, 'the key is left to the link and the page').toBe(true);
    expect(payloads(), 'nothing reaches the clipboard').toEqual([]);

    expectRowItselfStillCopies(row);
  });

  it('UNCHANGED: Enter on the row itself copies the value and consumes the key', () => {
    mount();
    const { row } = copyRowWithLink(layout);

    const notPrevented = fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
    expect(notPrevented, "the row's own Enter is consumed").toBe(false);
    expect(payloads()).toEqual([ACCOUNT_COPY]);
  });

  it('UNCHANGED: Space on the row itself copies the value and consumes the key', () => {
    mount();
    const { row } = copyRowWithLink(layout);

    const notPrevented = fireEvent.keyDown(row, { key: ' ', code: 'Space' });
    expect(notPrevented, "the row's own Space is consumed").toBe(false);
    expect(payloads()).toEqual([ACCOUNT_COPY]);
  });

  it('CONTROL: Escape, on the row or on its link, is neither prevented nor copies', () => {
    mount();
    const { row, link } = copyRowWithLink(layout);

    expect(fireEvent.keyDown(row, { key: 'Escape', code: 'Escape' })).toBe(true);
    expect(fireEvent.keyDown(link, { key: 'Escape', code: 'Escape' })).toBe(true);
    expect(payloads()).toEqual([]);

    expectRowItselfStillCopies(row);
  });

  it('UNCHANGED (measured): a mouse click on the inner link opens the record and copies nothing', () => {
    mount();
    const { row, link } = copyRowWithLink(layout);

    // The link's own click handler stops propagation before the row's click
    // handler can run, and hands the target to the host instead.
    fireEvent.click(link, { button: 0 });
    expect(openRecord).toHaveBeenCalledWith('account', 'acc-2');
    expect(payloads(), 'the click does not also copy').toEqual([]);

    // CONTROL: a click on the row itself copies, in this same tree.
    fireEvent.click(row);
    expect(payloads()).toEqual([ACCOUNT_COPY]);
  });
});

describe('the default row: the parts that only it draws (objectui#12569)', () => {
  beforeEach(() => setWidth(DESKTOP_WIDTH));

  it("UNCHANGED: Enter on the row's own hover copy button copies exactly once", async () => {
    const user = mount();
    const row = LAYOUTS[0].row('Account');
    const copyButton = within(row).getByRole('button');

    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);
    await user.keyboard('{Enter}');

    expect(payloads(), 'one copy, through the button').toEqual([ACCOUNT_COPY]);
  });

  it('CONTROL: a row with no copy handler (inline-editable) lets its link open, as before', async () => {
    const user = mount({ inlineEdit: true });
    const row = LAYOUTS[0].row('Owner');
    expect(row.getAttribute('role'), 'CONTROL: the inline-editable row is not a copy row').toBeNull();
    const link = within(row).getByRole('link', { name: 'Ada Lovelace' });

    expect(fireEvent.keyDown(link, { key: 'Enter', code: 'Enter' })).toBe(true);
    link.focus();
    await user.keyboard('{Enter}');

    expect(openRecord).toHaveBeenCalledWith('sys_user', 'usr-7');
    expect(payloads()).toEqual([]);
  });
});
