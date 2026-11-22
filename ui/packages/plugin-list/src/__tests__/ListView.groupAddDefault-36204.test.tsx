/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Add group field" groups by the view's first single select, not its first
 * column (objectstack#36204).
 *
 * It used to add the first field the editor listed, the list's first column,
 * a name as a rule: twelve customers became twelve groups of one. Now, in
 * both Group editors (the wide toolbar's panel and the View settings menu's
 * Group level):
 *   1. the first single select or radio in the reader's column order is added
 *      at once, a shown column before a hidden one;
 *   2. with none, nothing is grouped yet: the field dropdown opens, and the
 *      level is written once a field is picked;
 *   3. the dropdown lists the fields that suit grouping first (select, radio,
 *      person, linked record, tick, date; single-valued), then the rest, each
 *      part in column order;
 *   4. the change still goes only to `onGroupingChange` (the host's draft,
 *      objectstack#35955): the data source is asked to write nothing.
 *
 * DIRECTION: on main every pin but the CONTROLs fails: the button added
 * `name`, and the dropdown listed the columns in their own order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import { groupFieldOptions, pickGroupAddField, type ViewSettingsField } from '../components/ViewSettingsPopover';

const OBJECT = 'customer_36204';

const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Customer name' },
  owner: { type: 'user', label: 'Owner', reference: 'sys_user' },
  industry: { type: 'select', label: 'Industry', options: [{ value: 'it', label: 'IT' }] },
  stage: { type: 'radio', label: 'Stage', options: [{ value: 'new', label: 'New' }] },
  tags: { type: 'select', multiple: true, label: 'Tags', options: [{ value: 'a', label: 'A' }] },
  notes: { type: 'textarea', label: 'Notes' },
  signed: { type: 'date', label: 'Signed on' },
};

function mount(schemaExtra: Record<string, unknown>) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', industry: 'it' }], total: 1 }),
    queryGroupHeaders: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: FIELDS }),
  };
  const onGroupingChange = vi.fn();
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    compactToolbar: false,
    ...schemaExtra,
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={schema} dataSource={dataSource as never} onGroupingChange={onGroupingChange} />
    </SchemaRendererProvider>,
  );
  return { dataSource, onGroupingChange };
}

async function definitionRead(dataSource: { getObjectSchema: ReturnType<typeof vi.fn> }) {
  await vi.waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  await act(async () => {});
}

async function openToolbarGroup(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /^group/i }));
  return screen.findByTestId('group-field-list');
}

async function openDisplayGroup(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  const content = await screen.findByTestId('view-settings-content');
  fireEvent.click(within(content).getByTestId('options-row-group'));
  await within(content).findByTestId('grouping-add');
  return content;
}

async function listboxLabels(): Promise<string[]> {
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
}

const level = (field: string) => ({ field, order: 'asc', collapsed: false });

afterEach(() => cleanup());

describe('"Add group field" adds the first single select (objectstack#36204)', () => {
  const columns = ['name', 'owner', 'industry', 'notes'];

  it('the toolbar Group panel groups by Industry, not by the first column', async () => {
    const { dataSource, onGroupingChange } = mount({ columns });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    fireEvent.click(within(panel).getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenCalledTimes(1);
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry')] });
    // A draft for the host: the data source is asked to write nothing.
    expect(dataSource.create).not.toHaveBeenCalled();
    expect(dataSource.update).not.toHaveBeenCalled();
    expect(dataSource.delete).not.toHaveBeenCalled();
  });

  it('the View settings Group level does the same', async () => {
    const { dataSource, onGroupingChange } = mount({ columns, compactToolbar: true });
    await definitionRead(dataSource);
    const content = await openDisplayGroup();
    fireEvent.click(within(content).getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry')] });
  });

  it('the dropdown lists Owner and Industry ahead of Customer name, in both editors', async () => {
    const { dataSource } = mount({ columns, grouping: { fields: [level('industry')] } });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    fireEvent.keyDown(within(panel).getByTestId('grouping-field-0'), { key: 'ArrowDown' });
    expect(await listboxLabels()).toEqual(['Owner', 'Industry', 'Customer name', 'Notes']);
    cleanup();

    const second = mount({ columns, compactToolbar: true, grouping: { fields: [level('industry')] } });
    await definitionRead(second.dataSource);
    const content = await openDisplayGroup();
    fireEvent.keyDown(within(content).getByTestId('grouping-field-0'), { key: 'ArrowDown' });
    expect(await listboxLabels()).toEqual(['Owner', 'Industry', 'Customer name', 'Notes']);
  });

  it('follows the reader\'s column order: the select drawn first wins', async () => {
    const { dataSource, onGroupingChange } = mount({
      columns: ['name', 'industry', 'stage'],
      columnState: { order: ['stage', 'name', 'industry'] },
    });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    fireEvent.click(within(panel).getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('stage')] });
  });

  it('a shown select is picked before a hidden one; a hidden one when none is shown', async () => {
    const first = mount({ columns: ['name', 'industry', 'stage'], hiddenFields: ['industry'] });
    await definitionRead(first.dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect(first.onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('stage')] });
    cleanup();

    const second = mount({ columns: ['name', 'industry'], hiddenFields: ['industry'] });
    await definitionRead(second.dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect(second.onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry')] });
  });

  it('the second level follows the same rule: the next unused select', async () => {
    const { dataSource, onGroupingChange } = mount({
      columns: ['name', 'industry', 'stage'],
      grouping: { fields: [level('industry')] },
    });
    await definitionRead(dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry'), level('stage')] });
  });
});

describe('a view with no single select: the dropdown opens and nothing is grouped yet', () => {
  // `tags` is a select holding many values: not a default.
  const columns = ['name', 'owner', 'tags', 'signed'];

  it('the toolbar Group panel: no write until a pick, then the picked field', async () => {
    const { dataSource, onGroupingChange } = mount({ columns });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    fireEvent.click(within(panel).getByTestId('grouping-add'));
    expect(onGroupingChange).not.toHaveBeenCalled();
    expect(within(panel).queryByTestId('grouping-field-0')).toBeNull();
    expect(await listboxLabels()).toEqual(['Owner', 'Signed on', 'Customer name', 'Tags']);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Owner' }));
    expect(onGroupingChange).toHaveBeenCalledTimes(1);
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('owner')] });
  });

  it('the View settings Group level does the same', async () => {
    const { dataSource, onGroupingChange } = mount({ columns, compactToolbar: true });
    await definitionRead(dataSource);
    const content = await openDisplayGroup();
    fireEvent.click(within(content).getByTestId('grouping-add'));
    expect(onGroupingChange).not.toHaveBeenCalled();
    expect(await listboxLabels()).toEqual(['Owner', 'Signed on', 'Customer name', 'Tags']);
  });
});

describe('the ranking and the pick, as functions', () => {
  const fields: ViewSettingsField[] = [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'tags', label: 'Tags', type: 'select', multiple: true },
    { name: 'flag', label: 'Flag', type: 'boolean' },
    { name: 'calc', label: 'Calc', type: 'formula', groupable: false },
    { name: 'when', label: 'When', type: 'datetime' },
    { name: 'parent', label: 'Parent', type: 'lookup' },
    { name: 'status', label: 'Status', type: 'select' },
    { name: 'untyped', label: 'Untyped' },
  ];

  it('suits-grouping types first, the rest after, each in column order; formulas left out', () => {
    expect(groupFieldOptions(fields).map((o) => o.value))
      .toEqual(['flag', 'when', 'parent', 'status', 'name', 'tags', 'untyped']);
  });

  it('the column order a reader set comes first', () => {
    expect(groupFieldOptions(fields, ['status', 'name']).map((o) => o.value))
      .toEqual(['status', 'flag', 'when', 'parent', 'name', 'tags', 'untyped']);
  });

  it('picks the first single-valued select or radio among the remaining, in the order given', () => {
    const pick = pickGroupAddField(fields);
    expect(pick(groupFieldOptions(fields))).toBe('status');
    expect(pick(groupFieldOptions(fields).filter((o) => o.value !== 'status'))).toBeUndefined();
  });

  it('CONTROL: a field with no declared type is never picked, only listed', () => {
    expect(pickGroupAddField([{ name: 'untyped' }])([{ value: 'untyped' }])).toBeUndefined();
  });
});
