/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView reads its match total as `QueryResult` DECLARES it — and does NOT
 * read `count` (objectui#6917 arm B, following objectui#6840).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one count member:
 * `total`. Before this pin the fetch effect read
 *
 *     (results as any).total ?? (results as any).count
 *
 * — the same arm objectui#6840 deleted from `RelatedCountStore`, in a module
 * that card was not fenced to touch. It decides a rendered number (the record
 * count bar) and, through `serverTotal`, whether the grid pages server-side at
 * all.
 *
 * MEASURED on this tree for objectui#6917 — its OWN producer census. #6840's
 * zero is seam-local and must not be carried here: the same sweep read 0
 * producers for `value` at `ObjectView`'s seam and 5 at `extractRecords`'
 * seam (objectui#6839) in one and the same pass.
 *
 *   CELL      every `find()` producer body in the repo, bracket-scanned
 *             through chained calls .........................  592 producers
 *   CONTROL   `data`  emitted as an envelope member .........  312 producers
 *   CONTROL   `total` emitted as an envelope member .........  150 producers
 *   SUBJECT   `count` emitted as an envelope member ........     0 producers
 *
 * The controls sit on the JOIN — same cell, same pass, same extraction — so
 * the zero is a reading. Superset sweep too: of the 418 files holding a
 * `find()` producer, 25 contain the token `count:` anywhere and not one is an
 * envelope member (the DataSource's own sibling `count()` method, row fields,
 * i18n interpolation parameters, aggregate function names, React state, DOM
 * assertions, comments, and objectui#6840's own refusal pin).
 *
 * Both adapters' `normalizeQueryResult` fold `count` into `total` below the
 * fold; ListView calls `dataSource.find()` strictly above it, so the arm was
 * unreachable — exactly where a non-conforming producer keeps working
 * unrejected (AGENTS.md #0.1).
 *
 * ⛔ The fix is the deletion, NOT widening `QueryResult` to bless `count`.
 *
 * ⚠️ NOT fixed here, and deliberately: this same fetch effect ALSO unwraps rows
 * with `data → records → value`. That ladder is the `records`/`value` tolerance
 * set owned by objectui#6839's `extractRecords` family, not this card's
 * `count`/`value` residue, and objectui#6917 does not enumerate it. Reported
 * for #6839 rather than half-repaired here.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'showcase_contact';
const PAGE_SIZE = 10;
/** Three rows — fewer than the page size, so the row count and any server
 *  total are free to disagree and the disagreement is the whole measurement. */
const ROWS = [
  { id: 'c-0', name: 'Ada' },
  { id: 'c-1', name: 'Grace' },
  { id: 'c-2', name: 'Alan' },
];

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});
afterEach(cleanup);

function makeDataSource(answer: unknown) {
  return {
    find: vi.fn(async () => answer),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

const listSchema = (): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  fields: ['name'],
  // A page size is what turns on ListView's server-paging branch — the branch
  // that reads a server total at all.
  pagination: { pageSize: PAGE_SIZE },
} as unknown as ListViewSchema);

/**
 * Render against a `find()` answering `answer` and return the record-count
 * bar's text. Scoped by test id rather than queried globally: the digits of a
 * total can collide with row text, and `queryByText` throws on multiple
 * matches exactly as it does on none.
 */
async function recordCountText(answer: unknown): Promise<string> {
  const ds = makeDataSource(answer);
  const { getByTestId } = render(
    // Without an English provider the `{{count}}` interpolation never runs and
    // the raw template reaches the DOM, which would make the count unassertable.
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={listSchema()} dataSource={ds} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  let bar!: HTMLElement;
  await waitFor(() => {
    bar = getByTestId('record-count-bar');
    expect(within(bar).getByText(/record/)).toBeInTheDocument();
  });
  return within(bar).getByText(/record/).textContent ?? '';
}

describe('ListView find() envelope — objectui#6917', () => {
  it('still reads the server-side `total` — the contract\'s count member', async () => {
    expect(await recordCountText({ data: ROWS, total: 42 })).toBe('42 records');
  });

  it('does NOT read `count` — falls back to the honest page-local row count', async () => {
    // Before the fix this bar read "7 records" off an undeclared key. It now
    // reports what it can actually see rather than legitimising a second
    // de-facto contract.
    expect(await recordCountText({ data: ROWS, count: 7 })).toBe('3 records');
  });

  it('does NOT let `count` stand in when `total` is absent, even alongside rows', async () => {
    // The caricature guard: a reader that returned any number it could find in
    // the envelope would answer "7 records" here.
    expect(await recordCountText({ data: ROWS, count: 99 })).toBe('3 records');
  });

  it('`total` still outranks `count` — unchanged, and the control for the two above', async () => {
    // Green before AND after the fix: the arm that was always correct. Its
    // presence is what makes the refusals above a reading of THIS deletion
    // rather than of a ListView that stopped counting.
    expect(await recordCountText({ data: ROWS, total: 42, count: 7 })).toBe('42 records');
  });
});
