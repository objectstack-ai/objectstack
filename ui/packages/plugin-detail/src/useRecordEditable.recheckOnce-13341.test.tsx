/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13341 — one data change, one re-check per question, however often
 * the change is announced.
 *
 * A write commonly reaches the data-invalidation bus twice: the console's
 * `useMutationInvalidationBridge` on the write's response, and the host that
 * made it after awaiting it. When the second announcement landed while the
 * re-check prompted by the first was on the wire, it staled that re-check and
 * a second request went out for the same question.
 *
 * The explain endpoint here HOLDS every request until the test answers it, so
 * "on the wire" is literal and every count is a count of requests sent.
 *
 * Controls, each against the hole a fix could leave:
 *   - the re-check is still sent, and its answer is what the hook shows;
 *   - a question on the wire BEFORE the first announcement is still refused
 *     and asked again (objectui#10184, objectui#11699) — once, since the
 *     question it sets off is that re-check;
 *   - an announcement after the re-check has answered asks again.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { useRecordEditable, __clearRecordEditableCache } from './useRecordEditable';

interface HeldAsk {
  body: { object?: string; operation?: string; recordId?: string };
  answer: (visible: boolean) => Promise<void>;
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
            resolve({ ok: true, json: async () => ({ allowed: true, record: { recordId: body.recordId, visible } }) });
            await new Promise((r) => setTimeout(r, 0));
          });
        },
      });
    });
  });
  return { asks, fetchMock };
}

const asA = ({ children }: { children: React.ReactNode }) => (
  <MePermissionsProvider
    initialPermissions={{
      authenticated: true,
      userId: 'userA',
      tenantId: 't1',
      roles: [],
      permissionSets: [],
      objects: { note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      fields: {},
    } satisfies MePermissionsResponse}
  >
    {children}
  </MePermissionsProvider>
);

const changeR1 = () => act(() => notifyDataChanged({ objectName: 'note', recordId: 'r1' }));

describe('useRecordEditable — one re-check per change (objectui#13341)', () => {
  let held: ReturnType<typeof heldExplain>;
  beforeEach(() => {
    __clearRecordEditableCache();
    held = heldExplain();
    vi.stubGlobal('fetch', held.fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the change announced again while its re-check is on the wire joins it: one request, and its answer is shown', async () => {
    const { asks } = held;
    const header = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    const body = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(asks).toHaveLength(1));
    await asks[0].answer(true);
    await waitFor(() => expect(header.result.current).toBe(true));

    changeR1(); // the bridge, on the write's response
    await waitFor(() => expect(asks).toHaveLength(2));
    changeR1(); // the host, after awaiting the same write
    changeR1(); // and an object-wide notice of it, for good measure
    act(() => notifyDataChanged({ objectName: 'note' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asks).toHaveLength(2);

    // The write revoked the edit: the re-check's answer is what both show.
    await asks[1].answer(false);
    await waitFor(() => expect(header.result.current).toBe(false));
    await waitFor(() => expect(body.result.current).toBe(false));
    expect(asks).toHaveLength(2);
  });

  it('a question on the wire BEFORE the change is refused once, and the re-check it set off absorbs the next announcement', async () => {
    const { asks } = held;
    const header = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(asks).toHaveLength(1));

    changeR1();
    await waitFor(() => expect(asks).toHaveLength(2));
    changeR1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asks).toHaveLength(2);

    await asks[0].answer(true); // about the record before the change
    await asks[1].answer(false); // the re-check
    await waitFor(() => expect(header.result.current).toBe(false));
  });

  it('control — a change announced after the re-check answered asks again', async () => {
    const { asks } = held;
    const header = renderHook(() => useRecordEditable('note', 'r1'), { wrapper: asA });
    await waitFor(() => expect(asks).toHaveLength(1));
    await asks[0].answer(true);

    changeR1();
    await waitFor(() => expect(asks).toHaveLength(2));
    await asks[1].answer(true);

    changeR1();
    await waitFor(() => expect(asks).toHaveLength(3));
    await asks[2].answer(false);
    await waitFor(() => expect(header.result.current).toBe(false));
  });
});
