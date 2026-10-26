// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5062 — `FieldRow`'s host id is derived from the field's PATH, not
 * from its local name.
 *
 * ## What was measured (baseline `90517e1a2`, real `SchemaForm` renders)
 *
 * Two `composite` fields `a` / `b`, each with a sub-field named `field`
 * (labels "Field A" / "Field B", values `x` / `y`):
 *
 * ```
 * ids: ["mdf-a-label","mdf-field","mdf-b-label","mdf-field"]
 * DUPLICATES: ["mdf-field"]
 * label "Field A" for=mdf-field  resolves to INPUT[value="x"]
 * label "Field B" for=mdf-field  resolves to INPUT[value="x"]   <- Field A's control
 * ```
 *
 * `FieldRow` built `mdf-{name}` from the LOCAL field name while being called
 * recursively at four nesting points (composite sub-rows, repeater card rows,
 * record items, the recursive `SchemaForm`). Same-named sub-fields under
 * different parents therefore produced the same DOM id, and a `<label for>`
 * resolves to the FIRST match in the document: clicking "Field B" focused
 * Field A's input and assistive tech read Field A's control as "Field B".
 *
 * Worse than the dangling associations of #4871 / #4857 / #4788 / #5039 —
 * this one RESOLVES, to the wrong element, so nothing about the DOM looks
 * broken. Same failure class as objectui#3343 (fixed-id sub-inputs in
 * `packages/fields`), one host up.
 *
 * ## What this file pins
 *
 *  1. the CROSS-WIRING itself: at every nesting point, same-named sub-fields
 *     get distinct ids AND each label resolves to its OWN control — asserted on
 *     the value behind the association, not merely on id inequality, because
 *     two distinct ids can still be wired to one element;
 *  2. the TOP-LEVEL contract: a top-level field's id is still exactly
 *     `mdf-{field}` (and its group label id `mdf-{field}-label`). The scoping
 *     is additive — nested rows gain a prefix, the existing selector surface
 *     the other metadata-admin tests read does not move;
 *  3. the segment contract: row/item segments are numeric indices, so an
 *     author-typed `record` key (runtime user input, may contain spaces) can
 *     never reach an id that is consumed as an `aria-labelledby` IDREF.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

/** Every id in the document, and the ones that appear more than once. */
function idCensus() {
  const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
  return { ids, duplicates: Array.from(new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) };
}

/** The element a visible label's `for` actually resolves to. */
function controlFor(text: string): HTMLInputElement | null {
  const label = screen.getByText(text).closest('label')!;
  const target = label.getAttribute('for');
  return target ? (document.getElementById(target) as HTMLInputElement | null) : null;
}

describe('#5062 — nested same-named sub-fields do not share an id', () => {
  it('composite: two sub-fields named `field`, each label resolves to its own control', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              a: { type: 'object', title: 'A', properties: { field: { type: 'string' } } },
              b: { type: 'object', title: 'B', properties: { field: { type: 'string' } } },
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
                  { field: 'a', type: 'composite', fields: [{ field: 'field', type: 'text', label: 'Field A' }] },
                  { field: 'b', type: 'composite', fields: [{ field: 'field', type: 'text', label: 'Field B' }] },
                ],
              },
            ],
          } as never
        }
        value={{ a: { field: 'x' }, b: { field: 'y' } }}
        onChange={() => {}}
      />,
    );

    expect(idCensus().duplicates).toEqual([]);
    expect(document.getElementById('mdf-a.field')).not.toBeNull();
    expect(document.getElementById('mdf-b.field')).not.toBeNull();

    // The measured defect: before, BOTH of these read "x".
    expect(controlFor('Field A')).toHaveValue('x');
    expect(controlFor('Field B')).toHaveValue('y');
    expect(controlFor('Field A')).not.toBe(controlFor('Field B'));
  });

  it('repeater card rows: the row index is part of the path', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              tabs: {
                type: 'array',
                title: 'Tabs',
                items: { type: 'object', properties: { label: { type: 'string' } } },
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
                fields: [{ field: 'tabs', type: 'repeater', fields: [{ field: 'label', type: 'text', label: 'Row label' }] }],
              },
            ],
          } as never
        }
        value={{ tabs: [{ label: 'one' }, { label: 'two' }] }}
        onChange={() => {}}
      />,
    );

    // Open the SECOND row — its sub-field must carry the row's index, not a
    // bare `mdf-label` that every row would share.
    fireEvent.click(screen.getByText(/#2/));
    expect(document.getElementById('mdf-tabs.1.label')).toHaveValue('two');
    expect(document.getElementById('mdf-label')).toBeNull();
    expect(controlFor('Row label')).toHaveValue('two');
    expect(idCensus().duplicates).toEqual([]);
  });

  it('two repeaters with the same sub-field name, both expanded, stay distinct', () => {
    const items = { type: 'object', properties: { label: { type: 'string' } } };
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              left: { type: 'array', title: 'Left', items },
              right: { type: 'array', title: 'Right', items },
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
                  { field: 'left', type: 'repeater', fields: [{ field: 'label', type: 'text', label: 'L' }] },
                  { field: 'right', type: 'repeater', fields: [{ field: 'label', type: 'text', label: 'R' }] },
                ],
              },
            ],
          } as never
        }
        value={{ left: [{ label: 'l0' }], right: [{ label: 'r0' }] }}
        onChange={() => {}}
      />,
    );

    for (const toggle of screen.getAllByText(/#1/)) fireEvent.click(toggle);
    expect(idCensus().duplicates).toEqual([]);
    expect(controlFor('L')).toHaveValue('l0');
    expect(controlFor('R')).toHaveValue('r0');
  });

  it('record items: the id carries the item INDEX, never the author-typed key', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              cfg: {
                type: 'object',
                title: 'Cfg',
                additionalProperties: { type: 'object', properties: { title: { type: 'string' } } },
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
                fields: [{ field: 'cfg', type: 'record', fields: [{ field: 'title', type: 'text', label: 'Title' }] }],
              },
            ],
          } as never
        }
        // A key with a space in it: legal for a Record, and exactly what must
        // NOT reach an id that is read as an IDREF.
        value={{ cfg: { 'my key': { title: 'first' }, other: { title: 'second' } } }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('my key'));
    const titleInput = controlFor('Title')!;
    expect(titleInput).toHaveValue('first');
    expect(titleInput.id).toBe('mdf-cfg.0.title');
    expect(titleInput.id).not.toMatch(/\s/);
    expect(idCensus().duplicates).toEqual([]);
  });

  it('recursive SchemaForm: the inner field is scoped under the outer field', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              outer: {
                type: 'object',
                title: 'Outer',
                properties: { inner: { type: 'string', title: 'Inner' } },
              },
              inner: { type: 'string', title: 'Top Inner' },
            },
          } as never
        }
        value={{ outer: { inner: 'nested' }, inner: 'top' }}
        onChange={() => {}}
      />,
    );

    // A top-level field and a nested one, both named `inner`: before, one id.
    expect(idCensus().duplicates).toEqual([]);
    expect(document.getElementById('mdf-outer.inner')).toHaveValue('nested');
    expect(document.getElementById('mdf-inner')).toHaveValue('top');
    expect(controlFor('Inner')).toHaveValue('nested');
    expect(controlFor('Top Inner')).toHaveValue('top');
  });
});

describe('#5062 — top-level ids are unchanged (the existing selector surface)', () => {
  it('a control-channel field keeps `for`/`id` = `mdf-{field}`', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { title: { type: 'string', title: 'Title' } } } as never}
        value={{ title: 'v' }}
        onChange={() => {}}
      />,
    );

    const label = screen.getByText('Title').closest('label')!;
    expect(label).toHaveAttribute('for', 'mdf-title');
    expect(document.getElementById('mdf-title')).toHaveValue('v');
  });

  it('a group-channel field keeps its label id `mdf-{field}-label` and the IDREF', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: { a: { type: 'object', title: 'A', properties: { field: { type: 'string' } } } },
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [{ label: 'S', fields: [{ field: 'a', type: 'composite', fields: [{ field: 'field', type: 'text' }] }] }],
          } as never
        }
        value={{ a: { field: 'x' } }}
        onChange={() => {}}
      />,
    );

    const label = screen.getByText('A').closest('label')!;
    expect(label).toHaveAttribute('id', 'mdf-a-label');
    expect(label).not.toHaveAttribute('for');
    const group = document.querySelector('[aria-labelledby="mdf-a-label"]')!;
    expect(group).not.toBeNull();
    expect(group).toHaveAccessibleName('A');
  });
});
