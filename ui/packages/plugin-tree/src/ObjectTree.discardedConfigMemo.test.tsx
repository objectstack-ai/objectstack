/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6700 — the record-fetch effect is the LAST `dataConfig`-identity
 * dependence in `ObjectTree` (the schema-resolution effect #6592 also named
 * was already retired by #6696 in favor of `useSettledSchema`'s primitive
 * `schemaKey`). See `ObjectMap.discardedConfigMemo.test.tsx` for the full
 * rationale this mirrors: `useMemo` carries no semantic guarantee — React
 * may discard its cache and recompute even when `schema` itself hasn't
 * changed — and `getDataConfig(schema)` builds a FRESH `{ provider, object }`
 * wrapper object on every call. A fetch effect keyed on that container
 * object's identity therefore re-runs (and refetches) on a bare discard,
 * with nothing about the bound object actually different.
 *
 * The discard proxy: two schema object literals with identical primitive
 * content but different references. `dataConfig = useMemo(() =>
 * getDataConfig(schema), [schema])` is keyed on `[schema]` (the whole prop
 * object, confirmed at `ObjectTree.tsx` — `const dataConfig = useMemo(() =>
 * getDataConfig(schema), [schema]);`), so a schema reference swap reliably
 * forces the recompute — the same "different identity, same content" shape
 * a genuine memo-cache discard would produce with `schema` held constant.
 * `useSettledSchema`'s OWN internal effect is keyed on the derived primitive
 * `schemaKey` string, not on `schema`/`dataConfig`, so this swap leaves
 * `objectSchema`/`schemaSettled` referentially stable and cannot confound
 * the result through that channel.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue([{ id: '1', name: 'Acme', parent_id: null }]),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'business_unit', fields: {} }),
  } as any;
}

describe('ObjectTree — record-fetch effect survives a discarded `dataConfig` memo (objectui#6700)', () => {
  it('does not re-fire dataSource.find when `schema` gets a new reference with the SAME primitive fields', async () => {
    const dataSource = makeDataSource();
    const schemaA: any = {
      type: 'object-tree',
      objectName: 'business_unit',
      parentField: 'parent_id',
      labelField: 'name',
    };
    const schemaB: any = {
      type: 'object-tree',
      objectName: 'business_unit',
      parentField: 'parent_id',
      labelField: 'name',
    };
    expect(schemaA).not.toBe(schemaB);
    expect(schemaA).toEqual(schemaB);

    const { rerender } = render(<ObjectTree schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(screen.getByTestId('object-tree')).toBeTruthy());
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(1));

    const findCallsAtRest = dataSource.find.mock.calls.length;

    rerender(<ObjectTree schema={schemaB} dataSource={dataSource} />);
    // Give any (incorrectly) re-triggered effect a turn of the microtask
    // queue to actually issue its fetch before asserting it did not.
    await new Promise((r) => setTimeout(r, 0));

    expect(dataSource.find.mock.calls.length).toBe(findCallsAtRest);
  });

  it('still DOES re-fire when the recomputed `dataConfig` carries a genuinely different `object`', async () => {
    const dataSource = makeDataSource();
    const schemaA: any = {
      type: 'object-tree',
      objectName: 'business_unit',
      parentField: 'parent_id',
      labelField: 'name',
    };
    const schemaB: any = {
      type: 'object-tree',
      objectName: 'department',
      parentField: 'parent_id',
      labelField: 'name',
    };

    const { rerender } = render(<ObjectTree schema={schemaA} dataSource={dataSource} />);
    await waitFor(() =>
      expect(dataSource.find).toHaveBeenCalledWith('business_unit', expect.any(Object)),
    );
    const callsBefore = dataSource.find.mock.calls.length;

    rerender(<ObjectTree schema={schemaB} dataSource={dataSource} />);

    await waitFor(() => expect(dataSource.find.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(dataSource.find).toHaveBeenCalledWith('department', expect.any(Object));
  });
});
