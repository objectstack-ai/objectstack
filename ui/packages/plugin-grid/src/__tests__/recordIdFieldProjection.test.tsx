/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `recordIdField` is part of a view's field appetite (objectstack#8018).
 *
 * The grid projects what it DISPLAYS plus what its PREDICATES read
 * (objectui#3501). An action's `recordIdField` is neither: it names the row key
 * whose VALUE the action runtime sends as `recordIdParam`. So an action keyed on
 * anything other than a listView column asked the server for every field except
 * the one identifying the record it acts on — the row arrived without the key,
 * the runtime read `undefined`, and the injection was silently skipped.
 *
 * That is a class, not an instance: any object may declare it, and the failure
 * shape is a mutation that reports success while naming no record. This file
 * pins the projection half — the harvest — on both routes a `recordIdField`
 * reaches the grid: the object's own `actions`, and the view's `rowActionDefs` /
 * `bulkActionDefs`.
 *
 * The guard it inherits from the predicate harvest is deliberate: a
 * `recordIdField` naming a field the object does not declare is DROPPED rather
 * than projected. An unknown key in `$select` is not ignored by every backend
 * (the cloud multi-tenant runtime answers with an empty result set), so a typo'd
 * declaration must not be able to zero the whole list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';

const OBJECT_FIELDS = {
  name: { type: 'text' },
  status: { type: 'select' },
  // The key an action identifies the record by, deliberately NOT a column below
  // — this is the whole shape of the defect.
  token: { type: 'text' },
};

const makeDataSource = (actions?: unknown[]) => ({
  // `ObjectGrid` reads `result.data` for rows and `result.total` for the
  // match count (ObjectGrid.tsx). This double used to answer
  // `{ value: [], '@odata.count': 0 }` — neither key is read, so it read as
  // though it supplied rows while supplying none. Inert only while the array
  // was empty; the first person to put a row in it would have been handed
  // zero silently (objectui#6917).
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'sessions',
    fields: OBJECT_FIELDS,
    ...(actions ? { actions } : {}),
  }),
});

/** Render a grid showing only `name` and return the `$select` it asked for. */
const selectFor = async (
  schemaExtra: Record<string, unknown>,
  objectActions?: unknown[],
): Promise<string[]> => {
  const ds = makeDataSource(objectActions);
  const schema: any = {
    type: 'object-grid',
    objectName: 'sessions',
    columns: ['name'],
    ...schemaExtra,
  };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
};

const REVOKE = {
  name: 'revoke_session',
  label: 'Revoke Session',
  type: 'api',
  locations: ['list_item'],
  target: '/api/v1/auth/revoke-session',
  recordIdParam: 'token',
  recordIdField: 'token',
};

describe('ObjectGrid — $select harvests every declared `recordIdField` (objectstack#8018)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("projects an object action's `recordIdField` that no column shows", async () => {
    const select = await selectFor({}, [REVOKE]);
    expect(select).toContain('token');
    // The columns and `id` are still there — the harvest ADDS, it never replaces.
    expect(select).toContain('name');
    expect(select).toContain('id');
  });

  it("projects a view `rowActionDefs` entry's `recordIdField`", async () => {
    const select = await selectFor({ rowActionDefs: [REVOKE] });
    expect(select).toContain('token');
  });

  it("projects a view `bulkActionDefs` entry's `recordIdField`", async () => {
    const select = await selectFor({
      bulkActionDefs: [{ ...REVOKE, locations: ['list_toolbar'] }],
    });
    expect(select).toContain('token');
  });

  it('drops a `recordIdField` the object does not declare, rather than poisoning `$select`', async () => {
    const select = await selectFor({}, [{ ...REVOKE, recordIdField: 'toekn' }]);
    expect(select).not.toContain('toekn');
    expect(select).toContain('name');
  });

  it('adds nothing when the action keys off the default `id`', async () => {
    const select = await selectFor({}, [{ ...REVOKE, recordIdField: undefined }]);
    expect(select).toEqual(['id', 'name']);
  });

  it('projects the key once when it is also a column', async () => {
    const select = await selectFor({ columns: ['name', 'token'] }, [REVOKE]);
    expect(select.filter((f) => f === 'token')).toHaveLength(1);
  });
});
