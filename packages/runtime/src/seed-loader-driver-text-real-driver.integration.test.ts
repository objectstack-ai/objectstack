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
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';
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

/**
 * [#10629] This fixture provisions its own business objects and nothing else,
 * so the engine's single-tenant probe (`ObjectQL.probeInstallOrganizations`,
 * memoised once per engine) reads a `sys_organization` that was never created.
 * The probe is fail-soft by construction — it catches `isMissingTableError` and
 * only that — but the driver and the engine each log the fault on the way out.
 * Withheld and asserted rather than muted; `expected-read-refusal-noise.ts`
 * says why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('[#8442] a REAL driver constraint violation is withheld from the seed response', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  /** [#10629] The expected-noise capture belonging to the latest boot. */
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    // [#10629] The capture is a PIN, not a mute — asserted after teardown so a
    // failure here can never leave the engine running. The single test in this
    // file boots and writes, so the probe fires for it.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  it('a duplicate on a UNIQUE column leaks neither the SQL nor the seeded values', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-8442-real-'));
    const real = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    // [#10629] Installed on the REAL driver (the one that logs) before it runs
    // a statement — the `Object.create(real)` wrapper below resolves `logger`
    // through the prototype chain to this sink.
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(real);
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
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ACCT as any, 'com.objectstack.test.8442');

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

    // ── The row's SENTENCE moved populations (#14095) ──────────────────────
    // ⚠️ RETRIAGED, not re-baselined. `declaresSeedClientRefusal` is a POSITIVE
    // list — a 4xx status, or the VALIDATION_FAILED shape — and it did not
    // move. What moved is which side of it this error is on: since #14095 the
    // insert door answers a driver unique violation with the ADR-0112 envelope
    // `DUPLICATE_RECORD` / `status: 409`, so the seed row is a DECLARED refusal
    // and `quotableSeedFailureDetail` quotes it. The rejection is still
    // located the same way ("record #1 (name=second)"); only the tail changed,
    // from the generic reason to the platform's own sentence.
    //
    // ⛔ The withheld population is NOT vacated. `raw.status` is asserted
    // `undefined` twelve lines up: the DRIVER's error still declares nothing
    // and would still be withheld — what the sink now sees is the engine's
    // envelope, not that error. A regression that started quoting undeclared
    // driver faults would redden the `seed-loader-driver-text.test.ts` cases
    // that drive this sink with a bare driver throw.
    expect(result.success).toBe(false);
    const failed = result.errors.find((e: any) => e.recordIndex === 1);
    expect(failed, 'the duplicate row was not reported').toBeDefined();
    expect(failed!.message).toContain("Duplicate record refused on 'dt_acct'");
    expect(failed!.message).toContain("a unique constraint on 'email' already holds this value");
    expect(failed!.message).toContain('record #1 (name=second)');

    // Nothing of the DRIVER's sentence reaches the caller — asserted over the
    // WHOLE payload, and every one of these is unchanged. They hold against
    // the new sentence for the reason the envelope was built that way: the
    // platform sentence carries no statement, no bound value and no dialect
    // text, because the driver's error is preserved WHOLE on `cause` and
    // `cause` never reaches the wire.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('UNIQUE constraint failed');
    expect(wire).not.toContain('SQLITE_CONSTRAINT');
    expect(wire).not.toContain('insert into');
    expect(wire).not.toContain('dup@example.com');

    // ── …and the operator still gets it — the half #14095 had to REPAIR ────
    // Both assertions are the ORIGINAL ones, byte for byte, and that is the
    // point: the envelope nearly cost them. `seedFailureCause` read
    // `err.message` alone, so with a platform sentence on `message` the
    // driver's own words would have reached NEITHER the response nor the log —
    // withholding becoming indistinguishable from deleting the diagnostic,
    // which is the exact failure this file's sink was built against. It now
    // reaches through `cause` to the deepest sentence, so the operator keeps
    // `UNIQUE constraint failed: dt_acct.email`.
    //
    // And the MARKER stays true for a newly subtle reason: the payload quoted
    // the PLATFORM sentence while this line prints the DRIVER sentence, so the
    // reporter genuinely did not see these words. `seedCauseLabel` now asks its
    // question about the sentence being printed rather than about the error,
    // which is what keeps `Cause (withheld from the seed response)` honest
    // here while a plainly-declared refusal (whose printed and quoted sentence
    // are the same string) still reads `Cause`.
    const logged = ((logger.error as any).calls as string[]).join('\n');
    expect(logged).toContain('UNIQUE constraint failed');
    expect(logged).toContain('Cause (withheld from the seed response)');
    // The platform sentence is on the payload; the driver's is on the log.
    // Asserted together so a future edit cannot quietly collapse them into one.
    expect(logged).toContain('dt_acct');

    // The structured authoring feedback survives: which row failed.
    expect(failed!.sourceObject).toBe('dt_acct');
    expect(failed!.attemptedValue).toBe('second');
  });
});
