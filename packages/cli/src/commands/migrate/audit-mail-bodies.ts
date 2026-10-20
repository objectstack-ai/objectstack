// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { MailLogBodyMigrationReport } from '@objectstack/plugin-audit';
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

/**
 * [#24899] What the command did about one declared archive target: `examined`
 * (its driver is registered on this boot, and `report` is the run), `none` (no
 * connected datasource and no runtime row of that name — the deployment has no
 * archive), `not-connected` (an active runtime datasource row of that name
 * exists, which this boot does not connect: NOT examined) or `unknown` (not
 * connected, and that row could not be read). The last two fail the run.
 */
interface ArchiveOutcome {
  datasource: string;
  objects: string[];
  status: 'examined' | 'none' | 'not-connected' | 'unknown';
  report?: MailLogBodyMigrationReport;
}

/**
 * Does the database hold an active runtime datasource row named `datasource`?
 * Runtime datasources are `sys_metadata` rows of type `datasource` — the
 * store `os serve`'s datasource admin rehydrates its pools from at boot. Ids
 * only are read; a refused read answers `unknown`, never `none`.
 */
async function runtimeDatasourceRowStatus(
  engine: Pick<IObjectQLEngine, 'find'>,
  datasource: string,
): Promise<'none' | 'not-connected' | 'unknown'> {
  try {
    const rows = await engine.find(
      'sys_metadata',
      { where: { type: 'datasource', name: datasource, state: 'active' }, fields: ['id'], limit: 1 },
      { context: { isSystem: true } },
    );
    return Array.isArray(rows) && rows.length > 0 ? 'not-connected' : 'none';
  } catch {
    return 'unknown';
  }
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
 * `os migrate audit-mail-bodies` — the one-off mask of the mail-log bodies the
 * audit writer copied in clear into `sys_audit_log` / `sys_activity` (#24693).
 *
 * The audit writer COPIES a `sys_email` / `sys_identity_email` row into
 * `sys_audit_log.new_value` / `old_value` and both halves of
 * `sys_activity.metadata`. Before #24625 that copy carried the mail BODY in
 * clear, reset, verification, magic-link and invitation links included: a
 * second, at-rest store of them. The writer masks those columns now, but only
 * on NEW writes; rows copied before keep the body. This command masks them with
 * the writer's own mask (`@objectstack/plugin-audit`'s
 * `migrateMailLogBodyCopies`). Operators run it once after upgrading, dry run
 * first.
 *
 * Its own command, not a step of `os migrate organization-ownership`: it masks
 * every copy of both mail logs, so it needs no identity-mail selector and gives
 * the same result run before or after the ceremony, on a database the ceremony
 * never runs on too. Only the copy column of a copy row is written.
 *
 * Dry run by default (writes no row), `--apply` to mask. Idempotent: a masked
 * body is the mask, so a second run masks nothing — re-running and reading a
 * clean report is the verification. The report is counts only. No
 * `sys_migration` flag is recorded: nothing gates irreversible behaviour on it.
 * The flags are `os migrate audit-metadata-bodies`'s, one for one.
 *
 * ## The archive datasource too (#24899)
 *
 * `sys_audit_log` declares `lifecycle.archive` (`to: 'archive'`): the
 * Archiver copies rows past the hot window to that datasource verbatim and
 * deletes them hot, and the engine never routes the object there. So a copy
 * archived before the writer masked still holds the body, out of the hot run's
 * reach. After the hot run this command reads each copy table's declared
 * archive target and, when this boot connected a datasource of that name,
 * runs the same runner through its driver (`migrateArchivedMailLogBodyCopies`),
 * in the same dry-run / `--apply` mode. A hot copy masked before the Archiver
 * moves it is archived masked, so the two runs cover the copies already
 * archived and the ones still to be.
 *
 * Absence is loud: when the target is not connected here but the database
 * holds an active runtime datasource row of that name (one an admin created,
 * which `os serve` connects and this boot does not), the archive was NOT
 * examined — the report says so and the command exits non-zero. No such row
 * and no connected datasource means the deployment has no archive, and the
 * Archiver retains every row hot: nothing to mask there.
 */
export default class MigrateAuditMailBodies extends Command {
  static override description =
    'Mask the mail bodies (body_text, body_html) of sys_email / sys_identity_email rows that the audit writer ' +
    'copied in clear into sys_audit_log / sys_activity before it masked them, on this database and in the archive ' +
    'datasource sys_audit_log archives to. Dry run by default; --apply writes. Reports counts only.';

  static override examples = [
    '$ os migrate audit-mail-bodies',
    '$ os migrate audit-mail-bodies --apply',
    '$ os migrate audit-mail-bodies --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Mask the copies that hold a mail body in clear (default is a read-only dry run)',
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
   * [#24899] The process must end when the run does — the reason `os migrate
   * plan`'s does (#13027): the boot connects the declared datasources
   * (`composeDeclaredDatasources`), and a pool it opened can leave the event
   * loop alive after the kernel reports a clean shutdown. The failure paths
   * exit through oclif's own signal and do not come back here.
   */
  async run(): Promise<void> {
    await this.mask();
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  private async mask(): Promise<void> {
    const { flags } = await this.parse(MigrateAuditMailBodies);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · audit-mail-bodies');
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
        ? `--force: ${describeOccupancy(occupancy)} Masking anyway — the live process may write rows mid-walk.`
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
        chalk.bold('\nMask the mail body in every audit/activity copy of a mail-log row on this database and its archive? [y/N] '),
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
        // [#24899] Connect the declared datasources as `os serve` does, so a
        // declared archive datasource is registered under its name and the
        // archive run below reaches it.
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

      const { migrateMailLogBodyCopies, migrateArchivedMailLogBodyCopies, MAIL_LOG_BODY_COPY_OBJECTS } =
        await import('@objectstack/plugin-audit');

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21552] The read view `os migrate audit-metadata-bodies` reads the same
      // two tables through: a table the read-only boot MEASURED absent holds no
      // copy and answers no rows without the read; `sys_activity`, rotation-
      // managed and a view over time-sharded tables, is always read, and only
      // the refusal of a table that is not there reads as no rows. ⛔ Any other
      // refused read is still counted in `failures` and still exits non-zero.
      // `--apply` booted plain; its writes go to the engine itself.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView: Pick<IObjectQLEngine, 'find' | 'update'> = {
        find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await migrateMailLogBodyCopies(readView, logger, { apply });

      // [#24899] Each copy table's declared archive target, then the same
      // runner through that datasource's driver — the registry the Archiver
      // itself resolves `archive.to` against (`engine.datasource(name)`).
      const targets = new Map<string, Array<(typeof MAIL_LOG_BODY_COPY_OBJECTS)[number]>>();
      for (const object of MAIL_LOG_BODY_COPY_OBJECTS) {
        const to = (engine.getObject(object) as { lifecycle?: { archive?: { to?: unknown } } } | undefined)
          ?.lifecycle?.archive?.to;
        if (typeof to !== 'string' || to === '') continue;
        targets.set(to, [...(targets.get(to) ?? []), object]);
      }
      const archive: ArchiveOutcome[] = [];
      for (const [datasource, objects] of targets) {
        const driver = engine.getDriverByName?.(datasource);
        if (driver) {
          const archived = await migrateArchivedMailLogBodyCopies(driver, logger, { apply, objects });
          archive.push({ datasource, objects, status: 'examined', report: archived });
          continue;
        }
        // Not connected on this boot. A runtime datasource row of that name is
        // an archive `os serve` connects and this boot cannot: NOT examined.
        archive.push({ datasource, objects, status: await runtimeDatasourceRowStatus(readView, datasource) });
      }
      const archiveFailures = archive.reduce(
        (n, a) => n + (a.report?.failures ?? 0) + (a.status === 'not-connected' || a.status === 'unknown' ? 1 : 0),
        0,
      );
      const failures = report.failures + archiveFailures;

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
          `  ${chalk.white(object)}: ${stats.scanned} mail-log cop(ies) scanned, ${stats.rewritten} ${apply ? 'masked' : 'to mask'}`,
        );
      }
      for (const a of archive) {
        if (a.report) {
          for (const [object, stats] of Object.entries(a.report.byObject)) {
            console.log(
              `  ${chalk.white(object)} (archive datasource '${a.datasource}'): ${stats.scanned} mail-log cop(ies) scanned, ` +
                `${stats.rewritten} ${apply ? 'masked' : 'to mask'}`,
            );
          }
        } else if (a.status === 'none') {
          console.log(chalk.dim(`  archive datasource '${a.datasource}': none on this deployment — nothing archived, nothing to mask`));
        }
      }
      console.log('');
      for (const a of archive) {
        if (a.status === 'not-connected') {
          printError(
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) was NOT examined: the database holds an active ` +
              `runtime datasource of that name, which \`os serve\` connects and this command does not, so its archived ` +
              `copies may still hold a mail body in clear. Declare it in the stack config's \`datasources\` ` +
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
          `Masked the mail body in ${rewritten} audit/activity row(s). Re-run any time — it only revisits copies still holding a body.`,
        );
      } else if (!apply && rewritten > 0) {
        printInfo(`Dry run only — ${rewritten} row(s) would be masked. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to mask — no audit/activity copy of a mail-log row holds a mail body in clear.');
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
