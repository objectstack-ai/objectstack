/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8489 — a kanban card must not draw a badge it has no label for.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 * `ObjectKanban`'s explicit-card-field loop opens with
 * `if (raw == null || raw === '') continue;` — which an empty array passes —
 * and then FORKS on `isPicklist`, true for any field carrying declared
 * `options`. That fork never calls `getCellRenderer`, so objectui#8481's
 * renderer fix (an empty array is not a cell value) cannot reach it: the
 * branch resolves a label and a colour itself and pushes a plain object onto
 * `cardBadges`. With nothing to resolve, the label came out as the empty
 * string and the card drew a fully styled, fully coloured pill with no
 * children in it — the most commonly authored shape of the three, because a
 * picklist that declares its options is the normal case.
 *
 * ── What the repair is, and what it deliberately is NOT ───────────────────
 * The kanban does not learn what an "empty value" is. At the push site the
 * only question left is *is there a label to draw?*, so the branch declines
 * to push a badge whose RESOLVED label is empty. That is strictly narrower
 * than an emptiness judgement, and it closes both halves at once.
 *
 * ── Why the empty array is the easy case and not the subject ──────────────
 * ANY value that resolves to an empty label draws the same empty pill. A fix
 * that special-cases `[]` leaves the defect standing while reading as
 * complete, so the DISCRIMINATING pin below is `stringifiesToNothing` — a
 * NON-array stored value whose `String(...)` is empty. The empty array comes
 * along for free; built the other way round, it would not.
 *
 * Measured while writing these: the third shape the card imagined — an
 * OPTION whose declared `label` is the empty string — cannot reach the push
 * site as an empty label on its own. `opt?.label || String(raw)` falls back
 * to the stringified value, and the i18n hop cannot introduce one either:
 * `useObjectLabel`'s `resolve()` rejects a translation that is `''` and
 * returns its fallback (`packages/i18n/src/useObjectLabel.ts`). So the empty
 * label always arrives through `String(raw)`, by either of the two shapes
 * pinned here. Recorded because it is the reason there is no third case.
 *
 * ── Non-regression, derived from the two plausible WRONG fixes ────────────
 * "drop any badge whose label is falsy" would also drop a legitimately
 * authored `'0'` label, so `'0'` is pinned rendering normally, byte for
 * byte. "drop empty arrays" leaves the second half standing, so the
 * non-array case is pinned separately from the array one.
 *
 * ── Both push sites ───────────────────────────────────────────────────────
 * `cardBadges.push` happens twice in `ObjectKanban.tsx`: the explicit
 * `cardFields` loop, and the legacy semantic-field heuristic that runs when a
 * board authors no `cardFields` at all. Both resolve a label exactly the same
 * way (the file's own comment says so) and both had the defect, so both are
 * pinned; a repair on one alone leaves the pill drawable from the other.
 *
 * ── Why these assertions are at the DOM ───────────────────────────────────
 * `cardBadges` is an implementation array one refactor away from meaning
 * nothing; the defect is what the card DRAWS. Every count below is taken
 * from rendered nodes, scoped to one card through the `role="listitem"` /
 * `aria-label` handle `SortableCard` gives every card. `queryByText('')`
 * cannot express "no pill" (and `queryByText` throws on multiple matches as
 * well as none), so the pins COUNT nodes at a selector — and the first case
 * below verifies that selector matches exactly ONE node per badge, because
 * `.rounded-full` alone matches two nodes per avatar elsewhere in this repo.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary. Importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget under full parallelism (objectui#3010);
// same specifier as `index.tsx`'s factory, so ESM's module cache makes that
// factory resolve immediately.
import './KanbanImpl';

/**
 * A stored value that stringifies to nothing while being neither `null`,
 * nor the empty string, nor an array — the discriminating shape. It clears
 * the loop's `raw == null || raw === ''` guard, misses the option lookup
 * (nothing declares the empty value), and leaves `String(raw)` as the only
 * label the branch can resolve.
 */
const stringifiesToNothing = { toString: () => '' };

const TAGS_FIELD = {
  name: 'tags',
  type: 'multiselect',
  label: 'Tags',
  options: [{ value: 'alpha', label: 'Alpha', color: 'indigo' }],
};

/** `'0'` is a legitimately authored label, and it is falsy. */
const TIER_FIELD = {
  name: 'tier',
  type: 'picklist',
  label: 'Tier',
  options: [
    { value: 'zero', label: '0', color: 'blue' },
    { value: 'one', label: 'One', color: 'green' },
  ],
};

const CHANNEL_FIELD = {
  name: 'channel',
  type: 'picklist',
  label: 'Channel',
  options: [{ value: 'email', label: 'Email', color: 'amber' }],
};

/** The legacy heuristic's own badge field — reached with no `cardFields`. */
const PRIORITY_FIELD = {
  name: 'priority',
  type: 'picklist',
  label: 'Priority',
  options: [{ value: 'high', label: 'High', color: 'red' }],
};

const OBJECT_SCHEMA = {
  name: 'test_object',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    status: { type: 'text' },
    tags: TAGS_FIELD,
    tier: TIER_FIELD,
    channel: CHANNEL_FIELD,
    priority: PRIORITY_FIELD,
  },
};

const ROWS: any[] = [
  // Every badge this board can draw correctly, on one card.
  { id: 'c1', name: 'Populated card', status: 'open', tags: ['alpha'], tier: 'zero', channel: 'email' },
  // The easy half: an empty array clears the loop's guard.
  { id: 'c2', name: 'Empty array card', status: 'open', tags: [] },
  // The discriminating half: NOT an array, still resolves to no label.
  { id: 'c3', name: 'Stringifies to nothing card', status: 'open', channel: stringifiesToNothing },
];

/** The legacy heuristic reads `priority` off the record, with no field list. */
const LEGACY_ROWS: any[] = [
  { id: 'l1', name: 'Legacy populated card', status: 'open', priority: 'high' },
  { id: 'l2', name: 'Legacy empty array card', status: 'open', priority: [] },
  { id: 'l3', name: 'Legacy stringifies to nothing card', status: 'open', priority: stringifiesToNothing },
];

const LANES = [{ id: 'open', title: 'Open' }];

function makeDataSource(rows: any[]) {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
}

/**
 * The three populated pills, captured from a run BEFORE the repair. The
 * repair may not move one byte of them: it only declines a push, so the
 * markup of every badge that still has a label has to be what it was.
 */
const POPULATED_BADGE_HTML: string[] = [
  '<div class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-xs font-normal bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/60">Alpha</div>',
  '<div class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-xs font-normal bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60">0</div>',
  '<div class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-xs font-normal bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60">Email</div>',
];

/** The same capture for the legacy heuristic's own pill. */
const LEGACY_POPULATED_BADGE_HTML: string[] = [
  '<div class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-xs font-normal bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60">High</div>',
];

afterEach(cleanup);

/**
 * Every badge pill drawn inside one card, in document order.
 *
 * The selector is the `Badge` primitive's own cva base — `inline-flex` and
 * `whitespace-nowrap` together with `rounded-full`. Radix's `Avatar.Root` and
 * `AvatarFallback`, the two nodes that make a bare `.rounded-full` count
 * double elsewhere in this repo, carry neither, so this matches exactly one
 * node per badge. The `renders exactly one node per badge` case below proves
 * that rather than asserting it.
 */
function badgesIn(card: HTMLElement): HTMLElement[] {
  return Array.from(
    card.querySelectorAll<HTMLElement>('div.inline-flex.whitespace-nowrap.rounded-full'),
  );
}

/** The card whose accessible name is `title` — `SortableCard`'s own handle. */
function cardNamed(title: string): HTMLElement {
  return screen.getByRole('listitem', { name: title });
}

async function renderBoard(rows: any[], cardFields?: string[]) {
  const adapter = makeDataSource(rows);
  const result = render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'test_object',
            groupBy: 'status',
            columns: LANES,
            ...(cardFields ? { cardFields } : {}),
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain(rows[0].name));
  return result;
}

describe('objectui#8489 — the card declines to draw a badge with no label', () => {
  describe('the explicit cardFields picklist branch', () => {
    it('renders exactly one node per badge at the counting selector', async () => {
      await renderBoard(ROWS, ['tags', 'tier', 'channel']);
      const populated = cardNamed('Populated card');

      // Three declared, populated card fields -> three pills, and the
      // selector resolves them one-for-one. Without this the counts below
      // could not distinguish "no badge" from "a selector that never matched".
      expect(badgesIn(populated).map((b) => b.textContent)).toEqual(['Alpha', '0', 'Email']);
    });

    it('draws no badge for an empty array', async () => {
      await renderBoard(ROWS, ['tags', 'tier', 'channel']);

      // Mapped to outerHTML so a failure prints the pill that should not exist.
      expect(badgesIn(cardNamed('Empty array card')).map((b) => b.outerHTML)).toEqual([]);
    });

    it('draws no badge for a non-array value that stringifies to nothing', async () => {
      await renderBoard(ROWS, ['tags', 'tier', 'channel']);

      expect(
        badgesIn(cardNamed('Stringifies to nothing card')).map((b) => b.outerHTML),
      ).toEqual([]);
    });

    it('leaves every populated badge byte-identical to before the repair', async () => {
      await renderBoard(ROWS, ['tags', 'tier', 'channel']);

      expect(badgesIn(cardNamed('Populated card')).map((b) => b.outerHTML)).toEqual(
        POPULATED_BADGE_HTML,
      );
    });

    it("keeps a legitimately authored '0' label, which is falsy", async () => {
      await renderBoard(ROWS, ['tags', 'tier', 'channel']);
      const populated = cardNamed('Populated card');

      const zero = badgesIn(populated).filter((b) => b.textContent === '0');
      expect(zero).toHaveLength(1);
    });
  });

  describe('the legacy semantic-field heuristic (no cardFields authored)', () => {
    it('renders exactly one node per badge at the counting selector', async () => {
      await renderBoard(LEGACY_ROWS);

      expect(badgesIn(cardNamed('Legacy populated card')).map((b) => b.textContent)).toEqual([
        'High',
      ]);
    });

    it('leaves every populated badge byte-identical to before the repair', async () => {
      await renderBoard(LEGACY_ROWS);

      expect(badgesIn(cardNamed('Legacy populated card')).map((b) => b.outerHTML)).toEqual(
        LEGACY_POPULATED_BADGE_HTML,
      );
    });

    it('draws no badge for an empty array', async () => {
      await renderBoard(LEGACY_ROWS);

      expect(
        badgesIn(cardNamed('Legacy empty array card')).map((b) => b.outerHTML),
      ).toEqual([]);
    });

    it('draws no badge for a non-array value that stringifies to nothing', async () => {
      await renderBoard(LEGACY_ROWS);

      expect(
        badgesIn(cardNamed('Legacy stringifies to nothing card')).map((b) => b.outerHTML),
      ).toEqual([]);
    });
  });
});
