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
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { describeSecurityPluginComposition, describeUnloadableHostConfig } from '../../utils/schema-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import {
  deleteSecurityCatalogOverlayRows,
  listSecurityCatalogOverlayRows,
  type SecurityCatalogOverlayOutcome,
  type SecurityCatalogOverlayRow,
} from '../../utils/security-catalog-overlays.js';

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

/** One row as the report shows it, in both faces. */
function describeRow(row: SecurityCatalogOverlayRow): string {
  const label = row.catalogType === 'permission' ? 'permission set' : 'position';
  const spelling = row.storedType === row.catalogType ? '' : ` (stored under the legacy type '${row.storedType}')`;
  const binding = row.packageId ? `bound to ${row.packageId}` : 'bound to no package';
  return `${label} "${row.name}"${spelling}, ${binding}, row ${row.id} — held by ${row.heldBy.join(', ')}`;
}

function jsonRow(row: SecurityCatalogOverlayRow, outcome?: SecurityCatalogOverlayOutcome): Record<string, unknown> {
  return {
    id: row.id,
    type: row.storedType,
    catalogType: row.catalogType,
    name: row.name,
    packageId: row.packageId,
    heldBy: row.heldBy,
    outcome: outcome?.outcome ?? 'listed',
    ...(outcome?.outcome === 'deleted' ? { door: outcome.door } : {}),
    ...(outcome?.outcome === 'failed' ? { error: outcome.error } : {}),
  };
}

/**
 * `os migrate security-catalog-overlays` — list, and with `--apply` delete, the
 * environment-wide `sys_metadata` rows a v18 cold boot refuses: an active,
 * environment-wide `permission` / `position` row (the legacy plurals included)
 * whose name a configured package holds (ADR-0048 N.3).
 *
 * ## Why an offline step
 *
 * A deployment upgraded from 17.x can carry such rows — a permission set or a
 * position saved in the environment over a package's name before the packaged
 * locks refused that, or over one of the platform security plugin's own sets.
 * v18's cold boot refuses to start over any of them, so nothing that needs the
 * server can clear them; the metadata API's delete reaches no legacy-plural row
 * at all. This step is the upgrade's supported remedy (maintainer ruling A′ on
 * #22371, record 6073500921, item 1, as amended by ruling letter B, record
 * 6074838935): run it before the first v18 boot, or after a refused one.
 *
 * ## How it answers exactly what the cold boot refuses
 *
 * It composes the deployment the way `os serve` does — the host config's
 * plugins, the application or the compiled artifact, and the security plugin
 * behind `serve`'s auth gate (`resolvePlatformAuthComposition`,
 * `@objectstack/core`, the one rule both ask) — for the kernel's first phase
 * only, and boots it WITHOUT `sys_metadata` hydration. The cold-boot check then
 * meets an empty environment half and the boot comes up. The package-held names
 * are read off the registry through the engine's own holder reading
 * (`findPackageHeldSecurityCatalogNames`), and met with the stored rows. See
 * `../../utils/security-catalog-overlays.ts` for the population and the write
 * path. The security plugin's shipped sets join only when `serve` composes it,
 * so the step reads the environment `serve` reads — `OS_AUTH_SECRET` above all
 * — and says which way the gate went.
 *
 * `--preset` and `--dev` are `serve`'s two flags that move that composition,
 * with `serve`'s meaning, read through the rules `serve` reads them by:
 * `--preset` names the tier preset the auth gate's tiers fall back to
 * (`resolveStackTiers`), and `--dev` merges the config's `devPlugins`
 * (`stackBootPlugins`) and makes the boot a development one for the auth
 * secret's fallback (`isDevelopmentBoot`). Pass the flags the deployment boots
 * with. They move the composition only: this boot stays a one-shot boot (no
 * dev schema self-heal, `NODE_ENV` untouched, and the project's `.env*` files
 * picked by `NODE_ENV` as `os start` picks them — `--dev` does not switch them
 * to `os dev`'s, #22581), so the rest of the environment is the operator's to
 * set as the deployment's.
 *
 * ## The family's conventions
 *
 * Preview by default; `--apply` is the only writing mode, confirmed with
 * `[y/N]` or `--yes`; `--force` past a busy SQLite file; `--json` for one
 * document; `--database-url` / `$OS_DATABASE_URL` for the target. The preview
 * boots read-only (deferred DDL, no seed, no file brought into existence), and
 * `--apply` boots plain, as `os migrate meta --stored --apply` does.
 *
 * Exit status: 0 when nothing is listed or everything listed was deleted; 1
 * when the preview lists a row (the boot would be refused), when a deletion
 * failed, or when the composition could not be read.
 */
export default class MigrateSecurityCatalogOverlays extends Command {
  static override description =
    'List, and with --apply delete, the environment-wide permission-set and position rows (legacy plurals '
    + 'included) over a name a configured package holds — the rows a v18 cold boot refuses. Run before the first '
    + 'v18 boot.';

  static override examples = [
    '$ os migrate security-catalog-overlays',
    '$ os migrate security-catalog-overlays --json',
    '$ os migrate security-catalog-overlays --preset minimal',
    '$ os migrate security-catalog-overlays --dev',
    '$ os migrate security-catalog-overlays --apply',
    '$ os migrate security-catalog-overlays --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database to examine (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Delete the listed rows (default is a read-only preview)',
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
    // [#22371] `os serve`'s two flags that move the composition, with its meaning.
    preset: Flags.string({
      description: 'Compose as `os serve --preset` does: the tier preset the auth tier falls back to when the stack '
        + 'declares no tiers. Pass what the deployment boots with.',
      options: Object.keys(STACK_TIER_PRESETS),
    }),
    dev: Flags.boolean({
      description: 'Compose as `os serve --dev` does: the config\'s devPlugins, and a development boot for the auth '
        + 'secret\'s fallback. Pass it when the deployment boots with --dev (`os dev`).',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateSecurityCatalogOverlays);
    const timer = createTimer();
    const apply = flags.apply;
    if (!flags.json) printHeader('Migrate · security-catalog-overlays');

    // Occupancy gate — probed BEFORE boot (afterwards our own pool is what the
    // probe finds) and before the prompt, so nobody confirms something we then
    // refuse. The same gate `os migrate meta --stored --apply` keeps.
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
        ? `--force: ${describeOccupancy(occupancy)} Deleting anyway — the live process may write metadata mid-run.`
        : `${describeOccupancy(occupancy)} The preview below writes nothing.`);
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
          'Apply mode deletes the listed sys_metadata rows — each through the metadata write path, with a '
          + 'history tombstone. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nDelete the environment-wide rows over package-held permission-set and position names? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — nothing deleted.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Composing the deployment (APPLY mode, no hydration)…' : 'Composing the deployment (preview only, no hydration)…');
    }

    let stack;
    try {
      // The deployment's composition, as `os serve` composes it, for its first
      // phase — and NO hydration, so the cold-boot check this step clears does
      // not stop the boot. The preview boots read-only, like `os migrate plan`.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        composeHostStack: true,
        composeAuthGatedSecurity: true,
        serveFlags: { dev: flags.dev === true, ...(flags.preset ? { preset: flags.preset } : {}) },
        hydrateMetadata: false,
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); return; }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    // Collected rather than thrown: `this.exit()` raises an oclif ExitError.
    // Decide the code here, exit after the stack is down.
    let exitCode = 0;
    try {
      exitCode = await this.report(stack, {
        apply,
        json: flags.json === true,
        serveFlags: { preset: flags.preset ?? 'default', dev: flags.dev === true },
      }, timer);
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

  /** List, delete under `--apply`, and report on the booted stack; answers the exit status. */
  private async report(
    stack: Awaited<ReturnType<typeof bootSchemaStack>>,
    opts: { apply: boolean; json: boolean; serveFlags: { preset: string; dev: boolean } },
    timer: { elapsed: () => number; display: () => string },
  ): Promise<number> {
    const { apply, json, serveFlags } = opts;
    const composition = stack.composition;
    // A host config that exists and could not be read leaves the held set
    // incomplete: listing would miss names and the boot would still refuse.
    // Refused before any row is read or deleted.
    const unloadable = describeUnloadableHostConfig(composition);
    if (unloadable !== null) {
      if (json) await emitJson({ error: 'host_config_unloadable', message: unloadable }, 0, { compact: true });
      else printError(unloadable);
      return 1;
    }

    // The preview's read-only boot measured whether `sys_metadata` exists; a
    // table that does not exist stores no row (the `meta --stored` reading).
    const reads = absentTableReads(stack);
    const rows = reads.absent('sys_metadata') ? [] : await listSecurityCatalogOverlayRows(stack.kernel);
    const outcomes = apply && rows.length > 0 ? await deleteSecurityCatalogOverlayRows(stack.kernel, rows) : [];
    const deleted = outcomes.filter((o) => o.outcome === 'deleted').length;
    const failed = outcomes.filter((o) => o.outcome === 'failed').length;
    const exitCode = (apply ? failed > 0 : rows.length > 0) ? 1 : 0;

    if (json) {
      reads.notice(true);
      await emitJson({
        database: stack.dbLabel,
        apply,
        hostConfig: composition.hostConfigPath,
        serveFlags,
        securityPlugin: composition.securityPlugin ?? null,
        listed: rows.length,
        deleted,
        failed,
        rows: rows.map((row, i) => jsonRow(row, outcomes[i])),
        duration: timer.elapsed(),
      });
      return exitCode;
    }

    printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
    if (composition.hostConfigPath) printInfo(`Host config: ${chalk.white(composition.hostConfigPath)}`);
    printInfo(`Composed as: ${chalk.white(`os serve --preset ${serveFlags.preset}${serveFlags.dev ? ' --dev' : ''}`)}`);
    reads.notice(false);
    // What decided whether the platform security plugin's sets are held — the
    // one composition fact that moves this list with the boot environment.
    if (composition.securityPlugin) printInfo(describeSecurityPluginComposition(composition.securityPlugin));
    console.log('');
    if (rows.length === 0) {
      printSuccess(
        'No environment-wide permission-set or position row is stored over a package-held name — '
        + `nothing here refuses the cold boot ${chalk.dim(`(${timer.display()})`)}`,
      );
      return exitCode;
    }
    if (!apply) {
      console.log(chalk.bold(`${rows.length} row(s) the cold boot refuses:`));
      for (const row of rows) console.log(`  • ${describeRow(row)}`);
      console.log('');
      printWarning(
        'A v18 boot of this deployment is refused while these rows are stored. Re-run with --apply to delete '
        + 'them (each through the metadata write path, with a history tombstone). Nothing is adopted: a row the '
        + 'environment needs under its own name must be re-created under a name no package holds.',
      );
      return exitCode;
    }
    // One audit line per row: what was deleted, through which door, or why not.
    for (const outcome of outcomes) {
      if (outcome.outcome === 'deleted') {
        console.log(`  ${chalk.green('✓')} deleted ${describeRow(outcome.row)} ${chalk.dim(`(via ${outcome.door}, actor 'os migrate security-catalog-overlays')`)}`);
      } else {
        console.log(`  ${chalk.red('✗')} not deleted: ${describeRow(outcome.row)} — ${outcome.error}`);
      }
    }
    console.log('');
    if (failed > 0) {
      printError(`${failed} of ${rows.length} row(s) could not be deleted; the cold boot still refuses them.`);
    } else {
      printSuccess(`Deleted ${deleted} row(s) — the cold boot no longer refuses them ${chalk.dim(`(${timer.display()})`)}`);
    }
    return exitCode;
  }
}
