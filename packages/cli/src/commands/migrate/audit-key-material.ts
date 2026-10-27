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
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import { archiveFailureCount, examineArchiveTargets } from '../../utils/ledger-copy-archive.js';

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
 * `os migrate audit-key-material` — the one-off removal of the encrypted
 * key-material columns from the ledger copies the audit writer stored in
 * `sys_audit_log` / `sys_activity` before it omitted them.
 *
 * The audit writer COPIES an audited row into `sys_audit_log.new_value` /
 * `old_value` and both halves of `sys_activity.metadata`. For the objects
 * `@objectstack/plugin-audit` lists (`KEY_MATERIAL_COPY_COLUMNS`), that copy
 * used to carry an encrypted key-material column. The writer omits those
 * columns now, but only on NEW writes; rows copied before keep them. This
 * command removes them with the writer's own helper
 * (`migrateKeyMaterialCopies`). Operators run it once after upgrading, dry run
 * first.
 *
 * It is `os migrate audit-mail-bodies`'s twin: the same runner and stores in
 * plugin-audit, driven with a different list and planners, and the same
 * command shape here — flags, read-only dry-run boot, absent-table read view,
 * archive run and exit semantics. Only the copy column of a copy row is
 * written, under `preserveAudit` with the row's stored `updated_at`; every
 * other key of the copy is kept.
 *
 * Dry run by default (writes no row), `--apply` to remove. Idempotent: a copy
 * without the columns has nothing to remove, so a second run rewrites nothing —
 * re-running and reading a clean report is the verification. The report is
 * counts only and no line names a value. No `sys_migration` flag is recorded:
 * nothing gates irreversible behaviour on it.
 *
 * ## The archive datasource too
 *
 * `sys_audit_log` declares `lifecycle.archive`: the Archiver copies rows past
 * the hot window to that datasource verbatim and deletes them hot, and the
 * engine never routes the object there. After the hot run this command reads
 * each copy table's declared archive target and, when this boot connected a
 * datasource of that name, runs the same rewrite through its driver
 * (`migrateArchivedKeyMaterialCopies`), in the same dry-run / `--apply` mode.
 * Absence is loud, exactly as for `audit-mail-bodies`: an archive this boot
 * did not reach but the stack config declares, or that an active runtime
 * datasource row names, is NOT examined, and the command exits non-zero
 * (`../../utils/ledger-copy-archive.ts` holds the one classification).
 */
export default class MigrateAuditKeyMaterial extends Command {
  static override description =
    'Remove the encrypted key-material columns from the sys_audit_log / sys_activity copies the audit writer stored ' +
    'before it omitted them, on this database and in the archive datasource sys_audit_log archives to. ' +
    'Dry run by default; --apply writes. Reports counts only.';

  static override examples = [
    '$ os migrate audit-key-material',
    '$ os migrate audit-key-material --apply',
    '$ os migrate audit-key-material --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Remove the key-material columns from the copies that hold them (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  /**
   * The process must end when the run does, as `os migrate audit-mail-bodies`'
   * does: the boot connects the declared datasources
   * (`composeDeclaredDatasources`), and a pool it opened can leave the event
   * loop alive after the kernel reports a clean shutdown. The failure paths
   * exit through oclif's own signal and do not come back here.
   */
  async run(): Promise<void> {
    await this.rewrite();
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  private async rewrite(): Promise<void> {
    const { flags } = await this.parse(MigrateAuditKeyMaterial);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · audit-key-material');
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
        printWarning('Apply mode rewrites audit/activity rows (and archived audit rows). Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRemove the key-material columns from every audit/activity ledger copy on this database and its archive? [y/N] '),
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
      // The dry run boots READ-ONLY — the boot `os migrate plan` takes:
      // `deferSchemaDdl` holds schema DDL back and suppresses the artifact's
      // inline seed loader, and `readOnlyProbe` keeps a missing sqlite file
      // from being created. `--apply` keeps the plain boot.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ audit: true }),
        // Connect the declared datasources as `os serve` does, so a declared
        // archive datasource is registered under its name and the archive run
        // below reaches it.
        composeDeclaredDatasources: true,
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
      // RESULT — the `objectql` slot serves `IObjectQLEngine`, whose `find` /
      // `update` are exactly what the rewrite calls.
      const engine = stack.kernel.getService('objectql') as IObjectQLEngine | undefined;
      if (typeof engine?.find !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot rewrite audit rows.');
      }

      const { migrateKeyMaterialCopies, migrateArchivedKeyMaterialCopies, KEY_MATERIAL_COPY_TABLES } =
        await import('@objectstack/plugin-audit');

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // The read view `os migrate audit-mail-bodies` reads the same two tables
      // through: a table the read-only boot MEASURED absent holds no copy and
      // answers no rows without the read; `sys_activity`, rotation-managed and a
      // view over time-sharded tables, is always read, and only the refusal of a
      // table that is not there reads as no rows. ⛔ Any other refused read is
      // still counted in `failures` and still exits non-zero. `--apply` booted
      // plain; its writes go to the engine itself.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView: Pick<IObjectQLEngine, 'find' | 'update'> = {
        find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await migrateKeyMaterialCopies(readView, logger, { apply });

      // Each copy table's declared archive target, then the same rewrite
      // through that datasource's driver.
      const archive = await examineArchiveTargets({
        engine,
        kernel: stack.kernel,
        reads: readView,
        tables: KEY_MATERIAL_COPY_TABLES,
        run: (driver, objects) => migrateArchivedKeyMaterialCopies(driver, logger, { apply, objects }),
      });
      const failures = report.failures + archiveFailureCount(archive);

      if (flags.json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, apply, report, archive, duration: timer.elapsed() });
        if (failures > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      console.log('');
      for (const [object, stats] of Object.entries(report.byObject)) {
        console.log(
          `  ${chalk.white(object)}: ${stats.scanned} ledger cop(ies) scanned, ${stats.rewritten} ${apply ? 'rewritten' : 'to rewrite'}`,
        );
      }
      for (const a of archive) {
        if (a.report) {
          for (const [object, stats] of Object.entries(a.report.byObject)) {
            console.log(
              `  ${chalk.white(object)} (archive datasource '${a.datasource}'): ${stats.scanned} ledger cop(ies) scanned, ` +
                `${stats.rewritten} ${apply ? 'rewritten' : 'to rewrite'}`,
            );
          }
        } else if (a.status === 'none') {
          console.log(chalk.dim(
            `  archive datasource '${a.datasource}': none declared and connected on this boot, and no active runtime ` +
              `datasource row names one — nothing examined. An archive a host registers in code outside the stack ` +
              `config is not reached: declare it in the config's \`datasources\` with \`autoConnect: true\`.`,
          ));
        }
      }
      console.log('');
      for (const a of archive) {
        if (a.status === 'not-connected' && a.connection) {
          printError(
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) was NOT examined: the stack config declares ` +
              `it, and this boot did not connect it (${a.connection.status}` +
              `${a.connection.reason ? `: ${a.connection.reason}` : ''}), so its archived copies may still hold ` +
              `key-material columns. Make it reachable from where this command runs, and re-run.`,
          );
        } else if (a.status === 'not-connected') {
          printError(
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) was NOT examined: the database holds an active ` +
              `runtime datasource of that name, which \`os serve\` connects and this command does not, so its archived ` +
              `copies may still hold key-material columns. Declare it in the stack config's \`datasources\` ` +
              `(with \`autoConnect: true\`) and re-run.`,
          );
        } else if (a.status === 'unknown') {
          printError(
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) was NOT examined: it is not connected on this ` +
              `boot, and whether the database holds a runtime datasource of that name could not be read.`,
          );
        }
      }

      const rewritten = report.rewritten + archive.reduce((n, a) => n + (a.report?.rewritten ?? 0), 0);
      if (failures > 0) {
        printError(`${failures} read(s), row(s) or archive datasource(s) failed — re-run to finish them.`);
      } else if (apply && rewritten > 0) {
        printSuccess(
          `Removed the key-material columns from ${rewritten} audit/activity row(s). Re-run any time — it only revisits copies still holding them.`,
        );
      } else if (!apply && rewritten > 0) {
        printInfo(`Dry run only — ${rewritten} row(s) would be rewritten. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to remove — no audit/activity copy holds a key-material column.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (failures > 0) this.exit(1);
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
