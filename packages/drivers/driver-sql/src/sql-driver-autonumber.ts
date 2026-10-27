// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 11] The autonumber sequence path of `SqlDriver`: the counter
 * read-and-advance `getNextSequenceValue`, the per-row fill
 * `fillAutoNumberFields`, the issue-ahead door `issueAutonumbers`, the
 * bootstrap reading `maxAutonumberCounter`, and the #5495 collision re-seed
 * (`collidingAutoNumberReservations`, `resyncSequenceToDataMax`). They moved
 * out of `sql-driver.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same counter key, the same tenant bucket, the same lock, the
 * same bootstrap and the same re-seed.
 *
 * What did NOT move, and why:
 *
 *  - `ensureSequencesTable` and `ensureSequencesKeyHashShape` write the
 *    driver's fields, and the series keeps a body that writes `this` in the
 *    class.
 *  - `autoNumberValueExists` and `scanMaxNumericTail` each hold a
 *    tenant-column predicate that `check:tenant-chokepoint`'s ADR-0131 D8 rule
 *    counts, and that gate scans the driver files, not this module.
 *  - The small members the sequence-semantics block names (the counter key,
 *    the tenant bucket, the table definition and the two getters) and
 *    `attemptWithoutPoisoning` pay nothing to move.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps every
 * method, because the published `dist/*.d.ts` lists each one's name,
 * docblock and position. `TursoDriver` overrides `getNextSequenceValue`,
 * `autoNumberValueExists` and `resyncSequenceToDataMax`, and each override
 * calls `super` on its local path. Each body is now one literal of exactly the
 * {@link AutonumberHost} members that method reads, plus a `.call`. The five
 * `async` methods are no longer `async`: each returns the moved function's own
 * promise. `maxAutonumberCounter` reads no member, so its method calls the
 * function directly.
 *
 * Methods go as closures that call them on the driver at call time, so a
 * subclass override is still the one a body reaches: `fillAutoNumberFields`
 * reaches `TursoDriver`'s `getNextSequenceValue`, and
 * `collidingAutoNumberReservations` and `issueAutonumbers` reach its
 * `autoNumberValueExists` and `resyncSequenceToDataMax`, as they did when
 * they called `this.…`. A test spy on the instance is reached the same way. The fields `autoNumberFields`,
 * `issuedAutoNumbers`, `knex`, `physicalTableByObject` and
 * `sequencesHasKeyHash` go as GETTERS, so each read happens when the body
 * makes it, as it did on the class.
 *
 * The one module-level declaration the bodies read that is not imported from
 * elsewhere stays in `sql-driver.ts`: `SEQUENCES_TABLE`. It gained `export`
 * there and is imported here, because `ensureSequencesTable`,
 * `ensureSequencesKeyHashShape` and the `sequencesTableName` getter still read
 * it. The module cycle is evaluation-safe because the value import is read
 * only inside a function body, never while the two modules are first
 * evaluated. `index.ts` re-exports nothing from this module, so the published
 * surface does not move.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import { missingFieldValues, readAutonumberCounter, renderAutonumber } from '@objectstack/spec/data';
import { StorageNameMapping } from '@objectstack/spec/system';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';
import type { Knex } from 'knex';
import { GLOBAL_TENANT } from './schema-drift.js';
import type { AutoNumberReservation, SqlDriver } from './sql-driver.js';
import { SEQUENCES_TABLE } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface AutonumberHost {
  attemptWithoutPoisoning: SqlDriver['attemptWithoutPoisoning'];
  autoNumberCounterKey: SqlDriver['autoNumberCounterKey'];
  readonly autoNumberFields: SqlDriver['autoNumberFields'];
  autoNumberValueExists: SqlDriver['autoNumberValueExists'];
  collidingAutoNumberReservations: SqlDriver['collidingAutoNumberReservations'];
  ensureSequencesTable: SqlDriver['ensureSequencesTable'];
  fillAutoNumberFields: SqlDriver['fillAutoNumberFields'];
  getNextSequenceValue: SqlDriver['getNextSequenceValue'];
  injectTenantOnInsert: SqlDriver['injectTenantOnInsert'];
  readonly issuedAutoNumbers: SqlDriver['issuedAutoNumbers'];
  readonly knex: SqlDriver['knex'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  resolveSequenceTenantId: SqlDriver['resolveSequenceTenantId'];
  resyncSequenceToDataMax: SqlDriver['resyncSequenceToDataMax'];
  scanMaxNumericTail: SqlDriver['scanMaxNumericTail'];
  sequenceKeyHash: SqlDriver['sequenceKeyHash'];
  readonly sequencesHasKeyHash: SqlDriver['sequencesHasKeyHash'];
}

/** The body of `SqlDriver#getNextSequenceValue`; the method's docblock there is its contract. */
export async function getNextSequenceValue(this: Pick<AutonumberHost, 'attemptWithoutPoisoning' | 'ensureSequencesTable' | 'knex' | 'resolveSequenceTenantId' | 'scanMaxNumericTail' | 'sequenceKeyHash' | 'sequencesHasKeyHash'>, object: string, tableName: string, field: string, prefix: string, tenantField: string | null, tenantId: string | null, parentTrx?: Knex.Transaction, scope = '', suffix = ''): Promise<number> {
  // Pass the caller's transaction so a cold-cache first write inside a batch
  // transaction ensures the table on the right connection instead of dead-
  // locking on a second one (SQLite pool max=1). `initObjects` normally warms
  // this up front, making the call a no-op — this only bites the lazy path.
  // The bucket first: an organization-less row on a tenant table is refused
  // here (ADR-0131 D9), before the lazy DDL below or any counter read.
  const resolvedTenantId = this.resolveSequenceTenantId(tenantField, tenantId, tableName, field);
  await this.ensureSequencesTable(parentTrx);
  if (scope !== '' && !this.sequencesHasKeyHash) {
    // The legacy sequences table could not be migrated to the key_hash shape,
    // so it cannot represent per-scope counters. Fail with a clear, actionable
    // message instead of corrupting the single legacy counter.
    throw new Error(
      `Cannot generate a per-scope autonumber for "${object}.${field}": the ` +
        `${SEQUENCES_TABLE} table is still the legacy shape. ` +
        `Migrate it to the key_hash shape before using date/{field}/per-parent formats.`,
    );
  }
  // `scope` (rendered date/field prefix, boundary-delimited) gives each
  // period/group its own counter; '' keeps the single global counter for
  // fixed-prefix formats. `prefix` is the full rendered prefix used to
  // bootstrap from existing data. The row is keyed by a hash of the composite;
  // on an un-migrated legacy table only fixed-prefix (scope '') reaches here,
  // so fall back to the original `(object, tenant_id, field)` key for it.
  const key = this.sequencesHasKeyHash
    ? { key_hash: this.sequenceKeyHash(tableName, resolvedTenantId, field, scope) }
    : { object: tableName, tenant_id: resolvedTenantId, field };
  const insertRow = this.sequencesHasKeyHash
    ? { ...key, object: tableName, tenant_id: resolvedTenantId, field, scope }
    : { ...key };

  const runner: Knex | Knex.Transaction = parentTrx ?? this.knex;

  return runner.transaction(async (trx) => {
    // Lock the row (no-op on SQLite, real lock on Postgres/MySQL).
    //
    // Speculative, so it runs under a savepoint: `.forUpdate()` on a MISSING
    // row does NOT throw on Postgres (measured: returns zero rows), so the
    // fallback below is unreachable for the reason the old comment gave. It
    // IS reachable for lock-level failures — deadlock (40P01), lock/statement
    // timeout (55P03/57014) — and without the savepoint each of those turned
    // into a `25P02` from the fallback SELECT, masking the real error.
    let existing: any;
    const locked = await this.attemptWithoutPoisoning(trx, (scoped) =>
      scoped(SEQUENCES_TABLE).where(key).forUpdate().first(),
    );
    if (locked.ok) {
      existing = locked.value;
    } else {
      // Fall back to a plain SELECT then rely on transaction isolation.
      existing = await trx(SEQUENCES_TABLE).where(key).first();
    }

    if (!existing) {
      const seedMax = await this.scanMaxNumericTail(
        trx,
        tableName,
        field,
        prefix,
        tenantField,
        resolvedTenantId === GLOBAL_TENANT ? null : resolvedTenantId,
        suffix,
      );
      const initial = seedMax + 1;
      const inserted = await this.attemptWithoutPoisoning(trx, (scoped) =>
        scoped(SEQUENCES_TABLE).insert({ ...insertRow, last_value: initial }),
      );
      if (inserted.ok) return initial;
      // Another writer raced us to the first INSERT. Fall through to
      // the UPDATE path with the now-present row. This `SELECT … FOR UPDATE`
      // blocks until the winner commits, so it sees the committed counter.
      existing = await trx(SEQUENCES_TABLE).where(key).forUpdate().first();
      if (!existing) throw inserted.error;
    }

    const next = Number(existing.last_value) + 1;
    await trx(SEQUENCES_TABLE).where(key).update({ last_value: next, updated_at: this.knex.fn.now() });
    return next;
  });
}

/** The body of `SqlDriver#fillAutoNumberFields`; the method's docblock there is its contract. */
export async function fillAutoNumberFields(this: Pick<AutonumberHost, 'autoNumberFields' | 'getNextSequenceValue' | 'physicalTableByObject'>, object: string, row: Record<string, any>, options?: DriverOptions): Promise<AutoNumberReservation[]> {
  // Scan/seed the physical (remote) table for an external object; managed
  // objects fall through to the storage-mapped name. Config lookup stays
  // keyed by object name (matching initObjects/registerExternalObject).
  const tableName = this.physicalTableByObject[object] ?? StorageNameMapping.resolveTableName({ name: object } as any);
  const cfgs = this.autoNumberFields[object] || this.autoNumberFields[tableName];
  if (!cfgs || cfgs.length === 0) return [];
  const reservations: AutoNumberReservation[] = [];
  const parentTrx = options?.transaction as Knex.Transaction | undefined;
  const timezone = options?.timezone;
  const now = new Date();
  for (const cfg of cfgs) {
    if (row[cfg.name] !== undefined && row[cfg.name] !== null && row[cfg.name] !== '') continue;
    // A `{field}` token with no value would render to an empty prefix and
    // silently merge this record into the wrong counter scope, so refuse to
    // generate rather than emit a wrong record number (the referenced field
    // must be populated before the autonumber — see field.zod docs).
    const missing = missingFieldValues(cfg.tokens, row);
    if (missing.length > 0) {
      throw new Error(
        `Cannot generate autonumber "${object}.${cfg.name}" (format "${cfg.format}"): ` +
          `referenced field(s) [${missing.join(', ')}] are empty on the record. ` +
          `Fields interpolated into an autonumber format must be set before the record is created.`,
      );
    }
    // Resolve tenant for this row: explicit field on the record wins,
    // then driver options, else null → global sequence.
    const rowTenant = cfg.tenantField ? row[cfg.tenantField] : undefined;
    const optTenant = options?.tenantId;
    const tenantId = rowTenant != null && rowTenant !== ''
      ? String(rowTenant)
      : optTenant != null && optTenant !== ''
        ? String(optTenant)
        : null;
    // Resolve the scope/prefix for this row (counter-value-independent),
    // reserve the next value under that scope, then render the final string.
    const probe = renderAutonumber({ tokens: cfg.tokens, seq: 0, record: row, now, timezone });
    const next = await this.getNextSequenceValue(
      object,
      tableName,
      cfg.name,
      probe.prefix,
      cfg.tenantField,
      tenantId,
      parentTrx,
      probe.scope,
      probe.suffix,
    );
    const value = renderAutonumber({ tokens: cfg.tokens, seq: next, record: row, now, timezone }).value;
    row[cfg.name] = value;
    reservations.push({
      field: cfg.name,
      tableName,
      prefix: probe.prefix,
      scope: probe.scope,
      suffix: probe.suffix,
      tenantField: cfg.tenantField ?? null,
      tenantId,
      value,
    });
  }
  return reservations;
}

/** The body of `SqlDriver#issueAutonumbers`; the method's docblock there is its contract. */
export async function issueAutonumbers(this: Pick<AutonumberHost, 'autoNumberCounterKey' | 'collidingAutoNumberReservations' | 'fillAutoNumberFields' | 'injectTenantOnInsert' | 'issuedAutoNumbers' | 'resyncSequenceToDataMax'>, object: string, rows: Record<string, unknown>[], options?: DriverOptions, afterCollision?: unknown): Promise<string[][]> {
  if (afterCollision === undefined) {
    const filled: string[][] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        filled.push([]);
        continue;
      }
      // Filled as `create()` fills it: the caller's organization stamped
      // first (numbers are issued per organization), on a view, so only
      // the numbers land on the caller's row.
      const view: Record<string, any> = { ...row };
      this.injectTenantOnInsert(object, view, options);
      const reserved = await this.fillAutoNumberFields(object, view, options);
      for (const r of reserved) row[r.field] = view[r.field];
      // A value kept from an earlier issue on this row is still this
      // driver's, so it stays described beside the fresh ones (#6943).
      const fresh = new Set(reserved.map((r) => r.field));
      const kept = (this.issuedAutoNumbers.get(row) ?? []).filter((r) => !fresh.has(r.field));
      this.issuedAutoNumbers.set(row, [...kept, ...reserved]);
      filled.push(reserved.map((r) => r.field));
    }
    return filled;
  }

  const none = rows.map((): string[] => []);
  if (options?.transaction !== undefined) return none;
  const issued = rows.map((row) => (row && typeof row === 'object' ? this.issuedAutoNumbers.get(row) ?? [] : []));
  const colliding = await this.collidingAutoNumberReservations(afterCollision, issued.flat(), options);
  if (colliding.length === 0) return none;

  const stale = new Set<string>();
  for (const reservation of colliding) {
    const key = this.autoNumberCounterKey(reservation);
    if (stale.has(key)) continue;
    stale.add(key);
    await this.resyncSequenceToDataMax(reservation);
  }
  return rows.map((row, i) => {
    const emptied: string[] = [];
    const kept: AutoNumberReservation[] = [];
    for (const reservation of issued[i]) {
      if (stale.has(this.autoNumberCounterKey(reservation))) {
        delete row[reservation.field];
        emptied.push(reservation.field);
      } else {
        kept.push(reservation);
      }
    }
    if (emptied.length > 0) this.issuedAutoNumbers.set(row, kept);
    return emptied;
  });
}

/** The body of `SqlDriver#maxAutonumberCounter`; the method's docblock there is its contract. */
export function maxAutonumberCounter(values: Iterable<unknown>, prefix: string, suffix: string): number {
  let maxN = 0;
  const anchored = prefix !== '' || suffix !== '';
  for (const v of values) {
    if (typeof v !== 'string') continue;
    let n: number;
    if (anchored) {
      // Spec's inverse of `renderAutonumber` (#6560). It also re-checks the
      // prefix in JS: a driver-side `LIKE` can match looser than `startsWith`
      // (collation, case-insensitive columns), and a row from another scope
      // must not inflate this counter — it reads as `undefined`, same as a
      // row carrying no counter at all.
      const read = readAutonumberCounter(v, prefix, suffix);
      if (read === undefined) continue;
      n = read;
    } else {
      // Unanchored: `prefix` is '' here, so this is the whole value.
      n = parseInt(v.replace(/[^0-9]/g, ''), 10);
    }
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return maxN;
}

/** The body of `SqlDriver#collidingAutoNumberReservations`; the method's docblock there is its contract. */
export async function collidingAutoNumberReservations(this: Pick<AutonumberHost, 'autoNumberValueExists' | 'knex'>, error: unknown, reservations: AutoNumberReservation[], options?: DriverOptions): Promise<AutoNumberReservation[]> {
  if (reservations.length === 0 || !isUniqueViolationError(error)) return [];

  const column = uniqueViolationColumn(error);
  if (column !== undefined) return reservations.filter((r) => r.field === column);

  const runner: Knex | Knex.Transaction = (options?.transaction as Knex.Transaction | undefined) ?? this.knex;
  const colliding: AutoNumberReservation[] = [];
  for (const reservation of reservations) {
    if (await this.autoNumberValueExists(runner, reservation)) colliding.push(reservation);
  }
  return colliding;
}

/** The body of `SqlDriver#resyncSequenceToDataMax`; the method's docblock there is its contract. */
export async function resyncSequenceToDataMax(this: Pick<AutonumberHost, 'ensureSequencesTable' | 'knex' | 'resolveSequenceTenantId' | 'scanMaxNumericTail' | 'sequenceKeyHash' | 'sequencesHasKeyHash'>, reservation: AutoNumberReservation): Promise<void> {
  await this.ensureSequencesTable();
  const resolvedTenantId = this.resolveSequenceTenantId(
    reservation.tenantField,
    reservation.tenantId,
    reservation.tableName,
    reservation.field,
  );
  const key = this.sequencesHasKeyHash
    ? { key_hash: this.sequenceKeyHash(reservation.tableName, resolvedTenantId, reservation.field, reservation.scope) }
    : { object: reservation.tableName, tenant_id: resolvedTenantId, field: reservation.field };

  await this.knex.transaction(async (trx) => {
    const observedMax = await this.scanMaxNumericTail(
      trx,
      reservation.tableName,
      reservation.field,
      reservation.prefix,
      reservation.tenantField,
      resolvedTenantId === GLOBAL_TENANT ? null : resolvedTenantId,
      reservation.suffix,
    );
    const existing = await trx(SEQUENCES_TABLE).where(key).first();
    if (!existing || Number(existing.last_value) >= observedMax) return;
    await trx(SEQUENCES_TABLE).where(key).update({ last_value: observedMax, updated_at: this.knex.fn.now() });
  });
}
