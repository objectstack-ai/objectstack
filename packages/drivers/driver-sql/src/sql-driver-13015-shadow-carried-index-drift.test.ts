// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13015 — a healthy #11627 hash-shadow UNIQUE is not drift, and the remedy the
 * differ used to propose would have DROPPED the constraint it was reconciling.
 *
 * ## The defect
 *
 * `diffManagedIndexes` compared the declared key against the columns the index
 * physically KEYS. A shadow-carried UNIQUE keys exactly one driver-owned
 * VARBINARY(32) generated column, so that comparison could never match: a clean
 * `initObjects` reported the index the same boot had just created as
 * `index_mismatch` / `destructive` / `recreate_index`.
 *
 * ## Why the remedy was worse than the defect
 *
 * `recreate_index` drops the UNIQUE by name and re-runs the sync. The sync
 * retakes the shadow route — and the shadow `ALTER TABLE ... ADD COLUMN` then
 * failed on the SURVIVING generated column (dropping an index does not drop the
 * column it keys). That failure is matched by neither the "already exists"
 * absorb (which spells INDEX names) nor the unique-violation branch, so the
 * apply ended with the constraint dropped and not re-created. An operator
 * following `os migrate apply --allow-destructive`, as the finding's own
 * message instructed, removed a live uniqueness guarantee.
 *
 * ## What is pinned here
 *
 * Half the vocabulary was already taught: the ORPHAN-column pass guards the
 * shadow via `isHashShadowColumn` while the index it carries was proposed for
 * destructive rebuild. The fix makes both passes read one vocabulary — so the
 * pins below are as much about the differ NOT going quiet as about it going
 * quiet in the right place. Every "no finding" assertion carries a COLOCATED
 * positive control in the same `diffManagedIndexes` call: a genuinely drifted
 * index that must still be reported. A fix that simply skipped every shadow
 * would pass the first half and fail the stale-shadow pins.
 *
 * The live-MySQL cell reads the PHYSICAL catalog (`information_schema`) rather
 * than the differ's own report about itself, and runs opt-in:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver, diffManagedIndexes } from '../src/index.js';
// The shadow vocabulary stays INTERNAL to this package — nothing outside it
// consumes a hash shadow, so #13015 deliberately did not widen the published
// surface. Imported from the module, exactly as the #11627/#12998 suites do.
import {
  enforcedIndexKey,
  hashShadowColumnFor,
  isHashShadowCarrier,
  isHashShadowColumn,
  parseHashShadowKeyParts,
  type ExpectedIndex,
  type PhysicalIndex,
} from './schema-drift.js';
import { MYSQL_CELL, declareDialectCell } from './live-dialect-matrix.testkit.js';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures — the shapes `introspectIndexes` produces on MySQL
// ─────────────────────────────────────────────────────────────────────────

const TABLE = 'os13015_probe';
/** The org-scoped declared unique whose key MySQL cannot express directly. */
const DECLARED_NAME = 'uniq_os13015_probe_organization_id_v';
const SHADOW = hashShadowColumnFor(DECLARED_NAME);

const declaredOrgUnique: ExpectedIndex = {
  name: DECLARED_NAME,
  columns: ['organization_id', 'v'],
  unique: true,
  nullSafeColumns: ['organization_id'],
};

/**
 * A shadow-carried index as the catalog reports it: ONE plain generated column
 * as the whole key. `expressions` is empty — the shadow is a real column, not
 * an EXPRESSION key part, which is precisely why `isRuntimeManagedIndex` never
 * covered this case.
 */
const carrier = (shadowKey?: PhysicalIndex['shadowKey']): PhysicalIndex => ({
  name: DECLARED_NAME,
  columns: [SHADOW],
  unique: true,
  ...(shadowKey ? { shadowKey } : {}),
});

/** What a HEALTHY (post-#12998) shadow hashes: the declared NULL-safe key. */
const healthyKey = [
  { column: 'organization_id', nullSafe: true },
  { column: 'v', nullSafe: false },
];

/** What a PRE-#12998 shadow hashes: the same columns, RAW. */
const staleKey = [
  { column: 'organization_id', nullSafe: false },
  { column: 'v', nullSafe: false },
];

/**
 * The colocated POSITIVE CONTROL, present in every call below: an ordinary
 * declared unique that really has drifted (declared NULL-safe, physically
 * bare). It must keep producing a finding, so an empty result for the shadow
 * can never be read as "the differ stopped reporting".
 *
 * Deliberately shares no key column and no name fragment with the shadow
 * fixtures — the control must not be a substring of the term under test.
 */
const CONTROL_NAME = 'uniq_os13015_probe_organization_id_ctl';
const declaredControl: ExpectedIndex = {
  name: CONTROL_NAME,
  columns: ['organization_id', 'ctl'],
  unique: true,
  nullSafeColumns: ['organization_id'],
};
const physicalControl: PhysicalIndex = {
  name: CONTROL_NAME,
  columns: ['organization_id', 'ctl'],
  unique: true,
};

const diff = (expected: ExpectedIndex[], physical: PhysicalIndex[]) =>
  diffManagedIndexes({
    table: TABLE,
    expected,
    legacy: [],
    physical,
    tenantField: 'organization_id',
  });

describe('shadow-carried UNIQUE is not index drift (#13015)', () => {
  it('derives the shadow column from the index name, and recognises the carrier', () => {
    expect(SHADOW).toBe(`${DECLARED_NAME}__hash`);
    expect(isHashShadowColumn(SHADOW)).toBe(true);
    expect(isHashShadowCarrier(carrier())).toBe(true);
    // Not a carrier: an ordinary index, and a shadow-named column keyed by an
    // index it does NOT belong to (the name binds shadow to index, #11627).
    expect(isHashShadowCarrier(physicalControl)).toBe(false);
    expect(isHashShadowCarrier({ name: 'uniq_other', columns: [SHADOW], unique: true })).toBe(false);
  });

  it('reports NO drift for a healthy shadow-carried unique, while still reporting real drift', () => {
    const entries = diff([declaredOrgUnique, declaredControl], [carrier(healthyKey), physicalControl]);
    // The positive control fired — the differ is awake.
    expect(entries.map((e) => e.op.type)).toEqual(['recreate_index']);
    expect((entries[0]!.op as any).indexName).toBe(CONTROL_NAME);
    // …and said nothing at all about the shadow-carried one.
    expect(entries.filter((e) => (e.op as any).indexName === DECLARED_NAME)).toEqual([]);
  });

  it('reports no drift for an UNRESOLVED carrier rather than proposing a destructive drop', () => {
    // The catalog read that resolves the generation expression can fail. The
    // carrier is still recognisable by name, so the differ must decline to
    // reason about it — never propose dropping a constraint on a guess.
    const entries = diff([declaredOrgUnique, declaredControl], [carrier(), physicalControl]);
    expect(entries.map((e) => (e.op as any).indexName)).toEqual([CONTROL_NAME]);
  });

  it('STILL reports a pre-#12998 shadow that hashes the RAW columns', () => {
    // The case a blind skip would have made permanently invisible: same
    // columns, no COALESCE, so every NULL-organization row is unconstrained
    // (#5030's shape) while the boot log calls the constraint carried.
    const entries = diff([declaredOrgUnique], [carrier(staleKey)]);
    expect(entries.length).toBe(1);
    const [entry] = entries;
    expect(entry!.op.type).toBe('recreate_index');
    // Recognised as the ADR-0120 D4 pure tightening, so the duplicate
    // pre-flight runs before anything is dropped.
    expect((entry!.op as any).tightenNullSafeOnly).toBe(true);
    // The report names the key the index ENFORCES, not the digest column it
    // stores — the old message read `UNIQUE (uniq_..._v__hash)`, which told an
    // operator nothing about the constraint at risk.
    expect(entry!.actual).toBe('UNIQUE (organization_id, v)');
    expect(entry!.actual).not.toContain('__hash');
    expect(entry!.expected).toBe("UNIQUE (COALESCE(organization_id, '__global__'), v)");
  });

  it('describes an ORPHANED carrier by the key it enforced, not by its digest column', () => {
    // Declaration gone: `drop_index` is still the right remedy, but the report
    // must be readable.
    const entries = diff([], [carrier(healthyKey)]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.op.type).toBe('drop_index');
    expect(entries[0]!.actual).toBe("UNIQUE (COALESCE(organization_id, '__global__'), v)");
    expect(entries[0]!.message).not.toContain('__hash');
  });

  it('resolves the enforced key from the stored generation expression', () => {
    // The spellings MySQL 8 stores, verbatim: single column, plain composite,
    // and the NULL-safe composite #12998 introduced.
    expect(parseHashShadowKeyParts('unhex(sha2(`v`,256))')).toEqual([
      { column: 'v', nullSafe: false },
    ]);
    expect(parseHashShadowKeyParts('unhex(sha2(concat(`a`,0x1f,`b`),256))')).toEqual([
      { column: 'a', nullSafe: false },
      { column: 'b', nullSafe: false },
    ]);
    expect(
      parseHashShadowKeyParts(
        "unhex(sha2(concat(coalesce(`organization_id`,_utf8mb4'__global__'),0x1f,`v`),256))",
      ),
    ).toEqual(healthyKey);
    // An unreadable expression resolves to nothing — which is what keeps the
    // carrier in the "declines to reason about it" branch above.
    expect(parseHashShadowKeyParts('')).toEqual([]);
    expect(enforcedIndexKey(carrier())).toEqual({ columns: [SHADOW], nullSafeColumns: undefined });
    expect(enforcedIndexKey(carrier(healthyKey))).toEqual({
      columns: ['organization_id', 'v'],
      nullSafeColumns: ['organization_id'],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Live MySQL: the PHYSICAL catalog, before and after the remedy runs
// ─────────────────────────────────────────────────────────────────────────

/**
 * An org-scoped unique over a field too long for a MySQL key part, so the sync
 * is forced down the #11627 shadow route — the same route the live platform
 * members take.
 */
const orgUniqueOn = (name: string) => ({
  name,
  fields: {
    organization_id: { type: 'string' },
    v: { type: 'text', maxLength: 1024 },
  },
  indexes: [{ fields: ['v'], unique: 'organization' as const, name: `uniq_${name}_org_v` }],
});

declareDialectCell(MYSQL_CELL, 'shadow-carried index drift (#13015)', (cell) => {
  describe('shadow-carried UNIQUE against the live MySQL catalog (#13015)', () => {
    let driver: SqlDriver;
    afterEach(async () => {
      await driver?.disconnect().catch(() => {});
    });

    /** Physical truth, read from the catalog — never from the DDL we emitted. */
    const catalog = async (table: string) => {
      const knex = (driver as any).knex;
      const cols = await knex
        .select('COLUMN_NAME', 'GENERATION_EXPRESSION')
        .from('information_schema.COLUMNS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      const idx = await knex
        .select('INDEX_NAME', 'NON_UNIQUE', 'COLUMN_NAME')
        .from('information_schema.STATISTICS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      return { cols, idx };
    };

    /**
     * Is the declared UNIQUE physically present and carried by its shadow?
     * Read as a positive claim from `STATISTICS`, so "no drift" can never be
     * satisfied by an index that simply is not there.
     */
    const carriedUniquePresent = async (table: string, indexName: string) => {
      const { idx } = await catalog(table);
      const parts = idx.filter((i: any) => i.INDEX_NAME === indexName);
      return (
        parts.length === 1 &&
        Number(parts[0].NON_UNIQUE) === 0 &&
        parts[0].COLUMN_NAME === hashShadowColumnFor(indexName)
      );
    };

    it('a freshly synced shadow-carried unique reports no destructive index drift', async () => {
      driver = new SqlDriver(cell.config());
      const obj = orgUniqueOn('os13015_fresh');
      await driver.initObjects([obj]);

      // POSITIVE CONTROL first: the constraint really exists, carried by the
      // shadow. Without this, an empty drift list proves nothing.
      expect(await carriedUniquePresent('os13015_fresh', 'uniq_os13015_fresh_org_v')).toBe(true);

      const drift = await driver.detectManagedDrift([obj]);
      const onIndex = drift.filter((d) => d.kind === 'index_mismatch' || d.kind === 'unmapped_index');
      expect(onIndex).toEqual([]);
      // And the shadow COLUMN is still protected from the orphan-column pass —
      // the half of the vocabulary that was already taught.
      expect(drift.filter((d) => d.kind === 'unmapped_column')).toEqual([]);
    });

    /**
     * The remedy pin. Even on a second boot — the runtime ledger empty again,
     * which is the state the card measured — applying every entry the differ
     * produces WITH `--allow-destructive` must leave the constraint standing.
     * Before the fix this ran `recreate_index`: it dropped the UNIQUE, the
     * re-sync failed on the surviving generated column, and the catalog read
     * below found nothing.
     */
    it('survives "os migrate apply --allow-destructive" over every reported entry', async () => {
      driver = new SqlDriver(cell.config());
      const obj = orgUniqueOn('os13015_apply');
      await driver.initObjects([obj]);
      await driver.disconnect();

      // A SECOND driver: `runtimeCreatedIndexes` starts empty, so the ledger
      // escape hatch cannot mask the differ's verdict.
      driver = new SqlDriver(cell.config());
      await driver.initObjects([obj]);
      const drift = await driver.detectManagedDrift([obj]);
      await driver.applyMigrationEntries(drift, { allowDestructive: true });

      expect(await carriedUniquePresent('os13015_apply', 'uniq_os13015_apply_org_v')).toBe(true);
      // …and it still ENFORCES: two NULL-organization rows with one payload.
      const knex = (driver as any).knex;
      const V = 'q'.repeat(900);
      await knex('os13015_apply').insert({ id: 'a', v: V, organization_id: null });
      await expect(
        knex('os13015_apply').insert({ id: 'b', v: V, organization_id: null }),
      ).rejects.toThrow(/duplicate/i);
    });

    /**
     * The surviving generated column, isolated: drop the index by name (exactly
     * what `recreate_index` does) and re-sync. The shadow column is still
     * there, and the re-sync must RE-KEY it rather than fail on a duplicate
     * column name.
     */
    it('re-keys a surviving shadow column instead of failing the rebuild', async () => {
      driver = new SqlDriver(cell.config());
      const obj = orgUniqueOn('os13015_survive');
      await driver.initObjects([obj]);
      const knex = (driver as any).knex;
      const indexName = 'uniq_os13015_survive_org_v';

      await knex.raw(`ALTER TABLE \`os13015_survive\` DROP INDEX \`${indexName}\``);
      // The column OUTLIVES the index — the whole mechanism of the defect.
      const { cols } = await catalog('os13015_survive');
      expect(cols.filter((c: any) => isHashShadowColumn(c.COLUMN_NAME)).length).toBe(1);
      expect(await carriedUniquePresent('os13015_survive', indexName)).toBe(false);

      await driver.initObjects([obj]);
      expect(await carriedUniquePresent('os13015_survive', indexName)).toBe(true);
    });

    /**
     * The direction a blind skip would have lost: a shadow hashing the RAW
     * columns (what shipped before #12998) must still be reported AND must be
     * repairable — the stale column is re-generated, not reused.
     */
    it('reports and repairs a shadow that hashes the raw columns', async () => {
      driver = new SqlDriver(cell.config());
      const obj = orgUniqueOn('os13015_stale');
      await driver.initObjects([obj]);
      const knex = (driver as any).knex;
      const indexName = 'uniq_os13015_stale_org_v';
      const shadow = hashShadowColumnFor(indexName);

      // Reproduce the pre-#12998 physical state: raw CONCAT, no COALESCE.
      await knex.raw(`ALTER TABLE \`os13015_stale\` DROP INDEX \`${indexName}\``);
      await knex.raw(`ALTER TABLE \`os13015_stale\` DROP COLUMN \`${shadow}\``);
      await knex.raw(
        `ALTER TABLE \`os13015_stale\` ` +
          `ADD COLUMN \`${shadow}\` VARBINARY(32) GENERATED ALWAYS AS ` +
          `(UNHEX(SHA2(CONCAT(\`organization_id\`, 0x1f, \`v\`), 256))) STORED, ` +
          `ADD UNIQUE KEY \`${indexName}\` (\`${shadow}\`)`,
      );
      const before = await catalog('os13015_stale');
      const staleCol = before.cols.find((c: any) => c.COLUMN_NAME === shadow);
      expect(String(staleCol.GENERATION_EXPRESSION).toLowerCase()).not.toContain('coalesce');

      // The differ must SEE it — a blind skip would report nothing here.
      const drift = await driver.detectManagedDrift([obj]);
      const found = drift.find((d) => (d.op as any).indexName === indexName);
      expect(found, 'a raw-column shadow is real drift and must be reported').toBeTruthy();
      expect(found!.op.type).toBe('recreate_index');

      await driver.applyMigrationEntries(drift, { allowDestructive: true });

      // Repaired in the catalog: the constraint stands and now folds NULL.
      expect(await carriedUniquePresent('os13015_stale', indexName)).toBe(true);
      const after = await catalog('os13015_stale');
      const fixed = after.cols.find((c: any) => c.COLUMN_NAME === shadow);
      expect(String(fixed.GENERATION_EXPRESSION).toLowerCase()).toContain('coalesce');
    });
  });
});
