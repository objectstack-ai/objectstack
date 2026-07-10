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
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { bootstrapPlatformAdmin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

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

function safeGetService(kernel: any, name: string): any {
  try {
    return kernel?.getService?.(name);
  } catch {
    return undefined;
  }
}

/**
 * `os meta resync` — reconcile materialized metadata to the compiled `dist`
 * without a `--fresh` wipe (#2705).
 *
 * The default permission sets (admin_full_access / member_default /
 * viewer_readonly …) are seeded INSERT-ONCE at boot: an existing row is never
 * clobbered, so an edit to a default set's source is served with its OLD value
 * until the DB is wiped — a silent dev-loop trap (a permission-gated action
 * "mysteriously" keeps its old behavior). Every OTHER metadata seed (declared
 * permission sets, positions, built-in roles, capabilities) already upserts on
 * boot; this command closes the one remaining gap by force-reconciling the
 * default permission-set rows to the shipped declaration.
 *
 * Business data is never touched — only `sys_permission_set` definition rows.
 * A row an admin has taken over in Setup (`managed_by:'user'`) or a package
 * owns (`'package'`) is an intentional override and is left alone.
 */
export default class MetaResync extends Command {
  static override description =
    'Reconcile materialized metadata (default permission sets) to the compiled dist without a --fresh wipe (#2705)';

  static override examples = [
    '$ os meta resync',
    '$ os meta resync --yes',
    '$ os meta resync --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to reconcile (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt', default: false }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to mutate)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MetaResync);
    const timer = createTimer();
    let exitCode = 0;

    if (!flags.json) {
      printHeader('Meta · resync');
      printStep('Booting runtime stack…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({ databaseUrl: flags['database-url'] });
    } catch (error: any) {
      if (flags.json) console.log(JSON.stringify({ error: error.message }));
      else printError(error.message || String(error));
      process.exit(1);
    }

    try {
      const ql = safeGetService(stack.kernel, 'objectql');
      // Prefer the SecurityPlugin's resolved set when a full stack is booted (it
      // picks up an app's `defaultPermissionSets` override); fall back to the
      // platform defaults, which is what the standalone stack this command boots
      // exposes. Either way these are the sets `bootstrapPlatformAdmin` seeds.
      const svcSets = safeGetService(stack.kernel, 'security.bootstrapPermissionSets');
      const sets: any[] = Array.isArray(svcSets) && svcSets.length > 0 ? svcSets : securityDefaultPermissionSets;

      if (!ql) {
        if (flags.json) {
          console.log(JSON.stringify({ error: 'objectql_unavailable' }));
          return;
        }
        printError('ObjectQL service is not available — cannot resync.');
        return;
      }
      if (!Array.isArray(sets) || sets.length === 0) {
        if (flags.json) {
          console.log(JSON.stringify({ resynced: 0, resyncSkipped: 0, inserted: 0, message: 'no_default_permission_sets' }));
          return;
        }
        printWarning('No default permission sets are available to resync.');
        return;
      }

      // Confirmation gate — resync overwrites the default permission-set
      // definitions from the compiled dist, so admin Setup edits to those sets
      // are replaced. Business data is never touched.
      if (!flags.yes) {
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) {
            console.log(JSON.stringify({ resynced: 0, resyncSkipped: 0, inserted: 0, message: 'confirmation_required', hint: 'pass --yes' }));
            return;
          }
          printWarning('Confirmation required. Re-run with --yes to resync.');
          return;
        }
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        printWarning('This overwrites the default permission-set definitions from the compiled dist.');
        console.log(chalk.dim('  Admin Setup edits to those sets are replaced. Business data is untouched.'));
        console.log(chalk.dim('  Sets an admin or a package has taken over (managed_by user/package) are left alone.'));
        const ok = await confirm(chalk.bold(`\nResync ${sets.length} default permission set(s) to ${stack.dbLabel}? [y/N] `));
        if (!ok) {
          printInfo('Aborted — no changes made.');
          return;
        }
      }

      const logger = flags.json
        ? undefined
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await bootstrapPlatformAdmin(ql, sets as any[], { resync: true, logger });
      const resynced = report.resynced ?? 0;
      const resyncSkipped = report.resyncSkipped ?? 0;
      // seeded = existing + newly inserted; existing (under resync) = resynced +
      // resyncSkipped, so the remainder is what this run freshly seeded.
      const inserted = Math.max(0, (report.seeded ?? 0) - resynced - resyncSkipped);

      if (flags.json) {
        console.log(JSON.stringify({ database: stack.dbLabel, resynced, resyncSkipped, inserted, duration: timer.elapsed() }, null, 2));
        return;
      }

      console.log('');
      if (resynced > 0 || inserted > 0) {
        printSuccess(`Reconciled ${resynced} default permission set(s) to dist${inserted > 0 ? `, seeded ${inserted} new` : ''}.`);
      } else {
        printInfo('Nothing reconciled.');
      }
      if (resyncSkipped > 0) {
        printWarning(`Left ${resyncSkipped} set(s) untouched (admin- or package-owned override).`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      exitCode = 1;
      if (flags.json) console.log(JSON.stringify({ error: error.message }));
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
      // A one-shot command must exit even when the booted app stack left
      // keep-alive handles open (schedulers/watchers registered on kernel:ready
      // that `runtime.stop()` cannot fully drain). Matches the process.exit
      // posture the other one-shot CLI commands use.
      process.exit(exitCode);
    }
  }
}
