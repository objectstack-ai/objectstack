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
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';

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
 * `os migrate value-shapes` — the ADR-0104 D1 non-media value-shape gate
 * (#3438), the sibling of `os migrate files-to-references` (#3617).
 *
 * Scans every stored reference (`lookup` / `master_detail` / `user` / `tree`)
 * and structured-JSON (`location` / `address` / `composite` / `repeater` /
 * `record` / `vector`) value against the contract the write path enforces, and
 * — on an `--apply` run finding zero violations — records the deployment-level
 * `adr-0104-value-shapes` flag. That flag, never the platform version, is what
 * turns strict enforcement of those classes on for THIS deployment.
 *
 * ## No backfill, deliberately
 *
 * Unlike its sibling this run rewrites nothing. The file migration converts
 * legacy values because the platform narrowed that storage form and therefore
 * owes the conversion; a malformed `location` is application data whose correct
 * value only its author knows. So this reports and prescribes, and the operator
 * fixes and re-runs until it is green.
 *
 * The happy consequence: with nothing to convert, `--apply`'s only write is the
 * flag row, so #3617's invariant is trivially preserved — a dry run changes
 * nothing, and whether a run changed this deployment's posture never depends on
 * what the run found.
 *
 * ## Why it is not gated on the file migration's flag
 *
 * That flag attests that file values were migrated and their ownership
 * reconciled. It says nothing about whether a `lookup` id or a `location`
 * payload is well formed. Reusing it here would be borrowing evidence for a
 * fact it does not cover — see the ADR's 2026-07-27 amendment.
 */
export default class MigrateValueShapes extends Command {
  static override description =
    'Scan stored reference and structured-JSON field values against the ADR-0104 value contract. ' +
    'Read-only; --apply records the deployment-level migration flag when the scan finds zero violations.';

  static override examples = [
    '$ os migrate value-shapes',
    '$ os migrate value-shapes --apply',
    '$ os migrate value-shapes --apply --yes --json',
    '$ os migrate value-shapes --object contact --object account',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to scan (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description:
        'Record the deployment migration flag when the scan passes (the scan itself is always read-only)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    object: Flags.string({
      description: 'Restrict to this object (repeatable; default: every object with a covered field)',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description:
        'Safety bound on records scanned per object — exceeding it truncates the scan and fails the gate',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateValueShapes);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · value-shapes');

    // No occupancy gate, unlike the file migration: that command rewrites rows,
    // so a second writer on the same SQLite file is a real hazard. This one only
    // reads. A concurrent writer can still move the counts under us, which the
    // scan reports honestly rather than pretending to have frozen the database.

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning(
          'Apply mode records this deployment\'s migration flag, which turns on strict value-shape ' +
            'enforcement. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRecord the value-shape migration flag on this database if the scan passes? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — nothing recorded.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (scan only)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins(),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: any = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot scan.');
      }
      // An empty scan is indistinguishable from a clean one, and this command's
      // verdict is what authorises strict enforcement — so refuse to run when no
      // app metadata is loaded (missing artifact / wrong directory) rather than
      // "verify" a database the scan never actually looked at.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the scan would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }

      const { scanValueShapes, valueShapeScanPassed, formatValueShapeScanReport } =
        await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route scan warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await scanValueShapes(engine, logger, {
        objects: flags.object,
        maxRecordsPerObject: flags['max-records'],
      });
      const passed = valueShapeScanPassed(report);

      // The flag write is the ONLY write this command makes, and only on an
      // apply run that passed. A failing apply run still records — deliberately:
      // it stamps `blocking` and clears `verified_at`, so a deployment whose data
      // has regressed closes its own gate rather than coasting on an old pass.
      let flag: unknown = null;
      if (apply) {
        const { recordDataMigrationRun } = await import('@objectstack/platform-objects/system');
        const { VALUE_SHAPES_MIGRATION_ID } = await import('@objectstack/spec/system');
        flag = await recordDataMigrationRun(engine, {
          migrationId: VALUE_SHAPES_MIGRATION_ID,
          passed,
          blocking: report.blocking,
          advisory: 0,
          applied: true,
          // Passed as an OBJECT — `recordDataMigrationRun` serialises it.
          details: {
            scannedObjects: report.scannedObjects.length,
            scannedRecords: report.scannedRecords,
            fields: report.findings.length,
            truncated: report.truncated,
            unreadableObjects: report.unreadableObjects,
          },
        });
        if (typeof engine.invalidateDataMigrationFlags === 'function') {
          engine.invalidateDataMigrationFlags();
        }
      }

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          apply,
          scan: report,
          gatePassed: passed,
          flag,
          duration: timer.elapsed(),
        });
        if (!passed) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(formatValueShapeScanReport(report).join('\n'));
      console.log('');

      if (passed && apply) {
        printSuccess(
          `Scan clean — recorded the deployment flag. Reference and structured-JSON value shapes ` +
            `are now enforced on this deployment (${timer.elapsed()}).`,
        );
      } else if (passed) {
        printSuccess(`Scan clean (${timer.elapsed()}). Re-run with --apply to record the flag and enforce.`);
      } else if (apply) {
        printError('Scan found violations — the flag records the failure and the gate stays closed.');
        printInfo('Fix the values named above and re-run; nothing is converted for you.');
        this.exit(1);
      } else {
        printError('Scan found violations — fix them, then re-run with --apply.');
        this.exit(1);
      }
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
