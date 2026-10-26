/**
 * The catalog's multi-select example shows its authored placeholder while
 * nothing is selected, and not after a pick — objectui#11140.
 *
 * `fields-select/multi-select` authors `"placeholder"` beside
 * `"multiple": true`. Once objectui#11116 routed that field to the multi-value
 * widget, the key reached a widget that read no `placeholder`, so this example
 * (a docs demo and a few-shot retrieval source) taught a key that did nothing.
 * The widget now honours it; the widget-level cases sit beside it, in
 * `packages/fields/src/widgets/MultiSelectField.placeholder-11140.test.tsx`.
 *
 * Driven through the real `SchemaRenderer`, the real form renderer and the real
 * `@object-ui/fields` registration, because the question is whether the key
 * survives the hand-authored form path to the widget, not only whether the
 * widget can draw it.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`, so paying the import here
 * keeps the lazy factories out of every test timeout budget.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor, fireEvent, within } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

interface FieldEntry {
  name: string;
  label?: string;
  placeholder?: string;
  multiple?: boolean;
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

async function renderGroup(schema: FormNode) {
  const utils = render(<SchemaRenderer schema={schema as never} />);
  const field = schema.fields[0];
  // `waitFor`: the widget is a `React.lazy` boundary, so the FormItem's control
  // is absent until the chunk resolves.
  await waitFor(() =>
    expect(utils.container.querySelector(`[data-field="${field.name}"] [role="group"]`)).toBeTruthy(),
  );
  const item = utils.container.querySelector(`[data-field="${field.name}"]`) as HTMLElement;
  return { ...utils, item, group: item.querySelector('[role="group"]') as HTMLElement };
}

describe('fields-select/multi-select shows its placeholder while empty (objectui#11140)', () => {
  it('authors the placeholder beside multiple: true (the keys this pin reads)', () => {
    const field = example().fields[0];
    expect(field.multiple).toBe(true);
    expect(field.placeholder).toBe('Select tags...');
  });

  it('renders "Select tags..." while nothing is selected, and not after a pick', async () => {
    const schema = example();
    const { group } = await renderGroup(schema);
    expect(group.textContent).toContain('Select tags...');

    const first = group.querySelector('button[aria-pressed]') as HTMLElement;
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute('aria-pressed')).toBe('true'));
    expect(group.textContent).not.toContain('Select tags...');

    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute('aria-pressed')).toBe('false'));
    expect(group.textContent).toContain('Select tags...');
  });

  it('keeps the group labelled by the field label, not by the placeholder', async () => {
    const schema = example();
    const { item, group } = await renderGroup(schema);
    const label = item.querySelector('label')!;
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect(within(item).getByRole('group', { name: schema.fields[0].label })).toBe(group);
  });

  it('control: without a placeholder the group holds the chips and nothing else', async () => {
    const schema = example();
    delete schema.fields[0].placeholder;
    const { group } = await renderGroup(schema);
    const children = Array.from(group.children);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c) => c.tagName === 'BUTTON')).toBe(true);
    expect(group.textContent).not.toContain('Select tags...');
  });
});
