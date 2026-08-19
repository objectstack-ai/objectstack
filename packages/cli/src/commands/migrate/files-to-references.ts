// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * `os migrate files-to-references` — the ADR-0104 D3 data migration, with its
 * self-check gate (#3617).
 *
 * Converts legacy file-field values (inline metadata blobs, resolver URLs,
 * `data:` URIs) to owned `sys_file` references, reconciles the ownership
 * ledger against what records actually hold, and — on an `--apply` run whose
 * reconciliation reports zero blocking discrepancies — records the
 * deployment-level `adr-0104-file-references` flag. That flag (never the
 * platform version) is what later opens released-file collection (#3459) and
 * strict media value-shape enforcement (#3438) on this deployment.
 *
 * Dry run by default, and a dry run writes NOTHING — not conversions, not the
 * flag. Not run / not passed → files keep being retained forever: storage
 * cost, zero data loss.
 */
export default class MigrateFilesToReferences extends Command {
  static override description =
    'Migrate legacy file-field values to sys_file references and verify the ownership ledger (ADR-0104). ' +
    'Dry-run by default; --apply also records the deployment-level migration flag when the self-check passes.';

  static override examples = [
    '$ os migrate files-to-references',
    '$ os migrate files-to-references --apply',
    '$ os migrate files-to-references --apply --yes --json',
    '$ os migrate files-to-references --object product --object article',
    '$ os migrate files-to-references --apply --force',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description:
        'Write the conversions and record the deployment migration flag (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description: 'Restrict to this object (repeatable; default: every object with a file field)',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description:
        'Safety bound on records scanned per object — exceeding it truncates the scan and fails the gate',
    }),
    'include-unreferenced': Flags.boolean({
      description: 'Also sweep for committed files nothing references (advisory; extra full sys_file read)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateFilesToReferences);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) {
      printHeader('Migrate · files-to-references');
    }

    // Occupancy gate (#3917 follow-up) — this command rewrites ROWS, so a live
    // writer on the same SQLite file is at least as dangerous here as it is for
    // `os migrate apply`: both processes would be mutating the same records
    // with no coordination. Probed before boot (afterwards our own pool is what
    // the probe finds) and before the confirmation prompt, so an operator is
    // never asked to confirm something we are about to refuse.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson({
          error: 'database_busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_HINT,
        }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && !flags.json) {
      // A dry run writes nothing, so it only ever warns — but it warns, because
      // the numbers it reports are a moving target while another process writes.
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Converting anyway — the live process may write records mid-scan.`
        : `${describeOccupancy(occupancy)} The dry run below writes nothing, but its counts may shift while that process is running.`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    // Confirmation gate — before boot, since an apply run starts writing as
    // it scans. The documented workflow is: dry-run first, then --apply.
    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
        }
        printWarning('Apply mode rewrites record data. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nConvert legacy file values and record the migration flag on this database? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ storage: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: any = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || !engine.getObject('sys_file')) {
        throw new Error(
          'sys_file is not registered on this stack — the storage service objects are required. ' +
            'Ensure @objectstack/service-storage is installed, then re-run.',
        );
      }
      // An empty scan is indistinguishable from a clean one, and this command's
      // verdict is what later authorises irreversible behaviour — so refuse to
      // run when no app metadata is loaded (missing artifact / wrong directory)
      // rather than "verify" a database the scan never actually looked at.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the scan would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      const getStorage = () => {
        try {
          // Canonical slot since #9683 (service-storage also registers the
          // deprecated `file-storage` alias with the same instance in v17).
          return stack.kernel.getService('storage');
        } catch {
          return null;
        }
      };

      const {
        runFilesToReferencesMigration,
        formatBackfillReport,
        formatFileReferenceReport,
      } = await import('@objectstack/service-storage');

      // In JSON mode keep stdout parseable — route migration warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const result = await runFilesToReferencesMigration(engine, getStorage, logger, {
        apply,
        objects: flags.object,
        maxRecordsPerObject: flags['max-records'],
        includeUnreferenced: flags['include-unreferenced'],
      });

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          apply,
          backfill: {
            scannedObjects: result.backfill.scannedObjects,
            scannedRecords: result.backfill.scannedRecords,
            converted: result.backfill.converted,
            alreadyReferences: result.backfill.alreadyReferences,
            externalUrls: result.backfill.externalUrls,
            unresolvable: result.backfill.unresolvable,
            truncated: result.backfill.truncated,
            // already_id rows are the bulk and carry no action — report the rest
            actions: result.backfill.actions.filter((a) => a.kind !== 'already_id'),
          },
          verify: {
            scannedObjects: result.verify.scannedObjects,
            scannedRecords: result.verify.scannedRecords,
            heldReferences: result.verify.heldReferences,
            ownedFiles: result.verify.ownedFiles,
            counts: result.verify.counts,
            blocking: result.verify.blocking,
            ok: result.verify.ok,
            truncated: result.verify.truncated,
            issues: result.verify.issues,
          },
          gatePassed: result.gatePassed,
          gateFailures: result.gateFailures,
          flag: result.flag,
          duration: timer.elapsed(),
        });
        if (!result.gatePassed) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(formatBackfillReport(result.backfill));
      console.log('');
      console.log(formatFileReferenceReport(result.verify));
      console.log('');

      if (result.gatePassed) {
        if (apply) {
          printSuccess(
            'Self-check passed — deployment flag recorded (adr-0104-file-references). ' +
              'Media value shapes are now ENFORCED on this deployment: a malformed ' +
              'file/image value is rejected rather than warned about. ' +
              '(Set OS_ALLOW_LAX_MEDIA_VALUES=1 to re-open leniency while diagnosing.)',
          );
        } else if (result.backfill.converted > 0) {
          printInfo(
            `Dry run only — ${result.backfill.converted} value(s) would be converted. ` +
              'Re-run with --apply to convert and record the deployment flag.',
          );
        } else {
          printInfo(
            'Data is already in reference form. Re-run with --apply to record the deployment flag.',
          );
        }
      } else {
        for (const failure of result.gateFailures) {
          printError(`Gate not passed: ${failure}`);
        }
        printWarning(
          apply
            ? 'The migration flag was recorded as NOT verified — collection and strict enforcement stay closed. Fix the records listed above and re-run.'
            : 'Fix the records listed above, then re-run (and finally with --apply).',
        );
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (!result.gatePassed) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
