// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
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
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import type {
  DatasourceArtefactLike,
  SecretReferenceEngineLike,
} from '../../utils/secret-reference-union.js';
import type {
  PreDeleteExport,
  SecretRowSnapshot,
  SettingRowSnapshot,
  SysSecretSweepPlan,
} from '../../utils/sys-secret-orphan-sweep.js';

/**
 * `os secret orphans` — the operator-run half of #8103.
 *
 * ## What it is, and what the maintainer ruled
 *
 * #8030 / PR #8063 made a settings rotation reap the ciphertext it retired,
 * but only FORWARD: the reaping fires on the write that repoints a handle.
 * Rows orphaned by rotations that already happened on a deployed instance are
 * untouched, and nothing else ever touches them.
 *
 * Removing those is a destructive, irreversible delete-many over stored
 * credentials, so the vehicle was a maintainer decision, taken twice:
 *
 *  - 2026-08-26, option **B** — an EXPLICIT OPERATOR COMMAND with the dry-run
 *    report as its default, deletion only behind an explicit flag, a mandatory
 *    pre-delete export, and the `unattributable` class never deleted.
 *    ⛔ Option C, an automatic migration that sweeps on boot or upgrade, was
 *    ruled out on measured grounds. Nothing on any boot path invokes this
 *    command, and it must not grow such a caller.
 *  - 2026-08-27, option **B'** — B, but SEQUENCED behind its missing
 *    precondition. The deletion predicate is *"attributable AND unreferenced
 *    by the COMPLETE union"*, over all three `sys_secret` producer families.
 *    Report-only remains the recorded fallback, and ⛔ no seat downgrades to it
 *    silently.
 *
 * ⛔ It is also NOT a `lifecycle`/retention implementation. Age is not
 * unreferencedness, and an age sweep takes the in-force oldest rows FIRST —
 * see the exposure note below, which is why that inversion is fatal here.
 *
 * ## ⚠️ The exposure framing is INVERTED, and the operator text says so
 *
 * The tempting sentence — "this cleans up leaked old credentials" — is FALSE
 * for this population, and this command never says it. On the pre-fix rotation
 * path the handle was never repointed, so the value STILL IN FORCE is the
 * OLDEST one — the credential the administrator believed they had replaced —
 * while each orphan holds a value the administrator INTENDED to set and which
 * never took effect. Deleting orphans therefore retires nothing that is
 * exposed, and if the administrator also rotated at the provider, the newest
 * orphan may be a credential that is CURRENTLY VALID there.
 *
 * ## The safety property is the completeness of the union, and it is checked
 *
 * `sys_secret` has three producers and no producer column, so "unreferenced by
 * `sys_setting`" is not "unreferenced" — a LIVE, engine-owned credential lands
 * in the settings-scoped classifier's `orphaned` bucket, reproduced against the
 * real producers in `sys-secret-orphan-sweep.test.ts`. This command therefore
 * decides on the cross-producer union, and **refuses to delete when any family
 * could not be enumerated, naming the family**. The union models three
 * independent gap sources and ⛔ this command flattens none of them: the
 * per-family status is printed and carried into `--json` and into the export.
 *
 * ## Why the export is mandatory rather than advisable
 *
 * The settings audit trail records content digests, never handles, so a row
 * deleted in error cannot be NAMED afterwards, let alone recovered. The export
 * is the only record that survives the delete, and it therefore carries the
 * cipher material: an export that named the row without its ciphertext would
 * make the mistake describable and still permanent. `--delete` without
 * `--export` is refused, the file is written with owner-only permissions, and
 * it is READ BACK and checked against the plan before a single row is removed.
 */
export default class SecretOrphans extends Command {
  static override description =
    'Report `sys_secret` rows no producer references any more, and (only with --delete) remove the '
    + 'ones attributable to settings. Report-only by default: it writes nothing and deletes nothing.';

  static override examples = [
    '<%= config.bin %> secret orphans',
    '<%= config.bin %> secret orphans --json',
    '<%= config.bin %> secret orphans --declared-datasources ./datasources.json',
    '<%= config.bin %> secret orphans --no-declared-datasources',
    '<%= config.bin %> secret orphans --delete --export ./sys-secret-backup.json --no-declared-datasources',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    delete: Flags.boolean({
      description:
        'Delete the deletable rows (default is a report that writes nothing). Requires --export, '
        + 'and refuses whenever the reference union is incomplete.',
      default: false,
    }),
    export: Flags.string({
      description:
        'Path for the MANDATORY pre-delete export. Holds the cipher material of every row about '
        + 'to be deleted, so the delete is recoverable — the audit trail records digests, not '
        + 'handles, and cannot name a deleted row afterwards. Refuses to overwrite.',
    }),
    'declared-datasources': Flags.string({
      description:
        'Path to a JSON file listing the datasource artefacts this host declares IN CODE (an array, '
        + 'or {"datasources": [...]}). A datasource declared in code that nothing ever installed '
        + 'reaches neither sys_metadata nor the engine index, so only the host can answer for it.',
      exclusive: ['no-declared-datasources'],
    }),
    'no-declared-datasources': Flags.boolean({
      description:
        'State that this host declares NO code-defined datasources. Distinct from saying nothing: '
        + 'saying nothing leaves the datasource family a declared GAP and deletion is refused.',
      default: false,
      exclusive: ['declared-datasources'],
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --delete confirmation prompt', default: false }),
    json: Flags.boolean({
      description: 'Output as JSON (implies non-interactive; requires --yes to delete)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretOrphans);
    const timer = createTimer();
    const json = flags.json;

    if (!json) printHeader('Secret · orphaned sys_secret rows');

    // ── The host's own answer for family 3, read BEFORE the boot ───────────
    // A malformed file must not cost a boot, and — more importantly — it must
    // never degrade into `[]`. `undefined` here means "nobody answered", which
    // the union turns into a declared gap.
    let declaredDatasources: readonly DatasourceArtefactLike[] | undefined;
    if (flags['no-declared-datasources']) {
      declaredDatasources = [];
    } else if (flags['declared-datasources']) {
      try {
        declaredDatasources = readDeclaredDatasources(flags['declared-datasources']);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (json) { await emitJson({ error: 'declared_datasources_unreadable', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
    }

    if (flags.delete && !flags.export) {
      const message =
        'Refusing to delete without --export. The pre-delete export is mandatory: the audit trail '
        + 'records content digests rather than handles, so a row deleted in error cannot be named '
        + 'afterwards and cannot be recovered. Name a path for it.';
      if (json) { await emitJson({ error: 'export_required', message }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    const exportPath = flags.export ? resolvePath(flags.export) : undefined;
    if (exportPath && existsSync(exportPath)) {
      const message = `Refusing to overwrite an existing export at ${exportPath}. Name a new path.`;
      if (json) { await emitJson({ error: 'export_exists', message, path: exportPath }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    if (!json) printStep(flags.delete ? 'Booting (DELETE mode)…' : 'Booting (report only)…');

    // Loaded at the point of use, never at module load: oclif `import()`s every
    // command module on every invocation while building its table, and these
    // chains reach objectql / service-settings / service-datasource. A static
    // import would charge every `os` invocation for them (the #5726 shape).
    const { collectSecretReferenceUnion } = await import('../../utils/secret-reference-union.js');
    const { buildPreDeleteExport, planSysSecretOrphanSweep, useHandlePredicate } =
      await import('../../utils/sys-secret-orphan-sweep.js');
    const { collectEncryptedSpecifierRefs, isSecretHandle, SettingsServicePlugin } =
      await import('@objectstack/service-settings');
    const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');

    // The legacy-inline discriminator comes from the producer that mints the
    // handles, never from a restated `sec_` prefix in the sweep module.
    useHandlePredicate(isSecretHandle);

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        // Settings is registered so its REGISTERED manifests are readable: the
        // attribution set is theirs, and without it nothing is attributable and
        // nothing is deletable (the safe direction, reported as a note).
        extraPlugins: [new PlatformObjectsPlugin(), new SettingsServicePlugin({ registerRoutes: false })],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) { await emitJson({ error: 'boot_failed', message }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    try {
      const engine = stack.kernel.getService('objectql') as SecretReferenceEngineLike | undefined;
      if (!engine) {
        const message = 'No ObjectQL engine on this runtime, so no producer family can be enumerated.';
        if (json) { await emitJson({ error: 'no_engine', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      // `sys_secret` is read at DRIVER level and UNSCOPED, the same choice the
      // union makes and for the same reason: every filter subtracts rows, and a
      // row missing from THIS read is a row the report never mentions.
      const secretDriver = engine.getDriverForObject('sys_secret');
      if (!secretDriver) {
        const message = 'No driver resolves for `sys_secret`, so its rows could not be read.';
        if (json) { await emitJson({ error: 'no_sys_secret_driver', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      const rawSecrets = rowsOf(await secretDriver.find('sys_secret', {}));
      const rawById = new Map(rawSecrets.map((r) => [String(r.id), r]));
      // ⛔ `ciphertext` is dropped here and not carried into the plan: the plan
      // is printed and serialised, and cipher material must not be reachable
      // from a surface that is expected to be safe to show.
      const secrets: SecretRowSnapshot[] = rawSecrets.map((r) => ({
        id: String(r.id),
        namespace: String(r.namespace ?? ''),
        key: String(r.key ?? ''),
        version: (r.version as number | null | undefined) ?? null,
        kms_key_id: (r.kms_key_id as string | null | undefined) ?? null,
        created_at: (r.created_at as string | null | undefined) ?? null,
        rotated_at: (r.rotated_at as string | null | undefined) ?? null,
      }));

      const settingDriver = engine.getDriverForObject('sys_setting');
      const settingRows: SettingRowSnapshot[] = settingDriver
        ? rowsOf(await settingDriver.find('sys_setting', {})).map((r) => ({
          namespace: String(r.namespace ?? ''),
          key: String(r.key ?? ''),
          scope: (r.scope as string | null | undefined) ?? null,
          user_id: (r.user_id as string | null | undefined) ?? null,
          value_enc: (r.value_enc as string | null | undefined) ?? null,
        }))
        : [];

      const settings = stack.kernel.getService('settings') as
        { listManifests?: () => unknown[] } | undefined;
      const manifests = (settings?.listManifests?.() ?? []) as Parameters<
        typeof collectEncryptedSpecifierRefs
      >[0];

      const union = await collectSecretReferenceUnion({ engine, declaredDatasources });
      const plan = planSysSecretOrphanSweep({
        secrets,
        union,
        attributableTo: collectEncryptedSpecifierRefs(manifests),
        settingRows,
      });

      if (!flags.delete) {
        if (json) { await emitJson({ mode: 'report', plan }, 0, { compact: true }); return; }
        renderPlan(plan);
        printInfo(`Report only — nothing was written or deleted. (${timer.display()})`);
        printInfo('Re-run with --delete --export <path> to remove the deletable rows.');
        return;
      }

      // ── The falsifiable criterion: an incomplete union refuses, by family ──
      if (plan.refusal) {
        if (json) {
          await emitJson({ mode: 'delete', refused: plan.refusal, plan }, 1, { compact: true });
          return;
        }
        renderPlan(plan);
        printError(plan.refusal.message);
        for (const gap of plan.refusal.gaps) printError(`  family '${gap.family}': ${gap.reason}`);
        this.exit(1);
        return;
      }

      if (plan.deletable.length === 0) {
        if (json) { await emitJson({ mode: 'delete', deleted: [], plan }, 0, { compact: true }); return; }
        renderPlan(plan);
        printSuccess('Nothing to delete.');
        return;
      }

      if (!json) {
        renderPlan(plan);
        printWarning(
          `About to permanently delete ${plan.deletable.length} sys_secret row(s). This cannot be `
          + 'undone from inside the platform: the audit trail records digests, not handles.',
        );
      }
      if (!flags.yes) {
        if (json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 1, { compact: true });
          return;
        }
        const ok = await confirm(
          chalk.yellow(`  Delete ${plan.deletable.length} row(s) after writing the export? [y/N] `),
        );
        if (!ok) { printInfo('Aborted — nothing was written or deleted.'); return; }
      }

      // ── The export, written and READ BACK before anything is deleted ──────
      const doc = buildPreDeleteExport({
        plan,
        rawById,
        producedBy: `${this.config.bin} secret orphans --delete`,
      });
      let verified: PreDeleteExport;
      try {
        // Owner-only: this file holds cipher material.
        writeFileSync(exportPath!, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        // Read back rather than trusting the write. A write that reported
        // success and produced a short or unreadable file would leave the
        // delete with no record at all, which is the one outcome the export
        // exists to prevent — and it would look exactly like a clean run.
        verified = JSON.parse(readFileSync(exportPath!, 'utf8')) as PreDeleteExport;
      } catch (error) {
        const message =
          `Refusing to delete: the pre-delete export could not be written and read back at `
          + `${exportPath} — ${error instanceof Error ? error.message : String(error)}`;
        if (json) { await emitJson({ error: 'export_failed', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      const exported = new Set(verified.rows?.map((r) => r.id) ?? []);
      const missing = plan.deletable.filter((id) => !exported.has(id));
      if (missing.length > 0) {
        const message =
          `Refusing to delete: the export at ${exportPath} does not record ${missing.length} of the `
          + `${plan.deletable.length} row(s) to be deleted (${missing.join(', ')}).`;
        if (json) { await emitJson({ error: 'export_incomplete', message, missing }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }
      if (!json) printSuccess(`Pre-delete export written (owner-only): ${exportPath}`);

      // The union's driver port is READ-ONLY by construction, so the one write
      // this command performs is asked for separately and CHECKED — ⛔ never
      // cast onto the read port, which would erase exactly the property that
      // makes the union safe to depend on. A driver with no `delete` refuses
      // here, before the loop, rather than throwing partway through it.
      const deleting = asDeletingDriver(secretDriver);
      if (!deleting) {
        const message =
          'Refusing to delete: the driver serving `sys_secret` exposes no delete(). The export has '
          + `already been written to ${exportPath} and no row was removed.`;
        if (json) { await emitJson({ error: 'driver_cannot_delete', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      const deleted: string[] = [];
      const failed: Array<{ id: string; message: string }> = [];
      for (const id of plan.deletable) {
        try {
          await deleting.delete('sys_secret', id);
          deleted.push(id);
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : String(error) });
        }
      }

      if (json) {
        await emitJson(
          { mode: 'delete', export: exportPath, deleted, failed, plan },
          failed.length > 0 ? 1 : 0,
          { compact: true },
        );
        return;
      }
      printSuccess(`Deleted ${deleted.length} sys_secret row(s) in ${timer.display()}.`);
      for (const f of failed) printError(`  ${f.id}: ${f.message}`);
      printInfo(`Keep ${exportPath} until you are certain the sweep was correct — it is the only record.`);
      if (failed.length > 0) this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}

/**
 * The single WRITE verb this command needs, declared apart from the union's
 * read-only driver port so the two cannot be confused for one another.
 */
interface SecretDeleteDriverLike {
  delete(object: string, id: string): Promise<unknown>;
}

/** The driver, if it can delete. `null` is a refusal, never an assumption. */
export function asDeletingDriver(driver: unknown): SecretDeleteDriverLike | null {
  const candidate = driver as Partial<SecretDeleteDriverLike> | null | undefined;
  return candidate && typeof candidate.delete === 'function'
    ? (candidate as SecretDeleteDriverLike)
    : null;
}

/** Normalise a driver result (`T[]` or `{ data: T[] }` or a single row). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (!result) return [];
  const list = Array.isArray(result)
    ? result
    : Array.isArray((result as { data?: unknown }).data)
      ? (result as { data: unknown[] }).data
      : [result];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
}

/**
 * Read the host's declared datasource artefacts.
 *
 * ⛔ Throws rather than returning `[]` on anything it cannot read. An empty
 * array is the host STATING it has none; a file that does not parse is nobody
 * having answered, and the two must not converge — the whole point of the flag
 * is that only the host can answer for a datasource declared in code that
 * nothing ever installed.
 */
export function readDeclaredDatasources(path: string): DatasourceArtefactLike[] {
  const absolute = resolvePath(path);
  if (!existsSync(absolute)) {
    throw new Error(`--declared-datasources: no such file: ${absolute}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(
      `--declared-datasources: ${absolute} does not parse as JSON — `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { datasources?: unknown })?.datasources)
      ? (parsed as { datasources: unknown[] }).datasources
      : undefined;
  if (!list) {
    throw new Error(
      `--declared-datasources: ${absolute} must hold an array of datasource artefacts, or an `
      + 'object with a `datasources` array.',
    );
  }
  return list.filter((d): d is DatasourceArtefactLike => !!d && typeof d === 'object');
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

/** Render the plan for a human. Never prints cipher material. */
function renderPlan(plan: SysSecretSweepPlan): void {
  console.log(chalk.bold('\n  Reference union — one line per producer family'));
  for (const family of Object.values(plan.families)) {
    if (family.status === 'enumerated') {
      printSuccess(`${family.family}: enumerated, ${family.referenceCount} reference(s)`);
    } else {
      printError(`${family.family}: GAP — ${family.reason}`);
    }
  }

  console.log(chalk.bold('\n  sys_secret rows'));
  printInfo(
    `total ${plan.counts.total} · referenced ${plan.counts.referenced} · `
    + `deletable ${plan.counts.deletable} · withheld ${plan.counts.withheld}`,
  );
  for (const [cls, count] of Object.entries(plan.withheldByClass)) {
    if (count > 0) printInfo(`  withheld · ${cls}: ${count}`);
  }
  for (const row of plan.rows) {
    if (row.decision === 'referenced') continue; // the operator is acting on the rest
    const tag = row.decision === 'deletable' ? chalk.red('DELETABLE') : chalk.yellow('withheld ');
    console.log(`    ${tag} ${row.id}  (${row.namespace}.${row.key})`);
    console.log(chalk.dim(`      ${row.reason}`));
  }
  if (plan.legacyInlineRows.length > 0) {
    printWarning(`${plan.legacyInlineRows.length} sys_setting row(s) still hold inline ciphertext.`);
  }

  console.log(chalk.bold('\n  Read before acting'));
  for (const note of plan.notes) printWarning(note);
}
