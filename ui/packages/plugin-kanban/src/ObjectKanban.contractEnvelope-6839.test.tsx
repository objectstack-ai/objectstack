/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectKanban` reads its `find()` answer as `QueryResult` DECLARES it — and
 * does NOT read `records` (objectui#6839).
 *
 * ## Why per module, when the read lives in ONE shared helper
 *
 * The board unwraps through `extractRecords` (`@object-ui/core`). A repo-wide
 * "nothing reads `records`" assertion would pass over a module that unwrapped
 * the envelope itself instead — as `plugin-list`'s `ListView` still does — so
 * what this file measures is the ROUTE, at the cards.
 *
 * ## This module is where the `value` arm is LIVE, which is why it is asserted
 *
 * `value` is not a leftover here: THREE `find()` doubles in this package answer
 * `{ value: [...] }` today, and objectui#6840 (which deleted `value` from
 * `ObjectView`'s own ladder on a zero at THAT seam) said in as many words that
 * its zero must not be carried to this one. So the `value` case below is a
 * NON-REGRESSION case — it is what refuses an `extractRecords` that answers
 * `[]` for everything, an implementation strictly worse than the bug.
 *
 * MEASURED for this module: no `find()` in `plugin-kanban`, nor in any app or
 * example mounting a board, emits a `records` envelope. The package's four
 * `records:` object literals are a doc comment, an authoring-metadata
 * description, and two record-VISIBILITY batch route stubs (`fetch`, not
 * `find`). CONTROL, so the zero is a reading: the same sweep finds a live
 * `find()` double emitting `{ records: [...] }` at `plugin-list`'s
 * ObjectGallery, a consumer with its own unwrap ladder.
 *
 * ## ⭐ Why the two outcomes wait DIFFERENTLY (objectui#8532)
 *
 * This file used to hand all four cases one wait, tuned for the refusal — and
 * it went red on `main` on PRs that cannot reach `plugin-kanban` at all.
 *
 * The wait was `waitFor(() => screen.queryByText('Negotiation'))`, and its own
 * docblock called that a MOUNT signal rather than a rows signal. MEASURED here,
 * the header is weaker still: it is not a first-paint signal either. The board
 * reaches `KanbanImpl` through `React.lazy(() => import('./KanbanImpl'))` behind
 * a `Suspense` (`src/index.tsx`), so at `render`, at `find` being CALLED, and at
 * `find` being SETTLED the header is still absent — it appears only when that
 * chunk resolves. `KanbanImpl` then mirrors its `columns` prop into
 * `boardColumns` state and re-syncs it through a `useEffect`, and BOTH the
 * header text and the cards are drawn from that mirror. So the header lands in
 * whatever state the mirror was seeded with at ITS mount.
 *
 * The header and the rows are therefore two INDEPENDENT races — chunk load
 * versus data commit — and nothing in the helper orders them. When the data
 * commit wins, the reveal carries the rows and the read sees 2 (every local
 * run, cold chunk). When the chunk wins, the reveal draws the column with an
 * empty list and the read sees 0 — the CI failure, `expected +0 to be 2`.
 *
 * The four cases need OPPOSITE waits, so they no longer share one:
 *
 *   - the three POSITIVE arms wait FOR the rows. A row count is a signal you
 *     can wait on, and waiting on it is what makes them immune to which race
 *     won — not a wider window on the same race, which is what a raised
 *     timeout would have bought.
 *   - the REFUSAL arm cannot wait for an absence, so it takes a SETTLED read:
 *     `find` has answered, the board has drawn the very list `cards()` reads,
 *     and everything React still had queued is flushed. Waiting on the LIST
 *     rather than on the header is the part that matters — `cards()` answers
 *     `[]` both when the list is ABSENT and when it is EMPTY, so under the old
 *     header wait a board that had not drawn yet was indistinguishable from a
 *     board that refused.
 *
 * ⛔ Do not fold these back into one wait, and ⛔ do not "fix" a future red
 * here with a longer timeout: the failure was never slowness, it was reading a
 * signal that does not carry the answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, act } from '@testing-library/react';
import React from 'react';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

const schema = {
  type: 'object-kanban',
  objectName: 'opportunity',
  groupBy: 'stage',
  cardTitle: 'name',
  columns: [{ id: 'negotiation', title: 'Negotiation' }],
} satisfies ObjectKanbanSchema;

const ROWS = [
  { id: 'o1', name: 'Northwind renewal', stage: 'negotiation' },
  { id: 'o2', name: 'Contoso expansion', stage: 'negotiation' },
];

const DEF = {
  name: 'opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'picklist',
      label: 'Stage',
      options: [{ value: 'negotiation', label: 'Negotiation' }],
    },
  },
};

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asValue: Envelope = (rows) => ({ value: rows, total: rows.length });
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * The column's card list — the ONE node `cards()` reads.
 *
 * The board draws it on EVERY arm, refused or not (`KanbanColumnView` renders
 * it unconditionally; a zero-card column fills it with a dashed placeholder
 * that is not a `listitem`). So its presence is the honest "this column has
 * been drawn" signal, and it is what separates an empty list from a missing one.
 */
function cardList(): HTMLElement | null {
  return screen.queryByRole('list', { name: 'Negotiation cards' });
}

/** Cards the board actually painted, by their `aria-label`. */
function cards(): string[] {
  const list = cardList();
  if (!list) return [];
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

/**
 * What a case expects the board to settle on — which is also what decides HOW
 * it waits. See the `objectui#8532` section of this file's header.
 */
type Outcome =
  /** Wait FOR the rows. `because` is carried into the timeout message. */
  | { readonly draws: number; readonly because: string }
  /** No absence to wait for: settle, then read. */
  | { readonly refuses: true };

const REFUSES: Outcome = { refuses: true };

/**
 * Mount the board over a `find()` answering `envelope`, and hand back the cards
 * it drew once `outcome` says the board has settled.
 *
 * ⛔ Call this ONCE per case and NEVER from inside a `waitFor` predicate
 * (objectui#7802) — it renders, and `waitFor` re-runs its callback on DOM
 * mutations, so a predicate that renders feeds itself and leaks a container
 * div per run.
 *
 * ⚠️ The predicates BELOW are inside `waitFor` on purpose and stay sound under
 * that same rule: `cards()` and `cardList()` are pure `screen` reads. They
 * mount nothing, so re-running them on a DOM mutation is free — which is
 * exactly the property `cardsThrough` itself does not have.
 *
 * ⚠️ Mounted with NO `data` prop: `ObjectKanban` skips its own fetch when
 * external data is supplied, and a board handed its rows directly would answer
 * every case identically — measuring nothing.
 */
async function cardsThrough(envelope: Envelope, outcome: Outcome): Promise<string[]> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds = {
    getObjectSchema: vi.fn(async () => DEF),
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as DataSource;
  render(<ObjectKanban schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it, "no cards" is satisfied by the mount's initial
  // empty state, which every arm renders identically.
  await find.mock.results[0].value;

  if ('refuses' in outcome) {
    // A refusal has no arrival to wait for, so this is a SETTLED read, built
    // from the three things that CAN be observed: `find` has answered (above),
    // the board has drawn the list itself — not merely the header, which the
    // lazy chunk can reveal ahead of the data — and React has nothing left
    // queued. `act` here is a flush of the pending work, not a delay: it is
    // the opposite of widening a timeout.
    await waitFor(() =>
      expect(cardList(), 'the board must have drawn the column list before it is read').not.toBeNull(),
    );
    await act(async () => {});
    return cards();
  }

  await waitFor(() => expect(cards(), outcome.because).toHaveLength(outcome.draws));
  return cards();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    const because = 'the declared rows member must still draw both cards';
    const drawn = await cardsThrough(asData, { draws: 2, because });
    expect(drawn.length, because).toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    const because = 'the bare-array arm must still draw both cards';
    const drawn = await cardsThrough(asBareArray, { draws: 2, because });
    expect(drawn.length, because).toBe(2);
  });

  it('still reads `value` — LIVE at this seam, three doubles in this package emit it', async () => {
    const because =
      'objectui#6840 refused to transfer its `ObjectView` zero here; deleting this arm would '
      + 'break three doubles in this package';
    const drawn = await cardsThrough(asValue, { draws: 2, because });
    expect(drawn.length, because).toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two cards drew off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`.
    const drawn = await cardsThrough(asRecords, REFUSES);
    expect(
      drawn,
      'a `records` envelope must reach the board as zero cards, not as the rows it names',
    ).toEqual([]);
  });
});
