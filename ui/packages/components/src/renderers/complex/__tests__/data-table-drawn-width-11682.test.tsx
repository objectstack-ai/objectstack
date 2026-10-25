/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11682 — an auto-sized column is sized from what its cells DRAW,
 * and a sticky column never covers a cell's content.
 *
 * The estimate used to read the STORED value: `String(row[key]).length`, at
 * 8px a character plus 48px. On the showcase at a 1440px viewport that was
 * wrong both ways. Budget stores `200000` (6 characters, 96px) and draws
 * `200,000.00`, which truncated. Tasks' Assignee drew 171px of text in a
 * 240px column, and the columns' sum came to 1230px in a 1184px content box,
 * so the scrolling region passed 46px under the right-pinned Actions column,
 * and the right-aligned Progress percentage with it.
 *
 * ## Which pins are arithmetic and which replay geometry
 *
 * happy-dom lays nothing out: every `getBoundingClientRect()` is 0x0. So:
 *
 *  - ARITHMETIC — the first block runs on that, as every page with no layout
 *    does: the drawn TEXT is read back and its length is the estimate's input.
 *  - REPLAYED GEOMETRY — the second block gives the table a fake layout that
 *    answers ONLY the probe (an element at `width: max-content`) and answers
 *    it with the natural widths measured in Chromium on the showcase's Projects
 *    and Tasks lists at a 1440px viewport (the `MEASURED` table below, one
 *    reading, ⛔ not re-derived here). A table that never probes reads 0 and
 *    falls back to the text path, so these pins fail if the probe is gone.
 *    The cells' insets (cell width less content box) are replayed from the
 *    same reading. What these pins assert is the arithmetic of it: the Budget
 *    column is given at least what its widest amount needs, and the Tasks
 *    columns fit the measured 1184px content box beside the measured fixed
 *    columns, each one whole, so no scrolling column passes under the pinned
 *    Actions column. The live readings themselves are the PR's.
 *  - The stacked-pin block mocks the header cells' widths, the way
 *    `data-table-sticky-offsets.test.tsx` does for the left pins.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }> | undefined;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered`).toBeTruthy();
  return th as HTMLElement;
};
const px = (value: string) => parseFloat(value);

/** The body cells of the column headed `label`, in row order. */
function bodyCells(label: string): HTMLElement[] {
  const ths = Array.from(document.querySelectorAll('thead tr th'));
  const index = ths.findIndex((th) => th.textContent?.trim() === label);
  if (index < 0) throw new Error(`no header "${label}"`);
  return Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.children[index] as HTMLElement);
}

const AMOUNT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('data-table sizes a column from the text its cells draw, where nothing is laid out (objectui#11682)', () => {
  it('a currency cell is sized from "200,000.00", not from the stored 200000', () => {
    const schema = (cell?: (v: number) => string) => ({
      type: 'data-table',
      data: [{ id: '1', budget: 200000 }],
      columns: [{ header: 'Budget', accessorKey: 'budget', ...(cell ? { cell } : {}) }],
      pagination: false,
      searchable: false,
    });
    render(<DataTable schema={schema((v) => AMOUNT.format(v))} />);
    // 10 drawn characters: 10 * 8 + 48.
    expect(header('Budget').style.width).toBe('128px');
    expect(bodyCells('Budget')[0].style.maxWidth, 'the cell is clamped to the same width').toBe('128px');
    cleanup();
    // CONTROL: the same column drawing its stored value is sized from it.
    render(<DataTable schema={schema()} />);
    expect(header('Budget').style.width).toBe('96px');
  });

  it('a lookup cell is sized from the name it draws, not the id it stores', () => {
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [{ id: '1', project: '6650f2a9c41e7b3d' }],
          columns: [{ header: 'Project', accessorKey: 'project', cell: () => 'Mobile App' }],
          pagination: false,
          searchable: false,
        }}
      />,
    );
    // 'Mobile App' is 10 characters (128px); the 16-character id was 176px.
    expect(header('Project').style.width).toBe('128px');
  });

  it('re-sizes when a cell draws its text after the table rendered (a lookup resolving its name)', async () => {
    const Resolving = () => {
      const [name, setName] = React.useState('');
      React.useEffect(() => {
        const t = setTimeout(() => setName('Website Relaunch Programme'), 0);
        return () => clearTimeout(t);
      }, []);
      return <span>{name}</span>;
    };
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [{ id: '1', project: 'p1' }],
          columns: [{ header: 'Project', accessorKey: 'project', cell: () => <Resolving /> }],
          pagination: false,
          searchable: false,
        }}
      />,
    );
    // 26 characters once resolved: 26 * 8 + 48. The table itself does not
    // re-render when the cell does; the body observer is what re-reads it.
    await waitFor(() => expect(header('Project').style.width).toBe('256px'));
  });
});

/**
 * Natural (`max-content`) widths read in Chromium on the showcase lists at a
 * 1440px viewport, console dev server against the showcase backend, keyed by
 * column and drawn text. Headers are keyed by their label. One reading, kept
 * as a fixture; the PR records how it was taken.
 */
const MEASURED: Record<string, Record<string, number>> = {
  budget: { Budget: 58.03, '150,000.00': 72.61, '50,000.00': 64.38, '200,000.00': 72.61, '600,000.00': 72.61, '90,000.00': 64.38 },
  title: {
    Title: 42.16, 'App wireframes': 96.23, 'Build homepage': 98.05, 'PII access review': 104.52, 'Content backlog': 99.72,
    'Audit current IA': 94.83, 'Design system': 89.31, 'Ingest pipeline': 88.3, 'Evidence collection': 117.77,
    'SEO migration plan': 115.09, 'Warehouse schema': 119.83,
  },
  project: { Project: 39.22, 'Mobile App': 68.17, 'Website Relaunch': 106.94, 'Compliance Audit': 105.78, 'Data Platform': 81.08 },
  assignee: { Assignee: 69.77, 'auditor.demo@example.com': 171.02, 'admin@objectos.ai': 113.94, 'phone.demo@example.com': 167.97 },
  status: { Status: 53.42, Done: 51.72, 'In Progress': 85.59, 'To Do': 54.42, Backlog: 67.36, 'In Review': 75.83 },
  priority: { Priority: 58.41, Medium: 67.89, High: 48.25, Urgent: 60.47, Low: 45.47 },
  due_date: {
    'Due Date': 69.22, 'Overdue 6d': 70.61, 'Oct 16': 40.92, 'Oct 18': 40.92, 'Nov 5': 35.69, 'Sep 18': 43.19,
    'In 2 days': 54.25, 'Oct 26': 40.92, 'Oct 31': 40.92, 'Oct 21': 40.92, 'In 3 days': 54.25,
  },
  // The progress cell draws a 64px bar beside the number; both are in its width.
  progress: { Progress: 67.78, '100%': 109.36, '45%': 101.11, '0%': 92.84, '80%': 101.11, '55%': 101.11, '90%': 101.11 },
};
/** The measured content box of the list, and its fixed columns: checkbox, `#`, Actions. */
const CONTENT_BOX = 1184;
const FIXED_COLUMNS = 28 + 39.22 + 66.66;
/**
 * The space each cell keeps around its content, measured the same way (cell
 * width less content-box width). 24px is the 12px padding either side. Under
 * the table's collapsed borders the frozen first column's 2px rule is split
 * with its neighbour (25px each), and the Actions column's 1px left rule with
 * the column before it (24.5px), and no computed style of those cells says so.
 */
const INSET: Record<string, number> = { title: 25, project: 25, progress: 24.5 };
const insetOf = (key: string) => INSET[key] ?? 24;

/**
 * A fake layout for the table: a cell is as wide as its `style.width`, its
 * content box is that less the measured inset, and the probe (an
 * auto-width target at `max-content`) is as wide as `MEASURED` says.
 */
function installMeasuredLayout() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  const rect = (width: number) =>
    ({ width, height: 20, top: 0, left: 0, bottom: 20, right: width, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const own = this.getAttribute('data-auto-width-key');
    if (own !== null && this.style.width === 'max-content') {
      const text = (this.textContent ?? '').trim();
      const width = MEASURED[own]?.[text];
      if (width === undefined) throw new Error(`no measured width for ${own} / "${text}"`);
      return rect(width);
    }
    if (this.tagName === 'TD' || this.tagName === 'TH') return rect(parseFloat(this.style.width) || 0);
    // The element a cell's content box is read off: the display cell itself,
    // or the full-width row a header label sits in.
    const key = own ?? (this.parentElement?.tagName === 'TH'
      ? this.querySelector(':scope > [data-auto-width-key]')?.getAttribute('data-auto-width-key') ?? null
      : null);
    const box = this.closest('th, td') as HTMLElement | null;
    if (key !== null && box) return rect((parseFloat(box.style.width) || 0) - insetOf(key));
    return original.call(this);
  });
  return () => spy.mockRestore();
}

const STATUS: Record<string, string> = { done: 'Done', in_progress: 'In Progress', todo: 'To Do', backlog: 'Backlog', in_review: 'In Review' };
const PRIORITY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
/** The showcase's All Tasks rows: stored values, and the due-date text the cell drew that day. */
const TASKS = [
  ['App wireframes', 'Mobile App', 'auditor.demo@example.com', 'done', 'medium', 'Overdue 6d', 100],
  ['Build homepage', 'Website Relaunch', 'admin@objectos.ai', 'in_progress', 'high', 'Oct 16', 45],
  ['PII access review', 'Compliance Audit', 'phone.demo@example.com', 'todo', 'urgent', 'Oct 18', 0],
  ['Content backlog', 'Website Relaunch', 'phone.demo@example.com', 'backlog', 'low', 'Nov 5', 0],
  ['Audit current IA', 'Website Relaunch', 'auditor.demo@example.com', 'done', 'medium', 'Sep 18', 100],
  ['Design system', 'Website Relaunch', 'auditor.demo@example.com', 'in_review', 'high', 'In 2 days', 80],
  ['Ingest pipeline', 'Data Platform', 'admin@objectos.ai', 'in_progress', 'urgent', 'Oct 26', 55],
  ['Evidence collection', 'Compliance Audit', 'phone.demo@example.com', 'backlog', 'medium', 'Oct 31', 0],
  ['SEO migration plan', 'Website Relaunch', 'admin@objectos.ai', 'todo', 'medium', 'Oct 21', 0],
  ['Warehouse schema', 'Data Platform', 'admin@objectos.ai', 'in_review', 'high', 'In 3 days', 90],
].map(([title, project, assignee, status, priority, due, progress], i) => ({
  id: `t${i + 1}`,
  title,
  // A lookup arrives expanded; the cell draws its name.
  project: { id: `p-${project}`, name: project },
  assignee,
  status,
  priority,
  due_date: `2026-10-${String(10 + i).padStart(2, '0')}`,
  due_text: due,
  progress,
}));

const TASK_COLUMNS = [
  { header: 'Title', accessorKey: 'title' },
  { header: 'Project', accessorKey: 'project', cell: (v: { name: string }) => v.name },
  { header: 'Assignee', accessorKey: 'assignee' },
  { header: 'Status', accessorKey: 'status', cell: (v: string) => STATUS[v] },
  { header: 'Priority', accessorKey: 'priority', cell: (v: string) => PRIORITY[v] },
  { header: 'Due Date', accessorKey: 'due_date', cell: (_v: string, row: { due_text: string }) => row.due_text },
  { header: 'Progress', accessorKey: 'progress', align: 'right', cell: (v: number) => `${v}%` },
];

describe('data-table sizes a column from its measured drawn content, where the page is laid out (objectui#11682)', () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    uninstall = installMeasuredLayout();
  });
  afterEach(() => uninstall());

  it('Budget: the widest drawn amount renders whole in the width the column is given', () => {
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [150000, 50000, 200000, 600000, 90000].map((budget, i) => ({ id: String(i), budget })),
          columns: [{ header: 'Budget', accessorKey: 'budget', align: 'right', cell: (v: number) => AMOUNT.format(v) }],
          pagination: false,
          searchable: false,
        }}
      />,
    );
    const width = px(header('Budget').style.width);
    expect(width - insetOf('budget'), 'the content box holds the widest drawn amount').toBeGreaterThanOrEqual(72.61);
    for (const td of bodyCells('Budget')) expect(px(td.style.maxWidth)).toBe(width);
  });

  it('Progress: the Tasks list fits its 1440px content box, so no scrolling column passes under the pinned Actions column', () => {
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: TASKS,
          columns: TASK_COLUMNS,
          frozenColumns: 1,
          pagination: false,
          searchable: false,
        }}
      />,
    );
    const widths = TASK_COLUMNS.map((c) => px(header(c.header).style.width));
    const total = widths.reduce((a, b) => a + b, 0) + FIXED_COLUMNS;
    expect(total, `the columns sum to ${total}px`).toBeLessThanOrEqual(CONTENT_BOX);
    expect(px(header('Progress').style.width) - insetOf('progress'), 'the bar and the number render whole')
      .toBeGreaterThanOrEqual(109.36);
    // And no column bought that by truncating: each content box holds its
    // widest drawn cell and its label, the collapsed-border insets included.
    for (const c of TASK_COLUMNS) {
      const widest = Math.max(...Object.values(MEASURED[c.accessorKey]));
      expect(px(header(c.header).style.width) - insetOf(c.accessorKey), `${c.header} renders whole`)
        .toBeGreaterThanOrEqual(widest);
    }
  });

  it('the probe leaves no width behind on what it measured', () => {
    render(
      <DataTable schema={{ type: 'data-table', data: TASKS, columns: TASK_COLUMNS, pagination: false, searchable: false }} />,
    );
    const probed = Array.from(document.querySelectorAll<HTMLElement>('[data-auto-width-key]'));
    expect(probed.length, 'CONTROL: the header labels and cells were probed').toBe(TASK_COLUMNS.length * (TASKS.length + 1));
    for (const el of probed) expect(el.style.width).toBe('');
  });
});

describe('data-table stacks right-pinned columns instead of overlaying them (objectui#11682)', () => {
  const PINNED = 'sticky right-0 z-10 bg-background border-l border-border';
  /** Header widths the mocked layout reports: the four data columns, in order. */
  const WIDTHS = [150, 120, 110, 67];

  function renderPinned(pinnedCount: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = this.tagName === 'TH' && this.parentElement
        ? Array.prototype.indexOf.call(this.parentElement.children, this)
        : -1;
      const width = index >= 0 ? (WIDTHS[index] ?? 0) : 0;
      return { width, height: 40, top: 0, left: 0, bottom: 40, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const columns = ['Name', 'Owner', 'Due', 'Actions'].map((h, i) => ({
      header: h,
      accessorKey: h.toLowerCase(),
      ...(i >= 4 - pinnedCount ? { className: PINNED, cellClassName: PINNED } : {}),
    }));
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [{ id: '1', name: 'A', owner: 'B', due: 'C', actions: 'D' }],
          columns,
          pagination: false,
          searchable: false,
        }}
      />,
    );
  }

  it('an inner right pin sticks beside the outer one, at the outer one\'s measured width', () => {
    renderPinned(2);
    expect(header('Due').style.right, 'the inner pin clears the 67px outer pin').toBe('67px');
    expect(bodyCells('Due')[0].style.right).toBe('67px');
    expect(header('Actions').style.right, 'the outermost pin stays at right-0').toBe('');
    expect(bodyCells('Actions')[0].style.right).toBe('');
  });

  it('CONTROL: one right pin renders exactly as before', () => {
    renderPinned(1);
    expect(header('Actions').style.right).toBe('');
    expect(header('Due').style.right).toBe('');
  });
});
