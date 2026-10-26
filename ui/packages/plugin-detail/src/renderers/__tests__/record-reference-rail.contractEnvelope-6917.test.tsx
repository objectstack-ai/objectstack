/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reference rail counts a `find()` answer as `QueryResult` DECLARES it —
 * and does NOT read `count` (objectui#6917 arm B, following objectui#6840).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one count member:
 * `total`. Before this pin the rail's count resolution read
 *
 *     typeof res?.total === 'number' ? res.total
 *       : typeof res?.count === 'number' ? res.count
 *       : items.length;
 *
 * — the SAME ladder objectui#6840 deleted from `RelatedCountStore`, in a module
 * that card was not fenced to touch. It decides a rendered number: the count
 * badge on each rail card.
 *
 * MEASURED on this tree for objectui#6917 — its OWN producer census, NOT
 * objectui#6840's numbers. That zero is seam-local and says nothing here; the
 * same sweep that read 0 producers for `value` at `ObjectView`'s seam read 5 at
 * `extractRecords`' seam (objectui#6839), in one pass.
 *
 *   CELL      every `find()` producer body in the repo, bracket-scanned
 *             through chained calls .........................  592 producers
 *   CONTROL   `data`  emitted as an envelope member .........  312 producers
 *   CONTROL   `total` emitted as an envelope member .........  150 producers
 *   SUBJECT   `count` emitted as an envelope member ........     0 producers
 *
 * The controls sit on the JOIN — same cell, same pass, same extraction — so the
 * zero is a reading and not an unmeasured cell. Superset sweep as well: of the
 * 418 files holding a `find()` producer, 25 contain the token `count:`
 * anywhere, and every one is the DataSource's own sibling `count()` method, a
 * row field, an i18n interpolation parameter, an aggregate function name, React
 * state, a DOM assertion, a comment, or objectui#6840's own refusal pin — none
 * an envelope member.
 *
 * `'@odata.count'` is a DIFFERENT key and does not answer this question:
 * `res?.count` cannot read it. Two producers emit it (both plugin-grid
 * fixtures, repaired on this same card).
 *
 * `count` IS read below the adapter, which is exactly why nothing re-emits it
 * above: `ObjectStackAdapter.normalizeQueryResult` and
 * `ApiDataSource.normalizeQueryResult` both fold `count` into `total` before
 * returning. This rail calls `dataSource.find()` strictly ABOVE that fold, so
 * the arm was unreachable — and an unreachable tolerant arm is precisely where
 * a non-conforming producer keeps working unrejected (AGENTS.md #0.1).
 *
 * ⛔ The fix is the deletion, NOT widening `QueryResult` to bless `count` —
 * a published-type change and the maintainer's call (the floor objectui#6726,
 * #6840 and #6839 all held).
 *
 * The live arms are pinned here too, because live and dead is the whole
 * distinction: `total` (what `$count: true` asks the server for), the
 * `data` row count, and the bare array.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { RecordContextProvider } from '@object-ui/react';

import { RecordReferenceRailRenderer } from '../record-reference-rail';

/** The rail gates its queries on an IntersectionObserver. Report intersecting
 *  immediately so the fetch effect runs deterministically under jsdom. */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const ROWS = [{ id: 'c1', name: 'Ada' }, { id: 'c2', name: 'Grace' }, { id: 'c3', name: 'Alan' }];

/**
 * Render one rail entry against a `find()` answering `answer`, and return the
 * badge's text. The badge is read by CLASS, not by its digits: a total that
 * happens to equal a row's text would make a `getByText` query ambiguous, and
 * `queryByText` throws on multiple matches just as it does on none.
 */
async function badgeFor(answer: unknown): Promise<string> {
  const dataSource = { find: vi.fn(async () => answer) };
  const { container } = render(
    <MemoryRouter>
      <RecordContextProvider objectName="account" recordId="A1" dataSource={dataSource as any}>
        <RecordReferenceRailRenderer
          schema={{
            // `hideEmpty: false` so a zero-total entry still renders its card
            // instead of folding into the "+ N more (empty)" chip — the
            // refusal cases below are precisely the zero-total ones.
            hideEmpty: false,
            entries: [{ objectName: 'contact', relationshipField: 'account_id', title: 'Contacts' }],
          }}
        />
      </RecordContextProvider>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(container.querySelector('.tabular-nums')).not.toBeNull();
  });
  return container.querySelector('.tabular-nums')!.textContent ?? '';
}

describe('reference rail find() envelope — objectui#6917', () => {
  it('still prefers the server-side `total` — the reason `$count: true` is sent', async () => {
    expect(await badgeFor({ total: 42, data: [{ id: 'c1' }] })).toBe('42');
  });

  it("still counts the contract's `data` member", async () => {
    expect(await badgeFor({ data: ROWS })).toBe('3');
  });

  it('still counts a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await badgeFor(ROWS)).toBe('3');
  });

  it('does NOT count `count` — not a QueryResult member', async () => {
    // Before the fix this badge read 7. It now reports the honest "no
    // countable answer" 0 rather than legitimising a second de-facto contract.
    expect(await badgeFor({ count: 7 })).toBe('0');
  });

  it('does NOT let `count` OUTRANK the `data` row count', async () => {
    // Both members present and disagreeing. `data` is the contract's, so 2 is
    // the only correct answer; the pre-fix ladder answered 7.
    expect(await badgeFor({ count: 7, data: [{ id: 'a' }, { id: 'b' }] })).toBe('2');
  });

  it('`total` still outranks `count` — unchanged, and the control for the two above', async () => {
    // Green before AND after the fix: the arm that was always correct. Its
    // presence is what makes the two refusals above a reading of THIS deletion
    // rather than of a rail that stopped counting.
    expect(await badgeFor({ total: 42, count: 7 })).toBe('42');
  });
});
