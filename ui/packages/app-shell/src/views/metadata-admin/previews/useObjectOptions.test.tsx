// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10585 — `useObjectOptions` tells a failed fetch apart from a catalog
 * that answered with no objects.
 *
 * Both leave `options: []` with `loading: false`; before this card nothing
 * else was returned, so a caller could not tell the two apart and made the
 * claims of an answered roster ("not published", "publish an object") on a
 * failure. The hook now publishes `error`, spelled the way `useObjectFields`
 * spells it, so `rosterFrom({ loading, error })` reads both hooks alike.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: {
    list: vi.fn(async (): Promise<unknown[]> => []),
  },
}));

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { useObjectOptions } from './useObjectOptions';

afterEach(cleanup);

describe('useObjectOptions — failure is its own fact (objectui#10585)', () => {
  it('a rejected `client.list` sets `error` to the cause, with `loading` false and no options', async () => {
    state.metadataClient.list.mockImplementationOnce(async () => {
      throw new Error('503 Service Unavailable');
    });
    const { result } = renderHook(() => useObjectOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('503 Service Unavailable');
    expect(result.current.options).toEqual([]);
  });

  it('a resolved EMPTY list leaves `error` null — an answer, not a failure', async () => {
    state.metadataClient.list.mockImplementationOnce(async () => []);
    const { result } = renderHook(() => useObjectOptions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.options).toEqual([]);
  });

  it('in flight, `error` is null and `loading` is true', () => {
    state.metadataClient.list.mockImplementationOnce(() => new Promise<unknown[]>(() => {}));
    const { result } = renderHook(() => useObjectOptions());

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
