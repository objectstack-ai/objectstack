/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8313 — the MEMBER shape of `object-kanban`'s four array/object-armed
 * keys, each measured AT ITS OWN SINK.
 *
 * ## Why this file exists
 *
 * `structuredKeysAreDeclaredAndHonoured-8313.test.ts` next door is the
 * DECLARATION half: it asserts `data`, `cardFields`, `grouping` and
 * `conditionalFormatting` are discoverable — the html tier accepts them, both
 * registrations publish them, and `ComponentPropsMap` does not refuse them by
 * name. It says nothing about what is INSIDE any of the four, and it cannot:
 * its spec row is a KEY verdict.
 *
 * Since objectui#8212 an array/object-armed declaration owes a member claim as
 * well, and the criterion objectui#8068 set for one is that some file must
 * constrain the member shape the RENDERER READS, so that a registration
 * declaring `array` while the code reads members as something else goes red.
 * This is that file, registered as the `MEMBER_PINS` entry of all four keys.
 *
 * ## ⚠️ FOUR KEYS, FOUR DIFFERENT QUESTIONS — which is the whole point
 *
 * objectui#8223 had to correct a landed rider note that predicted `sort` would
 * be an identity pin; it could never have been, because `convertSortToQueryParams`
 * builds a new map. objectui#8269 found the sharper version: a resolver
 * answering WHICH FIELD and one answering WHICH COLUMN THE ROWS CARRY coincide
 * only when no alias is written. So each block below states which question it
 * answers, and none of the four is assumed to share a shape with another:
 *
 *   - `data` — read TWICE, with two different meanings. As a GATE it suppresses
 *     the board's own query; as a VALUE it is selected and then REBUILT into
 *     cards. ⛔ No identity claim is true of it, unlike the two `filter` pins.
 *     ⚠️ And the gate is DOUBLY guarded — see the `data` block below, which
 *     records the measurement rather than the guard this file first named.
 *   - `cardFields` — WHICH NAMES THE AUTHOR CHOSE, at the exported pure
 *     resolver. That is NOT the same question as which cells a card carries;
 *     the two are measured separately and shown to differ.
 *   - `grouping` — WHICH SINGLE NESTED POSITION is read, and under what
 *     precedence. One position (`fields[0].field`), one role (the fallback for
 *     `swimlaneField`), everything else inert.
 *   - `conditionalFormatting` — WHICH MEMBER DIALECT is evaluated, and
 *     against what. One dialect since objectui#11522, `{ condition, style }`,
 *     per card, on the card's own record.
 *
 * ## What the spec supplies, and what it cannot
 *
 * On the installed spec, `conditionalFormatting` is `z.unknown().optional()`,
 * so the contract constrains its value not at all. `grouping` is TYPED: the
 * row holds the list view's own `GroupingConfigSchema` by reference, which
 * fixes the SHAPE of the block (`{ fields: [{ field, order?, collapsed? }] }`,
 * closed, at least one entry) and which both faces of `@object-ui/types` judge
 * the key by since objectui#11216. It does not say WHICH position this board
 * reads — the schema is the list view's, whose grid reads every entry — so the
 * `[0]` rows below are still the only statement of that. `data` is
 * `z.array(z.unknown())` and `cardFields` is `z.array(z.string())`: those fix
 * the CONTAINER kind and, for `cardFields`, the member kind, but neither says
 * anything about what the board does with a member. For all four, what the
 * board does with a member is the read site's alone.
 *
 * ## Non-vacuity
 *
 * Every rendered row waits for real DOM before asserting, so "nothing rendered"
 * can never read as success — the discipline
 * `ObjectKanban.filterMembersReachTheWire-8176.test.tsx` states next door.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { resolveKanbanCardFields } from '../ObjectKanban';

afterEach(cleanup);

const OBJECT = 'deal';

const DEAL_SCHEMA = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    owner: { type: 'text', label: 'Owner' },
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
  },
  // The ADR-0085 semantic role `resolveKanbanCardFields` falls back to.
  highlightFields: ['region'],
};

/** The row the adapter would serve if the board ever queried. */
const FETCHED = [{ id: 'fetched', name: 'FETCHED ROW', status: 'open' }];

function makeAdapter(): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: FETCHED })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEAL_SCHEMA),
  };
}

/** The declared board configuration, identical across every case below. */
const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  columns: [
    { id: 'open', title: 'Open' },
    { id: 'won', title: 'Won' },
  ],
};

function renderBoard(adapter: Record<string, any>, extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={{ ...BOARD, ...extra } as never} />
    </SchemaRendererProvider>,
  );
}

/** The accessible names of the cards rendered inside one column's list. */
const cardsInList = (container: HTMLElement, label: string): string[] =>
  [...(container.querySelector(`[role="list"][aria-label="${label}"]`)?.children ?? [])].map(
    (node) => node.getAttribute('aria-label') ?? '',
  );

/** Every `role="list"` aria-label on the board, in DOM order. */
const listLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="list"]')].map((n) => n.getAttribute('aria-label') ?? '');

/**
 * Wait long enough that a query, had one been issued, would be observable.
 *
 * ⚠️ A NEGATIVE assertion about a side effect needs a CALIBRATED window, not a
 * hopeful one. Measured while writing this file: an earlier `data` gate row
 * asserted `find` was never called immediately after the first card appeared,
 * and it could NOT be made to fail — removing `!schema.data` from the gate in
 * `ObjectKanban.tsx` left every row green, because the query is issued later
 * than the first paint. The row was describing nothing.
 *
 * The board fetches only once `getObjectSchema` has RESOLVED (`if
 * (!objectDefReady) return;` guards the effect), and `dataSource.find` is then
 * reached synchronously inside it. So the window is: the definition call, plus
 * enough macrotask turns for the commit that lands it to run its effects. The
 * row below named CONTROL proves the window is enough, by making a real query
 * observable through exactly this wait — which is what turns it from a sleep
 * into a measurement.
 */
const settle = async (adapter: Record<string, any>): Promise<void> => {
  await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalled());
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

/** Every inline `style` inside one card, joined — `''` when the card is absent. */
const stylesOnCard = (container: HTMLElement, title: string): string => {
  const item = container.querySelector(`[role="listitem"][aria-label="${title}"]`);
  if (!item) return '';
  return [item, ...item.querySelectorAll('[style]')]
    .map((n) => n.getAttribute('style') ?? '')
    .join(' | ');
};

/* -------------------------------------------------------------------------- */
/* `data` — members are RECORDS, and the key is read twice.                    */
/* -------------------------------------------------------------------------- */

describe('objectui#8313 — `object-kanban`.`data`: members are records, read twice', () => {
  const ROWS = [
    { id: 'a', name: 'Alpha deal', status: 'open', owner: 'ann' },
    { id: 'b', name: 'Beta deal', status: 'won', owner: 'bob' },
  ];

  it('CONTROL for the gate — the settle window really does make a query observable', async () => {
    // FIRST, because it is what licenses the two negatives below. Without it
    // "no query" is indistinguishable from "not yet", and this file measured
    // that difference the hard way — see `settle`.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter);

    await settle(adapter);
    expect(adapter.find, 'the window is too short — the negatives below prove nothing').toHaveBeenCalled();
    await waitFor(() => expect(container.textContent).toContain('FETCHED ROW'));
  });

  it('AS A GATE — authoring `data` suppresses the board’s own query entirely', async () => {
    // The key is not only a value here, and a pin that measured only the value
    // would miss the half an author feels first.
    //
    // ⚠️ WHICH GUARD DOES THIS — measured, because the obvious answer is only
    // half of it and this file asserted the wrong half first. On the authored
    // node path the suppression is DOUBLY guarded:
    //
    //   1. `SchemaRenderer` spreads non-metadata schema properties as React
    //      props, so an authored `data` arrives BOTH as `schema.data` and as
    //      this component's `data` prop. `hasExternalData =
    //      Array.isArray(externalData)` is therefore TRUE, and the fetch effect
    //      returns at its first line.
    //   2. `if (schema.objectName && !boundData && !schema.data)` — the guard
    //      that reads like the whole answer, and is never reached here.
    //
    // Ablation, all three legs run: removing (2) alone — GREEN. Removing (1)
    // alone — GREEN. Removing BOTH — this row and the one below go RED by
    // name. So the row constrains the BEHAVIOUR, which is the claim, and the
    // comment names the mechanism it actually measured rather than the one
    // that reads best.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, { data: ROWS });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    await settle(adapter);
    expect(adapter.find, 'the board queried despite inline `data`').not.toHaveBeenCalled();
  });

  it('AS A GATE — an EMPTY `data` suppresses it too, and renders no cards', async () => {
    // The discriminating case between "authored" and "non-empty": `[]` is a
    // real authored value, so the fetch stays suppressed and the board is
    // empty rather than silently falling back to the query. A gate spelled
    // `!schema.data?.length` would pass every other row in this file.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, { data: [] });

    await settle(adapter);
    expect(adapter.find, 'an empty authored `data` did not suppress the query').not.toHaveBeenCalled();
    expect(listLabels(container)).toEqual(['Open cards', 'Won cards']);
    expect(container.textContent).not.toContain('FETCHED ROW');
    expect(cardsInList(container, 'Open cards')).toEqual([]);
  });

  it('INSIDE A MEMBER — the `groupBy` field’s value is what routes it to a lane', async () => {
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, { data: ROWS });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    // Per lane, not merely "both titles appear somewhere": the member key being
    // read is `status`, and only a per-lane assertion can see that.
    expect(cardsInList(container, 'Open cards')).toEqual(['Alpha deal']);
    expect(cardsInList(container, 'Won cards')).toEqual(['Beta deal']);
  });

  it('⛔ NOT A PASS-THROUGH — every member is REBUILT, so no identity claim is true of this key', async () => {
    // The row that refuses the reading the two `filter` pins license. `filter`
    // reaches `$filter` BY IDENTITY; `data` does not reach anything by
    // identity, because `effectiveData` returns `{ ...item, id: item.id ||
    // item._id, title: <resolved> }` for every member.
    //
    // Measured rather than argued: this record carries NEITHER `id` NOR
    // `title`, and the card that appears has both. A forwarded array could not
    // produce that — `SortableCard` keys on `card.id` and labels on
    // `card.title`, and this member has neither key.
    const adapter = makeAdapter();
    const idless = [{ _id: 'legacy-1', name: 'Legacy deal', status: 'open' }];
    const { container } = renderBoard(adapter, { data: idless });

    await waitFor(() => expect(container.textContent).toContain('Legacy deal'));
    // `_id` became the card identity and `name` became the title — two reads
    // INSIDE the member, both of which the authored object spells differently.
    expect(cardsInList(container, 'Open cards')).toEqual(['Legacy deal']);
    expect(Object.keys(idless[0]), 'the authored member was mutated in place').toEqual([
      '_id',
      'name',
      'status',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* `cardFields` — members are BARE NAMES, and there are two questions.         */
/* -------------------------------------------------------------------------- */

describe('objectui#8313 — `object-kanban`.`cardFields`: members are bare field names', () => {
  it('WHICH NAMES THE AUTHOR CHOSE — authored order, and NOT filtered against the object', () => {
    // `resolveKanbanCardFields` is the exported, pure sink. The unfiltered read
    // is the behaviour that distinguishes the explicit list from the fallback
    // it overrides, so it is asserted rather than left implied: `ghost` is not
    // a declared field and survives.
    expect(resolveKanbanCardFields(['amount', 'ghost'], DEAL_SCHEMA as never)).toEqual([
      'amount',
      'ghost',
    ]);
    // Order is a member-level claim of its own — the cells render in it.
    expect(resolveKanbanCardFields(['owner', 'amount'], DEAL_SCHEMA as never)).toEqual([
      'owner',
      'amount',
    ]);
  });

  it('THE FALLBACK IT OVERRIDES *is* filtered — the contrast that makes the row above a reading', () => {
    // `highlightFields` names `region` (declared) and `dropped` (not), and only
    // the declared one survives. Without this contrast, "not filtered" above
    // could just mean nothing filters anything anywhere.
    const def = { ...DEAL_SCHEMA, highlightFields: ['region', 'dropped'] };
    expect(resolveKanbanCardFields(undefined, def as never)).toEqual(['region']);
    // An empty array reads as omitted rather than as "no cells".
    expect(resolveKanbanCardFields([], def as never)).toEqual(['region']);
    // A non-array is not a one-member list.
    expect(resolveKanbanCardFields('amount' as never, def as never)).toEqual(['region']);
    // …and with neither source there is nothing to render, which is the floor
    // the caller's legacy heuristic takes over from.
    expect(resolveKanbanCardFields(undefined, { fields: DEAL_SCHEMA.fields } as never)).toEqual([]);
  });

  it('the authored names become the card’s cells, in the authored order', async () => {
    const adapter = makeAdapter();
    const rows = [{ id: 'a', name: 'Alpha deal', status: 'open', owner: 'ann', amount: 10 }];
    const { container } = renderBoard(adapter, { data: rows, cardFields: ['amount', 'owner'] });

    await waitFor(() => expect(container.querySelector('dl')).toBeTruthy());
    const cells = [...container.querySelectorAll('dl > div')];
    // The `dt` carries `cell.label || cell.field`, and the label is
    // `objectDef.fields[f].label` — so it reads as the DECLARED label once the
    // async `getObjectSchema` has landed, and as the bare field name before
    // that. Until objectui#8534 the board rendered one `columns` generation
    // behind (its mirror was re-synced by a passive effect), so this row could
    // observe the pre-`objectDef` generation and read bare names. It no longer
    // can. WHICH cells these are, and their order, is unchanged and is what
    // this row pins: `amount` then `owner`, as authored.
    expect(cells.map((c) => c.querySelector('dt')?.textContent)).toEqual(['Amount', 'Owner']);
    expect(cells.map((c) => c.querySelector('dd')?.textContent)).toEqual(['10', 'ann']);
  });

  it('⚠️ WHICH CELLS THE CARD CARRIES IS A DIFFERENT QUESTION — the two answers really differ', async () => {
    // objectui#8269's trap, in this block's own terms. The resolver ANSWERS
    // `['name', 'amount']`; the card carries one cell, because the card loop
    // additionally drops a name that duplicates the title and one whose value
    // is empty. A pin that asserted the card's cells and called that "what
    // `cardFields` means" would be describing the wrong function.
    expect(resolveKanbanCardFields(['name', 'amount', 'region'], DEAL_SCHEMA as never)).toEqual([
      'name',
      'amount',
      'region',
    ]);

    const adapter = makeAdapter();
    const rows = [{ id: 'a', name: 'Alpha deal', status: 'open', amount: 10, region: '' }];
    const { container } = renderBoard(adapter, {
      data: rows,
      cardTitle: 'name',
      cardFields: ['name', 'amount', 'region'],
    });

    await waitFor(() => expect(container.querySelector('dl')).toBeTruthy());
    const cells = [...container.querySelectorAll('dl > div')];
    // `name` duplicates the title; `region` is empty on this record. The `dt`
    // reads as the declared label rather than the bare field name — see the row
    // above and objectui#8534; the CELL COUNT is what this row is about.
    expect(cells.map((c) => c.querySelector('dt')?.textContent)).toEqual(['Amount']);
  });
});

/* -------------------------------------------------------------------------- */
/* `grouping` — ONE nested position, in ONE role.                              */
/* -------------------------------------------------------------------------- */

describe('objectui#8313 — `object-kanban`.`grouping`: one nested position and no more', () => {
  const ROWS = [
    { id: 'a', name: 'Alpha deal', status: 'open', owner: 'ann', region: 'EMEA' },
    { id: 'b', name: 'Beta deal', status: 'open', owner: 'bob', region: 'EMEA' },
  ];

  it('`fields[0].field` becomes the swimlane field — the whole of what this board reads', async () => {
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      grouping: { fields: [{ field: 'owner' }] },
    });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Kanban board with swimlanes',
    );
    // Lanes are the DISTINCT values of the named field, and each card is in its
    // own — so the read really went through `owner` rather than merely turning
    // some 2D layout on.
    expect(listLabels(container)).toEqual([
      'Open - ann cards',
      'Won - ann cards',
      'Open - bob cards',
      'Won - bob cards',
    ]);
    expect(cardsInList(container, 'Open - ann cards')).toEqual(['Alpha deal']);
    expect(cardsInList(container, 'Open - bob cards')).toEqual(['Beta deal']);
  });

  it('CONTROL — with no `grouping` and no `swimlaneField` there are no swimlanes at all', async () => {
    // Without it, every assertion above could be satisfied by a board that
    // always renders the 2D layout.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, { data: ROWS });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Kanban board',
    );
    expect(listLabels(container)).toEqual(['Open cards', 'Won cards']);
  });

  it('an explicit `swimlaneField` WINS — `grouping` is the fallback, not the source', async () => {
    // `effectiveSwimlaneField = schema.swimlaneField || grouping?.fields?.[0]?.field`.
    // Both are authored here and they name DIFFERENT fields, so the lane labels
    // say which one was read.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      swimlaneField: 'region',
      grouping: { fields: [{ field: 'owner' }] },
    });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(listLabels(container)).toEqual(['Open - EMEA cards', 'Won - EMEA cards']);
  });

  it('a SECOND `fields` entry is inert — the read is at `[0]`, not over the list', async () => {
    // This is what pins the declared description's "later `fields` entries
    // included" clause. A board that grouped by the whole list, or by the last
    // entry, would produce `status` lanes here instead of `owner` lanes.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      grouping: { fields: [{ field: 'owner' }, { field: 'region' }] },
    });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(listLabels(container)).toEqual([
      'Open - ann cards',
      'Won - ann cards',
      'Open - bob cards',
      'Won - bob cards',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* `conditionalFormatting` — the `{ condition, style }` member, per card.      */
/* -------------------------------------------------------------------------- */

describe('objectui#8313 — `object-kanban`.`conditionalFormatting`: the `{ condition, style }` member', () => {
  const ROWS = [
    { id: 'a', name: 'Alpha deal', status: 'open', owner: 'ann' },
    { id: 'b', name: 'Beta deal', status: 'open', owner: 'bob' },
  ];

  // ⚠️ RESPELLED, not rewritten (objectui#11522). The two rows below used to
  // author the two dialects the member then accepted: the native
  // `{ field: 'owner', operator: 'equals', value: 'ann', backgroundColor }` and
  // the flat CEL `{ condition: "record.owner == 'bob'", backgroundColor }`.
  // Both are retired and refused by name on every zod face; each row now writes
  // the SAME predicate and the SAME paint as `{ condition, style }`, and asserts
  // the SAME card is painted and its neighbour is not — so a respelling that
  // changed which card the rule reaches would turn the row red.
  it('a `{ condition, style }` member colours the matching card, and only it', async () => {
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      conditionalFormatting: [
        { condition: "record.owner == 'ann'", style: { backgroundColor: 'rgb(1, 2, 3)' } },
      ],
    });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(stylesOnCard(container, 'Alpha deal')).toContain('background-color: rgb(1, 2, 3)');
    // The live non-matching control, in the SAME render: without it a green
    // could come from two unstyled cards agreeing, or from a rule applied to
    // every card at once.
    expect(container.textContent).toContain('Beta deal');
    expect(stylesOnCard(container, 'Beta deal')).not.toContain('background-color');
  });

  it('a second rule aimed at the OTHER card does the same, against that card’s own record', async () => {
    // Aimed at the other card on purpose, so one shared fixture cannot make two
    // rules look alike (#1584 / ADR-0058).
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      conditionalFormatting: [
        { condition: "record.owner == 'bob'", style: { backgroundColor: 'rgb(4, 5, 6)' } },
      ],
    });

    await waitFor(() => expect(container.textContent).toContain('Beta deal'));
    expect(stylesOnCard(container, 'Beta deal')).toContain('background-color: rgb(4, 5, 6)');
    expect(container.textContent).toContain('Alpha deal');
    expect(stylesOnCard(container, 'Alpha deal')).not.toContain('background-color');
  });

  it('the WHOLE `style` map reaches the card — `style` is the only colour channel now', async () => {
    // With the top-level colour keys retired (objectui#11522), every paint
    // rides `style`, so the map must arrive whole and not as one picked key.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter, {
      data: ROWS,
      conditionalFormatting: [
        { condition: "record.owner == 'ann'", style: { backgroundColor: 'rgb(1, 2, 3)', borderColor: 'rgb(7, 8, 9)' } },
      ],
    });

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(stylesOnCard(container, 'Alpha deal')).toContain('background-color: rgb(1, 2, 3)');
    expect(stylesOnCard(container, 'Alpha deal')).toContain('border-color: rgb(7, 8, 9)');
    expect(stylesOnCard(container, 'Beta deal')).not.toContain('border-color');
  });

  it('⚠️ `ObjectKanban.tsx` never NAMES this key — it rides the `{ ...schema }` spread', () => {
    // The structural fact that makes the two rows above load-bearing, made
    // mechanical instead of left in prose. `conditionalFormatting` is the only
    // one of this card's four keys with no read site in `ObjectKanban.tsx` at
    // all: it travels on the spread into `effectiveSchema` and then into
    // `KanbanRenderer`, which forwards it to `KanbanImpl`. An edit replacing
    // that spread with an explicit key list would drop the key SILENTLY, and
    // the rows above are the only thing in this repo that would notice.
    //
    // A zero-hit grep is not a reading on its own, so the control is in the
    // same assertion: `cardFields`, a key the same file demonstrably does name.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'ObjectKanban.tsx'),
      'utf8',
    );
    const occurrences = (needle: string): number => source.split(needle).length - 1;

    expect(occurrences('cardFields'), 'the control found nothing — this read is vacuous').toBeGreaterThan(0);
    expect(
      occurrences('conditionalFormatting'),
      'ObjectKanban.tsx now names `conditionalFormatting`: re-measure which sink ' +
        'carries the member contract before trusting the rows above',
    ).toBe(0);
    // …and the spread it rides is still there.
    expect(source).toContain('...schema,');
  });
});
