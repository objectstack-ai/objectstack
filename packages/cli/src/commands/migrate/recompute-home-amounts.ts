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
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { refuseUndeclaredObjects } from '../../utils/migrate-object-scope.js';
// Type-only: the engine package is imported dynamically inside run(), first for the `--since`
// check (before the probe, the prompt and the boot), never at module load, so `os --help` and
// every other command pay nothing for it.
import type { HomeAmountRecomputeEngine } from '@objectstack/objectql';

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
 * `os migrate recompute-home-amounts` — the explicit recompute of the home
 * amounts a `record`-mode amount stores (ADR-0144 D5, D7 parameter 1).
 *
 * A write stores each such amount converted into its organization's home
 * currency, with the rate it used. A rate row corrected (or added) later does
 * not rewrite what was stored; this command does, after a report.
 *
 * The command is the shell; the walk, its refusals, its report and its audit
 * entry are `@objectstack/objectql`'s `recomputeHomeAmounts` — the split
 * `os migrate record-currency-codes` has with `record-currency-backfill.ts`.
 * The numbers are the write's: the run projects each stored row through the
 * write's own projection, and an applied row is written through the engine,
 * which projects it again. The boot carries the settings service (each
 * organization's home currency and timezone) and the audit ledger (one run-level entry
 * per applied run).
 *
 * Dry run by default (writes no row), `--apply` to write. Rows that cannot be
 * converted (no rate in force on the document date, an amount with no
 * currency code, no document date, no home currency) are listed and skipped,
 * and keep the command's exit code at 1 until a re-run converts them
 * (ADR-0144 Open item 8). Idempotent: a re-run with nothing listed is the
 * verification. No `sys_migration` flag is recorded: nothing gates on the run.
 *
 * `--org <id>` limits the run to one organization's rows, the same flag
 * `os migrate record-currency-codes` takes (ruling 6670707546 item 3), handed
 * to `recomputeHomeAmounts` as its organization filter. Without it the run
 * covers every organization, each in its own home currency, and is never
 * refused for it: a recompute writes no value the operator chose.
 */
export default class MigrateRecomputeHomeAmounts extends Command {
  static override description =
    'Recompute the home-currency amounts that record-mode currency fields store, at the exchange rates in force ' +
    'now — after a rate is corrected or added. Reports what would change and the rows that cannot be converted ' +
    '(listed and skipped); dry run by default, --apply writes.';

  static override examples = [
    '$ os migrate recompute-home-amounts --object invoice',
    '$ os migrate recompute-home-amounts --object invoice --since 2026-01-01',
    '$ os migrate recompute-home-amounts --object invoice --org org_emea',
    '$ os migrate recompute-home-amounts --object invoice --field amount --apply',
    '$ os migrate recompute-home-amounts --object invoice --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({ description: 'The object whose stored home amounts are recomputed', required: true }),
    field: Flags.string({
      description: 'One record-mode amount declaring homeAmount (default: every one the object declares)',
    }),
    since: Flags.string({
      description:
        'Only rows whose DOCUMENT DATE (homeAmount.rateDate, the date that picks the rate) is on or after this ' +
        'date, YYYY-MM-DD. A datetime document date is read as its calendar day in the organization\'s timezone; ' +
        'a row with no document date is outside every --since window',
    }),
    org: Flags.string({
      description:
        'Only this organization\'s rows (its id). Default: every organization, each in its own home currency',
    }),
    apply: Flags.boolean({
      description: 'Write the recomputed home amounts and rates (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on rows read — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateRecomputeHomeAmounts);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · recompute-home-amounts');

    // `--since` first: before the occupancy probe, the `--apply` prompt and the boot. The check
    // and its envelope are the recompute's own, so the command keeps no copy of either.
    try {
      const { assertHomeAmountRecomputeSince } = await import('@objectstack/objectql');
      assertHomeAmountRecomputeSince(flags.since);
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(error.message);
      this.exit(1);
      return;
    }

    // Occupancy gate, as `record-currency-codes`: probed before boot and before the prompt.
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
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Recomputing anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table, but its counts may shift while that process is running. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode rewrites record data. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold(
          `\nRewrite the stored home amounts of ${flags.object}${flags.field ? `.${flags.field}` : ''}` +
            `${flags.org !== undefined ? ` in organization ${flags.org}` : ''} at the rates in force now, on this database? [y/N] `,
        ),
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
      // The dry run boots read-only, as `record-currency-codes` does; `--apply`
      // keeps the plain boot, because the tables must exist before it writes.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ settings: true, audit: true }),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: HomeAmountRecomputeEngine & { getConfigs?(): Record<string, unknown> } =
        stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine?.homeAmountReadsFor !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read the object declaration.');
      }
      // A stack with no app metadata loaded would answer "object not found"
      // for a real object: say what is missing instead.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      refuseUndeclaredObjects([flags.object], loadedObjects);

      const { recomputeHomeAmounts, formatHomeAmountRecomputeReport } = await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await recomputeHomeAmounts(engine, logger, {
        object: flags.object,
        field: flags.field,
        since: flags.since,
        organizationId: flags.org,
        apply,
        maxRecords: flags['max-records'],
        source: 'os migrate recompute-home-amounts',
      });
      // [ADR-0144 Open item 8] A listed-and-skipped row is a gap a total over
      // the home field silently leaves out, so the run is not done while one
      // remains: exit 1, on a dry run as on an apply run. A walk `--max-records`
      // cut short has not looked at every row, so it is not done either.
      const gap = report.failures.length > 0 || report.skippedTotal > 0 || report.truncated;

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (gap) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      // The report's dry-run line claims no row or table; on a SQLite file the
      // read-only boot's connect may still have switched the journal mode (its
      // header, no row), so the line is followed by the note naming the switch.
      const journalNote = !report.applied && report.changed > 0
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      console.log(`${formatHomeAmountRecomputeReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be written — re-run to finish them.`);
      } else if (report.skippedTotal > 0) {
        printError(
          `${report.skippedTotal} amount(s) could not be converted and were left as stored — totals over the home ` +
            'field leave them out. Fix each reason listed above, then re-run.',
        );
      } else if (report.truncated) {
        printError(
          `The walk stopped at --max-records (${report.scannedRecords} row(s) read): rows past it were not looked at. ` +
            'Re-run with a higher --max-records to cover every row.',
        );
      } else if (apply && report.written > 0) {
        printSuccess(`Recomputed ${report.written} row(s). Re-run any time — it only rewrites rows that still differ.`);
      } else if (!apply && report.changed > 0) {
        printInfo(`Dry run only — ${report.changed} amount(s) would be recomputed. Re-run with --apply.`);
      } else {
        printSuccess(`Nothing to recompute — every stored home amount of ${report.object} is current.`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (gap) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      // `INVALID_FIELD` is the run refusing the object or field before its walk
      // ("Refused before the walk read or wrote any row."). The boot above ran
      // first, so on a SQLite file the note naming a journal-mode switch follows.
      const journalNote = error?.code === 'INVALID_FIELD'
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      printError(`${error.message || String(error)}${journalNote}`);
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
