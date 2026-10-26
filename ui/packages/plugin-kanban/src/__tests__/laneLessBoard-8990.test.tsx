/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8990 — what a LANE-LESS `object-kanban` board actually does, now
 * that `ObjectKanbanSchema.groupBy` is OPTIONAL on both published faces.
 *
 * ## Why this file exists
 *
 * The card is a WIDENING: `@objectstack/spec` declares
 * `groupBy: z.string().optional()` and this repository required it, so both
 * published faces refused a document the protocol accepts. The risk of a
 * widening is not a compile break — it is a RUNTIME PATH THAT NEVER RAN. This
 * file measures that path instead of asserting the declaration, which
 * `packages/types/src/__tests__/object-kanban-group-by-limit-7322.test.ts`
 * already does.
 *
 * ## ⭐ The arm this card unlocks, and its firing control
 *
 * `@objectstack/spec` declares `object-kanban.columns` as two array shapes —
 * `{ id, title }` lanes, or bare value strings. The renderer honours the
 * bare-string arm ONLY under `if (!schema.groupBy)` (`ObjectKanban.tsx`, the
 * `effectiveColumns` memo). While `groupBy` was REQUIRED, no schema-valid
 * document could reach that branch: objectui#8913 admitted the arm anyway
 * (refusing it would have been a second narrowing) and recorded it as
 * unreachable. Making `groupBy` optional is what makes it reachable BY A
 * SCHEMA-VALID DOCUMENT — the qualifier matters, and the section headed "WHICH
 * legs guard the widening" below is where it is measured: the RENDERER never
 * consulted this package's validator, so the branch was always live for a
 * document that reached it unvalidated. ⛔ Not "dead code that came alive".
 *
 * ⚠️ "The arm fires" is not observable from the lane COUNT alone — a grouped
 * board draws two lanes too. It is observable from the lane TITLES, and that is
 * this file's discriminator:
 *
 *   - the string branch returns `{ id: val, title: val }` and never calls
 *     `localizeColumn`, so the lanes are titled by the RAW option VALUES;
 *   - the picklist branch a grouped board takes returns the option LABELS.
 *
 * The fixture object's `status` options are deliberately `todo -> 'To Do'` and
 * `doing -> 'Doing'`, so the two paths are distinguishable on screen. The
 * grouped board is the FIRING CONTROL: it proves the assertion can fail, and it
 * proves the `!schema.groupBy` gate is still a gate rather than dead code.
 *
 * ## ⚠️ Reachable is NOT populated — the honest half of the result
 *
 * Every lane-less board holds ZERO cards, whatever its `columns`, because
 * `bucketCardsIntoColumns` opens with
 * `if (!data || !groupBy || !Array.isArray(data)) return columns.map(...)` —
 * with no lane key the records are never distributed. So the widening admits
 * documents that RENDER (lane headings, no crash), not documents that work
 * better. ⛔ It is not an invitation to omit the key.
 *
 * ## ⚠️ WHICH legs guard the widening — measured by ablation, and not obvious
 *
 * Reverting `groupBy` to REQUIRED on both faces (source-only mutation, no
 * rebuild; the `dist/` marker read both ways and unchanged, so the run was
 * reading source through vitest's `@object-ui/types` alias) turns exactly the
 * CONTRACT legs of this file red — `safeParse` / `safeValidateSchema` — and
 * leaves every RENDER leg green.
 *
 * ⭐ That is a fact about the system, not a weakness of the pins: `SchemaRenderer`
 * runs the structural `validateSchema`, never this package's zod mirror, so the
 * renderer's bare-string branch was ALWAYS live for a document that reached it
 * without passing the published validator — `ListView.tsx`'s generated node, or
 * any host not running `os check`. What the requiredness made impossible was a
 * SCHEMA-VALID document reaching that branch. ⇒ ⛔ Do not read the render legs
 * below as guarding the declaration; they pin renderer BEHAVIOUR, and the
 * contract legs above are what pin the widening. Deleting the contract legs
 * would leave this file fully green against a re-narrowed schema.
 *
 * ## ⛔ objectui#8993 is NOT reached from here, and that is asserted
 *
 * objectui#8993 (`bucketCardsIntoColumns` double-buckets a non-string lane id)
 * lives AFTER that early return — the `knownIds` set and the `__uncolumned__`
 * lane below it. A lane-less board returns before reaching any of it, and the
 * picklist-materialised lanes whose ids come straight from `opt.value` are
 * built under `if (schema.groupBy && ...)`, a branch a lane-less board cannot
 * enter. ⇒ objectui#8993's reachable set is UNCHANGED by this card: admitting
 * documents cannot shrink it, and none of the documents newly admitted can reach
 * the defect. ⛔ Not "narrowed" — the claim is that nothing was widened. ⛔ And
 * nothing here fixes #8993; it is a renderer behaviour change with its own card.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { ObjectKanbanSchema } from '@object-ui/types/zod';
import { safeValidateSchema } from '@object-ui/types/zod';
import { bucketCardsIntoColumns, KANBAN_UNCOLUMNED_ID } from '../index';
// Registers `object-kanban`.
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

/**
 * ⭐ The option VALUES and LABELS differ on purpose — that difference is what
 * tells the bare-string arm apart from the picklist arm on screen.
 */
const OBJECT_SCHEMA = {
  name: 'task',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'todo', label: 'To Do' },
        { value: 'doing', label: 'Doing' },
      ],
    },
  },
};

const ROWS = [
  { id: 'r1', name: 'Card one', status: 'todo' },
  { id: 'r2', name: 'Card two', status: 'doing' },
];

const LANE_VALUES = ['todo', 'doing'];
const LANE_LABELS = ['To Do', 'Doing'];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
}

/**
 * The board-level live region (objectui#8827): `role="status" aria-live="polite"`,
 * titled "No cards". It is painted ONLY once the records have SETTLED, never
 * while they are in flight — which is what makes it a legitimate settle signal
 * for a board that is expected to show nothing.
 */
const emptyState = () => document.querySelector('[role="status"][aria-live="polite"]');

/**
 * ⚠️ RIG DISCIPLINE. A "no cards on screen" assertion is only a reading if the
 * rows had a chance to arrive first; asserted too early it passes for the wrong
 * reason, against a board that is merely still loading. The first cut of this
 * file settled on the dnd live region, which the board renders IMMEDIATELY, and
 * the grouped CONTROL leg caught it by failing — the rows had not landed yet.
 *
 * So every leg here settles on a signal that PROVES the query resolved:
 *   - `expectCards` waits for a row to appear;
 *   - `expectSettledEmpty` waits for the objectui#8827 empty state, which the
 *     board withholds until its records settle, and additionally asserts `find`
 *     was actually called.
 */
async function renderBoard(schema: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const result = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
  return { ...result, find: dataSource.find as ReturnType<typeof vi.fn> };
}

/** Settle on a board that is expected to end up showing NOTHING. */
async function expectSettledEmpty(find: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(emptyState()).not.toBeNull());
  expect(find, 'RIG SELF-CHECK: the board must actually have queried').toHaveBeenCalled();
}

/** Settle on a board that is expected to end up showing cards. */
async function expectCards(container: HTMLElement, name: string) {
  await waitFor(() => expect(container.textContent).toContain(name));
}

/**
 * Lane headings as drawn, in DOM order.
 *
 * ⚠️ The `h3, h4` arms are a net, not a contract, and the board-level empty
 * state renders its "No cards" title as an `h3` — which is NOT a lane heading.
 * It only ever landed in this net once objectui#9045 made that region reachable
 * on a lane-less board; before then the zero-lane leg below was reading a board
 * that had no such region. Excluding the live region restores what this helper
 * says it returns. ⛔ Not a loosening: the legs that assert ON lane titles
 * compare against lane VALUES and picklist LABELS, neither of which this filter
 * can remove.
 */
function laneTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-slot="kanban-column-title"], h3, h4'))
    .filter((el) => !el.closest('[role="status"][aria-live="polite"]'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

afterEach(cleanup);

describe('objectui#8990 — the contract admits a lane-less board on both entry paths', () => {
  const laneless = { type: 'object-kanban', objectName: 'task', columns: LANE_VALUES };

  it('a bare-string `columns` board with no `groupBy` parses green', () => {
    const r = ObjectKanbanSchema.safeParse(laneless);
    expect(r.success, 'this is the document the protocol accepts and this repo refused').toBe(true);
    expect(safeValidateSchema(laneless).success, 'the union entry path must agree').toBe(true);
  });

  it('CONTROL — the same board WITH `groupBy` still parses green', () => {
    // Guards the direction: this card widened the accept set, it did not swap
    // one refusal for another.
    expect(ObjectKanbanSchema.safeParse({ ...laneless, groupBy: 'status' }).success).toBe(true);
  });
});

describe('objectui#8990 — the bare-string `columns` arm FIRES on a lane-less board', () => {
  it('draws its lanes titled by the RAW strings', async () => {
    const { container, find } = await renderBoard({
      type: 'object-kanban',
      objectName: 'task',
      columns: LANE_VALUES,
    });
    await expectSettledEmpty(find);

    const titles = laneTitles(container);
    for (const value of LANE_VALUES) {
      expect(titles, `the string arm returns { id: val, title: val }; lane "${value}" must be drawn`)
        .toContain(value);
    }
    // ⭐ The discriminator: raw VALUES, never the picklist LABELS. Were the
    // string branch skipped and the picklist branch taken, these would appear.
    for (const label of LANE_LABELS) {
      expect(titles, `"${label}" is the picklist LABEL — a lane-less board never localizes`)
        .not.toContain(label);
    }
  });

  it('FIRING CONTROL — the very same `columns` with `groupBy` set draws the picklist LABELS instead', async () => {
    // This is the leg that proves the assertion above can fail, and that
    // `if (!schema.groupBy)` is a live gate: with a lane key the string arm is
    // skipped entirely and `effectiveColumns` materialises lanes from
    // `field.options`, titled by their labels.
    const { container } = await renderBoard({
      type: 'object-kanban',
      objectName: 'task',
      groupBy: 'status',
      columns: LANE_VALUES,
    });
    await expectCards(container, 'Card one');

    const titles = laneTitles(container);
    for (const label of LANE_LABELS) {
      expect(titles, `a GROUPED board takes the picklist branch; "${label}" must be drawn`)
        .toContain(label);
    }
    expect(titles, 'and the raw values must NOT be the headings on this leg')
      .not.toContain('todo');
  });

  it('⚠️ reachable is not populated — a lane-less board holds ZERO cards, the grouped control holds them', async () => {
    const laneLess = await renderBoard({
      type: 'object-kanban',
      objectName: 'task',
      columns: LANE_VALUES,
    });
    // Settled, not merely early: the empty state is withheld until the records
    // land, so reaching it means the rows had their chance and none was placed.
    await expectSettledEmpty(laneLess.find);
    for (const row of ROWS) {
      expect(
        laneLess.container.textContent,
        'with no lane key the bucketer returns before distributing records',
      ).not.toContain(row.name);
    }
    cleanup();

    // CONTROL — the same rows DO reach the board once a lane key exists, so the
    // absence above is the missing key and not a broken fixture. ⭐ This leg is
    // what caught the first cut of this file, which asserted before the query
    // resolved.
    const grouped = await renderBoard({
      type: 'object-kanban',
      objectName: 'task',
      groupBy: 'status',
      columns: LANE_VALUES,
    });
    await expectCards(grouped.container, 'Card one');
    for (const row of ROWS) {
      expect(grouped.container.textContent, 'CONTROL: the fixture rows do render when grouped')
        .toContain(row.name);
    }
  });

  it('a lane-less board with NO `columns` renders an EMPTY board rather than crashing', async () => {
    // ⚠️ When this was written, this leg COULD NOT settle on the objectui#8827
    // empty state: `KanbanImpl` gated it on `boardColumns.length > 1`, so a
    // ZERO-lane board never painted it. objectui#9045 removed that conjunct and
    // the region is now painted here too — ⛔ that is the very gap this leg's
    // own comment recorded, not a change of subject. The settle signal is left
    // on the board region so this leg keeps measuring what it always measured
    // (lanes and rows, neither of which arrives), and takes its credibility
    // from the paired control below, which shares the whole rig and differs
    // only by the lane key.
    const laneLess = await renderBoard({ type: 'object-kanban', objectName: 'task' });
    await waitFor(() => expect(laneLess.find).toHaveBeenCalled());
    await waitFor(() =>
      expect(laneLess.container.querySelector('[role="region"][aria-label="Kanban board"]')).not.toBeNull(),
    );
    // `effectiveColumns` falls past all three of its `schema.groupBy &&` guards
    // and returns `[]`.
    expect(laneTitles(laneLess.container), 'no lane key and no declared lanes: no lanes').toEqual([]);
    for (const row of ROWS) {
      expect(laneLess.container.textContent).not.toContain(row.name);
    }
    cleanup();

    // CONTROL — same schema plus the lane key. `effectiveColumns` now takes the
    // picklist branch, materialises both lanes from `field.options`, and the
    // rows land. This is what proves the rig above was connected: the lanes and
    // the cards are absent for want of a lane key, not for want of a working
    // fixture.
    const grouped = await renderBoard({ type: 'object-kanban', objectName: 'task', groupBy: 'status' });
    await expectCards(grouped.container, 'Card one');
    expect(laneTitles(grouped.container)).toEqual(expect.arrayContaining(LANE_LABELS));
  });
});

describe('objectui#8990 — ⛔ the lane-less path does NOT reach objectui#8993', () => {
  const lanes = [
    { id: 'todo', title: 'To Do' },
    { id: 'doing', title: 'Doing' },
  ];

  it('with no lane key the bucketer early-returns: every lane empty, and NO `__uncolumned__` lane', () => {
    const out = bucketCardsIntoColumns(lanes, ROWS, undefined, undefined, 'Uncategorized');
    expect(out.map((c: any) => c.id)).toEqual(['todo', 'doing']);
    expect(out.every((c: any) => c.cards.length === 0)).toBe(true);
    // The `knownIds` / `__uncolumned__` block — and objectui#8993's
    // double-bucketing with it — sits BELOW the `!groupBy` return.
    expect(out.map((c: any) => c.id)).not.toContain(KANBAN_UNCOLUMNED_ID);
  });

  it('CONTROL — the same call WITH a lane key does distribute, and can reach the uncolumned lane', () => {
    const bucketed = bucketCardsIntoColumns(lanes, ROWS, 'status', undefined, 'Uncategorized');
    expect(bucketed.find((c: any) => c.id === 'todo').cards).toHaveLength(1);
    expect(bucketed.find((c: any) => c.id === 'doing').cards).toHaveLength(1);

    // An off-lane record reaches the trailing lane — the code path the
    // lane-less leg above never enters.
    const withOrphan = bucketCardsIntoColumns(
      lanes,
      [...ROWS, { id: 'r3', name: 'Orphan', status: 'done' }],
      'status',
      undefined,
      'Uncategorized',
    );
    expect(withOrphan.map((c: any) => c.id)).toContain(KANBAN_UNCOLUMNED_ID);
  });
});
