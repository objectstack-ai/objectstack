/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9782 — the related-list TOOLBAR had no ADR-0066 D4 capability gate.
 *
 * `@objectstack/spec` (`packages/spec/src/ui/action.zod.ts`) declares
 * `requiredPermissions` as "enforced with 403 on the platform action route
 * (script/flow/modal + MCP) and **mirrored as a UI hide**". The header of a
 * related list evaluated only each action's `visible` CEL predicate, so a
 * `list_toolbar` action declaring a capability the caller does not hold
 * rendered anyway — one surface over from `EnvironmentListToolbar`, which
 * filters the same location through `mayInvoke`.
 *
 * ⛔ A UI MIRROR of a decision the SERVER still enforces, and nothing more. The
 * route-side 403 is untouched, no request changes shape, and ⛔ no enforcement
 * moves into the console. The third and last carrier of one declared
 * behaviour, after the data-table row menu (objectui#9623) and
 * `DeclaredActionsBar` (objectui#9572).
 *
 * ## ⭐ What this file pins about PLACEMENT, and why it is a full mount
 *
 * `useCapabilityGate` resolves the held set from the nearest `ActionProvider`
 * ABOVE its caller. objectui#9572 measured the failure that makes this
 * load-bearing: a gate placed on the wrong side of the provider that carries
 * the held set reads a different provider — or none at all — and fails OPEN on
 * every action forever, with a green suite and a rendered button.
 *
 * Measured here rather than assumed: `RelatedList` mounts NO provider of its
 * own (unlike `DeclaredActionsBar`, which mounts one and therefore had to gate
 * from a module-private inner component). Its host chain is
 * `RecordDetailView`'s `ActionProvider` → `RelatedRecordActionsBridge` →
 * `SchemaRenderer` → this component, so the component body and the header
 * buttons it draws read one and the same provider. The gate therefore belongs
 * in the list body, applied ONCE to the set — which is what the first case
 * below measures directly at the mount, and what every case after it exercises
 * by supplying the held set through an `ActionProvider` wrapping `RelatedList`
 * and through NOTHING else. Move the filter to a caller above that provider —
 * or back out to the host bridge — and the DETECTOR case reds.
 *
 * ## EMPTY vs ABSENT is the axis
 *
 * `useCapabilityGate` gates normally on an EMPTY held set ("holds nothing") and
 * fails OPEN only on `undefined` ("nobody reported any"). ⭐ The fail-OPEN arm
 * is the one a careless repair breaks — a gate that collapses `undefined` to
 * `[]` hides a permitted user's button — so it is pinned beside the detector
 * on the same mount, in both directions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider, PredicateScopeProvider, useHeldCapabilities } from '@object-ui/react';
import { RelatedList } from '../RelatedList';

/**
 * Mounted with no `dataSource`, this component takes its legacy raw-URL branch
 * and calls `fetch`. Left real, jsdom dials the origin for a request this file
 * does not care about and fills the console with `ECONNREFUSED` from a passing
 * test. The rows are irrelevant here; the header is not.
 */
let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ json: async () => [] }) as any) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * The live example named on the card and in the component's own docblock:
 * `invite_user` on an organization's Invitations list. `requiredPermissions` is
 * carried through `RelatedRecordActionsBridge.deriveActions` untouched — that
 * bridge filters on `locations` alone and the localizer spreads the rest — so
 * the declaration arrives at this component exactly as authored.
 */
const INVITE = {
  name: 'invite_user',
  label: 'Invite User',
  requiredPermissions: ['manage_org_users'],
};

/** A sibling declaring no capability — the control that must survive the filter. */
const EXPORT = { name: 'export', label: 'Export' };

/** Holds the declared capability. */
const OWNER = { id: 'owner', name: 'Olga', systemPermissions: ['manage_org_users', 'setup.access'] };
/** ⭐ EMPTY, not absent — "holds nothing", which gates normally. */
const MEMBER = { id: 'member', name: 'Mel', systemPermissions: [] as string[] };
/** No `systemPermissions` key at all — the unknown case, which fails OPEN. */
const UNREPORTED = { id: 'member', name: 'Mel' };

/**
 * The held set reaches the list through the `ActionProvider` and through
 * NOTHING else: the predicate scope is deliberately empty, so a gate that ends
 * up reading anything other than this provider resolves `undefined` and fails
 * open — which is exactly how a misplaced gate announces itself here.
 */
function wrapper(user: unknown, scope: Record<string, unknown> = {}) {
  return ({ children }: { children: React.ReactNode }) => (
    <ActionProvider context={{ user } as any}>
      <PredicateScopeProvider scope={scope}>{children}</PredicateScopeProvider>
    </ActionProvider>
  );
}

function renderList(toolbarActions: unknown[], user: unknown, scope: Record<string, unknown> = {}) {
  const Wrapper = wrapper(user, scope);
  return render(
    <Wrapper>
      <RelatedList
        title="Invitations"
        type="table"
        api="sys_invitation"
        objectName="sys_invitation"
        referenceField="organization_id"
        parentId="org_1"
        columns={[{ accessorKey: 'email', header: 'Email' }]}
        toolbarActions={toolbarActions as any}
        onToolbarAction={() => {}}
      />
    </Wrapper>,
  );
}

/** The header button for a `list_toolbar` action, by the component's own testid. */
const toolbarButton = (name: string) => screen.queryByTestId(`related-toolbar-action-${name}`);

/** The list header is async (the fetch branch above settles first). */
const headerReady = () => waitFor(() => expect(screen.getByText('Invitations')).toBeInTheDocument());

describe('RelatedList list_toolbar — ADR-0066 D4 capability mirror (objectui#9782)', () => {
  it('resolves the caller capabilities AT THIS MOUNT, and keeps EMPTY apart from ABSENT', () => {
    // The placement measurement, taken before any rendering claim rests on it:
    // the held set really is reachable from where the list body sits, so the
    // repair is this component consulting the gate — nothing has to be threaded
    // through the bridge, and no new prop is needed.
    const held = renderHook(() => useHeldCapabilities(), { wrapper: wrapper(MEMBER) }).result.current;
    expect(held).toEqual([]);
    expect(held).not.toBeUndefined();

    const unknown = renderHook(() => useHeldCapabilities(), { wrapper: wrapper(UNREPORTED) }).result.current;
    expect(unknown).toBeUndefined();
  });

  it('DETECTOR — hides a toolbar action whose `requiredPermissions` the caller does not hold', async () => {
    renderList([INVITE], MEMBER);
    await headerReady();
    expect(toolbarButton('invite_user')).toBeNull();
    expect(screen.queryByText('Invite User')).toBeNull();
  });

  it('shows the same action to a caller who holds the capability', async () => {
    renderList([INVITE], OWNER);
    await headerReady();
    expect(toolbarButton('invite_user')).toBeInTheDocument();
  });

  it('fails OPEN when nothing reported `systemPermissions` (unknown is not denied)', async () => {
    // ⭐ The arm a careless repair breaks. The doctrine `useCapabilityGate`
    // states, pinned at this surface: the server is the authority either way,
    // and hiding a permitted user's button on missing client data is the worse
    // failure. Green before the repair too — it is a guard on the repair, not a
    // detector of the defect.
    renderList([INVITE], UNREPORTED);
    await headerReady();
    expect(toolbarButton('invite_user')).toBeInTheDocument();
  });

  it('removes only the gated action, leaving its ungated sibling', async () => {
    renderList([INVITE, EXPORT], MEMBER);
    await headerReady();
    expect(toolbarButton('export')).toBeInTheDocument();
    expect(toolbarButton('invite_user')).toBeNull();
  });

  it('leaves an action declaring no capability untouched', async () => {
    renderList([EXPORT], MEMBER);
    await headerReady();
    expect(toolbarButton('export')).toBeInTheDocument();
  });

  it('composes with the fail-CLOSED `visible` predicate rather than replacing it', async () => {
    // The two gates are ANDed and the composition is MONOTONE: a capability
    // gate in front of the existing `visible` CEL can only ever hide more than
    // before, never expose something that was hidden. Pinned in the direction
    // that a filter written as a REPLACEMENT for `visible` would break — the
    // caller holds the capability, so only `visible` can still hide it.
    renderList(
      [{ ...INVITE, visible: 'features.organization != false' }],
      OWNER,
      // The scope is authored rather than left empty: `features` must RESOLVE
      // to false, so the hide below is the predicate answering, never an
      // unresolvable one failing closed for an unrelated reason.
      { features: { organization: false } },
    );
    await headerReady();
    expect(toolbarButton('invite_user')).toBeNull();
  });
});
