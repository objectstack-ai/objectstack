/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dataset dimension whose `field` is a `relationship.field` path
 * (`dimensionFields`, `QueryDatasetOutput`) drills as a nested-relation
 * condition, never as a dotted filter key — objectstack#34907, and since
 * objectstack#34990 without reading any related id.
 *
 * The data API refuses a dotted filter key (`INVALID_FIELD` / 400), so
 * `resolveDatasetDrillFilter` writes the clicked value beneath the
 * relationship field (`{ crm_account: { owner_id: 'u1' } }`), one level per
 * hop, and the server matches it in the database.
 */

import { describe, it, expect } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import {
  buildDatasetDrillFilter,
  resolveDatasetDrillFilter,
  datasetDrillPathsResolvable,
} from '../dataset-format';
import { convertFiltersToAST, FilterOperatorError } from '../filter-converter';

const SCHEMAS: Record<string, { fields: Record<string, Record<string, unknown>> }> = {
  crm_order: {
    fields: {
      amount: { type: 'currency' },
      crm_account: { type: 'lookup', reference: 'crm_account' },
      tags: { type: 'lookup', reference: 'crm_tag', multiple: true },
      status: { type: 'select' },
    },
  },
  crm_account: {
    fields: {
      owner_id: { type: 'user' },
      region: { type: 'select' },
      parent: { type: 'lookup', reference: 'crm_group' },
    },
  },
  crm_group: { fields: { kind: { type: 'select' }, zone: { type: 'lookup', reference: 'crm_zone' } } },
  crm_zone: { fields: { code: { type: 'text' } } },
};

/** A data source that records every read and answers each object from `rows`. */
function recordingSource(rows: Record<string, Array<{ id: string }>>) {
  const finds: Array<{ object: string; params: unknown }> = [];
  const schemaReads: string[] = [];
  return {
    finds,
    schemaReads,
    async find(object: string, params?: unknown) {
      finds.push({ object, params });
      return { data: rows[object] ?? [] };
    },
    async getObjectSchema(object: string) {
      schemaReads.push(object);
      return SCHEMAS[object];
    },
  };
}

describe('resolveDatasetDrillFilter — a relationship-path dimension (objectstack#34907)', () => {
  it.each([
    ['one hop', 'crm_account.owner_id', { crm_account: { owner_id: 'v' } }, ['crm_order']],
    ['two hops', 'crm_account.parent.kind', { crm_account: { parent: { kind: 'v' } } }, ['crm_order', 'crm_account']],
    [
      'three hops',
      'crm_account.parent.zone.code',
      { crm_account: { parent: { zone: { code: 'v' } } } },
      ['crm_order', 'crm_account', 'crm_group'],
    ],
  ])('writes a %s path as one nested condition and reads no related record', async (_, path, filter, schemaReads) => {
    const source = recordingSource({ crm_account: [{ id: 'acc1' }], crm_group: [{ id: 'g1' }], crm_zone: [{ id: 'z1' }] });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { d: 'v' },
      drillDims: ['d'],
      dimensionFields: { d: path },
      dataSource: source,
    });
    expect(resolution).toEqual({ status: 'resolved', filter });
    expect(source.finds).toEqual([]);
    expect(source.schemaReads).toEqual(schemaReads);
  });

  it('the drawer lowers the nested condition to the equality node the spec reads back as the nested form', async () => {
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { kind: 'factory' },
      drillDims: ['kind'],
      dimensionFields: { kind: 'crm_account.parent.kind' },
      dataSource: recordingSource({}),
    });
    const filter = resolution.status === 'resolved' ? resolution.filter : {};
    const node = convertFiltersToAST(filter);
    expect(node).toEqual(['crm_account', '=', { parent: { kind: 'factory' } }]);
    expect(parseFilterAST(node)).toEqual({ crm_account: { parent: { kind: 'factory' } } });
  });

  it('shares a hop between path dimensions, beside a plain dimension and the widget filter', async () => {
    const source = recordingSource({ crm_account: [{ id: 'acc1' }] });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { owner: 'u1', region: 'east', status: 'open' },
      drillDims: ['owner', 'region', 'status'],
      dimensionFields: { owner: 'crm_account.owner_id', region: 'crm_account.region', status: 'status' },
      runtimeFilter: { amount: { $gt: 0 } },
      dataSource: source,
    });
    expect(source.finds).toEqual([]);
    expect(resolution.status).toBe('resolved');
    expect(resolution.status === 'resolved' && resolution.filter).toEqual({
      // `composeDrillFilter`'s own shape: the widget filter AND the bucket's two conditions.
      $and: [{ amount: { $gt: 0 } }, { $and: [{ status: 'open' }, { crm_account: { owner_id: 'u1', region: 'east' } }] }],
    });
  });

  it('a plain dimension on the relationship field a path walks is the related record\'s id', async () => {
    const source = recordingSource({});
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { account: 'acc1', owner: 'u1' },
      drillDims: ['account', 'owner'],
      dimensionFields: { account: 'crm_account', owner: 'crm_account.owner_id' },
      dataSource: source,
    });
    expect(resolution).toEqual({ status: 'resolved', filter: { crm_account: { owner_id: 'u1', id: 'acc1' } } });
    expect(source.finds).toEqual([]);
  });

  it('offers no drill for an unknown relationship, a multi-valued one, the empty bucket, or a path past the hop limit', async () => {
    const source = recordingSource({});
    const run = (field: string, raw: unknown) => resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { d: raw },
      drillDims: ['d'],
      dimensionFields: { d: field },
      dataSource: source,
    });
    expect(await run('status.label', 'x')).toEqual({ status: 'unavailable', reason: 'unknown-relationship', field: 'status' });
    expect(await run('tags.name', 'x')).toEqual({ status: 'unavailable', reason: 'unknown-relationship', field: 'tags' });
    expect(await run('crm_account.owner_id', null)).toEqual({ status: 'unavailable', reason: 'empty-bucket', field: 'crm_account.owner_id' });
    expect(await run('a.b.c.d.e', 'x')).toEqual({ status: 'unavailable', reason: 'hop-limit', field: 'a.b.c.d.e' });
    expect(source.finds).toEqual([]);
    expect(datasetDrillPathsResolvable(['d'], { d: 'a.b.c.d.e' })).toBe(false);
    expect(datasetDrillPathsResolvable(['d'], { d: 'a.b.c.col' })).toBe(true);
  });

  it('CONTROL: a single-object bucket resolves to exactly the builder output and reads nothing', async () => {
    const source = recordingSource({});
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { status: 'open' },
      drillDims: ['status'],
      dimensionFields: { status: 'status' },
      dataSource: source,
    });
    expect(resolution).toEqual({ status: 'resolved', filter: { status: 'open' } });
    expect(resolution.status === 'resolved' && resolution.filter)
      .toEqual(buildDatasetDrillFilter({ status: 'open' }, ['status'], { status: 'status' }));
    expect(source.finds).toEqual([]);
    expect(source.schemaReads).toEqual([]);
  });

  it('the synchronous builder refuses a relationship path rather than writing a dotted key', () => {
    let thrown: unknown;
    try {
      buildDatasetDrillFilter({ owner: 'u1' }, ['owner'], { owner: 'crm_account.owner_id' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    expect((thrown as FilterOperatorError).code).toBe('INVALID_FILTER');
    expect((thrown as FilterOperatorError).httpStatus).toBe(400);
    expect((thrown as FilterOperatorError).field).toBe('crm_account.owner_id');
  });
});
