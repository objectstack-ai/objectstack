/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36147 — the record page's field area is one list, drawn the
 * same in the side preview, on a phone and in the wide page's pinned left
 * column: one field a row (label left, value right, a hairline between rows),
 * a group's title left and its chevron at the row's right end (down folded,
 * up open), no pencil beside a field (a click on an editable value edits it,
 * a click on a read-only one does nothing), and every empty row folded into
 * the list's one last row.
 *
 * Drawn here as the laid-out record page draws it: the default record page's
 * frameless face (`DefaultRecordPageContext`), the column cap of 1 and the
 * page's field list (`RecordFieldListContext`).
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { DefaultRecordPageContext, DetailsColumnCapContext } from '../defaultRecordPage';
import { createEmptyFieldTally, RecordFieldListContext, type RecordFieldList } from '../recordFieldList';
import { EmptyFieldsRow } from '../EmptySectionsFold';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    code: { type: 'auto_number', label: 'Code' },
    note: { type: 'text', label: 'Note' },
    phone: { type: 'text', label: 'Phone' },
    website: { type: 'url', label: 'Website' },
  },
};

const section = {
  title: 'Overview',
  fields: [
    { name: 'name', label: 'Name' },
    { name: 'amount', label: 'Amount' },
    { name: 'code', label: 'Code' },
    { name: 'note', label: 'Note' },
    { name: 'phone', label: 'Phone' },
    { name: 'website', label: 'Website' },
  ],
} as unknown as DetailViewSection;

const data = { name: 'Atlas deal', amount: 174000, code: 'D-0004', note: null, phone: '', website: 'https://example.com' };

function makeList(showEmpty = false): RecordFieldList {
  return { showEmpty, toggleShowEmpty: vi.fn(), emptyFields: createEmptyFieldTally() };
}

function Page({ list, cap = 1, children }: { list: RecordFieldList | null; cap?: 1 | 3; children: React.ReactNode }) {
  return (
    <DefaultRecordPageContext.Provider value>
      <DetailsColumnCapContext.Provider value={cap}>
        <RecordFieldListContext.Provider value={list}>{children}</RecordFieldListContext.Provider>
      </DetailsColumnCapContext.Provider>
    </DefaultRecordPageContext.Provider>
  );
}

const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-detail-field-row]'));
const rowOf = (label: string) => screen.getByText(label, { exact: true }).closest('[data-detail-field-row]') as HTMLElement;

let innerWidth: number;
beforeEach(() => {
  innerWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
});

describe('the field list: one field a row at any width (objectstack#36147 items 1–2)', () => {
  it('under the cap of 1 the group draws one column of label-left rows, a hairline between them', () => {
    const { container } = render(
      <Page list={makeList()}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(container.querySelector('[data-detail-section-list]')).not.toBeNull();
    const grid = container.querySelector('[data-detail-section-list] .grid') as HTMLElement;
    expect(grid.className.split(/\s+/)).toContain('grid-cols-1');
    expect(grid.className).not.toMatch(/grid-cols-2|grid-cols-3/);
    for (const row of rows(container)) {
      expect(row.className).toContain('border-b');
      expect(row.querySelector('[data-detail-field-label]')).not.toBeNull();
    }
  });

  it('on a phone the rows are the same rows: no grouped-inset face of its own', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    const { container } = render(
      <Page list={makeList()}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(rows(container).length).toBeGreaterThan(0);
    expect(container.querySelector('.divide-y')).toBeNull();
    expect(rowOf('Name').querySelector('[data-detail-field-label]')).not.toBeNull();
  });

  it('a full page whose details are its only face keeps laying a group out by width (cap 3)', () => {
    const { container } = render(
      <Page list={makeList()} cap={3}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(container.querySelector('[data-detail-section-list]')).toBeNull();
    expect(rows(container)[0].className).not.toContain('border-b');
  });
});

describe('a group: title left, chevron at the right end, down folded and up open (objectstack#36147 item 3)', () => {
  it('the whole title row toggles, and the chevron turns', () => {
    const { container } = render(
      <Page list={makeList()}>
        <DetailSection section={{ ...section, collapsible: true } as DetailViewSection} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    const toggle = screen.getByRole('button', { name: 'Overview' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.lastElementChild?.getAttribute('class')).toContain('lucide-chevron-up');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.lastElementChild?.getAttribute('class')).toContain('lucide-chevron-down');
    expect(rows(container)).toHaveLength(0);
  });
});

describe('no pencil: a click on an editable value edits it (objectstack#36147 item 7)', () => {
  it('a single click on an editable value enters edit; a read-only value takes no click', () => {
    const onEnter = vi.fn();
    render(
      <Page list={makeList()}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} onEnterInlineEdit={onEnter} />
      </Page>,
    );
    fireEvent.click(screen.getByText('Atlas deal'));
    expect(onEnter).toHaveBeenCalledWith('name');
    onEnter.mockClear();
    fireEvent.click(screen.getByText('D-0004'));
    expect(onEnter).not.toHaveBeenCalled();
    // A read-only row is not a copy button any more.
    expect(rowOf('Code').querySelector('[role="button"]')).toBeNull();
  });

  it('the pencil is not drawn beside a field: it stays only as the keyboard’s way in', () => {
    render(
      <Page list={makeList()}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} onEnterInlineEdit={vi.fn()} />
      </Page>,
    );
    const pencil = rowOf('Name').querySelector('button') as HTMLButtonElement;
    expect(pencil).not.toBeNull();
    expect(pencil.className.split(/\s+/)).toContain('sr-only');
    expect(pencil.className).not.toContain('pointer-coarse:opacity-100');
  });

  it('a click on a link inside an editable value is the link’s, not the row’s', () => {
    const onEnter = vi.fn();
    render(
      <Page list={makeList(true)}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} onEnterInlineEdit={onEnter} />
      </Page>,
    );
    const link = rowOf('Website').querySelector('a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(onEnter).not.toHaveBeenCalled();
  });
});

describe('empty fields fold into the list’s one last row (objectstack#36147 item 5)', () => {
  it('a group hides its empty rows, draws no toggle of its own, and reports them to the list', () => {
    const list = makeList();
    const { container } = render(
      <Page list={list}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
        <EmptyFieldsRow />
      </Page>,
    );
    expect(screen.queryByText('Note')).toBeNull();
    expect(screen.queryByText('Phone')).toBeNull();
    expect(list.emptyFields.getTotal()).toBe(2);
    const row = container.querySelector('[data-empty-fields-row]') as HTMLElement;
    expect(row.getAttribute('data-empty-fields-count')).toBe('2');
    expect(row.querySelectorAll('button')).toHaveLength(1);
    // The section draws no toggle of its own: the list's row is the only one.
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(1);
    fireEvent.click(row.querySelector('button')!);
    expect(list.toggleShowEmpty).toHaveBeenCalledTimes(1);
  });

  it('shown, the empty rows return in place and the row offers to hide them', () => {
    const list = makeList(true);
    const { container } = render(
      <Page list={list}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
        <EmptyFieldsRow />
      </Page>,
    );
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Phone')).toBeTruthy();
    const button = container.querySelector('[data-empty-fields-row] button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('a group with only empty rows draws nothing until they are shown; the list still counts them', () => {
    const list = makeList();
    const empty = { title: 'Address', fields: [{ name: 'note', label: 'Note' }, { name: 'phone', label: 'Phone' }] } as unknown as DetailViewSection;
    const { container, rerender } = render(
      <Page list={list}>
        <DetailSection section={empty} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(container.querySelector('section')).toBeNull();
    expect(screen.queryByText('Address')).toBeNull();
    expect(list.emptyFields.getTotal()).toBe(2);
    rerender(
      <Page list={{ ...list, showEmpty: true }}>
        <DetailSection section={empty} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(screen.getByText('Address')).toBeTruthy();
  });

  it('an authored all-empty hide is not the reader’s to undo, and is not counted', () => {
    const list = makeList(true);
    const hidden = { title: 'Hidden', hideEmpty: true, fields: [{ name: 'note', label: 'Note' }] } as unknown as DetailViewSection;
    render(
      <Page list={list}>
        <DetailSection section={hidden} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(screen.queryByText('Hidden')).toBeNull();
    expect(list.emptyFields.getTotal()).toBe(0);
  });

  it('a group leaving the list withdraws its count', () => {
    const list = makeList();
    const { unmount } = render(
      <Page list={list}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    expect(list.emptyFields.getTotal()).toBe(2);
    act(() => unmount());
    expect(list.emptyFields.getTotal()).toBe(0);
  });

  it('outside the laid-out page a group keeps its own toggle', () => {
    const { container } = render(
      <Page list={null}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </Page>,
    );
    const toggles = Array.from(container.querySelectorAll('section button')).filter((b) => /2/.test(b.textContent ?? ''));
    expect(toggles).toHaveLength(1);
    expect(container.querySelector('[data-empty-fields-row]')).toBeNull();
  });
});
