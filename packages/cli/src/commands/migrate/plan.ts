// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
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
} from '../../utils/format.js';
import {
  bootSchemaStack,
  renderPlan,
  renderPendingSchemaWork,
  summarize,
  summarizePendingSchemaWork,
} from '../../utils/schema-migrate.js';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import {
  refuseWhenHostConfigUnloadable,
  type SchemaMigrationComposition,
} from '../../utils/schema-migration-plugins.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import {
  collectUnmanagedTables,
  renderUnmanagedTables,
  type UnmanagedTablesReport,
} from './unmanaged-tables.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import {
  resolveTenancyPosture,
  collectGlobalUniques,
  describeGlobalUniqueFinding,
  postureGatesGlobalUniques,
  GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION,
} from '@objectstack/types';

/**
 * `os migrate plan` — dry-run diff of metadata vs the physical database,
 * categorised safe / needs-confirm / destructive (issue #2186). Never mutates
 * the schema.
 *
 * "Never mutates" is enforced rather than merely documented since #3917: the
 * stack boots with schema DDL deferred and the artifact seed suppressed, so the
 * boot-time create-table / add-column sync that used to run before this command
 * printed a single line is now REPORTED as pending work instead of performed.
 * A database another process is using is reported too — as a warning, not a
 * refusal, since a plan writes nothing either way.
 *
 * Since #6743 the dry run also stops short of CREATING the database. The
 * deferral #3917 introduced covered the DDL and the seed but not the open
 * itself, so a `plan` in a never-started project still left a 0-table
 * `.objectstack/data/objectstack.db` behind — a write side effect from a
 * read-only command, and one that made "this project has no database yet"
 * unobservable to whatever ran next. A missing sqlite target is now opened as
 * an empty in-memory database: the plan is unchanged (an empty database is an
 * empty database, and "every table needs creating" is the true answer for a
 * fresh project), and nothing is written to disk.
 */
export default class MigratePlan extends Command {
  static override description =
    'Show how the physical database has drifted from metadata (dry run; no changes applied)';

  static override examples = [
    '$ os migrate plan',
    '$ os migrate plan --json',
    '$ os migrate plan --database-url postgres://localhost/app',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  /**
   * #13027 — the process must end when the plan does.
   *
   * The body is {@link plan}; this wrapper exists so every one of its early
   * `return`s funnels through one deliberate exit. A composed host stack can
   * leave the event loop alive — its `start()` was suppressed, so anything it
   * armed during `init()` has no release path — and this command has measurably
   * outlived its own "Graceful shutdown complete" by 78 minutes.
   *
   * ⛔ The FAILURE paths are deliberately NOT routed here: `this.exit(n)` throws
   * an `ExitError` that oclif's `handle()` turns into a `process.exit` of its
   * own, so they already terminate — and catching them here to exit "tidily"
   * would swallow the report with them.
   */
  async run(): Promise<void> {
    await this.plan();
    // [#12953] A host config that EXISTS but could not be loaded means the plan
    // above covered a fraction of this deployment — UNMEASURED, not "in sync" —
    // and the maintainer ruled that green exit out (2026-08-29, verbatim
    // 「同意」). Applied HERE, after `plan()`, deliberately: every one of its
    // early returns (no SQL driver, in sync, the rendered plan) has already
    // written its report by now, and the report — the human plan, or the JSON
    // document whose `composition.hostConfigLoaded` the ruling kept as the
    // consumer's discriminator — must survive the refusal, not be replaced by
    // it. `this.composition` is `null` on the boot-failure path, which already
    // exits non-zero through oclif.
    if (this.composition) refuseWhenHostConfigUnloadable(this.composition);
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  /**
   * What {@link plan} composed, read by {@link run} after it returns (#12953).
   * `null` until the stack has booted, and on every path where it never did.
   */
  private composition: SchemaMigrationComposition | null = null;

  private async plan(): Promise<void> {
    const { flags } = await this.parse(MigratePlan);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('Migrate · plan');
      printStep('Booting schema stack…');
    }

    // Probed before boot so the answer is about somebody else's connections,
    // not our own pool.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && !flags.json) {
      printWarning(`${describeOccupancy(occupancy)} The plan below is still accurate — nothing is written — but "os migrate apply" will refuse until it is free (or you pass --force).`);
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        deferSchemaDdl: true,
        // A plan writes nothing — so it must not bring a database file into
        // existence either (#6743). On a never-started project the target is
        // opened as an empty in-memory database: the plan below is unchanged
        // (an empty database is an empty database), and no file, `-wal` or
        // `-shm` is left behind. `os migrate apply` deliberately does NOT set
        // this — it flushes the deferred DDL after confirmation and needs a
        // real file to flush into.
        readOnlyProbe: true,
        // #12938 — diff the object set this deployment actually serves. Without
        // it the plan covers the five-table data stack alone: on a control plane
        // carrying ~80 `sys_*` tables that printed "in sync" while the driver's
        // own boot detector reported ten findings on the same database, and the
        // command those findings name is this one.
        composeHostStack: true,
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }
    this.composition = stack.composition;

    try {
      if (!stack.driver) {
        if (flags.json) { await emitJson({ error: 'no_sql_driver', changes: [] }, 0, { compact: true }); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      const drift = await stack.driver.detectManagedDrift();
      const pending = stack.pendingSchemaWork;

      // [#13204] What EXISTS that nothing declares. Deliberately computed
      // BEFORE the "in sync" early return below: a stranded table is exactly
      // the finding a drift-free plan is otherwise structurally blind to, and
      // retiring an object is how one gets there.
      //
      // ⛔ Informational only. It proposes no drop and reaches no DDL path —
      // dropping an existing physical table is destructive and hard to
      // reverse, so that decision stays with a human.
      //
      // ⛔ And it is NOT `composition.coverage`: coverage says what this plan
      // EXAMINED of what the deployment declares, this says what exists that
      // no declaration accounts for. Merged, "examined and clean" would be
      // indistinguishable from "never looked at". See `./unmanaged-tables.ts`.
      const { normalizeRows } = await import('@objectstack/metadata-protocol');
      const unmanagedTables: UnmanagedTablesReport = await collectUnmanagedTables({
        driver: stack.driver,
        declaredObjects: stack.allObjects(),
        normalize: normalizeRows,
      });

      // [ADR-0120 D5e, advisory form] Installation-wide uniques on app objects
      // are a decision point under the `isolated` posture — organizations there
      // are separate CUSTOMERS. The HARD gate runs at app install; this covers
      // the two populations it cannot reach (installs predating the gate, and
      // environments whose posture changed after install). Never fatal: a plan
      // writes nothing, and this reports a metadata decision, not drift.
      const uniqueScopeAdvisory = postureGatesGlobalUniques(resolveTenancyPosture())
        ? collectGlobalUniques(stack.allObjects())
        : [];

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          managedTables: stack.managedTableCount,
          total: drift.length,
          changes: drift,
          pending,
          // [#13204] Always present once a SQL driver was found, including
          // when the sweep found nothing (`tables: []`) and when it could not
          // run (`status: 'unreadable'`). A consumer must be able to tell
          // "swept, everything is declared" from "never swept" — omitting the
          // key on the clean case would make those two byte-identical, which
          // is the blind spot this section exists to remove.
          unmanagedTables,
          ...(uniqueScopeAdvisory.length > 0
            ? {
                uniqueScopeAdvisory: {
                  posture: resolveTenancyPosture(),
                  adr: 'ADR-0120 D5e',
                  findings: uniqueScopeAdvisory.map((f) => ({
                    id: f.id,
                    object: f.object,
                    kind: f.kind,
                    ...(f.name ? { name: f.name } : {}),
                    columns: f.columns,
                    spelling: f.spelling,
                  })),
                },
              }
            : {}),
          // [#12938] What the diffed object set was composed from — present
          // only when there WAS a deployment to compose, so a project with
          // neither a config nor a compiled artifact emits the same document it
          // always did. A consumer asserting coverage needs `hostConfigLoaded`
          // and not just `managedTables`: a config that fails to load also
          // raises the count (the platform floor still lands), and a count alone
          // cannot tell that apart from a deployment that is genuinely small.
          ...(stack.composition.notes.length > 0
            ? {
                composition: {
                  hostConfig: stack.composition.hostConfigPath,
                  hostConfigLoaded: stack.composition.hostConfigLoaded,
                  // [#13028] The plan's own boundary, so a consumer gate can
                  // refuse a PARTIAL plan instead of reading `managedTables`
                  // as coverage. `unexaminedObjects > 0` is the discriminator;
                  // `reasons` says which kind of partial it is.
                  ...(stack.composition.coverage ? { coverage: stack.composition.coverage } : {}),
                  notes: stack.composition.notes,
                },
              }
            : {}),
          ...(occupancy.status === 'busy'
            ? { occupancy: { status: 'busy', signal: occupancy.signal, detail: occupancy.detail } }
            : {}),
          duration: timer.elapsed(),
        });
        return;
      }

      if (uniqueScopeAdvisory.length > 0) {
        printWarning(
          `${uniqueScopeAdvisory.length} installation-wide unique constraint(s) on app objects, in an ` +
          "'isolated'-posture environment (ADR-0120 D5e):",
        );
        for (const finding of uniqueScopeAdvisory) {
          console.log(chalk.dim(`      • ${describeGlobalUniqueFinding(finding)}`));
        }
        console.log(chalk.dim(`      → ${GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION}`));
        console.log('');
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      printInfo(`Examined ${chalk.white(String(stack.managedTableCount))} managed table(s).`);
      // What the object set was composed from (#12938) — never silent about a
      // host config it could not load, and empty (so this block prints nothing)
      // when there was no deployment to compose.
      for (const note of stack.composition.notes) console.log(chalk.dim(`      ${note}`));
      console.log('');

      // [#13204] Its own block, above the drift verdict and never folded into
      // the "Examined N managed table(s)" line — it is a statement about a
      // DIFFERENT population (what exists) than every other line here (what is
      // declared). Silent when the sweep ran and found nothing; loud when it
      // could not run, because "did not look" must never read as "found none".
      const unmanagedLines = renderUnmanagedTables(unmanagedTables);
      if (unmanagedLines.length > 0) {
        printInfo(unmanagedLines[0]!);
        for (const line of unmanagedLines.slice(1)) console.log(chalk.dim(`      ${line}`));
        console.log('');
      }

      if (drift.length === 0 && pending.length === 0) {
        // [#13028] "In sync" is a claim about the objects this plan EXAMINED.
        // On a composed host that examined a strict subset — a control plane
        // declaring ~80 tables of which 8 reached the diffed driver — printing
        // the unqualified sentence tells an operator the deployment is
        // migrated when most of it was never looked at. Say which it is.
        const partial = (stack.composition.coverage?.unexaminedObjects ?? 0) > 0;
        if (partial) {
          const c = stack.composition.coverage!;
          printWarning(
            `No drift over the ${c.examinedObjects} object(s) this plan examined — but `
            + `${c.unexaminedObjects} of ${c.registeredObjects} declared object(s) were NOT examined (see above). `
            + 'This is a PARTIAL plan: it is not evidence that the deployment is in sync.',
          );
        } else {
          printSuccess('Physical schema is in sync with metadata — nothing to migrate.');
        }
        console.log('');
        return;
      }

      await renderPendingSchemaWork(pending);
      renderPlan(drift);
      if (pending.length > 0) printInfo(await summarizePendingSchemaWork(pending));
      printInfo(summarize(drift));
      console.log(chalk.dim('  Apply with: ') + chalk.white('os migrate apply') +
        chalk.dim(' (add --allow-destructive for drops / tightenings)'));
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
