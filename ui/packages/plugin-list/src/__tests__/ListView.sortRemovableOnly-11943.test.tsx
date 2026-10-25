/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11943, the removable-only half: a field the Sort picker keeps ONLY
 * because the current sort names it is listed disabled.
 *
 * The triage ruling: such a field "stays visible only as removable, marked
 * unavailable and never offered as a new choice". The picker keeps a field for
 * that reason in three cases, and each is measured here on the real
 * `SortBuilder`:
 *
 *  - UNREADABLE: field-level read denies it (`canReadField`, objectui#11943).
 *  - PLATFORM-REFUSED: the served projection refuses to order by it (#6455).
 *  - RELATIONAL: a lookup, listed as ordering by ID (objectui#4243).
 *
 * In each case the field is declared FIRST on the object, so an "Add sort" that
 * still seeded the first entry would seed it. The controls: a field the picker
 * lists anyway carries no flag, in use or not, and with full read and no
 * served projection the same unreadable and refused fields are ordinary
 * options again.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ListView } from '../ListView';

const OBJECT = 'fls_ticket';

const FIELD_DEFS: Record<string, Record<string, unknown>> = {
  secret_note: { type: 'text', label: 'Secret Note' },
  remote_status: { type: 'text', label: 'Remote Status' },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  title: { type: 'text', label: 'Title' },
  priority: { type: 'number', label: 'Priority' },
};

/** The object definition with `first` declared first, the rest in `FIELD_DEFS` order. */
function definition(first: string) {
  const fields: Record<string, Record<string, unknown>> = { [first]: FIELD_DEFS[first] };
  for (const [name, def] of Object.entries(FIELD_DEFS)) if (name !== first) fields[name] = def;
  return { name: OBJECT, label: 'Ticket', fields };
}

function answer(fields: MePermissionsResponse['fields']): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['fls_member'],
    objects: { [OBJECT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
    fields,
  };
}

const RESTRICTED = answer({ [`${OBJECT}.secret_note`]: { readable: false, editable: false } });
const FULL_READ = answer({});

/** The platform's own resolver, with `remote_status` refused, as #6455's pins serve it. */
function attachProjection(def: ReturnType<typeof definition>) {
  const resolved = resolveObjectSortability(def) as { fields: Record<string, unknown> };
  const fields: Record<string, unknown> = { ...resolved.fields };
  // The base the refusal is measured against: every other field is sortable.
  for (const name of ['secret_note', 'owner', 'title', 'priority']) {
    expect(fields[name]).toEqual({ sortable: true });
  }
  fields.remote_status = { sortable: false };
  attachObjectSortability(def, { fields });
  return def;
}

function mount(
  { first, sort, perms = RESTRICTED, projection = true }: {
    first: string;
    sort: string[];
    perms?: MePermissionsResponse;
    projection?: boolean;
  },
) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      const def = definition(first);
      return projection ? attachProjection(def) : def;
    }),
  };
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: Object.keys(FIELD_DEFS).map((field) => ({ field })),
    sort: sort.map((field) => ({ field, order: 'asc' })),
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <MePermissionsProvider initialPermissions={perms}>
        <ListView schema={schema} dataSource={dataSource as unknown as DataSource} />
      </MePermissionsProvider>
    </SchemaRendererProvider>,
  );
}

function sortPanel(): HTMLElement {
  const dialog = screen.getByText('Sort Records').closest('[role="dialog"]');
  if (!dialog) throw new Error('no popover content around "Sort Records"');
  return dialog as HTMLElement;
}

/** The field triggers of the sort rows: each row is `[field select, direction select]`. */
function sortRowTriggers(): HTMLElement[] {
  return within(sortPanel())
    .getAllByRole('combobox')
    .filter((_, i) => i % 2 === 0);
}

type Option = { label: string; disabled: boolean };

/** What a row's field dropdown offers, and which entries it marks unavailable. */
async function optionsOf(trigger: HTMLElement): Promise<Option[]> {
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const options = within(listbox)
    .getAllByRole('option')
    .map((o) => ({
      label: o.textContent?.trim() ?? '',
      disabled: o.getAttribute('aria-disabled') === 'true' && o.hasAttribute('data-disabled'),
    }));
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return options;
}

/** Open the popover once the object definition built the list (`Priority` shows it did). */
async function openSort(): Promise<Option[]> {
  fireEvent.click(await screen.findByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
  let options: Option[] = [];
  await waitFor(async () => {
    options = await optionsOf(sortRowTriggers()[0]);
    expect(options.map((o) => o.label)).toContain('Priority');
  });
  return options;
}

function chooseIn(trigger: HTMLElement, label: string) {
  fireEvent.click(trigger);
  const listbox = screen.getByRole('listbox');
  const target = within(listbox).getAllByRole('option').find((o) => o.textContent?.trim() === label);
  if (!target) throw new Error(`no option "${label}"`);
  fireEvent.click(target);
  if (screen.queryByRole('listbox')) fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
}

afterEach(() => {
  cleanup();
});

const CASES = [
  { name: 'unreadable', field: 'secret_note', label: 'Secret Note' },
  { name: 'platform-refused', field: 'remote_status', label: 'Remote Status' },
  { name: 'relational', field: 'owner', label: 'Owner (by ID)' },
] as const;

describe('a field the Sort picker keeps only for the current sort is removable only (objectui#11943)', () => {
  for (const c of CASES) {
    it(`${c.name}: listed disabled, its row shows it, "Add sort" skips it, and removing the row drops it`, async () => {
      mount({ first: c.field, sort: [c.field] });
      const options = await openSort();

      // Listed (first, as declared) and marked unavailable; nothing else is.
      expect(options).toEqual([
        { label: c.label, disabled: true },
        { label: 'Title', disabled: false },
        { label: 'Priority', disabled: false },
      ]);
      // Its own row is not blank.
      expect(sortRowTriggers()[0]).toHaveTextContent(c.label);

      // "Add sort" seeds the first field the user may choose, not this one.
      fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
      await waitFor(() => expect(sortRowTriggers()).toHaveLength(2));
      expect(sortRowTriggers()[1]).toHaveTextContent('Title');

      // The new row offers it only as unavailable, and choosing it does nothing.
      expect((await optionsOf(sortRowTriggers()[1])).find((o) => o.label === c.label)).toEqual({
        label: c.label,
        disabled: true,
      });
      chooseIn(sortRowTriggers()[1], c.label);
      expect(sortRowTriggers()[1]).toHaveTextContent('Title');

      // Removing its row ends the exception: the field leaves the list.
      const firstRow = within(sortPanel()).getByText('Sort by').parentElement as HTMLElement;
      fireEvent.click(within(firstRow).getByRole('button'));
      await waitFor(() => expect(sortRowTriggers()).toHaveLength(1));
      expect(sortRowTriggers()[0]).toHaveTextContent('Title');
      expect((await optionsOf(sortRowTriggers()[0])).map((o) => o.label)).toEqual(['Title', 'Priority']);
    });
  }

  it('control: a field the picker lists anyway carries no flag, whether or not the sort names it', async () => {
    mount({ first: 'title', sort: ['title'] });
    expect(await openSort()).toEqual([
      { label: 'Title', disabled: false },
      { label: 'Priority', disabled: false },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
    await waitFor(() => expect(sortRowTriggers()).toHaveLength(2));
    // With nothing flagged, "Add sort" seeds the first entry, as it always has.
    expect(sortRowTriggers()[1]).toHaveTextContent('Title');
  });

  it('control: with full read and no served projection, the unreadable and refused fields are ordinary options', async () => {
    mount({ first: 'secret_note', sort: ['secret_note', 'remote_status'], perms: FULL_READ, projection: false });
    const options = await openSort();
    expect(options.find((o) => o.label === 'Secret Note')).toEqual({ label: 'Secret Note', disabled: false });
    expect(options.find((o) => o.label === 'Remote Status')).toEqual({ label: 'Remote Status', disabled: false });
  });
});
