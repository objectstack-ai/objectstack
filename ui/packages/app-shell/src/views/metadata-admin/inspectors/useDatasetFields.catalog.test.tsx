// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

/**
 * objectstack#5425. `useDatasetFieldCatalog` collapses its `include: string[]`
 * prop into one scalar so it can sit in a `React.useEffect` dependency array,
 * then expands it again inside the effect. That encode/decode pair used to be
 * `join` / `split` on a raw U+0000 byte — a byte that made this entire file
 * binary to grep, so nothing in it was findable by content search.
 *
 * The pair is now `JSON.stringify` / `JSON.parse`, which needs no "character the
 * data cannot contain" at all. These tests pin the behaviour that round-trip is
 * responsible for, because it is the only thing the swap could have broken:
 * which paths get walked, and when the effect re-runs.
 *
 * No control byte appears in this file, and none is needed to test the fix —
 * that is rather the point of the change.
 */

/**
 * The client identity must be STABLE across renders. The real
 * `useMetadataClient` memoizes with `useMemo`, and the effect under test lists
 * `client` in its dependency array — so a mock that returns a fresh object per
 * render re-runs the effect on every render, whose `setState` triggers the next
 * render. That is an unbounded loop that OOMs the worker rather than failing an
 * assertion, so the faithful mock is the only usable one here.
 */
const { get, client } = vi.hoisted(() => {
  const get = vi.fn();
  return { get, client: { get } };
});

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => client,
}));

import { useDatasetFieldCatalog } from './useDatasetFields';

/** Minimal object docs: an opportunity that looks up an account, which looks up a region. */
const DOCS: Record<string, Record<string, unknown>> = {
  opportunity: {
    label: 'Opportunity',
    fields: {
      amount: { type: 'currency', label: 'Amount' },
      account: { type: 'lookup', reference: 'account', label: 'Account' },
    },
  },
  account: {
    label: 'Account',
    fields: {
      name: { type: 'text', label: 'Account Name' },
      region: { type: 'lookup', reference: 'region', label: 'Region' },
    },
  },
  region: {
    label: 'Region',
    fields: { code: { type: 'text', label: 'Region Code' } },
  },
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (_type: string, name: string) => DOCS[name] ?? null);
});

afterEach(cleanup);

describe('useDatasetFieldCatalog — the include round-trip', () => {
  it('walks a single-hop include path and groups its fields', async () => {
    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', ['account']));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const values = result.current.fieldOptions.map((o) => o.value);
    expect(values).toContain('amount');
    expect(values).toContain('account.name');
    // The heading is every hop's relationship label plus the target object's
    // own label, so a single hop through "Account" onto the Account object
    // reads "Account → Account" (buildFieldOptions).
    expect(result.current.fieldOptions.find((o) => o.value === 'account.name')?.group).toBe('Account → Account');
  });

  it('walks a MULTI-hop path — the case the encode/decode pair exists for', async () => {
    // `a.b.field` is the ADR-0071 generalisation. If the round-trip mangled the
    // path (the real risk when a separator collides with the data), this is
    // where it shows: the second hop would never be fetched.
    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', ['account.region']));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const values = result.current.fieldOptions.map((o) => o.value);
    expect(values).toContain('account.region.code');
    expect(result.current.fieldOptions.find((o) => o.value === 'account.region.code')?.group).toBe(
      'Account → Region → Region',
    );
    expect(get).toHaveBeenCalledWith('object', 'region');
  });

  it('keeps several include paths distinct', async () => {
    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', ['account', 'account.region']));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const values = result.current.fieldOptions.map((o) => o.value);
    expect(values).toContain('account.name');
    expect(values).toContain('account.region.code');
  });

  it('treats an empty include list as "base object fields only"', async () => {
    // The old code guarded this with a ternary on the joined string, because
    // ''.split(sep) yields [''] rather than []. JSON.parse('[]') needs no guard,
    // but the observable behaviour must be identical.
    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', []));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.fieldOptions.map((o) => o.value)).toEqual(['amount', 'account']);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('re-runs when include CHANGES but not when it is merely a new array', async () => {
    // The whole reason the scalar key exists: `include` is a fresh array on
    // every render, so keying on it directly would refetch forever.
    const { result, rerender } = renderHook(({ include }) => useDatasetFieldCatalog('opportunity', include), {
      initialProps: { include: ['account'] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterFirst = get.mock.calls.length;

    // Same contents, new array identity -> no refetch.
    rerender({ include: ['account'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get.mock.calls.length).toBe(afterFirst);

    // Different contents -> refetch, and the new path resolves.
    rerender({ include: ['account.region'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get.mock.calls.length).toBeGreaterThan(afterFirst);
    expect(result.current.fieldOptions.map((o) => o.value)).toContain('account.region.code');
  });

  it('still resolves a path whose segment names contain a comma', async () => {
    // A regression guard aimed at the fix itself. The obvious repair for the
    // U+0000 separator is "use a printable character no name contains" — which
    // just relocates the collision. JSON has no such assumption, so a name that
    // contains the would-be separator must still round-trip.
    const docs = {
      ...DOCS,
      opportunity: {
        label: 'Opportunity',
        fields: { 'odd,name': { type: 'lookup', reference: 'account', label: 'Odd' } },
      },
    };
    get.mockImplementation(async (_t: string, name: string) => docs[name as keyof typeof docs] ?? null);

    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', ['odd,name']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.fieldOptions.map((o) => o.value)).toContain('odd,name.name');
  });

  it('falls back to an empty catalog when the base object cannot be read', async () => {
    get.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDatasetFieldCatalog('opportunity', ['account']));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.fieldOptions).toEqual([]);
    expect(result.current.relationships).toEqual([]);
  });
});
