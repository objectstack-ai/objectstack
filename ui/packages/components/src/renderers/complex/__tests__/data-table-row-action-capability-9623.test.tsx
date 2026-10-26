/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9623 — a row action's `requiredPermissions` was INERT inside a
 * record page's related-list panel, while the SAME declaration gated correctly
 * on `record_header`.
 *
 * The related list feeds a child object's `list_item` actions into this
 * data-table as `rowActionDefs` (`RelatedRecordActionsBridge`), and this
 * renderer filters its own action list instead of routing through
 * `ActionEngine.getActionsForLocation` — so the engine's ADR-0066 D4 gate never
 * reached it. Downstream (cloud#2224) a plain organization member was offered
 * Set as Primary / Verify DNS / Delete on an environment's domain rows and read
 * a red 403 toast on click.
 *
 * ⭐ What this file pins, and why it is written as a mount and not as a unit of
 * `planDataTableRowMenu`: the capability is supplied by the page's
 * `<ActionProvider>` — the same provider the record surface one level up gates
 * off — so the only honest question is whether THIS renderer, mounted under
 * that provider, asks. The first case below reads the resolved set directly at
 * that mount and pins it as `[]`; the defect was never the value failing to
 * arrive.
 *
 * EMPTY vs ABSENT is the axis, and collapsing the two is the defect's twin:
 * `useCapabilityGate` gates normally on an EMPTY held set ("holds nothing") and
 * fails OPEN only on `undefined` ("nobody reported any"). Both directions are
 * asserted, on one and the same mount.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, PredicateScopeProvider, useHeldCapabilities } from '@object-ui/react';
// The renderer under test registers itself as a side effect of this import —
// at module scope, never in a hook, so the cost sits outside every timeout.
import '../data-table';

/**
 * The real declaration from the card: `sys_domain.set_primary`, which names
 * both surfaces and the capability a plain member lacks.
 */
const SET_PRIMARY = {
  name: 'set_primary',
  label: 'Set as Primary',
  requiredPermissions: ['manage_org_users'],
};

/** A sibling with no `requiredPermissions` — the control that must survive. */
const VIEW_DETAILS = { name: 'view_details', label: 'View Details' };

/** The reported sets from the card's `GET /api/v1/auth/me/permissions` reading. */
const OWNER = { id: 'owner', name: 'Olga', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'] };
/** ⭐ EMPTY, not absent — "holds nothing", which gates normally. */
const MEMBER = { id: 'member', name: 'Mel', systemPermissions: [] as string[] };
/** No `systemPermissions` key at all — the unknown case, which fails OPEN. */
const UNREPORTED = { id: 'member', name: 'Mel' };

const ROWS = [{ id: 'd1', name: 'example.com' }];

const BASE_SCHEMA = {
  type: 'data-table',
  pagination: false,
  searchable: false,
  rowActions: true,
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: ROWS,
};

/** Mount exactly as the record page does: the row actions under the page's provider. */
function wrapper(user: unknown) {
  return ({ children }: { children: React.ReactNode }) => (
    <ActionProvider context={{ user } as any}>
      <PredicateScopeProvider scope={{}}>{children}</PredicateScopeProvider>
    </ActionProvider>
  );
}

function renderTable(schema: Record<string, unknown>, user: unknown) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  const Wrapper = wrapper(user);
  return render(
    <Wrapper>
      <DataTable schema={{ ...BASE_SCHEMA, ...schema }} />
    </Wrapper>,
  );
}

/** Every row overflow trigger currently in the document. */
const triggers = () => screen.queryAllByLabelText('Row actions');

/** Radix opens on `pointerdown` and portals on the next tick. */
async function openFirstMenu() {
  fireEvent.pointerDown(triggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

describe('data-table row actions — ADR-0066 D4 capability mirror (objectui#9623)', () => {
  it('resolves the caller capabilities AT THIS MOUNT as EMPTY, not unknown', () => {
    // The card inferred the panel's runtime never carried `systemPermissions`.
    // Measured here on the mount the rows render under: it carries them, and
    // `[]` arrives as `[]`. So the repair is this renderer consulting the gate,
    // not a new binding — nothing has to be threaded anywhere.
    const held = renderHook(() => useHeldCapabilities(), { wrapper: wrapper(MEMBER) }).result.current;
    expect(held).toEqual([]);
    expect(held).not.toBeUndefined();

    const unknown = renderHook(() => useHeldCapabilities(), { wrapper: wrapper(UNREPORTED) }).result.current;
    expect(unknown).toBeUndefined();
  });

  it('hides a row action whose `requiredPermissions` the caller does not hold', async () => {
    renderTable({ rowActionDefs: [SET_PRIMARY], onRowActionDef: () => {} }, MEMBER);
    // Nothing survives the gate, so there is no trigger to open either — the
    // objectui#3562 invariant: the count and the items read ONE source.
    expect(triggers()).toHaveLength(0);
    expect(screen.queryByTestId('row-action-set_primary')).toBeNull();
  });

  it('shows the same action to a caller who holds the capability', async () => {
    renderTable({ rowActionDefs: [SET_PRIMARY], onRowActionDef: () => {} }, OWNER);
    expect(triggers()).toHaveLength(ROWS.length);
    await openFirstMenu();
    expect(await screen.findByTestId('row-action-set_primary')).toBeInTheDocument();
  });

  it('fails OPEN when nothing reported `systemPermissions` (unknown is not denied)', async () => {
    // The doctrine `useCapabilityGate` states, pinned at this surface: hiding a
    // permitted user's button on missing client data is the worse failure, and
    // the server is the authority either way.
    renderTable({ rowActionDefs: [SET_PRIMARY], onRowActionDef: () => {} }, UNREPORTED);
    expect(triggers()).toHaveLength(ROWS.length);
    await openFirstMenu();
    expect(await screen.findByTestId('row-action-set_primary')).toBeInTheDocument();
  });

  it('removes only the gated item, leaving its ungated sibling and the trigger', async () => {
    renderTable({ rowActionDefs: [SET_PRIMARY, VIEW_DETAILS], onRowActionDef: () => {} }, MEMBER);
    expect(triggers()).toHaveLength(ROWS.length);
    await openFirstMenu();
    expect(await screen.findByTestId('row-action-view_details')).toBeInTheDocument();
    expect(screen.queryByTestId('row-action-set_primary')).toBeNull();
  });

  it('leaves an action declaring no capability untouched', async () => {
    renderTable({ rowActionDefs: [VIEW_DETAILS], onRowActionDef: () => {} }, MEMBER);
    expect(triggers()).toHaveLength(ROWS.length);
    await openFirstMenu();
    expect(await screen.findByTestId('row-action-view_details')).toBeInTheDocument();
  });
});
