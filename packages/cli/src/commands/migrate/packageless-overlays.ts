// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { STACK_TIER_PRESETS } from '@objectstack/core';
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
import type { PackagelessOverlayCensus, PackagelessOverlayMigration } from '@objectstack/metadata-protocol';
import { PackageServicePlugin } from '@objectstack/service-package';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { describeUnloadableHostConfig } from '../../utils/schema-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

/** The command's own name, the `actor` its writes record. */
export const PACKAGELESS_OVERLAYS_ACTOR = 'os migrate packageless-overlays';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((res) => rl.question(question, res));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** The census and the move's report, as `@objectstack/metadata-protocol` declares them. */
type Census = PackagelessOverlayCensus;
type Migration = PackagelessOverlayMigration;
type CensusRow = Census['rows'][number];
type Outcome = Migration['outcomes'][number];
interface MigrationProtocol {
  listPackagelessOverlays?: () => Promise<Census>;
  migratePackagelessOverlays?: (request: { actor: string }) => Promise<Migration>;
}

/** One item as the report names it. */
function itemOf(row: { type: string; name: string; state: string; member?: string }): string {
  return `${row.type} "${row.name}"${row.member ? ` (${row.member})` : ''}${row.state === 'draft' ? ' [draft]' : ''}`;
}

/** Why a listed row is not moved, and what the administrator can do. */
function reasonOf(row: CensusRow): string {
  switch (row.disposition) {
    case 'multi_shipped':
      return `several packages ship this name (${row.shippers.join(', ')}), so it overlays none of them for certain. `
        + 'Left as it is: move it by hand into the pair of the package it customizes, or delete it.';
    case 'no_pair':
      return `'${row.base}' has no paired .custom package id, so there is nowhere to move it. Left as it is.`;
    case 'foreign_declaration':
      return `its body already carries an \`overrides\` key that does not name '${row.base}'. Left as it is: `
        + 'correct or remove the key, then re-run.';
    case 'shadowed':
      return `'${row.pair}' already ${row.shadowDeclares ? 'overrides this item (a customization made in Studio)' : 'holds a row of this name'}, `
        + 'and that row is the one served — this row is never merged into it. Two ways out: keep the Studio '
        + `customization and delete this package-less row (id ${row.id}), or use "Restore package original" in `
        + `Studio to delete '${row.pair}''s row and re-run this command to move this one.`;
    default:
      return '';
  }
}

function jsonRow(row: CensusRow, outcome?: Outcome): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    storedType: row.storedType,
    name: row.name,
    state: row.state,
    ...(row.member !== undefined ? { member: row.member } : {}),
    disposition: row.disposition,
    shippers: row.shippers,
    ...(row.base !== undefined ? { base: row.base } : {}),
    ...(row.pair !== undefined ? { pair: row.pair } : {}),
    ...(row.shadowDeclares !== undefined ? { shadowDeclares: row.shadowDeclares } : {}),
    outcome: outcome?.outcome ?? (row.disposition === 'movable' ? 'listed' : 'left'),
    ...(outcome && outcome.outcome !== 'failed' ? { packageId: outcome.packageId, basedOn: outcome.basedOn } : {}),
    ...(outcome?.outcome === 'failed' ? { error: outcome.error } : {}),
  };
}

/**
 * `os migrate packageless-overlays` — list, and with `--apply` move, every
 * package-less overlay row of a name exactly one installed code package ships
 * into that package's paired `<base>.custom`, as a declared override
 * (ADR-0146 D11, the migration half of N-16).
 *
 * ## Why a ceremony
 *
 * A Setup "customize" of a view, dashboard, report, translation or email
 * template a package ships was stored bound to no package: it is served, but it
 * is never exported and never reaches another environment. ADR-0146 moves every
 * customization of an installed package into its paired `.custom` package,
 * declared in the item's body (`overrides: { package, basedOn }`). Moving the
 * existing rows is the administrator's call, so it is this command and not a
 * boot step; the release note names it as the one operator step.
 *
 * ## What it does
 *
 * The protocol's census and move (`listPackagelessOverlays` /
 * `migratePackagelessOverlays`, `@objectstack/metadata-protocol`, whose module
 * header holds the rules): the pair is ensured through its one creation door,
 * each body is saved into the pair through the save door with the declaration
 * (`basedOn` = the installed base's version now), read back as the served
 * override, and only then is the package-less row deleted. A name no package
 * ships is environment metadata and is not touched; a name several packages
 * ship, and a row the pair already overrides (a Studio customization made
 * first), are listed and left alone. A pair row declaring an override with no
 * `basedOn` gains it. A second run moves nothing.
 *
 * The deployment is composed as `os serve` composes it — the host config's
 * plugins and the application or the compiled artifact — so the packages that
 * ship a name are the ones the server serves. `--preset` and `--dev` are
 * `serve`'s two flags that move that composition, with its meaning.
 *
 * ## Who runs it
 *
 * The operator, on the deployment's database. The HTTP door that creates a pair
 * (`POST /packages/:id/ensure-customization`) keeps its walled refusal: under a
 * wall a tenant administrator is refused there (403), and this command adds no
 * door of its own.
 *
 * ## The family's conventions
 *
 * Preview by default; `--apply` is the only writing mode, confirmed with
 * `[y/N]` or `--yes`; `--force` past a busy SQLite file; `--json` for one
 * document; `--database-url` / `$OS_DATABASE_URL` for the target. The preview
 * boots read-only (deferred DDL, no seed, no file brought into existence), and
 * `--apply` boots plain.
 *
 * Exit status: 0 when the preview ran, or when everything `--apply` acted on
 * succeeded; 1 when a row could not be moved or completed, or when the
 * composition could not be read.
 */
export default class MigratePackagelessOverlays extends Command {
  static override description =
    'List, and with --apply move, the package-less view, dashboard, report, translation and email-template rows '
    + 'over a name one installed package ships into that package\'s paired .custom package, as declared overrides '
    + '(ADR-0146 D11). Run once after upgrading.';

  static override examples = [
    '$ os migrate packageless-overlays',
    '$ os migrate packageless-overlays --json',
    '$ os migrate packageless-overlays --apply',
    '$ os migrate packageless-overlays --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database to examine (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Move the listed rows (default is a read-only preview)',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip the --apply confirmation prompt',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output the machine-readable result as JSON.' }),
    preset: Flags.string({
      description: 'Compose as `os serve --preset` does: the tier preset the stack falls back to when it declares '
        + 'no tiers. Pass what the deployment boots with.',
      options: Object.keys(STACK_TIER_PRESETS),
    }),
    dev: Flags.boolean({
      description: 'Compose as `os serve --dev` does: the config\'s devPlugins and the development .env files. '
        + 'Pass it when the deployment boots with --dev (`os dev`).',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePackagelessOverlays);
    const timer = createTimer();
    const apply = flags.apply;
    if (!flags.json) printHeader('Migrate · packageless-overlays');

    // Occupancy gate — probed BEFORE boot and before the prompt, as every
    // writing member of the family does.
    const occupancy = await probeMigrationTarget(flags['database-url'], { dev: flags.dev === true });
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
        ? `--force: ${describeOccupancy(occupancy)} Moving anyway — restart that process afterwards so it serves the moved rows.`
        : `${describeOccupancy(occupancy)} The preview below writes no row or table. ${JOURNAL_MODE_SWITCH_NOTE}`);
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
        printWarning(
          'Apply mode moves the listed sys_metadata rows into each base\'s paired .custom package (created when '
          + 'absent) and deletes the package-less rows. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nMove the package-less overlay rows into each base\'s .custom package as declared overrides? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — nothing moved.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Composing the deployment (APPLY mode)…' : 'Composing the deployment (preview only)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        composeHostStack: true,
        composeAuthGatedSecurity: true,
        // The package registry, live, under `--apply` only: the pair the
        // ensure door creates is persisted to `sys_packages` (the server
        // installs it from there at its next boot), and a pair an earlier run
        // created is installed again here. The preview writes nothing, so it
        // composes none (its `start()` provisions the table).
        ...(apply ? { extraPlugins: [new PackageServicePlugin()] } : {}),
        serveFlags: { dev: flags.dev === true, ...(flags.preset ? { preset: flags.preset } : {}) },
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); return; }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    // Collected rather than thrown: `this.exit()` raises an oclif ExitError.
    let exitCode = 0;
    try {
      exitCode = await this.report(stack, { apply, json: flags.json === true }, timer);
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

  /** Census, move under `--apply`, and report on the booted stack; answers the exit status. */
  private async report(
    stack: Awaited<ReturnType<typeof bootSchemaStack>>,
    opts: { apply: boolean; json: boolean },
    timer: { elapsed: () => number; display: () => string },
  ): Promise<number> {
    const { apply, json } = opts;
    // A host config that exists and could not be read leaves the shipping
    // packages incomplete: a row would be classified against the wrong set.
    const unloadable = describeUnloadableHostConfig(stack.composition);
    if (unloadable !== null) {
      if (json) await emitJson({ error: 'host_config_unloadable', message: unloadable }, 0, { compact: true });
      else printError(unloadable);
      return 1;
    }
    const protocol = stack.kernel.getService('protocol') as MigrationProtocol | undefined;
    if (typeof protocol?.listPackagelessOverlays !== 'function' || typeof protocol.migratePackagelessOverlays !== 'function') {
      throw new Error(
        'No metadata protocol on this stack, so sys_metadata cannot be read. '
        + 'Run this from the project root whose stack registers the ObjectQL engine.',
      );
    }

    // The preview's read-only boot measured whether `sys_metadata` exists; a
    // table that does not exist stores no row.
    const reads = absentTableReads(stack);
    const empty: Migration = { rows: [], environmentRows: 0, incompleteDeclarations: [], outcomes: [], bases: [] };
    const result: Migration = reads.absent('sys_metadata')
      ? empty
      : apply
        ? await protocol.migratePackagelessOverlays({ actor: PACKAGELESS_OVERLAYS_ACTOR })
        : { ...(await protocol.listPackagelessOverlays()), outcomes: [], bases: [] };
    const outcomeOf = new Map(result.outcomes.map((o) => [o.id, o]));
    const movable = result.rows.filter((r) => r.disposition === 'movable');
    const left = result.rows.filter((r) => r.disposition !== 'movable');
    const failed = result.outcomes.filter((o) => o.outcome === 'failed').length;
    const exitCode = apply && failed > 0 ? 1 : 0;

    if (json) {
      reads.notice(true);
      await emitJson({
        database: stack.dbLabel,
        apply,
        hostConfig: stack.composition.hostConfigPath,
        movable: movable.length,
        moved: result.outcomes.filter((o) => o.outcome === 'moved').length,
        declarationsCompleted: result.outcomes.filter((o) => o.outcome === 'declaration_completed').length,
        failed,
        left: left.length,
        environmentRows: result.environmentRows,
        bases: result.bases,
        rows: result.rows.map((row) => jsonRow(row, outcomeOf.get(row.id))),
        incompleteDeclarations: result.incompleteDeclarations.map((d) => ({
          ...d,
          outcome: outcomeOf.get(d.id)?.outcome ?? 'listed',
          ...(outcomeOf.get(d.id)?.outcome === 'failed' ? { error: (outcomeOf.get(d.id) as { error: string }).error } : {}),
        })),
        duration: timer.elapsed(),
      });
      return exitCode;
    }

    printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
    if (stack.composition.hostConfigPath) printInfo(`Host config: ${chalk.white(stack.composition.hostConfigPath)}`);
    reads.notice(false);
    if (result.environmentRows > 0) {
      printInfo(`${result.environmentRows} package-less row(s) of a name no package ships are environment metadata and are not touched.`);
    }
    console.log('');
    if (movable.length === 0 && left.length === 0 && result.incompleteDeclarations.length === 0) {
      printSuccess(`No package-less overlay row is stored over a name a package ships — nothing to move ${chalk.dim(`(${timer.display()})`)}`);
      return exitCode;
    }
    if (left.length > 0) {
      console.log(chalk.bold(`${left.length} row(s) left as they are:`));
      for (const row of left) console.log(`  • ${itemOf(row)} — ${reasonOf(row)}`);
      console.log('');
    }
    if (!apply) {
      if (movable.length > 0) {
        console.log(chalk.bold(`${movable.length} row(s) to move:`));
        for (const row of movable) console.log(`  • ${itemOf(row)} → ${row.pair} (overrides ${row.base})`);
      }
      if (result.incompleteDeclarations.length > 0) {
        console.log(chalk.bold(`${result.incompleteDeclarations.length} declared override(s) missing basedOn:`));
        for (const d of result.incompleteDeclarations) console.log(`  • ${itemOf(d)} in ${d.pair} (overrides ${d.base})`);
      }
      console.log('');
      if (movable.length > 0 || result.incompleteDeclarations.length > 0) {
        printWarning('Re-run with --apply to move them (each base\'s .custom package is created when absent).');
      }
      return exitCode;
    }
    for (const row of [...movable, ...result.incompleteDeclarations]) {
      const outcome = outcomeOf.get(row.id);
      if (outcome === undefined) continue;
      if (outcome.outcome === 'failed') {
        console.log(`  ${chalk.red('✗')} ${itemOf(row)} — ${outcome.error}`);
      } else {
        const verb = outcome.outcome === 'moved' ? 'moved into' : 'basedOn recorded in';
        console.log(`  ${chalk.green('✓')} ${itemOf(row)} ${verb} ${outcome.packageId} ${chalk.dim(`(basedOn ${outcome.basedOn})`)}`);
      }
    }
    console.log('');
    for (const line of result.bases) {
      printInfo(`${line.base} → ${line.pair}${line.pairCreated ? ' (created)' : ''}: ${line.moved} moved, `
        + `${line.declarationsCompleted} basedOn recorded, ${line.shadowed} shadowed, ${line.failed} failed`);
    }
    if (failed > 0) {
      printError(`${failed} row(s) could not be moved; each package-less row that failed is kept as it was.`);
    } else {
      printSuccess(`Done ${chalk.dim(`(${timer.display()})`)}. Restart the server so it serves the moved rows.`);
    }
    return exitCode;
  }
}
