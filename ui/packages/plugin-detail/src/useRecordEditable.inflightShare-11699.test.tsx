/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11699 — an unanswered explain question is asked once, however many
 * mounts ask it at once.
 *
 * The verdict memo holds FINISHED answers only, so every mount that asked
 * while the first answer was still on the wire sent its own
 * `POST /api/v1/security/explain`. A record page asks each question from two
 * hosts at the same moment — the page header and `record:details`'
 * `DetailView` — and one open sent each question twice.
 *
 * The explain endpoint here HOLDS every request until the test answers it, so
 * "at once" means the first request is genuinely still pending, and every
 * count is a count of requests sent.
 *
 * Pinned beside the one-request count, each against the hole it would leave:
 *   - a different question is never merged into another's answer;
 *   - a fail-open answer is shared but not remembered, so a later mount asks;
 *   - a data change that stales the pending question makes the re-ask a fresh
 *     request rather than a join on an answer about the record before it;
 *   - a principal change empties the pending map, so an unknown-principal
 *     question asked after it cannot join one asked before it.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { useRecordEditable, __clearRecordEditableCache } from './useRecordEditable';

interface HeldAsk {
  body: { object?: string; operation?: string; recordId?: string };
  answer: (visible: boolean | 'not-ok') => Promise<void>;
}

/** An explain endpoint that answers nothing until the test says so. */
function heldExplain() {
  const asks: HeldAsk[] = [];
  const fetchMock = vi.fn((_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Promise((resolve) => {
      asks.push({
        body,
        answer: async (visible) => {
          await act(async () => {
            resolve(
              visible === 'not-ok'
                ? { ok: false, json: async () => ({}) }
                : { ok: true, json: async () => ({ allowed: true, record: { recordId: body.recordId, visible } }) },
            );
          });
        },
      });
    });
  });
  return { asks, fetchMock };
}

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

function signedInAs(userId: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MePermissionsProvider initialPermissions={me(userId)}>{children}</MePermissionsProvider>
  );
}

describe('useRecordEditable — concurrent askers share one explain request (objectui#11699)', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('two mounts asking one question while it is unanswered send ONE POST, and both get the verdict', async () => {
    const { asks, fetchMock } = heldExplain();
    vi.stubGlobal('fetch', fetchMock);

    const header = renderHook(() => useRecordEditable('note', 'r1', 'update'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(1));
    const body = renderHook(() => useRecordEditable('note', 'r1', 'update'), { wrapper: signedInAs('userA') });
    // Give the second mount every chance to send its own request.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await asks[0].answer(false);
    await waitFor(() => expect(header.result.current).toBe(false));
    await waitFor(() => expect(body.result.current).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a second, DISTINCT question is not merged into the first one’s answer', async () => {
    const { asks, fetchMock } = heldExplain();
    vi.stubGlobal('fetch', fetchMock);

    const update = renderHook(() => useRecordEditable('note', 'r1', 'update'), { wrapper: signedInAs('userA') });
    const remove = renderHook(() => useRecordEditable('note', 'r1', 'delete'), { wrapper: signedInAs('userA') });
    const other = renderHook(() => useRecordEditable('note', 'r2', 'update'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(3));
    expect(asks.map((a) => `${a.body.recordId}/${a.body.operation}`).sort()).toEqual([
      'r1/delete',
      'r1/update',
      'r2/update',
    ]);

    // Opposite answers to the two questions on r1: each mount shows its own.
    await asks.find((a) => a.body.recordId === 'r1' && a.body.operation === 'update')!.answer(true);
    await asks.find((a) => a.body.operation === 'delete')!.answer(false);
    await asks.find((a) => a.body.recordId === 'r2')!.answer(false);
    await waitFor(() => expect(remove.result.current).toBe(false));
    await waitFor(() => expect(other.result.current).toBe(false));
    expect(update.result.current).toBe(true);
  });

  it('a fail-open answer is shared but not remembered — a later mount asks again', async () => {
    const { asks, fetchMock } = heldExplain();
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: signedInAs('userA') });
    const second = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(1));
    await asks[0].answer('not-ok');
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    first.unmount();
    second.unmount();

    const later = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(2));
    await asks[1].answer(false);
    await waitFor(() => expect(later.result.current).toBe(false));
  });

  it('a data change while the question is pending makes the re-ask a FRESH request', async () => {
    const { asks, fetchMock } = heldExplain();
    vi.stubGlobal('fetch', fetchMock);

    const header = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(1));

    // The record changes under the pending question (ownership moved).
    act(() => {
      notifyDataChanged({ objectName: 'note', recordId: 'r1' });
    });
    // The mounted hook asks again — and must not be answered by the question
    // sent before the change.
    await waitFor(() => expect(asks).toHaveLength(2));

    await asks[0].answer(true); // about the record BEFORE the change
    await asks[1].answer(false); // about the record now
    await waitFor(() => expect(header.result.current).toBe(false));
  });

  it('a principal change empties the pending map: an unknown-principal ask after it does not join one from before', async () => {
    const { asks, fetchMock } = heldExplain();
    vi.stubGlobal('fetch', fetchMock);

    // No provider: the principal is unknown (`null`), as while `/me/permissions`
    // is in flight, or between a sign-out and the next sign-in.
    const before = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(asks).toHaveLength(1));

    // The tab learns who it is …
    renderHook(() => useRecordEditable('note', 'r1'), { wrapper: signedInAs('userA') });
    await waitFor(() => expect(asks).toHaveLength(2));

    // … and then no longer knows. Same `null` key as the first ask, which is
    // still unanswered — it must be asked again, not joined.
    const after = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(asks).toHaveLength(3));

    await asks[0].answer(true);
    await asks[2].answer(false);
    await waitFor(() => expect(after.result.current).toBe(false));
    before.unmount();
  });
});
