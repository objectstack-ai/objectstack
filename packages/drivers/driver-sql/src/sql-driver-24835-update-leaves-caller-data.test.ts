// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24835] `update()` leaves the caller's `data` argument exactly as it was
 * handed in — on every path that stamps `updated_at`.
 *
 * ## What was wrong
 *
 * `formatInput` and `applyWriteColumnMap` are copy-on-write: a patch that needs
 * no coercion comes back as the CALLER'S OWN OBJECT. `update()` and
 * `rotatedUpdateById()` then assigned the `updated_at` stamp onto it, so the
 * stamp landed in the caller's patch. ObjectQL hands `driver.update` the same
 * object it later publishes as `DataEvent.changes`, so every reader of the
 * update event saw a value the caller never wrote:
 *
 *  - on PostgreSQL / MySQL the stamp is `knex.fn.now()`, a knex `Raw` that
 *    holds the client, its pool and a Node `Timeout`. `JSON.stringify` of the
 *    event payload throws ("Converting circular structure to JSON"), so the
 *    webhook outbox could not store the delivery and EVERY webhook delivery for
 *    a record update was lost there;
 *  - on SQLite it is an ISO-8601 string — serialisable, which is why the loss
 *    never showed there, and just as foreign to the caller's patch.
 *
 * `updateMany()` already stamped into a fresh object; these two doors now do
 * the same.
 *
 * ## What is pinned
 *
 * The caller's patch is deep-equal to a clone taken before the call, on each
 * path that stamps: the plain path (a table this driver's DDL created), the
 * presumed-timestamp path (`skipSchemaSync`-style registration, both when the
 * column exists and when the fallback has to drop the stamp), and the rotated
 * path. Each case also proves the stamp really ran on that path, so a pin
 * cannot pass because nothing was stamped at all. SQLite only: the mutation is
 * dialect-independent (only the stamped VALUE differs), and the live-PG/MySQL
 * driver lane does not run on pull requests.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

/** These fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as const;
const BACKDATED = '2020-01-01T00:00:00.000Z';

function sqlite(): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
}

/** Read `updated_at` straight out of storage, past every read-side coercion. */
async function storedUpdatedAt(driver: SqlDriver, table: string, id: string): Promise<unknown> {
  const row: any = await (driver as any).knex(table).where('id', id).first();
  return row?.updated_at;
}

/** Update with `patch`, and return what the caller's object looked like before and after. */
async function updateAndCompare(driver: SqlDriver, object: string, id: string, patch: Record<string, unknown>) {
  const before = structuredClone(patch);
  await driver.update(object, id, patch, OPTS);
  return { before, after: patch };
}

describe('#24835 — SqlDriver.update() never writes into the caller\'s data', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
  });

  it('plain path: a table the driver created stamps updated_at, and the patch is untouched', async () => {
    driver = sqlite();
    await driver.initObjects([{ name: 'n24835_plain', fields: { title: { type: 'text' } } } as any]);
    await driver.create('n24835_plain', { id: 'p1', title: 'seed' }, OPTS);
    await (driver as any).knex('n24835_plain').where('id', 'p1').update({ updated_at: BACKDATED });

    const { before, after } = await updateAndCompare(driver, 'n24835_plain', 'p1', { title: 'renamed' });

    expect(after).toStrictEqual(before);
    expect(Object.keys(after)).toEqual(['title']);
    // The stamp ran on this path — it landed in storage, not in the patch.
    expect(await storedUpdatedAt(driver, 'n24835_plain', 'p1')).not.toBe(BACKDATED);
  });

  it('presumed path, column present: the speculative stamped attempt leaves the patch untouched', async () => {
    driver = sqlite();
    const knex = (driver as any).knex;
    await knex.raw(
      `create table "n24835_presumed" (id text primary key, title text, `
        + `created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')), `
        + `updated_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    );
    driver.registerObjectMetadata([{ name: 'n24835_presumed', fields: { title: { type: 'text' } } } as any]);
    await driver.create('n24835_presumed', { id: 'q1', title: 'seed' }, OPTS);
    await knex('n24835_presumed').where('id', 'q1').update({ updated_at: BACKDATED });
    expect((driver as any).updatedAtStampIsPresumed('n24835_presumed')).toBe(true);

    const { before, after } = await updateAndCompare(driver, 'n24835_presumed', 'q1', { title: 'renamed' });

    expect(after).toStrictEqual(before);
    expect(await storedUpdatedAt(driver, 'n24835_presumed', 'q1')).not.toBe(BACKDATED);
    // The presumption was settled by this very call.
    expect((driver as any).updatedAtStampIsPresumed('n24835_presumed')).toBe(false);
  });

  it('presumed path, column absent: the fallback that drops the stamp leaves the patch untouched', async () => {
    driver = sqlite();
    const knex = (driver as any).knex;
    await knex.raw(`create table "n24835_nocol" (id text primary key, title text)`);
    driver.registerObjectMetadata([{ name: 'n24835_nocol', fields: { title: { type: 'text' } } } as any]);
    await knex('n24835_nocol').insert({ id: 'r1', title: 'seed' });
    expect((driver as any).updatedAtStampIsPresumed('n24835_nocol')).toBe(true);

    const { before, after } = await updateAndCompare(driver, 'n24835_nocol', 'r1', { title: 'renamed' });

    expect(after).toStrictEqual(before);
    expect((await knex('n24835_nocol').where('id', 'r1').first()).title).toBe('renamed');
    // The fallback path really ran: the driver now knows the column is absent.
    expect((driver as any).updatedAtColumnState.get('n24835_nocol')).toBe('absent');
  });

  it('rotated path: a rotation-managed object stamps updated_at in its shard, and the patch is untouched', async () => {
    driver = sqlite();
    const rotated = {
      name: 'n24835_rot',
      fields: { payload: { type: 'text' }, created_at: { type: 'datetime' } },
      lifecycle: { class: 'telemetry', storage: { strategy: 'rotation', shards: 3, unit: 'day' } },
    };
    await driver.initObjects([rotated as any]);
    const shards: string[] | undefined = (driver as any).rotationShardsOf('n24835_rot');
    expect(shards?.length).toBeGreaterThan(0);
    await driver.create('n24835_rot', { id: 's1', payload: 'seed' }, OPTS);
    await (driver as any).knex(shards![0]).where('id', 's1').update({ updated_at: BACKDATED });

    const { before, after } = await updateAndCompare(driver, 'n24835_rot', 's1', { payload: 'patched' });

    expect(after).toStrictEqual(before);
    expect(await storedUpdatedAt(driver, shards![0], 's1')).not.toBe(BACKDATED);
  });
});
