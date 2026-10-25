/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE stored value, ONE (empty) declaration, ONE width — on every percent
 * face (objectui#9843).
 *
 * ## The defect
 *
 * `FieldSchema.scale` is optional, and each percent face used to decide for
 * itself what an ABSENT `scale` meant: the list cell, the detail summary chip
 * and this package's footer each spelled `?? 0`, the edit widget `: 2`. So one
 * stored `0.25` on a field declaring nothing read `25%` in the list and
 * `25.00%` in the widget.
 *
 * Ruling A′ (recorded on objectui#9843) put the answer in the protocol:
 * `@objectstack/spec` declares the absent width per field type, and every
 * consumer reads it through `resolveFieldScale`, with ⛔ no `?? N` of its own.
 *
 * ## Why this file lives in plugin-grid
 *
 * It is the one package whose tests reach all five faces: the cell and the
 * widget are `@object-ui/fields`, the chip is `@object-ui/plugin-detail`, the
 * footer is here, and this package depends on both. A parity pin split across
 * three packages could not fail for the reason this card exists — ONE face
 * drifting from the others.
 *
 * ## The five faces
 *
 *  1. the list cell (`PercentCellRenderer`);
 *  2. the record header's summary chip (`DetailView` `summaryFields`);
 *  3. this package's column-summary footer (`useColumnSummary`, `sum` over a
 *     single row, so the aggregate IS the stored value);
 *  4. the edit widget's READONLY face (`PercentField readonly`);
 *  5. the edit widget's EDITABLE face. It renders no formatted text, so its
 *     width is read off what it offers: the input's `step` and one slider
 *     increment.
 *
 * ## Why two kinds of assertion
 *
 * Every face is compared against the SAME expected bytes, and those bytes are
 * derived in the same run from `resolveFieldScale` and `formatPercent` (the
 * cell's own formatter) — the row states "the protocol's width" rather than a
 * number copied out of it (AGENTS.md #9). The literal `25%` / `25.00%` rows are
 * there because a comparison-only pin is blind to a JOINT move: five faces
 * drifting together to one new private default would still agree.
 *
 * The declared `scale: 2` row is the control: it moved on no face, and a repair
 * that broke it would have reached past the absent case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, renderHook, cleanup, fireEvent, screen } from '@testing-library/react';
import { resolveFieldScale } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { PercentCellRenderer, PercentField, formatPercent } from '@object-ui/fields';
import { DetailView } from '@object-ui/plugin-detail';
import type { DetailViewSchema, FieldMetadata, ListColumn } from '@object-ui/types';
import { useColumnSummary } from '../useColumnSummary';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; under happy-dom that is a real request.
 * Served from a double so no case here depends on the network (the harness
 * `summaryChip.percentConvention-9167.test.tsx` established for the chip).
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The one stored value every row is about. */
const STORED = 0.25;
/** The English footer prefix, measured below rather than assumed. */
const PREFIX = 'Sum: ';

/**
 * No `max`, so the edit widget is on its FRACTION convention — the same
 * scaling `percentDisplayValue` applies on the read faces — and the width is
 * the only thing that can differ between them.
 */
const field = (declared: Record<string, unknown>): FieldMetadata =>
  ({ name: 'rate', label: 'Rate', type: 'percent', ...declared }) as unknown as FieldMetadata;

function session(node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en' }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Face 1 — the list cell. */
function cellText(declared: Record<string, unknown>): string {
  const { container } = render(
    session(<PercentCellRenderer value={STORED} field={field(declared)} />),
  );
  const value = container.querySelector<HTMLElement>('span.tabular-nums');
  expect(value, 'the cell states its own percentage').not.toBeNull();
  const text = collapse(value!.textContent ?? '');
  cleanup();
  return text;
}

/** Face 2 — the summary chip beside the record H1. */
function chipText(declared: Record<string, unknown>): string {
  const f = field(declared);
  const { container } = render(
    session(
      <DetailView
        schema={
          {
            type: 'record:details',
            objectName: 'account',
            summaryFields: [f.name],
            fields: [{ ...f }],
            data: { id: 'A9', name: 'Acme', [f.name]: STORED },
          } as unknown as DetailViewSchema
        }
      />,
    ),
  );
  const chip = container.querySelector<HTMLElement>(`[data-summary-chip="${f.name}"]`);
  expect(chip, 'a summary chip is beside the H1').not.toBeNull();
  // The percent chip's text is its value alone: the field name reaches the
  // reader through `aria-label`, and the bar beside the value is empty.
  const text = collapse(chip!.textContent ?? '');
  cleanup();
  return text;
}

/**
 * Face 3 — the column-summary footer. The field definition goes in as
 * `fieldMetadata`, as the other faces are handed it: objectui#11588 retired
 * the footer's column-level read of `scale`, so a def spread onto the column
 * would not reach it.
 */
function footerText(declared: Record<string, unknown>): string {
  const cols = [{ field: 'rate', summary: 'sum' }] as unknown as ListColumn[];
  const meta = { rate: field(declared) };
  const { result } = renderHook(() => useColumnSummary(cols, [{ rate: STORED }], meta as never), {
    wrapper: ({ children }: { children: React.ReactNode }) => session(children),
  });
  const label = result.current.summaries.get('rate')?.label ?? '';
  expect(label.startsWith(PREFIX), `the footer label "${label}" carries the Sum prefix`).toBe(true);
  cleanup();
  return collapse(label.slice(PREFIX.length));
}

/** Face 4 — the edit widget's readonly face. */
function widgetReadonlyText(declared: Record<string, unknown>): string {
  const { container } = render(
    session(<PercentField value={STORED} onChange={() => {}} field={field(declared)} readonly />),
  );
  const text = collapse(container.textContent ?? '');
  cleanup();
  return text;
}

/** Face 5 — the edit widget's editable face: what it steps by. */
function widgetEditable(declared: Record<string, unknown>): { step: string | null; nudged: number } {
  const onChange = vi.fn();
  render(session(<PercentField value={STORED} onChange={onChange} field={field(declared)} />));
  const step = screen.getByRole('spinbutton').getAttribute('step');
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
  expect(onChange, 'one slider increment emits exactly once').toHaveBeenCalledTimes(1);
  const nudged = onChange.mock.calls[0][0] as number;
  cleanup();
  return { step, nudged };
}

/** The four faces that render text, read in one run. */
function readFaces(declared: Record<string, unknown>) {
  return {
    cell: cellText(declared),
    chip: chipText(declared),
    footer: footerText(declared),
    widgetReadonly: widgetReadonlyText(declared),
  };
}

describe('every percent face reads its width through resolveFieldScale (objectui#9843)', () => {
  it('the footer prefix this file strips is the one the bundle produces', () => {
    const { result } = renderHook(
      () => useColumnSummary([{ field: 'n', summary: 'sum' }] as unknown as ListColumn[], [{ n: 1 }]),
      { wrapper: ({ children }: { children: React.ReactNode }) => session(children) },
    );
    expect(result.current.summaries.get('n')?.label).toBe(`${PREFIX}1`);
  });

  it('an undeclared percent reads the protocol’s width on all five faces', () => {
    const width = resolveFieldScale({ type: 'percent' });
    expect(typeof width, 'the protocol answers a width for an undeclared percent').toBe('number');
    // The faces' field declares no `max`, so it stores a fraction (objectui#11475).
    const expected = collapse(formatPercent(STORED, 'fraction', width, 'en'));

    const faces = readFaces({});
    expect(faces).toEqual({ cell: expected, chip: expected, footer: expected, widgetReadonly: expected });

    const editable = widgetEditable({});
    expect(editable.step).toBe((10 ** -width!).toFixed(width!));
    expect(editable.nudged).toBeCloseTo(STORED + 10 ** -width! / 100, 10);
  });

  it('…and those bytes are `25%`, never the widget’s old `25.00%`', () => {
    // The absolute row a comparison-only pin cannot provide.
    const faces = readFaces({});
    for (const [face, text] of Object.entries(faces)) {
      expect(text, `face "${face}"`).toBe('25%');
      expect(text, `face "${face}"`).not.toBe('25.00%');
    }
    const editable = widgetEditable({});
    expect(editable.step).toBe('1');
    expect(editable.step).not.toBe('0.01');
  });

  it('control: a declared `scale: 2` reads `25.00%` on all five faces', () => {
    const declared = { scale: 2 };
    expect(resolveFieldScale({ type: 'percent', ...declared })).toBe(2);

    const faces = readFaces(declared);
    for (const [face, text] of Object.entries(faces)) {
      expect(text, `face "${face}"`).toBe('25.00%');
    }
    const editable = widgetEditable(declared);
    expect(editable.step).toBe('0.01');
    expect(editable.nudged).toBeCloseTo(0.2501, 10);
  });

  it('a malformed `scale` is no declaration on any face', () => {
    // `scale: "2"` from stored JSON never passed `FieldSchema`. The resolver's
    // door refuses it, so every face takes the absent width — the cell no
    // longer pads to the string's value while the widget ignores it.
    const faces = readFaces({ scale: '2' });
    for (const [face, text] of Object.entries(faces)) {
      expect(text, `face "${face}"`).toBe('25%');
    }
  });
});
