/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `file` field with `multiple: true` takes the full row of the detail grid
 * (objectstack#32746).
 *
 * The sighting: an expense claim carries its e-invoices in one multi-file
 * field, and in a half-width cell every file name was cut short, so the
 * approver could not tell the invoices apart. The detail panel gives the
 * author no width key, so the auto layout is the only lever: a multi-value
 * `file` / `image` field counts as wide. A single file field, and the wide
 * types that were wide before, keep their spans.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

afterEach(() => cleanup());

const objectSchema = {
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    invoices: { name: 'invoices', type: 'file', label: 'Invoices', multiple: true },
    receipt: { name: 'receipt', type: 'file', label: 'Receipt' },
    photos: { name: 'photos', type: 'image', label: 'Photos', multiple: true },
    notes: { name: 'notes', type: 'textarea', label: 'Notes' },
  },
};

const data = {
  title: 'Trip to Shanghai',
  amount: 1280,
  invoices: [
    { name: 'taxi-invoice-24312000000123456789.pdf', url: '/files/1' },
    { name: 'hotel-invoice-24312000000987654321.pdf', url: '/files/2' },
  ],
  receipt: { name: 'receipt.pdf', url: '/files/3' },
  photos: [{ name: 'a.png', url: '/files/4' }],
  notes: 'Client visit',
};

/**
 * The rich descriptors the running app hands the section: name, label and the
 * object's type, never `multiple` — that stays the object field's declaration.
 */
const section = {
  columns: 2,
  fields: (['title', 'amount', 'invoices', 'receipt', 'photos', 'notes'] as const).map((name) => ({
    name,
    label: objectSchema.fields[name].label,
    type: objectSchema.fields[name].type,
  })),
} as unknown as DetailViewSection;

/** The grid cell a field's label sits in — the element the span class lands on. */
const cellOf = (label: string): HTMLElement => {
  const cell = screen.getByText(label, { exact: true }).closest('div.group');
  if (!(cell instanceof HTMLElement)) throw new Error(`no grid cell for ${label}`);
  return cell;
};

const spans = (label: string): boolean => cellOf(label).className.split(/\s+/).includes('md:col-span-2');

describe('detail grid — a multi-file field spans the full row (objectstack#32746)', () => {
  it('a `file` field with `multiple: true` spans both columns', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(spans('Invoices')).toBe(true);
  });

  it('an `image` field with `multiple: true` spans both columns', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(spans('Photos')).toBe(true);
  });

  it('CONTROL: a single `file` field and a plain field keep one cell', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(spans('Receipt')).toBe(false);
    expect(spans('Title')).toBe(false);
  });

  it('CONTROL: a wide type keeps spanning the row', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(spans('Notes')).toBe(true);
  });
});
