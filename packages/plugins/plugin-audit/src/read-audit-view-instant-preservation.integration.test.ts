// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16829] The record-view ledger keeps the VIEW instant, measured through the
 * REAL `sys_stamp_audit_insert` hook.
 *
 * ## Why this file exists next to a suite that already claims this
 *
 * `read-audit.test.ts` has a case named `records the VIEW instant, not the
 * flush instant`. It builds its engine as a bare `new ObjectQL()` over a stub
 * driver — no {@link ObjectQLPlugin} — and `sys_stamp_audit_insert` is
 * registered by that PLUGIN (`packages/objectql/src/plugin.ts`, `builtinHooks`
 * bound as `sys:audit`), never by the engine. So no audit stamp hook runs in
 * that harness at all: whatever `created_at` the writer puts on the row is what
 * the driver stores, on BOTH sides of any change to the write's context. The
 * case is green today, was green before #15964 flattened the ordinary insert
 * branch, and stays green after this card's fix. An instrument that cannot fail
 * is indistinguishable from a pass — the same shape that let
 * `migrate-sys-notification-to-event.test.ts` read `23 passed` for #16312 while
 * the rows it described were being restamped.
 *
 * ⇒ this file is the instrument that CAN fail. It boots a real
 * {@link ObjectKernel} with the real {@link ObjectQLPlugin} (so the shipped
 * audit stamp hooks are registered) over a real {@link SqliteWasmDriver}, and
 * reads the persisted row back through the driver's own SQL surface.
 *
 * ⚠️ Unlike #16312's equivalent (`packages/runtime/src/notification-migration-
 * audit-preservation.integration.test.ts`), this one lives beside the code it
 * tests. That file had to leave `packages/metadata` because
 * `@objectstack/objectql` depends on it and the test-only import would have
 * closed a cycle. Here the edge already runs the other way —
 * `@objectstack/plugin-audit` depends on `@objectstack/objectql` — and
 * `@objectstack/driver-sqlite-wasm` depends on neither, so the harness is
 * expressible in this package with a devDependency and no cycle.
 *
 * ## The defect
 *
 * `buildRow` writes `created_at: event.viewedAt` on purpose: batching moves the
 * INSERT off the request path, so `created_at`'s `NOW()` default would stamp a
 * whole batch with one buffer-drain time. `persistReadAuditRows` wrote that row
 * under `{ context: { isSystem: true } }` and the module's comment cited that
 * flag as the mechanism carrying the view instant through. It never was.
 * `isSystem` exempts a write from the READONLY STRIP; the stamp hook reads
 * `session.preserveAudit` and nothing else. Before #15964 the hook's line was
 * `record.created_at = record.created_at ?? now` — client-preferred on EVERY
 * insert, no flag required — and that accident is what was actually carrying
 * `event.viewedAt`. With #15964's ternary in place the ordinary branch stamps
 * `now`, i.e. the flush instant: precisely the outcome the field exists to
 * prevent.
 *
 * ## The three readings, and why the first two are load-bearing
 *
 * The two `control` cases are ANTI-VACUITY controls, and they are green on both
 * sides of the fix by design:
 *
 *   1. `isSystem` alone does NOT keep a supplied `created_at` — the card's
 *      central claim, asserted directly on the very write path the ledger uses.
 *      It is also the proof that the real hook is LIVE in this fixture: delete
 *      `ObjectQLPlugin` from the boot and this case goes red first, by name.
 *   2. `preserveAudit` DOES keep it, on this object and this write path. Without
 *      it a green third case could mean "the channel happens to be open" rather
 *      than "the writer declared it".
 *
 * Only the third case moves with the fix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { installReadAuditWriter, READ_AUDIT_ACTION } from './read-audit.js';
import { SysAuditLog } from './objects/index.js';

/** The ledger under test — the REAL shipped object definition, not a stand-in. */
const LEDGER = 'sys_audit_log';
/** The audited business object. */
const AUDITED_OBJECT = 'contact';
const RECORD_ID = 'c_16829';
const VIEWER_ID = 'u_alice';

/** Owning package for the harness objects — `registerObject` requires one. */
const HARNESS_PACKAGE = 'com.objectstack.audit.test';

/**
 * Deliberately years in the past, and NOT round.
 *
 * The verdict is "is the view instant, or the buffer-drain instant, on the
 * row?" — so the two must never be within a clock skew of each other, and
 * `not.toBe(flushInstant)` is not what discriminates: the positive equality is.
 */
const VIEW_INSTANT = new Date('2019-03-04T05:06:07.891Z');
/** A second past instant, for the two control writes. */
const BACKDATED = '2019-03-05T06:07:08.912Z';

const contactObject = {
  name: AUDITED_OBJECT,
  label: 'Contact',
  fields: {
    full_name: { name: 'full_name', label: 'Name', type: 'text' as const },
  },
};

/** `Date.parse` of a stored value, whatever spelling the driver handed back. */
function instantOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}

/** knex wraps some results as `[rows]`; normalize both shapes and take the first. */
function firstRow(result: unknown): Record<string, unknown> {
  const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  expect(Array.isArray(list)).toBe(true);
  expect((list as unknown[]).length).toBeGreaterThan(0);
  return (list as Record<string, unknown>[])[0]!;
}

describe('[#16829] the record-view ledger keeps the VIEW instant through the real audit stamp hook', () => {
  let kernel: ObjectKernel;
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** Raw SQL through the driver's own surface — the same door an operator has. */
  let sql: (statement: string, bindings?: unknown[]) => Promise<unknown>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');

    // The engine's own `init()` ran during bootstrap, before this driver
    // existed, so the connect the engine would have done is done here.
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    sql = (statement, bindings) =>
      (driver as unknown as { execute(s: string, b: unknown[]): Promise<unknown> }).execute(
        statement,
        bindings ?? [],
      );

    engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysAuditLog as any, HARNESS_PACKAGE);
    // Real DDL for both tables, including the builtin audit timestamp columns.
    await engine.syncSchemas();

    await engine.insert(
      AUDITED_OBJECT,
      { id: RECORD_ID, full_name: 'Wei Zhang' },
      { context: { isSystem: true } },
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }, 30_000);

  /**
   * ANTI-VACUITY CONTROL, and the card's central claim as a measurement.
   *
   * The write below is byte-for-byte the context `persistReadAuditRows` used:
   * `{ isSystem: true }`, carrying a back-dated `created_at`, onto
   * `sys_audit_log`. If `isSystem` were the mechanism the module's comment
   * claimed, the supplied instant would survive. It does not — the ordinary
   * branch of `sys_stamp_audit_insert` stamps `now`.
   *
   * ⇒ this is also the proof the shipped hook is LIVE in this fixture. In a
   * harness that runs no hooks (`new ObjectQL()` with no plugin — what
   * `read-audit.test.ts` builds) this case is the one that goes red.
   */
  it('control — a bare `isSystem` write does NOT keep a supplied created_at, so the real stamp hook is live', async () => {
    const before = Date.now();
    await engine.insert(
      LEDGER,
      {
        action: 'create',
        object_name: AUDITED_OBJECT,
        record_id: 'rec_control_is_system',
        created_at: BACKDATED,
      },
      { context: { isSystem: true } },
    );

    const row = firstRow(
      await sql(`SELECT created_at FROM "${LEDGER}" WHERE record_id = ?`, ['rec_control_is_system']),
    );
    const stored = instantOf(row.created_at);
    expect(stored).not.toBe(Date.parse(BACKDATED));
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
  });

  /**
   * ANTI-VACUITY CONTROL — the declared historical-import channel is open on
   * THIS object and THIS write path.
   *
   * `preserveAudit` is the ruled channel for reinstating an original timeline
   * (#3493, reaffirmed by #15964's ruling of 2026-09-06), not a bypass of
   * audit. `sys_audit_log` is `isSystem` + `managedBy: 'append-only'`, so the
   * create-side readonly strip exits early on it and the hook's keep is the
   * whole story. That reasoning is what this case turns into a measurement:
   * without it, a green third case could not distinguish "the writer declared
   * the channel" from "nothing was ever going to restamp this row".
   */
  it('control — `context.preserveAudit` keeps a supplied created_at on this write path', async () => {
    await engine.insert(
      LEDGER,
      {
        action: 'create',
        object_name: AUDITED_OBJECT,
        record_id: 'rec_control_preserve',
        created_at: BACKDATED,
      },
      { context: { isSystem: true, preserveAudit: true } },
    );

    const row = firstRow(
      await sql(`SELECT created_at FROM "${LEDGER}" WHERE record_id = ?`, ['rec_control_preserve']),
    );
    expect(instantOf(row.created_at)).toBe(Date.parse(BACKDATED));
  });

  /**
   * THE CARD. A record-detail view produces a ledger row stamped with the
   * VIEW instant, not the instant the batch drained.
   *
   * RED before the fix: `persistReadAuditRows` passed `{ isSystem: true }`
   * only, so the audit hook took its ordinary branch and stamped the flush
   * instant on every row in the batch — a ledger that answers "when did they
   * look?" with the time its own buffer drained, with read order inside the
   * window destroyed.
   *
   * The clock seam (`now`) is `installReadAuditWriter`'s own declared option,
   * so the view instant here is the one the writer would stamp in production,
   * moved somewhere no wall clock can wander to.
   */
  it('a record-detail view is stamped with the VIEW instant, not the flush instant', async () => {
    const writer = installReadAuditWriter(engine, {
      objects: [AUDITED_OBJECT],
      now: () => VIEW_INSTANT,
    });
    expect(writer).not.toBeNull();

    try {
      const flushWindowStart = Date.now();
      const seen = await engine.findOne(AUDITED_OBJECT, {
        where: { id: RECORD_ID },
        context: { userId: VIEWER_ID },
      });
      // The read itself must have materialized the record — otherwise the
      // record-detail discriminator would decline and the absence of a ledger
      // row would be about the fixture, not about the stamp.
      expect((seen as { id?: string } | null)?.id).toBe(RECORD_ID);

      await writer!.flush();
      expect(writer!.pending()).toBe(0);

      const row = firstRow(
        await sql(`SELECT created_at, user_id, record_id FROM "${LEDGER}" WHERE action = ?`, [
          READ_AUDIT_ACTION,
        ]),
      );
      expect(row.record_id).toBe(RECORD_ID);
      expect(row.user_id).toBe(VIEWER_ID);
      expect(instantOf(row.created_at)).toBe(VIEW_INSTANT.getTime());
      // Stated the other way round too: the row predates the drain it was
      // written in, which is the property the whole field exists for.
      expect(instantOf(row.created_at)).toBeLessThan(flushWindowStart);
    } finally {
      await writer!.stop();
    }
  });
});
