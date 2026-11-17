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
import { composeRedactionSeal } from '../../utils/audit-redaction-seal.js';
import { sealerStoppedFlag, underAuditSealLock } from '../../utils/audit-seal-lock.js';
import { objectNotFoundError } from '@objectstack/core';

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
 * `os migrate audit-side-copies` — the one-off removal of the side-copy
 * columns from the ledger copies the audit writer stored in `sys_audit_log` /
 * `sys_activity` before it omitted them (#32442, #33155).
 *
 * A side-copy column holds ANOTHER record's field values, served on its own
 * row only through its owner's per-reader narrowing (`side-copy-columns.ts` in
 * `@objectstack/plugin-audit`; today `sys_approval_request.payload_json`). A
 * ledger copy cannot be narrowed that way, so the writer omits those columns
 * from every new copy; copies written before keep them. This command removes
 * them with the writer's own list (`migrateSideCopies` on the hot tables,
 * `migrateArchivedSideCopies` on the archive). Operators run it once after
 * upgrading, dry run first. Until it has run, the serve-time redactions drop
 * the columns and the query guards treat a query naming one as reaching every
 * object, so it is completeness, not a gate.
 *
 * It is `os migrate audit-key-material`'s twin: the same runner and stores in
 * plugin-audit, driven with a different list and planners, and the same
 * command shape here (flags, read-only dry-run boot, absent-table read view,
 * redaction seal, archive run and exit semantics), plus `--object`, which
 * narrows the run to the named copy tables. A name that is not one of them is
 * refused before the boot (`OBJECT_NOT_FOUND`), never narrowed to nothing.
 * Its redaction amendments name it `os migrate audit-side-copies`
 * (`rewritten_by`), as the twins name theirs.
 *
 * Dry run by default (writes no row), `--apply` to remove. Idempotent: a copy
 * without the columns has nothing to remove, so a second run rewrites nothing —
 * re-running and reading a clean report is the verification. The report is
 * counts only, per copy table and per store, and no line names a value. No
 * `sys_migration` flag is recorded: nothing gates irreversible behaviour on it.
 *
 * ## The archive datasource too
 *
 * After the hot run this command reads each selected copy table's declared
 * archive target (`lifecycle.archive.to`) and, when this boot connected a
 * datasource of that name, runs the same rewrite through its driver, in the
 * same dry-run / `--apply` mode. Absence is loud, exactly as for the twins:
 * an archive this boot did not reach but the stack config declares, or that an
 * active runtime datasource row names, is NOT examined, and the command exits
 * non-zero (`../../utils/ledger-copy-archive.ts` holds the one classification).
 */
export default class MigrateAuditSideCopies extends Command {
  static override description =
    'Remove the side-copy columns (another record\'s field values, such as an approval request\'s payload_json) from ' +
    'the sys_audit_log / sys_activity copies the audit writer stored before it omitted them, on this database and in ' +
    'the archive datasource sys_audit_log archives to. Dry run by default; --apply writes. Reports counts only.';

  static override examples = [
    '$ os migrate audit-side-copies',
    '$ os migrate audit-side-copies --object sys_audit_log',
    '$ os migrate audit-side-copies --apply',
    '$ os migrate audit-side-copies --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Remove the side-copy columns from the copies that hold them (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description: 'Rewrite only this copy table (sys_audit_log or sys_activity), on this database and its archive. Repeatable; default both',
      multiple: true,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
    'sealer-stopped': sealerStoppedFlag,
  };

  /**
   * The process must end when the run does, as `os migrate audit-key-material`
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
    const { flags } = await this.parse(MigrateAuditSideCopies);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · audit-side-copies');

    // `--object` names copy tables; anything else is refused before the boot,
    // with the family's envelope (`OBJECT_NOT_FOUND`), never narrowed to nothing.
    const { migrateSideCopies, migrateArchivedSideCopies, SIDE_COPY_TABLES } = await import('@objectstack/plugin-audit');
    const unknown = [...new Set((flags.object ?? []).filter((name) => !(SIDE_COPY_TABLES as readonly string[]).includes(name)))];
    if (unknown.length > 0) {
      const error = objectNotFoundError(unknown[0]);
      error.message =
        `${unknown.length === 1 ? 'Object' : 'Objects'} ${unknown.map((name) => `'${name}'`).join(', ')} not a ledger copy ` +
        `table: --object takes one of ${[...SIDE_COPY_TABLES].sort().join(', ')}, and nothing was read.`;
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(error.message);
      this.exit(1);
      return;
    }
    const objects = flags.object
      ? SIDE_COPY_TABLES.filter((table) => flags.object!.includes(table))
      : [...SIDE_COPY_TABLES];
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
        chalk.bold(`\nRemove the side-copy columns from every ${objects.join(' / ')} ledger copy on this database and its archive? [y/N] `),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');
    }

    // [ADR-0154 D7] The crypto `os serve` seals with, so a sealed copy is amended before it is rewritten.
    const redaction = await composeRedactionSeal();
    let stack;
    try {
      // The dry run boots READ-ONLY — the boot `os migrate plan` takes:
      // `deferSchemaDdl` holds schema DDL back and suppresses the artifact's
      // inline seed loader, and `readOnlyProbe` keeps a missing sqlite file
      // from being created. `--apply` keeps the plain boot.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: [...(await buildDataMigrationPlugins({ audit: true })), ...redaction.plugins],
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

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // The read view `os migrate audit-key-material` reads the same two tables
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

      const seal = await redaction.seal(stack.kernel, engine);
      // [ADR-0154 D3 amended] An --apply run holds the audit seal lock from before its first rewrite to after its
      // last, archive runs included, on the copy tables it rewrites (`--object` narrows them), so no sealer pass
      // seals a row it rewrites; where the database offers no session lock, a run on a sealed object needs
      // --sealer-stopped (seat ruling 6885005594, E + B), as for its twins.
      const { result: { report, archive }, lostLock } = await underAuditSealLock(
        engine,
        { apply, sealerStopped: flags['sealer-stopped'], objects: objects, warn: (line) => logger.warn(line) },
        async () => {
          const report = await migrateSideCopies(readView, logger, { apply, objects, seal });
          // Each copy table's declared archive target, then the same rewrite
          // through that datasource's driver.
          const archive = await examineArchiveTargets({
            engine,
            kernel: stack.kernel,
            reads: readView,
            tables: objects,
            run: (driver, archived) => migrateArchivedSideCopies(driver, logger, { apply, objects: archived, seal }),
          });
          return { report, archive };
        },
      );
      const failures = report.failures + archiveFailureCount(archive);
      const refused = report.refused + archive.reduce((n, a) => n + (a.report?.refused ?? 0), 0);

      if (flags.json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, apply, objects, report, archive, ...(lostLock ? { sealLockLost: lostLock } : {}), duration: timer.elapsed() });
        if (failures > 0 || refused > 0 || lostLock) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      console.log('');
      for (const [object, stats] of Object.entries(report.byObject)) {
        console.log(
          `  ${chalk.white(object)}: ${stats.scanned} ledger cop(ies) scanned, ${stats.rewritten} ${apply ? 'rewritten' : 'to rewrite'}` +
            (stats.refused > 0 ? `, ${stats.refused} sealed and refused` : ''),
        );
      }
      for (const a of archive) {
        if (a.report) {
          for (const [object, stats] of Object.entries(a.report.byObject)) {
            console.log(
              `  ${chalk.white(object)} (archive datasource '${a.datasource}'): ${stats.scanned} ledger cop(ies) scanned, ` +
                `${stats.rewritten} ${apply ? 'rewritten' : 'to rewrite'}` + (stats.refused > 0 ? `, ${stats.refused} sealed and refused` : ''),
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
              `side-copy columns. Make it reachable from where this command runs, and re-run.`,
          );
        } else if (a.status === 'not-connected') {
          printError(
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) was NOT examined: the database holds an active ` +
              `runtime datasource of that name, which \`os serve\` connects and this command does not, so its archived ` +
              `copies may still hold side-copy columns. Declare it in the stack config's \`datasources\` ` +
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
      if (refused > 0) printError(redaction.refusedLine(refused));
      if (lostLock) printError(lostLock);
      if (failures > 0) {
        printError(`${failures} read(s), row(s) or archive datasource(s) failed — re-run to finish them.`);
      } else if (apply && rewritten > 0) {
        printSuccess(
          `Removed the side-copy columns from ${rewritten} audit/activity row(s). Re-run any time — it only revisits copies still holding them.`,
        );
      } else if (!apply && rewritten > 0) {
        printInfo(`Dry run only — ${rewritten} row(s) would be rewritten. Re-run with --apply.`);
      } else if (refused === 0) {
        printSuccess('Nothing to remove — no audit/activity copy holds a side-copy column.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (failures > 0 || refused > 0 || lostLock) this.exit(1);
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
