/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The default form (no authored `sections`, laid out from the object's
 * `fieldGroups`) draws a field whenever the field's own object-level
 * `visibleWhen` holds for the record — exactly as an authored section naming
 * the same field does (objectstack#35249).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';

import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();
afterEach(cleanup);

const OBJECT_SCHEMA = {
  name: 'deal',
  fieldGroups: [
    { key: 'basics', label: 'Basics' },
    { key: 'outcome', label: 'Outcome' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', group: 'basics' },
    stage: {
      type: 'select',
      label: 'Stage',
      group: 'basics',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed Lost', value: 'closed_lost' },
        { label: 'Closed Won', value: 'closed_won' },
      ],
    },
    // TRUE for the record below.
    loss_reason: { type: 'text', label: 'Loss Reason', group: 'outcome', visibleWhen: "record.stage == 'closed_lost'" },
    // FALSE for the record below (CONTROL).
    win_reason: { type: 'text', label: 'Win Reason', group: 'outcome', visibleWhen: "record.stage == 'closed_won'" },
    // No predicate (CONTROL).
    next_step: { type: 'text', label: 'Next Step', group: 'outcome' },
  },
};

const RECORD = { id: 'd1', title: 'Stark Expansion', stage: 'closed_lost', loss_reason: 'Price', win_reason: '', next_step: '' };

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  findOne: vi.fn().mockResolvedValue(RECORD),
  create: vi.fn(),
  update: vi.fn(),
});

const AUTHORED_SECTIONS = [
  { name: 'basics', label: 'Basics', fields: ['title', 'stage'] },
  { name: 'outcome', label: 'Outcome', fields: ['loss_reason', 'win_reason', 'next_step'] },
];

const has = (name: string) => document.querySelector(`[name="${name}"]`) != null;

type Arm = { arm: string; mount: (sections?: unknown) => void };

const ARMS: Arm[] = [
  {
    arm: 'ObjectForm (simple)',
    mount: (sections) =>
      render(
        <ObjectForm
          schema={{ type: 'object-form', objectName: 'deal', mode: 'edit', recordId: 'd1', ...(sections ? { sections } : {}) } as any}
          dataSource={makeDS() as any}
        />,
      ),
  },
  {
    arm: 'ModalForm',
    mount: (sections) =>
      render(
        <ModalForm
          schema={{ type: 'object-form', formType: 'modal', objectName: 'deal', mode: 'edit', recordId: 'd1', open: true, ...(sections ? { sections } : {}) } as any}
          dataSource={makeDS() as any}
        />,
      ),
  },
  {
    arm: 'DrawerForm',
    mount: (sections) =>
      render(
        <DrawerForm
          schema={{ type: 'object-form', formType: 'drawer', objectName: 'deal', mode: 'edit', recordId: 'd1', open: true, ...(sections ? { sections } : {}) } as any}
          dataSource={makeDS() as any}
        />,
      ),
  },
];

describe.each(ARMS)('$arm — a field `visibleWhen` on the fieldGroups-derived form', ({ mount }) => {
  it('CONTROL — the authored section draws the field whose predicate holds and hides the one whose predicate is false', async () => {
    mount(AUTHORED_SECTIONS);
    await waitFor(() => expect(has('title')).toBe(true));
    expect(has('loss_reason')).toBe(true);
    expect(has('win_reason')).toBe(false);
    expect(has('next_step')).toBe(true);
  });

  it('the derived form draws the field whose predicate holds, exactly as the authored section does', async () => {
    mount();
    await waitFor(() => expect(has('title')).toBe(true));
    await waitFor(() => expect(document.body.textContent).toContain('Outcome'));
    expect(has('loss_reason'), 'visibleWhen holds for the record: the field is drawn').toBe(true);
    expect(has('win_reason'), 'CONTROL: visibleWhen is false: the field stays hidden').toBe(false);
    expect(has('next_step'), 'CONTROL: no predicate: the field is drawn').toBe(true);
  });
});
