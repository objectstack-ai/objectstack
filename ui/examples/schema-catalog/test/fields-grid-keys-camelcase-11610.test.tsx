/**
 * The grid catalog example's field-level keys are camelCase, and they draw
 * through the real form path (objectui#11610).
 *
 * `fields-grid/line-items-grid` is the stored document the grid doc page shows
 * under "Field-Level Keys". objectui#11610 renamed the grid widget's eight
 * field-level keys from snake_case to camelCase and refused the old spellings
 * by name, so this fixture moved with them. This file drives it through the
 * real `SchemaRenderer`, the real `form` renderer (which hands each field
 * widget the entry itself as its metadata carrier) and the real
 * `@object-ui/fields` registration, and checks what the grid DRAWS:
 *
 *   - the document validates on the strict authoring face;
 *   - `addLabel` labels the Add button, `totalField` draws the footer total,
 *     `allowReorder` / `allowDelete` / `allowAdd` leave their controls on
 *     (each row has a drag handle, a Remove and a Duplicate), and `minRows`
 *     / `maxRows` leave them enabled at two rows;
 *   - the CONTROL: the same document with its keys respelled in snake_case is
 *     refused on the strict face by name, and the form draws the grid's named
 *     refusal instead of the grid. Without it, a renderer that ignored both
 *     spellings would pass the first two rows as well.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`, so paying the import here
 * keeps the lazy factories out of every test timeout budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { GRID_FIELD_RETIRED_KEYS } from '@object-ui/types';
import { StrictAnyComponentSchema } from '@object-ui/types/zod';
import { allExamples } from '../src/index.js';

const ID = 'fields-grid/line-items-grid';

type Entry = Record<string, unknown> & { name: string; type: string };
interface FormNode {
  type: 'form';
  fields: Entry[];
  [key: string]: unknown;
}

function example(): FormNode {
  const found = allExamples().find((e) => e.id === ID);
  expect(found, `${ID} is missing from the catalog`).toBeTruthy();
  // A deep copy: the control case edits its own schema.
  return JSON.parse(JSON.stringify(found!.schema)) as FormNode;
}

/** The same document with every camelCase grid key respelled the way it was before objectui#11610. */
function asSnakeCase(schema: FormNode): FormNode {
  const entry = schema.fields[0];
  for (const [snake, camel] of Object.entries(GRID_FIELD_RETIRED_KEYS)) {
    if (camel in entry) {
      entry[snake] = entry[camel];
      delete entry[camel];
    }
  }
  return schema;
}

describe('fields-grid/line-items-grid writes the camelCase keys, and they draw (objectui#11610)', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it('the entry carries all eight camelCase keys and no snake_case one', () => {
    const entry = example().fields[0];
    expect(entry.type).toBe('grid');
    for (const [snake, camel] of Object.entries(GRID_FIELD_RETIRED_KEYS)) {
      expect(entry, camel).toHaveProperty(camel);
      expect(entry, snake).not.toHaveProperty(snake);
    }
  });

  it('validates on the strict authoring face', () => {
    expect(StrictAnyComponentSchema.safeParse(example()).success).toBe(true);
  });

  it('draws its label, total and row controls through the real form renderer', async () => {
    render(<SchemaRenderer schema={example() as never} />);
    // `waitFor`: the grid widget is a `React.lazy` boundary.
    const add = await waitFor(() => screen.getByTestId('line-items-add') as HTMLButtonElement);
    expect(add.textContent).toBe('Add line item');
    // `maxRows: 10` at two rows: Add stays enabled.
    expect(add.disabled).toBe(false);
    // `totalField: 'amount'`: 59.98 + 49.99.
    expect(screen.getByTestId('line-items-total').textContent).toContain('109.97');
    // `allowReorder` / `allowDelete` / `allowAdd` all true: each row keeps its controls.
    expect(screen.queryAllByTestId(/^line-items-drag-/)).toHaveLength(2);
    expect(screen.queryAllByTestId(/^line-items-duplicate-/)).toHaveLength(2);
    const removes = screen.queryAllByTestId(/^line-items-remove-/) as HTMLButtonElement[];
    expect(removes).toHaveLength(2);
    // `minRows: 1` at two rows: Remove stays enabled.
    expect(removes.every((b) => !b.disabled)).toBe(true);
    expect(screen.queryByTestId('grid-field-retired-keys')).toBeNull();
  });

  it('CONTROL: respelled in snake_case, it is refused by name on the strict face and drawn as the refusal', async () => {
    const snake = asSnakeCase(example());
    const parsed = StrictAnyComponentSchema.safeParse(snake);
    expect(parsed.success).toBe(false);
    const paths = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
    expect(paths.sort()).toEqual(Object.keys(GRID_FIELD_RETIRED_KEYS).map((k) => `fields.0.${k}`).sort());

    render(<SchemaRenderer schema={snake as never} />);
    const alert = await waitFor(() => screen.getByTestId('grid-field-retired-keys'));
    expect(alert.textContent).toContain('Grid field `line_items`');
    expect(alert.textContent).toContain('`total_field` → `totalField`');
    expect(screen.queryByTestId('line-items-add')).toBeNull();
    expect(screen.queryByTestId('line-items-total')).toBeNull();
  });
});
