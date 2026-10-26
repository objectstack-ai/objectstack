// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression (#3108): a multi-value lookup hydrated its committed ids with a
 * SERIAL `findOne` per id — 41 selected users meant 41 sequential round-trips,
 * during which the trigger rendered the bare "Select…" placeholder,
 * indistinguishable from having no value at all.
 *
 * Fixed behaviour under test:
 *  1. unresolved ids are fetched in ONE batched `$in` query (chunked), not
 *     one findOne per id;
 *  2. while hydration is in flight the trigger shows a loading indicator and
 *     the committed-value count instead of the empty placeholder;
 *  3. the loading state settles (falls back to placeholder) when hydration
 *     fails, instead of spinning forever.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { LookupField } from './LookupField';

afterEach(cleanup);

const USERS = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
  { id: 'u3', name: 'Margaret Hamilton' },
];

describe('LookupField — multi-value hydration batches and shows loading (#3108)', () => {
  it('hydrates several ids with one $in query instead of a findOne per id', async () => {
    const find = vi.fn(async (_obj: string, params: any) => {
      const wanted: any[] = params?.$filter?.id?.$in ?? [];
      return { data: USERS.filter((u) => wanted.includes(u.id)) };
    });
    const findOne = vi.fn(async () => null);
    render(
      <LookupField
        value={['u1', 'u2', 'u3']}
        onChange={() => {}}
        dataSource={{ find, findOne } as never}
        field={{ reference: 'sys_user', multiple: true } as never}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Margaret Hamilton')).toBeTruthy();

    // One batched round-trip, zero per-id GETs.
    expect(findOne).not.toHaveBeenCalled();
    const hydrationCalls = find.mock.calls.filter((c) => c[1]?.$filter?.id?.$in);
    expect(hydrationCalls).toHaveLength(1);
    expect(hydrationCalls[0][1].$filter.id.$in).toEqual(['u1', 'u2', 'u3']);
  });

  it('shows the committed count + spinner while hydration is in flight, never the empty placeholder', async () => {
    let resolveFind!: (v: any) => void;
    const find = vi.fn(
      () => new Promise((resolve) => { resolveFind = resolve; }),
    );
    render(
      <LookupField
        value={['u1', 'u2', 'u3']}
        onChange={() => {}}
        dataSource={{ find } as never}
        field={{ reference: 'sys_user', multiple: true } as never}
      />,
    );

    // In-flight: loading indicator + raw committed count, no "Select…".
    await waitFor(() => expect(screen.getByTestId('lookup-hydrating')).toBeTruthy());
    expect(screen.queryByText('Select…')).toBeNull();
    expect(screen.getByText(/3/)).toBeTruthy();

    resolveFind({ data: USERS });
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByTestId('lookup-hydrating')).toBeNull();
  });

  it('settles (no infinite spinner) when the hydration fetch fails', async () => {
    const find = vi.fn(async (_obj: string, params: any) => {
      if (params?.$filter?.id?.$in) throw new Error('boom');
      return { data: [] };
    });
    render(
      <LookupField
        value={['u1', 'u2']}
        onChange={() => {}}
        dataSource={{ find } as never}
        field={{ reference: 'sys_user', multiple: true } as never}
      />,
    );

    await waitFor(() => expect(find).toHaveBeenCalled());
    // The failed attempt is marked settled — the spinner clears instead of
    // spinning forever (pre-existing fallback: unresolvable ids drop).
    await waitFor(() => expect(screen.queryByTestId('lookup-hydrating')).toBeNull());
  });

  it('readonly mode shows the loading count instead of an empty value while hydrating', async () => {
    let resolveFind!: (v: any) => void;
    const find = vi.fn(
      () => new Promise((resolve) => { resolveFind = resolve; }),
    );
    render(
      <LookupField
        value={['u1', 'u2']}
        onChange={() => {}}
        readonly
        dataSource={{ find } as never}
        field={{ reference: 'sys_user', multiple: true } as never}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('lookup-hydrating')).toBeTruthy());

    resolveFind({ data: USERS.slice(0, 2) });
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
  });

  it('keeps the cheap findOne GET for a single unresolved primary id', async () => {
    const find = vi.fn(async () => ({ data: [] }));
    const findOne = vi.fn(async () => ({ id: 'u1', name: 'Ada' }));
    render(
      <LookupField
        value={['u1']}
        onChange={() => {}}
        dataSource={{ find, findOne } as never}
        field={{ reference: 'sys_user', multiple: true } as never}
      />,
    );
    await waitFor(() => expect(findOne).toHaveBeenCalledWith('sys_user', 'u1'));
  });
});
