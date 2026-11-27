/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37801 — on the record page's field list a WIDE field (long
 * text, markdown, html, rich text, a multi-file list) draws its label above
 * the value, and the value takes the column's whole width.
 *
 * The field list (objectstack#36147) draws every row label-left in a 112 px
 * column. In the pinned left column of a wide page that left a long body
 * 276 px to be set in. The predicate is the auto layout's own
 * `isWideDetailField`, never a second type list; every other field keeps the
 * label-left row, and the row keeps its attributes and its click-to-edit.
 *
 * jsdom does no layout, so these pins read the class and element contract
 * the width rests on; the pixel readings are in the pull request.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { DefaultRecordPageContext, DetailsColumnCapContext } from '../defaultRecordPage';
import { createEmptyFieldTally, RecordFieldListContext, type RecordFieldList } from '../recordFieldList';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }] },
    summary: { type: 'textarea', label: 'Summary' },
    body: { type: 'markdown', label: 'Body' },
    page: { type: 'html', label: 'Page' },
    letter: { type: 'richtext', label: 'Letter' },
    invoices: { type: 'file', label: 'Invoices', multiple: true },
    receipt: { type: 'file', label: 'Receipt' },
  },
};

type Name = keyof typeof objectSchema.fields;

/**
 * The section as the running app hands it: name, label and the object's
 * type. `withoutType` drops the type, so the row has to read it off the
 * object field the way the cell renderer does.
 */
function sectionOf(names: readonly Name[], { withoutType = false } = {}): DetailViewSection {
  return {
    title: 'Overview',
    fields: names.map((name) => ({
      name,
      label: objectSchema.fields[name].label,
      ...(withoutType ? {} : { type: objectSchema.fields[name].type }),
    })),
  } as unknown as DetailViewSection;
}

const ALL: readonly Name[] = ['name', 'stage', 'summary', 'body', 'page', 'letter', 'invoices', 'receipt'];

const data = {
  name: 'Atlas deal',
  stage: 'open',
  summary: 'A long summary that would be set in what is left beside the label.',
  body: '# Policy\n\nThe body of the policy.',
  page: '<h1>Page</h1><p>Body</p>',
  letter: '<p>Dear reader</p>',
  invoices: [
    { name: 'taxi-invoice-24312000000123456789.pdf', url: '/files/1' },
    { name: 'hotel-invoice-24312000000987654321.pdf', url: '/files/2' },
  ],
  receipt: { name: 'receipt.pdf', url: '/files/3' },
};

function makeList(): RecordFieldList {
  return { showEmpty: true, toggleShowEmpty: vi.fn(), emptyFields: createEmptyFieldTally() };
}

function FieldList({ children }: { children: React.ReactNode }) {
  return (
    <DefaultRecordPageContext.Provider value>
      <DetailsColumnCapContext.Provider value={1}>
        <RecordFieldListContext.Provider value={makeList()}>{children}</RecordFieldListContext.Provider>
      </DetailsColumnCapContext.Provider>
    </DefaultRecordPageContext.Provider>
  );
}

const rowOf = (container: HTMLElement, name: string): HTMLElement => {
  const row = container.querySelector<HTMLElement>(`[data-detail-field="${name}"]`);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

const classes = (el: Element): string[] => el.className.split(/\s+/);

/** Label above value: a column, stretched (no `items-start`), the label first and not a fixed-width column. */
function expectLabelOnTop(row: HTMLElement) {
  expect(classes(row)).toContain('flex-col');
  expect(classes(row)).not.toContain('items-start');
  const label = row.querySelector<HTMLElement>('[data-detail-field-label]');
  expect(label).not.toBeNull();
  expect(row.firstElementChild).toBe(label);
  expect(classes(label!)).not.toContain('w-28');
  expect(classes(label!)).not.toContain('shrink-0');
  // The value is the label's sibling, and it grows with the row.
  const value = label!.nextElementSibling as HTMLElement;
  expect(classes(value)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
}

/** Label left: a row, the label a 112 px column beside the value. */
function expectLabelLeft(row: HTMLElement) {
  expect(classes(row)).not.toContain('flex-col');
  expect(classes(row)).toEqual(expect.arrayContaining(['flex', 'items-start', 'gap-3']));
  const label = row.querySelector<HTMLElement>('[data-detail-field-label]');
  expect(classes(label!)).toEqual(expect.arrayContaining(['w-28', 'shrink-0']));
}

let innerWidth: number;
beforeEach(() => {
  innerWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
});

describe('objectstack#37801 — a wide field on the field list reads label-on-top', () => {
  for (const name of ['summary', 'body', 'page', 'letter', 'invoices'] as const) {
    it(`${objectSchema.fields[name].type}${name === 'invoices' ? ' (multiple)' : ''}: label above, value across the row`, () => {
      const { container } = render(
        <FieldList>
          <DetailSection section={sectionOf(ALL)} data={data} objectSchema={objectSchema} />
        </FieldList>,
      );
      const row = rowOf(container, name);
      expectLabelOnTop(row);
      // The row keeps the attributes a page finds it by.
      expect(row.getAttribute('data-detail-field')).toBe(name);
      expect(row.hasAttribute('data-detail-field-row')).toBe(true);
    });
  }

  it('CONTROL: a text, a select and a single file field keep the label-left row', () => {
    const { container } = render(
      <FieldList>
        <DetailSection section={sectionOf(ALL)} data={data} objectSchema={objectSchema} />
      </FieldList>,
    );
    for (const name of ['name', 'stage', 'receipt'] as const) expectLabelLeft(rowOf(container, name));
  });

  it('the type is read off the object field when the section entry carries none', () => {
    const { container } = render(
      <FieldList>
        <DetailSection section={sectionOf(['name', 'body'], { withoutType: true })} data={data} objectSchema={objectSchema} />
      </FieldList>,
    );
    expectLabelOnTop(rowOf(container, 'body'));
    expectLabelLeft(rowOf(container, 'name'));
  });

  it('a click on a wide value still enters edit', () => {
    const onEnter = vi.fn();
    const { container, getByText } = render(
      <FieldList>
        <DetailSection section={sectionOf(['name', 'summary'])} data={data} objectSchema={objectSchema} onEnterInlineEdit={onEnter} />
      </FieldList>,
    );
    fireEvent.click(getByText(data.summary));
    expect(onEnter).toHaveBeenCalledWith('summary');
    // The edit hint stays on the value, the click target it always was.
    const value = rowOf(container, 'summary').querySelector('[data-detail-field-label]')!.nextElementSibling as HTMLElement;
    expect(value.getAttribute('title')).toBe('Click to edit');
  });

  it('CONTROL: the boxed face (off the default record page) is unchanged — labels already sit on top', () => {
    const { container } = render(<DetailSection section={sectionOf(ALL)} data={data} objectSchema={objectSchema} />);
    for (const name of ['name', 'body']) {
      const row = rowOf(container, name);
      expect(classes(row)).toEqual(expect.arrayContaining(['space-y-1.5', 'group', 'min-w-0']));
      expect(classes(row)).not.toContain('flex-col');
      expect(row.hasAttribute('data-detail-field-row')).toBe(false);
    }
  });
});
