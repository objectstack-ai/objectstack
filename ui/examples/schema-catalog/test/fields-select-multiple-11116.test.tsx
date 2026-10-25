/**
 * The catalog's multi-select example renders a MULTI-value select and submits
 * an array — objectui#11116.
 *
 * `fields-select/multi-select` authors `"type": "select", "multiple": true` on a
 * hand-authored form. The form renderer's built-in `select` branch read
 * `multiple` nowhere, so this example — a docs demo and a few-shot retrieval
 * source — drew the same single-value combobox with and without the key, and
 * taught a capability that did not happen. The object-bound path already
 * mapped the same declaration to `field:multiselect`; the hand-authored path now
 * routes to that same widget.
 *
 * Driven through the real `SchemaRenderer`, the real form renderer and the real
 * `@object-ui/fields` registration, because the defect lived in which widget the
 * form picks — a stand-in widget cannot show that the example now reaches the
 * one the object-bound path renders. The routing mechanism itself, its label
 * association and the no-`@object-ui/fields` host are pinned beside the form
 * renderer, in `form-builtin-select-multiple-11116.test.tsx`.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`, so paying the import here
 * keeps the lazy factories out of every test timeout budget.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

interface FieldEntry {
  name: string;
  multiple?: boolean;
  options?: Array<{ value: string }>;
}
interface FormNode {
  fields: FieldEntry[];
  [key: string]: unknown;
}

function example(): FormNode {
  const found = allExamples().find((e) => e.id === 'fields-select/multi-select');
  expect(found, 'fields-select/multi-select example is missing').toBeTruthy();
  // A deep copy: each case below edits its own schema.
  return JSON.parse(JSON.stringify(found!.schema)) as FormNode;
}

async function renderItem(schema: FormNode) {
  const utils = render(<SchemaRenderer schema={schema as never} />);
  const field = schema.fields[0];
  // `waitFor`: the widget is a `React.lazy` boundary, so the FormItem's control
  // is absent until the chunk resolves.
  await waitFor(() =>
    expect(
      utils.container.querySelector(
        `[data-field="${field.name}"] [role="group"], [data-field="${field.name}"] [role="combobox"]`,
      ),
    ).toBeTruthy(),
  );
  return { ...utils, item: utils.container.querySelector(`[data-field="${field.name}"]`) as HTMLElement };
}

describe('fields-select/multi-select renders a multi-value select (objectui#11116)', () => {
  it('declares multiple: true (the key this example exists to demonstrate)', () => {
    expect(example().fields[0].multiple).toBe(true);
  });

  it('renders one toggle per option inside a labelled group, and no single-value combobox', async () => {
    const schema = example();
    const { item } = await renderItem(schema);
    expect(item.querySelector('[role="combobox"]')).toBeNull();
    const group = item.querySelector('[role="group"]')!;
    const label = item.querySelector('label')!;
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    const toggles = group.querySelectorAll('button[aria-pressed]');
    expect(toggles.length).toBe(schema.fields[0].options!.length);
  });

  it('submits the picked values as an array', async () => {
    const onSubmit = vi.fn();
    const schema = { ...example(), showSubmit: true, onSubmit };
    const { item, container } = await renderItem(schema);
    const [first, , third] = Array.from(item.querySelectorAll('button[aria-pressed]'));
    fireEvent.click(first);
    fireEvent.click(third);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = schema.fields[0].options!.map((o) => o.value);
    expect(onSubmit.mock.calls[0][0]).toEqual({ tags: [values[0], values[2]] });
  });

  it('without multiple, the same field is still the single-value select', async () => {
    const schema = example();
    delete schema.fields[0].multiple;
    const { item } = await renderItem(schema);
    expect(item.querySelector('[role="combobox"]')).not.toBeNull();
    expect(item.querySelector('button[aria-pressed]')).toBeNull();
  });
});
