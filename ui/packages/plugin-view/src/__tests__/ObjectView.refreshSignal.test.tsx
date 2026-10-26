/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectView's refresh signal has exactly the entry points that are reachable
 * (objectui#4568).
 *
 * ## Why this file exists
 *
 * `ObjectView` kept a `handleRefresh` callback that bumped `refreshKey` and was
 * referenced by nothing — not passed to the toolbar, not exposed on a handle,
 * not wired to any control. It read as "ObjectView has a refresh entry point"
 * to anyone scanning for one, which cost objectui#4549 a detour to rule out.
 * Triage ruled deletion rather than wiring it to a new toolbar button: the
 * button is a feature with no recorded pull, and the affordance already exists
 * downstream (see below). objectui#4568 removed the callback.
 *
 * A dead-code deletion is only safe once the surviving paths are pinned, so
 * this file asserts the ones that remain rather than asserting the absence of
 * the one that went. `refreshKey` itself stays — it is read by the non-grid
 * fetch effect, by the remount key of the views that cannot refetch in place
 * (objectui#10035), and is forwarded to a host list view as `refreshKey` /
 * `refreshTrigger`.
 *
 * ## Where the real refresh button lives
 *
 * Not here. `packages/plugin-list/src/ListView.tsx` renders a toolbar Refresh
 * button gated on `toolbarFlags.showRefresh` (derived from
 * `userActions.refresh`) driving ListView's OWN refresh counter. ObjectView
 * reaches it by delegating through `renderListView` — and deliberately does not
 * auto-subscribe in that mode, which is the third test below. That delegation
 * is why the deleted callback had no toolbar to attach to in the first place.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema, DataSourceMutationEvent } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="schema-renderer">{schema?.type}</div>
    ),
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

/**
 * A DataSource whose `onMutation` hands the registered callback back to the
 * test, so a mutation can be emitted the way a real adapter would.
 */
function makeDataSource() {
  const subscribers: ((event: DataSourceMutationEvent) => void)[] = [];
  const unsubscribe = vi.fn();
  const onMutation = vi.fn((cb: (event: DataSourceMutationEvent) => void) => {
    subscribers.push(cb);
    return unsubscribe;
  });
  const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
  const ds: any = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    onMutation,
  };
  return {
    ds,
    find,
    onMutation,
    unsubscribe,
    emit: async (event: DataSourceMutationEvent) => {
      await act(async () => {
        subscribers.forEach(cb => cb(event));
      });
    },
  };
}

/** A non-grid view type, because the grid branch fetches its own data. */
const KANBAN_SCHEMA = {
  type: 'object-view',
  objectName: 'task',
  defaultViewType: 'kanban',
} as unknown as ObjectViewSchema;

describe('ObjectView refresh signal (objectui#4568)', () => {
  it('re-fetches when the DataSource reports a mutation on the same object', async () => {
    const { ds, find, emit } = makeDataSource();
    render(<ObjectView schema={KANBAN_SCHEMA} dataSource={ds} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

    await emit({ type: 'create', resource: 'task', id: '1' });

    await waitFor(
      () => expect(find).toHaveBeenCalledTimes(2),
      { timeout: 2000 },
    );
  });

  it('ignores a mutation reported for a different object', async () => {
    const { ds, find, emit } = makeDataSource();
    render(<ObjectView schema={KANBAN_SCHEMA} dataSource={ds} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

    await emit({ type: 'create', resource: 'not_task', id: '1' });

    // Nothing should re-run the fetch. Give the effect a turn to misbehave
    // before asserting it did not.
    await act(async () => { await Promise.resolve(); });
    expect(
      find,
      'A mutation on an unrelated object re-queried this view. The auto-subscribe\n'
        + 'is gated on `event.resource === schema.objectName`; losing that gate turns\n'
        + 'every mutation anywhere into a refetch storm.',
    ).toHaveBeenCalledTimes(1);
  });

  it('does not auto-subscribe when a host list view is supplied', async () => {
    const { ds, onMutation } = makeDataSource();
    render(
      <ObjectView
        schema={KANBAN_SCHEMA}
        dataSource={ds}
        renderListView={({ refreshKey }) => (
          <div data-testid="host-list" data-refresh-key={refreshKey} />
        )}
      />,
    );

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

    expect(
      onMutation,
      'ObjectView auto-subscribed to mutations while a host list view was supplied.\n'
        + 'The host (e.g. plugin-list ListView) owns its own fetching AND its own\n'
        + 'toolbar Refresh button; subscribing here double-fetches. This delegation is\n'
        + 'also why ObjectView never had a refresh control of its own for the\n'
        + 'objectui#4568 callback to attach to.',
    ).not.toHaveBeenCalled();
  });
});
