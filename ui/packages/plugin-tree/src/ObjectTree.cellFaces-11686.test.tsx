/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Tree cells draw the SAME per-field-type faces list cells draw — objectui#11686.
 *
 * ── The repro this file pins ───────────────────────────────────────────────
 * Setup → Business Units, the "Org Chart" tab (`sys_business_unit`'s
 * `org_chart` list view, `type: 'tree'`, which `ListView` hands to this
 * package's `object-tree`) printed the boolean `active` column as the text
 * `true`. The tree's formatter knew two families — "has options" and "is a
 * reference" — and sent every other type to `String(value)`, so booleans,
 * dates, numbers and currency all printed raw while the flat-table tabs on the
 * same page drew them through `@object-ui/fields`.
 *
 * ── How "the same face" is asserted ────────────────────────────────────────
 * Not by restating what each face draws: every typed cell below is compared,
 * byte for byte, against the face the list surfaces resolve for the same field
 * — `getCellRenderer(resolveCellRendererType(field))` rendered on its own. A
 * face that changes its markup changes both sides, so these assertions follow
 * the registry instead of freezing a copy of it; a tree that stringifies a
 * value cannot match any of them.
 *
 * The mount is the `ListView` shape (a live dataSource AND inline `data`),
 * because that is the path the Org Chart takes and the one that fetches the
 * object schema the faces are resolved from.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { getCellRenderer, resolveCellRendererType, type CellRendererProps } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

/** `sys_business_unit`, trimmed to the columns this file reads. */
const OBJECT_SCHEMA = {
  name: 'sys_business_unit',
  fields: {
    name: { type: 'text', label: 'Name' },
    parent_business_unit_id: { type: 'tree', reference: 'sys_business_unit', label: 'Parent' },
    kind: {
      type: 'select',
      label: 'Kind',
      options: [
        { label: 'Business Department', value: 'department' },
        { label: 'Holding Company', value: 'company' },
      ],
    },
    active: { type: 'boolean', label: 'Active' },
    effective_from: { type: 'date', label: 'Effective From', format: 'short' },
    budget: { type: 'currency', label: 'Budget', currency: 'USD' },
  },
};

const ROWS = [
  {
    id: 'bu1',
    name: 'Acme',
    parent_business_unit_id: null,
    kind: 'company',
    active: true,
    effective_from: '2024-03-05',
    budget: 1250000,
  },
  {
    id: 'bu2',
    name: 'Retired Office',
    parent_business_unit_id: null,
    kind: 'department',
    active: false,
    effective_from: '2023-11-20',
    budget: 0,
  },
];

/** The column order the tree renders: the label column first, then these. */
const COLUMNS = ['kind', 'active', 'effective_from', 'budget', 'code'] as const;

const TREE_SCHEMA = {
  type: 'object-tree',
  objectName: 'sys_business_unit',
  parentField: 'parent_business_unit_id',
  labelField: 'name',
  // `code` is deliberately NOT in the object schema: the untyped bound.
  fields: ['name', ...COLUMNS],
};

function makeDataSource(): DataSource {
  return {
    find: async () => ROWS.map((r) => ({ ...r, code: `${r.id.toUpperCase()}-CODE` })),
    getObjectSchema: async () => OBJECT_SCHEMA,
  } as unknown as DataSource;
}

function Tree() {
  return (
    <ObjectTree schema={TREE_SCHEMA as never} dataSource={makeDataSource()} data={ROWS} />
  );
}

/** One row's `<td>` for a column, located by the row's label text. */
async function cellOf(rowLabel: string, column: (typeof COLUMNS)[number]): Promise<HTMLElement> {
  await waitFor(() =>
    expect(
      screen.getAllByTestId('object-tree-row').some((r) => r.textContent?.includes(rowLabel)),
    ).toBe(true),
  );
  // The schema arrives after the first rows, and before it does EVERY column
  // is untyped and prints its plain string — so each assertion below waits for
  // the schema first. The signal is deliberately one the fix does not produce:
  // the `kind` select reading its option label is what the tree printed
  // before objectui#11686 too. Waiting on a face's own markup instead would
  // make every test here fail at this line on a tree without the faces, and a
  // reverse check would then prove only that the wait times out.
  const cellIn = (label: string, col: (typeof COLUMNS)[number]) => {
    const row = screen
      .getAllByTestId('object-tree-row')
      .find((r) => r.textContent?.includes(label));
    // The first `<td>` is the label column.
    return row ? (Array.from(row.querySelectorAll('td'))[1 + COLUMNS.indexOf(col)] as HTMLElement) : undefined;
  };
  await waitFor(() => expect(cellIn('Acme', 'kind')?.textContent).toBe('Holding Company'));
  return cellIn(rowLabel, column)!;
}

/**
 * What a list cell draws for this column and value: the published two-step,
 * rendered on its own, with the `field` a list surface hands it.
 */
function listFaceHtml(column: keyof typeof OBJECT_SCHEMA.fields, value: unknown): string {
  const def: { type: string; format?: string } = OBJECT_SCHEMA.fields[column];
  const rendererType = resolveCellRendererType({ type: def.type, format: def.format });
  const Face = getCellRenderer(rendererType);
  const field = { ...def, name: column, type: rendererType } as CellRendererProps['field'];
  const { container, unmount } = render(<Face value={value} field={field} />);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe('ObjectTree cells draw the list cell faces (objectui#11686)', () => {
  it('draws a boolean column through the boolean face, not the text `true`', async () => {
    render(<Tree />);
    const cell = await cellOf('Acme', 'active');

    // The reported symptom, gone.
    expect(cell.textContent).not.toContain('true');
    // The face itself: a checked, read-only checkbox.
    const box = within(cell).getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(cell.innerHTML).toBe(listFaceHtml('active', true));
  });

  it('draws `false` on a status-named column as the face draws it, not the text `false`', async () => {
    render(<Tree />);
    const cell = await cellOf('Retired Office', 'active');

    expect(cell.textContent).not.toContain('false');
    // An unchecked, read-only box named by its column, the face every boolean
    // draws for `false` whatever its name (objectui#13412 retired the badge).
    expect(within(cell).getByRole('checkbox', { name: 'Active' })).toHaveAttribute('aria-checked', 'false');
    expect(within(cell).queryByTestId('boolean-warning-badge')).toBeNull();
    expect(cell.innerHTML).toBe(listFaceHtml('active', false));
  });

  it('draws date, currency and select columns through their list faces', async () => {
    render(<Tree />);

    const date = await cellOf('Acme', 'effective_from');
    expect(date.textContent).not.toBe('2024-03-05');
    expect(date.innerHTML).toBe(listFaceHtml('effective_from', '2024-03-05'));

    const budget = await cellOf('Acme', 'budget');
    expect(budget.textContent).not.toBe('1250000');
    expect(budget.innerHTML).toBe(listFaceHtml('budget', 1250000));

    const kind = await cellOf('Acme', 'kind');
    expect(kind.textContent).toBe('Holding Company');
    expect(kind.innerHTML).toBe(listFaceHtml('kind', 'company'));
  });

  it('keeps the plain string for a column the object schema does not define', async () => {
    // The declared bound: no declared type, no face to resolve — not a guess.
    render(<Tree />);
    const cell = await cellOf('Acme', 'code');

    expect(cell.textContent).toBe('BU1-CODE');
    expect(cell.children).toHaveLength(0);
  });

  it('renders the Active column through the boolean face under a non-en locale, labelled in that locale', async () => {
    // The card's pin. The boolean face names its column by the checkbox's
    // accessible name, and it names it with the label this tree's header
    // prints — the session language's, not the authored English. Since
    // objectui#13412 a `false` is the same unchecked box, with no badge.
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'zh',
          detectBrowserLanguage: false,
          resources: {
            zh: {
              testapp: {
                fields: { sys_business_unit: { active: '启用' } },
                fieldOptions: {},
              },
            },
          },
        }}
      >
        <Tree />
      </I18nProvider>,
    );

    const on = await cellOf('Acme', 'active');
    expect(on.textContent).not.toContain('true');
    expect(within(on).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

    const off = await cellOf('Retired Office', 'active');
    expect(off.textContent).not.toContain('false');
    const box = within(off).getByRole('checkbox', { name: '启用' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box.getAttribute('aria-label')).not.toContain('Active');
    expect(within(off).queryByTestId('boolean-warning-badge')).toBeNull();

    // …and it is the header's word, not a second translation of it.
    const header = screen.getAllByRole('columnheader')[1 + COLUMNS.indexOf('active')];
    expect(header.textContent).toBe('启用');
  });
});
