/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35053 — a grid grouped by a lookup names each group by the
 * TARGET object's declared `nameField` when the lookup declares no
 * `displayField`, as the lookup's own cell already does; the spec's
 * `FieldSchema.displayField` states that default ("defaults to the referenced
 * object's name/title"). The target here is titled by an autonumber
 * `deal_number` and has no `name` / `label` / `title` field, so the old
 * `name ?? label ?? title` guess printed every group as its raw record id.
 *
 * Both producers are pinned: the server-grouped headers (labels read in the
 * header load) and the client grouping (an expanded record per row). Each has
 * a control that an explicit `displayField` still wins, and the groups stay
 * keyed by id, so two records with one title stay two groups. The empty group
 * reads the grid's own empty-value string in the reader's language.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'crm_cb_order';
const TARGET = 'crm_deal_confirmation';

/** The target: titled by an autonumber, with no name-ish field at all. */
const TARGET_DEF = {
  name: TARGET,
  nameField: 'deal_number',
  fields: {
    deal_number: { type: 'autonumber', label: 'Deal Number' },
    code: { type: 'text', label: 'Code' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const DEALS = [
  { id: 'T1lF9T1kq45KAN06', deal_number: 'DEAL-2026-0001', code: 'C-1', amount: 10 },
  { id: 'mhHko1m3h9-1aahG', deal_number: 'DEAL-2026-0002', code: 'C-2', amount: 20 },
];

const orderFields = (lookupExtra: Record<string, unknown> = {}) => ({
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  deal_confirmation: { type: 'lookup', label: 'Deal', reference: TARGET, ...lookupExtra },
});

const ORDER_ROWS: Array<Record<string, unknown>> = [
  { id: 'o1', subject: 'First', deal_confirmation: DEALS[0].id },
  { id: 'o2', subject: 'Second', deal_confirmation: DEALS[1].id },
  { id: 'o3', subject: 'Third', deal_confirmation: DEALS[0].id },
  { id: 'o4', subject: 'Unlinked', deal_confirmation: null },
];

function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$in' in op) return (op.$in as unknown[]).includes(row[key]);
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

const schemaOf = (lookupExtra: Record<string, unknown>) => vi.fn(async (name: string) =>
  name === TARGET ? TARGET_DEF : { name: OBJECT, fields: orderFields(lookupExtra) });

/** Serves the header query and the row pages of the order, and the deal reads. */
const makeServerSource = (lookupExtra: Record<string, unknown> = {}) => ({
  queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
    const groupBy = query.groupBy ?? [];
    const buckets = new Map<string, number>();
    for (const row of ORDER_ROWS.filter((r) => matches(r, query.where))) {
      const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([key, count]) => {
      const values = JSON.parse(key) as unknown[];
      return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
    });
  }),
  find: vi.fn(async (object: string, params: Record<string, unknown>) => {
    const source = object === TARGET ? DEALS : ORDER_ROWS;
    const matching = source.filter((r) => matches(r, params.$filter));
    const skip = (params.$skip as number | undefined) ?? 0;
    const top = (params.$top as number | undefined) ?? matching.length;
    return { data: matching.slice(skip, skip + top), total: matching.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: schemaOf(lookupExtra),
});

/** The client path: rows handed in with each deal expanded, as `$expand` serves it. */
const CLIENT_ROWS: Array<Record<string, unknown>> = [
  { id: 'o1', subject: 'First', deal_confirmation: DEALS[0] },
  { id: 'o2', subject: 'Second', deal_confirmation: DEALS[1] },
  { id: 'o3', subject: 'Third', deal_confirmation: DEALS[0] },
  { id: 'o4', subject: 'Unlinked', deal_confirmation: null },
];

const makeSchemaOnlySource = (lookupExtra: Record<string, unknown> = {}) => ({
  find: vi.fn(),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: schemaOf(lookupExtra),
});

function renderGrid(
  ds: unknown,
  extra: Record<string, unknown> = {},
  language?: string,
) {
  const grid = (
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['subject'],
          grouping: { fields: [{ field: 'deal_confirmation' }] },
          ...extra,
        } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>
  );
  return render(
    language
      ? (
        <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
          {grid}
        </I18nProvider>
      )
      : grid,
  );
}

const groupLabels = () =>
  Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent);

afterEach(() => cleanup());

describe('server-grouped headers name a lookup by its target nameField (objectstack#35053)', () => {
  it('a target titled by `deal_number` heads its groups with the deal number, not the record id', async () => {
    const ds = makeServerSource();
    renderGrid(ds);
    await vi.waitFor(() =>
      expect(groupLabels()).toEqual(['Empty', 'DEAL-2026-0001', 'DEAL-2026-0002']),
    );
    expect(ds.getObjectSchema).toHaveBeenCalledWith(TARGET);
  });

  it('CONTROL — an explicit `displayField` on the lookup still wins over the nameField', async () => {
    const ds = makeServerSource({ displayField: 'code' });
    renderGrid(ds);
    await vi.waitFor(() => expect(groupLabels()).toEqual(['Empty', 'C-1', 'C-2']));
  });

  it('zh-CN: the empty group reads the grid\'s empty-value string in Chinese, and keeps its place', async () => {
    const ds = makeServerSource();
    renderGrid(ds, {}, 'zh-CN');
    await vi.waitFor(() =>
      expect(groupLabels()).toEqual(['空', 'DEAL-2026-0001', 'DEAL-2026-0002']),
    );
  });
});

describe('client grouping names an expanded lookup by its target nameField (objectstack#35053)', () => {
  it('heads each group with the deal number, counting by id', async () => {
    const ds = makeSchemaOnlySource();
    renderGrid(ds, { data: { provider: 'value', items: CLIENT_ROWS } });
    await vi.waitFor(() =>
      expect(groupLabels()).toEqual(['Empty', 'DEAL-2026-0001', 'DEAL-2026-0002']),
    );
    expect(ds.getObjectSchema).toHaveBeenCalledWith(TARGET);
  });

  it('CONTROL — an explicit `displayField` on the lookup still wins over the nameField', async () => {
    const ds = makeSchemaOnlySource({ displayField: 'code' });
    renderGrid(ds, { data: { provider: 'value', items: CLIENT_ROWS } });
    await vi.waitFor(() => expect(groupLabels()).toEqual(['Empty', 'C-1', 'C-2']));
  });

  it('two records sharing one title stay two groups', async () => {
    const twin = { ...DEALS[1], deal_number: DEALS[0].deal_number };
    const ds = makeSchemaOnlySource();
    renderGrid(ds, {
      data: {
        provider: 'value',
        items: [
          { id: 'o1', subject: 'First', deal_confirmation: DEALS[0] },
          { id: 'o2', subject: 'Second', deal_confirmation: twin },
        ],
      },
    });
    await vi.waitFor(() => expect(groupLabels()).toEqual(['DEAL-2026-0001', 'DEAL-2026-0001']));
  });

  it('zh-CN: the empty group reads the grid\'s empty-value string in Chinese', async () => {
    const ds = makeSchemaOnlySource();
    renderGrid(ds, { data: { provider: 'value', items: CLIENT_ROWS } }, 'zh-CN');
    await vi.waitFor(() =>
      expect(groupLabels()).toEqual(['空', 'DEAL-2026-0001', 'DEAL-2026-0002']),
    );
  });
});
