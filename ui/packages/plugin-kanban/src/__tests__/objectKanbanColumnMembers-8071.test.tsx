/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8071 — the MEMBER shape of `object-kanban`.`columns`, each member
 * measured AT ITS OWN SINK.
 *
 * ## Why a declaration pin is not this pin
 *
 * `@object-ui/types`' `__tests__/object-kanban-columns-declared-8913.test.ts`
 * is the DECLARATION half, and it is a good one: it parses lane bags against
 * both published faces, each refusal paired with the same bag under an
 * undeclared key so the row reports its own removal. Read end to end before
 * being cited here. What it cannot say is what the board DOES with a member it
 * admitted — every assertion in it is a `safeParse`. objectui#8068's criterion
 * for a member pin is the other half: some file must constrain the member shape
 * the RENDERER READS, so that a registration declaring `array` while the code
 * reads members as something else goes red. This is that file.
 *
 * ## SIX MEMBERS, SIX DIFFERENT SINKS
 *
 * The lane element the protocol admits carries `id`, `title` and the optional
 * `cards` / `limit` / `className` / `collapsed`. They do not share a sink and
 * none of them is assumed to behave like its neighbour:
 *
 *   - `id` — WHICH RECORDS LAND HERE. It is the bucketing key
 *     (`groups[col.id]`) and the lane's heading id, and a record whose group
 *     value matches no lane id is swept into a trailing lane rather than
 *     dropped (objectui#2792).
 *   - `title` — PRESENTATION ONLY: the lane's accessible name. It used to be
 *     read a second time, as an undeclared BUCKETING ALIAS, so a record whose
 *     stored group value was the lane's TITLE landed in that lane and renaming
 *     a lane moved records. objectui#10069 (ruling A) retired that reading:
 *     a title-valued record is now an orphan, and the row that pinned the
 *     alias is FLIPPED below rather than deleted.
 *   - `cards` — UNION, not replacement. Static lane cards are kept AND the
 *     bucketed records are appended, statics first.
 *   - `limit` — a WIP cap that is displayed and flags the lane, and ⛔ never
 *     truncates: an over-limit lane renders every card it holds.
 *   - `className` — reaches the lane container's class list.
 *   - `collapsed` — withholds the lane's cards. The full treatment of this one
 *     member (both faces, the swimlane layout, re-expanding) is
 *     `columnCollapsedHonoured-9628.test.tsx`; the row here is the member-set
 *     claim, not a second copy of that file.
 *
 * ## The spec supplies none of it
 *
 * On the installed protocol this key is `z.array(z.unknown())` with its element
 * shape stated in `describe` PROSE. So the contract fixes the container kind
 * and nothing else, and the read site is the whole of the member contract —
 * the same position `grouping` and `conditionalFormatting` are in next door in
 * `ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx`.
 *
 * ## What is deliberately NOT re-asserted here
 *
 * The bare-string arm (`laneLessBoard-8990.test.tsx`), lane-id key coercion
 * (`laneIdCoercion-8993.test.ts`), the windowed lane counts
 * (`laneCountHonesty-8307.test.tsx`) and the collapse affordance
 * (`columnCollapsedHonoured-9628.test.tsx`) each own their member question
 * already. Copying them here would make this file look stronger while adding
 * no judging.
 *
 * ## Non-vacuity
 *
 * Every row waits for real DOM before it asserts, so "nothing rendered" can
 * never read as success — the discipline
 * `ObjectKanban.filterMembersReachTheWire-8176.test.tsx` states next door. The
 * negative rows carry a LIT CONTROL in the same render.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010), same specifier as
// `index.tsx`'s factory so ESM's module cache resolves it immediately.
import '../KanbanImpl';

afterEach(cleanup);

const OBJECT = 'deal';

const DEAL_SCHEMA = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
  },
};

function makeAdapter(rows: Array<Record<string, unknown>>): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: rows })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEAL_SCHEMA),
  };
}

function renderBoard(adapter: Record<string, any>, columns: unknown) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'status', columns } as never}
      />
    </SchemaRendererProvider>,
  );
}

/** The accessible names of the cards rendered inside one lane's list. */
const cardsInList = (container: HTMLElement, label: string): string[] =>
  [...(container.querySelector(`[role="list"][aria-label="${label}"]`)?.children ?? [])]
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((name) => name !== '');

/** Every lane container on the board, by its accessible name. */
const lane = (container: HTMLElement, title: string): HTMLElement | null =>
  container.querySelector(`[role="group"][aria-label="${title}"]`);

/** Every lane's accessible name, in DOM order. */
const laneNames = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="group"]')].map((n) => n.getAttribute('aria-label') ?? '');

/* -------------------------------------------------------------------------- */
/* `id` — WHICH RECORDS LAND HERE                                             */
/* -------------------------------------------------------------------------- */

describe('objectui#8071 — `object-kanban`.`columns[].id`: the bucketing key', () => {
  const LANES = [
    { id: 'open', title: 'Open' },
    { id: 'won', title: 'Won' },
  ];

  it('a record whose group value equals a lane `id` renders in THAT lane', async () => {
    const adapter = makeAdapter([
      { id: 'a', name: 'Alpha deal', status: 'open' },
      { id: 'b', name: 'Beta deal', status: 'won' },
    ]);
    const { container } = renderBoard(adapter, LANES);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Alpha deal']));
    expect(cardsInList(container, 'Won cards')).toEqual(['Beta deal']);
    // The member also names the heading, which is what an `aria-describedby`
    // pointing at a lane resolves against.
    expect(container.querySelector('#kanban-col-open')).not.toBeNull();
    expect(container.querySelector('#kanban-col-won')).not.toBeNull();
  });

  it('CONTROL — a record matching NO lane id is swept into a trailing lane, not dropped', async () => {
    // objectui#2792. The control is what stops the row above reading as "the
    // bucketer happens to put everything somewhere plausible".
    const adapter = makeAdapter([
      { id: 'a', name: 'Alpha deal', status: 'open' },
      { id: 'z', name: 'Orphan deal', status: 'archived' },
    ]);
    const { container } = renderBoard(adapter, LANES);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Alpha deal']));
    expect(laneNames(container).length).toBe(3);
    const trailing = laneNames(container)[2];
    expect(cardsInList(container, `${trailing} cards`)).toEqual(['Orphan deal']);
  });
});

/* -------------------------------------------------------------------------- */
/* `title` — the accessible name, and ⛔ NOT a bucketing key (objectui#10069) */
/* -------------------------------------------------------------------------- */

describe('objectui#8071 — `object-kanban`.`columns[].title`: presentation only', () => {
  const LANES = [
    { id: 'open', title: 'In Progress' },
    { id: 'won', title: 'Closed Won' },
  ];

  it('AS PRESENTATION — it is the lane’s accessible name and its card list’s', async () => {
    const adapter = makeAdapter([{ id: 'a', name: 'Alpha deal', status: 'open' }]);
    const { container } = renderBoard(adapter, LANES);

    // Wait on the CARD, not on the lane: the lanes commit before the query
    // settles, so waiting on a lane would let this row assert an empty board
    // and pass — which is what it did on its first run.
    await waitFor(() => expect(cardsInList(container, 'In Progress cards')).toEqual(['Alpha deal']));
    expect(lane(container, 'In Progress')).not.toBeNull();
    expect(lane(container, 'Closed Won')).not.toBeNull();
    // The lane `id` is NOT the accessible name — otherwise the row above would
    // be satisfied by a renderer that never read `title` at all.
    expect(lane(container, 'open')).toBeNull();
  });

  it('⭐ NOT A BUCKETING KEY — a record storing the lane’s TITLE is an orphan (objectui#10069)', async () => {
    // FLIPPED, not deleted: this row pinned the retired alias
    // (a lane's lowercased `title` mapped onto its `id`). Under ruling A a lane
    // matches the stored option value by `id` only, so the title-valued record
    // no longer reaches "In Progress" — it is swept into the trailing lane,
    // and the id-valued record beside it in the SAME render still lands, which
    // is what stops this row reading as "nothing buckets at all".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeAdapter([
      { id: 'a', name: 'By id', status: 'open' },
      { id: 'b', name: 'By title', status: 'in progress' },
    ]);
    const { container } = renderBoard(adapter, LANES);

    await waitFor(() => expect(cardsInList(container, 'In Progress cards')).toEqual(['By id']));
    expect(laneNames(container).length).toBe(3);
    expect(cardsInList(container, `${laneNames(container)[2]} cards`)).toEqual(['By title']);
    // Loud, not silent: the move into the trailing lane names the raw value
    // and the lane ids an author could have stored instead.
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('"in progress"') && m.includes('"open", "won"'))).toBe(true);
    warn.mockRestore();
  });

  it('CONTROL — a value matching neither the id nor the title IS an orphan', async () => {
    const adapter = makeAdapter([
      { id: 'a', name: 'By id', status: 'open' },
      { id: 'c', name: 'Neither', status: 'in flight' },
    ]);
    const { container } = renderBoard(adapter, LANES);

    await waitFor(() => expect(cardsInList(container, 'In Progress cards')).toEqual(['By id']));
    expect(laneNames(container).length).toBe(3);
    expect(cardsInList(container, `${laneNames(container)[2]} cards`)).toEqual(['Neither']);
  });
});

/* -------------------------------------------------------------------------- */
/* `cards` — UNION with the bucketed records, not replacement                  */
/* -------------------------------------------------------------------------- */

describe('objectui#8071 — `object-kanban`.`columns[].cards`: kept AND appended to', () => {
  it('⭐ static lane cards survive the fetch and come FIRST', async () => {
    // `cards: [...(col.cards || []), ...(groups[col.id] || [])]`. An author who
    // writes both gets a union: the static card is not replaced by the query,
    // and it is not de-duplicated against it either.
    const adapter = makeAdapter([{ id: 'a', name: 'Fetched deal', status: 'open' }]);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', cards: [{ id: 'static-1', title: 'Static deal' }] },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Static deal', 'Fetched deal']));
  });

  it('CONTROL — the same board with no `cards` renders only the fetched record', async () => {
    const adapter = makeAdapter([{ id: 'a', name: 'Fetched deal', status: 'open' }]);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open' },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Fetched deal']));
  });
});

/* -------------------------------------------------------------------------- */
/* `limit` — displayed and flagged, ⛔ never enforced                          */
/* -------------------------------------------------------------------------- */

describe('objectui#8071 — `object-kanban`.`columns[].limit`: a WIP cap that shows, not one that cuts', () => {
  const rows = [
    { id: 'a', name: 'Alpha deal', status: 'open' },
    { id: 'b', name: 'Beta deal', status: 'open' },
  ];

  it('is rendered beside the lane count', async () => {
    const adapter = makeAdapter(rows);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', limit: 5 },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toHaveLength(2));
    expect(lane(container, 'Open')?.textContent).toContain('/ 5');
    // LIT CONTROL, same render: the neighbour that declared no `limit` shows
    // none, so the row above is about the member and not about the layout.
    expect(lane(container, 'Won')?.textContent).not.toContain('/');
  });

  it('⛔ does NOT truncate — a lane over its cap renders every card it holds, and says so', async () => {
    // `isLimitExceeded = column.limit && safeCards.length >= column.limit`
    // drives a badge; nothing anywhere slices the array. A pin asserting only
    // the badge would stay green under a renderer that dropped the overflow.
    const adapter = makeAdapter(rows);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', limit: 1 },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Alpha deal', 'Beta deal']));
    expect(lane(container, 'Open')?.textContent).toContain('Full');
    expect(lane(container, 'Won')?.textContent).not.toContain('Full');
  });
});

/* -------------------------------------------------------------------------- */
/* `className` / `collapsed` / the member set as a WHITELIST                   */
/* -------------------------------------------------------------------------- */

describe('objectui#8071 — `object-kanban`.`columns[]`: the remaining members, and the set itself', () => {
  it('`className` reaches the lane container, and only that lane', async () => {
    const adapter = makeAdapter([{ id: 'a', name: 'Alpha deal', status: 'open' }]);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', className: 'pinned-lane-marker' },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(lane(container, 'Open')).not.toBeNull());
    expect(lane(container, 'Open')?.className).toContain('pinned-lane-marker');
    expect(lane(container, 'Won')?.className).not.toContain('pinned-lane-marker');
  });

  it('`collapsed` withholds that lane’s cards while its neighbour keeps them', async () => {
    // The member-set row. The full treatment of this member — both published
    // faces, the swimlane layout, re-expanding, and the board that authors it
    // nowhere — is `columnCollapsedHonoured-9628.test.tsx`.
    const adapter = makeAdapter([
      { id: 'a', name: 'Alpha deal', status: 'open' },
      { id: 'b', name: 'Beta deal', status: 'won' },
    ]);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', collapsed: true },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Won cards')).toEqual(['Beta deal']));
    expect(container.querySelector('[role="list"][aria-label="Open cards"]')).toBeNull();
  });

  it('⭐ an UNDECLARED lane member reaches no sink at all', async () => {
    // The member set is a whitelist: a key outside it survives the strip
    // posture of the tolerant face and then changes nothing that renders. The
    // `className` on the same lane is the LIT CONTROL in the same render — it
    // proves the search is capable of finding a member that DID reach the DOM.
    const adapter = makeAdapter([{ id: 'a', name: 'Alpha deal', status: 'open' }]);
    const { container } = renderBoard(adapter, [
      { id: 'open', title: 'Open', className: 'lit-control-marker', color: 'undeclared-member-marker' },
      { id: 'won', title: 'Won' },
    ]);

    await waitFor(() => expect(cardsInList(container, 'Open cards')).toEqual(['Alpha deal']));
    expect(container.innerHTML).toContain('lit-control-marker');
    expect(container.innerHTML).not.toContain('undeclared-member-marker');
  });
});
