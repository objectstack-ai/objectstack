// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { STACK_TIER_PRESETS } from '@objectstack/core';
import { printHeader, printSuccess, printWarning, printError, printInfo, emitJson, errorCodeFields, isExitSignal } from '../../../utils/format.js';
import { StorageNameMapping } from '@objectstack/spec/system';
import { bootSchemaStack, type PendingSchemaWork } from '../../../utils/schema-migrate.js';
import { describeUnloadableHostConfig } from '../../../utils/schema-migration-plugins.js';
import { absentTableReads } from '../../../utils/absent-table-reads.js';
import {
  collectStoredPackageReferences,
  type ReferenceCandidate,
  type StoredPackageReferenceReport,
  type StoredReferenceEngine,
  type StoredReferenceRegistry,
} from '../../../utils/stored-package-references.js';

/** How the report spells a candidate. */
export function describeCandidate(c: ReferenceCandidate): string {
  if (c.holder === 'package') return `${c.address} (package "${c.packageId}")`;
  if (c.holder === 'environment') return `${c.address} (the environment)`;
  return 'the platform';
}

/** Why a reported reference is refused, in the operator's words. */
const REASONS = {
  ambiguous: 'more than one holder, none picked — bind one after review',
  'environment-only': 'only an environment-authored item holds it, which a package never reaches (ADR-0150 D3 (a)) — not bindable',
  'outside-closure': 'only packages outside the writer\'s declared dependencies hold it (ADR-0150 D3 (c)) — declare the dependency; not bindable',
} as const;

/**
 * The D8 package columns this read-only boot measured missing from a present
 * table: the held-back sync's `add_columns`, which the driver derives by
 * comparing the declared columns with the table's own (a fact about the
 * database, not a refused read), keyed by physical table as the driver keys
 * it. A database this release has not booted yet lacks every one of them. The
 * report reads such a table as nothing bound yet
 * (`utils/stored-package-references.ts`) and says so once, naming each table
 * and column it asked about; it adds no column.
 */
export function packageColumnReads(pending: readonly PendingSchemaWork[]): {
  absent(table: string, column: string): boolean;
  line(): string | null;
  notice(json: boolean): void;
} {
  const missing = new Map<string, Set<string>>();
  for (const work of pending) {
    if (work.kind !== 'add_columns') continue;
    const columns = missing.get(work.table) ?? new Set<string>();
    for (const column of work.columns) columns.add(column);
    missing.set(work.table, columns);
  }
  const readUnbound = new Map<string, string>();
  const line = (): string | null => {
    if (readUnbound.size === 0) return null;
    const named = [...readUnbound].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([t, c]) => `${t} (${c})`);
    return `${named.length} table(s) have no package column yet (this release adds them at its first boot): `
      + `${named.join(', ')}. Nothing in them is bound yet, so every row was read as naming no package. The first boot `
      + '(os serve) adds the columns, binds each row the resolution rule answers with one package, and leaves unbound '
      + 'exactly the rows this report lists. This report added no column.';
  };
  return {
    absent: (table, column) => {
      if (missing.get(StorageNameMapping.resolveTableName({ name: table }))?.has(column) !== true) return false;
      readUnbound.set(table, column);
      return true;
    },
    line,
    notice: (json) => {
      const text = line();
      if (!text) return;
      if (json) console.error(text);
      else printInfo(text);
    },
  };
}

/** The composition flags `serve` reads, shared with the bind. */
export const COMPOSITION_FLAGS = {
  'database-url': Flags.string({
    description: 'Database to examine (defaults to $OS_DATABASE_URL / the project DB)',
    env: 'OS_DATABASE_URL',
  }),
  json: Flags.boolean({ description: 'Output the machine-readable result as JSON.' }),
  preset: Flags.string({
    description: 'Compose as `os serve --preset` does: pass what the deployment boots with.',
    options: Object.keys(STACK_TIER_PRESETS),
  }),
  dev: Flags.boolean({ description: 'Compose as `os serve --dev` does (`os dev`).' }),
};

/**
 * `os migrate stored-references` — the ADR-0150 D10 upgrade report: every
 * stored reference the package-column backfills (D8) left naming no package
 * because the one D3 rule refuses it, each with every candidate the rule
 * names, plus the packaged picklist references the rule refuses (D8 R17),
 * the names the boot's holder seal found held twice, and the installed
 * packages whose namespace spells an address literal (D5, child G1). The rules, and what is
 * deliberately left out, are `utils/stored-package-references.ts`'s header.
 *
 * Read-only: it boots the deployment as `os serve` composes it (the host
 * config's plugins, the artifact, the served platform, each for its
 * declarations only, so no boot backfill runs), deferred and with no file
 * brought into existence, and writes no row or table. Two runs over one
 * database print the same bytes: the document carries no clock and no
 * duration. `os migrate stored-references bind` writes one reviewed row.
 *
 * Run before the release's first boot, on a database an earlier release
 * wrote, the D8 tables have no package column yet: each is read as nothing
 * bound yet (every row naming no package), so the report lists the rows that
 * boot's backfill will leave null, and one notice names the tables
 * ({@link packageColumnReads}). It adds no column.
 *
 * Exit status: 0 when the report ran (findings or none); 1 when the
 * composition could not be read.
 */
export default class MigrateStoredReferences extends Command {
  static override description =
    'Report the stored references to a flow, permission set, sharing rule, queue, assignment rule, connector or email '
    + 'template whose package the one resolution rule refuses (ADR-0150 D10), each with every candidate. Read-only; '
    + 'bind one row after review with "os migrate stored-references bind".';

  static override examples = ['$ os migrate stored-references', '$ os migrate stored-references --json'];

  static override flags = COMPOSITION_FLAGS;

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateStoredReferences);
    if (!flags.json) printHeader('Migrate · stored-references');
    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        composeHostStack: true,
        composeServedPlatform: true,
        composeAuthGatedSecurity: true,
        serveFlags: { dev: flags.dev === true, ...(flags.preset ? { preset: flags.preset } : {}) },
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); return; }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }
    let exitCode = 0;
    try {
      exitCode = await this.report(stack, flags.json === true);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      exitCode = 1;
      if (flags.json) await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
    }
    if (exitCode !== 0) this.exit(exitCode);
  }

  private async report(stack: Awaited<ReturnType<typeof bootSchemaStack>>, json: boolean): Promise<number> {
    const unloadable = describeUnloadableHostConfig(stack.composition);
    if (unloadable !== null) {
      if (json) await emitJson({ error: 'host_config_unloadable', message: unloadable }, 0, { compact: true });
      else printError(unloadable);
      return 1;
    }
    const engine = stack.kernel.getService('objectql') as (StoredReferenceEngine & { registry?: StoredReferenceRegistry }) | undefined;
    if (typeof engine?.find !== 'function' || !engine.registry) {
      throw new Error('No ObjectQL engine on this stack, so the stored references cannot be read. '
        + 'Run this from the project root whose stack registers the ObjectQL engine.');
    }
    const reads = absentTableReads(stack);
    const columns = packageColumnReads(stack.pendingSchemaWork);
    const report = await collectStoredPackageReferences(engine, engine.registry, {
      absent: (t) => reads.absent(t),
      packageColumnAbsent: (t, c) => columns.absent(t, c),
    });
    if (json) {
      reads.notice(true);
      columns.notice(true);
      await emitJson({ database: stack.dbLabel, ...report });
      return 0;
    }
    printReport(report, stack.dbLabel);
    reads.notice(false);
    columns.notice(false);
    return 0;
  }
}

/** The human face of the report. */
function printReport(report: StoredPackageReferenceReport, database: string): void {
  printInfo(`Database: ${chalk.white(database)}`);
  if (report.tablesNotCarried.length > 0) {
    printWarning(`Not read — this composition does not carry them (compose their plugins as the server does): ${report.tablesNotCarried.join(', ')}.`);
  }
  console.log('');
  const total = report.stored.length + report.picklists.length + report.sealedClashes.length
    + report.literalNamespaces.length + report.pairMembers.length + report.packageLessRows.length;
  if (total === 0) {
    printSuccess('No stored reference, picklist reference or sealed name is refused by the resolution rule, and no '
      + 'package namespace spells an address literal — nothing to review.');
    return;
  }
  if (report.stored.length > 0) {
    console.log(chalk.bold(`${report.stored.length} stored reference(s) naming no package:`));
    for (const f of report.stored) {
      console.log(`  • ${f.d8} ${f.table} "${f.id}" ${f.column} = "${f.name}"${f.callerPackageId ? ` (written by package "${f.callerPackageId}")` : ''}`);
      console.log(`      ${REASONS[f.reason]}: ${f.candidates.map(describeCandidate).join('; ')}`);
    }
    console.log('');
  }
  if (report.picklists.length > 0) {
    console.log(chalk.bold(`${report.picklists.length} packaged field(s) whose picklist is refused (served with no options):`));
    for (const f of report.picklists) {
      console.log(`  • R17 ${f.object}.${f.field} of package "${f.packageId}" → "${f.name}"`);
      console.log(`      ${REASONS[f.reason]}: ${f.candidates.map(describeCandidate).join('; ')}`);
    }
    console.log('');
  }
  if (report.sealedClashes.length > 0) {
    console.log(chalk.bold(`${report.sealedClashes.length} name(s) held twice since before the one-holder rule (a caller naming no package is refused):`));
    for (const c of report.sealedClashes) console.log(`  • ${c.type} "${c.name}": ${c.candidates.join('; ')}`);
    console.log('');
  }
  if (report.literalNamespaces.length > 0) {
    console.log(chalk.bold(`${report.literalNamespaces.length} installed package(s) whose namespace spells an address literal (kept at boot; an install is refused):`));
    for (const f of report.literalNamespaces) {
      console.log(`  • package "${f.packageId}", namespace "${f.namespace}": ${f.message}`);
      console.log(`      Its items are read with ?package=${f.packageId}; rename the namespace to give them qualified addresses.`);
    }
    console.log('');
  }
  if (report.pairMembers.length > 0) {
    console.log(chalk.bold(`${report.pairMembers.length} customization member row(s) two or more packages could own (each one's exact read is refused):`));
    for (const f of report.pairMembers) {
      console.log(`  • ${f.table} "${f.id}" ${f.type} "${f.name}"${f.member ? ` member "${f.member}"` : ''} in "${f.pairId}"`);
      console.log(`      could be the added member of: ${f.candidates.map(describeCandidate).join('; ')}`);
      // The save gate's `declared_package_ships_no_such_item` refusal (#28777).
      console.log('      No door binds an added member to one base today (the save gate refuses overrides.package naming a base that does not ship it): the row stays refused, and listed here, until it is deleted.');
    }
    console.log('');
  }
  if (report.packageLessRows.length > 0) {
    console.log(chalk.bold(`${report.packageLessRows.length} package-less row(s) two or more packages could own (each one's exact read is refused):`));
    for (const f of report.packageLessRows) {
      console.log(`  • ${f.table} "${f.id}" ${f.type} "${f.name}"${f.member ? ` member "${f.member}"` : ''}`);
      console.log(`      could be the customization of: ${f.candidates.map(describeCandidate).join('; ')}`);
      console.log('      Where one of these packages ships the item, save the customization into its pair declaring it (overrides.package) and delete this row; otherwise no door binds the row to one package today, and it stays refused until it is deleted.');
    }
    console.log('');
  }
  if (report.stored.some((f) => f.reason === 'ambiguous' && f.packageColumn)) {
    printWarning('Bind an ambiguous row after review, one at a time: os migrate stored-references bind --table TABLE --id ID --package PACKAGE_ID');
  }
}
