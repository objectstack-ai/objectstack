/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-grid.bulkActions` and `object-grid.bulkActionDefs` — the MEMBER
 * shapes this renderer reads (objectui#8071, criterion from objectui#8068).
 *
 * Both keys are declared `type: 'array'` with no `of`, and both spec rows are
 * `z.array(z.unknown())`: every coarse member kind parses on both declared
 * sides, so the read site is the whole member contract. And these two are the
 * pair where that matters most, because they are ONE affordance authored in TWO
 * vocabularies that land in the same selection bar:
 *
 *   - `bulkActions` members are BARE ACTION NAMES. `ObjectGrid.tsx` hands them
 *     to `resolveBulkActions`, which resolves each against `objectDef.actions`
 *     and PROMOTES the match to a full def — so a promoted button carries the
 *     object action's own label, icon and gates. A member that is not a string
 *     is skipped outright (`if (typeof name !== 'string') continue`).
 *   - `bulkActionDefs` members are FULL `BulkActionDef` OBJECTS, left as
 *     authored and never resolved against the object's action set.
 *
 * ⚠️ THE HAZARD, and why the negatives below are the load-bearing half. This is
 * the `page:header.actions` shape (objectui#6252 / objectstack#11592) with a
 * second key beside it: an author who writes the DEF vocabulary into
 * `bulkActions`, or a bare NAME into `bulkActionDefs`, is refused by nothing —
 * not the registration, not the spec, not `tsc` on a JSON view. Rows 2 and 5
 * are what keep that from becoming an accepted second dialect (AGENTS.md #0.1),
 * and what would red if either read site started COERCING one vocabulary into
 * the other.
 *
 * The two directions do not fail ALIKE, and that asymmetry is pinned as such:
 *
 *   - `bulkActions: [{ name: 'approve' }]` — the DEF vocabulary in the NAME
 *     key. Stepped over by `resolveBulkActions`'s `typeof name !== 'string'`
 *     guard, in SILENCE. Row 2.
 *   - `bulkActionDefs: ['approve']` — the NAME vocabulary in the DEF key.
 *     Skipped, and SAID OUT LOUD: one `console.warn` per authored array,
 *     naming the block, the index, what was seen and what to write instead.
 *     Row 5, with row 4 as its no-fire leg.
 *
 * ⚠️ ROW 5 WAS REWRITTEN, and the rewrite is the point of the original row.
 * It first pinned this direction's CRASH — the bare string reached
 * `BulkActionBar` with no `name`, and `formatActionLabel(undefined)` threw
 * `TypeError: Cannot read properties of undefined (reading 'replace')` DURING
 * RENDER, taking the whole selection bar down — as the CURRENT shape, with
 * objectui#8730 filed from it, precisely so that landing the fix would RED the
 * row instead of leaving it describing nothing. That is what happened: the fix
 * landed as PR #8741 (commit `baf3776a`), objectui#8730 closed completed on
 * 2026-09-09, the row went red in the merge queue, and it now pins the
 * CORRECTED contract — skip, diagnose, and leave the bar standing with its
 * well-formed siblings intact.
 *
 * The class-level coverage of that fix (every unusable member kind, the
 * survivors' order, referential identity, the diagnostic's own no-fire leg)
 * lives in `bulkActionDefsUnusableMember-8730.test.tsx`. What stays here is the
 * member-VOCABULARY fact this file is about: a bare name is not this key's
 * shape, and it is not lifted into one.
 *
 * ⛔ NOT a restatement of the declaration. The registration's prose ("Names of
 * actions offered once rows are selected" / "Full inline bulk-action
 * definitions") is the CLAIM; every row here is a render that would change if
 * the read site stopped honouring it. The unit-level resolution is covered by
 * `resolveBulkActions.test.ts`; this file is the block-level half — the same
 * facts observed through the registered `object-grid` renderer, which is the
 * surface an author actually writes against.
 *
 * `selection` is declared explicitly on every row so the ONLY variable between
 * them is the member shape. Left implicit, the grid auto-enables multi-select
 * from `hasBulkActions`, which is itself derived from these two keys — so a
 * negative row would lose its selection UI for the very reason under test and
 * pass without ever reaching the bar.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'os_invoice';

/**
 * The object declares ONE action, `approve`, with a label that is NOT the
 * humanized form of its name. That gap is the instrument: a button reading
 * "Approve the invoice" can only have come from resolving the member as a NAME
 * against `objectDef.actions`; a renderer that treated the member as a display
 * string would show "Approve".
 */
const OBJECT_ACTIONS = [
  { name: 'approve', label: 'Approve the invoice', variant: 'primary' },
];

function makeDataSource() {
  const rows = [
    { id: 'r1', name: 'INV-1', status: 'draft' },
    { id: 'r2', name: 'INV-2', status: 'draft' },
  ];
  return {
    find: vi.fn(async () => ({
      data: rows.map((r) => ({ ...r })),
      total: rows.length,
      hasMore: false,
      pageSize: 50,
    })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
      actions: OBJECT_ACTIONS,
    }),
  } as any;
}

async function renderAndSelectAll(schema: Record<string, unknown>) {
  render(
    <ActionProvider handlers={{}}>
      <ObjectGrid
        schema={
          {
            type: 'object-grid',
            objectName: OBJECT,
            columns: [{ field: 'name', label: 'Name' }],
            pagination: { pageSize: 50 },
            selection: { type: 'multiple' },
            ...schema,
          } as any
        }
        dataSource={makeDataSource()}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('INV-1')).toBeInTheDocument());
  const headerCheckbox = document.querySelector('thead [role="checkbox"]') as HTMLElement;
  expect(headerCheckbox, 'the multi-select header checkbox').toBeTruthy();
  fireEvent.click(headerCheckbox);
  await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
}

/**
 * Every bulk-action button in the bar, in DOM order, by `data-testid`.
 *
 * COUNTING, not navigating: an exact census is what refuses a renderer that
 * skips everything as well as one that skips nothing. The prefix ends in a
 * hyphen so the bar's own `bulk-actions-bar` testid cannot match, and the query
 * is scoped to the bar so a second bar shows up as a `getByTestId` failure
 * rather than as doubled counts.
 */
function renderedBulkActionIds(): string[] {
  const bar = screen.getByTestId('bulk-actions-bar');
  return Array.from(bar.querySelectorAll('[data-testid^="bulk-action-"]')).map(
    (n) => n.getAttribute('data-testid') as string,
  );
}

/** Just enough of a spy to read its call log, without vitest's generics. */
type ConsoleSpy = { mock: { calls: unknown[][] } };

/** The diagnostic channel this key owns: `console.warn` lines mentioning it. */
function bulkDefWarnings(warn: ConsoleSpy): string[] {
  return warn.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((line: string) => line.includes('bulkActionDefs'));
}

describe('object-grid `bulkActions` members are BARE ACTION NAMES (objectui#8071)', () => {
  it('1. a name member is resolved against `objectDef.actions` and promoted', async () => {
    await renderAndSelectAll({ bulkActions: ['approve'] });
    const button = await screen.findByTestId('bulk-action-approve');
    // The object action's OWN label, not `formatActionLabel('approve')`.
    expect(button).toHaveTextContent('Approve the invoice');
  });

  it('2. an object member is NOT this key\'s shape — skipped, and in silence', async () => {
    // The `page:header.actions` hole, checked on this key: `{ name }` is what
    // an author transplanting the def vocabulary would write, and
    // `resolveBulkActions` steps over any non-string member. Nothing reports it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderAndSelectAll({ bulkActions: [{ name: 'approve' }] });
      expect(screen.queryByTestId('bulk-action-approve')).not.toBeInTheDocument();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('3. a name matching no declared action still reaches the bar, by name', async () => {
    // Not a hole: `resolveBulkActions` keeps unresolved names so a consumer's
    // `runner.registerHandler('<name>', …)` stays reachable. Pinned because it
    // is the one case where the member is read as a name AND stays one — which
    // is what makes row 1's promotion an observable event rather than the only
    // path a string could take.
    await renderAndSelectAll({ bulkActions: ['no_such_action'] });
    expect(await screen.findByTestId('bulk-action-no_such_action')).toHaveTextContent(
      'No Such Action',
    );
  });
});

describe('object-grid `bulkActionDefs` members are FULL DEFS (objectui#8071)', () => {
  it('4. a def member renders as authored, and the channel stays QUIET', async () => {
    // `archive` is declared by NO object action, and the button still carries
    // the authored label: the def was read as-is, not resolved.
    //
    // ⭐ This row is also row 5's NO-FIRE LEG. A diagnostic that fires for
    // every authored array is worth exactly as little as one that never fires,
    // so row 5's `toHaveLength(1)` only means something next to a well-formed
    // list that produces none. Kept in the same file as the fire leg so the
    // pair cannot drift apart.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderAndSelectAll({
        bulkActionDefs: [{ name: 'archive', operation: 'custom', label: 'Put it away' }],
      });
      expect(await screen.findByTestId('bulk-action-archive')).toHaveTextContent('Put it away');
      expect(bulkDefWarnings(warn)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('5. a bare-name member is NOT this key\'s shape — it is SKIPPED and DIAGNOSED', async () => {
    // The mirror of row 2, and still the sharper of the pair: the two
    // vocabularies do not swap. What differs between the directions is the
    // TREATMENT, not the verdict — row 2's is skipped in silence, this one is
    // skipped out loud (objectui#8730, fixed by PR #8741 / `baf3776a`).
    //
    // ⛔ A SKIP IS NOT A COERCION, and that is what this row exists to hold.
    // `'approve'` is a REAL declared object action here, so a read site that
    // lifted the bare name into `{ name: 'approve' }` and resolved it the way
    // `bulkActions` does would render a button labelled "Approve the invoice"
    // — the exact second dialect AGENTS.md #0.1 refuses, and a product change
    // to what a `bulkActionDefs` member MEANS (objectui#3002 / objectui#3139).
    // The census below is what refuses it.
    //
    // ⛔ NOT "it does not throw". That is a tautology a renderer producing an
    // empty bar would also satisfy, so a WELL-FORMED SIBLING travels with the
    // bad member and is counted: the skip must be exactly one member wide.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderAndSelectAll({
        bulkActionDefs: [
          'approve',
          { name: 'archive', operation: 'custom', label: 'Put it away' },
        ],
      });

      // SKIPPED — and the sibling is not collateral. One id, not zero (skip
      // everything), not two (skip nothing), and not `bulk-action-approve`
      // (coercion). Reaching this line at all is the third assertion: the
      // pre-fix shape threw during render.
      expect(renderedBulkActionIds()).toEqual(['bulk-action-archive']);
      expect(screen.getByTestId('bulk-action-archive')).toHaveTextContent('Put it away');
      // The label the FULL coercion would have produced — lifted AND resolved
      // the way `bulkActions` is — named so the refusal is legible rather than
      // implied by an absent testid. Row 1 is its reachability control: that
      // row proves this exact string DOES render when a member is read as a
      // name in the key whose vocabulary that is, so its absence here is a
      // measured difference and not a string nothing ever produces.
      expect(screen.queryByText('Approve the invoice')).not.toBeInTheDocument();

      // THE BAR SURVIVES — the affordance the crash destroyed. `getByTestId`
      // throws if it did not, and its `key`/`Clear` half is proven by React
      // having no duplicate-key complaint: an undefined `name` produced one.
      expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
      expect(
        error.mock.calls
          .map((args: unknown[]) => args.map((a: unknown) => String(a)).join(' '))
          .filter((line: string) => line.includes('unique "key" prop')),
      ).toEqual([]);

      // DIAGNOSED — the half that makes this a diagnosis rather than a quieter
      // version of row 2's silence. Once per authored array, addressing the
      // member by INDEX and naming the key a bare action name belongs in.
      const lines = bulkDefWarnings(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('bulkActionDefs[0]');
      expect(lines[0]).toContain("'approve'");
      expect(lines[0]).toContain('bulkActions');
      // WHERE: the block is addressed, so the author knows which grid to open.
      expect(lines[0]).toContain("objectName: 'os_invoice'");
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('6. both keys reach ONE bar, authored defs first, and neither shadows the other', async () => {
    await renderAndSelectAll({
      bulkActions: ['approve'],
      bulkActionDefs: [{ name: 'archive', operation: 'custom', label: 'Put it away' }],
    });
    const bar = screen.getByTestId('bulk-actions-bar');
    const ids = Array.from(bar.querySelectorAll('[data-testid^="bulk-action-"]')).map((n) =>
      n.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['bulk-action-archive', 'bulk-action-approve']);
  });
});
