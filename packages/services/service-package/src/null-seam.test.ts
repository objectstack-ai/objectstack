// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10965 — `get()` / `list()` answered over a driver they never queried.
 *
 * ## What was measured before the fix
 *
 * The card established the conflation by READING, and said so; it named the
 * boot path as unverified. It was booted for real before this change — a
 * `LiteKernel` with the real `ObjectQLPlugin` and a real
 * `InMemoryDriver({ persistence: false })`, with `PackageServicePlugin.start()`
 * driven against that engine:
 *
 *     typeof objectql.execute            -> 'function'   (the shape test passes)
 *     objectql.registry.installPackage   -> 'function'   (so hydration RUNS)
 *     start() issues 3 statements, each returning null:
 *       CREATE TABLE IF NOT EXISTS sys_packages …        -> null
 *       CREATE INDEX IF NOT EXISTS idx_packages_latest … -> null
 *       SELECT * FROM sys_packages … (the hydration list) -> null
 *     list() -> []      ⇒ "no packages are installed"
 *     get()  -> null    ⇒ "this package is not installed"
 *
 * So the boot path DOES reach `list()` on the zero-install stack, and the
 * hydration loop iterated zero times without a word — its only log sits behind
 * `hydrated > 0`. What nothing did was WRITE on that reading: the loop's only
 * write is per-row, and `metadata-protocol`'s `installPackage` /
 * `updatePackage` / `deletePackage` call `publish` / `delete` unconditionally,
 * never gated on this read. No re-install; a silent hydration skip plus two
 * false answers on the HTTP read doors.
 *
 * ## What these tests pin — BOTH directions
 *
 * The separation is not "stopped returning null/[]". It is that a seam which
 * cannot ANSWER is now distinguishable from one that answered NO ROWS, and the
 * second case must keep working: an implementation that treated every empty
 * result as a broken seam would score green on the refusal cases alone and
 * break every legitimately-empty deployment. The `node:sqlite` cases below are
 * that leg, on a real driver running the real statements from `index.ts`.
 *
 * ## What is deliberately NOT asserted here
 *
 * The ROWS a dialect yields are not this file's subject — only the
 * answered/unanswered separation is. When these tests were written the local
 * `normalizeRows` implemented two of the three dialect shapes and did not
 * unwrap the mysql2 `[rows, fields]` tuple; that gap was filed rather than
 * fixed as a rider, and closed in #11062. The populated-tuple assertions live
 * with the rest of the dialect-shape contract in `mysql2-tuple.test.ts`. What
 * stays pinned HERE is the part this card owns: a tuple-shaped result is an
 * ANSWER, so the guard cannot misfire on it.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  PackageServicePlugin,
  PACKAGE_SEAM_UNREADABLE_MESSAGE,
  type PackageService,
} from './index.js';

const MANIFEST = { id: 'com.acme.crm', name: 'CRM', version: '1.0.0', type: 'application' } as any;

interface Booted {
  svc: PackageService;
  warnLogs: string[];
  errorLogs: string[];
}

/** Boot the real plugin over whatever `execute` the case supplies. */
async function bootWith(
  execute: (q: { sql: string; args?: unknown[] }) => Promise<unknown>,
  registry?: { installPackage: (m: unknown) => void; getPackage: (id: string) => unknown },
): Promise<Booted> {
  const warnLogs: string[] = [];
  const errorLogs: string[] = [];
  const engine: any = { execute };
  if (registry) engine.registry = registry;

  let registered: PackageService | undefined;
  const ctx: any = {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => warnLogs.push(String(msg)),
      error: (msg: string) => errorLogs.push(String(msg)),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    registerService: (_n: string, s: PackageService) => { registered = s; },
  };

  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  return { svc: registered!, warnLogs, errorLogs };
}

/**
 * A REAL SQLite database behind `objectql.execute` — an ANSWERING seam.
 *
 * `stmt.all()` returns a bare row array, dialect shape #1, and an empty SELECT
 * returns `[]`. The `CREATE TABLE` / `CREATE INDEX` in `ensureTable` and the
 * SELECTs in `get()` / `list()` are the statements from `index.ts`, run
 * verbatim against a real engine.
 */
function realSqliteSeam() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    async execute({ sql, args }: { sql: string; args?: unknown[] }) {
      const stmt = db.prepare(sql);
      return /^\s*select/i.test(sql)
        ? stmt.all(...((args ?? []) as any[]))
        : stmt.run(...((args ?? []) as any[]));
    },
  };
}

/** The ADR-0112 envelope a seam refusal must declare: code AND status. */
async function expectSeamRefusal(run: () => Promise<unknown>): Promise<void> {
  let thrown: any;
  try {
    await run();
    throw new Error('expected a refusal, but the call returned');
  } catch (e) {
    thrown = e;
  }
  // ⛔ Never `toThrow()` alone: an unfixed path throwing a bare Error would
  // satisfy that and pin nothing. The envelope is the contract.
  expect(thrown.code).toBe('SERVICE_UNAVAILABLE');
  expect(thrown.status).toBe(503);
  expect(thrown.message).toBe(PACKAGE_SEAM_UNREADABLE_MESSAGE);
  // The wording is itself the contract: it says the answer is UNKNOWN.
  expect(thrown.message).toMatch(/UNKNOWN/);
  expect(thrown.message).not.toMatch(/sys_packages|SELECT/i);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The seam that cannot answer — every spelling of "no result set"
// ───────────────────────────────────────────────────────────────────────────

describe('#10965 a non-answering seam is REFUSED, not reported as absence', () => {
  // `null` first: the measured `InMemoryDriver.execute()` return.
  const nonAnswers: Array<[string, unknown]> = [
    ['null — the measured InMemoryDriver return', null],
    ['undefined', undefined],
    ['a host that echoes the statement back', 'SELECT * FROM sys_packages'],
    ['an object with no rows key', {}],
    ['an object whose rows is not an array', { rows: 'not-an-array' }],
    ['a number', 42],
  ];

  for (const [label, value] of nonAnswers) {
    it(`get() refuses over ${label}`, async () => {
      const { svc } = await bootWith(async () => value);
      await expectSeamRefusal(() => svc.get('com.acme.crm', 'latest'));
    });

    it(`list() refuses over ${label}`, async () => {
      const { svc } = await bootWith(async () => value);
      await expectSeamRefusal(() => svc.list());
    });
  }

  it('get() refuses for a pinned version too, not only "latest"', async () => {
    const { svc } = await bootWith(async () => null);
    await expectSeamRefusal(() => svc.get('com.acme.crm', '1.0.0'));
  });

  it('the refusal is logged as an inability, not as a miss', async () => {
    const { svc, errorLogs } = await bootWith(async () => null);
    await svc.get('com.acme.crm', 'latest').catch(() => {});
    await svc.list().catch(() => {});
    expect(errorLogs.some((l) => /Cannot answer whether package/.test(l))).toBe(true);
    expect(errorLogs.some((l) => /Cannot answer which packages/.test(l))).toBe(true);
    // The old lines claimed a failed read of something that exists.
    expect(errorLogs.some((l) => /^Failed to get package/.test(l))).toBe(false);
    expect(errorLogs.some((l) => /^Failed to list packages/.test(l))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. STILL-EMPTY — the load-bearing leg, on a REAL driver
// ───────────────────────────────────────────────────────────────────────────

describe('#10965 a seam that ANSWERS with zero rows still means "not installed"', () => {
  it('real SQLite, empty sys_packages: get() -> null and list() -> []', async () => {
    const seam = realSqliteSeam();
    const { svc, warnLogs } = await bootWith(seam.execute);

    // The table exists and is genuinely empty — proven against the real db,
    // so "the query never ran" cannot explain the answers below.
    expect(seam.db.prepare('SELECT COUNT(*) AS n FROM sys_packages').get()).toEqual({ n: 0 });

    await expect(svc.get('com.acme.crm', 'latest')).resolves.toBeNull();
    await expect(svc.get('com.acme.crm', '1.0.0')).resolves.toBeNull();
    await expect(svc.list()).resolves.toEqual([]);
    // A legitimately-empty install says nothing about an unreadable seam.
    expect(warnLogs.filter((l) => /SKIPPED/.test(l))).toEqual([]);
  });

  it('real SQLite, populated: the rows still come back', async () => {
    const seam = realSqliteSeam();
    const { svc } = await bootWith(seam.execute);

    await svc.publish({ manifest: MANIFEST, metadata: { objects: [] } });

    const got = await svc.get('com.acme.crm', 'latest');
    expect(got).toMatchObject({ id: 'com.acme.crm', version: '1.0.0' });
    expect(got!.manifest).toMatchObject({ id: 'com.acme.crm' });

    const listed = await svc.list();
    expect(listed.map((p) => p.id)).toEqual(['com.acme.crm']);
  });

  it('a package that is genuinely absent is still `null`, beside one that is present', async () => {
    const seam = realSqliteSeam();
    const { svc } = await bootWith(seam.execute);
    await svc.publish({ manifest: MANIFEST, metadata: {} });

    await expect(svc.get('com.acme.crm', 'latest')).resolves.not.toBeNull();
    await expect(svc.get('com.acme.nothing', 'latest')).resolves.toBeNull();
    await expect(svc.get('com.acme.crm', '9.9.9')).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The dialect shapes this flattener implements stay answers
// ───────────────────────────────────────────────────────────────────────────

describe('#10965 the guard never turns a result set into a refusal', () => {
  const row = {
    id: 'com.acme.crm',
    version: '1.0.0',
    manifest: JSON.stringify(MANIFEST),
    metadata: '{}',
    hash: 'h',
    created_at: 't',
    updated_at: 't',
  };

  /** Only the SELECTs are shaped; DDL keeps the same spelling. */
  function seamReturning(select: unknown) {
    return async ({ sql }: { sql: string }) => (/^\s*select/i.test(sql.trim()) ? select : []);
  }

  it('bare row array (better-sqlite3 through knex) — rows come through', async () => {
    const { svc } = await bootWith(seamReturning([row]));
    await expect(svc.get('com.acme.crm', 'latest')).resolves.toMatchObject({ id: 'com.acme.crm' });
    await expect(svc.list()).resolves.toHaveLength(1);
  });

  it('bare EMPTY array — an answer of no rows, not a refusal', async () => {
    const { svc } = await bootWith(seamReturning([]));
    await expect(svc.get('com.acme.crm', 'latest')).resolves.toBeNull();
    await expect(svc.list()).resolves.toEqual([]);
  });

  it('`{ rows, rowCount }` (pg) — rows come through', async () => {
    const { svc } = await bootWith(seamReturning({ rows: [row], rowCount: 1 }));
    await expect(svc.get('com.acme.crm', 'latest')).resolves.toMatchObject({ id: 'com.acme.crm' });
    await expect(svc.list()).resolves.toHaveLength(1);
  });

  it('`{ rows: [], rowCount: 0 }` (pg) — an answer of no rows, not a refusal', async () => {
    const { svc } = await bootWith(seamReturning({ rows: [], rowCount: 0 }));
    await expect(svc.get('com.acme.crm', 'latest')).resolves.toBeNull();
    await expect(svc.list()).resolves.toEqual([]);
  });

  it('an `[rows, fields]`-shaped result is an ANSWER — the guard does not misfire', async () => {
    // Nothing is asserted here about the rows the tuple yields — that is
    // `mysql2-tuple.test.ts`'s contract (#11062). What is asserted is the only
    // thing this card owns: it is not mistaken for a seam that failed to
    // answer, so no dialect gets a false 503.
    const { svc } = await bootWith(seamReturning([[], []]));
    await expect(svc.list()).resolves.toEqual([]);
    await expect(svc.get('com.acme.crm', 'latest')).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Boot hydration — the measured consequence, now audible
// ───────────────────────────────────────────────────────────────────────────

describe('#10965 boot hydration over a non-answering seam', () => {
  function fakeRegistry() {
    const installed: any[] = [];
    return {
      installed,
      installPackage: (m: any) => { installed.push(m); },
      getPackage: (_id: string) => undefined,
    };
  }

  it('does not brick boot, and SAYS the durable packages could not be read', async () => {
    const registry = fakeRegistry();
    const { warnLogs } = await bootWith(async () => null, registry);

    // Boot completed (bootWith would have rejected otherwise) and installed
    // nothing — but no longer silently.
    expect(registry.installed).toEqual([]);
    const skip = warnLogs.find((l) => /hydration from sys_packages SKIPPED/i.test(l));
    expect(skip).toBeDefined();
    expect(skip).toMatch(/no result set/);
    expect(skip).toMatch(/not "no packages installed"/);
  });

  it('an ANSWERING seam with zero rows hydrates nothing and says nothing', async () => {
    const registry = fakeRegistry();
    const seam = realSqliteSeam();
    const { warnLogs } = await bootWith(seam.execute, registry);

    expect(registry.installed).toEqual([]);
    expect(warnLogs.filter((l) => /SKIPPED/.test(l))).toEqual([]);
  });

  it('an ANSWERING seam with a durable row still hydrates it', async () => {
    const registry = fakeRegistry();
    const seam = realSqliteSeam();

    // Seed the durable row through the service's own publish, then boot a
    // second plugin instance over the same database — a restart.
    const first = await bootWith(seam.execute);
    await first.svc.publish({ manifest: MANIFEST, metadata: {} });

    const { warnLogs } = await bootWith(seam.execute, registry);
    expect(registry.installed.map((m: any) => m.id)).toEqual(['com.acme.crm']);
    expect(warnLogs.filter((l) => /SKIPPED/.test(l))).toEqual([]);
  });
});
