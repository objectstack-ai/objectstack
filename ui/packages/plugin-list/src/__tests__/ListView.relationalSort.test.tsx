/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3096 — the toolbar sort picker stops offering relational fields.
 *
 * This view's sort leaves as a server `$orderby` on the flat field name, so
 * picking `owner` ordered the whole collection by the stored foreign-key id
 * while the column showed people's names. The server cannot order by the
 * related record's name without a join (objectstack#4256 settled that it
 * won't), so the picker no longer offers the illusion — and says why.
 *
 * A relational field the CURRENT sort already uses stays listed (flagged as
 * ordering by ID) so a view authored or saved with such a sort round-trips
 * instead of rendering a blank row and losing the sort on the next edit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
    account: { type: 'master_detail', label: 'Account', reference: 'accounts' },
    assignee: { type: 'user', label: 'Assignee', reference: 'sys_user' },
    // No target key. It carried the retired snake_case spelling, which
    // `FieldSchema` refuses BY NAME, and the sort picker's object-def branch
    // reads only the declared `reference` (objectui#6837 half 2) — so the
    // line annotated nothing and was read by nothing. On a `tree` the target
    // is optional; this object is `contacts` and the value named it, so
    // renaming would turn a refused key into an accepted self-annotation this
    // fixture never made (objectui#8031).
    parent: { type: 'tree', label: 'Parent' },
    // The picker's SECOND withholding rule (#4243, and the shared judgement as
    // of objectui#3950): computed on read, no column to order by. Present in
    // this fixture so the exact option lists below pin its absence rather than
    // only prose describing it.
    score: { type: 'formula', label: 'Score' },
  },
};

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(objectDef),
});

const baseSchema: ListViewSchema = {
  type: 'list-view',
  objectName: 'contacts',
  viewType: 'grid',
  columns: ['name', 'amount', 'owner', 'account', 'assignee', 'parent', 'score'] as any,
};

async function openSortPopover(schema: ListViewSchema) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView schema={schema} dataSource={dataSource as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  return await screen.findByText('Sort Records');
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

describe('ListView sort picker — relational fields (objectui#3096)', () => {
  it('offers plain fields but no relational ones, and explains the omission', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    expect(await sortFieldOptions()).toEqual(['Name', 'Amount']);
    // The four relational types the renderer expands are all withheld:
    // lookup / master_detail / user / tree.
    expect(screen.getByTestId('sort-relational-info')).toHaveAttribute('title', expect.stringMatching(/can only be sorted by the stored ID/i));
  });

  /**
   * objectui#4294 — the remedy the hint names has to be one the server will
   * actually sort by. It used to say "add a formula field holding it", and a
   * formula field is precisely the type the server refuses to order by
   * (objectstack `UNMATERIALIZED_SORT_TYPES`, a hard 400 since
   * objectstack#6994): an author who followed the hint landed on a refusal —
   * and, since #4243 withheld formula fields from the picker, on a field this
   * very panel does not offer. The wording now tracks the server's own
   * refusal-door hint (a STORED, denormalised field, written when the source
   * changes), so this pins both halves: the remedy it gives, and the one it
   * must never give again.
   */
  it('points at a stored denormalised field, never a formula field (objectui#4294)', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    // objectui#12528 — the note is the info control's tooltip now.
    const hint = screen.getByTestId('sort-relational-info').getAttribute('title') ?? '';
    expect(hint).toMatch(/denormalize it onto this object as a stored field/i);
    // A formula field is still named — to be ruled OUT. So the pin cannot be
    // "the word formula is absent"; it is the recommendation shape that must
    // have flipped, in both directions.
    expect(hint).toMatch(/not a formula field/i);
    expect(hint).not.toMatch(/add a formula field/i);
  });

  /**
   * objectui#4243's own rule, pinned behaviourally for the first time here
   * (objectui#3950): a `formula` field is withheld too, and for a different
   * reason — not "the key would be invisible" but "there is no key". Silently,
   * because the relational hint's sentence is about relations; the remedy for
   * this one is a stored denormalised field, which is what the hint above
   * already recommends for its own case.
   *
   * The exception the relational half has, this half needs more: a formula field
   * the CURRENT sort already names stays listed, because that row is the only
   * way to remove a sort the server refuses outright.
   */
  it('withholds a formula field — there is no key to order by', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    const options = await sortFieldOptions();
    expect(options).not.toContain('Score');
    // Collateral control: the two stored columns are still both offered, so the
    // omission is this one field's type and not a narrower picker.
    expect(options).toEqual(['Name', 'Amount']);
  });

  it('keeps a formula field the current sort already names — the only way to remove it', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'score', order: 'asc' }] } as any);

    // Unflagged, unlike the relational exception: ordering by ID is a truth
    // about a relational key, and this field has no key at all to describe.
    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Score']);
  });

  it('keeps a relational field the current sort already uses, flagged as by-ID', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'owner', order: 'asc' }] } as any);

    const options = await sortFieldOptions();
    expect(options).toContain('Owner (by ID)');
    // Still only the one in use — the other three stay withheld.
    expect(options).toEqual(['Name', 'Amount', 'Owner (by ID)']);
  });

  it('drops the hint when the object has no relational field to withhold', async () => {
    const flatDataSource = {
      ...makeDataSource(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'contacts',
        fields: { name: { type: 'text', label: 'Name' } },
      }),
    };
    render(
      <SchemaRendererProvider dataSource={flatDataSource as any}>
        <ListView
          schema={{ ...baseSchema, columns: ['name'] } as any}
          dataSource={flatDataSource as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(flatDataSource.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
    await screen.findByText('Sort Records');
    expect(screen.queryByTestId('sort-relational-info')).toBeNull();
  });
});

/**
 * objectui#12528 nail 2 — the note is no longer a standing paragraph that took
 * about half the popover on every open: it is an info control beside the
 * popover's title, the note as its tooltip and accessible name, and one line
 * under the rows only while the current sort names a linked column.
 */
describe('ListView sort popover — the relational note as an info control (objectui#12528)', () => {
  it('draws no paragraph: an info control carries the note', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    expect(screen.queryByTestId('sort-relational-hint')).toBeNull();
    const info = screen.getByTestId('sort-relational-info');
    expect(info).toHaveAttribute('title', expect.stringMatching(/can only be sorted by the stored ID/i));
    expect(info).toHaveAttribute('aria-label', info.getAttribute('title')!);
    expect(info.textContent).toBe('');
  });

  it('says in one line that a linked column in the current sort orders by ID', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'owner', order: 'asc' }] } as any);

    expect(screen.getByTestId('sort-relational-picked')).toHaveTextContent(
      'A linked column sorts by the stored ID, not the name shown.',
    );
  });

  it('CONTROL: a sort on a plain field shows no one-line hint', async () => {
    await openSortPopover({ ...baseSchema, sort: [{ field: 'name', order: 'asc' }] } as any);

    expect(screen.queryByTestId('sort-relational-picked')).toBeNull();
  });
});
