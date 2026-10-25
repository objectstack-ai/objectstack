/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9170 — the board's empty state announces "no cards" and nothing else.
 *
 * ## The defect, measured in the DOM on objectui#9169's branch
 *
 * `KanbanImpl` composed the board-level empty state's description by
 * CONCATENATION — the lane count, a space, then the pack's `kanban.columns`
 * unit word, a bare plural with no singular form. Reading the live region's own
 * `textContent` at three lane counts:
 *
 *   ZERO: "No cards0 columns"   ← grammatical (English takes the plural at 0)
 *   ONE:  "No cards1 columns"   ← the defect
 *   TWO:  "No cards2 columns"   ← grammatical
 *
 * `DataEmptyState` there is `role="status" aria-live="polite"`, so this is read
 * ALOUD, not merely printed.
 *
 * ## ⭐ Why the string was safe until objectui#9169 and is not any more
 *
 * The bare plural was not a latent bug — it was CORRECT for every board that
 * could reach it. The empty state used to require `boardColumns.length > 1`, so
 * the count in front of `columns` was never 1. objectui#9169 removed that
 * conjunct so a zero-lane and a one-lane board announce at all — that widening
 * IS the accessibility fix — and the one-lane form became reachable with it.
 *
 * ## The repair, and what it is NOT
 *
 * The maintainer's ruling on objectui#9170 (2026-09-12) took the third of the
 * card's three routes: the region's job is "no cards", the lane count is already
 * visible on the board, and read aloud it is noise. The description is removed,
 * so the announcement carries NO NUMBER AT ALL.
 *
 * ⛔ It is not the plural-family route (that was ruled against), and ⛔ it is not
 * a retreat to the `> 1` predicate — the zero- and one-lane boards still
 * announce, which is the whole of objectui#9045 and is asserted here as its own
 * leg rather than assumed.
 *
 * ## Why "no digit" and not just "equals No cards"
 *
 * The three rows below are asserted three ways on purpose. Byte equality pins
 * today's copy; the EQUALITY ACROSS the three rows is the claim the card's
 * measurement actually makes — the same string at every lane count; and the
 * absence of any digit is the one that survives a copy change, catching a count
 * that comes back in a spelling nobody predicted. A repair that reworded the
 * title would fail the first and still be held by the other two.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-kanban`.
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

const ONE_LANE = [{ id: 'todo', title: 'To Do' }];
const TWO_LANES = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
];

/** The lane shapes the card measured, in its own order. */
const SHAPES: Array<[row: string, schema: Record<string, unknown>]> = [
  ['ZERO', { type: 'object-kanban' }],
  ['ONE', { type: 'object-kanban', groupBy: 'status', columns: ONE_LANE }],
  ['TWO', { type: 'object-kanban', groupBy: 'status', columns: TWO_LANES }],
];

/**
 * The board's only live region — `role="status" aria-live="polite"`. Queried off
 * `document` rather than a render container so a portalled subtree could not
 * read as an absence.
 */
const liveRegion = () => document.querySelector('[role="status"][aria-live="polite"]');

/** What assistive technology is handed: the region's own text, whole. */
const announcement = () => (liveRegion()?.textContent ?? '');

/**
 * Pump the event loop inside `act` until `pred()` holds or the budget expires,
 * and REPORT whether it did — a rig that never completed must not read as an
 * absence.
 */
async function pumpUntil(pred: () => boolean, budgetMs = 3000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  return pred();
}

/**
 * Render an empty board at a given lane shape. `language` mounts a real
 * `I18nProvider` — the path the console takes; `null` mounts none, which is the
 * `createSafeTranslation` fallback path an embedder gets, and the path the
 * card's original three-lane measurement was taken on.
 */
function renderEmptyBoard(schema: Record<string, unknown>, language: string | null, rows: unknown[] = []) {
  const find = vi.fn(() => Promise.resolve({ data: rows, total: rows.length }));
  const dataSource = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const board = (
    <SchemaRendererProvider dataSource={dataSource as never}>
      <SchemaRenderer schema={{ objectName: 'deal', cardTitle: 'name', ...schema } as never} />
    </SchemaRendererProvider>
  );
  const result = render(
    language === null ? (
      board
    ) : (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{board}</I18nProvider>
    ),
  );
  return { ...result, find };
}

/** What a row reads when the board mounted and settled but announced nothing. */
const SILENT = '(no live region)';

/**
 * Settle the board, PROVE it settled, then read the live region.
 *
 * ⚠️ The rig self-check is on the BOARD, not on the live region, and the
 * difference is the whole diagnostic value of this helper. A missing live region
 * is a READING — it is what a board that stopped announcing looks like, which is
 * exactly the regression the `objectui#9045 is NOT undone` case below exists to
 * catch — so it returns `SILENT` and lets the caller judge it. A missing BOARD is
 * a rig failure and throws, because nothing can be read off a board that never
 * mounted.
 *
 * Read as non-empty text rather than an English needle: the title comes from the
 * pack, so a needle would make every non-`en` path fail as a rig failure instead
 * of as the reading it is. The exact text is asserted by the caller.
 */
async function settledAnnouncement(find: ReturnType<typeof vi.fn>): Promise<string> {
  await waitFor(() => expect(find).toHaveBeenCalled());
  const mounted = await pumpUntil(
    () => !!document.querySelector('[role="region"][aria-label="Kanban board"]'),
  );
  expect(mounted, 'RIG SELF-CHECK: the board itself must be on screen').toBe(true);
  const painted = await pumpUntil(() => announcement().trim().length > 0);
  return painted ? announcement() : SILENT;
}

/** Read all three lane shapes in one language, one render each. */
async function readAllThree(language: string | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [row, schema] of SHAPES) {
    const { find } = renderEmptyBoard(schema, language);
    out[row] = await settledAnnouncement(find);
    cleanup();
  }
  return out;
}

afterEach(cleanup);

/**
 * One render set per path, reused by the three claims below.
 *
 * ⭐ The claims are SEPARATE cases on purpose. As one case they were three
 * assertions in a row, and the first — byte equality — aborted before the other
 * two ran: under a mutation that swaps the description for another NUMBERLESS
 * string, the byte pin fires and the equality and no-digit legs are never
 * evaluated, so an ablation cannot show that they held. Assertions that share a
 * case cannot be measured independently, and three legs whose independence is
 * unmeasured are one leg wearing three hats.
 *
 * The cache is what makes that affordable: the renders happen once per path, not
 * once per claim. Nothing is cached unless the read completed, so a rig failure
 * re-reads rather than poisoning the later cases with a stale answer.
 */
const READ_CACHE = new Map<string, Record<string, string>>();
async function readings(language: string | null): Promise<Record<string, string>> {
  const cacheKey = language ?? '(no provider)';
  const cached = READ_CACHE.get(cacheKey);
  if (cached) return cached;
  const fresh = await readAllThree(language);
  READ_CACHE.set(cacheKey, fresh);
  return fresh;
}

/**
 * The three paths this has to hold on. They are not redundant:
 *
 *   - through the provider is what the console runs;
 *   - provider-less is `createSafeTranslation`'s fallback, which reads its own
 *     defaults table and never sees the pack — an embedder's path, and the one
 *     the card's original three-lane measurement was taken on;
 *   - `ru` is where the route this card did NOT take would have been hardest:
 *     a plural family there reaches `few` at the everyday two-to-four lanes.
 *     With no number in the region there is nothing for any language's plural
 *     rules to act on, and that is shown rather than argued.
 */
const PATHS: Array<[label: string, language: string | null, expected: string]> = [
  ['en, through the provider', 'en', 'No cards'],
  ['provider-less — an embedder, and the path the card measured', null, 'No cards'],
  ['ru — the numberless claim is language-independent', 'ru', 'Нет карточек'],
];

describe.each(PATHS)('objectui#9170 — %s', (_label, language, expected) => {
  it('reads the same copy, byte for byte, at zero / one / two lanes', async () => {
    expect(await readings(language)).toEqual({ ZERO: expected, ONE: expected, TWO: expected });
  });

  it('⭐ the SAME string at every lane count — the card\'s actual claim', async () => {
    // Stated as an equality rather than three literals: it keeps holding if the
    // copy is reworded, and stops holding the moment the rows diverge again —
    // which is precisely what "1 columns" was.
    const read = await readings(language);
    expect(new Set(Object.values(read)).size, `the three lane counts no longer read alike: ${JSON.stringify(read)}`).toBe(1);
  });

  it('carries no digit in any row — the leg that survives a rewording', async () => {
    // A count that comes back in a spelling nobody predicted is still a count.
    for (const [row, text] of Object.entries(await readings(language))) {
      expect(/\d/.test(text), `${row} put a number back into the live region: ${text}`).toBe(false);
    }
  });
});

describe('objectui#9170 — the rows above are readings, not an empty probe', () => {
  it('LIT CONTROL — a board WITH cards paints no live region at all', async () => {
    // Without this, "no digit in the live region" would also be true of a board
    // that never rendered one. ⛔ Not evidence of this card: it is what makes the
    // three rows above evidence.
    const { find, container } = renderEmptyBoard(
      { type: 'object-kanban', groupBy: 'status', columns: ONE_LANE },
      'en',
      [{ id: '1', name: 'Alpha', status: 'todo' }],
    );
    await waitFor(() => expect(find).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toContain('Alpha'));
    expect(liveRegion(), 'a board holding a card is not empty, whatever its lane count').toBeNull();
  });

  it('⛔ objectui#9045 is NOT undone — one lane still announces, it just says less', async () => {
    // Route 3 removes the NUMBER, never the announcement. A repair that restored
    // the `> 1` predicate would satisfy every "no digit" leg above by making the
    // region vanish on the two shapes objectui#9045 exists to serve — which is
    // the ablation leg this case exists to catch.
    for (const row of ['ZERO', 'ONE'] as const) {
      const schema = SHAPES.find(([name]) => name === row)![1];
      const { find } = renderEmptyBoard(schema, 'en');
      const text = await settledAnnouncement(find);
      expect(text, `${row} lanes: the board went silent — that is objectui#9045 undone`).toBe('No cards');
      cleanup();
    }
  });
});
