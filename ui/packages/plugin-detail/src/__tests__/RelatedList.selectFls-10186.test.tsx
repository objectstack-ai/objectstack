/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10186 — `RelatedList`'s row fetch sends a `$select` projected by
 * field-level security, the select half of objectui#6898 that this surface
 * never had (it gained the `$expand` half in objectui#10112).
 *
 * ## What is red on `main`, and why
 *
 * `main` sends NO projection at all, so a field the principal cannot read is
 * requested with every child row and dropped only at the column layer. The
 * first case is the ruling's named probe verbatim: a permissions provider that
 * denies one column, and `dataSource.find` called with a `$select` that
 * excludes it. It is red on `main` because the request carries no `$select`
 * array to read, not because it carries the denied name — the assertion is on
 * the projection existing AND lacking the field.
 *
 * The provider is the real `PermissionProvider`, not a stubbed hook: the
 * ruling names "a permissions provider", and the component reads the policy
 * through `usePermissions()` exactly as it does in the console.
 *
 * ## What each case is for
 *
 *  - PIN 1 — the ruling's probe. Its CONTROL renders the same list with the
 *    denial lifted and must see `salary` requested; without it, "not in
 *    `$select`" is unfalsifiable (an absent field proves nothing until the same
 *    instrument has been seen reporting it).
 *  - PIN 2 — the request and the drawing agree: every column the table draws
 *    is one the request asked for, and the parent key the list never draws is
 *    not asked for. The two sides share one spelling of each gate.
 *  - PIN 3 — an authored list whose every column is denied still projects (to
 *    `id`), instead of reading the emptied list as "no restriction" and asking
 *    for everything — the widening objectui#7215 measured on `$expand`.
 *  - PIN 4 — the fields the ROW PREDICATES read ride along (objectui#3501),
 *    through the same two gates as `ObjectGrid`: declared-or-platform, and FLS
 *    on a declared one. Its fixture has no reference-bearing column, so the
 *    expand key never changes and only the projection's own key can carry
 *    the late-arriving operands onto the wire. PIN 4b repeats the harvest over
 *    the ARRAY-shaped field container, which a Record-only reader would read
 *    as "nothing declared".
 *  - PIN 6 — the mobile card gallery's cover rides along: requested when the
 *    child declares it and FLS allows it (6a), not when denied (6b) or
 *    undeclared (6c), and the cover the gallery node reads is the one the
 *    projection carries (6d).
 *  - PIN 5 — the boundary, GREEN on `main` by design: a list that DERIVES its
 *    columns (no authored `columns`, or redaction emptied them) sends no
 *    projection. Those columns are only known after the fetch, and what that
 *    path should send is the question objectui#10186 left open; this pin makes
 *    any answer to it a deliberate change rather than a side effect.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399): below the 768
 * breakpoint `RelatedList` renders a gallery, and PIN 2 reads table columns.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** Capture the schema `RelatedList` hands to `SchemaRenderer` (the data-table). */
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const OBJECT = 'demo_employee';

const baseFields: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  title: { type: 'text', label: 'Title' },
  salary: { type: 'currency', label: 'Salary' },
  status: { type: 'text', label: 'Status' },
  manager_note: { type: 'text', label: 'Manager note' },
  // The PARENT relationship — drawn by nobody, so requested by nobody.
  department_id: { type: 'text', label: 'Department' },
};

/** A backend that does NOT strip: every stored field comes back, asked or not. */
const storedRow = {
  id: 'emp_1',
  name: 'Ada',
  title: 'Engineer',
  salary: 90000,
  status: 'active',
  manager_note: 'n/a',
  department_id: 'dep_1',
  owner_id: 'usr_1',
};

const makeDataSource = (schema: Record<string, any> = { name: OBJECT, fields: baseFields }) => ({
  getObjectSchema: vi.fn(async () => schema),
  find: vi.fn(async () => ({ data: [storedRow], total: 1 })),
});

const roles: RoleDefinition[] = [{ name: 'staff', label: 'Staff' }];
const denying = (...fields: string[]): ObjectPermissionConfig[] => [
  {
    object: OBJECT,
    roles: {
      staff: {
        actions: ['read'],
        fieldPermissions: fields.map((field) => ({ field, read: false })),
      },
    },
  },
];

type ListProps = Partial<React.ComponentProps<typeof RelatedList>>;

const renderList = (ds: ReturnType<typeof makeDataSource>, permissions: ObjectPermissionConfig[], props: ListProps = {}) =>
  render(
    <PermissionProvider roles={roles} permissions={permissions} userRoles={['staff']}>
      <RelatedList
        title="Employees"
        type="table"
        api={OBJECT}
        objectName={OBJECT}
        referenceField="department_id"
        parentId="dep_1"
        dataSource={ds as any}
        {...props}
      />
    </PermissionProvider>,
  );

/** The params of every row fetch this list sent for its own collection. */
const rowFetches = (ds: ReturnType<typeof makeDataSource>): Record<string, any>[] =>
  ds.find.mock.calls
    .filter(([api]: any[]) => api === OBJECT)
    .map(([, params]: any[]) => params ?? {});

const drawnKeys = (): string[] =>
  (h.schema?.columns ?? []).map((c: any) => c.accessorKey);

/** Readiness: the table has drawn at least one column over fetched rows. */
const tableDrawn = () => (h.schema?.data?.length ?? 0) > 0 && drawnKeys().length > 0;

beforeEach(() => {
  h.schema = null;
});

afterEach(() => {
  cleanup();
});

describe('RelatedList row fetch — `$select` is FLS-projected (objectui#10186)', () => {
  it('PIN 1: a column the principal cannot read is never requested', async () => {
    const ds = makeDataSource();
    renderList(ds, denying('salary'), { columns: ['name', 'salary', 'title'] });
    await waitFor(() => expect(tableDrawn()).toBe(true));

    const fetches = rowFetches(ds);
    expect(fetches.length).toBeGreaterThan(0);
    for (const params of fetches) {
      expect(Array.isArray(params.$select)).toBe(true);
      expect(params.$select).not.toContain('salary');
      expect(params.$select).toEqual(expect.arrayContaining(['id', 'name', 'title']));
    }
  });

  it('PIN 1 CONTROL: the same list with the denial lifted does request the column', async () => {
    const ds = makeDataSource();
    renderList(ds, denying(), { columns: ['name', 'salary', 'title'] });
    await waitFor(() => expect(tableDrawn()).toBe(true));

    const last = rowFetches(ds).at(-1)!;
    expect(last.$select).toEqual(expect.arrayContaining(['id', 'name', 'salary', 'title']));
  });

  it('PIN 2: every drawn column was requested, and the parent key is neither drawn nor requested', async () => {
    const ds = makeDataSource();
    renderList(ds, denying('salary'), { columns: ['name', 'salary', 'department_id', 'title'] });
    await waitFor(() => expect(tableDrawn()).toBe(true));

    const select: string[] = rowFetches(ds).at(-1)!.$select;
    expect(drawnKeys()).toEqual(['name', 'title']);
    for (const key of drawnKeys()) expect(select).toContain(key);
    expect(select).not.toContain('department_id');
    expect(select).not.toContain('salary');
  });

  it('PIN 3: an authored list whose every column is denied projects to `id`, not to everything', async () => {
    const ds = makeDataSource();
    renderList(ds, denying('salary'), { columns: ['salary'] });
    await waitFor(() => expect(rowFetches(ds).length).toBeGreaterThan(0));

    for (const params of rowFetches(ds)) {
      expect(params.$select).toEqual(['id']);
    }
  });

  it('PIN 4: the row predicates’ operands are requested, through the declared-field and FLS gates', async () => {
    const ds = makeDataSource({
      name: OBJECT,
      fields: baseFields,
      // The built-in row Edit override — a per-row CEL predicate the row menu
      // evaluates. `status` is on no column.
      userActions: { edit: { visibleWhen: "record.status != 'terminated'" } },
    });
    renderList(ds, denying('manager_note'), {
      columns: ['name'],
      rowActions: [
        {
          name: 'promote',
          label: 'Promote',
          // `owner_id`: a platform column no object declares — projectable.
          // `manager_note`: declared, but denied by the policy above.
          // `typo_field`: declared nowhere — an unknown `$select` key zeroes
          // the list on backends that reject it.
          visible: "record.owner_id != '' && record.manager_note != '' && record.typo_field != ''",
        } as any,
      ],
      onRowAction: () => {},
    });

    // The operands can only be validated once the child schema has landed, so
    // they arrive on a LATER fetch — which only the projection's key can cause.
    await waitFor(() =>
      expect(rowFetches(ds).some((p) => (p.$select ?? []).includes('status'))).toBe(true),
    );
    const select: string[] = rowFetches(ds).at(-1)!.$select;
    expect(select).toEqual(expect.arrayContaining(['id', 'name', 'status', 'owner_id']));
    expect(select).not.toContain('manager_note');
    expect(select).not.toContain('typo_field');
    expect(rowFetches(ds).every((p) => p.$expand === undefined)).toBe(true);
  });

  it('PIN 4b: the same harvest reads the ARRAY-shaped field container the metadata API also serves', async () => {
    // A reader that knows only the Record shape answers "undeclared" for every
    // name in an array of defs, and would drop `status` from the projection —
    // the row Edit predicate would then fault on the absent key.
    const ds = makeDataSource({
      name: OBJECT,
      fields: Object.entries(baseFields).map(([name, def]) => ({ name, ...def })),
      userActions: { edit: { visibleWhen: "record.status != 'terminated'" } },
    });
    renderList(ds, denying('manager_note'), { columns: ['name'] });

    await waitFor(() =>
      expect(rowFetches(ds).some((p) => (p.$select ?? []).includes('status'))).toBe(true),
    );
    expect(rowFetches(ds).at(-1)!.$select).toEqual(['id', 'name', 'status']);
  });
});

/**
 * The mobile card gallery's cover. Below the breakpoint a grid/table list
 * renders an `object-gallery` whose cards read a cover field that no column
 * shows, so the projection has to carry it — or, on a backend that honours
 * `$select`, every card loses its image. The field reaches the request only
 * after the child schema lands (it must be DECLARED), so each case waits for a
 * later fetch the same way PIN 4 does.
 */
describe('RelatedList row fetch — the mobile gallery cover rides along (objectui#10186)', () => {
  const withImage = { name: OBJECT, fields: { ...baseFields, image: { type: 'image', label: 'Photo' } } };
  const lastSelect = (ds: ReturnType<typeof makeDataSource>): string[] =>
    rowFetches(ds).at(-1)?.$select ?? [];
  /**
   * Readiness for the NEGATIVE cases: the drawn `name` column carries a typed
   * cell, which the column layer attaches only once the child schema is in
   * hand. A projection built from that schema has run its fetch effect by then,
   * so a wrongly admitted cover would already be on a recorded request.
   */
  const schemaLanded = (): boolean =>
    tableDrawn() && typeof (h.schema?.columns ?? []).find((c: any) => c.accessorKey === 'name')?.cell === 'function';

  it('PIN 6a: a declared, readable cover is requested', async () => {
    const ds = makeDataSource(withImage);
    renderList(ds, denying('salary'), { columns: ['name'] });
    await waitFor(() => expect(lastSelect(ds)).toContain('image'));
    expect(lastSelect(ds)).toEqual(['id', 'name', 'image']);
  });

  it('PIN 6b: a declared cover FLS denies is not requested', async () => {
    const ds = makeDataSource(withImage);
    renderList(ds, denying('image'), { columns: ['name'] });
    await waitFor(() => expect(schemaLanded()).toBe(true));
    for (const params of rowFetches(ds)) expect(params.$select).not.toContain('image');
  });

  it('PIN 6c: an undeclared cover is not requested (an unknown key can zero the list)', async () => {
    const ds = makeDataSource();
    renderList(ds, denying(), { columns: ['name'] });
    await waitFor(() => expect(schemaLanded()).toBe(true));
    for (const params of rowFetches(ds)) expect(params.$select).not.toContain('image');
  });

  it('PIN 6d: the cover the mobile gallery reads is the one the projection carries', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    try {
      const ds = makeDataSource(withImage);
      renderList(ds, denying(), { columns: ['name'] });
      await waitFor(() => expect(h.schema?.type).toBe('object-gallery'));
      await waitFor(() => expect(lastSelect(ds)).toContain('image'));
      const cover = h.schema.gallery.coverField;
      expect(typeof cover).toBe('string');
      expect(lastSelect(ds)).toContain(cover);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    }
  });
});

describe('RelatedList row fetch — the derived-columns boundary (objectui#10186)', () => {
  it('PIN 5: no authored columns ⇒ no projection (the field walk decides after the fetch)', async () => {
    const ds = makeDataSource();
    renderList(ds, denying('salary'));
    await waitFor(() => expect(tableDrawn()).toBe(true));

    // The column layer still drops the denied field …
    expect(drawnKeys()).not.toContain('salary');
    // … and the request is the one this component has always sent.
    for (const params of rowFetches(ds)) expect('$select' in params).toBe(false);
  });

  it('PIN 5b: authored columns that redaction empties take the derived path too', async () => {
    const ds = makeDataSource();
    renderList(ds, denying(), { columns: ['salary'], redactFields: ['salary'] });
    await waitFor(() => expect(tableDrawn()).toBe(true));

    expect(drawnKeys()).not.toContain('salary');
    for (const params of rowFetches(ds)) expect('$select' in params).toBe(false);
  });
});
