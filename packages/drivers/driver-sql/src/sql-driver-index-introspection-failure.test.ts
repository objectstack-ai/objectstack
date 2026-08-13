// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver, diffManagedIndexes, type PhysicalIndex } from '../src/index.js';

/**
 * A failed index read is not an empty index list (#7332).
 *
 * `introspectIndexes` used to wrap its whole dialect dispatch — SQLite,
 * Postgres and MySQL alike — in one bare `catch {}` and return `byName` in
 * whatever half-built state it had reached. The caller could not tell "this
 * table genuinely has no such index" from "the read failed and I am guessing",
 * so a transient SQLITE_BUSY / WAL hiccup was laundered into a confident,
 * specific, FALSE report that the database is missing declared indexes.
 *
 * The swallow's own justification — *"let creation handle conflicts"* — is
 * sound where it was written, {@link SqlDriver.getExistingIndexNames}: a
 * wrong-but-optimistic reading there costs one redundant `CREATE INDEX`, which
 * `syncDeclaredIndexes` absorbs as "already exists". Drift DETECTION has no
 * such backstop, and it inherited the swallow only because it was wired onto
 * the same function later (#3728). So the split is by call site, not by
 * removal: the creation seam opts into `{ onFailure: 'partial' }`, everything
 * else — detection included — sees the error.
 *
 * Note the asymmetry this closes: the sibling read in the very same detect
 * path, `introspectColumns`, has never swallowed. `reconcileAndWarnDrift`
 * already carries the handler for a throwing `detectTableDrift`
 * ("could not introspect '<table>' for drift detection"), and both CLI
 * consumers already `catch → printError → exit(1)`. The index dimension was
 * the one that could not reach any of them.
 */
describe('index introspection failure is not "no indexes" (#7332)', () => {
  let knexInstance: any;

  const makeDriver = (opts: any = {}) => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    return d;
  };

  afterEach(async () => {
    await knexInstance?.destroy();
    knexInstance = undefined;
  });

  const productMeta = [
    {
      name: 'product',
      fields: {
        id: { type: 'string' },
        organization_id: { type: 'string' },
        code: { type: 'string' },
      },
      indexes: [{ name: 'idx_product_code', fields: ['code'] }],
    },
  ];

  /**
   * Fail the index read the way a busy database does — mid-dispatch, on one
   * statement — rather than by stubbing the method under test. `PRAGMA
   * index_list` is the SQLite branch's second round-trip; `introspectColumns`
   * goes through `knex(table).columnInfo()` and is deliberately untouched, so
   * the column dimension still reads clean and only the index dimension breaks.
   */
  const breakIndexRead = (driver: SqlDriver, message = 'SQLITE_BUSY: database is locked') => {
    const knex: any = (driver as any).knex;
    const real = knex.raw.bind(knex);
    // knex defines `raw` as non-writable (but configurable), so a plain
    // assignment throws — the swap has to go through `defineProperty`.
    const swap = (fn: any) => Object.defineProperty(knex, 'raw', { value: fn, configurable: true });
    swap((sql: any, ...rest: any[]) => {
      if (typeof sql === 'string' && /PRAGMA\s+index_list/i.test(sql)) throw new Error(message);
      return real(sql, ...rest);
    });
    return () => swap(real);
  };

  // ── Detection sees the failure ────────────────────────────────────────────

  it('detectManagedDrift propagates the read failure instead of reporting "(absent)"', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);
    const restore = breakIndexRead(driver);
    try {
      await expect(driver.detectManagedDrift(productMeta as any)).rejects.toThrow(/SQLITE_BUSY/);
    } finally {
      restore();
    }
  });

  it('does not invent a create_index remedy for an index that is actually there', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);

    // Ground truth first: the index the read is about to miss really exists.
    const physical: PhysicalIndex[] = await (driver as any).introspectIndexes('product');
    expect(physical.map((p) => p.name)).toContain('idx_product_code');

    const restore = breakIndexRead(driver);
    try {
      const drift = await driver.detectManagedDrift(productMeta as any).catch((e) => e);
      expect(drift).toBeInstanceOf(Error);
    } finally {
      restore();
    }
  });

  it('the boot path reports the failure as a failure, not as drift', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);
    (driver as any).logger.warn.mockClear();

    const restore = breakIndexRead(driver);
    try {
      await (driver as any).reconcileAndWarnDrift('product', productMeta[0].fields, productMeta[0].indexes);
    } finally {
      restore();
    }

    const warnings = (driver as any).logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(warnings.some((w: string) => /could not introspect 'product' for drift detection/.test(w))).toBe(true);
    // The false report the swallow used to produce, verbatim from the differ.
    expect(warnings.some((w: string) => /has no such index/.test(w))).toBe(false);
  });

  it('introspectIndexes throws by default — the honest contract for a read', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);
    const restore = breakIndexRead(driver);
    try {
      await expect((driver as any).introspectIndexes('product')).rejects.toThrow(/SQLITE_BUSY/);
    } finally {
      restore();
    }
  });

  // ── Creation keeps the swallow, because it keeps the backstop ─────────────

  it('getExistingIndexNames still degrades to a partial read rather than throwing', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);
    const restore = breakIndexRead(driver);
    try {
      await expect((driver as any).getExistingIndexNames('product')).resolves.toBeInstanceOf(Set);
    } finally {
      restore();
    }
  });

  it('a boot whose index read fails throughout still creates the declared index', async () => {
    // The whole justification for keeping the swallow on the creation path: an
    // optimistic wrong reading is corrected by the database rejecting the
    // duplicate, so the boot completes and the schema converges anyway.
    const driver = makeDriver();
    const restore = breakIndexRead(driver);
    try {
      await driver.initObjects(productMeta);
    } finally {
      restore();
    }

    const physical: PhysicalIndex[] = await (driver as any).introspectIndexes('product');
    expect(physical.map((p) => p.name)).toContain('idx_product_code');
  });

  it('an index read that fails on the SECOND boot does not take the boot down', async () => {
    const driver = makeDriver();
    await driver.initObjects(productMeta);
    const restore = breakIndexRead(driver);
    try {
      // Everything already exists; the read that would prove it is broken.
      await expect(driver.initObjects(productMeta)).resolves.not.toThrow();
    } finally {
      restore();
    }
  });

  // ── A truncated read can never ARM a destructive remedy ───────────────────

  it('losing physical indexes only ever removes drop remedies, never adds one', () => {
    // The differ's three sections all key off PRESENCE in the physical list:
    // `replace_unique_index` needs the legacy index present, `drop_index` needs
    // the orphan present, `recreate_index` needs the declared name present.
    // Dropping entries is therefore monotone — this pins that direction, which
    // is why a false read is loud-and-wrong rather than destructive.
    const full: PhysicalIndex[] = [
      { name: 'product_code_unique', columns: ['code'], unique: true, primary: false },
      { name: 'idx_product_stale', columns: ['legacy_col'], unique: false, primary: false },
    ];
    const args = {
      table: 'product',
      expected: [{ name: 'idx_product_code', columns: ['code'], unique: false }],
      legacy: [
        {
          column: 'code',
          legacyColumns: ['code'],
          legacyNames: ['product_code_unique'],
          replacement: { name: 'uniq_product_organization_id_code', columns: ['organization_id', 'code'], unique: true as const },
        },
      ],
      tenantField: 'organization_id',
    };

    const complete = diffManagedIndexes({ ...args, physical: full } as any);
    expect(complete.some((d) => d.op.type === 'replace_unique_index')).toBe(true);
    expect(complete.some((d) => d.op.type === 'drop_index')).toBe(true);

    const truncated = diffManagedIndexes({ ...args, physical: [] } as any);
    expect(truncated.some((d) => d.category === 'destructive')).toBe(false);
    expect(truncated.map((d) => d.op.type)).toEqual(['create_index']);
  });
});
