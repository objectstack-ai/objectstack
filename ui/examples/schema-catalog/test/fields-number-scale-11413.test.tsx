/**
 * The number catalog example and the number docs page teach `scale` for the
 * decimal width — objectui#11413, the number twin of objectui#11255 (percent).
 *
 * Every number face reads its decimal places from `scale`: the `NumberField`
 * edit widget derives its input `step` from it, and `NumberCellRenderer` reads
 * it through `resolveFieldScale` in `@objectstack/spec/data`. Neither reads
 * `precision`, which the spec declares as the TOTAL digit count of the stored
 * decimal. The page's "With Precision" example declared `precision: 2`, so an
 * author or an AI copying it got an input that steps by `any` (the same as
 * declaring nothing) and a cell that shows the value's natural precision,
 * while the page promised two decimals. The entry now declares `scale: 2` and
 * was renamed `fields-number/with-decimal-places` with its heading.
 *
 * Driven through the real `SchemaRenderer`, the real form renderer and the
 * real `@object-ui/fields` registration: the defect was in what the copied
 * example RENDERS, so the assertion is on the rendered widget. Each reading is
 * paired with the old `precision` spelling of the same entry: without that
 * control, a face that ignored both keys, or read either one, would pass here
 * too.
 *
 * The cell block backs the two widths `content/docs/fields/number.mdx` states
 * in its Cell Renderer comment for a stored `1234.5`, so a change in that face
 * turns this red rather than leaving the page quietly wrong.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`, so paying the import here
 * keeps the lazy factories out of every test timeout budget.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { NumberCellRenderer } from '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

const ID = 'fields-number/with-decimal-places';

interface FieldEntry {
  name: string;
  type: string;
  scale?: number;
  precision?: number;
}
interface FormNode {
  type: 'form';
  fields: FieldEntry[];
  [key: string]: unknown;
}

function example(): FormNode {
  const found = allExamples().find((e) => e.id === ID);
  expect(found, `${ID} is missing from the catalog`).toBeTruthy();
  // A deep copy: the control cases below edit their own schema.
  return JSON.parse(JSON.stringify(found!.schema)) as FormNode;
}

/** The same entry spelled the way it used to be: its `scale` moved to `precision`. */
function asPrecision(schema: FormNode): FormNode {
  const field = schema.fields[0];
  field.precision = field.scale;
  delete field.scale;
  return schema;
}

async function numberInput(schema: FormNode): Promise<HTMLInputElement> {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  const selector = `[data-field="${schema.fields[0].name}"] input[type="number"]`;
  // `waitFor`: the widget is a `React.lazy` boundary, so the FormItem's input
  // is absent until the chunk resolves.
  await waitFor(() => expect(container.querySelector(selector)).toBeTruthy());
  return container.querySelector(selector) as HTMLInputElement;
}

function cellText(field: FieldEntry): string {
  const { container } = render(<NumberCellRenderer value={1234.5 as never} field={field as never} />);
  return container.textContent ?? '';
}

describe('the number catalog example declares its width as `scale` (objectui#11413)', () => {
  it('fields-number/with-decimal-places steps by the 0.01 its two decimal places promise', async () => {
    const schema = example();
    expect(schema.fields[0].scale).toBe(2);

    const input = await numberInput(schema);
    expect(input.getAttribute('step')).toBe('0.01');

    // The old spelling: `precision: 2` sets no width, so the input steps by `any`.
    const control = await numberInput(asPrecision(example()));
    expect(control.getAttribute('step')).toBe('any');
  });

  it('its field shows a stored 1234.5 as 1,234.50 in a table cell, and 1,234.5 with no scale', () => {
    expect(cellText(example().fields[0])).toBe('1,234.50');
    // The old spelling is a field with no `scale`: the value's natural precision.
    expect(cellText(asPrecision(example()).fields[0])).toBe('1,234.5');
  });
});
