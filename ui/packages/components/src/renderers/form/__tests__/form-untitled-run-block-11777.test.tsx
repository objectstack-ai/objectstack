/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11777 — an untitled run of fields after a titled section opens a
 * field grid of its own.
 *
 * A sectioned form is ONE form whose section headings are inline
 * `section-divider` rows. Before this card every row shared one field grid, so
 * the fields of an untitled section (`@objectstack/spec`'s trailing ungrouped
 * bucket, which draws no row by the one row rule of objectui#9849 letter E)
 * flowed on under the previous heading — into the same grid row as its last
 * member — and read as that section's members.
 *
 * The renderer now splits the grid where the heading's membership claim
 * (`fields`, objectui#6236) ends. ⛔ It adds no row, no heading and no
 * placeholder title for the untitled run: the block boundary is the whole
 * separation.
 *
 * The rows below are structural: they ask which grid container holds which
 * field, never what a class spells, except for the one row that pins the
 * boundary is DRAWN.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

afterEach(() => cleanup());

const cel = (source: string) => ({ dialect: 'cel', source });

const field = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name.toUpperCase(),
  type: 'input',
  ...extra,
});

/** A titled heading row that claims its members, as every plugin-form arm emits it. */
const heading = (label: string, members: string[], extra: Record<string, unknown> = {}) => ({
  name: `__section_${label}`,
  label,
  type: 'section-divider',
  fields: members,
  colSpan: 4,
  ...extra,
});

const GRID = 'grid gap-4 grid-cols-1 @md:grid-cols-2';

function renderForm(fields: unknown[], extra: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        showSubmit: false,
        showCancel: false,
        columns: 2,
        fieldContainerClass: GRID,
        fields,
        ...extra,
      }}
    />,
  );
}

const item = (name: string) => document.querySelector(`[data-field="${name}"]`) as HTMLElement | null;
/** The grid container a field is laid out in. */
const blockOf = (name: string) => item(name)?.parentElement ?? null;
/** The grid container a heading row is laid out in. */
const headingBlock = (label: string) => {
  const span = Array.from(document.querySelectorAll('span')).find((s) => s.textContent === label);
  return span?.closest('div.col-span-full')?.parentElement ?? null;
};
/** The form's field grids (its action bar is the one other child `div`). */
const blocks = () =>
  Array.from(document.querySelector('form')?.children ?? []).filter((c) => c.classList.contains('grid'));

describe('objectui#11777 — an untitled run after a titled section is its own block', () => {
  it("the filer's shape: one group holding one field, then the ungrouped fields", () => {
    renderForm([
      heading('New group', ['name']),
      field('name'),
      field('status'),
      field('due_date'),
      field('technician'),
    ]);

    const titled = headingBlock('New group');
    expect(titled).not.toBeNull();
    expect(blockOf('name')).toBe(titled);
    for (const n of ['status', 'due_date', 'technician']) {
      // Not inside the titled group's container…
      expect(titled!.contains(item(n))).toBe(false);
      // …and not preceded by its heading in the block it IS in.
      expect(blockOf(n)!.textContent).not.toContain('New group');
    }
    // The untitled run is ONE block, not one per field.
    expect(blockOf('due_date')).toBe(blockOf('status'));
    expect(blockOf('technician')).toBe(blockOf('status'));
    // Both blocks are siblings in the ONE form, in source order.
    const [first, second, ...rest] = blocks();
    expect(first).toBe(titled);
    expect(second).toBe(blockOf('status'));
    expect(rest).toHaveLength(0);
  });

  it('draws the boundary on the untitled block itself — no row, no heading, no title', () => {
    renderForm([heading('New group', ['name']), field('name'), field('status')]);

    const untitled = blockOf('status')!;
    expect(untitled.className).toContain('border-t');
    // Nothing but the field is drawn in it: no divider row, no heading text.
    expect(untitled.querySelector('div.col-span-full')).toBeNull();
    expect(untitled.textContent).toBe(item('status')!.textContent);
    // The titled block keeps the plain grid.
    expect(headingBlock('New group')!.className).not.toContain('border-t');
  });

  it('keeps ONE form, so a submit still collects every block', async () => {
    const onSubmit = vi.fn();
    renderForm([heading('New group', ['name']), field('name'), field('status')], { onSubmit });

    expect(document.querySelectorAll('form').length).toBe(1);
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'Pump' } });
    fireEvent.change(document.querySelector('input[name="status"]')!, { target: { value: 'open' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Pump', status: 'open' });
  });

  describe('controls — one block, the DOM this renderer drew before #11777', () => {
    it('a flat form (no heading at all)', () => {
      renderForm([field('a'), field('b'), field('c')]);
      expect(blocks().length).toBe(1);
      expect(blockOf('a')).toBe(blockOf('c'));
      expect(blockOf('a')!.className).toBe(GRID);
    });

    it('titled sections only', () => {
      renderForm([
        heading('First', ['a', 'b']),
        field('a'),
        field('b'),
        heading('Second', ['c']),
        field('c'),
      ]);
      expect(blocks().length).toBe(1);
      expect(headingBlock('First')).toBe(headingBlock('Second'));
      expect(blockOf('c')).toBe(headingBlock('First'));
      expect(blockOf('a')!.className).toBe(GRID);
    });

    it('untitled fields BEFORE the first heading', () => {
      renderForm([field('u'), heading('Titled', ['a']), field('a')]);
      expect(blocks().length).toBe(1);
      expect(blockOf('u')).toBe(headingBlock('Titled'));
    });

    it('a heading WITHOUT a claim keeps the pre-#6236 contract and never splits', () => {
      renderForm([
        { name: '__section_legacy', label: 'Legacy', type: 'section-divider', colSpan: 4 },
        field('a'),
        field('b'),
      ]);
      expect(blocks().length).toBe(1);
      expect(blockOf('b')).toBe(headingBlock('Legacy'));
    });
  });

  it('a headingless gate row after a titled section opens a block too', () => {
    renderForm([
      heading('Titled', ['a']),
      field('a'),
      // A headingless section that authored a predicate: a chrome-less carrier.
      { name: '__section_gate_g', type: 'section-divider', visibleWhen: cel('1 == 1'), fields: ['g'], colSpan: 4 },
      field('g'),
    ]);
    expect(headingBlock('Titled')!.contains(item('g'))).toBe(false);
    expect(blockOf('g')!.className).toContain('border-t');
  });

  it('a collapsed titled section keeps its heading and the untitled block stays apart', () => {
    renderForm([
      heading('Collapsed', ['a'], { collapsible: true, collapsed: true }),
      field('a', { hidden: true }),
      field('u'),
    ]);
    expect(item('a')).toBeNull();
    expect(headingBlock('Collapsed')).not.toBeNull();
    expect(headingBlock('Collapsed')!.contains(item('u'))).toBe(false);
    expect(blockOf('u')!.className).toContain('border-t');
  });

  it("a titled section's predicate still gates ONLY its own members", () => {
    renderForm([
      heading('Gated', ['a'], { visibleWhen: cel('1 == 2') }),
      field('a'),
      field('u'),
    ]);
    // The section and its claimed member are gone; the untitled field is not.
    expect(document.body.textContent).not.toContain('Gated');
    expect(item('a')).toBeNull();
    expect(item('u')).not.toBeNull();
    // Nothing above it was drawn, so the untitled block opens on no rule.
    expect(blockOf('u')!.className).not.toContain('border-t');
  });

  it('an untitled run whose every field is hidden draws no boundary', () => {
    renderForm([heading('Titled', ['a']), field('a'), field('u', { hidden: true })]);
    expect(item('u')).toBeNull();
    const [, untitled] = blocks();
    expect(untitled.childElementCount).toBe(0);
    expect(untitled.className).not.toContain('border-t');
  });

  it('an untitled section BETWEEN two titled ones is set apart from the first', () => {
    renderForm([
      heading('First', ['a']),
      field('a'),
      field('u'),
      heading('Second', ['b']),
      field('b'),
    ]);
    expect(headingBlock('First')!.contains(item('u'))).toBe(false);
    // The untitled run's block carries on into the next titled section, whose
    // own heading row draws its own boundary.
    expect(headingBlock('Second')).toBe(blockOf('u'));
    expect(blockOf('b')).toBe(blockOf('u'));
  });
});
