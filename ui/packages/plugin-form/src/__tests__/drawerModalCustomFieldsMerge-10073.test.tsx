/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.customFields` MERGES on every `formType` arm (objectui#10073).
 *
 * The registered description is one sentence for the whole block: "Field
 * definitions merged over the set generated from object metadata." objectui#9778
 * made the default arm honour it (pinned by `objectFormCustomFieldsMembers-8071`);
 * the `drawer` and `modal` arms hand the whole schema to `DrawerForm` /
 * `ModalForm`, which REPLACED the generated set with the members. The merge rule
 * now has one spelling, `customFieldsMerge.ts`, called from all three arms.
 *
 * Every row runs through the real `ObjectForm` with the arm's `formType`, the
 * path an author reaches, and runs on all three arms:
 *
 *   OVERRIDE — a member naming a declared field is that field's whole
 *              definition, in the generated set's position;
 *   KEEP     — a declared field no member names renders with the object's label;
 *   APPEND   — a member naming nothing declared comes after the generated set,
 *              in authored order;
 *   NO DATA SOURCE — the members are the only field source;
 *   FIELD GROUPS — `customFields` does not switch the object's `fieldGroups`
 *              fallback off; the groups are derived over the merged set, and an
 *              overriding member renders its own definition inside its group.
 *
 * The `simple` rows are the lit control: that arm already merged before this
 * card, so they prove the extraction into the shared helper did not move it.
 * On the pre-fix tree the `drawer` / `modal` rows of OVERRIDE, KEEP, APPEND and
 * FIELD GROUPS are red (the members were the whole set and the group fallback
 * was off), and the `simple` rows are green.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

const GROUPED_SCHEMA = {
  name: 'ticket',
  fieldGroups: [
    { key: 'basic', label: 'Basic Info' },
    { key: 'tracking', label: 'Tracking Info' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', group: 'basic' },
    assignee: { type: 'text', label: 'Assignee', group: 'basic' },
    status_note: { type: 'text', label: 'Status Note', group: 'tracking' },
    channel: { type: 'text', label: 'Channel', group: 'tracking' },
  },
};

const makeDataSource = (objectSchema: unknown = OBJECT_SCHEMA) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

const ARMS = ['simple', 'drawer', 'modal'] as const;
type Arm = (typeof ARMS)[number];

/** The drawer and modal portal their content, so every read is off `document.body`. */
const drawnFields = (): string[] =>
  [...document.body.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

const labelOf = (name: string): string | null =>
  document.body.querySelector(`[data-field="${name}"] label`)?.textContent ?? null;

async function mount(arm: Arm, schema: Record<string, unknown>, adapter: any = makeDataSource()) {
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

describe.each(ARMS)('`object-form` `formType: %s` — `customFields` merges over the generated set', (arm) => {
  it('OVERRIDE — a member replaces the declared field in place, and the metadata is fetched', async () => {
    const { adapter, unmount } = await mount(arm, {
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }],
    });
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice');
    expect(
      drawnFields(),
      'one member, three declared fields: the member takes `note`\'s position, it does not become the set',
    ).toEqual(['customer', 'note', 'amount']);
    expect(labelOf('note'), 'the member supplies the whole definition').toBe('INLINE NOTE');
    unmount();
  });

  it('KEEP — a declared field no member names renders with the label the object gave it', async () => {
    const { unmount } = await mount(arm, {
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }],
    });
    expect(labelOf('customer')).toBe('Customer');
    expect(labelOf('amount')).toBe('Amount');
    unmount();
  });

  it('APPEND — members naming nothing declared come after the generated set, in authored order', async () => {
    const { unmount } = await mount(arm, {
      customFields: [
        { name: 'zz', label: 'Brand new', type: 'text' },
        { name: 'yy', label: 'Also new', type: 'text' },
      ],
    });
    expect(drawnFields()).toEqual(['customer', 'note', 'amount', 'zz', 'yy']);
    expect(labelOf('zz')).toBe('Brand new');
    unmount();
  });

  it('NO DATA SOURCE — the members are the only field source', async () => {
    const { unmount } = await mount(
      arm,
      { customFields: [{ name: 'zz', label: 'Inline only', type: 'text' }] },
      null,
    );
    expect(drawnFields()).toEqual(['zz']);
    expect(labelOf('zz')).toBe('Inline only');
    unmount();
  });

  it('FIELD GROUPS — the object\'s `fieldGroups` still derive sections, over the merged set', async () => {
    const { unmount } = await mount(
      arm,
      {
        objectName: 'ticket',
        customFields: [{ name: 'channel', label: 'INLINE CHANNEL', type: 'text', group: 'tracking' }],
      },
      makeDataSource(GROUPED_SCHEMA),
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain('Basic Info');
      expect(document.body.textContent).toContain('Tracking Info');
    });
    expect(drawnFields()).toEqual(['title', 'assignee', 'status_note', 'channel']);
    expect(labelOf('channel'), 'the member renders inside its group as its own definition').toBe(
      'INLINE CHANNEL',
    );
    expect(labelOf('title'), 'a field no member names keeps the object\'s definition').toBe('Title');
    unmount();
  });
});
