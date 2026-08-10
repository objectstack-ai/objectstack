// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  findInterruptedRuns,
  readRunJournal,
  resumeMigrationJournal,
  MigrationJournalRefusal,
  type InterruptedRun,
  type MigrationPlanProvider,
} from '@objectstack/core';
import { describeInterruptedRun } from '@objectstack/runtime';
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
 * `os migrate resume` — act on a migration run the journal says was
 * interrupted (ADR-0119 D2, #4617 deliverable 3).
 *
 * The counterpart to `MigrationRecoveryPlugin`'s boot scan, and the division of
 * labour is deliberate: **boot discovers, this command acts.** Resuming is a
 * large, irreversible write against production data, so it happens under
 * explicit operator intent rather than as a side effect of a process starting.
 * The runner's re-entrancy is what makes deferring safe — `started ∧ ¬done` is
 * durable, so a run stays exactly as recoverable an hour later as it was at
 * boot.
 *
 * With no `--run`, this lists what the journal knows and exits without writing
 * anything: the read-only default the other `os migrate` commands use, for the
 * same reason (#2186 — a bare command must never mutate by surprise).
 *
 * ## What "resume" does is not this command's decision
 *
 * The plan's `onCrash` policy decides whether an interrupted run goes FORWARD
 * from the first chunk lacking `chunk_done` or UNWINDS what it committed. Only
 * the plan's author knows which of those is safe for their steps, so this
 * command carries the operator's intent to act and the plan carries what acting
 * means.
 *
 * ## Why a run can be unresumable here
 *
 * A journal cannot hold a plan: `forward`/`compensate` are functions and
 * `load()` reads the live database, so none of it crosses a process boundary.
 * A resume needs the plan handed back by the code that owns it, through the
 * `migration-plans` registry. If the package owning a run's plan is not loaded,
 * this command says exactly that and changes nothing — an unresumable run is
 * reported, never silently skipped, because "nothing to do" and "the code for
 * this run is not here" are different facts.
 */
export default class MigrateResume extends Command {
  static override description =
    'List migration runs the journal says were interrupted, and resume or unwind one. ' +
    'Read-only without --run.';

  static override examples = [
    '$ os migrate resume',
    '$ os migrate resume --json',
    '$ os migrate resume --run 6f1e6a3c-6a1e-4c53-9c2f-2c8a9d5b1f77',
    '$ os migrate resume --run 6f1e6a3c-... --yes',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    run: Flags.string({
      description: 'Resume this run id (omit to list interrupted runs and exit without writing)',
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the resume confirmation prompt', default: false }),
    json: Flags.boolean({ description: 'Machine-readable output', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateResume);
    const timer = createTimer();

    if (!flags.json) printHeader('Migrate · resume');
    if (!flags.json) printStep(flags.run ? 'Booting data stack…' : 'Booting data stack (read-only)…');

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
      // Typed off the slot's contract, not erased to `any` (#4168/#4176/#4251):
      // the journal reads below are exactly the surface `IObjectQLEngine`
      // declares, so there is nothing here that needs the checking switched off.
      const engine: IObjectQLEngine = stack.kernel.getService('objectql');
      if (typeof engine?.find !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read the migration journal.');
      }

      let plans: MigrationPlanProvider | undefined;
      try {
        plans = stack.kernel.getService('migration-plans') as MigrationPlanProvider;
      } catch {
        // No registry service composed — every run reports as unresumable,
        // which is the truthful answer for this process.
      }

      const interrupted = await findInterruptedRuns(engine);

      // ── list mode (no --run): read-only ──────────────────────────────
      if (!flags.run) {
        if (flags.json) {
          await emitJson({
            interrupted: interrupted.map((r) => ({ ...r, resumable: Boolean(plans?.get(r.planId)) })),
            count: interrupted.length,
            duration: timer.elapsed(),
          });
          return;
        }
        if (interrupted.length === 0) {
          printSuccess('No interrupted migration runs — every run in the journal concluded.');
          return;
        }
        printWarning(`${interrupted.length} interrupted migration run(s):`);
        for (const run of interrupted) this.log(`  ${describeInterruptedRun(run, plans)}`);
        printInfo('Nothing was changed. Re-run with --run <id> to act on one.');
        return;
      }

      // ── act mode (--run) ─────────────────────────────────────────────
      const target = interrupted.find((r) => r.runId === flags.run);
      if (!target) {
        // Distinguish "no such run" from "that run already concluded" — the
        // second is a success the operator should not be alarmed by.
        const events = await readRunJournal(engine, flags.run);
        const msg = events.length === 0
          ? `No journal rows for run '${flags.run}'.`
          : `Run '${flags.run}' is not interrupted — it already concluded (${
              events.some((e) => e.kind === 'run_done') ? 'run_done' : 'fully compensated'
            }). Nothing to do.`;
        if (flags.json) { await emitJson({ error: msg, runId: flags.run, duration: timer.elapsed() }, 0, { compact: true }); this.exit(events.length === 0 ? 1 : 0); return; }
        if (events.length === 0) { printError(msg); this.exit(1); return; }
        printSuccess(msg);
        return;
      }

      const plan = plans?.get(target.planId);
      if (!plan) {
        const msg =
          `Run '${target.runId}' belongs to plan '${target.planId}', which no loaded package registers. ` +
          `A resume needs the plan's code — the journal stores its hash, not its callbacks. ` +
          `Load the package that owns this migration and re-run.`;
        if (flags.json) { await emitJson({ error: msg, runId: target.runId, planId: target.planId, duration: timer.elapsed() }, 0, { compact: true }); this.exit(1); return; }
        printError(msg);
        this.exit(1);
        return;
      }

      const policy = plan.onCrash ?? 'resume';
      if (!flags.yes) {
        const summary = `${policy === 'compensate' ? 'UNWIND' : 'RESUME FORWARD'} run '${target.runId}' (plan '${plan.id}')`;
        if (flags.json || !process.stdin.isTTY) {
          const msg = `Confirmation required: ${summary}. Re-run with --yes.`;
          if (flags.json) { await emitJson({ error: 'confirmation_required', hint: 'pass --yes', summary, duration: timer.elapsed() }, 0, { compact: true }); this.exit(1); return; }
          printWarning(msg);
          this.exit(1);
          return;
        }
        this.log('');
        this.log(`  ${describeInterruptedRun(target, plans)}`);
        const ok = await confirm(chalk.bold(`\n${summary}? [y/N] `));
        if (!ok) { printInfo('Aborted — nothing changed.'); return; }
      }

      if (!flags.json) printStep(policy === 'compensate' ? 'Unwinding…' : 'Resuming forward…');

      const result = await resumeMigrationJournal(engine, plan, target.runId);

      if (flags.json) {
        await emitJson({ ...result, error: result.error ? String(result.error) : undefined, duration: timer.elapsed() });
        // A run that ended `failed` left the database in a state no clean story
        // covers, so the exit code has to say so — a zero here would let a
        // scripted recovery move on from a migration that needs a human.
        this.exit(result.status === 'failed' ? 1 : 0);
        return;
      }

      if (result.status === 'completed') {
        printSuccess(
          `Run '${result.runId}' completed — ${result.chunksCommitted}/${result.chunksTotal} chunk(s) committed.`,
        );
      } else if (result.status === 'compensated') {
        printWarning(
          `Run '${result.runId}' was unwound — ${result.chunksCompensated} chunk(s) compensated. ` +
            `The database is back to its pre-run state for this plan.`,
        );
      } else {
        printError(
          `Run '${result.runId}' FAILED and its compensation did not finish. ` +
            `${result.chunksCommitted} chunk(s) committed, ${result.chunksCompensated} compensated — ` +
            `the remainder are still applied. Inspect sys_migration_journal for run '${result.runId}'; ` +
            `this needs a decision, not a retry.`,
        );
        this.exit(1);
      }
    } catch (error: any) {
      const msg = error instanceof MigrationJournalRefusal
        // A refusal is the runner working, not breaking — say what it refused.
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
