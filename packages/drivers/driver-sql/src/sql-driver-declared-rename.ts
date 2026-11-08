// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The "Declared renames" section of `SqlDriver` (epic cloud#3652, ruling D3
 * 「写进清单 renamedFrom」): the bodies of `declaredRenameLimit`,
 * `planDeclaredRenames`, `carryDeclaredRenames`, `reverseDeclaredRenames` and
 * `retireIndexesNamedForOldKeys`. The rule itself, and every refusal, is
 * `declared-rename.ts`; this module reads the table and runs the DDL.
 *
 * Written in the facet form the class's other sections take (ruling
 * 6624345766): each static method is the body of the `SqlDriver` method of
 * the same name, the method stays on the class as a one-call stub carrying the
 * contract docblock, and the bodies reach the class through
 * {@link DeclaredRenameHost}, `declaredRenameHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import {
  DeclaredRenameRefusal,
  executeDeclaredRenames,
  planDeclaredRenames,
  renamedFromOf,
  type DeclaredRenameCarry,
  type DeclaredRenamePlan,
  type DeclaredRenameRefusalEntry,
} from './declared-rename.js';
import {
  buildIndexName,
  diffManagedTable,
  expectedIndexes,
  indexedKeyColumns,
  isHashShadowCarrier,
  type DriftOp,
} from './schema-drift.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link DeclaredRenameFacet} read — every
 * one of them, and no other, each typed AS the class member.
 */
export interface DeclaredRenameHost {
  assertSchemaMutable: SqlDriver['assertSchemaMutable'];
  declaredRenameLimit: SqlDriver['declaredRenameLimit'];
  readonly dialectName: SqlDriver['dialectName'];
  dropIndexIfExists: SqlDriver['dropIndexIfExists'];
  readonly fileColumnsMoved: SqlDriver['fileColumnsMoved'];
  introspectColumns: SqlDriver['introspectColumns'];
  introspectIndexes: SqlDriver['introspectIndexes'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly knex: SqlDriver['knex'];
  readonly logger: SqlDriver['logger'];
  planDeclaredRenames: SqlDriver['planDeclaredRenames'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  varcharColumnChars: SqlDriver['varcharColumnChars'];
}

/**
 * The drift ops that describe the column's TYPE (as opposed to its
 * nullability or its default): the ones a rename's type judgement reads.
 */
const TYPE_DRIFT_OPS: ReadonlySet<DriftOp['type']> = new Set([
  'narrow_varchar',
  'widen_varchar',
  'manual_column_type_change',
  'manual_widen_varchar_to_text',
]);

/** The object shape these bodies read: its fields, and its declared indexes for keyedness. */
type DeclaringObject = { fields?: Record<string, any>; indexes?: any[] };

/** The bodies of the "Declared renames" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class DeclaredRenameFacet {
  /** The body of `SqlDriver#declaredRenameLimit`; the method's docblock there is its contract. */
  static declaredRenameLimit(this: Pick<DeclaredRenameHost, 'dialectName'>): string | null {
    return this.dialectName === 'unknown'
      ? 'this datasource\'s SQL dialect is not one the driver knows (sqlite, postgres or mysql), so it renames no column'
      : null;
  }

  /** The body of `SqlDriver#planDeclaredRenames`; the method's docblock there is its contract. */
  static async planDeclaredRenames(
    this: Pick<DeclaredRenameHost, 'declaredRenameLimit' | 'dialectName' | 'fileColumnsMoved' | 'introspectColumns' | 'introspectIndexes' | 'isMysql' | 'knex' | 'resolveTenantField' | 'varcharColumnChars'>,
    tableName: string,
    object: DeclaringObject,
    opts: { liveKeys?: Iterable<string> } = {},
  ): Promise<DeclaredRenamePlan> {
    const fields = object.fields ?? {};
    if (!Object.values(fields).some((def) => renamedFromOf(def).length > 0)) return { carries: [], refusals: [] };

    const exists = await this.knex.schema.hasTable(tableName);
    const physical = new Set<string>(exists ? Object.keys(await this.knex(tableName).columnInfo()) : []);
    const tenantField = this.resolveTenantField(tableName);
    const plan = planDeclaredRenames({
      table: tableName,
      fields,
      physicalColumns: physical,
      tenantField,
      ...(opts.liveKeys !== undefined ? { liveKeys: opts.liveKeys } : {}),
    });
    if (plan.carries.length === 0) return plan;

    // A transport that renames no column refuses each carry it would owe, by
    // name — only when there is one: a declaration whose rename is long done
    // (no old column left) asks nothing of it.
    const limit = this.declaredRenameLimit();
    if (limit !== null) {
      return {
        carries: [],
        refusals: [
          ...plan.refusals,
          ...plan.carries.map((c) => ({
            table: tableName,
            field: c.to,
            from: [c.from],
            reason: 'transport' as const,
            message: `${tableName}.${c.to} declares \`renamedFrom\` '${c.from}', and the table still has the column `
              + `'${c.from}' to carry, but ${limit}. Nothing was changed.`,
          })),
        ],
      };
    }

    // The old column, read under the new declaration: a change the drift
    // categories call `destructive` is refused, as the upgrade plan lists it.
    const columns = await this.introspectColumns(tableName);
    const keyedColumns = indexedKeyColumns({ table: tableName, fields, tenantField, declaredIndexes: object.indexes });
    const indexes = this.isMysql ? await this.introspectIndexes(tableName) : [];
    const carries: DeclaredRenameCarry[] = [];
    const refusals: DeclaredRenameRefusalEntry[] = [...plan.refusals];
    for (const carry of plan.carries) {
      const column = columns.find((c) => c.name === carry.from);
      const destructive = column === undefined ? [] : diffManagedTable({
        table: tableName,
        fields: { [carry.to]: fields[carry.to] },
        columns: [{ name: carry.to, type: column.type, nullable: column.nullable, maxLength: column.maxLength, defaultValue: column.defaultValue }],
        dialect: this.dialectName,
        keyedColumns,
        varcharColumnChars: (field, keyed) => this.varcharColumnChars(field, keyed),
        fileColumnsMoved: this.fileColumnsMoved,
        ceremonyOwnedNullability: tenantField,
      }).filter((d) => d.category === 'destructive' && TYPE_DRIFT_OPS.has(d.op.type));
      if (destructive.length > 0) {
        refusals.push({
          table: tableName,
          field: carry.to,
          from: [carry.from],
          reason: 'destructive_type',
          message: `${tableName}.${carry.to} declares \`renamedFrom\` '${carry.from}': the column '${carry.from}' read `
            + `under the new declaration is a destructive change (${destructive.map((d) => d.message).join(' ')}) `
            + 'Carrying it would lose or refuse values. Declare a type the old column fits, or carry the values by hand.',
        });
        continue;
      }
      // MySQL refuses to rename a column a generated column references, and a
      // hash-shadow carrier (#11627) is exactly that: its shadow hashes the
      // declared key BY NAME. An unreadable shadow key is judged as touching it.
      const carrier = indexes.find((i) => isHashShadowCarrier(i)
        && (i.shadowKey === undefined || i.shadowKey.some((part) => part.column === carry.from)));
      if (carrier !== undefined) {
        refusals.push({
          table: tableName,
          field: carry.to,
          from: [carry.from],
          reason: 'index_cannot_follow',
          message: `${tableName}.${carry.to} declares \`renamedFrom\` '${carry.from}', and the unique index `
            + `'${carrier.name}' keys '${carry.from}' through a generated hash column, which MySQL does not let a `
            + 'column rename carry along. Drop that index (or the unique declaration) for the upgrade and declare it '
            + 'again after, or carry the values by hand.',
        });
        continue;
      }
      carries.push(carry);
    }
    return { carries, refusals };
  }

  /** The body of `SqlDriver#carryDeclaredRenames`; the method's docblock there is its contract. */
  static async carryDeclaredRenames(
    this: Pick<DeclaredRenameHost, 'assertSchemaMutable' | 'dialectName' | 'knex' | 'logger' | 'planDeclaredRenames'>,
    tableName: string,
    object: DeclaringObject,
    opts: { liveKeys?: Iterable<string> } = {},
  ): Promise<DeclaredRenameCarry[]> {
    if (!Object.values(object.fields ?? {}).some((def) => renamedFromOf(def).length > 0)) return [];
    this.assertSchemaMutable('carryDeclaredRenames');
    const plan = await this.planDeclaredRenames(tableName, object, opts);
    if (plan.refusals.length > 0) throw new DeclaredRenameRefusal(tableName, plan.refusals);
    if (plan.carries.length === 0) return [];
    // `planDeclaredRenames` answers a `transport` refusal for any other dialect.
    await executeDeclaredRenames(this.knex, this.dialectName as 'sqlite' | 'postgres' | 'mysql', tableName, plan.carries);
    for (const c of plan.carries) {
      this.logger.info?.(
        `[sql-driver] carried the declared rename ${tableName}.${c.from} → ${tableName}.${c.to} (renamedFrom): `
        + `the column and every value in it now serve '${c.to}'`,
        { table: tableName, from: c.from, to: c.to },
      );
    }
    return plan.carries;
  }

  /** The body of `SqlDriver#reverseDeclaredRenames`; the method's docblock there is its contract. */
  static async reverseDeclaredRenames(
    this: Pick<DeclaredRenameHost, 'assertSchemaMutable' | 'dialectName' | 'knex' | 'logger'>,
    carries: ReadonlyArray<DeclaredRenameCarry>,
  ): Promise<void> {
    if (carries.length === 0) return;
    this.assertSchemaMutable('reverseDeclaredRenames');
    const byTable = new Map<string, Array<{ from: string; to: string }>>();
    for (const c of carries) {
      const list = byTable.get(c.table) ?? [];
      list.push({ from: c.to, to: c.from });
      byTable.set(c.table, list);
    }
    for (const [table, list] of byTable) {
      await executeDeclaredRenames(this.knex, this.dialectName as 'sqlite' | 'postgres' | 'mysql', table, list);
      this.logger.info?.(
        `[sql-driver] reversed ${list.length} declared rename(s) on ${table}: ${list.map((c) => `${c.from} → ${c.to}`).join(', ')}`,
        { table },
      );
    }
  }

  /** The body of `SqlDriver#retireIndexesNamedForOldKeys`; the method's docblock there is its contract. */
  static async retireIndexesNamedForOldKeys(
    this: Pick<DeclaredRenameHost, 'dropIndexIfExists' | 'introspectIndexes' | 'knex' | 'logger'>,
    tableName: string,
    object: DeclaringObject,
    tenantField: string | null,
  ): Promise<string[]> {
    const fields = object.fields ?? {};
    const oldKeys = new Map<string, string[]>();
    for (const [field, def] of Object.entries(fields)) {
      const entries = renamedFromOf(def);
      if (entries.length > 0) oldKeys.set(field, entries);
    }
    if (oldKeys.size === 0) return [];
    const physicalColumns = new Set(Object.keys(await this.knex(tableName).columnInfo()));
    const expected = expectedIndexes({ table: tableName, fields, tenantField, declaredIndexes: object.indexes, physicalColumns })
      .filter((e) => e.columns.some((c) => oldKeys.has(c)));
    if (expected.length === 0) return [];
    const expectedNames = new Set(expected.map((e) => e.name));
    const physical = new Set((await this.introspectIndexes(tableName)).map((i) => i.name));
    const retired: string[] = [];
    for (const e of expected) {
      if (!physical.has(e.name)) continue;
      // The name the index had while one of its columns was still an old key:
      // each declaring column swapped back, one at a time.
      for (const [i, column] of e.columns.entries()) {
        for (const old of oldKeys.get(column) ?? []) {
          const name = buildIndexName(tableName, e.columns.map((c, j) => (j === i ? old : c)), e.unique);
          if (name === e.name || expectedNames.has(name) || !physical.has(name) || retired.includes(name)) continue;
          await this.dropIndexIfExists(tableName, name);
          retired.push(name);
          this.logger.info?.(
            `[sql-driver] dropped the index '${name}' on ${tableName}: it was named for the old key '${old}', and the `
            + `rename carried it to '${column}', where '${e.name}' now holds the same key`,
            { table: tableName, index: name, replacedBy: e.name },
          );
        }
      }
    }
    return retired;
  }
}
