/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record dialog's defaults when the author declared no layout
 * (objectui#12521).
 *
 * ## What changed
 *
 * - SIZE: a dialog with no `modalSize` derived its width from the inferred
 *   column count, and three or more columns mapped to `full` (95vw). It is now
 *   bounded: `lg` or `xl`, chosen from the grid that renders and the field
 *   count, ⛔ never `full`. An authored `modalSize: 'full'` is used as written.
 * - GRID: a form that declares no `columns` (on the form, and on no section)
 *   inferred one to four columns from its field count. It now lays out at two
 *   columns from the container's `@md` tier up, through the explicit-columns
 *   route, so every field takes one cell and a wide kind or a `span: 'full'`
 *   field takes the row. An authored `columns` wins.
 * - SECTION DENSITY (the section-`columns` fork, ruled 6204264665): a section
 *   that declares no `columns`, in a form that declares none, draws two per
 *   row from `@md`, beside any other section's count, on objectui#12548's
 *   per-section grid. A declared count, `1` included, is drawn as written.
 *
 * ## What it reads
 *
 * The real `ModalForm` with the real form renderer and field registry, as
 * `AppContent` mounts it (no `ObjectForm` above it). The dialog's size is its
 * `sm:max-w-*` class; a field's width is the col-span classes on its grid
 * cell. jsdom evaluates no container query, so "two columns from `@md`" is
 * read as the grid's class list, which the form renderer emits verbatim.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';

registerAllFields();

afterEach(() => cleanup());

const opt = (v: string) => [{ label: v, value: v }];

/** Twelve plain fields plus one textarea — "an object form with twelve fields". */
const TWELVE = {
  name: 'thing',
  fields: {
    name: { type: 'text', label: 'Name' },
    code: { type: 'text', label: 'Code' },
    email: { type: 'email', label: 'Email' },
    phone: { type: 'text', label: 'Phone' },
    website: { type: 'url', label: 'Website' },
    status: { type: 'select', label: 'Status', options: opt('open') },
    stage: { type: 'select', label: 'Stage', options: opt('new') },
    source: { type: 'select', label: 'Source', options: opt('web') },
    amount: { type: 'currency', label: 'Amount' },
    quantity: { type: 'number', label: 'Quantity' },
    due: { type: 'date', label: 'Due' },
    notes: { type: 'textarea', label: 'Notes' },
  },
};

/** A two-field form: short enough that a wide dialog would only stretch it. */
const TWO = {
  name: 'thing',
  fields: {
    name: { type: 'text', label: 'Name' },
    code: { type: 'text', label: 'Code' },
  },
};

const ds = (def: unknown) => ({
  getObjectSchema: vi.fn().mockResolvedValue(def),
  findOne: vi.fn().mockResolvedValue({}),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
});

/** Mount the dialog, wait for its fields, and read its size and grid. */
async function openDialog(def: { fields: Record<string, unknown> }, extra: Record<string, unknown> = {}) {
  const first = Object.keys(def.fields)[0];
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'thing',
        mode: 'create',
        open: true,
        fields: Object.keys(def.fields),
        ...(extra as object),
      }}
      dataSource={ds(def) as any}
    />,
  );
  await waitFor(() => {
    if (!document.body.querySelector(`[name="${first}"]`)) throw new Error('form not drawn yet');
  });
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  const form = document.body.querySelector('form') as HTMLElement;
  const grid = form.querySelector('.grid') as HTMLElement | null;
  /** The col-span classes on the grid cell that holds `name`'s control. */
  const spanOf = (name: string): string[] => {
    const control = form.querySelector(`[name="${name}"]`);
    let cell = control as HTMLElement | null;
    while (cell && cell.parentElement !== grid) cell = cell.parentElement;
    if (!cell) throw new Error(`no grid cell holds ${name}`);
    return cell.className.split(/\s+/).filter((c) => c.includes('col-span'));
  };
  return { dialog, grid, spanOf };
}

const DEFAULT_GRID = 'grid gap-4 grid-cols-1 @md:grid-cols-2';
/** objectui#12548's per-section grid, drawn when the sections' counts do not all fit one grid. */
const TWELVE_TRACK_GRID = 'grid gap-4 grid-cols-1 @md:grid-cols-12';

describe('a dialog with no authored layout (objectui#12521)', () => {
  it('twelve fields: a bounded xl dialog, a two-column grid from @md, one cell per field, the textarea across the row', async () => {
    const { dialog, grid, spanOf } = await openDialog(TWELVE);

    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(dialog.className).not.toContain('sm:max-w-[95vw]');

    expect(grid?.className).toBe(DEFAULT_GRID);

    // Fields of one kind share one width: every non-wide field is one cell.
    for (const name of Object.keys(TWELVE.fields).filter((n) => n !== 'notes')) {
      expect(spanOf(name), name).toEqual([]);
    }
    // The wide kind spans both columns.
    expect(spanOf('notes')).toEqual(['@md:col-span-2']);
  });

  it('a short form gets the lg bound, not a dialog wider than its fields', async () => {
    const { dialog, grid } = await openDialog(TWO);
    expect(dialog.className).toContain('sm:max-w-2xl');
    expect(grid?.className).toBe(DEFAULT_GRID);
  });

  it('below sm the grid is one column, and the dialog is still the phone sheet', async () => {
    const { dialog, grid } = await openDialog(TWELVE);
    // Every multi-column tier is a container query from @md up; the base is one column.
    const tokens = (grid?.className ?? '').split(/\s+/);
    expect(tokens).toContain('grid-cols-1');
    expect(tokens.filter((t) => /grid-cols-(?!1$)/.test(t)).every((t) => t.startsWith('@md:'))).toBe(true);
    // The phone sheet's own classes are untouched.
    expect(dialog.className).toContain('h-[100dvh]');
    expect(dialog.className).toContain('inset-0');
  });

  it('object fieldGroups with no layout get the same two-column default', async () => {
    const grouped = {
      ...TWELVE,
      fieldGroups: [
        { key: 'main', label: 'Main' },
        { key: 'more', label: 'More' },
      ],
      fields: Object.fromEntries(
        Object.entries(TWELVE.fields).map(([k, f], i) => [k, { ...f, group: i < 6 ? 'main' : 'more' }]),
      ),
    };
    const { dialog, grid, spanOf } = await openDialog(grouped);
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(grid?.className).toBe(DEFAULT_GRID);
    expect(spanOf('name')).toEqual([]);
    expect(spanOf('notes')).toEqual(['@md:col-span-2']);
  });

  it('sections that declare no columns anywhere get the two-column default too', async () => {
    const { grid, spanOf } = await openDialog(TWELVE, {
      sections: [
        { name: 'a', label: 'A', fields: ['name', 'code', 'email', 'phone', 'website', 'status'] },
        { name: 'b', label: 'B', fields: ['stage', 'source', 'amount', 'quantity', 'due', 'notes'] },
      ],
    });
    expect(grid?.className).toBe(DEFAULT_GRID);
    expect(spanOf('name')).toEqual([]);
    expect(spanOf('notes')).toEqual(['@md:col-span-2']);
  });
});

describe('an authored layout is used as written (objectui#12521)', () => {
  it("an authored modalSize: 'full' is honoured", async () => {
    const { dialog } = await openDialog(TWELVE, { modalSize: 'full' });
    expect(dialog.className).toContain('sm:max-w-[95vw]');
  });

  it('an authored columns: 1 is honoured: one stacked column, no grid tiers', async () => {
    const { grid } = await openDialog(TWELVE, { columns: 1 });
    expect(grid).toBeNull();
    expect(document.body.querySelector('[class*="@md:grid-cols-2"]')).toBeNull();
  });

  it("a field's authored span: 'full' takes the row in the default grid", async () => {
    const { spanOf } = await openDialog(TWELVE, {
      sections: [{ name: 'a', label: 'A', fields: [{ field: 'name', span: 'full' }, 'code', 'email'] }],
    });
    expect(spanOf('name')).toEqual(['@md:col-span-2']);
    expect(spanOf('code')).toEqual([]);
  });

  it('CONTROL: an authored multi-section layout keeps every grid class and col-span main draws', async () => {
    // The hotcrm lead form's shape: a two-column section and a three-column
    // one. These are the classes objectui#12548's per-section grid draws on
    // `main` — the defaults of objectui#12521 reach none of them. Only the
    // size moves: no `modalSize` is authored, so the derived bound applies,
    // and twelve fields on a three-wide grid are what used to derive `full`.
    const { dialog, grid, spanOf } = await openDialog(TWELVE, {
      sections: [
        { name: 'a', label: 'A', columns: 2, fields: ['name', { field: 'code', span: 'full' }, 'email', 'phone', 'website'] },
        { name: 'b', label: 'B', columns: 3, fields: ['status', 'stage', 'source', 'amount', 'quantity', 'due', 'notes'] },
      ],
    });
    expect(grid?.className).toBe(TWELVE_TRACK_GRID);
    expect(spanOf('name')).toEqual(['@md:col-span-6']);
    expect(spanOf('code')).toEqual(['@md:col-span-12']);
    expect(spanOf('status')).toEqual(['@md:col-span-6', '@2xl:col-span-4']);
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(dialog.className).not.toContain('sm:max-w-[95vw]');
  });
});

describe('section density: undeclared is the dialog\'s choice, declared is drawn as written (objectui#12521)', () => {
  it('an undeclared section draws two per row from @md, and a declared columns: 1 section draws one', async () => {
    const { grid, spanOf } = await openDialog(TWELVE, {
      sections: [
        { name: 'a', label: 'A', fields: ['name', 'code', 'email'] },
        { name: 'b', label: 'B', columns: 1, fields: ['phone', 'website'] },
      ],
    });
    // Both counts fit a two-wide grid, so objectui#12548's rule keeps it.
    expect(grid?.className).toBe(DEFAULT_GRID);
    expect(spanOf('name')).toEqual([]);
    expect(spanOf('code')).toEqual([]);
    expect(spanOf('phone')).toEqual(['@md:col-span-2']);
    expect(spanOf('website')).toEqual(['@md:col-span-2']);
  });

  it('beside a declared columns: 3 section, an undeclared section draws two per row on the 12-track grid', async () => {
    const { grid, spanOf } = await openDialog(TWELVE, {
      sections: [
        { name: 'a', label: 'A', fields: ['name', 'code', 'email', 'notes'] },
        { name: 'b', label: 'B', columns: 3, fields: ['status', 'stage', 'source'] },
      ],
    });
    expect(grid?.className).toBe(TWELVE_TRACK_GRID);
    // Two per row at every tier from @md: six twelfths each.
    expect(spanOf('name')).toEqual(['@md:col-span-6']);
    expect(spanOf('email')).toEqual(['@md:col-span-6']);
    // A wide kind still takes the row.
    expect(spanOf('notes')).toEqual(['@md:col-span-12']);
    // The declared three: two per row at @md, three from @2xl.
    expect(spanOf('status')).toEqual(['@md:col-span-6', '@2xl:col-span-4']);
  });

  it('a declared columns: 3 section draws three per row', async () => {
    const { grid, spanOf } = await openDialog(TWELVE, {
      sections: [{ name: 'b', label: 'B', columns: 3, fields: ['name', 'code', 'email', 'phone', 'website', 'status'] }],
    });
    expect(grid?.className).toBe('grid gap-4 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3');
    for (const name of ['name', 'code', 'email', 'phone', 'website', 'status']) {
      expect(spanOf(name), name).toEqual([]);
    }
  });

  it('a declared columns: 1 is never read as undeclared: every section at 1 — what the spec\'s parse writes today — draws one column', async () => {
    const { grid } = await openDialog(TWELVE, {
      sections: [
        { name: 'a', label: 'A', columns: 1, fields: ['name', 'code', 'email'] },
        { name: 'b', label: 'B', columns: 1, fields: ['phone', 'website'] },
      ],
    });
    expect(grid).toBeNull();
    expect(document.body.querySelector('[class*="@md:grid-cols-"]')).toBeNull();
  });

  it('CONTROL: under a declared form columns, an undeclared section fills the form\'s count as before', async () => {
    const { grid, spanOf } = await openDialog(TWELVE, {
      columns: 3,
      sections: [{ name: 'a', label: 'A', fields: ['name', 'code', 'email', 'phone', 'website', 'status'] }],
    });
    expect(grid?.className).toBe('grid gap-4 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3');
    expect(spanOf('name')).toEqual([]);
  });
});
