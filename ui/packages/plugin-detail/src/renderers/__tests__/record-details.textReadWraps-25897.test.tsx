/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25897 — `record:details` READ mode wraps a plain `text` value
 * instead of cutting it to one line.
 *
 * ## The defect
 *
 * A HotCRM case read its subject as "Data export timing out for large…" in a
 * two-column section with room to its right. The row resolved `text` through
 * `getCellRenderer`, whose table maps it to `TextCellRenderer` — the GRID's
 * one-line cell, `TruncatedText` (`truncate`: no wrap, an ellipsis). The ruling
 * (triage on the card): "Read mode wraps text-like values; truncation only
 * where a layout declares it, with the full value reachable."
 *
 * ## What is pinned, and how
 *
 * The row now draws every value the table sends to the text cell through
 * `TextField`'s own read display, the move objectui#11577 made for `textarea`.
 * The value cell is compared, as markup, with what `TextField` renders
 * read-only for the same value, and no element between the drawn text and the
 * row may carry a utility that stops it wrapping. happy-dom applies no
 * Tailwind, so the class list is named here only for that negative check.
 *
 * Controls:
 *  - the GRID keeps its one-line cell: `getCellRenderer('text')` is still
 *    `TextCellRenderer`, which still truncates with the whole value as its
 *    `title` (truncation where the layout declares it);
 *  - a host that registered its own `text` face keeps it on the record page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { TextField, TextCellRenderer, getCellRenderer, registerFieldRenderer } from '@object-ui/fields';
import { RecordDetailsRenderer } from '../record-details';

/** The case subject the browser pass read cut. */
const SUBJECT = 'Data export timing out for large datasets';

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;
const pinViewport = (width: number) => () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

const caseSchema = {
  name: 'support_case',
  label: 'Case',
  nameField: 'case_number',
  fields: {
    case_number: { type: 'text', label: 'Case Number' },
    subject: { type: 'text', label: 'Subject' },
    reference: { type: 'auto_number', label: 'Reference' },
  },
};
const BODY_FIELDS = ['subject', 'reference'];

async function renderBody(record: Record<string, unknown>) {
  const ds = { getObjectSchema: vi.fn(async () => caseSchema) };
  render(
    <RecordContextProvider
      objectName="support_case"
      recordId="C2"
      data={{ id: 'C2', case_number: 'CASE-00002', ...record }}
      objectSchema={caseSchema}
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

function markupOf(element: React.ReactElement): string {
  const { container, unmount } = render(element);
  const html = container.innerHTML;
  unmount();
  return html;
}

const textReadDisplay = (name: string, type: string, value: string) =>
  markupOf(<TextField field={{ name, type, label: name } as never} value={value} onChange={() => {}} readonly />);

/** The element holding a row's drawn value, found from the label the row prints. */
function valueCellOf(label: string, layout: 'desktop' | 'mobile'): HTMLElement {
  const box = screen.getByText(label).nextElementSibling as HTMLElement | null;
  expect(box).not.toBeNull();
  if (layout === 'mobile') return box!;
  expect(box!.firstElementChild).not.toBeNull();
  return box!.firstElementChild as HTMLElement;
}

/** The innermost element whose text is exactly the value. */
function drawingNodeOf(cell: HTMLElement, value: string): HTMLElement {
  const hits = [cell, ...Array.from(cell.querySelectorAll<HTMLElement>('*'))].filter(
    (el) => el.textContent === value && !Array.from(el.children).some((c) => c.textContent === value),
  );
  expect(hits).toHaveLength(1);
  return hits[0];
}

/** Utilities that keep a value on one line. */
const ONE_LINE = ['truncate', 'whitespace-nowrap', 'text-ellipsis', 'line-clamp-1'];

function oneLineClassesBetween(node: HTMLElement, stop: HTMLElement): string[] {
  const found: string[] = [];
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    for (const cls of ONE_LINE) if (el.classList.contains(cls)) found.push(cls);
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
  describe(`objectstack#25897 — record:details read mode, ${layout}: a text value wraps`, () => {
    beforeEach(pinViewport(layout === 'desktop' ? DESKTOP_WIDTH : MOBILE_WIDTH));

    it('a `text` cell holds exactly the read display TextField renders for it', async () => {
      await renderBody({ subject: SUBJECT });
      expect(valueCellOf('Subject', layout).innerHTML).toBe(textReadDisplay('subject', 'text', SUBJECT));
    });

    it('nothing between the drawn subject and the row keeps it on one line', async () => {
      await renderBody({ subject: SUBJECT });
      const cell = valueCellOf('Subject', layout);
      const node = drawingNodeOf(cell, SUBJECT);
      expect(node.textContent).toBe(SUBJECT);
      expect(oneLineClassesBetween(node, cell)).toEqual([]);
    });
  });
}

describe('objectstack#25897 — every type the table sends to the text cell reads the same way', () => {
  beforeEach(pinViewport(DESKTOP_WIDTH));

  it('an `auto_number` value reads through TextField too', async () => {
    await renderBody({ subject: SUBJECT, reference: 'REF-000123' });
    const cell = valueCellOf('Reference', 'desktop');
    expect(cell.innerHTML).toBe(textReadDisplay('reference', 'auto_number', 'REF-000123'));
    expect(oneLineClassesBetween(drawingNodeOf(cell, 'REF-000123'), cell)).toEqual([]);
  });
});

describe('objectstack#25897 — CONTROLS', () => {
  beforeEach(pinViewport(DESKTOP_WIDTH));

  it('the grid keeps its one-line text cell, titled with the whole value', () => {
    expect(getCellRenderer('text')).toBe(TextCellRenderer);
    const { container } = render(
      <TextCellRenderer value={SUBJECT} field={{ name: 'subject', type: 'text' } as never} />,
    );
    const span = container.querySelector('span');
    expect(span).toHaveClass('truncate');
    expect(span).toHaveAttribute('title', SUBJECT);
  });

  it("a host's own `text` face is kept on the record page", async () => {
    const shipped = getCellRenderer('text');
    const HostText = ({ value }: { value: unknown }) => <em data-host-text>{String(value)}</em>;
    try {
      registerFieldRenderer('text', HostText as never);
      await renderBody({ subject: SUBJECT });
      const cell = valueCellOf('Subject', 'desktop');
      expect(cell.querySelector('em[data-host-text]')?.textContent).toBe(SUBJECT);
    } finally {
      registerFieldRenderer('text', shipped);
    }
  });
});
