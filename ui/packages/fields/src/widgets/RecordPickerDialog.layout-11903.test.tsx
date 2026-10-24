/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One picker, one dialog layout — objectui#11903.
 *
 * The maintainer opened a role's Assign user and found the picker ugly; the
 * card traced each defect to an override stacked on the design system's
 * primitives and wrote the whole down as a contract. This file pins the
 * contract's DOM-checkable points against the real `RecordPickerDialog`, the
 * real `@object-ui/components` primitives and the real cell registry:
 *
 *   1. header rhythm — the container keeps the primitive's `gap-4`, with no
 *      `gap-0` and no per-section margin or padding standing in for it;
 *   2. one search border — the `Input` primitive draws the only border and
 *      keeps its own focus ring; the wrapper only positions the icon;
 *   3. checkbox rows — in `multiple` mode every row leads with the `Checkbox`
 *      primitive reflecting the pending selection, the header carries a
 *      select-all for the page, a click toggles once, and the grid's arrow /
 *      Enter / Space keys toggle the focused row as before;
 *   4. width by columns — the max-width rung follows the drawn column count;
 *   5. one footer bar — the record count, the page controls, the selected
 *      count, Cancel and Confirm live in one bar with no padding of their own;
 *   6. Confirm disabled while nothing is pending;
 *   7. no link cells — a census over every type the cell registry resolves,
 *      under a host that routes to records, finds no anchor in a row; its
 *      control draws the same probes outside the picker and finds them.
 *
 * Point 8's human half is the console preview gallery's `record_picker`
 * entry; the two-surface agreement pin (`LookupField.pickerAgreement.test.tsx`,
 * objectui#5492) is unchanged and runs beside this file.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RelatedRecordActionsProvider, type RelatedRecordActionsValue } from '@object-ui/react';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer, listCellRendererTypes } from '../index';

afterEach(cleanup);

type PickerProps = React.ComponentProps<typeof RecordPickerDialog>;

const USERS = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { id: `u${n}`, name: `User ${n}`, email: `user${n}@example.com`, email_verified: i % 3 !== 0 };
});

const USER_FIELDS: Record<string, { type: string; label: string }> = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'email', label: 'Email' },
  email_verified: { type: 'boolean', label: 'Email verified' },
};

/** A related list's Add picker: name, email, email verified. */
const THREE_COLUMNS = ['name', 'email', 'email_verified'];

function makeDataSource(rows: Record<string, unknown>[] = USERS) {
  return {
    find: vi.fn(async (_objectName: string, params?: { $skip?: number; $top?: number }) => {
      const skip = params?.$skip ?? 0;
      const top = params?.$top ?? rows.length;
      return { data: rows.slice(skip, skip + top), total: rows.length };
    }),
    findOne: vi.fn(async (_objectName: string, id: string) => rows.find((r) => r.id === id) ?? null),
    getObjectSchema: vi.fn(async () => ({ name: 'sys_user', fields: USER_FIELDS })),
  } as any;
}

function renderPicker(props: Partial<PickerProps> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <RecordPickerDialog
      open
      onOpenChange={() => {}}
      multiple
      dataSource={makeDataSource()}
      objectName="sys_user"
      columns={THREE_COLUMNS}
      fieldsMeta={USER_FIELDS}
      cellRenderer={getCellRenderer}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { ...utils, onSelect };
}

const dialog = () => screen.getByTestId('record-picker-dialog');
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const row = (rid: string) => screen.getByTestId(`record-row-${rid}`);
/** The row's LEADING cell checkbox — the boolean column draws a checkbox too. */
const leadingCheckbox = (rid: string) =>
  row(rid).querySelector('td:first-child [role="checkbox"]') as HTMLElement | null;
const confirmButton = () => screen.getByRole('button', { name: 'Confirm' });

async function pageShown(count = 10) {
  await waitFor(() => expect(document.querySelectorAll('[data-testid^="record-row-"]')).toHaveLength(count));
}

/** Let async cell work (a lookup cell's schema fetch) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('RecordPickerDialog — one picker, one dialog layout (objectui#11903)', () => {
  it('point 1: the container keeps the primitive gap, with nothing standing in for it', async () => {
    renderPicker();
    await pageShown();

    const classes = tokens(dialog());
    expect(classes).toContain('gap-4');
    expect(classes).not.toContain('gap-0');

    // The sections between the header and the footer are spaced by that gap
    // alone: no direct child carries a vertical margin or padding of its own.
    const VERTICAL_SPACING = /^(?:[a-z-]+:)*-?(?:m[ytb]|p[ytb])-/;
    for (const child of Array.from(dialog().children)) {
      expect(tokens(child).filter((c) => VERTICAL_SPACING.test(c)), child.outerHTML.slice(0, 120)).toEqual([]);
    }
  });

  it('point 2: the search is the Input primitive, the one bordered element, with its own focus ring', async () => {
    renderPicker();
    await pageShown();

    const input = screen.getByTestId('record-picker-search');
    const chain: Element[] = [];
    for (let el: Element | null = input; el && el !== dialog(); el = el.parentElement) chain.push(el);

    // A border-WIDTH utility (`border`, `border-2`, `border-b`, …), not a
    // colour (`border-input`) and not the explicit absence (`border-0`).
    const BORDER_WIDTH = /^(?:[a-z-]+:)*border(?:-[xytrbl])?(?:-(?!0$)\d+)?$/;
    const bordered = chain.filter((el) => tokens(el).some((c) => BORDER_WIDTH.test(c)));
    expect(bordered).toEqual([input]);

    const inputClasses = tokens(input);
    expect(inputClasses).not.toContain('border-0');
    expect(inputClasses).not.toContain('focus-visible:ring-0');
    // The primitive's own ring is still there to draw focus.
    expect(inputClasses).toContain('focus-visible:ring-2');
  });

  it('point 3: every row leads with a Checkbox reflecting the pending selection', async () => {
    const { onSelect } = renderPicker({ value: ['u02'] });
    await pageShown();

    for (const rec of USERS.slice(0, 10)) {
      const box = leadingCheckbox(rec.id);
      expect(box, rec.id).not.toBeNull();
      expect(box).toHaveAttribute('aria-label', 'Select row');
      expect(box).toHaveAttribute('aria-checked', rec.id === 'u02' ? 'true' : 'false');
    }

    // A row click still toggles, and the checkbox follows it.
    fireEvent.click(row('u03').querySelector('td:nth-child(2)')!);
    expect(leadingCheckbox('u03')).toHaveAttribute('aria-checked', 'true');

    // A click on the checkbox itself toggles exactly once (it does not also
    // reach the row's handler, which would toggle it straight back).
    fireEvent.click(leadingCheckbox('u04')!);
    expect(leadingCheckbox('u04')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(leadingCheckbox('u04')!);
    expect(leadingCheckbox('u04')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(confirmButton());
    expect(onSelect).toHaveBeenCalledWith(['u02', 'u03']);
  });

  it('point 3: the header is a select-all for the page', async () => {
    renderPicker({ value: ['u01'] });
    await pageShown();

    const selectPage = document.querySelector('thead [role="checkbox"]') as HTMLElement;
    expect(selectPage).toHaveAttribute('aria-label', 'Select all rows');
    expect(selectPage).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(selectPage);
    for (const rec of USERS.slice(0, 10)) {
      expect(leadingCheckbox(rec.id), rec.id).toHaveAttribute('aria-checked', 'true');
    }
    expect(selectPage).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('record-picker-selected-count')).toHaveTextContent('10 selected');

    // Again: the page clears, the pre-selected row with it.
    fireEvent.click(selectPage);
    for (const rec of USERS.slice(0, 10)) {
      expect(leadingCheckbox(rec.id), rec.id).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByTestId('record-picker-selected-count')).toHaveTextContent('0 selected');
  });

  it('point 3: the arrow keys and Enter / Space toggle the focused row, as before', async () => {
    renderPicker();
    await pageShown();

    const grid = screen.getByRole('grid', { name: 'Records' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(leadingCheckbox('u01')).toHaveAttribute('aria-checked', 'true');
    expect(row('u01')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: ' ' });
    expect(leadingCheckbox('u02')).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(leadingCheckbox('u01')).toHaveAttribute('aria-checked', 'false');

    // The row checkbox is not a tab stop of its own: the grid is the keyboard path.
    expect(leadingCheckbox('u01')).toHaveAttribute('tabindex', '-1');
  });

  it('point 3: single-select draws no selection column', async () => {
    renderPicker({ multiple: false });
    await pageShown();

    expect(document.querySelector('thead [role="checkbox"]')).toBeNull();
    expect(leadingCheckbox('u01')).toBeNull();
  });

  it('point 4: the width rung follows the drawn column count, the old width the ceiling', async () => {
    const SIX = ['name', 'email', 'email_verified', 'id', 'department', 'title'];
    const cases: Array<[Partial<PickerProps>, string, string[]]> = [
      [{ columns: THREE_COLUMNS }, 'sm:max-w-2xl', ['lg:max-w-5xl', 'sm:max-w-3xl']],
      [{ columns: ['name'], multiple: false }, 'sm:max-w-xl', ['lg:max-w-5xl', 'sm:max-w-2xl']],
      // Multiple mode's footer holds the buttons too: it starts at the three-column rung.
      [{ columns: ['name'] }, 'sm:max-w-2xl', ['lg:max-w-5xl']],
      [{ columns: SIX }, 'lg:max-w-5xl', ['sm:max-w-2xl']],
    ];
    for (const [props, rung, absent] of cases) {
      renderPicker(props);
      await pageShown();
      const classes = tokens(dialog());
      expect(classes, JSON.stringify(props)).toContain(rung);
      for (const other of absent) expect(classes, JSON.stringify(props)).not.toContain(other);
      cleanup();
    }
  });

  it('point 5: one footer bar holds the count, the page controls, the selected count and both buttons', async () => {
    renderPicker();
    await pageShown();

    const footer = screen.getByTestId('record-picker-footer');
    expect(footer.parentElement).toBe(dialog());

    const pagination = screen.getByTestId('record-picker-pagination');
    expect(pagination.parentElement).toBe(footer);
    expect(dialog().querySelectorAll('[data-testid="record-picker-pagination"]')).toHaveLength(1);

    const countLine = pagination.querySelector(':scope > span');
    expect(countLine).toHaveTextContent('12 records');
    const selectedCount = screen.getByTestId('record-picker-selected-count');
    for (const el of [
      countLine,
      screen.getByTestId('record-picker-page-jump'),
      screen.getByRole('button', { name: 'Next page' }),
      selectedCount,
      screen.getByRole('button', { name: 'Cancel' }),
      confirmButton(),
    ]) {
      expect(footer).toContainElement(el as HTMLElement);
    }

    // One horizontal padding — the dialog's: the bar and its two groups carry none.
    const HORIZONTAL_PADDING = /^(?:[a-z-]+:)*p[xlr]-/;
    for (const el of [footer, pagination, selectedCount.parentElement!]) {
      expect(tokens(el).filter((c) => HORIZONTAL_PADDING.test(c)), el.outerHTML.slice(0, 120)).toEqual([]);
    }
  });

  it('point 5: single-select keeps one bar, without buttons', async () => {
    renderPicker({ multiple: false });
    await pageShown();

    const footer = screen.getByTestId('record-picker-footer');
    expect(footer).toContainElement(screen.getByTestId('record-picker-pagination'));
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByTestId('record-picker-selected-count')).toBeNull();
  });

  it('point 6: Confirm is disabled while nothing is pending', async () => {
    renderPicker();
    await pageShown();

    expect(confirmButton()).toBeDisabled();
    fireEvent.click(row('u05').querySelector('td:nth-child(2)')!);
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(row('u05').querySelector('td:nth-child(2)')!);
    expect(confirmButton()).toBeDisabled();
  });

  it('point 6: a picker opened over a held value can confirm it', async () => {
    renderPicker({ value: ['u07'] });
    await pageShown();
    expect(confirmButton()).toBeEnabled();
  });
});

/**
 * A host that routes to records of any object — the record page's bridge
 * shape, the widest one (the shape objectui#11817's census uses).
 */
const host: RelatedRecordActionsValue = {
  resolve: () => ({}),
  recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
  openRecord: () => {},
};

const CONTRACT = { url: 'https://cdn.example.com/contract.pdf', name: 'contract.pdf' };
const GRACE = { id: 'r2', name: 'Grace' };

/**
 * Probe values per registry key. A key with no entry gets a plain string,
 * which every renderer accepts. The families that draw an anchor get a value
 * that makes them draw it — the control holds them to that.
 */
const PROBE_VALUE: Record<string, unknown> = {
  email: 'ada@example.com',
  url: 'https://example.com/ada',
  phone: '+15550100',
  file: CONTRACT,
  video: CONTRACT,
  audio: CONTRACT,
  lookup: GRACE,
  master_detail: GRACE,
  tree: GRACE,
};
const REFERENCE_TYPES = new Set(['lookup', 'master_detail', 'tree']);

function censusFields(types: readonly string[]) {
  const fields: Record<string, Record<string, unknown>> = { name: { type: 'text', label: 'Name' } };
  for (const type of types) {
    fields[`f_${type}`] = REFERENCE_TYPES.has(type)
      ? { type, label: type, reference: 'census' }
      : { type, label: type };
  }
  return fields;
}

describe('RecordPickerDialog — no cell renders as a link (objectui#11903, point 7)', () => {
  it('control: outside the picker, the probe values draw mailto, URL, tel, download and record anchors', async () => {
    const types = listCellRendererTypes();
    expect(types.length).toBeGreaterThan(20);
    const fields = censusFields(types);
    const { container } = render(
      <RelatedRecordActionsProvider value={host}>
        {types.map((type) => {
          const Renderer = getCellRenderer(type);
          return (
            <div key={type} data-type={type}>
              {/* A census spans every type, so no one `FieldMetadata` member names the def. */}
              <Renderer value={PROBE_VALUE[type] ?? 'probe'} field={{ name: `f_${type}`, ...fields[`f_${type}`] } as never} />
            </div>
          );
        })}
      </RelatedRecordActionsProvider>,
    );
    await waitFor(() => expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull());

    expect(container.querySelector('a[href="mailto:ada@example.com"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com/ada"]')).not.toBeNull();
    expect(container.querySelector('a[href="tel:+15550100"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://cdn.example.com/contract.pdf"]')).not.toBeNull();
    expect(container.querySelector('a[href="/apps/demo/census/record/r2"]')).not.toBeNull();
  });

  it('census: every registered type, drawn in a picker row under that host, draws no anchor', async () => {
    const types = listCellRendererTypes();
    const fields = censusFields(types);
    const record: Record<string, unknown> = { id: 'r1', name: 'Ada' };
    for (const type of types) record[`f_${type}`] = PROBE_VALUE[type] ?? 'probe';

    render(
      <RelatedRecordActionsProvider value={host}>
        <RecordPickerDialog
          open
          onOpenChange={() => {}}
          multiple
          dataSource={makeDataSource([record])}
          objectName="census"
          columns={['name', ...types.map((type) => `f_${type}`)]}
          fieldsMeta={fields}
          cellRenderer={getCellRenderer}
          onSelect={() => {}}
        />
      </RelatedRecordActionsProvider>,
    );
    await pageShown(1);
    await settle();

    // Every census column is drawn (the census measured the row, not a subset).
    expect(row('r1').querySelectorAll('[data-lookup-cell]')).toHaveLength(types.length + 1);
    expect(Array.from(row('r1').querySelectorAll('a')).map((a) => a.outerHTML)).toEqual([]);

    // The values are still there, as text: the address, the URL, the number,
    // the file's name and the referenced record's name.
    const cell = (type: string) => row('r1').querySelector(`[data-lookup-cell="f_${type}"]`);
    expect(cell('email')).toHaveTextContent('ada@example.com');
    expect(cell('url')).toHaveTextContent('https://example.com/ada');
    expect(cell('phone')).toHaveTextContent('+15550100');
    expect(cell('file')).toHaveTextContent('contract.pdf');
    expect(cell('lookup')).toHaveTextContent('Grace');
  });
});
