/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `kanban` group — `KanbanColumn`'s card list.
 *
 * `packages/types` declared the member as `items`, in both halves of the
 * published surface (`complex.ts` and its zod mirror `complex.zod.ts`), while
 * every board reads `cards`. Re-measured on `origin/main` @ `78a3cc238`, the
 * base of this branch:
 *
 *   - `KanbanImpl.tsx`      12 lines read `.cards`,  0 read `.items`
 *   - `KanbanEnhanced.tsx`   8 lines read `.cards`,  0 read `.items`
 *   - `index.tsx`            `bucketCardsIntoColumns` reads `col.cards` twice,
 *                            each as `col.cards || []`
 *
 * (A same-shaped LIT control on the same two files — `.title` — returns 8 and
 * 3, so the two zeros above are readings and not a mis-shaped probe.)
 *
 * ## Why the render half is the discriminating half, and why it is inverted here
 *
 * objectui#6318's triage: a "correction" that renders identically proves the
 * SCHEMA was the wrong side. The tree-view row of this card cleared that bar by
 * rendering identically. This row clears the STRONGER, opposite-polarity bar —
 * "correcting" the fixtures toward the declaration does not merely change the
 * render, it EMPTIES THE BOARD. Measured through this file's harness on
 * `78a3cc238`, before either declaration was touched:
 *
 *   basic-kanban-board       `cards` 64 elements, "To Do2 … Design new feature …"
 *                            `items` 45 elements, "No cards3 columnsTo Do0 …"
 *   advanced-…-and-limits    `cards` 86 elements, "Backlog2 … User Authentication …"
 *                            `items` 58 elements, "No cards4 columnsBacklog0 …"
 *
 * ⚠️ Those four readings are the measurement objectui#6939 was decided on and
 * they are left verbatim. Two of them are no longer what the harness returns:
 * objectui#9170 removed the lane count from the board-level empty state, so the
 * `items` rows lost one element and the "N columns" phrase each. The `cards`
 * rows are untouched — those boards hold cards, so the board-level empty state
 * never paints on them. The current readings, and the subtraction between the
 * two, are below.
 *
 * `column.cards || []` in `bucketCardsIntoColumns` is the mechanism: under the
 * `items` spelling every column buckets to zero cards. So the accepted spelling
 * had to move to `cards` — renaming the twelve read sites instead would have
 * emptied every authored board.
 *
 * ## The accept-set move this pins (Clause-② surface)
 *
 * Before: the two catalog entries FAILED `safeValidateSchema` (": Invalid
 * input") and the `items` spelling PASSED. After: exactly reversed. That is a
 * published mirror's accept/reject behaviour moving, and a renamed member on a
 * published type — pinned in both directions below.
 *
 * ⚠️ That vector has moved TWICE more since, on the surviving face rather than
 * on this arm, and the two `it`s below carry the current reading with its
 * reason: objectui#8802 retired the `kanban` arm (everything inside `columns`
 * went unjudged), and objectui#8913 declared `columns` on `ObjectKanbanSchema`
 * with the PROTOCOL's element union — a bare value string or a `{ id, title }`
 * lane whose `cards` is OPTIONAL. So a lane card's `title` is judged again
 * while `cards` itself is not required, and an undeclared lane key such as
 * `items` stays accepted-and-dropped.
 *
 * ## The harness, and why identity is claimed only within it
 *
 * `kanban` resolves to `KanbanRenderer`, which is
 * `<Suspense><LazyKanban/></Suspense>` over `React.lazy(() =>
 * import('./KanbanImpl'))`. A bare render measures the Suspense fallback — one
 * `<div>` skeleton, empty `textContent`, which is the vacuous identity pin this
 * file must not be (it was the first reading taken here, and it was discarded).
 *
 * `measure()` therefore settles the boundary with `waitFor`, the same way the
 * sibling `catalog-gallery-render.test.tsx` settles it for these very entries
 * (its comment names `kanban` as one of its three `React.lazy` categories).
 * Side-effect-importing the lazy chunk at module scope would be faster, but the
 * only specifier that reaches it — `@object-ui/plugin-kanban/KanbanImpl` — is
 * not in the package's `exports` map and resolves solely through the repo's
 * vitest source alias. objectui#4325 ruled that shape out for
 * `@object-ui/fields`: a package's surface is its index, and one test's preload
 * does not justify minting permanent public API. The witness used here is a
 * column heading, which exists in BOTH the populated and the empty board, so
 * the wait cannot pass for one spelling and time out for the other.
 *
 * Absolute counts are harness-relative; identity within THIS harness is the claim.
 *
 * Three readings per tile, because a count alone cannot tell a swapped element
 * from an equal one: element count, a tag census, and the text — visible text
 * as a literal, plus a SHA-256 over the full `textContent` with the Radix
 * scroll-area `<style>` blocks included.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import '@object-ui/components';
import '@object-ui/plugin-kanban';
import { SchemaRenderer, SchemaRendererProvider, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const IDS = [
  'plugin-kanban/basic-kanban-board',
  'plugin-kanban/advanced-kanban-with-badges-and-limits',
] as const;

type Reading = {
  elements: number;
  tags: Record<string, number>;
  sha256: string;
  visibleText: string;
};

/** Radix ScrollArea injects this per viewport; folded out of `visibleText`. */
const SCROLL_AREA_STYLE =
  '[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;' +
  '-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}';

/**
 * The AUTHORED (`cards`) spelling, measured on `origin/main` @ `78a3cc238`
 * through `measure()` below with both declarations still saying `items`. The
 * repair must not move any of these numbers.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#12837, and kept for the
 * reason `ITEMS_SPELLING_6939` is kept: `PRE_REPAIR` below is this reading with
 * ONE string swapped, and that swap is asserted.
 */
const PRE_REPAIR_PRE_12837: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 64,
    tags: { DIV: 52, SPAN: 6, H3: 3, STYLE: 3 },
    sha256: '034c51898d2e87caa57aaced4c1eff31c8b0e9f3832cd55ee2847aa580b084b4',
    visibleText: "To Do2Design new featureCreate mockups and wireframesWrite documentationUpdate API docsIn Progress1Implement featureCode the new componentHigh PriorityDone1Setup projectInitialize repository\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 86,
    tags: { DIV: 68, SPAN: 10, H3: 4, STYLE: 4 },
    sha256: 'bec0ae1f2c2a0c945ad582232730fe29a25c529f63f2e4996b40c8ef77454d66',
    visibleText: "Backlog2User AuthenticationImplement OAuth2.0BackendHighDark ModeAdd theme switcherUIWork In Progress1 / 3API IntegrationConnect to backend servicesIn ProgressCode Review0No cardsCompleted1Project SetupRepository initialized\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
};

/**
 * The `items` spelling, measured in the same run on `78a3cc238`. This is the
 * board the declaration was asking authors to write, and it is empty. Pinned so
 * that the claim "the rename is toward the shape that ships" stays a
 * measurement.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#9170, and kept for a reason
 * rather than out of sentiment: the current reading below is stated as this one
 * MINUS one named node, and that subtraction is asserted. A census updated by
 * overwriting its own numbers records that something moved and destroys the
 * evidence of what; two literals and a delta case keep both.
 */
const ITEMS_SPELLING_6939: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 45,
    tags: { DIV: 31, SPAN: 6, H3: 4, P: 1, STYLE: 3 },
    sha256: '2523834600c510b6673b125862cb2041d9b20d3ddc8c0f53292b17f227d73410',
    visibleText: "No cards3 columnsTo Do0In Progress0Done0\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 58,
    tags: { DIV: 39, SPAN: 9, H3: 5, P: 1, STYLE: 4 },
    sha256: 'acd99051b378a9eaf6e5096604dba293a6b8f14bd0b8af68e511bc2b1269eeb0',
    visibleText: "No cards4 columnsBacklog0Work In Progress0 / 3Code Review0Completed0\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
};

/**
 * The `items` spelling after objectui#9170 removed the lane count from the
 * board-level empty state's description.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#12837 (see
 * `ITEMS_SPELLING` below), and kept: the objectui#9170 delta case still
 * compares against it, and the objectui#12837 delta case starts from it.
 *
 * ⭐ Written as its own literal rather than derived from the baseline above: a
 * computed expectation would agree with that baseline by construction, and the
 * whole point of keeping both is that the delta case can compare two
 * independently written readings.
 *
 * objectui#6939's own result is UNCHANGED by that card and still visible here —
 * the `items` board is still empty, still says "No cards", and still reads zero
 * on every column. What left is one `<p>`: `DataEmptyState` renders its
 * description as `{description && <p …>{description}</p>}`, and route 3 passes
 * none.
 */
const ITEMS_SPELLING_PRE_12837: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 44,
    tags: { DIV: 31, SPAN: 6, H3: 4, STYLE: 3 },
    sha256: '16bf02258c44ba4044d5d1336c0e6d7d9db3b879846d9247d5162fe7ea0b4586',
    visibleText: "No cardsTo Do0In Progress0Done0\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 57,
    tags: { DIV: 39, SPAN: 9, H3: 5, STYLE: 4 },
    sha256: '6adfe4595da25bb8e84f679d3e7e4517258ad5eac8facbd5cc9c6632f8fa8e76',
    visibleText: "No cardsBacklog0Work In Progress0 / 3Code Review0Completed0\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  ",
  },
};

/**
 * dnd-kit's default screen-reader instructions, which every card's
 * `aria-describedby` pointed at until objectui#12837 (the board's hidden
 * instructions node; its text lands in `textContent`).
 */
const DND_KIT_DEFAULT_INSTRUCTIONS =
  '\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n' +
  '    Press space again to drop the item in its new position, or press escape to cancel.\n  ';

/**
 * What the board's instructions node reads since objectui#12837: the en value
 * of `kanban.dnd.instructions`. This harness mounts no translation provider,
 * so the text comes from `useKanbanT`'s provider-less defaults in
 * `packages/plugin-kanban/src/KanbanImpl.tsx`, which `pnpm check:i18n-keys`
 * holds equal to the en pack. This package does not depend on
 * `@object-ui/i18n`, so the value is held here once rather than imported.
 */
const KANBAN_DND_INSTRUCTIONS_EN = 'To move this card to another column, drag it with a pointer or by touch.';

/**
 * The AUTHORED (`cards`) spelling after objectui#12837 replaced the board's
 * instructions text. Written as its own literal, not derived from
 * `PRE_REPAIR_PRE_12837`, so the delta case compares two independently
 * written readings.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#12883 (see `PRE_REPAIR`
 * below), and kept: the objectui#12837 delta case ends on it, and the
 * objectui#12883 delta case starts from it.
 */
const PRE_REPAIR_PRE_12883: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 64,
    tags: { DIV: 52, SPAN: 6, H3: 3, STYLE: 3 },
    sha256: 'fe90e1cc6d10ddd0ba415df89ecdf6be451a9ba1831ce4adfdacbbb77702d263',
    visibleText: "To Do2Design new featureCreate mockups and wireframesWrite documentationUpdate API docsIn Progress1Implement featureCode the new componentHigh PriorityDone1Setup projectInitialize repositoryTo move this card to another column, drag it with a pointer or by touch.",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 86,
    tags: { DIV: 68, SPAN: 10, H3: 4, STYLE: 4 },
    sha256: 'f80e461758a7005a05d13bd53afe4604cc9b465cbb9d6e70961108b69fdec303',
    visibleText: "Backlog2User AuthenticationImplement OAuth2.0BackendHighDark ModeAdd theme switcherUIWork In Progress1 / 3API IntegrationConnect to backend servicesIn ProgressCode Review0No cardsCompleted1Project SetupRepository initializedTo move this card to another column, drag it with a pointer or by touch.",
  },
};

/**
 * The AUTHORED (`cards`) spelling after objectui#12883 made each card a
 * `button` inside its own `listitem` wrapper: one more `<div>` per card, and
 * nothing else — no text moved. Written as its own literal, not derived from
 * `PRE_REPAIR_PRE_12883`, so the delta case below compares two independently
 * written readings. The `items` readings do not move: that board draws no
 * card.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#13054 (see `PRE_REPAIR`
 * below), and kept: the objectui#12883 delta case ends on it, and the
 * objectui#13054 delta case starts from it.
 */
const PRE_REPAIR_PRE_13054: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 68,
    tags: { DIV: 56, SPAN: 6, H3: 3, STYLE: 3 },
    sha256: 'fe90e1cc6d10ddd0ba415df89ecdf6be451a9ba1831ce4adfdacbbb77702d263',
    visibleText: "To Do2Design new featureCreate mockups and wireframesWrite documentationUpdate API docsIn Progress1Implement featureCode the new componentHigh PriorityDone1Setup projectInitialize repositoryTo move this card to another column, drag it with a pointer or by touch.",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 90,
    tags: { DIV: 72, SPAN: 10, H3: 4, STYLE: 4 },
    sha256: 'f80e461758a7005a05d13bd53afe4604cc9b465cbb9d6e70961108b69fdec303',
    visibleText: "Backlog2User AuthenticationImplement OAuth2.0BackendHighDark ModeAdd theme switcherUIWork In Progress1 / 3API IntegrationConnect to backend servicesIn ProgressCode Review0No cardsCompleted1Project SetupRepository initializedTo move this card to another column, drag it with a pointer or by touch.",
  },
};

/**
 * The `items` spelling after objectui#12837. objectui#6939's result is
 * unchanged: the board is still empty, says "No cards", and reads zero on
 * every column.
 *
 * ⚠️ SUPERSEDED as the expected reading by objectui#13054 (see
 * `ITEMS_SPELLING` below), and kept: the objectui#12837 delta case ends on it,
 * and the objectui#13054 delta case starts from it.
 */
const ITEMS_SPELLING_PRE_13054: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 44,
    tags: { DIV: 31, SPAN: 6, H3: 4, STYLE: 3 },
    sha256: 'd863684901a946ea155c8cd2e118e01e808c8428d3715011fd0d2df1e880f7e5',
    visibleText: "No cardsTo Do0In Progress0Done0To move this card to another column, drag it with a pointer or by touch.",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 57,
    tags: { DIV: 39, SPAN: 9, H3: 5, STYLE: 4 },
    sha256: '21e8e94cce3ad4ee15b0eb5d19c0363091b7b5f10d910e0f0cb925ccbe43be33',
    visibleText: "No cardsBacklog0Work In Progress0 / 3Code Review0Completed0To move this card to another column, drag it with a pointer or by touch.",
  },
};

/**
 * The id prefix of the board's move status region (objectui#13054): one
 * visually hidden `role="status"` `<div>` every board renders, empty until a
 * cross-column move's write settles and the board announces its outcome there.
 */
const MOVE_STATUS_REGION = '[id^="KanbanMoveStatus"]';

/**
 * The AUTHORED (`cards`) spelling as it reads TODAY, after objectui#13054 gave
 * the board its own move status region: one more `<div>`, holding no text
 * until a move settles, and nothing else. Written as its own literal, not
 * derived from `PRE_REPAIR_PRE_13054`, so the delta case below compares two
 * independently written readings.
 */
const PRE_REPAIR: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 69,
    tags: { DIV: 57, SPAN: 6, H3: 3, STYLE: 3 },
    sha256: 'fe90e1cc6d10ddd0ba415df89ecdf6be451a9ba1831ce4adfdacbbb77702d263',
    visibleText: "To Do2Design new featureCreate mockups and wireframesWrite documentationUpdate API docsIn Progress1Implement featureCode the new componentHigh PriorityDone1Setup projectInitialize repositoryTo move this card to another column, drag it with a pointer or by touch.",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 91,
    tags: { DIV: 73, SPAN: 10, H3: 4, STYLE: 4 },
    sha256: 'f80e461758a7005a05d13bd53afe4604cc9b465cbb9d6e70961108b69fdec303',
    visibleText: "Backlog2User AuthenticationImplement OAuth2.0BackendHighDark ModeAdd theme switcherUIWork In Progress1 / 3API IntegrationConnect to backend servicesIn ProgressCode Review0No cardsCompleted1Project SetupRepository initializedTo move this card to another column, drag it with a pointer or by touch.",
  },
};

/**
 * The `items` spelling as it reads TODAY, after objectui#13054: the same one
 * empty move status `<div>` as the authored board, and objectui#6939's result
 * unchanged — still empty, still "No cards", still zero on every column.
 */
const ITEMS_SPELLING: Record<(typeof IDS)[number], Reading> = {
  'plugin-kanban/basic-kanban-board': {
    elements: 45,
    tags: { DIV: 32, SPAN: 6, H3: 4, STYLE: 3 },
    sha256: 'd863684901a946ea155c8cd2e118e01e808c8428d3715011fd0d2df1e880f7e5',
    visibleText: "No cardsTo Do0In Progress0Done0To move this card to another column, drag it with a pointer or by touch.",
  },
  'plugin-kanban/advanced-kanban-with-badges-and-limits': {
    elements: 58,
    tags: { DIV: 40, SPAN: 9, H3: 5, STYLE: 4 },
    sha256: '21e8e94cce3ad4ee15b0eb5d19c0363091b7b5f10d910e0f0cb925ccbe43be33',
    visibleText: "No cardsBacklog0Work In Progress0 / 3Code Review0Completed0To move this card to another column, drag it with a pointer or by touch.",
  },
};

/** Render one entry through the provider-wrapped bare renderer and measure it. */
async function measure(
  schema: unknown,
): Promise<Reading & { text: string; moveStatus: Array<{ tag: string; text: string; childCount: number }> }> {
  const { container, unmount } = render(
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </SchemaRendererProvider>,
  );
  // A column heading exists in BOTH the populated and the empty board, so this
  // wait is a carrier legal in both states — it cannot pass for one spelling
  // and time out for the other.
  await waitFor(() => expect(container.querySelector('h3')).not.toBeNull());
  const nodes = Array.from(container.querySelectorAll('*'));
  const text = container.textContent ?? '';
  const tags = nodes.reduce<Record<string, number>>((h, el) => ((h[el.tagName] = (h[el.tagName] ?? 0) + 1), h), {});
  const out = {
    elements: nodes.length,
    tags,
    sha256: createHash('sha256').update(text).digest('hex'),
    visibleText: text.split(SCROLL_AREA_STYLE).join(''),
    text,
    moveStatus: Array.from(container.querySelectorAll(MOVE_STATUS_REGION)).map((el) => ({
      tag: el.tagName,
      text: el.textContent ?? '',
      childCount: el.querySelectorAll('*').length,
    })),
  };
  unmount();
  return out;
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** The same document with every column's `cards` renamed back to `items`. */
function toItemsSpelling(schema: unknown): unknown {
  const s = JSON.parse(JSON.stringify(schema)) as { columns: Array<Record<string, unknown>> };
  for (const col of s.columns) {
    col.items = col.cards;
    delete col.cards;
  }
  return s;
}

describe('objectui#6939 — the mirror now accepts the spelling every board reads', () => {
  it.each(IDS)('%s validates under safeValidateSchema', (id) => {
    // Each reported `: Invalid input` on `78a3cc238` — `columns[].items` was
    // required and no authored entry has ever carried it.
    expect(reasons(getExample(id).schema)).toEqual([]);
  });

  it.each(IDS)('⚠️ %s: `columns[].items` is ACCEPTED again — objectui#6939\'s judging was ARM-SCOPED and the arm retired', (id) => {
    // ⭐ This leg asserted `.not.toEqual([])` — REFUSED — until objectui#8802.
    // The reading flipped, and it flipped for a structural reason worth
    // spelling out rather than papering over:
    //
    //   - objectui#6939 made `columns[].cards` a JUDGED key by declaring
    //     `columns: z.array(KanbanColumnSchema)` on the `kanban` arm;
    //   - objectui#8802 retired that arm with the bare node type key, and the
    //     surviving `object-kanban` face (`objectql.zod.ts#ObjectKanbanSchema`)
    //     has NEVER declared `columns`;
    //   - so `columns` now rides `BaseSchema`'s `.passthrough()` and nothing
    //     inside it is judged — not the `cards` / `items` spelling, not a
    //     card's required `title`, not `cards`'s type.
    //
    // ⭐ objectui#8913 DECLARED `columns` on `ObjectKanbanSchema` — and this leg
    // is STILL green, which is the finding that card had to make rather than
    // the one it was sent to make. Two corrections to the paragraph above:
    //
    //   1. declaring on this face NARROWED, it did not widen — `BaseSchema`
    //      carried `[key: string]: any` / `.passthrough()` then, so a
    //      declaration could only add validation where there was none;
    //   2. `columns[].items` was never refused BY NAME even on the retired
    //      arm. `KanbanColumnSchema` is a plain (strip-postured) object, so
    //      `items` was accepted and dropped there too; what refused the
    //      document was the arm's REQUIRED `cards`. objectui#8913 could not
    //      make `cards` required, because `@objectstack/spec` declares a lane
    //      as `{ id, title }` per `groupBy` value — no `cards` — and the
    //      protocol is the authority. So `items` stays accepted-and-dropped,
    //      and the judging that came back is the one below.
    expect(reasons(toItemsSpelling(getExample(id).schema))).toEqual([]);
  });

  it('⭐ `cards` is a JUDGED declaration again on the surviving arm (objectui#8913) — measured, with a firing control', () => {
    // The same four probes objectui#6939 wrote, re-read on the surviving face.
    //
    // The vector moved TWICE. objectui#6939 made all four judged on the
    // `kanban` arm; objectui#8802 retired that arm and all four went green
    // (unjudged); objectui#8913 declared `columns` on `object-kanban` and the
    // two NONSENSE probes are refused again. `cardsAbsent` is the one that
    // deliberately did NOT come back — and its `true` is the protocol, not an
    // oversight: `@objectstack/spec` describes a lane as `{ id, title }` per
    // `groupBy` value, its own gate-validated example authors three lanes with
    // no `cards`, and `bucketCardsIntoColumns` reads `col.cards || []`. A lane
    // is a SWIMLANE first; carrying its own cards is the static board's option.
    const col = (extra: Record<string, unknown>) => ({
      type: 'object-kanban',
      groupBy: 'status',
      data: [],
      columns: [{ id: 'todo', title: 'To Do', ...extra }],
    });
    expect({
      cardsIsAString: safeValidateSchema(col({ cards: 'nope' })).success,
      cardHasNoTitle: safeValidateSchema(col({ cards: [{ id: '1' }] })).success,
      cardsAbsent: safeValidateSchema(col({})).success,
      wellFormed: safeValidateSchema(col({ cards: [{ id: '1', title: 'Task' }] })).success,
    }).toEqual({ cardsIsAString: false, cardHasNoTitle: false, cardsAbsent: true, wellFormed: true });

    // FIRING CONTROL on the same call: the surviving arm is not refusing
    // everything either — its own tombstone refuses by name on a document whose
    // `columns` is well-formed, so the vector above is a reading about
    // `columns` and not about a validator stuck in one direction.
    expect(safeValidateSchema({ ...col({ cards: [] }), groupField: 'status' }).success).toBe(false);
  });
});

describe('objectui#6939 — and the repair moved the validator, not the renderer', () => {
  it.each(IDS)('%s renders exactly what it rendered before', async (id) => {
    const after = await measure(getExample(id).schema);
    const before = PRE_REPAIR[id];
    expect(after.elements).toBe(before.elements);
    expect(after.tags).toEqual(before.tags);
    expect(after.visibleText).toBe(before.visibleText);
    expect(after.sha256).toBe(before.sha256);
  });

  it.each(IDS)('%s anti-vacuity: the authored columns AND cards are on screen', async (id) => {
    // A tile that renders nothing satisfies "identical" trivially — and the
    // empty board below is exactly such a tile, so this guard is load-bearing.
    const schema = getExample(id).schema as {
      columns: Array<{ title: string; cards: Array<{ title: string }> }>;
    };
    const m = await measure(schema);
    expect(m.text).not.toContain('failed to render');
    expect(m.text).not.toContain('Unknown component type');
    for (const column of schema.columns) {
      expect(m.visibleText).toContain(column.title);
      for (const card of column.cards) expect(m.visibleText).toContain(card.title);
    }
    // At least one card actually exists, or the loop above is vacuous.
    expect(schema.columns.reduce((n, c) => n + c.cards.length, 0)).toBeGreaterThan(0);
  });

  it.each(IDS)('%s: the `items` spelling still draws an EMPTY board', async (id) => {
    // The discriminator. `bucketCardsIntoColumns` reads `col.cards || []`, so
    // under `items` every column buckets to zero — unchanged by this card,
    // which is why this reading is a carrier legal in both states.
    const m = await measure(toItemsSpelling(getExample(id).schema));
    const expected = ITEMS_SPELLING[id];
    expect(m.elements).toBe(expected.elements);
    expect(m.tags).toEqual(expected.tags);
    expect(m.visibleText).toBe(expected.visibleText);
    expect(m.sha256).toBe(expected.sha256);
    // Named explicitly: no authored card title survives, and every column reads zero.
    expect(m.visibleText).toContain('No cards');
    const schema = getExample(id).schema as { columns: Array<{ cards: Array<{ title: string }> }> };
    for (const column of schema.columns) {
      for (const card of column.cards) expect(m.visibleText).not.toContain(card.title);
    }
  });

  it.each(IDS)('%s: the `items` census moved by exactly the description objectui#9170 removed', (id) => {
    // ⭐ THE RE-DERIVATION. This case did not exist before objectui#9170. The
    // `items` readings were absolute numbers measured on `78a3cc238`, and route 3
    // moved two of the four on each arm — CI said `expected 57 to be 58` and
    // `expected 44 to be 45`.
    //
    // ⛔ Decrementing those literals would have recorded THAT something moved
    // and destroyed the evidence of WHAT: the next reader would find a census
    // one lower than the card that established it, with nothing saying whether a
    // description, a lane or a wrapper had gone. So both readings are kept, each
    // written as its own literal, and the ONE difference between them is
    // asserted here. Anything else that moves this census — a lane that stops
    // rendering, a wrapper that appears, a second string that disappears — fails
    // this case instead of being absorbed into a new baseline.
    //
    // ⚠️ This is also the case that decides WHICH KIND of failure the CI red was.
    // A census that moves because the change removed something it was counting is
    // a correct report; a census that moves because the change removed something
    // else is a defect in the change. Legs (1) and (2) below are what tell those
    // apart, and they say: exactly the description `<p>`, exactly the lane-count
    // phrase, nothing else.
    const before = ITEMS_SPELLING_6939[id];
    const after = ITEMS_SPELLING_PRE_12837[id];

    // (1) one element fewer, and it is the description `<p>` —
    // `DataEmptyState` renders `{description && <p …>{description}</p>}`, so
    // passing no description removes exactly that node.
    expect(after.elements).toBe(before.elements - 1);
    const { P, ...everyOtherTag } = before.tags;
    expect(P, 'the pre-9170 census must contain the <p> this card removed, or the subtraction is imaginary').toBe(1);
    expect(after.tags, 'a tag other than the description <p> moved').toEqual(everyOtherTag);

    // (2) exactly the lane-count phrase left the text. The phrase is derived
    // from the DOCUMENT's own lane count rather than hard-coded, so the two
    // entries are checked against their own shapes and a fixture that gains a
    // lane cannot quietly satisfy this with the other one's number.
    const laneCount = `${(getExample(id).schema as { columns: unknown[] }).columns.length} columns`;
    expect(before.visibleText, `the pre-9170 text must contain "${laneCount}"`).toContain(laneCount);
    expect(before.visibleText.replace(laneCount, ''), 'more than the lane count left the text').toBe(
      after.visibleText,
    );
    expect(after.visibleText, 'a lane count is back in the announcement').not.toMatch(/\d+ columns/);

    // (3) ⛔ objectui#6939's own result is NOT what moved. The `items` board is
    // still empty, still announces, and still reads zero on every column — which
    // is the finding this whole file exists to hold, and route 3 does not touch
    // it.
    expect(before.visibleText.startsWith('No cards'), 'the pre-9170 board announced').toBe(true);
    expect(after.visibleText.startsWith('No cards'), 'the board stopped announcing — that is not this card').toBe(true);
    // …and the two readings really are two, not one constant referenced twice.
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.elements).not.toBe(before.elements);
  });

  it.each(IDS)('%s: both censuses moved by exactly the instructions text objectui#12837 replaced', (id) => {
    // The same discipline as the objectui#9170 case above: the pre-12837
    // readings are kept, and the ONE difference is asserted. objectui#12837
    // gave the board's DndContext `screenReaderInstructions`, so the hidden
    // instructions node every card's `aria-describedby` points at stays, and
    // only its text changes from dnd-kit's default to the bundle sentence.
    const pairs = [
      ['authored (`cards`)', PRE_REPAIR_PRE_12837[id], PRE_REPAIR_PRE_12883[id]],
      ['`items`', ITEMS_SPELLING_PRE_12837[id], ITEMS_SPELLING_PRE_13054[id]],
    ] as const;
    for (const [spelling, before, after] of pairs) {
      // (1) the node stays: no element and no tag moved.
      expect(after.elements, `${spelling}: an element moved`).toBe(before.elements);
      expect(after.tags, `${spelling}: a tag moved`).toEqual(before.tags);
      // (2) exactly the instructions text was swapped, and nothing else.
      expect(before.visibleText, `${spelling}: the pre-12837 text must carry dnd-kit's default`).toContain(
        DND_KIT_DEFAULT_INSTRUCTIONS,
      );
      expect(
        before.visibleText.replace(DND_KIT_DEFAULT_INSTRUCTIONS, KANBAN_DND_INSTRUCTIONS_EN),
        `${spelling}: more than the instructions text moved`,
      ).toBe(after.visibleText);
      // (3) the two readings really are two.
      expect(after.sha256, `${spelling}: one hash referenced twice`).not.toBe(before.sha256);
    }
  });

  it.each(IDS)('%s: the authored census moved by exactly one wrapper <div> per card (objectui#12883)', (id) => {
    // The same discipline again. objectui#12883 made each card a `button` (the
    // control Enter and Space activate) inside a `listitem` wrapper, because a
    // `button` cannot itself be the item its `role="list"` needs. That adds
    // one `<div>` per card and nothing else. The card count is derived from
    // the DOCUMENT, so a fixture that gains a card cannot satisfy this with
    // the other entry's number.
    const before = PRE_REPAIR_PRE_12883[id];
    const after = PRE_REPAIR_PRE_13054[id];
    const cardCount = (getExample(id).schema as { columns: Array<{ cards: unknown[] }> }).columns.reduce(
      (n, c) => n + c.cards.length,
      0,
    );
    expect(cardCount, 'a board with no card would make this delta vacuous').toBeGreaterThan(0);

    // (1) exactly one element per card, and every one of them is a <div>.
    expect(after.elements).toBe(before.elements + cardCount);
    const { DIV: divBefore, ...otherBefore } = before.tags;
    const { DIV: divAfter, ...otherAfter } = after.tags;
    expect(divAfter, 'not one <div> per card').toBe(divBefore + cardCount);
    expect(otherAfter, 'a tag other than <div> moved').toEqual(otherBefore);

    // (2) ⛔ no text moved: the wrapper draws nothing.
    expect(after.visibleText, 'the visible text moved').toBe(before.visibleText);
    expect(after.sha256, 'the text hash moved').toBe(before.sha256);
  });

  it.each(IDS)('%s: both censuses moved by exactly the empty move status region (objectui#13054)', async (id) => {
    // The same discipline again. objectui#13054 moved a cross-column move's
    // announcement from the drop to the moment its write settles, into one
    // board-owned, visually hidden `role="status"` `<div>`. Every board renders
    // it, empty until a move settles. That adds one `<div>` to each census and
    // nothing else; the RENDERER's output for these fixtures is otherwise
    // unchanged, which is the 6939 property this file holds.
    const pairs = [
      ['authored (`cards`)', PRE_REPAIR_PRE_13054[id], PRE_REPAIR[id], getExample(id).schema],
      ['`items`', ITEMS_SPELLING_PRE_13054[id], ITEMS_SPELLING[id], toItemsSpelling(getExample(id).schema)],
    ] as const;
    for (const [spelling, before, after, schema] of pairs) {
      // (1) exactly one element more, and it is a <div>.
      expect(after.elements, `${spelling}: not exactly one element more`).toBe(before.elements + 1);
      const { DIV: divBefore, ...otherBefore } = before.tags;
      const { DIV: divAfter, ...otherAfter } = after.tags;
      expect(divAfter, `${spelling}: the new element is not one <div>`).toBe(divBefore + 1);
      expect(otherAfter, `${spelling}: a tag other than <div> moved`).toEqual(otherBefore);
      // (2) ⛔ no text moved: the region holds nothing until a move settles.
      expect(after.visibleText, `${spelling}: the visible text moved`).toBe(before.visibleText);
      expect(after.sha256, `${spelling}: the text hash moved`).toBe(before.sha256);

      // (3) MEASURED, not inferred: the one extra node on today's render IS the
      // move status region — a single empty, childless <div> — and with it set
      // aside the render is the pre-13054 census exactly.
      const m = await measure(schema);
      expect(m.moveStatus, `${spelling}: the move status region`).toEqual([{ tag: 'DIV', text: '', childCount: 0 }]);
      expect(m.elements - 1, `${spelling}: without the region the census is not the pre-13054 one`).toBe(before.elements);
    }
  });
});
