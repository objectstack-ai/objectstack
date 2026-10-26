/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectDataTable` WITHHOLDS an untyped column from the draw while the bound
 * object's field types are unknown (objectui#10657 — the objectui#10706 class
 * at this producer).
 *
 * ## The defect
 *
 * A cell here draws from `fieldMeta.type`: the column's authored `type`, or
 * the object's. Bound and inline rows paint before the object definition
 * lands, and a failed read settles with none, so in that window a column that
 * authors no type drew its value as text: a `password` field in the clear, for
 * good when the read failed. PR 1 of this card stamped every column `masked`
 * in that window; the stamp withholds copy, tooltip, export, search and sort,
 * but it does not draw.
 *
 * ## The contract pinned here
 *
 * - HELD and REJECTED: an untyped column draws the mask; the raw value is
 *   nowhere in the DOM, text or attribute. Rows the widget FETCHED after a
 *   failed read are withheld the same way.
 * - SETTLED: the withholding lifts — the declared `text` field draws its value
 *   — and the declared `password` field keeps the mask.
 * - THE RECORD DRAWER (record drill-down) draws a clicked row's fields from the
 *   same unknown types, so after a failed read it withholds every value too.
 *
 * ## Controls
 *
 * Each mount carries `Name`, a column that AUTHORS `type: 'text'`: its type
 * does not wait on the definition, so it draws its value in every arm. The
 * auto-derived arm (no authored columns, so no typed control) is read against
 * its headers and its drawn masks instead.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-data-table` (and, through its imports, `data-table`).
import '../index';

const MASK = '••••••';
const RAW_KEY = 'RAW-ZULU-10657';
const RAW_NOTE = 'NOTE-TANGO-10657';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
  note: { type: 'text', label: 'Note' },
};

const ROWS = [{ id: 'v1', name: 'Ada', api_key: RAW_KEY, note: RAW_NOTE }];

/** `Name` authors its type (the control); `API Key` and `Note` author none. */
const COLUMNS = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'api_key', label: 'API Key' },
  { field: 'note', label: 'Note' },
];

type SchemaMode = 'held' | 'rejected';

function makeDataSource(mode: SchemaMode) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return {
    release: () => release(),
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      if (mode === 'held') await held;
      if (mode === 'rejected') throw new Error('metadata unavailable');
      return { name: 'vault', fields: FIELDS };
    }),
  };
}

function mount(ds: ReturnType<typeof makeDataSource>, widget: Record<string, unknown>) {
  const schema = { type: 'object-data-table', objectName: 'vault', ...widget };
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
}

const headerTexts = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

/** The body cell under the header `label`, in the first row. */
function cellUnder(label: string): HTMLElement {
  const index = headerTexts().indexOf(label);
  expect(index, `CONTROL: a "${label}" header rendered (headers: ${headerTexts().join(' | ')})`).toBeGreaterThanOrEqual(0);
  const cell = document.querySelectorAll('tbody tr')[0]?.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

/** CONTROL, then the withheld reading. */
async function expectWithheld() {
  await waitFor(() => expect(cellUnder('Name').textContent, 'CONTROL: the typed text column draws').toContain('Ada'));
  expect(cellUnder('API Key').textContent, 'the untyped password column draws the mask').toContain(MASK);
  expect(cellUnder('Note').textContent, 'the untyped text column is withheld too: its type is unknown').toContain(MASK);
  // Text OR attribute: nowhere in the DOM.
  expect(document.body.innerHTML, 'the raw credential is nowhere in the DOM').not.toContain(RAW_KEY);
  expect(document.body.innerHTML, 'the withheld note is nowhere in the DOM').not.toContain(RAW_NOTE);
}

describe('ObjectDataTable — an untyped column is withheld while the object types are unknown (objectui#10657)', () => {
  it('HELD (inline rows): the untyped columns draw the mask; the typed text column draws', async () => {
    const ds = makeDataSource('held');
    mount(ds, { data: ROWS, columns: COLUMNS });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await expectWithheld();
  });

  it('REJECTED (inline rows): a failed read keeps them withheld — fail closed, never back to text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource('rejected');
    mount(ds, { data: ROWS, columns: COLUMNS });
    await waitFor(() => expect(error).toHaveBeenCalled());
    await act(async () => {});
    await expectWithheld();
  });

  it('REJECTED (fetched rows): rows fetched after the failed read are withheld the same way', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource('rejected');
    mount(ds, { columns: COLUMNS });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(error, 'CONTROL: the definition read failed before the rows were fetched').toHaveBeenCalled();
    await expectWithheld();
  });

  it('HELD (auto-derived columns): every derived column is withheld', async () => {
    const ds = makeDataSource('held');
    mount(ds, { data: ROWS });
    // CONTROL — the derived headers rendered, and the row drew (as masks).
    await waitFor(() => expect(headerTexts()).toEqual(expect.arrayContaining(['Name', 'Api Key', 'Note'])));
    await waitFor(() => expect(cellUnder('Api Key').textContent).toContain(MASK));
    expect(cellUnder('Name').textContent).toContain(MASK);
    expect(document.body.innerHTML).not.toContain(RAW_KEY);
    expect(document.body.innerHTML).not.toContain(RAW_NOTE);
  });

  it('SETTLED: the declared text field draws once the definition lands; the declared password keeps the mask', async () => {
    const ds = makeDataSource('held');
    mount(ds, { data: ROWS, columns: COLUMNS });
    await expectWithheld();
    await act(async () => { ds.release(); });
    // CONTROL — the withholding lifts for a field the object declares `text`.
    await waitFor(() => expect(cellUnder('Note').textContent).toContain(RAW_NOTE));
    expect(cellUnder('API Key').textContent, 'the declared password is masked').toContain(MASK);
    expect(document.body.innerHTML).not.toContain(RAW_KEY);
  });

  it('REJECTED: the record drawer a row opens draws every value withheld', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource('rejected');
    mount(ds, { data: ROWS, columns: COLUMNS, drillDown: { enabled: true } });
    await waitFor(() => expect(error).toHaveBeenCalled());
    await expectWithheld();

    fireEvent.click(cellUnder('Name'));
    const body = await screen.findByTestId('record-detail-body');
    // CONTROL — the drawer rendered this record's fields, not an empty shell.
    expect(within(body).getByText('Api Key')).toBeInTheDocument();
    expect(body.textContent, 'the drawer draws the values as the mask').toContain(MASK);
    expect(document.body.innerHTML, 'the raw credential is nowhere in the DOM').not.toContain(RAW_KEY);
    expect(document.body.innerHTML, 'the withheld note is nowhere in the DOM').not.toContain(RAW_NOTE);
  });
});
