/**
 * The percent catalog examples and the percent docs page teach `scale` for the
 * decimal width — objectui#11255.
 *
 * Every percent face reads its decimal places from `scale` through
 * `resolveFieldScale` in `@objectstack/spec/data`, and none reads `precision`,
 * which the spec declares as the TOTAL digit count of the stored decimal. The
 * catalog's "With Precision" example declared `precision: 1` and
 * `required-percent` declared `precision: 2`, so an author or an AI copying
 * them got the protocol's default width (whole percents) while the page
 * promised decimals. Both entries now declare `scale`; the first was renamed
 * `fields-percent/with-decimal-places` with its heading.
 *
 * Driven through the real `SchemaRenderer`, the real form renderer and the
 * real `@object-ui/fields` registration: the defect was in what the copied
 * example RENDERS, so the assertion is on the rendered widget. The width
 * shows on the edit face as the input's `step` (the value itself is shown
 * unformatted while editing). Each width reading is paired with the old
 * `precision` spelling of the same entry, which must step by whole percents:
 * without that control, a step that ignored both keys would pass here too.
 *
 * The last block backs the two widths `content/docs/fields/percent.mdx`
 * states for a stored `0.855` (its read-only display and its Cell Renderer
 * comment), so a change in either face turns this red rather than leaving the
 * page quietly wrong.
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
import { PercentCellRenderer } from '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

interface FieldEntry {
  name: string;
  type: string;
  scale?: number;
  precision?: number;
  readonly?: boolean;
}
interface FormNode {
  type: 'form';
  fields: FieldEntry[];
  defaultValues?: Record<string, unknown>;
  [key: string]: unknown;
}

function example(id: string): FormNode {
  const found = allExamples().find((e) => e.id === id);
  expect(found, `${id} is missing from the catalog`).toBeTruthy();
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

async function percentInput(schema: FormNode): Promise<HTMLInputElement> {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  const selector = `[data-field="${schema.fields[0].name}"] input[type="number"]`;
  // `waitFor`: the widget is a `React.lazy` boundary, so the FormItem's input
  // is absent until the chunk resolves.
  await waitFor(() => expect(container.querySelector(selector)).toBeTruthy());
  return container.querySelector(selector) as HTMLInputElement;
}

describe('the percent catalog examples declare their width as `scale` (objectui#11255)', () => {
  it('fields-percent/with-decimal-places steps by the one decimal place it declares', async () => {
    const schema = example('fields-percent/with-decimal-places');
    expect(schema.fields[0].scale).toBe(1);

    const input = await percentInput(schema);
    expect(input.getAttribute('step')).toBe('0.1');
    // The seeded 0.753 is shown as 75.3, which a 0.1 step admits.
    expect(input.value).toBe('75.3');

    const control = await percentInput(asPrecision(example('fields-percent/with-decimal-places')));
    expect(control.getAttribute('step')).toBe('1');
  });

  it('fields-percent/required-percent steps by the two decimal places it declares', async () => {
    const schema = example('fields-percent/required-percent');
    expect(schema.fields[0].scale).toBe(2);

    const input = await percentInput(schema);
    expect(input.getAttribute('step')).toBe('0.01');

    const control = await percentInput(asPrecision(example('fields-percent/required-percent')));
    expect(control.getAttribute('step')).toBe('1');
  });
});

describe('the widths content/docs/fields/percent.mdx states for a stored 0.855 (objectui#11255)', () => {
  function readOnlyForm(field: Partial<FieldEntry>): FormNode {
    return {
      type: 'form',
      showSubmit: false,
      showCancel: false,
      defaultValues: { discount_rate: 0.855 },
      fields: [{ name: 'discount_rate', type: 'percent', readonly: true, ...field }],
    };
  }

  async function readOnlyText(schema: FormNode): Promise<string> {
    const { container } = render(<SchemaRenderer schema={schema as never} />);
    const item = () => container.querySelector('[data-field="discount_rate"]');
    await waitFor(() => expect(item()?.textContent ?? '').toMatch(/%/));
    return item()!.textContent ?? '';
  }

  it('the read-only display shows 85.50% with scale: 2 and 86% with no scale', async () => {
    expect(await readOnlyText(readOnlyForm({ scale: 2 }))).toContain('85.50%');
    expect(await readOnlyText(readOnlyForm({}))).toContain('86%');
  });

  it('the table cell shows 85.50% with scale: 2 and 86% with no scale', () => {
    const scaled = render(
      <PercentCellRenderer value={0.855 as never} field={{ type: 'percent', scale: 2 } as never} />,
    );
    expect(scaled.container.textContent).toBe('85.50%');
    const bare = render(<PercentCellRenderer value={0.855 as never} field={{ type: 'percent' } as never} />);
    expect(bare.container.textContent).toBe('86%');
  });
});
