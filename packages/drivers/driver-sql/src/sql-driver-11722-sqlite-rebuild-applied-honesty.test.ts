// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11722] On SQLite, `applied` must mean "this op happened" — not "a rebuild ran".
 *
 * ## The defect
 *
 * `SqlDriver.applyMigrationEntries` splits by dialect and the two arms
 * disagreed about what `applied` means. The in-place arm asks per entry and
 * believes the answer (`applyDriftOpInPlace` returns `false` for an op its
 * dialect cannot do, and the entry goes to `skipped`). The SQLite arm did not
 * ask at all:
 *
 * ```ts
 * await this.rebuildSqliteTablePatched(table, ents);
 * applied.push(...ents);        // every entry, unconditionally
 * ```
 *
 * `rebuildSqliteTablePatched` honours exactly four op types — `relax_not_null`,
 * `tighten_not_null`, `drop_column`, `drop_column_default` — and silently
 * ignores everything else; its own docblock says so for the varchar ops. An
 * ignored op was still pushed into `applied`.
 *
 * ## Why the failure mode is a FALSE GREEN, not an error
 *
 * Nothing throws and nothing is skipped, so every consumer announces work that
 * never happened: `reconcileAndWarnDrift` logs `auto-reconciled <op> on
 * <table>`, and the artifact boot gate prints `↪ migrated <op>`. The finding is
 * still physically present, so the NEXT boot detects it again, reports drift
 * again, and "migrates" it again — a loop with no failing signal anywhere in
 * it. §4 pins that consumer-visible symptom directly.
 *
 * ## Why a test that passes on `main` would prove nothing here
 *
 * The gap is LATENT: it is held closed from two independent directions, neither
 * aware it is holding it. `enforcesVarcharLength` excludes SQLite, so the differ
 * never emits `widen_varchar`/`narrow_varchar` there; and
 * `multiValueColumnTypeIsLoadBearing` excludes SQLite for an unrelated MEASURED
 * reason (a stale textual column does not corrupt the value there), so #11535's
 * `manual_column_type_change` is never emitted on SQLite either.
 *
 * So this suite CONSTRUCTS the reachability instead of waiting for it. It
 * substitutes exactly one thing and nothing else — the differ's dialect guard —
 * by handing the entries straight to `applyMigrationEntries`, which is the
 * public seam `os migrate apply` (`packages/cli/src/commands/migrate/apply.ts`)
 * and the artifact boot gate (`packages/cli/src/utils/artifact-boot-migration.ts`)
 * both call with differ output. Driver, dialect and database are real
 * throughout. Every assertion below FAILS on the pre-fix tree, where the
 * ignored entries arrive in `applied`.
 *
 * ## What this suite deliberately does NOT assert
 *
 * That the rebuild is skipped when it honours nothing. The rebuild
 * re-materializes every kept column's default and the whole declared index set
 * from metadata, so it is not a no-op — suppressing it would change what the
 * reconciler DOES rather than what it REPORTS, which is a different question
 * from this one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import type { DriftOp, ManagedDriftEntry } from './schema-drift.js';

describe('SqlDriver SQLite reconcile reports only what the rebuild honoured (#11722)', () => {
  let knexInstance: any;

  const makeDriver = (opts: any = {}, Ctor: typeof SqlDriver = SqlDriver) => {
    const d = new Ctor({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn() };
    return d;
  };

  afterEach(async () => {
    await knexInstance?.destroy();
    knexInstance = undefined;
  });

  /** A drift entry carrying `op`, exactly as the differ would hand one over. */
  const entryFor = (op: DriftOp, category: ManagedDriftEntry['category']): ManagedDriftEntry =>
    ({
      kind: 'type_mismatch',
      severity: 'error',
      table: op.table,
      column: (op as { column?: string }).column,
      category,
      op,
      message: `${op.type} on ${op.table}.${(op as { column?: string }).column}`,
    }) as ManagedDriftEntry;

  const logLines = (driver: SqlDriver): string[] => {
    const l = (driver as any).logger;
    return [...l.warn.mock.calls, ...l.info.mock.calls].map((c: any[]) => String(c[0]));
  };

  // ────────────────────────────────────────────────────────────────────
  // §1 — the op that already documents its own answer: no reconciler arm
  // ────────────────────────────────────────────────────────────────────
  describe('§1 an op the rebuild does not honour is reported skipped, not applied', () => {
    it('`manual_column_type_change` — the op whose docblock says "skipped, never applied" — is skipped on SQLite too', async () => {
      const driver = makeDriver();
      await driver.initObjects([{ name: 'proj_task', fields: { tags: { type: 'string' } } }]);
      await knexInstance('proj_task').insert({ id: '1', tags: '["a","b"]' });

      const before = await knexInstance('proj_task').columnInfo();

      const op: DriftOp = {
        type: 'manual_column_type_change',
        table: 'proj_task',
        column: 'tags',
        from: 'varchar',
        to: 'json',
      };
      const { applied, skipped } = await driver.applyMigrationEntries([entryFor(op, 'needs_confirm')], {
        allowDestructive: false,
      });

      // The whole point: the entry is reported for what actually happened to it.
      expect(applied).toHaveLength(0);
      expect(skipped.map((d) => d.op.type)).toEqual(['manual_column_type_change']);

      // …and "what actually happened to it" is: nothing. The physical column is
      // byte-for-byte the one it was, which is why reporting it applied was a
      // lie rather than a naming quibble.
      expect(await knexInstance('proj_task').columnInfo()).toEqual(before);

      // Reported in the SAME words the in-place arm uses for an op its dialect
      // cannot perform — one greppable sentence across all three dialects.
      expect(logLines(driver).some((m) => /manual_column_type_change on proj_task\.tags is unsupported on dialect 'sqlite' — skipped/.test(m))).toBe(true);
    });

    it('`widen_varchar` — a SAFE op the rebuild ignores by design — is skipped, so dev auto-reconcile cannot announce it', async () => {
      const driver = makeDriver();
      await driver.initObjects([{ name: 'proj_task', fields: { title: { type: 'string', maxLength: 60 } } }]);

      const op: DriftOp = { type: 'widen_varchar', table: 'proj_task', column: 'title', from: 30, to: 60 };
      const { applied, skipped } = await driver.applyMigrationEntries([entryFor(op, 'safe')], {
        allowDestructive: false,
      });

      expect(applied).toHaveLength(0);
      expect(skipped.map((d) => d.op.type)).toEqual(['widen_varchar']);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // §2 — a MIXED batch: the rebuild still runs and still reports honestly
  // ────────────────────────────────────────────────────────────────────
  describe('§2 a mixed batch splits — the rebuild runs, and only its own work is reported applied', () => {
    it('relaxes NOT NULL for real while reporting the ignored sibling as skipped', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.timestamp('created_at');
        t.timestamp('updated_at');
        t.string('name');
        t.string('organization_id').notNullable();
      });
      await knexInstance('biz_unit').insert({ id: '1', name: 'Acme', organization_id: 'org1' });
      await driver.initObjects([
        {
          name: 'biz_unit',
          fields: {
            name: { type: 'string' },
            organization_id: { type: 'string', required: false },
          },
        },
      ]);

      // The relax entry is REAL differ output — only the ignored sibling is
      // constructed, and only because the differ's SQLite guard withholds it.
      const drift = await driver.detectManagedDrift();
      const relax = drift.find((d) => d.op.type === 'relax_not_null');
      expect(relax, 'fixture must produce a real relax_not_null entry').toBeDefined();

      const ignored = entryFor(
        { type: 'narrow_varchar', table: 'biz_unit', column: 'name', from: 255, to: 40 },
        'destructive',
      );

      const { applied, skipped } = await driver.applyMigrationEntries([relax!, ignored], {
        allowDestructive: true,
      });

      expect(applied.map((d) => d.op.type)).toEqual(['relax_not_null']);
      expect(skipped.map((d) => d.op.type)).toEqual(['narrow_varchar']);

      // The rebuild genuinely ran: the constraint is gone and the row survived.
      const info = await knexInstance('biz_unit').columnInfo();
      expect(info.organization_id.nullable).toBe(true);
      expect(info).toHaveProperty('name');
      expect(await knexInstance('biz_unit').select('*')).toMatchObject([
        { id: '1', name: 'Acme', organization_id: 'org1' },
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // §3 — the ratchet: the honoured set is EXACTLY the four the rebuild acts on
  // ────────────────────────────────────────────────────────────────────
  describe('§3 every column op type is partitioned by what the rebuild actually does', () => {
    it('honours exactly relax/tighten NOT NULL, drop_column, drop_column_default — and skips the rest', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('ratchet_t', (t: any) => {
        t.string('id').primary();
        t.string('a').notNullable();
        t.string('b');
        t.string('c');
        t.string('d').defaultTo('current_user');
        t.string('e');
        t.string('f');
        t.string('g');
      });
      await driver.initObjects([
        {
          name: 'ratchet_t',
          fields: {
            a: { type: 'string' },
            b: { type: 'string' },
            d: { type: 'string' },
            e: { type: 'string' },
            f: { type: 'string' },
            g: { type: 'string' },
          },
        },
      ]);

      // One entry per COLUMN op type in `DriftOp`, each on its own column so no
      // two can interfere. Index ops take a different path entirely and are not
      // this partition's business.
      const batch: Array<[DriftOp, ManagedDriftEntry['category']]> = [
        [{ type: 'relax_not_null', table: 'ratchet_t', column: 'a' }, 'safe'],
        [{ type: 'tighten_not_null', table: 'ratchet_t', column: 'b' }, 'destructive'],
        [{ type: 'drop_column', table: 'ratchet_t', column: 'c' }, 'destructive'],
        [{ type: 'drop_column_default', table: 'ratchet_t', column: 'd' }, 'safe'],
        [{ type: 'widen_varchar', table: 'ratchet_t', column: 'e', from: 30, to: 60 }, 'safe'],
        [{ type: 'narrow_varchar', table: 'ratchet_t', column: 'f', from: 60, to: 30 }, 'destructive'],
        [
          { type: 'manual_column_type_change', table: 'ratchet_t', column: 'g', from: 'varchar', to: 'json' },
          'needs_confirm',
        ],
      ];

      const { applied, skipped } = await driver.applyMigrationEntries(
        batch.map(([op, cat]) => entryFor(op, cat)),
        { allowDestructive: true },
      );

      expect(applied.map((d) => d.op.type).sort()).toEqual(
        ['drop_column', 'drop_column_default', 'relax_not_null', 'tighten_not_null'].sort(),
      );
      expect(skipped.map((d) => d.op.type).sort()).toEqual(
        ['manual_column_type_change', 'narrow_varchar', 'widen_varchar'].sort(),
      );

      // Positive control on the applied half — a partition that reported
      // "applied" for work that did not happen is the defect itself, so the
      // four honoured ops are checked against the physical table.
      const info = await knexInstance('ratchet_t').columnInfo();
      expect(info).not.toHaveProperty('c');
      expect(info.a.nullable).toBe(true);
      expect(info.b.nullable).toBe(false);
      expect(info.d.defaultValue ?? null).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // §4 — the consumer-visible symptom the card is actually about
  // ────────────────────────────────────────────────────────────────────
  describe('§4 dev auto-reconcile no longer announces an op that never happened', () => {
    /**
     * The differ cannot emit a non-rebuildable column op on SQLite today, so
     * the future in which it can is simulated at the ONE seam that holds it
     * closed: `detectTableDrift`. Everything downstream of it — the reconcile,
     * the rebuild, the logging, the re-detect — is the real code path.
     */
    class FutureOpDriver extends SqlDriver {
      public nextDrift: ManagedDriftEntry[] = [];
      protected async detectTableDrift(): Promise<ManagedDriftEntry[]> {
        return this.nextDrift;
      }
    }

    it('logs "unsupported … skipped" instead of "auto-reconciled", and the finding is still warned about', async () => {
      const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' }, FutureOpDriver) as FutureOpDriver;
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string', maxLength: 60 } } }]);

      driver.nextDrift = [
        entryFor({ type: 'widen_varchar', table: 'biz_unit', column: 'name', from: 30, to: 60 }, 'safe'),
      ];
      // Re-detect after the reconcile returns the SAME entry, because the op
      // was never performed — which is precisely the loop this card describes.
      await (driver as any).reconcileAndWarnDrift('biz_unit', { name: { type: 'string', maxLength: 60 } });

      const lines = logLines(driver);
      expect(lines.some((m) => m.includes('auto-reconciled'))).toBe(false);
      expect(lines.some((m) => /widen_varchar on biz_unit\.name is unsupported on dialect 'sqlite' — skipped/.test(m))).toBe(true);
      // Still surfaced as drift — reporting it skipped does not hide it.
      expect(lines.some((m) => m.includes('widen_varchar on biz_unit.name'))).toBe(true);
    });
  });
});
