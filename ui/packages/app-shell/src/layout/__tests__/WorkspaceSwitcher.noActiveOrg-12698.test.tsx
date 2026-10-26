// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12698 — the header names the organization the SERVER reports as
 * active, never `orgList[0]`.
 *
 * Real `AuthProvider` over a mocked auth server, real `WorkspaceSwitcher`. When
 * the server holds no active organization (a refused `set-active` nulls it),
 * the provider holds `activeOrganization = null`; the component used to fill
 * that with the first membership and name an organization the session did not
 * hold. The control case uses the identical harness, which is what proves the
 * query can see the component when an organization is active.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth, type AuthClient, type AuthOrganization } from '@object-ui/auth';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const PREV = { id: 'org_prev', name: 'Previous Org', slug: 'prev' } as AuthOrganization;
const OTHER = { id: 'org_other', name: 'Other Org', slug: 'other' } as AuthOrganization;
const MEMBERSHIPS = [PREV, OTHER];

/** A server that answers `active` for the session's active organization; set-active is refused. */
function createServer(active: AuthOrganization | null): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({
      user: { id: 'u_12698', name: 'Member', email: 'member@test.com' },
      session: { token: 'tok-12698' },
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue(MEMBERSHIPS),
    getActiveOrganization: vi.fn().mockResolvedValue(active),
    setActiveOrganization: vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { status: 403 })),
    getActiveMember: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({ features: { tenancyPosture: 'isolated', multiOrgEnabled: true } }),
  } as unknown as AuthClient;
}

/** Waits until the provider has the membership list, so a negative is not read before the answer lands. */
function Probe() {
  const { user, organizations, isMembershipResolved, activeOrganization } = useAuth();
  const ready = user && isMembershipResolved && organizations.length === MEMBERSHIPS.length;
  return <span data-testid="probe">{ready ? (activeOrganization?.id ?? 'none') : 'loading'}</span>;
}

async function boot(active: AuthOrganization | null) {
  render(
    <MemoryRouter>
      <AuthProvider authUrl="/api/auth" client={createServer(active)}>
        <Probe />
        <WorkspaceSwitcher />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(active?.id ?? 'none'));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('WorkspaceSwitcher names only the server-active organization (objectui#12698)', () => {
  it('(a) two memberships, server reports no active organization: no organization is named', async () => {
    await boot(null);
    // Let the tenancy-posture config fetch land too, so "nothing rendered" is not "not yet rendered".
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByTestId('workspace-switcher')).toBeNull();
    for (const org of MEMBERSHIPS) expect(screen.queryByText(org.name)).toBeNull();
  });

  it('(b) control: the server-active organization is named as before', async () => {
    await boot(PREV);

    const el = await screen.findByTestId('workspace-switcher');
    expect(el).toHaveTextContent(PREV.name);
  });
});
