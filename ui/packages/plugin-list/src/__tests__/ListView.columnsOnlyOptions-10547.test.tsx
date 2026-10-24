/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10547 — the columns-only candidate fallback reads no select options
 * off a list column.
 *
 * Before the object definition loads, `ListView` builds its filter and sort
 * candidates from the view's declared `columns`. That branch used to read
 * `options` off each column, and `ListColumnSchema` refuses the key with
 * `unrecognized_keys` and no rename hint, so a spec-compliant producer can never
 * put it there. The ruling objectui#7531 made for the relational keys
 * (5809501335, letter "remove") is reused for this one: select options come from
 * the object definition once it loads, never from a column.
 *
 * The regression window is the pre-load one, so the pin holds `getObjectSchema`
 * pending. The lit control then lets the definition load and sees the options
 * arrive from it.
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
  options?: Array<{ value: unknown; label: string }>;
};

// What ListView hands the filter builder: the candidate list itself.
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

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const PLAIN_COLUMNS = [
  { field: 'status', label: 'Status', type: 'select' },
  { field: 'name', label: 'Name' },
];

const COLUMNS_CARRYING_OPTIONS = [{ ...PLAIN_COLUMNS[0], options: STATUS_OPTIONS }, PLAIN_COLUMNS[1]];

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
    objectName: 'crm_ticket',
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
}

const latestCandidates = () => captured.fields[captured.fields.length - 1];

/** A definition that never arrives: the columns-only branch is the only one. */
const neverLoads = () => new Promise<unknown>(() => {});

afterEach(() => {
  cleanup();
  captured.fields.length = 0;
});

describe('objectui#10547 — no select options are read off a list column', () => {
  it('the spec refuses `options` on a column (lit control: the bare column parses)', () => {
    expect(ListColumnSchema.safeParse(PLAIN_COLUMNS[0]).success).toBe(true);
    const result = ListColumnSchema.safeParse(COLUMNS_CARRYING_OPTIONS[0]);
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue && 'keys' in issue ? issue.keys : []).toEqual(['options']);
  });

  it('before the definition loads, a column carrying `options` offers the same candidates as a plain one', async () => {
    await renderAndOpenFilter(PLAIN_COLUMNS, neverLoads);
    const plain = latestCandidates();
    cleanup();

    await renderAndOpenFilter(COLUMNS_CARRYING_OPTIONS, neverLoads);
    const carrying = latestCandidates();

    // These ARE the columns-only candidates: the declared columns, in order.
    expect(carrying.map((f) => [f.value, f.label, f.type])).toEqual([
      ['status', 'Status', 'select'],
      ['name', 'Name', 'text'],
    ]);
    expect(carrying[0].options).toBeUndefined();
    expect(carrying).toStrictEqual(plain);
  });

  it('control: the select options arrive with the object definition, and the capture sees them', async () => {
    let deliver!: (def: unknown) => void;
    const definition = new Promise<unknown>((resolve) => { deliver = resolve; });
    await renderAndOpenFilter(PLAIN_COLUMNS, () => definition);

    expect(latestCandidates()[0].options).toBeUndefined();

    deliver({
      name: 'crm_ticket',
      fields: {
        status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
        name: { type: 'text', label: 'Name' },
      },
    });

    await waitFor(() =>
      expect(latestCandidates().find((f) => f.value === 'status')?.options?.map((o) => o.value)).toEqual([
        'open',
        'closed',
      ]),
    );
  });
});
