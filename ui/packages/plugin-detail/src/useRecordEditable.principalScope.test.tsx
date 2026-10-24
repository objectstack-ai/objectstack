/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10107 — the record-grained verdict memo is PER PRINCIPAL.
 *
 * `useRecordEditable` memoises the explain engine's row verdict so revisiting a
 * record costs nothing. The memo used to be keyed on `object:recordId:operation`
 * alone — nothing about WHO the verdict was computed for — and it lives at module
 * scope, so it outlives every unmount for the life of the tab.
 *
 * Signing out does not end that life. `AuthProvider.signOut` is documented in
 * this repo as never reloading the page ("no sign-out call site reloads the
 * page — `AppHeader`, `UserMenu` and `RemediationOverlay` all just call
 * `signOut()` and let the SPA keep running"), which is why it purges the
 * per-tab caches by hand. This map was not among them, so the next principal to
 * sign in in the same tab was answered from the previous principal's verdicts —
 * synchronously, as the hook's INITIAL state, so no probe was ever sent and no
 * later answer could correct it.
 *
 * Both fail directions are real and both are pinned here, because a repair that
 * only fixes one is worse than no repair:
 *
 *  - **Stale DENY** (the card's report): a `false` computed for someone else is
 *    served to a user who holds a record-level `edit` share, so a permitted user
 *    is shown no Edit for the rest of the tab's life while `PATCH` on the same
 *    record succeeds.
 *  - **Stale ALLOW** (the inverse, and the worse one): a `true` computed for a
 *    privileged principal is served to one who holds no grant, so the UI offers
 *    an action the server refuses.
 *
 * ⛔ These pins do NOT move the hook's fail-open posture on an unknown answer
 * (ADR-0124 D1 — server enforces, client is courtesy). `useRecordEditable.test.tsx`
 * owns that contract; what is pinned here is that a verdict belonging to another
 * principal is not an answer at all.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { useRecordEditable, __clearRecordEditableCache } from './useRecordEditable';

/** A `/me/permissions` payload for one principal. The object bits are constant
 *  across principals on purpose: the OBJECT-level grant is not what this file
 *  measures, so it cannot be the reason a verdict changes. */
function me(userId: string): MePermissionsResponse {
  return {
    authenticated: true,
    userId,
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    objects: { note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** A provider standing for "this tab is signed in as `userId`". */
function principal(userId: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MePermissionsProvider initialPermissions={me(userId)}>{children}</MePermissionsProvider>
  );
}

/** An explain endpoint that answers `visible` for every record it is asked about. */
function explainAnswering(visible: boolean) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ allowed: true, record: { recordId: 'r1', visible } }),
  })) as any;
}

describe('useRecordEditable — the verdict memo is per principal (objectui#10107)', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-asks for the new principal: a record-level edit share is not hidden by another principal’s denial', async () => {
    // Principal A is refused this row.
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userA') });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    // Same tab, new principal — this one holds a record-level `edit` share, and
    // the server says so.
    const allow = explainAnswering(true);
    vi.stubGlobal('fetch', allow);
    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userB') });

    await waitFor(() => expect(second.result.current).toBe(true));
    expect(allow).toHaveBeenCalledTimes(1);
  });

  it('re-asks for the new principal: one principal’s allowance is not offered to another', async () => {
    // Principal A may write this row.
    const allow = explainAnswering(true);
    vi.stubGlobal('fetch', allow);
    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userA') });
    await waitFor(() => expect(allow).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBe(true);
    first.unmount();

    // Same tab, new principal, no grant. The affordance must not be inherited.
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userB') });

    await waitFor(() => expect(second.result.current).toBe(false));
    expect(deny).toHaveBeenCalledTimes(1);
  });

  it('still memoises within one principal — revisiting a record costs nothing', async () => {
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);

    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userA') });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: principal('userA') });
    expect(second.result.current).toBe(false);
    expect(deny).toHaveBeenCalledTimes(1);
  });

  it('memoises with no provider mounted, where the principal is unknown to the client', async () => {
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);

    const first = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    const second = renderHook(() => useRecordEditable('note', 'r1'));
    expect(second.result.current).toBe(false);
    expect(deny).toHaveBeenCalledTimes(1);
  });
});
