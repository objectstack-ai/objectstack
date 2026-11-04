// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Migration flags, value-shape deviations, creation attestations, destroy"
 * section of `ObjectQL`: the bodies of `objectHasMediaField`,
 * `mediaValueShapeStrictFor`, `objectHasCoveredValueField`,
 * `valueShapeStrictFor`, `isFileReferencesMigrationVerified`,
 * `haveFileColumnsMoved`, `readMigrationFlagMemoized`,
 * `valueShapeViolationsAdmitted`, `admittedViolationSink`,
 * `recordObservedDeviation`, `retractCreationAttestation`,
 * `invalidateDataMigrationFlags` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link MigrationStateFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link MigrationStateHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each stub hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class,
 * and a field a body assigns goes with a SETTER that assigns it on the engine.
 *
 * `ObjectQL` here is `ObjectQLStatics` (imported AS `ObjectQL`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `ObjectQLClass`.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { DATA_MIGRATION_FLAG_OBJECT, FILE_REFERENCES_MIGRATION_ID, isDataMigrationFlagVerified } from '@objectstack/spec/system';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isScannableValueShapeField } from './validation/record-validator.js';
import type { AdmittedValueShapeViolationSink } from './validation/record-validator.js';
import type { AdmittedValueShapeViolationTally } from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link MigrationStateFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface MigrationStateHost {
  readonly _registry: ObjectQLClass['_registry'];
  readonly admittedValueShapeViolations: ObjectQLClass['admittedValueShapeViolations'];
  creationAttestationRetraction: ObjectQLClass['creationAttestationRetraction'];
  deviationRecording: ObjectQLClass['deviationRecording'];
  fileReferencesMigrationVerified: ObjectQLClass['fileReferencesMigrationVerified'];
  findOne: ObjectQLClass['findOne'];
  invalidateDataMigrationFlags: ObjectQLClass['invalidateDataMigrationFlags'];
  isFileReferencesMigrationVerified: ObjectQLClass['isFileReferencesMigrationVerified'];
  isValueShapesMigrationVerified: ObjectQLClass['isValueShapesMigrationVerified'];
  readonly logger: ObjectQLClass['logger'];
  migrationGatesAnnounced: ObjectQLClass['migrationGatesAnnounced'];
  noteAdmittedValueShapeViolation: ObjectQLClass['noteAdmittedValueShapeViolation'];
  objectHasCoveredValueField: ObjectQLClass['objectHasCoveredValueField'];
  objectHasMediaField: ObjectQLClass['objectHasMediaField'];
  readFileReferencesFlagRow: ObjectQLClass['readFileReferencesFlagRow'];
  readMigrationFlagRowMemoized: ObjectQLClass['readMigrationFlagRowMemoized'];
  readonly recordedDeviations: ObjectQLClass['recordedDeviations'];
  readonly retractedCreationAttestations: ObjectQLClass['retractedCreationAttestations'];
  update: ObjectQLClass['update'];
  valueShapesMigrationVerified: ObjectQLClass['valueShapesMigrationVerified'];
  wasDatastoreCreatedFromEmpty: ObjectQLClass['wasDatastoreCreatedFromEmpty'];
}

/** The bodies of the "Migration flags, value-shape deviations, creation attestations, destroy" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class MigrationStateFacet {
  /**
   * Does this object declare a media field at all? Cached per schema object —
   * the registry hands back the same instance per object, so this scans a
   * field map once rather than on every write.
   */
  static objectHasMediaField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.mediaFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.values(objectSchema.fields).some(
      (def: any) => def && FILE_REFERENCE_TYPES.has(def.type),
    );
    ObjectQL.mediaFieldPresence.set(objectSchema, present);
    return present;
  }

  /**
   * The media value-shape verdict for a write against `objectSchema`.
   *
   * Dormant by design, mirroring the storage module's own rule: an object with
   * no file-class field can hold no malformed media value, so it must not pay
   * even one query to learn that. Only objects that actually declare media
   * consult the deployment flag — and that read is itself memoized, so the
   * whole mechanism costs one query per process, and zero for an app that
   * stores no files.
   */
  static async mediaValueShapeStrictFor(this: Pick<MigrationStateHost, 'isFileReferencesMigrationVerified' | 'objectHasMediaField'>, objectSchema: any): Promise<boolean> {
    if (!this.objectHasMediaField(objectSchema)) return false;
    return this.isFileReferencesMigrationVerified();
  }

  /**
   * Does this object declare a reference or structured-JSON field that a write
   * would actually check? Same per-schema cache and same dormancy rule as
   * {@link objectHasMediaField}: an object holding none can hold no violation
   * of them, so it must not pay a query to learn that.
   *
   * The membership test is `isScannableValueShapeField` — the validator's own
   * — and not raw type membership, because the registry INJECTS covered-type
   * fields into every object it registers: `organization_id` and `owner_id`
   * (both `system`), plus `created_by` / `updated_by` (both in `SKIP_FIELDS`),
   * are all `lookup`s. A caller never writes any of them, so counting them made
   * this answer `true` for literally every object — the dormancy rule above
   * never fired, and this cache memoized a constant. Same predicate as the
   * scanner for the same reason the scanner imports it: three readings of "a
   * covered field" drifting by one clause is how a gate ends up governing
   * fields nothing enforces.
   *
   * [#21663] The three that are `readonly` (`organization_id`, `created_by`,
   * `updated_by`) DO reach the value-shape check now, on the value a system
   * writer, hook or stamp stores. They still do not count here, so an object
   * whose only covered fields are those stays warn-first for them: a malformed
   * value is admitted, logged and reported, never stored silently. See
   * `isScannableValueShapeField` for why widening this test is not the fix.
   */
  static objectHasCoveredValueField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.coveredValueFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.entries(objectSchema.fields).some(
      ([name, def]: [string, any]) => isScannableValueShapeField(name, def),
    );
    ObjectQL.coveredValueFieldPresence.set(objectSchema, present);
    return present;
  }

  /** The reference / structured-JSON value-shape verdict for a write. */
  static async valueShapeStrictFor(this: Pick<MigrationStateHost, 'isValueShapesMigrationVerified' | 'objectHasCoveredValueField'>, objectSchema: any): Promise<boolean> {
    if (!this.objectHasCoveredValueField(objectSchema)) return false;
    return this.isValueShapesMigrationVerified();
  }

  /** The body of `ObjectQL#isFileReferencesMigrationVerified`; the method's docblock there is its contract. */
  static async isFileReferencesMigrationVerified(this: Pick<MigrationStateHost, 'readFileReferencesFlagRow'>): Promise<boolean> {
    return (await this.readFileReferencesFlagRow()).verified;
  }

  /** The body of `ObjectQL#haveFileColumnsMoved`; the method's docblock there is its contract. */
  static async haveFileColumnsMoved(this: Pick<MigrationStateHost, 'readFileReferencesFlagRow'>): Promise<boolean> {
    return (await this.readFileReferencesFlagRow()).columnsMoved;
  }

  /**
   * The memoized seam both public flag readers share — and the place where
   * "read once per process" is kept from meaning "answer from a read that
   * never happened" (#4769).
   *
   * The two negatives this read can produce are NOT the same fact:
   *
   *  - **Conclusive.** The ledger was reachable and it does not authorise the
   *    gate (no row, `verified_at` null, blocking findings). Evidence was
   *    consulted; memoize it. A later in-process migration run announces
   *    itself through {@link invalidateDataMigrationFlags}.
   *  - **Inconclusive.** The ledger could not be ASKED — `sys_migration` is
   *    not registered yet, or the query threw. Both still answer `false` (an
   *    unaskable gate stays closed), but freezing that for the life of the
   *    process turns one unlucky early write into a whole boot's posture. It
   *    is exactly how one boot ends up lax over data the next boot rejects:
   *    the platform objects register during kernel init while the very first
   *    write can land before them, so the answer cached is about a moment
   *    when nothing could have answered at all.
   *
   * So an inconclusive read is answered but not kept. The retry costs one
   * registry lookup per write until the ledger exists (it short-circuits
   * before any query), and stops the moment a real read succeeds.
   */
  static async readMigrationFlagMemoized(this: Pick<MigrationStateHost, 'readMigrationFlagRowMemoized'>, slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified', migrationId: string, verifiedLog: string): Promise<boolean> {
    return (await this.readMigrationFlagRowMemoized(slot, migrationId, verifiedLog)).verified;
  }

  /** The body of `ObjectQL#valueShapeViolationsAdmitted`; the method's docblock there is its contract. */
  static valueShapeViolationsAdmitted(this: Pick<MigrationStateHost, 'admittedValueShapeViolations'>): Record<string, AdmittedValueShapeViolationTally> {
    const out: Record<string, AdmittedValueShapeViolationTally> = {};
    for (const [migrationId, tally] of this.admittedValueShapeViolations) {
      out[migrationId] = { count: tally.count, first: { ...tally.first } };
    }
    return out;
  }

  /**
   * The sink `validateRecord` reports admitted violations to. Built per write
   * (one closure per call, not per row) so the tally can name the object.
   */
  static admittedViolationSink(this: Pick<MigrationStateHost, 'noteAdmittedValueShapeViolation'>, object: string): AdmittedValueShapeViolationSink {
    return (violation) => this.noteAdmittedValueShapeViolation(object, violation);
  }

  /**
   * Record that this deployment has ADMITTED a value its own verified contract
   * rejects (#4797) — without touching `verified_at`.
   *
   * ## The window
   *
   * Once a certificate holds, the write path is strict and a non-conforming
   * value cannot land, so the certificate cannot go stale on its own. The
   * operator escape hatches are the exception, and they exist *precisely* to
   * relax a deployment that has already verified: with
   * `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES` on, the value is
   * admitted and persisted while `sys_migration` still reads `verified_at`
   * non-null, `blocking: 0`. Turn the switch off — or let any other process or
   * machine run without it — and strict returns to reject the very data this
   * deployment stored. Meanwhile the `adr-0104-file-references` gate, which
   * also governs reclamation of released field files, keeps deleting bytes on
   * the strength of a certificate that is now false.
   *
   * ## Why a marker rather than a revocation
   *
   * {@link retractCreationAttestation} clears `verified_at`, and is right to:
   * its target is a certificate issued on the inference "created empty, so
   * clean", which a single counterexample fully disproves. A certificate
   * earned by `os migrate … --apply` is a walk of the whole store, and one
   * admitted write is not evidence of that order — overturning it would make a
   * deliberately temporary switch into a one-way door, forcing a full
   * re-migration on anyone who used the escape hatch once.
   *
   * So the authority is withdrawn in proportion to reversibility. The marker
   * leaves every recoverable behaviour running (strict enforcement once the
   * switch is off, tombstoning, throttling — a rejected write is retried, a
   * tombstone is lifted on re-attach) and stops only what cannot be undone:
   * `authorisesIrreversibleAction` is false while it stands, so the reap
   * guard's byte delete refuses. A real apply-mode run clears it.
   *
   * ## Cost
   *
   * At most one ledger read+update per migration id per process, never awaited
   * by the write that triggered it, and skipped entirely once the marker is
   * standing. A lax write is therefore not a ledger round-trip; the FIRST lax
   * write of each class is, and only while the row is still verified.
   *
   * Deliberately never inserts. No row means nothing was certified, so there
   * is no authority to withdraw — and inserting one would fabricate a run that
   * never happened.
   */
  static recordObservedDeviation(this: Pick<MigrationStateHost, '_registry' | 'admittedValueShapeViolations' | 'deviationRecording' | 'findOne' | 'logger' | 'recordedDeviations' | 'update'>, migrationId: string): void {
    if (this.recordedDeviations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    this.recordedDeviations.add(migrationId);
    this.deviationRecording = this.deviationRecording
      .then(async () => {
        // [#20648] Same single-row route as `readMigrationFlagVerified`.
        const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          context: { isSystem: true } as ExecutionContext,
        });
        if (!row || row.id !== migrationId) return; // nothing certified — no authority to withdraw
        if (row.deviation_observed_at != null && String(row.deviation_observed_at) !== '') return; // already standing
        // Only a row that currently authorises something can have authority
        // withdrawn. An unverified row already denies both halves, so marking
        // it would add a diagnostic nobody gates on — and the next apply run
        // would clear it before anything read it.
        const verified = isDataMigrationFlagVerified({
          id: migrationId,
          last_run_at: String(row.last_run_at ?? ''),
          verified_at: row.verified_at == null ? null : String(row.verified_at),
          blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
        });
        if (!verified) return;
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            deviation_observed_at: now,
            deviation_detail: JSON.stringify({
              observed: 'lax-admitted-violating-value',
              ...(tally?.first ?? {}),
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.logger.warn(
          `[value-shape] '${migrationId}': this deployment is recorded as verified, but an ` +
            'escape hatch (OS_ALLOW_LAX_MEDIA_VALUES / OS_ALLOW_LAX_VALUE_SHAPES) just admitted a ' +
            `value that contract rejects (${tally?.first.object}.${tally?.first.field}: ` +
            `${tally?.first.detail}). The certificate stands for everything recoverable, but ` +
            'irreversible actions are withheld — released field files are no longer collected, so ' +
            'no byte is deleted on evidence this deployment has contradicted. Fix the data and run ' +
            '`os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to clear it (ADR-0104).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Failing to record
        // is the dangerous direction — it leaves the reclamation gate open on
        // a certificate we now know is stale — so say so loudly.
        this.logger.warn(
          `[value-shape] could not record the observed deviation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still authorises irreversible collection while ` +
            'this deployment holds a value its own contract rejects; run the migration to ' +
            're-derive the gate',
        );
      });
  }

  /**
   * Tear up a creation attestation this boot has just contradicted (#4769).
   *
   * The attestation normally never gets written in the first place: it asks
   * {@link valueShapeViolationsAdmitted} before recording anything, so a boot
   * that seeded a violating value declines to certify. This closes the other
   * order — the certificate is already in the ledger and the contradicting
   * value lands afterwards, which is reachable whenever the deployment is
   * still lenient at that moment (`OS_ALLOW_LAX_MEDIA_VALUES` /
   * `OS_ALLOW_LAX_VALUE_SHAPES`) or whenever a writer runs after the
   * attestation point at all — the `os dev` hot-reload seeder and a runtime
   * marketplace install both seed on a store this boot created. Without this
   * the ledger would keep asserting a fact the store contradicts, and the NEXT
   * boot would enforce it against exactly the data this one wrote.
   *
   * The boot's own inline seed used to head that list, via the background
   * continuation of a run that overran `OS_INLINE_SEED_BUDGET_MS` — the
   * attestation's `kernel:ready` backstop fired mid-seed and the tail landed
   * against the certificate it had just issued. #4795 closed that ordering at
   * the source: the attestation now defers while the `seed-settlement` contract
   * reports a source outstanding, so the inline seed can no longer contradict
   * a certificate this boot issued. This stays the safety net rather than the
   * first line of defence for it.
   *
   * Deliberately narrow:
   *
   *  - only on a store THIS boot created from empty, so the only verified row
   *    that can exist is the attestation this boot issued. Evidence produced by
   *    a real `os migrate … --apply` run is never rewritten from here — a scan
   *    that walked the whole store outranks a single write's observation, and
   *    an operator who opted into leniency did not ask us to revoke their
   *    migration;
   *  - never inserts. No row means nothing was certified, and the attestation
   *    declining on the tally is what keeps it that way;
   *  - once per migration id per process, and never awaited by the write. The
   *    recorded `blocking` count is therefore a LOWER bound — which is all the
   *    gate reads, since any non-zero count closes it.
   */
  static retractCreationAttestation(this: Pick<MigrationStateHost, '_registry' | 'admittedValueShapeViolations' | 'creationAttestationRetraction' | 'findOne' | 'invalidateDataMigrationFlags' | 'logger' | 'retractedCreationAttestations' | 'update' | 'wasDatastoreCreatedFromEmpty'>, migrationId: string): void {
    if (this.retractedCreationAttestations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    if (!this.wasDatastoreCreatedFromEmpty()) return;
    this.retractedCreationAttestations.add(migrationId);
    this.creationAttestationRetraction = this.creationAttestationRetraction
      .then(async () => {
        // [#20648] Same single-row route as `readMigrationFlagVerified`.
        const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          context: { isSystem: true } as ExecutionContext,
        });
        if (!row || row.id !== migrationId) return; // nothing certified — nothing to revoke
        if (row.verified_at == null) return; // gate already closed
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        let details: Record<string, unknown> = {};
        if (typeof row.details === 'string' && row.details.length > 0) {
          try {
            const parsed = JSON.parse(row.details);
            if (parsed && typeof parsed === 'object') details = parsed as Record<string, unknown>;
          } catch {
            details = { previous_details: row.details };
          }
        }
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            verified_at: null,
            blocking: tally?.count ?? 1,
            details: JSON.stringify({
              ...details,
              revoked: 'boot-admitted-violating-value',
              revoked_at: now,
              revoked_by: tally?.first,
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.invalidateDataMigrationFlags();
        this.logger.warn(
          `[value-shape] revoked '${migrationId}': this deployment was recorded as verified at ` +
            'creation, then this boot wrote a value that contradicts it ' +
            `(${tally?.first.object}.${tally?.first.field}: ${tally?.first.detail}). ` +
            'The gate is closed again — fix the data, then run `os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to re-earn it (ADR-0104).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Staying verified
        // is the bad direction, so say so loudly rather than silently.
        this.logger.warn(
          `[value-shape] could not revoke the creation attestation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still claims this deployment is verified ` +
            'while its data contradicts that; run the migration to re-derive it',
        );
      });
  }

  /** The body of `ObjectQL#invalidateDataMigrationFlags`; the method's docblock there is its contract. */
  static invalidateDataMigrationFlags(this: Pick<MigrationStateHost, 'fileReferencesMigrationVerified' | 'migrationGatesAnnounced' | 'recordedDeviations' | 'valueShapesMigrationVerified'>): void {
    this.fileReferencesMigrationVerified = null;
    this.valueShapesMigrationVerified = null;
    this.migrationGatesAnnounced = false;
    this.recordedDeviations.clear();
  }
}
