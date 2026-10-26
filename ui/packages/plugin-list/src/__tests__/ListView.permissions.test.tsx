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

/** `permissions: null` renders with NO PermissionProvider at all. */
function renderGalleryBulk(permissions: ObjectPermissionConfig | null) {
  const view = <ListView schema={galleryBulkSchema} dataSource={mockDataSource as any} />;
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
 * [#4647] The grid toolbar's inline-edit affordance — the permission gate it
 * never had, and the declared switch nothing read.
 *
 * ## Gap 1
 *
 * The toggle rendered on "grid view ∧ the host wired `onInlineEditChange` ∧ not
 * the compact toolbar", and every host wires that callback unconditionally. It
 * was the ONE affordance on this toolbar with no permission check: New and
 * Import are hidden for an account without the grant and the bulk-delete entry
 * pinned above ANDs `can(obj, 'delete')`, but a read-only principal could flip
 * inline edit, modify cells and press "Save all" to earn a server 403.
 *
 * ## Gap 2
 *
 * `userActions.editInline` is spec-declared and, on this toolbar, was read by
 * nothing — an author could not switch inline editing off even unconditionally.
 *
 * Three render sites carry the verdict, and all three are pinned: the wide
 * toolbar's toggle, the COMPACT toolbar's popover entry (which had no gate at
 * all, not even the callback), and the `editable` MODE handed to the grid —
 * because a stored view carrying `inlineEdit: true` drops a read-only principal
 * into editable cells with no toggle to press.
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

/** Records the `editable` prop the grid is rendered with. */
let gridEditableCalls: Array<boolean | undefined> = [];

function registerRecordingGrid() {
  ComponentRegistry.register('object-grid', (props: any) => {
    gridEditableCalls.push(props.editable);
    return <div data-testid="grid-stub">{String(!!props.editable)}</div>;
  });
}

/**
 * The author's opt-out (objectui#12086). `userActions.editInline` is read with
 * the v18 spec default, on (objectstack#22605), so a view that declares nothing
 * is offered inline editing wherever the permission gate admits the principal,
 * and `editInline: false` is how a view withdraws it. The permission-gate cases
 * below declare nothing, the shape the acceptance names; each "loses the
 * toggle" case has a permitted twin with the same schema, so the absence reads
 * the gate and not the declared switch.
 */
const OPTED_OUT = { userActions: { editInline: false } } as Partial<ListViewSchema>;

/** `permissions: null` renders with NO PermissionProvider at all. */
function renderInlineEdit(
  permissions: ObjectPermissionConfig | null,
  schemaOverride?: Partial<ListViewSchema>,
  onInlineEditChange: (next: boolean) => void = vi.fn(),
) {
  const view = (
    <ListView
      // objectui#12423 — the WIDE toolbar (its inline-edit button sits in the
      // bar) unless a case asks for the Display form with `compactToolbar: true`.
      schema={{ compactToolbar: false, ...inlineEditSchema, ...schemaOverride } as ListViewSchema}
      dataSource={mockDataSource as any}
      onInlineEditChange={onInlineEditChange}
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

describe('ListView – inline-edit toggle vs the principal permission gate (#4647)', () => {
  let prevGrid: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    mockDataSource.find.mockClear();
    gridEditableCalls = [];
    prevGrid = ComponentRegistry.get('object-grid');
    registerRecordingGrid();
  });

  afterEach(() => {
    cleanup();
    if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  it('a principal WITH update is offered the inline-edit toggle on a view that declares nothing (objectui#12086)', async () => {
    renderInlineEdit(makeUpdatePermissions(true));
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
  });

  it('a principal WITHOUT update loses it, on the same view that declares nothing', async () => {
    renderInlineEdit(makeUpdatePermissions(false));
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });

  it('with NO PermissionProvider the toggle survives (fail-open preserved)', async () => {
    renderInlineEdit(null);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
  });

  it('a read-only principal cannot reach edit MODE through a stored inlineEdit:true view', async () => {
    // The door that stays open if only the toggle is gated: a view can store
    // `inlineEdit: true`, so the mode can be entered with no toggle press at
    // all.
    renderInlineEdit(makeUpdatePermissions(false), { inlineEdit: true } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('false');
    expect(gridEditableCalls.at(-1)).toBeFalsy();
  });

  it('…while a permitted principal keeps that same stored view editable', async () => {
    // Control group: proves the assertion above observes the PERMISSION and not
    // a schema key that stopped being forwarded.
    renderInlineEdit(makeUpdatePermissions(true), { inlineEdit: true } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('true');
  });

  it('the COMPACT toolbar entry is gated too', async () => {
    // `showInlineEdit` on the settings popover was `currentView === 'grid'`
    // alone — it never even required the host callback, so gating only the wide
    // toolbar would have left the affordance reachable on mobile.
    //
    // The panel has to be opened before an absence means anything, or the
    // assertion passes for every input including a completely ungated one: the
    // entry lives inside `PopoverContent`, closed until the trigger is clicked.
    // Since objectui#12423 it is a switch row of the Display panel rather than
    // a collapsible section, so no second layer hides it. The seeded
    // `inlineEdit: true` is the realistic shape of this regression: a stored
    // view already in inline-edit mode, reopened by a principal who has since
    // lost `update`.
    renderInlineEdit(makeUpdatePermissions(false), {
      compactToolbar: true,
      inlineEdit: true,
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    await screen.findByTestId('view-settings-content');
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });

  it('…and a permitted principal keeps that compact entry', async () => {
    // Control group for the case above: same two layers opened the same way,
    // so the absence there is the permission gate and not a collapsed panel.
    renderInlineEdit(makeUpdatePermissions(true), {
      compactToolbar: true,
      inlineEdit: true,
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    await screen.findByTestId('view-settings-content');
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
  });
});

describe('ListView – the declared userActions.editInline switch (#4647 gap 2)', () => {
  let prevGrid: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    mockDataSource.find.mockClear();
    gridEditableCalls = [];
    prevGrid = ComponentRegistry.get('object-grid');
    registerRecordingGrid();
  });

  afterEach(() => {
    cleanup();
    if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  it('`editInline: false` withholds the toggle from a fully-permitted principal', async () => {
    renderInlineEdit(makeUpdatePermissions(true), OPTED_OUT);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });

  it('`editInline: false` also withholds edit MODE from a stored inlineEdit:true view', async () => {
    // objectui#5144: the explicit spec key wins over the stored `inlineEdit`,
    // so the fold leaves `editInline: false` in place. The toggle goes as well.
    renderInlineEdit(makeUpdatePermissions(true), {
      inlineEdit: true,
      userActions: { editInline: false },
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('false');
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });

  it('`editInline: true` offers the toggle', async () => {
    renderInlineEdit(makeUpdatePermissions(true), {
      userActions: { editInline: true },
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
  });

  it('an ABSENT editInline reads ON, the v18 spec default: offered, and the grid opens out of edit mode (objectui#12086)', async () => {
    // This case has pinned three readings. Before objectui#5144 an absent
    // `editInline` deferred to the host channel. objectui#5144 read it with the
    // spec's then `.default(false)`, so a view with neither key was offered no
    // inline editing. The maintainer's v18 ruling (objectstack#22605) flipped
    // the spec default to `true`, so a view with neither key is offered the
    // toggle. The mode is still the view's `inlineEdit`, absent here, so the
    // grid opens out of edit mode. `userActions` carries an unrelated toggle so
    // the block exists and only `editInline` is absent from it.
    renderInlineEdit(makeUpdatePermissions(true), {
      userActions: { search: false },
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('false');
  });

  it('…and the COMPACT entry is offered for an absent editInline too', async () => {
    // The second render site of the same verdict: the Display panel's Edit
    // inline switch (objectui#12423), drawn with `inlineEdit` absent too. It
    // and its control below look for the switch itself.
    renderInlineEdit(makeUpdatePermissions(true), {
      compactToolbar: true,
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const content = await screen.findByTestId('view-settings-content');
    expect(within(content).getByTestId('toolbar-inline-edit-toggle')).toHaveAttribute('role', 'switch');
  });

  it('…control: the same compact popover withholds the entry once the view declares `editInline: false`', async () => {
    renderInlineEdit(makeUpdatePermissions(true), {
      compactToolbar: true,
      ...OPTED_OUT,
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const content = await screen.findByTestId('view-settings-content');
    expect(within(content).queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
  });
});

/**
 * objectui#5144 — a view's stored `inlineEdit`, read through the fold.
 *
 * Stored views carry `inlineEdit` (authored, or written by the console's old
 * toolbar toggle) and no `userActions.editInline`. `normalizeListViewSchema`
 * folds the first into the second, so every case here declares `inlineEdit`
 * and leaves `editInline` out. The fold's own table is pinned in
 * `@object-ui/core`'s `normalize-list-view.inlineEditFold-5144.test.ts`. This
 * block pins what the toolbar does with it.
 *
 * Since triage's ruling E the console no longer persists the toggle, so it
 * writes no new `inlineEdit` (pinned in `@object-ui/app-shell`'s
 * `ObjectView.inlineEditSessionOnly-5144.test.tsx`).
 */
describe('ListView – a stored inlineEdit folds into editInline (objectui#5144)', () => {
  let prevGrid: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    mockDataSource.find.mockClear();
    gridEditableCalls = [];
    prevGrid = ComponentRegistry.get('object-grid');
    registerRecordingGrid();
  });

  afterEach(() => {
    cleanup();
    if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  it('a stored `inlineEdit: true` folds to on: the toggle is offered and the grid opens editable', async () => {
    renderInlineEdit(makeUpdatePermissions(true), { inlineEdit: true } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('true');
  });

  it('a stored `inlineEdit: false` reads off: no toggle and no edit mode', async () => {
    // A recorded cost of triage's ruling E (objectui#5144): a view or overlay
    // the old toolbar toggle left at `inlineEdit: false` stays off. It is
    // existing data, and the maintainer's ruling rejects migrating it. The
    // remedy is declaring `userActions.editInline: true` (the case below).
    renderInlineEdit(makeUpdatePermissions(true), { inlineEdit: false } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).toBeNull();
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('false');
  });

  it('an explicit `editInline: true` wins over a stored `inlineEdit: false`: offered, out of edit mode', async () => {
    // The remedy the changeset names. The explicit spec key keeps the toggle
    // offered, and the stored `inlineEdit` still decides the mode.
    renderInlineEdit(makeUpdatePermissions(true), {
      inlineEdit: false,
      userActions: { editInline: true },
    } as Partial<ListViewSchema>);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('toolbar-inline-edit-toggle')).not.toBeNull();
    expect(screen.getByTestId('grid-stub')).toHaveTextContent('false');
  });

  it('the toggle reports to the host: switching off reports `false` and leaves edit mode', async () => {
    // The toggle flips the session's edit mode and reports it through
    // `onInlineEditChange`. Since ruling E (objectui#5144) the console writes
    // nothing for it, so the next load is seeded from the view's own
    // `inlineEdit` again.
    const onInlineEditChange = vi.fn();
    renderInlineEdit(makeUpdatePermissions(true), { inlineEdit: true } as Partial<ListViewSchema>, onInlineEditChange);
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toHaveTextContent('true'));
    fireEvent.click(screen.getByTestId('toolbar-inline-edit-toggle'));
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toHaveTextContent('false'));
    expect(onInlineEditChange).toHaveBeenCalledTimes(1);
    expect(onInlineEditChange).toHaveBeenLastCalledWith(false);
  });
});
