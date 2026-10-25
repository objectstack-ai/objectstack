// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10367 — `SchemaForm`'s required `*` stays out of the control's
 * accessible name, and the requirement reaches the control as a STATE.
 *
 * Three marker sites, all inside something that NAMES a control:
 *  - `FieldRow`'s default row and its boolean row put the `showRequiredStar`
 *    span inside the label associated by `htmlFor` (or by id plus
 *    `aria-labelledby` on the group channel);
 *  - a grid/table repeater's column-header `th` carries the column's `*`, and
 *    every cell control under it is named from that header by
 *    `aria-labelledby` (objectui#5063).
 * Before the fix each `*` was a bare span, so a required string property was
 * named "Title *", and the file emitted no `aria-required` anywhere.
 *
 * The objectui#10178 / objectui#3299 shape: the marker is `aria-hidden`, and
 * `FieldControl` puts `aria-required` on the controls it renders itself, from
 * the same flag that draws the marker, and hands that flag to a registered
 * `labelling: 'control'` widget, which emits it through `controlNaming()` in
 * `widgets.tsx`, and to `color-picker`, whose `radiogroup` carries it.
 * `aria-required`, not native `required`,
 * so a host `<form>` gains no browser verdict — each case asserts native
 * `required` stays absent.
 *
 * The marker is located by `data-required-marker`, never by the a11y attribute
 * under test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

describe('objectui#10367 — SchemaForm keeps the required `*` out of the accessible name', () => {
  it('a required string property is named without `*` and is aria-required', () => {
    const { container } = render(
      <SchemaForm
        schema={{ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } as never}
        value={{}}
        onChange={() => {}}
      />,
    );

    // The card's named probe: the computed name has no trailing `*`.
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAccessibleName('Title');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');

    const marker = container.querySelector('label [data-required-marker]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('the boolean row — a required switch with no default — is named without `*` and is aria-required', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } as never}
        value={{}}
        onChange={() => {}}
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Enabled' });
    expect(toggle).toHaveAttribute('aria-required', 'true');
    expect(toggle).not.toHaveAttribute('required');
  });

  it('a grid repeater cell under a required column header is named without `*` and is aria-required', () => {
    const { container } = render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              cols: {
                type: 'array',
                title: 'Cols',
                items: { type: 'object', properties: { field: { type: 'string' }, note: { type: 'string' } } },
              },
            },
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  {
                    field: 'cols',
                    type: 'repeater',
                    widget: 'grid',
                    fields: [
                      { field: 'field', type: 'text', label: 'Field', required: true },
                      { field: 'note', type: 'text', label: 'Note' },
                    ],
                  },
                ],
              },
            ],
          } as never
        }
        value={{ cols: [{ field: 'name', note: '' }] }}
        onChange={() => {}}
      />,
    );

    const [fieldCell, noteCell] = Array.from(container.querySelectorAll('td input')) as HTMLElement[];
    // Named through the header by IDREF — the `*` there no longer rides along.
    expect(fieldCell).toHaveAccessibleName('Field');
    expect(fieldCell).toHaveAttribute('aria-required', 'true');
    expect(fieldCell).not.toHaveAttribute('required');
    // The optional column beside it is the in-render control.
    expect(noteCell).toHaveAccessibleName('Note');
    expect(noteCell).not.toHaveAttribute('aria-required');

    const headerMarker = container.querySelector('th [data-required-marker]');
    expect(headerMarker).not.toBeNull();
    expect(headerMarker).toHaveAttribute('aria-hidden', 'true');
  });

  it('a registered `control` widget is named without `*` and carries aria-required, in a row and in a grid cell', () => {
    // The widget half: `FieldControl` hands the flag to the widget as
    // `WidgetProps.required`, and `controlNaming()` emits it beside the naming
    // props. Before it, hiding the `*` left these controls with no cue at all.
    const { container } = render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              tags: { type: 'array', items: { type: 'string' } },
              glyph: { type: 'string' },
              extra: { type: 'array', items: { type: 'string' } },
            },
            required: ['tags', 'glyph'],
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  { field: 'tags', widget: 'string-tags' },
                  { field: 'glyph', widget: 'icon' },
                  { field: 'extra', widget: 'string-tags' },
                ],
              },
            ],
          } as never
        }
        value={{}}
        onChange={() => {}}
      />,
    );

    const tags = screen.getByRole('textbox', { name: 'Tags' });
    expect(tags).toHaveAttribute('aria-required', 'true');
    expect(tags).not.toHaveAttribute('required');
    const glyph = screen.getByRole('combobox', { name: 'Glyph' });
    expect(glyph).toHaveAttribute('aria-required', 'true');
    // The optional registered field beside them is the in-render control.
    expect(screen.getByRole('textbox', { name: 'Extra' })).not.toHaveAttribute('aria-required');
    expect(container.querySelectorAll('label [data-required-marker]')).toHaveLength(2);
    cleanup();

    // A grid cell reaches the same widget with its column's `required`.
    const grid = render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              rows: {
                type: 'array',
                title: 'Rows',
                items: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
              },
            },
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  {
                    field: 'rows',
                    type: 'repeater',
                    widget: 'grid',
                    fields: [{ field: 'tags', label: 'Tags', widget: 'string-tags', required: true }],
                  },
                ],
              },
            ],
          } as never
        }
        value={{ rows: [{ tags: [] }] }}
        onChange={() => {}}
      />,
    );
    const cell = grid.container.querySelector('td input') as HTMLElement;
    expect(cell).toHaveAccessibleName('Tags');
    expect(cell).toHaveAttribute('aria-required', 'true');
  });

  it('the `color-picker` radiogroup is named without `*` and carries aria-required', () => {
    // A `'group'` widget, but its surface is a `radiogroup`, where ARIA 1.2
    // supports `aria-required`: `ColorSwatchGroupWidget` hands the flag to
    // `ColorVariantPicker`. A declared palette (`enum`) is what makes the host
    // resolve `color-picker` rather than `color-input`.
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              accent: { type: 'string', enum: ['red', 'blue'] },
              tint: { type: 'string', enum: ['red', 'blue'] },
            },
            required: ['accent'],
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  { field: 'accent', widget: 'color-picker' },
                  { field: 'tint', widget: 'color-picker' },
                ],
              },
            ],
          } as never
        }
        value={{}}
        onChange={() => {}}
      />,
    );

    const accent = screen.getByRole('radiogroup', { name: 'Accent' });
    expect(accent).toHaveAccessibleName('Accent');
    expect(accent).toHaveAttribute('aria-required', 'true');
    // The optional picker beside it is the in-render control.
    expect(screen.getByRole('radiogroup', { name: 'Tint' })).not.toHaveAttribute('aria-required');
  });

  it('CONTROL — an optional string property shows no marker and carries no aria-required', () => {
    const { container } = render(
      <SchemaForm
        schema={{ type: 'object', properties: { title: { type: 'string' } } } as never}
        value={{}}
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('[data-required-marker]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-required');
  });
});
