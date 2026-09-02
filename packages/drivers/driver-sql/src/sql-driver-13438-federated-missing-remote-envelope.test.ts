// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#13438 — the terminal backend-fault envelope DECLARES the table the
 * statement targeted, so a genuinely absent federated remote reads benign again.
 *
 * ## The residual #13324 left behind
 *
 * `isMissingTableError(error, readObject)` refuses the benign "not provisioned
 * yet" verdict when the dialect phrase names a relation OTHER than the one the
 * caller read. Call sites pass the object's API name. For a federated object
 * (ADR-0015) that is not the name in the statement: `registerExternalObject`
 * records `external.remoteName` in `physicalTableByObject`, and `getBuilder`
 * targets it. So a caller reading `crm_order` from an absent `legacy_orders`
 * got a phrase naming `legacy_orders`, compared it against `crm_order`, and
 * was told the failure was about something else — loud, for the one case the
 * licence exists for. Nothing at the call site knows the mapping; it lives on
 * this driver instance.
 *
 * ## The ruling (maintainer, 2026-09-01, option 2 on the card)
 *
 * The driver declares the table it targeted on the envelope, and the predicate
 * prefers a declared name over the caller-supplied object name. The predicate's
 * half — precedence, the dialect fixtures, the #13324 fence — is pinned in
 * `packages/types/src/driver-error-classification.targeted-table.test.ts`. This
 * suite pins the DRIVER's half, live, on every dialect it speaks:
 *
 *   1. the declared table IS the remote — the same name the dialect's own
 *      phrase carries, which is the measurement that makes the fix a fix;
 *   2. the composed message still withholds it (#8931's disclosure clause);
 *   3. the carrier is invisible to `JSON.stringify`, a spread and `Object.keys`
 *      — the same discipline the envelope's `cause` already keeps;
 *   4. end to end through the real predicate (`@objectstack/types` is a
 *      dependency of this package): benign for the absent remote, and — on the
 *      one dialect where a view can outlive its base table — still loud for a
 *      relation the statement did NOT target.
 *
 * The undeclared shape of the same error is asserted loud as a CONTROL, so the
 * benign verdict is measured as a consequence of the declaration rather than
 * of some wider change in the predicate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DRIVER_TARGETED_TABLE, isMissingTableError, targetedTableOf } from '@objectstack/types';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** The API object name the caller reads. */
const OBJECT = 'os13438_order';
/** `external.remoteName` — never created on any cell. */
const REMOTE = 'os13438_legacy_orders';
/** A native (non-federated) object that was never provisioned. */
const NATIVE_MISSING = 'os13438_never_created';

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the query to fail, but it resolved');
}

/**
 * The same envelope with the declaration REMOVED — code, status, message and
 * the non-enumerable `cause` copied, the symbol not. What the predicate saw on
 * `origin/main`, reconstructed from the live error so the control is about
 * this dialect's real phrase and not a hand-written fixture.
 */
function undeclared(err: any): Error {
  const copy = Object.assign(new Error(String(err.message)), { code: err.code, status: err.status });
  Object.defineProperty(copy, 'cause', { value: err.cause, enumerable: false, writable: true, configurable: true });
  return copy;
}

function declareSweep(cell: DialectCell): void {
describe(`[#13438] driver-sql — the envelope declares the targeted table (${cell.label})`, () => {
  let driver: SqlDriver;

  // A full connect cycle plus a drop against the cell's live server: budgeted
  // like every live-matrix hook in this package (#14100), NOT a claim that it
  // is known to time out.
  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${REMOTE}`).catch(() => {});
    await driver.execute(`drop table if exists ${NATIVE_MISSING}`).catch(() => {});
    // The federated view of a remote that does not exist. No DDL runs here —
    // that is what makes an external object external — so the remote stays
    // absent and the first read hits the dialect's missing-table phrase.
    driver.registerExternalObject({
      name: OBJECT,
      external: { remoteName: REMOTE },
      fields: { title: { type: 'string' } },
    });
  }, 60_000);

  afterAll(async () => {
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE CARD — the declared table is the remote, on both read halves
  // ───────────────────────────────────────────────────────────────

  it('declares `external.remoteName` — the name the dialect itself put in its phrase', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(OBJECT, {})],
      ['count', () => driver.count(OBJECT, {})],
    ] as const) {
      const err = await caught(run);
      expect(err.code, `${half}: code`).toBe('DATABASE_ERROR');
      expect(err.status, `${half}: status`).toBe(500);
      expect(targetedTableOf(err), `${half}: the declared target`).toBe(REMOTE);

      // POSITIVE CONTROL — the mismatch was real: the dialect named the
      // REMOTE and not the object, which is exactly what the caller's
      // `readObject` could never have matched.
      const phrase = String(err.cause?.message);
      expect(phrase, `${half}: the dialect names the remote`).toContain(REMOTE);
      expect(phrase, `${half}: the dialect does not name the object`).not.toContain(OBJECT);
    }
  });

  it('reads BENIGN again through the real predicate, with the caller passing its own API name', async () => {
    const err = await caught(() => driver.find(OBJECT, {}));
    expect(isMissingTableError(err, OBJECT), 'the card: an absent remote is truthful emptiness').toBe(true);

    // CONTROL — the same error without the declaration is what `origin/main`
    // produced, and it reads loud: the benign verdict above is a consequence
    // of the declaration, not of a wider predicate.
    expect(isMissingTableError(undeclared(err), OBJECT), 'undeclared: the pre-#13438 verdict').toBe(false);
  });

  // ───────────────────────────────────────────────────────────────
  // THE DISCLOSURE CLAUSE — declared on the envelope, never in the message
  // ───────────────────────────────────────────────────────────────

  it('the composed message still withholds the physical table (#8931)', async () => {
    const err = await caught(() => driver.find(OBJECT, {}));
    expect(String(err.message)).toContain(OBJECT);
    expect(String(err.message)).not.toContain(REMOTE);
  });

  it('the carrier is code-readable and serialisation-invisible, like `cause`', async () => {
    const err = await caught(() => driver.find(OBJECT, {}));
    expect(Object.getOwnPropertySymbols(err)).toContain(DRIVER_TARGETED_TABLE);
    expect(Object.keys(err), 'own enumerable keys').toEqual(['code', 'status']);
    expect(JSON.stringify(err), 'a serialised envelope carries no physical table').not.toContain(REMOTE);
    const spread = { ...err };
    expect(targetedTableOf(spread), 'a spread copy declares nothing').toBeNull();
    for (const key of Object.keys(spread)) {
      const value = (spread as Record<string, unknown>)[key];
      if (typeof value === 'string') expect(value, `spread property '${key}'`).not.toContain(REMOTE);
    }
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROL — a native object declares its own name, and matches as before
  // ───────────────────────────────────────────────────────────────

  it('a native object never provisioned declares its own name (the table `getBuilder` targeted)', async () => {
    const err = await caught(() => driver.find(NATIVE_MISSING, {}));
    expect(err.code).toBe('DATABASE_ERROR');
    expect(targetedTableOf(err)).toBe(NATIVE_MISSING);
    expect(String(err.cause?.message)).toContain(NATIVE_MISSING);
    expect(isMissingTableError(err, NATIVE_MISSING)).toBe(true);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#13438] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'federated missing-remote envelope', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// SQLITE-ONLY — the #13324 fence, live, WITH the declaration present
// ─────────────────────────────────────────────────────────────────

/**
 * The defect #13324 closed, reproduced live: a VIEW whose base table is gone
 * raises `no such table: main.<base>` — a phrase that answers the shape test
 * perfectly and names a relation the statement did NOT target. The envelope
 * now declares the view (what `getBuilder` targeted); the phrase names the
 * base; they differ; the verdict stays loud. SQLite is the one dialect where a
 * view outlives its base table — Postgres refuses the `DROP` without `CASCADE`
 * (which drops the view), and MySQL answers a different error class (an
 * invalid-view refusal, not a missing table) that the predicate never
 * recognised in the first place.
 */
const SQLITE = DIALECT_CELLS.find((c) => c.id === 'sqlite')!;
const VIEW = 'os13438_view_over_dropped_base';
const BASE = 'os13438_dropped_base';

declareDialectCell(SQLITE, 'federated missing-remote envelope — the #13324 fence', (cell) => {
describe('[#13438] sqlite — a relation the statement did NOT target is still loud', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`create table ${BASE} (id text primary key, title text)`);
    await driver.execute(`create view ${VIEW} as select * from ${BASE}`);
    await driver.execute(`drop table ${BASE}`);
  }, 60_000);

  afterAll(async () => {
    await driver.execute(`drop view if exists ${VIEW}`).catch(() => {});
    await driver.disconnect();
  });

  it('declares the VIEW, the phrase names the BASE, and the verdict is NOT benign', async () => {
    const err = await caught(() => driver.find(VIEW, {}));
    expect(err.code).toBe('DATABASE_ERROR');
    expect(targetedTableOf(err), 'the statement targeted the view').toBe(VIEW);
    const phrase = String(err.cause?.message);
    expect(phrase, 'the dialect names the dropped base').toContain(BASE);
    expect(isMissingTableError(err, VIEW), 'a view that exists is not "not provisioned yet"').toBe(false);
    // The one-argument published form reaches the same verdict from the
    // declaration alone — the driver supplied what the caller could not.
    expect(isMissingTableError(err)).toBe(false);
  });
});
});
