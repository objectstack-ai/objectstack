/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12548 — every authored section renders its OWN `columns` count of
 * fields per row, whatever the other sections declare.
 *
 * `@objectstack/spec` `FormSectionSchema.columns` (`1 | 2 | 3 | 4`) is a
 * per-section column count. A sectioned host draws all its sections in ONE
 * field grid (one form, one react-hook-form instance), and that grid used to be
 * sized by the widest section, with every field spanning
 * `Math.round(grid / sectionColumns)` cells. Whenever a section's count did not
 * divide the grid, the section drew the wrong number per row: a `columns: 2`
 * section on a 3-wide grid spans 2 of 3 cells — ONE field per row — and on a
 * 4-wide grid a `columns: 3` section spans 1 cell — FOUR per row.
 *
 * The rule now (`sectionedGridLayout` in `autoLayout.ts`, called by all five
 * hosts): a form whose sections all divide its grid keeps that grid, byte for
 * byte; otherwise the grid is 12 tracks wide from `@md` and a field spans
 * twelfths of the row. These pins read the class attributes the real renderer
 * draws, per host, because the claim is about what renders.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ComponentRegistry } from '@object-ui/core';
import type { FormField } from '@object-ui/types';
import '@object-ui/components';
import {
  CONTAINER_GRID_COLS,
  TWELVE_TRACK_GRID_COLS,
  applyAutoColSpan,
  sectionedGridLayout,
} from '../autoLayout';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';
import { SplitForm } from '../SplitForm';
import { TabbedForm } from '../TabbedForm';
import { WizardForm } from '../WizardForm';

registerAllFields();

afterEach(() => cleanup());

const FIELD_NAMES = ['c1', 'c2', 'c3', 'c4', 'full', 'q1', 'q2', 'q3', 'd1', 'd2'];

const makeDataSource = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'lead',
    fields: Object.fromEntries(
      FIELD_NAMES.map((n) => [n, { type: 'text', label: `Field ${n}` }]),
    ),
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn().mockResolvedValue({ id: '1' }),
  findOne: vi.fn().mockResolvedValue({}),
});

type Section = { name: string; label: string; columns?: number; fields: unknown[] };

/** HotCRM `crm_lead`'s shape, reduced: a 2 / 3 / 1 mixed form with a `span: 'full'` field. */
const MIXED: Section[] = [
  { name: 'contact', label: 'Contact', columns: 2, fields: ['c1', 'c2', { field: 'full', span: 'full' }, 'c3', 'c4'] },
  { name: 'classification', label: 'Classification', columns: 3, fields: ['q1', 'q2', 'q3'] },
  { name: 'notes', label: 'Notes', columns: 1, fields: ['d1', 'd2'] },
];

const single = (columns: number): Section[] => [
  { name: 'contact', label: 'Contact', columns, fields: ['c1', 'c2', { field: 'full', span: 'full' }, 'c3'] },
  { name: 'classification', label: 'Classification', columns, fields: ['q1', 'q2', 'q3'] },
];

type Host = 'modal' | 'object' | 'split' | 'tabbed' | 'wizard';

function mount(host: Host, sections: Section[], extra: Record<string, unknown> = {}) {
  const schema = {
    type: 'object-form',
    objectName: 'lead',
    mode: 'create',
    title: 'New Lead',
    sections,
    ...extra,
  } as any;
  const ds = makeDataSource();
  switch (host) {
    case 'modal':
      return render(<ModalForm schema={{ ...schema, formType: 'modal' }} dataSource={ds} />);
    case 'object':
      return render(<ObjectForm schema={schema} dataSource={ds} />);
    case 'split':
      return render(<SplitForm schema={{ ...schema, formType: 'split' }} dataSource={ds} />);
    case 'tabbed':
      return render(<TabbedForm schema={{ ...schema, formType: 'tabbed' }} dataSource={ds} />);
    case 'wizard':
      return render(<WizardForm schema={{ ...schema, formType: 'wizard' }} dataSource={ds} />);
  }
}

/** The grid classes of the container holding `name`, and that field's own span classes. */
function readField(name: string): { grid: string[]; span: string[] } {
  const cell = document.body.querySelector(`[data-field="${name}"]`);
  if (!cell) throw new Error(`field not rendered: ${name}`);
  const tokens = (el: Element | null) => (el?.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  return {
    grid: tokens(cell.parentElement).filter((t) => /(^|:)grid-cols-/.test(t)),
    span: tokens(cell).filter((t) => /(^|:)col-span-/.test(t)),
  };
}

async function settle(name: string) {
  await waitFor(() => expect(document.body.querySelector(`[data-field="${name}"]`)).not.toBeNull());
}

// The multi-column tiers of a container-query grid, narrowest first. A
// field's count per row at a tier is (tracks in force there) / (its span in
// force there); Tailwind's prefixes are min-width, so the class in force at a
// tier is the widest-prefixed one at or below it.
const TIERS = ['@md', '@2xl', '@4xl'] as const;
function perRowAt(read: { grid: string[]; span: string[] }, tier: (typeof TIERS)[number]): number {
  const upTo = TIERS.slice(0, TIERS.indexOf(tier) + 1);
  const inForce = (list: string[], stem: string) => {
    let v: number | undefined;
    for (const t of upTo) {
      const hit = list.find((c) => c.startsWith(`${t}:${stem}`));
      if (hit) v = Number(hit.split('-').pop());
    }
    return v;
  };
  const tracks = inForce(read.grid, 'grid-cols-') ?? 1;
  const span = inForce(read.span, 'col-span-') ?? 1;
  return tracks / span;
}

const HOSTS: Host[] = ['modal', 'object', 'split', 'tabbed'];

describe('objectui#12548 — a 2 / 3 / 1 mixed form draws 2 / 3 / 1 per row', () => {
  for (const host of HOSTS) {
    it(`${host}: each section at its own count, span: 'full' takes the row`, async () => {
      mount(host, MIXED);
      await settle('d2');
      const c1 = readField('c1');
      const q1 = readField('q1');
      const d1 = readField('d1');
      const full = readField('full');

      // Below `@md` the grid is one column (the base class), whatever the section.
      expect(c1.grid).toContain('grid-cols-1');

      // At the widest tier each section reads its authored count.
      expect(perRowAt(c1, '@4xl'), 'columns: 2 section').toBe(2);
      expect(perRowAt(q1, '@4xl'), 'columns: 3 section').toBe(3);
      expect(perRowAt(d1, '@4xl'), 'columns: 1 section').toBe(1);
      expect(perRowAt(full, '@4xl'), "span: 'full'").toBe(1);

      // `@md` is where multi-column starts: two per row there for the 2- and
      // 3-column sections (the 3-column step ladder 2 → 3 at `@2xl` is kept).
      expect(perRowAt(c1, '@md')).toBe(2);
      expect(perRowAt(q1, '@md')).toBe(2);
      expect(perRowAt(q1, '@2xl')).toBe(3);
      expect(perRowAt(c1, '@2xl')).toBe(2);
      expect(perRowAt(d1, '@md')).toBe(1);
      expect(perRowAt(full, '@md')).toBe(1);
    });
  }

  it('wizard: a form-level grid wider than the step draws the step at its own count', async () => {
    // A wizard shows one section per step and sizes its grid from the form
    // `columns`, else the step's own — so a mix only arises under a form-level
    // `columns` wider than the step.
    mount('wizard', MIXED, { columns: 3 });
    await settle('c4');
    expect(perRowAt(readField('c1'), '@4xl')).toBe(2);
    expect(perRowAt(readField('c1'), '@md')).toBe(2);
    expect(perRowAt(readField('full'), '@4xl')).toBe(1);
  });

  it('a 3-column section beside a 4-column one draws three per row, not four', async () => {
    mount('modal', [
      { name: 'a', label: 'A', columns: 4, fields: ['c1', 'c2', 'c3', 'c4'] },
      { name: 'b', label: 'B', columns: 3, fields: ['q1', 'q2', 'q3'] },
    ]);
    await settle('q3');
    expect(perRowAt(readField('q1'), '@4xl')).toBe(3);
    // The 4-column section keeps its own step ladder: 2 → 3 → 4.
    expect(perRowAt(readField('c1'), '@md')).toBe(2);
    expect(perRowAt(readField('c1'), '@2xl')).toBe(3);
    expect(perRowAt(readField('c1'), '@4xl')).toBe(4);
  });
});

/**
 * CONTROL — a single-density form keeps the grid it always had. The literal
 * classes below are the ones `main` drew before objectui#12548; they must not
 * move.
 */
describe('objectui#12548 CONTROL — single-density forms are byte-identical', () => {
  const BEFORE: Record<number, { grid: string[]; plain: string[]; full: string[] }> = {
    2: { grid: ['grid-cols-1', '@md:grid-cols-2'], plain: [], full: ['@md:col-span-2'] },
    3: {
      grid: ['grid-cols-1', '@md:grid-cols-2', '@2xl:grid-cols-3'],
      plain: [],
      full: ['@md:col-span-2', '@2xl:col-span-3'],
    },
  };
  for (const host of HOSTS) {
    for (const columns of [2, 3]) {
      it(`${host}: all sections columns: ${columns}`, async () => {
        mount(host, single(columns));
        await settle('q3');
        const c1 = readField('c1');
        expect(c1.grid).toEqual(BEFORE[columns].grid);
        expect(c1.span).toEqual(BEFORE[columns].plain);
        expect(readField('q1').span).toEqual(BEFORE[columns].plain);
        expect(readField('full').span).toEqual(BEFORE[columns].full);
      });
    }
  }
});

describe('objectui#12548 — the 12-track ladder matches the 1–4 grids, density by density', () => {
  // The drift guard between the two halves of this card: the renderer's
  // twelfths table hard-codes the step ladder of the 1–4 container classes,
  // so read the tiers out of `CONTAINER_GRID_COLS[4]` and require every
  // density to draw `min(columns, tier)` per row at each of them.
  const tiers = Array.from(CONTAINER_GRID_COLS[4]!.matchAll(/(@\w+):grid-cols-(\d+)/g)).map((m) => ({
    tier: m[1] as (typeof TIERS)[number],
    cols: Number(m[2]),
  }));

  it('reads the same three tiers this file measures', () => {
    expect(tiers.map((t) => t.tier)).toEqual([...TIERS]);
  });

  for (const columns of [1, 2, 3, 4]) {
    it(`a columns: ${columns} section on the 12-track grid`, () => {
      const grid = sectionedGridLayout(4, [4, 3, 2, 1]);
      expect(grid.fieldContainerClass).toBe(TWELVE_TRACK_GRID_COLS);
      const [field] = grid.layOut([{ name: 'x', label: 'X', type: 'input' }] as FormField[], columns);
      const Form = ComponentRegistry.get('form')!;
      render(
        <Form
          schema={{
            type: 'form',
            showSubmit: false,
            showCancel: false,
            fields: [field],
            columns: grid.columns,
            fieldContainerClass: grid.fieldContainerClass,
          }}
        />,
      );
      for (const { tier, cols } of tiers) {
        expect(perRowAt(readField('x'), tier), `${tier}`).toBe(Math.min(columns, cols));
      }
    });
  }
});

describe('objectui#12548 — sectionedGridLayout (the one rule)', () => {
  const f = (over: Partial<FormField> & Record<string, unknown> = {}) =>
    ({ name: 'x', label: 'X', type: 'input', ...over }) as FormField;

  it('keeps the 1–4 grid and applyAutoColSpan when every section is 1 or the grid width', () => {
    for (const [cols, sections] of [
      [2, [2, 2]],
      [3, [3, 1, undefined]],
      [4, [4, 1]],
    ] as const) {
      const grid = sectionedGridLayout(cols, sections);
      expect(grid.fieldContainerClass).toBe(CONTAINER_GRID_COLS[cols]);
      const fields = [f(), f({ name: 'y', span: 'full' }), f({ name: 'z', colSpan: 2 })];
      for (const s of sections) {
        expect(grid.layOut(fields, s)).toEqual(applyAutoColSpan(fields, cols, s));
      }
    }
  });

  it('leaves a one-column form alone', () => {
    const grid = sectionedGridLayout(1, [1]);
    expect(grid.fieldContainerClass).toBeUndefined();
    const fields = [f()];
    expect(grid.layOut(fields, 1)).toBe(fields);
  });

  it('switches to twelfths when a section count is neither 1 nor the grid width', () => {
    const grid = sectionedGridLayout(3, [2, 3, 1]);
    expect(grid.fieldContainerClass).toBe(TWELVE_TRACK_GRID_COLS);
    expect(grid.columns).toBe(3);
    expect(grid.layOut([f()], 2)[0].colSpan).toBe(6);
    expect(grid.layOut([f()], 3)[0].colSpan).toBe(4);
    expect(grid.layOut([f()], 1)[0].colSpan).toBe(12);
    // A section that declares nothing fills the form's DECLARED grid, as it
    // always did; with no form `columns` it draws two (objectui#12592).
    expect(grid.layOut([f()], undefined)[0].colSpan).toBe(4);
  });

  it('an undeclared section draws two when the form declares no columns (objectui#12592)', () => {
    expect(sectionedGridLayout(undefined, [undefined, undefined]).fieldContainerClass).toBe(
      CONTAINER_GRID_COLS[2],
    );
    const mixed = sectionedGridLayout(undefined, [undefined, 3]);
    expect(mixed.columns).toBe(3);
    expect(mixed.fieldContainerClass).toBe(TWELVE_TRACK_GRID_COLS);
    expect(mixed.layOut([f()], undefined)[0].colSpan).toBe(6);
    // A declared 1 is drawn as written, never read as undeclared.
    expect(sectionedGridLayout(undefined, [1, 1]).fieldContainerClass).toBeUndefined();
  });

  it("span: 'full' and a wide widget take the row; an authored colSpan keeps winning", () => {
    const grid = sectionedGridLayout(3, [2, 3]);
    expect(grid.layOut([f({ span: 'full' })], 3)[0].colSpan).toBe(12);
    expect(grid.layOut([f({ type: 'field:textarea' })], 2)[0].colSpan).toBe(12);
    expect(grid.layOut([f({ colSpan: 2 })], 3)[0].colSpan).toBe(8);
    // Clamped to the section's own columns.
    expect(grid.layOut([f({ colSpan: 4 })], 2)[0].colSpan).toBe(12);
  });

  it('clamps a section count to the form grid — the form view outranks it', () => {
    const grid = sectionedGridLayout(2, [4]);
    expect(grid.fieldContainerClass).toBe(CONTAINER_GRID_COLS[2]);
  });

  it('never touches a section-divider row', () => {
    const divider = { name: '__s', type: 'section-divider', colSpan: 4 } as unknown as FormField;
    expect(sectionedGridLayout(3, [2, 3]).layOut([divider], 2)[0]).toBe(divider);
  });
});
