// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19912] The LOCAL face of `TursoDriver` (`url: ':memory:'`, `file:`) runs
 * `SqlDriver`'s schema sync over better-sqlite3, so it inherits the local
 * `Field.json` storage backfill (`SqlDriver.backfillCanonicalJsonEncoding`)
 * through all three schema doors: `syncSchema`, `initObjects` and
 * `syncSchemasBatch`.
 *
 * Before the fix that backfill `json_quote()`d every TEXT cell SQLite's
 * `json_valid()` rejects — including an array nested past SQLite's JSON depth
 * limit, which the current write door stores correctly and `JSON.parse` reads.
 * The dev's reproduction on the card, pinned here: `syncSchema`, `create` the
 * deep array, read an array; `syncSchema` again, read a string.
 *
 * The driver-sql side, with the rest of the pins (idempotence, preservation,
 * compare-and-set, paging): `driver-sql/src/sql-driver-json-backfill-depth-limit.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TursoDriver } from './turso-driver.js';

const T = 'turso_json_depth_19912';
const SCHEMA = { name: T, fields: { label: { type: 'text' }, val: { type: 'json' } } };

function deepArray(levels: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < levels; i++) v = [v];
  return v;
}

function arrayDepth(v: unknown): number {
  let d = 0;
  while (Array.isArray(v)) {
    d++;
    v = v[0];
  }
  return d;
}

const DOORS: Array<{ door: string; sync: (d: TursoDriver) => Promise<void> }> = [
  { door: 'syncSchema', sync: (d) => d.syncSchema(T, SCHEMA) },
  { door: 'initObjects', sync: (d) => d.initObjects([SCHEMA]) },
  { door: 'syncSchemasBatch', sync: (d) => d.syncSchemasBatch([{ object: T, schema: SCHEMA }]) },
];

let driver: TursoDriver | undefined;

afterEach(async () => {
  await driver?.disconnect();
  driver = undefined;
});

async function readAll(d: TursoDriver): Promise<Map<string, unknown>> {
  const rows = (await d.find(T, {})) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [r.id as string, r.val]));
}

async function disk(d: TursoDriver, id: string): Promise<unknown> {
  const rows = (await d.execute(`select "val" as v from "${T}" where "id" = ?`, [id])) as any[];
  return rows[0].v;
}

describe('[#19912] TursoDriver local face: a deep json array survives the json backfill', () => {
  for (const { door, sync } of DOORS) {
    it(`${door}: the 1001-level array still reads as an array after a second sync; bare legacy text is quoted`, async () => {
      driver = new TursoDriver({ url: ':memory:' });
      await driver.connect();
      expect(driver.isRemote).toBe(false);
      await sync(driver); // creates the table
      await driver.create(T, { id: 'deep', label: 'deep', val: deepArray(1001) }, { bypassTenantAudit: true });
      // The pre-#12380 form of the string 'bare': bound as-is, no encoding.
      await driver.execute(`insert into "${T}" ("id", "label", "val") values ('bare', 'bare', 'bare')`);
      expect(arrayDepth((await readAll(driver)).get('deep'))).toBe(1001);

      await sync(driver); // the backfill runs: the table exists
      let read = await readAll(driver);
      expect(Array.isArray(read.get('deep'))).toBe(true);
      expect(arrayDepth(read.get('deep'))).toBe(1001);
      expect(await disk(driver, 'bare')).toBe('"bare"');
      expect(read.get('bare')).toBe('bare');

      await sync(driver); // and again
      read = await readAll(driver);
      expect(arrayDepth(read.get('deep'))).toBe(1001);
      expect(await disk(driver, 'deep')).toBe(JSON.stringify(deepArray(1001)));
    });
  }
});
