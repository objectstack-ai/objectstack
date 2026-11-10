// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R4, D10] The activation ledger's package backfill, run by
 * the engine plugin once per cold boot.
 *
 * `sys_metadata_activation`'s unique key is `(metadata_type, package_id, name)`
 * (ADR-0150 D4). A row written before the key carried the package may name no
 * package for an item a package holds; this binds each such row to that one
 * holder, and reports the rows it cannot bind without guessing.
 *
 * ## Where the answer comes from
 *
 * The holder is the package-scoped resolver's own answer for a caller with no
 * package (`resolvePackageScopedName`, ADR-0150 D3), read through its exports
 * and never re-stated here:
 *
 *  - resolved to a package (the unique holder, or the overridable baseline when
 *    no other package holds the name) → the row takes that package;
 *  - resolved to the environment's own item (ADR-0150 D1 bucket 4) → the row
 *    stays null, which is its spelling;
 *  - refused → the ambiguous set: left null, every candidate named;
 *  - not-found → nothing holds the name any more: left null.
 *
 * A type the resolver does not address by package (`position`, one
 * environment-wide slot, ADR-0150 D7) is never asked: its rows stay as they are.
 *
 * An item one package holds that has more than one row (two naming no package,
 * or one naming none beside one that already names the holder) is reported at
 * `error` with every row and the remedy, and none of its rows is bound: binding
 * one would let the package-less index build over the pair on the next boot,
 * and the duplicate would never be reported again
 * (`backfillActivationLedgerPackages` in `@objectstack/core`).
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, after the bare-name holders are sealed
 * (`sealBareNameHoldersAtColdBoot`): every package of the boot has registered,
 * so "the one holder" is the environment's final answer, and phase 1's seal
 * makes it unique for every covered type. On a kernel that never seals (no
 * boot-phase hooks) it does not run, because the answer could still change.
 *
 * On a boot that repairs nothing behind the operator's back it writes nothing
 * either (#32096): the CLI's one-shot boot (`bootSchemaStack`, under `os
 * migrate plan` / `apply`, `os migrate stored-references` and every other
 * command it boots) declares itself with the engine plugin's
 * `runPlatformMigrations: false`, the signal the platform's boot repairs
 * already key on (#9380). The backfill is the served boot's upgrade write, so
 * there it runs as a dry run: it names the rows the next served boot binds, in
 * one line, and is otherwise silent. It never reaches the declaration boot's
 * write guard, whose refusal names a plugin bug that does not exist here.
 *
 * Re-runnable by construction: it reads only rows with no package and writes
 * only `package_id`, so the next boot finds nothing new to bind. It moves no
 * reader or writer onto the package: every consumer still keys a row by type
 * and name (ADR-0150 red line 3).
 */

import {
  backfillActivationLedgerPackages,
  METADATA_ACTIVATION_TABLE,
  type ActivationLedgerBackfillReport,
  type ActivationLedgerDuplicateRow,
  type ActivationLedgerHolder,
  type MetadataActivationStoreEngine,
} from '@objectstack/core';
import {
  isPackageScopedType,
  resolvePackageScopedName,
  type PackageScopedRegistry,
} from './package-scoped-resolver.js';

/**
 * The backfill's `holderOf`, answered by the package-scoped resolver for a
 * caller with no package (module doc).
 */
export function activationLedgerHolderOf(
  registry: PackageScopedRegistry,
): (metadataType: string, name: string) => ActivationLedgerHolder {
  return (metadataType, name) => {
    if (!isPackageScopedType(metadataType)) return { kind: 'unaddressed' };
    const answer = resolvePackageScopedName(registry, { type: metadataType, name, callerPackageId: null });
    switch (answer.status) {
      case 'resolved':
        return answer.holder.kind === 'package'
          ? { kind: 'package', packageId: answer.holder.packageId }
          : { kind: 'environment' };
      case 'not-found':
        return { kind: 'unheld' };
      case 'refused':
        return {
          kind: 'ambiguous',
          candidates: answer.candidates.map((c) => (c.kind === 'package' ? c.packageId : 'the environment')),
        };
    }
  };
}

/** The registry slice the boot run reads, beyond the resolver's. */
type BackfillRegistry = PackageScopedRegistry & {
  readonly bareNameHoldersAreSealed?: boolean;
  getObject?(name: string): unknown;
};

/** The logger slice the boot run writes to. */
interface BackfillLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  /** The platform logger's shape: the second argument is the thrown error, when there is one. */
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

const describeRow = (row: { metadataType: string; name: string }): string => `${row.metadataType} '${row.name}'`;

const describeDuplicateRow = (row: ActivationLedgerDuplicateRow): string =>
  `row ${row.id} (${row.packageId === undefined ? 'no package' : `package ${row.packageId}`}, ` +
  `${row.active ? 'active' : 'switched off'})`;

/** How the boot that runs {@link backfillActivationLedgerAtBoot} declares itself. */
export interface BackfillAtBootOptions {
  /**
   * The engine plugin's own `runPlatformMigrations` (#9380), passed through.
   * `false` is the CLI's one-shot boot, which repairs nothing behind the
   * operator's back: the backfill only says what the next served boot binds
   * (module doc, #32096). Omitted or `true`: the served boot, which writes.
   */
  readonly runPlatformMigrations?: boolean;
}

/**
 * The one-shot boot's run (module doc, #32096): the backfill's own dry run,
 * one line naming the rows the next served boot binds, nothing else. A ledger
 * this boot cannot read (a database the plan opened empty, a table still
 * pending `create_table`) is not an upgrade that failed, so it goes to debug.
 */
async function previewOnOneShotBoot(
  engine: Partial<Pick<MetadataActivationStoreEngine, 'find' | 'update'>>,
  registry: BackfillRegistry,
  logger: BackfillLogger,
): Promise<ActivationLedgerBackfillReport | undefined> {
  let report: ActivationLedgerBackfillReport;
  try {
    report = await backfillActivationLedgerPackages(
      engine as Pick<MetadataActivationStoreEngine, 'find' | 'update'>,
      activationLedgerHolderOf(registry),
      { dryRun: true },
    );
  } catch (e: unknown) {
    logger.debug?.(
      `[ObjectQLPlugin] the ${METADATA_ACTIVATION_TABLE} package backfill preview could not read the ledger on ` +
        'this one-shot boot; the served boot runs the backfill itself.',
      { error: e instanceof Error ? e.message : String(e) },
    );
    return undefined;
  }
  if (report.bound.length > 0) {
    logger.info(
      `[ObjectQLPlugin] activation ledger: ${report.bound.length} row(s) name no package, and the next served boot ` +
        'gives each the package that holds its item (ADR-0150 D8); this one-shot boot writes none — ' +
        `${report.bound.map((r) => `${describeRow(r)} → ${r.packageId}`).join(', ')}.`,
    );
  }
  return report;
}

/**
 * Run the backfill once for this boot and say what it did (module doc).
 *
 * Never fatal: a ledger that cannot be read leaves every row as it was, a row
 * that cannot be written keeps naming no package, which is the state every
 * reader already handles, and the next boot tries again. An item with more
 * than one row is reported with every row and the remedy, and none of its rows
 * is bound, so the package-less index keeps refusing until an operator deletes
 * the row that should not apply. Returns the report, or `undefined` when it did
 * not run.
 */
export async function backfillActivationLedgerAtBoot(
  engine: Partial<Pick<MetadataActivationStoreEngine, 'find' | 'update'>> | undefined,
  registry: BackfillRegistry | undefined,
  logger: BackfillLogger,
  options: BackfillAtBootOptions = {},
): Promise<ActivationLedgerBackfillReport | undefined> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function' || !registry) return undefined;
  // Unsealed, a package of this boot could still register and change who
  // holds a name: binding now would record an answer the boot can contradict.
  if (registry.bareNameHoldersAreSealed !== true) return undefined;
  let registered = false;
  try {
    registered = Boolean(registry.getObject?.(METADATA_ACTIVATION_TABLE));
  } catch {
    registered = false; // a registry that cannot answer is not an answer
  }
  // A composition without the ledger object has no rows to bind.
  if (!registered) return undefined;

  if (options.runPlatformMigrations === false) return previewOnOneShotBoot(engine, registry, logger);

  let report: ActivationLedgerBackfillReport;
  try {
    report = await backfillActivationLedgerPackages(
      engine as Pick<MetadataActivationStoreEngine, 'find' | 'update'>,
      activationLedgerHolderOf(registry),
    );
  } catch (e: unknown) {
    // Only the read and the holder questions can throw, and both come before
    // the first write, so nothing was written (`backfillActivationLedgerPackages`).
    logger.warn(
      `[ObjectQLPlugin] the ${METADATA_ACTIVATION_TABLE} package backfill stopped before writing any row: rows ` +
        'that name no package keep naming none, every switch still applies by type and name as before, and the ' +
        "next boot tries again. The failure is in this record's meta.",
      { error: e instanceof Error ? e.message : String(e) },
    );
    return undefined;
  }

  if (report.bound.length > 0) {
    logger.info(
      `[ObjectQLPlugin] activation ledger: ${report.bound.length} row(s) now name the package that holds their ` +
        `item (ADR-0150 D8) — ${report.bound.map((r) => `${describeRow(r)} → ${r.packageId}`).join(', ')}.`,
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[ObjectQLPlugin] activation ledger: ${report.ambiguous.length} row(s) name no package and more than one ` +
        'package holds their item, so none is picked and each row is left as it is. Its switch keeps applying by ' +
        `type and name — ${report.ambiguous
          .map((r) => `${describeRow(r)} (held by ${r.candidates.join(', ')})`)
          .join('; ')}.`,
      { ambiguous: report.ambiguous },
    );
  }
  if (report.duplicated.length > 0) {
    // `error`: two administrators' switches stand for one item and the one a
    // name-keyed reader applies is picked by storage order, while everything
    // looks healthy (the package-less index's own refusal says the same).
    logger.error(
      `[ObjectQLPlugin] activation ledger: ${report.duplicated.length} item(s) have more than one switch row, so ` +
        'none of those rows is given a package: binding one would hide the other (from the one-row-per-item index ' +
        'that refuses while both stand, or behind the row that already names the package), and which switch ' +
        `applies is picked by storage order. Delete the row that should not apply from ${METADATA_ACTIVATION_TABLE} ` +
        '(by the id named here), then restart: the next boot gives the row left its package. Nothing is deleted ' +
        `automatically — ${report.duplicated
          .map((d) => `${describeRow(d)}, held by ${d.packageId}: ${d.rows.map(describeDuplicateRow).join(', ')}`)
          .join('; ')}.`,
      undefined,
      { duplicated: report.duplicated },
    );
  }
  if (report.failed.length > 0) {
    logger.warn(
      `[ObjectQLPlugin] activation ledger: ${report.failed.length} row(s) could not be given the package that ` +
        'holds their item and keep naming none; their switches still apply by type and name as before, every ' +
        `other row was handled, and the next boot tries these again — ${report.failed
          .map((f) => `${describeRow(f)} (row ${f.id} → ${f.packageId}): ${f.error}`)
          .join('; ')}.`,
      { failed: report.failed },
    );
  }
  return report;
}
