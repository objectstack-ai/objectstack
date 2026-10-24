/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — the object kanban's card move reads the `kanbanCardMove`
 * row of the affordance-to-grant map.
 *
 * Before, a card was draggable for every caller and a cross-column drop always
 * PATCHed the record's `groupBy` field: a caller without the update grant could
 * drag a card, watch it land, and get a refusal toast and a rollback. Now the
 * board draws the cards as NOT movable when the row is closed (dnd-kit's
 * sortable is disabled, which is what `aria-disabled` reports), and the board
 * is handed no mover at all, so no drop can reach the write.
 *
 * The drop is synthesized through `DndContext`'s real `onDragEnd`, captured by
 * the module mock below — the same harness `ObjectKanban.rejectedMoveRollback.
 * test.tsx` uses, for the reason it gives: dnd-kit's pointer sensors need
 * layout that the DOM double does not provide. Measured through the REAL
 * `MePermissionsProvider` over the map pin's four grant shapes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time (AGENTS.md §测试纪律); specifier
// byte-identical to the component's own lazy import.
import './KanbanImpl';

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragEnd = props.onDragEnd as (event: unknown) => void;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

registerAllFields();

const OBJECT = 'task';
const CARD = 'Fix the widget';

const objectDef = {
  name: OBJECT,
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'picklist',
      label: 'Status',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'in_progress', label: 'In Progress' },
      ],
    },
  },
};

const schema = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'in_progress', title: 'In Progress' },
  ],
} satisfies ObjectKanbanSchema;

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; update: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, update: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, update: true },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, update: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, update: true },
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

function makeDataSource() {
  return {
    getObjectSchema: vi.fn(async () => objectDef),
    find: vi.fn(async () => ({ value: [{ id: 't1', title: CARD, status: 'backlog' }] })),
    update: vi.fn(async () => ({ id: 't1', status: 'in_progress' })),
  } as unknown as DataSource & { update: ReturnType<typeof vi.fn> };
}

async function mountBoard(perms: MePermissionsResponse | null) {
  const ds = makeDataSource();
  const board = <ObjectKanban schema={schema} dataSource={ds} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{board}</MePermissionsProvider> : board);
  expect(await screen.findByText(CARD)).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  return ds;
}

/** The card's own element — the sortable node, whose `aria-disabled` dnd-kit sets. */
const cardNode = () => screen.getByRole('button', { name: CARD });

async function dropOnInProgress() {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 't1' }, over: { id: 'in_progress' } });
  });
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(SHAPES)('ObjectKanban under a $shape grant (objectui#12082)', ({ bits, update }) => {
  it('a card is movable, and a drop writes, exactly when the update grant allows it', async () => {
    const ds = await mountBoard(envelope(bits));
    expect(cardNode().getAttribute('aria-disabled')).toBe(String(!update));
    await dropOnInProgress();
    expect(ds.update).toHaveBeenCalledTimes(update ? 1 : 0);
    if (update) expect(ds.update).toHaveBeenCalledWith(OBJECT, 't1', { status: 'in_progress' });
  });
});

describe('ObjectKanban: the map\'s other layers and fail-open (objectui#12082)', () => {
  it('fail-open: with no permission provider a card is movable and a drop writes, as before', async () => {
    const ds = await mountBoard(null);
    expect(cardNode().getAttribute('aria-disabled')).toBe('false');
    await dropOnInProgress();
    expect(ds.update).toHaveBeenCalledTimes(1);
  });

  it('an effective operation set without update keeps cards still under the full grant', async () => {
    const ds = await mountBoard(envelope({ ...SHAPES[3].bits, apiOperations: ['read', 'create'] }));
    expect(cardNode().getAttribute('aria-disabled')).toBe('true');
    await dropOnInProgress();
    expect(ds.update).not.toHaveBeenCalled();
  });
});
