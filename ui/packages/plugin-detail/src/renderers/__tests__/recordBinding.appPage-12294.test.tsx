/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record blocks on an `app` page, bound by `dataSource` (objectui#12294).
 *
 * `record:details`, `record:highlights` and `record:quick_actions` used to read
 * their record from the record page's `RecordContextProvider` only, so on an
 * `app` page they drew an empty box or "no actions configured" whatever the
 * node's `dataSource` binding returned. Each block is mounted here the way an
 * `app` page mounts it: through the REAL registration and `SchemaRenderer`,
 * under a `SchemaRendererProvider` adapter, with NO record context anywhere.
 *
 * The card's semantics, per block:
 *   - one row  → that record;
 *   - zero rows → the block's empty state, and a read the server REFUSES is the
 *     same empty state (a record you may not read looks absent);
 *   - two rows → the FIRST by the binding's `sort`, read as ONE row (`$top: 1`).
 *
 * What a block "shows" is observed per block: the bound row's field value for
 * the two display blocks, and for the action bar the record id a declared
 * action runs against — the bar's whole job.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, MetadataCtx, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';
import '../../index';

/**
 * `record:details` probes the record's edit verdict over `/api/v1/security/explain`
 * (`useRecordEditable`), exactly as on the record page. Answered here with a
 * 501 — the probe's fail-open reply — so no read leaves the process. Installed
 * once at module scope and never torn down, the shape the network-escape guard
 * prescribes for a tree that can read after a test body returns.
 */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

const OBJECT = 'sys_environment';

const OBJECT_SCHEMA = {
  name: OBJECT,
  label: 'Environment',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    region: { name: 'region', type: 'text', label: 'Region' },
    rank: { name: 'rank', type: 'number', label: 'Rank' },
    environment_type: {
      name: 'environment_type',
      type: 'select',
      label: 'Type',
      options: [
        { value: 'production', label: 'Production' },
        { value: 'sandbox', label: 'Sandbox' },
      ],
    },
  },
};

const APPROVE = { name: 'approve', label: 'Approve environment', type: 'api', locations: ['record_header'] };
const OBJECT_META = { name: OBJECT, label: 'Environment', actions: [APPROVE] };

type Row = Record<string, unknown>;

/**
 * An adapter whose `find` applies the two query keys a one-record read relies
 * on — `$orderby` and `$top` — so "the first row by sort" is a fact about the
 * request, not about the order the fixture happens to be written in.
 */
function makeAdapter(rows: Row[], opts: { reject?: unknown } = {}) {
  const find = vi.fn(async (_object: string, params?: Record<string, any>) => {
    if (opts.reject) throw opts.reject;
    let out = rows.map((r) => ({ ...r }));
    const orderby = params?.$orderby as Array<{ field: string; order?: string }> | undefined;
    if (Array.isArray(orderby) && orderby.length > 0) {
      const { field, order } = orderby[0];
      out.sort((a, b) => (Number(a[field]) - Number(b[field])) * (order === 'desc' ? -1 : 1));
    }
    if (typeof params?.$top === 'number') out = out.slice(0, params.$top);
    return { data: out, total: out.length };
  });
  return {
    find,
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    onMutation: () => () => {},
  };
}

const getItem = vi.fn(async (type: string, name: string) => (type === 'object' && name === OBJECT ? OBJECT_META : null));
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META] as any,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const PRODUCTION = [{ field: 'environment_type', operator: 'equals', value: 'production' }];

/** An `app` page: the adapter and the action runtime, and no record context at all. */
function mountOnAppPage(node: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>, api = vi.fn()) {
  const utils = render(
    <MetadataCtx.Provider value={METADATA}>
      <SchemaRendererProvider dataSource={adapter as any}>
        <ActionProvider handlers={{ api: async (_action, ctx) => { api(ctx); return { success: true }; } }}>
          <SchemaRenderer schema={node as any} />
        </ActionProvider>
      </SchemaRendererProvider>
    </MetadataCtx.Provider>,
  );
  return { ...utils, api };
}

interface BlockCase {
  type: 'record:details' | 'record:highlights' | 'record:quick_actions';
  properties: Record<string, unknown>;
  /** Resolves when the block shows the record named `name` with id `id`. */
  shows: (m: ReturnType<typeof mountOnAppPage>, name: string, id: string) => Promise<void>;
  /** Asserts the block shows no record at all (after its read settled). */
  showsNone: (m: ReturnType<typeof mountOnAppPage>) => Promise<void>;
}

const testIdOf = (type: string) => type.replace(/[:_]/g, '-');

/** Wait until the scope's own read settled — its loading state is gone. */
async function settled(type: string) {
  await waitFor(() => expect(screen.queryByTestId(`${testIdOf(type)}-loading-record`)).not.toBeInTheDocument());
}

const BLOCKS: BlockCase[] = [
  {
    type: 'record:highlights',
    properties: { fields: ['name', 'rank'] },
    shows: async (_m, name) => {
      expect(await screen.findByText(name)).toBeInTheDocument();
    },
    showsNone: async () => {
      await settled('record:highlights');
      expect(screen.queryByText('Rank')).not.toBeInTheDocument();
    },
  },
  {
    type: 'record:details',
    // `region`, not `name`: the body leaves the title field to the page header.
    properties: { fields: ['region', 'environment_type'] },
    shows: async (_m, name) => {
      expect(await screen.findByText(`${name} region`)).toBeInTheDocument();
      // The OPTION LABEL, which needs the object definition the scope provides
      // beside the row: the raw value would be `production`.
      expect(await screen.findByText('Production')).toBeInTheDocument();
    },
    showsNone: async () => {
      await settled('record:details');
      // DetailView's own no-record state — the one it draws when a record read
      // answers nothing — and no field of any record.
      expect(await screen.findByText(/not found/i)).toBeInTheDocument();
      expect(screen.queryByText('Production')).not.toBeInTheDocument();
    },
  },
  {
    type: 'record:quick_actions',
    properties: { actionNames: ['approve'] },
    shows: async (m, _name, id) => {
      fireEvent.click(await screen.findByRole('button', { name: /Approve environment/i }));
      // The object's declared action runs against the BOUND row's id.
      await waitFor(() => expect(m.api).toHaveBeenCalledTimes(1));
      expect(m.api.mock.calls[0][0]).toMatchObject({ recordId: id, objectName: OBJECT });
    },
    showsNone: async (m) => {
      await settled('record:quick_actions');
      // A bar that names an action with no record to run it against draws
      // nothing — not the authoring placeholder, which would claim the block
      // names no action (objectui#12995).
      expect(screen.queryByText(/no actions configured/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Approve environment/i })).not.toBeInTheDocument();
      expect(m.api).not.toHaveBeenCalled();
    },
  },
];

afterEach(() => {
  cleanup();
  getItem.mockClear();
});

describe.each(BLOCKS)('$type bound by `dataSource` on an app page (objectui#12294)', (block) => {
  const node = (dataSource: Record<string, unknown>) => ({ type: block.type, properties: block.properties, dataSource });

  it('one row → that record, read under the binding with `$top: 1`', async () => {
    const adapter = makeAdapter([
      { id: 'env-1', name: 'Prod env', region: 'Prod env region', rank: 1, environment_type: 'production' },
    ]);
    const m = mountOnAppPage(node({ object: OBJECT, filter: PRODUCTION, limit: 1 }), adapter);
    await block.shows(m, 'Prod env', 'env-1');

    expect(adapter.find).toHaveBeenCalled();
    const [object, params] = adapter.find.mock.calls[0];
    expect(object).toBe(OBJECT);
    expect(params).toMatchObject({ $top: 1 });
    // The binding's filter reached the read (lowered by the gate, so matched by
    // content rather than by shape).
    expect(JSON.stringify(params?.$filter)).toContain('production');
  });

  it('zero rows → the block\'s empty state', async () => {
    const adapter = makeAdapter([]);
    const m = mountOnAppPage(node({ object: OBJECT, filter: PRODUCTION, limit: 1 }), adapter);
    await block.showsNone(m);
    expect(adapter.find).toHaveBeenCalled();
  });

  it('a read the server refuses → the same empty state as zero rows', async () => {
    const refused = Object.assign(new Error('Forbidden'), { status: 403 });
    const adapter = makeAdapter([{ id: 'env-1', name: 'Prod env', rank: 1 }], { reject: refused });
    const m = mountOnAppPage(node({ object: OBJECT, filter: PRODUCTION, limit: 1 }), adapter);
    await block.showsNone(m);
  });

  it('two rows → the FIRST by the binding\'s `sort`, whatever order they are stored in', async () => {
    const adapter = makeAdapter([
      { id: 'env-2', name: 'Second env', region: 'Second env region', rank: 2, environment_type: 'production' },
      { id: 'env-1', name: 'First env', region: 'First env region', rank: 1, environment_type: 'production' },
    ]);
    const m = mountOnAppPage(
      node({ object: OBJECT, filter: PRODUCTION, sort: [{ field: 'rank', order: 'asc' }] }),
      adapter,
    );
    await block.shows(m, 'First env', 'env-1');
    expect(screen.queryByText('Second env')).not.toBeInTheDocument();
    expect(screen.queryByText('Second env region')).not.toBeInTheDocument();
    expect(adapter.find.mock.calls[0][1]).toMatchObject({ $top: 1, $orderby: [{ field: 'rank', order: 'asc' }] });
  });

  it('a read that FAILS is reported, not drawn as an absent record', async () => {
    const adapter = makeAdapter([], { reject: new Error('upstream exploded') });
    mountOnAppPage(node({ object: OBJECT, limit: 1 }), adapter);
    expect(await screen.findByTestId(`${testIdOf(block.type)}-datasource-error`)).toHaveTextContent('upstream exploded');
  });

  it('a named view that does not resolve draws the family\'s configuration panel, and reads no row', async () => {
    const adapter = { ...makeAdapter([{ id: 'env-1', name: 'Prod env' }]), listViews: vi.fn(async () => []) };
    mountOnAppPage(node({ object: OBJECT, view: 'no_such_view' }), adapter);
    expect(await screen.findByTestId(`${testIdOf(block.type)}-datasource-error`)).toBeInTheDocument();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('declares the `dataSource` input it reads — through the seam, not by hand', () => {
    const inputs = (ComponentRegistry.getConfig(block.type)?.inputs ?? []).map((i) => i.name);
    expect(inputs).toContain('dataSource');
  });
});

describe('the declaration stays where the binding is read (objectui#12294)', () => {
  it('a record block that reads no binding does not declare one — `record:path` as the control', () => {
    const inputs = (ComponentRegistry.getConfig('record:path')?.inputs ?? []).map((i) => i.name);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs).not.toContain('dataSource');
  });
});
