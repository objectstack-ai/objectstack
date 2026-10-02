// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
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
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import type {
  DatasourceArtefactLike,
  SecretReferenceEngineLike,
} from '../../utils/secret-reference-union.js';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import type {
  RewrapSecretRow,
  SysSecretRewrapReport,
} from '../../utils/sys-secret-rewrap.js';
import { readDeclaredDatasources } from './orphans.js';

/**
 * `os secret rewrap` — the at-rest re-wrap of version-1 `sys_secret`
 * ciphertext, ADR-0128 §4.2.
 *
 * Every new seal binds its producer's scope into a versioned AAD (ADR-0128
 * D1–D3). A ciphertext sealed before that keeps the older binding over
 * `(namespace, key)` alone until it is re-wrapped. This command re-wraps it
 * through `rotateKey`, the seam §4 names, under the scope of the producer
 * whose holder references the row. `utils/sys-secret-rewrap.ts` holds the
 * planning, the per-row steps and the reasons, and this file does the I/O.
 *
 * - **A dry run by default.** It boots read-only (the `os migrate plan` boot),
 *   opens, re-seals and verifies every attributed row in memory, prints
 *   classes and counts, and writes nothing. `--apply` writes.
 * - **Never run for you.** Nothing on any boot or upgrade path invokes it, and
 *   it must not grow such a caller.
 * - **Operator-only.** ⛔ No HTTP surface, so no refusal here answers a
 *   request (ADR-0112).
 * - **Classes and counts only.** ⛔ It never prints a plaintext, a ciphertext,
 *   key material, or a row id beside its holder.
 *
 * ## The key
 *
 * Rows open only under the key that sealed them, so the provider is resolved
 * from a key that ALREADY exists: `OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY`, or the
 * persisted key file, the way every host resolves it. It is constructed in the
 * strict posture and with the auto-key opt-in withheld, whatever `NODE_ENV`
 * says, so this command never mints a key: a minted key can open nothing that
 * is stored. It is resolved before the boot and handed to the settings
 * service the boot composes, so no provider in this run mints a key. No key is
 * a refusal, before any row is opened. The provider is `LocalCryptoProvider`,
 * the one every in-tree host constructs.
 */
export default class SecretRewrap extends Command {
  static override description =
    'Re-wrap version-1 `sys_secret` ciphertext under the current AAD derivation, each row under the '
    + 'scope of the producer that holds it. A dry run by default: it writes nothing without --apply.';

  static override examples = [
    '<%= config.bin %> secret rewrap --no-declared-datasources',
    '<%= config.bin %> secret rewrap --json --no-declared-datasources',
    '<%= config.bin %> secret rewrap --declared-datasources ./datasources.json',
    '<%= config.bin %> secret rewrap --apply --no-declared-datasources',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to re-wrap (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description:
        'Write the re-wrapped rows (default is a dry run that writes nothing). Refuses whenever a '
        + 'holder family could not be enumerated.',
      default: false,
    }),
    'declared-datasources': Flags.string({
      description:
        'Path to a JSON file listing the datasource artefacts this host declares IN CODE (an array, '
        + 'or {"datasources": [...]}). Only the host can answer for a datasource nothing installed.',
      exclusive: ['no-declared-datasources'],
    }),
    'no-declared-datasources': Flags.boolean({
      description:
        'State that this host declares NO code-defined datasources. Saying nothing leaves the '
        + 'datasource family a gap, and --apply is refused.',
      default: false,
      exclusive: ['declared-datasources'],
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    json: Flags.boolean({
      description: 'Output as JSON (implies non-interactive; requires --yes to apply)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretRewrap);
    const timer = createTimer();
    const json = flags.json;
    const mode: 'dry-run' | 'apply' = flags.apply ? 'apply' : 'dry-run';

    if (!json) printHeader('Secret · re-wrap version-1 sys_secret ciphertext');

    // The host's answer for the datasource family, read BEFORE the boot. A
    // file that does not parse is nobody having answered, never `[]`.
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

    if (!json) printStep(flags.apply ? 'Booting (APPLY mode)…' : 'Booting (dry run)…');

    // Loaded at the point of use, never at module load: oclif imports every
    // command module on every invocation while building its table.
    const { collectSecretReferenceUnion } = await import('../../utils/secret-reference-union.js');
    const {
      asCompareAndSetWriter,
      buildRewrapReport,
      executeSysSecretRewrap,
      planSysSecretRewrap,
      rewrapUnfinished,
    } = await import('../../utils/sys-secret-rewrap.js');
    const { ciphertextDerivationStatus, LocalCryptoProvider, SettingsServicePlugin } =
      await import('@objectstack/service-settings');
    const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');

    // ── The provider, resolved BEFORE the boot, from a key that already exists ──
    // The strict posture never mints a key, and the auto-key opt-in is
    // withheld. A missing key is refused only once the plan has a row to open,
    // so a run with nothing to open still reports.
    let provider: (ICryptoProvider & { keySource: string }) | null = null;
    let keyUnavailable: string | null = null;
    try {
      provider = new LocalCryptoProvider({
        mode: 'production',
        env: { ...process.env, OS_CRYPTO_AUTOKEY: undefined },
      });
    } catch (error) {
      keyUnavailable = error instanceof Error ? error.message : String(error);
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        // The composition `os secret orphans` boots: the platform objects
        // register `sys_secret` and the holder objects, and the settings
        // service registers `sys_setting`, the settings family's holder. The
        // settings service is handed THIS run's provider, so it does not
        // construct one of its own: in a development posture with no key, its
        // default would mint a key file, and the next run would then resolve a
        // key under which nothing stored opens. With no key, it is handed one
        // that refuses every call. Nothing in this one-shot boot reads a
        // setting's value.
        extraPlugins: [
          new PlatformObjectsPlugin(),
          new SettingsServicePlugin({
            registerRoutes: false,
            cryptoProvider: provider ?? refusingCryptoProvider(keyUnavailable ?? 'no data key'),
          }),
        ],
        // The dry run boots READ-ONLY, the boot `os migrate plan` takes.
        // `--apply` keeps the plain boot: it writes rows.
        ...(flags.apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
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
        const message = 'No ObjectQL engine on this runtime, so no holder family can be enumerated.';
        if (json) { await emitJson({ error: 'no_engine', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      const secretDriver = engine.getDriverForObject('sys_secret');
      if (!secretDriver) {
        const message = 'No driver resolves for `sys_secret`, so its rows could not be read.';
        if (json) { await emitJson({ error: 'no_sys_secret_driver', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      // Read at DRIVER level and UNSCOPED, as the union reads its holders: a
      // row missing from this read is a row the run never mentions.
      const secrets: RewrapSecretRow[] = (await secretDriver.find('sys_secret', {})).map((r) => ({
        id: String(r.id),
        namespace: String(r.namespace ?? ''),
        key: String(r.key ?? ''),
        kms_key_id: r.kms_key_id,
        alg: r.alg,
        version: r.version,
        ciphertext: r.ciphertext,
      }));

      const union = await collectSecretReferenceUnion({ engine, declaredDatasources });
      const plan = planSysSecretRewrap({ secrets, union, derivationOf: ciphertextDerivationStatus });

      // ── --apply: refusals that come before any row is opened ─────────────
      // An incomplete union settles every version-1 row as left at planning
      // time (`attempts` is 0), so this run opens nothing and only counts.
      if (flags.apply && plan.refusal) {
        const report = buildRewrapReport({
          mode,
          plan,
          result: await executeSysSecretRewrap({
            plan,
            provider: null,
            derivationOf: ciphertextDerivationStatus,
            writer: null,
          }),
          keySource: null,
        });
        if (json) { await emitJson({ error: 'union_incomplete', refused: plan.refusal, report }, 1, { compact: true }); return; }
        renderReport(report);
        printError(plan.refusal.message);
        for (const gap of plan.refusal.gaps) printError(`  family '${gap.family}': ${gap.reason}`);
        this.exit(1);
        return;
      }

      const writer = flags.apply ? asCompareAndSetWriter(secretDriver) : null;
      if (flags.apply && plan.attempts > 0 && !writer) {
        const message =
          'Refusing to re-wrap: the driver serving `sys_secret` exposes no updateMany(), so a row cannot '
          + 'be written conditionally on the ciphertext this run read. Without that, a value a producer '
          + 'wrote during the run could be overwritten. No row was opened or written.';
        if (json) { await emitJson({ error: 'driver_cannot_compare_and_set', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      // ── A row to open needs a key that already existed before this run ───
      if (plan.attempts > 0 && !provider) {
        const message =
          'Refusing to re-wrap: no existing data key was found (OS_SECRET_KEY, OS_DEV_CRYPTO_KEY or the '
          + 'persisted key file), and a key minted now could open nothing that is stored. Run this with '
          + 'the key the deployment seals with. No row was opened or written. Cause: '
          + `${keyUnavailable ?? 'no provider'}`;
        if (json) { await emitJson({ error: 'crypto_key_unavailable', message }, 1, { compact: true }); return; }
        printError(message);
        this.exit(1);
        return;
      }

      if (flags.apply && plan.attempts > 0 && !flags.yes) {
        if (json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 1, { compact: true });
          return;
        }
        const ok = await confirm(
          chalk.yellow(`  Open, re-seal, verify and write up to ${plan.attempts} sys_secret row(s)? [y/N] `),
        );
        if (!ok) { printInfo('Aborted — nothing was opened or written.'); return; }
      }

      const result = await executeSysSecretRewrap({
        plan,
        provider,
        derivationOf: ciphertextDerivationStatus,
        writer,
      });
      const report = buildRewrapReport({
        mode,
        plan,
        result,
        keySource: plan.attempts > 0 ? provider?.keySource ?? null : null,
      });
      const exitCode = flags.apply && rewrapUnfinished(result) ? 1 : 0;

      if (json) { await emitJson({ mode, report }, exitCode, { compact: true }); return; }
      renderReport(report);
      if (flags.apply) {
        printSuccess(`Re-wrapped ${report.counts.rewrap} sys_secret row(s) in ${timer.display()}.`);
      } else {
        printInfo(`Dry run — nothing was written. (${timer.display()})`);
      }
      if (exitCode !== 0) this.exit(exitCode);
    } catch (error) {
      // A read the run could not make is a refusal, and under `--json` a
      // refusal is still one JSON document. The dry run boots read-only, so a
      // database that lacks a table it reads is refused here.
      if (isExitSignal(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (json) { await emitJson({ error: 'scan_failed', message, ...errorCodeFields(error) }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}

/**
 * The provider this run hands the settings service when no data key exists:
 * every call refuses with the reason. Composed so the service never builds a
 * default provider of its own, which in a development posture mints a key.
 */
function refusingCryptoProvider(reason: string): ICryptoProvider {
  const refuse = (): never => {
    throw new Error(`No data key is available to this run, so nothing may be sealed or opened: ${reason}`);
  };
  return {
    encrypt: async () => refuse(),
    decrypt: async () => refuse(),
    rotateKey: async () => refuse(),
    digest: () => refuse(),
    keyedDigest: async () => refuse(),
  };
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

/** Render the report for a human. Classes and counts only. */
function renderReport(report: SysSecretRewrapReport): void {
  console.log(chalk.bold('\n  Reference union — one line per holder family'));
  for (const [family, status] of Object.entries(report.families)) {
    if (status.status === 'enumerated') {
      printSuccess(`${family}: enumerated, ${status.referenceCount} reference(s)`);
    } else {
      printError(`${family}: GAP — ${status.reason}`);
    }
  }

  const c = report.byClass;
  const s = report.rewrapByScope;
  console.log(chalk.bold(`\n  sys_secret rows (${report.mode})`));
  printInfo(`total ${report.counts.total}`);
  printInfo(
    `${report.mode === 'apply' ? 're-wrapped' : 'would re-wrap'} ${report.counts.rewrap} `
    + `(settings ${s.settings} · object_secret_field ${s.object_secret_field} · `
    + `datasource_credential ${s.datasource_credential})`,
  );
  printInfo(`done (already current) ${report.counts.done}`);
  printInfo(
    `left ${report.counts.left} (orphan ${c.left_orphan} · conflicting scope ${c.left_conflicting_scope} · `
    + `union incomplete ${c.left_union_incomplete})`,
  );
  printInfo(
    `refused ${report.counts.refused} (unreadable ${c.refused_unreadable} · unknown derivation `
    + `${c.refused_unknown_derivation} · verify failed ${c.refused_verify_failed})`,
  );
  if (report.mode === 'apply') {
    printInfo(
      `not written ${report.counts.notWritten} (changed during the run ${c.write_conflict} · write failed `
      + `${c.write_failed})`,
    );
  }
  if (report.keySource) printInfo(`data key source: ${report.keySource}`);

  console.log(chalk.bold('\n  Read before acting'));
  for (const note of report.notes) printWarning(note);
}
