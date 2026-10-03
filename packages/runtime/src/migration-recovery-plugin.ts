// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  findInterruptedRuns,
  MigrationPlanRegistry,
  type InterruptedRun,
  type MigrationPlanProvider,
} from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { MIGRATION_JOURNAL_OBJECT } from '@objectstack/spec/system';

/**
 * MigrationRecoveryPlugin — boot reconciliation for the ADR-0119 D2 migration
 * journal (#4617, deliverable 3).
 *
 * A migration that died mid-run leaves rows behind and no one to notice. The
 * operator may not even know a run was interrupted — the process that was
 * running it is gone, and its output went with it. This plugin is what makes
 * that state impossible to miss: at `kernel:ready` it asks the journal which
 * runs started and never concluded, and says so.
 *
 * It also owns the `migration-plans` registry service, so a plugin that defines
 * a journal-backed migration has one place to hand its plan to, and
 * `os migrate resume` has one place to look it up.
 *
 * ## Why it REPORTS and does not resume
 *
 * This is the design decision in this file, so it is worth stating plainly:
 * boot is discovery, the CLI is action.
 *
 * Resuming a migration is a large, irreversible, potentially hour-long write
 * against production data. Doing that as an unrequested side effect of a
 * process starting is the kind of behaviour an operator finds out about from a
 * graph. Worse, a resume is not always even possible at boot: it needs the
 * plan's live callbacks, and the plugin that owns them may not be loaded in the
 * process that happened to restart first.
 *
 * So the split is: this plugin surfaces the run and names the exact command
 * that will act on it; `os migrate resume` acts, under explicit operator
 * intent. ADR-0119 D2's `onCrash` policy still decides WHAT that action is —
 * resume forward or unwind — it just does not decide WHEN, and "when" is the
 * part a human should own.
 *
 * The runner's re-entrancy is what makes this safe to defer: `started ∧ ¬done`
 * is durable, so an interrupted run stays exactly as recoverable an hour later
 * as it was at boot. Nothing decays while the operator decides.
 *
 * ## Degrades quietly, on purpose
 *
 * No engine, or no `sys_migration_journal` registered (a lean kernel that never
 * composed platform-objects) → the scan is skipped in silence. A kernel with no
 * journal has no interrupted runs to find, and a warning there would train
 * operators to ignore this plugin's output, which is the one thing it cannot
 * afford. A scan that FAILS, by contrast, is reported: "I could not check" and
 * "there is nothing to find" are different answers.
 */
export class MigrationRecoveryPlugin implements Plugin {
  readonly name = 'com.objectstack.migration-recovery';
  readonly type = 'standard';
  readonly version = '1.0.0';
  readonly dependencies: string[] = [];
  /** Needs the engine to read the journal; still loads (inert) without it. */
  readonly optionalDependencies: string[] = ['com.objectstack.engine.objectql'];

  private readonly registry = new MigrationPlanRegistry();

  async init(ctx: PluginContext): Promise<void> {
    // Registered in init so plugins that contribute plans can find the service
    // during their own init/start, before the kernel:ready scan runs.
    (ctx as any)?.registerService?.('migration-plans', this.registry as MigrationPlanProvider);
  }

  async start(ctx: PluginContext): Promise<void> {
    (ctx as any)?.hook?.('kernel:ready', async () => {
      const logger = (ctx as any)?.logger;
      let engine: IObjectQLEngine | undefined;
      try {
        engine = (ctx as any).getService?.('objectql');
      } catch {
        return; // no engine — nothing to reconcile
      }
      if (!engine || typeof engine.find !== 'function') return;
      // A kernel without the journal object never ran the runner.
      if (typeof engine.getObject === 'function' && !engine.getObject(MIGRATION_JOURNAL_OBJECT)) return;

      let interrupted: InterruptedRun[];
      try {
        interrupted = await findInterruptedRuns(engine);
      } catch (err) {
        // "I could not check" is not "there is nothing to find".
        logger?.warn?.(
          `Migration journal scan failed; interrupted migrations (if any) were NOT detected this boot: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }

      if (interrupted.length === 0) return;

      for (const run of interrupted) {
        logger?.warn?.(describeInterruptedRun(run, this.registry));
      }
      logger?.warn?.(
        `${interrupted.length} interrupted migration run(s) found in ${MIGRATION_JOURNAL_OBJECT}. ` +
          `They are NOT resumed automatically — run 'os migrate resume' to act on them.`,
      );
    });
  }
}

/**
 * The operator-facing sentence for one interrupted run.
 *
 * Shared with `os migrate resume` so boot and CLI describe the same run the
 * same way — an operator who greps the boot warning and then runs the command
 * should not have to reconcile two vocabularies for one situation.
 */
export function describeInterruptedRun(run: InterruptedRun, plans?: MigrationPlanProvider): string {
    const plan = plans?.get(run.planId);
    const parts = [
      `Interrupted migration run '${run.runId}' (plan '${run.planId}'${
        run.migrationId ? `, migration '${run.migrationId}'` : ''
      }${run.startedAt ? `, started ${run.startedAt}` : ''}):`,
      `${run.committedChunks.length} chunk(s) committed`,
    ];
    if (run.unknownChunks.length > 0) {
      // The state the whole journal design exists to make legible.
      parts.push(
        `${run.unknownChunks.length} chunk(s) with UNKNOWN outcome (${run.unknownChunks.join(', ')}) — ` +
          `started, never confirmed committed`,
      );
    }
    if (run.compensatedChunks.length > 0) {
      parts.push(`${run.compensatedChunks.length} already compensated`);
    }
    const outstanding = run.committedChunks.filter((i) => !run.compensatedChunks.includes(i));
    if (run.compensatedChunks.length > 0 && outstanding.length > 0) {
      // A half-finished unwind: the loudest case, because neither "it ran" nor
      // "it was rolled back" is true and only a human can pick.
      parts.push(
        `COMPENSATION DID NOT FINISH — chunk(s) ${outstanding.join(', ')} are still applied. ` +
          `This needs a decision, not a retry`,
      );
    }
    parts.push(
      plan
        ? `Resume with: os migrate resume --run ${run.runId}`
        : `No loaded plugin registers plan '${run.planId}', so this run cannot be resumed in this ` +
          `process. Load the package that owns it, then: os migrate resume --run ${run.runId}`,
    );
    return parts.join(' ');
}
