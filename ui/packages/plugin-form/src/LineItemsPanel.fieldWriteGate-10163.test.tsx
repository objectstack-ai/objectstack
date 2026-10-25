/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A line-items grid does not offer a cell the CALLER may read but not edit
 * (objectui#10163).
 *
 * ## The defect, one container over from objectui#10120
 *
 * objectui#10120 taught the three record-form containers to render a field the
 * caller's permission set marks `editable: false` as non-editable, through ONE
 * render pass (`applyFieldPermissions` in `fieldWriteGate.ts`). The
 * `record:line_items` grid stayed outside that pass: it read `schema.readonly`
 * and nothing else, so the same column rendered as a live, editable cell.
 *
 * ## Why every refusal row carries a lit control in the SAME grid
 *
 * "The denied cell is disabled" is only a finding if a cell the caller MAY
 * edit — same grid, same row, same principal — is still enabled. Otherwise a
 * grid that had gone read-only wholesale would pass. So each refusal assertion
 * sits beside the control column's assertion, and the whole-grid affordances
 * (add a line, remove a line) are pinned to the answer they gave before.
 *
 * ## Fail-open with no provider
 *
 * With no permission provider mounted the grid behaves exactly as it did
 * before: every cell editable. That posture is objectui#10161's, kept on
 * purpose (see `fieldWriteGate.ts`), and this card does not move it.
 *
 * ## The same grid inside `MasterDetailForm`
 *
 * `MasterDetailForm` renders its child collections through the same
 * `LineItemsField`, so it carried the same gap. The second `describe` below
 * mounts the master-detail form with the same principal, the same child
 * columns and the same rows, and holds its grid to the answers the panel
 * gives: refused ⇒ locked, unreadable ⇒ omitted, no provider ⇒ unchanged.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();
afterEach(cleanup);

/** The card's sibling fixture: the child line of a KPI sheet. */
const CHILD = 'kpi_entry_line';

const SCHEMA = {
  childObject: CHILD,
  relationshipField: 'sheet',
  parentObject: 'kpi_entry_sheet',
  parentId: 'SHEET1',
  columns: [
    { name: 'indicator_name', label: 'Indicator', type: 'text' },
    { name: 'actual_value', label: 'Actual', type: 'number' },
    { name: 'score', label: 'Score', type: 'number' },
    { name: 'reviewer_note', label: 'Reviewer note', type: 'text' },
  ],
} as any;

const ROWS = [
  { id: 'LINE1', sheet: 'SHEET1', indicator_name: 'Revenue', actual_value: 4000, score: 0 },
  { id: 'LINE2', sheet: 'SHEET1', indicator_name: 'Margin', actual_value: 12, score: 0 },
];

/**
 * `/me/permissions` for the card's `reporter`: may read `score` but not edit
 * it, and may not read `reviewer_note` at all. Everything else on the child
 * object falls back to the object-level grant, which allows editing.
 */
const REPORTER: any = {
  authenticated: true,
  userId: 'u-reporter',
  tenantId: null,
  roles: ['kpi_dept_reporter'],
  permissionSets: ['kpi_dept_reporter'],
  objects: { [CHILD]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true } },
  fields: {
    [`${CHILD}.score`]: { readable: true, editable: false },
    [`${CHILD}.reviewer_note`]: { readable: false, editable: false },
  },
};

/** The same principal with no field-level restriction anywhere. */
const UNRESTRICTED: any = { ...REPORTER, fields: {} };

function makeDataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function mount(perms: any | null, schema: any = SCHEMA) {
  const panel = (
    <SchemaRendererProvider dataSource={makeDataSource()}>
      <LineItemsPanel schema={schema} />
    </SchemaRendererProvider>
  );
  return render(
    perms ? <MePermissionsProvider initialPermissions={perms}>{panel}</MePermissionsProvider> : panel,
  );
}

/** Every rendered cell of one column — the two loaded rows plus the entry row. */
async function cells(label: string): Promise<HTMLInputElement[]> {
  return waitFor(() => {
    const els = screen.getAllByLabelText(label) as HTMLInputElement[];
    // Two loaded rows and the grid's always-present entry row.
    if (els.length < ROWS.length + 1) throw new Error(`${label} cells not rendered yet`);
    return els;
  });
}

describe('LineItemsPanel — a cell the caller may read but not edit is not offered (objectui#10163)', () => {
  it('renders the FLS-refused column non-editable while the permitted columns in the same grid stay editable', async () => {
    mount(REPORTER);
    const actual = await cells('Actual');
    const indicator = await cells('Indicator');
    const score = await cells('Score');

    // The lit control: same grid, same rows, same principal — still editable.
    for (const el of [...actual, ...indicator]) expect(el.disabled).toBe(false);
    // Readable, so the column is still SHOWN, with its values …
    expect(score.map((el) => el.value).slice(0, ROWS.length)).toEqual(['0', '0']);
    // … but never offered as an edit, on a loaded row or on a new one.
    for (const el of score) expect(el.disabled).toBe(true);
  });

  it('locks the refused column on every row even where the author declared a narrower lock', async () => {
    // An authored per-row lock that is FALSE for every loaded row: on its own it
    // leaves the column editable. The refusal is row-independent, so it wins.
    const narrower = {
      ...SCHEMA,
      columns: SCHEMA.columns.map((c: any) =>
        c.name === 'score' ? { ...c, readonlyWhen: "record.indicator_name == 'Never'" } : c,
      ),
    };
    mount(REPORTER, narrower);
    const actual = await cells('Actual');
    for (const el of actual) expect(el.disabled).toBe(false);
    for (const el of await cells('Score')) expect(el.disabled).toBe(true);
  });

  it('omits a column the caller may not read, exactly as the form containers do', async () => {
    mount(REPORTER);
    await cells('Actual');
    expect(screen.queryAllByLabelText('Reviewer note')).toHaveLength(0);
  });

  it('leaves adding and removing lines on the answer they had before', async () => {
    mount(REPORTER);
    await cells('Actual');
    expect(screen.getByTestId('line-items-add')).toBeTruthy();
    expect((screen.getByTestId('line-items-add') as HTMLButtonElement).disabled).toBe(false);
    const removes = screen.getAllByRole('button', { name: 'Remove row' }) as HTMLButtonElement[];
    expect(removes).toHaveLength(ROWS.length);
    for (const b of removes) expect(b.disabled).toBe(false);
  });

  it('CONTROL — an unrestricted caller gets every column, every cell editable', async () => {
    mount(UNRESTRICTED);
    for (const label of ['Indicator', 'Actual', 'Score', 'Reviewer note']) {
      for (const el of await cells(label)) expect(el.disabled).toBe(false);
    }
  });

  it('CONTROL — with no permission provider the grid is exactly as before: fail-open, nothing withheld', async () => {
    mount(null);
    for (const label of ['Indicator', 'Actual', 'Score', 'Reviewer note']) {
      for (const el of await cells(label)) expect(el.disabled).toBe(false);
    }
    expect(screen.getByTestId('line-items-add')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove row' })).toHaveLength(ROWS.length);
  });

  it('CONTROL — a `readonly` panel still withholds adding and removing lines for every caller', async () => {
    mount(REPORTER, { ...SCHEMA, readonly: true });
    await waitFor(() => expect(screen.getByTestId('line-items-readonly')).toBeTruthy());
    expect(screen.queryByTestId('line-items-add')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Remove row' })).toHaveLength(0);
  });
});

/** The master-detail form's parent: one header field, no field-level rule. */
const PARENT = 'kpi_entry_sheet';

/** {@link REPORTER} with an object-level grant on the parent too, so the header renders as usual. */
const MD_REPORTER: any = {
  ...REPORTER,
  objects: {
    ...REPORTER.objects,
    [PARENT]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
  },
};

/** The same principal with no field-level restriction anywhere. */
const MD_UNRESTRICTED: any = { ...MD_REPORTER, fields: {} };

function makeMasterDetailDataSource() {
  return {
    getObjectSchema: vi.fn(async (obj: string) =>
      obj === PARENT ? { name: PARENT, fields: { sheet_title: { type: 'text', label: 'Sheet title' } } } : null,
    ),
    findOne: vi.fn().mockResolvedValue({ id: 'SHEET1', sheet_title: 'Q3' }),
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

/** Edit mode, so the child grid loads the same two rows the panel above lists. */
function mountMasterDetail(perms: any | null) {
  const form = (
    <MasterDetailForm
      schema={{
        objectName: PARENT,
        mode: 'edit',
        recordId: 'SHEET1',
        fields: ['sheet_title'],
        details: [{ childObject: CHILD, relationshipField: 'sheet', columns: SCHEMA.columns }],
      }}
      dataSource={makeMasterDetailDataSource()}
    />
  );
  return render(
    perms ? <MePermissionsProvider initialPermissions={perms}>{form}</MePermissionsProvider> : form,
  );
}

describe('MasterDetailForm — its child grid does not offer a cell the caller may read but not edit (objectui#10163)', () => {
  it('renders the FLS-refused child column non-editable while the permitted columns in the same grid stay editable', async () => {
    mountMasterDetail(MD_REPORTER);
    const actual = await cells('Actual');
    const indicator = await cells('Indicator');
    const score = await cells('Score');

    // The lit control: same grid, same rows, same principal — still editable.
    for (const el of [...actual, ...indicator]) expect(el.disabled).toBe(false);
    // Readable, so the column is still SHOWN, with its values …
    expect(score.map((el) => el.value).slice(0, ROWS.length)).toEqual(['0', '0']);
    // … but never offered as an edit, on a loaded row or on a new one.
    for (const el of score) expect(el.disabled).toBe(true);
  });

  it('omits a child column the caller may not read, exactly as LineItemsPanel does', async () => {
    mountMasterDetail(MD_REPORTER);
    await cells('Actual');
    expect(screen.queryAllByLabelText('Reviewer note')).toHaveLength(0);
  });

  it('CONTROL — an unrestricted caller gets every child column, every cell editable', async () => {
    mountMasterDetail(MD_UNRESTRICTED);
    for (const label of ['Indicator', 'Actual', 'Score', 'Reviewer note']) {
      for (const el of await cells(label)) expect(el.disabled).toBe(false);
    }
  });

  it('CONTROL — with no permission provider the child grid is exactly as before: fail-open, nothing withheld', async () => {
    mountMasterDetail(null);
    for (const label of ['Indicator', 'Actual', 'Score', 'Reviewer note']) {
      for (const el of await cells(label)) expect(el.disabled).toBe(false);
    }
  });
});
