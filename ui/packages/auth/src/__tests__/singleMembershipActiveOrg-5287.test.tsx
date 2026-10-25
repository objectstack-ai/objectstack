/**
 * objectui#5287 — the console top bar HAS the active organization for a
 * single-membership session. This file is the measurement, kept as a pin.
 *
 * ## Why it exists
 *
 * The card's fix (a read-only current-organization indicator in the top bar,
 * for users with exactly one membership) rests on a premise that had never
 * been asserted anywhere: that `useAuth()` — the only source the header reads
 * — actually carries `activeOrganization` when the user belongs to ONE
 * organization. If it did not, the fix would need a new fetch, which is a
 * different-sized change. The three shapes the ruling named were "already
 * present" / "present only on the multi-membership path" / "genuinely absent";
 * these cases pin the first.
 *
 * Two independent things have to hold, and each fails differently:
 *
 *   1. `refreshOrganizations` runs for EVERY authenticated session, not only
 *      for users the server reports several organizations for. There is no
 *      membership-count gate on the effect that calls it, and these cases
 *      would catch one being added: `listOrganizations` is asserted called
 *      with a one-org server.
 *   2. `activeOrganization` ends up non-null. Two server shapes reach that:
 *      the session already carries a server-side active-org stamp, and the
 *      pre-stamp session that ADR-0081's single-membership repair activates
 *      (`orgs.length === 1` → `setActiveOrganization(orgs[0].id)`).
 *
 * Without (2) the indicator renders nothing and the reported defect survives
 * the fix silently — the switcher is hidden by design at one membership, so
 * there is no second surface to notice the miss. The renderer's own tests live
 * in `@object-ui/app-shell` (`CurrentOrganizationIndicator.test.tsx`); this one
 * is deliberately here, against the REAL provider, because a mocked `useAuth`
 * can only restate the premise, never measure it.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import type { AuthClient } from '../types';

const ORG = { id: 'org_solo', name: 'Titanwind EHR', slug: 'titanwind' };

/**
 * Implements the methods the provider reaches on this path only — the same
 * shape and the same one-place cast as `AuthProvider.test.tsx` and every other
 * double in this package.
 */
function createMockClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({
      user: { id: 'u_solo', name: 'Solo Member', email: 'solo@test.com' },
      session: { token: 'tok-solo' },
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    setActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as AuthClient;
}

/** Reads exactly what the top bar reads. */
function OrgProbe() {
  const { organizations, activeOrganization } = useAuth();
  return (
    <div>
      <span data-testid="org-count">{String(organizations?.length ?? 0)}</span>
      <span data-testid="active-org-name">{activeOrganization?.name ?? 'none'}</span>
    </div>
  );
}

async function mount(client: AuthClient) {
  render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <OrgProbe />
    </AuthProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('active-org-name').textContent).not.toBe('none');
  });
}

describe('single-membership session carries the active organization (#5287)', () => {
  it('loads organizations for a one-membership user — the fetch is not gated on membership count', async () => {
    const client = createMockClient();

    await mount(client);

    expect(client.listOrganizations).toHaveBeenCalled();
    expect(screen.getByTestId('org-count').textContent).toBe('1');
    expect(screen.getByTestId('active-org-name').textContent).toBe('Titanwind EHR');
  });

  it('activates the sole organization when the session carries no server-side stamp (ADR-0081 repair)', async () => {
    const setActiveOrganization = vi.fn().mockResolvedValue(ORG);
    const client = createMockClient({
      getActiveOrganization: vi.fn().mockResolvedValue(null),
      setActiveOrganization,
    });

    await mount(client);

    expect(setActiveOrganization).toHaveBeenCalledWith(ORG.id);
    expect(screen.getByTestId('active-org-name').textContent).toBe('Titanwind EHR');
  });
});
