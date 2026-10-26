/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedCountStore` reads a `find()` answer as `QueryResult` DECLARES it —
 * and does NOT read `records` (objectui#6726, following objectui#5945).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * Before this pin the store's row-count fallback read
 *
 *     Array.isArray(res?.records) ? res.records.length
 *       : Array.isArray(res?.data) ? res.data.length : ...
 *
 * — `records` FIRST, ahead of the contract's `data`. That is the same
 * precedence inversion objectui#5945 was filed about, and this module is where
 * it actually decides a rendered number: the tab-strip badge on a record detail
 * ("Contacts (12)").
 *
 * MEASURED on this tree, no producer emits `records` at the `DataSource.find()`
 * seam this store's `probe` is bound to (`containers.tsx` hands it
 * `(object, query) => ds.find(object, query)`):
 * `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK `records`
 * envelope and returns `{ data, total, page, pageSize, hasMore }`; every other
 * `find()` implementation in the repo returns `data` too. `ProbeFn` itself
 * never declared `records` either — only the `res: any` cast let it through.
 *
 * The two live arms are pinned here as well, because live and dead is the whole
 * distinction: `total` (what `$count: true` asks the server for) and the bare
 * array (what fakes at this seam really answer with).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelatedCountStore } from '../hooks/related-count-store';

/** Three rows, wrapped by whichever envelope the case is measuring. */
const ROWS = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

beforeEach(() => {
  RelatedCountStore._reset();
});

describe('RelatedCountStore — the find() envelope it counts from (objectui#6726)', () => {
  it("counts the contract's `data` member", async () => {
    const probe = vi.fn(async () => ({ data: ROWS }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(3);
  });

  it('still prefers the server-side `total` — the reason `$count: true` is sent', async () => {
    const probe = vi.fn(async () => ({ total: 42, data: [{ id: 'c1' }] }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(42);
  });

  it('still counts a bare array — the live non-envelope shape fakes answer with', async () => {
    const probe = vi.fn(async () => ROWS);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(3);
  });

  it('does NOT count `records` — not a QueryResult member', async () => {
    const probe = vi.fn(async () => ({ records: ROWS }) as never);
    // Before the fix this returned 3. The badge now reports the honest "no
    // countable answer" 0 rather than legitimising a second de-facto contract.
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(0);
  });

  it('does NOT let `records` OUTRANK `data` — the precedence inversion itself', async () => {
    // The sharp end of objectui#5945: both members present and disagreeing.
    // `data` is the contract's, so 1 is the only correct answer; the pre-fix
    // order answered 3.
    const probe = vi.fn(async () => ({ records: ROWS, data: [{ id: 'only' }] }) as never);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(1);
  });
});
