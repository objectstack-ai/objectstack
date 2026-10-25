/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11984 — every field list `ListView` and its toolbar offer asks the
 * field read, `canReadField` (objectui#11962's predicate), behind its
 * `isLoaded` gate.
 *
 * objectui#11925 gave the Filter panel's list the read and objectui#11943 the
 * Sort picker's. The list the hide-fields popover, the Group editor and the
 * Row color select share (`allFields`, which the compact toolbar's View
 * settings popover reads too) and the user-filter chips still offered a field
 * the caller may not read. This file pins three things:
 *
 * 1. **The enumeration pin.** A sweep opens every popover the toolbar renders
 *    (anything carrying `aria-haspopup`), opens every combobox inside it, and
 *    reads every option and checkbox it offers. A popover that offers a field
 *    of this view is a field list, and the set of them must equal
 *    `FIELD_LIST_TRIGGERS`, so a new field list fails here until it is listed.
 *    For a restricted caller, nothing the sweep reads, nor the toolbar's own
 *    text (the user-filter chips), may name a field they cannot read. The
 *    control runs the same sweep with full read: every listed popover then
 *    offers the unreadable field, so the sweep reaches each list.
 *    Its bound: it reads what an opened popover draws once every editor holds
 *    a value; a list behind a further click (a collapsed section) needs a row
 *    in `POSITIONS`.
 * 2. **One pin per position** (`POSITIONS`): restricted, the unreadable field
 *    is not offered and the list is otherwise today's; full read lists what no
 *    permission answer lists; before the answer loads, nothing is withheld.
 * 3. **Stored configuration** naming an unreadable field is kept as stored:
 *    a grouping level stays visible and removable, a hidden-field entry and a
 *    row-color rule are withheld from the editors but never cleared by them,
 *    and a user-filter chip whose field a held selection names stays.
 *
 * The fixture is synthetic: one object, three readable fields and two the
 * restricted answer marks unreadable (`secret_note`, and the select
 * `secret_status`, which the derived user-filter chips would offer). Every
 * unreadable field's label and name carry "secret", which is what the sweep
 * looks for.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ListView } from '../ListView';

const OBJECT = 'fls_ticket';

const FIELDS: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
  priority: { type: 'number', label: 'Priority' },
  secret_note: { type: 'textarea', label: 'Secret Note' },
  secret_status: { type: 'select', label: 'Secret Status', options: [{ label: 'Hush', value: 'hush' }] },
};

const COLUMNS = Object.entries(FIELDS).map(([field, def]) => ({ field, label: def.label as string }));
const FIELD_LABELS = COLUMNS.map((c) => c.label);
const UNREADABLE = /secret/i;

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

const RESTRICTED = answer({
  [`${OBJECT}.secret_note`]: { readable: false, editable: false },
  [`${OBJECT}.secret_status`]: { readable: false, editable: false },
});
const FULL_READ = answer({});

/**
 * Every editor holds a value, so every list draws its rows: a filter
 * condition, a sort key, a grouping level, a row-color rule and a hidden field,
 * all on readable fields. The user-filter chips are derived from the
 * definition's select fields.
 */
const EVERY_EDITOR_HOLDS_A_VALUE: Record<string, unknown> = {
  sort: [{ field: 'title', order: 'asc' }],
  grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] },
  rowColor: { field: 'status', colors: {} },
  hiddenFields: ['priority'],
  userFilters: { element: 'dropdown' },
};
const HELD_FILTER = {
  initialFilters: { logic: 'and', conditions: [{ id: 'c1', field: 'title', operator: 'contains', value: 'a' }] },
};

type Perms = MePermissionsResponse | undefined;

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: FIELDS }),
  };
}

function listFor(schemaExtra: Record<string, unknown>, props: Record<string, unknown>, dataSource: ReturnType<typeof makeDataSource>) {
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: COLUMNS,
    userActions: { hideFields: true, rowColor: true },
    // Derived from the definition's select fields, so they also say when it has loaded.
    userFilters: { element: 'dropdown' },
    // objectui#12423 — the Display form is the toolbar's default; these cases
    // reach the WIDE form's per-control popovers unless they set
    // `compactToolbar: true` themselves.
    compactToolbar: false,
    ...schemaExtra,
  } as unknown as ListViewSchema;
  return <ListView schema={schema} dataSource={dataSource} {...props} />;
}

function mount(perms: Perms, schemaExtra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  const list = listFor(schemaExtra, props, dataSource);
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {perms ? <MePermissionsProvider initialPermissions={perms}>{list}</MePermissionsProvider> : list}
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/** The definition has loaded once the derived user-filter chips are drawn. */
async function definitionLoaded(): Promise<void> {
  await screen.findByTestId('filter-badge-status');
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';

/** Open a Radix `Select` trigger and return the labels its listbox offers. */
async function comboboxOptions(trigger: HTMLElement): Promise<string[]> {
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox).getAllByRole('option').map(text);
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return labels;
}

/** Click a popover trigger and return the content it controls. */
async function openPopover(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
  const content = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  if (!content) throw new Error(`no popover content for trigger "${text(trigger)}"`);
  return content;
}

async function closePopover(trigger: HTMLElement): Promise<void> {
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
}

/** Open a popover, read it, and close it again, so a retry starts closed. */
async function inPopover<T>(trigger: HTMLElement, read: (content: HTMLElement) => Promise<T> | T): Promise<T> {
  const content = await openPopover(trigger);
  try {
    return await read(content);
  } finally {
    await closePopover(trigger);
  }
}

const toolbarButton = (name: RegExp) => screen.getByRole('button', { name });

function checkboxLabels(scope: HTMLElement): string[] {
  // The Display panel's Edit inline entry is a `role="switch"` button since
  // objectui#12423, so every checkbox here is a field's.
  return Array.from(scope.querySelectorAll('input[type="checkbox"]'))
    .map((box) => text(box.closest('label')));
}

/**
 * Both Row color pickers, the toolbar's and the View settings popover's, are
 * the shared `Select` (objectui#11865), not native selects: read the fields
 * the listbox offers, leaving out "None".
 */
async function pickerLabels(trigger: HTMLElement): Promise<string[]> {
  return (await comboboxOptions(trigger)).filter((label) => label !== 'None');
}

// ---------------------------------------------------------------------------
// The enumeration pin
// ---------------------------------------------------------------------------

/**
 * Every toolbar popover that offers a field list, per toolbar layout, by its
 * trigger's name. A popover the sweep finds offering a field that is not
 * named here fails the pin: list it here, and give it the field read.
 */
const FIELD_LIST_TRIGGERS: Record<'wide' | 'compact', string[]> = {
  // The Filter panel (`filterFields`), the Sort picker (`sortFields`), and
  // the three `allFields` lists: hide fields, the Group editor, Row color.
  wide: ['Color', 'Filter', 'Group', 'Hide fields', 'Sort'],
  // The compact toolbar folds Group, Row color and Hide fields into Display
  // (objectui#12423; "View settings" before it), which reads `allFields` for
  // all three.
  compact: ['Display', 'Filter', 'Sort'],
};

interface Sweep {
  /** What each opened popover offers, by its trigger's name. */
  offered: Map<string, string[]>;
  /** The toolbar's own text: the user-filter chips live here. */
  toolbarText: string;
}

async function sweepToolbar(): Promise<Sweep> {
  const cluster = document.querySelector('[data-print-hide]');
  const toolbar = cluster?.parentElement;
  if (!toolbar) throw new Error('no toolbar around the tool cluster');
  const offered = new Map<string, string[]>();
  for (const trigger of Array.from(toolbar.querySelectorAll<HTMLElement>('[aria-haspopup]'))) {
    // Keyed by the label: a count badge's digits are dropped, and so is the
    // ", 1 active" the Filter trigger's name carries while a filter is held
    // (objectui#12500).
    const name = (trigger.getAttribute('aria-label') ?? text(trigger)).split(',')[0].replace(/\d+/g, '').trim();
    const content = await openPopover(trigger);
    const items = [
      ...Array.from(content.querySelectorAll('option')).map(text),
      ...checkboxLabels(content),
    ];
    for (const combobox of Array.from(content.querySelectorAll<HTMLElement>('[role="combobox"]'))) {
      items.push(...(await comboboxOptions(combobox)));
    }
    offered.set(name, items);
    await closePopover(trigger);
  }
  return { offered, toolbarText: text(toolbar) };
}

const fieldListsOf = (sweep: Sweep) =>
  [...sweep.offered]
    .filter(([, items]) => items.some((item) => FIELD_LABELS.includes(item)))
    .map(([name]) => name)
    .sort();

describe('every field list ListView and its toolbar offer asks the field read (objectui#11984)', () => {
  afterEach(() => cleanup());

  for (const layout of ['wide', 'compact'] as const) {
    const schemaExtra = { ...EVERY_EDITOR_HOLDS_A_VALUE, ...(layout === 'compact' ? { compactToolbar: true } : {}) };

    it(`${layout} toolbar: no list offers a field the caller may not read, and the field lists are the ones enumerated`, async () => {
      mount(RESTRICTED, schemaExtra, HELD_FILTER);
      await definitionLoaded();
      const sweep = await sweepToolbar();
      expect(fieldListsOf(sweep)).toEqual(FIELD_LIST_TRIGGERS[layout]);
      for (const [name, items] of sweep.offered) {
        expect(items.filter((item) => UNREADABLE.test(item)), `"${name}" offers an unreadable field`).toEqual([]);
      }
      expect(sweep.toolbarText).not.toMatch(UNREADABLE);
    });

    it(`${layout} toolbar, control: with full read every enumerated list offers the field, so the sweep reaches each`, async () => {
      mount(FULL_READ, schemaExtra, HELD_FILTER);
      await definitionLoaded();
      const sweep = await sweepToolbar();
      expect(fieldListsOf(sweep)).toEqual(FIELD_LIST_TRIGGERS[layout]);
      for (const name of FIELD_LIST_TRIGGERS[layout]) {
        expect(sweep.offered.get(name), name).toContain('Secret Note');
      }
      expect(sweep.toolbarText).toContain('Secret Status');
    });
  }
});

// ---------------------------------------------------------------------------
// One pin per position
// ---------------------------------------------------------------------------

interface Position {
  name: string;
  schemaExtra?: Record<string, unknown>;
  props?: Record<string, unknown>;
  /** The field labels the position offers, in its order. */
  read: () => Promise<string[]>;
}

const viewSettings = () => screen.getByTestId('toolbar-display-trigger');

const POSITIONS: Position[] = [
  {
    name: 'the Filter panel (objectui#11925)',
    props: HELD_FILTER,
    read: () => inPopover(toolbarButton(/^filter/i), (c) => comboboxOptions(within(c).getAllByRole('combobox')[0])),
  },
  {
    name: 'the Sort picker (objectui#11943)',
    schemaExtra: { sort: [{ field: 'title', order: 'asc' }] },
    read: () => inPopover(toolbarButton(/^sort/i), (c) => comboboxOptions(within(c).getAllByRole('combobox')[0])),
  },
  {
    name: 'the hide-fields popover',
    read: () => inPopover(toolbarButton(/^hide fields/i), checkboxLabels),
  },
  {
    name: 'the Group editor',
    schemaExtra: { grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] } },
    read: () => inPopover(toolbarButton(/^group/i), (c) => comboboxOptions(within(c).getByTestId('grouping-field-0'))),
  },
  {
    name: 'the Row color select',
    read: () => inPopover(toolbarButton(/^color/i), (c) => pickerLabels(within(c).getByTestId('color-field-select'))),
  },
  {
    name: 'the user-filter chips, derived from the definition',
    schemaExtra: { userFilters: { element: 'dropdown' } },
    read: async () => Array.from(document.querySelectorAll('[data-testid^="filter-badge-"]')).map(text),
  },
  {
    name: 'the user-filter chips, named by the author',
    schemaExtra: { userFilters: { element: 'dropdown', fields: [{ field: 'status' }, { field: 'secret_status' }] } },
    read: async () => Array.from(document.querySelectorAll('[data-testid^="filter-badge-"]')).map(text),
  },
  {
    name: 'View settings: the Group editor',
    schemaExtra: { compactToolbar: true, grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] } },
    read: () => inPopover(viewSettings(), (c) => comboboxOptions(within(c).getByTestId('grouping-field-0'))),
  },
  {
    name: 'View settings: the Row color select',
    schemaExtra: { compactToolbar: true, rowColor: { field: 'status', colors: {} } },
    read: () => inPopover(viewSettings(), (c) => pickerLabels(within(c).getByTestId('color-field-select'))),
  },
  {
    name: 'View settings: the hide-fields section',
    schemaExtra: { compactToolbar: true, hiddenFields: ['priority'] },
    read: () => inPopover(viewSettings(), checkboxLabels),
  },
];

async function readPosition(position: Position, perms: Perms): Promise<string[]> {
  mount(perms, position.schemaExtra, position.props);
  await definitionLoaded();
  let labels: string[] = [];
  // The Filter and Sort lists are built from the definition once it loads.
  await waitFor(async () => {
    labels = await position.read();
    expect(labels).toContain('Status');
  });
  cleanup();
  return labels;
}

describe('each field list, one pin per position (objectui#11984)', () => {
  afterEach(() => cleanup());

  for (const position of POSITIONS) {
    it(`${position.name}: withholds an unreadable field and is otherwise today's list`, async () => {
      const today = await readPosition(position, undefined);
      const fullRead = await readPosition(position, FULL_READ);
      const restricted = await readPosition(position, RESTRICTED);
      // Control: with full read the list is what it is with no permission
      // answer at all, and it does offer an unreadable field.
      expect(fullRead).toEqual(today);
      expect(fullRead.some((label) => UNREADABLE.test(label))).toBe(true);
      expect(restricted).toEqual(fullRead.filter((label) => !UNREADABLE.test(label)));
    });
  }

  it('before the permission answer loads, nothing is withheld, as the columns defer', async () => {
    // The real "not loaded" state with children mounted: the provider is
    // refetching. It still holds the RESTRICTED answer, so `checkField` would
    // deny, but `isLoaded` is false and every list must offer every field.
    const dataSource = makeDataSource();
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(new Response(JSON.stringify(RESTRICTED), { status: 200 }))
        : new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const schemaExtra = { grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] } };
    const tree = (endpoint: string) => (
      <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
        <MePermissionsProvider endpoint={endpoint} fetcher={fetcher} maxRetries={0}>
          {listFor(schemaExtra, {}, dataSource)}
        </MePermissionsProvider>
      </SchemaRendererProvider>
    );
    const { rerender } = render(tree('/me/permissions?first'));
    await definitionLoaded();
    const hideFields = () => inPopover(toolbarButton(/^hide fields/i), checkboxLabels);
    const chips = () => Array.from(document.querySelectorAll('[data-testid^="filter-badge-"]')).map(text);
    // Loaded and restricted: withheld.
    await waitFor(async () => expect(await hideFields()).toEqual(['Title', 'Status', 'Priority']));
    expect(chips()).toEqual(['Status']);
    // A refetch that never settles: the provider keeps its data, `isLoaded` drops.
    rerender(tree('/me/permissions?second'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(await hideFields()).toEqual(FIELD_LABELS));
    expect(chips()).toEqual(['Status', 'Secret Status']);
    // The level's own field is offered in its own dropdown, so all five are.
    const group = await inPopover(toolbarButton(/^group/i), (c) => comboboxOptions(within(c).getByTestId('grouping-field-0')));
    expect(group).toEqual(FIELD_LABELS);
  });
});

// ---------------------------------------------------------------------------
// Stored configuration naming an unreadable field
// ---------------------------------------------------------------------------

describe('a stored configuration on an unreadable field is kept as stored (objectui#11984)', () => {
  afterEach(() => cleanup());

  it('a grouping level on it stays visible under its name and removable, and nothing else offers it', async () => {
    const onGroupingChange = vi.fn();
    mount(RESTRICTED, { grouping: { fields: [{ field: 'secret_note', order: 'asc', collapsed: false }] } }, { onGroupingChange });
    await definitionLoaded();
    const content = await openPopover(toolbarButton(/^group/i));
    const level = within(content).getByTestId('grouping-field-0');
    expect(level).toHaveTextContent('secret_note');
    expect(await comboboxOptions(level)).toEqual(['secret_note', 'Title', 'Status', 'Priority']);
    expect(onGroupingChange).not.toHaveBeenCalled();
    // "Add group field" seeds a readable field, and the new level does not offer it.
    fireEvent.click(within(content).getByTestId('grouping-add'));
    expect(onGroupingChange).toHaveBeenLastCalledWith({
      fields: [
        { field: 'secret_note', order: 'asc', collapsed: false },
        { field: 'title', order: 'asc', collapsed: false },
      ],
    });
    expect(await comboboxOptions(within(content).getByTestId('grouping-field-1'))).toEqual(['Title', 'Status', 'Priority']);
    // Its own level can be removed.
    fireEvent.click(within(content).getByTestId('grouping-remove-0'));
    expect(onGroupingChange).toHaveBeenLastCalledWith({ fields: [{ field: 'title', order: 'asc', collapsed: false }] });
  });

  it('a hidden-field entry on it is not listed, counted or cleared, and every write keeps it', async () => {
    const onHiddenFieldsChange = vi.fn();
    mount(RESTRICTED, { hiddenFields: ['secret_note', 'priority'] }, { onHiddenFieldsChange });
    await definitionLoaded();
    const trigger = toolbarButton(/^hide fields/i);
    // The badge counts the one entry this caller can see.
    expect(trigger).toHaveTextContent(/^Hide fields1$/);
    const content = await openPopover(trigger);
    expect(checkboxLabels(content)).toEqual(['Title', 'Status', 'Priority']);
    expect(within(content).getByRole('checkbox', { name: 'Priority' })).not.toBeChecked();
    fireEvent.click(within(content).getByRole('checkbox', { name: 'Status' }));
    expect(new Set(onHiddenFieldsChange.mock.lastCall?.[0])).toEqual(new Set(['priority', 'status', 'secret_note']));
    fireEvent.click(within(content).getByRole('button', { name: 'Show all' }));
    expect(onHiddenFieldsChange).toHaveBeenLastCalledWith(['secret_note']);
  });

  it('control: with full read the same entry is listed, counted and cleared, as today', async () => {
    const onHiddenFieldsChange = vi.fn();
    mount(FULL_READ, { hiddenFields: ['secret_note', 'priority'] }, { onHiddenFieldsChange });
    await definitionLoaded();
    const trigger = toolbarButton(/^hide fields/i);
    expect(trigger).toHaveTextContent(/^Hide fields2$/);
    const content = await openPopover(trigger);
    expect(within(content).getByRole('checkbox', { name: 'Secret Note' })).not.toBeChecked();
    fireEvent.click(within(content).getByRole('button', { name: 'Show all' }));
    expect(onHiddenFieldsChange).toHaveBeenLastCalledWith([]);
  });

  it('a row-color rule on it is withheld from the select: None, with no Clear', async () => {
    mount(RESTRICTED, { rowColor: { field: 'secret_note', colors: {} } });
    await definitionLoaded();
    const content = await openPopover(toolbarButton(/^color/i));
    const picker = within(content).getByTestId('color-field-select');
    expect(picker).toHaveTextContent(/^None$/);
    expect(within(content).queryByTestId('clear-row-color')).toBeNull();
    // Nor does the picker offer it, as its own field or as the rule's.
    expect(await comboboxOptions(picker)).toEqual(['None', 'Title', 'Status', 'Priority']);
    cleanup();
    // Control: with full read the select shows the rule and offers Clear.
    mount(FULL_READ, { rowColor: { field: 'secret_note', colors: {} } });
    await definitionLoaded();
    const full = await openPopover(toolbarButton(/^color/i));
    const fullPicker = within(full).getByTestId('color-field-select');
    expect(fullPicker).toHaveTextContent(/^Secret Note$/);
    expect(within(full).getByTestId('clear-row-color')).toBeInTheDocument();
    expect(await comboboxOptions(fullPicker)).toEqual(['None', ...FIELD_LABELS]);
  });

  it('a row-color rule on it outside the columns gets no item of its own: the picker never names it', async () => {
    // The picker shows a field none of its options carries as an item of its
    // own (objectui#11865). It is handed the OFFERED rule, so a rule on a field
    // the caller may not read never reaches that item.
    const columns = COLUMNS.filter((c) => c.field !== 'secret_note');
    mount(RESTRICTED, { columns, rowColor: { field: 'secret_note', colors: {} } });
    await definitionLoaded();
    const content = await openPopover(toolbarButton(/^color/i));
    const picker = within(content).getByTestId('color-field-select');
    expect(picker).toHaveTextContent(/^None$/);
    expect(within(content).queryByTestId('clear-row-color')).toBeNull();
    expect(await comboboxOptions(picker)).toEqual(['None', 'Title', 'Status', 'Priority']);
    cleanup();
    // Control: with full read the same rule is the picker's own outside item.
    mount(FULL_READ, { columns, rowColor: { field: 'secret_note', colors: {} } });
    await definitionLoaded();
    const full = await openPopover(toolbarButton(/^color/i));
    const fullPicker = within(full).getByTestId('color-field-select');
    expect(fullPicker).toHaveTextContent(/^secret_note$/);
    expect(await comboboxOptions(fullPicker)).toEqual(['secret_note', 'None', 'Title', 'Status', 'Priority', 'Secret Status']);
  });

  it('a user-filter chip whose field a restored selection names stays until that selection is cleared', async () => {
    const dataSource = makeDataSource();
    const schema = {
      type: 'list-view',
      objectName: OBJECT,
      viewType: 'grid',
      columns: COLUMNS,
      // Named by the author, so the chips exist before the definition loads
      // and the restored selection is applied at mount.
      userFilters: { element: 'dropdown', fields: [{ field: 'status' }, { field: 'secret_status' }] },
    } as unknown as ListViewSchema;
    // A host that stores the selections and hands them back, as the console does.
    function Host() {
      const [selections, setSelections] = React.useState<Record<string, Array<string | number | boolean>>>({
        secret_status: ['hush'],
      });
      return (
        <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
          <MePermissionsProvider initialPermissions={RESTRICTED}>
            <ListView
              schema={schema}
              dataSource={dataSource}
              userFilterSelections={selections}
              onUserFilterSelectionsChange={setSelections}
            />
          </MePermissionsProvider>
        </SchemaRendererProvider>
      );
    }
    render(<Host />);
    const chip = await screen.findByTestId('filter-badge-secret_status');
    expect(chip).toHaveTextContent('Secret Status');
    await act(async () => {
      fireEvent.click(screen.getByTestId('filter-clear-secret_status'));
    });
    await waitFor(() => expect(screen.queryByTestId('filter-badge-secret_status')).toBeNull());
    expect(screen.getByTestId('filter-badge-status')).toBeInTheDocument();
  });
});
