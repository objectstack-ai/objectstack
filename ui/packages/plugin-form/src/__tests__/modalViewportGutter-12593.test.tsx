/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bounded wide dialog sizes keep a viewport gutter from `sm` up
 * (objectui#12593).
 *
 * `lg` (`sm:max-w-2xl`, 672px) and `xl` (`sm:max-w-5xl`, 1024px) took the
 * dialog primitive's `w-full`, so on a window between `sm` (640px) and the max
 * width the dialog was as wide as the window, at x = 0. Both now read ONE
 * shared class, a width of the window less 1rem on each side, under their own
 * `max-w`.
 *
 * ## What it reads
 *
 * The real `ModalForm`, mounted as `AppContent` mounts it, and the class list
 * on the dialog element after `tailwind-merge` has resolved it against
 * `MobileDialogContent`'s base classes. jsdom computes no layout, so the pins
 * read classes. The rendered widths are a Chromium reading, recorded on the
 * pull request, not here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ModalForm, type ModalFormSchema } from '../ModalForm';

registerAllFields();

afterEach(() => cleanup());

/** The shared gutter: the window less 1rem on each side, from `sm` up. */
const GUTTER = 'sm:w-[calc(100%-2rem)]';
/** Any width class written for the `sm` tier and up. */
const isSmWidth = (t: string) => t.startsWith('sm:w-');

const TWO = {
  name: 'thing',
  fields: {
    name: { type: 'text', label: 'Name' },
    code: { type: 'text', label: 'Code' },
  },
};

const opt = (v: string) => [{ label: v, value: v }];

/** Twelve plain fields plus one textarea: the default size answers `xl`. */
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

const ds = (def: unknown) => ({
  getObjectSchema: vi.fn().mockResolvedValue(def),
  findOne: vi.fn().mockResolvedValue({}),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
}) as unknown as DataSource;

/** Mount the dialog, wait for its fields, and return its class tokens. */
async function dialogTokens(
  def: { fields: Record<string, unknown> },
  modalSize?: ModalFormSchema['modalSize'],
): Promise<string[]> {
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
        ...(modalSize ? { modalSize } : {}),
      }}
      dataSource={ds(def)}
    />,
  );
  await waitFor(() => {
    if (!document.body.querySelector(`[name="${first}"]`)) throw new Error('form not drawn yet');
  });
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  const tokens = dialog.className.split(/\s+/).filter(Boolean);
  cleanup();
  return tokens;
}

const minus = (a: string[], b: string[]) => a.filter((t) => !b.includes(t)).sort();

describe('the bounded wide sizes keep a viewport gutter from sm up (objectui#12593)', () => {
  it('lg and xl both carry the one shared gutter, under their own max width', async () => {
    const lg = await dialogTokens(TWO, 'lg');
    const xl = await dialogTokens(TWO, 'xl');

    expect(lg).toContain('sm:max-w-2xl');
    expect(xl).toContain('sm:max-w-5xl');
    // One value, read by both: the same single sm-tier width on each.
    expect(lg.filter(isSmWidth)).toEqual([GUTTER]);
    expect(xl.filter(isSmWidth)).toEqual([GUTTER]);
    // tailwind-merge kept the size's max width over the primitive's base one.
    expect(lg).not.toContain('sm:max-w-lg');
    expect(xl).not.toContain('sm:max-w-lg');
  });

  it('a field-heavy dialog with no authored size, the console\'s New and Edit, carries it', async () => {
    const heavy = await dialogTokens(TWELVE);
    expect(heavy).toContain('sm:max-w-5xl');
    expect(heavy.filter(isSmWidth)).toEqual([GUTTER]);
  });

  it('below sm nothing changes: against default, lg and xl differ only in sm-tier classes', async () => {
    const def = await dialogTokens(TWO, 'default');
    const lg = await dialogTokens(TWO, 'lg');
    const xl = await dialogTokens(TWO, 'xl');

    expect(minus(lg, def)).toEqual([GUTTER, 'sm:max-w-2xl'].sort());
    expect(minus(xl, def)).toEqual([GUTTER, 'sm:max-w-5xl'].sort());
    expect(minus(def, lg)).toEqual(['sm:max-w-lg']);
    expect(minus(def, xl)).toEqual(['sm:max-w-lg']);
    for (const added of [...minus(lg, def), ...minus(xl, def)]) {
      expect(added.startsWith('sm:')).toBe(true);
    }
    // The phone sheet and the height rules are still on both.
    for (const tokens of [lg, xl]) {
      expect(tokens).toEqual(
        expect.arrayContaining(['fixed', 'inset-0', 'w-full', 'h-[100dvh]', 'sm:h-auto', 'sm:max-h-[90vh]']),
      );
    }
  });

  it('CONTROL: sm, default and full are unchanged and read no gutter', async () => {
    const sm = await dialogTokens(TWO, 'sm');
    const def = await dialogTokens(TWO, 'default');
    const full = await dialogTokens(TWO, 'full');

    expect(sm).toContain('sm:max-w-sm');
    expect(sm.filter(isSmWidth)).toEqual([]);
    expect(def).toContain('sm:max-w-lg');
    expect(def.filter(isSmWidth)).toEqual([]);
    expect(full).toContain('sm:max-w-[95vw]');
    expect(full.filter(isSmWidth)).toEqual(['sm:w-full']);
  });
});
