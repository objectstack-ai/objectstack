/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7166 — `descriptionField`, `lookupColumns` and `lookupFilters` leave
 * `ObjectGrid`'s relational copy set, and NOTHING a user can see changes.
 *
 * ## Why this file renders instead of asserting the copy set
 *
 * This card exists because a DERIVATION was mistaken for a delivery proof.
 * objectui#6875 swept its three consumers, found `descriptionField` and
 * `lookupColumns` read and not copied, and added them — onto a bag their only
 * reader never consults. Its third key, `displayField`, was genuinely
 * delivered, and it is the one that arrived with a rendering test
 * (`lookupDisplayFieldSpelling-6875.test.tsx`, `ACME-42` vs `Wrong Name`).
 * One-for-three, and the difference between the hit and the misses is exactly
 * the evidence bar.
 *
 * ⭐ A derivation establishes that a consumer READS a key. It does NOT
 * establish that a given BAG is how that consumer gets it. So this file proves
 * the second claim the only way it can be proved — by rendering — in both
 * directions:
 *
 *   A. THE CELL. Four lookup columns over one referenced record, differing only
 *      in the key under test, all resolve the SAME text. The `displayField`
 *      column is the control: it differs, which is what makes the other three
 *      zeros readings rather than a fixture that never reached the lookup path.
 *
 *   B. THE EDITOR. Each retired key STILL takes effect in the inline picker
 *      with the copy set no longer carrying it, because `renderCellEditor`
 *      looks the field up in the object schema and spreads the whole def into
 *      the widget. This is the half that makes the retirement
 *      behaviour-preserving rather than merely tidy, and each test carries a
 *      sibling control column that declares nothing.
 *
 * ## The fixture choice that makes the controls load-bearing
 *
 * The referenced object's schema declares ONLY `id` and `name`. That matters:
 * `deriveLookupColumns` builds a picker column set from the referenced schema
 * whenever a field declares no `lookup_columns`, and `effectiveDescriptionField`
 * falls back to the first derived non-display column. With a two-field schema
 * it derives nothing beyond the display field, so a control column shows NO
 * preview line at all — and the declared column's preview is attributable to
 * the declaration rather than to the heuristic. The extra values the pickers
 * render (`region`, `email`) live on the RECORDS, which is all
 * `recordToOption` needs.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { RELATIONAL_META_KEYS } from '../relationalMetaKeys';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'os_7166_task';
const REF = 'os_7166_person';

/** Six candidates, split across two regions so a filter is observable as rows. */
const PEOPLE = [
  { id: 'p1', name: 'Person 01', region: 'north', email: 'p1@north.example' },
  { id: 'p2', name: 'Person 02', region: 'north', email: 'p2@north.example' },
  { id: 'p3', name: 'Person 03', region: 'north', email: 'p3@north.example' },
  { id: 'p4', name: 'Person 04', region: 'south', email: 'p4@south.example' },
  { id: 'p5', name: 'Person 05', region: 'south', email: 'p5@south.example' },
  { id: 'p6', name: 'Person 06', region: 'south', email: 'p6@south.example' },
];

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as any;
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
  if (!(Element.prototype as any).setPointerCapture) (Element.prototype as any).setPointerCapture = () => {};
  if (!(Element.prototype as any).releasePointerCapture) (Element.prototype as any).releasePointerCapture = () => {};
});

/**
 * A data source whose referenced-object query honours the `$filter` record, so
 * a declared `lookupFilters` is observable as rendered rows and not only as a
 * call argument. The referenced schema is deliberately two fields — see the
 * docblock.
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
        if (filter && typeof filter === 'object' && typeof filter.region === 'string') {
          recs = recs.filter((p) => p.region === filter.region);
        }
        return { data: recs, total: recs.length, hasMore: false, pageSize: 50 };
      }
      return { data: rows, total: rows.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (objectName: string, id: string) =>
      objectName === REF ? (PEOPLE.find((p) => p.id === id) ?? null) : null,
    ),
    update: vi.fn(async (_o: string, _id: string, changes: any) => changes),
    getObjectSchema: async (name: string) => {
      if (name === REF) {
        // No `nameField`, no `titleFormat`, no third field: nothing but the
        // field def's own pointers can shape the cell or the picker.
        return { name, fields: { id: { type: 'text' }, name: { type: 'text' } } };
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

describe('objectui#7166 — the three retired keys were never delivered by this bag', () => {
  it('none of the three is on the copy set any more (the premise the rest of this file measures)', () => {
    // Control: the copy set is populated and still holds the key objectui#6875
    // genuinely delivered, so "does not contain" below is a reading.
    // ⚠️ objectui#7155 shrank the copy set from 7 to 3 (the snake_case dialect
    // was retired), and objectui#11070 round 4 to 2 (`reference_to` was
    // retired), so this floor moved with each. It is still a floor, not a
    // formality: at 0 every `not.toContain` below would pass vacuously.
    expect(RELATIONAL_META_KEYS.length).toBeGreaterThan(1);
    expect(RELATIONAL_META_KEYS).toContain('reference');
    expect(RELATIONAL_META_KEYS).toContain('displayField');
    for (const key of ['descriptionField', 'lookupColumns', 'lookupFilters']) {
      expect(RELATIONAL_META_KEYS).not.toContain(key);
    }
    // ⭐ objectui#7155 — INVERTED. These snake_case spellings used to be a
    // DIFFERENT population that stayed copied, on an open producer-side
    // question. That question was answered (the host feeding snake_case was
    // this repo's own widget contract and docs) and the dialect was retired, so
    // they are now absent for the same reason as the camel three above.
    for (const key of ['description_field', 'lookup_filters', 'id_field', 'display_field']) {
      expect(RELATIONAL_META_KEYS).not.toContain(key);
    }
  });

  it('A. THE CELL — declaring any of the three changes nothing; `displayField` (CONTROL) changes everything', async () => {
    const rows = [{ id: 't1', title: 'Task one', plain: 'p1', desc: 'p1', cols: 'p1', filt: 'p1', disp: 'p1' }];
    const ds = makeDataSource(
      {
        plain: { type: 'lookup', label: 'Plain', reference: REF },
        desc: { type: 'lookup', label: 'Desc', reference: REF, descriptionField: 'email' },
        cols: { type: 'lookup', label: 'Cols', reference: REF, lookupColumns: ['name', 'region'] },
        // Points at a region this record is NOT in — if the key reached the
        // cell at all, this is where it would show.
        filt: { type: 'lookup', label: 'Filt', reference: REF, lookupFilters: [{ field: 'region', operator: 'eq', value: 'south' }] },
        disp: { type: 'lookup', label: 'Disp', reference: REF, displayField: 'email' },
      },
      rows,
    );
    renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'plain', label: 'Plain', type: 'lookup' },
      { field: 'desc', label: 'Desc', type: 'lookup' },
      { field: 'cols', label: 'Cols', type: 'lookup' },
      { field: 'filt', label: 'Filt', type: 'lookup' },
      { field: 'disp', label: 'Disp', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // CONTROL first — the cell path is live, reads the field def, and CAN
    // render something different. Without this, the four-way match below would
    // also be satisfied by a fixture that never reached the lookup renderer.
    await waitFor(
      () => expect(screen.getByText('p1@north.example')).toBeInTheDocument(),
      { timeout: 4000 },
    );

    // The four columns that do NOT declare `displayField` all resolve the same
    // text: the three retired keys made no difference to any of them.
    await waitFor(
      () => expect(screen.getAllByText('Person 01').length).toBe(4),
      { timeout: 4000 },
    );
  });

  it('B1. THE EDITOR — `descriptionField` still drives the picker’s secondary line', async () => {
    const rows = [{ id: 't1', title: 'Task one', owner_desc: null, owner_plain: null }];
    const ds = makeDataSource(
      {
        owner_desc: { type: 'lookup', label: 'Owner (desc)', reference: REF, descriptionField: 'email' },
        owner_plain: { type: 'lookup', label: 'Owner (plain)', reference: REF },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner_desc', label: 'Owner (desc)', type: 'lookup' },
      { field: 'owner_plain', label: 'Owner (plain)', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // Declared: the author's `email` is previewed under each option, with the
    // key off the copy set — it arrived through the editor's schema spread.
    const declared = cellAt(container, 1);
    fireEvent.click(await openEditor(declared));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    await waitFor(() => {
      expect(document.querySelectorAll('[data-lookup-preview="email"]').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('p1@north.example')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(document.querySelectorAll('[data-lookup-preview="email"]').length).toBe(0));

    // CONTROL — same reference, same records, nothing declared: the two-field
    // referenced schema derives no extra column, so there is no preview line.
    const control = cellAt(container, 2);
    fireEvent.click(await openEditor(control));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(document.querySelectorAll('[data-lookup-preview]').length).toBe(0);
  });

  it('B2. THE EDITOR — `lookupColumns` still shapes the picker’s columns', async () => {
    const rows = [{ id: 't1', title: 'Task one', owner_cols: null, owner_plain: null }];
    const ds = makeDataSource(
      {
        owner_cols: { type: 'lookup', label: 'Owner (cols)', reference: REF, lookupColumns: ['name', 'region'] },
        owner_plain: { type: 'lookup', label: 'Owner (plain)', reference: REF },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner_cols', label: 'Owner (cols)', type: 'lookup' },
      { field: 'owner_plain', label: 'Owner (plain)', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // Declared: `region` is a picker column, so it previews under each option.
    const declared = cellAt(container, 1);
    fireEvent.click(await openEditor(declared));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    await waitFor(() => {
      expect(document.querySelectorAll('[data-lookup-preview="region"]').length).toBeGreaterThan(0);
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(document.querySelectorAll('[data-lookup-preview="region"]').length).toBe(0));

    // CONTROL — nothing declared, nothing derived, no preview.
    const control = cellAt(container, 2);
    fireEvent.click(await openEditor(control));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(document.querySelectorAll('[data-lookup-preview]').length).toBe(0);
  });

  it('B3. THE EDITOR — `lookupFilters` still scopes the picker’s candidates', async () => {
    const rows = [{ id: 't1', title: 'Task one', owner_filtered: null, owner_plain: null }];
    const ds = makeDataSource(
      {
        owner_filtered: {
          type: 'lookup',
          label: 'Owner (filtered)',
          reference: REF,
          lookupFilters: [{ field: 'region', operator: 'eq', value: 'south' }],
        },
        owner_plain: { type: 'lookup', label: 'Owner (plain)', reference: REF },
      },
      rows,
    );
    const { container } = renderGrid(ds, rows, [
      { field: 'title', label: 'Title', editable: false },
      { field: 'owner_filtered', label: 'Owner (filtered)', type: 'lookup' },
      { field: 'owner_plain', label: 'Owner (plain)', type: 'lookup' },
    ]);
    await waitFor(() => expect(screen.getByText('Task one')).toBeInTheDocument());

    // Declared: only the `south` half is offered — the author's hard scope
    // reached the picker with the key off the copy set.
    const declared = cellAt(container, 1);
    fireEvent.click(await openEditor(declared));
    await waitFor(() => expect(screen.getByText('Person 04')).toBeInTheDocument());
    expect(screen.queryByText('Person 01')).not.toBeInTheDocument();
    expect(ds.refQueries.some((q: any) => q?.$filter?.region === 'south')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Person 04')).not.toBeInTheDocument());

    // CONTROL — the same six records, unscoped: the north half is offered too,
    // which is what makes the absence above a filter and not an empty fixture.
    const control = cellAt(container, 2);
    fireEvent.click(await openEditor(control));
    await waitFor(() => expect(screen.getByText('Person 01')).toBeInTheDocument());
    expect(screen.getByText('Person 04')).toBeInTheDocument();
  });
});
