/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useRecordSearch`'s `fieldReadPolicy` (objectui#10500): a hit is labelled
 * from its record with the fields the loaded policy denies removed, `id` and
 * `_id` kept, before any resolver reads the row.
 *
 * This package does not depend on `@object-ui/permissions`, so the policy here
 * is a plain object of the two members the hook reads (`isLoaded`,
 * `checkField`), the shape `usePermissions()` hands back. The app-shell
 * surfaces pin the same rule against the real `PermissionProvider`
 * (`CommandPalette.searchLabelFls-10500`, `SearchResultsPage.searchLabelFls-10500`,
 * `global-search.searchLabelFls-10500`).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRecordSearch } from '../useRecordSearch';

const OBJECT = 'contact_10500';
const RECORD = { id: 'K1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };
const FIELDS = {
  name: { label: 'Name', type: 'text' },
  email: { label: 'Email', type: 'text' },
  phone: { label: 'Phone', type: 'text' },
};

/** A loaded policy denying `denied` on the test object, and nothing elsewhere. */
function denying(...denied: string[]) {
  return {
    isLoaded: true,
    checkField: (object: string, field: string) => !(object === OBJECT && denied.includes(field)),
  };
}

function fanout() {
  return { find: vi.fn(async (_o: string, _q: unknown) => ({ data: [{ ...RECORD }] })) };
}

function searchAllNoTitle() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    searchAll: vi.fn(async (_q: string, _o?: unknown) => ({ hits: [{ object: OBJECT, id: 'K1', record: { ...RECORD } }] })),
  };
}

const PATHS: Array<[string, () => Record<string, unknown>]> = [
  ['the per-object `find` fanout', fanout],
  ['`searchAll` hits with no server title', searchAllNoTitle],
];

describe.each(PATHS)('objectui#10500 — useRecordSearch gates the labelled row, over %s', (_path, makeDs) => {
  it('hands the resolver the row without the denied field, `id` kept', async () => {
    const seen: unknown[] = [];
    const ds = makeDs();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS }];
    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'ada',
        objects,
        dataSource: ds,
        debounceMs: 0,
        getDisplayName: (_def, row) => {
          seen.push(row);
          return String(row?.email ?? row?.name ?? '');
        },
        fieldReadPolicy: denying('email'),
      }),
    );
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(seen).toEqual([{ id: 'K1', name: 'Ada Lovelace', phone: '555-0100' }]);
    expect(seen[0]).not.toBe(result.current.results[0].raw);
    expect(result.current.results[0].display).toBe('Ada Lovelace');
  });

  it('a denied `titleFormat` token falls through the default resolver to `name`', async () => {
    const ds = makeDs();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS, titleFormat: '{name} - {email}' }];
    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'ada',
        objects,
        dataSource: ds,
        debounceMs: 0,
        fieldReadPolicy: denying('email'),
      }),
    );
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].display).toBe('Ada Lovelace');
  });

  it('with every field denied, `id` included, the label is the `Record #<id>` floor', async () => {
    const ds = makeDs();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS }];
    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'ada',
        objects,
        dataSource: ds,
        debounceMs: 0,
        fieldReadPolicy: denying('id', 'name', 'email', 'phone'),
      }),
    );
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].display).toBe('Record #K1');
  });

  it('CONTROL: a policy that is not loaded hands the resolver the SAME row as served', async () => {
    const seen: unknown[] = [];
    const ds = makeDs();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS }];
    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'ada',
        objects,
        dataSource: ds,
        debounceMs: 0,
        getDisplayName: (_def, row) => {
          seen.push(row);
          return String(row?.email ?? '');
        },
        fieldReadPolicy: { isLoaded: false, checkField: () => false },
      }),
    );
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].display).toBe('ada@example.com');
    expect(seen[0]).toBe(result.current.results[0].raw);
  });
});

describe('objectui#10500 — when the read policy decides a run', () => {
  it('relabels the shown hits from the gated row once the policy loads', async () => {
    const ds = fanout();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS, titleFormat: '{email}' }];
    const { result, rerender } = renderHook(
      ({ loaded }: { loaded: boolean }) =>
        useRecordSearch({
          query: 'ada',
          objects,
          dataSource: ds,
          debounceMs: 0,
          fieldReadPolicy: loaded ? denying('email') : { isLoaded: false, checkField: () => true },
        }),
      { initialProps: { loaded: false } },
    );
    // Before the policy loads, the row is labelled as served.
    await waitFor(() => expect(result.current.results[0]?.display).toBe('ada@example.com'));

    rerender({ loaded: true });
    await waitFor(() => expect(result.current.results[0]?.display).toBe('Ada Lovelace'));
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('an inline policy object, new on every render, never re-runs the search', async () => {
    const ds = fanout();
    const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS }];
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useRecordSearch({
          query: 'ada',
          objects,
          dataSource: ds,
          debounceMs: 0,
          // A fresh object and function on every render, same `isLoaded`.
          fieldReadPolicy: { isLoaded: true, checkField: () => tick >= 0 },
        }),
      { initialProps: { tick: 0 } },
    );
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    rerender({ tick: 1 });
    rerender({ tick: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find).toHaveBeenCalledTimes(1);
  });
});
