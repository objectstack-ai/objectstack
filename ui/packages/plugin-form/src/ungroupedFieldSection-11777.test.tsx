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
 *
 * Since objectstack#33229 the arms head the derived bucket "Other", so it is a
 * titled section sharing the grid with the groups, and these rows read "not
 * under the group's heading" off the heading above each field. The untitled
 * split itself stays pinned by the authored untitled section row below.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { I18nProvider } from '@object-ui/i18n';
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
/**
 * The drawn heading a field sits under: the last of `labels`' heading rows
 * that precedes it in document order. Since objectstack#33229 the bucket is a
 * TITLED section ("Other"), so it shares the grid with the titled groups the
 * way any two titled sections do, and "not under the group's heading" reads
 * as "under its own heading".
 */
const headingAbove = (name: string, labels: string[] = ['New group', 'Other']): string | null => {
  const el = item(name);
  if (!el) return null;
  let found: string | null = null;
  for (const label of labels) {
    const row = headingRow(label);
    if (row && row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      if (found === null || headingRow(found)!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) found = label;
    }
  }
  return found;
};

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
      expect(headingAbove(n)).toBe('Other');
      expect(blockOf(n)).toBe(blockOf('status'));
    }
    // Still ONE form, and the bucket trails the group (spec placement).
    expect(document.body.querySelectorAll('form').length).toBe(1);
    expect(headingRow('New group')!.compareDocumentPosition(headingRow('Other')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(headingAbove('status')).toBe('Other');

    // Opened from its own heading: the member comes back under the group.
    fireEvent.click(headingRow('New group')!);
    await waitFor(() => expect(item('name')).not.toBeNull());
    expect(headingAbove('name')).toBe('New group');
    expect(headingAbove('status')).toBe('Other');
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

/**
 * objectstack#33229 — the bucket is not only its own block, it is HEADED: a
 * divider row with the translated `common.ungroupedSection` ("Other"), drawn
 * only when declared groups precede it. Under a collapsed last group a
 * headerless block still read as that group's hidden contents.
 */
describe.each(ARMS)('%s — the ungrouped block carries its own "Other" heading (objectstack#33229)', (_arm, Arm, formType) => {
  const renderArm = (objectSchema: unknown, extra: Record<string, unknown> = {}, language?: string) => {
    const tree = (
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
      />
    );
    return render(
      language
        ? <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{tree}</I18nProvider>
        : tree,
    );
  };

  const settle = () =>
    waitFor(() => {
      expect(item('technician')).not.toBeNull();
    });

  it('under a collapsed group, the ungrouped fields sit under "Other", not under the group', async () => {
    renderArm(filerObject({ collapse: 'collapsed' }));
    await settle();

    const group = headingRow('New group');
    const other = headingRow('Other');
    expect(group).toBeTruthy();
    expect(other).toBeTruthy();
    expect(other).not.toBe(group);
    // The group's member is collapsed away; the bucket's fields are under "Other".
    expect(item('name')).toBeNull();
    for (const n of UNGROUPED) expect(headingAbove(n)).toBe('Other');
    // The heading follows the group (spec placement) and is no disclosure control.
    expect(group!.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(other!.querySelector('[aria-expanded]')).toBeNull();
  });

  it('zh-CN reads the heading 其他', async () => {
    renderArm(filerObject(), {}, 'zh-CN');
    await settle();

    expect(headingRow('其他')).toBeTruthy();
    for (const n of UNGROUPED) expect(headingAbove(n, ['New group', '其他'])).toBe('其他');
    expect(headingRow('Other')).toBeFalsy();
  });

  it('CONTROL: no declared group applies — the flat form gets no heading', async () => {
    const flat = filerObject();
    (flat.fields.name as Record<string, unknown>).group = undefined;
    renderArm(flat);
    await settle();

    expect(headingRow('Other')).toBeFalsy();
    expect(headingRow('New group')).toBeFalsy();
  });

  it('CONTROL: an authored untitled section stays headerless', async () => {
    renderArm(filerObject(), {
      sections: [
        { name: 'curated', label: 'Curated', fields: ['name'] },
        { fields: ['status', 'technician'] },
      ],
    });
    await settle();

    expect(headingRow('Curated')).toBeTruthy();
    expect(headingRow('Other')).toBeFalsy();
  });
});
