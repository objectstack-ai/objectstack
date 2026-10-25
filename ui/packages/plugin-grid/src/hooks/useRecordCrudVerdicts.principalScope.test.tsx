/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10184 — the row kebab's record-verdict memo is PER PRINCIPAL.
 *
 * `useRecordCrudVerdicts` memoises the explain engine's batch verdicts at module
 * scope, so they outlive every unmount for the life of the tab — and signing out
 * does not end that life (`AuthProvider.signOut` never reloads the page). Keyed
 * on `object:recordId:operation` alone, the next principal to sign in in the
 * same tab was answered from the previous one's verdicts and nothing was asked.
 * objectui#10107 repaired the identical memo behind the detail header
 * (`useRecordEditable.principalScope.test.tsx` in `@object-ui/plugin-detail`);
 * this is the same pin, retargeted at the list.
 *
 * Both directions, because a repair that only fixes one is worse than none:
 *
 *  - **stale DENY**: a `false` computed for someone else hides the kebab's Edit
 *    from a principal the server lets write the row;
 *  - **stale ALLOW** (the one that guards the boundary): a `true` computed for
 *    a privileged principal offers Edit to one the server refuses. A "fix" that
 *    simply showed the kebab to everyone passes the first and fails this one.
 *
 * The controls hold the memo in place, so the pins cannot pass by deleting it.
 *
 * ⛔ The fail-open posture on an unknown answer is not moved here (ADR-0124 D1).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { useRecordCrudVerdicts, __clearRecordCrudVerdictCache } from './useRecordCrudVerdicts';

const OBJECT = 'note';

/** A `/me/permissions` payload for one principal; the object grant is constant. */
function me(userId: string): MePermissionsResponse {
  return {
    authenticated: true,
    userId,
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** This tab, signed in as `userId`. */
function signedInAs(userId: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MePermissionsProvider initialPermissions={me(userId)}>{children}</MePermissionsProvider>
  );
}

/** A batch explain endpoint answering `visible` for every id it is asked about. */
function explainAnswering(visible: boolean) {
  return vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { recordIds?: string[] };
    return {
      ok: true,
      json: async () => ({
        allowed: true,
        records: (body.recordIds ?? []).map((recordId) => ({ recordId, visible })),
      }),
    };
  });
}

/** The kebab's question about one row: may this principal UPDATE `r1`? */
const useR1UpdateVerdict = () => {
  const lookup = useRecordCrudVerdicts({ objectName: OBJECT, recordIds: ['r1'], update: true });
  return lookup('r1', 'update');
};

describe('useRecordCrudVerdicts — the verdict memo is per principal (objectui#10184)', () => {
  beforeEach(() => {
    __clearRecordCrudVerdictCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stale DENY: re-asks for the new principal, so another principal’s denial does not hide the kebab', async () => {
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const first = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userA') });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    // Same tab, new principal — the server lets this one write the row.
    const allow = explainAnswering(true);
    vi.stubGlobal('fetch', allow);
    const second = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userB') });

    await waitFor(() => expect(second.result.current).toBe(true));
    expect(allow).toHaveBeenCalledTimes(1);
  });

  it('stale ALLOW: re-asks for the new principal, so one principal’s allowance is not offered to another', async () => {
    const allow = explainAnswering(true);
    vi.stubGlobal('fetch', allow);
    const first = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userA') });
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    // Same tab, new principal, no grant. The kebab's Edit must not be inherited.
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const second = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userB') });

    // Not `undefined` (fail open, the kebab stays) — the server's own `false`.
    await waitFor(() => expect(second.result.current).toBe(false));
    expect(deny).toHaveBeenCalledTimes(1);
  });

  it('control — still memoises within one principal: revisiting the page asks nothing', async () => {
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const first = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userA') });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    const second = renderHook(useR1UpdateVerdict, { wrapper: signedInAs('userA') });
    await waitFor(() => expect(second.result.current).toBe(false));
    await act(async () => {});
    expect(deny).toHaveBeenCalledTimes(1);
  });

  it('control — memoises with no provider mounted, where the principal is unknown to the client', async () => {
    const deny = explainAnswering(false);
    vi.stubGlobal('fetch', deny);
    const first = renderHook(useR1UpdateVerdict);
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    const second = renderHook(useR1UpdateVerdict);
    await waitFor(() => expect(second.result.current).toBe(false));
    await act(async () => {});
    expect(deny).toHaveBeenCalledTimes(1);
  });
});
