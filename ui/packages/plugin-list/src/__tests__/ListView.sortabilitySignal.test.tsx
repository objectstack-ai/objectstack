/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#6108] The toolbar sort picker consumes the platform's per-column
 * sortability signal — objectstack#10235 ruling A, through #5729's landed
 * spelling (`isPlatformSortableField`). It used to re-derive the same verdict
 * from the field's TYPE, via `UNMATERIALIZED_FIELD_TYPES`.
 *
 * ## Why the cells below are the ones they are
 *
 * The predicate that was deleted and the contract that replaced it AGREE about
 * `formula` — the platform computes its own projection from the same
 * `@objectstack/spec` storage fact — and that agreement is exactly why the
 * drift went unnoticed for two cards. So a pin over a formula field would pass
 * against the re-derivation too and prove nothing at all.
 *
 * Every cell here is therefore an input where the two DISAGREE, and this file
 * names each one:
 *
 *  - ABSENCE (`audited_at`). The projection's domain is "the served field map
 *    plus the always-provisioned `id`"; a name absent from it — an unknown
 *    field, a dotted path, an unprovisioned audit column — has no platform
 *    sort behind it (`ObjectSortabilitySchema.fields`, spec). The contract
 *    withholds. A type read sees `datetime`, not `formula`, and offers it.
 *  - A NON-VIRTUAL REFUSAL (`remote_status`). `sortable: false` with no
 *    `reason: virtual-type` — the shape "any future verdict the runtime doors
 *    add" arrives in. The contract withholds; a type read sees `text` and
 *    offers it.
 *  - THE PLATFORM MOVING (`rolled_total`). A `formula` the projection answers
 *    `sortable: true` for. The contract OFFERS it — the one cell that runs the
 *    opposite direction from the rest, and the one no type read can ever
 *    follow: it withholds on the type alone, forever.
 *
 * Controls sit beside them in the same render, because "the picker offers
 * fewer options" is trivially satisfied by a picker that offers none:
 * `expected_revenue` (a formula both readings withhold), `owner` (the
 * relational carve-out, deliberately NOT delegated to the signal), and the two
 * plain stored columns that stay offered throughout.
 *
 * AGREEMENT over hardcoding, for everything that is not a drift cell: the base
 * projection is produced by the platform's own `resolveObjectSortability`
 * (`@objectstack/spec/api`) — the resolver the REST layer serves it from — so
 * the control cells follow the runtime's predicate rather than a copied table.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    // Agreement control — a formula the platform refuses and a type read
    // refuses too.
    expected_revenue: { type: 'formula', label: 'Expected Revenue' },
    // DRIFT: absent from the served projection.
    audited_at: { type: 'datetime', label: 'Audited At' },
    // DRIFT: refused with no `reason: virtual-type`.
    remote_status: { type: 'text', label: 'Remote Status' },
    // DRIFT: a formula the platform DOES order by.
    rolled_total: { type: 'formula', label: 'Rolled Total' },
    // Relational carve-out — the projection answers `sortable: true` here.
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  },
};

/**
 * The served projection: the platform's own resolver, then the three drift
 * cells set to what a platform that has moved past a type read would serve.
 */
function servedProjection() {
  const resolved = resolveObjectSortability(objectDef) as { fields: Record<string, any> };
  const fields: Record<string, any> = { ...resolved.fields };
  // Sanity on the base the drift cells are measured against — if the platform
  // resolver ever stopped answering these the way this file assumes, the drift
  // cells below would be measuring something else.
  expect(fields.amount).toEqual({ sortable: true });
  expect(fields.expected_revenue.sortable).toBe(false);
  expect(fields.owner).toEqual({ sortable: true });

  delete fields.audited_at;
  fields.remote_status = { sortable: false };
  fields.rolled_total = { sortable: true };
  return { fields };
}

const makeDataSource = (opts: { servesSignal?: boolean } = {}) => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => {
    const schema = JSON.parse(JSON.stringify(objectDef));
    if (opts.servesSignal !== false) attachObjectSortability(schema, servedProjection());
    return schema;
  }),
});

const baseSchema: ListViewSchema = {
  type: 'list-view',
  objectName: 'crm_opportunity',
  viewType: 'grid',
  columns: [
    'name',
    'amount',
    'expected_revenue',
    'audited_at',
    'remote_status',
    'rolled_total',
    'owner',
  ] as any,
};

async function openSortPopover(schema: ListViewSchema, dsOpts = {}) {
  const dataSource = makeDataSource(dsOpts);
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView schema={schema} dataSource={dataSource as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
  return dataSource;
}

/** Labels offered by the sort field <Select> (Radix renders them on open). */
async function sortFieldOptions(): Promise<string[]> {
  const combos = screen.getAllByRole('combobox');
  fireEvent.click(combos[0]);
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent?.trim() ?? '');
}

describe('ListView sort picker — the served sortability signal (#6108)', () => {
  it('offers exactly what the platform will order by, across all three drift families', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    // One list, read once. Each membership below is a separate claim:
    //   Name / Amount        — controls, offered under both readings
    //   Rolled Total         — DRIFT, offered ONLY by the contract (formula,
    //                          `sortable: true`); a type read withholds it
    //   Audited At           — DRIFT, absent from the projection ⇒ withheld;
    //                          a type read (`datetime`) would offer it
    //   Remote Status        — DRIFT, `sortable: false` on a `text` field ⇒
    //                          withheld; a type read would offer it
    //   Expected Revenue     — agreement control, withheld either way
    //   Owner                — relational carve-out, withheld either way
    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Rolled Total']);
  });

  it('withholds a name the projection has no entry for — absence is a refusal, not a default', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    const options = await sortFieldOptions();
    expect(options).not.toContain('Audited At');
    // Positive control in the SAME render: a stored sibling is still offered,
    // so the omission is this name's absence and not a dead picker.
    expect(options).toContain('Amount');
  });

  it('withholds a refusal that carries no `virtual-type` reason', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    const options = await sortFieldOptions();
    expect(options).not.toContain('Remote Status');
    expect(options).toContain('Amount');
  });

  it('follows the platform when it moves: a formula it DOES order by keeps its option', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    const options = await sortFieldOptions();
    // The direction no type read can follow.
    expect(options).toContain('Rolled Total');
    // …and the other formula field, which the platform still refuses, is out —
    // so this is the served verdict being read, not "formulas are back".
    expect(options).not.toContain('Expected Revenue');
  });

  it('keeps the relational carve-out separate from the signal', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    // The projection answers `sortable: true` for `owner`: the platform CAN
    // order by the stored foreign key. The UI withholds for its own reason —
    // that order means nothing beside a column of names. Folding this into the
    // signal would hand every relational field its option back.
    expect(await sortFieldOptions()).not.toContain('Owner');
    expect(screen.getByTestId('sort-relational-info')).toBeInTheDocument();
  });

  /**
   * The picker's deliberate keep-current-sort behaviour, over the family that
   * only exists after this card. A view saved before the signal existed can
   * name a field the platform now refuses; withholding the option unconditionally
   * would render a blank row the user cannot remove — and re-emit the refused
   * entry into the next sort the host stores.
   */
  it('keeps a platform-refused field the CURRENT sort already names, so it can be removed', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'remote_status', order: 'asc' }] } as any);

    // Unflagged: "(by ID)" is a truth about a relational key, and this refusal
    // is not that.
    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Remote Status', 'Rolled Total']);
  });

  it('keeps the exception for an ABSENT name too', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'audited_at', order: 'asc' }] } as any);

    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Audited At', 'Rolled Total']);
  });

  it('flags an in-use relational field by ID, unchanged by the signal', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'owner', order: 'asc' }] } as any);

    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Rolled Total', 'Owner (by ID)']);
  });

  /**
   * NO SIGNAL SERVED is a different question from "nothing is sortable": a
   * deployment older than objectstack#10235, or an inline/mock data source.
   * That branch keeps the type read as a compatibility floor, so this is the
   * pre-#6108 option list exactly — and it is also what every cell above would
   * read if the contract branch were removed.
   */
  it('falls back to the type read when the deployment served no projection', async () => {
    await openSortPopover(
      { ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any,
      { servesSignal: false },
    );

    expect(await sortFieldOptions()).toEqual([
      'Name',
      'Amount',
      'Audited At',
      'Remote Status',
    ]);
  });
});
