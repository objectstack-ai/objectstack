/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7531 — the columns-only candidate fallback reads no relational key
 * off a list column.
 *
 * Before the object definition loads, `ListView` builds its filter and sort
 * candidates from the view's declared `columns`. That branch used to read
 * `reference_to` / `reference`, `display_field` / `reference_field` and
 * `id_field` off each column, and `ListColumnSchema` declares none of them in
 * either casing, so a spec-compliant producer can never put one there. The
 * ruling (5809501335, letter "remove") took the reads out: a relational target
 * comes from the object definition once it loads, never from a column.
 *
 * The regression window is the pre-load one, so every render here holds
 * `getObjectSchema` pending on purpose. A test that let the definition load
 * would read the other branch and pass whatever this one does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListColumnSchema } from '@objectstack/spec/ui';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

/** One filter candidate as ListView builds it. */
type Candidate = {
  value: string;
  label: string;
  type: string;
  options?: unknown;
  referenceTo?: string;
  displayField?: string;
  idField?: string;
};

// What ListView hands the filter builder: the candidate list itself, rather
// than whichever value picker the builder happens to draw from it.
const captured = vi.hoisted(() => ({ fields: [] as Candidate[][] }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...actual,
    FilterBuilder: (props: { fields: Candidate[] }) => {
      captured.fields.push(props.fields);
      return null;
    },
  };
});

import { ListView } from '../ListView';

/** The five spellings the fallback used to read, none declared on a column. */
const UNDECLARED_RELATIONAL_KEYS = {
  reference_to: 'account',
  reference: 'account',
  display_field: 'name',
  reference_field: 'name',
  id_field: 'id',
} as const;

const PLAIN_COLUMNS = [
  { field: 'account_id', label: 'Account', type: 'lookup' },
  { field: 'name', label: 'Name' },
];

const COLUMNS_CARRYING_KEYS = [
  { ...PLAIN_COLUMNS[0], ...UNDECLARED_RELATIONAL_KEYS },
  PLAIN_COLUMNS[1],
];

function makeDataSource(getObjectSchema: () => Promise<unknown>) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(getObjectSchema),
  };
}

async function renderAndOpenFilter(columns: unknown[], getObjectSchema: () => Promise<unknown>) {
  captured.fields.length = 0;
  const dataSource = makeDataSource(getObjectSchema);
  const schema = {
    type: 'list-view',
    objectName: 'crm_contact',
    viewType: 'grid',
    columns,
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
  await screen.findByText('Filter Records');
  await waitFor(() => expect(captured.fields.length).toBeGreaterThan(0));
  return dataSource;
}

const latestCandidates = () => captured.fields[captured.fields.length - 1];

/** A definition that never arrives: the columns-only branch is the only one. */
const neverLoads = () => new Promise<unknown>(() => {});

afterEach(() => {
  cleanup();
  captured.fields.length = 0;
});

describe('objectui#7531 — no relational key is read off a list column', () => {
  it('the spec refuses every one of the five spellings on a column (lit control: the bare column parses)', () => {
    expect(ListColumnSchema.safeParse(PLAIN_COLUMNS[0]).success).toBe(true);
    for (const [key, value] of Object.entries(UNDECLARED_RELATIONAL_KEYS)) {
      const result = ListColumnSchema.safeParse({ ...PLAIN_COLUMNS[0], [key]: value });
      expect(result.success, key).toBe(false);
      expect(result.error?.issues.map((i) => i.code), key).toContain('unrecognized_keys');
    }
  });

  it('control: before the definition loads, a plain column yields the columns-only candidate', async () => {
    await renderAndOpenFilter(PLAIN_COLUMNS, neverLoads);
    const plain = latestCandidates();

    // These ARE the columns-only candidates: the declared columns, in order,
    // labelled by the column, with no definition behind them.
    expect(plain.map((f) => [f.value, f.label, f.type])).toEqual([
      ['account_id', 'Account', 'lookup'],
      ['name', 'Name', 'text'],
    ]);
    expect(plain[0].referenceTo).toBeUndefined();
  });

  it('before the definition loads, a column carrying the five keys offers the same candidates as a plain one', async () => {
    await renderAndOpenFilter(PLAIN_COLUMNS, neverLoads);
    const plain = latestCandidates();
    cleanup();

    await renderAndOpenFilter(COLUMNS_CARRYING_KEYS, neverLoads);
    const carrying = latestCandidates();

    expect(carrying).toStrictEqual(plain);
    for (const key of ['referenceTo', 'displayField', 'idField'] as const) {
      expect(carrying[0][key], key).toBeUndefined();
    }
  });

  it('control: the relational target arrives with the object definition, and the capture sees it', async () => {
    let deliver!: (def: unknown) => void;
    const definition = new Promise<unknown>((resolve) => { deliver = resolve; });
    await renderAndOpenFilter(PLAIN_COLUMNS, () => definition);

    expect(latestCandidates()[0].referenceTo).toBeUndefined();

    deliver({
      name: 'crm_contact',
      fields: {
        account_id: { type: 'lookup', label: 'Account', reference: 'crm_account' },
        name: { type: 'text', label: 'Name' },
      },
    });

    await waitFor(() => expect(latestCandidates()[0].referenceTo).toBe('crm_account'));
  });
});
