/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8071 slice 12 — the MEMBER shape `object-grid` reads inside
 * `operations`.
 *
 * ## What the registration cannot say
 *
 * `operations` is registered as an OBJECT-armed input. The arm says nothing
 * about which members are read, and the three that ARE read do not behave
 * alike: `update` and `delete` gate the row kebab's generic entries, `export`
 * gates the toolbar button — and the two halves carry OPPOSITE defaults once
 * the block is present at all. That asymmetry is invisible from the
 * registration, invisible from `ObjectGridSchema`, and is the thing an author
 * writing `operations: { export: false }` actually needs to know.
 *
 * ## The member facts pinned here, and why each is at the row rather than at a prop
 *
 *  1. **Presence REPLACES, it does not merge.** An authored block is taken
 *     whole: `{}` means "update: absent, delete: absent" and CLOSES both, even
 *     with `onEdit` / `onDelete` wired. Omitting the key entirely takes the
 *     wired-callback default instead. Merging the default UNDER the authored
 *     block (`{ ...defaults, ...authored }`) is the plausible simplification
 *     this file refuses: it reads identically on every schema that names
 *     `update`/`delete`, and silently re-opens generic Edit/Delete for every
 *     author who declared a block naming neither.
 *  2. **`update` and `delete` are independent**, not one write flag.
 *  3. **`operations` is the CEILING — an INTERSECTION with `rowActions`' canonical
 *     names, never a union.** `operations: { update: false }` closes row editing
 *     whatever `rowActions` says, and a member a PRESENT block does not name is
 *     closed too, so `rowActions: ['edit']` cannot select what the block
 *     withheld. ⚠️ This file pinned the OPPOSITE — the union — from slice 12
 *     until the maintainer ruling of 2026-09-18 (batch #162 item 1, letter A,
 *     objectui#9819) made the two gates intersections. The flip is that ruling
 *     landing, ⛔ not a regression; the union's own shape is kept below as the
 *     case that goes red if the `||` ever comes back.
 *     The ruling's OTHER half — `rowActions` NARROWING inside the ceiling —
 *     landed with objectui#10083: a DECLARED `rowActions` list offers the
 *     generic entry only for the canonical names it carries, while an ABSENT
 *     list keeps the default. Until then this file pinned the gap as a
 *     `NOT IMPLEMENTED` case; that case is flipped below, ⛔ not deleted.
 *  4. **Neither member is a grant.** Without the consumer's callback the
 *     affordance stays closed whatever the block says.
 *  5. **`export` defaults the OTHER WAY inside a present block** — omitted
 *     means allowed, and only an explicit `false` closes it.
 *
 * Every row-kebab claim is read out of an OPENED menu on a rendered row.
 * "The prop was computed" is green against a grid that draws the entry anyway,
 * which is the failure this key exists to prevent.
 *
 * Prior art, stated so this file is not read as the first word on the key:
 * `exportGate.test.tsx` already covers fact 5's three cases on their own;
 * `rowCrudEffectiveOps.test.tsx` and `rowOperationsPerRow-8674.test.tsx` cover
 * the layers ANDed on TOP of this key (the ADR-0103 bucket, `userActions`, the
 * server's effective operation set, the per-row predicate). None of them states
 * facts 1-4, which are the key's own members.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const ROWS = [{ id: 'r1', name: 'Alice' }];

interface Case {
  /** Omitted from the schema entirely when absent — the key's own absence. */
  operations?: Record<string, boolean>;
  rowActions?: string[];
  exportOptions?: Record<string, unknown>;
  /** Both callbacks are wired unless a case says otherwise. */
  wireCallbacks?: boolean;
}

function renderGrid(c: Case = {}) {
  const wire = c.wireCallbacks !== false;
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...(c.operations ? { operations: c.operations } : {}),
    ...(c.rowActions ? { rowActions: c.rowActions } : {}),
    ...(c.exportOptions ? { exportOptions: c.exportOptions } : {}),
  };
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={schema}
        {...(wire ? { onEdit: vi.fn(), onDelete: vi.fn() } : {})}
      />
    </ActionProvider>,
  );
}

/**
 * What the row's kebab offers.
 *
 * Located through the row, because a row refused everything grows no "⋮"
 * trigger at all (#3562) — indexing a global list of triggers would silently
 * address nothing once the gate works, and read as a pass.
 */
async function rowKebab(): Promise<{ trigger: boolean; edit: boolean; delete: boolean }> {
  const row = screen.getByText('Alice').closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { trigger: false, edit: false, delete: false };
  await userEvent.click(trigger);
  const answer = {
    trigger: true,
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  };
  await userEvent.keyboard('{Escape}');
  return answer;
}

async function settle() {
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
}

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('object-grid `operations` — an authored block REPLACES the wired-callback default', () => {
  it('CONTROL — with the key absent, the wired callbacks alone open both generic entries', async () => {
    renderGrid();
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: true, delete: true });
  });

  it('an EMPTY authored block closes both, on the same data and the same callbacks', async () => {
    renderGrid({ operations: {} });
    await settle();
    // Not "one entry fewer": a row with nothing left to offer grows no kebab.
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
  });

  it('a block naming only `export` still closes the two it does not name', async () => {
    // The shape an author actually writes when they mean "no exporting".
    // Under a merge it would keep Edit and Delete from the default — the same
    // fields, the same callbacks, an author who asked to close one door and
    // left two open without being told.
    renderGrid({ operations: { export: false } });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
  });
});

describe('object-grid `operations` — `update` and `delete` are read independently', () => {
  it('`update: true, delete: false` offers Edit and withholds Delete', async () => {
    renderGrid({ operations: { update: true, delete: false } });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: true, delete: false });
  });

  it('`update: false, delete: true` is the mirror', async () => {
    renderGrid({ operations: { update: false, delete: true } });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: false, delete: true });
  });
});

describe('object-grid `operations` — neither member is a grant, and the block is the CEILING over `rowActions`', () => {
  it('`update`/`delete` true with NO callbacks wired offers nothing', async () => {
    renderGrid({ operations: { update: true, delete: true }, wireCallbacks: false });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
  });

  it('the CEILING refuses: `update: false` SURVIVES `rowActions: [edit]`', async () => {
    renderGrid({ operations: { update: false, delete: false }, rowActions: ['edit'] });
    await settle();
    // Until objectui#9819 this read `{ trigger: true, edit: true, delete: false }`
    // — the canonical name in `rowActions` re-opened Edit over the author's own
    // `update: false`. What an author reading `operations` as a permission block
    // always predicted is now the only answer the gate gives, for both members:
    // with nothing left to offer the row grows no kebab at all.
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
  });

  it('the ceiling refuses a member the block does not NAME, not only an explicit `false`', async () => {
    // Fact 1's replacement rule and the ceiling meet here: `{ delete: true }`
    // allows delete and says NOTHING about update — and nothing is not an
    // allowance, so `rowActions: ['edit']` selects an operation that is not on
    // offer. Without this case a ceiling implemented as `update !== false`
    // passes every other case in this file, and `rowActions` keeps its old power
    // to open on the shape authors write most (one member named, one omitted).
    // `rowActions` names BOTH canonical members so the objectui#10083 narrowing
    // cannot be what withholds either — Edit's absence is the ceiling alone.
    renderGrid({ operations: { delete: true }, rowActions: ['edit', 'delete'] });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: false, delete: true });
  });

  it('ABSENT `operations` keeps the wired-callback default — `rowActions` naming both selects both', async () => {
    // The direction the ruling explicitly protects — "`operations` absent means
    // today's defaults". The CONTROL for the two cases above: without it they
    // read as "`rowActions: [edit]` never opens Edit", which is not the rule and
    // would be satisfied by a gate that ignored `rowActions` and `operations`
    // both.
    renderGrid({ rowActions: ['edit', 'delete'] });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: true, delete: true });
  });

  it('`rowActions` NARROWS inside the ceiling — naming only `edit` withholds Delete that `operations` allows', async () => {
    // objectui#10083, the ruling's second half: `rowActions` "chooses among what
    // `operations` allows". Until objectui#10083 this case was pinned as
    // `⚠️ NOT IMPLEMENTED` and read `{ trigger: true, edit: true, delete: true }`,
    // because the call site collapsed "`rowActions` absent" and "`rowActions`
    // present without `delete`" into the same `false`.
    renderGrid({ operations: { update: true, delete: true }, rowActions: ['edit'] });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: true, delete: false });
  });

  it('…and narrows the same way under the wired-callback default, when `operations` is absent', async () => {
    // The narrowing is a term of its own, not a rider on an authored
    // `operations` block: the default arm is picked by whether `rowActions` was
    // declared, never by whether `operations` was.
    renderGrid({ rowActions: ['delete'] });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: false, delete: true });
  });

  it('ABSENT `rowActions` keeps the default — the narrowing never fires on a list nobody declared', async () => {
    // The control for the two narrowing cases: implement narrowing on the bare
    // `includes()` answer and this goes red, because an absent list reads as
    // "names nothing" and closes both generic entries on every grid that never
    // mentioned `rowActions`.
    renderGrid({ operations: { update: true, delete: true } });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: true, edit: true, delete: true });
  });

  it('a DECLARED list naming neither canonical member offers neither generic entry', async () => {
    // An empty list is a declaration that selects nothing — the same rule as a
    // list naming only custom actions (`rowActions: ['approve']`), which keeps
    // its custom entry and loses the generic pair.
    renderGrid({ operations: { update: true, delete: true }, rowActions: [] });
    await settle();
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
  });
});

describe('object-grid `operations` — `export` is read at a different site with the opposite default', () => {
  it('a present block that does NOT name `export` still offers the export button', async () => {
    renderGrid({ operations: { update: false, delete: false }, exportOptions: { formats: ['csv'] } });
    await settle();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('only an explicit `export: false` closes it', async () => {
    renderGrid({ operations: { export: false }, exportOptions: { formats: ['csv'] } });
    await settle();
    expect(screen.queryAllByRole('button', { name: /export/i })).toHaveLength(0);
  });

  it('THE ASYMMETRY, in one statement: the same omission closes `update` and opens `export`', async () => {
    renderGrid({ operations: { somethingElse: true } as any, exportOptions: { formats: ['csv'] } });
    await settle();
    // One block, one omission each, two opposite answers.
    expect(await rowKebab()).toEqual({ trigger: false, edit: false, delete: false });
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });
});
