// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11062 — the mysql2 `[rows, fields]` tuple was never unwrapped, so a
 * POPULATED result answered "not installed".
 *
 * ## The shape, and why it reaches this file
 *
 * `ObjectQLEngine.execute()` returns what the driver returned verbatim, and
 * `SqlDriver.execute()` returns `knex.raw()` verbatim — so the raw client's own
 * per-dialect shape arrives at this service's `normalizeRows` untouched.
 * `sql-driver.ts` says so in its own words at the one place it flattens a raw
 * SELECT internally: *"mysql2 returns [rows, fields]"*.
 *
 * This is a SUPPORTED composition, not a hypothetical one:
 * `OS_DATABASE_URL=mysql://…` is dispatched by `standalone-stack.ts` to
 * `kind === 'mysql'` → a `SqlDriver` on the `mysql2` client, as the DEFAULT
 * driver — and the default driver is exactly the one `objectql.execute()`
 * selects for this service's raw SELECTs (its own docblock names
 * `PackageService` as the caller it exists for). `os serve` loads
 * `PackageServicePlugin` for the `marketplace` feature over that same engine.
 *
 * ## What the defect did
 *
 * The tuple is an ARRAY, so it satisfied both the old `Array.isArray(result)`
 * branch and `isResultSet` — no false 503, and #10965's guard was never at
 * fault. `normalizeRows` simply returned the 2-element tuple, so:
 *
 *   - `get()`  read `rows[0]` — the row ARRAY, not a row. `row.manifest` was
 *     `undefined`, `JSON.parse(undefined)` threw into `get()`'s catch, and the
 *     catch answers `null` ⇒ **"this package is not installed"**.
 *   - `list()` mapped over `[rows, fields]` and threw in the same place, into a
 *     catch that answers `[]` ⇒ **"no packages are installed"**.
 *
 * Both over a driver that had just returned the row. The swallowed throw is the
 * signature, which is why the populated cases below also assert that NOTHING
 * was logged to `error` — a fix that returned the right rows while still
 * throwing and recovering somewhere would pass a rows-only assertion.
 *
 * ## What is pinned — all three dialects, one row, one answer
 *
 * The parity case is the point: the SAME logical row, spelled three ways,
 * must produce the SAME answer. A fix that taught the flattener the tuple but
 * broke the bare array or `{ rows }` would fail here, and so would a "fix" that
 * special-cased mysql2 into a different result. Shapes 1 and 2 are not
 * regression ballast — they are half the contract.
 */

import { describe, it, expect } from 'vitest';
import {
  PackageServicePlugin,
  type PackageService,
} from './index.js';

const MANIFEST = { id: 'com.acme.crm', name: 'CRM', version: '1.0.0', type: 'application' };
const METADATA = { author: 'ACME', installedBy: 'os-dev' };

/** One stored row, as every dialect hands back the columns of `sys_packages`. */
const ROW = {
  id: 'com.acme.crm',
  version: '1.0.0',
  manifest: JSON.stringify(MANIFEST),
  metadata: JSON.stringify(METADATA),
  hash: 'd3adb33f',
  created_at: '2026-08-23T00:00:00.000Z',
  updated_at: '2026-08-23T00:00:00.000Z',
};

/** The answer both read doors must produce from that row, in every dialect. */
const EXPECTED = {
  id: 'com.acme.crm',
  version: '1.0.0',
  manifest: MANIFEST,
  metadata: METADATA,
  hash: 'd3adb33f',
  created_at: '2026-08-23T00:00:00.000Z',
  updated_at: '2026-08-23T00:00:00.000Z',
};

/**
 * mysql2's second tuple element — column metadata, never rows.
 *
 * Spelled out rather than left `[]` so the tuple case cannot pass by accident:
 * with a non-empty second element, returning the whole tuple yields a
 * 2-element `list()`, which is visibly wrong rather than coincidentally equal.
 */
const FIELDS = [
  { name: 'id', type: 253 },
  { name: 'version', type: 253 },
  { name: 'manifest', type: 252 },
];

interface Booted {
  svc: PackageService;
  errorLogs: string[];
}

/** Boot the real plugin over a seam that returns `result` for every SELECT. */
async function bootReturning(result: unknown): Promise<Booted> {
  const errorLogs: string[] = [];
  const engine: any = {
    async execute({ sql }: { sql: string; args?: unknown[] }) {
      // DDL from `ensureTable` answers like a real driver; only SELECTs carry
      // the dialect shape under test.
      return /^\s*select/i.test(sql) ? result : undefined;
    },
  };

  let registered: PackageService | undefined;
  const ctx: any = {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => errorLogs.push(String(msg)),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    registerService: (_n: string, s: PackageService) => { registered = s; },
  };

  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  return { svc: registered!, errorLogs };
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The three dialect shapes recover the SAME row
// ───────────────────────────────────────────────────────────────────────────

describe('#11062 normalizeRows — every supported dialect answers with the row', () => {
  const dialects: Array<[string, unknown]> = [
    ['bare row array (better-sqlite3 through knex, Turso remote)', [ROW]],
    ['`{ rows, rowCount }` (pg)', { rows: [ROW], rowCount: 1 }],
    ['`[rows, fields]` tuple (mysql2)', [[ROW], FIELDS]],
  ];

  for (const [label, shape] of dialects) {
    it(`get() returns the package from ${label}`, async () => {
      const { svc, errorLogs } = await bootReturning(shape);
      await expect(svc.get('com.acme.crm', 'latest')).resolves.toEqual(EXPECTED);
      // The defect's signature was a SWALLOWED throw, not a wrong return.
      expect(errorLogs).toEqual([]);
    });

    it(`list() returns exactly one package from ${label}`, async () => {
      const { svc, errorLogs } = await bootReturning(shape);
      await expect(svc.list()).resolves.toEqual([EXPECTED]);
      expect(errorLogs).toEqual([]);
    });
  }

  it('all three dialects agree — same row in, same answer out', async () => {
    const answers = [];
    for (const [, shape] of dialects) {
      const { svc } = await bootReturning(shape);
      answers.push(await svc.list());
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[1]).toEqual(answers[2]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The tuple branch must not misfire on the shapes that already worked
// ───────────────────────────────────────────────────────────────────────────

describe('#11062 the tuple test cannot swallow a bare row array', () => {
  /**
   * The unwrap keys on `Array.isArray(result[0])`, so it fires only where a
   * dialect NESTS an array at index 0. A bare row array holds row OBJECTS —
   * measured on `@libsql/client` 0.17.4, `result.rows` is a real array whose
   * elements are plain objects (`Array.isArray(rows[0]) === false`), and knex
   * over better-sqlite3 likewise maps rows to objects.
   */
  it('a multi-row bare array keeps every row', async () => {
    const second = { ...ROW, id: 'com.acme.hr', version: '2.0.0' };
    const { svc } = await bootReturning([ROW, second]);
    const listed = await svc.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((p: any) => p.id)).toEqual(['com.acme.crm', 'com.acme.hr']);
  });

  it('a single-row bare array is not mistaken for a tuple', async () => {
    const { svc } = await bootReturning([ROW]);
    await expect(svc.list()).resolves.toEqual([EXPECTED]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. An EMPTY answer stays an answer — in every dialect, including the tuple
// ───────────────────────────────────────────────────────────────────────────

describe('#11062 empty results remain "no rows", never a refusal', () => {
  /**
   * The half that stops this being a rename (#10965's leg, re-asserted for the
   * shape this card adds): an empty result set in ANY spelling is still a
   * result set, so it answers "not installed" / "nothing installed" rather than
   * raising the seam refusal.
   */
  const empties: Array<[string, unknown]> = [
    ['bare `[]`', []],
    ['`{ rows: [], rowCount: 0 }` (pg)', { rows: [], rowCount: 0 }],
    ['`[[], fields]` (mysql2, zero rows)', [[], FIELDS]],
  ];

  for (const [label, shape] of empties) {
    it(`${label} answers no-rows without throwing`, async () => {
      const { svc, errorLogs } = await bootReturning(shape);
      await expect(svc.get('com.acme.crm', 'latest')).resolves.toBeNull();
      await expect(svc.list()).resolves.toEqual([]);
      expect(errorLogs).toEqual([]);
    });
  }
});
