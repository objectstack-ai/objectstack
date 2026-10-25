/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11810 — the field list `ListView` hands its filter builder.
 *
 * Reported on the showcase Tasks list: "Add filter" started every condition on
 * Organization (`organization_id`, `hidden: true`), and the 25-entry field list
 * led with the injected system columns — Organization, Created By, Last
 * Modified At, Last Modified By, Owner, Owning Business Unit — before Title,
 * hidden ones (`owning_business_unit_id`, the `__search` companion) included.
 * The list was the object definition's field map verbatim, and the builder
 * seeds a new row on that list's first entry.
 *
 * The fixture is the served Tasks definition rebuilt from its sources rather
 * than typed by hand: the injected columns are the spec's own
 * `injectedSystemColumnDefs` (the table `applySystemFields` spreads), in the
 * order the report observed them ahead of the declared fields; the declared
 * fields are `task.object.ts`'s, with the author's own `created_at`; the
 * companion is the `hidden` + `system` text column the engine provisions. Its
 * size is the report's 25 — pinned, so a drift in either source is loud.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { injectedSystemColumnDefs } from '@objectstack/spec/data';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

type Candidate = { value: string; label: string; type: string };

// Every field list `ListView` hands the builder, while the REAL builder still
// renders — the "Add filter" pin below drives it.
const captured = vi.hoisted(() => ({ fields: [] as Candidate[][] }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...actual,
    FilterBuilder: (props: React.ComponentProps<typeof actual.FilterBuilder>) => {
      captured.fields.push((props.fields ?? []) as Candidate[]);
      return <actual.FilterBuilder {...props} />;
    },
  };
});

import { ListView } from '../ListView';

/** The declared fields of the showcase Tasks object, in declaration order. */
const DECLARED: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  project: { type: 'master_detail', label: 'Project', reference: 'showcase_project' },
  assignee: { type: 'text', label: 'Assignee' },
  status: { type: 'select', label: 'Status', options: [{ label: 'Backlog', value: 'backlog' }] },
  priority: { type: 'select', label: 'Priority', options: [{ label: 'Low', value: 'low' }] },
  estimate_hours: { type: 'number', label: 'Estimate (h)' },
  progress: { type: 'progress', label: 'Progress' },
  done: { type: 'boolean', label: 'Done' },
  due_date: { type: 'date', label: 'Due Date' },
  start_date: { type: 'date', label: 'Start Date' },
  end_date: { type: 'date', label: 'End Date' },
  created_at: { type: 'datetime', label: 'Created At' },
  location: { type: 'location', label: 'Work Location' },
  cover: { type: 'image', label: 'Cover Image' },
  labels: { type: 'tags', label: 'Labels' },
  notes: { type: 'textarea', label: 'Notes' },
  sync_status: { type: 'select', label: 'Sync Status', options: [{ label: 'Synced', value: 'synced' }] },
  sync_error: { type: 'textarea', label: 'Sync Error' },
};

/** The served map: injected columns first (the author's `created_at` wins its own slot), then declared, then the companion. */
function servedTaskFields(): Record<string, Record<string, unknown>> {
  const injected = injectedSystemColumnDefs({ name: 'showcase_task', fields: DECLARED });
  const ahead = Object.fromEntries(Object.entries(injected).filter(([name]) => !(name in DECLARED)));
  return {
    ...ahead,
    ...DECLARED,
    __search: { type: 'text', label: 'Search Index', hidden: true, system: true, readonly: true },
  };
}

/** The showcase Tasks default list's columns (`task.view.ts`). */
const TASK_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date', 'progress'];

const HIDDEN = ['organization_id', 'owning_business_unit_id', '__search'];
const BUSINESS_REST = ['estimate_hours', 'done', 'start_date', 'end_date', 'location', 'cover', 'labels', 'notes', 'sync_status', 'sync_error'];
const SYSTEM = ['created_by', 'updated_at', 'updated_by', 'owner_id', 'created_at'];

function mount(schemaExtra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'showcase_task', fields: servedTaskFields() }),
  };
  const schema = {
    type: 'list-view',
    objectName: 'showcase_task',
    viewType: 'grid',
    columns: TASK_COLUMNS.map((field) => ({ field })),
    ...schemaExtra,
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <ListView schema={schema} dataSource={dataSource} {...props} />
    </SchemaRendererProvider>,
  );
}

/** Open the Filter popover and wait for the list built from the DEFINITION (not the columns-only fallback). */
async function openFilterFieldList(): Promise<string[]> {
  fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
  await screen.findByText('Filter Records');
  await waitFor(() => {
    const latest = captured.fields[captured.fields.length - 1] ?? [];
    // `estimate_hours` is no column, so seeing it proves the definition loaded.
    expect(latest.some((f) => f.value === 'estimate_hours')).toBe(true);
  });
  return captured.fields[captured.fields.length - 1].map((f) => f.value);
}

function filterPanel() {
  return screen.getByText('Filter Records').closest('[role="dialog"]') as HTMLElement;
}

afterEach(() => {
  cleanup();
  captured.fields.length = 0;
});

describe('objectui#11810 — the filter field list: no hidden field, the view’s columns first, system fields last', () => {
  it('the fixture is the reported shape: 25 fields, hidden system columns first (lit control)', () => {
    const served = servedTaskFields();
    expect(Object.keys(served)).toHaveLength(25);
    expect(Object.keys(served)[0]).toBe('organization_id');
    for (const name of HIDDEN) expect(served[name]?.hidden, name).toBe(true);
  });

  it('offers no hidden field, and orders columns → other business fields → system fields', async () => {
    mount();
    const list = await openFilterFieldList();
    for (const name of HIDDEN) expect(list, name).not.toContain(name);
    expect(list).toEqual([...TASK_COLUMNS, ...BUSINESS_REST, ...SYSTEM]);
  });

  it('"Add filter" starts the new condition on the view’s first visible column', async () => {
    mount();
    await openFilterFieldList();
    fireEvent.click(within(filterPanel()).getByRole('button', { name: /add filter/i }));
    await waitFor(() => {
      expect(within(filterPanel()).getAllByRole('combobox')[0].textContent).toBe('Title');
    });
  });

  it('follows the order the grid shows its columns in (`fieldOrder`), not the authored one', async () => {
    mount({ fieldOrder: ['due_date', 'title'] });
    const list = await openFilterFieldList();
    expect(list.slice(0, TASK_COLUMNS.length)).toEqual(['due_date', 'title', 'project', 'assignee', 'status', 'priority', 'progress']);
  });

  it('keeps a hidden field a held condition filters on, last, so the restored row still names it', async () => {
    mount({}, {
      initialFilters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'organization_id', operator: 'equals', value: '' }] },
    });
    const list = await openFilterFieldList();
    expect(list[list.length - 1]).toBe('organization_id');
    expect(list).not.toContain('owning_business_unit_id');
    expect(within(filterPanel()).getAllByRole('combobox')[0].textContent).toBe('Organization');
  });

  // objectui#13118 — this row pinned the opposite until the spec retired the
  // key: "keeps a hidden field the author named in `filterableFields`", and the
  // list was the three named fields alone. `@objectstack/spec` 18 retires the
  // list view's `filterableFields` (objectstack#24640, ruling C) and no
  // per-view whitelist replaces it, so a stored view that still carries the key
  // gets the spec's list: every readable field, minus the `hidden: true` ones,
  // the same list the first row pins for a view with no key at all.
  it('a stored view still carrying the retired `filterableFields` gets the spec’s list — it neither narrows the panel nor brings a hidden field back (objectui#13118)', async () => {
    mount({ filterableFields: ['owning_business_unit_id', 'estimate_hours', 'title'] });
    const list = await openFilterFieldList();
    for (const name of HIDDEN) expect(list, name).not.toContain(name);
    expect(list).toEqual([...TASK_COLUMNS, ...BUSINESS_REST, ...SYSTEM]);
  });
});
