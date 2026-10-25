/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11777 — on every form arm, the fields no group claims render in a
 * block of their own, not under the last group's heading.
 *
 * `@objectstack/spec`'s `deriveFieldGroupLayout` (ADR-0085 §5) emits the
 * declared groups and then a separate, untitled, TRAILING bucket. By the one
 * row rule (objectui#9849, director ruling letter E) that bucket draws no
 * divider row, and every arm flattens its sections into one field list for one
 * form, so before this card the bucket's fields continued in the same grid
 * under the previous group's heading — the filer's Studio-published object
 * drew Status, Due Date and Technician as members of "New group".
 *
 * The fix is in the form renderer (`splitAtUntitledRuns`, `@object-ui/components`),
 * which every arm below reaches; it reads the membership claim each arm's
 * heading row already carries (`projectSectionDivider`). These rows pin each
 * arm ON ITS OWN, so an arm that stopped emitting the claim would go red here
 * while its siblings stay green. Placement is the spec's and is unchanged: the
 * untitled block TRAILS the groups.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * The filer's object: one declared group holding ONE field, four fields in no
 * group. (None is named `owner` / `created_by` etc. — those are dropped as
 * system fields before the groups are derived.)
 */
const filerObject = (group: Record<string, unknown> = {}) => ({
  name: 'work_order',
  fieldGroups: [{ key: 'new_group', label: 'New group', ...group }],
  fields: {
    name: { type: 'text', label: 'Name', group: 'new_group' },
    status: { type: 'text', label: 'Status' },
    due_date: { type: 'text', label: 'Due Date' },
    problem_description: { type: 'text', label: 'Problem Description' },
    technician: { type: 'text', label: 'Technician' },
  },
});

const UNGROUPED = ['status', 'due_date', 'problem_description', 'technician'];

const makeDS = (objectSchema: unknown) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn().mockResolvedValue({ id: 'w1' }),
  update: vi.fn().mockResolvedValue({ id: 'w1' }),
  findOne: vi.fn().mockResolvedValue({ id: 'w1' }),
});

/** The one prop shape these rows hand every arm. */
type Arm = React.ComponentType<{ schema: Record<string, unknown>; dataSource: unknown }>;

const ARMS: Array<[string, Arm, string | undefined]> = [
  ['ObjectForm', ObjectForm as unknown as Arm, undefined],
  ['ModalForm', ModalForm as unknown as Arm, 'modal'],
  ['DrawerForm', DrawerForm as unknown as Arm, 'drawer'],
];

const item = (name: string) => document.body.querySelector(`[data-field="${name}"]`) as HTMLElement | null;
const blockOf = (name: string) => item(name)?.parentElement ?? null;
const headingRow = (label: string) =>
  Array.from(document.body.querySelectorAll('span'))
    .find((s) => s.textContent === label)
    ?.closest('div.col-span-full') as HTMLElement | null | undefined;
const headingBlock = (label: string) => headingRow(label)?.parentElement ?? null;

describe.each(ARMS)('%s — the ungrouped fields are their own block (objectui#11777)', (_arm, Arm, formType) => {
  const renderArm = (objectSchema: unknown, extra: Record<string, unknown> = {}) =>
    render(
      <Arm
        schema={{
          type: 'object-form',
          formType,
          objectName: 'work_order',
          mode: 'create',
          open: true,
          ...extra,
        }}
        dataSource={makeDS(objectSchema)}
      />,
    );

  const settle = () =>
    waitFor(() => {
      expect(item('technician')).not.toBeNull();
    });

  it("the filer's object: the ungrouped fields are not under the group's heading", async () => {
    renderArm(filerObject());
    await settle();

    const titled = headingBlock('New group');
    expect(titled).not.toBeNull();
    expect(blockOf('name')).toBe(titled);
    for (const n of UNGROUPED) {
      expect(titled!.contains(item(n))).toBe(false);
      expect(blockOf(n)!.textContent).not.toContain('New group');
      expect(blockOf(n)).toBe(blockOf('status'));
    }
    // Still ONE form, and the untitled block trails the group (spec placement).
    expect(document.body.querySelectorAll('form').length).toBe(1);
    expect(titled!.compareDocumentPosition(blockOf('status')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('control: no field opts into a group — the form stays flat, one block', async () => {
    const flat = filerObject();
    (flat.fields.name as Record<string, unknown>).group = undefined;
    renderArm(flat);
    await settle();

    expect(headingRow('New group')).toBeFalsy();
    for (const n of UNGROUPED) expect(blockOf(n)).toBe(blockOf('name'));
  });

  it('control: every field in a group — one block under the headings, as before', async () => {
    const allGrouped = filerObject();
    for (const def of Object.values(allGrouped.fields)) (def as Record<string, unknown>).group = 'new_group';
    renderArm(allGrouped);
    await settle();

    const titled = headingBlock('New group');
    expect(titled).not.toBeNull();
    for (const n of ['name', ...UNGROUPED]) expect(blockOf(n)).toBe(titled);
  });

  it("collapse gates only the group's own member, and the ungrouped block stays apart", async () => {
    renderArm(filerObject({ collapse: 'collapsed' }));
    await settle();

    // Collapsed: the member is out of the DOM, the ungrouped fields are not.
    expect(item('name')).toBeNull();
    for (const n of UNGROUPED) expect(item(n)).not.toBeNull();
    expect(headingBlock('New group')!.contains(item('status'))).toBe(false);

    // Opened from its own heading: the member comes back into the group's block.
    fireEvent.click(headingRow('New group')!);
    await waitFor(() => expect(item('name')).not.toBeNull());
    expect(blockOf('name')).toBe(headingBlock('New group'));
    expect(headingBlock('New group')!.contains(item('status'))).toBe(false);
  });

  it("visibleWhen gates only the group's own member", async () => {
    renderArm(filerObject({ visibleWhen: cel('1 == 2') }));
    await settle();

    expect(headingRow('New group')).toBeFalsy();
    expect(item('name')).toBeNull();
    for (const n of UNGROUPED) expect(item(n)).not.toBeNull();
  });

  it('an explicit untitled section after a titled one is its own block too', async () => {
    renderArm(filerObject(), {
      sections: [
        { name: 'curated', label: 'Curated', fields: ['name'] },
        { fields: ['status', 'technician'] },
      ],
    });
    await settle();

    const titled = headingBlock('Curated');
    expect(titled).not.toBeNull();
    expect(blockOf('name')).toBe(titled);
    expect(titled!.contains(item('status'))).toBe(false);
    expect(blockOf('technician')).toBe(blockOf('status'));
  });
});
