/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10184 — the row kebab's verdict memo forgets a row that CHANGED.
 *
 * A verdict cached for one principal is still wrong for that SAME principal
 * once the row changes under it — ownership moves, a share is granted or
 * revoked. The route ruled on objectui#10107 (ACCEPT) is the existing
 * data-invalidation bus: a change announced with `notifyDataChanged` drops the
 * affected row's entries, and a mounted list asks again in place — for that row
 * only. The detail header's memo takes the same route
 * (`useRecordEditable.invalidation.test.tsx` in `@object-ui/plugin-detail`), so
 * the kebab and the header keep answering a record identically.
 *
 * Both directions are pinned — stale DENY (a grant stays invisible) and stale
 * ALLOW (a revocation keeps offering Edit, the direction that guards the
 * boundary) — plus the controls that hold the memo in place: with no change
 * announced, or a change to another row, nothing is asked again.
 *
 * ⛔ The fail-open posture on an unknown answer is not moved here (ADR-0124 D1).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import {
  useRecordCrudVerdicts,
  __clearRecordCrudVerdictCache,
  type RecordCrudOperation,
} from './useRecordCrudVerdicts';

const OBJECT = 'note';

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

const asA = ({ children }: { children: React.ReactNode }) => (
  <MePermissionsProvider initialPermissions={me('userA')}>{children}</MePermissionsProvider>
);

/**
 * The explain engine. `verdicts` is what the server would answer RIGHT NOW per
 * row (absent = `false`); change it to model a grant or a revocation landing
 * server-side. Every request is recorded, so "asked again" is a count.
 */
const server = {
  verdicts: new Map<string, boolean>(),
  calls: [] as Array<{ object?: string; operation?: RecordCrudOperation; recordIds?: string[] }>,
};

function explain() {
  return vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    server.calls.push(body);
    const records = (body.recordIds as string[]).map((recordId) => ({
      recordId,
      visible: server.verdicts.get(recordId) ?? false, // decided when ASKED
    }));
    return { ok: true, json: async () => ({ allowed: true, records }) };
  });
}

/** A page of rows, asking about both kebab verbs, answered as a plain table. */
function usePage(recordIds: string[]) {
  const lookup = useRecordCrudVerdicts({ objectName: OBJECT, recordIds, update: true, delete: true });
  return Object.fromEntries(recordIds.map((id) => [id, { update: lookup(id, 'update'), delete: lookup(id, 'delete') }]));
}

const PAGE = ['r1', 'r2', 'r3'];

describe('useRecordCrudVerdicts — a changed row is asked again (objectui#10184)', () => {
  beforeEach(() => {
    __clearRecordCrudVerdictCache();
    server.verdicts = new Map();
    server.calls = [];
    vi.stubGlobal('fetch', explain());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stale DENY: a share granted, then the row’s change announced ⇒ asks again and the kebab offers Edit', async () => {
    const { result } = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(result.current.r1).toEqual({ update: false, delete: false }));
    expect(server.calls).toHaveLength(2); // one batch per verb

    server.verdicts.set('r1', true);
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'r1' }));

    await waitFor(() => expect(result.current.r1).toEqual({ update: true, delete: true }));
    // Only the changed row was asked about again — both verbs, nothing else.
    expect(server.calls.slice(2).map((c) => [c.operation, c.recordIds])).toEqual([
      ['update', ['r1']],
      ['delete', ['r1']],
    ]);
    expect(result.current.r2).toEqual({ update: false, delete: false });
  });

  it('stale ALLOW: a share revoked, then the row’s change announced ⇒ asks again and the kebab hides Edit', async () => {
    for (const id of PAGE) server.verdicts.set(id, true);
    const { result } = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(result.current.r1).toEqual({ update: true, delete: true }));

    server.verdicts.set('r1', false);
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'r1' }));

    // The server's own `false` — not `undefined`, which would keep the kebab.
    await waitFor(() => expect(result.current.r1).toEqual({ update: false, delete: false }));
    expect(server.calls).toHaveLength(4);
    expect(result.current.r2).toEqual({ update: true, delete: true });
  });

  it('a change announced while no list is mounted still drops the row: the next visit asks for it', async () => {
    const first = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(first.result.current.r1).toEqual({ update: false, delete: false }));
    first.unmount();

    server.verdicts.set('r1', true);
    notifyDataChanged({ objectName: OBJECT, recordId: 'r1' });

    const second = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(second.result.current.r1).toEqual({ update: true, delete: true }));
    expect(server.calls.slice(2).map((c) => c.recordIds)).toEqual([['r1'], ['r1']]);
  });

  it('an object-wide change and the "*" change stale every row of the page', async () => {
    const { result } = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(result.current.r3).toEqual({ update: false, delete: false }));

    for (const id of PAGE) server.verdicts.set(id, true);
    act(() => notifyDataChanged({ objectName: OBJECT }));
    await waitFor(() => expect(result.current.r3).toEqual({ update: true, delete: true }));
    expect(server.calls.slice(2).map((c) => c.recordIds)).toEqual([PAGE, PAGE]);

    for (const id of PAGE) server.verdicts.set(id, false);
    act(() => notifyDataChanged({ objectName: '*' }));
    await waitFor(() => expect(result.current.r3).toEqual({ update: false, delete: false }));
    expect(server.calls).toHaveLength(6);
  });

  it('an answer that was in flight when its row changed is not cached', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = explain();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { body?: unknown }) => {
        const res = await answer(input, init); // verdict taken when ASKED
        if (server.calls.length <= 2) await gate; // hold the first page's answers
        return res;
      }),
    );

    const first = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(server.calls).toHaveLength(2));
    first.unmount();

    server.verdicts.set('r1', true);
    notifyDataChanged({ objectName: OBJECT, recordId: 'r1' });
    // Let the held answers land; a macrotask boundary drains the hook's
    // continuation, so they have been handled before the next visit looks.
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // r1's pre-change answer was refused; r2 and r3 were cached as usual.
    const second = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(second.result.current.r1).toEqual({ update: true, delete: true }));
    expect(server.calls.slice(2).map((c) => c.recordIds)).toEqual([['r1'], ['r1']]);
    expect(second.result.current.r2).toEqual({ update: false, delete: false });
  });

  // ── Controls: the memo itself still works ────────────────────────────────

  it('control — no change announced: re-rendering and revisiting ask nothing', async () => {
    const first = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(first.result.current.r1).toEqual({ update: false, delete: false }));
    first.rerender();
    first.unmount();

    server.verdicts.set('r1', true); // the server moved, but nothing in this tab said so
    const second = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(second.result.current.r1).toEqual({ update: false, delete: false }));
    await act(async () => {});
    expect(server.calls).toHaveLength(2);
  });

  it('control — another row’s change, or another object’s, asks nothing', async () => {
    const { result } = renderHook(() => usePage(PAGE), { wrapper: asA });
    await waitFor(() => expect(result.current.r1).toEqual({ update: false, delete: false }));

    server.verdicts.set('r1', true);
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'r9' })); // same object, not on this page
    act(() => notifyDataChanged({ objectName: 'task', recordId: 'r1' }));
    act(() => notifyDataChanged({ objectName: 'task' }));
    await act(async () => {});

    expect(result.current.r1).toEqual({ update: false, delete: false });
    expect(server.calls).toHaveLength(2);
  });
});
