/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker`'s `sort` — the MEMBER shape the renderer reads
 * (objectui#8068 / objectui#8071 slice 3), on the one door it is read through
 * since objectui#11880: the node-level `dataSource` binding's `sort`.
 *
 * The flat `properties.sort` was a registered input (`type: 'array', of:
 * 'object'`) read as `composed?.sort ?? props.sort`. objectstack#11509 (ruled
 * A-narrow) retires it with the other flat query keys, and the picker now
 * reads `dataSource.sort` only: the flat key stays published until the spec's
 * v18 retirement ships, and is not read. The member contract is unchanged and
 * is pinned below on the binding.
 *
 * ## Where the read happens, and why it is an IDENTITY pin
 *
 * `record-picker.tsx`:
 *
 *     const sort = composed?.sort;
 *     …
 *     if (sort) query.$orderby = sort;
 *
 * There is no `normalizeSortSpec` here, unlike `record:related_list.sort`
 * (objectui#8071 slice 2) — the array authored on `dataSource.sort` reaches
 * `$orderby` BY REFERENCE (`composeElementDataSource` passes `config.sort`
 * through), unfiltered and untransformed. A malformed member (missing `field`)
 * is NOT dropped the way the sibling block drops one, because nothing here
 * inspects a member at all.
 *
 * No adapter's `getObjectSchema` is needed: no case below names a `view`, so
 * the saved-view fetch never engages — matching the disposition `record-picker-element-data-source.test.tsx` already
 * established for the `view`-bearing cases of this same block.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers `element:record_picker` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

const makeAdapter = () => ({
  find: vi.fn().mockResolvedValue({ data: [] }),
  getObjectSchema: vi.fn(),
});

/**
 * `label` / `placeholder` and the other display keys live under
 * `schema.properties` (the spec's element config bag, `readProps` above); the
 * per-element `dataSource` BINDING — the query — is a sibling top-level schema
 * key, read directly off `schema.dataSource` by `useElementDataSource`.
 */
const renderPicker = (
  properties: Record<string, unknown>,
  adapter: ReturnType<typeof makeAdapter>,
  dataSource?: Record<string, unknown>,
) =>
  render(
    <AdapterCtx.Provider value={adapter as any}>
      <SchemaRenderer
        schema={
          {
            type: 'element:record_picker',
            id: 'picker',
            properties,
            ...(dataSource ? { dataSource } : {}),
          } as any
        }
      />
    </AdapterCtx.Provider>,
  );

/** The `$orderby` this block put on the wire, or `undefined` when it sent none. */
async function orderbyOf(
  binding: Record<string, unknown>,
  properties: Record<string, unknown> = {},
): Promise<unknown> {
  const adapter = makeAdapter();
  renderPicker(properties, adapter, { object: 'account', ...binding });
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls[0] as any[])[1].$orderby;
}

const input = (name: string) =>
  ComponentRegistry.getConfig('element:record_picker')?.inputs?.find((i) => i.name === name);

describe('element:record_picker — the `sort` MEMBER shape the renderer reads (objectui#8068, objectui#11880)', () => {
  it('CONTROL — the flat `sort` is not published since the spec retired it; the binding is the door', () => {
    // It was published, described as NOT READ, until `@objectstack/spec` 18
    // retired it as a tombstone (objectstack#11509, objectui#12030).
    expect(input('sort')).toBeUndefined();
    expect(input('dataSource')).toBeDefined();
  });

  it('SUBJECT — an authored `dataSource.sort` reaches $orderby BY IDENTITY, not a copy', async () => {
    // `toBe`, not `toEqual`: the binding's array is assigned by reference, so
    // a fix that started cloning or lowering it would turn this red even
    // though `toEqual` would still pass.
    const sort = [{ field: 'name', order: 'asc' }];
    expect(await orderbyOf({ sort })).toBe(sort);
  });

  it('the bound object reaches the query (reachability before absence)', async () => {
    // Without this, every case below that never checks `object` reaching the
    // query could be satisfied by a picker that never queried at all.
    const adapter = makeAdapter();
    renderPicker({}, adapter, { object: 'account' });
    await waitFor(() => expect(adapter.find).toHaveBeenCalledWith('account', expect.any(Object)));
  });

  it('keeps multi-member order, in the order authored', async () => {
    const sort = [
      { field: 'stage', order: 'asc' },
      { field: 'created', order: 'desc' },
    ];
    expect(await orderbyOf({ sort })).toEqual(sort);
  });

  it("passes a member missing `field` through UNFILTERED — the block does NOT drop it", async () => {
    // The declared behavioural difference from `record:related_list.sort`
    // (objectui#8071 slice 2), which drops such a member silently via
    // `normalizeSortSpec`'s `.filter((s) => !!s?.field)`.
    const sort = [{ order: 'desc' }, { field: 'created', order: 'desc' }];
    expect(await orderbyOf({ sort })).toEqual(sort);
  });

  it('sends NO $orderby when `sort` is absent, rather than an empty clause', async () => {
    expect(await orderbyOf({})).toBeUndefined();
  });

  it('a flat `properties.sort` is not read beside a binding that carries its own `sort`', async () => {
    const dsSort = [{ field: 'amount', order: 'desc' }];
    const flatSort = [{ field: 'name', order: 'asc' }];
    expect(await orderbyOf({ sort: dsSort }, { sort: flatSort })).toBe(dsSort);
  });

  it('…nor beside a binding that carries none: no $orderby at all (objectui#11880)', async () => {
    // The row that used to pin the fall-through to the flat key
    // (`composed?.sort ?? props.sort`), inverted by the retirement.
    const flatSort = [{ field: 'name', order: 'asc' }];
    expect(await orderbyOf({}, { sort: flatSort })).toBeUndefined();
  });
});
