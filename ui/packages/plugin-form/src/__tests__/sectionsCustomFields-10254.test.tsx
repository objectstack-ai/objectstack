/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.customFields` under explicit `sections`, on every arm that
 * takes them (objectui#10254).
 *
 * The registered description of `customFields` is one sentence for every
 * `formType`: "Field definitions merged over the set generated from object
 * metadata." objectui#10073 brought the drawer and modal to the default arm's
 * merge for a form with NO sections (`drawerModalCustomFieldsMerge-10073`).
 * With explicit `sections`, the `drawer`, `modal`, `tabbed`, `wizard` and
 * `split` arms still rebuilt every section member from the object schema
 * alone, so the authored member was dropped: same schema, `INLINE NOTE` on the
 * default arm, `Note` on the other five.
 *
 * What this card unifies is the BASE definition a section member starts from:
 * a member naming the field supplies the whole definition, in place of the
 * generated one, through the one lookup the default arm's merge uses
 * (`findCustomFieldMember`). What it deliberately did NOT unify is each arm's
 * section-entry override rules, which differed then (the default arm copied
 * only `visibleOn` / `colSpan` / `span` from a spec entry; the other five
 * applied `normalizeSectionField`'s full set) — no row below authors an
 * override the two rule sets answered differently. objectui#10475 later moved
 * the default arm onto the same builder; its six-arm pins are
 * `sectionEntryOverrides-10475`.
 *
 * Every row mounts the real `ObjectForm` with the arm's `formType`, the path an
 * author reaches. The `simple` rows are the default-arm control: that arm
 * already resolved section members against its merged pool, and they stay
 * green without the fix. Every schema below has ONE section, so the wizard's
 * rendered step is the section under test — and a wizard draws only its
 * current step's fields, which the `drawnFields()` equalities pin. On a tree
 * where an arm's `buildSectionFields` context does not carry `customFields`,
 * that arm's LABEL, REQUIRED, SPEC ENTRY and UNDECLARED NAME rows are red;
 * UNNAMED MEMBER is green on every arm either way (the arms already agreed
 * there, and it pins that the fix did not start drawing members no section
 * lists).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(async (_object: string, data: Record<string, unknown>) => ({ id: 'r1', ...data })),
    update: vi.fn(),
  }) as any;

const ARMS = ['simple', 'drawer', 'modal', 'tabbed', 'wizard', 'split'] as const;
type Arm = (typeof ARMS)[number];

/** The drawer and modal portal their content, so every read is off `document.body`. */
const drawnFields = (): string[] =>
  [...document.body.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

const labelOf = (name: string): string | null =>
  document.body.querySelector(`[data-field="${name}"] label`)?.textContent ?? null;

const controlOf = (name: string): HTMLInputElement | HTMLTextAreaElement | null =>
  document.body.querySelector(`[data-field="${name}"] input, [data-field="${name}"] textarea`);

const MAIN_SECTION = (fields: Array<string | Record<string, unknown>>) => [
  { name: 'main', label: 'Main', fields },
];

async function mount(arm: Arm, schema: Record<string, unknown>) {
  const adapter = makeDataSource();
  const utils = render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: 'invoice',
          mode: 'create',
          ...(arm === 'simple' ? {} : { formType: arm, open: true }),
          ...schema,
        } as any
      }
      dataSource={adapter}
    />,
  );
  await waitFor(() => {
    if (!document.body.querySelector('form [data-field]')) throw new Error('form not ready');
  });
  return { ...utils, adapter };
}

describe.each(ARMS)('`object-form` `formType: %s` — explicit `sections` draw a `customFields` member as the field', (arm) => {
  it('LABEL — a section naming a member field renders the member\'s label', async () => {
    const { unmount } = await mount(arm, {
      sections: MAIN_SECTION(['customer', 'note']),
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }],
    });
    expect(drawnFields()).toEqual(['customer', 'note']);
    expect(labelOf('note'), 'the member supplies the whole definition').toBe('INLINE NOTE');
    expect(labelOf('customer'), 'a field no member names keeps the object\'s definition').toBe('Customer');
    unmount();
  });

  it('REQUIRED — a member\'s `required` refuses an empty submit and lets a filled one through', async () => {
    const { adapter, unmount } = await mount(arm, {
      sections: MAIN_SECTION(['customer', 'note']),
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text', required: true }],
    });
    expect(controlOf('note')?.getAttribute('aria-required')).toBe('true');
    expect(controlOf('customer')?.getAttribute('aria-required'), 'the object does not require customer').toBeNull();

    const form = document.body.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(document.body.textContent).toContain('INLINE NOTE is required'));
    expect(adapter.create, 'the member\'s required refused the empty submit').not.toHaveBeenCalled();

    fireEvent.change(controlOf('note') as HTMLInputElement, { target: { value: 'filled' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('invoice', expect.objectContaining({ note: 'filled' })),
    );
    unmount();
  });

  it('SPEC ENTRY — a spec `{ field }` entry starts from the member, not the generated field', async () => {
    const { unmount } = await mount(arm, {
      // `colSpan` is a layout key both override rule sets carry; nothing here
      // restates `label`, `required` or `type`, so the member is what shows.
      sections: MAIN_SECTION(['customer', { field: 'note', colSpan: 1 }]),
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'textarea', required: true }],
    });
    expect(labelOf('note')).toBe('INLINE NOTE*');
    expect(controlOf('note')?.getAttribute('aria-required')).toBe('true');
    expect(
      controlOf('note')?.tagName,
      'the member\'s own `type` renders — the object schema\'s `text` is the generated definition\'s',
    ).toBe('TEXTAREA');
    unmount();
  });

  it('UNDECLARED NAME — a section naming a field only a member supplies renders the member', async () => {
    const { unmount } = await mount(arm, {
      sections: MAIN_SECTION(['customer', 'extra']),
      customFields: [{ name: 'extra', label: 'EXTRA', type: 'text' }],
    });
    expect(drawnFields()).toEqual(['customer', 'extra']);
    expect(labelOf('extra')).toBe('EXTRA');
    unmount();
  });

  it('UNNAMED MEMBER — a member no section lists is not drawn under explicit sections', async () => {
    const { unmount } = await mount(arm, {
      sections: MAIN_SECTION(['customer', 'note']),
      customFields: [
        { name: 'extra', label: 'EXTRA', type: 'text' },
        { name: 'amount', label: 'INLINE AMOUNT', type: 'text' },
      ],
    });
    expect(
      drawnFields(),
      'sections draw what they list — neither an appended member nor an overriding one',
    ).toEqual(['customer', 'note']);
    unmount();
  });
});
