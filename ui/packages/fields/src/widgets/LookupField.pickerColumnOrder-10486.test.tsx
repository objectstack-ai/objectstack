/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The browse-all picker's display column labels a record the way the lookup
 * dropdown does — objectui#10486, the picker half of objectui#10343 (itself the
 * lookup branch of objectui#9436's ruling C1: the field's own `displayField`,
 * then the object's `nameField`, then the deprecated `titleFormat`).
 *
 * objectui#10479 moved the dropdown's option label onto `@object-ui/core`'s
 * `getRecordDisplayName`. The picker's display column kept its own private
 * single-brace template renderer, fed a bare `titleFormat` string cut out of
 * the schema, so it:
 *   - ranked the template above the object's declared `nameField`;
 *   - ranked it above the lookup's own declared `displayField` too;
 *   - kept the outer braces of a double-brace template (`{Globex}`);
 *   - never read `nameField` at all when no template was declared, printing
 *     the `name` guess, or nothing when the object has no `name` field.
 *
 * Every pin here reads BOTH surfaces off one mounted LookupField and asserts
 * they agree, because the disagreement is the defect: either surface alone
 * can look reasonable. Every fixture row carries a `name` value on purpose
 * (except the no-`name` case), so an order that lets the `name` guess outrank
 * the object's declarations is red.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LookupField } from './LookupField';
import { renderLookupColumnValue } from './lookupColumnDisplay';

const CONTRACT_FIELDS: Record<string, unknown> = {
  contract_no: { type: 'text', label: 'Contract No' },
  name: { type: 'text', label: 'Name' },
  account: { type: 'text', label: 'Account' },
  short_code: { type: 'text', label: 'Short Code' },
};

const ROWS: Record<string, unknown>[] = [
  { id: 'c1', contract_no: 'HT-001', name: 'Acme', account: 'Globex', short_code: 'AC' },
  { id: 'c2', contract_no: 'HT-002', name: 'Initech', account: 'Umbrella', short_code: 'IN' },
];

function makeBackend(
  decl: Record<string, unknown>,
  rows: Record<string, unknown>[] = ROWS,
  fields: Record<string, unknown> = CONTRACT_FIELDS,
) {
  const find = vi.fn(async (objectName: string) =>
    objectName === 'contract' ? { data: rows.map((r) => ({ ...r })), total: rows.length } : { data: [], total: 0 },
  );
  const findOne = vi.fn(async (objectName: string, id: string) =>
    objectName === 'contract' ? rows.find((r) => r.id === id) ?? null : null,
  );
  const getObjectSchema = vi.fn(async (objectName: string) =>
    objectName === 'contract' ? { name: 'contract', fields, ...decl } : undefined,
  );
  return { find, findOne, getObjectSchema } as any;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

interface Reading {
  /** Each dropdown option's label (its `title` attribute). */
  dropdown: string[];
  /** The picker's display-column cells, row by row. */
  picker: string[];
}

/** Mount one LookupField, read the dropdown's labels, then the picker's display column. */
async function readBoth(ds: any, field: Record<string, unknown> = {}): Promise<Reading> {
  render(
    <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
      <LookupField
        value={undefined}
        onChange={() => {}}
        dataSource={ds}
        field={{ reference: 'contract', ...field } as never}
      />
    </SchemaRendererContext.Provider>,
  );
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('contract'));
  await settle();

  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  await settle();
  const dropdown = screen.getAllByRole('option').map((el) => el.getAttribute('title') ?? '');

  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('browse-all-records'));
  });
  await waitFor(() => expect(screen.getByTestId('record-row-c1')).toBeInTheDocument());
  await settle();
  const displayColumn = (field.displayField as string | undefined) ?? 'name';
  const picker = Array.from(document.querySelectorAll(`[data-lookup-cell="${displayColumn}"]`)).map(
    (el) => el.textContent ?? '',
  );
  return { dropdown, picker };
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('RecordPickerDialog display column: the dropdown label order, on the same resolver (objectui#10486)', () => {
  it('agreement: the object declares nameField and titleFormat, and both surfaces read the nameField value', async () => {
    const r = await readBoth(makeBackend({ nameField: 'contract_no', titleFormat: '{account} / {contract_no}' }));
    expect(r.dropdown).toEqual(['HT-001', 'HT-002']);
    expect(r.picker).toEqual(['HT-001', 'HT-002']);
    expect(r.picker.join(' ')).not.toContain('Globex');
  });

  it('a double-brace titleFormat renders without its braces, as its single-brace twin does', async () => {
    const r = await readBoth(makeBackend({ titleFormat: '{{account}} / {{contract_no}}' }));
    expect(r.picker).toEqual(['Globex / HT-001', 'Umbrella / HT-002']);
    expect(r.picker).toEqual(r.dropdown);
    expect(r.picker.join(' ')).not.toMatch(/[{}]/);
  });

  it('lit control: a titleFormat alone still renders its template on both surfaces', async () => {
    const r = await readBoth(makeBackend({ titleFormat: '{account} / {contract_no}' }));
    expect(r.picker).toEqual(['Globex / HT-001', 'Umbrella / HT-002']);
    expect(r.picker).toEqual(r.dropdown);
  });

  it("the lookup declares displayField: its column shows that field, above the object's nameField and titleFormat", async () => {
    const r = await readBoth(
      makeBackend({ nameField: 'contract_no', titleFormat: '{account} / {contract_no}' }),
      { displayField: 'short_code' },
    );
    expect(r.dropdown).toEqual(['AC', 'IN']);
    expect(r.picker).toEqual(['AC', 'IN']);
  });

  it('nameField and no titleFormat: the display column reads nameField, not the `name` guess', async () => {
    const r = await readBoth(makeBackend({ nameField: 'contract_no' }));
    expect(r.dropdown).toEqual(['HT-001', 'HT-002']);
    expect(r.picker).toEqual(['HT-001', 'HT-002']);
  });

  it('nameField and no `name` field at all: the display column is no longer blank', async () => {
    const { name: _name, ...fields } = CONTRACT_FIELDS;
    const rows = ROWS.map(({ name: _n, ...row }) => row);
    const r = await readBoth(makeBackend({ nameField: 'contract_no' }, rows, fields));
    expect(r.dropdown).toEqual(['HT-001', 'HT-002']);
    expect(r.picker).toEqual(['HT-001', 'HT-002']);
  });
});

describe('renderLookupColumnValue display-column step (objectui#10486)', () => {
  const col = { field: 'code' };
  const numberOnly = { name: 'thing', fields: { code: { type: 'number' } } };

  it("the resolver's `Record #id` floor is not a title: the column keeps its own value", () => {
    const out = renderLookupColumnValue({ id: 'r1', code: 7 }, col, {
      descriptors: {},
      objectSchema: numberOnly,
      displayField: 'code',
    });
    expect(out).toBe('7');
  });

  it('control: a record with a title renders it in the display column only', () => {
    const record = { id: 'r1', code: 7, label: 'Seven' };
    const ctx = { descriptors: {}, objectSchema: numberOnly, displayField: 'code' };
    expect(renderLookupColumnValue(record, col, ctx)).toBe('Seven');
    expect(renderLookupColumnValue(record, { field: 'id' }, ctx)).toBe('r1');
  });

  it('control: with no schema the display column renders its own value, as every non-lookup caller does', () => {
    const out = renderLookupColumnValue({ id: 'r1', code: 7, label: 'Seven' }, col, {
      descriptors: {},
      displayField: 'code',
    });
    expect(out).toBe('7');
  });
});
