/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The authored `emptyState` of the three BOUND record blocks (objectui#12932).
 *
 * The spec declares `emptyState` on `record:details`, `record:highlights` and
 * `record:quick_actions` (objectstack#24266), the list view's own
 * `EmptyStateSchema` by reference, and says when it is drawn: the block
 * carries a `dataSource` binding and the bound read answered no row. Each block
 * is mounted the way an `app` page mounts it — the REAL registration through
 * `SchemaRenderer`, the spec's `{ type, properties, dataSource }` document,
 * under a `SchemaRendererProvider` adapter — so the `properties` hoist the
 * runtime applies is in the path too.
 *
 * Per block:
 *   (a) 0 rows + an authored `emptyState` → it is drawn (title and message);
 *   (b) 0 rows and none authored → the block's own default, unchanged;
 *   (c) controls: a row draws the row, a failed read draws the error panel,
 *       and an unbound block on a record page is unchanged.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import {
  ActionProvider,
  MetadataCtx,
  RecordContextProvider,
  SchemaRenderer,
  SchemaRendererProvider,
} from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';
import '../../index';

/**
 * `record:details` probes the record's edit verdict over `/api/v1/security/explain`
 * (`useRecordEditable`). Answered with a 501 — the probe's fail-open reply — so
 * no read leaves the process; installed once at module scope, as in the
 * objectui#12294 file beside this one.
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
  },
};

const APPROVE = { name: 'approve', label: 'Approve environment', type: 'api', locations: ['record_header'] };
const OBJECT_META = { name: OBJECT, label: 'Environment', actions: [APPROVE] };

type Row = Record<string, unknown>;

function makeAdapter(rows: Row[], opts: { reject?: unknown } = {}) {
  const find = vi.fn(async (_object: string, params?: Record<string, any>) => {
    if (opts.reject) throw opts.reject;
    const out = rows.map((r) => ({ ...r }));
    const top = typeof params?.$top === 'number' ? out.slice(0, params.$top) : out;
    return { data: top, total: top.length };
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

/** The page's providers; `record` wraps the node in a record page's own context. */
function mount(
  node: Record<string, unknown>,
  adapter: ReturnType<typeof makeAdapter>,
  record?: { id?: string; data?: Row },
) {
  const api = vi.fn();
  const body = <SchemaRenderer schema={node as any} />;
  render(
    <MetadataCtx.Provider value={METADATA}>
      <SchemaRendererProvider dataSource={adapter as any}>
        <ActionProvider handlers={{ api: async (_action, ctx) => { api(ctx); return { success: true }; } }}>
          {record ? (
            <RecordContextProvider
              objectName={OBJECT}
              recordId={record.id}
              data={record.data}
              objectSchema={OBJECT_SCHEMA as any}
              dataSource={adapter as any}
            >
              {body}
            </RecordContextProvider>
          ) : body}
        </ActionProvider>
      </SchemaRendererProvider>
    </MetadataCtx.Provider>,
  );
  return { api };
}

type BlockType = 'record:details' | 'record:highlights' | 'record:quick_actions';

interface BlockCase {
  type: BlockType;
  properties: Record<string, unknown>;
  /** Resolves when the block draws the row named `name` (`region` = `${name} region`). */
  shows: (name: string) => Promise<void>;
  /** The block's own 0-row default, as objectui#12294 pins it — unchanged here. */
  showsDefault: () => Promise<void>;
}

const testIdOf = (type: string) => type.replace(/[:_]/g, '-');

async function settled(type: string) {
  await waitFor(() => expect(screen.queryByTestId(`${testIdOf(type)}-loading-record`)).not.toBeInTheDocument());
}

const BLOCKS: BlockCase[] = [
  {
    type: 'record:details',
    properties: { fields: ['region'] },
    shows: async (name) => {
      expect(await screen.findByText(`${name} region`)).toBeInTheDocument();
    },
    showsDefault: async () => {
      // DetailView's own loud "record not found" state.
      expect(await screen.findByText('Record not found')).toBeInTheDocument();
    },
  },
  {
    type: 'record:highlights',
    properties: { fields: ['name', 'rank'] },
    shows: async (name) => {
      expect(await screen.findByText(name)).toBeInTheDocument();
    },
    showsDefault: async () => {
      // The strip draws nothing for a record that is not there.
      expect(screen.queryByText('Rank')).not.toBeInTheDocument();
    },
  },
  {
    type: 'record:quick_actions',
    properties: { actionNames: ['approve'] },
    shows: async () => {
      expect(await screen.findByRole('button', { name: /Approve environment/i })).toBeInTheDocument();
    },
    showsDefault: async () => {
      // A bar naming an action with no record to run it against draws nothing
      // on a runtime view (objectui#12995).
      expect(screen.queryByRole('button', { name: /Approve environment/i })).not.toBeInTheDocument();
    },
  },
];

const EMPTY_STATE = {
  title: 'No production environment',
  message: 'Create one from the environments page.',
  icon: 'server',
};

const BINDING = { object: OBJECT, limit: 1 };

afterEach(() => {
  cleanup();
  getItem.mockClear();
});

describe.each(BLOCKS)('$type — the authored `emptyState` of a bound record block (objectui#12932)', (block) => {
  // `null` is "no binding" (a default parameter would take `undefined` as BINDING).
  const node = (extra: Record<string, unknown>, dataSource: Record<string, unknown> | null = BINDING) => ({
    type: block.type,
    properties: { ...block.properties, ...extra },
    ...(dataSource ? { dataSource } : {}),
  });
  const emptyStateTestId = `${testIdOf(block.type)}-empty-state`;

  it('(a) 0 rows with an authored `emptyState` → its title and message are drawn in the block\'s place', async () => {
    const adapter = makeAdapter([]);
    mount(node({ emptyState: EMPTY_STATE }), adapter);
    const drawn = await screen.findByTestId(emptyStateTestId);
    expect(drawn).toHaveTextContent(EMPTY_STATE.title);
    expect(drawn).toHaveTextContent(EMPTY_STATE.message);
    expect(adapter.find).toHaveBeenCalled();
    // In PLACE of the block's own default, not beside it.
    expect(screen.queryByText('Record not found')).not.toBeInTheDocument();
  });

  it('(a) a read the server refuses as forbidden reads as no row, so the authored empty state is drawn for it too', async () => {
    const refused = Object.assign(new Error('Forbidden'), { status: 403 });
    mount(node({ emptyState: EMPTY_STATE }), makeAdapter([{ id: 'env-1', name: 'Prod env' }], { reject: refused }));
    expect(await screen.findByTestId(emptyStateTestId)).toHaveTextContent(EMPTY_STATE.title);
  });

  it('(b) 0 rows with NO `emptyState` → the block\'s own default, unchanged', async () => {
    mount(node({}), makeAdapter([]));
    await settled(block.type);
    await block.showsDefault();
    expect(screen.queryByTestId(emptyStateTestId)).not.toBeInTheDocument();
  });

  it('(c) CONTROL: a bound source with a row draws the row, not the empty state', async () => {
    mount(
      node({ emptyState: EMPTY_STATE }),
      makeAdapter([{ id: 'env-1', name: 'Prod env', region: 'Prod env region', rank: 1 }]),
    );
    await block.shows('Prod env');
    expect(screen.queryByTestId(emptyStateTestId)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATE.title)).not.toBeInTheDocument();
  });

  it('(c) CONTROL: a read that FAILS draws the error panel, not the empty state', async () => {
    mount(node({ emptyState: EMPTY_STATE }), makeAdapter([], { reject: new Error('upstream exploded') }));
    expect(await screen.findByTestId(`${testIdOf(block.type)}-datasource-error`)).toHaveTextContent('upstream exploded');
    expect(screen.queryByTestId(emptyStateTestId)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATE.title)).not.toBeInTheDocument();
  });

  it('(c) CONTROL: an UNBOUND block on a record page is unchanged — its record, and its own default without one', async () => {
    const withRecord = makeAdapter([]);
    mount(node({ emptyState: EMPTY_STATE }, null), withRecord, {
      id: 'env-9',
      data: { id: 'env-9', name: 'Page env', region: 'Page env region', rank: 9 },
    });
    await block.shows('Page env');
    expect(screen.queryByTestId(emptyStateTestId)).not.toBeInTheDocument();
    // The unbound path reads nothing: the record page's record is the block's.
    expect(withRecord.find).not.toHaveBeenCalled();
    cleanup();

    mount(node({ emptyState: EMPTY_STATE }, null), makeAdapter([]), { id: undefined, data: undefined });
    await block.showsDefault();
    expect(screen.queryByTestId(emptyStateTestId)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATE.title)).not.toBeInTheDocument();
  });

  it('publishes the `emptyState` input it draws', () => {
    const input = (ComponentRegistry.getConfig(block.type)?.inputs ?? []).find((i) => i.name === 'emptyState');
    expect(input?.type).toBe('object');
  });
});

describe('the authored empty state\'s members (objectui#12932)', () => {
  const details = (emptyState: Record<string, unknown>) => ({
    type: 'record:details',
    properties: { fields: ['region'], emptyState },
    dataSource: BINDING,
  });

  it('an `emptyState` with no `title` keeps the record block\'s own heading', async () => {
    mount(details({ message: 'Nothing here yet.' }), makeAdapter([]));
    const drawn = await screen.findByTestId('record-details-empty-state');
    expect(drawn).toHaveTextContent('Record not found');
    expect(drawn).toHaveTextContent('Nothing here yet.');
  });

  it('`title` as an inline locale map draws its display-locale entry', async () => {
    mount(details({ title: { en: 'No environment yet', 'zh-CN': 'ZH-TITLE' } }), makeAdapter([]));
    const drawn = await screen.findByTestId('record-details-empty-state');
    expect(drawn).toHaveTextContent('No environment yet');
    expect(drawn).not.toHaveTextContent('ZH-TITLE');
  });

  it('`icon` is resolved by name through `resolveIcon`, the grid\'s own resolver', async () => {
    mount(details({ title: 'None', icon: 'server' }), makeAdapter([]));
    const drawn = await screen.findByTestId('record-details-empty-state');
    await waitFor(() => expect(drawn.querySelector('svg.lucide-server')).not.toBeNull());
  });

  it('`link` draws the one shared empty-state link', async () => {
    mount(details({ title: 'None', link: { label: 'Read the guide', url: '/docs/environments' } }), makeAdapter([]));
    const drawn = await screen.findByTestId('record-details-empty-state');
    expect(drawn).toContainElement(screen.getByTestId('empty-state-link'));
    expect(screen.getByTestId('empty-state-link')).toHaveTextContent('Read the guide');
  });
});
