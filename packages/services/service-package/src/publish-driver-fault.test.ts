// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8131] `publish` stops handing driver text back as caller-visible data,
 * and stops swallowing refusals.
 *
 * ## What was measured before the fix
 *
 * The card was filed with its `publish` path read from SOURCE, not reproduced,
 * and said so. It was reproduced before this change: a REAL SQLite database
 * behind `objectql.execute`, running the real `INSERT INTO sys_packages …`
 * statement from `index.ts`, driven through the real handler. Two forced
 * failures, both answered on the wire as:
 *
 *     HTTP 400
 *     {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
 *      "message":"no such table: sys_packages"}}
 *
 *     HTTP 400
 *     {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
 *      "message":"NOT NULL constraint failed: sys_packages.tenant_ref"}}
 *
 * i.e. exactly the card's claim, and on a **400** — a client error for a fault
 * the client had no part in.
 *
 * ## Why the PRODUCER half is the load-bearing one
 *
 * The dispatch assumed that reclassifying this path to 5xx would put it inside
 * #8086's withhold "with no new rule". Measured, that is false: the withhold
 * lives in the door's `sendThrownError`, and a failure that is *returned*
 * reaches `sendError` directly, which consults no predicate at any status.
 * Classification alone changes 400 to 500 and leaves the driver line exactly
 * where it was.
 *
 * When this was written there was a second, independent reason —
 * `looksLikeInternalErrorLeak('no such table: sys_packages')` was **false**,
 * so the line would have survived the withhold even if it had been reached.
 * #8132 has since taught the predicate that phrasing, retiring that half of
 * the argument. It changes nothing here: re-measured against the widened
 * predicate, the classification-only counterfactual still answers
 * `500 {"message":"no such table: sys_packages"}`, because nothing on the
 * returned path asks. The door's suite carries that case.
 *
 * So the disclosure is closed HERE, at the producer, where no heuristic is
 * involved and no dialect's phrasing has to be recognised — option C of #8086,
 * for this producer, and the reason it does not depend on #8132 holding.
 *
 * ## The driver is real on purpose
 *
 * A hand-thrown `new Error('no such table: …')` would pin the plumbing while
 * proving nothing about what SQLite actually emits for these statements. The
 * text asserted below is produced by SQLite, from the real DDL and the real
 * INSERT.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PackageServicePlugin, PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE, type PackageService } from './index.js';

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' } as any;
const METADATA = { objects: [], views: [] };

interface Booted {
  svc: PackageService;
  errorLogs: Array<{ msg: string; err?: any }>;
}

/**
 * A REAL SQLite database behind `objectql.execute`. `ensureTable` and the
 * publish INSERT are the statements in `index.ts`, run verbatim.
 *
 * `mutate` runs AFTER the plugin has started, so the table it breaks is the
 * one the service just created — the failure lands on the INSERT, which is
 * the seam this card is about, not on boot.
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
  const ctx: any = {
    logger: {
      debug: () => {}, info: () => {}, warn: () => {},
      error: (msg: string, err?: any) => errorLogs.push({ msg, err }),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    registerService: () => {},
  };
  let registered: PackageService | undefined;
  ctx.registerService = (_n: string, s: PackageService) => { registered = s; };

  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (mutate) mutate(db);
  return { svc: registered!, errorLogs };
}

/** Every string a caller could read out of a publish outcome. */
function callerVisibleText(result: unknown): string {
  return JSON.stringify(result ?? null);
}

// ---------------------------------------------------------------------------
// 1. A real driver fault: stable sentence out, raw text to the log only
// ---------------------------------------------------------------------------

describe('[#8131] a real INSERT INTO sys_packages failure', () => {
  const FAULTS: Array<{ name: string; break: (db: DatabaseSync) => void; driverText: string }> = [
    {
      name: 'the table is gone (the missing-table family)',
      break: (db) => db.exec('DROP TABLE sys_packages'),
      driverText: 'no such table: sys_packages',
    },
    {
      name: 'a constraint dump naming the physical table and column',
      break: (db) => {
        db.exec('DROP TABLE sys_packages');
        db.exec(`CREATE TABLE sys_packages (
          id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL,
          metadata TEXT NOT NULL, hash TEXT NOT NULL,
          created_at TEXT, updated_at TEXT, tenant_ref TEXT NOT NULL,
          PRIMARY KEY (id, version))`);
      },
      driverText: 'NOT NULL constraint failed: sys_packages.tenant_ref',
    },
  ];

  for (const fault of FAULTS) {
    it(`${fault.name}: the caller gets the stable sentence, the log gets the driver line`, async () => {
      const { svc, errorLogs } = await boot(fault.break);

      const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });

      // ── The DISCLOSURE half and the ANTI-VACUITY half, asserted together.
      // `not.toContain(driverText)` alone is green on a path that emitted no
      // text at all — including a `publish` that never ran. The log assertion
      // below is what proves SQLite really produced this exact line on this
      // call, so the absence above is a withhold and not a no-op.
      expect(result.success).toBe(false);
      expect(result.driverFault?.message).toBe(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE);
      expect(callerVisibleText(result)).not.toContain(fault.driverText);
      expect(callerVisibleText(result)).not.toContain('sys_packages');

      // The diagnostics are UNCHANGED — this fix moves the text, it does not
      // delete it. An operator loses nothing.
      const logged = errorLogs.find((l) => l.msg === 'Failed to publish package');
      expect(logged, 'the driver fault was never logged').toBeDefined();
      expect(String(logged!.err?.message)).toBe(fault.driverText);
    });
  }

  it('the old `error` limb is gone, not merely unused', async () => {
    // The carrier itself. A fix that kept `error` populated "for
    // compatibility" would pass every assertion above while leaving the leak
    // one field over — this is the case that refuses that shape.
    const { svc } = await boot((db) => db.exec('DROP TABLE sys_packages'));
    const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });
    expect(Object.keys(result).sort()).toEqual(['driverFault', 'success']);
    expect((result as unknown as Record<string, unknown>).error).toBeUndefined();
  });

  it('a healthy publish is unaffected (anti-vacuity for the whole section)', async () => {
    const { svc, errorLogs } = await boot();
    const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });
    expect(result).toEqual({ success: true });
    expect(errorLogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. A DECLARED refusal is re-thrown, not swallowed
// ---------------------------------------------------------------------------
//
// The other half of the classification. Before this change `publish` caught
// every throw, so a coded refusal reachable from this call path came back as
// `{ success: false, error }` and the door answered `400
// PACKAGE_PUBLISH_FAILED` — losing the producer's status AND its code. That is
// the same flattening #8016 removed from the door's catch-alls, one frame
// lower, where #8016's mapping could never see it.

/** An engine whose `execute` throws whatever the case declares. */
async function bootThrowing(error: unknown): Promise<Booted> {
  const errorLogs: Array<{ msg: string; err?: any }> = [];
  let registered: PackageService | undefined;
  let started = false;
  const engine = {
    async execute() {
      // Let `ensureTable` (which runs first, inside `start`) succeed, so the
      // throw lands on the publish INSERT and not on boot.
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
  return { svc: registered!, errorLogs };
}

describe('[#8131] a throw that DECLARES an envelope is re-thrown, not swallowed', () => {
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
      await expect(svc.publish({ manifest: MANIFEST, metadata: METADATA }))
        .rejects.toBe(c.error);

      // Still logged on the way out — the log is not conditional on the exit.
      expect(errorLogs.some((l) => l.msg === 'Failed to publish package')).toBe(true);
    });
  }

  it('an UNDECLARED throw is NOT re-thrown — it is the driver fault of section 1', async () => {
    // The discriminant, from the other side. Without this case the rule above
    // is satisfied by "re-throw everything", which would put the raw driver
    // line back on the wire through the door's catch-all.
    const { svc } = await bootThrowing(new Error('no such table: sys_packages'));
    const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });
    expect(result.success).toBe(false);
    expect(result.driverFault?.message).toBe(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE);
  });

  it('a non-object throw declares nothing and is a driver fault', async () => {
    const { svc } = await bootThrowing('SQLITE_ERROR: disk I/O error');
    const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });
    expect(result.success).toBe(false);
    expect(callerVisibleText(result)).not.toContain('SQLITE_ERROR');
  });

  /**
   * ⛔ The regression that a `.code`-reading discriminant causes, pinned per
   * driver dialect.
   *
   * An earlier draft of `declaresHttpAnswer` accepted any non-empty string
   * `code` as a declaration — which reads as reasonable and is wrong, because
   * a string `code` is exactly what every SQL driver puts on its errors. Under
   * that draft each shape below was re-thrown as if it were a refusal,
   * resolved to `500 INTERNAL_ERROR` carrying the driver's own message, and
   * (the heuristic being false for the missing-table phrasing) put that
   * message back on the wire — the very leak this card closes.
   *
   * These are the real spellings, not invented ones: `node:sqlite` really does
   * throw `ERR_SQLITE_ERROR` — it is what made the section-1 cases fail while
   * this fix was being written.
   */
  const DRIVER_CODES: Array<{ dialect: string; code: unknown; message: string }> = [
    { dialect: 'node:sqlite', code: 'ERR_SQLITE_ERROR', message: 'no such table: sys_packages' },
    { dialect: 'better-sqlite3', code: 'SQLITE_ERROR', message: 'no such table: sys_packages' },
    { dialect: 'postgres (SQLSTATE)', code: '42P01', message: 'relation "sys_packages" does not exist' },
    { dialect: 'mysql', code: 'ER_NO_SUCH_TABLE', message: "Table 'os.sys_packages' doesn't exist" },
    { dialect: 'a numeric errno', code: 1299, message: 'NOT NULL constraint failed: sys_packages.hash' },
    { dialect: 'an empty string', code: '', message: 'no such table: sys_packages' },
  ];

  for (const d of DRIVER_CODES) {
    it(`a ${d.dialect} error \`code\` is NOT a declaration — still a driver fault`, async () => {
      const { svc } = await bootThrowing(Object.assign(new Error(d.message), { code: d.code }));
      const result = await svc.publish({ manifest: MANIFEST, metadata: METADATA });
      expect(result.success).toBe(false);
      expect(result.driverFault?.message).toBe(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE);
      expect(callerVisibleText(result)).not.toContain(d.message);
      expect(callerVisibleText(result)).not.toContain('sys_packages');
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The message is a constant, and that is the point
// ---------------------------------------------------------------------------

describe('[#8131] the caller-facing sentence interpolates nothing', () => {
  it('is identical across different faults and different packages', async () => {
    // If the sentence ever grows an interpolation, it grows a channel. Two
    // different failures on two different packages must be byte-identical.
    const a = await boot((db) => db.exec('DROP TABLE sys_packages'));
    const first = await a.svc.publish({ manifest: MANIFEST, metadata: METADATA });

    const b = await boot((db) => {
      db.exec('DROP TABLE sys_packages');
      db.exec('CREATE TABLE sys_packages (id TEXT NOT NULL, extra TEXT NOT NULL)');
    });
    const second = await b.svc.publish({
      manifest: { id: 'com.other.app', version: '9.9.9' } as any,
      metadata: { objects: [] },
    });

    expect(first.driverFault?.message).toBe(second.driverFault?.message);
    expect(first.driverFault?.message).toBe(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE);
    // Names neither package, so it cannot be echoing anything it was handed.
    expect(second.driverFault?.message).not.toContain('com.other.app');
  });

  it('says what a caller can act on: not persisted, logged, not theirs to fix', async () => {
    // Pinned as prose because the sentence IS the contract here — a future
    // edit that shortens it to "Publish failed." would pass every other case
    // in this file while deleting what the caller needed.
    expect(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE).toContain('could not store');
    expect(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE).toContain('logged on the server');
    expect(PACKAGE_PUBLISH_DRIVER_FAULT_MESSAGE).toContain('no package data was written');
  });
});
