/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10277 — the grid's `$select` carries the row keys a row action's
 * `defaultFromRow` params seed from and the `{field}` tokens of its `target`.
 *
 * The grid projects what it DISPLAYS plus what its actions READ off the row
 * (objectui#3501 for predicates, objectstack#8018 for `recordIdField`). A
 * `defaultFromRow` param reads the row too: the param dialog is seeded from
 * `row[field ?? name]`, and only when the row OWNS that key. So a param bound to
 * a field no column shows opened its dialog blank on every projected row, and a
 * `{field}` token in an `api` target was filled with an empty string — authored
 * metadata dropped without a word. The fixture is the named producer's shape,
 * objectstack's `sys_team_member.remove_team_member`.
 *
 * PIN 1–3 read the projection; PIN 4 reads the row the param dialog is handed,
 * off a data source that honours `$select` the way a real backend does, so what
 * it asserts is the key the runtime looks up being present on a projected row.
 * PIN 5 is the guard the harvest inherits: an undeclared key is dropped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'team_member';

const OBJECT_FIELDS = {
  name: { type: 'text', label: 'Name' },
  // The two keys the action reads, deliberately NOT columns below — the whole
  // shape of the defect.
  team_id: { type: 'text', label: 'Team' },
  user_id: { type: 'text', label: 'User' },
};

/** The stored record. The data source below returns only what `$select` asks for. */
const STORED_ROW = { id: 'tm_1', name: 'Ada', team_id: 'team_42', user_id: 'user_7' };

const REMOVE_TEAM_MEMBER = {
  name: 'remove_team_member',
  label: 'Remove from Team',
  type: 'api',
  locations: ['list_item'],
  target: '/api/v1/auth/organization/remove-team-member',
  params: [
    { name: 'teamId', field: 'team_id', required: true, defaultFromRow: true },
    { name: 'userId', field: 'user_id', required: true, defaultFromRow: true },
  ],
};

const makeDataSource = (objectActions?: unknown[]) => ({
  // Honours `$select` as a real backend does: a key nobody asked for is absent
  // from the row, not `undefined`-valued — the own-property distinction the
  // param seeding reads.
  find: vi.fn(async (_object: string, params?: { $select?: string[] }) => {
    const select = params?.$select;
    const row = select
      ? Object.fromEntries(Object.entries(STORED_ROW).filter(([key]) => select.includes(key)))
      : { ...STORED_ROW };
    return { data: [row], total: 1 };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: OBJECT,
    fields: OBJECT_FIELDS,
    ...(objectActions ? { actions: objectActions } : {}),
  })),
});

/** Render a grid showing only `name` and return the `$select` it asked for. */
const selectFor = async (
  schemaExtra: Record<string, unknown>,
  objectActions?: unknown[],
): Promise<string[]> => {
  const ds = makeDataSource(objectActions);
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name'], ...schemaExtra } as never}
        dataSource={ds as never}
      />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ObjectGrid — `$select` carries what a row action READS off the row (objectui#10277)', () => {
  it('PIN 1: projects the fields an object action’s `defaultFromRow` params seed from', async () => {
    const select = await selectFor({}, [REMOVE_TEAM_MEMBER]);
    expect(select).toEqual(expect.arrayContaining(['team_id', 'user_id']));
    // The param's payload NAME is not a field and is not asked for.
    expect(select).not.toContain('teamId');
    // The harvest ADDS; the column and `id` are still there.
    expect(select).toEqual(expect.arrayContaining(['id', 'name']));
  });

  it('PIN 2: does the same for a view `rowActionDefs` and `bulkActionDefs` entry', async () => {
    expect(await selectFor({ rowActionDefs: [REMOVE_TEAM_MEMBER] })).toEqual(
      expect.arrayContaining(['team_id', 'user_id']),
    );
    cleanup();
    expect(
      await selectFor({ bulkActionDefs: [{ ...REMOVE_TEAM_MEMBER, locations: ['list_toolbar'] }] }),
    ).toEqual(expect.arrayContaining(['team_id', 'user_id']));
  });

  it('PIN 3: projects the `{field}` tokens of an action `target`', async () => {
    const select = await selectFor({
      rowActionDefs: [{
        name: 'remove_member',
        label: 'Remove',
        type: 'api',
        locations: ['list_item'],
        target: '/api/v1/teams/{team_id}/members/{user_id}',
      }],
    });
    expect(select).toEqual(expect.arrayContaining(['team_id', 'user_id']));
  });

  it('PIN 4: the row the param dialog is handed carries the seed key on a projected row', async () => {
    const ds = makeDataSource();
    let dialogRow: Record<string, unknown> | undefined;
    const onParamCollection = vi.fn(async (_params: unknown, action?: { params?: unknown }) => {
      dialogRow = (action?.params as { _rowRecord?: Record<string, unknown> } | undefined)?._rowRecord;
      return null; // cancel — the dialog's inputs are what this reads, not the request
    });
    render(
      <ActionProvider onParamCollection={onParamCollection as never}>
        <SchemaRendererProvider dataSource={ds as never}>
          <ObjectGrid
            schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name'], rowActionDefs: [REMOVE_TEAM_MEMBER] } as never}
            dataSource={ds as never}
          />
        </SchemaRendererProvider>
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('row-action-trigger')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('row-action-trigger'));
    await userEvent.click(await screen.findByTestId('row-action-remove_team_member'));
    await waitFor(() => expect(onParamCollection).toHaveBeenCalled());

    // `resolveActionParam` seeds from `row[field ?? name]` only when the row
    // OWNS the key — an absent key is a blank dialog, not an error.
    expect(Object.prototype.hasOwnProperty.call(dialogRow, 'team_id')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(dialogRow, 'user_id')).toBe(true);
    expect(dialogRow).toMatchObject({ id: 'tm_1', team_id: 'team_42', user_id: 'user_7' });
  });

  it('PIN 5: drops a seed key or token the object does not declare, rather than poisoning `$select`', async () => {
    // `user_id` is the same-fixture control: the harvest ran, so the two typos'
    // absence is the declared-field guard, not a harvest that saw nothing.
    const select = await selectFor({}, [{
      ...REMOVE_TEAM_MEMBER,
      target: '/api/v1/x/{taem_id}',
      params: [
        { name: 'teamId', field: 'team_idd', defaultFromRow: true },
        { name: 'userId', field: 'user_id', defaultFromRow: true },
      ],
    }]);
    expect(select).not.toContain('team_idd');
    expect(select).not.toContain('taem_id');
    expect(select).toEqual(['id', 'name', 'user_id']);
  });
});
