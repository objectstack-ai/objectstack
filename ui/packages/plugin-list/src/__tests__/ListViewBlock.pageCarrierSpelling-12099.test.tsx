/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12099 — a page `list-view` node is written `data` / `type`, and a
 * metadata page reads `properties.type` as the list kind
 * (objectstack-ai/objectstack#22444, ruling C).
 *
 * Every case renders through the REAL `SchemaRenderer` and the REAL `list-view`
 * registration, because the defect lived between the two: the renderer's
 * `properties` hoist never copies a bag's `type` onto the node (the node's own
 * `type` is the registry key), so a metadata page's list kind reached nothing
 * and the list drew a grid. The two view spies record which child view
 * `ListView` built and the object it bound.
 *
 * What is pinned:
 *  1. `properties.type: 'kanban'` with `properties.data` naming the object
 *     draws a kanban over that object, and the node's own `type` stays
 *     `list-view`: the kanban the spy receives is the `object-kanban` node
 *     `ListView` builds, so the registry resolved `list-view`, not the kind.
 *  2. A grid only when `properties.type` is absent (and for a kind no list
 *     view draws).
 *  3. ⛔ No read of `objectName` / `viewType` on a page node, in the bag or
 *     flat: a node that names its object only that way draws the "no object
 *     named" hint (naming `data.object`) and queries nothing, a `viewType`
 *     beside a working `data` changes nothing, and each retired key is named
 *     in one console warning per process. The hint and the warning are
 *     asserted by the key they name, not by their wording.
 *  4. The kind beside a `dataSource` binding: the node's `properties.type`
 *     outranks a bound saved view's kind, and with no `properties.type` the
 *     saved view's kind applies.
 *  5. The registrations publish `data` / `type` and no `objectName` /
 *     `viewType`, in `inputs` and `defaultProps`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers the REAL `list-view` and `view:list`.
import '../index';

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
  // The saved view case 4 binds by name: a kanban.
  listViews: {
    board: { name: 'board', label: 'Board', type: 'kanban', kanban: { groupByField: 'stage' } },
  },
};

/** What a view spy reads off the node `ListView` built for it. */
interface SpyProps {
  schema: { type?: string; objectName?: string };
}

/** Props each view spy received, in order. */
let kanbanProps: SpyProps[] = [];
let gridProps: SpyProps[] = [];

ComponentRegistry.register(
  'object-kanban',
  (props: SpyProps) => {
    kanbanProps.push(props);
    return <div data-testid="kanban-spy" />;
  },
  { namespace: 'test', label: 'Kanban spy', category: 'view' },
);

ComponentRegistry.register(
  'object-grid',
  (props: SpyProps) => {
    gridProps.push(props);
    return <div data-testid="grid-spy" />;
  },
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async (_object: string, _params?: unknown) => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  });

function renderNode(node: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const view = render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <SchemaRenderer schema={node as never} />
    </SchemaRendererProvider>,
  );
  return { dataSource, ...view };
}

/**
 * How long an absence is watched before it is believed (objectui#8705): real
 * time, longer than any deferral the test environment drains for free.
 */
const ABSENCE_SETTLE_MS = 250;

async function settleAbsenceWindow(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ABSENCE_SETTLE_MS));
  });
}

/** The hint names the page key to write, and never the retired one. */
async function expectNoObjectHint(getByTestId: (id: string) => HTMLElement): Promise<void> {
  await waitFor(() => expect(getByTestId('list-view-no-object')).toBeTruthy());
  const text = getByTestId('list-view-no-object').textContent ?? '';
  expect(text).toContain('data.object');
  expect(text).toContain('dataSource.object');
  expect(text).not.toContain('objectName');
}

/** The warnings issued so far that name `key` as a page node key not read. */
const warningsNaming = (spy: ReturnType<typeof vi.spyOn>, key: string): string[] =>
  (spy.mock.calls as unknown[][])
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => line.includes(`\`${key}\``) && line.includes('list-view'));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  kanbanProps = [];
  gridProps = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  cleanup();
});

const last = (spy: SpyProps[]): SpyProps => spy[spy.length - 1];

describe('a metadata page list-view node reads `properties.type` as its kind (objectui#12099)', () => {
  it('draws a kanban over the object `properties.data` names, and the node stays a list-view', async () => {
    // THE CARD'S CRITERION, verbatim in shape.
    const { dataSource, container } = renderNode({
      type: 'list-view',
      properties: {
        data: { provider: 'object', object: OBJECT },
        type: 'kanban',
        kanban: { groupByField: 'stage' },
      },
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(gridProps).toHaveLength(0);
    // The kanban `ListView` built is bound to the object `data` names, and it
    // is a live binding: the list queried that object.
    expect(last(kanbanProps).schema.type).toBe('object-kanban');
    expect(last(kanbanProps).schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
    // Unclobbered: only `ListView` builds that `object-kanban` node, so the
    // registry resolved `list-view`. Had the hoist copied the kind over the
    // node's `type`, the registry would have looked up `kanban`, which no
    // registration in this file answers.
    expect(container.textContent ?? '').not.toMatch(/Unknown component/i);
  });

  it('draws a grid when `properties.type` is absent', async () => {
    const { dataSource } = renderNode({
      type: 'list-view',
      properties: { data: { provider: 'object', object: OBJECT } },
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
    expect(last(gridProps).schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  });

  it('draws a grid for a `properties.type` that names no kind a list view draws', async () => {
    renderNode({
      type: 'list-view',
      properties: { data: { provider: 'object', object: OBJECT }, type: 'list-view' },
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
  });

  it('reads the kind on the `view:list` alias too: one renderer, one spelling', async () => {
    renderNode({
      type: 'view:list',
      properties: {
        data: { provider: 'object', object: OBJECT },
        type: 'kanban',
        kanban: { groupByField: 'stage' },
      },
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(gridProps).toHaveLength(0);
    expect(last(kanbanProps).schema.objectName).toBe(OBJECT);
  });
});

describe('a page list-view node does not read `objectName` / `viewType` (objectui#12099)', () => {
  // FIRST in this file to carry a retired key, on purpose: the warning is one
  // per key per process, so this is the render that issues both.
  it('names each retired key in one warning, and only once', async () => {
    const first = renderNode({ type: 'list-view', properties: { objectName: OBJECT, viewType: 'kanban' } });
    await expectNoObjectHint(first.getByTestId);
    expect(warningsNaming(warn, 'objectName')).toHaveLength(1);
    expect(warningsNaming(warn, 'viewType')).toHaveLength(1);
    cleanup();

    const second = renderNode({ type: 'list-view', objectName: OBJECT, viewType: 'kanban' });
    await expectNoObjectHint(second.getByTestId);
    expect(warningsNaming(warn, 'objectName')).toHaveLength(1);
    expect(warningsNaming(warn, 'viewType')).toHaveLength(1);
  });

  it.each([
    ['in the properties bag', { properties: { objectName: OBJECT, viewType: 'kanban', kanban: { groupByField: 'stage' } } }],
    ['flat on the node', { objectName: OBJECT, viewType: 'kanban', kanban: { groupByField: 'stage' } }],
  ])('a node naming its object only as `objectName` (%s) draws the hint and queries nothing', async (_where, rest) => {
    const { dataSource, getByTestId } = renderNode({ type: 'list-view', ...rest });

    await expectNoObjectHint(getByTestId);
    await settleAbsenceWindow();
    expect(dataSource.find).not.toHaveBeenCalled();
    expect(kanbanProps).toHaveLength(0);
    expect(gridProps).toHaveLength(0);
  });

  it('a `viewType` beside a working `data` changes nothing: the list is a grid', async () => {
    renderNode({
      type: 'list-view',
      properties: {
        data: { provider: 'object', object: OBJECT },
        viewType: 'kanban',
        kanban: { groupByField: 'stage' },
      },
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
  });

  it.each([
    ['no record source at all', {}],
    ['the registration\'s default `data`, which names no object', { properties: { data: { provider: 'object', object: '' } } }],
  ])('a node with %s draws the hint naming `data.object`', async (_case, rest) => {
    const { dataSource, getByTestId } = renderNode({ type: 'list-view', ...rest });

    await expectNoObjectHint(getByTestId);
    await settleAbsenceWindow();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('control: inline rows are a record source, so no hint is drawn', async () => {
    const { queryByTestId } = renderNode({
      type: 'list-view',
      properties: { data: { provider: 'value', items: rows } },
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(queryByTestId('list-view-no-object')).toBeNull();
  });
});

describe('the kind beside a `dataSource` binding (objectui#12099)', () => {
  it('draws a kanban over the bound object when `properties.type` says so', async () => {
    const { dataSource } = renderNode({
      type: 'list-view',
      dataSource: { object: OBJECT },
      properties: { type: 'kanban', kanban: { groupByField: 'stage' } },
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(last(kanbanProps).schema.objectName).toBe(OBJECT);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  });

  it('the node\'s `properties.type` outranks the bound saved view\'s kind', async () => {
    renderNode({
      type: 'list-view',
      dataSource: { object: OBJECT, view: 'board' },
      properties: { type: 'grid' },
    });

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    expect(kanbanProps).toHaveLength(0);
  });

  it('control: with no `properties.type`, the bound saved view\'s kind applies', async () => {
    renderNode({
      type: 'list-view',
      dataSource: { object: OBJECT, view: 'board' },
    });

    await waitFor(() => expect(kanbanProps.length).toBeGreaterThan(0));
    expect(gridProps).toHaveLength(0);
  });
});

describe('the registrations publish `data` / `type` (objectui#12099)', () => {
  const inputNames = (type: string) => (ComponentRegistry.getConfig(type)?.inputs ?? []).map((input) => input.name);

  it.each(['list-view', 'view:list'])('%s publishes `data` and `type`, and no `objectName` or `viewType`', (type) => {
    const names = inputNames(type);
    expect(names).toEqual(expect.arrayContaining(['data', 'type']));
    expect(names).not.toContain('objectName');
    expect(names).not.toContain('viewType');
  });

  it('the `type` input enumerates the kinds a list view draws', () => {
    const input = ComponentRegistry.getConfig('list-view')?.inputs?.find((candidate) => candidate.name === 'type');
    const options: Array<string | { value: unknown }> = input?.enum ?? [];
    expect(options.map((option) => (typeof option === 'string' ? option : option.value))).toEqual(
      expect.arrayContaining(['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map', 'chart', 'tree']),
    );
    expect(input?.required).not.toBe(true);
  });

  it('`defaultProps` carry the `data` shape and no `objectName`, `viewType` or `type`', () => {
    const defaults = ComponentRegistry.getConfig('list-view')?.defaultProps ?? {};
    expect(defaults.data).toEqual({ provider: 'object', object: '' });
    expect(defaults).not.toHaveProperty('objectName');
    expect(defaults).not.toHaveProperty('viewType');
    expect(defaults).not.toHaveProperty('type');
  });
});
