// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
  isExitSignal,
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

/** The raw-SQL seam shape — same signature `@objectstack/metadata-protocol` resolves. */
export type RawExec = (sql: string, params?: unknown[]) => Promise<unknown>;

/** The two dialects on which a stale textual column actually corrupts (measured, #11535). */
export type CorruptingDialect = 'postgres' | 'mysql';

export const CORRUPTING_DIALECTS: readonly CorruptingDialect[] = ['postgres', 'mysql'];

/**
 * ── The remedy statement comes FROM THE ENGINE, at the point of use ─────────
 *
 * `manualJsonConversionSql` is `@objectstack/driver-sql`'s own builder — the
 * one whose output `manual_column_type_change` prints — re-exported from that
 * package for this command (#11733) and imported here rather than reproduced.
 * Two of its arms were corrected by running the earlier version against a live
 * server (`json_build_array` over `to_json`, which yields a JSON *scalar*; and
 * the explicit `IS NULL` arm, because `json_build_array(NULL)` is `[null]`), so
 * a second copy of it in this package could only ever be a copy that goes
 * stale. There is now exactly one definition, in the package that measured it.
 *
 * It arrives through {@link RemedySqlBuilder} rather than a module-level import
 * for a mechanical reason, not a stylistic one: no CLI production module may
 * STATICALLY value-import a driver package. oclif `import()`s every command
 * module on every invocation while building its command table, so one static
 * driver import makes an unbuilt `driver-sql/dist` print a `MODULE_NOT_FOUND`
 * block for each of the nine commands sharing that chain, in front of whatever
 * the operator actually ran, and drops all nine from the table (#5726, pinned
 * by `schema-migrate.lazy-driver-import.test.ts`). The command therefore
 * `await import(...)`s the driver at the point of use and hands the builder in,
 * which also keeps {@link planStaleColumnTargets} synchronous and pure.
 */
export type RemedySqlBuilder = (
  dialect: CorruptingDialect,
  table: string,
  column: string,
) => string;

/**
 * Split the remedy into the statements a driver seam can take one at a time.
 *
 * The same split #11720's live suite executes the remedy with. It is not a
 * general SQL splitter and does not need to be: neither dialect's form contains
 * a semicolon inside a literal (`''`, `'['`), which is a property of THESE two
 * statements, pinned by `multi-value-columns.dialect-probe.test.ts`.
 *
 * The MySQL form is three statements and must be run in order — the two UPDATEs
 * put every row into a shape the `MODIFY … json` will accept.
 */
export function splitRemedyStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One stale column this command can act on. */
export interface StaleColumnTarget {
  table: string;
  column: string;
  /** Physical type the column still has, as the engine read it off the server. */
  from: string;
  /** Type the metadata declares — always `json` for this op. */
  to: string;
  dialect: CorruptingDialect;
  /** Ordered statements; the whole remedy for `table.column`. */
  statements: string[];
}

/** A finding this command declines to act on, and why. Never silently dropped. */
export interface StaleColumnRefusal {
  table: string;
  column: string;
  reason: 'remedy_not_recognized';
  detail: string;
}

export interface StaleColumnPlan {
  targets: StaleColumnTarget[];
  refusals: StaleColumnRefusal[];
}

/** Is this a `manual_column_type_change` finding? (The only op this command touches.) */
export function isStaleMultiValueColumn(entry: ManagedDriftEntry): boolean {
  return entry?.op?.type === 'manual_column_type_change';
}

/**
 * Turn the engine's findings into an executable plan.
 *
 * ## The dialect is read off the finding, not off the connection
 *
 * A `ManagedDriftEntry` does not carry a dialect, and there is deliberately no
 * client-name table here: `driver-sql` owns the mapping from a knex client
 * spelling to a dialect (`postgres` / `pg` / `postgresql` are one dialect under
 * three names, and getting that list wrong is a measured defect class — see
 * `POSTGRES_EMIT_CLIENTS`), so a second copy of it in this package could only
 * ever disagree with it. The dialect is therefore decided by WHICH dialect's
 * statement the engine's own finding message contains; the two forms are
 * unmistakable, backtick-quoted MySQL against double-quoted Postgres.
 *
 * ## What the containment check claims, now that `sql` IS the engine's function
 *
 * While this command carried its own copy of the statement, this check was also
 * the guard that the copy had not gone stale. That job is gone — `sql` is
 * `manualJsonConversionSql` itself (#11733), so the two sides cannot disagree,
 * and a test asserting they match would be a test that cannot fail.
 *
 * The check stays because the OTHER job it was doing is the one it now does
 * alone: it reads the dialect, by matching the engine's finding against the
 * engine's own function. Its failure branch remains reachable and load-bearing.
 * A finding whose message no longer embeds the remedy — a message the engine
 * reworded, an entry forwarded without one — yields no dialect, and the command
 * REFUSES it rather than guess which of two dialects' DDL to run against a
 * customer's table. SQLite would land there too if it ever produced this
 * finding, which it does not: it reads a stale column back as a real array, so
 * `diffManagedTable` stays silent (measured, #11720).
 */
export function planStaleColumnTargets(
  entries: ManagedDriftEntry[],
  opts: { sql: RemedySqlBuilder; tables?: string[] },
): StaleColumnPlan {
  const wanted = opts.tables && opts.tables.length > 0 ? new Set(opts.tables) : null;
  const targets: StaleColumnTarget[] = [];
  const refusals: StaleColumnRefusal[] = [];

  for (const entry of entries) {
    if (!isStaleMultiValueColumn(entry)) continue;
    const op = entry.op as { table: string; column: string; to: string; from: string };
    if (wanted && !wanted.has(op.table)) continue;

    const message = typeof entry.message === 'string' ? entry.message : '';
    const dialect = CORRUPTING_DIALECTS.find((d) =>
      message.includes(opts.sql(d, op.table, op.column)),
    );

    if (!dialect) {
      refusals.push({
        table: op.table,
        column: op.column,
        reason: 'remedy_not_recognized',
        detail:
          `the drift finding for ${op.table}.${op.column} does not contain the remedy statement this ` +
          `command knows how to run, so there is nothing here it can execute without inventing SQL. ` +
          `Run "os migrate plan" and apply the statement the finding prints, by hand.`,
      });
      continue;
    }

    targets.push({
      table: op.table,
      column: op.column,
      from: op.from,
      to: op.to,
      dialect,
      statements: splitRemedyStatements(opts.sql(dialect, op.table, op.column)),
    });
  }

  return { targets, refusals };
}

/** What one target's execution did — or, in a dry run, did not do. */
export interface StaleColumnOutcome {
  table: string;
  column: string;
  dialect: CorruptingDialect;
  from: string;
  to: string;
  statements: string[];
  /** Statements actually sent to the database. ALWAYS `[]` in a dry run. */
  executed: string[];
  status: 'planned' | 'migrated' | 'failed';
  error?: string;
}

export interface StaleColumnRunResult {
  apply: boolean;
  outcomes: StaleColumnOutcome[];
  refusals: StaleColumnRefusal[];
  /** Statements sent to the database across every target. `[]` in a dry run. */
  executedStatements: string[];
}

/**
 * Execute the plan — or, without `apply`, deliberately execute nothing.
 *
 * ⚠️ The dry run is the contract this function exists to keep: with
 * `apply !== true` the `exec` seam is never called, not once, not for a probe.
 * "Shows what it would run" and "quietly runs it" are indistinguishable to an
 * operator reading a successful report, so the difference is pinned by a test
 * that re-reads the column type and the rows from a real database after a dry
 * run and requires both unchanged — with the same instrument shown observing
 * the change an apply run makes.
 *
 * Failures are per target: one table's ALTER failing (an index on the column is
 * the common cause — a json column cannot carry a plain btree) stops THAT
 * target's remaining statements and is reported, while the other targets are
 * still attempted. On MySQL the three statements are separate implicit-commit
 * DDL/DML, so a target that fails midway is left partly converted; re-running
 * finishes it, because each statement skips the rows the previous run already
 * moved.
 */
export async function runStaleColumnMigration(args: {
  plan: StaleColumnPlan;
  exec: RawExec;
  apply: boolean;
  onStatement?: (statement: string) => void;
}): Promise<StaleColumnRunResult> {
  const { plan, exec, apply } = args;
  const outcomes: StaleColumnOutcome[] = [];
  const executedStatements: string[] = [];

  for (const target of plan.targets) {
    const outcome: StaleColumnOutcome = {
      table: target.table,
      column: target.column,
      dialect: target.dialect,
      from: target.from,
      to: target.to,
      statements: target.statements,
      executed: [],
      status: 'planned',
    };
    outcomes.push(outcome);

    if (!apply) continue;

    try {
      for (const statement of target.statements) {
        args.onStatement?.(statement);
        await exec(statement);
        outcome.executed.push(statement);
        executedStatements.push(statement);
      }
      outcome.status = 'migrated';
    } catch (error: unknown) {
      outcome.status = 'failed';
      outcome.error = error instanceof Error ? error.message : String(error);
    }
  }

  return { apply, outcomes, refusals: plan.refusals, executedStatements };
}

/**
 * What the operator does if it goes wrong — printed by the command and repeated
 * in `content/docs/deployment/cli.mdx`.
 *
 * The first line is not boilerplate. The conversion is NOT information
 * preserving: both `NULL` and the empty string map to `NULL`, so after a
 * successful run the rows that held `''` are indistinguishable from the rows
 * that held `NULL`. A type-only reversal (`ALTER … TYPE text`) therefore
 * restores the column's TYPE and not its contents — the backup is the only
 * faithful rollback, which is why the command refuses to pretend it has an
 * `--undo`.
 */
export const ROLLBACK_NOTES: readonly string[] = [
  'Restore the backup you took before the run. The conversion maps both NULL and the empty string to NULL, so once it succeeds those two states cannot be told apart again — no reverse statement can put them back.',
  'Reverting only the column TYPE (Postgres: ALTER TABLE … ALTER COLUMN … TYPE text USING …::text) puts the column back to text with JSON text in it. Metadata still declares the field multi-value, so the drift finding returns on the next boot and the corruption resumes on the next write. It is a stopgap for an incident, not a rollback.',
  'Postgres runs the whole remedy as ONE statement: if it fails, the column is untouched and there is nothing to roll back.',
  'MySQL runs three statements, and DDL there commits implicitly — a failure midway leaves rows partly converted. Re-run the command: the UPDATEs skip rows that already hold an array, so finishing an interrupted run is safe.',
  'If the ALTER fails naming an index, drop the index on that column first (a json column cannot carry a plain btree) and re-run; recreate it afterwards in the shape your dialect supports for json.',
];

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
 * `os migrate multi-value-columns` — the operator-run half of #11535.
 *
 * A field that gains `multiple: true` over an existing database keeps its old
 * `varchar`/`text` column: the additive sync adds columns and never changes
 * one's type. Arrays are then written as the STRINGIFIED literal `'["a","b"]'`
 * and read back as a string, so a consumer receives one opaque id instead of a
 * list. `driver-sql` reports that as `manual_column_type_change` (#11720);
 * this command is how an operator acts on the report.
 *
 * ## It is never run for you — that is the ruling, not an omission
 *
 * Ruled C on #11700 (maintainer, 2026-08-24): the platform WARNS and ships an
 * explicit, operator-run migration. Unattended auto-migration was rejected —
 * it was the only route that had the platform altering a customer's production
 * table structure with nobody watching. So the reconciler still has NO arm for
 * this op: `os migrate apply` hands it to `applyMigrationEntries`, which
 * declines it (`applied=0, skipped=1`). This command does not go through the
 * reconciler either — it runs the engine's own statement through the driver's
 * raw seam, only after the operator asked for `--apply` and confirmed. Nothing
 * on the boot path invokes it; `multi-value-columns.no-auto-run.test.ts` pins
 * that.
 *
 * ## Historical data is out of scope, by the same ruling
 *
 * 「11700 11693 不需要考虑历史数据，其他按照你的建议继续」 — rows corrupted
 * BEFORE the column was migrated are the customer's to repair. This command
 * converts the column and the values in it; it does not hunt for stringified
 * arrays that a hook already copied into some other single-value column, and it
 * must not grow that.
 */
export default class MigrateMultiValueColumns extends Command {
  static override description =
    'Migrate a stale varchar/text column to json where the field declares multiple: true (#11535). ' +
    'Dry-run by default: prints the exact statements and the database they would run against, and writes nothing.';

  static override examples = [
    '$ os migrate multi-value-columns',
    '$ os migrate multi-value-columns --json',
    '$ os migrate multi-value-columns --apply',
    '$ os migrate multi-value-columns --apply --yes --json',
    '$ os migrate multi-value-columns --table crm_case',
    '$ os migrate multi-value-columns --database-url postgres://localhost/app',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Run the statements (default is a dry run that executes nothing at all)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    table: Flags.string({
      description: 'Restrict to this physical table (repeatable; default: every stale column reported)',
      multiple: true,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateMultiValueColumns);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · multi-value-columns');

    // Probed before boot, so the answer is about somebody else's connections
    // rather than our own pool, and before the prompt, so an operator is never
    // asked to confirm a run we then refuse.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
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
    if (occupancy.status === 'busy' && !flags.json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Altering the column anyway — the live process may write rows mid-migration.`
        : `${describeOccupancy(occupancy)} The dry run below writes nothing.`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode changes a column type and rewrites its values. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nAlter these columns to json and rewrite their values? Take a backup first. [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting schema stack (APPLY mode)…' : 'Booting schema stack (dry run)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        // Held back so the boot itself performs no create-table / add-column
        // work — the only statements this command may run are the remedy's.
        deferSchemaDdl: true,
        // A dry run must not bring a database into existence either (#6743);
        // an apply run needs the real target to write into.
        ...(apply ? {} : { readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      if (!stack.driver) {
        if (flags.json) { await emitJson({ error: 'no_sql_driver', targets: [] }, 0, { compact: true }); return; }
        printWarning('This migration only applies to SQL drivers (Postgres / MySQL). No SQL driver is active.');
        return;
      }

      // Lazily, at the point of use: a static value import of a driver package
      // in a command module costs every OTHER command its place in oclif's
      // table when the driver is not built (#5726).
      const { manualJsonConversionSql } = await import('@objectstack/driver-sql');

      const drift = await stack.driver.detectManagedDrift();
      const plan = planStaleColumnTargets(drift, {
        sql: manualJsonConversionSql,
        ...(flags.table ? { tables: flags.table } : {}),
      });

      let result: StaleColumnRunResult;
      let verified: boolean | null = null;

      if (!apply) {
        // The dry run never resolves a seam, so there is nothing here that
        // could execute by accident: the exec it is handed throws.
        result = await runStaleColumnMigration({
          plan,
          apply: false,
          exec: async () => {
            throw new Error('dry run must not execute SQL');
          },
        });
      } else {
        const { resolveSeedTenancyExec, normalizeRows } = await import('@objectstack/metadata-protocol');
        const getService = (stack.kernel as { getService?: (name: string) => unknown })?.getService;
        const ql = getService?.call(stack.kernel, 'objectql') as IObjectQLEngine | undefined;
        const exec = resolveSeedTenancyExec(ql);

        // Loud absence, never a silent success. A driver can expose an
        // `execute` that accepts every statement and performs none (#10677),
        // and "migrated 3 columns" from a seam that ran nothing is the worst
        // report this command could print. `select 1` must come back as a row.
        const answers = exec
          ? await exec('select 1 as os_seam_probe')
              .then((r) => normalizeRows(r).length > 0)
              .catch(() => false)
          : false;
        if (!exec || !answers) {
          const detail =
            'The active driver exposes no usable raw SQL seam — it is either absent, or present but ' +
            'answering nothing — so the migration cannot be executed. Run "os migrate plan" and apply ' +
            'the statement the finding prints, by hand.';
          if (flags.json) { await emitJson({ error: 'no_sql_seam', detail }, 0, { compact: true }); this.exit(1); return; }
          printError(detail);
          this.exit(1);
          return;
        }

        result = await runStaleColumnMigration({
          plan,
          apply: true,
          exec,
          onStatement: flags.json ? undefined : (s) => printStep(chalk.dim(s)),
        });

        // The finding must be GONE afterwards — the same check #11720's live
        // suite makes. A migration that "succeeded" while the engine still
        // reports the column has not done what it claims.
        if (result.outcomes.some((o) => o.status === 'migrated')) {
          const after = await stack.driver.detectManagedDrift();
          const stillStale = planStaleColumnTargets(after, { sql: manualJsonConversionSql }).targets;
          verified = !result.outcomes.some(
            (o) => o.status === 'migrated' && stillStale.some((t) => t.table === o.table && t.column === o.column),
          );
        }
      }

      const failed = result.outcomes.filter((o) => o.status === 'failed');

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          apply,
          targets: result.outcomes,
          refusals: result.refusals,
          verified,
          rollback: ROLLBACK_NOTES,
          duration: timer.elapsed(),
        });
        if (failed.length > 0 || verified === false) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');

      if (result.outcomes.length === 0 && result.refusals.length === 0) {
        printSuccess('No stale multi-value columns — every field declaring "multiple: true" already has a json column.');
        console.log(chalk.dim(`  ${timer.display()}`));
        console.log('');
        return;
      }

      for (const outcome of result.outcomes) {
        const mark = outcome.status === 'migrated' ? chalk.green('✓') : outcome.status === 'failed' ? chalk.red('✗') : chalk.yellow('•');
        console.log(`${mark} ${chalk.bold(`${outcome.table}.${outcome.column}`)}  ${chalk.dim(`${outcome.from} → ${outcome.to} (${outcome.dialect})`)}`);
        for (const statement of outcome.statements) {
          console.log(`    ${chalk.cyan(statement)}`);
        }
        if (outcome.error) console.log(`    ${chalk.red(outcome.error)}`);
        console.log('');
      }

      for (const refusal of result.refusals) {
        printWarning(`${refusal.table}.${refusal.column}: ${refusal.detail}`);
      }

      if (!apply) {
        printInfo(
          `Dry run — nothing was executed. ${result.outcomes.length} column(s) would be migrated by the ` +
            'statements above. Take a backup, then re-run with --apply.',
        );
        console.log('');
        console.log(chalk.bold('If it goes wrong:'));
        for (const note of ROLLBACK_NOTES) console.log(`  ${chalk.dim('·')} ${note}`);
      } else if (failed.length > 0) {
        printError(`${failed.length} column(s) could not be migrated — see the errors above.`);
        console.log('');
        console.log(chalk.bold('If it goes wrong:'));
        for (const note of ROLLBACK_NOTES) console.log(`  ${chalk.dim('·')} ${note}`);
      } else if (verified === false) {
        printError('The statements ran, but the drift finding is still reported — the column has not reached json. Do not treat this as migrated.');
      } else if (result.outcomes.length > 0) {
        printSuccess(`Migrated ${result.outcomes.length} column(s) to json; the drift finding no longer reports them.`);
      }

      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (failed.length > 0 || verified === false) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
