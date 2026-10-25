/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8793 — `record:related_list`'s field-security fold must fail
 * CLOSED on a column whose identity it cannot resolve.
 *
 * ## The defect, in one sentence
 *
 * The block filtered `columns` against the field-security allow-list with an
 * else-branch that KEPT any entry it could not name. `columnIdentity`
 * deliberately refuses the table library's own `accessorKey` (objectui#3104 —
 * it is TanStack's column key, not ObjectStack metadata identity), so a column
 * authored `{ accessorKey: 'salary' }` resolved to nothing, took that branch,
 * skipped both `enforceFieldSecurity` and `redactFields`, and then rendered its
 * real values through `RelatedList`'s own `accessorKey || columnIdentity` read.
 * A security filter and a renderer disagreeing about what a column IS is the
 * whole mechanism; the else-branch is where the disagreement pays out.
 *
 * ## Why these pins render the REAL table
 *
 * The member-level fold is pinned next door in
 * `RecordRelatedListRenderer.columnMembers.test.tsx`, which MOCKS `RelatedList`
 * and reads the column array the block hands down. That file cannot see the
 * half that makes this a data-exposure bug rather than a filtering nit: the
 * VALUE on screen. So these cases mount the block over the real `RelatedList`
 * and the real `data-table`, and assert on rendered cells.
 *
 * ## The instrument, stated rather than smuggled
 *
 * `enforceFieldSecurity` / `redactFields` are used here because they are the
 * ONLY switch that makes the block read a column member at all. They were
 * renderer-only keys when this file was written; `@objectstack/spec` 17.5.0
 * declares both on `RecordRelatedListProps`, and objectui#8649 published them
 * as this block's `inputs` on the strength of that declaration (the
 * columnMembers file ties the two together). Their presence here is not
 * evidence either way.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (the reason spelled out in
 * `RelatedList.columnIdentityAccessor.test.tsx`): under the 768 breakpoint a
 * `type="table"` list renders a card gallery with no cells to read.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  subject: { type: 'text', label: 'Subject' },
  status: { type: 'text', label: 'Status' },
  salary: { type: 'text', label: 'Salary' },
};

const rows = [
  // `computed_total` is deliberately ABSENT from `fields` above: a key the child
  // object never declares, which is the shape the residual leg below is about.
  { id: 'c1', subject: 'Fix the pump', status: 'open', salary: '90000', computed_total: 'SECRET-42' },
  { id: 'c2', subject: 'Replace filter', status: 'closed', salary: '120000', computed_total: 'SECRET-43' },
];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields })),
});

/** Mount the block over the REAL `RelatedList` with the given schema extras. */
function renderBlock(extra: Record<string, unknown>, wrap?: (node: React.ReactNode) => React.ReactElement) {
  const node = (
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDS() as any}>
      <RecordRelatedListRenderer
        schema={{ objectName: 'contact', relationshipField: 'account', ...extra } as any}
      />
    </RecordContextProvider>
  );
  return render(wrap ? wrap(node) : node);
}

/** Every rendered body cell's text, in DOM order. */
const cellTexts = () => screen.getAllByRole('cell').map((c) => (c.textContent || '').trim());

/** Wait until the fetched rows have painted, then answer with the cell texts. */
async function paintedCells(): Promise<string[]> {
  await waitFor(() => expect(screen.getAllByRole('cell').length).toBeGreaterThan(0));
  return cellTexts();
}

const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];

/** `read` on `contact`, and `read` on every field EXCEPT the ones named. */
function permsDenying(...deniedFields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: 'contact',
      roles: {
        restricted: {
          actions: ['read'],
          fieldPermissions: deniedFields.map((field) => ({ field, read: false })),
        },
      },
    },
  ];
}

describe('objectui#8793 — an unresolvable column identity is EXCLUDED, not kept', () => {
  it('THE REPORTED LEG — a redacted column authored in the table library key does not reach the screen', async () => {
    // `salary` is redacted. Authored as `{ field: 'salary' }` it was always
    // dropped; authored as the table's own `accessorKey` it used to sail
    // through the fold and render its values.
    renderBlock({
      columns: [
        { field: 'subject', label: 'Subject' },
        { accessorKey: 'salary', header: 'Salary' },
      ],
      redactFields: ['salary'],
    });

    const cells = await paintedCells();

    // THE LIVE CONTROL, in the same render: a column whose identity DOES
    // resolve and IS allowed still renders its values. Without it, "the
    // redacted value is gone" is equally satisfied by a fold that filtered
    // everything out, and a reviewer could not tell the repair from a rout.
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter']));

    // The exposure itself: neither row's salary is on screen.
    expect(cells).not.toContain('90000');
    expect(cells).not.toContain('120000');
    expect(screen.queryByText('90000')).not.toBeInTheDocument();
  });

  it('THE BOUNDARY — three columns, three different reasons', async () => {
    // allowed + resolvable  -> renders
    // denied  + resolvable  -> dropped by the allow-list (always was)
    // denied  + unresolvable-> dropped by the fail-closed branch (this fix)
    renderBlock({
      columns: [
        { field: 'subject', label: 'Subject' },
        { field: 'status', label: 'Status' },
        { accessorKey: 'salary', header: 'Salary' },
      ],
      redactFields: ['status', 'salary'],
    });

    const cells = await paintedCells();
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter']));
    expect(cells).not.toContain('open');
    expect(cells).not.toContain('closed');
    expect(cells).not.toContain('90000');
  });

  it('THE FLS LEG — a field-security denial reaches the unresolvable column too', async () => {
    // The same fold, driven through `enforceFieldSecurity` rather than
    // `redactFields`. Pinned separately because the two legs are the same
    // branch in the block but NOT the same story downstream — see the census
    // case below.
    renderBlock(
      {
        columns: [
          { field: 'subject', label: 'Subject' },
          { accessorKey: 'salary', header: 'Salary' },
        ],
        enforceFieldSecurity: true,
      },
      (node) => (
        <PermissionProvider roles={roles} permissions={permsDenying('salary')} userRoles={['restricted']}>
          {node}
        </PermissionProvider>
      ),
    );

    const cells = await paintedCells();
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter']));
    expect(cells).not.toContain('90000');
  });

  it('COUNTER-PROBE — with neither key set the fold never runs and the same column still renders', async () => {
    // The bound on the blast radius, measured rather than argued: this change
    // moves nothing on a related list that does not switch the filter on, and
    // no in-repo producer switches it on. An unresolvable column on an
    // unfiltered list renders exactly as before.
    renderBlock({
      columns: [
        { field: 'subject', label: 'Subject' },
        { accessorKey: 'salary', header: 'Salary' },
      ],
    });

    const cells = await paintedCells();
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter', '90000']));
  });

  it('THE LIMIT OF THIS REPAIR — an EMPTIED set still falls through to auto-derived columns, and objectui#9090 filters THOSE too', async () => {
    // The bound on this repair, pinned as the behaviour it is instead of living
    // only in a pull-request body.
    //
    // When the fold removes EVERY authored member, `RelatedList` reads the empty
    // array as "no columns were authored" and derives a set from the child
    // object's schema instead. That derivation is a path the block's own list
    // never reached, so when this row was first written the redacted field came
    // back through it — filed as objectui#9053 and pinned here red-on-landing.
    //
    // objectui#9090 landed first and closed it: the block now hands `redactFields`
    // DOWN as well, and `RelatedList` filters the derived set by the same
    // `accessorKey || columnIdentity` key it renders through. The fall-through
    // itself is unchanged — that is still the bound — but the redacted value no
    // longer survives it, so this row now pins the pair.
    renderBlock({
      columns: [{ accessorKey: 'salary', header: 'Salary' }],
      redactFields: ['salary'],
    });

    const cells = await paintedCells();

    // THE FALL-THROUGH, proven rather than assumed: `status` was never authored,
    // so its values can only be on screen because the derivation ran. Without
    // this control the assertion below is equally satisfied by a list that
    // rendered no columns at all — a different outcome with the same shape.
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'open']));

    // …and the redacted field does not come back with it (objectui#9090).
    expect(cells).not.toContain('90000');
    expect(cells).not.toContain('120000');
  });

  it('THE RESIDUAL LEG — FLS on a key the child object never declares, which nothing downstream refuses', async () => {
    // The one leg where this repair still moves a rendered cell, and therefore
    // the case this file needs in order to stay able to fail.
    //
    // objectui#9090 gave the REDACT leg a second gate downstream
    // (`RelatedList.filterRedacted`, resolving `accessorKey || columnIdentity`),
    // and `filterFLS` beside it has always been the second gate for a DECLARED
    // field that field security denies — the CENSUS case below pins exactly
    // that. Both of those resolve the entry the block could not, so neither can
    // see this arm any more.
    //
    // What neither of them refuses is a key the permission evaluator has no
    // opinion about: `computed_total` is not in the child object's `fields`, so
    // `perms.checkField` default-ALLOWS it and the derived/authored column
    // sails through downstream. The block's fold is the only thing standing
    // between it and the screen, and the fold cannot name it — which is exactly
    // when it must not pass.
    renderBlock(
      {
        columns: [
          { field: 'subject', label: 'Subject' },
          { accessorKey: 'computed_total', header: 'Total' },
        ],
        enforceFieldSecurity: true,
      },
      (node) => (
        <PermissionProvider roles={roles} permissions={permsDenying()} userRoles={['restricted']}>
          {node}
        </PermissionProvider>
      ),
    );

    const cells = await paintedCells();

    // THE LIVE CONTROL, in the same render: the resolvable, allowed column
    // still paints, so "the value is gone" cannot be satisfied by a fold that
    // dropped everything.
    expect(cells).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter']));

    // The unresolvable entry does not reach the screen.
    expect(cells).not.toContain('SECRET-42');
    expect(cells).not.toContain('SECRET-43');
  });

  it('CENSUS — `RelatedList` runs its OWN field-security filter, and that one reads `accessorKey`', async () => {
    // Falsifies the brief's assumption that the block's fold is the only
    // security gate on this path. `RelatedList.filterFLS` resolves a column as
    // `accessorKey || columnIdentity(c)` and calls `perms.checkField`, so the
    // FLS leg of the bypass was already caught HERE whenever a
    // PermissionProvider was mounted and loaded. Driven directly — no block,
    // no fold — so the assertion is about that filter alone.
    //
    // ⇒ what objectui#8793 actually moves for users is the REDACT leg, which
    // has no second gate. The FLS leg is repaired one layer earlier than it
    // was, at the layer that names the policy.
    render(
      <PermissionProvider roles={roles} permissions={permsDenying('salary')} userRoles={['restricted']}>
        <RelatedList
          title="Contacts"
          type="table"
          api="contact"
          objectName="contact"
          columns={[
            { accessorKey: 'subject', header: 'Subject' },
            { accessorKey: 'salary', header: 'Salary' },
          ]}
          data={rows}
          dataSource={makeDS() as any}
        />
      </PermissionProvider>,
    );

    // objectui#10657 PR 2: the first cells paint WITHHELD (as the mask) while
    // the definition is in flight, so wait for the settled draw, not the first
    // cell.
    await waitFor(() => expect(cellTexts()).toEqual(expect.arrayContaining(['Fix the pump', 'Replace filter'])));
    expect(cellTexts()).not.toContain('90000');
  });
});
