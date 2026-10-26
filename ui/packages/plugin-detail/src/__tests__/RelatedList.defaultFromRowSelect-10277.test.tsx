/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10277 — on `RelatedList`'s authored path the row fetch's `$select`
 * carries the keys a row action's `defaultFromRow` params seed from and the
 * `{field}` tokens of its `target`, and FLS still decides.
 *
 * The harvest core's `listViewPredicates` feeds this list's projection
 * (objectui#10186). It now names two more row keys an action reads; this file
 * pins the half that matters most here: a harvested name is a CANDIDATE, not a
 * read grant. The list asks for a seed key or token field only when the child
 * DECLARES it and the principal may READ it — the order `ObjectGrid`'s
 * `passesProjectionGate` set.
 *
 *  - PIN 1 — a readable seed key and token field are requested; a DENIED one
 *    named the same way is not.
 *  - PIN 1 CONTROL — the same list with the denial lifted requests it, so the
 *    absence in PIN 1 is a reading of the gate, not of a harvest that never
 *    produced the name.
 *
 * The provider is the real `PermissionProvider`, as in
 * `RelatedList.selectFls-10186.test.tsx`, whose harness this mirrors.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RelatedList } from '../RelatedList';

/** Desktop, pinned rather than inherited (objectui#8399): below 768 it renders a gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** The data-table node is not under test; stub the renderer it goes through. */
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, SchemaRenderer: () => null };
});

const OBJECT = 'team_member';

const fields: Record<string, unknown> = {
  name: { type: 'text', label: 'Name' },
  team_id: { type: 'text', label: 'Team' },
  user_id: { type: 'text', label: 'User' },
  // The PARENT relationship — drawn by nobody.
  org_id: { type: 'text', label: 'Organization' },
};

/** The slice of a row fetch's params this file reads. */
type FetchParams = { $select?: string[] };

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields })),
  find: vi.fn(async (_api: string, _params?: FetchParams) => ({
    data: [{ id: 'tm_1', name: 'Ada', team_id: 'team_42', user_id: 'user_7', org_id: 'org_1' }],
    total: 1,
  })),
});

const roles: RoleDefinition[] = [{ name: 'staff', label: 'Staff' }];
const denying = (...denied: string[]): ObjectPermissionConfig[] => [
  {
    object: OBJECT,
    roles: {
      staff: {
        actions: ['read'],
        fieldPermissions: denied.map((field) => ({ field, read: false })),
      },
    },
  },
];

/**
 * `team_id` is named by a `defaultFromRow` param, `user_id` by BOTH a param and a
 * `target` token — the field the policy below denies.
 */
const REMOVE_TEAM_MEMBER = {
  name: 'remove_team_member',
  label: 'Remove from Team',
  type: 'api',
  locations: ['list_item'],
  target: '/api/v1/teams/{team_id}/members/{user_id}',
  params: [
    { name: 'teamId', field: 'team_id', required: true, defaultFromRow: true },
    { name: 'userId', field: 'user_id', required: true, defaultFromRow: true },
  ],
};

const renderList = (ds: ReturnType<typeof makeDataSource>, permissions: ObjectPermissionConfig[]) =>
  render(
    <PermissionProvider roles={roles} permissions={permissions} userRoles={['staff']}>
      <RelatedList
        title="Members"
        type="table"
        api={OBJECT}
        objectName={OBJECT}
        referenceField="org_id"
        parentId="org_1"
        dataSource={ds as never}
        columns={['name']}
        rowActions={[REMOVE_TEAM_MEMBER] as never}
        onRowAction={() => {}}
      />
    </PermissionProvider>,
  );

/** The params of every row fetch this list sent for its own collection. */
const rowFetches = (ds: ReturnType<typeof makeDataSource>): FetchParams[] =>
  ds.find.mock.calls
    .filter(([api]) => api === OBJECT)
    .map(([, params]) => params ?? {});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('RelatedList row fetch — `defaultFromRow` / `target` keys ride the projection, behind FLS (objectui#10277)', () => {
  it('PIN 1: a readable seed key is requested; a denied one named by a param and a token is not', async () => {
    const ds = makeDataSource();
    renderList(ds, denying('user_id'));

    // The keys can only be validated once the child schema has landed, so they
    // arrive on a LATER fetch — the one the projection's own key causes.
    await waitFor(() =>
      expect(rowFetches(ds).some((p) => (p.$select ?? []).includes('team_id'))).toBe(true),
    );
    for (const params of rowFetches(ds)) expect(params.$select).not.toContain('user_id');
    expect(rowFetches(ds).at(-1)!.$select).toEqual(['id', 'name', 'team_id']);
  });

  it('PIN 1 CONTROL: with the denial lifted the same key is requested', async () => {
    const ds = makeDataSource();
    renderList(ds, denying());

    await waitFor(() =>
      expect(rowFetches(ds).some((p) => (p.$select ?? []).includes('user_id'))).toBe(true),
    );
    expect(rowFetches(ds).at(-1)!.$select).toEqual(['id', 'name', 'team_id', 'user_id']);
  });
});
