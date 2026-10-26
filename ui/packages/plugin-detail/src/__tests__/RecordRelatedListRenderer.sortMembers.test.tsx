/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list.sort` — the MEMBER shape the renderer reads
 * (objectui#8068 / objectui#8071).
 *
 * The per-block member pin objectui#8068 requires: what this block does with
 * the ELEMENTS of its `sort` array, not a restatement of the registration.
 * The registration declares `{ name: 'sort', type: 'array' }` and stops there —
 * no `of`, no description — so the published surface says "an array" and says
 * nothing whatever about what an element is. `ComponentInput` cannot say more
 * (`of` carries a member KIND and nothing finer, objectui#8067), which is
 * exactly why the shape has to be pinned against the READ SITE instead.
 *
 * ## Where the read actually happens
 *
 * `renderers/record-related-list.tsx` hands `schema.sort` to `RelatedList` as
 * `defaultSort`, and `RelatedList`'s `normalizeSortSpec` is the function that
 * reads the members. It lowers them into the `$orderby` this block puts on the
 * wire, so the wire is where the member contract is observable — a prop-level
 * assertion would only pin that a value was threaded somewhere.
 *
 * ## ⚠️ The same spec union, two different string arms
 *
 * `ListView.sort` and `record:related_list.sort` declare the SAME union in
 * `@objectstack/spec` (`string | Array<{field, order}>`) and mean DIFFERENT
 * things by the string arm: ListView's string is the legacy space-separated
 * clause (`'seq_no desc'`), while this block's `normalizeSortSpec` reads the
 * OData-ish `'field'` / `'-field'`. objectui#8221 retired the legacy clause AT
 * THE DERIVATION BOUNDARY (`deriveRelatedLists` refuses it out loud rather than
 * translating it); it did not change what THIS key accepts, and the pins below
 * are about this key. The divergence is stated here because a reader who knows
 * one arm will assume the other.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';
import '../index';

const rows = [{ id: 'c1', name: 'Alice' }];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

/** Render the BLOCK (not `RelatedList` directly) with only `sort` varying. */
function renderBlock(sort: unknown, ds = makeDS()) {
  render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
      <RecordRelatedListRenderer
        schema={{ objectName: 'contact', relationshipField: 'account', columns: ['name'], sort } as any}
      />
    </RecordContextProvider>,
  );
  return ds;
}

/** The `$orderby` this block put on the wire, or `undefined` when it sent none. */
async function orderbyOf(sort: unknown): Promise<unknown> {
  const ds = renderBlock(sort);
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls[0] as any[])[1].$orderby;
}

const input = (name: string) =>
  ComponentRegistry.getConfig('record:related_list')?.inputs?.find((i) => i.name === name);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('record:related_list — the `sort` MEMBER shape the renderer reads (objectui#8068)', () => {
  it('CONTROL — the key is declared as a bare array, so the members are undescribed', () => {
    // Calibration for everything below: this pin exists BECAUSE the published
    // surface stops at the kind. If a future change gives `sort` an `of` or a
    // member description, this assertion reddens and whoever wrote it must
    // re-read the pins below rather than assume they still say something new.
    expect(input('sort')).toBeDefined();
    expect(input('sort')?.type).toBe('array');
    expect(input('sort')?.of).toBeUndefined();
    expect(input('sort')?.description).toBeUndefined();
  });

  it('SUBJECT — an array member is `{ field, order }`, and it reaches $orderby verbatim', async () => {
    // The member vocabulary, asserted where it lands. `toEqual` on the whole
    // array, not a `field` spot-check: a member re-spelled on the way down
    // (`{ name, direction }`, `'-created'`) would be the drift this pin exists
    // to catch, and a spot-check would not see it.
    expect(await orderbyOf([{ field: 'created', order: 'desc' }])).toEqual([
      { field: 'created', order: 'desc' },
    ]);
  });

  it('keeps multi-key order, in the order authored', async () => {
    // Members are ORDERED — a sort is a sequence, and a member reader that
    // reduced it to one key would still pass the assertion above.
    expect(
      await orderbyOf([
        { field: 'stage', order: 'asc' },
        { field: 'created', order: 'desc' },
      ]),
    ).toEqual([
      { field: 'stage', order: 'asc' },
      { field: 'created', order: 'desc' },
    ]);
  });

  it('⚠️ DROPS a member with no `field`, silently and without refusing the rest', async () => {
    // `normalizeSortSpec` is `sort.filter((s) => !!s?.field)`. The member the
    // author got wrong disappears with no diagnostic while its siblings survive,
    // so a two-key order silently becomes a one-key order. Pinned as the
    // behaviour it is — this is the half of the member contract an author
    // cannot discover from a declaration that says only "array".
    expect(
      await orderbyOf([{ order: 'desc' }, { field: 'created', order: 'desc' }]),
    ).toEqual([{ field: 'created', order: 'desc' }]);
  });

  it('sends NO $orderby when every member is unusable, rather than an empty clause', async () => {
    expect(await orderbyOf([{ order: 'desc' }])).toBeUndefined();
  });

  it('reads the STRING arm as `field` / `-field`, the OData-ish spelling', async () => {
    // The arm the registration does not declare at all (`type: 'array'`) and the
    // renderer nevertheless reads. Both directions, because the sign is the
    // whole content of the arm.
    expect(await orderbyOf('created')).toEqual([{ field: 'created', order: 'asc' }]);
    expect(await orderbyOf('-created')).toEqual([{ field: 'created', order: 'desc' }]);
  });

  it('COUNTER-PROBE — no `sort` authored sends no $orderby at all', async () => {
    // Non-vacuity: without this, every assertion above would be satisfied by a
    // block that never sends `$orderby` and a helper that reads `undefined`.
    expect(await orderbyOf(undefined)).toBeUndefined();
  });
});
