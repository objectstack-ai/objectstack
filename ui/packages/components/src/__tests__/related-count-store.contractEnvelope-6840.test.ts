/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedCountStore` reads a `find()` answer as `QueryResult` DECLARES it —
 * and does NOT read `count` (objectui#6840, following objectui#6726).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one count member:
 * `total`. Before this pin the store's count resolution read
 *
 *     typeof res?.total === 'number' ? res.total
 *       : typeof res?.count === 'number' ? res.count : ...
 *
 * — `count` SECOND, but still ahead of the contract's rows member `data`. That
 * is the same precedence inversion objectui#6726 removed for `records`, on the
 * key objectui#6726 did not measure, and this module is where it decides a
 * rendered number: the tab-strip badge on a record detail ("Contacts (12)").
 *
 * MEASURED on this tree (objectui#6840) — a producer sweep of its own, NOT
 * objectui#6726's `records` numbers, which say nothing about this key:
 *
 *   cell    every `find()` DEFINITION body in the repo (452 bodies / 331 files),
 *           bracket-scanned so a body cannot leak into sibling properties
 *   SUBJECT `count` emitted as an envelope key ....  0 hits /   0 files
 *   CONTROL `total` emitted as an envelope key ....  85 hits /  75 files
 *   CONTROL `data`  emitted as an envelope key ....  135 hits / 103 files
 *
 * The controls sit on the JOIN — the same cell the zero lives in, extracted by
 * the same pass — so the zero is a reading and not an unmeasured cell.
 *
 * `count` IS read below the adapter, on the raw payload, which is exactly why
 * nothing re-emits it above: `ObjectStackAdapter.normalizeQueryResult`
 * (`data-objectstack/src/index.ts:3382`) and `ApiDataSource.normalizeQueryResult`
 * (`core/src/adapters/ApiDataSource.ts:402`) both fold `count` into `total`
 * before returning. The store's `probe` is bound strictly ABOVE that fold —
 * `containers.tsx` hands it `(object, query) => ds.find(object, query)` — so the
 * arm was unreachable, and an unreachable tolerant arm is precisely where a
 * non-conforming producer would keep working unrejected (AGENTS.md #0.1).
 *
 * ⛔ The fix is the deletion, NOT widening `QueryResult` to bless `count` —
 * that is a published-type change and the maintainer's call (same floor as
 * objectui#6726).
 *
 * The live arms are pinned here as well, because live and dead is the whole
 * distinction: `total` (what `$count: true` asks the server for), `data`
 * (the contract's rows member), and the bare array.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelatedCountStore } from '../hooks/related-count-store';

/** Three rows, wrapped by whichever envelope the case is measuring. */
const ROWS = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

beforeEach(() => {
  RelatedCountStore._reset();
});

describe('RelatedCountStore — the find() envelope it counts from (objectui#6840)', () => {
  it('still prefers the server-side `total` — the reason `$count: true` is sent', async () => {
    const probe = vi.fn(async () => ({ total: 42, data: [{ id: 'c1' }] }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(42);
  });

  it("still counts the contract's `data` member", async () => {
    const probe = vi.fn(async () => ({ data: ROWS }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(3);
  });

  it('still counts a bare array — the live non-envelope shape fakes answer with', async () => {
    const probe = vi.fn(async () => ROWS);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(3);
  });

  it('does NOT count `count` — not a QueryResult member', async () => {
    const probe = vi.fn(async () => ({ count: 7 }) as never);
    // Before the fix this returned 7. The badge now reports the honest "no
    // countable answer" 0 rather than legitimising a second de-facto contract.
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(0);
  });

  it('does NOT let `count` OUTRANK `data` — the precedence inversion itself', async () => {
    // The sharp end: both members present and disagreeing. `data` is the
    // contract's, so 2 is the only correct answer; the pre-fix order answered 7.
    const probe = vi.fn(async () => ({ count: 7, data: [{ id: 'a' }, { id: 'b' }] }) as never);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(2);
  });

  it('does NOT let `count` OUTRANK a bare array either', async () => {
    // A bare array carries no `count`; this case exists so the deletion is
    // pinned on BOTH live rows shapes, not only the envelope one.
    const probe = vi.fn(async () => ROWS as never);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(3);
  });

  it('`total` still outranks `count` — unchanged, and the control for the two above', async () => {
    // Green before AND after the fix: it is the arm that was always correct.
    // Its presence is what makes the four refusals above a reading of THIS
    // deletion rather than of a store that stopped counting.
    const probe = vi.fn(async () => ({ total: 42, count: 7 }) as never);
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1')).toBe(42);
  });
});
