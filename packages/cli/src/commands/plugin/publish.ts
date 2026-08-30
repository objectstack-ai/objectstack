// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin publish` — upload a signed `.osplugin` to ObjectStack Cloud
 * (ADR-0025 §3.4 step 3). Completes the build → sign → publish pipeline.
 *
 * Flow:
 *   1. Read the `.osplugin` bytes + the detached `.sig` (publisher signature).
 *   2. Extract the compiled `objectstack.plugin.json` from inside the
 *      artifact (id / version / name / runtime / permissions / integrity),
 *      then preflight the artifact files against the manifest's declared
 *      per-file `integrity` digests (ADR-0025 §3.2) — refuse on any
 *      mismatch / missing / extra file; an absent map skips the check
 *      (the field is optional).
 *   3. POST /cloud/packages          — ensure the sys_package row exists.
 *   4. POST /cloud/packages/:id/versions with `artifact_kind: 'plugin'`,
 *      the base64 artifact, the declared manifest, the signature, and the
 *      whole-artifact sha256 checksum. The cloud verifies the signature,
 *      audits permissions/runtime tier, stores the blob, and sets
 *      listing_status=pending_review (or approved with --auto-approve).
 *
 * The platform counter-signature is written by the marketplace review/approve
 * flow, not here.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, basename } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, printStep } from '../../utils/format.js';
import { DEFAULT_CLOUD_URL, tryReadCloudConfig } from '../../utils/cloud-config.js';
import {
  OSPLUGIN_EXT,
  MANIFEST_FILENAME,
  SIGNATURE_FILENAME,
  sha256Hex,
  readTarGz,
  type ArchiveFile,
} from '../../utils/osplugin.js';
import { verifyIntegrity, formatIntegrityViolation } from '@objectstack/core';

interface PostResult { ok: boolean; status: number; body: any; error?: string }

export default class PluginPublish extends Command {
  static override description =
    'Publish a signed .osplugin to ObjectStack Cloud (ADR-0025 §3.4)';

  static override examples = [
    '$ os plugin publish ./com.acme.stripe-1.0.0.osplugin --visibility marketplace --submit',
    '$ os plugin publish ./x.osplugin --sig ./x.osplugin.sig --org org_123',
    '$ OS_CLOUD_URL=http://localhost:4000 os plugin publish ./x.osplugin --auto-approve',
  ];

  static override args = {
    artifact: Args.string({ description: 'Path to the .osplugin (default: the single .osplugin in cwd)', required: false }),
  };

  static override flags = {
    server: Flags.string({ char: 's', description: 'Cloud control-plane URL', env: 'OS_CLOUD_URL', default: DEFAULT_CLOUD_URL }),
    token: Flags.string({ char: 't', description: 'Cloud API key (bearer)', env: 'OS_CLOUD_API_KEY' }),
    sig: Flags.string({ description: 'Path to the detached signature (default: <artifact>.sig)' }),
    'manifest-id': Flags.string({ description: 'Override package id (default: from the manifest)' }),
    'display-name': Flags.string({ description: 'Marketplace display name (default: manifest.name)' }),
    visibility: Flags.string({ description: 'Who can see/install', options: ['private', 'org', 'marketplace'], default: 'private' }),
    org: Flags.string({ description: 'owner_org_id (service mode)', env: 'OS_ORG_ID' }),
    note: Flags.string({ char: 'n', description: 'Release notes (markdown ok)' }),
    'pre-release': Flags.boolean({ description: 'Mark as a pre-release', default: false }),
    submit: Flags.boolean({ description: 'Submit for marketplace review after publish', default: false }),
    'auto-approve': Flags.boolean({ description: 'Platform admin only: skip review queue', default: false }),
    timeout: Flags.integer({ description: 'HTTP timeout (ms, 0 disables)', env: 'OS_CLOUD_TIMEOUT_MS', default: 120_000 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginPublish);
    printHeader('Publish Plugin');

    // 1. Resolve the artifact path. ────────────────────────────────────
    let artifactPath: string;
    if (args.artifact) {
      artifactPath = resolvePath(process.cwd(), args.artifact);
    } else {
      const here = (await readdir(process.cwd())).filter((f) => f.endsWith(OSPLUGIN_EXT));
      if (here.length === 0) { printError(`No ${OSPLUGIN_EXT} found in cwd. Run \`os plugin build\` first, or pass a path.`); this.exit(1); return; }
      if (here.length > 1) { printError(`Multiple ${OSPLUGIN_EXT} files found — pass one explicitly.`); this.exit(1); return; }
      artifactPath = resolvePath(process.cwd(), here[0]);
    }
    if (!existsSync(artifactPath)) { printError(`Artifact not found: ${artifactPath}`); this.exit(1); return; }

    const bytes = new Uint8Array(await readFile(artifactPath));
    const checksum = sha256Hex(bytes);
    const base64 = Buffer.from(bytes).toString('base64');

    // 2. Extract the compiled manifest from inside the artifact. ────────
    let manifest: Record<string, any>;
    let archiveFiles: ArchiveFile[];
    try {
      archiveFiles = readTarGz(bytes);
      const entry = archiveFiles.find((f) => f.path === MANIFEST_FILENAME);
      if (!entry) throw new Error(`${MANIFEST_FILENAME} not found in artifact`);
      manifest = JSON.parse(Buffer.from(entry.data).toString('utf8')) as Record<string, any>;
    } catch (err: any) {
      printError(`Cannot read manifest from artifact: ${err?.message ?? err}`);
      this.exit(1);
      return;
    }
    const id = String(flags['manifest-id'] ?? manifest.id ?? '').trim();
    const version = String(manifest.version ?? '').trim();
    const displayName = String(flags['display-name'] ?? manifest.name ?? id).trim();
    if (!id || !version) { printError('Artifact manifest is missing id or version.'); this.exit(1); return; }
    printStep(`${id}@${version} (${(bytes.byteLength / 1024).toFixed(1)} KB, runtime: ${manifest.runtime ?? 'unset'})`);

    // 2b. Integrity preflight (ADR-0025 §3.2) — self-check the artifact
    // bytes against the manifest's own declared per-file digests before
    // upload. Absent map = permissive by contract (the field is
    // `.optional()`; artifacts built before integrity computation stay
    // publishable). Unpack-time re-verification remains the cloud control
    // plane's obligation (#11331) — this preflight does not discharge it.
    const declaredIntegrity = manifest.integrity;
    if (
      declaredIntegrity !== undefined && declaredIntegrity !== null
      && (typeof declaredIntegrity !== 'object' || Array.isArray(declaredIntegrity))
    ) {
      printError('Artifact manifest has a malformed `integrity` map (expected an object of path → digest). Rebuild with `os plugin build`.');
      this.exit(1);
      return;
    }
    const integrityCheck = verifyIntegrity(
      archiveFiles,
      declaredIntegrity as Record<string, string> | undefined,
      { exempt: [MANIFEST_FILENAME, SIGNATURE_FILENAME] },
    );
    if (!integrityCheck.ok) {
      printError(`Integrity preflight failed — the artifact's bytes no longer match its own manifest \`integrity\` digests (${integrityCheck.violations.length} violation${integrityCheck.violations.length === 1 ? '' : 's'}):`);
      for (const v of integrityCheck.violations) console.log(`    • ${formatIntegrityViolation(v)}`);
      console.log('\n  Rebuild the artifact with `os plugin build` (then re-sign with `os plugin sign`) so the digests match the packaged files, and publish the fresh artifact.');
      this.exit(1);
      return;
    }
    if (integrityCheck.skipped) {
      printStep('No `integrity` map in the manifest — per-file integrity preflight skipped.');
    } else {
      printKV('  Integrity', `${integrityCheck.checked} file(s) verified against the manifest digests`);
    }

    // 3. Detached publisher signature. ─────────────────────────────────
    const sigPath = resolvePath(process.cwd(), flags.sig ?? `${artifactPath}.sig`);
    let signature: string | undefined;
    if (existsSync(sigPath)) {
      signature = (await readFile(sigPath, 'utf-8')).trim();
      printKV('  Signature', signature.length > 48 ? signature.slice(0, 48) + '…' : signature);
    } else {
      printStep(`No signature sidecar at ${basename(sigPath)} — publishing UNSIGNED (a "node"-tier plugin will be rejected by the server unless the publisher is verified). Run \`os plugin sign\` first.`);
    }

    // 4. Auth + server URL (same precedence as `os package publish`). ───
    let token = flags.token ?? process.env.OS_TOKEN ?? undefined;
    let baseUrl = flags.server.replace(/\/+$/, '');
    const serverFlagWasDefault = !process.env.OS_CLOUD_URL && baseUrl === DEFAULT_CLOUD_URL;
    if (!token || serverFlagWasDefault) {
      const stored = await tryReadCloudConfig();
      if (!token && stored?.token) token = stored.token;
      if (serverFlagWasDefault && stored?.url) baseUrl = stored.url.replace(/\/+$/, '');
    }
    if (!token) { printError('Not logged in. Run `os cloud login`, or pass --token / set $OS_CLOUD_API_KEY.'); this.exit(1); return; }

    // 5. Register the package row. ──────────────────────────────────────
    printStep(`Registering package '${id}'...`);
    const pkgBody: Record<string, any> = { manifest_id: id, display_name: displayName, visibility: flags.visibility };
    if (flags.org) pkgBody.owner_org_id = flags.org;
    if (typeof manifest.description === 'string') pkgBody.description = manifest.description;
    const pkgRes = await this.postJson(`${baseUrl}/api/v1/cloud/packages`, pkgBody, token, flags.timeout);
    if (!pkgRes.ok) { printError(`Register package failed (${pkgRes.status}): ${pkgRes.error}`); this.exit(1); return; }
    const pkg = pkgRes.body?.data ?? pkgRes.body;
    printSuccess(`${pkg?.created ? 'Created' : 'Updated'} sys_package ${pkg?.id} (${id})`);

    // 6. Publish the plugin version. ────────────────────────────────────
    printStep(`Publishing version ${version}...`);
    const verBody: Record<string, any> = {
      version,
      artifact_kind: 'plugin',
      osplugin: base64,
      plugin_manifest: manifest,
      artifact_checksum: checksum,
      is_pre_release: flags['pre-release'] || /-(alpha|beta|rc|dev|preview|staging|pr)/i.test(version),
    };
    if (signature) verBody.signature = signature;
    if (flags.note) verBody.release_notes = flags.note;
    if (flags.submit) verBody.submit_for_review = true;
    if (flags['auto-approve']) verBody.auto_approve = true;

    const verRes = await this.postJson(
      `${baseUrl}/api/v1/cloud/packages/${encodeURIComponent(pkg.id)}/versions`, verBody, token, flags.timeout,
    );
    if (!verRes.ok) {
      printError(`Publish version failed (${verRes.status}): ${verRes.error}`);
      const violations = Array.isArray(verRes.body?.violations) ? verRes.body.violations : [];
      if (violations.length > 0) {
        console.log('\n  Violations:');
        for (const v of violations) console.log(`    • ${v}`);
      }
      this.exit(1);
      return;
    }
    const ver = verRes.body?.data ?? verRes.body;
    printSuccess('Plugin version published');
    printKV('  Version', String(ver?.version ?? version));
    printKV('  Listing status', String(ver?.listing_status ?? (flags.submit ? 'pending_review' : 'draft')));
    printKV('  Artifact sha256', checksum);
    if (!flags.submit && !flags['auto-approve'] && flags.visibility === 'marketplace') {
      printStep('Re-run with --submit to send this version for marketplace review.');
    }
  }

  /** Tiny fetch wrapper returning a normalized envelope; honours a timeout. */
  private async postJson(url: string, body: unknown, token: string, timeoutMs: number): Promise<PostResult> {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed: any = null;
      try { parsed = await response.json(); } catch { /* empty body */ }
      if (!response.ok) {
        const errMsg = parsed?.error?.message ?? parsed?.error ?? response.statusText;
        return { ok: false, status: response.status, body: parsed, error: String(errMsg) };
      }
      return { ok: true, status: response.status, body: parsed };
    } catch (err: any) {
      return { ok: false, status: 0, body: null, error: err?.message ?? String(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
