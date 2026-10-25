/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ObjectGrid column identity (objectui#3104 PR2).
 *
 * ObjectGrid is NOT downstream of `normalizeListViewSchema` when it is rendered
 * on its own — a page can author an `object-grid` node directly, and then no
 * ingestion fold has run over its `columns`. So the chokepoint from PR1 does
 * not cover this surface; converging the reads onto `columnIdentity()` is what
 * does.
 *
 * The bug: `getSelectFields` resolved `c.field` alone while the `ensureId`
 * probe one line above resolved `f?.name || f?.field`. A legacy `{ name }`
 * column was therefore projected as `undefined` — it reached `$select` as a
 * hole, so the server never returned the field and every cell in that column
 * came back empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';

const makeDataSource = () => ({
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
    name: 'contacts',
    fields: {
      name: { type: 'text' },
      account: { type: 'lookup', reference: 'accounts' },
    },
  }),
});

const selectFor = async (columns: unknown[]) => {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: 'contacts',
    columns,
  };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
};

describe('ObjectGrid — $select resolves one column identity (#3104)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projects a spec-canonical `field` column', async () => {
    expect(await selectFor([{ field: 'account' }])).toContain('account');
  });

  it('projects a legacy `name`-only column instead of a hole', async () => {
    // Before the convergence this landed in `$select` as `undefined`.
    const select = await selectFor([{ name: 'account' }]);
    expect(select).toContain('account');
    expect(select).not.toContain(undefined);
  });

  it('projects the canonical key when a column carries both', async () => {
    const select = await selectFor([{ field: 'account', name: 'account_name' }]);
    expect(select).toContain('account');
    expect(select).not.toContain('account_name');
  });

  it('still projects bare string columns', async () => {
    expect(await selectFor(['account'])).toContain('account');
  });

  it('always includes `id` so row navigation can resolve the record key', async () => {
    expect(await selectFor([{ name: 'account' }])).toContain('id');
  });
});
