/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ListViewSchema } from '@object-ui/types';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

/**
 * Negative tests for ListView FLS — when the current user lacks read
 * permission on a column, it must disappear from the rendered table
 * (and, by extension, from the hide-fields popover, the filter
 * builder, and any $select that flows to the data source).
 *
 * We assert against the `$select` arg passed to dataSource.find rather
 * than rendered DOM text: the DOM depends on which list renderer is
 * registered (which varies between isolated `--filter` test runs and
 * the root `vitest run --coverage` combined run where other packages
 * register table renderers), but the $select contract is invariant.
 */

// Every grant this role uses comes from the `ObjectPermissionConfig` below —
// the only wired home for role grants. (`RoleDefinition` used to require a
// second, never-read `permissions` array; retired in objectui#4288.)
const roles: RoleDefinition[] = [
  { name: 'restricted', label: 'Restricted', description: 'denies one field' },
];

function makeRestrictedConfig(deniedField: string): ObjectPermissionConfig {
  return {
    object: 'account',
    roles: {
      restricted: {
        // `actions` is the declared channel for a role's object-level grants and
        // the only one `evaluatePermission` reads. This entry used to spell them
        // `objectPermissions: { read: true, … }` beside a `roleName` echo of its
        // own map key — neither key exists on
        // `ObjectPermissionConfig['roles'][string]`, so both were inert and the
        // role granted nothing at all. The rewrite says what the old shape
        // meant: read allowed, no writes.
        //
        // No assertion moves. The field gate these cases exercise runs through
        // `checkField`, which reads `fieldPermissions` directly and never
        // consults `actions`, so they were testing what they claim even while
        // the object grant was empty.
        actions: ['read'],
        fieldPermissions: [{ field: deniedField, read: false, write: false }],
      },
    },
  };
}

const mockDataSource = {
  find: vi.fn().mockResolvedValue([
    { id: 'A1', name: 'Acme Co', annual_revenue: 1_000_000, industry: 'Tech' },
    { id: 'A2', name: 'Globex',  annual_revenue: 500_000,    industry: 'Energy' },
  ]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  fields: ['name', 'industry', 'annual_revenue'],
};

function renderRestricted(deniedField: string) {
  return render(
    <SchemaRendererProvider dataSource={mockDataSource as any}>
      <PermissionProvider
        roles={roles}
        permissions={[makeRestrictedConfig(deniedField)]}
        userRoles={['restricted']}
      >
        <ListView schema={schema} dataSource={mockDataSource as any} />
      </PermissionProvider>
    </SchemaRendererProvider>,
  );
}

/** Pull the most-recent $select that ListView projected to the data source. */
function lastSelect(): string[] | undefined {
  const calls = mockDataSource.find.mock.calls;
  if (calls.length === 0) return undefined;
  const lastArgs = calls[calls.length - 1]?.[1];
  return lastArgs?.$select as string[] | undefined;
}

describe('ListView – field-level permission gating (negative)', () => {
  beforeEach(() => {
    mockDataSource.find.mockClear();
  });

  it('drops the denied column from the $select projection', async () => {
    renderRestricted('annual_revenue');
    await waitFor(() => {
      expect(mockDataSource.find).toHaveBeenCalled();
    });
    const select = lastSelect();
    // ListView always projects an explicit $select for trimmed payloads;
    // permission gating must remove the denied field from it.
    expect(select).toBeDefined();
    expect(select).not.toContain('annual_revenue');
    expect(select).toEqual(expect.arrayContaining(['industry', 'name']));
  });

  it('does not leak the denied value into any rendered cell', async () => {
    const { container } = renderRestricted('annual_revenue');
    await waitFor(() => {
      expect(mockDataSource.find).toHaveBeenCalled();
    });
    expect(container.textContent).not.toMatch(/1,000,000|1000000|500,000|500000/);
  });

  it('keeps the denied column in $select when no PermissionProvider is mounted', async () => {
    render(
      <SchemaRendererProvider dataSource={mockDataSource as any}>
        <ListView schema={schema} dataSource={mockDataSource as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(mockDataSource.find).toHaveBeenCalled();
    });
    const select = lastSelect();
    expect(select).toBeDefined();
    expect(select).toContain('annual_revenue');
  });
});

/**
 * [#4096] The NON-grid bulk bar (kanban / calendar / gallery / …), which
 * ListView renders itself — the grid path delegates to ObjectGrid, which gates
 * its own.
 *
 * The built-in `delete` entry used to be gated on the object's resolved delete
 * affordance alone: the ADR-0103 bucket ∧ `userActions.delete` ∧ the server's
 * `apiOperations`. All three describe the OBJECT. `apiOperations` in particular
 * is byte-identical across accounts with opposite write grants, so the most
 * destructive control on a board stayed visible for a principal with no
 * `allowDelete` — the same defect the main list's row kebab carried. It now
 * also ANDs `can(obj, 'delete')`.
 *
 * Both directions plus the no-provider fail-open are pinned here.
 */
function makeObjectPermissions(allowDelete: boolean): ObjectPermissionConfig {
  return {
    object: 'account',
    roles: {
      restricted: {
        // `evaluatePermission` reads the role's `actions` list, so the grant
        // has to live there. The `roleName` echo of the map key and the
        // `objectPermissions` block that used to sit beside it are gone: neither
        // is declared on `ObjectPermissionConfig['roles'][string]`, so neither
        // was ever read. The comment they carried — that `objectPermissions`
        // "drives the field-level gate" — was wrong twice over: that gate is
        // `checkField`, it reads `fieldPermissions`, and this fixture declares
        // none, so the block decided nothing here at all.
        actions: allowDelete ? ['read', 'delete'] : ['read'],
      },
    },
  };
}

const galleryBulkSchema: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'gallery',
  fields: ['name', 'industry'],
  bulkActions: ['delete', 'archive'] as any,
};

/**
 * Stand in for the gallery renderer and select a row as soon as it mounts —
 * the bulk bar only renders with a non-empty selection, and driving the real
 * gallery's selection UI would couple this permission assertion to that
 * component's markup.
 */
function registerSelectingGallery() {
  ComponentRegistry.register('object-gallery', (props: any) => {
    const onRowSelect = props.onRowSelect;
    React.useEffect(() => {
      onRowSelect?.([{ id: 'A1', name: 'Acme Co' }]);
    }, [onRowSelect]);
    return <div data-testid="gallery-stub" />;
  });
}

/**
 * The gallery's data source also serves the object, which declares `archive`:
 * the non-grid bar draws a bare `bulkActions` name only when the object
 * declares it (objectstack#30394), so without the declaration the
 * non-delete control below would have nothing to draw.
 */
const galleryDataSource = {
  ...mockDataSource,
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'account',
    fields: { name: { type: 'text' }, industry: { type: 'text' } },
    actions: [{ name: 'archive', label: 'Archive' }],
  }),
};

/** `permissions: null` renders with NO PermissionProvider at all. */
function renderGalleryBulk(permissions: ObjectPermissionConfig | null) {
  const view = <ListView schema={galleryBulkSchema} dataSource={galleryDataSource as any} />;
  return render(
    <SchemaRendererProvider dataSource={galleryDataSource as any}>
      {permissions
        ? (
          <PermissionProvider roles={roles} permissions={[permissions]} userRoles={['restricted']}>
            {view}
          </PermissionProvider>
        )
        : view}
    </SchemaRendererProvider>,
  );
}

describe('ListView – non-grid bulk delete vs the principal permission gate (#4096)', () => {
  let prevGallery: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    mockDataSource.find.mockClear();
    prevGallery = ComponentRegistry.get('object-gallery');
    registerSelectingGallery();
  });

  afterEach(() => {
    cleanup();
    if (prevGallery) ComponentRegistry.register('object-gallery', prevGallery);
    else ComponentRegistry.unregister('object-gallery');
  });

  it('a principal WITH allowDelete keeps the bulk delete button', async () => {
    renderGalleryBulk(makeObjectPermissions(true));
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeNull();
  });

  it('a principal WITHOUT allowDelete loses it, and keeps the non-delete actions', async () => {
    renderGalleryBulk(makeObjectPermissions(false));
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-delete')).toBeNull();
    // Control group: proves the bar rendered and the probe can observe a
    // surviving entry, so the absence above is not a false positive. Custom
    // ids route through the action runner with their own gates.
    expect(screen.queryByTestId('bulk-action-archive')).not.toBeNull();
  });

  it('with NO PermissionProvider the bulk delete survives (fail-open preserved)', async () => {
    renderGalleryBulk(null);
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeNull();
  });
});

/**
 * [#4647] The grid's in-place editing — the permission gate it never had, and
 * the declared switch nothing read — on the `editable` the list hands its grid.
 *
 * Since objectstack#35684 there is no inline-edit mode and no toggle: the grid
 * IS editable wherever the principal may update the object and the view does
 * not declare `userActions.editInline: false` (read with the v18 default, on —
 * objectstack#22605), and a view's stored `inlineEdit` reaches the switch
 * through the fold (objectui#5144). These cases were the toggle's; each now
 * reads the grid's `editable`, and the toggle's absence is pinned on both
 * toolbars.
 */
function makeUpdatePermissions(allowUpdate: boolean): ObjectPermissionConfig {
  return {
    object: 'account',
    roles: {
      restricted: {
        actions: allowUpdate ? ['read', 'update'] : ['read'],
      },
    },
  };
}

const inlineEditSchema: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'industry'],
};

function registerRecordingGrid() {
  ComponentRegistry.register('object-grid', (props: any) => (
    <div data-testid="grid-stub">{String(!!props.editable)}</div>
  ));
}

const OPTED_OUT = { userActions: { editInline: false } } as Partial<ListViewSchema>;

/** `permissions: null` renders with NO PermissionProvider at all. */
function renderInlineEdit(permissions: ObjectPermissionConfig | null, schemaOverride?: Partial<ListViewSchema>) {
  const view = (
    <ListView
      schema={{ compactToolbar: false, ...inlineEditSchema, ...schemaOverride } as ListViewSchema}
      dataSource={mockDataSource as any}
    />
  );
  return render(
    <SchemaRendererProvider dataSource={mockDataSource as any}>
      {permissions
        ? (
          <PermissionProvider roles={roles} permissions={[permissions]} userRoles={['restricted']}>
            {view}
          </PermissionProvider>
        )
        : view}
    </SchemaRendererProvider>,
  );
}

/** The grid's `editable`, once the list has drawn it. */
async function gridEditable(): Promise<string> {
  await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
  return screen.getByTestId('grid-stub').textContent ?? '';
}

describe('ListView – the grid edits in place under the permission gate and the declared switch (#4647, objectstack#35684)', () => {
  let prevGrid: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    mockDataSource.find.mockClear();
    prevGrid = ComponentRegistry.get('object-grid');
    registerRecordingGrid();
  });

  afterEach(() => {
    cleanup();
    if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  it.each([
    ['a principal WITH update, on a view that declares nothing', makeUpdatePermissions(true), {}, 'true'],
    ['a principal WITHOUT update, on the same view', makeUpdatePermissions(false), {}, 'false'],
    ['NO PermissionProvider (fail-open preserved)', null, {}, 'true'],
    ['a read-only principal on a stored inlineEdit:true view', makeUpdatePermissions(false), { inlineEdit: true }, 'false'],
    ['a permitted principal on that stored view', makeUpdatePermissions(true), { inlineEdit: true }, 'true'],
    ['`editInline: false` for a fully-permitted principal', makeUpdatePermissions(true), OPTED_OUT, 'false'],
    ['`editInline: false` over a stored inlineEdit:true', makeUpdatePermissions(true), { inlineEdit: true, userActions: { editInline: false } }, 'false'],
    ['`editInline: true`', makeUpdatePermissions(true), { userActions: { editInline: true } }, 'true'],
    ['an ABSENT editInline (the v18 default, on)', makeUpdatePermissions(true), { userActions: { search: false } }, 'true'],
    ['a stored `inlineEdit: false` (folded, off)', makeUpdatePermissions(true), { inlineEdit: false }, 'false'],
    ['`editInline: true` over a stored `inlineEdit: false`', makeUpdatePermissions(true), { inlineEdit: false, userActions: { editInline: true } }, 'true'],
  ] as const)('%s: editable = %s', async (_label, permissions, override, expected) => {
    renderInlineEdit(permissions, override as Partial<ListViewSchema>);
    expect(await gridEditable()).toBe(expected);
  });

  it('draws no inline-edit toggle on the wide toolbar, nor in the Display menu of the compact one', async () => {
    renderInlineEdit(makeUpdatePermissions(true), { inlineEdit: true } as Partial<ListViewSchema>);
    expect(await gridEditable()).toBe('true');
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
    cleanup();
    renderInlineEdit(makeUpdatePermissions(true), { compactToolbar: true, inlineEdit: true } as Partial<ListViewSchema>);
    await gridEditable();
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const content = await screen.findByTestId('view-settings-content');
    fireEvent.click(within(content).getByTestId('options-row-more'));
    await within(content).findByTestId('options-page-more');
    expect(within(content).queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });
});
