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
import {
  FormulaCellRenderer,
  FormulaField,
  SummaryField,
  TextField,
  TextCellRenderer,
  getCellRenderer,
  registerFieldRenderer,
} from '@object-ui/fields';
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

async function renderBody(
  record: Record<string, unknown>,
  schema: typeof caseSchema = caseSchema,
  bodyFields: string[] = BODY_FIELDS,
) {
  const ds = { getObjectSchema: vi.fn(async () => schema) };
  render(
    <RecordContextProvider
      objectName={schema.name}
      recordId="C2"
      data={{ id: 'C2', case_number: 'CASE-00002', ...record }}
      objectSchema={schema}
      dataSource={ds as never}
    >
      <RecordDetailsRenderer schema={{ fields: bodyFields } as never} />
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

/**
 * objectstack#34148 — a text-returning formula wraps in `record:details` read
 * mode too.
 *
 * A downstream CRM read a margin-precheck explanation (a text formula of about
 * 120 characters) cut to one line with an ellipsis, the whole sentence only in
 * a hover `title`. `formula` maps to `FormulaCellRenderer`, whose text face is
 * the grid's one-line `TextCellRenderer`. The row now reads it through
 * `FormulaField`, the face the record form draws.
 * The change is a renderer choice and a class list, so a viewport-sized
 * happy-dom render covers 1440 px and phone width alike: no layout engine
 * runs, and none is needed to read which element draws the value.
 *
 * Controls: the grid keeps the one-line formula cell; a number formula keeps
 * its number text; a host's own `formula` face is kept on the record page.
 */
const EXPLANATION = (
  'Lowest landed cost of cost week 2026-W46: 6520 (Shanxi plant: 6260 + 260); quoted 7123.89; margin 8.48% >= tier A 4%, passes.'
).slice(0, 120);

const quoteLineSchema = {
  name: 'quote_line',
  label: 'Quote line',
  nameField: 'case_number',
  fields: {
    case_number: { type: 'text', label: 'Line' },
    explanation: { type: 'formula', label: 'Precheck Explanation', returnType: 'text', expression: 'record.case_number' },
    undeclared: { type: 'formula', label: 'Undeclared Formula', expression: 'record.case_number' },
    margin: { type: 'formula', label: 'Margin', returnType: 'number', scale: 2, expression: '1' },
  },
} as unknown as typeof caseSchema;
const QUOTE_LINE_FIELDS = ['explanation', 'undeclared', 'margin'];
const QUOTE_LINE = { explanation: EXPLANATION, undeclared: EXPLANATION, margin: 1234.5 };

const formulaReadDisplay = (name: string, value: unknown, extra: Record<string, unknown>) =>
  markupOf(<FormulaField field={{ name, type: 'formula', label: name, ...extra } as never} value={value} onChange={() => {}} readonly />);

for (const [layout, width] of [['desktop 1440', 1440], ['phone', MOBILE_WIDTH]] as const) {
  describe(`objectstack#34148 — record:details read mode, ${layout}: a long text formula wraps`, () => {
    const cellLayout = layout === 'phone' ? 'mobile' : 'desktop';
    beforeEach(pinViewport(width));

    it('the fixture is a 120-character value', () => {
      expect(EXPLANATION).toHaveLength(120);
    });

    for (const [label, name, extra] of [
      ['Precheck Explanation', 'explanation', { returnType: 'text', expression: 'record.case_number' }],
      ['Undeclared Formula', 'undeclared', { expression: 'record.case_number' }],
    ] as const) {
      it(`a formula \`${name}\` cell holds the read display FormulaField renders, and wraps`, async () => {
        await renderBody(QUOTE_LINE, quoteLineSchema, QUOTE_LINE_FIELDS);
        const cell = valueCellOf(label, cellLayout);
        expect(cell.innerHTML).toBe(formulaReadDisplay(name, EXPLANATION, extra));
        const node = drawingNodeOf(cell, EXPLANATION);
        expect(node.textContent).toBe(EXPLANATION);
        expect(oneLineClassesBetween(node, cell)).toEqual([]);
        // The whole value is the visible text, not a hover tooltip.
        expect(node).not.toHaveAttribute('title');
      });
    }
  });
}

describe('objectstack#34148 — CONTROLS', () => {
  beforeEach(pinViewport(1440));

  it('the grid keeps its one-line formula cell, titled with the whole value', () => {
    expect(getCellRenderer('formula')).toBe(FormulaCellRenderer);
    const { container } = render(
      <FormulaCellRenderer value={EXPLANATION} field={{ name: 'explanation', type: 'formula', returnType: 'text' } as never} />,
    );
    const span = container.querySelector('span');
    expect(span).toHaveClass('truncate');
    expect(span).toHaveAttribute('title', EXPLANATION);
  });

  it('a number formula keeps its number text on the record page', async () => {
    await renderBody(QUOTE_LINE, quoteLineSchema, QUOTE_LINE_FIELDS);
    expect(valueCellOf('Margin', 'desktop').textContent).toBe('1,234.50');
  });

  it("a host's own `formula` face is kept on the record page", async () => {
    const shipped = getCellRenderer('formula');
    const HostFormula = ({ value }: { value: unknown }) => <em data-host-formula>{String(value)}</em>;
    try {
      registerFieldRenderer('formula', HostFormula as never);
      await renderBody(QUOTE_LINE, quoteLineSchema, QUOTE_LINE_FIELDS);
      const cell = valueCellOf('Precheck Explanation', 'desktop');
      expect(cell.querySelector('em[data-host-formula]')?.textContent).toBe(EXPLANATION);
    } finally {
      registerFieldRenderer('formula', shipped);
    }
  });
});

/**
 * objectstack#34182 — a text-returning summary (roll-up) wraps in
 * `record:details` read mode too, the summary half of objectstack#34148.
 *
 * `summary` maps to `FormulaCellRenderer` as `formula` does, so a long text
 * roll-up read cut to one line with the whole value only in a hover `title`.
 * The row now reads it through `SummaryField`, the face the record form draws.
 *
 * Controls: the grid keeps the one-line summary cell; a number roll-up keeps
 * its number text; a host's own `summary` face is kept on the record page.
 */
const ROLLUP_TEXT = EXPLANATION;

const accountSchema = {
  name: 'account',
  label: 'Account',
  nameField: 'case_number',
  fields: {
    case_number: { type: 'text', label: 'Account' },
    latest_note: {
      type: 'summary',
      label: 'Latest Note',
      summaryOperations: { object: 'note', field: 'body', function: 'max' },
    },
    deal_total: {
      type: 'summary',
      label: 'Deal Total',
      scale: 2,
      summaryOperations: { object: 'deal', field: 'amount', function: 'sum' },
    },
  },
} as unknown as typeof caseSchema;
const ACCOUNT_FIELDS = ['latest_note', 'deal_total'];
const ACCOUNT = { latest_note: ROLLUP_TEXT, deal_total: 1234.5 };

const summaryReadDisplay = (name: string, value: unknown) =>
  markupOf(
    <SummaryField
      field={{ ...(accountSchema.fields as Record<string, object>)[name], name } as never}
      value={value}
      onChange={() => {}}
      readonly
    />,
  );

for (const [layout, width] of [['desktop 1440', 1440], ['phone', MOBILE_WIDTH]] as const) {
  describe(`objectstack#34182 — record:details read mode, ${layout}: a long text summary wraps`, () => {
    const cellLayout = layout === 'phone' ? 'mobile' : 'desktop';
    beforeEach(pinViewport(width));

    it('a summary cell holds the read display SummaryField renders, in full, and wraps', async () => {
      await renderBody(ACCOUNT, accountSchema, ACCOUNT_FIELDS);
      const cell = valueCellOf('Latest Note', cellLayout);
      expect(cell.innerHTML).toBe(summaryReadDisplay('latest_note', ROLLUP_TEXT));
      const node = drawingNodeOf(cell, ROLLUP_TEXT);
      expect(node.textContent).toBe(ROLLUP_TEXT);
      expect(oneLineClassesBetween(node, cell)).toEqual([]);
      // The whole value is the visible text, not a hover tooltip.
      expect(node).not.toHaveAttribute('title');
    });
  });
}

describe('objectstack#34182 — CONTROLS', () => {
  beforeEach(pinViewport(1440));

  it('the grid keeps its one-line summary cell, titled with the whole value', () => {
    expect(getCellRenderer('summary')).toBe(FormulaCellRenderer);
    const { container } = render(
      <FormulaCellRenderer value={ROLLUP_TEXT} field={{ name: 'latest_note', type: 'summary' } as never} />,
    );
    const span = container.querySelector('span');
    expect(span).toHaveClass('truncate');
    expect(span).toHaveAttribute('title', ROLLUP_TEXT);
  });

  it('a number summary keeps its number text on the record page', async () => {
    await renderBody(ACCOUNT, accountSchema, ACCOUNT_FIELDS);
    expect(valueCellOf('Deal Total', 'desktop').textContent).toBe('1,234.50');
  });

  it("a host's own `summary` face is kept on the record page", async () => {
    const shipped = getCellRenderer('summary');
    const HostSummary = ({ value }: { value: unknown }) => <em data-host-summary>{String(value)}</em>;
    try {
      registerFieldRenderer('summary', HostSummary as never);
      await renderBody(ACCOUNT, accountSchema, ACCOUNT_FIELDS);
      const cell = valueCellOf('Latest Note', 'desktop');
      expect(cell.querySelector('em[data-host-summary]')?.textContent).toBe(ROLLUP_TEXT);
    } finally {
      registerFieldRenderer('summary', shipped);
    }
  });
});
