// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import chalk from 'chalk';
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
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import type {
  OrphanDetailExport,
  OrphanDetailPlan,
  OrphanDetailRow,
  RecordRef,
} from '../../utils/orphan-detail-sweep.js';

/**
 * `os db orphans` — the operator's door to the detail rows whose required
 * master-detail master does not exist (#24964).
 *
 * ## Why such a row needs a door, and why this is the one
 *
 * A system-context write is exempt from the write-time reference check, so an
 * elevated writer can store a master id that names no master. The row's
 * access derives from that master, so every user door — the administrator's
 * included — answers 404 for it, and the dangling-reference audit reports it
 * and, by design, never rewrites it ("Reports; never rewrites",
 * `packages/objectql/src/integrity/dangling-reference-audit.ts`). The remedy is
 * a judgement for a person. This command is where that person acts.
 *
 * Removing such rows deletes business data, so the vehicle was the
 * maintainer's decision (ruling record 6303808312, option A, on the template
 * of the `os secret orphans` ruling, records 5271021652 and 5421208707):
 *
 *  1. An explicit operator command. ⛔ Nothing on any boot, upgrade, migrate
 *     or lifecycle-sweep path invokes it, and it must not grow such a caller
 *     (`orphans.no-auto-run.test.ts` holds it).
 *  2. The default run is a dry-run report: each detail row whose required
 *     master-detail master does not exist — object, record id, field, and the
 *     missing master id.
 *  3. Deletion only behind `--delete`, and only of the rows the same run's
 *     report lists.
 *  4. A mandatory pre-delete export of every row the run deletes, written and
 *     read back before the first delete.
 *  5. Deletion applies the master-detail's own delete semantics: the engine's
 *     by-id delete, whose cascade removes the deeper details. The deeper
 *     details it reaches are listed in the report too, read from the walk that
 *     delete runs (`ObjectQL.inspectCascadeDelete`).
 *
 * Out of the ruling, so not here: a lifecycle auto-remedy, any change to how
 * access derives from a master, and the system-write exemption itself.
 *
 * ## The safety properties, and where each is checked
 *
 * - **Unknown is not missing.** An orphan is a finding in the audit's
 *   `dangling` bucket: its probe RAN and found no master. A reference whose
 *   target could not be probed is `undetermined`, counted, and never deleted.
 *   An orphan whose cascade could not be read is withheld.
 * - **Only listed rows go.** Just before the first delete the audit is run
 *   again over the same objects, and the cascade of each orphan is read again
 *   just before its delete. An orphan whose master has since appeared is
 *   skipped, and so is one whose cascade now reaches a record the export does
 *   not hold. The window that remains is the one between that second read and
 *   the delete itself.
 * - **The export comes first and is checked.** Written with owner-only
 *   permissions, created or not written at all (`wx`), read back, and every
 *   record the run would delete must be in it. Any failure refuses the whole
 *   run with nothing deleted.
 * - **A delete is judged by what is gone, never by what it returned.** After
 *   each delete, every record of its cascade is read back. A delete whose roll-up
 *   recompute failed on the master it names, which does not exist, has still
 *   removed its rows (`SummaryRecomputeError` says so), and is reported as
 *   deleted with that note.
 *
 * Not previewed, and said so in the report: a `restrict` dependent outside the
 * cascade refuses the delete when it runs (reported as failed, and a cascade on
 * one datasource is one unit of work, so nothing of it is removed), and a
 * `set_null` reference to a deleted record is cleared, as any delete clears it.
 */
export default class DbOrphans extends Command {
  static override description =
    'Report detail rows whose required master-detail master does not exist, and (only with --delete) delete them '
    + 'with their cascade, after writing a pre-delete export. Report-only by default: it writes no row or table.';

  static override examples = [
    '<%= config.bin %> db orphans',
    '<%= config.bin %> db orphans --json',
    '<%= config.bin %> db orphans --delete --export ./orphans-backup.json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    delete: Flags.boolean({
      description:
        'Delete the listed orphans and the deeper details their cascade removes (default is a report that writes '
        + 'no row or table). Requires --export.',
      default: false,
    }),
    export: Flags.string({
      description:
        'Path for the MANDATORY pre-delete export: every record the run deletes, as stored, written and read back '
        + 'before the first delete. Refuses to overwrite.',
    }),
    'max-rows': Flags.integer({
      description:
        'Rows read per object, and in total. The report names every object it could not read in full.',
      default: 100_000,
      min: 1,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --delete confirmation prompt', default: false }),
    json: Flags.boolean({
      description: 'Output as JSON (implies non-interactive; requires --yes to delete)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DbOrphans);
    const timer = createTimer();
    const json = flags.json;

    if (!json) printHeader('Database · detail rows whose master is missing');

    if (flags.delete && !flags.export) {
      const message =
        'Refusing to delete without --export. The pre-delete export is mandatory: it is the only copy of the '
        + 'records this run deletes, and those rows are business data no user door can read. Name a path for it.';
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

    if (!json) printStep(flags.delete ? 'Booting (DELETE mode)…' : 'Booting (report only)…');

    // Loaded at the point of use, never at module load: oclif `import()`s every
    // command module on every invocation while building its table.
    const { planOrphanDetailSweep, buildOrphanDetailExport, exportedKeys, recordKey, recordsToDelete } =
      await import('../../utils/orphan-detail-sweep.js');
    const { SUMMARY_RECOMPUTE_CODE } = await import('@objectstack/objectql');
    const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        // The platform's objects are registered as `os serve` registers them, so
        // the cascade a delete runs here reaches the relations it reaches there.
        extraPlugins: [new PlatformObjectsPlugin()],
        // The report boots READ-ONLY, the boot `os migrate plan` takes. `--delete`
        // keeps the plain boot: it deletes rows.
        ...(flags.delete ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) { await emitJson({ error: 'boot_failed', message }, 1, { compact: true }); return; }
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
      const engine = stack.kernel.getService('objectql') as OrphanEngine | undefined;
      if (!engine) {
        const message = 'No ObjectQL engine on this runtime, so no row can be read.';
        if (json) { await emitJson({ error: 'no_engine', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      // A table the read-only boot measured absent stores nothing, so it is not read.
      const reads = absentTableReads(stack, (object) => engine.getConfigs()[object]);
      const plan = await planOrphanDetailSweep({ engine, maxRows: flags['max-rows'], absent: reads.absent });
      reads.notice(json);

      if (!flags.delete) {
        if (json) { await emitJson({ mode: 'report', plan }, 0, { compact: true }); return; }
        renderPlan(plan);
        printInfo(`Report only — no row or table was written or deleted.${journalNote} (${timer.display()})`);
        if (plan.orphans.length > 0) printInfo('Re-run with --delete --export <path> to delete the listed orphans.');
        return;
      }

      const doomed = recordsToDelete(plan);
      if (doomed.length === 0) {
        if (json) { await emitJson({ mode: 'delete', deleted: [], skipped: [], failed: [], plan }, 0, { compact: true }); return; }
        renderPlan(plan);
        printSuccess('Nothing to delete.');
        return;
      }

      if (!json) {
        renderPlan(plan);
        printWarning(
          `About to permanently delete ${plan.orphans.length} orphan row(s) and ${doomed.length - plan.orphans.length} `
          + 'deeper detail row(s) their cascade removes. The export below is the only copy that survives.',
        );
      }
      if (!flags.yes) {
        if (json) { await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 1, { compact: true }); return; }
        const ok = await confirm(chalk.yellow(`  Delete ${doomed.length} row(s) after writing the export? [y/N] `));
        if (!ok) { printInfo(`Aborted — no export was written and no row was deleted.${journalNote}`); return; }
      }

      // ── The export, written and READ BACK before anything is deleted ──────
      let verified: Set<string>;
      try {
        const rawRows = new Map<string, Record<string, unknown>>();
        for (const ref of doomed) {
          const row = await readStoredRow(engine, ref);
          if (row) rawRows.set(recordKey(ref.object, ref.id), row);
        }
        const doc = buildOrphanDetailExport({ plan, rawRows, producedBy: `${this.config.bin} db orphans --delete` });
        // Owner-only, and CREATED here or not written at all: the existence check
        // above runs before the boot and the prompt, so it is a pre-check, never
        // the guarantee. `wx` makes the guarantee atomic.
        writeFileSync(exportPath!, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        // Read back rather than trusting the write: a short or unreadable file
        // would leave the delete with no copy at all, and look like a clean run.
        verified = exportedKeys(JSON.parse(readFileSync(exportPath!, 'utf8')) as OrphanDetailExport);
      } catch (error) {
        const message =
          `Refusing to delete: the pre-delete export could not be written and read back at ${exportPath} — `
          + `${error instanceof Error ? error.message : String(error)}`;
        if (json) { await emitJson({ error: 'export_failed', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      const missing = doomed.filter((r) => !verified.has(recordKey(r.object, r.id)));
      if (missing.length > 0) {
        const message =
          `Refusing to delete: the export at ${exportPath} does not hold ${missing.length} of the ${doomed.length} `
          + `record(s) to be deleted (${missing.map((r) => `${r.object}/${r.id}`).join(', ')}).`;
        if (json) { await emitJson({ error: 'export_incomplete', message, missing }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      if (!json) printSuccess(`Pre-delete export written (owner-only): ${exportPath}`);

      // ── Only rows the report listed, and only while they still are orphans ─
      const recheck = await planOrphanDetailSweep({ engine, maxRows: flags['max-rows'] });
      const stillOrphaned = new Set(
        recheck.orphans.flatMap((o) => o.fields.map((f) => orphanFieldKey(o.object, o.recordId, f.field, f.missingMasterId))),
      );

      const deleted: Array<{ object: string; recordId: string; removed: RecordRef[]; notes: string[] }> = [];
      const skipped: Array<{ object: string; recordId: string; reason: string; unlisted?: RecordRef[] }> = [];
      const failed: Array<{ object: string; recordId: string; message: string; code?: string; remaining?: RecordRef[] }> = [];
      const removed = new Set<string>();

      for (const orphan of plan.orphans) {
        const { object, recordId } = orphan;
        if (removed.has(recordKey(object, recordId))) {
          skipped.push({ object, recordId, reason: 'already removed by the cascade of an orphan deleted before it' });
          continue;
        }
        if (!orphan.fields.every((f) => stillOrphaned.has(orphanFieldKey(object, recordId, f.field, f.missingMasterId)))) {
          skipped.push({
            object, recordId,
            reason: 'no longer an orphan as reported: its master now exists, or the row changed since the report',
          });
          continue;
        }
        let cascade: RecordRef[];
        try {
          cascade = await engine.inspectCascadeDelete(object, recordId);
        } catch (error) {
          failed.push({ object, recordId, message: `its cascade could not be read again, so it was not deleted: ${messageOf(error)}` });
          continue;
        }
        const unlisted = cascade.filter((r) => !verified.has(recordKey(r.object, r.id)));
        if (unlisted.length > 0) {
          skipped.push({
            object, recordId, unlisted,
            reason: 'its cascade now reaches records the report did not list and the export does not hold',
          });
          continue;
        }

        const notes: string[] = [];
        let refusal: unknown;
        try {
          await engine.delete(object, { where: { id: recordId }, context: { isSystem: true } });
        } catch (error) {
          const e = error as { code?: unknown; failures?: Array<{ parentObject?: string; parentId?: string; field?: string }> };
          if (e?.code === SUMMARY_RECOMPUTE_CODE) {
            // The rows WERE removed; a roll-up on the master could not be recomputed.
            for (const f of e.failures ?? []) {
              const onMissingMaster = orphan.fields.some((o) => o.master === f.parentObject && o.missingMasterId === f.parentId);
              notes.push(onMissingMaster
                ? `the roll-up ${f.parentObject}.${f.field} was not recomputed for ${f.parentId}, the master that does not exist`
                : `the roll-up ${f.parentObject}.${f.field} could not be recomputed for ${f.parentId}: it may be stale`);
            }
          } else {
            refusal = error;
          }
        }

        // Judged by what is gone, never by what the call returned.
        const remaining: RecordRef[] = [];
        for (const ref of cascade) {
          if (await readStoredRow(engine, ref)) remaining.push(ref);
          else removed.add(recordKey(ref.object, ref.id));
        }
        if (remaining.length === 0) {
          deleted.push({ object, recordId, removed: cascade, notes });
        } else {
          failed.push({
            object, recordId,
            message: refusal ? messageOf(refusal) : 'the delete returned, but these records are still stored',
            ...(refusal ? errorCodeFields(refusal) : {}),
            remaining,
          });
        }
      }

      if (json) {
        await emitJson({ mode: 'delete', export: exportPath, deleted, skipped, failed, plan }, failed.length > 0 ? 1 : 0, { compact: true });
        return;
      }
      const rowCount = deleted.reduce((n, d) => n + d.removed.length, 0);
      printSuccess(`Deleted ${deleted.length} orphan(s), ${rowCount} row(s) with their cascade, in ${timer.display()}.`);
      for (const d of deleted) for (const n of d.notes) printInfo(`  ${d.object}/${d.recordId}: ${n}`);
      for (const s of skipped) printWarning(`  skipped ${s.object}/${s.recordId}: ${s.reason}`);
      for (const f of failed) printError(`  ${f.object}/${f.recordId}: ${f.message}`);
      printInfo(`Keep ${exportPath} until you are certain the sweep was correct — it is the only copy.`);
      if (failed.length > 0) this.exit(1);
    } catch (error) {
      // A read the scan could not make is a refusal, and under `--json` a
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

/** The engine slice this command reads and the one write verb it uses. */
type OrphanEngine = import('../../utils/orphan-detail-sweep.js').OrphanDetailEngine
  & Pick<import('@objectstack/objectql').ObjectQL, 'delete' | 'getDriverForObject'>;

function orphanFieldKey(object: string, recordId: string, field: string, masterId: string): string {
  return JSON.stringify([object, recordId, field, masterId]);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The record as its driver stores it, unscoped, or `null` when it is not
 * there. The driver's own read: the export must hold the stored row whole, and
 * the read-back after a delete must see a record whatever its access says.
 */
async function readStoredRow(engine: OrphanEngine, ref: RecordRef): Promise<Record<string, unknown> | null> {
  const driver = engine.getDriverForObject(ref.object);
  if (!driver) throw new Error(`No driver resolves for '${ref.object}', so ${ref.object}/${ref.id} could not be read.`);
  return (await driver.findOne(ref.object, { where: { id: ref.id }, limit: 1 })) ?? null;
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

/** Render the plan for a human. */
function renderPlan(plan: OrphanDetailPlan): void {
  console.log(chalk.bold('\n  Detail rows whose required master does not exist'));
  printInfo(
    `scanned ${plan.scanned} row(s) of ${plan.objects.length} object(s) · orphans ${plan.counts.orphans} · `
    + `deeper details ${plan.counts.deeperDetails} · withheld ${plan.counts.withheld}`,
  );
  for (const orphan of plan.orphans) renderOrphan(orphan);
  for (const w of plan.withheld) {
    console.log(`    ${chalk.yellow('withheld')} ${w.object}/${w.recordId}`);
    console.log(chalk.dim(`      ${w.reason}`));
  }
  if (plan.otherDangling.length > 0) {
    console.log(chalk.bold('\n  Other dangling references (listed, never deleted)'));
    for (const d of plan.otherDangling) {
      console.log(`    ${d.objectName}/${d.recordId}.${d.field} → ${d.target} ${d.value}`);
    }
  }
  if (plan.notes.length > 0) {
    console.log(chalk.bold('\n  Read before acting'));
    for (const note of plan.notes) printWarning(note);
  }
}

function renderOrphan(orphan: OrphanDetailRow): void {
  console.log(`    ${chalk.red('ORPHAN')} ${orphan.object}/${orphan.recordId}`);
  for (const f of orphan.fields) {
    console.log(chalk.dim(`      ${f.field} → ${f.master} ${f.missingMasterId}, which does not exist`));
  }
  if (orphan.cascade.length > 0) {
    console.log(chalk.dim(`      its delete also removes ${orphan.cascade.length} deeper detail row(s):`));
    for (const c of orphan.cascade) console.log(chalk.dim(`        ${c.object}/${c.id}`));
  }
}
