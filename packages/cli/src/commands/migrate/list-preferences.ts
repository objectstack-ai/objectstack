// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve as resolvePath } from 'node:path';
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
import { composeProviderForDeclarations } from '../../utils/schema-migration-plugins.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
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

/** The object the retired rows are stored in. */
export const USER_PREFERENCE_OBJECT = 'sys_user_preference';

/**
 * The key prefix of the retired rows: one per user and object, written by
 * Consoles before the list layout moved to the browser.
 */
export const RETIRED_LIST_PREFERENCE_PREFIX = 'ui.list.';

const SYSTEM = { isSystem: true } as const;
const PAGE_SIZE = 500;

/** One retired row, as stored. */
export interface RetiredListPreferenceRow {
  id: string;
  user_id: unknown;
  key: string;
  value: unknown;
  [column: string]: unknown;
}

/** The pre-delete export: every row the run deletes, as stored. */
export interface RetiredListPreferenceExport {
  producedBy: string;
  object: typeof USER_PREFERENCE_OBJECT;
  keyPrefix: typeof RETIRED_LIST_PREFERENCE_PREFIX;
  rows: RetiredListPreferenceRow[];
}

type ReadEngine = Pick<IObjectQLEngine, 'find'>;

/**
 * Every stored `ui.list.*` row, walked in id order a page at a time, so a row
 * written mid-walk cannot shift another out of the walk.
 */
export async function listRetiredListPreferenceRows(
  engine: ReadEngine,
  read: <T>(run: () => Promise<T[]>) => Promise<T[]> = (run) => run(),
): Promise<RetiredListPreferenceRow[]> {
  const out: RetiredListPreferenceRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await read(async () => (await engine.find(USER_PREFERENCE_OBJECT, {
      where: {
        key: { $startsWith: RETIRED_LIST_PREFERENCE_PREFIX },
        ...(after !== undefined ? { id: { $gt: after } } : {}),
      },
      orderBy: [{ field: 'id', order: 'asc' }],
      limit: PAGE_SIZE,
      context: { ...SYSTEM },
    } as never)) as RetiredListPreferenceRow[]);
    for (const row of page) {
      if (row && typeof row.key === 'string' && row.key.startsWith(RETIRED_LIST_PREFERENCE_PREFIX)) out.push(row);
    }
    if (page.length < PAGE_SIZE) break;
    after = String(page[page.length - 1].id);
  }
  return out;
}

/** What a dry run reports, and what `--apply` deletes. */
export interface RetiredListPreferenceSummary {
  rows: number;
  users: number;
  objects: string[];
}

export function summarizeRetiredListPreferences(rows: readonly RetiredListPreferenceRow[]): RetiredListPreferenceSummary {
  const users = new Set(rows.map((row) => String(row.user_id)));
  const objects = new Set(rows.map((row) => row.key.slice(RETIRED_LIST_PREFERENCE_PREFIX.length)));
  return { rows: rows.length, users: users.size, objects: [...objects].sort() };
}

/**
 * `os migrate list-preferences` — remove the per-user list preference rows a
 * Console no longer reads: every `sys_user_preference` row whose key starts
 * with `ui.list.` (objectstack#35955).
 *
 * Such a row held one user's state for one object's lists — the view tab
 * order, and per view a sort, filters, a column layout, a row height, hidden
 * and added columns. The Console keeps none of that on the server any more:
 * a change on a list is a draft, and the column widths, the row height and
 * the tab order are kept in the reader's browser. Nothing reads these rows,
 * so leaving them is harmless; this step clears them, as the upgrade notes
 * ask. What they held is not carried anywhere: every reader's lists open on
 * their views' own layout.
 *
 * ## The family's conventions, and the delete's own
 *
 * - Dry run by default: it boots read-only and reports how many rows, for how
 *   many users and which objects. It writes nothing.
 * - `--apply` deletes, and only with `--export <path>`: every row it deletes
 *   is first written to that file as stored (owner-only, never over an
 *   existing file) and read back. A failed or incomplete export refuses the
 *   run with nothing deleted. The export is the only copy that survives.
 * - Only the exported rows are deleted, by id, under the system context, and
 *   none of them enters the recycle bin. The step then reads the prefix again:
 *   a row left (or written since) is reported and the run exits non-zero; a
 *   re-run finishes it.
 * - Confirmed with `[y/N]` or `--yes`; `--force` past a busy SQLite file;
 *   `--json` for one document; `--database-url` / `$OS_DATABASE_URL`.
 * - ⛔ Nothing on any boot, upgrade or lifecycle path runs it
 *   (`list-preferences.no-auto-run.test.ts`). No `sys_migration` verdict is
 *   recorded: nothing reads one.
 *
 * Exit status: 0 when nothing is stored, when a dry run lists rows (they are
 * inert), or when every listed row was deleted; 1 when a delete failed, a row
 * remains, the export could not be written, or the database could not be read.
 */
export default class MigrateListPreferences extends Command {
  // The tracker id stays in the comment above: a command description reaches
  // operators, who have no tracker to resolve it against.
  static override description =
    'Remove the per-user list preference rows (sys_user_preference keys starting with "ui.list.") that the Console '
    + 'no longer reads. Dry run by default; --apply --export <file> writes every row it deletes to the file first, '
    + 'then deletes them.';

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
      description: 'Delete the listed rows (default is a read-only dry run). Requires --export.',
      default: false,
    }),
    export: Flags.string({
      description: 'Path for the MANDATORY pre-delete export: every row --apply deletes, as stored, written owner-only '
        + 'and read back before the first delete. Must not exist yet.',
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateListPreferences);
    const timer = createTimer();
    const apply = flags.apply;
    const json = flags.json === true;

    if (!json) printHeader('Migrate · list-preferences');

    const refuse = async (error: string, message: string, extra: object = {}): Promise<void> => {
      if (json) await emitJson({ error, message, ...extra }, 0, { compact: true });
      else printError(message);
      this.exit(1);
    };

    const exportPath = flags.export ? resolvePath(flags.export) : undefined;
    if (apply && !exportPath) {
      await refuse(
        'export_required',
        'Refusing to delete without --export <path>. The pre-delete export is mandatory: it is the only copy of '
          + 'the rows this run deletes.',
      );
      return;
    }
    if (apply && exportPath && existsSync(exportPath)) {
      await refuse('export_exists', `Refusing to overwrite an existing export at ${exportPath}. Name a new path.`, {
        path: exportPath,
      });
      return;
    }

    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (json) {
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
    if (occupancy.status === 'busy' && !json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Deleting anyway — an old Console still open may write a row mid-run; a re-run removes it.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (json || !process.stdin.isTTY) {
        if (json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode deletes sys_user_preference rows. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(chalk.bold('\nDelete every "ui.list." preference row on this database, after writing the export? [y/N] '));
      if (!ok) {
        printInfo('Aborted — no export was written and no row was deleted.');
        return;
      }
    }

    if (!json) printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');

    let stack;
    try {
      // `sys_user_preference` is plugin-auth's: its identity objects are
      // composed for their declarations only (no auth manager, nothing
      // started), as `os user set-password` composes them. The dry run boots
      // READ-ONLY, the boot `os migrate plan` takes: no schema DDL, no
      // artifact seed, no sqlite file brought into existence.
      const { createIdentityObjectsPlugin } = await import('@objectstack/plugin-auth');
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        extraPlugins: [composeProviderForDeclarations(createIdentityObjectsPlugin())],
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      await refuse('boot_failed', error?.message ?? String(error), errorCodeFields(error));
      return;
    }

    let exitCode = 0;
    try {
      const engine = stack.kernel.getService('objectql') as IObjectQLEngine | undefined;
      if (typeof engine?.find !== 'function' || typeof engine?.delete !== 'function') {
        throw new Error(`No ObjectQL engine on this stack — cannot read ${USER_PREFERENCE_OBJECT}.`);
      }
      // A table the read-only boot measured absent stores no row.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const read = <T>(run: () => Promise<T[]>) => reads.rows<T>(USER_PREFERENCE_OBJECT, run);

      const rows = await listRetiredListPreferenceRows(engine, read);
      const summary = summarizeRetiredListPreferences(rows);

      if (!apply || rows.length === 0) {
        if (json) {
          reads.notice(true);
          await emitJson({ database: stack.dbLabel, apply, ...summary, deleted: 0, remaining: summary.rows, duration: timer.elapsed() });
          return;
        }
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        reads.notice(false);
        console.log('');
        if (rows.length === 0) {
          printSuccess(`No "ui.list." preference row is stored — nothing to remove ${chalk.dim(`(${timer.display()})`)}`);
        } else {
          console.log(`  ${chalk.white(USER_PREFERENCE_OBJECT)}: ${summary.rows} "ui.list." row(s) for ${summary.users} user(s)`);
          console.log(`  objects: ${summary.objects.join(', ')}`);
          console.log('');
          printInfo(
            'Dry run only — nothing reads these rows, so they are harmless where they are. Re-run with '
              + '--apply --export <path> to remove them.',
          );
        }
        return;
      }

      // ── The export, written and READ BACK before anything is deleted ──────
      const doc: RetiredListPreferenceExport = {
        producedBy: `${this.config.bin} migrate list-preferences --apply`,
        object: USER_PREFERENCE_OBJECT,
        keyPrefix: RETIRED_LIST_PREFERENCE_PREFIX,
        rows,
      };
      let exported: Set<string>;
      try {
        writeFileSync(exportPath!, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const back = JSON.parse(readFileSync(exportPath!, 'utf8')) as RetiredListPreferenceExport;
        exported = new Set((back.rows ?? []).map((row) => String(row.id)));
      } catch (error) {
        exitCode = 1;
        const message = `Refusing to delete: the pre-delete export could not be written and read back at ${exportPath} — `
          + `${error instanceof Error ? error.message : String(error)}. No row was deleted.`;
        if (json) await emitJson({ error: 'export_failed', message }, 0, { compact: true });
        else printError(message);
        return;
      }
      const missing = rows.filter((row) => !exported.has(String(row.id)));
      if (missing.length > 0) {
        exitCode = 1;
        const message = `Refusing to delete: the export at ${exportPath} does not hold ${missing.length} of the `
          + `${rows.length} row(s). No row was deleted.`;
        if (json) await emitJson({ error: 'export_incomplete', message }, 0, { compact: true });
        else printError(message);
        return;
      }
      if (!json) printSuccess(`Pre-delete export written (owner-only): ${exportPath}`);

      // ── The delete: the exported rows, by id, and nothing else ────────────
      const failed: Array<{ ids: string[]; message: string }> = [];
      const ids = rows.map((row) => String(row.id));
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        const batch = ids.slice(i, i + PAGE_SIZE);
        try {
          await engine.delete(USER_PREFERENCE_OBJECT, {
            where: { id: { $in: batch } },
            multi: true,
            context: { ...SYSTEM },
          } as never);
        } catch (error) {
          failed.push({ ids: batch, message: error instanceof Error ? error.message : String(error) });
        }
      }
      // Judged by what is gone, never by what the delete returned.
      const left = await listRetiredListPreferenceRows(engine);
      const leftIds = new Set(left.map((row) => String(row.id)));
      const deleted = ids.filter((id) => !leftIds.has(id)).length;
      if (failed.length > 0 || left.length > 0) exitCode = 1;

      if (json) {
        await emitJson({
          database: stack.dbLabel,
          apply,
          export: exportPath,
          ...summary,
          deleted,
          remaining: left.length,
          failures: failed.map((f) => f.message),
          duration: timer.elapsed(),
        });
        return;
      }
      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(`  ${chalk.white(USER_PREFERENCE_OBJECT)}: ${deleted} of ${summary.rows} "ui.list." row(s) deleted, for ${summary.users} user(s)`);
      for (const f of failed) printWarning(`A delete of ${f.ids.length} row(s) failed: ${f.message}`);
      console.log('');
      if (left.length > 0) {
        printError(`${left.length} "ui.list." row(s) are still stored — re-run with a new --export path to remove them.`);
      } else {
        printSuccess(`Removed every "ui.list." preference row ${chalk.dim(`(${timer.display()})`)}`);
        printInfo(`Keep ${exportPath} until you are certain — it is the only copy of the deleted rows.`);
      }
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      exitCode = 1;
      if (json) await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
    }
    if (exitCode !== 0) this.exit(exitCode);
  }
}
