// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Array/object-valued field types must be stored as JSON columns and
 * round-tripped as arrays/objects. Regression: `multiselect`/`checkboxes`/
 * `tags`/`repeater`/`vector` were absent from the driver's JSON-field
 * classification, so their array values reached the better-sqlite3 binder
 * un-serialized and crashed with "SQLite3 can only bind numbers, strings,
 * bigints, buffers, and null" — breaking common field types on every write
 * (found driving the showcase field-zoo, which had no seed data to surface it).
 *
 * The classification (`isJsonField`) and the DDL column-type switch now share
 * one `JSON_COLUMN_TYPES` source, plus a `formatInput` safety net stringifies
 * any stray array/object so an unclassified field degrades to a stored string
 * instead of a 500.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver array/object field persistence', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'zoo',
        fields: {
          name: { type: 'string' },
          tags: { type: 'tags' },
          ms: { type: 'multiselect' },
          cbs: { type: 'checkboxes' },
          rep: { type: 'repeater' },
          vec: { type: 'vector' },
          comp: { type: 'composite' },
          loc: { type: 'location' },
        },
      },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('persists and round-trips array-valued fields as arrays', async () => {
    await driver.create(
      'zoo',
      {
        id: 'z1', name: 'Specimen',
        tags: ['x', 'y'],
        ms: ['red', 'green'],
        cbs: ['email', 'push'],
        rep: [{ a: 1 }, { a: 2 }],
        vec: [0.1, 0.2, 0.3],
        comp: { k: 'v' },
        loc: { lat: 1.5, lng: 2.5 },
      },
      { bypassTenantAudit: true },
    );
    const row = await driver.findOne('zoo', { where: { id: 'z1' } }, { bypassTenantAudit: true });
    expect(row.tags).toEqual(['x', 'y']);
    expect(row.ms).toEqual(['red', 'green']);
    expect(row.cbs).toEqual(['email', 'push']);
    expect(row.rep).toEqual([{ a: 1 }, { a: 2 }]);
    expect(row.vec).toEqual([0.1, 0.2, 0.3]);
    expect(row.comp).toEqual({ k: 'v' });
    expect(row.loc).toEqual({ lat: 1.5, lng: 2.5 });
  });

  it('updates an array field to a new array', async () => {
    await driver.create('zoo', { id: 'z2', name: 'B', tags: ['a'] }, { bypassTenantAudit: true });
    await driver.update('zoo', 'z2', { tags: ['a', 'b', 'c'] }, { bypassTenantAudit: true });
    const row = await driver.findOne('zoo', { where: { id: 'z2' } }, { bypassTenantAudit: true });
    expect(row.tags).toEqual(['a', 'b', 'c']);
  });

  it('does not crash on an empty array', async () => {
    await driver.create('zoo', { id: 'z3', name: 'C', ms: [] }, { bypassTenantAudit: true });
    const row = await driver.findOne('zoo', { where: { id: 'z3' } }, { bypassTenantAudit: true });
    expect(row.ms).toEqual([]);
  });
});
