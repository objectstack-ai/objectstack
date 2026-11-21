/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36075 item 6 — `useRecordVerdict`, the three-state reading of
 * the same explain verdict `useRecordEditable` fails open on. The comment
 * panel offers Edit and Delete on other people's comments only on a definite
 * `true`, so every uncertainty must read `undefined`, never `true`; and
 * `useRecordEditable` must read exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRecordEditable, useRecordVerdict, __clearRecordEditableCache } from './useRecordEditable';

function mockExplain(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as any;
}

describe('useRecordVerdict (objectstack#36075)', () => {
  beforeEach(() => __clearRecordEditableCache());
  afterEach(() => vi.unstubAllGlobals());

  it('reads true on an allow and false on a refusal', async () => {
    vi.stubGlobal('fetch', mockExplain({ allowed: true, record: { recordId: 'r1', visible: true } }));
    const allowed = renderHook(() => useRecordVerdict('note', 'r1'));
    await waitFor(() => expect(allowed.result.current).toBe(true));
    __clearRecordEditableCache();
    vi.stubGlobal('fetch', mockExplain({ allowed: true, record: { recordId: 'r2', visible: false } }));
    const refused = renderHook(() => useRecordVerdict('note', 'r2'));
    await waitFor(() => expect(refused.result.current).toBe(false));
  });

  it('reads undefined, never true, while unanswered and on every uncertainty', async () => {
    let answer: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { answer = resolve; })) as any);
    const pending = renderHook(() => useRecordVerdict('note', 'r1'));
    expect(pending.result.current).toBeUndefined();
    answer({ ok: false, json: async () => ({}) });
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.result.current).toBeUndefined();

    __clearRecordEditableCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }) as any);
    const offline = renderHook(() => useRecordVerdict('note', 'r3'));
    await new Promise((r) => setTimeout(r, 0));
    expect(offline.result.current).toBeUndefined();

    __clearRecordEditableCache();
    vi.stubGlobal('fetch', mockExplain({ allowed: false }));
    const noRecordVerdict = renderHook(() => useRecordVerdict('note', 'r4'));
    await new Promise((r) => setTimeout(r, 0));
    expect(noRecordVerdict.result.current).toBeUndefined();
  });

  it('is a definite allow only when `allowed` holds beside `record.visible`, as the server admits', async () => {
    // An on-behalf-of session whose delegator is gone: the record reads
    // visible, the decision is still a refusal.
    vi.stubGlobal('fetch', mockExplain({ allowed: false, record: { recordId: 'r1', visible: true } }));
    const refused = renderHook(() => useRecordVerdict('note', 'r1'));
    await waitFor(() => expect(refused.result.current).toBe(false));

    __clearRecordEditableCache();
    vi.stubGlobal('fetch', mockExplain({ record: { recordId: 'r2', visible: true } }));
    const noAllowed = renderHook(() => useRecordVerdict('note', 'r2'));
    await new Promise((r) => setTimeout(r, 0));
    expect(noAllowed.result.current).toBeUndefined();
  });

  it('asks nothing and reads undefined when not enabled', () => {
    const fetchMock = mockExplain({ allowed: true, record: { recordId: 'r1', visible: true } });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRecordVerdict('note', 'r1', 'update', false));
    expect(result.current).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CONTROL: useRecordEditable still fails open on the same uncertainty', async () => {
    vi.stubGlobal('fetch', mockExplain({}, false));
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(true);
  });

  it('shares one question with useRecordEditable', async () => {
    const fetchMock = mockExplain({ allowed: true, record: { recordId: 'r1', visible: false } });
    vi.stubGlobal('fetch', fetchMock);
    const verdict = renderHook(() => useRecordVerdict('note', 'r1'));
    const editable = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(verdict.result.current).toBe(false));
    await waitFor(() => expect(editable.result.current).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
