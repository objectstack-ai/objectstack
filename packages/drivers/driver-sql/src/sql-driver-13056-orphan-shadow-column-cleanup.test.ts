// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13056 — the #11627 hash shadow of a RETIRED index is collected, so the
 * cleanup `isHashShadowColumn` promises is a path that exists.
 *
 * ## The defect
 *
 * `isHashShadowColumn`'s docblock is why the orphan-COLUMN pass skips a shadow,
 * and it stated what happens instead: the column "is then cleaned up by the
 * index's own removal path, not by a blind column drop". There was no such
 * path. `dropIndexIfExists` issues exactly one statement family — `ALTER TABLE
 * .. DROP CONSTRAINT`, `DROP INDEX IF EXISTS`, `ALTER TABLE .. DROP INDEX` —
 * and never touches a column. So when metadata stopped declaring a
 * shadow-carried UNIQUE, `diffManagedIndexes` reported the index as an orphan,
 * `os migrate apply --allow-destructive` dropped it, and the `VARBINARY(32)`
 * STORED generated column survived keyed by nothing — while the orphan-column
 * pass declined to report it forever, exactly as designed. A STORED generated
 * column is recomputed and written on every INSERT and on every UPDATE touching
 * its sources, so a table accumulating retired declarations pays for them
 * permanently, invisibly.
 *
 * ## Why the cleanup is on the OP and not in `dropIndexIfExists`
 *
 * The discriminator is not "which caller" but "is this index name coming
 * back", and only the op knows:
 *
 *  - `drop_index` — TERMINAL. The declaration is gone; nothing will re-create
 *    the name, so the shadow derived from it is dead. This is the leak.
 *  - `recreate_index` — drops in order to re-create under the SAME name. Its
 *    shadow is deliberately kept: #13015's `reusable` branch re-keys the
 *    survivor in place instead of rebuilding the table around a regenerated
 *    STORED column. A cleanup inside `dropIndexIfExists` would destroy exactly
 *    that survivor on every rebuild.
 *  - `replace_unique_index` — cannot reach a shadow at all. #13015 already
 *    excludes `isHashShadowCarrier` from legacy detection, in `diffManagedIndexes`,
 *    with a comment saying it does so *because* that op drops the legacy name.
 *    A shadow-aware step there would be enforcement for a state the producer
 *    excludes by construction — coverage in appearance only.
 *
 * The last two are pinned below in the NEGATIVE direction on purpose: they are
 * what a later "simplification" that moves the drop down into the shared helper
 * would break, and nothing else would notice.
 *
 * ## What is read, and what is not
 *
 * The live cell reads the PHYSICAL catalog (`information_schema`), never the
 * differ's report about itself, and carries a COLOCATED positive control: a
 * second shadow-carried UNIQUE on the same table whose declaration is retained
 * must be untouched by the same apply. A fix that dropped every shadow it found
 * would pass the first assertion and fail the control.
 *
 * ⚠️ The live cell is OPT-IN and was NOT run while this was written — no MySQL
 * is reachable in the authoring fleet. It is not a silent green: without
 * `OS_TEST_MYSQL_URL` `declareDialectCell` declares a NAMED SKIP, and the
 * runner that provisions the servers — the `Temporal Conformance (live PG +
 * MySQL)` CI job, `ci.yml` step "Run driver-sql suite against both live
 * servers" — sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, which turns a missing URL
 * into a failure. The dialect-free suites below therefore carry the pins that
 * can execute anywhere:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { SqlDriver, diffManagedIndexes } from '../src/index.js';
import {
  hashShadowColumnFor,
  isHashShadowCarrier,
  type ExpectedIndex,
  type LegacyUniqueReplacement,
  type PhysicalIndex,
} from './schema-drift.js';
import { MYSQL_CELL, declareDialectCell } from './live-dialect-matrix.testkit.js';

// ─────────────────────────────────────────────────────────────────────────
// 1. The legacy path is deliberately unchanged — because it cannot reach a
//    shadow. Pinned at the PRODUCER, which is where the exclusion lives.
// ─────────────────────────────────────────────────────────────────────────

describe('replace_unique_index never carries a shadow into its legacy drops (#13056)', () => {
  const TABLE = 'os13056_legacy';
  /** The tenant composite that supersedes a legacy platform-wide unique. */
  const replacement: ExpectedIndex = {
    name: 'uniq_os13056_legacy_organization_id_email',
    columns: ['organization_id', 'email'],
    unique: true,
  };
  const legacyOn = (legacyName: string): LegacyUniqueReplacement => ({
    column: 'email',
    legacyNames: [legacyName],
    replacement,
    legacyColumns: ['email'],
  });

  const diff = (legacy: LegacyUniqueReplacement[], physical: PhysicalIndex[]) =>
    diffManagedIndexes({
      table: TABLE,
      expected: [replacement],
      legacy,
      physical,
      tenantField: 'organization_id',
    });

  /**
   * The POSITIVE CONTROL, and it is not a substring of the term under test: an
   * ORDINARY legacy unique — a plain index physically keying the raw column —
   * really is selected for the legacy drop. Without this, the shadow assertion
   * below would be satisfied by a differ that had stopped emitting the op.
   */
  it('selects an ordinary legacy unique for the drop', () => {
    const legacyName = 'uniq_os13056_legacy_email';
    const entries = diff(
      [legacyOn(legacyName)],
      [{ name: legacyName, columns: ['email'], unique: true }],
    );
    const replace = entries.filter((e) => e.op.type === 'replace_unique_index');
    expect(replace.length).toBe(1);
    expect((replace[0]!.op as any).dropIndexNames).toEqual([legacyName]);
  });

  /**
   * A shadow-carried UNIQUE is NOT a legacy shape, so it never enters
   * `dropIndexNames` — which is the whole reason `applyIndexDriftOp`'s legacy
   * loop needs no shadow-aware step and stays byte-identical.
   */
  it('excludes a shadow carrier, so no shadow name can ever reach the drop list', () => {
    const legacyName = 'uniq_os13056_legacy_email';
    const shadowCarrier: PhysicalIndex = {
      name: legacyName,
      columns: [hashShadowColumnFor(legacyName)],
      unique: true,
    };
    // The carrier really is one — the exclusion is doing the work, not a typo.
    expect(isHashShadowCarrier(shadowCarrier)).toBe(true);

    const entries = diff([legacyOn(legacyName)], [shadowCarrier]);
    for (const e of entries) {
      if (e.op.type !== 'replace_unique_index') continue;
      expect((e.op as any).dropIndexNames).not.toContain(legacyName);
    }
    // Stated positively too: the shadow-carried name is never proposed for the
    // legacy drop under ANY op this call produced.
    const dropped = entries.flatMap((e) =>
      e.op.type === 'replace_unique_index' ? (e.op as any).dropIndexNames : [],
    );
    expect(dropped).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. The apply path, against a STANDING-IN catalog
// ─────────────────────────────────────────────────────────────────────────

interface FakeColumn {
  name: string;
  /** Empty string = a real, non-generated column (MySQL's own spelling). */
  generationExpression: string;
}
interface FakeIndexPart {
  indexName: string;
  column: string;
}

/**
 * A MySQL-flavoured driver whose `information_schema` reads and DDL come from
 * an in-memory catalog. `isMysql` is derived from `config.client` and from
 * nothing else, so overriding it is the whole of "pretend to be MySQL" — the
 * same idiom `sql-driver-deferred-ddl-lock-wait` uses.
 *
 * Every statement is recorded IN ORDER, which is how "index first, then column"
 * is asserted as an observation rather than assumed from the source.
 */
class CatalogProbeDriver extends SqlDriver {
  columns: FakeColumn[] = [];
  indexParts: FakeIndexPart[] = [];
  statements: string[] = [];
  logs: Array<{ level: string; msg: string }> = [];
  pretendMysql = true;
  /** Set to make the `information_schema` reads throw, as an unreachable catalog does. */
  catalogUnreadable = false;

  protected override get isMysql(): boolean {
    return this.pretendMysql;
  }

  protected override logger: any = {
    warn: (msg: string) => this.logs.push({ level: 'warn', msg }),
    error: (msg: string) => this.logs.push({ level: 'error', msg }),
    info: () => {},
    debug: () => {},
  };

  /** The index sync is not under test here; record the intent and stop. */
  protected override async syncDeclaredIndexes(table: string, indexes: any[]): Promise<void> {
    for (const i of indexes) this.statements.push(`SYNC ${table} ${i.name}`);
    for (const i of indexes) this.indexParts.push({ indexName: i.name, column: i.fields[0] });
  }

  protected override async getExistingIndexNames(): Promise<Set<string>> {
    return new Set(this.indexParts.map((p) => p.indexName));
  }

  installFakeKnex(): void {
    const self = this;
    const render = (sql: string, bindings?: any[]) => {
      let i = 0;
      return sql.replace(/\?\?/g, () => String(bindings?.[i++] ?? '?'));
    };
    const fake: any = (table: string) => ({
      columnInfo: async () =>
        Object.fromEntries(self.columns.map((c) => [c.name, { type: 'varbinary' }])),
      // Only reached by paths this suite does not exercise; loud rather than silent.
      then: undefined,
      _table: table,
    });
    fake.client = { database: () => 'os13056_db' };
    fake.raw = async (sql: string, bindings?: any[]) => {
      const rendered = render(sql, bindings);
      self.statements.push(rendered);
      const dropIndex = /DROP (?:INDEX|CONSTRAINT)(?: IF EXISTS)? (\S+)/i.exec(rendered);
      if (dropIndex) {
        const name = dropIndex[1]!;
        self.indexParts = self.indexParts.filter((p) => p.indexName !== name);
      }
      const dropColumn = /DROP COLUMN (\S+)/i.exec(rendered);
      if (dropColumn) {
        const name = dropColumn[1]!;
        self.columns = self.columns.filter((c) => c.name !== name);
      }
      return [];
    };
    fake.select = (...cols: string[]) => ({
      from: (source: string) => ({
        where: async (w: Record<string, string>) => {
          if (self.catalogUnreadable) throw new Error('information_schema unreachable');
          if (/COLUMNS$/i.test(source)) {
            return self.columns
              .filter((c) => c.name === w.COLUMN_NAME)
              .map((c) => ({ GENERATION_EXPRESSION: c.generationExpression }));
          }
          if (/STATISTICS$/i.test(source)) {
            return self.indexParts
              .filter((p) => p.column === w.COLUMN_NAME)
              .map((p) => ({ INDEX_NAME: p.indexName }));
          }
          throw new Error(`unexpected catalog read: ${source} ${cols.join(',')}`);
        },
      }),
    });
    (this as any).knex = fake;
  }

  apply(op: any): Promise<boolean> {
    return (this as any).applyIndexDriftOp(op);
  }
  collect(table: string, indexName: string): Promise<boolean> {
    return (this as any).dropOrphanedHashShadowColumn(table, indexName);
  }
}

describe('the drop_index op collects the shadow it retires (#13056)', () => {
  const TABLE = 'os13056_apply';
  const RETIRED = 'uniq_os13056_apply_token';
  const SHADOW = hashShadowColumnFor(RETIRED);
  /** What a healthy MySQL 8 shadow reports for `GENERATION_EXPRESSION`. */
  const GENERATED = 'unhex(sha2(`token`,256))';

  let driver: CatalogProbeDriver;
  let realKnex: any;

  beforeEach(() => {
    driver = new CatalogProbeDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    realKnex = (driver as any).knex;
    driver.installFakeKnex();
    driver.columns = [
      { name: 'id', generationExpression: '' },
      { name: 'token', generationExpression: '' },
      { name: SHADOW, generationExpression: GENERATED },
    ];
    driver.indexParts = [{ indexName: RETIRED, column: SHADOW }];
  });

  afterEach(async () => {
    (driver as any).knex = realKnex;
    await driver.disconnect().catch(() => {});
  });

  const names = () => driver.columns.map((c) => c.name);

  it('drops the index and THEN the column it keyed, in that order', async () => {
    const applied = await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(applied).toBe(true);
    // The column is physically gone from the catalog — the direction the whole
    // card is about.
    expect(names()).not.toContain(SHADOW);
    expect(names()).toEqual(['id', 'token']);

    const dropIndexAt = driver.statements.findIndex((s) => /DROP INDEX/i.test(s));
    const dropColumnAt = driver.statements.findIndex((s) => /DROP COLUMN/i.test(s));
    expect(dropIndexAt).toBeGreaterThanOrEqual(0);
    expect(dropColumnAt).toBeGreaterThanOrEqual(0);
    expect(dropIndexAt).toBeLessThan(dropColumnAt);
    expect(driver.statements[dropColumnAt]).toBe(`ALTER TABLE ${TABLE} DROP COLUMN ${SHADOW}`);
  });

  /**
   * The COLOCATED positive control for every "the column went" assertion above:
   * a shadow belonging to an index that is still there is not this op's to
   * collect, and the guard that says so is a catalog read, not the op's name.
   */
  it('leaves a shadow whose index still exists untouched', async () => {
    const KEPT = 'uniq_os13056_apply_secret';
    const KEPT_SHADOW = hashShadowColumnFor(KEPT);
    driver.columns.push({ name: KEPT_SHADOW, generationExpression: 'unhex(sha2(`secret`,256))' });
    driver.indexParts.push({ indexName: KEPT, column: KEPT_SHADOW });

    await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(names()).not.toContain(SHADOW);
    expect(names()).toContain(KEPT_SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([
      `ALTER TABLE ${TABLE} DROP COLUMN ${SHADOW}`,
    ]);
  });

  /**
   * #13015's `foreign` guard is the precedent, and this is the same refusal in
   * the removal direction: a column of that name that is not generated may hold
   * user data and is not the driver's to drop.
   */
  it('REFUSES a column of that name that is not a generated column', async () => {
    driver.columns = [
      { name: 'id', generationExpression: '' },
      { name: SHADOW, generationExpression: '' },
    ];
    driver.indexParts = [{ indexName: RETIRED, column: SHADOW }];

    const applied = await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    // The index still went — only the column was spared.
    expect(applied).toBe(true);
    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
    expect(driver.logs.some((l) => /NOT dropping/.test(l.msg) && /NOT a generated column/.test(l.msg))).toBe(true);
  });

  /**
   * "Index first, then column" as a CHECKED precondition rather than an
   * ordering comment: something still keying the column means either the drop
   * did not take or a second index would be removed as a side effect. Either
   * way this is not the orphan being collected.
   */
  it('REFUSES while another index still keys the column', async () => {
    driver.indexParts.push({ indexName: 'idx_os13056_apply_manual', column: SHADOW });

    await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
    expect(
      driver.logs.some((l) => /still key that column/.test(l.msg) && /idx_os13056_apply_manual/.test(l.msg)),
    ).toBe(true);
  });

  it('collects a column the index drop already removed — the half-applied migration', async () => {
    // The index is gone (a previous, partial apply); only the leak is left.
    driver.indexParts = [];

    const applied = await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(names()).not.toContain(SHADOW);
    // `dropIndexIfExists` found nothing, yet the apply DID rewrite the table.
    expect(applied).toBe(true);
  });

  it('is a no-op when no shadow survived', async () => {
    driver.columns = [
      { name: 'id', generationExpression: '' },
      { name: 'token', generationExpression: '' },
    ];

    await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
    expect(driver.logs.filter((l) => /NOT dropping/.test(l.msg))).toEqual([]);
  });

  it('degrades to leaving the column alone when the catalog cannot be read', async () => {
    driver.catalogUnreadable = true;

    await expect(
      driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED }),
    ).resolves.toBe(true);
    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
  });

  it('reads no catalog and drops no column on a non-MySQL dialect', async () => {
    driver.pretendMysql = false;

    await driver.apply({ type: 'drop_index', table: TABLE, indexName: RETIRED });

    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
  });

  // ── The two NEGATIVE pins: the other callers of `dropIndexIfExists` ──────

  /**
   * `recreate_index` drops and re-creates under the SAME name. Its shadow must
   * SURVIVE, or #13015's `reusable` branch — which re-keys the survivor in
   * place rather than rebuilding the table around a regenerated STORED column —
   * can never be reached again. This is the assertion a cleanup moved into
   * `dropIndexIfExists` would fail.
   */
  it('leaves the shadow in place across a recreate_index', async () => {
    await driver.apply({
      type: 'recreate_index',
      table: TABLE,
      indexName: RETIRED,
      columns: ['token'],
      unique: true,
    });

    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
    expect(driver.statements.some((s) => /DROP INDEX/i.test(s))).toBe(true);
  });

  /**
   * `replace_unique_index`'s legacy drop stays byte-identical. Suite 1 pins
   * that a shadow can never REACH this list; this pins that the apply would not
   * act on one even if it somehow did — so the two halves of the answer to
   * "should a legacy name's shadow go with it?" are both executable.
   */
  it('leaves the shadow in place across a replace_unique_index legacy drop', async () => {
    await driver.apply({
      type: 'replace_unique_index',
      table: TABLE,
      dropIndexNames: [RETIRED],
      createIndexName: 'uniq_os13056_apply_organization_id_token',
      createColumns: ['organization_id', 'token'],
    });

    expect(names()).toContain(SHADOW);
    expect(driver.statements.filter((s) => /DROP COLUMN/i.test(s))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Live MySQL: the PHYSICAL catalog, after `os migrate apply` runs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Two full-value UNIQUE indexes over columns MySQL cannot key directly, so both
 * take the #11627 shadow route. Retiring ONE declaration puts the control and
 * the subject on the same table, in the same apply.
 */
const twoCarriedUniques = (name: string, indexes: Array<'retired' | 'kept'>) => ({
  name,
  fields: {
    retired: { type: 'text', maxLength: 1024 },
    kept: { type: 'text', maxLength: 1024 },
  },
  indexes: indexes.map((f) => ({ fields: [f], unique: true as const, name: `uniq_${name}_${f}` })),
});

declareDialectCell(MYSQL_CELL, 'orphan shadow column cleanup (#13056)', (cell) => {
  describe('a retired shadow-carried UNIQUE leaves no column behind (#13056)', () => {
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
      return {
        columns: cols.map((c: any) => String(c.COLUMN_NAME)),
        indexes: idx.map((i: any) => String(i.INDEX_NAME)),
      };
    };

    it('drops the orphaned generated column, and keeps the one still carrying a constraint', async () => {
      const TABLE = 'os13056_orphan';
      const retiredIndex = `uniq_${TABLE}_retired`;
      const keptIndex = `uniq_${TABLE}_kept`;
      const retiredShadow = hashShadowColumnFor(retiredIndex);
      const keptShadow = hashShadowColumnFor(keptIndex);

      driver = new SqlDriver(cell.config());
      await driver.initObjects([twoCarriedUniques(TABLE, ['retired', 'kept'])]);
      await driver.disconnect();

      // POSITIVE CONTROL, before anything is retired: both shadows exist and
      // both indexes really are there. An "it is gone" assertion below proves
      // nothing without this.
      driver = new SqlDriver(cell.config());
      await driver.initObjects([twoCarriedUniques(TABLE, ['retired', 'kept'])]);
      const before = await catalog(TABLE);
      expect(before.columns).toContain(retiredShadow);
      expect(before.columns).toContain(keptShadow);
      expect(before.indexes).toContain(retiredIndex);
      expect(before.indexes).toContain(keptIndex);
      await driver.disconnect();

      // A FRESH driver so `runtimeCreatedIndexes` starts empty — the ledger
      // escape hatch cannot mask the differ's verdict. Metadata now declares
      // only `kept`.
      const retired = twoCarriedUniques(TABLE, ['kept']);
      driver = new SqlDriver(cell.config());
      await driver.initObjects([retired]);
      const drift = await driver.detectManagedDrift([retired]);
      const orphan = drift.find((d) => (d.op as any).indexName === retiredIndex);
      expect(orphan, 'the retired index must be reported as an orphan').toBeTruthy();
      expect(orphan!.op.type).toBe('drop_index');

      await driver.applyMigrationEntries(drift, { allowDestructive: true });

      const after = await catalog(TABLE);
      // The subject: index AND its generated column are both gone.
      expect(after.indexes).not.toContain(retiredIndex);
      expect(after.columns).not.toContain(retiredShadow);
      // The control: the still-declared constraint and its column are intact.
      expect(after.indexes).toContain(keptIndex);
      expect(after.columns).toContain(keptShadow);

      // …and the surviving constraint still BITES, so "kept" means enforced.
      const knex = (driver as any).knex;
      const V = 'k'.repeat(900);
      await knex(TABLE).insert({ id: 'a', kept: V });
      await expect(knex(TABLE).insert({ id: 'b', kept: V })).rejects.toThrow(/duplicate/i);
    });

    /**
     * The differ must go quiet afterwards for the right reason: with the column
     * collected there is no orphan column for the pass to skip, and a second
     * apply has nothing left to do.
     */
    it('converges — a second detect finds neither the index nor an orphan column', async () => {
      const TABLE = 'os13056_converge';
      driver = new SqlDriver(cell.config());
      await driver.initObjects([twoCarriedUniques(TABLE, ['retired', 'kept'])]);
      await driver.disconnect();

      const retired = twoCarriedUniques(TABLE, ['kept']);
      driver = new SqlDriver(cell.config());
      await driver.initObjects([retired]);
      await driver.applyMigrationEntries(await driver.detectManagedDrift([retired]), {
        allowDestructive: true,
      });

      const again = await driver.detectManagedDrift([retired]);
      expect(again.filter((d) => d.kind === 'unmapped_index')).toEqual([]);
      expect(again.filter((d) => d.kind === 'unmapped_column')).toEqual([]);
      const after = await catalog(TABLE);
      expect(after.columns).not.toContain(hashShadowColumnFor(`uniq_${TABLE}_retired`));
    });
  });
});
