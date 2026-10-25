/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7165 — the grid's inline editor SUPPLIES the dependent record, so a
 * `dependsOn` lookup column is editable instead of gated forever.
 *
 * ## The defect this closes
 *
 * `LookupField` resolves `dependentValues ?? {}` and `ObjectGrid`'s
 * `renderCellEditor` did not supply that prop: it rendered `FieldEditWidget`
 * with `field` / `value` / `onChange` only. The resolution then also spelled a
 * `?? ctx.formValues ?? ctx.data` tail, but `SchemaRendererContext` has neither
 * member and the grid set no `ctx.data` for a row — that tail could not be
 * supplied by any host and objectui#7206 has since retired it. The resolved
 * record was therefore `{}` for EVERY row, `dependenciesMissing` was permanently
 * `true`, and a column declaring `dependsOn` rendered a disabled trigger reading
 * "Select region first" — even when the row carried the parent value. The field
 * could never be filled and nothing said why.
 *
 * PR objectui#2216 closed objectui#2215 in two halves: the FORM renderer injects
 * its live watched record as `dependentValues`, and every picker surface takes
 * the `dependsOn` chain as a hard `baseFilter`. Half 2 is host-independent and
 * was ALREADY live here — which is why the gate fired at all. Half 1 is
 * per-host and the grid never got it. This card supplies that missing input; it
 * re-implements no cascade, and `test 2` below is what proves that distinction
 * rather than asserting it.
 *
 * ## objectui#7188 — the STAGED record crosses the seam too (option B)
 *
 * objectui#7165 shipped option A as a labelled interim: `dependentValues={ctx.row}`,
 * the SAVED record, so a parent edited but not yet saved in the same row did
 * not re-scope the child — strictly better than never fillable, strictly not
 * the form's answer to objectui#2215 (the LIVE record). objectui#7188 finished
 * it: `renderCellEditor`'s context (declared by objectui#6882, pinned by exact
 * type equality in `@object-ui/types`) gained a seventh member, `pendingRow` —
 * the persisted row shallow-merged with the row's `pendingChanges` entry — and
 * the grid scopes by `ctx.pendingRow ?? ctx.row`.
 *
 * ⭐ `test 4` is the assertion only B can pass and tests 1–3 cannot see: their
 * rows carry no staged edits, so `pendingRow` and `row` coincide there. It
 * carries its own proof that the staging happened AND that nothing was saved
 * (otherwise "scoped by south" could be true because the parent was persisted),
 * and it is the test that goes RED if anyone later "simplifies" B back to A.
 *
 * ## Why every test carries a live control
 *
 * An enabled-side green is worthless if the control column is also broken. Each
 * test renders the `dependsOn` column and a control column with the SAME
 * reference and the SAME records in ONE render, differing only in the declared
 * key — the shape objectui#6875 established and objectui#7154 reused.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'os_7165_task';
const REF = 'os_7165_person';

/** Six north, six south — so "scoped" and "unscoped" are different lists. */
const PEOPLE = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Person ${String(i + 1).padStart(2, '0')}`,
  region: i < 6 ? 'north' : 'south',
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as any;
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
  if (!(Element.prototype as any).setPointerCapture) (Element.prototype as any).setPointerCapture = () => {};
  if (!(Element.prototype as any).releasePointerCapture) (Element.prototype as any).releasePointerCapture = () => {};
});

/**
 * The referenced-object query honours the `$filter` record, so the dependent
 * cascade is observable as RENDERED ROWS and not only as call arguments.
 */
function makeDataSource(rows: any[]) {
  const refQueries: any[] = [];
  return {
    refQueries,
    find: vi.fn(async (objectName: string, params: any) => {
      if (objectName === REF) {
        refQueries.push(params);
        let recs = PEOPLE;
        const filter = params?.$filter;
        if (filter && typeof filter === 'object' && filter.region) {
          recs = recs.filter((p) => p.region === filter.region);
        }
        const top = params?.$top ?? 50;
        const skip = params?.$skip ?? 0;
        return { data: recs.slice(skip, skip + top), total: recs.length, hasMore: false, pageSize: top };
      }
      return { data: rows, total: rows.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (objectName: string, id: string) =>
      objectName === REF ? (PEOPLE.find((p) => p.id === id) ?? null) : null,
    ),
    update: vi.fn(async (_o: string, _id: string, changes: any) => changes),
    getObjectSchema: async (name: string) => {
      if (name === REF) {
        return { name, fields: { id: { type: 'text' }, name: { type: 'text' }, region: { type: 'text' } } };
      }
      return {
        name,
        fields: {
          id: { type: 'text' },
          title: { type: 'text', label: 'Title' },
          region: { type: 'text', label: 'Region' },
          owner: { type: 'lookup', label: 'Owner', reference: REF },
          regional_owner: { type: 'lookup', label: 'Regional owner', reference: REF, dependsOn: ['region'] },
        },
      };
    },
  } as any;
}

/** `region` is EDITABLE here — test 4 stages into it. */
const COLUMNS = [
  { field: 'title', label: 'Title', editable: false },
  { field: 'region', label: 'Region' },
  { field: 'owner', label: 'Owner', type: 'lookup' },
  { field: 'regional_owner', label: 'Regional owner', type: 'lookup' },
];

function renderGrid(ds: any, rows: any[]) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    data: rows,
    pagination: { pageSize: 50 },
    columns: COLUMNS,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The n-th DATA cell of a row (`td[0]` is the row-number column). */
function cellAt(container: HTMLElement, rowIndex: number, index: number): HTMLElement {
  const rowEl = container.querySelectorAll('tbody tr')[rowIndex] as HTMLElement;
  const tds = Array.from(rowEl.querySelectorAll('td')) as HTMLElement[];
  return tds[index + 1];
}

/** Single-click into a cell and hand back the widget's own trigger button. */
async function openEditor(cell: HTMLElement): Promise<HTMLButtonElement> {
  fireEvent.click(cell);
  return await waitFor(() => {
    const btn = cell.querySelector('button');
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  });
}

const ROW_NORTH = { id: 't1', title: 'Task one', region: 'north', owner: null, regional_owner: null };
const ROW_NO_REGION = { id: 't2', title: 'Task two', region: '', owner: null, regional_owner: null };

describe('objectui#7165 — the grid feeds the inline editor its row as dependent values', () => {
  it('1 — the `dependsOn` column opens (it used to gate forever); the control opens too', async () => {
    const rows = [ROW_NORTH];
    const ds = makeDataSource(rows);
    const { container } = renderGrid(ds, rows);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // CONTROL — same reference, same records, no `dependsOn`. Load-bearing in
    // BOTH directions: if this column were broken the test below would be
    // measuring a dead picker path rather than the declared key.
    const controlTrigger = await openEditor(cellAt(container, 0, 2));
    expect(controlTrigger.getAttribute('data-testid')).toBe('lookup-trigger-owner');
    expect(controlTrigger.disabled).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // ⭐ THE CARD'S MEASUREMENT, INVERTED. On `51449a043` and on `899730e0a`
    // before this change, this trigger was `lookup-trigger-gated`, `disabled`,
    // reading "Select region first" — with the row already carrying
    // `region: 'north'`. It is now an ordinary named, enabled trigger.
    const dependentTrigger = await openEditor(cellAt(container, 0, 3));
    expect(dependentTrigger.getAttribute('data-testid')).toBe('lookup-trigger-regional_owner');
    expect(dependentTrigger.disabled).toBe(false);
    expect(dependentTrigger.textContent).not.toMatch(/select region first/i);
    // The browse-all button shared the gate (PR objectui#2216) and is live too.
    expect(within(cellAt(container, 0, 3)).getByTestId('browse-all-records')).not.toBeDisabled();
  });

  it('2 — the picker is SCOPED by the row: north only, while the control offers south', async () => {
    const rows = [ROW_NORTH];
    const ds = makeDataSource(rows);
    const { container } = renderGrid(ds, rows);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // The declared column: `region: 'north'` reaches the query as a hard
    // `$filter`, so only the six north people are candidates. This is what
    // proves the fix supplied a CORRECT record and not merely a non-empty one
    // — an unscoped picker would list Person 07.
    fireEvent.click(await openEditor(cellAt(container, 0, 3)));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(screen.queryByText('Person 07')).not.toBeInTheDocument();
    expect(ds.refQueries.some((q: any) => q?.$filter?.region === 'north')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Person 01')).not.toBeInTheDocument());

    // CONTROL — the sibling column declares no `dependsOn`, so the SAME
    // reference over the SAME records is unfiltered and a south person is
    // offered. Without this, "Person 07 is absent" could just mean the picker
    // never loaded.
    fireEvent.click(await openEditor(cellAt(container, 0, 2)));
    await waitFor(() => expect(screen.getByText('Person 07')).toBeInTheDocument());
  });

  it('3 — NEGATIVE CONTROL: an empty saved parent still gates, so the gate was not disabled', async () => {
    // The fix supplies a record; it does not remove `dependenciesMissing`. A row
    // whose parent is genuinely empty must still gate — otherwise the picker
    // would issue an unfiltered query that ignores the cascade, which is the
    // defect objectui#2215 filed in the first place.
    const rows = [ROW_NORTH, ROW_NO_REGION];
    const ds = makeDataSource(rows);
    const { container } = renderGrid(ds, rows);
    await waitFor(() => expect(screen.getByText('Task two')).toBeInTheDocument());

    const gatedTrigger = await openEditor(cellAt(container, 1, 3));
    expect(gatedTrigger.getAttribute('data-testid')).toBe('lookup-trigger-gated');
    expect(gatedTrigger.disabled).toBe(true);
    expect(gatedTrigger.textContent).toMatch(/region/i);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // CONTROL — the row above, same render, same column: filled parent, open.
    const openTrigger = await openEditor(cellAt(container, 0, 3));
    expect(openTrigger.getAttribute('data-testid')).toBe('lookup-trigger-regional_owner');
    expect(openTrigger.disabled).toBe(false);
  });

  it('4 — ⭐ objectui#7188: a STAGED parent re-scopes the child before anything is saved', async () => {
    // Under option A (objectui#7165) this test pinned the OPPOSITE as current
    // behaviour: `dependentValues={ctx.row}` is the SAVED record, so staging
    // `region: 'south'` in this same row left the child scoped by the persisted
    // 'north'. objectui#7188 carries the staged record across the seam —
    // `data-table` passes `pendingRow` (the row merged with its `pendingChanges`
    // entry) and the grid scopes by `ctx.pendingRow ?? ctx.row` — so this is
    // the assertion that goes RED if anyone "simplifies" B back to A. Tests 1–3
    // cannot see that regression: their rows carry no staged edits, so
    // `pendingRow` and `row` coincide there.
    const rows = [ROW_NORTH];
    const ds = makeDataSource(rows);
    const { container } = renderGrid(ds, rows);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // Stage a new parent WITHOUT saving. `region` is a `text` field, so its
    // widget is `TextField` and is NOT in `DISCRETE_EDIT_TYPES` — its `onChange`
    // routes to `ctx.stage`, which writes `pendingChanges` without closing.
    const regionCell = cellAt(container, 0, 1);
    fireEvent.click(regionCell);
    const regionInput = await waitFor(() => {
      const el = regionCell.querySelector('input');
      expect(el).toBeTruthy();
      return el as HTMLInputElement;
    });
    fireEvent.change(regionInput, { target: { value: 'south' } });

    // Open the child. Clicking another cell moves the edit; the staged value
    // stays in `pendingChanges`.
    fireEvent.click(await openEditor(cellAt(container, 0, 3)));
    await waitFor(() => expect(screen.getByText('Person 07')).toBeInTheDocument());

    // ⭐ PROOF THE STAGING LANDED AND NOTHING WAS SAVED. Without the first half
    // this test could pass for a trivial reason (nothing staged, the saved
    // parent honoured as in test 2); without the second, a save would make the
    // staged and persisted parents coincide and the test could not tell A from
    // B. The region cell renders its PENDING value ('south') while the saved
    // record still says 'north' and the data source saw no write.
    await waitFor(() => {
      expect(cellAt(container, 0, 1).textContent).toMatch(/south/);
    });
    expect(rows[0].region).toBe('north');
    expect(ds.update).not.toHaveBeenCalled();

    // Scoped by the STAGED 'south', not the saved 'north': Person 07 is south
    // (offered); Person 01 is north (not offered). The query carried the staged
    // value as its hard `$filter`, and the persisted value never reached it.
    expect(screen.queryByText('Person 01')).not.toBeInTheDocument();
    expect(ds.refQueries.some((q: any) => q?.$filter?.region === 'south')).toBe(true);
    expect(ds.refQueries.some((q: any) => q?.$filter?.region === 'north')).toBe(false);
  });
});
