/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `answered`: did the approvals read answer for THIS record (objectui#12220)?
 *
 * The record page keys its `approval_status` column fallback on this. The
 * hook's older `available` flag cannot carry it: it starts `true` before any
 * read lands and keeps its last value on a 5xx or a network failure, so an
 * empty 200, a read still in flight and a first read that failed all looked
 * the same. A framework composition without the approvals service answers the
 * list route `200 { data: [] }`, so "answered, nothing found" is the case a
 * stale `pending` in the column must not override.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRecordApprovals } from './useRecordApprovals';

type Reply = { status: number; body: unknown };

const OBJECT = 'account';
const RECORD = 'acc_1';

const PENDING_ROW = {
  id: 'req_1',
  process_name: 'flow:account_review',
  object_name: OBJECT,
  record_id: RECORD,
  status: 'pending',
  lock_record: true,
};

/** Route every GET through `reply`, which can be swapped mid-test. */
let reply: (url: string) => Reply | Promise<Reply>;
let gets: string[];

function stubFetch() {
  gets = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      gets.push(u);
      const r = await reply(u);
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

const listGets = () => gets.filter((u) => u.includes('/approvals/requests?object='));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRecordApprovals — `answered` (objectui#12220)', () => {
  it('(a) an empty 200 is an answered read: `answered` true, no pending request', async () => {
    reply = () => ({ status: 200, body: { data: [] } });
    stubFetch();
    const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));

    await waitFor(() => expect(result.current.answered).toBe(true));
    expect(result.current.available).toBe(true);
    expect(result.current.pendingRequest).toBeNull();
  });

  it('(a) a 200 carrying a pending request is answered too, with the request', async () => {
    reply = (u) =>
      u.endsWith(`/approvals/requests/${PENDING_ROW.id}`)
        ? { status: 200, body: PENDING_ROW }
        : { status: 200, body: { data: [PENDING_ROW] } };
    stubFetch();
    const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));

    await waitFor(() => expect(result.current.pendingRequest?.id).toBe('req_1'));
    expect(result.current.answered).toBe(true);
  });

  for (const status of [404, 501]) {
    it(`(b) an absent route (${status}) is not an answer: \`answered\` false, \`available\` false`, async () => {
      reply = () => ({ status, body: { code: 'NOT_FOUND' } });
      stubFetch();
      const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));

      await waitFor(() => expect(result.current.available).toBe(false));
      expect(result.current.answered).toBe(false);
    });
  }

  it('(c) a first read that fails with a 5xx is not an answer, while `available` still reads true', async () => {
    reply = () => ({ status: 500, body: { error: 'boom' } });
    stubFetch();
    const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));
    await act(async () => {
      await result.current.refresh();
    });

    expect(listGets().length).toBeGreaterThan(0);
    expect(result.current.answered).toBe(false);
    // The reason `available` cannot be the input: it never left its default.
    expect(result.current.available).toBe(true);

    // Control: the same hook, once the route answers, reads `answered`.
    reply = () => ({ status: 200, body: { data: [] } });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.answered).toBe(true);
  });

  it('(c) after a read answered, a later transient failure keeps the last answer', async () => {
    reply = (u) =>
      u.endsWith(`/approvals/requests/${PENDING_ROW.id}`)
        ? { status: 200, body: PENDING_ROW }
        : { status: 200, body: { data: [PENDING_ROW] } };
    stubFetch();
    const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));
    await waitFor(() => expect(result.current.pendingRequest?.id).toBe('req_1'));

    reply = () => ({ status: 503, body: { error: 'unavailable' } });
    const before = listGets().length;
    await act(async () => {
      await result.current.refresh();
    });

    expect(listGets().length).toBe(before + 1);
    expect(result.current.answered).toBe(true);
    expect(result.current.pendingRequest?.id).toBe('req_1');
  });

  it('is not answered while the first read is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply = async () => {
      await gate;
      return { status: 200, body: { data: [] } };
    };
    stubFetch();
    const { result } = renderHook(() => useRecordApprovals(OBJECT, RECORD));

    await waitFor(() => expect(listGets()).toHaveLength(1));
    expect(result.current.answered).toBe(false);

    release();
    await waitFor(() => expect(result.current.answered).toBe(true));
  });

  it('opening another record reads as unanswered until that record\'s own read lands', async () => {
    reply = () => ({ status: 200, body: { data: [] } });
    stubFetch();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRecordApprovals(OBJECT, id),
      { initialProps: { id: RECORD } },
    );
    await waitFor(() => expect(result.current.answered).toBe(true));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply = async () => {
      await gate;
      return { status: 200, body: { data: [] } };
    };
    rerender({ id: 'acc_2' });

    await waitFor(() => expect(listGets().some((u) => u.includes('recordId=acc_2'))).toBe(true));
    expect(result.current.answered).toBe(false);

    release();
    await waitFor(() => expect(result.current.answered).toBe(true));
  });
});
