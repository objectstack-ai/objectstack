/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-grid.bulkActionDefs` — a member that is not a usable def is SKIPPED
 * and DIAGNOSED, never rendered (objectui#8730).
 *
 * ## What was wrong
 *
 * `bulkActions` and `bulkActionDefs` are one affordance authored in two
 * vocabularies: `bulkActions` members are BARE ACTION NAMES resolved against
 * `objectDef.actions`; `bulkActionDefs` members are FULL `BulkActionDef`
 * OBJECTS used as authored. Nothing refuses a member written in the other
 * vocabulary — both keys are registered `type: 'array'` with no `of`, and both
 * spec rows are `z.array(z.unknown())` — so the read site is the whole member
 * contract.
 *
 * Writing a bare name into `bulkActionDefs` did not fail quietly, it CRASHED:
 * `Array.isArray(schema.bulkActionDefs)` is true, the string travelled into the
 * authored list untouched, `BulkActionBar` rendered a `BulkActionButton` for
 * it, and `def.label ?? formatActionLabel(def.name)` threw
 * `TypeError: Cannot read properties of undefined (reading 'replace')` DURING
 * RENDER — the author's first multi-row selection lost the entire selection
 * bar. `key={def.name}` was `undefined` too, so React logged a duplicate-key
 * warning on the way down.
 *
 * ## What is pinned here
 *
 * "Usable" is defined by what the RENDERER READS, not by a fresh opinion:
 * `BulkActionBar` uses `def.name` both as the React `key` and as
 * `formatActionLabel`'s argument, so a member must be an object carrying a
 * non-empty string `name`. One test covers the whole unusable class — the
 * reported bare string, `null`, a number, `{}` and `{ name: '' }`.
 *
 * ⭐ The load-bearing half is the NON-REGRESSION axis, because "skip the bad
 * member" is also satisfied by an implementation that skips EVERYTHING. So the
 * class rows below are paired with rows that fail under exactly that caricature:
 *
 *   - reddens under "skip everything": rows 6 (a mixed list renders exactly the
 *     two good defs, in order, with their labels) and 7 (a clean list is
 *     untouched — same buttons, and the resolved array is the authored array BY
 *     REFERENCE).
 *   - reddens under "skip nothing": rows 1-5 (the class) and row 8's fire leg.
 *
 * The diagnostic is an assertion too, so it is pinned as a PAIR (row 8): it
 * must fire for the bad member and NAME it, and it must NOT fire for a clean
 * list. A warning that fires always is as useless as one that never fires.
 *
 * ## What row 9 inherits
 *
 * objectui#8071's member pin asserted this crash as the CURRENT SHAPE, so that
 * it could not be mistaken for the SILENT drop of the mirror direction
 * (`bulkActions: [{ name: 'approve' }]`, stepped over by `resolveBulkActions`'s
 * `typeof name !== 'string'` guard). That distinction is not deleted by this
 * fix, it is sharpened, and row 9 carries it: both directions now SKIP, but only
 * the def direction is diagnosed. Direction one's silence is asserted here as
 * well — it is deliberately unchanged (objectui#8730's ruling puts it out of
 * scope), and this row is what would notice a diagnostic leaking into it.
 *
 * `selection` is declared explicitly on every row so the ONLY variable between
 * them is the member shape. Left implicit, the grid auto-enables multi-select
 * from `hasBulkActions`, which is itself derived from these two keys — so a
 * row whose members are all skipped would lose its selection UI for the very
 * reason under test and pass without ever reaching the bar.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { resolveBulkActions } from '../resolveBulkActions';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import type { BulkActionDef } from '@object-ui/types';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const OBJECT = 'os_invoice';

/**
 * The object declares ONE action, `approve`, whose label is NOT the humanized
 * form of its name. That gap is the instrument for row 9: a button reading
 * "Approve the invoice" can only have come from resolving a member as a NAME.
 */
const OBJECT_ACTIONS = [{ name: 'approve', label: 'Approve the invoice', variant: 'primary' }];

/** Two well-formed defs, used wherever a row needs survivors to count. */
const ARCHIVE: BulkActionDef = { name: 'archive', operation: 'custom', label: 'Put it away' };
const EXPORT: BulkActionDef = { name: 'export_pdf', operation: 'custom', label: 'Export PDF' };

/**
 * The whole unusable class, each entry paired with the substring the
 * diagnostic must use to address it. `{ name: '' }` is in here for a reason
 * worth stating: it was the ONE member of the class that did not throw before
 * the fix — it rendered a nameless, unlabelled button with an empty React key.
 * Skipping is therefore a change in behaviour for it too, not only for the
 * four that crashed.
 */
const UNUSABLE: ReadonlyArray<readonly [label: string, member: unknown]> = [
  ['a bare action name (the reported shape)', 'approve'],
  ['null', null],
  ['a number', 42],
  ['an empty object', {}],
  ['an empty-string name', { name: '' }],
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
 * COUNTING is the point, not "something rendered": a census that navigates with
 * `querySelector` never notices a node it did not expect (measured on
 * objectui#8596, where `.rounded-full` matched two nodes per avatar). The
 * prefix ends in a hyphen so the bar's own `bulk-actions-bar` testid cannot
 * match, and the query is scoped to the bar so a second bar would be visible as
 * a `getByTestId` failure rather than as doubled counts.
 */
function renderedBulkActionIds(): string[] {
  const bar = screen.getByTestId('bulk-actions-bar');
  return Array.from(bar.querySelectorAll('[data-testid^="bulk-action-"]')).map(
    (n) => n.getAttribute('data-testid') as string,
  );
}

/** Just enough of a spy to read its call log, without importing vitest's generics. */
type ConsoleSpy = { mock: { calls: unknown[][] } };

/** The diagnostic channel: `console.warn` lines this key owns. */
function bulkDefWarnings(warn: ConsoleSpy): string[] {
  return warn.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((line: string) => line.includes('bulkActionDefs'));
}

/** React's duplicate-key complaint — the second symptom of an undefined `name`. */
function duplicateKeyErrors(error: ConsoleSpy): string[] {
  return error.mock.calls
    .map((args: unknown[]) => args.map((a: unknown) => String(a)).join(' '))
    .filter((line: string) => line.includes('unique "key" prop'));
}

describe('object-grid `bulkActionDefs`: an unusable member is skipped (objectui#8730)', () => {
  UNUSABLE.forEach(([label, member], i) => {
    it(`${i + 1}. ${label} renders no button, and does not take the bar down`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      // The pre-fix failure was a THROW during render, so reaching this line at
      // all is half the assertion; the count is the other half.
      await renderAndSelectAll({ bulkActionDefs: [member] });

      expect(renderedBulkActionIds()).toEqual([]);
      // The bar itself survives — that is the affordance the crash destroyed.
      expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
      expect(duplicateKeyErrors(error)).toEqual([]);
      // Skipping is never silent on this key (row 8 pins the message itself).
      expect(bulkDefWarnings(warn)).toHaveLength(1);
    });
  });

  it('6. a mixed list renders EXACTLY the well-formed defs, in order', async () => {
    // ⭐ The discriminating row. "Skip the bad member" is also satisfied by an
    // implementation that skips every member, and by one that drops the
    // survivors' order or identity. Only an exact, ordered census refuses all
    // three at once.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderAndSelectAll({ bulkActionDefs: ['approve', ARCHIVE, EXPORT] });

    expect(renderedBulkActionIds()).toEqual(['bulk-action-archive', 'bulk-action-export_pdf']);
    expect(screen.getByTestId('bulk-action-archive')).toHaveTextContent('Put it away');
    expect(screen.getByTestId('bulk-action-export_pdf')).toHaveTextContent('Export PDF');
    // The `key` half of "the key and the label read the same validated def":
    // the keys are the two surviving names, so React has nothing to complain
    // about. An `undefined` key is what the reported defect produced first.
    expect(duplicateKeyErrors(error)).toEqual([]);
    // One skip, reported once, naming the member that was skipped.
    expect(bulkDefWarnings(warn)).toHaveLength(1);
    expect(bulkDefWarnings(warn)[0]).toContain('bulkActionDefs[0]');
  });

  it('7. a list of only well-formed defs is untouched', async () => {
    // ⭐ The other half of the discriminating pair, at both levels.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await renderAndSelectAll({ bulkActionDefs: [ARCHIVE, EXPORT] });
    expect(renderedBulkActionIds()).toEqual(['bulk-action-archive', 'bulk-action-export_pdf']);
    expect(bulkDefWarnings(warn)).toEqual([]);

    // Unit level, and the sharper assertion of the two: a clean authored array
    // comes back BY REFERENCE. An always-allocating filter would pass the DOM
    // census above and fail here — and a view whose defs lose referential
    // identity every render is a real cost, not a stylistic one (the array is a
    // `useMemo`/`useEffect` dependency downstream).
    const authored = [ARCHIVE, EXPORT];
    const { defs } = resolveBulkActions({ bulkActionDefs: authored });
    expect(defs).toBe(authored);
  });

  it('8. the diagnostic fires for the bad member, by name — and not for a clean list', async () => {
    // An assertion that a warning EXISTS is worth little on its own: a warning
    // that fires always is as useless as one that never fires. Both legs, in
    // one row, so the pair cannot drift apart.
    const fired = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderAndSelectAll({ bulkActionDefs: ['approve'] });

    const lines = bulkDefWarnings(fired);
    expect(lines).toHaveLength(1);
    // WHERE: the addressed block, and the index inside the authored array.
    expect(lines[0]).toContain("objectName: 'os_invoice'");
    expect(lines[0]).toContain('bulkActionDefs[0]');
    // WHAT: the member itself, quoted — this is the "by name" half.
    expect(lines[0]).toContain("'approve'");
    // WHAT TO DO: the other vocabulary is named, since that is where a bare
    // action name belongs.
    expect(lines[0]).toContain('bulkActions');
    fired.mockRestore();

    // No-fire leg, on a fresh render of a clean list.
    document.body.innerHTML = '';
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderAndSelectAll({ bulkActionDefs: [ARCHIVE] });
    expect(bulkDefWarnings(quiet)).toEqual([]);
  });
});

describe('the two vocabularies still fail DIFFERENTLY (inherited from objectui#8071)', () => {
  it('9. direction one stays silent; direction two skips and says so', async () => {
    // What objectui#8071's row 5 was protecting: direction two is NOT direction
    // one's silent drop. Before this fix the difference was crash-vs-silence;
    // it is now diagnostic-vs-silence. Both are skips, and neither throws.
    //
    // Direction one — the DEF vocabulary written into `bulkActions`. Stepped
    // over by `resolveBulkActions`'s `typeof name !== 'string'` guard, with no
    // diagnostic. Deliberately unchanged (objectui#8730 scopes it out); this
    // leg is what would notice a diagnostic leaking into it.
    const one = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderAndSelectAll({ bulkActions: [{ name: 'approve' }] });
    expect(renderedBulkActionIds()).toEqual([]);
    expect(one).not.toHaveBeenCalled();
    one.mockRestore();

    // Direction two — the NAME vocabulary written into `bulkActionDefs`. Same
    // disposition, opposite treatment: skipped, and reported.
    document.body.innerHTML = '';
    const two = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderAndSelectAll({ bulkActionDefs: ['approve'] });
    expect(renderedBulkActionIds()).toEqual([]);
    expect(bulkDefWarnings(two)).toHaveLength(1);
  });

  it('10. a name in the RIGHT key still resolves and promotes', async () => {
    // The guard must not be reachable from the vocabulary that is supposed to
    // carry bare names. The object action's OWN label proves the promotion
    // happened rather than a humanized fallback.
    await renderAndSelectAll({ bulkActions: ['approve'] });
    expect(renderedBulkActionIds()).toEqual(['bulk-action-approve']);
    expect(screen.getByTestId('bulk-action-approve')).toHaveTextContent('Approve the invoice');
  });
});
