// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8275] `delete` stops swallowing refusals, and its driver faults stop being
 * labelled client errors.
 *
 * ## What was measured before the fix
 *
 * `packageService.delete` reported failure by RETURNING a bare
 * `{ success: false }` — the pre-#8131 shape, left in place when its sibling
 * `publish` was converted — and the door answered
 * `400 PACKAGE_DELETE_FAILED`. The statement that failed is
 * `DELETE FROM sys_packages WHERE id = ? [AND version = ?]`, so a missing
 * table, a lock timeout or a foreign-key restriction there is a SERVER fault
 * answered as a client one. Reproduced through a real `node:sqlite` database
 * running the real statement from `index.ts`; the two driver lines asserted
 * below are what SQLite actually emits for it, not invented text.
 *
 * ## Why this half looks SMALLER than `publish`'s, and is meant to
 *
 * `publish` needed a producer-side message (`PACKAGE_PUBLISH_DRIVER_FAULT_
 * MESSAGE`) because it had an `error?: string` limb carrying the raw driver
 * line to the wire. **This path never had one**, and the difference is
 * load-bearing rather than incidental: the door builds its sentence from the
 * request's own `:id` and `?version=`, so no driver text has ever reached a
 * caller here. This card is therefore a status-classification defect ONLY.
 *
 * That is also why the returned shape stays a bare flag. It would be easy to
 * mirror `publish` and add a `driverFault` message here for symmetry — and it
 * would be a regression in the one dimension that matters: the 5xx withhold
 * (#8086) lives in the door's `sendThrownError`, which a RETURNED failure
 * never reaches at any status (`sendError` consults no predicate — pinned in
 * `package-publish-status-classification.test.ts` §3). A message channel on
 * this path would be a channel to the wire that nothing filters. §1's
 * one-key assertion is what refuses that shape.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PackageServicePlugin, type PackageService } from './index.js';

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' } as any;
const METADATA = { objects: [], views: [] };

interface Booted {
  svc: PackageService;
  errorLogs: Array<{ msg: string; err?: any }>;
  db: DatabaseSync;
}

/**
 * A REAL SQLite database behind `objectql.execute`. `ensureTable` and the
 * delete statement are the ones in `index.ts`, run verbatim.
 *
 * `mutate` runs AFTER the plugin has started, so the table it breaks is the
 * one the service just created — the failure lands on the DELETE, which is the
 * seam this card is about, not on boot.
 */
async function boot(mutate?: (db: DatabaseSync) => void): Promise<Booted> {
  const db = new DatabaseSync(':memory:');
  const engine = {
    async execute({ sql, args }: { sql: string; args?: unknown[] }) {
      const stmt = db.prepare(sql);
      return /^\s*select/i.test(sql)
        ? stmt.all(...((args ?? []) as any[]))
        : stmt.run(...((args ?? []) as any[]));
    },
  };

  const errorLogs: Array<{ msg: string; err?: any }> = [];
  let registered: PackageService | undefined;
  const ctx: any = {
    logger: {
      debug: () => {}, info: () => {}, warn: () => {},
      error: (msg: string, err?: any) => errorLogs.push({ msg, err }),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    registerService: (_n: string, s: PackageService) => { registered = s; },
  };

  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (mutate) mutate(db);
  return { svc: registered!, errorLogs, db };
}

/** Every string a caller could read out of a delete outcome. */
function callerVisibleText(result: unknown): string {
  return JSON.stringify(result ?? null);
}

// ---------------------------------------------------------------------------
// 1. A real driver fault: a returned failure, and no channel to leak on
// ---------------------------------------------------------------------------

describe('[#8275] a real DELETE FROM sys_packages failure', () => {
  const FAULTS: Array<{
    name: string;
    break: (db: DatabaseSync) => void;
    driverText: string;
    version?: string;
  }> = [
    {
      name: 'the table is gone (the missing-table family)',
      break: (db) => db.exec('DROP TABLE sys_packages'),
      driverText: 'no such table: sys_packages',
      version: '1.0.0',
    },
    {
      name: 'the unversioned statement, same family (both SQL branches fail alike)',
      break: (db) => db.exec('DROP TABLE sys_packages'),
      driverText: 'no such table: sys_packages',
    },
    {
      name: 'a foreign-key restriction — the fault family only DELETE can have',
      break: (db) => {
        // A real referential restriction, the case the card names that
        // `publish` cannot reach: a dependent row pins the package, and the
        // driver refuses the DELETE. Nothing about the caller's request is
        // wrong, which is the whole point of the classification.
        db.exec('PRAGMA foreign_keys = ON');
        db.exec(`INSERT INTO sys_packages (id, version, manifest, metadata, hash)
                 VALUES ('com.acme.crm', '1.0.0', '{}', '{}', 'h')`);
        db.exec(`CREATE TABLE sys_package_dep (
                   dependent TEXT NOT NULL, pkg_id TEXT NOT NULL, pkg_version TEXT NOT NULL,
                   FOREIGN KEY (pkg_id, pkg_version) REFERENCES sys_packages(id, version))`);
        db.exec(`INSERT INTO sys_package_dep VALUES ('com.acme.billing', 'com.acme.crm', '1.0.0')`);
      },
      driverText: 'FOREIGN KEY constraint failed',
      version: '1.0.0',
    },
  ];

  for (const fault of FAULTS) {
    it(`${fault.name}: a returned failure, driver line to the log only`, async () => {
      const { svc, errorLogs } = await boot(fault.break);

      const result = await svc.delete('com.acme.crm', fault.version);

      expect(result.success).toBe(false);

      // ── The shape assertion that keeps this path leak-free BY CONSTRUCTION.
      // Not "the message is safe" — there is no message. A future edit that
      // adds one for symmetry with `publish` fails here, which is deliberate:
      // the door's `sendError` applies no withhold at any status, so a message
      // channel on this path is an unfiltered channel to the wire.
      expect(Object.keys(result)).toEqual(['success']);
      expect(callerVisibleText(result)).not.toContain(fault.driverText);
      expect(callerVisibleText(result)).not.toContain('sys_packages');

      // The anti-vacuity half: this proves SQLite really produced that exact
      // line on this call, so the absence above is a withhold and not a route
      // that never ran. It also pins that the operator's diagnostics are
      // UNCHANGED — this fix moves nothing out of the log.
      const logged = errorLogs.find((l) => l.msg === 'Failed to delete package');
      expect(logged, 'the driver fault was never logged').toBeDefined();
      expect(String(logged!.err?.message)).toBe(fault.driverText);
    });
  }

  it('a healthy delete is unaffected, and really deletes (anti-vacuity for §1)', async () => {
    const { svc, errorLogs, db } = await boot();
    await svc.publish({ manifest: MANIFEST, metadata: METADATA });

    const result = await svc.delete('com.acme.crm', '1.0.0');

    expect(result).toEqual({ success: true });
    expect(errorLogs).toEqual([]);
    // The statement ran against the real table — otherwise every failure case
    // above could be passing for the wrong reason.
    expect(db.prepare('SELECT COUNT(*) AS n FROM sys_packages').get()).toEqual({ n: 0 });
  });
});

// ---------------------------------------------------------------------------
// 2. A DECLARED refusal is re-thrown, not swallowed
// ---------------------------------------------------------------------------
//
// The other half of the classification, and the half that keeps 4xx intact.
// Before this change `delete` caught EVERY throw, so a coded refusal reachable
// from this call path came back as `{ success: false }` and the door answered
// `400 PACKAGE_DELETE_FAILED` — losing the producer's status AND its code.
// That is the same flattening #8016 removed from the door's catch-alls, one
// frame lower, where #8016's mapping could never see it.

/** An engine whose `execute` throws whatever the case declares. */
async function bootThrowing(error: unknown): Promise<Booted> {
  const errorLogs: Array<{ msg: string; err?: any }> = [];
  let registered: PackageService | undefined;
  let started = false;
  const engine = {
    async execute() {
      // Let `ensureTable` (which runs first, inside `start`) succeed, so the
      // throw lands on the DELETE and not on boot.
      if (!started) return null;
      throw error;
    },
  };
  const ctx: any = {
    logger: {
      debug: () => {}, info: () => {}, warn: () => {},
      error: (msg: string, err?: any) => errorLogs.push({ msg, err }),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    registerService: (_n: string, s: PackageService) => { registered = s; },
  };
  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  started = true;
  return { svc: registered!, errorLogs, db: undefined as any };
}

describe('[#8275] a throw that DECLARES an envelope is re-thrown, not swallowed', () => {
  const DECLARED: Array<{ name: string; error: any }> = [
    {
      name: 'a 409 with a registered code (the established DESTRUCTIVE_CHANGE shape)',
      error: Object.assign(new Error('Uninstalling drops 3 tables.'), {
        status: 409, code: 'DESTRUCTIVE_CHANGE',
      }),
    },
    {
      name: 'the `statusCode` spelling — both are produced in this repo',
      error: Object.assign(new Error('[tenant_scope_required] pass organizationId.'), {
        statusCode: 400,
      }),
    },
    {
      name: 'a declared 5xx — the producer said what it was, so it still answers',
      error: Object.assign(new Error('The registry is warming up.'), {
        status: 503, code: 'SERVICE_UNAVAILABLE',
      }),
    },
  ];

  for (const c of DECLARED) {
    it(`${c.name}: propagates UNCHANGED`, async () => {
      const { svc, errorLogs } = await bootThrowing(c.error);

      // Identity, not merely "some throw": the door's #8016 mapping reads the
      // producer's own `status`/`code` off this object, so a re-wrap would
      // silently change the answer.
      await expect(svc.delete('com.acme.crm', '1.0.0')).rejects.toBe(c.error);

      // Still logged on the way out — the log is not conditional on the exit.
      expect(errorLogs.some((l) => l.msg === 'Failed to delete package')).toBe(true);
    });
  }

  it('an UNDECLARED throw is NOT re-thrown — it is the driver fault of §1', async () => {
    // The discriminant, from the other side. Without this case the rule above
    // is satisfied by "re-throw everything", which would hand every driver
    // fault to the door's catch-all as a 500 INTERNAL_ERROR carrying the
    // driver's own message.
    const { svc } = await bootThrowing(new Error('no such table: sys_packages'));
    const result = await svc.delete('com.acme.crm', '1.0.0');
    expect(result).toEqual({ success: false });
    expect(callerVisibleText(result)).not.toContain('sys_packages');
  });

  it('a non-object throw declares nothing and is a driver fault', async () => {
    const { svc } = await bootThrowing('SQLITE_ERROR: disk I/O error');
    const result = await svc.delete('com.acme.crm');
    expect(result).toEqual({ success: false });
    expect(callerVisibleText(result)).not.toContain('SQLITE_ERROR');
  });

  /**
   * ⛔ The regression that a `.code`-reading discriminant causes, pinned per
   * driver dialect — the ruling this card carries, restated executably on the
   * `delete` seam rather than inherited from `publish`'s suite by analogy.
   *
   * A string `code` reads like a declaration and is not one: it is exactly
   * what every SQL driver puts on its errors. Under a `.code`-reading
   * predicate each shape below is re-thrown as if it were a refusal, resolved
   * by the door to `500 INTERNAL_ERROR` carrying the driver's own message —
   * putting driver text on a wire that, on THIS route, has never carried any.
   *
   * These are the real spellings. `node:sqlite` really does throw
   * `ERR_SQLITE_ERROR` for both statements in this method — measured, not
   * assumed.
   */
  const DRIVER_CODES: Array<{ dialect: string; code: unknown; message: string }> = [
    { dialect: 'node:sqlite', code: 'ERR_SQLITE_ERROR', message: 'no such table: sys_packages' },
    { dialect: 'better-sqlite3', code: 'SQLITE_ERROR', message: 'FOREIGN KEY constraint failed' },
    { dialect: 'postgres (SQLSTATE)', code: '42P01', message: 'relation "sys_packages" does not exist' },
    { dialect: 'postgres FK restriction (SQLSTATE)', code: '23503', message: 'update or delete on table "sys_packages" violates foreign key constraint' },
    { dialect: 'mysql', code: 'ER_NO_SUCH_TABLE', message: "Table 'os.sys_packages' doesn't exist" },
    { dialect: 'mysql lock timeout', code: 'ER_LOCK_WAIT_TIMEOUT', message: 'Lock wait timeout exceeded; try restarting transaction' },
    { dialect: 'a numeric errno', code: 1299, message: 'no such table: sys_packages' },
    { dialect: 'an empty string', code: '', message: 'no such table: sys_packages' },
  ];

  for (const d of DRIVER_CODES) {
    it(`a ${d.dialect} error \`code\` is NOT a declaration — still a driver fault`, async () => {
      const { svc } = await bootThrowing(Object.assign(new Error(d.message), { code: d.code }));
      const result = await svc.delete('com.acme.crm', '1.0.0');
      expect(result).toEqual({ success: false });
      expect(callerVisibleText(result)).not.toContain(d.message);
      expect(callerVisibleText(result)).not.toContain('sys_packages');
    });
  }
});
