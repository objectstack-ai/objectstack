// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';

/**
 * `os migrate account-issuer` — the PLAN leg of the `sys_account.issuer`
 * retirement (#17440).
 *
 * ## Where this sits in the ceremony, and why it is not a fourth one
 *
 * ADR-0131 D10 fixes the shape: *plan → backup → apply → post-check, per-table,
 * idempotent + resumable, with a boot refusal behind it, never an automatic
 * boot step* — and says in the same breath that it *"reuses the ADR-0120 D4
 * migration ceremony where it exists (index and column changes) rather than
 * inventing a second one."*
 *
 * A column drop plus an index re-key is exactly what ADR-0120 D4 covers, and
 * this repository already ships all four legs of it for that class:
 *
 * | leg        | what already runs it                                                   |
 * |:-----------|:-----------------------------------------------------------------------|
 * | plan       | `os migrate plan` reports the drop as destructive drift. **This command adds the row-level pre-flight D4 requires beside it.** |
 * | backup     | the operator's act and the apply step's stated precondition — the platform never takes one for them |
 * | apply      | `os migrate apply --allow-destructive`, which now REFUSES this particular drop while the pre-flight is dirty |
 * | post-check | re-run this command; it reads zero and the drop is authorised |
 * | boot refusal | already shipped: `runArtifactBootMigrationGate` fails the boot on unapplied destructive drift, naming the command to run (`os serve` never auto-migrates) |
 *
 * ⇒ So this file is deliberately the smallest thing that was missing: the
 * read-only duplicate pre-flight ADR-0120 D4 asks for on an index change, for
 * a key that is being NARROWED. Inventing an `os migrate account-issuer
 * --apply` that dropped the column itself would be the second ceremony D10
 * forbids, and it would drop the column outside the drift reconciler that owns
 * every other column drop.
 *
 * ## Why read-only, with no repair arm at all
 *
 * Which row survives a collision is application knowledge — two different
 * people can be behind those two rows. So this inventories and prescribes, in
 * the `os migrate duplicates` tradition: *"never renumbers, deduplicates or
 * rewrites anything."*
 *
 * ## No `sys_migration` flag, deliberately
 *
 * `os migrate summary-nulls` documents the rule: a deployment flag nothing
 * reads is a fact nothing reads. The consumer of this verdict is the destructive
 * drift gate in `os migrate apply`, which re-runs the probe against the live
 * database at the moment it matters rather than trusting a row written earlier —
 * and a row that says "clean on Tuesday" authorises nothing on Thursday.
 */
export default class MigrateAccountIssuer extends Command {
  // The tracker id stays in this comment and out of the string below: a
  // command description reaches operators, who have no tracker to resolve
  // `#NNNN` against (`check:doc-authoring`). This command is #17440's.
  static override description =
    'Pre-flight the retirement of sys_account.issuer: report every (provider_id, account_id) ' +
    'key held by more than one row — the class that is legal under the retired (issuer, account_id) key ' +
    'and is ONE account under the key better-auth 1.7.3 restored. Read-only; exits non-zero when the ' +
    'drop must not proceed.';

  static override examples = [
    '$ os migrate account-issuer',
    '$ os migrate account-issuer --json',
    '$ os migrate account-issuer --max-records 1000000',
    '$ os migrate account-issuer --database-url postgres://…',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    'max-records': Flags.integer({
      description:
        'Row cap for the scan. Reaching it REFUSES rather than reporting a partial scan as clean.',
    }),
    json: Flags.boolean({ description: 'Output the report as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateAccountIssuer);
    const timer = createTimer();

    if (!flags.json) printHeader('Migrate · account-issuer pre-flight');

    let stack;
    try {
      // Read-only boot, the `os migrate duplicates` shape: `deferSchemaDdl`
      // holds back create-table/add-column DDL and suppresses the artifact
      // seed, `readOnlyProbe` refuses to bring a missing sqlite file into
      // existence. This command cannot change the install it describes.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: 'boot_failed', detail: error?.message ?? String(error) }, 1, { compact: true });
        return;
      }
      printError(error?.message ?? String(error));
      this.exit(1);
      return;
    }

    try {
      const { probeAccountIdentityCollisions, formatAccountIdentityPreflightReport } =
        await import('@objectstack/plugin-auth');

      const engine = (stack.kernel as { getService?: (n: string) => unknown }).getService?.call(
        stack.kernel,
        'objectql',
      );

      if (!flags.json) printStep('Scanning sys_account…');
      const report = await probeAccountIdentityCollisions(engine as never, {
        ...(flags['max-records'] != null ? { max: flags['max-records'] } : {}),
      });

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, ...report, duration: timer.elapsed() });
        if (!report.ok) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(formatAccountIdentityPreflightReport(report));
      console.log('');

      if (report.ok) {
        printSuccess(
          'Pre-flight clean. Take a backup, then run "os migrate apply --allow-destructive" to drop the column.',
        );
        console.log(chalk.dim(`  ${timer.display()}`));
        return;
      }

      printWarning(
        'REFUSED — sys_account.issuer must NOT be dropped on this database yet. Resolve the rows above ' +
          '(keep the row whose provider account is live, delete the rest so a fresh sign-in re-links), ' +
          'then re-run this command as the post-check.',
      );
      printWarning(
        'Nothing is merged or deleted for you: which row survives is application knowledge, and two ' +
          'different people can be behind one colliding key.',
      );
      this.exit(1);
    } catch (error: any) {
      // A refusal from the probe itself (unreadable table, truncated scan)
      // lands here and stays a refusal — it is never softened into a clean run.
      if (flags.json) {
        await emitJson({ error: error?.message ?? String(error), ...errorCodeFields(error) }, 1, { compact: true });
        return;
      }
      printError(error?.message ?? String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
