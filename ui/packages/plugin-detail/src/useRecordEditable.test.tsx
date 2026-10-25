/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#3821 — the record-level write gate behind the detail header's
 * Edit / Delete CTAs.
 *
 * A record shared READ-ONLY lives inside an object the user may otherwise edit,
 * so object-level permissions said "yes" and the header offered Edit; the user
 * only found out at save time, via a 403. The gate asks the explain engine for
 * the row-level verdict instead.
 *
 * Every uncertainty must fail OPEN — a courtesy hint may never be the reason a
 * permitted user cannot act. The server is the authority (the framework's
 * ADR-0124 D1 — server enforces, client is courtesy).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { useRecordEditable, __clearRecordEditableCache } from './useRecordEditable';
import type { DataSource } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are placeholders for a provider that merely has to EXIST, and one probe
 * that pins the empty-object case by name.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

function mockExplain(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as any;
}

describe('useRecordEditable', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables the action when the record-level verdict says no', async () => {
    vi.stubGlobal('fetch', mockExplain({ allowed: true, record: { recordId: 'r1', visible: false } }));
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('keeps the action when the record-level verdict says yes', async () => {
    vi.stubGlobal('fetch', mockExplain({ allowed: true, record: { recordId: 'r1', visible: true } }));
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('asks about the requested operation and record', async () => {
    const fetchMock = mockExplain({ record: { recordId: 'r1', visible: true } });
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useRecordEditable('note', 'r1', 'delete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ object: 'note', operation: 'delete', recordId: 'r1' });
  });

  it('fails open on a non-OK response (401 / 403 / 501 deployments)', async () => {
    vi.stubGlobal('fetch', mockExplain({}, false));
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('fails open when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }) as any);
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('fails open when the report carries no record verdict', async () => {
    vi.stubGlobal('fetch', mockExplain({ allowed: false }));
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('does not call explain when disabled — the object-level gate already decided', async () => {
    const fetchMock = mockExplain({ record: { recordId: 'r1', visible: false } });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRecordEditable('note', 'r1', 'update', false));
    expect(result.current).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call explain without an object or a record id', async () => {
    const fetchMock = mockExplain({});
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useRecordEditable(undefined, 'r1'));
    renderHook(() => useRecordEditable('note', undefined));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── framework#3923 ② — the probe must be AUTHENTICATED ──────────────────
  //
  // It shipped as a bare `fetch(..., {credentials:'include'})`. A bearer-token
  // session keeps its credential in the `Authorization` header, not a cookie, so
  // every probe came back 401 on a perfectly valid admin session and the verdict
  // always failed open — the hook was inert in exactly the deployments it was
  // written for. Route it through the host's authenticated fetch instead.
  it('uses the host apiFetch when a SchemaRendererProvider supplies one', async () => {
    const hostFetch = mockExplain({ record: { recordId: 'r1', visible: false } });
    const globalFetch = mockExplain({ record: { recordId: 'r1', visible: true } });
    vi.stubGlobal('fetch', globalFetch);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SchemaRendererProvider dataSource={{} as unknown as DataSource} apiFetch={hostFetch}>
        {children}
      </SchemaRendererProvider>
    );
    const { result } = renderHook(() => useRecordEditable('note', 'r1'), { wrapper });

    await waitFor(() => expect(result.current).toBe(false));
    expect(hostFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(hostFetch.mock.calls[0][0]).toBe('/api/v1/security/explain');
  });

  it('falls back to the global fetch in a standalone embed (no provider)', async () => {
    const globalFetch = mockExplain({ record: { recordId: 'r1', visible: false } });
    vi.stubGlobal('fetch', globalFetch);
    const { result } = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(result.current).toBe(false));
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it('memoises the verdict so revisiting a record costs nothing', async () => {
    const fetchMock = mockExplain({ record: { recordId: 'r1', visible: false } });
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useRecordEditable('note', 'r1'));
    await waitFor(() => expect(first.result.current).toBe(false));

    const second = renderHook(() => useRecordEditable('note', 'r1'));
    expect(second.result.current).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
