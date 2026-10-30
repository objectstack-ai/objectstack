// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin install ./x.osplugin` — verify a built plugin artifact and
 * install it into this environment (ADR-0025 §3.5 steps 4–6, M1: the local T0
 * loop, first-party / self-signed plugins only).
 *
 *   1. Verify the detached signature (`<artifact>.sig`, from `os plugin sign`)
 *      over the whole artifact, BEFORE anything is inflated: a signature
 *      covers the compressed bytes, so nothing an untrusted key produced
 *      reaches gunzip. Its key id is resolved in this environment's trusted
 *      keys (`sys_trusted_key`, through the READ-ONLY one-shot boot of
 *      `../../utils/plugin-trust-read.ts`, the read `os serve`'s boot-time
 *      loader makes too), and the raw bytes are verified with that key by
 *      `verifyPublisherSignature`. Refused by name: no signature, a malformed
 *      one, a key id this environment does not trust, a revoked key id, and a
 *      signature that does not match the bytes.
 *   2. Read the archive (the inflate bounded, `MAX_UNPACKED_ARTIFACT_BYTES`)
 *      and its compiled `objectstack.plugin.json`; refuse an entry that could
 *      land outside the install directory, and a manifest `ManifestSchema`
 *      refuses (`readCompiledPluginManifest`, the read the boot-time loader
 *      makes too), with the schema's own message: an artifact built before a
 *      value was retired (`packaging: 'manifest-deps'`) gets that value's
 *      prescription here, before anything is unpacked.
 *   3. Re-verify every file against the manifest's `integrity` map; refuse a
 *      digest mismatch, a declared file that is missing, or a file the map
 *      does not declare.
 *   4. Holding the installations lock from here to the record, so a second
 *      install of this project cannot interleave, read this project's
 *      installation records (refusing a file it cannot read, which a write
 *      would clobber) and refuse an install directory that already holds
 *      other bytes no record of this project owns: two projects sharing one
 *      `OS_HOME` and one environment id share the directory, and one must
 *      not overwrite the other's install.
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
 * The next `os serve` (or `os dev` / `os start`) loads the install through the
 * boot-time loader (`@objectstack/runtime`'s `installed-plugin-loader.ts`),
 * which re-verifies the kept artifact first. Only `runtime: 'node'` is
 * dispatched in M1: an artifact declaring `sandbox` or `worker` installs, with
 * a warning, and is refused by name at boot until M3 routes those tiers.
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
  verifyPublisherSignature,
} from '@objectstack/core';
import {
  loadPluginInstallations,
  pluginInstallDir,
  dispatchPluginRuntime,
  readCompiledPluginManifest,
  recordPluginInstallation,
  withPluginInstallationsLock,
  PluginInstallationsLockedError,
  type PluginInstallationRecord,
} from '@objectstack/runtime';
import {
  emitJson,
  printError,
  printHeader,
  printKV,
  printStep,
  printSuccess,
  printWarningToStderr,
} from '../../utils/format.js';
import {
  MANIFEST_FILENAME,
  MAX_UNPACKED_ARTIFACT_BYTES,
  SIGNATURE_FILENAME,
  readTarGz,
  sha256Hex,
  type ArchiveFile,
} from '../../utils/osplugin.js';
import { readTrustedKeys } from '../../utils/plugin-trust-read.js';
import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  archiveEntryProblems,
  installedArtifactSha,
  materializePlugin,
  pluginEnvironmentId,
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

    // 1. The signature, against this environment's trusted keys — over the
    //    raw bytes, before anything is inflated. ─────────────────────────
    const artifactPath = resolvePath(process.cwd(), args.artifact);
    if (!existsSync(artifactPath)) {
      await refuse({ error: 'artifact_not_found', message: `Artifact not found: ${args.artifact}` });
      return;
    }
    let bytes: Uint8Array;
    try {
      const stat = statSync(artifactPath);
      if (!stat.isFile()) throw new Error('not a regular file');
      // Read nothing larger than any artifact may unpack to: the compressed
      // bytes are held whole for the signature check.
      if (stat.size > MAX_UNPACKED_ARTIFACT_BYTES) {
        throw new Error(`it is ${stat.size} bytes, more than the ${MAX_UNPACKED_ARTIFACT_BYTES} an .osplugin may unpack to`);
      }
      bytes = new Uint8Array(await readFile(artifactPath));
    } catch (error) {
      await refuse({
        error: 'artifact_unreadable',
        message: `${args.artifact} is not a readable .osplugin (gzipped tar): ${(error as Error).message}`,
      });
      return;
    }

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

      const read = await readTrustedKeys([parsed.keyId], { databaseUrl: flags['database-url'], json });
      if (!read.ok) {
        await refuse({ error: read.error, message: read.message });
        return;
      }
      const resolved = read.keys.get(parsed.keyId) ?? { verdict: 'unknown' as const };
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
        // The publisher chain only: M1 is local, and no marketplace
        // counter-signature exists for a self-signed artifact.
        verdict = await verifyPublisherSignature(
          { artifact: bytes, signature },
          (keyId) => (keyId === parsed.keyId ? publicKey : null),
        );
      } catch (error) {
        await refuse({ error: 'signature_verification_failed', message: `Signature verification failed: ${(error as Error).message}` });
        return;
      }
      if (!verdict.ok || !verdict.verified) {
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

    // 2. The archive and its manifest. ─────────────────────────────────
    let files: ArchiveFile[];
    try {
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
    // Through `ManifestSchema`, the read the boot-time loader makes too: an
    // artifact built before a schema change is refused here with the
    // schema's own words (a retired value's prescription), not at boot.
    const read = readCompiledPluginManifest(files);
    if (!read.ok) {
      await refuse(
        read.reason === 'unreadable'
          ? { error: 'manifest_unreadable', message: `Cannot read the artifact's manifest: ${read.message}` }
          : {
            error: 'manifest_invalid',
            message:
              `The artifact's ${MANIFEST_FILENAME} is not a valid plugin manifest, so nothing was installed. `
              + 'Fix the source manifest and rebuild the artifact with `os plugin build`:',
            details: read.issues,
          },
      );
      return;
    }
    const manifest = read.manifest;
    const { id, version } = manifest;
    const environmentId = pluginEnvironmentId();
    let installDir: string;
    try {
      installDir = pluginInstallDir(environmentId, id, version);
    } catch (error) {
      await refuse({ error: 'manifest_unsafe_identity', message: (error as Error).message });
      return;
    }
    if (!json) printStep(`${id}@${version} (${(bytes.byteLength / 1024).toFixed(1)} KB, runtime: ${manifest.runtime ?? 'unset'})`);
    if (signature === null) {
      printWarningToStderr(
        `--trust-unsigned: installing ${id}@${version} WITHOUT a signature. Nothing proves who built these bytes; `
          + 'the installation record keeps this override, and every boot that loads it says so. Dev use only.',
      );
    }

    // 3. Per-file integrity, re-verified at unpack (ADR-0025 §3.2); the
    //    map's shape is `ManifestSchema`'s, checked above. ──────────────
    const integrity = verifyIntegrity(files, manifest.integrity, {
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

    // 4. Before anything is written. 5. Materialize. 6. Record. ─────────
    // Under the installations lock throughout, so the check that the install
    // directory is this project's to write and the record that follows the
    // write cannot interleave with another install of this project.
    const artifactSha = sha256Hex(bytes);
    const permissions = manifest.permissions;
    let outcome: { refusal: Refusal } | { record: PluginInstallationRecord; replaced: boolean };
    try {
      outcome = withPluginInstallationsLock(environmentId, () => {
        let installations: PluginInstallationRecord[];
        try {
          installations = loadPluginInstallations(environmentId);
        } catch (error) {
          return { refusal: { error: 'record_unreadable', message: `${(error as Error).message} Nothing was installed.` } };
        }
        const presentSha = installedArtifactSha(installDir);
        if (
          presentSha !== undefined
          && presentSha !== artifactSha
          && !installations.some((r) => r.id === id && r.dir === installDir && r.artifact?.sha256 === presentSha)
        ) {
          return {
            refusal: {
              error: 'install_dir_taken',
              message:
                `${installDir} already holds ${id}@${version} `
                + (presentSha === null ? `with no readable ${INSTALLED_ARTIFACT_FILE}` : `built from other bytes (artifact sha256 ${presentSha})`)
                + ', and no installation of this project put it there: another project sharing this OS_HOME and environment did, '
                + 'or something else wrote it. Nothing was installed. Give this project its own environment (OS_ENVIRONMENT_ID) '
                + 'or home (OS_HOME), or publish the change under a new version.',
            },
          };
        }

        let replaced: boolean;
        try {
          ({ replaced } = materializePlugin({ dir: installDir, files, artifact: bytes, signature }));
        } catch (error) {
          return { refusal: { error: 'materialize_failed', message: `Cannot write ${installDir}: ${(error as Error).message}` } };
        }
        const record: PluginInstallationRecord = {
          id,
          version,
          versionId: `${id}@${version}`,
          runtime: manifest.runtime ?? null,
          status: 'installed',
          grantedPermissions: permissions ?? null,
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
          return {
            refusal: {
              error: 'record_failed',
              message: `${installDir} was written, but the installation was not recorded: ${(error as Error).message}`,
            },
          };
        }
        return { record, replaced };
      });
    } catch (error) {
      // Another live writer held the lock past the wait, or the lock file
      // itself could not be written.
      outcome = {
        refusal: {
          error: error instanceof PluginInstallationsLockedError ? 'installations_locked' : 'install_failed',
          message: `${(error as Error).message} Nothing was installed.`,
        },
      };
    }
    if ('refusal' in outcome) {
      await refuse(outcome.refusal);
      return;
    }
    const { record, replaced } = outcome;
    // ADR-0025 §3.6: only `node` is dispatched in M1.
    const tier = dispatchPluginRuntime(record.runtime ?? undefined);
    if (!tier.ok) {
      printWarningToStderr(
        `${id}@${version} is installed, and the next boot will refuse to load it (${tier.error}): ${tier.message}`,
      );
    }

    if (json) {
      await emitJson(
        {
          installed: record,
          replaced,
          integrity: { checked: integrity.checked, skipped: integrity.skipped },
          boot: tier.ok ? { loads: true } : { loads: false, error: tier.error },
        },
        0,
        { compact: true },
      );
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
    printStep(
      tier.ok
        ? 'The next `os serve` (or `os dev` / `os start`) re-verifies the kept artifact and loads it.'
        : 'The next `os serve` refuses to load it until its tier is dispatched (ADR-0025 M3).',
    );
  }
}
