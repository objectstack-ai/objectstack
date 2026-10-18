// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { lstat, open, readFile, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { resolveTenancyPosture } from '@objectstack/types';
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printStep,
  printWarning,
  createTimer,
  emitJson,
  errorCodeFields,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack, describeTelemetryDatabase } from '../../utils/schema-migrate.js';
import { TELEMETRY_DATASOURCE } from '../../utils/telemetry-datasource.js';
import { OCCUPANCY_STOP_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { resolvePlannedDriverExec } from '../../utils/unmanaged-tables.js';
import {
  buildOrganizationOwnershipPlan,
  OrganizationOwnershipPlanRefusal,
  columnListSql,
  columnNameOf,
  ceremonyDialectOf,
  PRIMARY_DATABASE,
  type OrganizationOwnershipPlan,
} from '../../utils/organization-ownership-plan.js';
import {
  HostFateSupplementRefusal,
  readHostFateSupplement,
  type InventoryEntry,
} from '../../utils/organization-ownership-inventory.js';
import {
  applyOrganizationOwnership,
  checkpointFromDetails,
  MetadataChoiceRefusal,
  ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  ReviewedPlanRefusal,
  reviewedPlanFromFile,
  TemplateChoiceRefusal,
  type ApplyExecutor,
  type ApplySibling,
  type CeremonyLedgerPort,
  type OrganizationOwnershipApplyReport,
  type ReviewedPlan,
} from '../../utils/organization-ownership-apply.js';

/** Who the ceremony's metadata saves name as their actor. */
const CEREMONY_ACTOR = 'os migrate organization-ownership';

/**
 * The databases beside the primary this boot provisioned — the `telemetry`
 * sibling a development boot (`--dev`) or an `OS_TELEMETRY_DB` deployment
 * keeps its lifecycle-classed objects in, exactly as the serving boot does —
 * each with its raw-SQL seam, and the booted engine's routing of an object to
 * its database. The ceremony plans, attributes and drops columns in each
 * object's own database: the boot refusal reads every object's columns where
 * the engine routes it, sibling included.
 */
async function ceremonySiblings(stack: {
  kernel: { getService(name: string): unknown };
  drivers: readonly unknown[];
  telemetryDatabase: string | null;
}): Promise<{ siblings: ApplySibling[]; homeOf: (object: string) => string | undefined }> {
  const { normalizeRows } = await import('@objectstack/metadata-protocol');
  const siblings: ApplySibling[] = [];
  const telemetry = stack.telemetryDatabase ? stack.drivers[1] : undefined;
  const exec = telemetry ? resolvePlannedDriverExec(telemetry as never) : null;
  if (telemetry && exec) {
    const client = (telemetry as { config?: { client?: unknown } }).config?.client;
    siblings.push({
      name: TELEMETRY_DATASOURCE,
      database: stack.telemetryDatabase!,
      executor: {
        dialect: ceremonyDialectOf(telemetry),
        ...(typeof client === 'string' ? { client } : {}),
        query: async (sql, params) => normalizeRows(await exec(sql, params ? [...params] : [])),
        execute: async (sql, params) => {
          await exec(sql, params ? [...params] : []);
        },
      },
    });
  }
  let engine: { getDriverForObject?: (object: string) => unknown } | undefined;
  try {
    engine = stack.kernel.getService('objectql') as typeof engine;
  } catch {
    engine = undefined;
  }
  const homeOf = (object: string): string | undefined => {
    if (siblings.length === 0 || typeof engine?.getDriverForObject !== 'function') return undefined;
    try {
      const driver = engine.getDriverForObject(object) as { name?: unknown } | undefined;
      return driver === telemetry || driver?.name === TELEMETRY_DATASOURCE ? TELEMETRY_DATASOURCE : PRIMARY_DATABASE;
    } catch {
      return undefined;
    }
  };
  return { siblings, homeOf };
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --backup-taken
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * [#23826] What the apply's report file holds from the moment it is reserved
 * (before the boot) until the report is written over it. A run that stops in
 * between without reaching its own cleanup (an interrupt, a crash) leaves this
 * text behind, which says what happened, never an empty file taken for a report.
 */
function reportReservationText(reservedAt: string): string {
  const note =
    'os migrate organization-ownership --apply reserved this file for its report before it opened the database. ' +
    'If this text is still here after that run ended, the run stopped before it wrote its report: the deployment ' +
    `ledger (sys_migration, row ${ORGANIZATION_OWNERSHIP_MIGRATION_ID}) records every step it finished. Re-run ` +
    '--apply with a new --out: it resumes, and finished steps are not repeated.';
  return `${JSON.stringify({ kind: 'organization-ownership-apply-reservation', reservedAt, note }, null, 2)}\n`;
}

/** Write `text` as the whole content of `handle`'s file, from its first byte. */
async function writeWholeFile(handle: FileHandle, text: string): Promise<void> {
  const bytes = Buffer.from(text, 'utf8');
  await handle.truncate(0);
  for (let at = 0; at < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, at, bytes.length - at, at);
    if (bytesWritten <= 0) throw new Error(`the write stopped at byte ${at} of ${bytes.length}`);
    at += bytesWritten;
  }
}

/**
 * The reserved path no longer names the file this run created: it was removed
 * or replaced while the ceremony ran. Not an OS error, so it carries no errno
 * `code`; what became of the file is its `standing`.
 */
class ReportFileLost extends Error {
  constructor(readonly file: string, readonly standing: 'removed' | 'replaced') {
    super(`${file} no longer names the file this run reserved: it was ${standing} while the ceremony ran`);
  }
}

/**
 * [#23826] The apply report's file, reserved before the apply boots: created
 * exclusively (never opened over an existing file), so an `--out` the run
 * cannot write refuses before anything executes, and no concurrent creator can
 * take the path between that check and the report. The report is written into
 * this same file at the end; a run with nothing to report releases it.
 */
class ReportFileReservation {
  private constructor(readonly file: string, private readonly handle: FileHandle) {}

  /** Create `file` exclusively, holding the reservation text; throws the OS error when it cannot. */
  static async take(file: string): Promise<ReportFileReservation> {
    const reservation = new ReportFileReservation(file, await open(file, 'wx'));
    try {
      await writeWholeFile(reservation.handle, reportReservationText(new Date().toISOString()));
    } catch (error) {
      await reservation.release();
      throw error;
    }
    return reservation;
  }

  /** Whether `file` still names the file this run created, or what became of it. */
  private async standing(): Promise<'held' | 'removed' | 'replaced'> {
    const ours = await this.handle.stat();
    const there = await lstat(this.file).catch(() => undefined);
    if (!there) return 'removed';
    return there.dev === ours.dev && there.ino === ours.ino ? 'held' : 'replaced';
  }

  /** Write the report over the reservation text; throws when it cannot be kept at {@link file}. */
  async keep(text: string): Promise<void> {
    const standing = await this.standing();
    if (standing !== 'held') throw new ReportFileLost(this.file, standing);
    await writeWholeFile(this.handle, text);
    await this.handle.close();
  }

  /** Nothing will be reported: remove the reservation, only while {@link file} still names it. Best effort. */
  async release(): Promise<void> {
    const standing = await this.standing().catch(() => undefined);
    await this.handle.close().catch(() => {});
    if (standing === 'held') await unlink(this.file).catch(() => {});
  }
}

/**
 * `os migrate organization-ownership` — the v18 organization-ownership
 * ceremony's preflight (ADR-0131 D10, ceremony item 1): per table, the fate,
 * the row counts each fate will touch, the rows whose owner cannot be derived
 * (listed by id), and the tables that will and will not receive NOT NULL.
 *
 * ## Read-only, by construction
 *
 * The boot is the family's read-only boot (`deferSchemaDdl` + `readOnlyProbe`:
 * no DDL, no seed, no database file brought into existence), and the plan
 * itself issues SELECT statements only (`../../utils/organization-ownership-plan.ts`).
 * On a datasource whose transport cannot defer DDL (the Turso REMOTE
 * transport) the boot skips schema sync instead (`deferredDdlUnsupported:
 * 'skip-schema-sync'`, #23816): it attempts no DDL at all, which keeps the same
 * promise. The environment's own boot has run the additive sync the ceremony
 * reads; the ceremony needs no table this release would create.
 * It writes no row or table; the one thing it writes is the plan FILE, on the
 * operator's disk, which the ADR asks for: "the plan is written to a file the
 * operator keeps". It never overwrites one — a kept plan is evidence.
 *
 * ## Refusal
 *
 * A table the plan cannot enumerate (a dialect with no catalog statement, a
 * read that fails, a column its fate reads that the table lacks, a
 * platform table the inventory names no fate for, a database that is not an
 * ObjectStack one) refuses the whole plan, naming it — exit 1 and no file. ⛔
 * Never a table reported as empty.
 *
 * The SQL dialect is read once, off the stack's driver, before either arm
 * runs a statement (`ceremonyDialectOf`, the resolver `@objectstack/metadata-core`
 * shares): `dialectName` first, then a recognised `config.client` string. A
 * driver whose dialect that cannot name is refused, naming the driver, exit 1
 * — ⛔ never read as SQLite.
 *
 * ## Why a subcommand, not a flag on `os migrate`
 *
 * Bare `os migrate` is the schema-drift plan (#2186) and stays exactly that.
 * Every data step in this family is a named subcommand whose bare run is the
 * read-only preview and whose `--apply` is the only writing mode; the ADR's
 * `--plan` names this mode.
 *
 * ## `--apply` (ADR-0131 D10 ceremony items 2 to 4)
 *
 * The writing mode. It reads the reviewed plan file first (`--plan-file`, the
 * file a plan run wrote; without it the run is refused before the boot), then
 * asks about the backup — the operator's act and the precondition (D10 item
 * 2): `--backup-taken`, or a yes at the prompt; a non-interactive run without
 * the flag is refused before the boot. It then
 * performs the fates in order — attribution (under `single`, on a database
 * that holds no organization at all, after creating the Default Organization
 * through plugin-auth's boot invariant, as the plan's warnings say; ADR-0131
 * D3), the authored catalog conversion,
 * the promotion of organization customizations and public-form withdrawals,
 * the template promotion, the settings global-rung move, the verified id→name
 * rewrite, mirror deletion, column drops — through `../../utils/organization-ownership-apply.ts`,
 * checkpointing each finished step in the deployment ledger (`sys_migration`,
 * row {@link ORGANIZATION_OWNERSHIP_MIGRATION_ID}) so an interrupted run
 * resumes where it stopped, and ends with the post-check. The ledger row is
 * the ceremony's marker: `applied_at` once every step has finished,
 * `verified_at` when the post-check also reads zero discrepancies (a departure
 * this release cannot perform — the declared sharing-rule mirrors its own boot
 * keeps seeding — is reported as advisory, not as a discrepancy). A report
 * file is written beside the plan's, never over an existing one: it is reserved
 * (created exclusively) before the boot, so an `--out` that cannot be written
 * is refused before anything executes (`apply_refused`), and a report that
 * still cannot be kept after the ceremony executed is answered with its own
 * code (`apply_report_unwritable`, `executed: true`, the report itself).
 *
 * ## `--plan-file FILE` (the plan the operator reviewed)
 *
 * `--apply` requires the plan file a plan run wrote, and executes only that
 * plan: it refuses, before anything is written, when the inventory digest it
 * computes differs from the file's (a different `--fate-supplement`, another
 * release) or the file names another database. Both digests and the remedy —
 * plan again, review, hand the new file in — are named. A checkpoint recorded
 * under another digest is superseded by the reviewed plan: the run starts over
 * and its report says so (`restartedFrom`). There is no flag that skips the
 * comparison.
 *
 * ## `--fate-supplement FILE` (the host's own objects, ADR-0131 D10)
 *
 * The inventory holds the platform's fates. An object a HOST provides — a
 * platform-prefixed table carrying `organization_id` that no platform row
 * names — is refused, because no fate may be guessed for it. The host declares
 * those fates in one JSON file (the spec's `OrganizationOwnershipSupplementSchema`,
 * `@objectstack/spec/system`) and hands it to this flag; both modes read it and
 * plan, or apply, its rows on the same terms as the platform's
 * (`mergeHostFateSupplement`). A file that cannot be used — missing, not JSON,
 * a row the schema refuses, a duplicate row, a row naming a platform object —
 * is refused before the database is opened, inside the `--json` envelope. Its
 * rows enter the plan's `inventoryDigest`, so the apply's checkpoint is keyed
 * on the supplement too. Nothing is read without the flag: no environment
 * variable, no conventional path.
 *
 * The apply boot composes the deployment's served object set
 * (`composeHostStack`, with the auth-gated security declarations and the
 * served platform) so the security catalog it verifies names against is the
 * one the deployment serves, and the schema-drift ceremony proposes the
 * column drops of exactly the objects this release declares without the
 * column. It still holds the boot's own DDL back (`deferSchemaDdl`, or on the
 * Turso REMOTE transport no schema sync at all, as the plan boots): the only
 * schema change the ceremony makes is the drops it asked for. On that transport
 * the drops go through the remote face's own drift detector and migration
 * door (`@objectstack/driver-turso`).
 */
export default class MigrateOrganizationOwnership extends Command {
  static override description =
    'The v18 organization-ownership ceremony (ADR-0131 D10). Without --apply, the read-only plan: per table, the fate, ' +
    'the row counts, the rows whose owner cannot be derived (by id), and which tables will receive NOT NULL, written ' +
    'to a file — never a row or a column changed; it refuses, naming it, any table it cannot enumerate. With --apply ' +
    '(the reviewed plan file in --plan-file, and a backup), only that plan: attribution, the authored catalog ' +
    'conversion, the promotion of organization customizations and form withdrawals, the template promotion, the ' +
    'settings move, the ' +
    'verified id-to-name rewrite, mirror deletion and column drops, in that order, ' +
    'resumable from a recorded checkpoint, then the post-check.';

  static override examples = [
    '$ os migrate organization-ownership',
    '$ os migrate organization-ownership --out plans/v18-ownership.json',
    '$ os migrate organization-ownership --database-url postgres://… --json',
    '$ os migrate organization-ownership --apply --plan-file plans/v18-ownership.json --backup-taken',
    '$ os migrate organization-ownership --fate-supplement host-fates.json',
    '$ os migrate organization-ownership --dev',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to plan (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    out: Flags.string({
      description:
        'Where to write the plan, or with --apply the apply report (default: organization-ownership-plan-TIMESTAMP.json, ' +
        'or organization-ownership-apply-TIMESTAMP.json, in the current directory). ' +
        'An existing file is never overwritten; with --apply, a report file that cannot be written refuses the run ' +
        'before anything executes',
    }),
    json: Flags.boolean({ description: 'Also print the plan (or, with --apply, the apply report) on stdout' }),
    dev: Flags.boolean({
      description: 'Compose as `os serve --dev` does: the config\'s devPlugins, the development .env files, a '
        + 'development boot for the auth secret\'s fallback, and the `telemetry` sibling database a development '
        + 'boot keeps its lifecycle objects in. Pass it when the deployment boots with --dev (`os dev`).',
      default: false,
    }),
    apply: Flags.boolean({
      description:
        'Perform the ceremony: attribution, the verified id-to-name rewrite, mirror deletion, column drops, then the ' +
        'post-check. Idempotent; an interrupted run resumes from its recorded checkpoint. Requires a backup',
      default: false,
    }),
    'plan-file': Flags.string({
      description:
        'With --apply (required): the plan file a plan run wrote and you reviewed. The run refuses, before any write, ' +
        'when its inventory digest differs from that file\'s (another --fate-supplement, another release) or the file ' +
        'names another database',
    }),
    'backup-taken': Flags.boolean({
      description:
        'With --apply: state that a backup of this database has been taken. The platform takes none and assumes ' +
        'none; without this flag the run asks, and a non-interactive run is refused',
      default: false,
    }),
    'template-choice': Flags.string({
      description:
        'With --apply: the sys_email_template row id the environment keeps for a listed template conflict ' +
        '(rows of one name and locale that differ). Repeat once per conflict; the other rows of that conflict are ' +
        'deleted only after the chosen body is promoted and verified',
      multiple: true,
    }),
    'metadata-choice': Flags.string({
      description:
        'With --apply: the sys_metadata row id the environment keeps for a listed customization conflict (rows ' +
        'of one type, name and package once the organization leaves the key). Repeat once per conflict. Under ' +
        'single the key keeps one environment row defining the chosen body, and its organization rows are deleted ' +
        'only after that row reads back; under a wall nothing is deleted, and a named organization row of a key it ' +
        'alone holds is promoted knowingly',
      multiple: true,
    }),
    'fate-supplement': Flags.string({
      description:
        'A JSON file of the fates the host declares for the objects it provides (OrganizationOwnershipSupplementSchema, ' +
        '@objectstack/spec/system), read in both modes and planned on the same terms as the platform inventory. ' +
        'A row naming a platform object, a duplicate row, or a row the schema refuses is refused',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateOrganizationOwnership);
    const timer = createTimer();
    const json = Boolean(flags.json);
    const refuse = async (payload: Record<string, unknown>, message: string): Promise<void> => {
      if (json) {
        // `apply_refused` / `plan_refused` mean nothing was executed; a report
        // lost after the ceremony executed has its own code (#23826).
        const error = payload.reason === 'boot-failed'
          ? 'boot_failed'
          : payload.reason === 'apply-failed'
            ? 'apply_failed'
            : payload.reason === 'report-write-failed'
              ? 'apply_report_unwritable'
              : flags.apply ? 'apply_refused' : 'plan_refused';
        await emitJson({ error, ...payload }, 1, { compact: true });
        return;
      }
      printError(message);
      this.exit(1);
    };

    let posture: string;
    try {
      posture = resolveTenancyPosture();
    } catch (error) {
      await refuse({ reason: 'posture-unresolved', detail: String((error as Error).message) }, (error as Error).message);
      return;
    }

    // The host's fate supplement, read before the database is opened in either
    // mode: a supplement that cannot be used refuses the whole run.
    let inventory: readonly InventoryEntry[] | undefined;
    if (flags['fate-supplement']) {
      try {
        inventory = await readHostFateSupplement(resolve(flags['fate-supplement']));
      } catch (error) {
        if (!(error instanceof HostFateSupplementRefusal)) throw error;
        await refuse(
          {
            reason: error.reason,
            file: error.file,
            ...(error.row !== undefined ? { row: error.row } : {}),
            ...(error.object !== undefined ? { object: error.object } : {}),
            detail: error.message,
          },
          `Refused: ${error.message}`,
        );
        return;
      }
    }

    // The occupancy gate, BEFORE either arm boots the stack — once it is up,
    // its own pooled connections are what the probe finds (#3917). Both arms
    // pass through here. The siblings' probe, and their fields inside this
    // command's own envelope, with one difference: the ceremony takes no
    // `--force` (no flag skips its reviewed plan or its backup either), so
    // `--apply` beside a holder is refused outright and the refusal names the
    // stop remedy alone. The plan writes no row or table and warns, as every
    // sibling's read-only arm does, saying what its connect can still change
    // on a SQLite file (`JOURNAL_MODE_SWITCH_NOTE`).
    const occupancy = await probeMigrationTarget(flags['database-url'], { dev: flags.dev === true });
    if (occupancy.status === 'busy' && flags.apply) {
      await refuse(
        {
          reason: 'database-busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_STOP_HINT,
        },
        `${describeOccupancy(occupancy)} ${OCCUPANCY_STOP_HINT}`,
      );
      return;
    }
    if (occupancy.status === 'busy' && !json) {
      printWarning(`${describeOccupancy(occupancy)} The plan below writes no row or table, but --apply will refuse until the database is free. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (flags.apply) {
      await this.runApply(flags, posture, refuse, inventory);
      return;
    }
    if (flags['template-choice']?.length) {
      await refuse({ reason: 'flag-without-apply', detail: '--template-choice is only meaningful with --apply' }, '--template-choice is only meaningful with --apply.');
      return;
    }
    if (flags['metadata-choice']?.length) {
      await refuse({ reason: 'flag-without-apply', detail: '--metadata-choice is only meaningful with --apply' }, '--metadata-choice is only meaningful with --apply.');
      return;
    }
    if (flags['plan-file']) {
      await refuse({ reason: 'flag-without-apply', detail: '--plan-file is only meaningful with --apply' }, '--plan-file is only meaningful with --apply.');
      return;
    }
    if (flags['backup-taken']) {
      await refuse({ reason: 'flag-without-apply', detail: '--backup-taken is only meaningful with --apply' }, '--backup-taken is only meaningful with --apply.');
      return;
    }

    if (!json) {
      printHeader('Migrate · organization-ownership (plan)');
      printStep('Booting data stack (read-only)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        deferSchemaDdl: true,
        serveFlags: { dev: flags.dev === true },
        // [#23816] The plan needs no held-back work listed, so a transport that
        // cannot defer DDL boots with no schema sync instead (still read-only).
        deferredDdlUnsupported: 'skip-schema-sync',
        readOnlyProbe: true,
      });
    } catch (error: unknown) {
      await refuse({ reason: 'boot-failed', detail: String((error as Error)?.message ?? error) }, String((error as Error)?.message ?? error));
      return;
    }

    let plan: OrganizationOwnershipPlan;
    try {
      const exec = resolvePlannedDriverExec(stack.driver);
      if (!stack.driver || !exec) {
        await refuse(
          { reason: 'driver-unsupported', detail: 'no SQL driver with a raw-SQL seam is active' },
          'No SQL driver with a raw-SQL seam is active, so no table can be enumerated. The ceremony supports SQLite, PostgreSQL and MySQL.',
        );
        return;
      }
      // The dialect, once, before the first statement: an unresolved one is
      // refused here, naming the driver, and never read as SQLite.
      const dialect = ceremonyDialectOf(stack.driver);
      const { normalizeRows } = await import('@objectstack/metadata-protocol');
      const client = (stack.driver.config as { client?: unknown } | undefined)?.client;
      const { siblings, homeOf } = await ceremonySiblings(stack);
      plan = await buildOrganizationOwnershipPlan({
        reader: {
          dialect,
          ...(typeof client === 'string' ? { client } : {}),
          query: async (sql, params) => normalizeRows(await exec(sql, params ? [...params] : [])),
        },
        posture,
        database: stack.dbLabel,
        siblings: siblings.map((d) => ({ name: d.name, database: d.database, reader: d.executor })),
        homeOf,
        ...(inventory ? { inventory } : {}),
      });
    } catch (error: unknown) {
      if (isExitSignal(error)) throw error;
      if (error instanceof OrganizationOwnershipPlanRefusal) {
        await refuse(
          { reason: error.reason, ...(error.table ? { table: error.table } : {}), detail: error.message },
          `Refused${error.table ? ` (${error.table})` : ''}: ${error.message}`,
        );
        return;
      }
      await refuse(
        { reason: 'plan-failed', detail: String((error as Error)?.message ?? error), ...errorCodeFields(error) },
        String((error as Error)?.message ?? error),
      );
      return;
    } finally {
      await stack.shutdown();
    }

    const target = resolve(flags.out ?? `organization-ownership-plan-${plan.generatedAt.replace(/[:.]/g, '-')}.json`);
    try {
      await writeFile(target, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      await refuse(
        { reason: 'plan-file-unwritable', file: target, detail: String((error as Error).message) },
        `The plan could not be written to ${target}: ${(error as Error).message}. An existing plan file is never overwritten.`,
      );
      return;
    }

    if (json) {
      await emitJson({ file: target, plan });
      return;
    }
    printInfo(`Database: ${chalk.white(plan.database)} · posture ${chalk.white(plan.posture)} · ` +
      `Default Organization ${plan.defaultOrganization
        ? chalk.white(plan.defaultOrganization.id)
        : chalk.yellow(plan.defaultOrganizationCreatedByApply ? 'none — --apply creates it' : 'none')}`);
    for (const sibling of plan.siblings ?? []) printInfo(describeTelemetryDatabase(sibling.database));
    console.log('');
    for (const table of plan.tables) {
      if (table.physical === 'absent') continue;
      const unattributable = table.unattributable.length;
      const where = table.database ? chalk.dim(` [${table.database}]`) : '';
      console.log(
        `  ${chalk.white(table.object.padEnd(34))}${where} ${table.fate.padEnd(16)} ` +
          `rows ${String(table.rows?.total ?? 0).padStart(7)}  null ${String(table.rows?.organizationNull ?? 0).padStart(6)}  ` +
          `${unattributable > 0 ? chalk.yellow(`unattributable ${unattributable}`) : ''}` +
          `${table.notNull.willReceive ? chalk.green(' NOT NULL') : ''}`,
      );
    }
    for (const table of plan.tables) {
      for (const conflict of table.templateConflicts ?? []) {
        printWarning(
          `Template conflict ${conflict.name} (${conflict.locale}): ` +
            conflict.candidates.map((c) => `${c.id} (organization ${c.organizationId ?? 'none'})`).join(', ') +
            ' differ. --apply blocks on it until one row is chosen with --template-choice ROW_ID.',
        );
      }
      for (const conflict of table.metadataConflicts ?? []) {
        printWarning(
          `Customization conflict ${conflict.type} ${conflict.name}${conflict.packageId ? ` (package ${conflict.packageId})` : ''}: ` +
            conflict.candidates.map((c) => `${c.id} (${c.organizationId ? `organization ${c.organizationId}` : 'environment'})`).join(', ') +
            ' hold one key. --apply blocks on it until one row is chosen with --metadata-choice ROW_ID.',
        );
      }
    }
    console.log('');
    // What the ceremony decides on the operator's behalf: said before the
    // summary, and again by --apply before its first write.
    for (const warning of plan.warnings) printWarning(warning);
    if (plan.warnings.length) console.log('');
    const { summary } = plan;
    printInfo(
      `${summary.present} table(s) planned, ${summary.absent} inventoried object(s) with no table here; ` +
        `${summary.notNull.willReceive.length} will receive NOT NULL, ${summary.notNull.willNotReceive.length} will not.`,
    );
    if (summary.unattributableRows > 0) {
      printWarning(`${summary.unattributableRows} row(s) whose owner cannot be derived are listed by id in the plan file.`);
    }
    // The occupancy probe answered `not_applicable` for a target that is no
    // SQLite file (PostgreSQL, MySQL, `:memory:`): no file header to switch.
    const sqliteFile = occupancy.status !== 'not_applicable';
    printSuccess(`Plan written to ${target} — no row or table in the database was changed.${sqliteFile ? ` ${JOURNAL_MODE_SWITCH_NOTE}` : ''}`);
    console.log(chalk.dim(`  ${timer.display()}`));
  }

  /** `--apply`: the backup precondition, the boot, the ceremony, the report file. */
  private async runApply(
    flags: {
      'database-url'?: string;
      out?: string;
      json?: boolean;
      dev?: boolean;
      'backup-taken'?: boolean;
      'template-choice'?: string[];
      'metadata-choice'?: string[];
      'plan-file'?: string;
    },
    posture: string,
    refuse: (payload: Record<string, unknown>, message: string) => Promise<void>,
    inventory: readonly InventoryEntry[] | undefined,
  ): Promise<void> {
    const json = Boolean(flags.json);
    const timer = createTimer();
    // The reviewed plan, read before the backup question and the boot.
    if (!flags['plan-file']) {
      await refuse(
        { reason: 'plan-file-required', detail: 'pass --plan-file with the plan file you reviewed' },
        'Refused: --apply executes only a plan you reviewed. Run the plan first (os migrate organization-ownership, with ' +
          'the same --fate-supplement), review the file it writes, then re-run --apply with --plan-file FILE.',
      );
      return;
    }
    let reviewedPlan: ReviewedPlan;
    const planFile = resolve(flags['plan-file']);
    try {
      reviewedPlan = reviewedPlanFromFile(planFile, await readFile(planFile, 'utf8'));
    } catch (error) {
      const refusal = error instanceof ReviewedPlanRefusal
        ? error
        : new ReviewedPlanRefusal('plan-file-unusable', `The plan file ${planFile} cannot be read: ${(error as Error).message}.`, { file: planFile });
      await refuse({ reason: refusal.reason, ...refusal.detail, detail: refusal.message }, `Refused: ${refusal.message}`);
      return;
    }
    if (!flags['backup-taken']) {
      const target = flags['database-url'] ?? process.env.OS_DATABASE_URL ?? 'the project database';
      const yes = !json && (await confirm(
        `${chalk.yellow('Backup')}: this run rewrites ownership, deletes mirror rows and drops columns in ${target}. ` +
          'Has a backup of it been taken? [y/N] ',
      ));
      if (!yes) {
        await refuse(
          { reason: 'backup-unacknowledged', detail: 'pass --backup-taken once a backup of this database exists' },
          'Refused: --apply needs a backup of this database first. Take one, then re-run with --backup-taken ' +
            '(or answer yes at the prompt). The platform takes no backup and assumes none.',
        );
        return;
      }
    }

    // [#23826] The report file, reserved before the boot under either boot
    // posture: an `--out` this run cannot write (an existing file, a missing
    // directory, no permission) is refused here, before anything executes. The
    // default name is stamped with this moment.
    const reportFile = resolve(flags.out ?? `organization-ownership-apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    let reservation: ReportFileReservation;
    try {
      reservation = await ReportFileReservation.take(reportFile);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      await refuse(
        { reason: 'report-file-unwritable', file: reportFile, ...errorCodeFields(error), detail: message },
        `Refused: the apply report cannot be written to ${reportFile}: ${message}. Nothing was executed. An existing ` +
          'file is never overwritten (a file a stopped run reserved says so in its own text); pass --out with a new path.',
      );
      return;
    }

    if (!json) {
      printHeader('Migrate · organization-ownership (apply)');
      printStep('Booting the deployment\'s served stack (schema DDL held back)…');
    }
    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        deferSchemaDdl: true,
        // [#23816] As the plan boots: no schema sync on a transport that cannot defer DDL.
        deferredDdlUnsupported: 'skip-schema-sync',
        composeHostStack: true,
        composeServedPlatform: true,
        composeAuthGatedSecurity: true,
        serveFlags: { dev: flags.dev === true },
      });
    } catch (error: unknown) {
      await reservation.release();
      await refuse({ reason: 'boot-failed', detail: String((error as Error)?.message ?? error) }, String((error as Error)?.message ?? error));
      return;
    }

    let report: OrganizationOwnershipApplyReport | undefined;
    try {
      const exec = resolvePlannedDriverExec(stack.driver);
      if (!stack.driver || !exec) {
        await refuse(
          { reason: 'driver-unsupported', detail: 'no SQL driver with a raw-SQL seam is active' },
          'No SQL driver with a raw-SQL seam is active. The ceremony supports SQLite, PostgreSQL and MySQL.',
        );
        return;
      }
      // The dialect, once, before the first statement: an unresolved one is
      // refused here, naming the driver, and never read as SQLite.
      const dialect = ceremonyDialectOf(stack.driver);
      const { normalizeRows } = await import('@objectstack/metadata-protocol');
      // [#23816] A boot that skipped schema sync measured no table absent, so
      // the ledger's presence is read from the catalog instead.
      const ledgerAbsent = stack.schemaSync === 'skipped'
        ? normalizeRows(await exec(columnListSql(dialect), ['sys_migration'])).length === 0
        : stack.tableAbsent('sys_migration');
      if (ledgerAbsent) {
        await refuse(
          { reason: 'ledger-absent', table: 'sys_migration', detail: 'the deployment ledger the ceremony checkpoints into does not exist' },
          'Refused: this database has no sys_migration table, where the ceremony records its checkpoint. Boot this ' +
            'release against it once (its schema sync creates the table), then re-run.',
        );
        return;
      }
      const { createSecurityCatalogReader } = await import('@objectstack/core');
      const { readDataMigrationFlag, recordDataMigrationRun } = await import('@objectstack/platform-objects/system');
      const kernel = stack.kernel as { getService(name: string): unknown };
      const engine = kernel.getService('objectql') as Parameters<typeof recordDataMigrationRun>[0] & { registry?: unknown };
      const protocol = kernel.getService('protocol') as {
        saveMetaItem?: (request: Record<string, unknown>) => Promise<unknown>;
        getMetaItems?: (request: { type: string }) => Promise<{ items?: unknown[] } | unknown[]>;
        getMetaItemsForExecution?: (request: { type: string }) => Promise<{ items?: unknown[] }>;
        getMetaItem?: (request: { type: string; name: string; packageId?: string }) => Promise<unknown>;
      } | undefined;
      const catalog = createSecurityCatalogReader({
        registry: engine.registry as never,
        metadata: kernel.getService('metadata') as never,
      });
      const client = (stack.driver.config as { client?: unknown } | undefined)?.client;
      const executor: ApplyExecutor = {
        dialect,
        ...(typeof client === 'string' ? { client } : {}),
        query: async (sql, params) => normalizeRows(await exec(sql, params ? [...params] : [])),
        execute: async (sql, params) => {
          await exec(sql, params ? [...params] : []);
        },
      };
      const ledger: CeremonyLedgerPort = {
        read: async () => checkpointFromDetails((await readDataMigrationFlag(engine, ORGANIZATION_OWNERSHIP_MIGRATION_ID))?.details),
        write: async (checkpoint, verdict) => {
          await recordDataMigrationRun(engine, {
            migrationId: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
            passed: verdict.complete && verdict.blocking === 0,
            applied: verdict.complete,
            blocking: verdict.blocking,
            advisory: verdict.advisory,
            details: { checkpoint },
          });
        },
      };
      const liveStack = stack;
      const { siblings, homeOf } = await ceremonySiblings(stack);
      if (!json) for (const sibling of siblings) printInfo(describeTelemetryDatabase(sibling.database));
      report = await applyOrganizationOwnership({
        executor,
        siblings,
        homeOf,
        // Whether this boot composed the security plugin: a shipped set or a
        // built-in position it alone declares is reported with that cause.
        securityPlugin: stack.composition.securityPlugin,
        ...(flags['template-choice']?.length ? { templateChoices: flags['template-choice'] } : {}),
        ...(flags['metadata-choice']?.length ? { metadataChoices: flags['metadata-choice'] } : {}),
        posture,
        database: stack.dbLabel,
        catalog,
        door: {
          save: async (type, name, body, target) => {
            if (typeof protocol?.saveMetaItem !== 'function') {
              throw new Error('no metadata protocol is composed on this stack');
            }
            await protocol.saveMetaItem({
              type,
              name,
              item: body,
              actor: CEREMONY_ACTOR,
              ...(target ? { packageId: target.packageId } : {}),
            });
          },
        },
        lock: {
          // The save door's own verdict: the item read reports it as `editable`.
          verdict: async (type, name, packageId) => {
            if (typeof protocol?.getMetaItem !== 'function') {
              throw new Error('no metadata protocol is composed on this stack');
            }
            const read = (await protocol.getMetaItem({ type, name, ...(packageId ? { packageId } : {}) })) as
              | { editable?: unknown; lock?: unknown; lockReason?: unknown }
              | null
              | undefined;
            return {
              editable: read?.editable !== false,
              ...(typeof read?.lock === 'string' ? { lock: read.lock } : {}),
              ...(typeof read?.lockReason === 'string' ? { lockReason: read.lockReason } : {}),
            };
          },
        },
        views: {
          // The env-wide view list, exactly as the anonymous form doors read it.
          list: async () => {
            if (typeof protocol?.getMetaItems !== 'function') {
              throw new Error('no metadata protocol is composed on this stack');
            }
            const result = await protocol.getMetaItems({ type: 'view' });
            const items = Array.isArray(result) ? result : (result?.items ?? []);
            return items.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
          },
        },
        templates: {
          // The environment's own row first (it is what a promotion must never
          // overwrite), then what the registry serves for the bundle member.
          find: async (name, locale) => {
            // Once column-drops has run, every row is the environment's (C7b).
            const scoped = (await executor.query(columnListSql(executor.dialect), ['sys_metadata']))
              .some((row) => columnNameOf(row) === 'organization_id');
            const stored = await executor.query(
              `SELECT metadata FROM sys_metadata WHERE type = ? AND name = ? AND state = ?${scoped ? ' AND organization_id IS NULL' : ''} ` +
                'AND (bundle_member = ? OR (bundle_member IS NULL AND ? = ?))',
              ['email_template', name, 'active', locale, locale, 'en-US'],
            );
            if (stored.length > 0) {
              const raw = stored[0]!.metadata;
              const definition = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
              return { definition, environment: true };
            }
            if (typeof protocol?.getMetaItemsForExecution !== 'function') return undefined;
            const listed = await protocol.getMetaItemsForExecution({ type: 'email_template' });
            const served = (listed?.items ?? []).find((item) => {
              const i = item as Record<string, unknown> | null;
              return !!i && i.name === name && (typeof i.locale === 'string' && i.locale ? i.locale : 'en-US') === locale;
            }) as Record<string, unknown> | undefined;
            return served ? { definition: served, environment: false } : undefined;
          },
        },
        columnDrops: {
          drop: async (columns) => {
            // The tables this booted composition declares, keyed as the driver
            // keys its managed set. A table outside it can never be proposed,
            // whatever a release declares: `not-declared`, and `not-proposed`
            // only for a declared one. A rotation shard is judged by its base.
            const { StorageNameMapping } = await import('@objectstack/spec/system');
            const { rotationBaseOf } = await import('../../utils/unmanaged-tables.js');
            const { buildIndexName } = await import('@objectstack/driver-sql');
            const { dropColumnsThroughDrift } = await import('../../utils/organization-ownership-column-drops.js');
            const declared = new Set(
              (liveStack.allObjects() as Array<{ name?: unknown } | null>)
                .map((o) => o?.name)
                .filter((name): name is string => typeof name === 'string' && name.length > 0)
                .map((name) => StorageNameMapping.resolveTableName({ name })),
            );
            return dropColumnsThroughDrift(
              {
                drift: liveStack,
                isDeclared: (table) => declared.has(rotationBaseOf(table) ?? table),
                indexName: (table, indexColumns, unique) => buildIndexName(table, [...indexColumns], unique),
              },
              columns,
            );
          },
        },
        ledger,
        defaultOrganization: {
          // [ADR-0131 D3] The boot invariant's own producer, so the ceremony
          // creates exactly the row a single-posture boot creates. Asked only
          // when the reviewed plan said --apply creates it (no organization at all).
          create: async () => {
            const organizations = engine as unknown as { getObject?: (name: string) => unknown };
            if (typeof organizations.getObject === 'function' && !organizations.getObject('sys_organization')) {
              throw new Error(
                'this run booted without the auth family that declares sys_organization (no auth secret, or the auth ' +
                  'tier off); run the ceremony the way the deployment is served — with its OS_AUTH_SECRET, or with --dev ' +
                  'for a development database',
              );
            }
            const { ensureDefaultOrganizationExists } = await import('@objectstack/plugin-auth');
            const result = await ensureDefaultOrganizationExists(engine);
            if (!result.organizationId) {
              throw new Error(
                `the database holds ${result.ambiguous?.organizationCount ?? 'several'} organizations and none has ` +
                  "slug 'default', so none is the Default Organization",
              );
            }
            return { id: result.organizationId };
          },
        },
        reviewedPlan,
        ...(inventory ? { inventory } : {}),
        ...(json ? {} : { onProgress: (message: string) => printStep(message), onWarning: (message: string) => printWarning(message) }),
      });
    } catch (error: unknown) {
      if (isExitSignal(error)) throw error;
      if (error instanceof ReviewedPlanRefusal) {
        await refuse({ reason: error.reason, ...error.detail, detail: error.message }, `Refused: ${error.message}`);
        return;
      }
      if (error instanceof MetadataChoiceRefusal) {
        await refuse({ reason: 'metadata-choice-refused', detail: error.message }, `Refused: ${error.message}`);
        return;
      }
      if (error instanceof TemplateChoiceRefusal) {
        await refuse({ reason: 'template-choice-refused', detail: error.message }, `Refused: ${error.message}`);
        return;
      }
      if (error instanceof OrganizationOwnershipPlanRefusal) {
        await refuse(
          { reason: error.reason, ...(error.table ? { table: error.table } : {}), detail: error.message },
          `Refused${error.table ? ` (${error.table})` : ''}: ${error.message}`,
        );
        return;
      }
      await refuse(
        { reason: 'apply-failed', detail: String((error as Error)?.message ?? error), ...errorCodeFields(error) },
        `${String((error as Error)?.message ?? error)} — every step finished before this one is checkpointed; ` +
          're-run --apply to resume.',
      );
      return;
    } finally {
      // No report (a refusal, a failed step): the reserved file goes with the run.
      if (!report) await reservation.release();
      await stack.shutdown();
    }

    try {
      await reservation.keep(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      await reservation.release();
      // The ceremony executed: never the pre-write refusal's code (#23826).
      const message = String((error as Error)?.message ?? error);
      await refuse(
        {
          reason: 'report-write-failed',
          file: reportFile,
          // An OS error keeps its own code; a lost reservation says what became of the file.
          ...(error instanceof ReportFileLost ? { standing: error.standing } : errorCodeFields(error)),
          detail: message,
          executed: true,
          report,
        },
        `The ceremony ran (${report.complete ? 'every step finished' : 'it stopped at a blocker'}), and its report could ` +
          `not be written to ${reportFile}: ${message}. Every finished step is checkpointed in the deployment ledger; ` +
          're-run --apply with a new --out to write the report (it resumes, and finished steps are not repeated).',
      );
      return;
    }
    const target = reportFile;
    const verdictCode = report.complete && report.blocking === 0 ? 0 : 1;
    if (json) {
      await emitJson({ file: target, report }, verdictCode);
      return;
    }
    console.log('');
    for (const step of report.steps) {
      const mark = step.status === 'done' || step.status === 'checkpointed' ? chalk.green('✓') : step.status === 'blocked' ? chalk.red('✗') : chalk.dim('·');
      console.log(`  ${mark} ${step.step.padEnd(22)} ${step.status.padEnd(12)} ${chalk.dim(JSON.stringify(step.summary))}`);
      for (const blocker of step.blockers) console.log(`      ${chalk.red(blocker)}`);
      for (const note of step.notes) console.log(`      ${chalk.dim(note)}`);
    }
    console.log('');
    for (const table of report.tables) {
      if (!table.before) continue;
      if (table.attributed + table.deleted + table.movedOut + table.movedIn + table.unattributable.length + table.remaining + table.departures.length === 0 && !table.columnDropped) continue;
      console.log(
        `  ${chalk.white(table.object.padEnd(34))} ${table.fate.padEnd(16)} attributed ${String(table.attributed).padStart(6)}  ` +
          `deleted ${String(table.deleted).padStart(6)}  ` +
          `${table.movedOut ? `moved out ${table.movedOut}  ` : ''}${table.movedIn ? `moved in ${table.movedIn}  ` : ''}` +
          `${table.columnDropped ? chalk.green('column dropped  ') : ''}` +
          `${table.unattributable.length ? chalk.yellow(`reported ${table.unattributable.length}  `) : ''}` +
          `${table.remaining ? chalk.red(`remaining ${table.remaining}`) : ''}`,
      );
      for (const departure of table.departures) {
        console.log(chalk.yellow(
          departure.advisory
            ? `      ${departure.rows} row(s) advisory, not held against certification — ${departure.label}: ${departure.advisory}`
            : `      ${departure.rows} row(s) still to leave by a step not yet run — ${departure.label}`,
        ));
      }
      for (const conflict of table.templateConflicts ?? []) {
        console.log(chalk.yellow(
          `      template conflict ${conflict.name} (${conflict.locale}): ` +
            conflict.candidates.map((c) => `${c.id} (organization ${c.organizationId ?? 'none'})`).join(', ') +
            ' — choose one with --template-choice ROW_ID',
        ));
      }
    }
    console.log('');
    // `advisory` counts two populations; each is said in its own terms.
    const unattributable = report.tables.reduce((n, t) => n + t.unattributable.length, 0);
    const held = report.tables.reduce((n, t) => n + t.departures.reduce((m, d) => m + (d.advisory ? d.rows : 0), 0), 0);
    if (unattributable > 0) {
      printWarning(`${unattributable} row(s) whose owner cannot be derived stay NULL; they are listed by id in the report file.`);
    }
    if (held > 0) {
      printWarning(
        `${held} row(s) of a departure this release cannot perform stay NULL and are reported as advisory, not as ` +
          'discrepancies; each is named above with what removes it.',
      );
    }
    if (verdictCode === 0) {
      printSuccess(`The ceremony is complete; recorded as ${ORGANIZATION_OWNERSHIP_MIGRATION_ID}. Report: ${target}`);
    } else {
      printError(
        report.complete
          ? `The post-check found ${report.blocking} discrepancy(ies). Report: ${target}`
          : `The ceremony stopped at a blocker (above). Resolve it and re-run --apply; finished steps are not repeated. Report: ${target}`,
      );
    }
    console.log(chalk.dim(`  ${timer.display()}`));
    if (verdictCode !== 0) this.exit(1);
  }
}
