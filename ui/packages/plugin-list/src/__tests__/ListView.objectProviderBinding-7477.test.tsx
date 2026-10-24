/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7477 — a react page binds ListView the way the published
 * `react-blocks` contract recommends, and it renders.
 *
 * Step 6 of #2890, released by the maintainer's ruling B on objectstack#14791.
 * The reported shape:
 *
 *     <ListView data={{ provider: 'object', object: 'x' }} type="kanban" />
 *
 * Both halves of that binding used to be INERT here, and silently so:
 *
 *   - `data.provider === 'object'` was read at ZERO sites in `ListView.tsx`
 *     (`provider === 'value'` and `provider === 'api'` are both live there, so
 *     the zero was a real gap and not a dead instrument). `schema.objectName`
 *     stayed undefined, `fetchData` returned early on `!schema.objectName`, and
 *     the page rendered an empty list with NO diagnostic — while the same
 *     metadata validates green against `@objectstack/spec`'s `ViewDataSchema`.
 *   - the author's `type` — which the react tier parks under `specType`,
 *     because the SDUI envelope claims the `type` key (ADR-0078,
 *     `components/renderers/layout/react-page.tsx`) — was read at ZERO sites in
 *     this package, so an absent `viewType` forced the view to `grid`.
 *
 * The fix is ONE fold in `normalizeListViewSchema` (`@object-ui/core`), not a
 * seventh per-block copy of the six sibling `data.object` reads and not a
 * renderer-side `??` dual-read (AGENTS.md #0.1).
 *
 * ## Why this file mounts the REAL react page tier
 *
 * The card's criterion is written about a react PAGE, and the `specType` park
 * only exists because that tier's wrapper puts it there. Asserting against a
 * hand-built `{ specType }` bag would pin this package's half against a shape
 * this file itself asserts — so the first test drives the real
 * `kind:'react'` compile, the real scope injection, the real `list-view`
 * registration and a spy under `object-kanban`, and the hand-built bag is kept
 * only as the narrower second case.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * drop either leg of the fold in `normalize-list-view.ts` and this file goes
 * red in a leg-specific way — without the `data.object` leg the kanban is
 * handed `objectName: undefined` and nothing is fetched; without the
 * `specType` leg the page renders `object-grid` instead of `object-kanban`.
 * The `provider: 'value'` case is the control that stays green either way.
 *
 * ## Dating the two query-absence controls (objectui#8705)
 *
 * `invents NO binding …` and `leaves the value provider alone …` each assert
 * that NO query is started. Read straight after their `waitFor`, that absence
 * was dated to MOUNT rather than to a settled load. Measured, not assumed: in
 * BOTH of those tests the kanban spy has already recorded two props entries by
 * the time `render` returns, so `waitFor` is satisfied without ever yielding
 * and `not.toHaveBeenCalled()` was evaluated before a deferred query could
 * have run. Both pins stayed
 * GREEN against an implementation strictly worse than the bug — one line in
 * `ListView.tsx` that fires `dataSource.find` 50ms after every mount — so they
 * could not tell "starts no query" from "starts a query a tick later", which
 * is exactly the regression shape that would reach them.
 *
 * There is no anchor to prefer here, and that was checked before reaching for
 * a timer. An anchor needs a positive signal the implementation must emit
 * AFTER any query would have started. On the `value` path nothing settles at
 * all: `loading` is false from the first commit and never flips. On the
 * `object`-provider-without-object path the one transition that exists —
 * `loading` going false, per the `useState` initializer in `ListView.tsx` — is
 * set from the very branch a query would start from, and the measurement above
 * shows it has already happened before `render` returns. It postdates a
 * SYNCHRONOUS query and never a deferred one, which is the shape at issue. The
 * absence is therefore watched over a bounded window; see `ABSENCE_SETTLE_MS`.
 *
 * The other three absence reads in this file are NOT this shape, and that is
 * measured, not assumed: at `expect(gridProps).toHaveLength(0)` and at both
 * `expect(kanbanProps).toHaveLength(0)` sites, `dataSource.find` has ALREADY
 * been called when the line runs. Those three cases bind an object, and
 * `ListView` withholds the view spy behind its loading skeleton
 * (`loading && data.length === 0`) until the query resolves — so they are
 * already dated to a resolved query and are left exactly as they were.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider, AdapterCtx } from '@object-ui/react';
// Registers the page renderers (`type:'page'` / `'home'`), which dispatch
// `kind:'react'` to `ReactKindPage`.
import '@object-ui/components';
// Registers the REAL `list-view`, which is what the react page's scope resolves.
import '../index';
import { ListView } from '../ListView';

const OBJECT = 'crm_task';

const rows = [
  { id: 't-1', name: 'Draft the brief', stage: 'todo' },
  { id: 't-2', name: 'Ship the fold', stage: 'doing' },
];

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'text', label: 'Stage' },
  },
};

/** Props each view spy last received. */
let kanbanProps: Array<Record<string, any>> = [];
let gridProps: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-kanban',
  (props: Record<string, any>) => {
    kanbanProps.push(props);
    return <div data-testid="kanban-spy" />;
  },
  { namespace: 'test', label: 'Kanban spy', category: 'view' },
);

ComponentRegistry.register(
  'object-grid',
  (props: Record<string, any>) => {
    gridProps.push(props);
    return <div data-testid="grid-spy" />;
  },
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

/** Render a real `kind:'react'` page and return its live adapter. */
function renderReactPage(source: string) {
  const dataSource = makeDataSource();
  render(
    <AdapterCtx.Provider value={dataSource}>
      <SchemaRendererProvider dataSource={dataSource}>
        <SchemaRenderer
          schema={{ type: 'page', kind: 'react', name: 'binding_page', source } as never}
        />
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
  return dataSource;
}

/** Mount ListView directly on an already-built schema bag. */
function renderListView(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ type: 'list-view', ...schema } as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/**
 * How long a query-absence is watched before it is believed.
 *
 * REAL time, on purpose, and deliberately larger than any deferral the test
 * environment drains for free: RTL's `asyncWrapper` already flushes one
 * macrotask before `waitFor` returns, so a `setTimeout(…, 0)` regression sits
 * INSIDE the pre-existing window and a 0ms settle would prove nothing at all.
 * objectui#8705's forced leg defers its query by 50ms; this window is 5x that
 * and still an order of magnitude inside vitest's 5s default test timeout.
 */
const ABSENCE_SETTLE_MS = 250;

/**
 * Advance past `ABSENCE_SETTLE_MS` of real time so a deferred query has run
 * before an absence is read. Wrapped in `act` so that a regression which does
 * land state during the window is flushed into React rather than warned about.
 */
async function settleAbsenceWindow(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ABSENCE_SETTLE_MS));
  });
}

beforeEach(() => {
  kanbanProps = [];
  gridProps = [];
});
afterEach(cleanup);

describe("ListView — data={{ provider: 'object', object }} binds the view (objectui#7477)", () => {
  it("renders object `x` as a KANBAN from a react page that declares neither objectName nor viewType", async () => {
    // THE EXECUTABLE CRITERION, verbatim in substance from the card. Before the
    // fold this rendered `object-grid` with `objectName: undefined` and never
    // called `find` — an empty list, no diagnostic.
    const dataSource = renderReactPage(`
function Page() {
  return <ListView data={{ provider: 'object', object: '${OBJECT}' }} type="kanban" />;
}`);

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    // (a) the KIND came from the author's `type`, parked under `specType`.
    expect(gridProps).toHaveLength(0);
    // (b) the OBJECT came from the `object` provider's `object`.
    expect(kanbanProps[kanbanProps.length - 1].schema.objectName).toBe(OBJECT);
    // (c) and it is a live binding, not just a prop: the view queried object x.
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('binds the same way when the wrapper-built bag is handed straight to the block', async () => {
    // The narrower half of the case above: exactly the bag
    // `buildComponentScope`'s wrapper produces (react-page.tsx — the
    // discriminator wins `type`, the author's value is parked beside it), with
    // the page tier taken out of the picture.
    const dataSource = renderListView({
      data: { provider: 'object', object: OBJECT },
      specType: 'kanban',
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(kanbanProps[kanbanProps.length - 1].schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('binds the object even when the author states no kind at all (still a grid)', async () => {
    // The `object` provider leg alone. `viewType` absent and no author `type`
    // ⇒ the pre-existing `'grid'` default still applies, unchanged.
    const dataSource = renderListView({ data: { provider: 'object', object: OBJECT } });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
    expect(gridProps[gridProps.length - 1].schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('invents NO binding from an `object` provider that names no object', async () => {
    // The negative control that keeps the three cases above from passing
    // vacuously: a half-written data block must not manufacture an objectName,
    // and must not start a query.
    const dataSource = renderListView({ data: { provider: 'object' }, specType: 'kanban' });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    // Both reads below are ABSENCES, and the props above arrive on the first
    // commit — so date them to the end of a settle window, not to mount
    // (objectui#8705). A late `objectName` would push a fresh props entry and
    // a deferred query would have called `find` by the time this returns.
    await settleAbsenceWindow();
    expect(kanbanProps[kanbanProps.length - 1].schema.objectName).toBeUndefined();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it("leaves the `value` provider alone — it never gains an objectName", async () => {
    // The live sibling provider, as the control this fold must not disturb:
    // inline rows still render with no object binding and no query.
    const dataSource = renderListView({
      data: { provider: 'value', items: rows },
      specType: 'kanban',
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    // Same dating as the control above, and this is the path with NO settle of
    // its own: an inline-items provider leaves `loading` false from the first
    // commit, so without this window the absence is dated to mount.
    await settleAbsenceWindow();
    expect(kanbanProps[kanbanProps.length - 1].schema.objectName).toBeUndefined();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('lets an explicit `viewType` win over the author-parked `specType`', async () => {
    // Gap-fill only. The `specType` leg fills the kind that used to resolve to
    // `'grid'`; it never overrides a kind the view already states.
    renderListView({
      data: { provider: 'object', object: OBJECT },
      viewType: 'grid',
      specType: 'kanban',
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
  });

  it('lets an explicit `objectName` win over the data block', async () => {
    // The other half of gap-fill: this fold can never re-point a binding that
    // already resolves.
    const dataSource = renderListView({
      objectName: OBJECT,
      data: { provider: 'object', object: 'crm_other' },
      specType: 'kanban',
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(kanbanProps[kanbanProps.length - 1].schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  });
});
