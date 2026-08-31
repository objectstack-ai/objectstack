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
  isExitSignal,
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { StrandedOrphanInventoryEngine } from '@objectstack/service-storage';

/**
 * The `objectql` slot's contract, plus the two structural bits this command
 * uses: the inventory's read seam, and the registry probe. `getObject` is
 * ObjectQL's own metadata surface rather than part of `IDataEngine`, so it is
 * declared here — the lookup keeps its contract type instead of being erased
 * to `any` (#4251).
 */
type OrphanInventoryEngine = IDataEngine &
  StrandedOrphanInventoryEngine & {
    getObject?(name: string): unknown;
  };

/**
 * `os storage orphans` — the read-only stranded-orphan inventory (#10950).
 *
 * Sizes the `sys_file` backlog that the forward-only tombstone fixes (#10171
 * update verb, #10240 delete verb) could not reach: attachments-scope files
 * left `status='committed'` with `deleted_at` NULL and no remaining
 * `sys_attachment` join row. Those match neither lifecycle policy on
 * `sys_file`, so the platform sweep never nominates them and their bytes are
 * never reclaimed.
 *
 * ⛔ REPORT-ONLY BY CONSTRUCTION. There is no `--apply`, no `--fix`, and no
 * write path in this command or in the pass it invokes — deliberately, not as
 * an unimplemented default. Authorising the destructive backfill is a separate
 * decision that this inventory's numbers exist to inform (#10950 step 2), and
 * a tombstone written here would start a 30-day clock ending in an
 * irreversible byte delete.
 *
 * ADR-0057 §3.3 forbids a bespoke SWEEPER — "detection and scheduling stay
 * inside the single platform sweep". This command schedules nothing and
 * registers nothing; it is an operator-invoked reconciliation read, the same
 * shape as `os migrate files-to-references`'s verify pass.
 */
export default class StorageOrphans extends Command {
  static override description =
    'Report-only inventory of stranded sys_file orphans — attachments-scope files that no ' +
    'sys_attachment join row and no ref_* owner holds, and that no lifecycle policy can ever ' +
    'nominate for reaping. Writes nothing, tombstones nothing, deletes nothing.';

  static override examples = [
    '$ os storage orphans',
    '$ os storage orphans --json',
    '$ os storage orphans --max-candidates 50000',
    '$ os storage orphans --samples 0',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    'max-candidates': Flags.integer({
      description:
        'Safety bound on sys_file rows read. Exceeding it truncates the walk and makes every ' +
        'count a LOWER BOUND — omit it to size the population.',
    }),
    samples: Flags.integer({
      description: 'Example stranded rows to list (default 20; 0 for counts only)',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(StorageOrphans);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('Storage · stranded orphan inventory');
    }

    // No occupancy gate and no confirmation prompt, unlike the migration
    // commands: this pass issues no write, so a concurrent writer can make the
    // counts drift but can never be corrupted by us. The drift is warned about
    // below instead of refused.
    if (!flags.json) {
      printStep('Booting data stack (read-only)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ storage: true }),
      });
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      // Annotated rather than `getService<…>(…)`: `BootedSchemaStack.kernel` is
      // itself untyped, so a type ARGUMENT on that call is a TS2347 error. The
      // annotation types the binding just as tightly, which is what #4251 is
      // after — the erasure it sweeps is an `any`-typed local, not this.
      const engine: OrphanInventoryEngine = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || !engine.getObject('sys_file')) {
        throw new Error(
          'sys_file is not registered on this stack — the storage service objects are required. ' +
            'Ensure @objectstack/service-storage is installed, then re-run.',
        );
      }
      // Unlike `os migrate files-to-references`, this pass reads only system
      // objects (`sys_file`, `sys_attachment`), so a project with no app
      // metadata loaded is not a reason to refuse: the scan's subject is
      // present either way.
      if (!engine.getObject('sys_attachment')) {
        throw new Error(
          'sys_attachment is not registered on this stack, so "does anything still reference this ' +
            'file?" cannot be answered — and an unanswerable reference check must not be reported ' +
            'as zero references. Ensure the storage service objects are loaded, then re-run.',
        );
      }

      const { inventoryStrandedFileOrphans, formatStrandedOrphanInventory } = await import(
        '@objectstack/service-storage'
      );

      const report = await inventoryStrandedFileOrphans(engine, {
        maxCandidates: flags['max-candidates'],
        sampleLimit: flags.samples,
      });

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          readOnly: true,
          ...report,
          duration: timer.elapsed(),
        });
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(formatStrandedOrphanInventory(report));
      console.log('');
      if (report.truncated) {
        printWarning(
          'Truncated walk — the counts above are lower bounds, not the population size.',
        );
      } else if (report.stranded === 0) {
        printSuccess('Nothing stranded on this deployment.');
      } else {
        printInfo(
          'Reporting only. Reclaiming these bytes is a separate, deliberately deferred decision — ' +
            'see issue #10950.',
        );
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
