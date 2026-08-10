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
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
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

  async run(): Promise<void> {
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
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      if (!stack.driver) {
        if (flags.json) { await emitJson({ error: 'no_sql_driver', changes: [] }, 0, { compact: true }); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      const drift = await stack.driver.detectManagedDrift();
      const pending = stack.pendingSchemaWork;

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
      console.log('');

      if (drift.length === 0 && pending.length === 0) {
        printSuccess('Physical schema is in sync with metadata — nothing to migrate.');
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
