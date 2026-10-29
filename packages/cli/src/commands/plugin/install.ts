// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin install ./x.osplugin` — verify a built plugin artifact and
 * install it into this environment (ADR-0025 §3.5 steps 4–6, M1: the local T0
 * loop, first-party / self-signed plugins only).
 *
 *   1. Read the archive and its compiled `objectstack.plugin.json`; refuse an
 *      entry that could land outside the install directory.
 *   2. Re-verify every file against the manifest's `integrity` map; refuse a
 *      digest mismatch, a declared file that is missing, or a file the map
 *      does not declare.
 *   3. Verify the detached signature (`<artifact>.sig`, from `os plugin sign`)
 *      over the whole artifact. Its key id is resolved in this environment's
 *      trusted keys (`sys_trusted_key`, through a READ-ONLY one-shot boot of
 *      the environment's database), and the bytes are verified with that key by
 *      `verifyPluginArtifact`. Refused by name: no signature, a malformed one,
 *      a key id this environment does not trust, a revoked key id, and a
 *      signature that does not match the bytes.
 *   4. Before anything is written, read this project's installation records
 *      (refusing a file it cannot read, which a write would clobber) and
 *      refuse an install directory that already holds other bytes no record
 *      of this project owns: two projects sharing one `OS_HOME` and one
 *      environment id share the directory, and one must not overwrite the
 *      other's install.
 *   5. Materialize to `<OS_HOME>/plugins/<env>/<id>/<version>/`, keeping the
 *      original artifact and its signature beside the unpacked files.
 *   6. Record the installation — key id and fingerprint included — in the
 *      local installation store (`@objectstack/runtime`).
 *
 * `--trust-unsigned` is the explicit, loud dev override for an artifact that
 * carries NO signature. ⛔ It never relaxes a signature that is present: a
 * malformed or failing signature, or one whose key id is unknown or revoked,
 * is refused with or without it. There is no "unsigned with a warning" arm
 * without the flag.
 *
 * Writes no database row in any mode. M1 is first-party / self-signed only and
 * is listed on no marketplace surface: a T0 plugin is author code in the host
 * process (ADR-0025 §3.6).
 */

import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import {
  formatIntegrityViolation,
  parseSignature,
  verifyIntegrity,
  verifyPluginArtifact,
} from '@objectstack/core';
import {
  DEFAULT_PLUGIN_ENVIRONMENT_ID,
  TRUSTED_KEY_OBJECT,
  loadPluginInstallations,
  pluginInstallDir,
  recordPluginInstallation,
  resolveTrustedKey,
  type PluginInstallationRecord,
  type TrustedKeyResolution,
} from '@objectstack/runtime';
import {
  emitJson,
  isExitSignal,
  printError,
  printHeader,
  printKV,
  printStep,
  printSuccess,
  printWarningToStderr,
} from '../../utils/format.js';
import { MANIFEST_FILENAME, SIGNATURE_FILENAME, readTarGz, sha256Hex, type ArchiveFile } from '../../utils/osplugin.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import { NO_TRUST_STORE_ENGINE, trustStoreEngine, trustStorePlugins } from '../../utils/plugin-trust-store.js';
import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  archiveEntryProblems,
  installedArtifactSha,
  materializePlugin,
} from '../../utils/plugin-install.js';

/** One refusal: a machine-readable name and the sentence an operator reads. */
interface Refusal {
  error: string;
  message: string;
  details?: string[];
}

export default class PluginInstall extends Command {
  static override description =
    'Verify a built .osplugin (signature against this environment\'s trusted keys, per-file integrity) and install it (ADR-0025 §3.5)';

  static override examples = [
    '$ os plugin install ./com.acme.stripe-1.0.0.osplugin',
    '$ os plugin install ./x.osplugin --sig ./x.osplugin.sig',
    '$ os plugin install ./x.osplugin --trust-unsigned   # dev only: an artifact with no signature',
  ];

  static override args = {
    artifact: Args.string({ description: 'Path to the .osplugin artifact', required: true }),
  };

  static override flags = {
    sig: Flags.string({ description: 'Path to the detached signature (default: <artifact>.sig)' }),
    'trust-unsigned': Flags.boolean({
      description:
        'DEV ONLY: install an artifact that carries no signature. Logged loudly and recorded on the installation. '
        + 'Never relaxes a signature that is present.',
      default: false,
    }),
    'database-url': Flags.string({
      description: "The environment's database, where its trusted keys live (defaults to $OS_DATABASE_URL / the project DB)",
      env: 'OS_DATABASE_URL',
    }),
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginInstall);
    const json = flags.json;
    if (!json) printHeader('Install Plugin');

    const refuse = async (r: Refusal): Promise<void> => {
      if (json) {
        await emitJson(r, 1, { compact: true });
        return;
      }
      printError(r.message);
      for (const line of r.details ?? []) console.log(`    • ${line}`);
      this.exit(1);
    };

    // 1. The archive and its manifest. ─────────────────────────────────
    const artifactPath = resolvePath(process.cwd(), args.artifact);
    if (!existsSync(artifactPath)) {
      await refuse({ error: 'artifact_not_found', message: `Artifact not found: ${args.artifact}` });
      return;
    }
    let bytes: Uint8Array;
    let files: ArchiveFile[];
    try {
      if (!statSync(artifactPath).isFile()) throw new Error('not a regular file');
      bytes = new Uint8Array(await readFile(artifactPath));
      files = readTarGz(bytes);
    } catch (error) {
      await refuse({
        error: 'artifact_unreadable',
        message: `${args.artifact} is not a readable .osplugin (gzipped tar): ${(error as Error).message}`,
      });
      return;
    }
    const entryProblems = archiveEntryProblems(files);
    if (entryProblems.length > 0) {
      await refuse({
        error: 'artifact_entries_refused',
        message: `${args.artifact} has ${entryProblems.length} entr${entryProblems.length === 1 ? 'y' : 'ies'} that cannot be unpacked safely; nothing was installed:`,
        details: entryProblems,
      });
      return;
    }
    let manifest: Record<string, any>;
    try {
      const entry = files.find((f) => f.path === MANIFEST_FILENAME);
      if (!entry) throw new Error(`${MANIFEST_FILENAME} not found in the artifact`);
      const parsed = JSON.parse(Buffer.from(entry.data).toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${MANIFEST_FILENAME} is not a JSON object`);
      manifest = parsed as Record<string, any>;
    } catch (error) {
      await refuse({ error: 'manifest_unreadable', message: `Cannot read the artifact's manifest: ${(error as Error).message}` });
      return;
    }
    const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
    if (!id || !version) {
      await refuse({ error: 'manifest_incomplete', message: 'The artifact manifest is missing `id` or `version`. Rebuild it with `os plugin build`.' });
      return;
    }
    const environmentId = process.env.OS_ENVIRONMENT_ID?.trim() || DEFAULT_PLUGIN_ENVIRONMENT_ID;
    let installDir: string;
    try {
      installDir = pluginInstallDir(environmentId, id, version);
    } catch (error) {
      await refuse({ error: 'manifest_unsafe_identity', message: (error as Error).message });
      return;
    }
    if (!json) printStep(`${id}@${version} (${(bytes.byteLength / 1024).toFixed(1)} KB, runtime: ${manifest.runtime ?? 'unset'})`);

    // 2. Per-file integrity, re-verified at unpack (ADR-0025 §3.2). ─────
    const declaredIntegrity = manifest.integrity;
    if (
      declaredIntegrity !== undefined && declaredIntegrity !== null
      && (typeof declaredIntegrity !== 'object' || Array.isArray(declaredIntegrity))
    ) {
      await refuse({
        error: 'integrity_malformed',
        message: 'The artifact manifest has a malformed `integrity` map (expected an object of path → digest). Rebuild it with `os plugin build`.',
      });
      return;
    }
    const integrity = verifyIntegrity(files, declaredIntegrity as Record<string, string> | undefined, {
      exempt: [MANIFEST_FILENAME, SIGNATURE_FILENAME],
    });
    if (!integrity.ok) {
      await refuse({
        error: 'integrity_mismatch',
        message:
          `Integrity check failed — the artifact's files do not match its manifest \`integrity\` digests `
          + `(${integrity.violations.length} violation${integrity.violations.length === 1 ? '' : 's'}); nothing was installed:`,
        details: integrity.violations.map((v) => formatIntegrityViolation(v)),
      });
      return;
    }

    // 3. The signature, against this environment's trusted keys. ────────
    const sigPath = resolvePath(process.cwd(), flags.sig ?? `${args.artifact}.sig`);
    let signature: string | null = null;
    if (existsSync(sigPath)) {
      // A signature that is there but cannot be read is refused, never taken
      // for an absent one: --trust-unsigned must not install around it.
      try {
        if (!statSync(sigPath).isFile()) throw new Error('not a regular file');
        signature = (await readFile(sigPath, 'utf-8')).trim();
      } catch (error) {
        await refuse({
          error: 'signature_unreadable',
          message: `Cannot read the signature ${sigPath}: ${(error as Error).message}. Nothing was installed.`,
        });
        return;
      }
    } else if (flags.sig) {
      await refuse({ error: 'signature_not_found', message: `Signature not found: ${flags.sig}` });
      return;
    }

    let trusted: { keyId: string; fingerprint: string } | null = null;
    if (signature === null) {
      if (!flags['trust-unsigned']) {
        await refuse({
          error: 'signature_missing',
          message:
            `${args.artifact} carries no signature (no ${flags.sig ?? `${args.artifact}.sig`}), so it was not installed. `
            + 'Sign it with `os plugin sign --key PATH.key.pem --key-id ID` and trust that key with '
            + '`os plugin trust add PATH.pub.pem --key-id ID`, or pass --trust-unsigned to install it unsigned (dev only).',
        });
        return;
      }
      printWarningToStderr(
        `--trust-unsigned: installing ${id}@${version} WITHOUT a signature. Nothing proves who built these bytes; `
          + 'the installation record keeps this override. Dev use only.',
      );
    } else {
      const parsed = parseSignature(signature);
      if (!parsed) {
        await refuse({
          error: 'signature_malformed',
          message: `The signature in ${sigPath} is malformed (expected the \`ed25519:KEYID:SIG\` that \`os plugin sign\` writes); nothing was installed.`,
        });
        return;
      }
      if (flags['trust-unsigned'] && !json) {
        printStep('--trust-unsigned has no effect here: the artifact carries a signature, and a present signature is always verified.');
      }

      const resolved = await this.resolveKey(parsed.keyId, flags['database-url'], json);
      if ('error' in resolved) {
        await refuse(resolved);
        return;
      }
      if (resolved.verdict === 'unknown') {
        await refuse({
          error: 'signature_key_untrusted',
          message:
            `The artifact is signed with key id '${parsed.keyId}', which this environment does not trust; nothing was installed. `
            + `Trust the publisher's public key first: \`os plugin trust add PUB.pem --key-id ${parsed.keyId}\`.`,
        });
        return;
      }
      if (resolved.verdict === 'revoked') {
        await refuse({
          error: 'signature_key_revoked',
          message: `The artifact is signed with key id '${parsed.keyId}', which was revoked in this environment (${resolved.row.fingerprint}); nothing was installed.`,
        });
        return;
      }
      if (resolved.verdict === 'invalid') {
        await refuse({
          error: 'trusted_key_invalid',
          message: `The trusted key '${parsed.keyId}' cannot verify anything: ${resolved.message}. Nothing was installed.`,
        });
        return;
      }
      const publicKey = resolved.publicKey;
      let verdict;
      try {
        verdict = await verifyPluginArtifact(
          { artifact: bytes, version: { package_id: id, version, signature } },
          {
            getPublisherPublicKey: (keyId) => (keyId === parsed.keyId ? publicKey : null),
            // M1 is local: no marketplace counter-signature exists for a self-signed artifact.
            requirePlatform: false,
          },
        );
      } catch (error) {
        await refuse({ error: 'signature_verification_failed', message: `Signature verification failed: ${(error as Error).message}` });
        return;
      }
      if (!verdict.ok || !verdict.publisherVerified) {
        await refuse({
          error: 'signature_invalid',
          message:
            `The signature does not verify against the trusted key '${parsed.keyId}' (${verdict.reason ?? 'not verified'}): `
            + 'these are not the bytes that key signed. Nothing was installed.',
        });
        return;
      }
      trusted = { keyId: parsed.keyId, fingerprint: resolved.row.fingerprint };
    }

    // 4. Before anything is written. ──────────────────────────────────
    let installations: PluginInstallationRecord[];
    try {
      installations = loadPluginInstallations(environmentId);
    } catch (error) {
      await refuse({ error: 'record_unreadable', message: `${(error as Error).message} Nothing was installed.` });
      return;
    }
    const artifactSha = sha256Hex(bytes);
    const presentSha = installedArtifactSha(installDir);
    if (
      presentSha !== undefined
      && presentSha !== artifactSha
      && !installations.some((r) => r.id === id && r.dir === installDir && r.artifact?.sha256 === presentSha)
    ) {
      await refuse({
        error: 'install_dir_taken',
        message:
          `${installDir} already holds ${id}@${version} `
          + (presentSha === null ? `with no readable ${INSTALLED_ARTIFACT_FILE}` : `built from other bytes (artifact sha256 ${presentSha})`)
          + ', and no installation of this project put it there: another project sharing this OS_HOME and environment did, '
          + 'or something else wrote it. Nothing was installed. Give this project its own environment (OS_ENVIRONMENT_ID) '
          + 'or home (OS_HOME), or publish the change under a new version.',
      });
      return;
    }

    // 5. Materialize. 6. Record. ───────────────────────────────────────
    let replaced: boolean;
    try {
      ({ replaced } = materializePlugin({ dir: installDir, files, artifact: bytes, signature }));
    } catch (error) {
      await refuse({ error: 'materialize_failed', message: `Cannot write ${installDir}: ${(error as Error).message}` });
      return;
    }
    const permissions = manifest.permissions;
    const record: PluginInstallationRecord = {
      id,
      version,
      versionId: `${id}@${version}`,
      runtime: typeof manifest.runtime === 'string' ? manifest.runtime : null,
      status: 'installed',
      grantedPermissions: permissions && typeof permissions === 'object' && !Array.isArray(permissions) ? permissions : null,
      dir: installDir,
      artifact: { file: INSTALLED_ARTIFACT_FILE, sha256: artifactSha },
      signatureFile: signature === null ? null : INSTALLED_SIGNATURE_FILE,
      signature: trusted,
      trustUnsigned: signature === null,
      installedAt: new Date().toISOString(),
    };
    try {
      recordPluginInstallation(environmentId, record);
    } catch (error) {
      await refuse({
        error: 'record_failed',
        message: `${installDir} was written, but the installation was not recorded: ${(error as Error).message}`,
      });
      return;
    }

    if (json) {
      await emitJson({ installed: record, replaced, integrity: { checked: integrity.checked, skipped: integrity.skipped } }, 0, { compact: true });
      return;
    }
    printSuccess(`Installed ${id}@${version}${replaced ? ' (replaced the copy installed before)' : ''}`);
    printKV('  Directory', installDir);
    printKV('  Environment', environmentId);
    printKV(
      '  Integrity',
      integrity.skipped
        ? 'no `integrity` map in the manifest — per-file check skipped'
        : `${integrity.checked} file(s) verified against the manifest digests`,
    );
    printKV('  Signature', trusted ? `verified with trusted key '${trusted.keyId}' (${trusted.fingerprint})` : 'NONE — installed under --trust-unsigned');
    printStep('`os serve` does not load installed plugins yet: the boot-time loader is the next step of this install loop.');
  }

  /**
   * Resolve `keyId` in the environment's `sys_trusted_key` through the
   * READ-ONLY one-shot boot. A table the boot measured absent has never
   * trusted a key, so the key is unknown there.
   */
  private async resolveKey(
    keyId: string,
    databaseUrl: string | undefined,
    json: boolean,
  ): Promise<TrustedKeyResolution | Refusal> {
    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl,
        extraPlugins: await trustStorePlugins(false),
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error) {
      return { error: 'boot_failed', message: error instanceof Error ? error.message : String(error) };
    }
    try {
      const engine = trustStoreEngine(stack);
      if (!engine) return { error: 'no_engine', message: NO_TRUST_STORE_ENGINE };
      const reads = absentTableReads(stack);
      if (reads.absent(TRUSTED_KEY_OBJECT)) {
        reads.notice(json);
        return { verdict: 'unknown' };
      }
      return await resolveTrustedKey(engine, keyId);
    } catch (error) {
      if (isExitSignal(error)) throw error;
      return {
        error: 'trusted_keys_unreadable',
        message: `Cannot read this environment's trusted keys: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      await stack.shutdown();
    }
  }
}
