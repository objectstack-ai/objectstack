/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#6108] Both of a related list's sort entry points consume the platform's
 * per-column sortability signal — objectstack#10235 ruling A, through #5729's
 * landed spelling (`isPlatformSortableField`). They used to re-derive the same
 * verdict from the field's TYPE, via `isUnmaterializedFieldType`.
 *
 * TWO surfaces, pinned separately and on purpose. They never shared a
 * derivation before this card, which is how the same refused sort stayed
 * reachable through whichever control the other one did not cover:
 *
 *  - the embedded table's column headers (`type: 'table' | 'grid'`), read off
 *    the column's own `sortable` flag;
 *  - the sort-button row that survives for `type: 'list'` (`data-list` has no
 *    headers), read off which buttons are rendered.
 *
 * ## Why the cells below are the ones they are
 *
 * The deleted predicate and the contract that replaced it AGREE about
 * `formula` — the platform computes its own projection from the same
 * `@objectstack/spec` storage fact — which is exactly why the drift went
 * unnoticed. A pin over a formula field would pass against the re-derivation
 * too and prove nothing. Every cell here is an input where the two DISAGREE:
 *
 *  - ABSENCE (`account.name`, a dotted path, and `audited_at`, an
 *    unprovisioned audit column). The projection's domain is "the served field
 *    map plus the always-provisioned `id`"; a name outside it has no platform
 *    sort behind it (`ObjectSortabilitySchema.fields`, spec). The contract
 *    withholds. The type read resolves NO field definition for either name, so
 *    `isUnmaterializedFieldType(undefined)` is `false` and it offers them —
 *    the exact family a caller-supplied `columns` prop can put on screen.
 *  - A NON-VIRTUAL REFUSAL (`remote_status`). `sortable: false` with no
 *    `reason: virtual-type` — how "any future verdict the runtime doors add"
 *    arrives. The contract withholds; a type read sees `text` and offers it.
 *  - THE PLATFORM MOVING (`rolled_total`). A `formula` the projection answers
 *    `sortable: true` for. The contract OFFERS it — the one cell running the
 *    opposite direction, and the one no type read can ever follow.
 *
 * Controls sit in the same render throughout: `total` (a formula both readings
 * withhold), `owner` (the relational carve-out, deliberately NOT delegated to
 * the signal — the projection says `sortable: true` for it), and `name` (a
 * stored column that stays sortable, which also proves the list rendered).
 *
 * AGREEMENT over hardcoding for everything that is not a drift cell: the base
 * projection comes from the platform's own `resolveObjectSortability`
 * (`@objectstack/spec/api`), the resolver the REST layer serves it from.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Surface 1 reads the table HEADERS and needs this branch. Surface 2 exercises
 * `type='list'`, which the mobile carve-out never touches (it applies to
 * `grid`/`table` only), so the pin states the branch without changing it.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer, so the column's own
// `sortable` flag can be read without the table in the way.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const objectSchema = {
  name: 'line_item',
  fields: {
    name: { type: 'text', label: 'Name' },
    // Agreement control — a formula both readings withhold.
    total: { type: 'formula', label: 'Total' },
    // DRIFT: refused with no `reason: virtual-type`.
    remote_status: { type: 'text', label: 'Remote Status' },
    // DRIFT: a formula the platform DOES order by.
    rolled_total: { type: 'formula', label: 'Rolled Total' },
    // DRIFT: present on the object, absent from the served projection.
    audited_at: { type: 'datetime', label: 'Audited At' },
    // Relational carve-out — the projection answers `sortable: true` here.
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  },
};

/**
 * Columns as a CALLER declares them — which is where `account.name` gets in:
 * a dotted path is a legal thing to put in a related list's `columns`, it
 * resolves to no field definition at all, and the platform has no sort behind
 * it either.
 */
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'total', header: 'Total' },
  { accessorKey: 'remote_status', header: 'Remote Status' },
  { accessorKey: 'rolled_total', header: 'Rolled Total' },
  { accessorKey: 'audited_at', header: 'Audited At' },
  { accessorKey: 'account.name', header: 'Account Name' },
  { accessorKey: 'owner', header: 'Owner' },
];

function servedProjection() {
  const resolved = resolveObjectSortability(objectSchema) as { fields: Record<string, any> };
  const fields: Record<string, any> = { ...resolved.fields };
  // Sanity on the base the drift cells are measured against.
  expect(fields.name).toEqual({ sortable: true });
  expect(fields.total.sortable).toBe(false);
  expect(fields.owner).toEqual({ sortable: true });
  // The resolver never had an entry for the dotted path — absence, not a
  // deletion. Assert that rather than assume it.
  expect(fields['account.name']).toBeUndefined();

  delete fields.audited_at;
  fields.remote_status = { sortable: false };
  fields.rolled_total = { sortable: true };
  return { fields };
}

const items = Array.from({ length: 9 }, (_, i) => ({
  id: `li${i}`,
  name: `Item ${i}`,
  total: i * 100,
  remote_status: 'open',
  rolled_total: i,
  audited_at: '2026-01-01',
  // The dotted path arrives FLAT on the row, which is how an expanded related
  // record reaches a related list — and why `pruneEmpty` keeps the column.
  'account.name': `Acme ${i}`,
  owner: `usr_${i}`,
}));

const makeDataSource = (opts: { servesSignal?: boolean } = {}) => ({
  getObjectSchema: vi.fn(async (api: string) => {
    if (api !== 'line_item') return { name: api, fields: {} };
    const schema = JSON.parse(JSON.stringify(objectSchema));
    if (opts.servesSignal !== false) attachObjectSortability(schema, servedProjection());
    return schema;
  }),
  find: vi.fn(async (api: string, params: any) => {
    if (api !== 'line_item') return { data: [] };
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? items.length;
    return { data: items.slice(skip, skip + top), total: items.length };
  }),
});

/** Whether the embedded table offers a sort on this column. */
const columnSortable = (accessorKey: string) => {
  const col = h.schema?.columns?.find((c: any) => c.accessorKey === accessorKey);
  return col ? col.sortable !== false : undefined;
};

/** Windowed: no `data` prop, an `api`, a page size and a `find`. */
function renderWindowed(type: 'table' | 'list', dsOpts = {}) {
  const dataSource = makeDataSource(dsOpts);
  render(
    <RelatedList
      title="Line Items"
      type={type}
      api="line_item"
      objectName="line_item"
      referenceField="opportunity"
      parentId="OPP-1"
      pageSize={4}
      columns={columns}
      sortable
      dataSource={dataSource as any}
    />,
  );
  return dataSource;
}

/** Which sort BUTTONS the `data-list` variant rendered. */
const sortButtonLabels = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent?.trim() ?? '')
    .filter((label) => columns.some((c) => label.startsWith(c.header)));

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList surface 1 — the embedded table headers (#6108)', () => {
  it('offers exactly what the platform will order by, across all three drift families', async () => {
    renderWindowed('table');
    // A stored column stays sortable — which also proves the table rendered.
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // DRIFT, contract withholds / type read would offer:
    expect(columnSortable('audited_at')).toBe(false); // absent from projection
    expect(columnSortable('account.name')).toBe(false); // dotted path, no entry
    expect(columnSortable('remote_status')).toBe(false); // refusal, no virtual reason
    // DRIFT, contract offers / type read would withhold:
    expect(columnSortable('rolled_total')).toBe(true);
    // Agreement control — still withheld.
    expect(columnSortable('total')).toBe(false);
  });

  it('withholds a name the projection has no entry for — absence is a refusal, not a default', async () => {
    renderWindowed('table');
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // An unprovisioned audit column: on the object, outside the projection.
    expect(columnSortable('audited_at')).toBe(false);
  });

  it('withholds a dotted path — a caller can declare one, and no field def resolves for it', async () => {
    renderWindowed('table');
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // `isUnmaterializedFieldType(undefined)` is `false`, so the deleted type
    // read offered this column its header click. The projection has no entry.
    expect(columnSortable('account.name')).toBe(false);
  });

  it('withholds a refusal that carries no `virtual-type` reason', async () => {
    renderWindowed('table');
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    expect(columnSortable('remote_status')).toBe(false);
  });

  it('follows the platform when it moves: a formula it DOES order by keeps its header', async () => {
    renderWindowed('table');
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // The direction no type read can follow.
    expect(columnSortable('rolled_total')).toBe(true);
    // …while the formula the platform still refuses stays withheld — so this
    // is the served verdict being read, not "formulas are back".
    expect(columnSortable('total')).toBe(false);
  });

  it('keeps the relational carve-out separate from the signal', async () => {
    renderWindowed('table');
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // The projection answers `sortable: true` for `owner`: the platform CAN
    // order by the stored foreign key. The UI withholds for its own reason —
    // that order means nothing beside a column of related-record names.
    expect(columnSortable('owner')).toBe(false);
  });

  it('falls back to the type read when the deployment served no projection', async () => {
    renderWindowed('table', { servesSignal: false });
    await waitFor(() => expect(columnSortable('name')).toBe(true));

    // The pre-#6108 verdicts, exactly: only `formula` and relational withheld.
    expect(columnSortable('total')).toBe(false);
    expect(columnSortable('rolled_total')).toBe(false);
    expect(columnSortable('owner')).toBe(false);
    expect(columnSortable('audited_at')).toBe(true);
    expect(columnSortable('account.name')).toBe(true);
    expect(columnSortable('remote_status')).toBe(true);
  });

  it('leaves every header live in client mode, where the key is the value the cell shows', async () => {
    const dataSource = makeDataSource();
    render(
      <RelatedList
        title="Line Items"
        type="table"
        api="line_item"
        objectName="line_item"
        referenceField="opportunity"
        parentId="OPP-1"
        columns={columns}
        sortable
        data={items}
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    // Not windowed ⇒ no server `$orderby` ⇒ the signal is not this question's
    // answer. The platform's refusals must not leak into the in-memory sort.
    expect(columnSortable('remote_status')).toBe(true);
    expect(columnSortable('audited_at')).toBe(true);
    expect(columnSortable('total')).toBe(true);
  });
});

describe('RelatedList surface 2 — the `data-list` sort-button row (#6108)', () => {
  it('renders a button for exactly what the platform will order by', async () => {
    renderWindowed('list');
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    const labels = sortButtonLabels();
    // Controls, offered under both readings — and proof the row rendered.
    expect(labels).toContain('Name');
    // DRIFT, contract offers / type read would withhold:
    expect(labels).toContain('Rolled Total');
    // DRIFT, contract withholds / type read would offer:
    expect(labels).not.toContain('Audited At');
    expect(labels).not.toContain('Account Name');
    expect(labels).not.toContain('Remote Status');
    // Agreement control and the relational carve-out.
    expect(labels).not.toContain('Total');
    expect(labels).not.toContain('Owner');
  });

  it('drops the button for an absent name, a dotted path, and a reasonless refusal', async () => {
    renderWindowed('list');
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    const labels = sortButtonLabels();
    // Positive control in the same render — the row exists and is populated.
    expect(labels).toContain('Name');
    expect(labels).not.toContain('Audited At');
    expect(labels).not.toContain('Account Name');
    expect(labels).not.toContain('Remote Status');
  });

  it('follows the platform when it moves: a formula it DOES order by keeps its button', async () => {
    renderWindowed('list');
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    const labels = sortButtonLabels();
    expect(labels).toContain('Rolled Total');
    expect(labels).not.toContain('Total');
  });

  it('keeps the relational carve-out separate from the signal', async () => {
    renderWindowed('list');
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    // The projection answers `sortable: true` for `owner`; this row withholds
    // for its own reason.
    expect(sortButtonLabels()).not.toContain('Owner');
  });

  it('falls back to the type read when the deployment served no projection', async () => {
    renderWindowed('list', { servesSignal: false });
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    const labels = sortButtonLabels();
    // The pre-#6108 button row, exactly.
    expect(labels).toContain('Name');
    expect(labels).toContain('Audited At');
    expect(labels).toContain('Account Name');
    expect(labels).toContain('Remote Status');
    expect(labels).not.toContain('Rolled Total');
    expect(labels).not.toContain('Total');
    expect(labels).not.toContain('Owner');
  });
});
