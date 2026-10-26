/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s FIRST PAINT before its object schema settles — the
 * objectui#10706 row of objectui#10657's enumeration.
 *
 * ## The defect
 *
 * On the host-fetched path (rows handed down as `data`, as `ListView` does)
 * the rows paint before the grid's own `getObjectSchema` read lands. An
 * untyped view column takes its type from that schema, so until it arrived an
 * untyped column over a `password` field drew the raw credential as text, and
 * grouping by it printed the credential as the group label. A failed read was
 * swallowed as non-fatal, which left the column drawn in the clear for the
 * life of the grid.
 *
 * ## The contract pinned here
 *
 * - HELD: an untyped column is WITHHELD — drawn as the mask, never as text,
 *   no raw value anywhere in the DOM (text or a `title`), nothing copied, and
 *   no group labelled by it.
 * - REJECTED: it stays withheld (fail closed, never back to text).
 * - SETTLED: the withholding lifts for a field declared `text`, and the
 *   declared `password` field keeps the mask.
 * - HOST CATALOGUE: handed the object's fields (`objectFields`, what `ListView`
 *   passes), the grid has no window: first paint draws each column from its
 *   declared type while its own read is still held.
 * - THE RECORD PANEL a row opens under overlay navigation, with no declared
 *   fields in hand, used to print every value of the record by inference: it
 *   withholds them too after a failed read.
 *
 * ## Controls
 *
 * Every mount carries `Name`, a column that AUTHORS `type: 'text'`: its type
 * does not wait on the schema, so it draws, tooltips and copies its value in
 * every arm. That is what makes each absence a reading and not a grid that
 * drew nothing. The group-label case groups a second mount by that column and
 * requires its label.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const MASK = '••••••';
const RAW_KEY = 'RAW-ZULU-10657';
const RAW_NOTE = 'NOTE-TANGO-10657';
const CONTROL_VALUE = 'Ada';

const ROWS = [{ id: 'r1', name: CONTROL_VALUE, api_key: RAW_KEY, note: RAW_NOTE }];

/** What the object declares: one credential, one ordinary text field. */
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
  note: { type: 'text', label: 'Note' },
};

/** `Name` authors its type (the control); `API Key` and `Note` author none. */
const COLUMNS = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'api_key', label: 'API Key' },
  { field: 'note', label: 'Note' },
];

let writeText: ReturnType<typeof vi.fn>;
const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  // Desktop: the sub-768px layout is the card list, which has no data-table.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  vi.restoreAllMocks();
  cleanup();
});

/** A data source whose schema read the test settles by hand. */
function heldDataSource() {
  let release!: (def: unknown) => void;
  let reject!: (err: unknown) => void;
  const pending = new Promise((res, rej) => { release = res; reject = rej; });
  const ds = { getObjectSchema: vi.fn(() => pending) } as any;
  return { ds, release, reject };
}

/** Rows handed down by a host, the way `ListView` hands them. */
function renderHostFed(ds: unknown, extra: { grouping?: unknown; objectFields?: unknown; navigation?: unknown } = {}) {
  const { grouping, objectFields, navigation } = extra;
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'masked_first_paint',
          columns: COLUMNS,
          ...(grouping ? { grouping } : {}),
          ...(navigation ? { navigation } : {}),
        } as any}
        dataSource={ds as any}
        data={ROWS}
        {...(objectFields ? { objectFields: objectFields as any } : {})}
      />
    </ActionProvider>,
  );
}

/** The body cell under the header whose text is `label`, in the control row. */
function cellUnder(label: string): HTMLElement {
  const row = screen.getByText(CONTROL_VALUE).closest('tr');
  expect(row, 'CONTROL: the data row rendered').not.toBeNull();
  const headers = Array.from(row!.closest('table')!.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" column header rendered`).toBeGreaterThanOrEqual(0);
  return row!.children[index] as HTMLElement;
}

const copied = () => writeText.mock.calls.map((call) => call[0]);

/** The text control draws, copies and tooltips its value: the grid is live. */
function expectControlLive() {
  const name = cellUnder('Name');
  expect(name.textContent, 'CONTROL: the authored text column draws its value').toContain(CONTROL_VALUE);
  fireEvent.keyDown(name, { key: 'c', ctrlKey: true });
  expect(copied(), 'CONTROL: the authored text column copies its value').toEqual([CONTROL_VALUE]);
  writeText.mockClear();
}

/** A column drawn as the mask: no raw text, no raw attribute, no copy. */
function expectWithheld(label: string, raw: string) {
  const cell = cellUnder(label);
  expect(cell.textContent, `${label}: drawn as the mask`).toContain(MASK);
  fireEvent.keyDown(cell, { key: 'c', ctrlKey: true });
  expect(copied(), `${label}: Ctrl+C copies nothing`).toEqual([]);
  // Text OR attribute: the `title` tooltip is where the raw value used to sit.
  expect(document.body.innerHTML, `${label}: the raw value is nowhere in the DOM`).not.toContain(raw);
}

describe('ObjectGrid — an untyped column is withheld until the object schema settles (objectui#10657)', () => {
  it('HELD: the untyped columns draw the mask, never the raw value; the typed text column draws', async () => {
    const { ds } = heldDataSource();
    renderHostFed(ds);
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    expect(ds.getObjectSchema, 'CONTROL: the grid is waiting on its own schema read').toHaveBeenCalled();

    expectControlLive();
    expectWithheld('API Key', RAW_KEY);
    expectWithheld('Note', RAW_NOTE);
  });

  it('HELD: no group is labelled by an untyped column; grouping by the typed text column still labels', async () => {
    const { ds } = heldDataSource();
    renderHostFed(ds, { grouping: { fields: [{ field: 'api_key' }] } });
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    expect(document.querySelectorAll('.group-label'), 'no group is labelled by the withheld key').toHaveLength(0);
    expect(document.body.innerHTML, 'the raw value is nowhere in the DOM').not.toContain(RAW_KEY);
    cleanup();

    // CONTROL — the same held window, grouped by the column that authors its
    // type: the grouping runs and its label is the value.
    const control = heldDataSource();
    renderHostFed(control.ds, { grouping: { fields: [{ field: 'name' }] } });
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent)).toEqual([CONTROL_VALUE]));
  });

  it('REJECTED: a failed schema read keeps the untyped columns withheld — fail closed, never back to text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ds, reject } = heldDataSource();
    renderHostFed(ds);
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    reject(new Error('metadata read refused'));
    // The grid swallows the failure with its own warning: that is the signal
    // the rejection has been handled, not merely issued.
    await waitFor(() =>
      expect(warn.mock.calls.some((c) => String(c[0]).includes('Failed to fetch objectSchema for inline data'))).toBe(true));

    expectControlLive();
    expectWithheld('API Key', RAW_KEY);
    expectWithheld('Note', RAW_NOTE);
  });

  it('REJECTED: grouping by the untyped column labels no group after the failed read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ds, reject } = heldDataSource();
    renderHostFed(ds, { grouping: { fields: [{ field: 'api_key' }] } });
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    reject(new Error('metadata read refused'));
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(document.querySelectorAll('.group-label')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(RAW_KEY);
  });

  it('SETTLED: the declared text field draws once the schema lands; the declared password keeps the mask', async () => {
    const { ds, release } = heldDataSource();
    renderHostFed(ds);
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    expect(cellUnder('Note').textContent, 'withheld while held').toContain(MASK);

    release({ name: 'masked_first_paint', fields: FIELDS });
    // CONTROL — the withholding lifts: a field the object declares `text`.
    await waitFor(() => expect(cellUnder('Note').textContent).toContain(RAW_NOTE));
    expectControlLive();
    // The declared `password` field is masked from its declaration now.
    expectWithheld('API Key', RAW_KEY);
  });

  it('HOST CATALOGUE: handed `objectFields`, first paint draws from the declared types while its own read is held', async () => {
    const { ds } = heldDataSource();
    renderHostFed(ds, { objectFields: FIELDS });
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());

    // No window: the declared `text` field draws its value at first paint…
    expect(cellUnder('Note').textContent, 'the declared text field draws at first paint').toContain(RAW_NOTE);
    expectControlLive();
    // …and the declared `password` field is the mask from the same paint.
    expectWithheld('API Key', RAW_KEY);
  });

  it('REJECTED: the record panel a row opens draws every value withheld', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ds, reject } = heldDataSource();
    renderHostFed(ds, { navigation: { mode: 'drawer' } });
    await waitFor(() => expect(screen.getByText(CONTROL_VALUE)).toBeInTheDocument());
    reject(new Error('metadata read refused'));
    await waitFor(() =>
      expect(warn.mock.calls.some((c) => String(c[0]).includes('Failed to fetch objectSchema for inline data'))).toBe(true));

    fireEvent.click(screen.getByText(CONTROL_VALUE));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    // CONTROL — the panel rendered this record's fields, not an empty shell.
    expect(within(dialog).getByText('Api key')).toBeInTheDocument();
    expect(dialog.textContent, 'the panel draws the values as the mask').toContain(MASK);
    expect(document.body.innerHTML, 'the raw credential is nowhere in the DOM').not.toContain(RAW_KEY);
    expect(document.body.innerHTML, 'the withheld note is nowhere in the DOM').not.toContain(RAW_NOTE);
  });
});
