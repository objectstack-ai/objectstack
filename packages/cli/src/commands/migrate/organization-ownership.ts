// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { resolvePlannedDriverExec } from '../../utils/unmanaged-tables.js';
import {
  buildOrganizationOwnershipPlan,
  OrganizationOwnershipPlanRefusal,
  type OrganizationOwnershipPlan,
} from '../../utils/organization-ownership-plan.js';

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
 * The one thing it writes is the plan FILE, on the operator's disk, which the
 * ADR asks for: "the plan is written to a file the operator keeps". It never
 * overwrites one — a kept plan is evidence.
 *
 * ## Refusal
 *
 * A table the plan cannot enumerate (a dialect with no catalog statement, a
 * read that fails, a column its fate reads that the table lacks, a
 * platform table the inventory names no fate for, a database that is not an
 * ObjectStack one) refuses the whole plan, naming it — exit 1 and no file. ⛔
 * Never a table reported as empty.
 *
 * ## Why a subcommand, not a flag on `os migrate`
 *
 * Bare `os migrate` is the schema-drift plan (#2186) and stays exactly that.
 * Every data step in this family is a named subcommand whose bare run is the
 * read-only preview and whose `--apply` is the only writing mode; the ADR's
 * `--plan` names this mode. C7b adds `--apply` (fate order: attribution, the
 * verified id-to-name rewrite, mirror deletion, column drops) and the
 * post-check to THIS command; until then it has no writing mode at all.
 */
export default class MigrateOrganizationOwnership extends Command {
  static override description =
    'The v18 organization-ownership ceremony\'s read-only plan (ADR-0131 D10): per table, the fate, the row counts, the ' +
    'rows whose owner cannot be derived (by id), and which tables will receive NOT NULL. Writes the plan to a file; ' +
    'never changes a row or a column. Refuses — naming it — any table it cannot enumerate.';

  static override examples = [
    '$ os migrate organization-ownership',
    '$ os migrate organization-ownership --out plans/v18-ownership.json',
    '$ os migrate organization-ownership --database-url postgres://… --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to plan (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    out: Flags.string({
      description:
        'Where to write the plan (default: organization-ownership-plan-TIMESTAMP.json in the current directory). ' +
        'An existing file is never overwritten',
    }),
    json: Flags.boolean({ description: 'Also print the plan document on stdout' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateOrganizationOwnership);
    const timer = createTimer();
    const json = Boolean(flags.json);
    const refuse = async (payload: Record<string, unknown>, message: string): Promise<void> => {
      if (json) {
        await emitJson({ error: payload.reason === 'boot-failed' ? 'boot_failed' : 'plan_refused', ...payload }, 1, { compact: true });
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
      const { normalizeRows } = await import('@objectstack/metadata-protocol');
      const client = (stack.driver.config as { client?: unknown } | undefined)?.client;
      plan = await buildOrganizationOwnershipPlan({
        reader: {
          client: client === undefined ? undefined : String(client),
          query: async (sql, params) => normalizeRows(await exec(sql, params ? [...params] : [])),
        },
        posture,
        database: stack.dbLabel,
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
      `Default Organization ${plan.defaultOrganization ? chalk.white(plan.defaultOrganization.id) : chalk.yellow('none')}`);
    console.log('');
    for (const table of plan.tables) {
      if (table.physical === 'absent') continue;
      const unattributable = table.unattributable.length;
      console.log(
        `  ${chalk.white(table.object.padEnd(34))} ${table.fate.padEnd(16)} ` +
          `rows ${String(table.rows?.total ?? 0).padStart(7)}  null ${String(table.rows?.organizationNull ?? 0).padStart(6)}  ` +
          `${unattributable > 0 ? chalk.yellow(`unattributable ${unattributable}`) : ''}` +
          `${table.notNull.willReceive ? chalk.green(' NOT NULL') : ''}`,
      );
    }
    console.log('');
    const { summary } = plan;
    printInfo(
      `${summary.present} table(s) planned, ${summary.absent} inventoried object(s) with no table here; ` +
        `${summary.notNull.willReceive.length} will receive NOT NULL, ${summary.notNull.willNotReceive.length} will not.`,
    );
    if (summary.unattributableRows > 0) {
      printWarning(`${summary.unattributableRows} row(s) whose owner cannot be derived are listed by id in the plan file.`);
    }
    printSuccess(`Plan written to ${target} — nothing in the database was changed.`);
    console.log(chalk.dim(`  ${timer.display()}`));
  }
}
