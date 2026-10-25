// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6936, end to end at the site the issue measured.
 *
 * The probe in objectui PR #3923 read the Studio object field list against two
 * backends and recorded:
 *
 *   B1 objectForm fields (post-#6254 `data.` spelling)
 *      row currency → Min, Max, Precision, Scale     (correct)
 *      row text     → Max Length, Min Length         (correct)
 *   B2 objectForm fields (installed spec 17.0.0-rc.5, bare spelling)
 *      row currency → not one of the 16 conditional sub-fields renders
 *      row text     → not one of the 16 conditional sub-fields renders
 *
 * B2 is the version-skew window: the predicate says `type in ['text',…]`, this
 * engine evaluates it against `{ data: draftRow }`, the root `type` resolves to
 * nothing, `includes(undefined)` is false, and the sub-field disappears with no
 * diagnostic. This file pins B2's repaired reading (sub-fields render, console
 * says why) and B1's unchanged one (still row-type-conditional) through the real
 * `SchemaForm` record-row site, not the evaluator alone.
 *
 * The sub-field set here is the simply-typed subset of the 16 — number / text /
 * select / boolean. The remaining four (`options`, `lookupFilters`,
 * `summaryOperations`, `expression`) render repeater / JSON / code widgets whose
 * module graphs are exactly what AGENTS.md §9 warns about pulling into a DOM
 * test; the full 16-predicate table is pinned at evaluator level in
 * `predicate.test.ts` instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { resetPredicateWarnings } from './predicate';

// See the note in `predicate.test.ts`: `ReturnType<typeof vi.spyOn>` is the
// un-instantiated `MockInstance<Procedure | Constructable>`, whose `mock.calls`
// carries no argument types (objectui#4040).
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  cleanup();
});

/** Mirrors the spec `objectForm`: a name-keyed `fields` record of field defs. */
const objectishSchema = {
  type: 'object',
  properties: {
    fields: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          type: { type: 'string', title: 'Type' },
          min: { type: 'number', title: 'Min' },
          max: { type: 'number', title: 'Max' },
          precision: { type: 'number', title: 'Precision' },
          scale: { type: 'number', title: 'Scale' },
          maxLength: { type: 'number', title: 'Max Length' },
          minLength: { type: 'number', title: 'Min Length' },
          reference: { type: 'string', title: 'Reference' },
          deleteBehavior: { type: 'string', title: 'Delete Behavior' },
          multiple: { type: 'boolean', title: 'Multiple' },
          returnType: { type: 'string', title: 'Return Type' },
          autonumberFormat: { type: 'string', title: 'Autonumber Format' },
          language: { type: 'string', title: 'Language' },
        },
      },
    },
  },
};

const NUMERIC = ['Min', 'Max', 'Precision', 'Scale'];
const TEXTUAL = ['Max Length', 'Min Length'];
const LOOKUP = ['Reference', 'Delete Behavior', 'Multiple'];
const OTHER = ['Return Type', 'Autonumber Format', 'Language'];
const ALL_CONDITIONAL = [...NUMERIC, ...TEXTUAL, ...LOOKUP, ...OTHER];

/** Sub-field specs gated on the row type, in a given predicate spelling. */
const rowFields = (spell: (path: string) => string) => [
  { field: 'type' },
  { field: 'min', visibleWhen: `${spell('type')} in ['number','currency','percent']` },
  { field: 'max', visibleWhen: `${spell('type')} in ['number','currency','percent']` },
  { field: 'precision', visibleWhen: `${spell('type')} in ['number','currency','percent']` },
  { field: 'scale', visibleWhen: `${spell('type')} in ['number','currency','percent']` },
  { field: 'maxLength', visibleWhen: `${spell('type')} in ['text','textarea','email']` },
  { field: 'minLength', visibleWhen: `${spell('type')} in ['text','textarea','email']` },
  { field: 'reference', visibleWhen: `${spell('type')} in ['lookup','master_detail','tree']` },
  { field: 'deleteBehavior', visibleWhen: `${spell('type')} in ['lookup','master_detail']` },
  { field: 'multiple', visibleWhen: `${spell('type')} in ['lookup']` },
  { field: 'returnType', visibleWhen: `${spell('type')} == 'formula'` },
  { field: 'autonumberFormat', visibleWhen: `${spell('type')} == 'autonumber'` },
  { field: 'language', visibleWhen: `${spell('type')} == 'code'` },
];

const formFor = (spell: (path: string) => string) =>
  ({
    type: 'simple' as const,
    sections: [
      {
        label: 'Fields',
        fields: [
          {
            field: 'fields',
            type: 'record',
            keyField: { field: 'name', label: 'Name' },
            fields: rowFields(spell),
          },
        ],
      },
    ],
  }) as never;

const bare = (path: string) => path.replace(/^data\./, '');
const scoped = (path: string) => `data.${path.replace(/^data\./, '')}`;

const renderRow = (spell: (path: string) => string, key: string, row: Record<string, unknown>) => {
  render(
    <SchemaForm
      schema={objectishSchema}
      form={formFor(spell)}
      value={{ fields: { [key]: row } }}
      onChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByText(key));
};

const warnings = () => warn.mock.calls.map((c) => c.join(' ')).join('\n');

describe('B2 — a backend serving bare predicates no longer empties the row (objectstack#6936)', () => {
  it('a currency row shows every conditional sub-field instead of none, and says why', () => {
    renderRow(bare, 'amount', { type: 'currency', precision: 2 });
    for (const label of ALL_CONDITIONAL) {
      expect(screen.getByText(label), `${label} must not vanish silently`).toBeInTheDocument();
    }
    // Fail-open is the visible half; the console is the audible half.
    expect(warn).toHaveBeenCalled();
    expect(warnings()).toContain('`type`');
    expect(warnings()).toContain("type in ['number','currency','percent']");
  });

  it('a text row likewise — the sub-fields are shown, not silently dropped', () => {
    renderRow(bare, 'title', { type: 'text', maxLength: 80 });
    for (const label of ALL_CONDITIONAL) {
      expect(screen.getByText(label), `${label} must not vanish silently`).toBeInTheDocument();
    }
    expect(warn).toHaveBeenCalled();
  });
});

describe('B1 — the `data.`-spelled predicates stay row-type-conditional', () => {
  it('a currency row shows the numeric sub-fields and hides the rest, silently', () => {
    renderRow(scoped, 'amount', { type: 'currency', precision: 2 });
    for (const label of NUMERIC) expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of [...TEXTUAL, ...LOOKUP, ...OTHER]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('a text row shows the length sub-fields and hides the numeric ones', () => {
    renderRow(scoped, 'title', { type: 'text', maxLength: 80 });
    for (const label of TEXTUAL) expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of [...NUMERIC, ...LOOKUP, ...OTHER]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('a row whose type is not set yet keeps its conditional sub-fields hidden', () => {
    // The boundary, at the render site: an unfilled draft value is NOT an
    // unresolvable path. If fail-open widened to "any undefined value", a fresh
    // row would light up with all 13 of these at once.
    renderRow(scoped, 'untyped', {});
    for (const label of ALL_CONDITIONAL) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});
