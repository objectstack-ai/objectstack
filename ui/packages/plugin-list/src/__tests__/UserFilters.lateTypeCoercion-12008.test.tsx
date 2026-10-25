/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12008 — a URL-restored quick-filter value on a declared field that
 * only the object definition types must be coerced once the definition loads.
 *
 * THE DEFECT. URL-restored values arrive as strings. `DropdownFilters` coerces
 * them to the field's resolved option types (`coerceToOptionTypes`) once: at
 * mount, or when the field first appears (objectui#12001). A field declared
 * WITHOUT its type (`fields: [{ field: 'is_active' }]`) takes its type and
 * options from the object definition, which `ListView` fetches after it
 * mounts. The coercion therefore ran against an untyped field, and nothing
 * coerced again when the definition arrived: the query filtered on the string
 * "true", and no option was ticked while the chip counted 1.
 *
 * THE ENUMERATION (triage's closing pass for this family). The second block
 * records every read `UserFilters` makes of the object definition, through a
 * Proxy, and pins that set to `DEFINITION_READS`. Each enumerated read has a
 * LATE probe: the bar mounts with no definition, the definition arrives, and
 * the state the read feeds must follow it. A new read of the definition turns
 * COMPLETENESS red until it is enumerated, and `LATE`'s type then demands its
 * probe. The sibling modes, `tabs` and the deprecated `toggle`, read nothing
 * from the definition.
 *
 * WHY THE DEFINITION IS LATE. In the list-level block, `getObjectSchema` waits
 * on a promise this file releases by hand, and each case first asserts that no
 * `find` has gone out, which `ListView` holds until the definition settles. In
 * the bar-level block, the bar mounts with `objectDef` undefined and the
 * definition is handed in by a rerender.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act, within } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { ListView } from '../ListView';
import { UserFilters } from '../UserFilters';

const ACCOUNT = { id: 'a1', name: 'ada', full_name: 'Ada Lovelace' };

const objectDef = {
  name: 'ticket',
  label: 'Ticket',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    is_active: { name: 'is_active', type: 'boolean', label: 'Active' },
    is_vip: { name: 'is_vip', type: 'boolean', label: 'VIP' },
    // Numeric option values, as the existing mount-time pin in
    // `UserFilters.test.tsx` ("coerces URL-restored string values to typed
    // option values") already has them on its definition.
    points: {
      name: 'points',
      type: 'select',
      label: 'Points',
      options: [
        { value: 1, label: 'One' },
        { value: 2, label: 'Two' },
      ],
    },
    status: {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
      ],
    },
    account_id: { name: 'account_id', type: 'lookup', label: 'Account', reference: 'crm_account', displayField: 'full_name' },
  },
};

const rows = [{ id: '1', subject: 'First', is_active: true, points: 2 }];

/** A data source whose definition answers only once `release()` is called. */
function makeGatedDataSource() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dataSource = {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => {
      await gate;
      return objectDef;
    }),
  } as any;
  return { dataSource, release: () => act(async () => release()) };
}

function mountList(userFilters: Record<string, unknown>, selections: Record<string, any[]>) {
  const { dataSource, release } = makeGatedDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: 'ticket', viewType: 'grid', columns: ['subject'], userFilters } as never}
        dataSource={dataSource}
        userFilterSelections={selections}
      />
    </SchemaRendererProvider>,
  );
  return { dataSource, release };
}

const filters = (dataSource: any) => dataSource.find.mock.calls.map((call: any[]) => call[1]?.$filter);
const lastFilter = (dataSource: any) => filters(dataSource).at(-1);

/** Opens the chip's popover and reads whether the option labelled `label` is ticked. */
function ticked(field: string, label: string): boolean {
  fireEvent.click(screen.getByTestId(`filter-badge-${field}`));
  const box = within(screen.getByTestId(`filter-options-${field}`)).getByLabelText(label) as HTMLInputElement;
  return box.checked;
}

afterEach(cleanup);

describe('a restored value on a field typed only by a late definition is coerced (objectui#12008)', () => {
  it('UNTYPED BOOLEAN: the True box is ticked and the last find carries ["is_active","=",true]', async () => {
    const { dataSource, release } = mountList({ element: 'dropdown', fields: [{ field: 'is_active' }] }, { is_active: ['true'] });
    // Precondition: the declared chip holds the URL string before the
    // definition has loaded.
    expect(screen.getByTestId('filter-badge-is_active').textContent).toContain('1');
    expect(dataSource.find).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(lastFilter(dataSource)).toEqual(['is_active', '=', true]));
    expect(ticked('is_active', 'True')).toBe(true);
  });

  it('TYPED CONTROL: the same field declared with its type sends the typed value on every find, as before', async () => {
    const { dataSource, release } = mountList(
      { element: 'dropdown', fields: [{ field: 'is_active', type: 'boolean' }] },
      { is_active: ['true'] },
    );
    expect(dataSource.find).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(lastFilter(dataSource)).toEqual(['is_active', '=', true]));
    await new Promise((r) => setTimeout(r, 50));
    expect(new Set(filters(dataSource).map((f: unknown) => JSON.stringify(f)))).toEqual(
      new Set([JSON.stringify(['is_active', '=', true])]),
    );
    expect(ticked('is_active', 'True')).toBe(true);
  });

  it('NUMERIC OPTION: a restored "2" against the definition option 2 is ticked and the last find carries 2', async () => {
    const { dataSource, release } = mountList({ element: 'dropdown', fields: [{ field: 'points' }] }, { points: ['2'] });
    expect(dataSource.find).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(lastFilter(dataSource)).toEqual(['points', '=', 2]));
    expect(ticked('points', 'Two')).toBe(true);
  });

  it('A USER CLEAR SURVIVES: a value cleared before the definition loads stays cleared after it', async () => {
    const { dataSource, release } = mountList({ element: 'dropdown', fields: [{ field: 'is_active' }] }, { is_active: ['true'] });
    fireEvent.click(screen.getByTestId('filter-clear-is_active'));
    expect(dataSource.find).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('filter-clear-is_active')).toBeNull();
    expect(filters(dataSource).every((f: unknown) => f === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The enumeration
// ---------------------------------------------------------------------------

/**
 * Every read the dropdown bar makes of the object definition, and the state it
 * feeds. COMPLETENESS pins this list to what the bar actually reads.
 */
const DEFINITION_READS = [
  // The per-field lookup every read below goes through.
  'objectDef.fields',
  // The i18n scope of the chip label and the option labels.
  'objectDef.name',
  // The resolved type: boolean options, the lookup picker, and the coercion
  // of a starting (restored or default) value.
  'fieldDef.type',
  // The option list, and the coercion of a starting value.
  'fieldDef.options',
  // The chip label when the author gives none.
  'fieldDef.label',
  // The lookup picker's target object.
  'fieldDef.reference',
  // The lookup picker's display column.
  'fieldDef.displayField',
] as const;

type DefinitionRead = (typeof DEFINITION_READS)[number];

/** Wraps a definition so every string-keyed read of it, and of its field definitions, is recorded. */
function recording(def: typeof objectDef) {
  const reads = new Set<string>();
  const track = <T extends object>(target: T, prefix: string): T =>
    new Proxy(target, {
      get(t, key, receiver) {
        if (typeof key === 'string') reads.add(`${prefix}.${key}`);
        return Reflect.get(t, key, receiver);
      },
    });
  const fields = new Proxy(def.fields, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver);
      return typeof key === 'string' && value && typeof value === 'object' ? track(value, 'fieldDef') : value;
    },
  });
  const proxied = new Proxy(def, {
    get(t, key, receiver) {
      if (typeof key === 'string') reads.add(`objectDef.${key}`);
      return key === 'fields' ? fields : Reflect.get(t, key, receiver);
    },
  });
  return { proxied, reads };
}

type BarProps = {
  fields: Array<Record<string, unknown>>;
  onFilterChange: (filters: any[]) => void;
  initialSelections?: Record<string, any[]>;
};

/** Mounts the dropdown bar with no definition; `arrive()` hands the definition in. */
function mountBar({ fields, onFilterChange, initialSelections }: BarProps, wrapper?: React.ComponentType<{ children: React.ReactNode }>) {
  const ui = (def: unknown) => (
    <UserFilters
      config={{ element: 'dropdown', fields } as never}
      objectDef={def}
      data={[]}
      onFilterChange={onFilterChange}
      initialSelections={initialSelections}
    />
  );
  const { rerender } = render(ui(undefined), wrapper ? { wrapper } : undefined);
  return { arrive: () => rerender(ui(objectDef)) };
}

/** Per enumerated read: the state it feeds follows a definition that arrives after mount. */
const LATE: Record<Exclude<DefinitionRead, 'objectDef.fields'>, () => void | Promise<void>> = {
  'fieldDef.type': () => {
    const onFilterChange = vi.fn();
    const { arrive } = mountBar({
      fields: [{ field: 'is_active' }, { field: 'is_vip', defaultValues: ['true'] }],
      onFilterChange,
      initialSelections: { is_active: ['true'] },
    });
    // Before the definition: the restored value and the author default are
    // both still the string.
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['is_active', 'in', ['true']],
      ['is_vip', 'in', ['true']],
    ]);
    arrive();
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['is_active', 'in', [true]],
      ['is_vip', 'in', [true]],
    ]);
    expect(ticked('is_active', 'True')).toBe(true);
  },
  'fieldDef.options': () => {
    const onFilterChange = vi.fn();
    const { arrive } = mountBar({ fields: [{ field: 'points' }], onFilterChange, initialSelections: { points: ['2'] } });
    arrive();
    expect(onFilterChange).toHaveBeenLastCalledWith([['points', 'in', [2]]]);
    expect(ticked('points', 'Two')).toBe(true);
  },
  'fieldDef.label': () => {
    const { arrive } = mountBar({ fields: [{ field: 'is_active' }], onFilterChange: vi.fn() });
    expect(screen.getByTestId('filter-badge-is_active').textContent).toContain('is_active');
    arrive();
    expect(screen.getByTestId('filter-badge-is_active').textContent).toContain('Active');
  },
  'objectDef.name': () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider
        config={{
          defaultLanguage: 'en',
          detectBrowserLanguage: false,
          resources: { en: { crm: { fields: { ticket: { is_active: 'Is live' } } } } },
        }}
      >
        {children}
      </I18nProvider>
    );
    const { arrive } = mountBar({ fields: [{ field: 'is_active' }], onFilterChange: vi.fn() }, wrapper);
    arrive();
    expect(screen.getByTestId('filter-badge-is_active').textContent).toContain('Is live');
  },
  'fieldDef.reference': () => lookupFollowsLateDefinition(),
  'fieldDef.displayField': () => lookupFollowsLateDefinition(),
};

/** The account chip becomes the remote picker, labelled by the declared display field. */
async function lookupFollowsLateDefinition() {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [ACCOUNT], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(),
  } as any;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SchemaRendererProvider dataSource={dataSource}>{children}</SchemaRendererProvider>
  );
  const { arrive } = mountBar(
    { fields: [{ field: 'account_id' }], onFilterChange: vi.fn(), initialSelections: { account_id: [ACCOUNT.id] } },
    wrapper,
  );
  arrive();
  fireEvent.click(screen.getByTestId('filter-badge-account_id'));
  expect(screen.getByTestId('filter-lookup-account_id')).toBeTruthy();
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('lookup-picker-account_id').textContent).toBe(ACCOUNT.full_name));
}

describe('every read UserFilters makes of the object definition, enumerated (objectui#12008)', () => {
  it('COMPLETENESS: the dropdown bar reads exactly the enumerated keys of the definition', () => {
    const { proxied, reads } = recording(objectDef);
    render(
      <UserFilters
        config={{
          element: 'dropdown',
          fields: [{ field: 'is_active' }, { field: 'points' }, { field: 'account_id' }],
        }}
        objectDef={proxied}
        data={[]}
        onFilterChange={vi.fn()}
        initialSelections={{ is_active: ['true'], points: ['2'] }}
      />,
    );
    expect([...reads].sort()).toEqual([...DEFINITION_READS].sort());
  });

  it.each(['tabs', 'toggle'] as const)('SIBLINGS: %s mode reads nothing from the definition', (element) => {
    const { proxied, reads } = recording(objectDef);
    render(
      <UserFilters
        config={
          {
            element,
            fields: [{ field: 'is_active', defaultValues: [true] }],
            tabs: [{ name: 'live', label: 'Live', filter: [{ field: 'is_active', operator: 'equals', value: true }] }],
          } as never
        }
        objectDef={proxied}
        data={[]}
        onFilterChange={vi.fn()}
        initialSelections={{ _tab: ['live'], is_active: ['true'] }}
      />,
    );
    expect([...reads]).toEqual([]);
  });

  it.each(Object.keys(LATE) as Array<keyof typeof LATE>)('LATE %s: the state it feeds follows a definition that arrives after mount', async (read) => {
    await LATE[read]();
  });
});

describe('the late typing settles once per field and only moves a starting value (objectui#12008)', () => {
  it('TYPED AT MOUNT: a declared typed field emits nothing more when the definition arrives', () => {
    const onFilterChange = vi.fn();
    const { arrive } = mountBar({
      fields: [{ field: 'is_active', type: 'boolean' }],
      onFilterChange,
      initialSelections: { is_active: ['true'] },
    });
    expect(onFilterChange).toHaveBeenLastCalledWith([['is_active', 'in', [true]]]);
    const settled = onFilterChange.mock.calls.length;
    arrive();
    expect(onFilterChange.mock.calls.length).toBe(settled);
  });

  it('NOTHING TO MOVE: string options from the definition leave a restored string as it was, with no new emit', () => {
    const onFilterChange = vi.fn();
    const { arrive } = mountBar({ fields: [{ field: 'status' }], onFilterChange, initialSelections: { status: ['open'] } });
    const settled = onFilterChange.mock.calls.length;
    arrive();
    expect(onFilterChange.mock.calls.length).toBe(settled);
    expect(ticked('status', 'Open')).toBe(true);
  });

  it('A USER CLEAR SURVIVES: the definition arriving after a clear emits nothing and restores nothing', () => {
    const onFilterChange = vi.fn();
    const { arrive } = mountBar({ fields: [{ field: 'is_active' }], onFilterChange, initialSelections: { is_active: ['true'] } });
    fireEvent.click(screen.getByTestId('filter-clear-is_active'));
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    const settled = onFilterChange.mock.calls.length;
    arrive();
    expect(onFilterChange.mock.calls.length).toBe(settled);
    expect(screen.queryByTestId('filter-clear-is_active')).toBeNull();
  });

  it('A USER CHOICE SURVIVES: a value picked before the definition loads is not coerced after it', () => {
    const onFilterChange = vi.fn();
    // Authored options let the user pick before the definition types the
    // field; the definition then makes it boolean.
    const { arrive } = mountBar({
      fields: [{ field: 'is_active', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] }],
      onFilterChange,
    });
    fireEvent.click(screen.getByTestId('filter-badge-is_active'));
    fireEvent.click(within(screen.getByTestId('filter-options-is_active')).getByLabelText('Yes'));
    expect(onFilterChange).toHaveBeenLastCalledWith([['is_active', 'in', ['true']]]);
    const settled = onFilterChange.mock.calls.length;
    arrive();
    expect(onFilterChange.mock.calls.length).toBe(settled);
  });

  it('ONE COMMIT: a field typed late and a field that arrives with the definition both reach the last emit', () => {
    const onFilterChange = vi.fn();
    const initialSelections = { is_active: ['true'], points: ['2'] };
    const ui = (fields: Array<Record<string, unknown>>, def: unknown) => (
      <UserFilters
        config={{ element: 'dropdown', fields } as never}
        objectDef={def}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={initialSelections}
      />
    );
    const { rerender } = render(ui([{ field: 'is_active' }], undefined));
    rerender(ui([{ field: 'is_active' }, { field: 'points' }], objectDef));
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['is_active', 'in', [true]],
      ['points', 'in', [2]],
    ]);
  });
});
