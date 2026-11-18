/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dataset dimension whose `field` is a `relationship.field` path
 * (`dimensionFields`, `QueryDatasetOutput`) drills through the related ids,
 * never as a dotted filter key — objectstack#34907.
 *
 * The data API refuses a dotted filter key (`INVALID_FIELD` / 400), and the
 * client filter dialect has no node for the nested-relation form, so
 * `resolveDatasetDrillFilter` reads the related object's ids matching the
 * clicked value through the drill's own data source and filters the base
 * object on the relationship field `$in` them.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDatasetDrillFilter,
  resolveDatasetDrillFilter,
  datasetDrillPathsResolvable,
  DATASET_DRILL_RELATED_ID_CAP,
} from '../dataset-format';
import { FilterOperatorError } from '../filter-converter';

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
  crm_group: { fields: { kind: { type: 'select' } } },
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
  it('reads the related ids and filters the base object on the lookup field $in them', async () => {
    const source = recordingSource({ crm_account: [{ id: 'acc1' }, { id: 'acc2' }] });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { owner: 'user_zhang' },
      drillDims: ['owner'],
      dimensionFields: { owner: 'crm_account.owner_id' },
      dataSource: source,
    });
    expect(source.finds).toEqual([
      {
        object: 'crm_account',
        params: { $filter: { owner_id: 'user_zhang' }, $select: ['id'], $top: DATASET_DRILL_RELATED_ID_CAP + 1 },
      },
    ]);
    expect(resolution).toEqual({ status: 'resolved', filter: { crm_account: { $in: ['acc1', 'acc2'] } } });
  });

  it('walks a two-hop path innermost first, one read per hop', async () => {
    const source = recordingSource({ crm_group: [{ id: 'g1' }], crm_account: [{ id: 'acc9' }] });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { kind: 'factory' },
      drillDims: ['kind'],
      dimensionFields: { kind: 'crm_account.parent.kind' },
      dataSource: source,
    });
    expect(source.finds.map((f) => f.object)).toEqual(['crm_group', 'crm_account']);
    expect((source.finds[1].params as { $filter: unknown }).$filter).toEqual({ parent: { $in: ['g1'] } });
    expect(resolution).toEqual({ status: 'resolved', filter: { crm_account: { $in: ['acc9'] } } });
  });

  it('reads a shared hop once, on every condition beneath it, beside a plain dimension and the widget filter', async () => {
    const source = recordingSource({ crm_account: [{ id: 'acc1' }] });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { owner: 'u1', region: 'east', status: 'open' },
      drillDims: ['owner', 'region', 'status'],
      dimensionFields: { owner: 'crm_account.owner_id', region: 'crm_account.region', status: 'status' },
      runtimeFilter: { amount: { $gt: 0 } },
      dataSource: source,
    });
    expect(source.finds).toHaveLength(1);
    expect((source.finds[0].params as { $filter: unknown }).$filter).toEqual({ owner_id: 'u1', region: 'east' });
    expect(resolution.status).toBe('resolved');
    expect(resolution.status === 'resolved' && resolution.filter).toEqual({
      // `composeDrillFilter`'s own shape: the widget filter AND the bucket's two conditions.
      $and: [{ amount: { $gt: 0 } }, { $and: [{ status: 'open' }, { crm_account: { $in: ['acc1'] } }] }],
    });
  });

  it('answers no related record with an empty $in, never an absent condition', async () => {
    const source = recordingSource({});
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { owner: 'nobody' },
      drillDims: ['owner'],
      dimensionFields: { owner: 'crm_account.owner_id' },
      dataSource: source,
    });
    expect(resolution).toEqual({ status: 'resolved', filter: { crm_account: { $in: [] } } });
  });

  it(`refuses more than ${DATASET_DRILL_RELATED_ID_CAP} related records instead of truncating`, async () => {
    const many = Array.from({ length: DATASET_DRILL_RELATED_ID_CAP + 1 }, (_, i) => ({ id: `acc${i}` }));
    const source = recordingSource({ crm_account: many });
    const resolution = await resolveDatasetDrillFilter({
      object: 'crm_order',
      rawRow: { owner: 'u1' },
      drillDims: ['owner'],
      dimensionFields: { owner: 'crm_account.owner_id' },
      dataSource: source,
    });
    expect(resolution).toEqual({ status: 'too-many', object: 'crm_account', cap: DATASET_DRILL_RELATED_ID_CAP });
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
