/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7154 — the four picker keys `multiple`, `allowCreate`,
 * `lookupPageSize` and `dependsOn` DO reach `ObjectGrid`'s inline lookup
 * picker, and they reach it WITHOUT being on the relational copy set.
 *
 * ## The card this file answers, and why it is not four verdict flips
 *
 * objectui#7154 was filed off the derivation objectui#6875 built: the extractor
 * in `relationalMetaCopySet.derivation.test.ts` sweeps the three consumers for
 * keys read off a field-meta bag, and these four came back read, spec-declared
 * (`FieldSchema` 17.2.0 — 71 strict props, all four present, measured with
 * `name`/`type`/`label` as the positive control) and absent from
 * `RELATIONAL_META_KEYS`. The card concluded the values never arrive, and asked
 * for four `deferred` → `spec` flips plus rendering proof.
 *
 * The rendering proof is what killed the premise. Every one of the four is
 * ALREADY in effect in the grid's inline picker on an unmodified tree, because
 * the picker is not fed the copied bag at all:
 *
 *   - `applyRelationalMeta` writes onto `fieldMeta`, and `fieldMeta`'s only
 *     consumer is `<CellRenderer field={fieldMeta}>` — the READ-ONLY cell
 *     (`ObjectGrid.tsx`, all three column-building paths). For a relational
 *     column that resolves to `LookupCellRenderer`, which reads exactly
 *     `reference`, `displayField` and
 *     `reference_field` — none of the four.
 *   - The inline EDITOR is a different seam: `renderCellEditor` looks the field
 *     up in the object schema itself and spreads the WHOLE def into the widget
 *     — `let field: any = { name: ctx.column.accessorKey, ...fieldDef }` — so
 *     every key the def carries reaches `LookupField`, on the copy set or not.
 *
 * Both halves read `objectSchema?.fields?.[name]`, the same object, so there is
 * no shape where the copy set could rescue an editor the schema read did not
 * already serve: when that lookup misses, `renderCellEditor` returns `null` and
 * `applyRelationalMeta` copies nothing, together.
 *
 * ⇒ Flipping the four verdicts would write four members onto a bag whose
 * consumer does not read them — the defect class objectui#6711
 * (`reference_to_field`) and objectui#6874 (`titleFormat`) each retired. They
 * stay `deferred`, now with the measurement in their notes instead of a promise.
 *
 * ## What each test renders
 *
 * One data source, one referenced object, two lookup columns whose field defs
 * differ ONLY in the key under test — the shape objectui#6875's
 * `lookupDisplayFieldSpelling-6875.test.tsx` established. The control column is
 * load-bearing in both directions: it proves the picker path is reached and
 * that the difference is the declared key rather than the fixture.
 *
 * ## ⚠️ `dependsOn` arrives — it used to GATE FOREVER (objectui#7165)
 *
 * ⭐ THIS SECTION WAS REWRITTEN, AND THE CASE BELOW UPDATED RATHER THAN
 * DELETED. When this file was written the `dependsOn` case pinned the DEFECT:
 * the column rendered a permanently gated, disabled trigger. objectui#7165
 * fixed that, so the pin now states the fixed behaviour. It is updated in place
 * on purpose — a deleted pin is indistinguishable from a pin that never
 * existed, and this case is still the only place the four keys are compared
 * against a live control in one render.
 *
 * objectui#2215 ("cascading lookup broken in forms; table picker bypasses the
 * dependent filter") was closed COMPLETED by PR objectui#2216, which fixed two
 * halves: the FORM renderer injects its live watched record as
 * `dependentValues`, and every picker surface takes the `dependsOn` chain as a
 * hard `baseFilter`. Only the second half is host-independent, and the grid
 * never got the first: `LookupField` resolves `dependentValues ?? {}` and this
 * grid's inline editor did not supply that prop, so the resolved record was
 * `{}` for every row and the gate never lifted — a field that could never be
 * filled. (The resolution then also carried a `?? ctx.formValues ?? ctx.data`
 * tail no host could set; objectui#7206 retired it.)
 *
 * objectui#7165 supplied the missing input: `renderCellEditor` passes the row as
 * `dependentValues`. The cascade itself is unchanged (half 2 was always live
 * here), which is why this case needs no new data source.
 *
 * objectui#7188 then carried the STAGED record across the seam too: the context
 * gained `pendingRow` (the persisted row merged with the row's unsaved edits)
 * and the grid scopes by `ctx.pendingRow ?? ctx.row`, so a parent edited but
 * not yet saved in the same row re-scopes the child. That case is pinned in
 * `gridDependentValues-7165.test.tsx` (test 4), not here: this file's rows
 * carry no staged edits, so `pendingRow` and `row` are the same object for
 * every assertion below.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { RELATIONAL_META_KEYS } from '../relationalMetaKeys';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'os_7154_task';
const REF = 'os_7154_person';

/** Twelve candidates: more than the picker dialog's default page of 10. */
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
 * A data source whose referenced-object query honours `$top`/`$skip` and the
 * `$filter` record, so a page size and a dependent filter are observable as
 * rendered rows rather than only as call arguments.
 */
function makeDataSource(fields: Record<string, any>, rows: any[]) {
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
      return { name, fields: { id: { type: 'text' }, title: { type: 'text', label: 'Title' }, ...fields } };
    },
  } as any;
}

function renderGrid(ds: any, rows: any[], columns: any[]) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    data: rows,
    pagination: { pageSize: 50 },
    columns,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The n-th DATA cell of the single row (`td[0]` is the row-number column). */
function cellAt(container: HTMLElement, index: number): HTMLElement {
  const row = container.querySelector('tbody tr') as HTMLElement;
  const tds = Array.from(row.querySelectorAll('td')) as HTMLElement[];
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

describe('objectui#7154 — the four picker keys reach the grid’s inline picker off the field def', () => {
  it('none of the four is on the relational copy set (the premise this file re-measures)', () => {
    // Control: the copy set is populated and holds the key objectui#6875 added,
    // so "does not contain" below is a reading and not an empty list.
    // objectui#7155 shrank it from 7 to 3 by retiring the snake_case dialect,
    // and objectui#11070 round 4 to 2 by retiring `reference_to`.
    expect(RELATIONAL_META_KEYS.length).toBeGreaterThan(1);
    expect(RELATIONAL_META_KEYS).toContain('reference');
    expect(RELATIONAL_META_KEYS).toContain('displayField');
    for (const key of ['multiple', 'allowCreate', 'lookupPageSize', 'dependsOn']) {
      expect(RELATIONAL_META_KEYS).not.toContain(key);
    }
  });

  it('`multiple` — the declared column accumulates two picks; the control replaces', async () => {
    const rows = [{ id: 't1', title: 'Task one', owners: null, owner: null }];
    const ds = makeDataSource(
      {
        owners: { type: 'lookup', label: 'Owners', reference: REF, multiple: true },
        owner: { type: 'lookup', label: 'Owner', reference: REF },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owners', label: 'Owners', type: 'lookup' },
      { field: 'owner', label: 'Owner', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // Declared `multiple: true` — both picks land, the popover stays open.
    const multiCell = cellAt(container, 1);
    fireEvent.click(await openEditor(multiCell));
    fireEvent.click(await waitFor(() => screen.getByText('Person 01')));
    fireEvent.click(await waitFor(() => screen.getByText('Person 02')));
    await waitFor(() => {
      expect(multiCell.textContent).toMatch(/2 selected/);
    });

    // CONTROL — same reference, same records, no `multiple`: the second pick
    // REPLACES the first and the compact trigger shows that one record.
    const singleCell = cellAt(container, 2);
    fireEvent.click(await openEditor(singleCell));
    fireEvent.click(await waitFor(() => screen.getByText('Person 01')));
    fireEvent.click(await openEditor(singleCell));
    fireEvent.click(await waitFor(() => screen.getByText('Person 02')));
    await waitFor(() => {
      expect(within(singleCell).getByText('Person 02')).toBeInTheDocument();
    });
    expect(singleCell.textContent).not.toMatch(/selected/);
  });

  it('`allowCreate` — `false` removes the quick-create affordance the control offers', async () => {
    const rows = [{ id: 't1', title: 'Task one', owner: null, fixed_owner: null }];
    const ds = makeDataSource(
      {
        owner: { type: 'lookup', label: 'Owner', reference: REF },
        fixed_owner: { type: 'lookup', label: 'Fixed owner', reference: REF, allowCreate: false },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner', label: 'Owner', type: 'lookup' },
      { field: 'fixed_owner', label: 'Fixed owner', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // CONTROL — nothing declared. `os_7154_person` is a user-facing reference,
    // so inline quick-create is on by default and the entry renders.
    const defaultCell = cellAt(container, 1);
    fireEvent.click(await openEditor(defaultCell));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(screen.getByText('Create new')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Create new')).not.toBeInTheDocument());

    // Declared `allowCreate: false` — the author's opt-out is honoured.
    const optedOutCell = cellAt(container, 2);
    fireEvent.click(await openEditor(optedOutCell));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(screen.queryByText('Create new')).not.toBeInTheDocument();
  });

  it('`lookupPageSize` — the declared page size scopes the picker dialog’s query and rows', async () => {
    const rows = [{ id: 't1', title: 'Task one', owner: null, paged_owner: null }];
    const ds = makeDataSource(
      {
        owner: { type: 'lookup', label: 'Owner', reference: REF },
        paged_owner: { type: 'lookup', label: 'Paged owner', reference: REF, lookupPageSize: 3 },
      },
      rows,
    );
    const { container, unmount } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner', label: 'Owner', type: 'lookup' },
      { field: 'paged_owner', label: 'Paged owner', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    const pagedCell = cellAt(container, 2);
    await openEditor(pagedCell);
    fireEvent.click(await waitFor(() => within(pagedCell).getByTestId('browse-all-records')));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    await waitFor(() => {
      expect(document.querySelectorAll('[role="dialog"] tbody tr').length).toBe(3);
    });
    expect(ds.refQueries.some((q: any) => q?.$top === 3)).toBe(true);
    unmount();

    // CONTROL — the sibling column declares no page size, so the same dialog
    // over the same twelve records uses `RecordPickerDialog`'s default of 10.
    const second = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner', label: 'Owner', type: 'lookup' },
      { field: 'paged_owner', label: 'Paged owner', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());
    const defaultCell = cellAt(second.container, 1);
    await openEditor(defaultCell);
    fireEvent.click(await waitFor(() => within(defaultCell).getByTestId('browse-all-records')));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="dialog"] tbody tr').length).toBe(10);
    });
  });

  it('`dependsOn` — the declared column is USABLE and scoped; the control is unscoped (objectui#7165)', async () => {
    const rows = [{ id: 't1', title: 'Task one', region: 'north', owner: null, regional_owner: null }];
    const ds = makeDataSource(
      {
        region: { type: 'text', label: 'Region' },
        owner: { type: 'lookup', label: 'Owner', reference: REF },
        regional_owner: { type: 'lookup', label: 'Regional owner', reference: REF, dependsOn: ['region'] },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'region', label: 'Region', editable: false },
      { field: 'owner', label: 'Owner', type: 'lookup' },
      { field: 'regional_owner', label: 'Regional owner', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // CONTROL — no `dependsOn`: an ordinary, usable trigger.
    const plainTrigger = await openEditor(cellAt(container, 2));
    expect(plainTrigger.getAttribute('data-testid')).toBe('lookup-trigger-owner');
    expect(plainTrigger.disabled).toBe(false);

    // Declared `dependsOn: ['region']`. ⭐ UPDATED BY objectui#7165 — this used
    // to assert `lookup-trigger-gated` / `disabled === true`, which pinned the
    // defect: the grid fed the widget NO dependent values, so the gate could
    // never lift however the row was filled. The grid now passes the row as
    // `dependentValues` (`ctx.pendingRow ?? ctx.row` since objectui#7188; nothing
    // is staged here, so that IS the row), the row carries `region: 'north'`, so
    // the dependency is satisfied and the picker is an ordinary usable trigger.
    //
    // The key still ARRIVES off the field def — which is this file's whole
    // claim — and the proof is no longer the gate but the SCOPING asserted
    // below: an unscoped picker would list all twelve people.
    const dependentTrigger = await openEditor(cellAt(container, 3));
    expect(dependentTrigger.getAttribute('data-testid')).toBe('lookup-trigger-regional_owner');
    expect(dependentTrigger.disabled).toBe(false);
    // The browse-all button next to it is live too (it shared the gate before).
    expect(within(cellAt(container, 3)).getByTestId('browse-all-records')).not.toBeDisabled();

    // The `dependsOn` chain reaches the query as a hard `$filter` (PR
    // objectui#2216's half 2, which was always live here — it just never had
    // an input). `region: 'north'` → only the six north people are offered.
    fireEvent.click(dependentTrigger);
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(screen.queryByText('Person 07')).not.toBeInTheDocument();
    expect(ds.refQueries.some((q: any) => q?.$filter?.region === 'north')).toBe(true);
  });
});
