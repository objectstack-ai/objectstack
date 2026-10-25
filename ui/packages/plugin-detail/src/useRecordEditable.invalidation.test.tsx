/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10184 — the record-verdict memo forgets a record that CHANGED.
 *
 * objectui#10107 made the memo per principal. What that left: a verdict cached
 * for one principal is still wrong for that SAME principal once the record
 * changes under it — ownership moves, a share is granted or revoked — and the
 * memo kept answering from before the change. The route ruled on objectui#10107
 * (ACCEPT) is the existing data-invalidation bus: a change announced with
 * `notifyDataChanged` drops the affected record's entries, and a mounted hook
 * asks again in place.
 *
 * Both directions are pinned, because a repair that only fixes one is worse
 * than none:
 *
 *  - **stale DENY**: a `false` cached before a grant keeps Edit hidden from a
 *    principal the server now lets write the record;
 *  - **stale ALLOW** (the one that guards the boundary): a `true` cached before
 *    a revocation keeps offering Edit the server now refuses. A "fix" that
 *    simply showed Edit to everyone passes the first and fails this one.
 *
 * And the controls, so the pins cannot pass by deleting the memo: with no
 * change announced, or a change to some OTHER record, nothing is asked again.
 *
 * ⛔ The fail-open posture on an unknown answer is not moved here (ADR-0124 D1 —
 * the server enforces, the client is courtesy); `useRecordEditable.test.tsx`
 * owns that contract.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { useRecordEditable, __clearRecordEditableCache } from './useRecordEditable';

/** A `/me/permissions` payload for one principal; the object grant is constant. */
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

/** This tab, signed in as `userId`. */
function signedInAs(userId: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MePermissionsProvider initialPermissions={me(userId)}>{children}</MePermissionsProvider>
  );
}

/**
 * The explain engine. `verdict` is what the server would answer RIGHT NOW for
 * every record — flip it to model a grant or a revocation landing server-side.
 * Every request is recorded, so "asked again" is a count, not an inference.
 */
const server = {
  verdict: false,
  calls: [] as Array<{ object?: string; operation?: string; recordId?: string }>,
};

function explain() {
  return vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    server.calls.push(body);
    const visible = server.verdict;
    return { ok: true, json: async () => ({ allowed: true, record: { recordId: body.recordId, visible } }) };
  });
}

const asA = signedInAs('userA');

describe('useRecordEditable — a changed record is asked again (objectui#10184)', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
    server.calls = [];
    vi.stubGlobal('fetch', explain());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stale DENY: a share granted, then the record’s change announced ⇒ asks again and offers Edit', async () => {
    server.verdict = false;
    const { result } = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(result.current).toBe(false));
    expect(server.calls).toHaveLength(1);

    // The grant lands server-side; this tab announces the record changed.
    server.verdict = true;
    act(() => notifyDataChanged({ objectName: 'note', recordId: 'r1' }));

    await waitFor(() => expect(result.current).toBe(true));
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toMatchObject({ object: 'note', operation: 'update', recordId: 'r1' });
  });

  it('stale ALLOW: a share revoked, then the record’s change announced ⇒ asks again and hides Edit', async () => {
    server.verdict = true;
    const { result } = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    await waitFor(() => expect(result.current).toBe(true));

    server.verdict = false;
    act(() => notifyDataChanged({ objectName: 'note', recordId: 'r1' }));

    await waitFor(() => expect(result.current).toBe(false));
    expect(server.calls).toHaveLength(2);
  });

  it('a change announced while no hook is mounted still drops the entry: the next mount asks', async () => {
    server.verdict = false;
    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    // e.g. ownership moved from a list's inline edit, then the record page opens.
    server.verdict = true;
    notifyDataChanged({ objectName: 'note', recordId: 'r1' });

    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(server.calls).toHaveLength(2);
  });

  it('drops EVERY operation of the changed record, not only the one that was asked about', async () => {
    server.verdict = false;
    const update = renderHook(() => useRecordEditable('note', 'r1', 'update'), { wrapper: asA });
    const del = renderHook(() => useRecordEditable('note', 'r1', 'delete'), { wrapper: asA });
    await waitFor(() => expect(update.result.current).toBe(false));
    await waitFor(() => expect(del.result.current).toBe(false));
    expect(server.calls).toHaveLength(2);

    server.verdict = true;
    act(() => notifyDataChanged({ objectName: 'note', recordId: 'r1' }));

    await waitFor(() => expect(update.result.current).toBe(true));
    await waitFor(() => expect(del.result.current).toBe(true));
    expect(server.calls.map((c) => c.operation).sort()).toEqual(['delete', 'delete', 'update', 'update']);
  });

  it('an object-wide change and the "*" change both stale the record', async () => {
    server.verdict = false;
    const { result } = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(result.current).toBe(false));

    server.verdict = true;
    act(() => notifyDataChanged({ objectName: 'note' }));
    await waitFor(() => expect(result.current).toBe(true));
    expect(server.calls).toHaveLength(2);

    server.verdict = false;
    act(() => notifyDataChanged({ objectName: '*' }));
    await waitFor(() => expect(result.current).toBe(false));
    expect(server.calls).toHaveLength(3);
  });

  it('an answer that was in flight when its record changed is not cached', async () => {
    // The pre-change answer is held open until after the change is announced.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        server.calls.push(body);
        const visible = server.verdict; // decided when ASKED, as the server would
        if (server.calls.length === 1) await gate;
        return { ok: true, json: async () => ({ allowed: true, record: { recordId: body.recordId, visible } }) };
      }),
    );

    server.verdict = false;
    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    first.unmount();

    server.verdict = true;
    notifyDataChanged({ objectName: 'note', recordId: 'r1' });
    // Let the held answer land. A macrotask boundary drains every microtask of
    // the hook's continuation, so the stale answer has been handled — cached or
    // refused — before the next mount looks.
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Had the pre-change `false` been cached, this mount would adopt it
    // synchronously and never ask.
    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(server.calls).toHaveLength(2));
    await waitFor(() => expect(second.result.current).toBe(true));
  });

  // ── Controls: the memo itself still works ────────────────────────────────

  it('control — no change announced: re-rendering and re-mounting ask nothing', async () => {
    server.verdict = false;
    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.rerender();
    first.unmount();

    server.verdict = true; // the server moved, but nothing in this tab said so
    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    expect(second.result.current).toBe(false);
    await act(async () => {});
    expect(server.calls).toHaveLength(1);
  });

  it('control — another record’s change, or another object’s, asks nothing', async () => {
    server.verdict = false;
    const { result } = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(result.current).toBe(false));

    server.verdict = true;
    act(() => notifyDataChanged({ objectName: 'note', recordId: 'r2' }));
    act(() => notifyDataChanged({ objectName: 'task', recordId: 'r1' }));
    act(() => notifyDataChanged({ objectName: 'task' }));
    await act(async () => {});

    expect(result.current).toBe(false);
    expect(server.calls).toHaveLength(1);
  });
});
