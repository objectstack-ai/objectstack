/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7353 — the widget node no longer carries `dataProvider`
 * (ADR-0049, remove arm; ruled on the card).
 *
 * ## What was retired
 *
 * Both dashboard surfaces turned a `provider: 'object'` widget into a node for
 * the table / pivot widgets and wrote the whole provider config onto it as
 * `dataProvider: widgetData`, beside `objectName: widgetData.object`. Nothing
 * read `dataProvider` — the widgets read `objectName` — so the key was a second
 * spelling of the same information that only the declarations kept alive
 * (`ObjectDataTableSchema.dataProvider` in `@object-ui/types`, and the
 * `schema.dataProvider` member of `ObjectPivotTableProps`). All three writes
 * went, both typed declarations became retirement tombstones that refuse the
 * key and point at `objectName`, and no reader was added.
 *
 * ## Why the pin reads the NODE, not the screen
 *
 * An unread key changes nothing visible, so a screen assertion is green on both
 * sides. What the removal changes is the node each widget is HANDED — so this
 * file records every node that reaches `SchemaRenderer` (the real one renders
 * it; the recorder only listens) and asserts on those. The object-data-table
 * case also reads the `data-table` node `ObjectDataTable` renders onward,
 * because that widget spreads its own node into it: the key travelled one hop
 * further than any producer wrote it.
 *
 * ## Controls, and what they are for
 *
 *  - `objectName` is still written on every one of those nodes — the key the
 *    widgets read. Without it, "no `dataProvider`" would also be satisfied by a
 *    branch that stopped emitting the node's binding altogether.
 *  - The object-data-table widget still FETCHES through `objectName`: the
 *    adapter's `find` is called for that object. That is the behaviour the
 *    retired key was never part of, and it must not move.
 *
 * ## Direction, stated before the reverse verification
 *
 * RED on the unmodified tree: every "carries no `dataProvider`" assertion (the
 * producers wrote it). GREEN on both sides: every control. The type-level half
 * (both widget prop types carry `dataProvider` as a `?: never` tombstone, so
 * authoring it is a compile error) is enforced by `tsconfig.test.json`, which
 * this package's `type-check` chains.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Every node handed to `SchemaRenderer`, in arrival order. Hoisted so the mock
 * factory below can close over it.
 */
const received = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  const RealSchemaRenderer = actual.SchemaRenderer;
  return {
    ...actual,
    // A listener, not a stub: the node is recorded and then rendered by the
    // REAL renderer, so the widgets below mount, fetch and render as they do in
    // production. Everything else is the real export by identity.
    SchemaRenderer: (props: any) => {
      if (props?.schema && typeof props.schema === 'object') received.push(props.schema);
      return <RealSchemaRenderer {...props} />;
    },
  };
});

import { SchemaRendererProvider } from '@object-ui/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// Side-effect imports at MODULE scope (never inside a case or a hook) per
// AGENTS.md's flaky-test rule: `@object-ui/components` registers `data-table`,
// the package barrel registers `object-data-table` / `pivot`.
import '@object-ui/components';
import { DashboardRenderer, DashboardGridLayout } from '../index';
import { LEGACY_RETIRED_WIDGET_SCHEMA } from '../legacyRetiredWidget';
import type { ObjectPivotTableProps } from '../ObjectPivotTable';
import type { ObjectDataTableProps } from '../ObjectDataTable';

afterEach(() => {
  cleanup();
  received.length = 0;
});

const ROWS = [{ id: 'a1', name: 'Acme', region: 'EMEA', amount: 3 }];

function makeAdapter() {
  return {
    find: vi.fn(async (_objectName: string, _params?: unknown) => ({ data: ROWS })),
    getObjectSchema: vi.fn(async (_objectName: string) => ({
      name: 'account',
      fields: { name: { type: 'text', label: 'Name' }, region: { type: 'text' }, amount: { type: 'number' } },
    })),
  };
}

/** The live provider surface: `options.data = { provider: 'object', object }`. */
const OBJECT_PROVIDER = { provider: 'object', object: 'account' } as const;

const dash = (widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets }) as unknown as DashboardComponentSchema;

const nodesOfType = (type: string) => received.filter((n) => n.type === type);

describe('objectui#7353 — DashboardRenderer: the object-data-table node carries no dataProvider', () => {
  it('writes objectName, not dataProvider, and the widget still fetches through objectName', async () => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as never}>
        <DashboardRenderer
          schema={dash([{ id: 'accounts', type: 'table', title: 'Accounts', options: { data: OBJECT_PROVIDER } }])}
          dataSource={adapter}
        />
      </SchemaRendererProvider>,
    );

    // Non-vacuity: the widget really mounted and fetched, and the table it
    // renders onward really arrived — otherwise every "absent" below would be
    // satisfied by a render that never happened.
    await waitFor(() => expect(nodesOfType('data-table').length).toBeGreaterThan(0));

    const widgetNodes = nodesOfType('object-data-table');
    expect(widgetNodes.length).toBeGreaterThan(0);
    for (const node of widgetNodes) {
      expect(node.objectName).toBe('account');
      expect(Object.keys(node)).not.toContain('dataProvider');
    }

    // The hop the key used to travel: ObjectDataTable spreads its node into
    // the `data-table` it renders.
    for (const node of nodesOfType('data-table')) {
      expect(Object.keys(node)).not.toContain('dataProvider');
    }

    // Control: the fetch is keyed on objectName, as before.
    expect(adapter.find).toHaveBeenCalled();
    expect(adapter.find.mock.calls.every(([objectName]) => objectName === 'account')).toBe(true);
  });
});

describe('objectui#7353 — DashboardGridLayout: the table and pivot nodes carry no dataProvider', () => {
  // The pivot row used to sit in this table as `['pivot', 'pivot', …]`,
  // pinning a `pivot` node with `objectName`. objectui#10528 (amended claim
  // 5831757648, option B) retired that branch: the grid's provider-object
  // pivot now answers with the shared retired-widget placeholder, as
  // `DashboardRenderer` does, so its row is the separate case below.
  it.each([
    ['table', 'data-table', {}],
  ])('a provider-object %s widget becomes a %s node with objectName and no dataProvider', async (widgetType, nodeType, extra) => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as never}>
        <DashboardGridLayout
          schema={dash([{ id: 'w1', type: widgetType, options: { ...extra, data: OBJECT_PROVIDER } }])}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(nodesOfType(nodeType).length).toBeGreaterThan(0));
    for (const node of nodesOfType(nodeType)) {
      // Control: the binding the producer writes beside it is still there.
      expect(node.objectName).toBe('account');
      expect(Object.keys(node)).not.toContain('dataProvider');
    }
  });

  it('a provider-object pivot widget becomes the retired-widget placeholder, which carries no dataProvider (objectui#10528)', async () => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as never}>
        <DashboardGridLayout
          schema={dash([{ id: 'w1', type: 'pivot', options: { rowField: 'region', valueField: 'amount', data: OBJECT_PROVIDER } }])}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    // The shared object itself, not a copy — and it has no `dataProvider`.
    expect(Object.keys(LEGACY_RETIRED_WIDGET_SCHEMA)).not.toContain('dataProvider');
    // The retired branch's node is gone: no `pivot` node, and no query.
    expect(nodesOfType('pivot')).toHaveLength(0);
    expect(adapter.find).not.toHaveBeenCalled();
  });
});

/*
 * The declaration half: `dataProvider` is a `?: never` RETIREMENT TOMBSTONE on
 * both widget prop types (objectui#7353), so authoring it is a compile error.
 *
 *  - `ObjectPivotTableProps['schema']` — the prop type of `ObjectPivotTable`,
 *    exported from this package's index. It has no zod face (neither
 *    `object-pivot` nor `PivotTableSchema` is mirrored), so this `tsc` refusal
 *    is the only one it has.
 *  - `ObjectDataTableProps['schema']`, anchored to `@object-ui/types`'
 *    `ObjectDataTableSchema`. This package reads that type through the BUILT
 *    `.d.ts` (its `tsconfig.test.json` empties `paths`), so these lines are the
 *    consumer-side half of the types tombstone: red on a stale `dist`.
 *
 * Why a tombstone and not a deletion: both carriers extend `BaseSchema`, whose
 * `[key: string]: any` absorbed a deleted member silently at any value until
 * objectui#8347 (a widened value still would) — an authored `dataProvider`
 * would still compile there and still do nothing. The
 * `@ts-expect-error` directives are real enforcement because this package's
 * `type-check` chains `tsc -p tsconfig.test.json`; vitest erases them.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type PivotSchema = ObjectPivotTableProps['schema'];
type DataTableSchema = ObjectDataTableProps['schema'];

/** `?: never` reads as `undefined`; a deletion would read as `any`, the old member as its object shape. */
export type assertionPivotDataProviderIsATombstone = Expect<Equal<PivotSchema['dataProvider'], undefined>>;
export type assertionDataTableDataProviderIsATombstone = Expect<Equal<DataTableSchema['dataProvider'], undefined>>;
/** Non-vacuity twins: the key both widgets read keeps its real type. */
export type assertionPivotObjectNameStaysLive = Expect<Equal<PivotSchema['objectName'], string | undefined>>;
export type assertionDataTableObjectNameStaysLive = Expect<Equal<DataTableSchema['objectName'], string | undefined>>;

describe('objectui#7353 — both widget prop types refuse an authored dataProvider', () => {
  it('ObjectPivotTableProps: authoring dataProvider is a compile error; objectName is not', () => {
    const node: PivotSchema = {
      type: 'pivot',
      rowField: 'region',
      columnField: 'stage',
      valueField: 'amount',
      data: [],
      objectName: 'account',
      // @ts-expect-error `dataProvider` is a retirement tombstone (objectui#7353) — write `objectName`
      dataProvider: { provider: 'object', object: 'account' },
    };
    // Control: an undeclared key carried no directive while the index signature
    // absorbed it — what a deletion would have left `dataProvider` as. Since
    // objectui#8347 it is refused too, as undeclared, with no remedy named; the
    // tombstone above is what names `objectName`.
    // @ts-expect-error — the pivot node declares no `zzUndeclared7353` (objectui#8347)
    const undeclared: PivotSchema = { type: 'pivot', rowField: 'r', columnField: 'c', valueField: 'v', data: [], zzUndeclared7353: 1 };
    expect([node.objectName, undeclared.type]).toEqual(['account', 'pivot']);
  });

  it('ObjectDataTableProps (anchored to ObjectDataTableSchema): the same, through the built types', () => {
    const node: DataTableSchema = {
      type: 'object-data-table',
      objectName: 'account',
      // @ts-expect-error `dataProvider` is a retirement tombstone (objectui#7353) — write `objectName`
      dataProvider: { provider: 'object', object: 'account' },
    };
    // @ts-expect-error — `ObjectDataTableSchema` declares no `zzUndeclared7353` (objectui#8347)
    const undeclared: DataTableSchema = { type: 'object-data-table', zzUndeclared7353: 1 };
    expect([node.objectName, undeclared.type]).toEqual(['account', 'object-data-table']);
  });
});
