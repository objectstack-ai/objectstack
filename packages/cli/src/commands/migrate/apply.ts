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
  isExitSignal,
} from '../../utils/format.js';
import {
  bootSchemaStack,
  describeDatabaseSource,
  describeTelemetryDatabase,
  renderPlan,
  renderPendingSchemaWork,
  summarize,
  summarizePendingSchemaWork,
  groupByCategory,
  SKIPPED_SCHEMA_SYNC_NOTE,
} from '../../utils/schema-migrate.js';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import {
  describeUnloadableHostConfig,
  refuseWhenHostConfigUnloadable,
  type SchemaMigrationComposition,
} from '../../utils/schema-migration-plugins.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import {
  COMMENT_OBJECT,
  REACTIONS_COLUMN,
  readCommentReactionsConversion,
} from '../../utils/comment-reactions-conversion.js';
import { ceremonyOrganizationColumnDrops, readOrganizationOwnershipMarker } from '../../utils/organization-ownership-drop-gate.js';

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
 * [#23848] One entry the driver did not apply, as the apply names it: where
 * (`table.column`; an index entry's `column` is its leading key column), the
 * kind, the index name for an index entry, and `(destructive)` when it is.
 */
function describeNotApplied(entry: ManagedDriftEntry): string {
  const where = entry.column ? `${entry.table}.${entry.column}` : entry.table;
  const index = 'indexName' in entry.op ? ` ${entry.op.indexName}` : '';
  return `${where} — ${entry.op.type}${index}${entry.category === 'destructive' ? ' (destructive)' : ''}`;
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
 *
 * And since #23848, a primary whose transport cannot hold DDL back (the Turso
 * REMOTE transport, which refused the boot until then) is reconciled too:
 *
 * 4. **The drift half runs where the additive half cannot be previewed.** The
 *    boot skips schema sync instead of deferring it, as `os migrate plan`'s
 *    does, so guarantee 1 still holds (nothing is written before the prompt)
 *    and the additive work is reported as NOT examined rather than as none.
 *    The drift entries are applied as on any database, and **every entry the
 *    driver did not apply is named** by table, column and kind; a destructive
 *    one the operator confirmed makes the run PARTIAL and exit 1.
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
      // two commands pass it identically — `composeServedPlatform` (#22506)
      // included.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        deferSchemaDdl: true,
        // [#23848] Where the primary's transport cannot defer DDL, skip schema
        // sync rather than refuse — the posture `os migrate plan` passes too.
        deferredDdlUnsupported: 'skip-schema-sync',
        composeHostStack: true,
        composeServedPlatform: true,
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

      // [#22581] The database this run reconciles and who named it, on every
      // payload below — the in-sync and refusal paths included, since "nothing
      // to apply" is only as good as the database it was read from.
      // [#22579] …and the `telemetry` sibling lifecycle-classed objects are
      // reconciled in, when the serving boot keeps one.
      // [#23848] …and, when the boot skipped schema sync, that `pending` /
      // `created` were not examined: the additive work is not this run's.
      const schemaSyncSkipped = stack.schemaSync === 'skipped';
      const target = {
        database: stack.dbLabel,
        databaseSource: stack.dbSource,
        ...(stack.telemetryDatabase !== null ? { telemetryDatabase: stack.telemetryDatabase } : {}),
        ...(schemaSyncSkipped ? { schemaSync: 'skipped' as const } : {}),
      };

      // What the object set was composed from (#12938) — printed BEFORE the
      // in-sync early return below, not with the plan. "Already in sync" over a
      // set that is a fraction of the target's tables is precisely the reading
      // this card exists to stop, so the account of what was composed has to
      // reach the operator on that path too. [#22581] The database line rides
      // above it for the same reason.
      if (!flags.json) {
        printInfo(`Database: ${chalk.white(stack.dbLabel)} ${chalk.dim(`(${describeDatabaseSource(stack.dbSource)})`)}`);
        if (stack.telemetryDatabase !== null) printInfo(describeTelemetryDatabase(stack.telemetryDatabase));
        if (schemaSyncSkipped) printWarning(SKIPPED_SCHEMA_SYNC_NOTE);
        for (const note of stack.composition.notes) console.log(chalk.dim(`      ${note}`));
        console.log('');
      }

      // [#22579] Over every datasource this run reconciles: the primary and the
      // `telemetry` sibling, each entry applied where it was found.
      const drift = await stack.detectManagedDrift();
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
            {
              ...target, applied: [], skipped: [], created: [],
              message: unexamined > 0 || schemaSyncSkipped ? 'in_sync_partial' : 'in_sync',
              ...compositionPayload,
            },
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
        if (schemaSyncSkipped) {
          // [#23848] Drift was read; the additive half was not (see above).
          printWarning(
            'Nothing to apply over the tables this database holds — but its additive schema work was NOT examined '
            + '(see above). This is a PARTIAL reconcile: it is not evidence that every declared table and column exists.',
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
            ...target,
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

      // ── [#17440] REFUSE THE sys_account.issuer DROP ON A DIRTY TABLE ──
      //
      // Same placement rule as the gate above, for the same reason: BELOW the
      // report (the operator sees the plan), ABOVE the confirmation prompt (an
      // operator is never asked to confirm a run this command has already
      // decided to refuse) and ABOVE both writes.
      //
      // Account uniqueness moved from `(issuer, account_id)` to
      // `(provider_id, account_id)` when better-auth 1.7.3 rolled the
      // issuer-scoped identity back. That is a NARROWER key, so rows that were
      // legal under the old one can be one account under the new one.
      //
      // ⛔ The detection mechanism is deliberately not "drop it and let the
      // constraint fail". On this table it would not fail: `syncDeclaredIndexes`
      // logs a plain UNIQUE whose CREATE fails on existing duplicates and lets
      // the boot continue (commit 61821e54c / #15479), so a database holding the class
      // carries no such constraint to violate. The drop would simply make the
      // rows indistinguishable and let a sign-in resolve onto the wrong user's
      // account — silently. Hence a row-level pre-flight, run against the live
      // database at the moment it matters.
      const dropsAccountIssuer = intended.some(
        (d) => d.op?.type === 'drop_column' && d.table === 'sys_account' && d.op.column === 'issuer',
      );
      if (dropsAccountIssuer) {
        const { probeAccountIdentityCollisions, formatAccountIdentityPreflightReport } =
          await import('@objectstack/plugin-auth');
        const engine = (stack.kernel as { getService?: (n: string) => unknown }).getService?.call(
          stack.kernel,
          'objectql',
        );
        // [#23281] Both refusals below exit 1 under `--json` as well, as the
        // human face and the `sys_comment.reactions` sibling do: a document
        // that says "refused" beside exit 0 reads as a successful apply to a
        // caller gating on the status. Each emitted with 0 until this card.
        let preflight;
        try {
          preflight = await probeAccountIdentityCollisions(engine as never);
        } catch (e: any) {
          // A pre-flight that could not read is not a pre-flight that passed.
          const detail = e?.message ?? String(e);
          if (flags.json) {
            await emitJson({
              ...target, created: [], applied: [], skipped: drift, pending,
              message: 'refused_account_issuer_preflight_unreadable', detail,
            }, 1, { compact: true });
            return;
          }
          printError(
            `Refusing to drop sys_account.issuer: the retirement pre-flight could not read the table. ${detail}`,
          );
          this.exit(1);
          return;
        }
        if (!preflight.ok) {
          if (flags.json) {
            await emitJson({
              ...target, created: [], applied: [], skipped: drift, pending,
              message: 'refused_account_issuer_collisions', preflight,
            }, 1, { compact: true });
            return;
          }
          console.log('');
          console.log(formatAccountIdentityPreflightReport(preflight));
          console.log('');
          printError(
            'Refusing to drop sys_account.issuer: dropping it would make the rows above '
            + 'indistinguishable, and a sign-in could resolve onto the wrong account. Resolve them, then '
            + 're-run "os migrate account-issuer" as the post-check before applying.',
          );
          this.exit(1);
          return;
        }
        if (!flags.json) {
          printSuccess(
            `sys_account.issuer retirement pre-flight: clean over ${preflight.scanned} row(s).`,
          );
        }
      }

      // ── [#23281] REFUSE THE sys_comment.reactions DROP BEFORE ITS CONVERSION ──
      //
      // The sibling of the gate above, placed by the same rule: below the
      // report, above the confirmation prompt, above both writes.
      //
      // v18 retired the column and an upgrade keeps existing data, so the
      // reactions a 17.x deployment stored in it are carried into
      // `sys_comment_reaction` records by `os migrate comment-reactions`. The
      // drop deletes whatever the column still holds, so it waits for that
      // command's verified run, recorded in `sys_migration` — the evidence
      // gated migrations already leave, read here instead of re-measured: once
      // converted, a member may delete their own reaction, and a live probe
      // would read that as unconverted (`utils/comment-reactions-conversion.ts`
      // says why). The boot drift report and the retirement's upgrade note name
      // this very command as the remedy, so both arrive here.
      const dropsCommentReactions = intended.some(
        (d) => d.op?.type === 'drop_column' && d.table === COMMENT_OBJECT && d.op.column === REACTIONS_COLUMN,
      );
      if (dropsCommentReactions) {
        const engine = (stack.kernel as { getService?: (n: string) => unknown }).getService?.call(
          stack.kernel,
          'objectql',
        );
        const conversion = await readCommentReactionsConversion(engine as never);
        if (!conversion.verified) {
          const detail = conversion.flag
            ? `The last run of "os migrate comment-reactions --apply" (${conversion.flag.last_run_at}) left `
              + `${conversion.flag.blocking} reaction(s) or stored value(s) unconverted.`
            : 'No run of "os migrate comment-reactions --apply" is recorded on this database.';
          if (flags.json) {
            await emitJson({
              ...target, created: [], applied: [], skipped: drift, pending,
              message: 'refused_comment_reactions_unconverted', detail, conversion: conversion.flag,
            }, 1, { compact: true });
            return;
          }
          printError(
            'Refusing to drop sys_comment.reactions: the emoji reactions stored in it are not yet carried into '
            + `sys_comment_reaction records, and dropping the column would delete them. ${detail} Run `
            + '"os migrate comment-reactions" to preview, then "os migrate comment-reactions --apply"; once it '
            + 'reports the run verified, re-run this command.',
          );
          this.exit(1);
          return;
        }
        if (!flags.json) {
          printSuccess(
            `sys_comment.reactions: its reactions were converted and verified (${conversion.flag?.verified_at}) — `
            + 'the drop may proceed.',
          );
        }
      }

      // ── [#23429 E1, ADR-0131 D10 item 5] REFUSE AN organization_id DROP AHEAD OF THE CEREMONY ──
      //
      // The third sibling, placed by the same rule: below the report, above the
      // confirmation prompt, above both writes. A v18 runtime declares no
      // organization column on the ceremony's column-drop tables, so the drift
      // report offers each physical one for `--allow-destructive`. Dropped here
      // first, the ceremony never promotes or reports the legacy organization
      // rows, they become environment rows, and the v18 boot refusal finds no
      // column left to refuse over — the escape hatch D10 item 5 forbids. So
      // the drop waits for the ceremony's verified marker; no flag stands it
      // down (`utils/organization-ownership-drop-gate.ts`).
      const organizationDrops = ceremonyOrganizationColumnDrops(intended);
      if (organizationDrops.length > 0) {
        const engine = (stack.kernel as { getService?: (n: string) => unknown }).getService?.call(
          stack.kernel,
          'objectql',
        );
        const marker = await readOrganizationOwnershipMarker(engine as never);
        if (!marker.verified) {
          const detail = marker.flag
            ? `The last run of "os migrate organization-ownership --apply --plan-file FILE" (${marker.flag.last_run_at}) is not verified `
              + `(${marker.flag.blocking} blocking item(s)).`
            : 'No run of "os migrate organization-ownership --apply --plan-file FILE" is recorded on this database.';
          if (flags.json) {
            await emitJson({
              ...target, created: [], applied: [], skipped: drift, pending,
              message: 'refused_organization_ownership_unmigrated', tables: organizationDrops, detail, marker: marker.flag,
            }, 1, { compact: true });
            return;
          }
          printError(
            `Refusing this --allow-destructive run: it would drop organization_id from ${organizationDrops.join(', ')}, a drop the organization-ownership ceremony `
            + `owns, and the ceremony has not verified on this database. ${detail} Dropping the column first would turn `
            + 'every legacy organization row into an environment row without the ceremony\'s promotion or report. Run '
            + '"os migrate organization-ownership --out PLAN" to write and review its plan, then '
            + '"os migrate organization-ownership --apply --plan-file PLAN"; it drops these columns itself, in its '
            + 'column-drops step, before it records the run verified. Nothing in this run was applied.',
          );
          this.exit(1);
          return;
        }
        if (!flags.json) {
          printSuccess(
            `organization_id on ${organizationDrops.join(', ')}: the organization-ownership ceremony verified `
            + `(${marker.flag?.verified_at}) — the drop may proceed.`,
          );
        }
      }

      const totalIntended = intended.length + pending.length;
      if (totalIntended === 0) {
        if (flags.json) { await emitJson({ ...target, applied: [], skipped: deferred, created: [], message: 'nothing_safe_to_apply' }, 0, { compact: true }); return; }
        printWarning('No changes to apply without --allow-destructive.');
        return;
      }

      // Confirmation gate. Nothing above this line has touched the database.
      if (!flags.yes) {
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) { await emitJson({ ...target, applied: [], skipped: drift, pending, message: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true }); return; }
          printWarning('Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.');
          return;
        }
        const targets = stack.telemetryDatabase !== null
          ? `${stack.dbLabel} and its telemetry database ${stack.telemetryDatabase}`
          : stack.dbLabel;
        const ok = await confirm(chalk.bold(`\nApply ${totalIntended} change(s) to ${targets}? [y/N] `));
        if (!ok) { printInfo('Aborted — no changes made.'); return; }
      }

      // Additive work first: a table has to exist before its columns can be
      // reconciled. Drift was detected against the pre-flush database, and a
      // just-created table matches metadata by construction, so the two sets
      // never overlap.
      const created = await stack.flushSchemaDdl();
      const { applied, skipped } = await stack.applyMigrationEntries(drift, { allowDestructive });

      // ── [#23848] NAME WHAT THE DRIVER DID NOT APPLY ──────────────────
      //
      // `skipped` mixes two things: the destructive entries this run held back
      // for lack of --allow-destructive (`deferred` — the driver was told not
      // to), and the entries the driver was asked to apply and did not — its
      // dialect or transport cannot perform them, or their DDL failed, and it
      // logged which. The Turso REMOTE transport runs no SQLite table rebuild,
      // so of the column entries it applies a drop and skips the rest. The
      // second kind is named entry by entry, by table, column and kind.
      //
      // A DESTRUCTIVE one makes the run PARTIAL and exit 1, in both faces, as
      // the refusals above do: the operator confirmed it with
      // --allow-destructive, and a caller gating on the status must not read
      // a schema that still differs as a migrated one. A non-destructive one
      // is named and the exit stays 0 — the report-only findings no driver
      // applies (`manual_column_type_change` and its siblings) have always
      // been skipped on every dialect, and still are.
      const held = new Set<ManagedDriftEntry>(deferred);
      const notApplied = skipped.filter((d) => !held.has(d));
      const unappliedDestructive = notApplied.filter((d) => d.category === 'destructive');
      const partial = unappliedDestructive.length > 0;

      if (flags.json) {
        await emitJson({
          ...target,
          created,
          applied,
          skipped,
          notApplied,
          ...(partial ? { message: 'partial' } : {}),
          ...compositionPayload,
          duration: timer.elapsed(),
        }, partial ? 1 : 0);
        return;
      }

      console.log('');
      if (created.length > 0) {
        printSuccess(`Created/extended ${created.length} table(s): ${await summarizePendingSchemaWork(created)}.`);
      }
      printSuccess(`Applied ${applied.length} change(s).`);
      const heldBack = skipped.length - notApplied.length;
      if (heldBack > 0) {
        printWarning(`Skipped ${heldBack} destructive change(s) (re-run with --allow-destructive to include them).`);
      }
      if (notApplied.length > 0) {
        printWarning(
          `${notApplied.length} change(s) were NOT applied — the driver could not perform them on this database (its log `
          + 'above says why), so the schema still differs from metadata there:',
        );
        for (const d of notApplied) console.log(chalk.yellow(`      • ${describeNotApplied(d)}`));
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (partial) {
        printError(
          `PARTIAL apply: ${unappliedDestructive.length} destructive change(s) confirmed with --allow-destructive were `
          + 'NOT applied (named above). The other changes in this run were applied.',
        );
        this.exit(1);
      }
    } catch (error: any) {
      // [#21434] The account-issuer pre-flight refusals above `this.exit(1)`
      // from inside this `try`; re-reporting the signal printed a second
      // error line, `EEXIT: 1`, under the refusal.
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
