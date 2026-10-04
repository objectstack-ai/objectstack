// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
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
import { absentTableReads } from '../../utils/absent-table-reads.js';

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
 * `os migrate audit-metadata-bodies` — the one-off rewrite of at-rest cleartext
 * metadata-body copies in `sys_audit_log` / `sys_activity` (#21120).
 *
 * The audit writer COPIES a `sys_metadata` / `sys_metadata_history` row whole
 * into `sys_audit_log.new_value` / `old_value` and `sys_activity.metadata` at
 * write time — a second, admin-readable, at-rest store. For a datasource body
 * that copy carried stored credential material. The writer now projects the
 * body through the shared redactor before it records it, but that reaches only
 * NEW writes; rows copied before the fix keep their cleartext. This command
 * rewrites them, projecting each copied body through the SAME redactor.
 *
 * [#21207] The same copies also carried the copied row's stored CONTENT HASH
 * (`checksum`, and the history row's `previous_checksum`) — a hash over the whole
 * stored body, withheld credential material included — and the decision-audit
 * note of a refused optimistic-lock write (`sys_metadata_audit`, and its ledger
 * and activity copies) named both hashes. The writers no longer copy either;
 * this command drops the hash columns from the copies already written and
 * withholds the hashes in those notes, in the same pass. Operators run it once
 * after upgrading, dry run first.
 *
 * Dry run by default (writes nothing), `--apply` to rewrite. Idempotent: a
 * second run finds nothing — a redacted copy has no credential and no hash
 * left — so re-running and reading a clean report is the verification. No
 * `sys_migration` flag is recorded: nothing gates irreversible behaviour on this
 * rewrite (the posture `os migrate summary-nulls` takes).
 */
export default class MigrateAuditMetadataBodies extends Command {
  static override description =
    'Rewrite the at-rest copies the audit writer left in sys_audit_log / sys_activity: project each copied ' +
    'metadata body through the shared credential redactor and drop its stored content hash; withhold the hashes ' +
    'a conflict note in sys_metadata_audit (and its copies) names. Dry run by default; --apply writes.';

  static override examples = [
    '$ os migrate audit-metadata-bodies',
    '$ os migrate audit-metadata-bodies --apply',
    '$ os migrate audit-metadata-bodies --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Rewrite the affected rows (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateAuditMetadataBodies);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · audit-metadata-bodies');

    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson(
          { error: 'database_busy', database: occupancy.filename, signal: occupancy.signal, detail: occupancy.detail, hint: OCCUPANCY_HINT },
          0,
          { compact: true },
        );
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
        ? `--force: ${describeOccupancy(occupancy)} Rewriting anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes nothing, but its counts may shift while that process is running.`);
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
        printWarning('Apply mode rewrites audit/activity/decision rows. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRewrite every audit/activity/decision row carrying a stored metadata body or content hash on this database? [y/N] '),
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
      // [#21349] The dry run boots READ-ONLY — the same boot `os migrate plan`
      // takes: `deferSchemaDdl` holds schema DDL back and suppresses the
      // artifact's inline seed loader (whose upserts rewrite every seeded row
      // of the app's tables), and `readOnlyProbe` keeps a missing sqlite file
      // from being created. `--apply` keeps the plain boot, unchanged.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ audit: true }),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      // `SchemaStack.kernel` is untyped, so the slot's contract is stated on the
      // RESULT — the `objectql` slot serves `IObjectQLEngine`, whose
      // `find` / `findOne` / `update` are exactly what the rewrite calls.
      const engine = stack.kernel.getService('objectql') as IObjectQLEngine | undefined;
      if (typeof engine?.find !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot rewrite audit rows.');
      }

      const { migrateStoredMetadataBodyCopies } = await import('@objectstack/plugin-audit');

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21552] Not asked: the dry run's read-only boot measured which tables
      // exist, and a table that does not exist holds no copy to rewrite. The
      // rewrite reads through this view, which answers such a table with its
      // true contents (no rows) without issuing the read. Read anyway, each
      // audited table of a project whose database does not exist yet counted as
      // a failed read and the dry run exited 1 over rows that do not exist.
      // `--apply` booted plain, so there every table exists and every read is
      // real; its writes go to the engine itself.
      // ⚠️ `sys_activity` is the exception the boot cannot measure: it is
      // rotation-managed, its base name a view over time-sharded tables, and the
      // deferred sync lists a view as a table to create. It is read, and only
      // the refusal of a table that is not there reads as no rows
      // (`absentTableReads`). Believing the measurement would skip the very rows
      // this command exists to reach.
      // ⛔ Only a table that is MEASURED absent: any other refused read is
      // still counted in `failures` and still exits non-zero.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView: Pick<IObjectQLEngine, 'find' | 'findOne' | 'update'> = {
        find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)),
        findOne: (object, query, options) =>
          reads.absent(object) ? Promise.resolve(null) : engine.findOne(object, query, options),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await migrateStoredMetadataBodyCopies(readView, logger, { apply });

      if (flags.json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (report.failures > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      console.log('');
      for (const [object, stats] of Object.entries(report.byObject)) {
        console.log(`  ${chalk.white(object)}: ${stats.scanned} scanned, ${stats.rewritten} ${apply ? 'rewritten' : 'to rewrite'}`);
      }
      console.log('');

      if (report.failures > 0) {
        printError(`${report.failures} row(s) could not be rewritten — re-run to finish them.`);
      } else if (apply && report.rewritten > 0) {
        printSuccess(
          `Rewrote ${report.rewritten} audit/activity/decision row(s). Re-run any time — it only revisits rows still carrying a body or a hash.`,
        );
      } else if (apply) {
        printSuccess('Nothing to rewrite — no audit/activity/decision row carries a stored metadata body or content hash.');
      } else if (report.rewritten > 0) {
        printInfo(`Dry run only — ${report.rewritten} row(s) would be rewritten. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to rewrite — no audit/activity/decision row carries a stored metadata body or content hash.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures > 0) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
