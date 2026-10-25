/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11577 — `record:details` READ mode draws a `textarea` value through
 * the fields package's own read display, `TextAreaField`'s `readonly` branch,
 * so a multi-line note keeps its line breaks on the record page.
 *
 * ## The defect
 *
 * The read row resolved `textarea` through `getCellRenderer`, whose standard
 * table maps it to `TextCellRenderer` — the GRID cell, a one-line
 * `TruncatedText` (`truncate` = `white-space: nowrap` plus an ellipsis). A
 * stored `Call back Monday.\n\nBudget approved, needs legal review.\n` read in
 * the browser as one line, breaks collapsed, while the record form's read-only
 * field and, since objectui#11562, the inline editor both kept them.
 *
 * ## What is pinned, and how
 *
 * The ruling (triage on objectui#11577) is "the read-mode half of
 * objectui#11562": read mode reaches `TextAreaField`'s read display, with no
 * second hand-written copy in `plugin-detail`. So the row's value cell is
 * compared, as markup, with what `TextAreaField` itself renders read-only for
 * the same value — the cell must hold exactly that display and nothing else.
 * A hand-written look-alike with a different class order or wrapper fails it,
 * and so does the old one-line cell.
 *
 * happy-dom applies no Tailwind, so "the breaks survive" is read the way the
 * DOM can carry it: the drawn text equals the stored value BYTE for byte, and
 * no element between it and the row carries a utility that collapses
 * whitespace. The class list is named here only for that negative check.
 *
 * Controls, per the ruling's pins:
 *  - a single-line value reads back as the same single line (green on both
 *    sides of the fix: its text is what the pin holds unchanged);
 *  - other plain-text types (`text`, `email`) still render their own cell
 *    renderer's markup, unchanged, even when handed a multi-line value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { TextAreaField, TextCellRenderer, EmailCellRenderer } from '@object-ui/fields';
import { RecordDetailsRenderer } from '../record-details';

/** A blank line inside and a trailing newline: the bytes a one-line cell drops. */
const MULTI_LINE = 'Call back Monday.\n\nBudget approved, needs legal review.\n';
/** The control: a value a one-line cell already showed whole. */
const SINGLE_LINE = 'Call back Monday.';

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;
const pinViewport = (width: number) => () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

const taskSchema = {
  name: 'task',
  label: 'Task',
  nameField: 'subject',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    notes: { type: 'textarea', label: 'Notes' },
    summary: { type: 'text', label: 'Summary' },
    contact_email: { type: 'email', label: 'Contact Email' },
  },
};
const BODY_FIELDS = ['notes', 'summary', 'contact_email'];

/**
 * The public door's shape: the block lists BARE field names, so a row's type
 * is the one the bound object declares. `DetailView` reads that declaration
 * through the record's data source, the same way a running app does; the
 * `email` control below is what shows the declared types reached the rows.
 */
async function renderBody(record: Record<string, unknown>) {
  const ds = { getObjectSchema: vi.fn(async () => taskSchema) };
  render(
    <RecordContextProvider
      objectName="task"
      recordId="T1"
      data={{ id: 'T1', subject: 'Follow up', ...record }}
      objectSchema={taskSchema}
      dataSource={ds as never}
    >
      <RecordDetailsRenderer schema={{ fields: BODY_FIELDS } as never} />
    </RecordContextProvider>,
  );
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await ds.getObjectSchema.mock.results[0].value;
  });
}

/** What a component renders on its own, as markup — the reference a row is held to. */
function markupOf(element: React.ReactElement): string {
  const { container, unmount } = render(element);
  const html = container.innerHTML;
  unmount();
  return html;
}

const textareaReadDisplay = (value: string) =>
  markupOf(<TextAreaField field={{ name: 'notes', type: 'textarea', label: 'Notes' } as never} value={value} onChange={() => {}} readonly />);

/**
 * The element that holds a row's drawn value: on desktop the value cell is the
 * first child of the box after the label; on mobile it is the span after the
 * label. Found from the label the row prints, so a row that is missing fails
 * loudly here rather than as a mismatch further down.
 */
function valueCellOf(label: string, layout: 'desktop' | 'mobile'): HTMLElement {
  const labelEl = screen.getByText(label);
  const box = labelEl.nextElementSibling as HTMLElement | null;
  expect(box).not.toBeNull();
  if (layout === 'mobile') return box!;
  expect(box!.firstElementChild).not.toBeNull();
  return box!.firstElementChild as HTMLElement;
}

/** The innermost element whose text is exactly the value (the node that draws it). */
function drawingNodeOf(cell: HTMLElement, value: string): HTMLElement {
  const hits = [cell, ...Array.from(cell.querySelectorAll<HTMLElement>('*'))].filter(
    (el) => el.textContent === value && !Array.from(el.children).some((c) => c.textContent === value),
  );
  expect(hits).toHaveLength(1);
  return hits[0];
}

/** Utilities that set `white-space` to a value which folds line breaks into spaces. */
const COLLAPSING = ['truncate', 'whitespace-nowrap', 'whitespace-normal'];

function collapsingClassesBetween(node: HTMLElement, stop: HTMLElement): string[] {
  const found: string[] = [];
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    for (const cls of COLLAPSING) if (el.classList.contains(cls)) found.push(cls);
    if (el === stop) break;
  }
  return found;
}

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom would
  // send that to a real socket, which the repo's network-escape guard fails the
  // file for (objectui#6640). Its answer is orthogonal to the read display.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

for (const layout of ['desktop', 'mobile'] as const) {
  describe(`objectui#11577 — record:details read mode, ${layout}: a textarea reads through TextAreaField's read display`, () => {
    beforeEach(pinViewport(layout === 'desktop' ? DESKTOP_WIDTH : MOBILE_WIDTH));

    it('a multi-line value: the cell holds exactly the read display TextAreaField renders for it', async () => {
      await renderBody({ notes: MULTI_LINE });
      expect(valueCellOf('Notes', layout).innerHTML).toBe(textareaReadDisplay(MULTI_LINE));
    });

    it('a multi-line value keeps its breaks: the text is byte for byte, and nothing on the way up folds whitespace', async () => {
      await renderBody({ notes: MULTI_LINE });
      const cell = valueCellOf('Notes', layout);
      const node = drawingNodeOf(cell, MULTI_LINE);
      expect(node.textContent).toBe(MULTI_LINE);
      expect(collapsingClassesBetween(node, cell)).toEqual([]);
    });

    // Green before the fix and after it, on purpose: the move changes nothing
    // a single-line value reads as. The cell's markup does change (the read
    // display, not the grid's one-line cell); the text the row draws does not.
    it('CONTROL — a single-line value reads back as the same single line', async () => {
      await renderBody({ notes: SINGLE_LINE });
      const cell = valueCellOf('Notes', layout);
      expect(drawingNodeOf(cell, SINGLE_LINE).textContent).toBe(SINGLE_LINE);
      expect(cell.textContent).toBe(SINGLE_LINE);
    });
  });
}

describe('objectui#11577 — CONTROL: other plain-text types render their own cell, unchanged', () => {
  beforeEach(pinViewport(DESKTOP_WIDTH));

  it('`text` keeps TextCellRenderer, even for a multi-line value', async () => {
    await renderBody({ summary: MULTI_LINE });
    expect(valueCellOf('Summary', 'desktop').innerHTML).toBe(
      markupOf(<TextCellRenderer value={MULTI_LINE} field={{ name: 'summary', type: 'text' } as never} />),
    );
  });

  it('`email` keeps EmailCellRenderer', async () => {
    await renderBody({ contact_email: 'ada@example.com' });
    expect(valueCellOf('Contact Email', 'desktop').innerHTML).toBe(
      markupOf(<EmailCellRenderer value="ada@example.com" field={{ name: 'contact_email', type: 'email' } as never} />),
    );
  });
});
