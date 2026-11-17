/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#34607 — a dialog whose author declared no
 * `columns` spreads a field-heavy form across its width: three per row in a
 * bounded dialog, four in a `full` one, one on a phone. A declared `columns`
 * is drawn as written, and every page host draws what it drew before.
 *
 * The count is `dialogUndeclaredColumns` (`autoLayout.ts`): `inferColumns` of
 * the fields laid out, at least two (the dialog's earlier default,
 * objectui#12521), at most three unless the dialog is `full`. The bounded
 * `xl` dialog's field container reaches the `@4xl` tier (64rem less the
 * scroller's 3rem of padding is 61rem, over 56rem), so the cap — not the
 * container — is what keeps a bounded dialog at three.
 *
 * jsdom evaluates no container query, so a count per row is read from the
 * classes the real form renderer draws: at each tier, the grid tracks in force
 * over the field's span in force (the reading `undeclaredSectionDensity-12592`
 * uses).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import '@object-ui/components';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';
import {
  dialogUndeclaredColumns,
  sectionedGridLayout,
  UNDECLARED_SECTION_COLUMNS,
} from '../autoLayout';

registerAllFields();

afterEach(() => cleanup());

const PLAIN = Array.from({ length: 14 }, (_, i) => `f${i}`);

/** Sixteen fields, no layout declared: fourteen plain ones, a textarea and a markdown body. */
const SIXTEEN = {
  name: 'thing',
  fields: {
    ...Object.fromEntries(PLAIN.map((n) => [n, { type: 'text', label: `Field ${n}` }])),
    notes: { type: 'textarea', label: 'Notes' },
    body: { type: 'markdown', label: 'Body' },
  },
};

/** Five plain fields: a light form. */
const FIVE = {
  name: 'thing',
  fields: Object.fromEntries(PLAIN.slice(0, 5).map((n) => [n, { type: 'text', label: `Field ${n}` }])),
};

const ds = (def: unknown): any => ({
  getObjectSchema: vi.fn().mockResolvedValue(def),
  findOne: vi.fn().mockResolvedValue({}),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
});

type Def = { fields: Record<string, unknown> };

function schemaFor(def: Def, extra: Record<string, unknown>) {
  return {
    type: 'object-form',
    objectName: 'thing',
    mode: 'create',
    fields: Object.keys(def.fields),
    ...extra,
  } as any;
}

async function settle(name: string) {
  await waitFor(() => expect(document.body.querySelector(`[data-field="${name}"]`)).not.toBeNull());
}

async function openDialog(def: Def, extra: Record<string, unknown> = {}) {
  render(<ModalForm schema={{ ...schemaFor(def, extra), formType: 'modal', open: true }} dataSource={ds(def)} />);
  await settle('f0');
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

async function openPage(def: Def, extra: Record<string, unknown> = {}) {
  render(<ObjectForm schema={schemaFor(def, extra)} dataSource={ds(def)} />);
  await settle('f0');
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

const TIERS = ['@md', '@2xl', '@4xl'] as const;

/** Fields per row at a container tier: tracks in force / span in force (min-width prefixes). */
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
  return (inForce(read.grid, 'grid-cols-') ?? 1) / (inForce(read.span, 'col-span-') ?? 1);
}

/** Per row at `@md` / `@2xl` / `@4xl`. */
const ladder = (name: string) => {
  const read = readField(name);
  return TIERS.map((t) => perRowAt(read, t));
};

/** Below `@md`: only unprefixed `grid-cols-*` classes apply. */
const belowMd = (name: string) => readField(name).grid.filter((t) => !t.includes(':'));

const TWO_SECTIONS = [
  { name: 'a', label: 'A', fields: PLAIN.slice(0, 8) },
  { name: 'b', label: 'B', fields: [...PLAIN.slice(8), 'notes', 'body'] },
];

describe('#34607 acceptance 1 — sixteen undeclared fields: three in an xl dialog, four in a full one, one on a phone', () => {
  it('the inferred dialog is the bounded xl, and draws three per row from @2xl, never four', async () => {
    const dialog = await openDialog(SIXTEEN);
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(ladder('f0')).toEqual([2, 3, 3]);
  });

  it("the full dialog (an authored modalSize: 'full') reaches four per row at @4xl", async () => {
    const dialog = await openDialog(SIXTEEN, { modalSize: 'full' });
    expect(dialog.className).toContain('sm:max-w-[95vw]');
    expect(ladder('f0')).toEqual([2, 3, 4]);
  });

  it('below @md the grid is one column, in either size', async () => {
    await openDialog(SIXTEEN);
    expect(belowMd('f0')).toEqual(['grid-cols-1']);
    expect(readField('f0').span.filter((t) => !t.includes(':'))).toEqual([]);
    cleanup();
    await openDialog(SIXTEEN, { modalSize: 'full' });
    expect(belowMd('f0')).toEqual(['grid-cols-1']);
  });

  it('item 3 — the wide kinds take the whole row at every tier, four-wide grid included', async () => {
    await openDialog(SIXTEEN, { modalSize: 'full' });
    expect(ladder('notes')).toEqual([1, 1, 1]);
    expect(ladder('body')).toEqual([1, 1, 1]);
  });
});

describe('#34607 acceptance 2 — a declared columns is drawn as written', () => {
  it('a declared columns: 2 stays two per row, in xl and in full', async () => {
    await openDialog(SIXTEEN, { columns: 2 });
    expect(ladder('f0')).toEqual([2, 2, 2]);
    cleanup();
    await openDialog(SIXTEEN, { columns: 2, modalSize: 'full' });
    expect(ladder('f0')).toEqual([2, 2, 2]);
  });

  it('a declared columns: 1 stays one per row', async () => {
    await openDialog(SIXTEEN, { columns: 1 });
    expect(ladder('f0')).toEqual([1, 1, 1]);
  });

  it('a section declaring columns: 2 keeps two beside an undeclared section that draws three', async () => {
    await openDialog(SIXTEEN, {
      sections: [{ ...TWO_SECTIONS[0], columns: 2 }, TWO_SECTIONS[1]],
    });
    expect(ladder('f0')).toEqual([2, 2, 2]);
    expect(ladder('f8')).toEqual([2, 3, 3]);
  });
});

describe('#34607 — undeclared sections and field groups in the dialog take the same count', () => {
  it('undeclared sections: three per row in xl, four in full', async () => {
    await openDialog(SIXTEEN, { sections: TWO_SECTIONS });
    expect(ladder('f0')).toEqual([2, 3, 3]);
    expect(ladder('notes')).toEqual([1, 1, 1]);
    cleanup();
    await openDialog(SIXTEEN, { sections: TWO_SECTIONS, modalSize: 'full' });
    expect(ladder('f0')).toEqual([2, 3, 4]);
  });

  it("the object's fieldGroups with no layout: three per row in xl", async () => {
    const grouped = {
      ...SIXTEEN,
      fieldGroups: [
        { key: 'main', label: 'Main' },
        { key: 'more', label: 'More' },
      ],
      fields: Object.fromEntries(
        Object.entries(SIXTEEN.fields).map(([k, f], i) => [k, { ...f, group: i < 8 ? 'main' : 'more' }]),
      ),
    };
    await openDialog(grouped);
    expect(ladder('f0')).toEqual([2, 3, 3]);
    expect(ladder('notes')).toEqual([1, 1, 1]);
  });

  it('a light form keeps the two-wide floor in the same xl dialog', async () => {
    const dialog = await openDialog(FIVE);
    expect(dialog.className).toContain('sm:max-w-5xl');
    expect(ladder('f0')).toEqual([2, 2, 2]);
  });
});

describe('#34607 CONTROL — the page hosts draw what they drew before', () => {
  it('ObjectForm sectioned, every section undeclared: still two per row (UNDECLARED_SECTION_COLUMNS)', async () => {
    await openPage(SIXTEEN, { sections: TWO_SECTIONS });
    expect(ladder('f0')).toEqual([2, 2, 2]);
    expect(belowMd('f0')).toEqual(['grid-cols-1']);
  });

  it("ObjectForm flat: still the page's own inference (sixteen fields → four, on the renderer's viewport grid)", async () => {
    await openPage(SIXTEEN);
    expect(readField('f0').grid).toEqual(['md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4']);
  });

  it('sectionedGridLayout with no third argument is the shared rule the page hosts call', () => {
    expect(UNDECLARED_SECTION_COLUMNS).toBe(2);
    const shared = sectionedGridLayout(undefined, [undefined, undefined]);
    expect(shared.columns).toBe(2);
    expect(shared.fieldContainerClass).toBe('grid gap-4 grid-cols-1 @md:grid-cols-2');
    const mixed = sectionedGridLayout(undefined, [undefined, 3]);
    expect(mixed.columns).toBe(3);
    expect(mixed.fieldContainerClass).toBe('grid gap-4 grid-cols-1 @md:grid-cols-12');
  });
});

describe('#34607 dialogUndeclaredColumns', () => {
  it('floors at two, follows inferColumns, caps at three unless full', () => {
    expect([1, 3, 8].map((n) => dialogUndeclaredColumns(n, 'xl'))).toEqual([2, 2, 2]);
    expect([9, 15, 16, 40].map((n) => dialogUndeclaredColumns(n, 'xl'))).toEqual([3, 3, 3, 3]);
    expect([9, 15, 16, 40].map((n) => dialogUndeclaredColumns(n, 'full'))).toEqual([3, 3, 4, 4]);
    expect(dialogUndeclaredColumns(16, 'lg')).toBe(3);
  });
});
