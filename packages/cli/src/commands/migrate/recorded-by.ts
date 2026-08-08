// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  runMigrationJournal,
  MigrationJournalRefusal,
  type MigrationPlanProvider,
} from '@objectstack/core';
import {
  createRecordedBySentinelPlan,
  findSentinelHistoryRows,
  RECORDED_BY_SENTINEL,
  RECORDED_BY_SENTINEL_PLAN_ID,
} from '@objectstack/metadata-protocol';
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
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
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
 * `os migrate recorded-by` — rewrite the `'system'` sentinel in
 * `sys_metadata_history.recorded_by` to `NULL` (#4556).
 *
 * `recorded_by` is a `lookup('sys_user')` that used to receive the STRING
 * `'system'` on every actor-less metadata write. That string is not any
 * user's id, so the column declared a foreign key and stored something no
 * join could resolve. The runtime no longer writes it (the write path stores
 * `NULL`); this command converts the rows already on disk.
 *
 * The conversion is semantically equivalent, not a reinterpretation: the
 * column has only ever held that one sentinel, written by one expression, and
 * both spellings mean "no actor" — only `NULL` is expressible in the declared
 * type.
 *
 * Dry run by default, like every other `os migrate` subcommand (#2186): a
 * bare invocation reports how many rows still carry the sentinel and writes
 * nothing. `--apply` runs the conversion through the ADR-0119 D2 migration
 * journal, so each chunk is one transaction and an interrupted run is
 * recoverable via `os migrate resume`.
 *
 * Safe to re-run: the plan selects only rows still holding the sentinel, so a
 * second `--apply` finds none and commits zero chunks.
 */
export default class MigrateRecordedBy extends Command {
  static override description =
    "Rewrite the legacy 'system' sentinel in sys_metadata_history.recorded_by to NULL (#4556). " +
    'Dry-run by default; --apply runs the conversion through the migration journal.';

  static override examples = [
    '$ os migrate recorded-by',
    '$ os migrate recorded-by --json',
    '$ os migrate recorded-by --apply --yes',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({ description: 'Perform the conversion (default is a read-only report)', default: false }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt', default: false }),
    'chunk-size': Flags.integer({ description: 'Rows per journal chunk', default: 200 }),
    json: Flags.boolean({ description: 'Machine-readable output', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateRecordedBy);
    const timer = createTimer();

    if (!flags.json) printHeader('Migrate · recorded-by sentinel → NULL');
    if (!flags.json) printStep(flags.apply ? 'Booting data stack…' : 'Booting data stack (read-only)…');

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins(),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: IObjectQLEngine = stack.kernel.getService('objectql');
      if (typeof engine?.find !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read sys_metadata_history.');
      }

      const plan = createRecordedBySentinelPlan({ chunkSize: flags['chunk-size'] });

      // Register the plan so an interrupted run is resumable in THIS process
      // too — `os migrate resume` looks plans up by id, and a run whose plan
      // nothing registers is reported unresumable.
      try {
        const plans = stack.kernel.getService('migration-plans') as MigrationPlanProvider;
        plans?.register?.(plan);
      } catch { /* no registry composed — resume reports it, this run still works */ }

      const pending = await findSentinelHistoryRows(engine);

      // ── dry run (default): read-only ─────────────────────────────────
      if (!flags.apply) {
        if (flags.json) {
          await emitJson({ planId: RECORDED_BY_SENTINEL_PLAN_ID, sentinel: RECORDED_BY_SENTINEL, pending: pending.length, applied: false, duration: timer.elapsed() });
          return;
        }
        if (pending.length === 0) {
          printSuccess(`No sys_metadata_history row holds the '${RECORDED_BY_SENTINEL}' sentinel — nothing to convert.`);
          return;
        }
        printWarning(`${pending.length} sys_metadata_history row(s) hold recorded_by = '${RECORDED_BY_SENTINEL}'.`);
        printInfo("Nothing was changed. Re-run with --apply to rewrite them to NULL.");
        return;
      }

      // ── apply ────────────────────────────────────────────────────────
      if (pending.length === 0) {
        const msg = `No sys_metadata_history row holds the '${RECORDED_BY_SENTINEL}' sentinel — nothing to convert.`;
        if (flags.json) { await emitJson({ planId: RECORDED_BY_SENTINEL_PLAN_ID, pending: 0, applied: true, status: 'completed', chunksCommitted: 0, duration: timer.elapsed() }); return; }
        printSuccess(msg);
        return;
      }

      if (!flags.yes) {
        const summary = `Rewrite recorded_by '${RECORDED_BY_SENTINEL}' → NULL on ${pending.length} row(s)`;
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) { await emitJson({ error: 'confirmation_required', hint: 'pass --yes', summary, duration: timer.elapsed() }, 0, { compact: true }); this.exit(1); return; }
          printWarning(`Confirmation required: ${summary}. Re-run with --yes.`);
          this.exit(1);
          return;
        }
        const ok = await confirm(chalk.bold(`\n${summary}? [y/N] `));
        if (!ok) { printInfo('Aborted — nothing changed.'); return; }
      }

      if (!flags.json) printStep('Converting…');
      const result = await runMigrationJournal(engine, plan);

      if (flags.json) {
        await emitJson({ ...result, pending: pending.length, applied: true, error: result.error ? String(result.error) : undefined, duration: timer.elapsed() });
        this.exit(result.status === 'completed' ? 0 : 1);
        return;
      }

      if (result.status === 'completed') {
        printSuccess(
          `Converted ${pending.length} row(s) — run '${result.runId}', ${result.chunksCommitted}/${result.chunksTotal} chunk(s) committed.`,
        );
      } else if (result.status === 'compensated') {
        printWarning(
          `Run '${result.runId}' failed and was unwound — ${result.chunksCompensated} chunk(s) compensated. ` +
            `The sentinel rows are back as they were; nothing is half-converted.`,
        );
        this.exit(1);
      } else {
        printError(
          `Run '${result.runId}' FAILED and its compensation did not finish. ` +
            `Inspect sys_migration_journal for run '${result.runId}' — this needs a decision, not a retry.`,
        );
        this.exit(1);
      }
    } catch (error: any) {
      const msg = error instanceof MigrationJournalRefusal
        ? `Refused (${error.code}): ${error.message}`
        : (error?.message || String(error));
      if (flags.json) { await emitJson({ error: msg, duration: timer.elapsed() }, 0, { compact: true }); this.exit(1); return; }
      printError(msg);
      this.exit(1);
    } finally {
      try { await stack.shutdown?.(); } catch { /* best effort */ }
    }
  }
}
