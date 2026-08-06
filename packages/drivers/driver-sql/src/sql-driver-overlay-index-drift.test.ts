// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SqlDriver,
  applyIndexKeyParts,
  classifyIndexKeyPart,
  diffManagedIndexes,
  isRuntimeManagedIndex,
  isSyncReproducibleIndex,
  parseIndexDdl,
  type PhysicalIndex,
} from '../src/index.js';

/**
 * A fresh database must not boot "drifted" (#4884).
 *
 * `examples/app-showcase` on a brand-new empty SQLite file printed two
 * `[schema-drift]` warnings before the server was ready, both about the ADR-0048
 * overlay indexes the framework itself had created seconds earlier:
 *
 *   1. `idx_sys_metadata_overlay_active` — the detector read the physical index
 *      as `(type, name, organization_id)` because `PRAGMA index_info` reports a
 *      NULL column for the `COALESCE(package_id,'')` key part, and the old
 *      introspection dropped NULL parts. It then reported a mismatch against the
 *      four-column declaration. The fourth column was there all along.
 *   2. `idx_sys_metadata_overlay_draft` — the partial UNIQUE index enforcing
 *      draft-overlay uniqueness, which no object declares, was classified as an
 *      orphan and the operator was told to run
 *      `os migrate apply --allow-destructive` to DROP it: our own boot advising
 *      the destruction of a live data-integrity guarantee, on a healthy database.
 *
 * The invariants pinned here: a database this build just created reports zero
 * drift, and no `--allow-destructive` remedy is ever printed for an index the
 * framework created rather than the additive sync.
 */
describe('overlay index drift on a fresh database (#4884)', () => {
  let knexInstance: any;
  const tempDirs: string[] = [];

  const makeDriver = (connection: any = { filename: ':memory:' }) => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection,
      useNullAsDefault: true,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn() };
    return d;
  };

  afterEach(async () => {
    await knexInstance?.destroy();
    knexInstance = undefined;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const tempDbFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'os-4884-'));
    tempDirs.push(dir);
    return join(dir, 'fresh.db');
  };

  /**
   * The `sys_metadata` shape that matters here, verbatim from
   * `packages/metadata-core/src/objects/sys-metadata.object.ts` — including the
   * comment's claim that the four-column declaration is "the fallback shape for
   * drivers without the runtime migration", which is precisely why the detector
   * must not try to rebuild the runtime's index from it.
   */
  const sysMetadataObjects = () => [
    {
      name: 'sys_metadata',
      fields: {
        type: { type: 'string' },
        name: { type: 'string' },
        organization_id: { type: 'string' },
        package_id: { type: 'string' },
        state: { type: 'string' },
      },
      indexes: [
        // Mirrors `metadata-core`'s sys-metadata.object.ts. It carried
        // `partial: "state = 'active'"` until #5248 / #4943 retired the key;
        // the declaration never produced a predicate (knex's `table.unique()`
        // cannot express one), so dropping it here changes nothing this file
        // measures — it keeps the fixture honest about what a real boot
        // declares. The partial UNIQUE the drift cases below care about is the
        // one `runEnsureOverlayIndex` issues in raw SQL.
        {
          name: 'idx_sys_metadata_overlay_active',
          fields: ['type', 'name', 'organization_id', 'package_id'],
          unique: true,
        },
        { name: 'idx_sys_metadata_org_type', fields: ['organization_id', 'type'] },
        { fields: ['state'] },
      ],
    } as any,
  ];

  /**
   * Exactly what `metadata-protocol`'s `ensureOverlayIndex` issues (protocol.ts
   * ~L2165-2215) — through `execute()`, the same seam it uses, so the runtime
   * ledger sees what a real boot would.
   */
  const runEnsureOverlayIndex = async (driver: SqlDriver): Promise<void> => {
    await driver.execute('DROP INDEX IF EXISTS idx_sys_metadata_overlay_active');
    await driver.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active ' +
        "ON sys_metadata (type, name, organization_id, COALESCE(package_id, '')) " +
        "WHERE state = 'active'",
    );
    await driver.execute('DROP INDEX IF EXISTS idx_sys_metadata_overlay_draft');
    await driver.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_draft ' +
        "ON sys_metadata (type, name, organization_id, COALESCE(package_id, '')) " +
        "WHERE state = 'draft'",
    );
  };

  // ── The issue itself ──────────────────────────────────────────────────────

  it('a fresh DB created by this build reports ZERO drift for the two overlay indexes', async () => {
    const driver = makeDriver();
    const objects = sysMetadataObjects();
    await driver.initObjects(objects);
    await runEnsureOverlayIndex(driver);

    const drift = await driver.detectManagedDrift(objects);
    expect(drift.map((d) => d.message)).toEqual([]);
  });

  it('never points --allow-destructive at an index the framework created', async () => {
    const driver = makeDriver();
    const objects = sysMetadataObjects();
    await driver.initObjects(objects);
    await runEnsureOverlayIndex(driver);

    const drift = await driver.detectManagedDrift(objects);
    expect(drift.filter((d) => d.message.includes('--allow-destructive'))).toEqual([]);
    // Neither of the two remedies that would destroy the runtime's index.
    expect(
      drift.filter(
        (d) =>
          (d.op.type === 'drop_index' || d.op.type === 'recreate_index') &&
          (d.op as any).indexName?.startsWith('idx_sys_metadata_overlay_'),
      ),
    ).toEqual([]);
  });

  it('stays silent on the SECOND boot, when the runtime ledger starts empty again', async () => {
    // The `runtimeCreated` ledger is process-scoped by design, so the durable
    // half of the guarantee — the index's own definition — has to carry a
    // restart on its own. Same file, brand-new driver, nothing recorded.
    const filename = tempDbFile();
    const first = makeDriver({ filename });
    const objects = sysMetadataObjects();
    await first.initObjects(objects);
    await runEnsureOverlayIndex(first);
    await (first as any).knex.destroy();

    const second = makeDriver({ filename });
    expect((second as any).runtimeCreatedIndexes.size).toBe(0);
    await second.initObjects(objects);

    const drift = await second.detectManagedDrift(objects);
    expect(drift.map((d) => d.message)).toEqual([]);
  });

  it('boot-time drift handling logs no [schema-drift] warning for a fresh overlay DB', async () => {
    const driver = makeDriver();
    const objects = sysMetadataObjects();
    await driver.initObjects(objects);
    await runEnsureOverlayIndex(driver);

    await (driver as any).reconcileAndWarnDrift(
      'sys_metadata',
      objects[0].fields,
      objects[0].indexes,
    );
    expect((driver as any).logger.warn).not.toHaveBeenCalled();
  });

  // ── Introspection reads the key as WRITTEN ────────────────────────────────

  it('reads the COALESCE key part as the column it pins, and flags the index partial', async () => {
    const driver = makeDriver();
    await driver.initObjects(sysMetadataObjects());
    await runEnsureOverlayIndex(driver);

    const physical: PhysicalIndex[] = await (driver as any).introspectIndexes('sys_metadata');
    const active = physical.find((p) => p.name === 'idx_sys_metadata_overlay_active')!;
    expect(active.columns).toEqual(['type', 'name', 'organization_id', 'package_id']);
    expect(active.unique).toBe(true);
    expect(active.partial).toBe(true);
    expect(active.expressions).toEqual(["COALESCE(package_id, '')"]);
    expect(isSyncReproducibleIndex(active)).toBe(false);

    const draft = physical.find((p) => p.name === 'idx_sys_metadata_overlay_draft')!;
    expect(draft.columns).toEqual(['type', 'name', 'organization_id', 'package_id']);
    expect(draft.partial).toBe(true);

    // A plain declared index is unaffected — same columns, no expressions.
    const orgType = physical.find((p) => p.name === 'idx_sys_metadata_org_type')!;
    expect(orgType.columns).toEqual(['organization_id', 'type']);
    expect(orgType.partial).toBeFalsy();
    expect(isSyncReproducibleIndex(orgType)).toBe(true);
  });

  // ── The runtime ledger is a record of fact ────────────────────────────────

  it('records index DDL it executed, and forgets it again on DROP', async () => {
    const driver = makeDriver();
    await driver.initObjects(sysMetadataObjects());
    await runEnsureOverlayIndex(driver);

    const ledger = (driver as any).runtimeCreatedIndexes.get('sys_metadata') as Set<string>;
    expect([...ledger].sort()).toEqual([
      'idx_sys_metadata_overlay_active',
      'idx_sys_metadata_overlay_draft',
    ]);

    await driver.execute('DROP INDEX idx_sys_metadata_overlay_draft');
    expect(ledger.has('idx_sys_metadata_overlay_draft')).toBe(false);
  });

  it('reads the table out of quoted and schema-qualified index DDL', async () => {
    const driver = makeDriver();
    const note = (sql: string) => (driver as any).noteRuntimeIndexDdl(sql);
    const ledger = (driver as any).runtimeCreatedIndexes as Map<string, Set<string>>;

    note('CREATE UNIQUE INDEX CONCURRENTLY "idx_a" ON "public"."sys_metadata" (a)');
    note('CREATE INDEX IF NOT EXISTS `idx_b` ON `sys_metadata` (b)');
    expect([...(ledger.get('sys_metadata') ?? [])].sort()).toEqual(['idx_a', 'idx_b']);

    note('DROP INDEX IF EXISTS "public"."idx_a"');
    expect([...(ledger.get('sys_metadata') ?? [])]).toEqual(['idx_b']);
  });

  it('honours the ledger even for an index the sync could otherwise reproduce', async () => {
    // The MySQL shape of the same migration: `ensureOverlayIndex` falls back to a
    // plain, non-partial index when the dialect rejects the WHERE clause, so the
    // definition alone cannot exonerate it — only the ledger can.
    const plain: PhysicalIndex = {
      name: 'idx_sys_metadata_overlay_draft',
      columns: ['type', 'name', 'organization_id', 'package_id'],
      unique: false,
    };
    expect(isSyncReproducibleIndex(plain)).toBe(true);
    expect(isRuntimeManagedIndex(plain)).toBe(false);
    expect(isRuntimeManagedIndex(plain, new Set(['idx_sys_metadata_overlay_draft']))).toBe(true);

    const entries = diffManagedIndexes({
      table: 'sys_metadata',
      expected: [],
      legacy: [],
      physical: [plain],
      runtimeCreated: new Set(['idx_sys_metadata_overlay_draft']),
    });
    expect(entries).toEqual([]);
  });

  // ── …without going soft on real orphans ───────────────────────────────────

  it('still flags a genuinely orphaned generated index as destructive', async () => {
    const driver = makeDriver();
    await driver.initObjects([
      { name: 'domain', fields: { host: { type: 'string' } }, indexes: [{ fields: ['host'] }] } as any,
    ]);
    expect(await (driver as any).getExistingIndexNames('domain')).toContain('idx_domain_host');

    // Declaration gone, index still there — nothing runtime-managed about it.
    const drift = await driver.detectManagedDrift([{ name: 'domain', fields: { host: { type: 'string' } } }]);
    const entry = drift.find((d) => d.op.type === 'drop_index');
    expect(entry?.category).toBe('destructive');
    expect(entry?.message).toContain('--allow-destructive');
  });

  it('still flags a redefined declared index whose physical form is plain', async () => {
    const driver = makeDriver();
    await driver.initObjects([
      { name: 'domain', fields: { host: { type: 'string' }, tld: { type: 'string' } } } as any,
    ]);
    await knexInstance.raw('CREATE INDEX idx_domain_host ON domain (tld)');

    const drift = await driver.detectManagedDrift([
      {
        name: 'domain',
        fields: { host: { type: 'string' }, tld: { type: 'string' } },
        indexes: [{ name: 'idx_domain_host', fields: ['host'] }],
      },
    ]);
    expect(drift.find((d) => d.op.type === 'recreate_index')).toBeDefined();
  });

  // ── Pure units ────────────────────────────────────────────────────────────

  describe('classifyIndexKeyPart', () => {
    it('reads a bare or quoted column as that column', () => {
      expect(classifyIndexKeyPart('package_id')).toEqual({ kind: 'column', column: 'package_id' });
      expect(classifyIndexKeyPart('"package_id"')).toEqual({ kind: 'column', column: 'package_id' });
      expect(classifyIndexKeyPart('`package_id`')).toEqual({ kind: 'column', column: 'package_id' });
      expect(classifyIndexKeyPart('host DESC NULLS LAST')).toEqual({ kind: 'column', column: 'host' });
    });

    it('attributes COALESCE(col, <literal>) to col — the ADR-0048 canonical form', () => {
      for (const sql of [
        "COALESCE(package_id, '')",
        "coalesce(package_id,'')",
        "COALESCE((package_id)::text, ''::text)", // pg_get_indexdef on a varchar
        "COALESCE(\"package_id\", '', 'x')",
      ]) {
        expect(classifyIndexKeyPart(sql)).toEqual({ kind: 'expression', sql, column: 'package_id' });
      }
    });

    it('refuses to attribute anything it cannot pin to one column', () => {
      for (const sql of ['lower(name)', 'COALESCE(a, b)', 'a || b', "COALESCE(name)"]) {
        expect(classifyIndexKeyPart(sql)).toEqual({ kind: 'expression', sql, column: null });
      }
    });
  });

  describe('parseIndexDdl', () => {
    it('splits the key list at top level only and detects the predicate', () => {
      expect(
        parseIndexDdl(
          'CREATE UNIQUE INDEX IF NOT EXISTS i ON sys_metadata ' +
            "(type, name, organization_id, COALESCE(package_id, '')) WHERE state = 'active'",
        ),
      ).toEqual({
        keyParts: ['type', 'name', 'organization_id', "COALESCE(package_id, '')"],
        partial: true,
      });
    });

    it('parses pg_get_indexdef output', () => {
      expect(
        parseIndexDdl(
          'CREATE UNIQUE INDEX idx_x ON public.sys_metadata USING btree ' +
            "(type, COALESCE(package_id, ''::text)) WHERE (state = 'active'::text)",
        ),
      ).toEqual({ keyParts: ['type', "COALESCE(package_id, ''::text)"], partial: true });
    });

    it('is quote-aware and reports a non-partial index as such', () => {
      expect(parseIndexDdl("CREATE INDEX i ON t (a, COALESCE(b, ','))")).toEqual({
        keyParts: ['a', "COALESCE(b, ',')"],
        partial: false,
      });
      expect(parseIndexDdl('')).toBeNull();
      expect(parseIndexDdl('CREATE INDEX i ON t')).toBeNull();
    });
  });

  it('applyIndexKeyParts keeps key order and records expressions verbatim', () => {
    const index: PhysicalIndex = { name: 'i', columns: [], unique: true };
    applyIndexKeyParts(index, ['type', "COALESCE(package_id, '')", 'lower(name)']);
    expect(index.columns).toEqual(['type', 'package_id']);
    expect(index.expressions).toEqual(["COALESCE(package_id, '')", 'lower(name)']);
    expect(isSyncReproducibleIndex(index)).toBe(false);
  });

  // ── ADR-0120 D3: the NULL-safe organization key part in the drift reader ──

  describe('NULL-safe organization key part attribution (ADR-0120 D3)', () => {
    it("attributes COALESCE(organization_id, '__global__') to organization_id in every dialect spelling", () => {
      for (const sql of [
        // SQLite: `sqlite_master.sql`, as the sync wrote it.
        "COALESCE(organization_id, '__global__')",
        'COALESCE("organization_id", \'__global__\')',
        // Postgres: `pg_get_indexdef` casts a varchar key part.
        "COALESCE((organization_id)::text, '__global__'::text)",
        // MySQL: `information_schema.STATISTICS.EXPRESSION` decorates the
        // literal with a charset introducer and backslash-escaped quotes.
        "coalesce(`organization_id`,_utf8mb4\\'__global__\\')",
      ]) {
        expect(classifyIndexKeyPart(sql)).toEqual({
          kind: 'expression',
          sql,
          column: 'organization_id',
        });
      }
    });

    it('applyIndexKeyParts records the attributed key part as a NULL-safe column', () => {
      const index: PhysicalIndex = { name: 'i', columns: [], unique: true };
      applyIndexKeyParts(index, ["COALESCE(organization_id, '__global__')", 'email']);
      expect(index.columns).toEqual(['organization_id', 'email']);
      expect(index.nullSafeColumns).toEqual(['organization_id']);
    });

    it("isSyncReproducibleIndex: the org key part is the sync's OWN vocabulary — for the tenant column only", () => {
      const org: PhysicalIndex = { name: 'i', columns: [], unique: true };
      applyIndexKeyParts(org, ["COALESCE(organization_id, '__global__')", 'email']);
      expect(isSyncReproducibleIndex(org, 'organization_id')).toBe(true);
      expect(isSyncReproducibleIndex(org, null)).toBe(false);
      expect(isSyncReproducibleIndex(org)).toBe(false);
      // The ADR-0048 overlay key attributes to a NON-tenant column and stays
      // out — loosening the column scoping to "any attributable COALESCE"
      // would resurrect the #4884 false orphan on the overlay indexes.
      const overlay: PhysicalIndex = { name: 'o', columns: [], unique: true };
      applyIndexKeyParts(overlay, ['type', "COALESCE(package_id, '')"]);
      expect(isSyncReproducibleIndex(overlay, 'organization_id')).toBe(false);
    });

    it('the differ compares key-part FORM literal-agnostically: COALESCE ≡ COALESCE, bare ≠ COALESCE', () => {
      const expected = [
        {
          name: 'uniq_t_organization_id_email',
          columns: ['organization_id', 'email'],
          unique: true,
          nullSafeColumns: ['organization_id'],
        },
      ];
      // Physical carries the COALESCE form with a DIFFERENT literal: any
      // literal folds NULL into one bucket, so it is the same constraint —
      // zero drift (the #4884 lesson applied to the tenant key part).
      const physSame: PhysicalIndex = { name: 'uniq_t_organization_id_email', columns: [], unique: true };
      applyIndexKeyParts(physSame, ["COALESCE(organization_id, '')", 'email']);
      expect(
        diffManagedIndexes({
          table: 't',
          expected,
          legacy: [],
          physical: [physSame],
          tenantField: 'organization_id',
        }),
      ).toEqual([]);
      // Physical is the bare NULL-distinct composite: a DIFFERENT constraint
      // (void on NULL-organization rows, #5030) → the D4 tightening op.
      const physBare: PhysicalIndex = {
        name: 'uniq_t_organization_id_email',
        columns: ['organization_id', 'email'],
        unique: true,
      };
      const out = diffManagedIndexes({
        table: 't',
        expected,
        legacy: [],
        physical: [physBare],
        tenantField: 'organization_id',
      });
      expect(out).toHaveLength(1);
      expect(out[0].op).toMatchObject({ type: 'recreate_index', tightenNullSafeOnly: true });
      expect(out[0].expected).toBe("UNIQUE (COALESCE(organization_id, '__global__'), email)");
      expect(out[0].actual).toBe('UNIQUE (organization_id, email)');
    });
  });
});
