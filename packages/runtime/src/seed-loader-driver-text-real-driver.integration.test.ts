// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8442 — the seed loader's `errors[].message` withhold, proven on a REAL
 * driver rather than a fixture.
 *
 * ## The question this file was written to answer
 *
 * The fix quotes a caught sentence when the error declared itself a client
 * refusal, and one of the two accepted declarations is the `VALIDATION_FAILED`
 * shape (`@objectstack/types`' `validationFailureDetails`), because the seed
 * channel's authoring feedback arrives that way and carries no `status`.
 * Importing the canonical recogniser rather than re-spelling it is what stops
 * the seed channel drifting from the HTTP boundaries — but it also means the
 * limb inherits whatever that recogniser admits.
 *
 * So: can a DRIVER-originated constraint violation — unique / check / FK, the
 * populations where the sentence's author and its shape could come apart —
 * reach the loader's catch already wearing the validation shape? If it could,
 * the new limb would be a disclosure path that no hand-built fixture in this
 * repo would ever reveal, because every fixture constructs its error at the
 * layer that authored the sentence.
 *
 * ## Measured answer: NO — and the disclosure withheld here is worse than the
 * one the issue reported
 *
 * Driven end to end (real `SqlDriver` on better-sqlite3 on disk, real
 * `ObjectQL`, real `SeedLoaderService`) with a duplicate on a `unique` column,
 * the driver raises:
 *
 * ```
 * SqliteError  name: 'SqliteError'  code: 'SQLITE_CONSTRAINT_UNIQUE'
 * own properties: [stack, message, code]        status: undefined
 * message: insert into `q2_acct` (…) select 'dup@example.com' as `email`, … - UNIQUE constraint failed: q2_acct.email
 * ```
 *
 * `validationFailureDetails` does NOT recognise it, so nothing converts it on
 * the way up: between the driver and this catch there is only ObjectQL, whose
 * own `ValidationError` throws are authored (`reference_not_found` from the
 * message catalog, and a re-wrap of already-authored fields). The conversions
 * that do exist — `mapDataError`, `resolveThrownHttpError` — live at HTTP
 * boundaries that CONSUME this loader's output; they are downstream of this
 * producer and can never wrap the engine's throw on its way into it.
 *
 * Note what that raw message contains: the full INSERT statement including the
 * seeded VALUES. The issue's example leaked a table name; this path would leak
 * row data and schema shape together. It is now withheld, and the assertion
 * below is on the whole payload, not just the tail.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { validationFailureDetails } from '@objectstack/types';

/** `email` declares UNIQUE, so the real driver — not a validator — rejects the duplicate. */
const ACCT = {
  name: 'dt_acct',
  fields: {
    name: { type: 'text' },
    email: { type: 'text', unique: true },
  },
};

const SEED_CONFIG = {
  dryRun: false, haltOnError: false, multiPass: true,
  defaultMode: 'insert', batchSize: 1000, transaction: false,
} as any;

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

describe('[#8442] a REAL driver constraint violation is withheld from the seed response', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('a duplicate on a UNIQUE column leaks neither the SQL nor the seeded values', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-8442-real-'));
    const real = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await real.initObjects([ACCT]);

    // Capture the RAW driver error at the seam, then let it propagate
    // untouched — so the test can assert on what the driver really threw
    // rather than on an assumption about it.
    let raw: any = null;
    const driver = Object.create(real);
    driver.create = async (o: string, d: any, opts: any) => {
      try { return await real.create(o, d, opts); } catch (e) { raw ??= e; throw e; }
    };
    driver.bulkCreate = async (o: string, rows: any[], opts: any) => {
      try { return await real.bulkCreate(o, rows, opts); } catch (e) { raw ??= e; throw e; }
    };

    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ACCT as any);

    const logger = { info() {}, warn() {}, error: (() => {
      const calls: string[] = [];
      const fn = (m: string) => { calls.push(String(m)); };
      (fn as any).calls = calls;
      return fn;
    })(), debug() {} };

    const svc = new SeedLoaderService(engine as never, metadataFor([ACCT]), logger as never);
    const result = await svc.load({
      seeds: [{
        object: 'dt_acct',
        externalId: 'name',
        mode: 'insert',
        env: ['prod', 'dev', 'test'],
        records: [
          { name: 'first', email: 'dup@example.com' },
          { name: 'second', email: 'dup@example.com' }, // duplicate on UNIQUE
        ],
      }],
      config: SEED_CONFIG,
    } as never);

    // ── The population really is what this file claims ──────────────────────
    // Non-vacuity: if the driver stopped rejecting duplicates, or the error
    // arrived wearing the validation shape, the assertions below would be
    // measuring something else entirely.
    expect(raw, 'the driver never rejected the duplicate').toBeTruthy();
    expect(String(raw.code)).toContain('SQLITE_CONSTRAINT');
    expect(String(raw.message)).toContain('UNIQUE constraint failed');
    // THE Q2 ANSWER: a driver-originated constraint violation does NOT arrive
    // wearing the validation shape, so the quoting limb never opens for it.
    expect(validationFailureDetails(raw)).toBeUndefined();
    expect(raw.status).toBeUndefined();

    // ── The withhold ───────────────────────────────────────────────────────
    expect(result.success).toBe(false);
    const failed = result.errors.find((e: any) => e.recordIndex === 1);
    expect(failed, 'the duplicate row was not reported').toBeDefined();
    expect(failed!.message).toContain('the data engine rejected the write; the reason is in the server log');

    // Nothing of the driver's sentence reaches the caller — asserted over the
    // WHOLE payload, because this message carries the statement AND the values.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('UNIQUE constraint failed');
    expect(wire).not.toContain('SQLITE_CONSTRAINT');
    expect(wire).not.toContain('insert into');
    expect(wire).not.toContain('dup@example.com');

    // ── …and the operator still gets it ────────────────────────────────────
    const logged = ((logger.error as any).calls as string[]).join('\n');
    expect(logged).toContain('UNIQUE constraint failed');
    expect(logged).toContain('Cause (withheld from the seed response)');

    // The structured authoring feedback survives: which row failed.
    expect(failed!.sourceObject).toBe('dt_acct');
    expect(failed!.attemptedValue).toBe('second');
  });
});
