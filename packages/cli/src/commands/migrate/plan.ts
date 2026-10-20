// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
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
  collectDriftApplyLimits,
  describeWithApplyLimits,
  describeDatabaseSource,
  describeTelemetryDatabase,
  distinctDatabaseDrivers,
  renderPlan,
  renderPendingSchemaWork,
  summarize,
  summarizePendingSchemaWork,
  SKIPPED_SCHEMA_SYNC_NOTE,
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
} from '../../utils/unmanaged-tables.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { ceremonyOrganizationColumnDrops, readOrganizationOwnershipMarker } from '../../utils/organization-ownership-drop-gate.js';
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
 * refusal, since a plan writes no row either way.
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
 *
 * [#23848] A primary whose transport cannot hold DDL back (the Turso REMOTE
 * transport) used to refuse the plan at its boot. It now boots with schema sync
 * skipped: still nothing written, the drift half read from the database, and
 * the additive half reported as not examined in both faces.
 *
 * [#23925] Nor does the plan offer a remedy that database does not have. The
 * driver that reported each entry declares what its apply door cannot perform
 * (`SchemaStack.driftApplyLimit`); such an entry is listed with its finding and
 * that limit instead of `--allow-destructive`, and the footer offers
 * `--allow-destructive` only for a destructive entry the database can apply.
 * Read from the declaration, never from the dialect or the transport name. A
 * driver that declares nothing (every database but a Turso REMOTE one) gets
 * the plan it always got, byte for byte. The `--json` document is the report
 * and is unchanged.
 *
 * [#24925, ADR-0131 D10 item 5] Nor a remedy the apply refuses. On a database
 * the organization-ownership ceremony has not verified (a 17.x one before the
 * ceremony), `os migrate apply --allow-destructive` refuses every run that
 * would drop an `organization_id` column, the whole run, and no flag stands
 * that down (`utils/organization-ownership-drop-gate.ts`). Each such drop is
 * listed and counted as drift with the ceremony as its remedy, and the footer
 * offers `--allow-destructive` for nothing while one is listed: it names the
 * ceremony's two commands instead. Which drops are held, and whether the
 * ceremony verified, are read through the two functions `apply` asks, never a
 * second list. A verified database, or one with no such drop, gets the plan it
 * always got, byte for byte; the `--json` document is unchanged.
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
      printWarning(`${describeOccupancy(occupancy)} The plan below is still accurate — it writes no row or table — but "os migrate apply" will refuse until it is free (or you pass --force). ${JOURNAL_MODE_SWITCH_NOTE}`);
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        deferSchemaDdl: true,
        // [#23848] …and where the primary's transport cannot defer DDL (the
        // Turso REMOTE transport), boot with schema sync skipped instead of
        // refusing: the drift half of the plan still reads the database, and
        // the additive half is reported as NOT examined (`schemaSync`), never
        // as "nothing to create". `os migrate apply` passes the same posture,
        // so the plan an operator reads is the one that apply confirms.
        deferredDdlUnsupported: 'skip-schema-sync',
        // A plan writes no row — so it must not bring a database file into
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
        // [#22506] …and what `os serve` mounts AROUND the stack — the auth
        // family behind its auth gate, the provider of every capability it
        // resolves — or an app declaring `requires: ['auth']` plans without
        // `sys_account`, and its retired `issuer` column is never a drop.
        composeServedPlatform: true,
        // [#24120] …and the datasources the deployment declares, connected as
        // `os serve` connects them: a `datasourceMapping` rule's objects are
        // planned in the datasource it routes them to, the declared default's
        // included. `os migrate apply` passes the same.
        composeDeclaredDatasources: true,
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
        if (flags.json) { await emitJson({ error: 'no_sql_driver', changes: [] }, 0, { compact: true }); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      // [#22579] Every datasource this plan covers — the primary, and the
      // `telemetry` sibling the serving boot keeps lifecycle-classed objects in.
      const drift = await stack.detectManagedDrift();
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
      // indistinguishable from "never looked at". See `../../utils/unmanaged-tables.ts`.
      const { normalizeRows } = await import('@objectstack/metadata-protocol');
      const unmanagedTables: UnmanagedTablesReport = await collectUnmanagedTables({
        // [#22580] Every database the drift above covers, the sibling included —
        // [#24120] each read once, though a declared default and the primary
        // resolved from it are two connections to one file.
        drivers: distinctDatabaseDrivers(stack.drivers),
        declaredObjects: stack.allObjects(),
        // [#24059] …and the tables the composition declares outside the object
        // set — `sys_packages`, which `os migrate apply` creates.
        nonObjectTables: stack.nonObjectTables,
        composition: stack.composition,
        normalize: normalizeRows,
      });

      // [ADR-0120 D5e, advisory form] Installation-wide uniques on app objects
      // are a decision point under the `isolated` posture — organizations there
      // are separate CUSTOMERS. The HARD gate runs at app install; this covers
      // the two populations it cannot reach (installs predating the gate, and
      // environments whose posture changed after install). Never fatal: a plan
      // writes no row or table, and this reports a metadata decision, not drift.
      const uniqueScopeAdvisory = postureGatesGlobalUniques(resolveTenancyPosture())
        ? collectGlobalUniques(stack.allObjects())
        : [];

      // [#23848] The boot skipped schema sync (a transport that cannot defer
      // DDL): `pending` below was not examined, so it cannot read as "none".
      const schemaSyncSkipped = stack.schemaSync === 'skipped';

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          // [#22581] Who named it — `--database-url`, this process's
          // environment, a `.env*` file, the config's datasource, or nobody.
          databaseSource: stack.dbSource,
          // [#22579] The sibling lifecycle-classed objects were planned
          // against — present only when the serving boot keeps one, so a
          // document without it planned every object against `database`.
          ...(stack.telemetryDatabase !== null ? { telemetryDatabase: stack.telemetryDatabase } : {}),
          // [#23848] Present only when the boot skipped schema sync: then
          // `pending: []` means NOT EXAMINED, and a consumer must not read it
          // as "every declared table and column exists".
          ...(schemaSyncSkipped ? { schemaSync: 'skipped' as const } : {}),
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

      // [#23899] Two kinds of line below claim that this plan wrote no row or
      // table: the declaration boot's write-guard note (one of the composition
      // notes, when a plugin's write was refused or a raw command forwarded)
      // and the unmanaged-table section's closing line. The read-only boot's
      // connect may still have switched a SQLite file's journal mode
      // (`SqlDriver.applySqliteJournalMode`, its rule for every connect), which
      // rewrites the file header and no row, so on a SQLite file each line that
      // makes the claim is followed by the note naming the switch. A target
      // that is no SQLite file (PostgreSQL, MySQL) has no header to switch. The
      // `--json` document above carries the same lines and no note.
      const journalNote = describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      const withJournalNote = (line: string): string =>
        (line.includes('no row or table') ? `${line}${journalNote}` : line);

      printInfo(`Database: ${chalk.white(stack.dbLabel)} ${chalk.dim(`(${describeDatabaseSource(stack.dbSource)})`)}`);
      if (stack.telemetryDatabase !== null) printInfo(describeTelemetryDatabase(stack.telemetryDatabase));
      if (schemaSyncSkipped) printWarning(SKIPPED_SCHEMA_SYNC_NOTE);
      printInfo(`Examined ${chalk.white(String(stack.managedTableCount))} managed table(s).`);
      // What the object set was composed from (#12938) — never silent about a
      // host config it could not load, and empty (so this block prints nothing)
      // when there was no deployment to compose.
      for (const note of stack.composition.notes) console.log(chalk.dim(`      ${withJournalNote(note)}`));
      console.log('');

      // [#13204] Its own block, above the drift verdict and never folded into
      // the "Examined N managed table(s)" line — it is a statement about a
      // DIFFERENT population (what exists) than every other line here (what is
      // declared). Silent when the sweep ran and found nothing; loud when it
      // could not run, because "did not look" must never read as "found none".
      const unmanagedLines = renderUnmanagedTables(unmanagedTables);
      if (unmanagedLines.length > 0) {
        printInfo(unmanagedLines[0]!);
        for (const line of unmanagedLines.slice(1)) console.log(chalk.dim(`      ${withJournalNote(line)}`));
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
        } else if (schemaSyncSkipped) {
          // [#23848] Drift was read; the additive half was not (see above).
          printWarning(
            'No drift over the tables this database holds — but its additive schema work was NOT examined (see above). '
            + 'This is a PARTIAL plan: it is not evidence that every declared table and column exists.',
          );
        } else {
          printSuccess('Physical schema is in sync with metadata — nothing to migrate.');
        }
        console.log('');
        return;
      }

      // [#23925] What the driver that reported each entry declares its apply
      // door cannot perform: on the Turso REMOTE transport, every column entry
      // but a drop (it runs no SQLite table rebuild). Empty for a driver that
      // declares nothing, and then everything below reads as it always has.
      const limits = collectDriftApplyLimits(stack, drift);
      // [#24925] The `organization_id` drops `os migrate apply` refuses here
      // until the organization-ownership ceremony has verified. Empty on a
      // verified database and on one with no such drop, and then everything
      // below reads as it always has.
      const held = await ceremonyHeldDrops(stack, drift);

      await renderPendingSchemaWork(pending);
      if (limits.size === 0 && held.size === 0) {
        renderPlan(drift);
      } else {
        // Still listed, still counted: it IS drift. Only the remedy changes,
        // from a command that cannot perform it here to the reason it cannot.
        const byLimit = limits.size === 0 ? (d: ManagedDriftEntry) => d.message : await describeWithApplyLimits(limits);
        renderPlan(drift, held.size === 0 ? byLimit : await describeWithCeremonyHolds(held, byLimit));
      }
      if (pending.length > 0) printInfo(await summarizePendingSchemaWork(pending));
      printInfo(summarize(drift));
      if (limits.size === 0 && held.size === 0) {
        console.log(chalk.dim('  Apply with: ') + chalk.white('os migrate apply') +
          chalk.dim(' (add --allow-destructive for drops / tightenings)'));
      } else {
        // `--allow-destructive` only for a destructive entry this database can
        // apply; no apply line at all when it can apply nothing listed here.
        const appliable = drift.filter((d) => !limits.has(d) && !held.has(d));
        const appliableDestructive = appliable.filter((d) => d.category === 'destructive').length;
        // [#24925] While the ceremony holds a drop, `apply` refuses every
        // --allow-destructive run, so it is offered for nothing: what `apply`
        // performs now is the rest, and the destructive changes wait.
        const appliableNow = held.size === 0 ? appliable : appliable.filter((d) => d.category !== 'destructive');
        if (appliableNow.length > 0 || pending.length > 0) {
          console.log(chalk.dim('  Apply with: ') + chalk.white('os migrate apply') + (held.size === 0 && appliableDestructive > 0
            ? chalk.dim(` (add --allow-destructive for the ${appliableDestructive} destructive change(s) it can apply on this database)`)
            : ''));
        }
        if (held.size > 0) printWarning(describeCeremonyHold(held.size, appliableDestructive));
        const limited = [...limits.keys()].filter((d) => !held.has(d)).length;
        if (limited > 0) {
          printWarning(
            `${limited} change(s) above cannot be applied on this database by "os migrate apply" (each says why), `
            + 'so they remain drift after it runs.',
          );
        }
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

/**
 * [#24925] The entries `os migrate apply` refuses on this database: each
 * `organization_id` drop, while the organization-ownership ceremony has not
 * verified. Answered by the two functions `apply`'s drop gate asks, through
 * the same `objectql` service, so the plan and the refusal cannot disagree:
 * `ceremonyOrganizationColumnDrops`, asked of one entry at a time, says which
 * entries; `readOrganizationOwnershipMarker` says whether the ceremony
 * verified, and answers "not verified" for a database with no `sys_migration`
 * table or row. The marker is read only when such a drop is listed, so every
 * other plan reads nothing it did not read before.
 */
async function ceremonyHeldDrops(
  stack: { kernel: unknown },
  drift: readonly ManagedDriftEntry[],
): Promise<ReadonlySet<ManagedDriftEntry>> {
  const drops = drift.filter((d) => ceremonyOrganizationColumnDrops([d]).length > 0);
  if (drops.length === 0) return new Set();
  const kernel = stack.kernel as { getService?: (n: string) => unknown };
  const engine = kernel.getService?.call(kernel, 'objectql');
  const marker = await readOrganizationOwnershipMarker(engine as never);
  return marker.verified ? new Set() : new Set(drops);
}

/**
 * [#24925] The {@link renderPlan} line for a held drop: the finding without
 * its `--allow-destructive` sentence, then the ceremony as its remedy. Every
 * other entry is described by `otherwise`. The driver package is imported at
 * the point of use, never statically (`schema-migrate.lazy-driver-import.test.ts`).
 */
async function describeWithCeremonyHolds(
  held: ReadonlySet<ManagedDriftEntry>,
  otherwise: (d: ManagedDriftEntry) => string,
): Promise<(d: ManagedDriftEntry) => string> {
  const { driftFindingWithoutRemedy } = await import('@objectstack/driver-sql');
  return (d) => (held.has(d)
    ? `${driftFindingWithoutRemedy(d)} — a drop the organization-ownership ceremony owns, and it has not verified `
      + 'on this database: the ceremony drops it itself (see below).'
    : otherwise(d));
}

/**
 * [#24925] The footer line for the held drops: why `--allow-destructive` is
 * offered for nothing, and the ceremony's two commands, as `os migrate apply`'s
 * refusal names them. `waiting` counts the other destructive entries that run
 * could perform once the ceremony has verified.
 */
function describeCeremonyHold(drops: number, waiting: number): string {
  return `${drops} organization_id drop(s) above are the organization-ownership ceremony's, and it has not verified `
    + 'on this database, so "os migrate apply --allow-destructive" refuses every run until it has'
    + (waiting > 0 ? ` (the other ${waiting} destructive change(s) above wait for it too)` : '')
    + '. Run "os migrate organization-ownership --out PLAN" to write and review its plan, take a backup, then '
    + '"os migrate organization-ownership --apply --plan-file PLAN --backup-taken"; it drops these columns itself.';
}
