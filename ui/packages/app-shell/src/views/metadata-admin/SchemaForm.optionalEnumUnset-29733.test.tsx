// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An OPTIONAL enum row in the metadata-admin `SchemaForm` can be returned to
 * "declares nothing".
 *
 * Both builtin select paths (`fieldSpec.options` and the schema's own `enum`)
 * used to list only the enum's values, so once an author picked one the key
 * could never be removed again from the form. On a `user` field that is not
 * cosmetic: a `user` field that declares no `deleteBehavior` stays out of the
 * delete walk, so an author who tried `cascade` and changed their mind was
 * left with it in force.
 *
 * The cure is a "— None —" item (the `engine.form.none` word the metadata-admin
 * pickers already use) that writes the key as ABSENT, through the form's own
 * clear convention: `onChange(undefined)`, which a form row deletes from the
 * object and a repeater row stores as `undefined` (dropped on the wire).
 *
 * Pins:
 *  - each path: a set value, choose None, the emitted object lacks the key;
 *  - the repeater card row (the `object` form's `fields` rows, where the
 *    `deleteBehavior` row lives): the row serialises without the key;
 *  - CONTROL: a REQUIRED enum offers no None item, on both paths and in a grid
 *    cell whose column is required;
 *  - CONTROL: a scalar list row of an enum offers no None item — an array
 *    element is removed with its own button, never "unset".
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import type { FormViewSpec } from './form-spec';
import { t } from './i18n';

afterEach(cleanup);

const NONE = t('engine.form.none', 'en-US');

/** Open a Radix Select trigger the way the other suites in this repo do. */
async function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
}

/** The last object a `SchemaForm` emitted. */
function lastEmitted(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onChange).toHaveBeenCalled();
  return onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, unknown>;
}

const DELETE_OPTIONS = [
  { label: 'Set null', value: 'set_null' },
  { label: 'Cascade (delete children)', value: 'cascade' },
  { label: 'Restrict (block the delete)', value: 'restrict' },
];

const fieldSchema = (required: string[] = []) =>
  ({
    type: 'object',
    properties: {
      type: { type: 'string', title: 'Type' },
      deleteBehavior: {
        type: 'string',
        title: 'Delete Behavior',
        enum: ['set_null', 'cascade', 'restrict'],
      },
    },
    required,
  }) as never;

describe('an optional enum row offers "— None —", which writes the key as absent', () => {
  it('⭐ the schema-enum path (no form options): choosing None deletes the key', async () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={fieldSchema()}
        value={{ type: 'user', deleteBehavior: 'cascade' }}
        onChange={onChange}
      />,
    );
    await openSelect(screen.getByRole('combobox', { name: 'Delete Behavior' }));
    fireEvent.click(screen.getByRole('option', { name: NONE }));

    const next = lastEmitted(onChange);
    expect('deleteBehavior' in next).toBe(false);
    // Nothing else moved.
    expect(next).toEqual({ type: 'user' });
  });

  it('⭐ the form-options path (`fieldSpec.options`): choosing None deletes the key', async () => {
    const onChange = vi.fn();
    const form: FormViewSpec = {
      sections: [
        {
          label: 'Relational',
          fields: [
            { field: 'type', label: 'Type' },
            { field: 'deleteBehavior', label: 'Delete Behavior', type: 'select', options: DELETE_OPTIONS },
          ],
        },
      ],
    };
    render(
      <SchemaForm
        schema={fieldSchema()}
        form={form}
        value={{ type: 'user', deleteBehavior: 'restrict' }}
        onChange={onChange}
      />,
    );
    await openSelect(screen.getByRole('combobox', { name: 'Delete Behavior' }));
    // The enum's own values are still all offered, after the None item.
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual([NONE, ...DELETE_OPTIONS.map((o) => o.label)]);
    fireEvent.click(screen.getByRole('option', { name: NONE }));

    const next = lastEmitted(onChange);
    expect('deleteBehavior' in next).toBe(false);
    expect(next).toEqual({ type: 'user' });
  });

  it('⭐ a repeater card row (the object form `fields` rows): the row serialises without the key', async () => {
    const onChange = vi.fn();
    const form: FormViewSpec = {
      sections: [
        {
          label: 'Fields',
          fields: [
            {
              field: 'fields',
              type: 'repeater',
              fields: [
                { field: 'name', label: 'Name', required: true },
                { field: 'deleteBehavior', label: 'Delete Behavior', type: 'select', options: DELETE_OPTIONS },
              ],
            },
          ],
        },
      ],
    };
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              fields: {
                type: 'array',
                title: 'Fields',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    deleteBehavior: { type: 'string', enum: ['set_null', 'cascade', 'restrict'] },
                  },
                },
              },
            },
          } as never
        }
        form={form}
        value={{ fields: [{ name: 'owner', deleteBehavior: 'cascade' }] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/#1/));
    await openSelect(screen.getByRole('combobox', { name: 'Delete Behavior' }));
    fireEvent.click(screen.getByRole('option', { name: NONE }));

    const next = lastEmitted(onChange);
    // What a save sends is the JSON of the draft.
    expect(JSON.parse(JSON.stringify(next))).toEqual({ fields: [{ name: 'owner' }] });
  });

  it('with nothing set, the trigger still reads the placeholder (no value is written on render)', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={fieldSchema()} value={{ type: 'user' }} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Delete Behavior' })).toHaveTextContent(
      t('engine.form.selectEllipsis', 'en-US'),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CONTROL — no None item where the value cannot be absent', () => {
  it('a REQUIRED enum (schema-enum path) offers only its values', async () => {
    render(
      <SchemaForm
        schema={fieldSchema(['deleteBehavior'])}
        value={{ type: 'user', deleteBehavior: 'cascade' }}
        onChange={() => {}}
      />,
    );
    await openSelect(screen.getByRole('combobox', { name: 'Delete Behavior' }));
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('a REQUIRED enum (form-options path) offers only its values', async () => {
    const form: FormViewSpec = {
      sections: [
        {
          label: 'Relational',
          fields: [
            { field: 'deleteBehavior', label: 'Delete Behavior', type: 'select', required: true, options: DELETE_OPTIONS },
          ],
        },
      ],
    };
    render(
      <SchemaForm
        schema={fieldSchema()}
        form={form}
        value={{ deleteBehavior: 'cascade' }}
        onChange={() => {}}
      />,
    );
    await openSelect(screen.getByRole('combobox', { name: 'Delete Behavior' }));
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('a grid repeater cell: an optional column offers None, a required column does not', async () => {
    const form: FormViewSpec = {
      sections: [
        {
          label: 'Rules',
          fields: [
            {
              field: 'rules',
              type: 'repeater',
              widget: 'grid',
              fields: [
                { field: 'mode', label: 'Mode', type: 'select', required: true, options: [
                  { label: 'Allow', value: 'allow' },
                  { label: 'Deny', value: 'deny' },
                ] },
                { field: 'kind', label: 'Kind', type: 'select', options: [
                  { label: 'Open', value: 'open' },
                  { label: 'Won', value: 'won' },
                ] },
              ],
            },
          ],
        },
      ],
    };
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              rules: {
                type: 'array',
                title: 'Rules',
                items: { type: 'object', properties: { mode: { type: 'string' }, kind: { type: 'string' } } },
              },
            },
          } as never
        }
        form={form}
        value={{ rules: [{ mode: 'allow', kind: 'open' }] }}
        onChange={() => {}}
      />,
    );
    const [modeCell, kindCell] = Array.from(document.querySelectorAll('td')) as HTMLElement[];
    await openSelect(within(modeCell).getByRole('combobox'));
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));

    await openSelect(within(kindCell).getByRole('combobox'));
    expect(screen.getByRole('option', { name: NONE })).toBeInTheDocument();
  });

  it('a scalar list row of an enum offers no None item', async () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              modes: { type: 'array', title: 'Modes', items: { type: 'string', enum: ['a', 'b'] } },
            },
          } as never
        }
        form={{ sections: [{ label: 'S', fields: [{ field: 'modes', type: 'repeater' }] }] }}
        value={{ modes: ['a'] }}
        onChange={() => {}}
      />,
    );
    await openSelect(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});
