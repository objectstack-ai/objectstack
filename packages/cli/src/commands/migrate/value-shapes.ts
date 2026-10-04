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
  errorCodeFields,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { isNarrowedRun, narrowedFlagNote, refuseUndeclaredObjects } from '../../utils/migrate-object-scope.js';

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
 * [#21644] Only a run over every object records it. A run narrowed by
 * `--object` reads only the named objects, so it records no flag and says so;
 * and a name the deployment does not declare is refused (`OBJECT_NOT_FOUND`)
 * rather than scanned as nothing (`utils/migrate-object-scope.ts`).
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
    'Read-only; --apply records the deployment-level migration flag when a scan of every object finds zero violations.';

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
        'Record the deployment migration flag when the scan passes (the scan itself is always read-only). ' +
        'Only a run without --object records it',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    object: Flags.string({
      description:
        'Restrict to this object (repeatable; default: every object with a covered field). A narrowed run records ' +
        'no deployment flag, and a name the deployment does not declare is refused',
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
    const narrowed = isNarrowedRun(flags.object);

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
          narrowed
            ? 'Apply mode was asked for, but a run narrowed by --object records no deployment flag. ' +
                'Re-run with --yes to confirm, or run without --apply to preview.'
            : 'Apply mode records this deployment\'s migration flag, which turns on strict value-shape ' +
                'enforcement. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold(
          narrowed
            ? '\nScan the named object(s)? A run narrowed by --object records no deployment flag. [y/N] '
            : '\nRecord the value-shape migration flag on this database if the scan passes? [y/N] ',
        ),
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
      // [#21391] The scan boots READ-ONLY, the boot `os migrate plan`
      // takes: `deferSchemaDdl` holds schema DDL back on every SQL datasource,
      // and `readOnlyProbe` keeps a missing sqlite file from being created.
      // `--apply` keeps the plain boot: the tables must exist before it writes.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins(),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
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
      // [#21644] The scan keeps only the candidates it covers, so a name this
      // registry does not declare would be dropped without a word and the run
      // would read as clean. Refused here, against the set the scan draws from.
      refuseUndeclaredObjects(flags.object, loadedObjects);

      const { scanValueShapes, valueShapeScanPassed, formatValueShapeScanReport } =
        await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route scan warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21529] Not asked: the scan's read-only boot measured which tables
      // exist, and a table that does not exist stores no value to check. The
      // scan reads through this view, which answers such a table with its true
      // contents (no rows) without issuing the read. Read anyway, every covered
      // object on a fresh project was "unreadable", the gate closed, and the
      // scan exited 1 over data that does not exist. `--apply` booted plain, so
      // there every table exists and every read is real.
      // ⛔ Only a table the boot measured absent: any other refused read still
      // lands in `unreadableObjects` and still closes the gate.
      const notStored = new Set<string>();
      const scanView = {
        getObject: (name: string) => engine.getObject(name),
        ...(typeof engine.getConfigs === 'function' ? { getConfigs: () => engine.getConfigs() } : {}),
        find: (object: string, options: Record<string, unknown>) => {
          if (!apply && stack.tableAbsent(object)) {
            notStored.add(object);
            return Promise.resolve([]);
          }
          return engine.find(object, options);
        },
      };

      const report = await scanValueShapes(scanView, logger, {
        objects: flags.object,
        maxRecordsPerObject: flags['max-records'],
      });
      const passed = valueShapeScanPassed(report);
      const notStoredLine = notStored.size > 0
        ? `${notStored.size} scanned object(s) have no table in this database yet, so nothing is stored in ` +
            `them and they were not read: ${[...notStored].sort().join(', ')}.`
        : null;

      // The flag write is the ONLY write this command makes, and only on an
      // apply run that passed. A failing apply run still records — deliberately:
      // it stamps `blocking` and clears `verified_at`, so a deployment whose data
      // has regressed closes its own gate rather than coasting on an old pass.
      //
      // [#21644] ⛔ Never on a run narrowed by `--object`, passing or failing:
      // the flag attests every object's stored data, and this run read only the
      // named ones. A flag an earlier full-scope run recorded is left as it was.
      let flag: unknown = null;
      const narrowedNote = isNarrowedRun(flags.object)
        ? narrowedFlagNote('value-shapes', flags.object, apply)
        : null;
      if (apply && !narrowed) {
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
        if (notStoredLine) logger.info(notStoredLine);
        if (narrowedNote) logger.info(narrowedNote);
        await emitJson({
          database: stack.dbLabel,
          apply,
          // [#21644] Recorded in the document, so a narrowed run cannot be
          // mistaken for a full one (the shape `os migrate duplicates` keeps).
          filter: narrowed ? { objects: flags.object } : null,
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
      if (notStoredLine) printInfo(notStoredLine);

      if (narrowedNote) {
        if (passed) printSuccess(`Scan clean over the named object(s) (${timer.elapsed()}).`);
        else printError('Scan found violations — fix the values named above, then re-run.');
        printInfo(narrowedNote);
        if (!passed) this.exit(1);
      } else if (passed && apply) {
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
      // [#21391] `this.exit(1)` above is how a failed gate leaves, and it
      // throws oclif's ExitError: rethrown, never re-reported. Caught here, it
      // printed a second `--json` document (`{"error":"EEXIT: 1"}`) after the
      // scan's own — the shape `summary-nulls` and `files-to-references`
      // already guard against. A scan with unreadable objects fails the gate.
      // (A table the read-only boot measured absent is not one of them since
      // #21529: it is answered from that measurement, above, never read.)
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
