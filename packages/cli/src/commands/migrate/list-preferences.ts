// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import chalk from 'chalk';
import type { ObjectQL } from '@objectstack/objectql';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  errorCodeFields,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { composeProviderForDeclarations } from '../../utils/schema-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import type { ListPreferenceExport, ListPreferencePlan } from '../../utils/list-preference-sweep.js';

/**
 * `os migrate list-preferences` — delete the per-reader list preference rows
 * an earlier Console stored in `sys_user_preference` under `ui.list.<object>`
 * (#35955).
 *
 * The Console no longer reads or writes that key family: a sort, filter or
 * column change on a list is an unsaved draft, and the column widths, row
 * height and view-tab order live in the reader's browser. The stored rows are
 * not migrated anywhere — the maintainer ruled them cleared — so after an
 * upgrade they are dead weight that no door reads. This command removes them.
 * The family, and why the delete matches it byte for byte, is documented on
 * `../../utils/list-preference-sweep.ts`.
 *
 * ## The shape is `os db orphans`', with the `os migrate` flags
 *
 *  1. An explicit operator command. ⛔ Nothing on any boot, upgrade, migrate
 *     or lifecycle path invokes it, and it must not grow such a caller
 *     (`list-preferences.no-auto-run.test.ts` holds it).
 *  2. The default run is a dry-run report that writes no row or table: counts
 *     per key and the readers holding each, never a value. The report boots
 *     READ-ONLY, the boot `os migrate plan` takes.
 *  3. `--apply` deletes, and only with `--export`: every row the run deletes,
 *     as stored, written owner-only (`0600`), created here or not at all
 *     (`wx`), and READ BACK before the first delete. Any failure there
 *     refuses the whole run with nothing deleted.
 *  4. Each delete is the engine's by-id delete in the system context, on every
 *     organization's rows: the family is read from the driver, unscoped.
 *  5. Judged by what is gone, never by what a delete returned: after the
 *     deletes the family is read again, and any row still there (one that
 *     failed, or one an older Console wrote since the export) exits 1.
 *
 * Re-runnable: a second run finds nothing, writes no export and deletes
 * nothing. `ui.record.*` and every other preference key are untouched.
 */
export default class MigrateListPreferences extends Command {
  static override description =
    'Delete the per-reader list preference rows an earlier Console stored in sys_user_preference under ' +
    '"ui.list.<object>" (column widths, row height, tab order and, before that, sorts and filters), which the ' +
    'Console no longer reads. Dry run by default: counts per key, writes no row. --apply deletes them, only with ' +
    '--export, after writing every row it deletes to an owner-only file and reading it back.';

  static override examples = [
    '$ os migrate list-preferences',
    '$ os migrate list-preferences --json',
    '$ os migrate list-preferences --apply --export ./list-preferences-backup.json',
    '$ os migrate list-preferences --apply --export ./list-preferences-backup.json --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description:
        'Delete the listed rows (default is a read-only dry run that writes no row or table). Requires --export.',
      default: false,
    }),
    export: Flags.string({
      description:
        'Path for the MANDATORY pre-delete export: every row the run deletes, as stored, written owner-only and '
        + 'read back before the first delete. Refuses to overwrite.',
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON (implies non-interactive; requires --yes to apply)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateListPreferences);
    const timer = createTimer();
    const json = flags.json;
    const apply = flags.apply;

    if (!json) printHeader('Migrate · list-preferences');

    if (apply && !flags.export) {
      const message =
        'Refusing to delete without --export. The pre-delete export is mandatory: it is the only copy of the '
        + 'rows this run deletes. Name a path for it.';
      if (json) { await emitJson({ error: 'export_required', message }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    const exportPath = flags.export ? resolvePath(flags.export) : undefined;
    if (exportPath && existsSync(exportPath)) {
      const message = `Refusing to overwrite an existing export at ${exportPath}. Name a new path.`;
      if (json) { await emitJson({ error: 'export_exists', message, path: exportPath }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    // A live server on the same SQLite file may write rows mid-run.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (json) {
        await emitJson(
          { error: 'database_busy', database: occupancy.filename, signal: occupancy.signal, detail: occupancy.detail, hint: OCCUPANCY_HINT },
          1,
          { compact: true },
        );
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && !json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Deleting anyway — the live process may write rows mid-run.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table, but its counts may shift while that process is running. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (!json) printStep(apply ? 'Booting (APPLY mode)…' : 'Booting (dry run)…');

    // Loaded at the point of use, never at module load: oclif `import()`s every
    // command module on every invocation while building its table.
    const { LIST_PREFERENCE_OBJECT, buildListPreferenceExport, exportedIds, planListPreferenceSweep, readListPreferenceRows } =
      await import('../../utils/list-preference-sweep.js');
    const { createIdentityObjectsPlugin } = await import('@objectstack/plugin-auth');

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        // `sys_user_preference` is an identity object: registered for its
        // declaration only — no auth manager, no hook, nothing started.
        extraPlugins: [composeProviderForDeclarations(createIdentityObjectsPlugin())],
        // The dry run boots READ-ONLY, the boot `os migrate plan` takes.
        // `--apply` keeps the plain boot: it deletes rows.
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error) {
      const message = messageOf(error);
      if (json) { await emitJson({ error: 'boot_failed', message, ...errorCodeFields(error) }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    try {
      // Either mode's connect may have switched a SQLite file's journal mode,
      // which rewrites its header and no row, so no line below says nothing changed.
      const journalNote = describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      const engine = stack.kernel.getService('objectql') as ListPreferenceEngine | undefined;
      const driver = engine?.getDriverForObject(LIST_PREFERENCE_OBJECT);
      if (!engine || !driver) {
        const message = `No ObjectQL engine or driver serves ${LIST_PREFERENCE_OBJECT} on this runtime, so no row can be read.`;
        if (json) { await emitJson({ error: 'no_engine', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      // A table the read-only boot measured absent stores nothing, so it is not read.
      const reads = absentTableReads(stack, (object) => engine.getConfigs()[object]);
      const readFamily = (): Promise<Record<string, unknown>[]> =>
        reads.rows(LIST_PREFERENCE_OBJECT, () => readListPreferenceRows(driver));
      const rows = await readFamily();
      const plan = planListPreferenceSweep(rows);
      reads.notice(json);

      if (!apply) {
        if (json) { await emitJson({ mode: 'report', database: stack.dbLabel, plan }, 0, { compact: true }); return; }
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        renderPlan(plan);
        printInfo(`Dry run only — no row or table was written or deleted.${journalNote} (${timer.display()})`);
        if (plan.counts.rows > 0) printInfo('Re-run with --apply --export <path> to delete the listed rows.');
        return;
      }

      if (rows.length === 0) {
        if (json) { await emitJson({ mode: 'apply', database: stack.dbLabel, plan, deleted: 0, failed: [], remaining: 0 }, 0, { compact: true }); return; }
        renderPlan(plan);
        printSuccess('Nothing to delete — no export was written.');
        return;
      }

      if (!json) {
        renderPlan(plan);
        printWarning(
          `About to permanently delete ${rows.length} ${LIST_PREFERENCE_OBJECT} row(s). The export below is the only copy that survives.`,
        );
      }
      if (!flags.yes) {
        if (json) { await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 1, { compact: true }); return; }
        const ok = await confirm(chalk.yellow(`  Delete ${rows.length} row(s) after writing the export? [y/N] `));
        if (!ok) { printInfo(`Aborted — no export was written and no row was deleted.${journalNote}`); return; }
      }

      // ── The export, written and READ BACK before anything is deleted ──────
      const ids = rows.map((row) => String(row.id));
      let verified: Set<string>;
      try {
        const doc = buildListPreferenceExport({ rows, producedBy: `${this.config.bin} migrate list-preferences --apply` });
        // Owner-only, and CREATED here or not written at all: the existence check
        // above runs before the boot and the prompt, so it is a pre-check, never
        // the guarantee. `wx` makes the guarantee atomic. Then read back rather
        // than trusting the write: a short or unreadable file would leave the
        // delete with no copy at all, and look like a clean run.
        writeFileSync(exportPath!, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        verified = exportedIds(JSON.parse(readFileSync(exportPath!, 'utf8')) as ListPreferenceExport);
      } catch (error) {
        const message =
          `Refusing to delete: the pre-delete export could not be written and read back at ${exportPath} — ${messageOf(error)}`;
        if (json) { await emitJson({ error: 'export_failed', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      const missing = ids.filter((id) => !verified.has(id));
      if (missing.length > 0) {
        const message =
          `Refusing to delete: the export at ${exportPath} does not hold ${missing.length} of the ${ids.length} `
          + 'row(s) to be deleted.';
        if (json) { await emitJson({ error: 'export_incomplete', message, missing }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      if (!json) printSuccess(`Pre-delete export written (owner-only): ${exportPath}`);

      // ── Only the exported rows, each by id, as the system ─────────────────
      const refusals = new Map<string, unknown>();
      for (const id of ids) {
        try {
          await engine.delete(LIST_PREFERENCE_OBJECT, { where: { id }, context: { isSystem: true } });
        } catch (error) {
          refusals.set(id, error);
        }
      }

      // Judged by what is gone, never by what a delete returned.
      const left = await readFamily();
      const leftIds = new Set(left.map((row) => String(row.id)));
      const failed = ids
        .filter((id) => leftIds.has(id))
        .map((id) => {
          const refusal = refusals.get(id);
          return {
            id,
            message: refusal ? messageOf(refusal) : 'the delete returned, but the row is still stored',
            ...(refusal ? errorCodeFields(refusal) : {}),
          };
        });
      const deleted = ids.length - failed.length;
      const unlisted = left.length - failed.length;

      if (json) {
        await emitJson(
          { mode: 'apply', database: stack.dbLabel, export: exportPath, plan, deleted, failed, remaining: left.length },
          left.length > 0 ? 1 : 0,
          { compact: true },
        );
        return;
      }
      printSuccess(`Deleted ${deleted} ${LIST_PREFERENCE_OBJECT} row(s) in ${timer.display()}.`);
      for (const f of failed) printError(`  ${f.id}: ${f.message}`);
      if (unlisted > 0) {
        printError(
          `  ${unlisted} row(s) of the family appeared after the export was written (a Console that still writes `
          + 'them is running?). They were not deleted; re-run with a new --export path.',
        );
      }
      printInfo(`Keep ${exportPath} until you are certain the sweep was correct — it is the only copy.`);
      if (left.length > 0) this.exit(1);
    } catch (error) {
      // A read the run could not make is a refusal, and under `--json` a
      // refusal is still one JSON document.
      if (isExitSignal(error)) throw error;
      const message = messageOf(error);
      if (json) { await emitJson({ error: 'scan_failed', message, ...errorCodeFields(error) }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}

/** The engine slice this command reads, and the one write verb it uses. */
type ListPreferenceEngine = Pick<ObjectQL, 'delete' | 'getConfigs' | 'getDriverForObject'>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Render the plan for a human: counts only, never a value. */
function renderPlan(plan: ListPreferencePlan): void {
  console.log(chalk.bold(`\n  ${plan.object} rows keyed ${plan.prefix}<object>`));
  printInfo(
    `${plan.counts.rows} row(s) · ${plan.counts.users} reader(s) · ${plan.counts.organizations} organization(s)`,
  );
  for (const entry of plan.byKey) {
    console.log(`    ${chalk.white(entry.key)}: ${entry.rows} row(s), ${entry.users} reader(s)`);
  }
  console.log('');
}
