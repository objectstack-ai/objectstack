/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A line-items grid's `boolean` / `toggle` column reads its two option labels
 * in the session language (objectui#12924).
 *
 * The derive functions turned such a child field into a select column whose
 * options were `{ label: 'Yes', value: 'true' }` and `{ label: 'No', value:
 * 'false' }`, English on every locale: the editable cell's picker and the
 * list-mode cell showed it. The labels now come from `useBooleanValueLabel`
 * (`@object-ui/fields`), the one rule that names a boolean value as a word
 * (`common.yes` / `common.no`, objectui#11689). The derive module is pure, so
 * its two producers hold the hook and hand it in, and every derive function
 * REQUIRES it. The stored values stay `'true'` / `'false'`.
 *
 * Three rows of pins:
 *
 *   - the derive functions draw the labels with the function they are handed,
 *     and keep the stored values;
 *   - `record:line_items` (`LineItemsPanel`) hydrates an untyped column over a
 *     boolean child field into a picker that reads the zh words, draws the
 *     same words in its read-only table, and re-labels the picker when the
 *     language is switched while it is on screen;
 *   - `MasterDetailForm` derives a boolean column that reads the zh words, in
 *     its editable grid and in its list-mode (per-row form) cells.
 *
 * Every oracle is read from the zh pack.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { I18nProvider, loadBuiltInLocale, useObjectTranslation } from '@object-ui/i18n';
import { zh } from '@object-ui/i18n/locales';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { deriveColumns, deriveDetail, hydrateColumns } from './deriveMasterDetail';
import { LineItemsPanel } from './LineItemsPanel';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

afterEach(() => cleanup());

const YES = (zh as unknown as { common: { yes: string } }).common.yes;
const NO = (zh as unknown as { common: { no: string } }).common.no;

/** A label function no pack spells, so a pin can only pass by reading it. */
const marked = (value: boolean) => (value ? 'WORD-FOR-TRUE' : 'WORD-FOR-FALSE');
const MARKED_OPTIONS = [
  { label: 'WORD-FOR-TRUE', value: 'true' },
  { label: 'WORD-FOR-FALSE', value: 'false' },
];

const CHILD = {
  name: 'inv_line',
  fields: {
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'inv' },
    description: { type: 'text', label: 'Description' },
    billable: { type: 'boolean', label: 'Billable' },
    rush: { type: 'toggle', label: 'Rush' },
  },
};

describe('the derive functions draw a boolean column\'s labels with the `booleanLabel` they are handed (objectui#12924)', () => {
  it('deriveColumns: a boolean and a toggle field each get the two words, over the stored values `true` / `false`', () => {
    const byName = Object.fromEntries(
      deriveColumns(CHILD, { relationshipField: 'invoice', booleanLabel: marked }).map((c) => [c.name, c]),
    );
    expect(byName.billable).toMatchObject({ type: 'select', options: MARKED_OPTIONS });
    expect(byName.rush).toMatchObject({ type: 'select', options: MARKED_OPTIONS });
  });

  it('hydrateColumns: an untyped column over a boolean field gets the same two options', () => {
    const [col] = hydrateColumns([{ name: 'billable' }], CHILD, { booleanLabel: marked });
    expect(col).toMatchObject({ type: 'select', label: 'Billable', options: MARKED_OPTIONS });
  });

  it('deriveDetail: both of its column paths hand the function on', () => {
    const derived = deriveDetail('inv_line', CHILD, 'inv', { booleanLabel: marked });
    expect(derived.columns.find((c) => c.name === 'billable')?.options).toEqual(MARKED_OPTIONS);
    const hydrated = deriveDetail('inv_line', CHILD, 'inv', { booleanLabel: marked, columns: [{ name: 'rush' }] });
    expect(hydrated.columns).toEqual([expect.objectContaining({ name: 'rush', options: MARKED_OPTIONS })]);
  });

  it('CONTROL: a select field keeps its own option labels; the function is not asked', () => {
    const asked = vi.fn(marked);
    const child = { fields: { status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] } } };
    expect(deriveColumns(child, { booleanLabel: asked })[0].options).toEqual([{ label: 'Open', value: 'open' }]);
    expect(asked).not.toHaveBeenCalled();
  });
});

const LINES = [
  { id: 'l1', invoice: 'inv1', description: 'Freight', billable: true },
  { id: 'l2', invoice: 'inv1', description: 'Packing', billable: false },
];

function dataSource() {
  return {
    getObjectSchema: vi.fn(async (o: string) =>
      o === 'inv_line' ? CHILD : { name: 'inv', fields: { ref: { type: 'text', label: 'Ref' } } },
    ),
    findOne: vi.fn().mockResolvedValue({ id: 'inv1', ref: 'INV-1' }),
    find: vi.fn(async (o: string) => ({ data: o === 'inv_line' ? LINES.map((l) => ({ ...l })) : [] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn(),
  };
}

const inZh = (node: React.ReactNode) =>
  render(<I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{node}</I18nProvider>);

/** The two lines' `Billable` pickers, in row order. */
const billablePickers = () => screen.getAllByRole('combobox', { name: 'Billable' }).slice(0, 2);

describe('the line-items carriers read a boolean column in the session language (objectui#12924)', () => {
  it('record:line_items: an untyped column over a boolean field is a picker reading the zh words', async () => {
    inZh(
      <SchemaRendererProvider dataSource={dataSource() as never}>
        <LineItemsPanel
          schema={{
            childObject: 'inv_line',
            relationshipField: 'invoice',
            parentObject: 'inv',
            parentId: 'inv1',
            columns: [{ name: 'description' }, { name: 'billable' }],
          } as never}
        />
      </SchemaRendererProvider>,
    );
    // `waitFor`: the zh catalogue loads after the first render, and the grid
    // is re-hydrated when the words change.
    await waitFor(() => expect(billablePickers().map((el) => el.textContent)).toEqual([YES, NO]));
    expect(screen.queryByText('Yes')).toBeNull();
    expect(screen.queryByText('No')).toBeNull();
  });

  /**
   * `MasterDetailForm` derives once, when its child schema arrives, so the
   * catalogue is loaded before the form mounts, as the console's
   * `preloadBootstrapLocale` loads it before the first render.
   */
  const masterDetail = async (inlineMode: 'grid' | 'form') => {
    await loadBuiltInLocale('zh');
    return inZh(
      <MasterDetailForm
        schema={{
          objectName: 'inv',
          mode: 'edit',
          recordId: 'inv1',
          fields: ['ref'],
          details: [{ childObject: 'inv_line', title: 'Lines', inlineMode }],
        } as never}
        dataSource={dataSource() as never}
      />,
    );
  };

  it('MasterDetailForm, editable grid: the derived picker reads the zh words', async () => {
    await masterDetail('grid');
    await waitFor(() => expect(billablePickers().map((el) => el.textContent)).toEqual([YES, NO]));
    expect(screen.queryByText('Yes')).toBeNull();
  });

  it('record:line_items, read-only: the table cell reads the zh word for each stored value', async () => {
    const { container } = inZh(
      <SchemaRendererProvider dataSource={dataSource() as never}>
        <LineItemsPanel
          schema={{
            childObject: 'inv_line',
            relationshipField: 'invoice',
            parentObject: 'inv',
            parentId: 'inv1',
            readonly: true,
            columns: [{ name: 'description' }, { name: 'billable' }],
          } as never}
        />
      </SchemaRendererProvider>,
    );
    // The read-only table draws each select cell's option label through
    // `displayText` (objectui#12915), so the hydrated words reach it too, on
    // screen and on a print page. Column 0 is the row number.
    const cells = () =>
      Array.from(container.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).slice(1).map((td) => td.textContent),
      );
    await waitFor(() => expect(cells()).toEqual([['Freight', YES], ['Packing', NO]]));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.textContent).not.toMatch(/\b(Yes|No|true|false)\b/);
  });

  it('record:line_items: a language switched while the grid is on screen re-labels the picker', async () => {
    // The grid memo is keyed on the two WORDS, so a switch re-hydrates the
    // columns; the function itself is a new one every render and cannot key it.
    function SwitchTo({ language }: { language: string }) {
      const { changeLanguage } = useObjectTranslation();
      return (
        <button type="button" onClick={() => void changeLanguage(language)}>
          switch
        </button>
      );
    }
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <SwitchTo language="zh" />
        <SchemaRendererProvider dataSource={dataSource() as never}>
          <LineItemsPanel
            schema={{
              childObject: 'inv_line',
              relationshipField: 'invoice',
              parentObject: 'inv',
              parentId: 'inv1',
              columns: [{ name: 'description' }, { name: 'billable' }],
            } as never}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(billablePickers().map((el) => el.textContent)).toEqual(['Yes', 'No']));
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    await waitFor(() => expect(billablePickers().map((el) => el.textContent)).toEqual([YES, NO]));
  });

  it('MasterDetailForm, list mode: each line\'s cell reads the zh words', async () => {
    const { container } = await masterDetail('form');
    await waitFor(() => expect(container.textContent).toContain('Freight'));
    const cellOf = (line: string) =>
      Array.from(container.querySelectorAll('tbody tr'))
        .find((tr) => tr.textContent?.includes(line))
        ?.querySelectorAll('td');
    const billableIndex = Array.from(container.querySelectorAll('thead th')).findIndex((th) => th.textContent === 'Billable');
    expect(billableIndex).toBeGreaterThan(0);
    await waitFor(() => expect(cellOf('Freight')?.[billableIndex]?.textContent).toBe(YES));
    expect(cellOf('Packing')?.[billableIndex]?.textContent).toBe(NO);
  });
});
