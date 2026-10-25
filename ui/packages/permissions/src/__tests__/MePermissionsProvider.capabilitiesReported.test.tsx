/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4656 — `MePermissionsProvider` used to collapse an ABSENT
 * `systemPermissions` (a backend predating ADR-0066, which omits the field
 * from the `/me/permissions` response entirely) and a genuinely EMPTY one
 * (a real answer: "you hold zero system capabilities") into the same `[]`.
 * Every `hasCapabilities` consumer downstream could not tell "no answer" from
 * "no grants" and had to either gate strictly (stripping UI from every admin
 * on a non-reporting deployment — objectstack#8270) or invent its own
 * call-site "empty ⇒ treat as unreported" heuristic (`HomePage.tsx`'s
 * `useCanAuthorMetadata`, before this fix).
 *
 * This pins the truth table the centralized fix promises:
 *   - field OMITTED (unreported backend)  → `systemPermissions` is
 *     `undefined`, `hasCapabilities` fails OPEN (`true`) regardless of what
 *     is required.
 *   - field REPORTED as `[]` (real, empty grant) → `systemPermissions` is
 *     `[]`, `hasCapabilities` gates STRICTLY — false unless `required` is
 *     empty too.
 *   - field REPORTED with real grants → ordinary subset check (positive AND
 *     negative control), unchanged from before this fix.
 *
 * Also pins the same "no report ⇒ undefined, not []" signal on the two other
 * `PermissionContextValue` sources: `PermissionProvider` (the role-based
 * provider, which never fetches `/me/permissions` and so can never claim a
 * real answer) and `usePermissions()`'s own no-context fallback (no provider
 * mounted at all).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider } from '../MePermissionsProvider';
import { PermissionProvider } from '../PermissionProvider';
import { usePermissions } from '../usePermissions';

function Probe({ required }: { required: string[] }) {
  const { hasCapabilities, systemPermissions } = usePermissions();
  return (
    <div>
      <span data-testid="reported">{String(Array.isArray(systemPermissions))}</span>
      <span data-testid="raw">{JSON.stringify(systemPermissions)}</span>
      <span data-testid="has">{String(hasCapabilities(required))}</span>
    </div>
  );
}

describe('objectui#4656 — absent-vs-empty systemPermissions truth table', () => {
  describe('MePermissionsProvider', () => {
    it('UNREPORTED (field omitted): systemPermissions undefined, hasCapabilities fails OPEN', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true,
            userId: 'u1',
            tenantId: 't1',
            roles: ['org_owner'],
            permissionSets: ['organization_admin'],
            // No `systemPermissions` key at all — pre-ADR-0066 shape.
            objects: {},
            fields: {},
          }}
        >
          <Probe required={['manage_metadata']} />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('reported').textContent).toBe('false');
      // `JSON.stringify(undefined)` is the JS value `undefined`, which React
      // renders as no text at all — so an unreported answer leaves this node
      // empty, distinct from the reported-empty case below rendering `[]`.
      expect(screen.getByTestId('raw').textContent).toBe('');
      expect(screen.getByTestId('has').textContent).toBe('true');
    });

    it('REPORTED empty ([]): systemPermissions is [], hasCapabilities gates STRICTLY', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true,
            userId: 'u1',
            tenantId: 't1',
            roles: ['org_owner'],
            permissionSets: ['organization_admin'],
            systemPermissions: [], // a REAL answer: holds zero capabilities
            objects: {},
            fields: {},
          }}
        >
          <Probe required={['manage_metadata']} />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('reported').textContent).toBe('true');
      expect(screen.getByTestId('raw').textContent).toBe('[]');
      // The bug this card fixes: before it, an empty-but-REPORTED answer was
      // indistinguishable from "unreported" and fell open too.
      expect(screen.getByTestId('has').textContent).toBe('false');
    });

    it('REPORTED empty ([]) with an empty `required` list still passes (vacuous subset)', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true,
            userId: 'u1',
            tenantId: 't1',
            roles: [],
            permissionSets: [],
            systemPermissions: [],
            objects: {},
            fields: {},
          }}
        >
          <Probe required={[]} />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('has').textContent).toBe('true');
    });

    it('REPORTED with real grants — positive control: holds the required capability', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true,
            userId: 'u1',
            tenantId: 't1',
            roles: ['org_owner'],
            permissionSets: ['organization_admin'],
            systemPermissions: ['manage_org_users', 'setup.access', 'manage_metadata'],
            objects: {},
            fields: {},
          }}
        >
          <Probe required={['manage_metadata']} />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('reported').textContent).toBe('true');
      expect(screen.getByTestId('has').textContent).toBe('true');
    });

    it('REPORTED with real grants — negative control: a non-empty set missing the required capability still gates', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true,
            userId: 'u1',
            tenantId: 't1',
            roles: ['org_owner'],
            permissionSets: ['organization_admin'],
            // The objectstack#8270 EE owner's exact set — non-empty, no manage_metadata.
            systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
            objects: {},
            fields: {},
          }}
        >
          <Probe required={['manage_metadata']} />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('reported').textContent).toBe('true');
      expect(screen.getByTestId('has').textContent).toBe('false');
    });
  });

  describe('sibling PermissionContextValue sources also signal "unreported" as undefined, not []', () => {
    it('PermissionProvider (role-based, no /me/permissions fetch) never claims a real answer', () => {
      render(
        <PermissionProvider roles={[]} permissions={[]} userRoles={['admin']}>
          <Probe required={['manage_metadata']} />
        </PermissionProvider>,
      );
      expect(screen.getByTestId('reported').textContent).toBe('false');
      // Fail-open by design — this provider has nothing to enforce with.
      expect(screen.getByTestId('has').textContent).toBe('true');
    });

    it('usePermissions() with no provider mounted at all', () => {
      render(<Probe required={['manage_metadata']} />);
      expect(screen.getByTestId('reported').textContent).toBe('false');
      expect(screen.getByTestId('has').textContent).toBe('true');
    });
  });

  describe('the sidebar nav OR-fallback pattern needs no call-site change (objectui#4656)', () => {
    // `UnifiedSidebar` gates a bare `requiredPermissions` name with
    // `hasCapabilities([perm]) || can(perm, 'read')` — not a heuristic that
    // reads `systemPermissions` itself, so there is nothing there to migrate.
    // This reproduces that exact expression against the real provider to show
    // it is fixed for free: on an unreported backend `hasCapabilities` alone
    // now opens the gate, where before this fix it fell through to the
    // `can(perm, 'read')` object-permission check — which reads a bare
    // capability name as an OBJECT name and denies for an authenticated
    // session with no matching object entry (#2926 ④), stripping every
    // bare-capability nav item on exactly the deployments this doctrine
    // exists to protect.
    function NavProbe({ perm }: { perm: string }) {
      const { hasCapabilities, can } = usePermissions();
      return <span data-testid="nav-shows">{String(hasCapabilities([perm]) || can(perm, 'read'))}</span>;
    }

    it('shows a bare-capability nav item on an UNREPORTED backend (fails open via hasCapabilities alone)', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true, userId: 'u1', tenantId: 't1',
            roles: ['org_owner'], permissionSets: ['organization_admin'],
            // `systemPermissions` omitted — pre-ADR-0066 shape.
            objects: {}, fields: {},
          }}
        >
          <NavProbe perm="manage_metadata" />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('nav-shows').textContent).toBe('true');
    });

    it('hides a bare-capability nav item on a REPORTED-empty backend lacking it and no matching object', () => {
      render(
        <MePermissionsProvider
          initialPermissions={{
            authenticated: true, userId: 'u1', tenantId: 't1',
            roles: ['org_owner'], permissionSets: ['organization_admin'],
            systemPermissions: [], // real answer: holds nothing
            objects: {}, fields: {},
          }}
        >
          <NavProbe perm="manage_metadata" />
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('nav-shows').textContent).toBe('false');
    });
  });
});
