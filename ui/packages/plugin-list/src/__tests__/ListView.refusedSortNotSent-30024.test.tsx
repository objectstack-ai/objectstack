/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30024 — a stored view `sort` the platform's sortability
 * projection refuses never reaches the server.
 *
 * `currentSort` is seeded from the view's `sort`, and the data fetch used to
 * map it into `$orderby` unfiltered. The projection's verdict was applied to
 * the header display and to the persist path (#6455) only, so a list whose
 * stored sort named a refused field asked the server for that sort, and the
 * Data API answers it `400 INVALID_SORT`: the list failed its first fetch
 * instead of loading.
 *
 * Two refused fields: a `formula`, which the platform's own resolver
 * (`resolveObjectSortability`, the one the REST layer serves from) refuses as
 * `virtual-type`, and a `text` field marked `sortable: false`, refused as
 * `author-declared` since objectstack#30021. The projection is built by that
 * resolver, not hand-written.
 *
 * Every negative cell sits beside a control: a sortable field's sort is sent
 * unchanged, and a deployment that serves no projection sends what it sent
 * before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    expected_revenue: { type: 'formula', label: 'Expected Revenue', expression: 'amount * 2' },
    // A stored `text` field its author marked unsortable: refused by the
    // projection as `author-declared` since objectstack#30021.
    internal_code: { type: 'text', label: 'Internal Code', sortable: false },
  },
};

/**
 * The data source answers as the Data API does: a `$orderby` naming a field
 * the projection refuses is a `400 INVALID_SORT`, so a list that sends one
 * shows its load error. Any other request answers one row.
 */
const REFUSED = new Set(['expected_revenue', 'internal_code']);

function makeDataSource(opts: { servesSignal?: boolean } = {}) {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      const orderby = Array.isArray(params?.$orderby) ? params.$orderby : [];
      if (orderby.some((item: any) => REFUSED.has(item?.field))) {
        throw Object.assign(new Error('Field is not sortable'), {
          status: 400,
          code: 'INVALID_SORT',
        });
      }
      return { data: [{ id: 'r1', name: 'Acme deal', amount: 100, expected_revenue: 200 }], total: 1 };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      const schema = JSON.parse(JSON.stringify(objectDef));
      if (opts.servesSignal !== false) {
        attachObjectSortability(schema, resolveObjectSortability(objectDef));
      }
      return schema;
    }),
  };
}

async function renderList(
  sort: Array<{ field: string; order: 'asc' | 'desc' }>,
  dsOpts: { servesSignal?: boolean } = {},
) {
  const dataSource = makeDataSource(dsOpts);
  const schema: ListViewSchema = {
    type: 'list-view',
    objectName: 'crm_opportunity',
    viewType: 'grid',
    columns: ['name', 'amount', 'expected_revenue', 'internal_code'] as any,
    sort,
  } as any;
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView schema={schema} dataSource={dataSource as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  // Let every request the mount made settle before reading the screen.
  await Promise.allSettled(dataSource.find.mock.results.map((r: any) => r.value));
  return dataSource;
}

/** Whether the list drew its load-error panel (what a `400` answer shows). */
const showsLoadError = () => screen.queryByTestId('list-error-state') !== null;

async function expectLoaded() {
  // Give a rejected request the chance to paint its error panel.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(showsLoadError()).toBe(false);
}

/** The `$orderby` of every request the list sent, each as `field order` pairs. */
function sentOrderBys(ds: ReturnType<typeof makeDataSource>) {
  return ds.find.mock.calls.map((call: any[]) => {
    const orderby = call[1]?.$orderby;
    return Array.isArray(orderby)
      ? orderby.map((item: any) => `${item.field} ${item.order}`)
      : orderby;
  });
}

describe('ListView — a refused stored sort never reaches the server (objectstack#30024)', () => {
  it('sanity: the served projection refuses the formula and offers the stored fields', () => {
    const served = resolveObjectSortability(objectDef) as { fields: Record<string, any> };
    expect(served.fields.expected_revenue?.sortable).toBe(false);
    expect(served.fields.amount).toEqual({ sortable: true });
    expect(served.fields.name).toEqual({ sortable: true });
    expect(served.fields.internal_code).toEqual({ sortable: false, reason: 'author-declared' });
  });

  it('sends no sort entry for a stored sort naming a sortable: false field, and the list loads', async () => {
    const ds = await renderList([
      { field: 'internal_code', order: 'asc' },
      { field: 'amount', order: 'desc' },
    ]);
    const sent = sentOrderBys(ds);
    expect(sent.length).toBeGreaterThan(0);
    for (const orderby of sent) {
      expect(orderby).toEqual(['amount desc']);
    }
    await expectLoaded();
  });

  it('sends no sort entry for a stored sort naming only a refused field, and the list loads', async () => {
    const ds = await renderList([{ field: 'expected_revenue', order: 'desc' }]);
    const sent = sentOrderBys(ds);
    expect(sent.length).toBeGreaterThan(0);
    for (const orderby of sent) {
      expect(orderby).toBeUndefined();
    }
    await expectLoaded();
  });

  it('CONTROL: a sortable field\'s stored sort is sent unchanged', async () => {
    const ds = await renderList([{ field: 'amount', order: 'desc' }]);
    const sent = sentOrderBys(ds);
    expect(sent.length).toBeGreaterThan(0);
    for (const orderby of sent) {
      expect(orderby).toEqual(['amount desc']);
    }
    await expectLoaded();
  });

  it('a mixed sort sends only the allowed entries, in their original order', async () => {
    const ds = await renderList([
      { field: 'name', order: 'asc' },
      { field: 'expected_revenue', order: 'desc' },
      { field: 'amount', order: 'desc' },
    ]);
    const sent = sentOrderBys(ds);
    expect(sent.length).toBeGreaterThan(0);
    for (const orderby of sent) {
      expect(orderby).toEqual(['name asc', 'amount desc']);
    }
    await expectLoaded();
  });

  /**
   * The harness's own control: with no projection there is no verdict to
   * filter by, so the refused entry is sent as before, and the server double
   * answers it `400` — the load-error panel is what the fixed cells above are
   * proven NOT to show.
   */
  it('CONTROL: with no projection served the stored sort is sent as before, and the 400 shows', async () => {
    const ds = await renderList(
      [
        { field: 'expected_revenue', order: 'desc' },
        { field: 'amount', order: 'asc' },
      ],
      { servesSignal: false },
    );
    const sent = sentOrderBys(ds);
    expect(sent.length).toBeGreaterThan(0);
    for (const orderby of sent) {
      expect(orderby).toEqual(['expected_revenue desc', 'amount asc']);
    }
    await waitFor(() => expect(showsLoadError()).toBe(true));
  });
});
