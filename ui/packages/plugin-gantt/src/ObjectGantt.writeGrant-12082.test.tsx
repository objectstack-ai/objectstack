/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — the gantt's in-chart writes read the affordance-to-grant
 * map: a bar's drag / resize / progress, its title edited in place and its
 * dependency links are the `rowEdit` row (an update of the task record), and a
 * row's Delete is the `rowDelete` row.
 *
 * Before, none of them read a grant: only the authored `readOnly` and the row
 * `lockField` closed them, so a read-only caller could drag a bar, link two
 * tasks or delete a row, and the server refused the write. The fix is the one
 * `GanttView` already understands: each affordance is the PRESENCE of its
 * handler (no `onTaskUpdate` draws no draggable bar, no progress handle, no
 * in-place title edit and no undo; no `onDependencyCreate` / `onDependencyDelete`
 * draws no link handles; no `onTaskDelete` draws no Delete), so `ObjectGantt`
 * hands the chart a handler only when the row allows the write.
 *
 * `GanttView` is replaced by a probe that records the handlers it is given: the
 * chart's own "capability = handler presence" contract is pinned in its own
 * suites (`GanttView.readonly.test.tsx`, `GanttView.links.test.tsx`), and what
 * is measured here is which handlers `ObjectGantt` hands it under each grant.
 * Driving a recorded handler is the real path into `ObjectGantt`'s own write.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const probe = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock('./GanttView', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    GanttView: (props: Record<string, unknown>) => {
      probe.props = props;
      return <div data-testid="gantt-probe" />;
    },
  };
});

import { ObjectGantt } from './ObjectGantt';

const OBJECT = 'pm_task';
const ROWS = [
  { id: 't1', name: 'Design', start_date: '2024-01-01', end_date: '2024-01-05', depends_on: '' },
  { id: 't2', name: 'Build', start_date: '2024-01-06', end_date: '2024-01-10', depends_on: '' },
];

const SCHEMA = {
  type: 'gantt',
  objectName: OBJECT,
  gantt: {
    titleField: 'name',
    startDateField: 'start_date',
    endDateField: 'end_date',
    dependenciesField: 'depends_on',
  },
  data: { provider: 'object', object: OBJECT },
} as any;

const makeDataSource = (objectSchema: Record<string, unknown> = {}) =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        depends_on: { type: 'text' },
      },
      ...objectSchema,
    }),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(true),
  }) as any;

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; update: boolean; remove: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, update: false, remove: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, update: true, remove: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, update: false, remove: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, update: true, remove: true },
];

const envelope = (bits: Record<string, unknown>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits as never },
  fields: {},
});

beforeEach(() => {
  probe.props = null;
});
afterEach(cleanup);

type Handler = ((...args: unknown[]) => unknown) | undefined;
const handler = (name: string): Handler => probe.props?.[name] as Handler;
const tasks = () => (probe.props?.tasks ?? []) as Array<Record<string, unknown>>;

const UPDATE_HANDLERS = ['onTaskUpdate', 'onDependencyCreate', 'onDependencyDelete'] as const;

async function mount(perms: MePermissionsResponse | null, ds = makeDataSource()) {
  const gantt = <ObjectGantt schema={SCHEMA} dataSource={ds} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{gantt}</MePermissionsProvider> : gantt);
  await screen.findByTestId('gantt-probe');
  await waitFor(() => expect(tasks().length).toBe(2));
  return ds;
}

describe.each(SHAPES)('ObjectGantt under a $shape grant (objectui#12082)', ({ bits, update, remove }) => {
  it('drag / resize and the dependency edit are offered exactly when the update grant allows them', async () => {
    const ds = await mount(envelope(bits));
    for (const name of UPDATE_HANDLERS) {
      expect(typeof handler(name) === 'function', name).toBe(update);
    }
    if (update) {
      await act(async () => {
        await handler('onTaskUpdate')!(tasks()[0], { start: new Date(2024, 0, 2), end: new Date(2024, 0, 6) });
      });
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.update.mock.calls[0][0]).toBe(OBJECT);
      await act(async () => {
        await handler('onDependencyCreate')!(tasks()[0], tasks()[1], 'fs');
      });
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
      expect(ds.update.mock.calls[1][2]).toEqual({ depends_on: 't1' });
    }
  });

  it('the row Delete is offered exactly when the delete grant allows it', async () => {
    await mount(envelope(bits));
    expect(typeof handler('onTaskDelete') === 'function', 'onTaskDelete').toBe(remove);
    if (remove) {
      act(() => {
        handler('onTaskDelete')!(tasks()[0]);
      });
      expect(await screen.findByRole('alertdialog')).toBeTruthy();
    }
  });
});

describe("ObjectGantt: the map's other layers and fail-open (objectui#12082)", () => {
  it('fail-open: with no permission provider every in-chart write is offered, as before', async () => {
    await mount(null);
    for (const name of [...UPDATE_HANDLERS, 'onTaskDelete']) {
      expect(typeof handler(name), name).toBe('function');
    }
  });

  it('an effective operation set without update and delete withholds every in-chart write under the full grant', async () => {
    await mount(envelope({ ...SHAPES[3].bits, apiOperations: ['get', 'list'] }));
    for (const name of [...UPDATE_HANDLERS, 'onTaskDelete']) {
      expect(handler(name), name).toBeUndefined();
    }
  });

  it("an object policy that closes edit and delete withholds them under the full grant", async () => {
    await mount(envelope(SHAPES[3].bits), makeDataSource({ userActions: { edit: false, delete: false } }));
    // The policy half reads the object schema, which settles after the chart's
    // first paint; wait for the verdict that reads it.
    await waitFor(() => expect(handler('onTaskUpdate')).toBeUndefined());
    for (const name of [...UPDATE_HANDLERS, 'onTaskDelete']) {
      expect(handler(name), name).toBeUndefined();
    }
  });
});
