/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#34668 — in the form auto-layout a `file` /
 * `image` field whose OBJECT field declares `multiple: true` takes the whole
 * row, on the dialog and on every page host alike, mirroring plugin-detail's
 * `isWideDetailField`. A single file or image keeps one cell, an authored
 * `span` / `colSpan` is drawn as written, and `multiple` on any other type
 * (a multi-value select) changes nothing.
 *
 * jsdom evaluates no container query, so a count per row is read from the
 * classes the real form renderer draws: at each tier, the grid tracks in force
 * over the field's span in force (the reading `dialogContainerColumns-34607`
 * uses). A row of 1 at every tier is the whole row.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import type { FormField } from '@object-ui/types';
import { registerAllFields } from '@object-ui/fields';
import '@object-ui/components';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';
import { applyAutoColSpan, applyAutoLayout, resolveColSpan, sectionedGridLayout } from '../autoLayout';

registerAllFields();

afterEach(() => cleanup());

const PLAIN = Array.from({ length: 12 }, (_, i) => `f${i}`);

/**
 * Seventeen fields, no layout declared: twelve plain ones, a multi image, a
 * multi file, a single image, a single file and a multi-value select.
 */
const DEAL = {
  name: 'deal',
  fields: {
    ...Object.fromEntries(PLAIN.map((n) => [n, { type: 'text', label: `Field ${n}` }])),
    gallery: { type: 'image', label: 'Gallery', multiple: true },
    attachments: { type: 'file', label: 'Attachments', multiple: true },
    logo: { type: 'image', label: 'Logo' },
    contract: { type: 'file', label: 'Contract' },
    tags: { type: 'select', label: 'Tags', multiple: true, options: [{ label: 'A', value: 'a' }] },
  },
};

const ds = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue(DEAL),
  findOne: vi.fn().mockResolvedValue({}),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
});

const base = (extra: Record<string, unknown>) =>
  ({ type: 'object-form', objectName: 'deal', mode: 'create', fields: Object.keys(DEAL.fields), ...extra }) as any;

async function settle(name: string) {
  await waitFor(() => expect(document.body.querySelector(`[data-field="${name}"]`)).not.toBeNull());
}

async function openDialog(extra: Record<string, unknown> = {}) {
  render(<ModalForm schema={{ ...base(extra), formType: 'modal', open: true }} dataSource={ds()} />);
  await settle('gallery');
}

async function openPage(extra: Record<string, unknown> = {}) {
  render(<ObjectForm schema={base(extra)} dataSource={ds()} />);
  await settle('gallery');
}

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

/** Fields per row at `@md` / `@2xl` / `@4xl`: tracks in force / span in force. */
function ladder(name: string): number[] {
  const read = readField(name);
  return TIERS.map((tier) => {
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
  });
}

const WHOLE_ROW = [1, 1, 1];
const SECTIONS = [
  { name: 'a', label: 'A', fields: [...PLAIN.slice(0, 6), 'gallery', 'logo'] },
  { name: 'b', label: 'B', fields: [...PLAIN.slice(6), 'attachments', 'contract', 'tags'] },
];

describe('#34668 acceptance 1 — a multi file / image field takes the whole row in the dialog', () => {
  it('flat create dialog (three wide): multi image and multi file take the row at every tier', async () => {
    await openDialog();
    expect(ladder('f0')).toEqual([2, 3, 3]);
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
  });

  it("a full dialog (four wide): still the whole row", async () => {
    await openDialog({ modalSize: 'full' });
    expect(ladder('f0')).toEqual([2, 3, 4]);
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
  });

  it('undeclared sections in the dialog: the whole row', async () => {
    await openDialog({ sections: SECTIONS });
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
  });

  it("the object's fieldGroups in the dialog: the whole row", async () => {
    const grouped = {
      ...DEAL,
      fieldGroups: [
        { key: 'main', label: 'Main' },
        { key: 'files', label: 'Files' },
      ],
      fields: Object.fromEntries(
        Object.entries(DEAL.fields).map(([k, f], i) => [k, { ...f, group: i < 8 ? 'main' : 'files' }]),
      ),
    };
    render(
      <ModalForm
        schema={{ ...base({}), formType: 'modal', open: true }}
        dataSource={{ ...ds(), getObjectSchema: vi.fn().mockResolvedValue(grouped) }}
      />,
    );
    await settle('gallery');
    expect(ladder('f0')).toEqual([2, 3, 3]);
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('logo')).toEqual([2, 3, 3]);
  });

  it('a mixed-density dialog (twelve-track grid): the whole row', async () => {
    await openDialog({ sections: [{ ...SECTIONS[0], columns: 2 }, SECTIONS[1]] });
    expect(readField('gallery').grid).toContain('@md:grid-cols-12');
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
  });
});

describe('#34668 acceptance 1 — the page hosts take the same rule', () => {
  it('ObjectForm sectioned page: the whole row, beside two-per-row plain fields', async () => {
    await openPage({ sections: SECTIONS });
    expect(ladder('f0')).toEqual([2, 2, 2]);
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
    expect(ladder('logo')).toEqual([2, 2, 2]);
  });

  it('ObjectForm flat page: the multi fields span the whole inferred grid, the single ones one cell', async () => {
    await openPage();
    // Seventeen fields infer four columns on the page's viewport grid.
    const full = readField('gallery').span;
    expect(full.some((c) => c.endsWith('col-span-4'))).toBe(true);
    expect(readField('attachments').span).toEqual(full);
    expect(readField('logo').span.some((c) => c.endsWith('col-span-4'))).toBe(false);
  });

  it('TabbedForm: the whole row', async () => {
    await openPage({ formType: 'tabbed', sections: SECTIONS });
    await waitFor(() => expect(screen.queryByTestId('form-tab:b')).not.toBeNull());
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('logo')).toEqual([2, 2, 2]);
  });

  it('WizardForm: the whole row on its step', async () => {
    await openPage({ formType: 'wizard', sections: SECTIONS });
    expect(ladder('gallery')).toEqual(WHOLE_ROW);
    expect(ladder('logo')).toEqual([2, 2, 2]);
  });
});

describe('#34668 acceptance 2 — single files, authored widths and other multi types are unchanged', () => {
  it('a single image and a single file keep one cell; a multi-value select keeps one cell', async () => {
    await openDialog();
    expect(ladder('logo')).toEqual([2, 3, 3]);
    expect(ladder('contract')).toEqual([2, 3, 3]);
    expect(ladder('tags')).toEqual([2, 3, 3]);
  });

  it("an authored colSpan: 1 keeps a multi image in one cell; span: 'full' still widens a single file", async () => {
    await openDialog({
      sections: [
        { name: 'a', label: 'A', fields: [...PLAIN.slice(0, 6), { field: 'gallery', colSpan: 1 }, 'logo'] },
        { name: 'b', label: 'B', fields: [...PLAIN.slice(6), 'attachments', { field: 'contract', span: 'full' }, 'tags'] },
      ],
    });
    expect(ladder('gallery')).toEqual([2, 3, 3]);
    expect(ladder('contract')).toEqual(WHOLE_ROW);
    expect(ladder('attachments')).toEqual(WHOLE_ROW);
  });
});

describe('#34668 the rule, at the layout helpers', () => {
  const ff = (type: string, objectField?: Record<string, unknown>, extra: Partial<FormField> = {}): FormField =>
    ({ name: 'x', label: 'X', type, ...(objectField ? { field: objectField } : {}), ...extra }) as FormField;

  it('both spellings of file / image widen when the object field declares multiple: true', () => {
    for (const t of ['field:image', 'field:file', 'image', 'file']) {
      expect(resolveColSpan(ff(t, { type: 'image', multiple: true }), 3)).toBe(3);
      expect(resolveColSpan(ff(t, { type: 'image' }), 3)).toBe(1);
      expect(resolveColSpan(ff(t, { type: 'image', multiple: false }), 3)).toBe(1);
    }
  });

  it('only the object field is read: a FormField-level multiple, or no object field, keeps one cell', () => {
    expect(resolveColSpan(ff('field:image', undefined, { multiple: true }), 3)).toBe(1);
    expect(resolveColSpan(ff('field:image', { type: 'image' }, { multiple: true }), 3)).toBe(1);
  });

  it('multiple on another type changes nothing', () => {
    expect(resolveColSpan(ff('field:select', { type: 'select', multiple: true }), 3)).toBe(1);
    expect(resolveColSpan(ff('field:lookup', { type: 'lookup', multiple: true }), 3)).toBe(1);
  });

  it('an authored span / colSpan wins', () => {
    const multi = { type: 'image', multiple: true };
    expect(resolveColSpan(ff('field:image', multi, { colSpan: 1 }), 3)).toBe(1);
    expect(resolveColSpan(ff('field:image', multi, { colSpan: 2 }), 3)).toBe(2);
    expect(applyAutoColSpan([ff('field:image', multi)], 4)[0].colSpan).toBe(4);
  });

  it('applyAutoLayout (the flat drawer and page path) widens it on the inferred grid', () => {
    const fields = [
      ...PLAIN.map((n) => ff('field:text', { type: 'text' }, { name: n })),
      ff('field:image', { type: 'image', multiple: true }, { name: 'gallery' }),
      ff('field:image', { type: 'image' }, { name: 'logo' }),
    ];
    const out = applyAutoLayout(fields, { fields: {} }, undefined, 'create');
    expect(out.columns).toBe(3);
    expect(out.fields.find((f) => f.name === 'gallery')?.colSpan).toBe(3);
    expect(out.fields.find((f) => f.name === 'logo')?.colSpan).toBeUndefined();
  });

  it('the twelve-track grid gives the multi field all twelve twelfths, an authored colSpan its own', () => {
    const grid = sectionedGridLayout(undefined, [2, 3]);
    expect(grid.fieldContainerClass).toContain('@md:grid-cols-12');
    const multi = { type: 'file', multiple: true };
    expect(grid.layOut([ff('field:file', multi)], 3)[0].colSpan).toBe(12);
    expect(grid.layOut([ff('field:file', { type: 'file' })], 3)[0].colSpan).toBe(4);
    expect(grid.layOut([ff('field:file', multi, { colSpan: 1 })], 3)[0].colSpan).toBe(4);
  });
});
