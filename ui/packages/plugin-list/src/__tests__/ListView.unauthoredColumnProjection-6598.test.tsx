/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * "The author declared no columns" must not reach the child grid spelled as
 * "the author declared exactly zero columns" (objectui#6598).
 *
 * ## The defect this pins
 *
 * A production `kind:'html'` page carried `<list-view objectName="opportunity">`
 * with no `columns`, and rendered the row count, the filter/group/sort toolbar
 * and the index column — and NOT ONE data column, with no diagnostic anywhere.
 * `ObjectGrid` has a default-columns derivation for exactly that case ("Default
 * columns priority (when schema doesn't specify columns)"), and it never ran:
 * the derivation is gated on `schema.fields` being ABSENT, ListView sent
 * `fields: []`, and an empty array is truthy. `normalizeColumns` had already
 * read the empty `columns` as unauthored — so the two keys disagreed about the
 * same fact and the stricter reading won.
 *
 * The single-variable measurement that isolated it: a bare
 * `<object-grid objectName="opportunity" />` on the same tier, same page kind,
 * same data source renders the object's default columns; the same object behind
 * `<list-view>` renders none. The only difference is this handoff.
 *
 * ## Why the FLS case is here and not in the permissions file
 *
 * `effectiveFields` is `[]` for two reasons that must NOT be handed down the
 * same way, and only one of them is "unauthored". When the author DID declare
 * columns and the field gate removed every one of them, the empty projection is
 * the answer and has to survive: falling through to the derivation there would
 * put fields on screen that the author never asked for. That is why the
 * predicate reads the AUTHORED value and never what survived filtering — and
 * why it is pinned next to the case it would otherwise be "simplified" into.
 *
 * ⭐ The reason is NOT "the grid would not re-check". It used to be: before
 * objectui#6799 `ObjectGrid` re-applied FLS on its derived path only, so a
 * fall-through here escaped the field gate outright. objectui#6799 closed that
 * — all three of the grid's default paths re-check now — and this pin is
 * deliberately UNCHANGED, because what it protects is AUTHORING INTENT. The
 * object's default columns are not the author's projection whether or not they
 * are FLS-checked on the way out.
 *
 * plugin-grid is not a dependency of plugin-list (avoids a cycle), so — as in
 * `ListView.findParamsHandoff.test.tsx` — a stub `object-grid` records what
 * ListView feeds it. The end-to-end half, through the REAL grid on a real
 * html-kind page, is `htmlTierListViewDefaultColumns-6598.test.tsx`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ListViewSchema, ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'opportunity';

let lastGridProps: any = null;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({
      data: [
        { id: 'o-1', name: 'Acme expansion', amount: 1000 },
        { id: 'o-2', name: 'Globex renewal', amount: 2000 },
      ],
      total: 2,
      hasMore: false,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Opportunity Name' },
        amount: { type: 'currency', label: 'Amount' },
      },
    }),
  } as any;
}

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, ...over }) as unknown as ListViewSchema;

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

/**
 * What the child block actually reads.
 *
 * `SchemaRenderer` hands a registered component its schema AND spreads the
 * schema's keys as props, and `ObjectGrid` reads the `schema` one — so the
 * assertions below read it too rather than the spread, which is the copy that
 * would still agree if the two ever diverged. `expect(gridSchema()).toBeTruthy()`
 * in every case is the accessor's own positive control: without it a renamed
 * prop would make every `toBeUndefined()` below pass while measuring nothing.
 */
const gridSchema = () => lastGridProps?.schema;

async function renderList(schema: ListViewSchema, wrap?: (el: React.ReactElement) => React.ReactElement) {
  const ds = makeDataSource();
  const inner = <ListView schema={schema} dataSource={ds} />;
  render(
    <SchemaRendererProvider dataSource={ds}>{wrap ? wrap(inner) : inner}</SchemaRendererProvider>,
  );
  await waitFor(() => expect(lastGridProps).toBeTruthy());
  return ds;
}

describe('ListView → object-grid: the unauthored column projection (#6598)', () => {
  it('sends NO projection when the author declared no columns', async () => {
    await renderList(listSchema());

    // Both keys, because the grid reads both and either one alone re-pins the
    // projection at zero: `columns` feeds `normalizeColumns`, `fields` gates the
    // default-columns derivation.
    expect(gridSchema()).toBeTruthy();
    expect(gridSchema().columns).toBeUndefined();
    expect(gridSchema().fields).toBeUndefined();
  });

  it('treats an empty `columns` as unauthored too', async () => {
    // The same rule `ElementDataSourceGate`'s precedence table states ("an empty
    // `columns` counts as unauthored") and `normalizeColumns` already applies.
    await renderList(listSchema({ columns: [] }));

    expect(gridSchema()).toBeTruthy();
    expect(gridSchema().columns).toBeUndefined();
    expect(gridSchema().fields).toBeUndefined();
  });

  it('sends exactly the authored projection when the author declared one', async () => {
    // The positive control for the two zeros above: this handoff does arrive,
    // so their `undefined` is a decision and not a dead render path.
    await renderList(listSchema({ columns: ['name', 'amount'] }));

    expect(gridSchema()).toBeTruthy();
    expect(gridSchema().columns).toEqual(['name', 'amount']);
    expect(gridSchema().fields).toEqual(['name', 'amount']);
  });

  it('still sends an EMPTY projection when the field gate removed every authored column', async () => {
    const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];
    const permissions: ObjectPermissionConfig[] = [
      {
        object: OBJECT,
        roles: {
          restricted: {
            actions: ['read'],
            fieldPermissions: [
              { field: 'name', read: false, write: false },
              { field: 'amount', read: false, write: false },
            ],
          },
        },
      },
    ];

    await renderList(listSchema({ columns: ['name', 'amount'] }), (el) => (
      <PermissionProvider roles={roles} permissions={permissions} userRoles={['restricted']}>
        {el}
      </PermissionProvider>
    ));

    // NOT `undefined`. The author declared a projection; every column of it was
    // denied. Handing the grid "unauthored" here would run its derivation and
    // put the object's OTHER fields on screen — fields the author never
    // declared. (Before objectui#6799 that was ALSO a widening past the field
    // gate, because the grid's explicit-columns path did not re-check. It does
    // now; the assertion is unchanged, because authoring intent is the reason.)
    expect(gridSchema()).toBeTruthy();
    expect(gridSchema().columns).toEqual([]);
    expect(gridSchema().fields).toEqual([]);
  });
});
