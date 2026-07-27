// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';
import type { DataMigrationFlag } from '@objectstack/spec/system';
import { recordDataMigrationRun } from '@objectstack/platform-objects/system';
import type { MigrationFlagEngine } from '@objectstack/platform-objects/system';
import type { IStorageService } from '@objectstack/spec/contracts';
import {
  backfillFileReferences,
  type BackfillEngine,
  type BackfillLogger,
  type BackfillReport,
} from './backfill-file-references.js';
import { verifyFileReferences, type FileReferenceReport } from './verify-file-references.js';

/**
 * The gated file-as-reference data migration (#3617) — ADR-0104 D3 wave 2's
 * acceptance evidence, produced per deployment.
 *
 * Composes the two existing halves into the migration step a deployment
 * actually runs (`os migrate files-to-references`):
 *
 *   1. {@link backfillFileReferences} — convert legacy file-field values to
 *      `sys_file` ids (dry run unless `apply`),
 *   2. {@link verifyFileReferences} — reconcile the ownership ledger against
 *      what records actually hold,
 *   3. on an APPLY run, record the outcome on the deployment-level
 *      `sys_migration` flag (`adr-0104-file-references`).
 *
 * The flag — not the platform version — is what may later open released-file
 * collection (#3459 PR-5b) and strict media value-shape enforcement (#3438)
 * on this deployment. That ordering is the point of the design: a ledger must
 * be shown to agree with reality *here* before anything may delete bytes
 * *here*, and no release-side observation window can vouch for a database
 * only its own operator can see.
 *
 * ## The self-check gate
 *
 * A run passes only when the reconciliation reports ZERO blocking
 * discrepancies AND neither scan was truncated (`ok` covers only what was
 * read). Advisory findings — external URLs awaiting a modelling decision,
 * stale owners, unreferenced files — never gate: they cost storage, not data.
 *
 * ## Dry run writes NOTHING
 *
 * Not the conversions, and not the flag either — even when the self-check
 * would pass. `--apply` is the single writing mode, so "did this run change
 * my deployment's posture" never depends on what the run happened to find.
 * A failing APPLY run, by contrast, deliberately records `blocking` and
 * clears `verified_at`: data that has regressed closes its own gate.
 */

/** Engine surface the migration needs — the union of its three halves'. */
export type FilesToReferencesEngine = BackfillEngine & MigrationFlagEngine;

export interface FilesToReferencesOptions {
  /** Write conversions and record the deployment flag. Omit for a dry run. */
  apply?: boolean;
  /** Restrict to these objects (default: every object with a file field). */
  objects?: string[];
  /** Safety bound on records read per object; exceeding it fails the gate. */
  maxRecordsPerObject?: number;
  /** Include the advisory unreferenced-file sweep in the reconciliation. */
  includeUnreferenced?: boolean;
}

export interface FilesToReferencesResult {
  backfill: BackfillReport;
  verify: FileReferenceReport;
  /** Zero blocking discrepancies and nothing truncated. */
  gatePassed: boolean;
  /** Why the gate did not pass (empty when it did). */
  gateFailures: string[];
  /** The flag row as recorded (apply runs only; null on a dry run). */
  flag: DataMigrationFlag | null;
}

export async function runFilesToReferencesMigration(
  engine: FilesToReferencesEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: BackfillLogger,
  options: FilesToReferencesOptions = {},
): Promise<FilesToReferencesResult> {
  const apply = options.apply === true;
  const shared = {
    objects: options.objects,
    maxRecordsPerObject: options.maxRecordsPerObject,
  };

  const backfill = await backfillFileReferences(engine, getStorage, logger, {
    ...shared,
    apply,
  });

  // The reconciliation runs on BOTH modes: a dry run still reports, against
  // current data, exactly what stands between this deployment and the gate.
  const verify = await verifyFileReferences(engine, {
    ...shared,
    includeUnreferenced: options.includeUnreferenced,
  });

  const gateFailures: string[] = [];
  if (verify.blocking > 0) {
    gateFailures.push(
      `${verify.blocking} blocking discrepancy(ies) between records and recorded ownership`,
    );
  }
  if (backfill.truncated || verify.truncated) {
    gateFailures.push(
      'scan truncated by maxRecordsPerObject — the verdict covers only what was read; ' +
        'raise the bound and re-run',
    );
  }
  const gatePassed = gateFailures.length === 0;

  let flag: DataMigrationFlag | null = null;
  if (apply) {
    const advisory =
      (verify.issues.length - verify.blocking) + backfill.externalUrls + backfill.unresolvable;
    flag = await recordDataMigrationRun(engine, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: gatePassed,
      blocking: verify.blocking,
      advisory,
      applied: true,
      details: {
        scanned_objects: verify.scannedObjects.length,
        scanned_records: verify.scannedRecords,
        held_references: verify.heldReferences,
        owned_files: verify.ownedFiles,
        issue_counts: verify.counts,
        backfill: {
          converted: backfill.converted,
          already_references: backfill.alreadyReferences,
          external_urls: backfill.externalUrls,
          unresolvable: backfill.unresolvable,
        },
        truncated: backfill.truncated || verify.truncated,
      },
    });
  }

  return { backfill, verify, gatePassed, gateFailures, flag };
}
