/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `list-view` reads its per-element `dataSource` binding through the SHARED
 * `ElementDataSourceGate` (objectui#4038).
 *
 * objectstack#5576 wrote the precedence table INSIDE `ListViewBlock`;
 * objectstack#6953 lifted the same table into `@object-ui/react` when the other
 * eight object-bound blocks needed it, leaving two copies of one table. Two
 * copies is how the next person to change the rules changes one side, and the
 * spec's "*additional* filter criteria" quietly becomes two dialects.
 * objectui#4038 deleted the private copy; what `ListViewBlock` still owns is the
 * five KEY NAMES it reads, and that is what this file pins.
 *
 * ## What each half pins — and what can actually turn it red
 *
 * The convergence is a refactor between two implementations that AGREED, so
 * objectstack#5576's suite passing untouched is its acceptance criterion
 * (`ListView.elementDataSource.test.tsx` — not one assertion edited). It follows
 * that the behavioural pins below cannot, even in principle, tell the private
 * copy from the shared gate: nothing can, that is the premise. What they guard is
 * the part the refactor left behind as a five-line constant, where a mistake is
 * now cheap to make and invisible to review — drop `viewType`, spell the row cap
 * `limit` instead of `pagination.pageSize`, or stop mapping `columns`, and they
 * go red naming the key that moved.
 *
 * The two `seam` tests are the other half, and the only ones that go red if the
 * block re-forks its own copy: they pin that the mapping is handed to the shared
 * gate at all. Together: a re-fork fails fast, and a mistyped mapping fails
 * precisely.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import { en } from '@object-ui/i18n';
import { ListViewBlock } from '../ListViewBlock';

const h = vi.hoisted(() => ({ captured: null as any, gate: [] as any[] }));

// Capture the BOUND schema `ListView` actually receives — the question asked of
// the block, not merely that a prop was threaded somewhere. Same idiom as
// `plugin-detail/src/__tests__/RecordRelatedListRenderer.elementDataSource.test.tsx`.
vi.mock('../ListView', () => ({
  ListView: (props: any) => {
    h.captured = props;
    return <div data-testid="list-view-mock" />;
  },
}));

// Partial mock — house idiom (`plugin-kanban/src/registration.test.tsx`): keep
// every real export and wrap ONLY the gate, so the REAL gate still does all the
// work while this file records what the block hands it. A whole-module
// replacement would hand back a second `SchemaRendererContext` instance and the
// provider below would stop reaching the block at all.
vi.mock(import('@object-ui/react'), async (importOriginal) => {
  const actual = await importOriginal();
  const RealGate = actual.ElementDataSourceGate;
  return {
    ...actual,
    ElementDataSourceGate: ((props: any) => {
      h.gate.push(props);
      return <RealGate {...props} />;
    }) as typeof actual.ElementDataSourceGate,
  };
});

/** A saved view that supplies every key the mapping can route. */
const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  // The view's render KIND (the spec's `type`), not a field list.
  type: 'kanban',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 5 },
};

const makeAdapter = (listViews: Record<string, unknown> = { hot: HOT_VIEW }) => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: [], listViews }),
});

function renderBlock(schema: Record<string, unknown>, adapter: any = makeAdapter()) {
  const utils = render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <ListViewBlock schema={schema as any} />
    </SchemaRendererProvider>,
  );
  return { ...utils, adapter };
}

/** The schema the gate composed and handed down to `ListView`. */
async function boundSchema(): Promise<Record<string, any>> {
  await waitFor(() => expect(h.captured).toBeTruthy());
  return h.captured.schema as Record<string, any>;
}

beforeEach(() => {
  h.captured = null;
  h.gate.length = 0;
});

describe('list-view — the seam: the binding is read through the SHARED gate (objectui#4038)', () => {
  it('hands the shared gate exactly the keys ListView reads', async () => {
    renderBlock({ type: 'list-view', dataSource: { object: 'account' } });
    await boundSchema();

    // `list-view` is the block that reads all five. This is the whole of what
    // the convergence left in `ListViewBlock` — the ~45-line table itself now
    // lives once, in `@object-ui/react`.
    expect(h.gate[0].mapping).toEqual({
      columns: true,
      filter: true,
      sort: true,
      limit: 'pagination.pageSize',
      viewType: true,
    });
  });

  it('names itself to the shared status panels with objectstack#5576’s testIds', async () => {
    const { container } = renderBlock({
      type: 'list-view',
      dataSource: { object: 'account', view: 'lukewarm' },
    });

    await waitFor(() =>
      expect(container.querySelector('[data-testid="list-view-datasource-error"]')).not.toBeNull(),
    );
    // The prefix is what keeps the shared panels byte-compatible with the
    // assertions objectstack#5576 already carries.
    expect(h.gate[0].testId).toBe('list-view');
    // Edited deliberately (objectui#12920): the title is read from the bundle,
    // no longer an English literal. With no `I18nProvider` mounted it is the
    // `en` pack's value, which the call site's inline default repeats; the
    // zh-CN render is pinned in `ListView.elementDataSource.test.tsx`.
    expect(h.gate[0].errorTitle).toBe(en.element.listView.sourceUnresolved);
    expect(container.textContent).toContain(en.element.listView.sourceUnresolved);
  });

  it('gives the gate the same adapter it gives ListView', async () => {
    // Both bridges in one assertion: the adapter resolved off the renderer
    // context (#3144) is the one the gate resolves saved views with AND the one
    // `ListView` queries through.
    const adapter = makeAdapter();
    renderBlock({ type: 'list-view', dataSource: { object: 'account' } }, adapter);
    await boundSchema();

    expect(h.gate[0].dataSource).toBe(adapter);
    expect(h.captured.dataSource).toBe(adapter);
  });

  it('renders the shared LOADING panel while a named view is still resolving', async () => {
    // Untested before objectui#4038 in either implementation: `-resolving-view`
    // appeared only in the block's own source. A component that treated "not
    // resolved yet" as "does not exist" would flash a configuration error on
    // every mount, so the two states get two panels.
    const pending = {
      ...makeAdapter(),
      getObjectSchema: vi.fn(() => new Promise(() => {})),
    };
    const { container } = renderBlock(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      pending,
    );

    const panel = container.querySelector('[data-testid="list-view-resolving-view"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('status');
    // The block must not be mounted against a half-resolved query — that is how
    // a page shows a wider answer than the one that was authored.
    expect(h.captured).toBeNull();
  });
});

describe('list-view — the mapping table, key by key, through the shared gate', () => {
  it('routes `object` onto the objectName ListView queries', async () => {
    renderBlock({ type: 'list-view', dataSource: { object: 'account' } });
    expect((await boundSchema()).objectName).toBe('account');
  });

  it('takes the view’s columns when the component authored none', async () => {
    renderBlock({ type: 'list-view', dataSource: { object: 'account', view: 'hot' } });
    expect((await boundSchema()).columns).toEqual(['name', 'rating']);
  });

  it('counts an authored-but-EMPTY columns as unauthored', async () => {
    // `[]` is what the designer emits for an unconfigured column list, and
    // supplying the columns is exactly why a view was named.
    renderBlock({ type: 'list-view', columns: [], dataSource: { object: 'account', view: 'hot' } });
    expect((await boundSchema()).columns).toEqual(['name', 'rating']);
  });

  it('lets a non-empty authored columns win over the view’s', async () => {
    renderBlock({
      type: 'list-view',
      columns: ['name'],
      dataSource: { object: 'account', view: 'hot' },
    });
    expect((await boundSchema()).columns).toEqual(['name']);
  });

  it('AND-combines the component’s own filter with the view’s and the binding’s', async () => {
    // "Additional filter criteria" taken literally: all three sources stay in
    // force, so a per-element filter can only narrow what the saved view already
    // restricts. `and` is associative, so the nesting below is the composer's
    // output shape rather than a semantic claim — it is pinned because a change
    // that DROPS a source would show up here first.
    renderBlock({
      type: 'list-view',
      filter: [['stage', '=', 'won']],
      dataSource: { object: 'account', view: 'hot', filter: { owner: 'me' } },
    });

    expect((await boundSchema()).filter).toEqual([
      'and',
      [['stage', '=', 'won']],
      ['and', [['rating', '=', 'hot']], ['owner', '=', 'me']],
    ]);
  });

  it('lets the component’s own sort win over one the VIEW supplied', async () => {
    // A view is a reference; a key written on the component is more specific.
    renderBlock({
      type: 'list-view',
      sort: [{ field: 'created', order: 'asc' }],
      dataSource: { object: 'account', view: 'hot' },
    });
    expect((await boundSchema()).sort).toEqual([{ field: 'created', order: 'asc' }]);
  });

  it('lets the BINDING’s own sort win over the component’s', async () => {
    // …but a sort authored on this placement is authoritative over both.
    renderBlock({
      type: 'list-view',
      sort: [{ field: 'created', order: 'asc' }],
      dataSource: { object: 'account', view: 'hot', sort: [{ field: 'rating', order: 'asc' }] },
    });
    expect((await boundSchema()).sort).toEqual([{ field: 'rating', order: 'asc' }]);
  });

  it('lands the row cap on pagination.pageSize, keeping the other pagination keys', async () => {
    renderBlock({
      type: 'list-view',
      pagination: { mode: 'server' },
      dataSource: { object: 'account', limit: 3 },
    });

    const schema = await boundSchema();
    expect(schema.pagination).toEqual({ mode: 'server', pageSize: 3 });
    // The mapping names only keys this block READS. A cap parked on a flat
    // `limit`/`pageSize` would be accepted and dropped — the very defect the
    // wiring removes, one layer further in.
    expect(schema.limit).toBeUndefined();
    expect(schema.pageSize).toBeUndefined();
  });

  it('lets an authored pagination.pageSize win over a cap the VIEW supplied', async () => {
    renderBlock({
      type: 'list-view',
      pagination: { pageSize: 25 },
      dataSource: { object: 'account', view: 'hot' },
    });
    expect((await boundSchema()).pagination).toEqual({ pageSize: 25 });
  });

  it('still takes the BINDING’s cap over an authored pagination.pageSize', async () => {
    renderBlock({
      type: 'list-view',
      pagination: { pageSize: 25 },
      dataSource: { object: 'account', view: 'hot', limit: 3 },
    });
    expect((await boundSchema()).pagination).toEqual({ pageSize: 3 });
  });

  it('takes the view’s KIND only when the component declared none', async () => {
    // `list-view` is the only container that renders several kinds off
    // `schema.viewType` (the kind it hands `ListView`), so naming a saved
    // kanban view and rendering a grid would be a silently wrong answer.
    renderBlock({ type: 'list-view', dataSource: { object: 'account', view: 'hot' } });
    expect((await boundSchema()).viewType).toBe('kanban');
  });

  it('leaves a kind authored as `properties.type` alone', async () => {
    // A page node writes its kind in `properties.type` (objectui#12099); the
    // block hands it to `ListView` as `viewType`, ahead of the view's kind.
    renderBlock({
      type: 'list-view',
      properties: { type: 'gallery' },
      dataSource: { object: 'account', view: 'hot' },
    });
    expect((await boundSchema()).viewType).toBe('gallery');
  });

  it('passes a schema with NO binding through BY REFERENCE', async () => {
    // Identity, not equality: a new schema object on every render would remount
    // `ListView` and refetch. The unbound path must stay exactly as it was.
    const authored = { type: 'list-view', data: { provider: 'object', object: 'account' }, columns: ['name'] };
    renderBlock(authored);
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.schema).toBe(authored);
  });
});
