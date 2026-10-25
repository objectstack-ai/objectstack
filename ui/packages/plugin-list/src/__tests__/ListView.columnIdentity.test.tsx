/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Repro + regression pin for the column-identity dual read (objectui#3104).
 *
 * ListView resolves "which field is this column" TWICE, with two different
 * precedences over the same `schema.columns` array:
 *
 *   request path  — `$expand` and the `$select` projection read `f?.field`
 *                   and ONLY `f?.field` (ListView.tsx, the `expandFields` and
 *                   `selectFields` memos).
 *   render path   — the FLS gate, the hidden-field filter, `fieldOrder`, the
 *                   export column list and the hide-fields popover all read
 *                   `f.name || f.fieldName || f.field` — name FIRST.
 *
 * So one column object can be two different fields at once, and the failure is
 * silent in both directions:
 *
 *   `{ field: 'account', name: 'account_name' }`
 *        → the row fetch asks the server for `account` (+ `$expand=account`)
 *          while the field-level permission check, the export and the
 *          hide-fields list all key off `account_name`.
 *   `{ name: 'account' }`
 *        → the render path shows an `account` column; the request path
 *          resolves `undefined` and DROPS it, so neither `$select` nor
 *          `$expand` carries it. The column renders with nothing behind it —
 *          this is the "relation column shows a bare id" defect class.
 *
 * `checkField` is the sharpest observable available: BOTH paths call it (the
 * render path from `effectiveFields`, the request path from `selectFields`),
 * so a column whose two keys disagree makes the same column check two
 * different field names. One column must produce exactly one identity.
 *
 * If this fails: do not add another `?? name` at the failing read site. The
 * fold lives in `normalizeColumnIdentity` (`@object-ui/core`), wired into
 * `normalizeListViewSchema` at ListView's component boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

// `vi.mock` is hoisted above this file's imports, so the spy it closes over has
// to be hoisted too.
const { checkField } = vi.hoisted(() => ({ checkField: vi.fn(() => true) }));

// ListView's FLS gate is skipped entirely unless permissions report `isLoaded`,
// and the real provider needs role metadata we have no reason to model here.
// Mocking just `usePermissions` turns the gate on and makes every identity it
// resolves observable, while leaving the rest of the package intact.
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      systemPermissions: [],
      hasCapabilities: () => true,
      isLoaded: true,
      can: () => true,
      cannot: () => false,
    }),
  };
});

/** `account` is a lookup, so a correctly-resolved column also drives `$expand`. */
const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
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

const renderList = async (columns: unknown[]) => {
  const ds = makeDataSource();
  const schema = {
    type: 'list-view',
    objectName: 'contacts',
    viewType: 'grid',
    columns,
  } as unknown as ListViewSchema;

  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );

  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  const params = ds.find.mock.calls.at(-1)?.[1] ?? {};
  return {
    select: (params.$select ?? []) as string[],
    expand: (params.$expand ?? []) as string[],
    /** Every distinct field name either path resolved for the account column. */
    checkedIdentities: new Set(
      checkField.mock.calls
        .map((call) => (call as unknown as unknown[])[1] as string)
        .filter((f) => typeof f === 'string' && f.startsWith('account')),
    ),
  };
};

describe('ListView — column identity is resolved once (#3104)', () => {
  beforeEach(() => {
    checkField.mockClear();
  });

  it('resolves ONE identity when a column carries both `field` and `name`', async () => {
    // The spec's canonical key is `field` (`ListColumnSchema` declares it as the
    // only required key and has no `name` at all), so `account` must win and
    // `account_name` must appear nowhere.
    const { select, expand, checkedIdentities } = await renderList([
      { field: 'account', name: 'account_name', label: 'Account' },
    ]);

    expect(select).toContain('account');
    expect(expand).toContain('account');
    // The render path used to key off `account_name` here while the request
    // asked for `account` — one column, two fields.
    expect(checkedIdentities).toEqual(new Set(['account']));
    expect(select).not.toContain('account_name');
    expect(expand).not.toContain('account_name');
  });

  it('requests a legacy `name`-only column instead of silently dropping it', async () => {
    // The bare-id defect: the render path shows the column, the request path
    // resolved `undefined` and filtered it out, so the row arrived without the
    // field and without the expanded relation.
    const { select, expand, checkedIdentities } = await renderList([
      { name: 'account', label: 'Account' },
    ]);

    expect(select).toContain('account');
    expect(expand).toContain('account');
    expect(checkedIdentities).toEqual(new Set(['account']));
  });

  it('leaves a spec-canonical column exactly as it was', async () => {
    const { select, expand, checkedIdentities } = await renderList([
      { field: 'account', label: 'Account' },
    ]);

    expect(select).toContain('account');
    expect(expand).toContain('account');
    expect(checkedIdentities).toEqual(new Set(['account']));
  });

  it('leaves a bare string column exactly as it was', async () => {
    const { select, expand, checkedIdentities } = await renderList(['account']);

    expect(select).toContain('account');
    expect(expand).toContain('account');
    expect(checkedIdentities).toEqual(new Set(['account']));
  });
});
