// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The
 * "The sequence semantics a second face shares, stated once" section of
 * `SqlDriver`: the bodies of `resolveSequenceTenantId`, `defineSequencesTable`,
 * `createSequencesTable`, `ensureSequencesKeyHashShape`, `scanMaxNumericTail`,
 * `escapeLikePrefix`, `attemptWithoutPoisoning`, `autoNumberValueExists`,
 * `autoNumberCounterKey`, `stampInsertTimestamps`, `observedUpdatedAtColumn`,
 * `stampUpsertUpdatedAt`, `keepSuppliedUpdatedAt`, `updatedAtStamp`,
 * `stampsUpdatedAt`, `updatedAtStampIsPresumed`, `update`,
 * `insertOnlyUpsertColumns`, `mergeLandsInWrittenOrganization`,
 * `assertMergeLandedOnSuppliedIdentity`,
 * `assertMergeLandedInWrittenOrganization`, `upsert`, `delete` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link SequenceSemanticsFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link SequenceSemanticsHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `sequenceSemanticsHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { oracleUpsertUnsupportedError } from './sql-driver-oracle-dialect.js';
import type { DriverOptions } from '@objectstack/spec/data';
import { StorageNameMapping } from '@objectstack/spec/system';
import { OrganizationlessCounterRefusal } from './organizationless-counter-refusal.js';
import { isUnbackedConflictTargetError } from '@objectstack/types';
import { GLOBAL_TENANT } from './schema-drift.js';
import type { PhysicalIndex } from './schema-drift.js';
import { withUpsertConflictClause } from './upsert-conflict-clause.js';
import type { Knex } from 'knex';
import { nanoid } from 'nanoid';
import {
  AUDIT_TIMESTAMP_COLUMNS, AUTONUMBER_COLLISION_RETRIES, DEFAULT_ID_LENGTH, LIKE_ESCAPE_CHARACTER,
  MYSQL_DATETIME_PRECISION, SEQUENCES_TABLE, isUpsertFenceRefusal, refuseCrossRowIdentityMerge,
  refuseUnbackedConflictTarget, refuseUpsertConflictOutsideWrittenOrganization,
} from './sql-driver-top-level.js';
import type { AutoNumberReservation } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link SequenceSemanticsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SequenceSemanticsHost {
  applyTenantScope: SqlDriver['applyTenantScope'];
  applyWriteColumnMap: SqlDriver['applyWriteColumnMap'];
  assertConflictTargetBackedWithoutClause: SqlDriver['assertConflictTargetBackedWithoutClause'];
  assertConflictTargetHonoured: SqlDriver['assertConflictTargetHonoured'];
  assertMergeLandedInWrittenOrganization: SqlDriver['assertMergeLandedInWrittenOrganization'];
  assertMergeLandedOnSuppliedIdentity: SqlDriver['assertMergeLandedOnSuppliedIdentity'];
  auditMissingTenant: SqlDriver['auditMissingTenant'];
  readonly autoNumberFields: SqlDriver['autoNumberFields'];
  collidingAutoNumberReservations: SqlDriver['collidingAutoNumberReservations'];
  createSequencesTable: SqlDriver['createSequencesTable'];
  defineSequencesTable: SqlDriver['defineSequencesTable'];
  escapeLikePrefix: SqlDriver['escapeLikePrefix'];
  fillAutoNumberFields: SqlDriver['fillAutoNumberFields'];
  formatInput: SqlDriver['formatInput'];
  formatOutput: SqlDriver['formatOutput'];
  getBuilder: SqlDriver['getBuilder'];
  injectTenantOnInsert: SqlDriver['injectTenantOnInsert'];
  insertOnlyUpsertColumns: SqlDriver['insertOnlyUpsertColumns'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isOracle: SqlDriver['isOracle'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly isSqlite: SqlDriver['isSqlite'];
  keepSuppliedUpdatedAt: SqlDriver['keepSuppliedUpdatedAt'];
  readonly knex: SqlDriver['knex'];
  readonly logger: SqlDriver['logger'];
  maxAutonumberCounter: SqlDriver['maxAutonumberCounter'];
  mergeLandsInWrittenOrganization: SqlDriver['mergeLandsInWrittenOrganization'];
  observedUpdatedAtColumn: SqlDriver['observedUpdatedAtColumn'];
  readonly organizationObjectRegistered: SqlDriver['organizationObjectRegistered'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveSequenceTenantId: SqlDriver['resolveSequenceTenantId'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  resyncSequenceToDataMax: SqlDriver['resyncSequenceToDataMax'];
  rotatedUpdateById: SqlDriver['rotatedUpdateById'];
  rotationShardsOf: SqlDriver['rotationShardsOf'];
  rotationWriteTarget: SqlDriver['rotationWriteTarget'];
  sequenceKeyHash: SqlDriver['sequenceKeyHash'];
  sequencesHasKeyHash: SqlDriver['sequencesHasKeyHash'];
  stampInsertTimestamps: SqlDriver['stampInsertTimestamps'];
  stampUpsertUpdatedAt: SqlDriver['stampUpsertUpdatedAt'];
  stampsUpdatedAt: SqlDriver['stampsUpdatedAt'];
  readonly tablesWithTimestamps: SqlDriver['tablesWithTimestamps'];
  updateWithPresumedTimestamp: SqlDriver['updateWithPresumedTimestamp'];
  readonly updatedAtColumnState: SqlDriver['updatedAtColumnState'];
  updatedAtStamp: SqlDriver['updatedAtStamp'];
  updatedAtStampIsPresumed: SqlDriver['updatedAtStampIsPresumed'];
  upsertTenantGuard: SqlDriver['upsertTenantGuard'];
}

/** The bodies of the "The sequence semantics a second face shares, stated once" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class SequenceSemanticsFacet {
  /** The body of `SqlDriver#resolveSequenceTenantId`; the method's docblock there is its contract. */
  static resolveSequenceTenantId(this: Pick<SequenceSemanticsHost, 'organizationObjectRegistered'>, tenantField: string | null, tenantId: string | null, table: string, field: string): string {
    if (!tenantField) return GLOBAL_TENANT;
    if (tenantId) return String(tenantId);
    if (this.organizationObjectRegistered) throw new OrganizationlessCounterRefusal(table, field, tenantField);
    return GLOBAL_TENANT;
  }

  /** The body of `SqlDriver#defineSequencesTable`; the method's docblock there is its contract. */
  static defineSequencesTable(this: Pick<SequenceSemanticsHost, 'knex'>, t: Knex.CreateTableBuilder): void {
    t.string('key_hash', 64).notNullable().primary();
    t.string('object').notNullable();
    t.string('tenant_id').notNullable();
    t.string('field').notNullable();
    // Non-indexed, so it is free of the PK length limit — a long `{plan_no}`
    // composite scope fits. 1024 is far above any realistic rendered prefix.
    t.string('scope', 1024).notNullable().defaultTo('');
    t.bigInteger('last_value').notNullable().defaultTo(0);
    t.timestamp('updated_at').defaultTo(this.knex.fn.now());
  }

  /** The body of `SqlDriver#createSequencesTable`; the method's docblock there is its contract. */
  static async createSequencesTable(this: Pick<SequenceSemanticsHost, 'defineSequencesTable' | 'knex'>, table: string, runner: Knex | Knex.Transaction = this.knex): Promise<void> {
    await runner.schema.createTable(table, (t) => this.defineSequencesTable(t));
  }

  /** The body of `SqlDriver#ensureSequencesKeyHashShape`; the method's docblock there is its contract. */
  static async ensureSequencesKeyHashShape(this: Pick<SequenceSemanticsHost, 'createSequencesTable' | 'knex' | 'logger' | 'sequenceKeyHash' | 'sequencesHasKeyHash'>, runner: Knex | Knex.Transaction = this.knex): Promise<void> {
    if (await runner.schema.hasColumn(SEQUENCES_TABLE, 'key_hash')) {
      this.sequencesHasKeyHash = true;
      return;
    }
    const hasScope = await runner.schema.hasColumn(SEQUENCES_TABLE, 'scope');
    const TMP = `${SEQUENCES_TABLE}__rebuild`;
    try {
      const rows: any[] = await runner(SEQUENCES_TABLE).select('*');
      await runner.schema.dropTableIfExists(TMP);
      await this.createSequencesTable(TMP, runner);
      const migrated = rows.map((r) => {
        const scope = hasScope && r.scope != null ? String(r.scope) : '';
        return {
          key_hash: this.sequenceKeyHash(String(r.object), String(r.tenant_id), String(r.field), scope),
          object: r.object,
          tenant_id: r.tenant_id,
          field: r.field,
          scope,
          last_value: r.last_value ?? 0,
          updated_at: r.updated_at ?? this.knex.fn.now(),
        };
      });
      if (migrated.length > 0) await runner(TMP).insert(migrated);
      await runner.schema.dropTable(SEQUENCES_TABLE);
      await runner.schema.renameTable(TMP, SEQUENCES_TABLE);
      this.sequencesHasKeyHash = true;
    } catch (err) {
      // Leave the original table intact; fall back to legacy keying for
      // fixed-prefix sequences and refuse per-scope writes until migrated.
      this.sequencesHasKeyHash = false;
      await runner.schema.dropTableIfExists(TMP).catch(() => {});
      this.logger.warn(
        `[autonumber] Failed to migrate ${SEQUENCES_TABLE} to the key_hash shape. ` +
          `Fixed-prefix autonumbers keep working; date/{field}/per-parent formats will ` +
          `error until the table is migrated.`,
        { error: String(err) },
      );
    }
  }

  /** The body of `SqlDriver#scanMaxNumericTail`; the method's docblock there is its contract. */
  static async scanMaxNumericTail(this: Pick<SequenceSemanticsHost, 'escapeLikePrefix' | 'maxAutonumberCounter'>, queryRunner: Knex | Knex.Transaction, tableName: string, field: string, prefix: string, tenantField: string | null, tenantId: string | null, suffix = ''): Promise<number> {
    let builder = queryRunner(tableName)
      .select(field)
      .whereRaw('?? like ? escape ?', [field, `${this.escapeLikePrefix(prefix)}%`, LIKE_ESCAPE_CHARACTER])
      .whereNotNull(field);
    if (tenantField && tenantId !== null) {
      builder = builder.where(tenantField, tenantId);
    }
    const rows = await builder;
    return this.maxAutonumberCounter((rows as any[]).map((r) => (r as any)[field]), prefix, suffix);
  }

  /** The body of `SqlDriver#escapeLikePrefix`; the method's docblock there is its contract. */
  static escapeLikePrefix(prefix: string): string {
    return prefix.replace(/([\\%_])/g, '\\$1');
  }

  /** The body of `SqlDriver#attemptWithoutPoisoning`; the method's docblock there is its contract. */
  static async attemptWithoutPoisoning<T>(trx: Knex.Transaction, attempt: (scoped: Knex.Transaction) => Promise<T> | Knex.QueryBuilder<any, T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    try {
      const value = await trx.transaction(async (scoped) => attempt(scoped));
      return { ok: true, value: value as T };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** The body of `SqlDriver#autoNumberValueExists`; the method's docblock there is its contract. */
  static async autoNumberValueExists(queryRunner: Knex | Knex.Transaction, reservation: AutoNumberReservation): Promise<boolean> {
    let builder = queryRunner(reservation.tableName).select(reservation.field).where(reservation.field, reservation.value);
    if (reservation.tenantField && reservation.tenantId !== null) {
      builder = builder.where(reservation.tenantField, reservation.tenantId);
    }
    const hit = await builder.first();
    return hit !== undefined && hit !== null;
  }

  /** The body of `SqlDriver#autoNumberCounterKey`; the method's docblock there is its contract. */
  static autoNumberCounterKey(this: Pick<SequenceSemanticsHost, 'resolveSequenceTenantId' | 'sequenceKeyHash'>, reservation: AutoNumberReservation): string {
    const resolvedTenantId = this.resolveSequenceTenantId(
      reservation.tenantField,
      reservation.tenantId,
      reservation.tableName,
      reservation.field,
    );
    return this.sequenceKeyHash(reservation.tableName, resolvedTenantId, reservation.field, reservation.scope);
  }

  /** The body of `SqlDriver#stampInsertTimestamps`; the method's docblock there is its contract. */
  static stampInsertTimestamps(this: Pick<SequenceSemanticsHost, 'isSqlite' | 'tablesWithTimestamps'>, object: string, formatted: Record<string, any>): void {
    if (!this.isSqlite || !this.tablesWithTimestamps.has(object)) return;
    const iso = new Date().toISOString();
    for (const col of AUDIT_TIMESTAMP_COLUMNS) {
      if (formatted[col] === undefined || formatted[col] === null) formatted[col] = iso;
    }
  }

  /** The body of `SqlDriver#observedUpdatedAtColumn`; the method's docblock there is its contract. */
  static observedUpdatedAtColumn(this: Pick<SequenceSemanticsHost, 'tablesWithTimestamps' | 'updatedAtColumnState'>, object: string): boolean {
    return this.tablesWithTimestamps.has(object) || this.updatedAtColumnState.get(object) === 'present';
  }

  /** The body of `SqlDriver#stampUpsertUpdatedAt`; the method's docblock there is its contract. */
  static stampUpsertUpdatedAt(this: Pick<SequenceSemanticsHost, 'observedUpdatedAtColumn' | 'updatedAtStamp'>, object: string, formatted: Record<string, any>): void {
    if (formatted.updated_at !== undefined && formatted.updated_at !== null) return;
    if (!this.observedUpdatedAtColumn(object)) return;
    formatted.updated_at = this.updatedAtStamp();
  }

  /** The body of `SqlDriver#keepSuppliedUpdatedAt`; the method's docblock there is its contract. */
  static keepSuppliedUpdatedAt(formatted: Record<string, any>, options?: DriverOptions): boolean {
    return options?.preserveAudit === true && formatted.updated_at != null;
  }

  /** The body of `SqlDriver#updatedAtStamp`; the method's docblock there is its contract. */
  static updatedAtStamp(this: Pick<SequenceSemanticsHost, 'isMysql' | 'isSqlite' | 'knex'>): string | Knex.Raw {
    if (this.isSqlite) return new Date().toISOString();
    return this.isMysql ? this.knex.fn.now(MYSQL_DATETIME_PRECISION) : this.knex.fn.now();
  }

  /** The body of `SqlDriver#stampsUpdatedAt`; the method's docblock there is its contract. */
  static stampsUpdatedAt(this: Pick<SequenceSemanticsHost, 'tablesWithTimestamps' | 'updatedAtColumnState'>, object: string): boolean {
    if (this.tablesWithTimestamps.has(object)) return true;
    const state = this.updatedAtColumnState.get(object);
    return state === 'presumed' || state === 'present';
  }

  /** The body of `SqlDriver#updatedAtStampIsPresumed`; the method's docblock there is its contract. */
  static updatedAtStampIsPresumed(this: Pick<SequenceSemanticsHost, 'tablesWithTimestamps' | 'updatedAtColumnState'>, object: string): boolean {
    return !this.tablesWithTimestamps.has(object) && this.updatedAtColumnState.get(object) === 'presumed';
  }

  /** The body of `SqlDriver#update`; the method's docblock there is its contract. */
  static async update(this: Pick<SequenceSemanticsHost, 'applyTenantScope' | 'applyWriteColumnMap' | 'auditMissingTenant' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'keepSuppliedUpdatedAt' | 'remoteColumn' | 'rotatedUpdateById' | 'rotationShardsOf' | 'stampsUpdatedAt' | 'updateWithPresumedTimestamp' | 'updatedAtStamp' | 'updatedAtStampIsPresumed'>, object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    this.auditMissingTenant(object, 'update', options);
    const rotationShards = this.rotationShardsOf(object);
    if (rotationShards) return this.rotatedUpdateById(object, rotationShards, id, data, options);
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));
    // The primary key's column: its `external.columnMap` remote column on a
    // federated object (the mapping the payload above just went through), `id`
    // otherwise.
    const idColumn = this.remoteColumn(object, 'id', 'id');

    // One definition of the statement, so the speculative attempt, the fenced
    // retry and the plain path cannot drift in WHERE or tenant scope.
    const issue = (payload: Record<string, any>, issueOptions?: DriverOptions): Promise<number> => {
      const builder = this.getBuilder(object, issueOptions).where(idColumn, id);
      this.applyTenantScope(builder, object, issueOptions);
      return builder.update(payload) as unknown as Promise<number>;
    };

    if (this.stampsUpdatedAt(object) && !this.keepSuppliedUpdatedAt(formatted, options)) {
      // [#24835] A FRESH object, never `formatted`: `formatInput` and
      // `applyWriteColumnMap` are copy-on-write, so for a patch that needs no
      // coercion `formatted` IS the caller's `data`. Assigning the stamp onto it
      // put `updated_at` into the caller's patch — which ObjectQL publishes as
      // `DataEvent.changes` — and on Postgres/MySQL that value is a knex `Raw`
      // holding the client, its pool and a timer, so every reader that
      // serialises the event (the webhook outbox first) threw. `updateMany`'s
      // shape, below.
      const stamped = { ...formatted, updated_at: this.updatedAtStamp() };
      if (this.updatedAtStampIsPresumed(object)) {
        await this.updateWithPresumedTimestamp(object, stamped, options, issue);
      } else {
        await issue(stamped, options);
      }
    } else {
      await issue(formatted, options);
    }

    const readback = this.getBuilder(object, options).where(idColumn, id);
    this.applyTenantScope(readback, object, options);
    const updated = await readback.first();
    return this.formatOutput(object, updated) || null;
  }

  /** The body of `SqlDriver#insertOnlyUpsertColumns`; the method's docblock there is its contract. */
  static insertOnlyUpsertColumns(this: Pick<SequenceSemanticsHost, 'autoNumberFields' | 'physicalTableByObject' | 'remoteColumn' | 'resolveTenantField'>, object: string): Set<string> {
    // Same config resolution as `fillAutoNumberFields`: object name first,
    // then the storage-mapped table name.
    const tableName = this.physicalTableByObject[object] ?? StorageNameMapping.resolveTableName({ name: object } as any);
    const cfgs = this.autoNumberFields[object] || this.autoNumberFields[tableName] || [];
    const columns = new Set<string>(['created_at', this.remoteColumn(object, 'id', 'id')]);
    for (const cfg of cfgs) columns.add(this.remoteColumn(object, cfg.name, cfg.name));
    const tenantField = this.resolveTenantField(object);
    if (tenantField) columns.add(this.remoteColumn(object, tenantField, tenantField));
    return columns;
  }

  /**
   * [#21185] The merge leg's organization predicate on the dialects whose
   * `ON CONFLICT … DO UPDATE` takes a `WHERE`: the stored row's tenant column
   * is NOT DISTINCT from the one the statement would have inserted
   * (`excluded`). SQLite spells NULL-safe equality `IS`, PostgreSQL
   * `IS NOT DISTINCT FROM` — the two dialects this is reached on (MySQL fences
   * after the statement instead; see {@link upsert}).
   *
   * The target table is the write target's bare PHYSICAL name — the rotation
   * shard when one is current, the federated remote table otherwise — because
   * that is how both dialects name the INSERT target inside this clause.
   */
  static mergeLandsInWrittenOrganization(this: Pick<SequenceSemanticsHost, 'isPostgres' | 'knex' | 'physicalTableByObject'>, writeTable: string, column: string): Knex.Raw {
    const table = this.physicalTableByObject[writeTable] ?? writeTable;
    const notDistinct = this.isPostgres ? 'IS NOT DISTINCT FROM' : 'IS';
    return this.knex.raw(`?? ${notDistinct} ??`, [`${table}.${column}`, `excluded.${column}`]);
  }

  /**
   * [#8807] After a primary-key-targeted merge on a table that carries a rival
   * UNIQUE key: did the statement land on the identity this call supplied?
   *
   * # Why the absence of the row is an exact verdict, not a heuristic
   *
   * The statement returned without error, so it either INSERTED (the row now
   * carries this id) or MERGED into an existing row. `id` is insert-only on the
   * merge path since #8622 — it is stripped from the merge set — so a merge
   * never writes this id onto the row it lands on. Therefore:
   *
   *   row with this id exists  ⟺  the merge landed on the primary key
   *   row with this id absent  ⟺  it landed on some other UNIQUE key
   *
   * That is a biconditional, not an inference from a symptom, which is what
   * makes this check free of false refusals — the property the ruling's
   * excluded blanket option could not have.
   *
   * # Why the PRIMARY KEY row wins a multi-key collision — measured, not assumed
   *
   * The biconditional needs one more fact than #8622 to be exact: when the
   * incoming row collides on the primary key AND on a rival UNIQUE key at the
   * same time, the row carrying our id exists — so "row present" must still mean
   * "the statement landed on it", or a pre-existing row with our id would mask a
   * merge that went elsewhere. MySQL updates only the FIRST matched index, and
   * *which* one that is decides the question. Measured on live MySQL 8.0.46,
   * `PRIMARY KEY (id)` + `UNIQUE (email)` + `UNIQUE (tax_id)`, rows
   * `R1(id=R1, tax_id=T-1)` and `R2(id=R2, tax_id=T-2)`, inserting
   * `(id=R1, tax_id=T-2)` — which collides with R1 on the primary key and with
   * R2 on `uniq_tax`:
   *
   * ```
   * ROW_COUNT() = 2 (an update)
   * R1 -> title='MERGED'   ← the PRIMARY KEY row won
   * R2 -> untouched
   * ```
   *
   * So the primary key is matched first and the masking case does not arise.
   *
   * # Tenant scope — applied, and scoped to the tenant the row was WRITTEN under
   *
   * The read routes through {@link applyTenantScope} like every other read door
   * in this class (`check:tenant-chokepoint` asserts exactly that, on a bound
   * builder). The subtlety is *which* tenant to scope to, and using the caller's
   * active org would be wrong in one real case:
   *
   *  - **Ordinary tenanted call** — nothing supplied a tenant on the row, so
   *    `injectTenantOnInsert` stamped `options.tenantId` on it. Scoping to the
   *    written tenant IS scoping to the caller's org: identical to the wall
   *    every sibling door applies.
   *  - **Admin writing to a specific tenant via raw row data** — a documented
   *    authority ({@link injectTenantOnInsert}: "explicit values are never
   *    overwritten"). The row lands under the tenant the caller named, so a read
   *    scoped to the caller's *active* org would miss a row that really was
   *    written and refuse a correct write. Scoping to the written tenant does
   *    not.
   *  - **No tenancy field, or no tenant context at all** — `applyTenantScope`
   *    returns the builder untouched when `tenantId` is empty, by its own
   *    contract. That is what keeps the lifecycle archiver working: it calls
   *    `cold.upsert(object, row, ['id'])` with NO options, so this read is
   *    unscoped there, exactly as before.
   *
   * The verdict itself is tenant-independent regardless: `id` is the PRIMARY
   * KEY, so at most one row in the table can carry it.
   *
   * ⚠️ [#21185] The first two bullets no longer reach this method: a
   * tenant-scoped call on a tenanted object is fenced to its organization, and
   * on MySQL {@link assertMergeLandedInWrittenOrganization} runs in this
   * check's place, reading under the written tenant and carrying #8807's
   * verdict with it. What still arrives here is the third bullet — and there
   * the written tenant must NOT become a scope: the tenant column is now
   * insert-only, so a payload naming another organization than the stored
   * row's is a merge that keeps the row's organization (measured on MariaDB
   * 10.11 before this guard: the read scoped to the payload's tenant missed the
   * merged row and answered this method's cross-row refusal for a merge that
   * landed on the supplied id). So the written tenant is used only under a
   * tenant context, and a call without one reads unscoped.
   *
   * # The write target, not the object
   *
   * A rotation-sharded write lands in the current shard, so that is where the
   * row must be looked for. Reading the unsharded name would report every
   * rotated write as a cross-row merge.
   */
  static async assertMergeLandedOnSuppliedIdentity(this: Pick<SequenceSemanticsHost, 'applyTenantScope' | 'getBuilder' | 'physicalTableByObject' | 'remoteColumn'>, object: string, writeTable: string, id: string | number, rivals: PhysicalIndex[], writtenTenant: unknown, options?: DriverOptions): Promise<void> {
    const builder = this.getBuilder(writeTable, options);
    // Scoped to the tenant this row was written under (see the docblock): the
    // caller's org on an ordinary call, the explicitly named one on an admin
    // cross-tenant write, and a no-op when neither exists. `tenantIds` is
    // dropped deliberately — the group-union posture widens a READ to a
    // membership set, and this is an identity probe for ONE row, not a read.
    const tenantContext = options?.tenantId !== undefined && options?.tenantId !== null && options?.tenantId !== '';
    const scopeOptions: DriverOptions = {
      ...options,
      tenantId:
        tenantContext && typeof writtenTenant === 'string' && writtenTenant !== '' ? writtenTenant : options?.tenantId,
      tenantIds: undefined,
    };
    this.applyTenantScope(builder, object, scopeOptions);
    // The key's column: its `external.columnMap` remote column on a federated
    // object, `id` otherwise.
    const idColumn = this.remoteColumn(object, 'id', 'id');
    const landed = await builder.where(idColumn, id).first(idColumn);
    if (landed) return;
    const tableName = this.physicalTableByObject[writeTable] ?? writeTable;
    throw refuseCrossRowIdentityMerge(object, tableName, id, rivals);
  }

  /**
   * [#21185] MySQL: after a tenant-scoped upsert's statement, did it land on a
   * row of the organization the row is WRITTEN under? Runs inside the same
   * transaction as the statement, so its throw rolls the write back.
   *
   * # Why MySQL needs a check where the other dialects need none
   *
   * SQLite and PostgreSQL fence the merge leg inside the statement
   * (`ON CONFLICT … DO UPDATE SET … WHERE` the stored tenant column equals the
   * written one — see {@link upsert}), so a row of another organization is
   * never written at all. MySQL's `ON DUPLICATE KEY UPDATE` takes no `WHERE`
   * (knex refuses to compile one: `.onConflict().merge().where() is not
   * supported for mysql`). This is #8807's mechanism, reused as ruled: the
   * statement and a read of the landed row run as one unit of work, and the
   * read's failure undoes the write.
   *
   * # The read, and why its absence is exact
   *
   * The landed row is looked up by the values it matched on (`matchOn`, the
   * conflict-key values the statement sent — or `id` when one of them is
   * empty, the same choice the read-back makes), under the written tenant
   * EXACTLY: {@link applyTenantScope} for the chokepoint, plus equality on the
   * tenant column, which closes that scope's NULL-organization arm. The tenant
   * column is insert-only ({@link insertOnlyUpsertColumns}), so a merge never
   * writes the written tenant onto the row it lands on. Therefore a row
   * matching those values under the written tenant exists exactly when the
   * statement inserted there or merged into a row that was already there; its
   * absence means the merge landed on a row of another organization, or on a
   * row with none.
   *
   * # When #8807's check is owed too (`rivals` given)
   *
   * A primary-key target on a table carrying a rival UNIQUE key. `matchOn` is
   * then the supplied `id`, so a found row is also #8807's verdict — the merge
   * landed on the supplied identity — and that check is subsumed. A MISSING row
   * has two causes the caller must be told apart, because they are two
   * different refusals:
   *
   *  - the merge landed through a rival key on a row of the WRITTEN
   *    organization — #8807's condition, answered with its own sentence
   *    ({@link refuseCrossRowIdentityMerge}), exactly as before this card;
   *  - it landed on a row of another organization — on the primary key (that
   *    row wins a multi-key collision, measured for #8807) or through a rival
   *    key — answered `UNIQUE_VIOLATION`.
   *
   * They are told apart by reading each rival key's sent values under the
   * written tenant: a merge through that key left the row carrying them, in
   * the written organization. Only a rival whose every column is in the
   * payload can be read this way (a hash-shadow carrier's generated column is
   * not); when none can, the answer is `UNIQUE_VIOLATION` — a refusal either
   * way, and the write is rolled back either way.
   *
   * ⛔ Nothing read here reaches the caller: the refusal names no organization
   * and no value of the row it landed on.
   */
  static async assertMergeLandedInWrittenOrganization(this: Pick<SequenceSemanticsHost, 'applyTenantScope' | 'getBuilder' | 'physicalTableByObject' | 'remoteColumn'>, object: string, writeTable: string, mergeKeys: string[], matchOn: Record<string, unknown>, sent: Record<string, unknown>, guard: { column: string; value: unknown }, identity: { id: string | number; rivals: PhysicalIndex[] } | null, options?: DriverOptions): Promise<void> {
    // The tenant scope of a ONE-row probe: the written tenant, with
    // `tenantIds` dropped for #8807's reason (the group-union posture widens a
    // READ to a membership set; this asks about one organization).
    const scopeOptions: DriverOptions = { ...options, tenantId: String(guard.value), tenantIds: undefined };

    // Every probe selects the key's column — the `external.columnMap` remote
    // column on a federated object, `id` otherwise.
    const idColumn = this.remoteColumn(object, 'id', 'id');
    const landedProbe = this.getBuilder(writeTable, options);
    this.applyTenantScope(landedProbe, object, scopeOptions);
    landedProbe.where(guard.column, guard.value as any);
    for (const [column, value] of Object.entries(matchOn)) landedProbe.where(column, value as any);
    if (await landedProbe.first(idColumn)) return;

    if (identity) {
      for (const rival of identity.rivals) {
        const probeable = rival.columns.length > 0 && rival.columns.every((c) => sent[c] !== undefined && sent[c] !== null);
        if (!probeable) continue;
        const rivalProbe = this.getBuilder(writeTable, options);
        this.applyTenantScope(rivalProbe, object, scopeOptions);
        rivalProbe.where(guard.column, guard.value as any);
        for (const column of rival.columns) rivalProbe.where(column, sent[column] as any);
        if (await rivalProbe.first(idColumn)) {
          const tableName = this.physicalTableByObject[writeTable] ?? writeTable;
          throw refuseCrossRowIdentityMerge(object, tableName, identity.id, identity.rivals);
        }
      }
    }
    throw refuseUpsertConflictOutsideWrittenOrganization(object, mergeKeys);
  }

  /** The body of `SqlDriver#upsert`; the method's docblock there is its contract. */
  static async upsert(this: Pick<SequenceSemanticsHost, 'applyTenantScope' | 'applyWriteColumnMap' | 'assertConflictTargetBackedWithoutClause' | 'assertConflictTargetHonoured' | 'assertMergeLandedInWrittenOrganization' | 'assertMergeLandedOnSuppliedIdentity' | 'auditMissingTenant' | 'collidingAutoNumberReservations' | 'fillAutoNumberFields' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'injectTenantOnInsert' | 'insertOnlyUpsertColumns' | 'isMysql' | 'isOracle' | 'knex' | 'mergeLandsInWrittenOrganization' | 'resolveTenantField' | 'resyncSequenceToDataMax' | 'remoteColumn' | 'rotationWriteTarget' | 'stampInsertTimestamps' | 'stampUpsertUpdatedAt' | 'upsertTenantGuard'>, object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>> {
    if (this.isOracle) throw oracleUpsertUnsupportedError(object);
    const { _id, ...rest } = data;
    const toUpsert = { ...rest };

    if (_id !== undefined && toUpsert.id === undefined) {
      toUpsert.id = _id;
    } else if (toUpsert.id === undefined) {
      toUpsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    this.auditMissingTenant(object, 'upsert', options);
    this.injectTenantOnInsert(object, toUpsert, options);

    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];
    // The conflict target as the statement names it: each key's
    // `external.columnMap` remote column on a federated object, the field
    // itself otherwise. The payload (`formatted` / `sent` below) is already in
    // column form after `applyWriteColumnMap`, the physical indexes the MySQL
    // pre-flight reads are columns, and so is the read-back. `mergeKeys` stays
    // the FIELDS, for the refusals the caller reads. On an object without a
    // map the two are the same list.
    const conflictColumns = mergeKeys.map((k) => this.remoteColumn(object, k, k));
    const idColumn = this.remoteColumn(object, 'id', 'id');

    // [#21185] The organization fence (ADR-0131 D8: the tenant predicate
    // reaches every driver door, and the merge leg of an upsert was the one it
    // did not). The conflict target is resolved against the WHOLE table — the
    // primary key and a `unique: 'global'` column are installation-wide — so
    // the row a tenant-scoped call collides with can belong to an organization
    // the caller cannot read, and the merge leg used to write onto it, tenant
    // column included. With a fence the merge may only land on a row whose
    // stored tenant column equals the written one; a conflict anywhere else is
    // refused with `UNIQUE_VIOLATION` and writes nothing. `null` for a call with
    // no tenant context, which keeps the merge and relies on the tenant column
    // being insert-only ({@link insertOnlyUpsertColumns}). See
    // {@link upsertTenantGuard}.
    const tenantGuard = this.upsertTenantGuard(object, toUpsert, options);

    // [#8621, #8755, #8807] Pre-flight the conflict target — see
    // {@link assertConflictTargetHonoured} for the mechanism and why it is
    // MySQL-only. Two placement facts, both load-bearing:
    //
    //  - ⚠️ It now runs whether or not the CALLER named a target, and the
    //    reasoning that used to stop at the caller-named case is superseded
    //    rather than merely widened. That reasoning was *"a probe on the default
    //    path could only ever confirm what the driver just built"*, and it was
    //    right about the question #8621/#8755 were asking — "is `['id']` backed?"
    //    has one possible answer on a table this driver created. #8807 asks a
    //    different question of the same introspection — "does anything ELSE on
    //    this table absorb a collision?" — and that one is genuinely unknown
    //    until read. The read is cached per table
    //    ({@link physicalKeyIndexes}), so the hot path pays it once, and the
    //    verdict it returns is not a refusal: see below.
    //  - It runs BEFORE the retry loop, therefore before
    //    `fillAutoNumberFields`. Refusing after it would burn an autonumber
    //    reservation for a statement that never executes — a visible gap in an
    //    externally meaningful sequence, handed out for a rejected call.
    const callerNamed = !!(conflictKeys && conflictKeys.length > 0);
    const preflight = this.isMysql
      ? await this.assertConflictTargetHonoured(object, conflictColumns, callerNamed)
      : { verifyIdentity: false };

    // [#8807] The primary-key-targeted merge on a table that carries a rival
    // UNIQUE key: MySQL may land it on a row this call never identified, and
    // nothing before the statement can tell whether it will. So the statement
    // and the identity check run as ONE unit of work, and the check's failure
    // is what rolls the wrong write back.
    //
    // The accept set moves for exactly the calls that corrupt data: a merge
    // that lands on the supplied identity — every insert, and every legitimate
    // re-upsert of the same row — passes the check untouched, because `id` is
    // insert-only (#8622) and therefore a row merged on the primary key always
    // still carries it.
    const verifyIdentity = preflight.verifyIdentity === true;

    // [#21185] MySQL's fence is a check after the statement, inside the same
    // unit of work — `ON DUPLICATE KEY UPDATE` takes no `WHERE` — so it is owed
    // whenever the call is fenced, not only when a rival UNIQUE key exists. See
    // {@link assertMergeLandedInWrittenOrganization}.
    const mysqlFence = this.isMysql && tenantGuard !== null;
    const checkAfterStatement = verifyIdentity || mysqlFence;

    // #6943. Measured: `upsert` does NOT share `bulkCreate`'s shape. It is
    // single-row, so a stale counter costs it exactly one burned number per
    // call — the same shape `create()` had before #5495, for the same reason
    // (no re-seed, no retry). `ON CONFLICT (mergeKeys) DO UPDATE` absorbs a
    // conflict on the merge key only; the tenanted autonumber lives under a
    // DIFFERENT unique index, so its violation is still raised and still
    // reaches here. The remedy is therefore `create()`'s, verbatim: re-seed and
    // re-issue, but only when the collision is provably this counter's
    // ({@link collidingAutoNumberReservations}), and only outside a caller
    // transaction (inside one the sequence UPDATE rolls back with the refused
    // INSERT, so nothing is burned and there is nothing to repair — measured).
    const mayRetry = options?.transaction === undefined;
    // The row the last attempt SENT, in storage form: the read-back below
    // looks the landed row up by its conflict-key values.
    let sent: Record<string, any> = {};
    for (let attempt = 0; ; attempt++) {
      const reservations = await this.fillAutoNumberFields(object, toUpsert, options);

      const formatted = this.applyWriteColumnMap(object, this.formatInput(object, toUpsert));
      sent = formatted;
      this.stampInsertTimestamps(object, formatted);
      // [#11176] …and the same slot filled on Postgres/MySQL, where the line
      // above returns early. Without it `updated_at` is not in `formatted`, so
      // it is not in the merge set built below, so the merge branch leaves the
      // row reading its INSERT-time default forever. See
      // {@link stampUpsertUpdatedAt} — no-op on SQLite (already filled) and on
      // any object whose `updated_at` column this driver has not OBSERVED.
      this.stampUpsertUpdatedAt(object, formatted);

      // Rotation: conflict-merge is scoped to the CURRENT shard (telemetry is
      // effectively append-only; a cross-shard upsert would need a probe-first
      // strategy nothing on the platform requires today).
      const writeTable = this.rotationWriteTarget(object) ?? object;
      // `created_at` is insert-only — never overwrite it when an existing row is
      // merged on conflict (the stamped/seeded value belongs to the original
      // insert). [#7011] `auto_number` columns are insert-only for the same
      // reason, and a stronger one: the number is an externally visible
      // business identifier once assigned (`CASE-00001`), and
      // `fillAutoNumberFields` above reserved a FRESH value before the
      // statement could know it would merge — leaving these columns in the
      // merge set rewrote the existing row's number on every merge-path upsert
      // (measured on a healthy counter: create → CASE-00001, two upserts of
      // the same id → CASE-00002 then CASE-00003, one row throughout). The
      // exclusion is unconditional — an explicit payload value does not
      // renumber on merge either; `update()` is the deliberate renumbering
      // path. The reservation itself still happens on the merge path (a gap,
      // not a rewrite) — that pre-burn half is #6943's reseed family, not
      // this exclusion's.
      //
      // [#8622] `id` is insert-only for the SAME argument at its strongest.
      // `upsert` mints a nanoid whenever the caller supplies none (just above),
      // so the merge set carried `id = excluded.id` — the freshly minted id of
      // the insert that LOST. On the default `['id']` conflict target that
      // clause is a no-op (both sides are the same value), which is precisely
      // why it stayed invisible; the moment `conflictKeys` names a business key
      // the merged row's identity is silently replaced. Measured here on SQLite
      // and live Postgres 16.13, and on live MySQL 8.0.46 in #8592 — a
      // dialect-independent defect, because the mechanism is the merge set this
      // driver builds, not anything a server decides:
      //
      //   upsert({email:'x@b.com', title:'first'},  ['email'])  -> id=rSxhabt0…
      //   upsert({email:'x@b.com', title:'second'}, ['email'])  -> id=hXqcSC45…
      //                                              ONE row, NEW primary key.
      //
      // `id` is what relationships, audit records, external id mappings and any
      // client-held reference point at, so this dangles every one of them with
      // no error on any dialect. The exclusion is unconditional for #7011's
      // reason: an explicit payload `id` (or its `_id` alias, folded into `id`
      // before `formatted` is built) does not re-key on merge either. `update()`
      // is the deliberate path — it writes exactly the columns it is handed,
      // `id` included.
      //
      // Everything else (incl. `updated_at`) merges as before, so an upsert
      // that updates a row still advances `updated_at`. [#11176] That last
      // clause used to hold on SQLite ONLY: it needs `updated_at` to BE in
      // `formatted`, which before this card nothing put there on Postgres or
      // MySQL. `stampUpsertUpdatedAt` above is what now makes the sentence true
      // on all three.
      const insertOnlyColumns = this.insertOnlyUpsertColumns(object);
      const mergeColumns = Object.keys(formatted).filter((c) => !insertOnlyColumns.has(c));

      // [#8622] Excluding `id` made a branch REACHABLE that could not fire
      // before, and the bare `merge()` below is merge-ALL: it re-admits every
      // insert-only column. Measured on live Postgres with an object whose only
      // non-`id` column is an `auto_number` — `upsert({ id: seeded }, ['id'])`
      // left `mergeColumns` empty and the merge-ALL fallback rewrote the row's
      // `case_no` from `0003` to `0004`, defeating #7011's exclusion. (SQLite
      // never reached it: `stampInsertTimestamps` puts a mergeable `updated_at`
      // in the payload there. [#11176] `stampUpsertUpdatedAt` now does the same
      // on Postgres and MySQL, so a TIMESTAMPED object no longer reaches this
      // fallback on any dialect either — it is still reachable for an object
      // with no observed `updated_at` column.)
      //
      // The remedy keeps the emitted SQL byte-identical to what `main` emits
      // for this shape. Falling back to the CONFLICT-TARGET columns present in
      // the payload is a provable no-op — a conflict means those columns matched,
      // so `excluded.<target>` IS the stored value — and it reproduces exactly
      // the `merge(['id'])` `main` produces here, because `id` was `main`'s only
      // mergeable column in this case. So this PR's net behavioural delta on the
      // degenerate path is nil rather than a #7011 regression.
      //
      // [#8740] When the payload carries no conflict-target column either, there
      // is nothing the merge leg may write, and the statement is a plain INSERT
      // with no conflict clause: a collision surfaces as the driver's own
      // unique-violation error and the stored row is left as it was. This used
      // to fall back to knex's bare `merge()`, which is merge-ALL on every
      // dialect: it re-admitted every insert-only column the lines above
      // exclude. ⛔ Not `ignore()` either: knex lowers it on MySQL to
      // `insert ignore`, which swallows unrelated errors and drops the conflict
      // target. See {@link withUpsertConflictClause}.
      const noopMergeColumns = Object.keys(formatted).filter((c) => conflictColumns.includes(c));
      const columnsToMerge = mergeColumns.length > 0 ? mergeColumns : noopMergeColumns;
      // …and that plain INSERT still refuses a conflict target nothing backs,
      // as every dialect does when there is something to merge.
      if (columnsToMerge.length === 0) await this.assertConflictTargetBackedWithoutClause(object, writeTable, conflictColumns);

      // [#21185] The fence for THIS attempt: the tenant column, and the value
      // the row is written under in storage form (what the statement sends).
      const fence = tenantGuard && {
        column: tenantGuard.column,
        value: formatted[tenantGuard.column] ?? tenantGuard.value,
      };

      // The statement, plus [#8807]'s identity check when one is owed. The
      // builder is built HERE rather than above the comment block so it can be
      // bound to whichever transaction this write runs on — the caller's, the
      // one opened just below, or none at all. The emitted INSERT is otherwise
      // unchanged.
      const runStatement = async (writeOptions?: DriverOptions): Promise<void> => {
        // Bound in two steps, not chained: this is the INSERT door, and
        // `check:tenant-chokepoint` classifies a builder as a write by seeing
        // `.insert` used on the BINDING. Collapsing these into one expression
        // hides that from the gate and the door reads as an unscoped read —
        // measured when this closure was first extracted. Insert-side tenancy
        // is `injectTenantOnInsert`'s job (called above), which is exactly why
        // this one is deliberately not scoped.
        const builder = this.getBuilder(writeTable, writeOptions);
        const insertion = builder.insert(formatted);
        const { statement, merges } = withUpsertConflictClause(insertion, conflictColumns, columnsToMerge);
        // [#21185] SQLite and PostgreSQL: the fence is a predicate INSIDE the
        // merge statement — `… DO UPDATE SET … WHERE` the stored tenant column
        // equals the written one — so a conflict on a row of another
        // organization (or of none) leaves that row untouched, atomically, with
        // no added round trip. The read-back below then finds no row under the
        // written organization, and that is where the call refuses. NULL-safe
        // on both (`IS` on SQLite, `IS NOT DISTINCT FROM` on PostgreSQL); the
        // written value is never NULL here, so a stored NULL is "distinct", and
        // a platform row with no organization is fenced off too. The target
        // table is named by its bare physical name, which both dialects accept
        // for the INSERT target in this clause, schema-qualified or not.
        // MySQL takes no `WHERE` here; its fence runs after the statement. A
        // plain INSERT ([#8740]) has no merge leg to fence.
        await (merges && fence && !this.isMysql
          ? statement.where(this.mergeLandsInWrittenOrganization(writeTable, fence.column))
          : statement);
        if (mysqlFence) {
          // [#21185] One read, under the written tenant exactly; #8807's
          // identity verdict rides on it when a rival key made one owed.
          const matchOn: Record<string, unknown> = conflictColumns.every((c) => formatted[c] !== undefined && formatted[c] !== null)
            ? Object.fromEntries(conflictColumns.map((c) => [c, formatted[c]]))
            : { [idColumn]: toUpsert.id };
          await this.assertMergeLandedInWrittenOrganization(
            object,
            writeTable,
            mergeKeys,
            matchOn,
            formatted,
            fence!,
            verifyIdentity ? { id: toUpsert.id, rivals: preflight.rivals ?? [] } : null,
            writeOptions,
          );
        } else if (verifyIdentity) {
          // The tenant the row was WRITTEN under, read off the payload after
          // `injectTenantOnInsert` has run — the caller's org on an ordinary
          // call, an explicitly supplied one on an admin cross-tenant write.
          const tenantField = this.resolveTenantField(object);
          await this.assertMergeLandedOnSuppliedIdentity(
            object,
            writeTable,
            toUpsert.id,
            preflight.rivals ?? [],
            tenantField ? toUpsert[tenantField] : undefined,
            writeOptions,
          );
        }
      };

      try {
        if (checkAfterStatement && options?.transaction === undefined) {
          // [#8807] No caller transaction, so the driver opens one: the check
          // is only worth making if its failure can UNDO the write it judged,
          // and an autocommitted statement is already permanent by the time the
          // row can be read back. Scoped to the calls a check is owed on —
          // `verifyIdentity`, and since #21185 every fenced MySQL call — so the
          // ordinary upsert (SQLite, PostgreSQL, and a MySQL call with neither)
          // keeps its single autocommitted round trip.
          //
          // Inside a caller transaction #8807's wrapper is deliberately NOT
          // added: the statement is already transactional, and throwing hands
          // the rollback decision to the owner of that transaction, exactly as
          // the autonumber path above reasons about the same boundary.
          await this.knex.transaction(async (trx) => {
            await runStatement({ ...options, transaction: trx });
          });
        } else if (mysqlFence) {
          // [#21185] …but the organization fence does not hand that decision
          // over. A cross-organization merge is never the caller's to keep, so
          // inside a caller transaction the statement and its check run in a
          // nested transaction — a SAVEPOINT on MySQL — and the check's throw
          // rolls back to it: the other organization's row is restored before
          // the refusal reaches the caller, whatever the caller then does with
          // its own transaction.
          await (options!.transaction as Knex.Transaction).transaction(async (savepoint) => {
            await runStatement({ ...options, transaction: savepoint });
          });
        } else {
          await runStatement(options);
        }
        break;
      } catch (error) {
        // [#21185] The fence's refusal is final: it is not the server's error,
        // so neither the unbacked-target recogniser nor the autonumber re-seed
        // below has anything to say about it, and a retry would be refused the
        // same way. The pair is this driver's own envelope; no dialect error
        // carries it.
        if (isUpsertFenceRefusal(error)) throw error;
        // [#8445] Classified BEFORE the autonumber retry logic, for three
        // reasons that all point the same way. It is not an autonumber
        // collision — `collidingAutoNumberReservations` gates on
        // `isUniqueViolationError`, and this error is not a unique violation:
        // no index existed for anything to violate.
        //
        // ⚠️ [#8567] That gate does NOT agree, and this comment used to claim it
        // did ("which is false for this error"). Measured on the real SQLite
        // error: `isUniqueViolationError` returns TRUE, because SQLite's
        // missing-index sentence ends `…PRIMARY KEY or UNIQUE constraint` and
        // the shared vocabulary matches the word pair `unique constraint`
        // wherever it appears. Filed as #8590. So the ORDERING here is
        // load-bearing rather than merely tidy: move this line below the branch
        // and the reservation probe really does run — querying the sequences
        // table for a collision that cannot exist, then rethrowing the raw
        // error. Recognising first is what makes that unreachable.
        //
        // It is also not transient — the same statement fails identically on
        // every attempt, so a retry is a wasted round trip by construction. And
        // it is the only placement that envelopes BOTH exits below: a refusal
        // recognised after the branch would still escape raw whenever
        // `mayRetry` is false.
        if (isUnbackedConflictTargetError(error)) throw refuseUnbackedConflictTarget(object, mergeKeys, error);
        if (!mayRetry || attempt >= AUTONUMBER_COLLISION_RETRIES) throw error;
        const colliding = await this.collidingAutoNumberReservations(error, reservations, options);
        if (colliding.length === 0) throw error;
        for (const reservation of colliding) {
          await this.resyncSequenceToDataMax(reservation);
          // Clear only what collided, so the next pass regenerates exactly
          // those fields — a reservation that did NOT collide keeps its value
          // rather than burning a second number for nothing. (Safe here in a
          // way it is NOT for a batch: one row cannot collide with itself.
          // See {@link bulkCreate}.)
          delete toUpsert[reservation.field];
        }
      }
    }

    // [#21166] Read back the row the statement landed on, by the identity it
    // MATCHED on: the conflict-key values. Reading it back by `toUpsert.id`
    // answers the wrong row on exactly the call #8622 protects: a merge on a
    // business key keeps the stored row's `id`, so the payload's `id` (or the
    // nanoid minted above) names no row, the read finds nothing, and the
    // fallback below answered the PAYLOAD. Measured on SQLite and live
    // Postgres 16: the row stored as `row-a` answered `id: 'row-NEW'`, an id
    // no stored row has. The conflict-key values name the landed row on both
    // legs: the inserted row carries them, and the merged row is the one that
    // matched them. A conflict key the row leaves empty cannot have matched
    // (NULL never conflicts), so the statement inserted and the row carries
    // `toUpsert.id`. On the default `['id']` target the two readings are the
    // same query. The tenant scope is applied to either, as before.
    const matchedOn = conflictColumns.every((c) => sent[c] !== undefined && sent[c] !== null);
    const readback = this.getBuilder(object, options);
    if (matchedOn) for (const c of conflictColumns) readback.where(c, sent[c]);
    else readback.where(idColumn, toUpsert.id);
    if (tenantGuard) {
      // [#21185] A fenced call reads back under the WRITTEN organization
      // EXACTLY: the chokepoint scope for that tenant (`tenantIds` dropped, as
      // for #8807's one-row probe), plus equality on the tenant column, which
      // closes the scope's NULL-organization arm. A row the fence left alone —
      // another organization's, or a platform row with none — is therefore not
      // found, and that absence IS the refusal: the statement wrote nothing
      // (SQLite / PostgreSQL), or rolled back (MySQL, where the same read ran
      // inside the transaction first). Scoping to the caller's ACTIVE org
      // instead would miss a row an admin really wrote under another
      // organization and refuse a correct write.
      const writtenTenant = sent[tenantGuard.column] ?? tenantGuard.value;
      this.applyTenantScope(readback, object, { ...options, tenantId: String(writtenTenant), tenantIds: undefined });
      readback.where(tenantGuard.column, writtenTenant);
      const landed = await readback.first();
      if (!landed) throw refuseUpsertConflictOutsideWrittenOrganization(object, mergeKeys);
      return this.formatOutput(object, landed) || landed;
    }
    this.applyTenantScope(readback, object, options);
    const result = await readback.first();
    return this.formatOutput(object, result) || toUpsert;
  }

  /** The body of `SqlDriver#delete`; the method's docblock there is its contract. */
  static async delete(this: Pick<SequenceSemanticsHost, 'applyTenantScope' | 'auditMissingTenant' | 'getBuilder' | 'remoteColumn' | 'rotationShardsOf'>, object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    this.auditMissingTenant(object, 'delete', options);
    const rotationShards = this.rotationShardsOf(object);
    if (rotationShards) {
      // The row lives in exactly one shard — probe newest-first.
      for (const shard of rotationShards) {
        const builder = this.getBuilder(shard, options).where('id', id);
        this.applyTenantScope(builder, object, options);
        const count = await builder.delete();
        if (count > 0) return true;
      }
      return false;
    }
    // The primary key's column — the `external.columnMap` remote column on a
    // federated object (as `update` above), `id` otherwise.
    const builder = this.getBuilder(object, options).where(this.remoteColumn(object, 'id', 'id'), id);
    this.applyTenantScope(builder, object, options);
    const count = await builder.delete();
    return count > 0;
  }
}
