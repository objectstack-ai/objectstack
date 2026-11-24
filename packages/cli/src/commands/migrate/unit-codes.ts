// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
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
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { refuseUndeclaredObjects } from '../../utils/migrate-object-scope.js';
// Type-only, so the heavy engine package is still loaded lazily below.
import type { UnitCodeBackfillEngine, UnitCodeBackfillReport, UnitCodeMapping } from '@objectstack/objectql';

/**
 * The `--map-file` mapping, read and judged before the occupancy probe, the
 * `--apply` prompt and the boot: a file that cannot be read, or a mapping the
 * engine would refuse as malformed, fails the same way on every database, and
 * an `--apply` boot may create tables and columns. The judge is the engine's
 * own (`unitCodeMappingOf`, `VALIDATION_ERROR` / 400 on `mapping`), so the
 * answer is the one the walk would give. Whether each target is a unit code is
 * judged after the boot: an organization's own codes are rows.
 */
async function readMapping(file: string | undefined): Promise<UnitCodeMapping | undefined> {
  if (file === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error: any) {
    throw Object.assign(
      new Error(`[unit-code-backfill] the mapping file '${file}' could not be read as JSON: ${error?.message ?? String(error)}. ` +
        'Refused before the database was opened or any row was read.'),
      { code: 'VALIDATION_ERROR', status: 400, httpStatus: 400, field: 'mapping' },
    );
  }
  const { unitCodeMappingOf } = await import('@objectstack/objectql');
  return unitCodeMappingOf(parsed);
}

/** The rows a run leaves holding no unit code the field admits, by kind; the report's ⚠ lines say what becomes of each. */
function rowsLeftOf(report: UnitCodeBackfillReport): string {
  const kinds = [
    report.blankBesideQuantity > 0 ? `${report.blankBesideQuantity} blank unit(s) beside a quantity` : undefined,
    report.skippedRetired > 0 ? `${report.skippedRetired} row(s) on a retired unit` : undefined,
    report.skippedOtherDimension > 0 ? `${report.skippedOtherDimension} row(s) on a unit code of another dimension` : undefined,
  ].filter((kind): kind is string => kind !== undefined);
  return kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0] ?? 'rows';
}

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
 * `os migrate unit-codes` — the explicit conversion of the free text a unit
 * code field stored before it was declared one (ADR-0158 U7 R1; Open item 12,
 * the backfill half; Open item 8, a standalone unit field).
 *
 * The command is the shell; the walk, its refusals and its report are
 * `@objectstack/objectql`'s `backfillUnitCodes`, the split
 * `os migrate record-currency-codes` has with its engine function. `--field`
 * names the unit code field: the `text` field a quantity's `unitField` names,
 * or one declaring `unitConfig: { unitMode: 'code' }`. The mapping is the
 * operator's `--map-file` (a JSON object of stored text, exactly as written, to
 * a unit code; `""` is a blank unit beside a quantity), ⛔ never derived.
 *
 * Dry run by default: it lists every distinct stored value with its row count
 * and what the mapping does with it, and writes nothing, so a first run with no
 * `--map-file` is how an operator sees the spellings to map. `--apply` refuses
 * before any write (exit 1) while a value has no mapping entry, naming each one,
 * so one run converts the whole field; idempotent, so re-running and reading a
 * clean report is the verification. Organizations are scoped as on
 * `record-currency-codes`: `--org <id>`, or `--all-organizations` explicitly;
 * an unscoped run over several organizations' rows is refused (exit 1) with
 * each one's counts. No `sys_migration` flag is recorded.
 */
export default class MigrateUnitCodes extends Command {
  static override description =
    'Rewrite the free text stored in a unit code field (kg, 公斤, …) into unit codes, from a mapping you give — the rows ' +
    'stored before the field was declared a unit code field. Nothing is derived. Dry run by default (lists every stored ' +
    'value); --apply writes, and is refused while a value has no mapping.';

  static override examples = [
    '$ os migrate unit-codes --object material --field uom',
    '$ os migrate unit-codes --object material --field uom --map-file units.json --org org_emea --apply',
    '$ os migrate unit-codes --object material --field uom --map-file units.json --all-organizations --apply',
    '$ os migrate unit-codes --object material --field uom --map-file units.json --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({ description: 'The object whose rows are converted', required: true }),
    field: Flags.string({
      description: 'The unit code field: a text field a quantity\'s unitConfig.unitField names, or one declaring unitMode code',
      required: true,
    }),
    'map-file': Flags.string({
      description:
        'A JSON file mapping each stored text, exactly as written, to its unit code: { "kg": "KGM", "公斤": "KGM" }. ' +
        'The entry "" gives a blank unit beside a quantity its code. Omit it for a dry run listing every stored value',
    }),
    org: Flags.string({
      description: 'Convert only this organization\'s rows (its id). Required when the rows belong to more than one organization',
      exclusive: ['all-organizations'],
    }),
    'all-organizations': Flags.boolean({
      description: 'Convert the rows of every organization with the one mapping, explicitly',
      default: false,
      exclusive: ['org'],
    }),
    apply: Flags.boolean({ description: 'Write the codes (default is a read-only dry run)', default: false }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    'max-records': Flags.integer({ description: 'Safety bound on rows read — exceeding it truncates the walk' }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateUnitCodes);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · unit-codes');

    // The mapping first: before the occupancy probe, the `--apply` prompt and the boot.
    let mapping: UnitCodeMapping | undefined;
    try {
      mapping = await readMapping(flags['map-file']);
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(error.message);
      this.exit(1);
      return;
    }

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
        ? `--force: ${describeOccupancy(occupancy)} Converting anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table, but its counts may shift while that process is running. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode rewrites record data. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const scope = flags.org !== undefined
        ? ` in organization ${flags.org}`
        : flags['all-organizations'] ? ' in EVERY organization' : '';
      const ok = await confirm(
        chalk.bold(`\nRewrite the stored text of ${flags.object}.${flags.field} into unit codes from the mapping${scope}, on this database? [y/N] `),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');

    let stack;
    try {
      // The dry run boots read-only; `--apply` keeps the plain boot, because the tables must exist before it writes.
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

    // On a SQLite file the boot's connect may switch the journal mode (its header, no row).
    const journalNote = describeDriverSqliteFile(stack.driver?.config) !== undefined ? ` ${JOURNAL_MODE_SWITCH_NOTE}` : '';
    try {
      const engine: UnitCodeBackfillEngine & { getConfigs?(): Record<string, unknown> } = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read the object declaration.');
      }
      const loadedObjects: string[] = typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      refuseUndeclaredObjects([flags.object], loadedObjects);

      const { backfillUnitCodes, formatUnitCodeBackfillReport, unitCodeBackfillComplete } = await import('@objectstack/objectql');
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await backfillUnitCodes(engine, logger, {
        object: flags.object,
        field: flags.field,
        ...(mapping !== undefined ? { mapping } : {}),
        apply,
        organizationId: flags.org,
        ...(flags['all-organizations'] ? { allOrganizations: true } : {}),
        maxRecords: flags['max-records'],
      });

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (report.failures.length > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(`${formatUnitCodeBackfillReport(report).join('\n')}${!report.applied && report.mapped > 0 ? journalNote : ''}`);
      console.log('');
      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be written — re-run to finish them.`);
      } else if (report.truncated) {
        printWarning(`Walk incomplete — ${report.scannedRecords} row(s) examined. Re-run without --max-records (or with a higher one) to finish.`);
      } else if (report.unmatched > 0) {
        printInfo(`${report.unmatched} row(s) hold a value with no mapping entry: add each to --map-file, then re-run with --apply.`);
      } else if (!apply && report.mapped > 0) {
        printInfo(`Dry run only — ${report.mapped} row(s) would be rewritten. Re-run with --apply.`);
      } else if (!unitCodeBackfillComplete(report)) {
        // The engine's own rule for its ✓ line: a run that leaves a row holding no unit code the field admits closes
        // with what is left, never with a success line.
        const wrote = apply && report.written > 0 ? `Wrote unit codes on ${report.written} row(s), but not complete` : 'Not complete';
        printWarning(`${wrote} — ${report.object}.${report.field} still has ${rowsLeftOf(report)}, holding no unit code the field ` +
          'admits (see the ⚠ lines above).');
      } else if (apply && report.written > 0) {
        printSuccess(`Wrote unit codes on ${report.written} row(s). Re-run any time — a row holding a unit code is never rewritten.`);
      } else {
        printSuccess(`Nothing to convert — every ${report.object}.${report.field} value is a unit code the field admits.`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures.length > 0) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      // The refusals of an unscoped multi-organization run and of unmatched values carry their counts.
      const organizations = Array.isArray(error?.organizations) ? error.organizations : undefined;
      const unmatched = Array.isArray(error?.unmatched) ? error.unmatched : undefined;
      if (flags.json) {
        await emitJson(
          { error: error.message, ...errorCodeFields(error), ...(organizations ? { organizations } : {}), ...(unmatched ? { unmatched } : {}) },
          0,
          { compact: true },
        );
        this.exit(1);
      }
      printError(`${error.message || String(error)}${journalNote}`);
      for (const org of organizations ?? []) {
        console.log(`  organization ${org.organizationId ?? '(none)'}: ${org.mapped} to rewrite, ${org.unmatched} unmatched, of ${org.scannedRecords} scanned`);
      }
      if (organizations) printInfo('Re-run with --org <id> for each organization, or with --all-organizations to use this one mapping for all of them.');
      if (unmatched) printInfo('Add each value to --map-file with its unit code, or correct those rows first, then re-run with --apply.');
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
