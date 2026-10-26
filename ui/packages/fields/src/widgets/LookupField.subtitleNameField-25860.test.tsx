/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The quick-picker's subtitle never repeats the field the option's title reads.
 *
 * A lookup that declares no `displayField` titles each option through the
 * referenced object's own name field (`getRecordDisplayName`), while the
 * subtitle skipped only the widget's `'name'` guess. On an object whose name
 * field is anything else — `title`, `customer_name`, every AI-built object —
 * the subtitle's first, widest slot repeated the title and pushed the field
 * that tells two records apart (the phone number) into truncation.
 *
 * The subtitle now skips the field the title resolved from: the declared
 * `displayField`, else the object's resolved name field — unless a
 * `titleFormat` template, not a field, titles the record.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LookupField } from './LookupField';

const FIELDS: Record<string, { type: string; label: string }> = {
  title: { type: 'text', label: 'Customer Name' },
  phone: { type: 'phone', label: 'Phone' },
  source: { type: 'text', label: 'Source' },
  code: { type: 'text', label: 'Code' },
};

const ROWS: Record<string, unknown>[] = [
  { id: 'c1', title: 'Wang Jing', phone: '18624570001', source: 'Store', code: 'C-001' },
  { id: 'c2', title: 'Zhou Mingxuan', phone: '18624570002', source: 'Web', code: 'C-002' },
];

function makeBackend(decl: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
    findOne: vi.fn(async (_o: string, id: string) => ROWS.find((r) => r.id === id) ?? null),
    getObjectSchema: vi.fn(async (objectName: string) => ({ name: objectName, fields: FIELDS, ...decl })),
  } as any;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/**
 * Open the dropdown and read, per option, its title and the fields its
 * subtitle previews, in order.
 */
async function openPicker(
  decl: Record<string, unknown>,
  field: Record<string, unknown> = {},
): Promise<Array<{ title: string; preview: string[] }>> {
  const ds = makeBackend(decl);
  render(
    <LookupField
      value={undefined}
      onChange={() => {}}
      dataSource={ds}
      field={{ reference: 'customer', ...field } as never}
    />,
  );
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('customer'));
  await settle();
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  await settle();
  return screen.getAllByRole('option').map((el) => ({
    title: el.getAttribute('title') ?? '',
    preview: Array.from(el.querySelectorAll<HTMLElement>('[data-lookup-preview]')).map(
      (v) => v.dataset.lookupPreview ?? '',
    ),
  }));
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField subtitle skips the field the title reads', () => {
  it("the object declares nameField 'title': the subtitle starts with the phone, not the title again", async () => {
    const options = await openPicker({ nameField: 'title' });
    expect(options.map((o) => o.title)).toEqual(['Wang Jing', 'Zhou Mingxuan']);
    for (const o of options) expect(o.preview).toEqual(['phone', 'source']);
  });

  it("no nameField declared: the derived name field 'title' is skipped the same way", async () => {
    const options = await openPicker({});
    expect(options.map((o) => o.title)).toEqual(['Wang Jing', 'Zhou Mingxuan']);
    for (const o of options) expect(o.preview).toEqual(['phone', 'source']);
  });

  it('an explicitly authored descriptionField still leads the subtitle', async () => {
    const options = await openPicker({ nameField: 'title' }, { descriptionField: 'source' });
    for (const o of options) expect(o.preview).toEqual(['source', 'phone']);
  });

  it("control: a declared displayField titles the option, so the object's name field stays in the subtitle", async () => {
    const options = await openPicker({ nameField: 'title' }, { displayField: 'code' });
    expect(options.map((o) => o.title)).toEqual(['C-001', 'C-002']);
    for (const o of options) expect(o.preview).toEqual(['title', 'phone', 'source']);
  });

  it('control: a titleFormat template titles the record, so the derived field stays in the subtitle', async () => {
    const options = await openPicker({ titleFormat: '{code} / {source}' });
    expect(options.map((o) => o.title)).toEqual(['C-001 / Store', 'C-002 / Web']);
    for (const o of options) expect(o.preview).toEqual(['title', 'phone', 'source']);
  });
});
