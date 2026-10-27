// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 13] The migration-flag and attestation bodies of `ObjectQL`,
 * moved out of `engine.ts`: `supplyTenantKeyCertifiedResolver` (hand a driver
 * the "is this database certified" question), `isOrganizationOwnershipCertified`
 * (that question's answer), `readFileReferencesFlagRow` and
 * `isValueShapesMigrationVerified` (the two memoized flag readers),
 * `readMigrationFlagVerified` (the one `sys_migration` row read behind them),
 * `noteAdmittedValueShapeViolation` (tally a violation this boot admitted),
 * `announceOpenMigrationGates` (the once-per-boot open-gate advisory) and
 * `wasDatastoreCreatedFromEmpty` (did this process create its store).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract. ADR-0104 and ADR-0131 govern what
 * these bodies decide; their decisions are cited on those docblocks.
 *
 * What stays in `engine.ts`: `isFileReferencesMigrationVerified` (ADR-0104
 * names it by path), `recordObservedDeviation` and `retractCreationAttestation`
 * (each writes through `this.update`), the bodies too short to pay for a host
 * (`haveFileColumnsMoved`, `readMigrationFlagMemoized`,
 * `readMigrationFlagRowMemoized`, `valueShapeViolationsAdmitted`,
 * `admittedViolationSink`, `invalidateDataMigrationFlags`), and every field
 * of the section, each declared where it was.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-driver-options.ts` applies it. The class keeps all eight methods
 * with name, modifiers, signature, docblock and position, and each body is
 * one literal of exactly the {@link MigrationFlagsHost} members that method
 * reads, plus a `.call`. The fields a body reads (`logger`, `_registry`,
 * `admittedValueShapeViolations`, `migrationGatesAnnounced`, `drivers`) go as
 * GETTERS, so each read happens when the body makes it, as it did. The one
 * field a body ASSIGNS, `migrationGatesAnnounced`, goes as a getter and
 * SETTER pair over the instance, so the write lands on the engine and the
 * next read, from either side, sees it. The methods they call go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import {
  DATA_MIGRATION_FLAG_OBJECT,
  FILE_REFERENCES_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
  ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  ORGANIZATION_OWNERSHIP_SHAPE_GENERATION,
  organizationOwnershipShapeGenerationOf,
  isDataMigrationFlagVerified,
  hasMovedFileColumns,
} from '@objectstack/spec/system';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataDriver } from '@objectstack/core';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { valueShapePostureSetByEnv, mediaPostureSetByEnv } from './validation/record-validator.js';
import type { AdmittedValueShapeViolation } from './validation/record-validator.js';
import type { MigrationFlagRead, ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters, and which one also has a setter.
 */
export interface MigrationFlagsHost {
  readonly logger: ObjectQL['logger'];
  readonly _registry: ObjectQL['_registry'];
  readonly admittedValueShapeViolations: ObjectQL['admittedValueShapeViolations'];
  migrationGatesAnnounced: ObjectQL['migrationGatesAnnounced'];
  readonly drivers: ObjectQL['drivers'];
  isOrganizationOwnershipCertified: ObjectQL['isOrganizationOwnershipCertified'];
  findOne: ObjectQL['findOne'];
  readMigrationFlagRowMemoized: ObjectQL['readMigrationFlagRowMemoized'];
  readMigrationFlagMemoized: ObjectQL['readMigrationFlagMemoized'];
  recordObservedDeviation: ObjectQL['recordObservedDeviation'];
  retractCreationAttestation: ObjectQL['retractCreationAttestation'];
  objectHasMediaField: ObjectQL['objectHasMediaField'];
  objectHasCoveredValueField: ObjectQL['objectHasCoveredValueField'];
  readMigrationFlagVerified: ObjectQL['readMigrationFlagVerified'];
}

/** The body of `ObjectQL#supplyTenantKeyCertifiedResolver`; the method's docblock there is its contract. */
export function supplyTenantKeyCertifiedResolver(
  this: Pick<MigrationFlagsHost, 'isOrganizationOwnershipCertified' | 'logger'>,
  driver: IDataDriver,
): void {
  const sink = driver as unknown as {
    setTenantKeyCertifiedResolver?: (resolve: () => Promise<boolean>) => void;
  };
  if (typeof sink.setTenantKeyCertifiedResolver !== 'function') return;
  try {
    sink.setTenantKeyCertifiedResolver(() => this.isOrganizationOwnershipCertified());
  } catch (e: any) {
    // A driver that did not take the resolver answers "not certified": it
    // keeps the two forms distinct and REPORTS a destructive recreate_index,
    // which is never applied unattended (safe-only boot reconcile, the
    // artifact gate, `os migrate apply --allow-destructive`).
    this.logger.debug('Driver declined the ADR-0131 certification resolver', {
      driverName: driver.name,
      error: e?.message ?? String(e),
    });
  }
}

/** The body of `ObjectQL#isOrganizationOwnershipCertified`; the method's docblock there is its contract. */
export async function isOrganizationOwnershipCertified(
  this: Pick<MigrationFlagsHost, '_registry' | 'findOne'>,
): Promise<boolean> {
  if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return false;
  try {
    const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID },
      context: { isSystem: true } as ExecutionContext,
    });
    if (!row || row.id !== ORGANIZATION_OWNERSHIP_MIGRATION_ID) return false;
    const verified = isDataMigrationFlagVerified({
      id: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
      last_run_at: String(row.last_run_at ?? ''),
      verified_at: row.verified_at == null ? null : String(row.verified_at),
      blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
    });
    return verified && organizationOwnershipShapeGenerationOf(row.details) >= ORGANIZATION_OWNERSHIP_SHAPE_GENERATION;
  } catch (error) {
    // A store whose ledger table does not exist yet has no certificate.
    if (isMissingTableError(error, DATA_MIGRATION_FLAG_OBJECT)) return false;
    throw error;
  }
}

/** The body of `ObjectQL#readFileReferencesFlagRow`; the method's docblock there is its contract. */
export function readFileReferencesFlagRow(
  this: Pick<MigrationFlagsHost, 'readMigrationFlagRowMemoized'>,
): Promise<MigrationFlagRead> {
  return this.readMigrationFlagRowMemoized(
    'fileReferencesMigrationVerified',
    FILE_REFERENCES_MIGRATION_ID,
    '[value-shape] this deployment has verified the file-as-reference migration — ' +
      'media value shapes are enforced and released field files may be collected ' +
      '(ADR-0104)',
  );
}

/** The body of `ObjectQL#isValueShapesMigrationVerified`; the method's docblock there is its contract. */
export async function isValueShapesMigrationVerified(
  this: Pick<MigrationFlagsHost, 'readMigrationFlagMemoized'>,
): Promise<boolean> {
  return this.readMigrationFlagMemoized(
    'valueShapesMigrationVerified',
    VALUE_SHAPES_MIGRATION_ID,
    '[value-shape] this deployment has verified the value-shape scan — reference and ' +
      'structured-JSON value shapes are enforced (ADR-0104)',
  );
}

/** The body of `ObjectQL#readMigrationFlagVerified`; the method's docblock there is its contract. */
export async function readMigrationFlagVerified(
  this: Pick<MigrationFlagsHost, '_registry' | 'findOne' | 'logger'>,
  migrationId: string,
  verifiedLog?: string,
): Promise<MigrationFlagRead> {
  if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
    return { verified: false, conclusive: false, columnsMoved: false };
  }
  try {
    // [#20648] The row by primary key, through the single-row route. ⛔ Not
    // `find` with `limit: 1`: the SQL driver reads that as page one of a
    // walk, and this read runs at boot BEFORE `sys_migration` is registered
    // with the driver — so every boot of an existing deployment printed the
    // driver's "Paged read ... is NOT deterministic" warning for a lookup
    // that cannot return two rows. `findOne` is the route it exempts.
    const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: migrationId },
      context: { isSystem: true } as ExecutionContext,
    });
    if (!row || row.id !== migrationId) {
      return { verified: false, conclusive: true, columnsMoved: false };
    }
    const flag = {
      id: migrationId,
      last_run_at: String(row.last_run_at ?? ''),
      verified_at: row.verified_at == null ? null : String(row.verified_at),
      // A non-numeric count must read as "not zero", not as 0 — a bad
      // coercion lands on NaN, which fails the === 0 test.
      blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
      // [#15989] Read here so both questions come off ONE row: an absent or
      // empty stamp is the JSON encoding, which is what every row written
      // before the column step existed holds.
      columns_moved_at: row.columns_moved_at == null ? null : String(row.columns_moved_at),
    };
    const verified = isDataMigrationFlagVerified(flag);
    if (verified && verifiedLog) this.logger.info(verifiedLog);
    return { verified, conclusive: true, columnsMoved: hasMovedFileColumns(flag) };
  } catch {
    // unreadable evidence → stay lenient, keep asking; and the columns read
    // as NOT moved, which is the encoding every deployment already writes.
    return { verified: false, conclusive: false, columnsMoved: false };
  }
}

/** The body of `ObjectQL#noteAdmittedValueShapeViolation`; the method's docblock there is its contract. */
export function noteAdmittedValueShapeViolation(
  this: Pick<MigrationFlagsHost, 'admittedValueShapeViolations' | 'recordObservedDeviation' | 'retractCreationAttestation'>,
  object: string,
  violation: AdmittedValueShapeViolation,
): void {
  const migrationId =
    violation.gate === 'media' ? FILE_REFERENCES_MIGRATION_ID : VALUE_SHAPES_MIGRATION_ID;
  const existing = this.admittedValueShapeViolations.get(migrationId);
  if (existing) {
    existing.count += 1;
  } else {
    this.admittedValueShapeViolations.set(migrationId, {
      count: 1,
      first: { object, field: violation.field, type: violation.type, detail: violation.detail },
    });
  }
  // Two consumers of the same counterexample, answering different questions.
  // The deviation marker goes first because it is the one that applies to
  // EVERY verified deployment (#4797); the retraction below applies only to
  // the narrow fresh-datastore case (#4769) and closes the gate outright
  // there. Each is the other's backstop if one write fails.
  this.recordObservedDeviation(migrationId);
  this.retractCreationAttestation(migrationId);
}

/** The body of `ObjectQL#announceOpenMigrationGates`; the method's docblock there is its contract. */
export async function announceOpenMigrationGates(
  this: Pick<MigrationFlagsHost, 'migrationGatesAnnounced' | '_registry' | 'objectHasMediaField' | 'objectHasCoveredValueField' | 'readMigrationFlagVerified' | 'logger'>,
): Promise<void> {
  if (this.migrationGatesAnnounced) return;
  this.migrationGatesAnnounced = true;
  try {
    const mediaByEnv = mediaPostureSetByEnv();
    const coveredByEnv = valueShapePostureSetByEnv();
    if (mediaByEnv && coveredByEnv) return;

    let media = false;
    let covered = false;
    for (const obj of this._registry.getAllObjects() as any[]) {
      if (!media && !mediaByEnv && this.objectHasMediaField(obj)) media = true;
      if (!covered && !coveredByEnv && this.objectHasCoveredValueField(obj)) covered = true;
      if ((media || mediaByEnv) && (covered || coveredByEnv)) break;
    }

    // [#4769] Read the ledger, not the memo. This advisory runs once, at
    // `kernel:bootstrapped`, and the fresh-datastore attestation may have
    // written its rows moments earlier — after the boot's first write had
    // already memoized "not verified". Reporting from that memo tells a
    // brand-new deployment to run a migration whose gate is already closed.
    // One query per applicable gate, once per boot.
    if (media && !(await this.readMigrationFlagVerified(FILE_REFERENCES_MIGRATION_ID)).verified) {
      this.logger.info(
        '[value-shape] media values are checked but NOT enforced here, and released files are ' +
          'never collected — this deployment has not verified its file migration. Run ' +
          '`os migrate files-to-references` (dry run) to see what it would do, then `--apply` ' +
          'to close the gate (ADR-0104).',
      );
    }
    if (covered && !(await this.readMigrationFlagVerified(VALUE_SHAPES_MIGRATION_ID)).verified) {
      this.logger.info(
        '[value-shape] reference and structured-JSON values are checked but NOT enforced here — ' +
          'this deployment has not verified its value-shape scan. Run `os migrate value-shapes` ' +
          '(dry run) to see what it would report, then `--apply` to close the gate ' +
          '(ADR-0104).',
      );
    }
  } catch {
    // An advisory must never be the reason a boot fails.
  }
}

/** The body of `ObjectQL#wasDatastoreCreatedFromEmpty`; the method's docblock there is its contract. */
export function wasDatastoreCreatedFromEmpty(
  this: Pick<MigrationFlagsHost, 'drivers'>,
): boolean {
  let created = 0;
  let existing = 0;
  let reporting = 0;
  for (const driver of this.drivers.values()) {
    const stats = (driver as any).getSchemaSyncStats?.();
    if (!stats) continue;
    reporting += 1;
    created += Number(stats.created) || 0;
    existing += Number(stats.existing) || 0;
  }
  return reporting > 0 && existing === 0 && created > 0;
}
