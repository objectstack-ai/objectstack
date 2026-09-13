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
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import {
  describeFileColumnMoveRefusal,
  runFileColumnMove,
  type FileColumnMoveResult,
} from '../../utils/file-column-move.js';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { SqlDriverLike } from '../../utils/schema-migrate.js';
import type { MediaColumnMoveScan, SqlDialectName } from '@objectstack/driver-sql';

/**
 * What {@link MigrateFilesToReferences.runColumnStep} did, or declined to do.
 *
 * `skipped` and `failed` are deliberately separate: every skip is a stated,
 * non-failing reason (this command's subject is the backfill), and only a
 * column step that ran and could not finish fails the command — because that
 * is the one outcome that leaves storage an operator has to be told about.
 */
interface ColumnStepOutcome {
  skipped: 'gate_not_passed' | 'no_sql_driver' | 'no_sql_seam' | 'nothing_to_move' | null;
  failed: boolean;
  /** `sys_migration.columns_moved_at` as written, or `null` if it was not written. */
  stampedAt: string | null;
  /** Set when the columns moved and RECORDING that failed — a durability failure. */
  stampError?: string;
  report: {
    dialect: SqlDialectName;
    apply: boolean;
    blocking: number;
    outcomes: FileColumnMoveResult['outcomes'];
    refusals: MediaColumnMoveScan['refusals'];
    executedStatements: string[];
    recordable: boolean;
    /** Carried from the driver, because the renderer cannot `await import`. */
    rollbackNotes: readonly string[];
  } | null;
}

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
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
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

      // ── The COLUMN step (#15989, the ruling on #15041 step 2) ────────────
      //
      // Runs only after the backfill and its self-check reported zero blocking
      // rows — the ruling's own "abort otherwise", and the reason it lives
      // here rather than in a command of its own: the gate's verdict is what
      // authorises it, and this is the only place that verdict exists.
      //
      // ⛔ The move and the arm flip are ONE act. Measured on SQLite: after
      // the columns are converted a JSON-arm driver still READS the migrated
      // column correctly but its next WRITE re-quotes. So `columns_moved_at`
      // is stamped in the same block that moved the columns, and only when
      // every one of them moved.
      const columnMove = await this.runColumnStep({
        stack,
        engine,
        apply,
        gatePassed: result.gatePassed,
        json: flags.json,
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
          columnMove: columnMove.report,
          columnsMovedAt: columnMove.stampedAt,
          duration: timer.elapsed(),
        });
        if (!result.gatePassed || columnMove.failed) this.exit(1);
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
      this.renderColumnStep(columnMove);

      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (!result.gatePassed || columnMove.failed) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }

  /**
   * The column step — plan, pre-check, move, stamp (#15989).
   *
   * Every early return is a NON-failure with a stated reason: this command's
   * subject is the backfill, and a deployment whose driver cannot plan a
   * column move is not a deployment whose backfill failed. The one thing that
   * fails the command is a column step that was asked to run, ran, and could
   * not finish — because that leaves storage the operator must be told about.
   */
  private async runColumnStep(args: {
    stack: { driver: SqlDriverLike | null; kernel: unknown };
    engine: unknown;
    apply: boolean;
    gatePassed: boolean;
    json: boolean;
  }): Promise<ColumnStepOutcome> {
    const { stack, apply, gatePassed, json } = args;

    if (!gatePassed) {
      // ⛔ The ruling's "abort unless backfill + verify report zero blocking".
      // Not an error of this step's own — the gate already reported why.
      return { skipped: 'gate_not_passed', failed: false, stampedAt: null, report: null };
    }
    if (!stack.driver || typeof stack.driver.planMediaColumnMove !== 'function') {
      return { skipped: 'no_sql_driver', failed: false, stampedAt: null, report: null };
    }

    const scan = await stack.driver.planMediaColumnMove();
    if (scan.plans.length === 0 && scan.refusals.length === 0) {
      return { skipped: 'nothing_to_move', failed: false, stampedAt: null, report: null };
    }

    // Lazily, at the point of use — ⛔ never a static value import of a driver
    // package in a command module (#5726).
    const { MEDIA_COLUMN_MOVE_ROLLBACK_NOTES } = await import('@objectstack/driver-sql');
    const { resolveSeedTenancyExec, normalizeRows } = await import('@objectstack/metadata-protocol');
    const exec = resolveSeedTenancyExec(args.engine as IObjectQLEngine | undefined);
    // Loud absence, never a silent success. A driver can expose an `execute`
    // that accepts every statement and performs none (#10677) — and "moved 3
    // columns" from a seam that ran nothing, followed by a `columns_moved_at`
    // stamp, is the worst report this command could produce: the driver would
    // then write bare ids into columns that never moved.
    const answers = exec
      ? await exec('select 1 as os_seam_probe')
          .then((r) => normalizeRows(r).length > 0)
          .catch(() => false)
      : false;
    if (!exec || !answers) {
      return { skipped: 'no_sql_seam', failed: false, stampedAt: null, report: null };
    }

    const run = await runFileColumnMove({
      scan,
      exec,
      rows: normalizeRows,
      apply,
      onStatement: json ? undefined : (statement: string) => printStep(chalk.dim(statement)),
    });

    let stampedAt: string | null = null;
    let stampError: string | undefined;
    if (run.recordable) {
      try {
        const { recordFileColumnMove } = await import('@objectstack/platform-objects/system');
        const { FILE_REFERENCES_MIGRATION_ID } = await import('@objectstack/spec/system');
        stampedAt = await recordFileColumnMove(args.engine as any, FILE_REFERENCES_MIGRATION_ID);
      } catch (error: any) {
        // The columns MOVED and the ledger does not say so. That is a
        // durability degradation in the sense AGENTS.md names: the next boot
        // stays on the JSON arm and re-quotes its writes into a column that
        // has already been converted. It must fail the command.
        stampError = error?.message ?? String(error);
      }
    }

    const failed =
      run.outcomes.some((o) => o.status === 'failed') || stampError !== undefined;

    return {
      skipped: null,
      failed,
      stampedAt,
      stampError,
      report: {
        dialect: scan.dialect,
        rollbackNotes: MEDIA_COLUMN_MOVE_ROLLBACK_NOTES,
        apply: run.apply,
        blocking: run.blocking,
        outcomes: run.outcomes,
        refusals: run.refusals,
        executedStatements: run.executedStatements,
        recordable: run.recordable,
      },
    };
  }

  /** The human-mode half of {@link runColumnStep}. JSON mode reports the same facts. */
  private renderColumnStep(outcome: ColumnStepOutcome): void {
    if (outcome.skipped === 'gate_not_passed' || outcome.report === null) {
      if (outcome.skipped === 'no_sql_driver') {
        printInfo(
          'Column step: not applicable — the ADR-0104 file-family column move is a SQL-driver step ' +
            'and no SQL driver is active here.',
        );
      } else if (outcome.skipped === 'no_sql_seam') {
        printWarning(
          'Column step: SKIPPED — the active driver exposes no usable raw SQL seam, so the media ' +
            'columns were neither inspected nor moved. The deployment stays on the JSON encoding.',
        );
      } else if (outcome.skipped === 'nothing_to_move') {
        printInfo('Column step: nothing to move — this datastore declares no single-value media column.');
      }
      return;
    }

    const report = outcome.report;
    console.log('');
    console.log(chalk.bold(`Column step · ${report.dialect}`));
    for (const o of report.outcomes) {
      const mark =
        o.status === 'moved' ? chalk.green('✓')
        : o.status === 'blocked' || o.status === 'failed' ? chalk.red('✗')
        : chalk.yellow('•');
      console.log(`${mark} ${chalk.bold(`${o.table}.${o.column}`)}  ${chalk.dim(`(${o.kind})`)}`);
      console.log(`    ${chalk.cyan(o.statement)}`);
      if (o.error) console.log(`    ${chalk.red(o.error)}`);
    }
    for (const refusal of report.refusals) {
      printWarning(`${refusal.table}.${refusal.column}: ${refusal.detail}`);
    }

    const refusal = describeFileColumnMoveRefusal({
      apply: report.apply,
      outcomes: report.outcomes,
      refusals: report.refusals,
      executedStatements: report.executedStatements,
      blocking: report.blocking,
      recordable: report.recordable,
    });
    console.log('');
    if (refusal) {
      printError(refusal);
    } else if (!report.apply) {
      printInfo(
        `Dry run — every abort pre-check passed and nothing was executed. ${report.outcomes.length} ` +
          'column(s) would move. Take a backup, then re-run with --apply.',
      );
    } else if (outcome.stampError) {
      printError(
        `The columns MOVED but recording it failed (${outcome.stampError}). This deployment's ` +
          'driver will stay on the JSON encoding and re-quote its next write into a column that ' +
          'has already been converted — re-run this command to record it.',
      );
    } else if (outcome.stampedAt) {
      printSuccess(
        `Column step complete — ${report.outcomes.length} media column(s) moved to the bare-id ` +
          `encoding and recorded (sys_migration.columns_moved_at = ${outcome.stampedAt}). The SQL ` +
          'driver writes bare ids from its next boot, and keeps reading the legacy encoding.',
      );
    }

    if (refusal || report.outcomes.some((o) => o.status === 'failed')) {
      console.log('');
      console.log(chalk.bold('If it goes wrong:'));
      for (const note of report.rollbackNotes) console.log(`  ${chalk.dim('·')} ${note}`);
    }
  }
}
