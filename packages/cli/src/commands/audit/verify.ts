// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { AUDIT_CHECKPOINT_SIGNER_SERVICE } from '@objectstack/spec/contracts';
import type { AuditProofBundle, AuditVerifyReport } from '@objectstack/plugin-audit';
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
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import { examineArchiveTargets } from '../../utils/ledger-copy-archive.js';
import { oneShotCrypto, type OneShotCrypto } from '../../utils/one-shot-settings.js';

type VerifyOptions = Parameters<typeof import('@objectstack/plugin-audit').verifyAuditLedger>[0];
type Driver = ReturnType<VerifyOptions['engine']['getDriverForObject']>;

/** Human output lists this many rows that are not `unmodified`; `--json` lists every one. */
const ROWS_SHOWN = 100;

/** ISO-8601: a date, or a date and time with a zone. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** A signing key fingerprint: lowercase hex SHA-256 of the raw public key, as the check prints it. */
const FINGERPRINT = /^[0-9a-f]{64}$/;

/**
 * `os audit verify` — the live check of ADR-0154 D9: every chain of every
 * sealed object, recomputed from the hot store and the archive datasource and
 * judged against the signing keys this deployment vouches for only.
 *
 * It boots the stack the way the `os migrate audit-*` commands do — read-only
 * (`deferSchemaDdl`, `readOnlyProbe`), with the declared datasources connected
 * so a declared archive is reached — and opens the checkpoint seeds and the
 * signing keys' private halves through the crypto provider `os serve` seals
 * with (`oneShotCrypto`: the declaring plugin's, or the existing local data
 * key; it never mints one). A signing key is trusted only through its wrapped
 * private half: a key row nobody can open is named, and trusted by nothing.
 *
 * Every row a checkpoint lists reads `unmodified`, `modified`, `missing`,
 * `late`, `redacted` or `expired`; a row of a sealed window no trusted
 * checkpoint holds reads `late` and unsealed. It prints the fingerprints of
 * the keys it trusted, to publish out of band.
 *
 * `--out FILE` also writes the run's proof bundle
 * (`objectstack.audit.proof-bundle.v1`): the trusted public keys, the
 * checkpoints and amendments, and each judged row's leaf input — its value
 * columns as salted commitments only, never a value, salt or seed. It still
 * carries personal data: the clear columns (`user_id`, `actor`, `ip_address`,
 * `user_agent`, `tenant_id`) identify people, so a bundle is an export of the
 * ledger, handled as one and narrowed with `--org` / `--from` / `--to` (D9).
 * `--bundle FILE` re-judges such a bundle offline, with no boot and no
 * database, trusting only the keys named by `--trusted-key` fingerprints
 * (learnt out of band, at least one): never a key because the bundle carries
 * it. `--bundle` takes no `--out`, no boot flag and no scope flag (the bundle
 * keeps the scope of the run that wrote it); `--trusted-key` is for
 * `--bundle` only.
 *
 * Exit codes (D9): 0 when every chain, link and signature verifies and every
 * row is `unmodified`, `late` (sealed), `redacted` or `expired` — and when
 * nothing is sealed; 1 when any row is `modified`, `missing` or `late`
 * unsealed, or any chain fault was found; 2 for a usage error, a stack that
 * would not boot, a crypto provider that cannot open what is sealed, or an
 * archive datasource a sealed object declares that this boot did not connect.
 * Nothing is written.
 */
export default class AuditVerify extends Command {
  static override description =
    'Verify the sealed audit ledger (ADR-0154): recompute every checkpoint from the stored rows, hot and archived, ' +
    'check every link and signature against the trusted signing keys, and report each row unmodified, modified, ' +
    'missing, late, redacted or expired. Read-only. Exits 1 when anything does not verify.';

  static override examples = [
    '$ os audit verify',
    '$ os audit verify --org org_123 --org org_456',
    '$ os audit verify --from 2026-11-01 --to 2026-11-08 --json',
    '$ os audit verify --out ledger-proof.json',
    '$ os audit verify --bundle ledger-proof.json --trusted-key <fingerprint>',
  ];

  static override flags = {
    // The one-shot family's shared boot flag, declared as `os migrate audit-key-material` declares it.
    'database-url': Flags.string({
      description: 'Database URL to verify (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    org: Flags.string({
      description: "Check only this organization's chains (repeatable); without it, every chain, the deployment chain included",
      multiple: true,
    }),
    from: Flags.string({ description: 'Judge only rows of the windows from this ISO-8601 instant on' }),
    to: Flags.string({ description: 'Judge only rows of the windows before this ISO-8601 instant' }),
    json: Flags.boolean({ description: 'Print the machine-readable report' }),
    out: Flags.string({
      description:
        'Also write the proof bundle to this file. It is an export of the ledger and carries personal data (its clear columns ' +
        'identify people): handle it as the ledger, and narrow it with --org / --from / --to. Value columns appear only as ' +
        'commitments; no salt or seed',
    }),
    bundle: Flags.string({
      description: 'Verify this proof bundle offline instead of the live ledger: no boot, no database (requires --trusted-key)',
    }),
    'trusted-key': Flags.string({
      description: "A signing key fingerprint --bundle trusts (repeatable); the bundle's own keys are trusted only through these",
      multiple: true,
    }),
  };

  /**
   * The process ends when the check does, as the `os migrate audit-*` commands
   * end: the boot connects the declared datasources, and a pool it opened can
   * keep the event loop alive after the kernel reports a clean shutdown.
   */
  async run(): Promise<void> {
    await this.verify();
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  private async verify(): Promise<void> {
    const { flags } = await this.parse(AuditVerify);
    const json = flags.json === true;
    const timer = createTimer();

    // `--bundle` is the offline check: exclusive with booting and with `--out`,
    // and the only mode `--trusted-key` belongs to. `--database-url` counts only
    // when given on the command line: `$OS_DATABASE_URL` also fills it.
    const given = (flag: string) => this.argv.some((arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`));
    if (flags.bundle !== undefined) {
      if (flags.out !== undefined) await this.refuse(json, 'usage', '--bundle verifies a bundle offline; it cannot also write one (--out).');
      if (given('database-url')) await this.refuse(json, 'usage', '--bundle verifies offline and boots nothing: --database-url does not apply.');
      const scoped = (['org', 'from', 'to'] as const).filter((flag) => flags[flag] !== undefined);
      if (scoped.length > 0) {
        await this.refuse(
          json,
          'usage',
          `--bundle judges the scope of the run that wrote it: ${scoped.map((f) => `--${f}`).join(', ')} apply when it is written (--out).`,
        );
      }
      const keys = (flags['trusted-key'] ?? []).map((key) => key.trim().toLowerCase());
      if (keys.length === 0) {
        await this.refuse(
          json,
          'usage',
          '--bundle requires at least one --trusted-key FINGERPRINT, learnt out of band: the keys a bundle carries are never trusted on its word.',
        );
      }
      const bad = keys.find((key) => !FINGERPRINT.test(key));
      if (bad !== undefined) await this.refuse(json, 'usage', `--trusted-key '${bad}' is not a signing key fingerprint (64 hex digits).`);
      await this.verifyBundle(flags.bundle, keys, json, timer);
      return;
    }
    if (flags['trusted-key'] !== undefined) {
      await this.refuse(json, 'usage', '--trusted-key applies to --bundle only: the live check trusts the keys this deployment vouches for.');
    }

    const from = flags.from === undefined ? undefined : instant(flags.from);
    const to = flags.to === undefined ? undefined : instant(flags.to);
    if (from === null) await this.refuse(json, 'usage', `--from '${flags.from}' is not an ISO-8601 date or date-time.`);
    if (to === null) await this.refuse(json, 'usage', `--to '${flags.to}' is not an ISO-8601 date or date-time.`);
    if (from && to && !(from.getTime() < to.getTime())) {
      await this.refuse(json, 'usage', `--from (${from.toISOString()}) must be before --to (${to.toISOString()}).`);
    }
    if (flags.org?.some((org) => org.trim() === '')) await this.refuse(json, 'usage', '--org needs an organization id.');

    if (!json) printHeader('Audit · verify');

    // The provider `os serve` seals with, composed before the boot. It never
    // mints a key: a missing one is refused once something sealed needs opening.
    let crypto: OneShotCrypto;
    try {
      crypto = await oneShotCrypto();
    } catch (error) {
      await this.refuse(json, 'crypto_provider_refused', error instanceof Error ? error.message : String(error));
      return;
    }

    if (!json) printStep('Booting data stack (read-only)…');
    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        // The platform objects register `sys_secret`; plugin-audit registers the
        // ledger, the checkpoints and the signing keys.
        extraPlugins: [...(await buildDataMigrationPlugins({ audit: true })), ...crypto.plugins],
        // Connect the declared datasources as `os serve` does, so a declared
        // archive datasource is registered under its name.
        composeDeclaredDatasources: true,
        // Read-only, the boot `os migrate plan` takes: no DDL, no new file.
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error) {
      await this.refuse(json, 'boot_failed', error instanceof Error ? error.message : String(error));
      return;
    }

    try {
      const engine = stack.kernel.getService('objectql') as (IObjectQLEngine & VerifyOptions['engine']) | undefined;
      if (typeof engine?.getDriverForObject !== 'function' || typeof engine?.registry?.getAllObjects !== 'function') {
        await this.refuse(json, 'no_engine', 'No ObjectQL engine on this stack: the ledger cannot be read.');
        return;
      }
      const { verifyAuditLedger } = await import('@objectstack/plugin-audit');

      // Reads only: a table the read-only boot measured absent holds nothing and
      // is not read, and nothing is written through this view.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView = (driver: Driver): Driver => driver && {
        find: (object: string, query: Record<string, unknown>) => reads.rows(object, () => driver.find(object, query)),
        create: async () => {
          throw new Error('os audit verify writes nothing');
        },
      };
      const view: VerifyOptions['engine'] = {
        registry: engine.registry,
        getDriverForObject: (object) => readView(engine.getDriverForObject(object)),
      };

      const sealed = view.registry.getAllObjects()
        .filter((o) => Boolean((o.lifecycle as { seal?: unknown } | undefined)?.seal))
        .map((o) => o.name);
      const checkpointsStored = (await view.getDriverForObject('sys_audit_checkpoint')
        ?.find('sys_audit_checkpoint', { orderBy: [{ field: 'id', order: 'asc' }], limit: 1 })
        .catch(() => []))?.length ?? 0;

      // Each sealed object's declared archive: read when this boot connected
      // it, read as none when no datasource of that name exists, and the check
      // refused when one exists out of reach (every archived row would read missing).
      const archiveDrivers = new Map<string, Driver>();
      const archives = await examineArchiveTargets({
        engine,
        kernel: stack.kernel,
        reads: { find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)) },
        tables: sealed,
        run: async (driver, objects) => {
          for (const object of objects) archiveDrivers.set(object, driver as unknown as Driver);
          return { failures: 0 };
        },
      });
      const unreached = archives.filter((a) => a.status === 'not-connected' || a.status === 'unknown');
      if (unreached.length > 0) {
        await this.refuse(
          json,
          'archive_not_connected',
          unreached.map((a) =>
            `Archive datasource '${a.datasource}' (${a.objects.join(', ')}) is not connected on this boot` +
              `${a.connection ? ` (${a.connection.status}${a.connection.reason ? `: ${a.connection.reason}` : ''})` : ''}, ` +
              'so its archived rows cannot be read and every one would read missing. No verdict is given: make it ' +
              'reachable from where this command runs (declared in the stack config with `autoConnect: true`), and re-run.').join('\n'),
        );
        return;
      }
      const noArchive = new Set(archives.filter((a) => a.status === 'none').map((a) => a.datasource));

      // The provider the boot chose, confirmed as `os serve` confirms it. A
      // refusal stops the check only when something sealed needs opening.
      let refusal: string | null = crypto.key?.unavailable ?? null;
      try {
        crypto.provider.confirm();
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (refusal !== null && checkpointsStored > 0) {
        await this.refuse(
          json,
          'crypto_provider_refused',
          `The ledger holds checkpoints, and this run cannot open their seeds or signing keys: ${refusal} ` +
            'Run where the crypto provider `os serve` seals with is available.',
        );
        return;
      }

      // The trust anchor the sealer signs through: a host's `audit.checkpointSigner`, else the local key's.
      let trust: VerifyOptions['trust'];
      try {
        trust = stack.kernel.getService(AUDIT_CHECKPOINT_SIGNER_SERVICE) ?? undefined;
      } catch {
        trust = undefined;
      }

      let bundle: AuditProofBundle | undefined;
      const report = await verifyAuditLedger({
        engine: view,
        crypto: crypto.provider,
        ...(trust ? { trust } : {}),
        ...(flags.org ? { orgs: flags.org } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        archive: (datasource, object) => archiveDrivers.get(object) ?? (noArchive.has(datasource) ? 'none' : undefined),
        ...(flags.out !== undefined ? { onProofBundle: (written: AuditProofBundle) => { bundle = written; } } : {}),
      });

      // The bundle is written whatever the verdict: offline, it shows the same.
      const out = flags.out === undefined ? undefined : resolve(flags.out);
      if (out !== undefined) {
        try {
          await writeFile(out, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
          // `mode` applies only when the file is created: an overwritten one is narrowed too.
          await chmod(out, 0o600);
        } catch (error) {
          await this.refuse(json, 'bundle_write_failed', `The proof bundle could not be written to ${out}: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }

      if (json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, report, ...(out !== undefined ? { out } : {}), duration: timer.elapsed() });
        if (!report.ok) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      this.render(report);
      if (out !== undefined) {
        printSuccess(`Proof bundle written to ${out}. Check it offline with: os audit verify --bundle ${flags.out} --trusted-key <fingerprint>`);
        printWarning(
          'The bundle carries personal data: its clear columns (user, actor, IP address, user agent, organization) identify ' +
            'people. Keep and pass it on under the rules for the ledger it came from.',
        );
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (!report.ok) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      // The check did not finish: no verdict, so neither 0 nor 1.
      if (json) await emitJson({ error: 'verify_failed', message: error.message, ...errorCodeFields(error) }, 0, { compact: true });
      else printError(error.message || String(error));
      this.exit(2);
    } finally {
      await stack.shutdown();
    }
  }

  /**
   * Report a refusal that ends the run with 2: no verdict was given.
   *
   * Declared below `verify()` on purpose: `diff-usage-error-stream.e2e.test.ts`
   * judges by line position, and a print call between `run()` and the first
   * read of the `--json` flag is the shape it refuses, whatever branch guards it.
   */
  private async refuse(json: boolean, error: string, message: string): Promise<never> {
    if (json) await emitJson({ error, message }, 0, { compact: true });
    else printError(message);
    return this.exit(2);
  }

  /** The offline check of a proof bundle: no boot, no database, trust only through `keys`. */
  private async verifyBundle(path: string, keys: string[], json: boolean, timer: ReturnType<typeof createTimer>): Promise<void> {
    const file = resolve(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      const unreadable = !(error instanceof SyntaxError);
      await this.refuse(
        json,
        unreadable ? 'bundle_unreadable' : 'bundle_invalid',
        `${unreadable ? 'The proof bundle could not be read' : 'The proof bundle is not JSON'} (${file}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const { AuditProofBundleError, verifyAuditProofBundle } = await import('@objectstack/plugin-audit');
    let report: AuditVerifyReport;
    try {
      report = await verifyAuditProofBundle(parsed, { trustedKeys: keys });
    } catch (error) {
      if (error instanceof AuditProofBundleError) await this.refuse(json, 'bundle_invalid', `${file}: ${error.message}`);
      await this.refuse(json, 'verify_failed', error instanceof Error ? error.message : String(error));
      return;
    }
    if (json) {
      await emitJson({ bundle: file, report, duration: timer.elapsed() });
      if (!report.ok) this.exit(1);
      return;
    }
    printHeader('Audit · verify (offline proof bundle)');
    printInfo(`Bundle: ${chalk.white(file)}, written by the check of ${(parsed as AuditProofBundle).checked_at}`);
    this.render(report, true);
    console.log(chalk.dim(`  ${timer.display()}`));
    console.log('');
    if (!report.ok) this.exit(1);
  }

  private render(report: AuditVerifyReport, offline = false): void {
    console.log('');
    if (!report.sealed) {
      printSuccess('Nothing is sealed: no object declares lifecycle.seal and no checkpoint is stored, so there is nothing to verify.');
      return;
    }
    const scope = [
      report.scope.orgs ? `organization(s) ${report.scope.orgs.join(', ')}` : 'every chain, the deployment chain included',
      report.scope.from || report.scope.to ? `rows of the windows ${report.scope.from ?? '…'} to ${report.scope.to ?? '…'}` : null,
    ].filter(Boolean).join('; ');
    console.log(`  Sealed object(s): ${report.objects.join(', ')}`);
    console.log(`  Scope: ${scope}`);
    console.log('');
    console.log(offline ? '  Signing keys trusted (--trusted-key):' : '  Trusted signing keys (publish these fingerprints out of band):');
    if (report.keys.trusted.length === 0) console.log(chalk.dim('    none'));
    for (const key of report.keys.trusted) console.log(`    ${chalk.white(key)}`);
    if (report.keys.untrusted.length > 0) {
      console.log(chalk.red('  Keys records name that no trusted key matches:'));
      for (const key of report.keys.untrusted) console.log(`    ${chalk.red(key)}`);
      if (report.keys.trusted.length === 0 && offline) {
        printWarning('No --trusted-key fingerprint names a key this bundle\'s records were signed with.');
      } else if (report.keys.trusted.length === 0) {
        printWarning(
          'No signing key opened with this run\'s crypto provider. If it is not the provider `os serve` seals with, ' +
            'the faults below say so, not that the ledger was changed.',
        );
      }
    }
    console.log('');
    for (const chain of report.chains) {
      const c = chain.counts;
      const parts = [
        `${c.unmodified} unmodified`,
        c.late ? `${c.late} late${c.unsealed ? ` (${c.unsealed} unsealed)` : ''}` : null,
        c.redacted ? `${c.redacted} redacted` : null,
        c.expired ? `${c.expired} expired` : null,
        c.modified ? chalk.red(`${c.modified} modified`) : null,
        c.missing ? chalk.red(`${c.missing} missing`) : null,
      ].filter(Boolean);
      console.log(`  ${chalk.white(chain.object)} ${chain.chain}: ${chain.checkpoints} checkpoint(s), ${parts.join(', ')}`);
    }
    if (report.rows.length > 0) {
      console.log('');
      console.log('  Rows that are not unmodified:');
      for (const row of report.rows.slice(0, ROWS_SHOWN)) {
        const verdict = row.verdict === 'late' && !row.sealed ? 'late, unsealed' : row.verdict;
        const failing = row.verdict === 'modified' || row.verdict === 'missing' || !row.sealed;
        const where = row.sequence === null ? 'no trusted checkpoint holds it' : `checkpoint ${row.sequence}`;
        console.log(`    ${failing ? chalk.red(verdict) : verdict}  ${row.object} ${row.chain} ${row.row} (${where})`);
      }
      if (report.rows.length > ROWS_SHOWN) {
        console.log(chalk.dim(`    … and ${report.rows.length - ROWS_SHOWN} more; --json lists every row.`));
      }
    }
    if (report.dangling.length > 0) {
      console.log('');
      console.log('  Redaction amendments whose rewrite never landed (the rows hold the sealed value):');
      for (const d of report.dangling) console.log(`    ${d.object} ${d.chain} ${d.row}.${d.column} (amendment ${d.amendment}, checkpoint ${d.sequence})`);
    }
    if (report.faults.length > 0) {
      console.log('');
      console.log(chalk.red('  Chain faults:'));
      for (const f of report.faults) console.log(`    ${chalk.red(f.kind)}  ${f.object} ${f.chain}: ${f.message}`);
    }
    console.log('');
    const t = report.totals;
    if (report.ok) {
      printSuccess(
        `The sealed ledger verifies: ${t.unmodified} unmodified, ${t.late} late, ${t.redacted} redacted, ${t.expired} expired, ` +
          'every link and signature under a trusted key.',
      );
    } else {
      printError(
        `The sealed ledger does NOT verify: ${t.modified} modified, ${t.missing} missing, ${t.unsealed} late and unsealed, ` +
          `${report.faults.length} chain fault(s).`,
      );
    }
  }
}

/** An ISO-8601 date or date-time as an instant, or `null` when it is neither. */
function instant(text: string): Date | null {
  if (!ISO_8601.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}
