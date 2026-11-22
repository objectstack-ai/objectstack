/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Add group field" asks for the field, and offers select-like fields only
 * (objectstack#36204, the card as the maintainer rewrote it).
 *
 * It used to add the first field the editor listed, the list's first column,
 * a name as a rule: twelve customers became twelve groups of one. Now, in
 * both Group editors (the wide toolbar's panel and the View settings menu's
 * Group level):
 *   1. no field is added by the click: the field dropdown opens, the list is
 *      not grouped, and the level is written once a field is picked; closing
 *      the dropdown without a pick writes nothing;
 *   2. the dropdown offers single select, radio, tick, person and linked
 *      record fields holding one value each: the view's columns first, then
 *      the object's other business fields of those types, then its system
 *      ones such as the owner (created by and updated by only as a column).
 *      Text, numbers,
 *      dates and many-valued fields are not offered;
 *   3. with none to offer, the button is disabled and says why; while the
 *      definition is still being read it is disabled without a reason;
 *   4. a view grouped by a field of another type keeps showing it, under its
 *      label, and can still be changed or removed;
 *   5. the change still goes only to `onGroupingChange` (the host's draft,
 *      objectstack#35955): the data source is asked to write nothing.
 *
 * DIRECTION: on main every pin but the CONTROL fails: the button added
 * `name` at once, every column was offered, and nothing was ever disabled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import { groupFieldOptions, isGroupableField, type ViewSettingsField } from '../components/ViewSettingsPopover';

const OBJECT = 'customer_36204';

const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Customer name' },
  owner: { type: 'user', label: 'Owner', reference: 'sys_user' },
  industry: { type: 'select', label: 'Industry', options: [{ value: 'it', label: 'IT' }] },
  stage: { type: 'radio', label: 'Stage', options: [{ value: 'new', label: 'New' }] },
  tags: { type: 'select', multiple: true, label: 'Tags', options: [{ value: 'a', label: 'A' }] },
  notes: { type: 'textarea', label: 'Notes' },
  signed: { type: 'date', label: 'Signed on' },
  revenue: { type: 'currency', label: 'Revenue' },
  vip: { type: 'boolean', label: 'VIP' },
  parent: { type: 'lookup', label: 'Parent account', reference: OBJECT },
  internal_code: { type: 'select', label: 'Internal code', hidden: true, options: [{ value: 'x', label: 'X' }] },
  owner_id: { type: 'lookup', label: 'Record owner', reference: 'sys_user', system: true },
  created_by: { type: 'lookup', label: 'Created by', reference: 'sys_user', system: true },
};

function mount(schemaExtra: Record<string, unknown>, definition: Promise<unknown> | null = Promise.resolve({ name: OBJECT, fields: FIELDS })) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', industry: 'it' }], total: 1 }),
    queryGroupHeaders: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(definition ? { getObjectSchema: vi.fn(() => definition) } : {}),
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

async function definitionRead(dataSource: { getObjectSchema?: ReturnType<typeof vi.fn> }) {
  if (dataSource.getObjectSchema) await vi.waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
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

const OPENERS = [
  ['the toolbar Group panel', false, openToolbarGroup],
  ['the View settings Group level', true, openDisplayGroup],
] as const;

async function listboxLabels(): Promise<string[]> {
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
}

const level = (field: string) => ({ field, order: 'asc', collapsed: false });

afterEach(() => cleanup());

describe('"Add group field" opens the field dropdown and groups only on a pick (objectstack#36204)', () => {
  const columns = ['name', 'industry', 'owner', 'notes', 'signed', 'revenue', 'tags'];

  for (const [where, compactToolbar, open] of OPENERS) {
    it(`${where}: the click writes nothing and opens the dropdown; a pick is the level`, async () => {
      const { dataSource, onGroupingChange } = mount({ columns, compactToolbar });
      await definitionRead(dataSource);
      const panel = await open();
      fireEvent.click(within(panel).getByTestId('grouping-add'));
      expect(onGroupingChange).not.toHaveBeenCalled();
      expect(within(panel).queryByTestId('grouping-field-0')).toBeNull();
      expect(within(panel).getByTestId('grouping-field-pending')).toBeInTheDocument();
      // The view's select-like columns, then the object's other business
      // ones, then its system ones (the record owner), as the Filter panel
      // orders them; no name, text, date, number, many-valued select, hidden
      // field, or created-by provenance the view does not show.
      expect(await listboxLabels()).toEqual(['Industry', 'Owner', 'Stage', 'VIP', 'Parent account', 'Record owner']);
      fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Industry' }));
      expect(onGroupingChange).toHaveBeenCalledTimes(1);
      expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry')] });
      // A draft for the host: the data source is asked to write nothing.
      expect(dataSource.create).not.toHaveBeenCalled();
      expect(dataSource.update).not.toHaveBeenCalled();
      expect(dataSource.delete).not.toHaveBeenCalled();
    });

    it(`${where}: closing the dropdown without a pick writes nothing`, async () => {
      const { dataSource, onGroupingChange } = mount({ columns, compactToolbar });
      await definitionRead(dataSource);
      const panel = await open();
      fireEvent.click(within(panel).getByTestId('grouping-add'));
      fireEvent.keyDown(await screen.findByRole('listbox'), { key: 'Escape' });
      await vi.waitFor(() => expect(within(panel).queryByTestId('grouping-field-pending')).toBeNull());
      expect(onGroupingChange).not.toHaveBeenCalled();
      expect(within(panel).getByTestId('grouping-add')).toBeEnabled();
    });

    it(`${where}: no groupable field — the button is disabled and says why`, async () => {
      const { dataSource } = mount({ columns: ['name', 'notes', 'signed', 'revenue', 'tags'], compactToolbar }, Promise.resolve({
        name: OBJECT,
        fields: { name: FIELDS.name, notes: FIELDS.notes, signed: FIELDS.signed, revenue: FIELDS.revenue, tags: FIELDS.tags },
      }));
      await definitionRead(dataSource);
      const panel = await open();
      expect(within(panel).getByTestId('grouping-add')).toBeDisabled();
      expect(within(panel).getByTestId('grouping-no-fields')).toHaveTextContent('No field here can group the list');
      expect(within(panel).getByTestId('grouping-add')).toHaveAttribute('aria-describedby', within(panel).getByTestId('grouping-no-fields').id);
    });
  }

  it('the second level offers the same fields, less the one in use', async () => {
    const { dataSource, onGroupingChange } = mount({ columns, grouping: { fields: [level('industry')] } });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    fireEvent.click(within(panel).getByTestId('grouping-add'));
    expect(onGroupingChange).not.toHaveBeenCalled();
    expect(await listboxLabels()).toEqual(['Owner', 'Stage', 'VIP', 'Parent account', 'Record owner']);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Owner' }));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry'), level('owner')] });
  });

  it('the columns come in the reader\'s column order', async () => {
    const { dataSource } = mount({ columns: ['name', 'industry', 'owner'], columnState: { order: ['owner', 'name', 'industry'] } });
    await definitionRead(dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect((await listboxLabels()).slice(0, 2)).toEqual(['Owner', 'Industry']);
  });

  it('created-by provenance is offered when the view shows it as a column', async () => {
    const { dataSource } = mount({ columns: ['name', 'created_by'] });
    await definitionRead(dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect((await listboxLabels())[0]).toBe('Created by');
  });

  it('a view grouped by a field of another type keeps it, under its label, and can change it', async () => {
    const { dataSource, onGroupingChange } = mount({ columns, grouping: { fields: [level('name')] } });
    await definitionRead(dataSource);
    const panel = await openToolbarGroup();
    const trigger = within(panel).getByTestId('grouping-field-0');
    expect(trigger).toHaveTextContent('Customer name');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await listboxLabels()).toEqual(['Customer name', 'Industry', 'Owner', 'Stage', 'VIP', 'Parent account', 'Record owner']);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Industry' }));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [level('industry')] });
  });

  it('while the definition is being read the button waits, disabled, without a reason', async () => {
    let answer: (value: unknown) => void = () => {};
    const { dataSource } = mount({ columns }, new Promise((resolve) => { answer = resolve; }));
    await vi.waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    const panel = await openToolbarGroup();
    expect(within(panel).getByTestId('grouping-add')).toBeDisabled();
    expect(within(panel).queryByTestId('grouping-no-fields')).toBeNull();
    await act(async () => { answer({ name: OBJECT, fields: FIELDS }); });
    expect(within(panel).getByTestId('grouping-add')).toBeEnabled();
  });

  it('CONTROL: a host with no definition to read offers every column, as before', async () => {
    const { dataSource } = mount({ columns: ['name', 'industry', 'notes'] }, null);
    await definitionRead(dataSource);
    fireEvent.click(within(await openToolbarGroup()).getByTestId('grouping-add'));
    expect(await listboxLabels()).toEqual(['name', 'industry', 'notes']);
  });
});

describe('the offer, as functions', () => {
  const fields: ViewSettingsField[] = [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'tags', label: 'Tags', type: 'select', multiple: true },
    { name: 'flag', label: 'Flag', type: 'boolean' },
    { name: 'calc', label: 'Calc', type: 'formula', groupable: false },
    { name: 'when', label: 'When', type: 'datetime' },
    { name: 'parent', label: 'Parent', type: 'lookup' },
    { name: 'people', label: 'People', type: 'user', multiple: true },
    { name: 'status', label: 'Status', type: 'select' },
    { name: 'untyped', label: 'Untyped' },
  ];

  it('only single-valued select, radio, tick, person and linked-record fields', () => {
    expect(groupFieldOptions(fields).map((o) => o.value)).toEqual(['flag', 'parent', 'status']);
    expect(['select', 'radio', 'boolean', 'toggle', 'user', 'lookup', 'master_detail', 'tree'].every((type) => isGroupableField({ type }))).toBe(true);
    expect(['text', 'number', 'currency', 'date', 'datetime', 'multiselect', 'checkboxes', 'formula'].some((type) => isGroupableField({ type }))).toBe(false);
  });

  it('in the column order a reader set', () => {
    expect(groupFieldOptions(fields, ['status', 'flag']).map((o) => o.value)).toEqual(['status', 'flag', 'parent']);
  });

  it('CONTROL: with no type known every field but the refused formula is offered, as before', () => {
    expect(groupFieldOptions(fields, undefined, false).map((o) => o.value))
      .toEqual(['name', 'tags', 'flag', 'when', 'parent', 'people', 'status', 'untyped']);
  });
});
