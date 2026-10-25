/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12357 — a text-valued formula is drawn the way a text field is
 * drawn, in the table cell and in the read-only form face, whether it declares
 * `returnType: 'text'` or declares nothing.
 *
 * Both faces used to fall through to a monospace span for every result that
 * was not a number, boolean or date, so a formula yielding a person's name
 * (HotCRM's Leads Name column, `crm_lead.full_name`) read as code beside the
 * proportional text columns around it. Declaring `returnType: 'text'` changed
 * nothing, and most code-authored formulas arrive with no `returnType`, so
 * the pin covers both.
 *
 * The comparison is against the text field's own faces, rendered beside the
 * formula for the same value: the cell's markup equals `TextCellRenderer`'s,
 * and the form face's classes equal `TextField`'s read-only branch's. A
 * numeric result is the control: it still reads through the number face.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TextCellRenderer, TextField, getCellRenderer } from '../index';
import { FormulaField } from '../widgets/FormulaField';

afterEach(() => cleanup());

const noop = () => {};

type FormulaExtra = Record<string, unknown>;
const formulaField = (extra: FormulaExtra) => ({ type: 'formula', name: 'full_name', ...extra }) as never;
const textField = { type: 'text', name: 'first_name' } as never;

const Cell = getCellRenderer('formula');

const NAME = 'Ada Lovelace';

const DECLARATIONS: Array<[string, FormulaExtra]> = [
  ["declared returnType 'text'", { returnType: 'text' }],
  ['no returnType', {}],
];

function htmlOf(node: React.ReactElement): string {
  const { container } = render(node);
  const html = container.innerHTML;
  cleanup();
  return html;
}

function classesOf(node: React.ReactElement): string[] {
  const { container } = render(node);
  const el = container.firstElementChild;
  const classes = el ? Array.from(el.classList).sort() : [];
  cleanup();
  return classes;
}

describe('a text-valued formula is drawn as text, not as code (objectui#12357)', () => {
  describe.each(DECLARATIONS)('%s', (_label, extra) => {
    it('the cell draws exactly what the text cell draws for the same value', () => {
      const formula = htmlOf(<Cell value={NAME} field={formulaField(extra)} />);
      const text = htmlOf(<TextCellRenderer value={NAME} field={textField} />);
      expect(formula).toBe(text);
    });

    it("the form face carries the text field's read-only classes", () => {
      const formula = classesOf(<FormulaField value={NAME} onChange={noop} field={formulaField(extra)} readonly />);
      const text = classesOf(<TextField value={NAME} onChange={noop} field={textField} readonly />);
      expect(formula).toEqual(text);
    });

    it('neither face is drawn in monospace', () => {
      for (const node of [
        <Cell key="cell" value={NAME} field={formulaField(extra)} />,
        <FormulaField key="form" value={NAME} onChange={noop} field={formulaField(extra)} readonly />,
      ]) {
        const { container } = render(node);
        expect(container.textContent).toBe(NAME);
        expect(container.querySelector('.font-mono')).toBeNull();
        cleanup();
      }
    });
  });

  // The control: the text face did not swallow the number face.
  it.each([
    ["declared returnType 'number'", { returnType: 'number' }],
    ['no returnType, a JS number', {}],
  ] as Array<[string, FormulaExtra]>)('control — %s still reads through the number face', (_label, extra) => {
    const { container } = render(<Cell value={200000} field={formulaField(extra)} />);
    expect(container.textContent).toBe('200,000');
    expect(container.querySelector('.tabular-nums')).not.toBeNull();
    cleanup();
    const form = render(<FormulaField value={200000} onChange={noop} field={formulaField(extra)} readonly />);
    expect(form.container.textContent).toBe('200,000');
  });
});
