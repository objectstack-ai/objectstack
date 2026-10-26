/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9053 — redaction must reach EVERY path that decides columns.
 *
 * `record:related_list` filters its authored `columns` against an allow-list
 * built from `enforceFieldSecurity` / `redactFields`, then hands the survivors
 * to `RelatedList`. `RelatedList.effectiveColumns` takes the authored array
 * only `if (columns && columns.length > 0)`; otherwise it AUTO-DERIVES a set
 * from the child object's `highlightFields` or from a heuristic field walk.
 *
 * So redacting EVERY authored column empties the array, the emptied array reads
 * as "no columns were authored", and the derived set brings the redacted field
 * straight back. Measured before the fix, real DOM cells, the card's fixture:
 *
 *     [ 'Fix the pump', '90000' ]     // `salary` was the redacted field
 *
 * ⇒ applying the control maximally is what switches it off. The repair pushes
 * the policy down to the component that decides columns, so ALL THREE paths —
 * authored, `highlightFields`, heuristic walk — are filtered by one policy.
 *
 * ## Scope fence (objectui#8793 is a DIFFERENT hole on the same seam)
 *
 * The block's fold keeps a member whose identity it cannot NAME
 * (`colName` → `null` ⇒ kept), which is objectui#8793's subject and is not
 * touched here: the filter added below is fail-open on an unnameable column,
 * exactly like the `filterFLS` it sits next to. What it does cover is a column
 * this component CAN name — including the table's own `accessorKey` spelling,
 * because that is the identity this component renders through.
 *
 * FLS is NOT what leaks here, and that is load-bearing for the grade: the
 * derived path re-applies `perms.checkField(...,'read')` — the identical
 * predicate `useFieldPermissions().readableFields` is built from — so the
 * permission boundary holds and only the block-level authoring preference was
 * lost. Pinned as its own case below rather than asserted in prose.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (the objectui#8399 reason): under the
 * 768 breakpoint a `type="table"` related list renders a card gallery with no
 * cells at all, and every assertion here reads rendered CELLS.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

/** The card's fixture: one child object, two declared fields, one row. */
const FIELDS = {
  subject: { type: 'text', label: 'Subject' },
  salary: { type: 'text', label: 'Salary' },
};

const ROWS = [{ id: 't1', subject: 'Fix the pump', salary: '90000' }];

const makeDS = (schemaExtra: Record<string, unknown> = {}) => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS, ...schemaExtra })),
});

/** Every rendered body cell's text, in DOM order. */
const cellTexts = () => screen.getAllByRole('cell').map((c) => (c.textContent || '').trim());

/** Render the BLOCK end to end over the real `RelatedList` and the real table. */
function renderBlock(schema: Record<string, unknown>, schemaExtra?: Record<string, unknown>) {
  return render(
    <RecordContextProvider
      objectName="account"
      recordId="ACC-1"
      dataSource={makeDS(schemaExtra) as any}
    >
      <RecordRelatedListRenderer
        schema={{ objectName: 'task', relationshipField: 'account_id', ...schema } as any}
      />
    </RecordContextProvider>,
  );
}

/**
 * Wait until `text` is on screen as a body CELL.
 *
 * Every "the redacted value is absent" read below is taken only after one of
 * these resolves, and that ordering is the whole guard against a false green:
 * the derived column set cannot exist before the object schema lands
 * (`if (!objectSchema?.fields) return []`), so a table with any cell at all is
 * a table whose columns are final. Waiting on a POSITIVE cell is therefore the
 * cheapest available proof that the negative was measured on the settled DOM
 * rather than on the render before it.
 */
const waitForCell = (text: string) =>
  waitFor(() => expect(cellTexts()).toContain(text));

describe('objectui#9053 — a redacted field must not come back through auto-derivation', () => {
  it('MAXIMAL — redacting the ONLY authored column does not resurrect it', async () => {
    // The card's measurement verbatim: one authored column, and it is redacted.
    renderBlock({
      columns: [{ field: 'salary', label: 'Salary' }],
      redactFields: ['salary'],
    });
    await waitForCell('Fix the pump');

    // Before the fix this read `[ 'Fix the pump', '90000' ]`.
    expect(cellTexts()).not.toContain('90000');
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
    // Non-vacuity: the list really did render, with the field that was NOT
    // redacted — so "90000 is absent" cannot be satisfied by an empty table.
    expect(cellTexts()).toContain('Fix the pump');
  });

  it('CONTROL (partial) — redacting SOME authored columns leaves the rest alone', async () => {
    // The array stays non-empty, so the AUTHORED path is taken. This is the
    // case redaction already handled, and the fix must not disturb it.
    renderBlock({
      columns: [
        { field: 'subject', label: 'Subject' },
        { field: 'salary', label: 'Salary' },
      ],
      redactFields: ['salary'],
    });
    await waitForCell('Fix the pump');

    expect(cellTexts()).not.toContain('90000');
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
  });

  it('CONTROL (no redaction) — the same column renders when nothing is redacted', async () => {
    // The positive control for every negative above: without `redactFields`
    // the value IS on screen, so their absence measures redaction and not a
    // broken fixture.
    renderBlock({ columns: [{ field: 'salary', label: 'Salary' }] });
    await waitForCell('90000');

    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('DERIVED (heuristic walk) — a redacted field never enters the auto-derived set', async () => {
    // No authored columns at all: the walk is the ONLY path, and the block's
    // redaction list has to reach it for the key to mean anything here.
    renderBlock({ redactFields: ['salary'] });
    await waitForCell('Fix the pump');

    expect(cellTexts()).not.toContain('90000');
  });

  it('DERIVED (highlightFields) — a redacted highlight field never leads the list', async () => {
    // ADR-0085 prominence path. With its only member redacted the branch must
    // yield nothing and fall through to the walk — which is itself filtered.
    renderBlock({ redactFields: ['salary'] }, { highlightFields: ['salary'] });
    await waitForCell('Fix the pump');

    expect(cellTexts()).not.toContain('90000');
  });

  it('CONTROL (highlightFields, no redaction) — the prominence path still leads with it', async () => {
    renderBlock({}, { highlightFields: ['salary'] });
    await waitForCell('90000');
  });

  it('the policy holds on `RelatedList` itself, for both authored and derived columns', async () => {
    // `RelatedList` is exported from this package's public entry, so the prop
    // has to mean the same thing to a direct consumer: a named column does not
    // render, whichever path produced it. A prop that only bound on the derived
    // path would be a fresh instance of the defect this card is about.
    const { rerender } = render(
      <RelatedList
        title="Tasks"
        type="table"
        api="task"
        objectName="task"
        columns={[{ field: 'subject' }, { field: 'salary' }]}
        redactFields={['salary']}
        data={ROWS}
        dataSource={makeDS() as any}
      />,
    );
    await waitForCell('Fix the pump');
    expect(cellTexts()).not.toContain('90000');

    rerender(
      <RelatedList
        title="Tasks"
        type="table"
        api="task"
        objectName="task"
        redactFields={['salary']}
        data={ROWS}
        dataSource={makeDS() as any}
      />,
    );
    await waitForCell('Fix the pump');
    expect(cellTexts()).not.toContain('90000');
  });
});

/**
 * The grade's load-bearing measurement, asserted rather than inherited: FLS is
 * re-applied on the derived path, so this card is a lost AUTHORING preference
 * and not a permission bypass. If this case ever fails, objectui#9053's p2
 * grade and the shape of its remedy are both wrong.
 */
describe('objectui#9053 — the derived path re-applies field-level security', () => {
  const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];
  const permissions: ObjectPermissionConfig[] = [
    {
      object: 'task',
      roles: {
        restricted: {
          actions: ['read'],
          fieldPermissions: [{ field: 'salary', read: false }],
        },
      },
    },
  ];

  it('an FLS-denied field stays out of the auto-derived set (no redactFields involved)', async () => {
    render(
      <PermissionProvider roles={roles} permissions={permissions} userRoles={['restricted']}>
        <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDS() as any}>
          <RecordRelatedListRenderer
            schema={{ objectName: 'task', relationshipField: 'account_id' } as any}
          />
        </RecordContextProvider>
      </PermissionProvider>,
    );
    await waitForCell('Fix the pump');

    expect(cellTexts()).not.toContain('90000');
  });
});
