/**
 * ObjectUI — useRecordSearch Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRecordSearch } from '../useRecordSearch';

// FIXTURE TRIAGE (objectui#6557): `account` used to carry `titleField: 'name'`.
// That key is one `@objectstack/spec`'s object schema — a `strictObject` —
// REJECTS with `unrecognized_keys` (objectui#6531), so no legal object metadata
// can ship it, and nothing here ever read it: the display below resolves
// through `getRecordDisplayName`'s name-ish derivation with the key present or
// absent. It pinned nothing while reading as a producer. `titleFormat` on
// `contact` is the CONTROL — a declared key that does parse and does decide the
// display, so its assertions below still measure something.
const objects = [
  { name: 'account', label: 'Account' },
  { name: 'contact', label: 'Contact', titleFormat: '{{first_name}} {{last_name}}' },
  { name: 'opportunity', label: 'Opportunity', searchable: false },
];

function makeDataSource(byObject: Record<string, any[]>) {
  return {
    find: vi.fn(async (objectName: string, _q: any) => ({
      data: byObject[objectName] ?? [],
    })),
  };
}

describe('useRecordSearch', () => {
  it('returns empty results when query is shorter than minLength', async () => {
    const ds = makeDataSource({});
    const { result } = renderHook(() =>
      useRecordSearch({ query: 'a', objects, dataSource: ds, debounceMs: 0 }),
    );
    expect(result.current.results).toEqual([]);
    // Give a tick to confirm nothing fires.
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('returns empty results when disabled', async () => {
    const ds = makeDataSource({ account: [{ id: '1', name: 'Acme' }] });
    renderHook(() =>
      useRecordSearch({
        query: 'acme',
        objects,
        dataSource: ds,
        enabled: false,
        debounceMs: 0,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('fans out across searchable objects after debounce and aggregates hits', async () => {
    const ds = makeDataSource({
      account: [{ id: 'a1', name: 'Acme Corp' }],
      contact: [{ id: 'c1', first_name: 'Ada', last_name: 'Lovelace' }],
    });

    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'acme',
        objects,
        dataSource: ds,
        debounceMs: 10,
        topPerObject: 3,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
      expect(result.current.results.length).toBe(2);
    });

    expect(ds.find).toHaveBeenCalledTimes(2);
    expect(ds.find).toHaveBeenCalledWith('account', { $search: 'acme', $top: 3 });
    expect(ds.find).toHaveBeenCalledWith('contact', { $search: 'acme', $top: 3 });
    expect(ds.find).not.toHaveBeenCalledWith('opportunity', expect.anything());

    const names = result.current.results.map((h) => h.display).sort();
    expect(names).toEqual(['Acme Corp', 'Ada Lovelace']);
  });

  it('honors the objectNames whitelist', async () => {
    const ds = makeDataSource({
      account: [{ id: 'a1', name: 'Acme' }],
      contact: [{ id: 'c1', first_name: 'Ada', last_name: 'L' }],
    });

    renderHook(() =>
      useRecordSearch({
        query: 'acme',
        objects,
        dataSource: ds,
        objectNames: ['contact'],
        debounceMs: 0,
      }),
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledTimes(1);
    });
    expect(ds.find).toHaveBeenCalledWith('contact', expect.objectContaining({ $search: 'acme' }));
  });

  it('discards stale results when query changes mid-flight', async () => {
    const accountResolvers: Array<(v: any) => void> = [];
    const ds = {
      find: vi.fn((objectName: string, _query: any) => {
        if (objectName === 'account') {
          return new Promise((resolve) => {
            accountResolvers.push((v) => resolve(v));
          });
        }
        return Promise.resolve({ data: [] });
      }),
    };

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) =>
        useRecordSearch({
          query: q,
          objects,
          dataSource: ds,
          debounceMs: 0,
        }),
      { initialProps: { q: 'old' } },
    );

    // Wait for the first run to dispatch find('account').
    await waitFor(() => {
      expect(accountResolvers.length).toBe(1);
    });

    // Change query; this should bump runId so the in-flight 'old' run is stale.
    rerender({ q: 'newq' });

    // Wait for the newer run to also dispatch find('account').
    await waitFor(() => {
      expect(accountResolvers.length).toBe(2);
    });

    // Resolve the stale call FIRST with a STALE id, then the fresh call empty.
    accountResolvers[0]({ data: [{ id: 'STALE', name: 'Should-Be-Ignored' }] });
    accountResolvers[1]({ data: [] });

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });

    expect(result.current.results.some((h) => h.recordId === 'STALE')).toBe(false);
  });

  it('tolerates per-object errors via Promise.allSettled', async () => {
    const ds = {
      find: vi.fn((objectName: string) => {
        if (objectName === 'account') {
          return Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404 }));
        }
        return Promise.resolve({
          data: [{ id: 'c1', first_name: 'Ada', last_name: 'L' }],
        });
      }),
    };

    const { result } = renderHook(() =>
      useRecordSearch({ query: 'ada', objects, dataSource: ds, debounceMs: 0 }),
    );

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
      expect(result.current.results.length).toBe(1);
    });

    expect(result.current.results[0].display).toBe('Ada L');
    expect(result.current.error).toBeUndefined();
  });

  it('orders hits by relevance, not by object-fanout order', async () => {
    // Fanout puts `account` before `contact` (per the candidates list),
    // but a startsWith match in `contact` should still beat a substring
    // match in `account`.
    const ds = {
      find: vi.fn(async (objectName: string) => {
        if (objectName === 'account') {
          // substring match: "ad" appears in middle
          return { data: [{ id: 'a1', name: 'Big Trader Ad Co' }] };
        }
        if (objectName === 'contact') {
          // startsWith match
          return { data: [{ id: 'c1', first_name: 'Ada', last_name: 'L' }] };
        }
        return { data: [] };
      }),
    };

    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'ad',
        objects,
        dataSource: ds,
        debounceMs: 0,
      }),
    );

    await waitFor(() => {
      expect(result.current.results.length).toBe(2);
    });

    // contact (startsWith 'Ada L') should outrank account (substring).
    expect(result.current.results[0].display).toBe('Ada L');
    expect(result.current.results[0].score).toBeGreaterThan(result.current.results[1].score);
  });

  it('treats exact-id paste as the top hit', async () => {
    const ds = {
      find: vi.fn(async (objectName: string) => {
        if (objectName === 'account') {
          return {
            data: [
              { id: 'OPP-9999', name: 'Some unrelated thing' },
              { id: 'a2', name: 'Acme Corp' },
            ],
          };
        }
        return { data: [] };
      }),
    };

    const { result } = renderHook(() =>
      useRecordSearch({
        query: 'OPP-9999',
        objects,
        dataSource: ds,
        debounceMs: 0,
      }),
    );

    await waitFor(() => {
      expect(result.current.results.length).toBeGreaterThan(0);
    });

    expect(result.current.results[0].recordId).toBe('OPP-9999');
  });

  it('sends the query as $search (server-side full-text), not $filter', async () => {
    // ADR-0054 §6 / ADR-0061: the palette delegates matching to the backend via
    // `$search`; it must NOT silently fall back to a client-side `$filter`. The
    // hook also trims surrounding whitespace before it leaves the page.
    const ds = makeDataSource({ account: [{ id: 'a1', name: 'Acme Corp' }] });

    renderHook(() =>
      useRecordSearch({
        query: '  Acme  ',
        objects,
        dataSource: ds,
        objectNames: ['account'],
        topPerObject: 5,
        debounceMs: 0,
      }),
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledTimes(1);
    });

    const [calledName, calledQuery] = ds.find.mock.calls[0];
    expect(calledName).toBe('account');
    // Exactly the trimmed $search + $top — no $filter, no $search_fields, etc.
    expect(calledQuery).toEqual({ $search: 'Acme', $top: 5 });
  });

  it('re-fires $search as the (debounced) query changes', async () => {
    const ds = makeDataSource({ account: [{ id: 'a1', name: 'Acme' }] });

    const { rerender } = renderHook(
      ({ q }: { q: string }) =>
        useRecordSearch({
          query: q,
          objects,
          dataSource: ds,
          objectNames: ['account'],
          debounceMs: 0,
        }),
      { initialProps: { q: 'ac' } },
    );

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith('account', { $search: 'ac', $top: 3 });
    });

    rerender({ q: 'acme' });

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith('account', { $search: 'acme', $top: 3 });
    });
  });

  // ADR-0061 / framework #3371: when the data source exposes the unified global
  // search endpoint (`searchAll` → GET /api/v1/search), the palette must use it
  // instead of the per-object `find({ $search })` fanout — the fanout misses
  // records that only the global index knows about.
  describe('global searchAll endpoint', () => {
    function makeSearchDataSource(hits: any[]) {
      return {
        find: vi.fn(async () => ({ data: [] })),
        // The parameters are declared even though the body ignores them: the
        // hook calls `searchAll(term, { objects, limit })`, and a zero-arity
        // `vi.fn` types `mock.calls[0]` as the empty tuple `[]`, so every
        // `const [term, opts] = ...` below read `undefined` as far as the
        // compiler was concerned (objectui#4040).
        searchAll: vi.fn(
          async (
            _term: string,
            _options: { objects?: string[]; limit?: number },
          ) => ({ query: 'wayne', hits }),
        ),
      };
    }

    it('prefers searchAll and maps hits without fanning out to find', async () => {
      const ds = makeSearchDataSource([
        { object: 'account', id: 'a1', title: 'Wayne Enterprises', snippet: 'Wayne Enterprises' },
        { object: 'contact', id: 'c1', title: 'Bruce Wayne', record: { id: 'c1' } },
      ]);

      const { result } = renderHook(() =>
        useRecordSearch({ query: 'wayne', objects, dataSource: ds, debounceMs: 0 }),
      );

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false);
        expect(result.current.results.length).toBe(2);
      });

      expect(ds.searchAll).toHaveBeenCalledTimes(1);
      expect(ds.find).not.toHaveBeenCalled();

      const byId = Object.fromEntries(result.current.results.map((h) => [h.recordId, h]));
      expect(byId.a1.display).toBe('Wayne Enterprises');
      expect(byId.a1.objectName).toBe('account');
      expect(byId.a1.objectLabel).toBe('Account');
      expect(byId.c1.display).toBe('Bruce Wayne');
    });

    it('trims and forwards the whitelist as the objects scope', async () => {
      const ds = makeSearchDataSource([]);
      renderHook(() =>
        useRecordSearch({
          query: '  wayne  ',
          objects,
          dataSource: ds,
          objectNames: ['account', 'contact'],
          debounceMs: 0,
        }),
      );

      await waitFor(() => {
        expect(ds.searchAll).toHaveBeenCalledTimes(1);
      });
      const [term, opts] = ds.searchAll.mock.calls[0];
      expect(term).toBe('wayne');
      expect(opts.objects).toEqual(['account', 'contact']);
    });

    it('drops hits for objects outside the candidate whitelist', async () => {
      // Server ignored our `objects` filter and returned an out-of-scope object.
      const ds = makeSearchDataSource([
        { object: 'account', id: 'a1', title: 'Wayne Enterprises' },
        { object: 'secret_object', id: 's1', title: 'Should be hidden' },
      ]);

      const { result } = renderHook(() =>
        useRecordSearch({
          query: 'wayne',
          objects,
          dataSource: ds,
          objectNames: ['account'],
          debounceMs: 0,
        }),
      );

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false);
      });
      expect(result.current.results.map((h) => h.objectName)).toEqual(['account']);
    });

    it('floats an exact-id paste above the server ranking', async () => {
      const ds = makeSearchDataSource([
        { object: 'account', id: 'a1', title: 'Alpha' },
        { object: 'account', id: 'OPP-42', title: 'Unrelated name' },
      ]);

      const { result } = renderHook(() =>
        useRecordSearch({ query: 'OPP-42', objects, dataSource: ds, debounceMs: 0 }),
      );

      await waitFor(() => {
        expect(result.current.results.length).toBe(2);
      });
      expect(result.current.results[0].recordId).toBe('OPP-42');
    });

    it('surfaces searchAll errors and clears results', async () => {
      const ds = {
        find: vi.fn(),
        searchAll: vi.fn(async () => {
          throw new Error('index unavailable');
        }),
      };

      const { result } = renderHook(() =>
        useRecordSearch({ query: 'wayne', objects, dataSource: ds, debounceMs: 0 }),
      );

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false);
        expect(result.current.error?.message).toBe('index unavailable');
      });
      expect(result.current.results).toEqual([]);
      expect(ds.find).not.toHaveBeenCalled();
    });

    // Regression: `maxObjectsQueried` caps the FANOUT (one request per
    // object), not the single-request searchAll scope. It used to truncate
    // the candidate pool itself, so ⌘K silently searched only the first 8
    // nav objects — records in every later object were unfindable.
    it('sends the full whitelist to searchAll, beyond maxObjectsQueried', async () => {
      const manyObjects = Array.from({ length: 20 }, (_, i) => ({
        name: `obj_${String(i).padStart(2, '0')}`,
        label: `Obj ${i}`,
      }));
      const ds = {
        find: vi.fn(),
        // Parameters declared for the same reason as `makeSearchDataSource`
        // above — a zero-arity `vi.fn` makes `mock.calls[0]` the empty tuple,
        // and the `opts.objects` assertion below is the whole regression.
        searchAll: vi.fn(
          async (
            _term: string,
            _options: { objects?: string[]; limit?: number },
          ) => ({ hits: [] }),
        ),
      };

      renderHook(() =>
        useRecordSearch({
          query: 'wayne',
          objects: manyObjects,
          objectNames: manyObjects.map((o) => o.name),
          dataSource: ds,
          debounceMs: 0,
          maxObjectsQueried: 8,
        }),
      );

      await waitFor(() => {
        expect(ds.searchAll).toHaveBeenCalledTimes(1);
      });
      const [, opts] = ds.searchAll.mock.calls[0];
      expect(opts.objects).toHaveLength(20);
      expect(ds.find).not.toHaveBeenCalled();
    });

    it('still caps the per-object fanout at maxObjectsQueried', async () => {
      const manyObjects = Array.from({ length: 20 }, (_, i) => ({
        name: `obj_${String(i).padStart(2, '0')}`,
        label: `Obj ${i}`,
      }));
      const ds = {
        find: vi.fn(async () => ({ data: [] })),
        // no searchAll — forces the fanout fallback
      };

      const { result } = renderHook(() =>
        useRecordSearch({
          query: 'wayne',
          objects: manyObjects,
          objectNames: manyObjects.map((o) => o.name),
          dataSource: ds,
          debounceMs: 0,
          maxObjectsQueried: 8,
        }),
      );

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false);
      });
      expect(ds.find).toHaveBeenCalledTimes(8);
    });
  });
});

/**
 * objectui#6557 — the candidate signature is the memo key that decides when the
 * cross-object fanout re-runs. It used to append `o?.titleField ?? ''` to every
 * entry.
 *
 * BOTH DIRECTIONS are pinned here, because proving only the first is
 * evidence-identical to having broken change detection outright:
 *
 *  - THE FIX: a new `objects` array whose only difference is the
 *    contract-rejected `titleField` no longer re-runs the fanout. Restore the
 *    old signature line and this case goes RED (the key changes the string, so
 *    the effect refires).
 *  - THE CONTROLS: a real change (a candidate NAME) still refires, and a new
 *    array with identical content still does not. Both are green in either
 *    world — which is what makes them controls rather than a second copy of the
 *    first assertion.
 */
describe('candidate signature (objectui#6557)', () => {
  const base = [
    { name: 'account', label: 'Account' },
    { name: 'contact', label: 'Contact' },
  ];
  /** Fresh array + fresh element identities, so only CONTENT can be the cause. */
  const clone = (extra: Record<string, unknown> = {}) => base.map((o) => ({ ...o, ...extra }));

  async function mounted(ds: any) {
    const view = renderHook(
      ({ objects }: { objects: any[] }) =>
        useRecordSearch({ query: 'acme', objects, dataSource: ds, debounceMs: 0 }),
      { initialProps: { objects: clone() } },
    );
    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledTimes(2);
    });
    ds.find.mockClear();
    return view;
  }

  it('does NOT re-run when the only difference is the contract-rejected `titleField`', async () => {
    const ds = makeDataSource({});
    const { rerender } = await mounted(ds);

    // `@objectstack/spec`'s object schema REJECTS this key with
    // `unrecognized_keys`, so this array is not metadata any producer could
    // ship — it is the shape the deleted half of the signature was reacting to.
    rerender({ objects: clone({ titleField: 'headline' }) });
    await new Promise((r) => setTimeout(r, 30));

    expect(ds.find).not.toHaveBeenCalled();
  });

  it('CONTROL: a new array with identical content still does not re-run', async () => {
    const ds = makeDataSource({});
    const { rerender } = await mounted(ds);

    rerender({ objects: clone() });
    await new Promise((r) => setTimeout(r, 30));

    expect(ds.find).not.toHaveBeenCalled();
  });

  it('CONTROL: a changed candidate NAME still re-runs the fanout', async () => {
    const ds = makeDataSource({});
    const { rerender } = await mounted(ds);

    rerender({ objects: [{ name: 'account', label: 'Account' }, { name: 'lead', label: 'Lead' }] });

    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith('lead', expect.objectContaining({ $search: 'acme' }));
    });
  });
});

/**
 * `getDisplayName` is a published, caller-supplied option (objectui#10044). It
 * is read INSIDE a run — to label hits — and never decides WHETHER a run
 * happens, so its identity must not key the search effect (AGENTS.md §5
 * commandment #10). The obvious spelling for an optional callback is an inline
 * arrow, which is a new function on every render; keyed on it, the effect's
 * cleanup cleared the pending debounce timer on each render.
 *
 * Every case here FORCES a fresh resolver identity on each render: a
 * module-level function (the only spelling the in-repo callers use) has a
 * stable identity and passes identically on defect and fix.
 */
describe('caller-supplied getDisplayName identity (objectui#10044)', () => {
  const debounceMs = 100;

  function setup() {
    const ds = makeDataSource({ account: [{ id: 'a1', name: 'Acme Corp' }] });
    const view = renderHook(
      ({ query, label }: { query: string; label: string }) =>
        useRecordSearch({
          query,
          objects,
          dataSource: ds,
          debounceMs,
          objectNames: ['account'],
          // Inline on purpose: a new function identity on every render.
          getDisplayName: (_obj: any, record: any) => `${label}:${record.name}`,
        }),
      { initialProps: { query: 'acme', label: 'v1' } },
    );
    return { ds, ...view };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-renders faster than debounceMs still search once the debounce elapses', async () => {
    vi.useFakeTimers();
    const { ds, rerender } = setup();

    // 10 renders, 40ms apart: 400ms of continuous re-rendering, four times the
    // debounce window, with nothing but the resolver identity changing.
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      rerender({ query: 'acme', label: 'v1' });
    }

    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('a sparse re-render issues no second identical request', async () => {
    vi.useFakeTimers();
    const { ds, rerender, result } = setup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMs + 10);
    });
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(result.current.results.map((h) => h.display)).toEqual(['v1:Acme Corp']);

    rerender({ query: 'acme', label: 'v1' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMs * 3);
    });

    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: the next run labels hits with the latest resolver', async () => {
    vi.useFakeTimers();
    const { ds, rerender, result } = setup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMs + 10);
    });
    expect(result.current.results.map((h) => h.display)).toEqual(['v1:Acme Corp']);

    // A resolver swap plus a real input change: the run the query change
    // triggers must read the resolver of the render that armed it.
    rerender({ query: 'acme corp', label: 'v2' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMs + 10);
    });

    expect(ds.find).toHaveBeenCalledTimes(2);
    expect(result.current.results.map((h) => h.display)).toEqual(['v2:Acme Corp']);
  });
});
