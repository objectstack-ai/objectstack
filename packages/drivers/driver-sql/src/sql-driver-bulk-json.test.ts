// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * bulkCreate write-side marshaling (#2735).
 *
 * The batch insert path (the common case for seeds/imports since
 * framework#2678) must serialize JSON-typed and object-valued fields per row
 * exactly like create() does. Before the fix, raw `{lat, lng}` objects went
 * straight to the SQLite binder — "Wrong API use: tried to bind a value of an
 * unknown type ([object Object])" — silently failing whole seed batches
 * (showcase accounts/tasks/field-zoo seeded zero rows).
 */
describe('SqlDriver bulkCreate JSON marshaling (#2735)', () => {
  let driver: SqlDriver;

  const objects = [
    {
      name: 'venue',
      fields: {
        name: { type: 'string' },
        location: { type: 'location' },
        tags: { type: 'array' },
        meta: { type: 'json' },
      },
    },
  ];

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects(objects);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('serializes object-valued fields per row like create() does', async () => {
    const rows = [
      { id: 'v1', name: 'HQ', location: { lat: 47.6062, lng: -122.3321 }, tags: ['a', 'b'], meta: { tier: 1 } },
      { id: 'v2', name: 'Lab', location: { lat: 37.7749, lng: -122.4194 }, tags: [], meta: null },
    ];
    const result = await driver.bulkCreate!('venue', rows);
    expect(result).toHaveLength(2);

    // Read-back parity: JSON columns decode to objects, same as single insert.
    const v1 = await driver.findOne('venue', { object: 'venue', where: { id: 'v1' } });
    expect(v1.location).toEqual({ lat: 47.6062, lng: -122.3321 });
    expect(v1.tags).toEqual(['a', 'b']);
    expect(v1.meta).toEqual({ tier: 1 });
  });

  it('matches the single-insert result shape', async () => {
    const single = await driver.create('venue', {
      id: 's1', name: 'Single', location: { lat: 1, lng: 2 },
    });
    const [batch] = await driver.bulkCreate!('venue', [
      { id: 'b1', name: 'Batch', location: { lat: 1, lng: 2 } },
    ]);
    expect(batch.location).toEqual(single.location);
  });
});
