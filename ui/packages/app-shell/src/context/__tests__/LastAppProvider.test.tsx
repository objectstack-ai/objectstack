// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The browser copy of the person's last app (`ui.app.last`) is kept per
 * (user, organization), like the server row it mirrors (objectstack#36244):
 * an app opened in one organization is no landing in another. The
 * organization is the one the real `ActiveOrganizationStorage` holds; a switch
 * reloads the console, so each organization is a fresh mount.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }),
}));

import { ActiveOrganizationStorage } from '@object-ui/auth';
import { LastAppProvider, useLastApp } from '../LastAppProvider';
import { UserStateAdaptersProvider } from '../UserStateAdapters';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <LastAppProvider>{children}</LastAppProvider>
    </UserStateAdaptersProvider>
  );
}

/** Boot the console in `orgId`; `firstPaint` is what the first render answered. */
function bootIn(orgId: string) {
  ActiveOrganizationStorage.set(orgId);
  const paints: Array<{ lastApp: string | null; settled: boolean }> = [];
  const view = renderHook(
    () => {
      const value = useLastApp();
      paints.push({ lastApp: value.lastApp, settled: value.settled });
      return value;
    },
    { wrapper },
  );
  return { view, firstPaint: paints[0] };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth-session-user-id', 'user-1');
});

afterEach(() => {
  ActiveOrganizationStorage.clear();
  localStorage.clear();
});

describe('LastAppProvider — kept per organization (objectstack#36244)', () => {
  it("the app opened in A is not B's first answer, and A keeps it", () => {
    const a = bootIn('org_a');
    act(() => a.view.result.current.rememberApp('a_app'));
    a.view.unmount();

    // B has no copy of its own: it waits for its server row instead of
    // landing in A's app.
    expect(bootIn('org_b').firstPaint).toEqual({ lastApp: null, settled: false });
    expect(bootIn('org_a').firstPaint).toEqual({ lastApp: 'a_app', settled: true });
  });

  it('a single organization keeps the copy kept before the organization was part of the key', () => {
    localStorage.setItem('ui.app.last:u:user-1', JSON.stringify(['crm']));
    expect(bootIn('org_a').firstPaint).toEqual({ lastApp: 'crm', settled: true });
    expect(localStorage.getItem('ui.app.last:u:user-1')).toBeNull();
  });

  it('with no organization the copy stays the user-only one', () => {
    localStorage.setItem('ui.app.last:u:user-1', JSON.stringify(['crm']));
    const { result } = renderHook(() => useLastApp(), { wrapper });
    expect(result.current.lastApp).toBe('crm');
    act(() => result.current.rememberApp('hr'));
    expect(JSON.parse(localStorage.getItem('ui.app.last:u:user-1')!)).toEqual(['hr']);
  });
});
