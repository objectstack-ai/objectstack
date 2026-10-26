/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` reads its PARENT record from `parentDataSource`
 * (objectui#12294's related-list leg, ruling B on objectui#12296).
 *
 * The block read its parent from the record page's `RecordContextProvider`
 * only, so on an `app` page — no record page around it — it had no parent, and
 * the list it drew was empty whatever existed. The spec row's
 * `parentDataSource` binds the parent by a query of its own, read by the
 * single-record rule: the FIRST row of the bound set by its `sort` is the
 * parent, and no row is a LOUD ABSENCE in the block's place, never an empty
 * list. The node-level `dataSource` keeps its meaning, the CHILD rows.
 *
 * Every case mounts the block the way a page does — through the REAL
 * registration and `SchemaRenderer`, with `parentDataSource` authored in the
 * `properties` bag (the spec's props door, hoisted onto the node) — and the
 * REAL `RelatedList`, so "the child rows filter against that parent" is read
 * off the child query the list sends and the rows it draws, not off a prop.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { RecordContextProvider, SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
import type { DataSource, DeclaredNode } from '@object-ui/types';
import { I18nProvider } from '@object-ui/i18n';
import '../../index';

/** `RelatedList` never reads over the network with an adapter; answered anyway, as the sibling suites do. */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

const PARENT_OBJECT = 'sys_environment';
const CHILD_OBJECT = 'sys_member';

const SCHEMAS: Record<string, unknown> = {
  [PARENT_OBJECT]: {
    name: PARENT_OBJECT,
    label: 'Environment',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      code: { name: 'code', type: 'text', label: 'Code' },
      rank: { name: 'rank', type: 'number', label: 'Rank' },
      environment_type: { name: 'environment_type', type: 'text', label: 'Type' },
    },
  },
  [CHILD_OBJECT]: {
    name: CHILD_OBJECT,
    label: 'Member',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      environment_id: { name: 'environment_id', type: 'text', label: 'Environment' },
      environment_code: { name: 'environment_code', type: 'text', label: 'Environment code' },
    },
  },
};

type Row = Record<string, unknown>;

/**
 * An adapter over a mutable store. The PARENT read applies `$orderby` and
 * `$top`, so "the first row by sort" is a fact about the request; the CHILD read
 * applies the equality scope `RelatedList` sends, so a row drawn is a row the
 * scope selected.
 */
function makeAdapter(store: { parents: Row[]; children: Row[] }, opts: { rejectParent?: unknown } = {}) {
  const find = vi.fn(async (object: string, params?: Record<string, unknown>) => {
    if (object === PARENT_OBJECT) {
      if (opts.rejectParent) throw opts.rejectParent;
      let out = store.parents.map((r) => ({ ...r }));
      const orderby = params?.$orderby as Array<{ field: string; order?: string }> | undefined;
      if (Array.isArray(orderby) && orderby.length > 0) {
        const { field, order } = orderby[0];
        out.sort((a, b) => (Number(a[field]) - Number(b[field])) * (order === 'desc' ? -1 : 1));
      }
      if (typeof params?.$top === 'number') out = out.slice(0, params.$top);
      return { data: out, total: out.length };
    }
    if (object === CHILD_OBJECT) {
      const scope = (params?.$filter ?? {}) as Record<string, unknown>;
      const rows = store.children.filter((row) => Object.entries(scope).every(([k, v]) => row[k] === v));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }
    return { data: [], total: 0 };
  });
  return {
    find,
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
    getObjectSchema: vi.fn(async (name: string) => SCHEMAS[name]),
    onMutation: () => () => {},
  };
}
type Adapter = ReturnType<typeof makeAdapter>;

const readsOf = (adapter: Adapter, object: string) =>
  adapter.find.mock.calls.filter(([o]) => o === object).map(([, params]) => params as Record<string, unknown>);

const PRODUCTION = [{ field: 'environment_type', operator: 'equals', value: 'production' }];
const BY_RANK = [{ field: 'rank', order: 'asc' }];

const PARENTS: Row[] = [
  { id: 'env-2', name: 'Second env', code: 'SECOND', rank: 2, environment_type: 'production' },
  { id: 'env-1', name: 'First env', code: 'FIRST', rank: 1, environment_type: 'production' },
];
const CHILDREN: Row[] = [
  { id: 'm-1', name: 'Alice', environment_id: 'env-1', environment_code: 'FIRST' },
  { id: 'm-2', name: 'Bob', environment_id: 'env-2', environment_code: 'SECOND' },
  { id: 'm-3', name: 'Carol', environment_id: 'env-page', environment_code: 'PAGE' },
];

/** A related list of members by `environment_id`, its parent bound when `parentDataSource` is given. */
const node = (parentDataSource?: unknown, extra: Row = {}) => ({
  type: 'record:related_list',
  properties: {
    objectName: CHILD_OBJECT,
    relationshipField: 'environment_id',
    columns: ['name'],
    ...(parentDataSource === undefined ? {} : { parentDataSource }),
    ...extra,
  },
});

/** An `app` page: the adapter, and no record context anywhere. */
function mountOnAppPage(schema: Row, adapter: Adapter) {
  return render(
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      <SchemaRenderer schema={schema as unknown as DeclaredNode} />
    </SchemaRendererProvider>,
  );
}

/** A record page: the page's own record in the record context, as `RecordDetailView` provides it. */
function mountOnRecordPage(schema: Row, adapter: Adapter) {
  return render(
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      <RecordContextProvider
        objectName={PARENT_OBJECT}
        recordId="env-page"
        data={{ id: 'env-page', name: 'Page env', code: 'PAGE' }}
        dataSource={adapter as unknown as DataSource}
      >
        <SchemaRenderer schema={schema as unknown as DeclaredNode} />
      </RecordContextProvider>
    </SchemaRendererProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('record:related_list — the parent bound by `parentDataSource` on an app page (objectui#12294)', () => {
  it('reads the FIRST row by the binding\'s `sort` as the parent, and its child rows are scoped to it', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN });
    mountOnAppPage(node({ object: PARENT_OBJECT, filter: PRODUCTION, sort: BY_RANK }), adapter);

    // The bound parent's child is drawn; the other parent's is not.
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();

    // The parent was read as ONE row, under the binding's filter and sort —
    // whatever `limit` the binding carries (none here).
    const parentReads = readsOf(adapter, PARENT_OBJECT);
    expect(parentReads.length).toBeGreaterThan(0);
    expect(parentReads[0]).toMatchObject({ $top: 1, $orderby: BY_RANK });
    expect(JSON.stringify(parentReads[0].$filter)).toContain('production');

    // Every child read is scoped to that parent's id, and to nothing else.
    const childReads = readsOf(adapter, CHILD_OBJECT);
    expect(childReads.length).toBeGreaterThan(0);
    for (const params of childReads) expect(params.$filter).toEqual({ environment_id: 'env-1' });
  });

  it('reads `relationshipValueField` on the bound row', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN });
    mountOnAppPage(
      node(
        { object: PARENT_OBJECT, sort: BY_RANK, limit: 1 },
        { relationshipField: 'environment_code', relationshipValueField: 'code' },
      ),
      adapter,
    );

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    for (const params of readsOf(adapter, CHILD_OBJECT)) expect(params.$filter).toEqual({ environment_code: 'FIRST' });
  });

  it('no row → the loud absence in the block\'s place, never an empty list, and no child query', async () => {
    const adapter = makeAdapter({ parents: [], children: CHILDREN });
    mountOnAppPage(node({ object: PARENT_OBJECT, filter: PRODUCTION, limit: 1 }), adapter);

    const absent = await screen.findByTestId('record-related-list-parent-absent');
    expect(absent).toHaveAttribute('role', 'status');
    expect(absent).toHaveTextContent(PARENT_OBJECT);
    expect(readsOf(adapter, PARENT_OBJECT).length).toBeGreaterThan(0);
    // Nothing of the list: no child read, and no rows of any parent.
    expect(readsOf(adapter, CHILD_OBJECT)).toEqual([]);
    for (const name of ['Alice', 'Bob', 'Carol']) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });

  it('a read the server refuses (403) → the same loud absence as no row', async () => {
    const refused = Object.assign(new Error('Forbidden'), { status: 403 });
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN }, { rejectParent: refused });
    mountOnAppPage(node({ object: PARENT_OBJECT, limit: 1 }), adapter);

    expect(await screen.findByTestId('record-related-list-parent-absent')).toBeInTheDocument();
    expect(readsOf(adapter, CHILD_OBJECT)).toEqual([]);
  });

  it('a read that fails any other way → the family\'s data-source error panel in the block\'s place', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN }, { rejectParent: new Error('upstream exploded') });
    mountOnAppPage(node({ object: PARENT_OBJECT, limit: 1 }), adapter);

    const panel = await screen.findByTestId('record-related-list-parent-datasource-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel).toHaveTextContent('upstream exploded');
    expect(screen.queryByTestId('record-related-list-parent-absent')).not.toBeInTheDocument();
    expect(readsOf(adapter, CHILD_OBJECT)).toEqual([]);
  });

  it('a named view that does not resolve draws the family\'s configuration panel, and reads no row', async () => {
    const adapter = { ...makeAdapter({ parents: PARENTS, children: CHILDREN }), listViews: vi.fn(async () => []) };
    mountOnAppPage(node({ object: PARENT_OBJECT, view: 'no_such_view' }), adapter);

    expect(await screen.findByTestId('record-related-list-parent-datasource-error')).toBeInTheDocument();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('re-reads the parent when a write to its object is announced, and the list follows the new first row', async () => {
    const store = { parents: PARENTS.map((r) => ({ ...r })), children: CHILDREN };
    const adapter = makeAdapter(store);
    mountOnAppPage(node({ object: PARENT_OBJECT, sort: BY_RANK, limit: 1 }), adapter);
    expect(await screen.findByText('Alice')).toBeInTheDocument();

    // `env-2` now ranks first.
    store.parents.find((r) => r.id === 'env-2')!.rank = 0;
    act(() => notifyDataChanged({ objectName: PARENT_OBJECT, recordId: 'env-2' }));

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
  });
});

describe('record:related_list on a record page (objectui#12294)', () => {
  it('without `parentDataSource`, the page record is the parent, as before, and nothing is read for a parent', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN });
    mountOnRecordPage(node(), adapter);

    expect(await screen.findByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    for (const params of readsOf(adapter, CHILD_OBJECT)) expect(params.$filter).toEqual({ environment_id: 'env-page' });
    // The parent binding's machinery stayed out of the way entirely.
    expect(readsOf(adapter, PARENT_OBJECT)).toEqual([]);
    expect(document.querySelector('[data-testid^="record-related-list-parent"]')).toBeNull();
  });

  it('with `parentDataSource`, the binding wins over the page record', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN });
    mountOnRecordPage(node({ object: PARENT_OBJECT, sort: BY_RANK, limit: 1 }), adapter);

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    for (const params of readsOf(adapter, CHILD_OBJECT)) expect(params.$filter).toEqual({ environment_id: 'env-1' });
  });
});

describe('record:related_list declares both bindings it reads (objectui#12294)', () => {
  it('publishes `parentDataSource` on its registration, beside the seam-injected `dataSource`', () => {
    const inputs = ComponentRegistry.getConfig('record:related_list')?.inputs ?? [];
    const parent = inputs.find((i) => i.name === 'parentDataSource');
    expect(parent?.type).toBe('object');
    expect(parent?.description ?? '').not.toMatch(/PLANNED/);
    expect(inputs.map((i) => i.name)).toContain('dataSource');
  });
});

describe('record:related_list — the parent-read panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN a failed parent read is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter({ parents: PARENTS, children: CHILDREN }, { rejectParent: new Error('upstream exploded') });
    render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
          <SchemaRenderer schema={node({ object: PARENT_OBJECT, limit: 1 }) as unknown as DeclaredNode} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    const panel = await screen.findByTestId('record-related-list-parent-datasource-error');
    expect(panel.querySelector('p.font-medium')?.textContent).toBe('无法读取此相关列表的父记录');
    // The thrown message is still shown beneath it, as thrown.
    expect(panel).toHaveTextContent('upstream exploded');
  });
});
