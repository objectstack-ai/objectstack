// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
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
} from '../../utils/format.js';
import {
  bootSchemaStack,
  renderPlan,
  renderPendingSchemaWork,
  summarize,
  summarizePendingSchemaWork,
  groupByCategory,
} from '../../utils/schema-migrate.js';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import {
  describeUnloadableHostConfig,
  refuseWhenHostConfigUnloadable,
  type SchemaMigrationComposition,
} from '../../utils/schema-migration-plugins.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';

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
 * `os migrate apply` — reconcile the physical database to metadata (#2186).
 * Applies safe (loosening) + needs-confirm changes by default; destructive
 * changes (drop column, tighten NOT NULL, narrow type) require
 * `--allow-destructive`.
 *
 * Two operational-safety guarantees, both added by #3917:
 *
 * 1. **Nothing is written before you say yes.** The stack boots with schema
 *    DDL deferred and the artifact seed suppressed, so the additive
 *    create-table / add-column work that used to run during boot is now part
 *    of the plan you confirm — not something that already happened by the time
 *    the prompt appeared.
 * 2. **A database somebody else is using is not migrated by accident.** The
 *    SQLite target is probed for other attached connections before boot, and a
 *    busy database refuses without `--force`.
 *
 * A third, added by #13118 (maintainer ruling 2026-08-29, verbatim 「同意」):
 *
 * 3. **An UNMEASURED run does not write.** When the host
 *    `objectstack.config.{ts,js,mjs}` exists and could not be loaded, the object
 *    set this command can see is the data stack plus the platform floor — not
 *    the deployment's. #12953 made that run exit non-zero; it still applied its
 *    DDL first. It now refuses above every write, and says so in the refusal.
 */
export default class MigrateApply extends Command {
  static override description =
    'Reconcile the physical database to metadata (safe by default; destructive changes need --allow-destructive)';

  static override examples = [
    '$ os migrate apply',
    '$ os migrate apply --yes',
    '$ os migrate apply --allow-destructive --yes',
    '$ os migrate apply --force',
    '$ os migrate apply --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to reconcile (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    'allow-destructive': Flags.boolean({
      description: 'Also apply destructive changes (drop column, tighten NOT NULL, narrow type)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Migrate even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to mutate)' }),
  };

  /**
   * #13027 — the process must end when the apply does.
   *
   * See `migrate/plan.ts`'s twin for the measurement, and for why the failure
   * paths deliberately stay on oclif's own exit.
   */
  async run(): Promise<void> {
    await this.apply();
    // [#12953] Same refusal as `migrate plan`, through the same choke point —
    // the ruling (2026-08-29, verbatim 「同意」) named BOTH commands, and the
    // reconcile an operator confirms has to be judged the same way as the plan
    // they read. Applied after `apply()` for the same reason it is there: the
    // report is already written and must survive the non-zero exit.
    // [#13118] `noDdlExecuted` is true because `apply()` above RETURNS on this
    // path before `flushSchemaDdl()` / `applyMigrationEntries()` — see the
    // refusal gate there. The two must move together: the sentence is a claim
    // about this run, not a label on the command.
    if (this.composition) {
      refuseWhenHostConfigUnloadable(this.composition, { noDdlExecuted: true });
    }
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  /**
   * What {@link apply} composed, read by {@link run} after it returns (#12953).
   * `null` until the stack has booted, and on every path where it never did.
   */
  private composition: SchemaMigrationComposition | null = null;

  private async apply(): Promise<void> {
    const { flags } = await this.parse(MigrateApply);
    const timer = createTimer();
    const allowDestructive = flags['allow-destructive'];

    if (!flags.json) {
      printHeader('Migrate · apply');
      printStep('Checking whether the database is in use…');
    }

    // Occupancy gate — BEFORE the stack boots, or our own pooled connections
    // are what the probe finds (#3917).
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && !flags.force) {
      if (flags.json) {
        await emitJson({
          error: 'database_busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_HINT,
        }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && flags.force && !flags.json) {
      printWarning(`--force: ${describeOccupancy(occupancy)} Migrating anyway — the live process may see stale schema or SQLITE_BUSY.`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (!flags.json) {
      printStep('Booting schema stack…');
    }

    let stack;
    try {
      // `deferSchemaDdl` is what makes the prompt below meaningful: without it
      // the boot has already created tables and added columns by this point.
      // `composeHostStack` (#12938): reconcile the object set this deployment
      // actually serves. It must be the SAME set `os migrate plan` diffed —
      // the plan the operator just read is the thing being confirmed — so the
      // two commands pass it identically.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        deferSchemaDdl: true,
        composeHostStack: true,
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }
    this.composition = stack.composition;

    try {
      if (!stack.driver) {
        if (flags.json) { await emitJson({ error: 'no_sql_driver' }, 0, { compact: true }); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      // What the object set was composed from (#12938) — printed BEFORE the
      // in-sync early return below, not with the plan. "Already in sync" over a
      // set that is a fraction of the target's tables is precisely the reading
      // this card exists to stop, so the account of what was composed has to
      // reach the operator on that path too.
      if (!flags.json) {
        for (const note of stack.composition.notes) console.log(chalk.dim(`      ${note}`));
        if (stack.composition.notes.length > 0) console.log('');
      }

      const drift = await stack.driver.detectManagedDrift();
      const grouped = groupByCategory(drift);
      // Additive work the boot sync was held back from doing. Not drift — it
      // is what `initObjects` does on its own — but it IS a change to the
      // target database, so it belongs in the plan and behind the prompt.
      const pending = stack.pendingSchemaWork;

      // [#13028] The boundary of what was reconciled, carried on every payload
      // that can be read as "this deployment is migrated". A consumer gate
      // needs `unexaminedObjects` — `applied: []` alone cannot tell "nothing to
      // do" apart from "most of it was never looked at".
      const compositionPayload = stack.composition.notes.length > 0
        ? {
            composition: {
              hostConfig: stack.composition.hostConfigPath,
              hostConfigLoaded: stack.composition.hostConfigLoaded,
              ...(stack.composition.coverage ? { coverage: stack.composition.coverage } : {}),
              notes: stack.composition.notes,
            },
          }
        : {};
      const unexamined = stack.composition.coverage?.unexaminedObjects ?? 0;

      if (drift.length === 0 && pending.length === 0) {
        if (flags.json) {
          await emitJson(
            { applied: [], skipped: [], created: [], message: unexamined > 0 ? 'in_sync_partial' : 'in_sync', ...compositionPayload },
            0,
            { compact: true },
          );
          return;
        }
        if (unexamined > 0) {
          const c = stack.composition.coverage!;
          printWarning(
            `Nothing to apply over the ${c.examinedObjects} object(s) this run examined — but `
            + `${c.unexaminedObjects} of ${c.registeredObjects} declared object(s) were NOT examined (see above). `
            + 'This is a PARTIAL reconcile: it is not evidence that the deployment is in sync.',
          );
          return;
        }
        printSuccess('Physical schema is already in sync with metadata — nothing to apply.');
        return;
      }

      // Entries we intend to apply this run.
      const intended = drift.filter((d) => d.category !== 'destructive' || allowDestructive);
      const deferred = drift.filter((d) => d.category === 'destructive' && !allowDestructive);

      if (!flags.json) {
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        console.log('');
        await renderPendingSchemaWork(pending);
        renderPlan(drift);
        if (pending.length > 0) printInfo(await summarizePendingSchemaWork(pending));
        printInfo(summarize(drift));
        if (deferred.length > 0) {
          printWarning(`${deferred.length} destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).`);
        }
        if (allowDestructive && grouped.destructive.length > 0) {
          printWarning('Destructive changes assume your full app/plugin set is loaded. A column that looks "orphaned" here may belong to a plugin that is not part of this build.');
        }
      }

      // ── [#13118] REFUSE BEFORE ANY DDL ──────────────────────────────
      //
      // Maintainer ruling 2026-08-29, verbatim 「同意」, option 2: when the host
      // config EXISTS and could not be loaded, `os migrate apply` refuses
      // WITHOUT writing DDL, and exits non-zero. #12953 had ruled only the exit
      // status, so until this gate the same run said "this result is UNMEASURED,
      // not in sync" and reconciled the operator's schema against that very
      // set — nine platform/data-stack tables, none of them the deployment's.
      //
      // Placement is the whole change, and it is exact:
      //
      //   • BELOW the report. Everything above this line is read-only — the
      //     boot deferred its DDL (#3917), `detectManagedDrift()` only reads the
      //     catalog — and #12953 pinned that the refusal replaces the STATUS,
      //     not the document. The plan and the `--json` payload still reach
      //     their reader, `composition.hostConfigLoaded` included.
      //   • ABOVE the confirmation gate. An operator must not be asked to
      //     confirm a reconcile this command has already decided to refuse.
      //   • ABOVE `flushSchemaDdl()` and `applyMigrationEntries()` — the two
      //     calls in this file that write. That is what makes `run()`'s
      //     `noDdlExecuted: true` a true sentence rather than a hopeful one.
      //
      // ⛔ No flag, env var or escape hatch: option 3 was refused in the same
      // ruling ("需求未测不加面"). The path back to a working apply is to fix the
      // config — which is also the only path back to a bootable deployment, as
      // `os serve` refuses the identical shape.
      //
      // Convergence, measured for the ruling before this gate was written: a
      // partial apply over the reduced set then a repaired full apply DOES
      // converge to the schema a never-degraded run produces. So this refusal
      // is contract honesty, not data rescue — which is exactly the outcome the
      // ruling said to implement anyway, at low cost.
      if (describeUnloadableHostConfig(stack.composition) !== null) {
        if (flags.json) {
          // `skipped`/`pending` carry what was NOT done, in the vocabulary the
          // other "we did not apply" payloads above already use. `created` and
          // `applied` are empty because nothing was created or applied — a
          // consumer must be able to read "no DDL" off the document too, not
          // only off stderr.
          await emitJson({
            database: stack.dbLabel,
            created: [],
            applied: [],
            skipped: drift,
            pending,
            message: 'refused_unloadable_host_config',
            ...compositionPayload,
          }, 0, { compact: true });
          return;
        }
        // The refusal sentence itself is printed once, on stderr, by `run()`'s
        // shared choke point — not duplicated here.
        return;
      }

      const totalIntended = intended.length + pending.length;
      if (totalIntended === 0) {
        if (flags.json) { await emitJson({ applied: [], skipped: deferred, created: [], message: 'nothing_safe_to_apply' }, 0, { compact: true }); return; }
        printWarning('No changes to apply without --allow-destructive.');
        return;
      }

      // Confirmation gate. Nothing above this line has touched the database.
      if (!flags.yes) {
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) { await emitJson({ applied: [], skipped: drift, pending, message: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true }); return; }
          printWarning('Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.');
          return;
        }
        const ok = await confirm(chalk.bold(`\nApply ${totalIntended} change(s) to ${stack.dbLabel}? [y/N] `));
        if (!ok) { printInfo('Aborted — no changes made.'); return; }
      }

      // Additive work first: a table has to exist before its columns can be
      // reconciled. Drift was detected against the pre-flush database, and a
      // just-created table matches metadata by construction, so the two sets
      // never overlap.
      const created = await stack.flushSchemaDdl();
      const { applied, skipped } = await stack.driver.applyMigrationEntries(drift, { allowDestructive });

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          created,
          applied,
          skipped,
          ...compositionPayload,
          duration: timer.elapsed(),
        });
        return;
      }

      console.log('');
      if (created.length > 0) {
        printSuccess(`Created/extended ${created.length} table(s): ${await summarizePendingSchemaWork(created)}.`);
      }
      printSuccess(`Applied ${applied.length} change(s).`);
      if (skipped.length > 0) {
        printWarning(`Skipped ${skipped.length} change(s) (destructive without --allow-destructive, or unsupported on this dialect).`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
