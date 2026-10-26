/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12157 — the `lookup` widget reads `allowCreate`, `lookupColumns` and
 * `lookupPageSize` ALONE. Their snake_case twins `allow_create`,
 * `lookup_columns` and `lookup_page_size` used to be read FIRST, a second
 * spelling of three keys `@objectstack/spec`'s `FieldSchema` declares in
 * camelCase and refuses in snake_case (AGENTS.md #0.1). They are retired with
 * no alias, on the ground objectui#11070 round 6 retired `display_field`: the
 * ingestion fold (`normalizeSchemaReferenceKeys`, objectui#7650 ruling A)
 * stamps a stored snake spelling onto its declared key for every object
 * `ObjectStackAdapter.getObjectSchema` serves and `MetadataProvider` stores.
 *
 * ## What each case renders
 *
 * One referenced object, one `LookupField` per def, and three readings taken
 * off the real widget, never off its props:
 *
 *   - the browse-all picker's COLUMNS (the `data-lookup-cell` names of a row),
 *   - its PAGE SIZE (the `$top` of its query, and the rows it draws),
 *   - whether the quick-select offers QUICK-CREATE on an empty result.
 *
 * Each def is read against a BARE def that declares none of the three keys,
 * which is the control in both directions: the camel def must differ from it,
 * and the unfolded snake def must not. The folded snake def must read exactly
 * as the camel def does — that is the measurement the retirement rests on.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { LookupField } from './LookupField';

const REF = 'depot';

/** Four plain columns, so the derived picker columns are all four. */
const DEPOT_FIELDS: Record<string, unknown> = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code' },
  region: { type: 'text', label: 'Region' },
  manager: { type: 'text', label: 'Manager' },
};

/** Twelve rows: more than the picker's default page of 10, and than 3. */
const DEPOTS = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { id: `d${n}`, name: `Depot ${n}`, code: `C${n}`, region: 'North', manager: `M${n}` };
});

/** The declared values, distinct from every default they could be confused with. */
const DECLARED_COLUMNS = ['name', 'code'];
const DECLARED_PAGE_SIZE = 3;

/** A backend whose referenced-object query honours `$top` / `$skip` and records them. */
function makeBackend(rows: Record<string, unknown>[] = DEPOTS) {
  const tops: number[] = [];
  const find = vi.fn(async (objectName: string, params?: { $top?: number; $skip?: number }) => {
    if (objectName !== REF) return { data: [], total: 0 };
    if (typeof params?.$top === 'number') tops.push(params.$top);
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? 50;
    return { data: rows.slice(skip, skip + top).map((r) => ({ ...r })), total: rows.length };
  });
  const findOne = vi.fn(async (_o: string, id: string) => rows.find((r) => r.id === id) ?? null);
  const getObjectSchema = vi.fn(async (objectName: string) =>
    objectName === REF ? { name: REF, fields: DEPOT_FIELDS } : undefined,
  );
  const create = vi.fn(async () => ({ id: 'new' }));
  return { find, findOne, getObjectSchema, create, tops };
}

type Backend = ReturnType<typeof makeBackend>;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function mount(ds: Backend, field: Record<string, unknown>) {
  render(
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <LookupField value={undefined} onChange={() => {}} dataSource={ds as never} field={field as never} />
    </SchemaRendererContext.Provider>,
  );
}

interface PickerReading {
  /** The column names one row of the browse-all picker draws, in order. */
  columns: string[];
  /** Rows drawn on the picker's first page. */
  rows: number;
  /** The `$top` of the picker's own query. */
  top: number | undefined;
}

/** Open the browse-all picker for one def and read what it draws. */
async function readPicker(field: Record<string, unknown>): Promise<PickerReading> {
  const ds = makeBackend();
  mount(ds, field);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(REF));
  await settle();
  const before = ds.tops.length;
  await act(async () => {
    fireEvent.click(screen.getByTestId('browse-all-records'));
  });
  await waitFor(() => expect(screen.getByTestId('record-row-d01')).toBeInTheDocument());
  await settle();
  const row = screen.getByTestId('record-row-d01');
  const columns = Array.from(row.querySelectorAll('[data-lookup-cell]')).map(
    (el) => el.getAttribute('data-lookup-cell') ?? '',
  );
  const rows = document.querySelectorAll('[data-testid^="record-row-"]').length;
  const picked = ds.tops.slice(before);
  const top = picked[picked.length - 1];
  cleanup();
  return { columns, rows, top };
}

/** Type into the quick-select over an empty result and report whether it offers to create. */
async function offersQuickCreate(field: Record<string, unknown>): Promise<boolean> {
  const ds = makeBackend([]);
  mount(ds, field);
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  const input = await screen.findByRole('combobox');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Harbour' } });
  });
  await waitFor(() => expect(screen.getByText('No options found')).toBeInTheDocument());
  await settle();
  const offered = screen.queryByText(/Create new/) !== null;
  cleanup();
  return offered;
}

/** A field def as a served object carries it, run through the ingestion fold. */
function folded(def: Record<string, unknown>): Record<string, unknown> {
  const schema = { name: 'ticket', fields: { depot: { ...def } } };
  normalizeSchemaReferenceKeys(schema);
  return schema.fields.depot;
}

const BARE = { type: 'lookup', reference: REF };

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField picker config reads the spec spellings alone (objectui#12157)', () => {
  it('CONTROL — a bare def draws the derived columns on the default page of 10', async () => {
    // Without this, "the snake def reads as bare" below could be satisfied by
    // a picker that ignores every key, and "the camel def differs" by a
    // fixture that never reaches the picker.
    const bare = await readPicker(BARE);
    expect(bare.columns).toEqual(['name', 'code', 'region', 'manager']);
    expect(bare.rows).toBe(10);
    expect(bare.top).toBe(10);
  });

  it('`lookupColumns` / `lookupPageSize` shape the picker', async () => {
    const camel = await readPicker({ ...BARE, lookupColumns: DECLARED_COLUMNS, lookupPageSize: DECLARED_PAGE_SIZE });
    expect(camel.columns).toEqual(DECLARED_COLUMNS);
    expect(camel.rows).toBe(DECLARED_PAGE_SIZE);
    expect(camel.top).toBe(DECLARED_PAGE_SIZE);
  });

  it('`lookup_columns` / `lookup_page_size` handed in UNFOLDED change nothing — the def reads as bare', async () => {
    // The break the changeset states: a def that reaches the widget without
    // the ingestion fold, spelling only the snake keys, loses both settings.
    const bare = await readPicker(BARE);
    const snake = await readPicker({ ...BARE, lookup_columns: DECLARED_COLUMNS, lookup_page_size: DECLARED_PAGE_SIZE });
    expect(snake).toEqual(bare);
  });

  it('the SAME snake def, folded at ingestion, shapes the picker exactly as the camel def does', async () => {
    const def = folded({ ...BARE, lookup_columns: DECLARED_COLUMNS, lookup_page_size: DECLARED_PAGE_SIZE });
    // The fold stamped the declared keys, by reference.
    expect(def.lookupColumns).toBe(DECLARED_COLUMNS);
    expect(def.lookupPageSize).toBe(DECLARED_PAGE_SIZE);
    const camel = await readPicker({ ...BARE, lookupColumns: DECLARED_COLUMNS, lookupPageSize: DECLARED_PAGE_SIZE });
    expect(await readPicker(def)).toEqual(camel);
  });
});

describe('LookupField quick-create reads `allowCreate` alone (objectui#12157)', () => {
  // `depot` is a user-facing reference, so quick-create is ON unless a def
  // opts out — which makes `false` the value whose loss is visible.
  it('CONTROL — a bare def on a user-facing reference offers quick-create', async () => {
    expect(await offersQuickCreate(BARE)).toBe(true);
  });

  it('`allowCreate: false` opts the reference out — the shape the flow-designer picker hands the widget', async () => {
    expect(await offersQuickCreate({ ...BARE, allowCreate: false })).toBe(false);
  });

  it('`allow_create: false` handed in UNFOLDED is not read: the default-on quick-create stands', async () => {
    expect(await offersQuickCreate({ ...BARE, allow_create: false })).toBe(true);
  });

  it('the SAME snake def, folded at ingestion, opts out', async () => {
    const def = folded({ ...BARE, allow_create: false });
    expect(def.allowCreate).toBe(false);
    expect(await offersQuickCreate(def)).toBe(false);
  });
});
