/**
 * ObjectUI — useSettledSchema Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#6482: the settled-schema RESOLUTION half shared across
 * ObjectKanban / ObjectView / ObjectCalendar's hand copies, extracted so the
 * shape those three already got right (and objectui#6014/#6481's ObjectTree
 * did not) is structural rather than conventional.
 *
 * The acceptance bar this file exists to demonstrate (per the maintainer
 * ruling): `ready` and `def` cannot be observed inconsistently, and a STALE
 * key can never read as ready — the exact defect objectui#6481 shipped by
 * carrying "settled" as a second, independent boolean.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSettledSchema } from '../useSettledSchema';

/** A deferred promise, so a test controls exactly when a fetch resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSettledSchema', () => {
  it('settles immediately with ready=true, def=null when dataSource is undefined', async () => {
    const { result } = renderHook(() => useSettledSchema('accounts', undefined));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toBeNull();
  });

  it('settles immediately with ready=true, def=null when the key is empty', async () => {
    const ds: any = { getObjectSchema: vi.fn().mockResolvedValue({ fields: {} }) };
    const { result } = renderHook(() => useSettledSchema('', ds));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toBeNull();
    expect(ds.getObjectSchema).not.toHaveBeenCalled();
  });

  it('settles immediately with ready=true, def=null when dataSource has no getObjectSchema', async () => {
    const ds: any = { find: vi.fn() };
    const { result } = renderHook(() => useSettledSchema('accounts', ds));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toBeNull();
  });

  it('is NOT ready while the fetch is in flight, then resolves with the definition', async () => {
    const d = deferred<any>();
    const ds: any = { getObjectSchema: vi.fn().mockReturnValue(d.promise) };

    const { result } = renderHook(() => useSettledSchema('accounts', ds));

    // Not ready yet — the fetch is still pending.
    expect(result.current.ready).toBe(false);
    expect(result.current.def).toBeNull();

    await act(async () => {
      d.resolve({ fields: { name: { type: 'text' } } });
      await d.promise;
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toEqual({ fields: { name: { type: 'text' } } });
    expect(ds.getObjectSchema).toHaveBeenCalledWith('accounts');
  });

  it('settles with def=null (ready=true) when the fetch throws — "settled with nothing" is not "not ready"', async () => {
    const d = deferred<any>();
    const ds: any = { getObjectSchema: vi.fn().mockReturnValue(d.promise) };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSettledSchema('accounts', ds));
    expect(result.current.ready).toBe(false);

    await act(async () => {
      d.reject(new Error('boom'));
      await d.promise.catch(() => {});
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toBeNull();
    consoleError.mockRestore();
  });

  // ---------------------------------------------------------------------
  // The acceptance bar: a stale key can never read as ready.
  // ---------------------------------------------------------------------

  it('objectui#6481 unwritable: switching keys while a fetch is in flight reads NOT ready in the SAME render — never the old key\'s def', async () => {
    const accountsFetch = deferred<any>();
    const contactsFetch = deferred<any>();
    const ds: any = {
      getObjectSchema: vi.fn((key: string) =>
        key === 'accounts' ? accountsFetch.promise : contactsFetch.promise,
      ),
    };

    const { result, rerender } = renderHook(
      ({ key }) => useSettledSchema(key, ds),
      { initialProps: { key: 'accounts' } },
    );

    // Settle the FIRST key while it is still current.
    await act(async () => {
      accountsFetch.resolve({ fields: { accountName: {} } });
      await accountsFetch.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toEqual({ fields: { accountName: {} } });

    // Switch keys. The new key's fetch has NOT resolved yet — this is the
    // exact window objectui#6481's bare `schemaSettled` boolean got wrong:
    // it stayed `true` from the 'accounts' settle, so a gated effect reading
    // it would see "ready" while `objectSchema` still held ACCOUNTS' fields,
    // for a key that is now CONTACTS.
    rerender({ key: 'contacts' });

    // Must read as NOT ready — synchronously, in the render right after the
    // key changed, with no need for the new fetch to complete first — and
    // `def` must NOT be leaking the previous ('accounts') definition.
    expect(result.current.ready).toBe(false);
    expect(result.current.def).toBeNull();

    // Now settle the new key. `ready` flips true again, keyed to 'contacts'.
    await act(async () => {
      contactsFetch.resolve({ fields: { contactName: {} } });
      await contactsFetch.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toEqual({ fields: { contactName: {} } });
  });

  it('a late resolution for an ABANDONED key never lands — the current key\'s resolution is never clobbered by a stale one arriving out of order', async () => {
    const accountsFetch = deferred<any>();
    const contactsFetch = deferred<any>();
    const ds: any = {
      getObjectSchema: vi.fn((key: string) =>
        key === 'accounts' ? accountsFetch.promise : contactsFetch.promise,
      ),
    };

    const { result, rerender } = renderHook(
      ({ key }) => useSettledSchema(key, ds),
      { initialProps: { key: 'accounts' } },
    );

    // Switch away from 'accounts' before its fetch ever resolves.
    rerender({ key: 'contacts' });
    expect(result.current.ready).toBe(false);

    // Settle 'contacts' FIRST.
    await act(async () => {
      contactsFetch.resolve({ fields: { contactName: {} } });
      await contactsFetch.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toEqual({ fields: { contactName: {} } });

    // The ABANDONED 'accounts' fetch now resolves, late. Its effect's
    // cleanup already ran (key changed), so its `isMounted` closure is
    // false — this write must be dropped, not overwrite 'contacts'.
    await act(async () => {
      accountsFetch.resolve({ fields: { accountName: {} } });
      await accountsFetch.promise.catch(() => {});
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.def).toEqual({ fields: { contactName: {} } });
  });

  it('does not call setState after unmount when a fetch resolves late', async () => {
    const d = deferred<any>();
    const ds: any = { getObjectSchema: vi.fn().mockReturnValue(d.promise) };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useSettledSchema('accounts', ds));
    unmount();

    await act(async () => {
      d.resolve({ fields: {} });
      await d.promise;
    });

    // No React "state update on an unmounted component" warning.
    const reactWarning = consoleError.mock.calls.some((args) =>
      String(args[0] ?? '').includes('unmounted'),
    );
    expect(reactWarning).toBe(false);
    consoleError.mockRestore();
  });

  it('re-fetches when dataSource identity changes even if the key does not', async () => {
    const dsA: any = { getObjectSchema: vi.fn().mockResolvedValue({ fields: { a: {} } }) };
    const dsB: any = { getObjectSchema: vi.fn().mockResolvedValue({ fields: { b: {} } }) };

    const { result, rerender } = renderHook(
      ({ ds }) => useSettledSchema('accounts', ds),
      { initialProps: { ds: dsA } },
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.def).toEqual({ fields: { a: {} } });

    rerender({ ds: dsB });
    // Ready flips false the instant the source changes, same mechanism as a
    // key change — there is only ever one comparison, `resolution.key === key`,
    // gated additionally by the effect re-running on a NEW `dataSource`.
    await waitFor(() => expect(result.current.def).toEqual({ fields: { b: {} } }));
    expect(dsB.getObjectSchema).toHaveBeenCalledWith('accounts');
  });
});
