// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack package publish` — upload a compiled artifact as a versioned
 * package into the caller's organization on ObjectStack Cloud.
 *
 * Flow (ADR-0006 v4 Phase B):
 *   1. POST /cloud/packages                  — ensure a sys_package row exists
 *      keyed by manifest_id. owner_org_id is derived from the caller's
 *      active organization (user mode) or supplied via --org (service mode).
 *   2. POST /cloud/packages/:id/versions     — snapshot dist/objectstack.json
 *      into sys_package_version.manifest_json (status=published).
 *   3. (optional) auto-install into a target environment via --env.
 *
 * This is the "upload my local code to my org" path. It does NOT write
 * sys_environment_revision (that's the legacy `objectstack publish` path,
 * which still exists for backward compatibility while ADR-0006 v4 Phase B
 * transitions complete).
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, basename } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, printStep } from '../../utils/format.js';
import { DEFAULT_CLOUD_URL, tryReadCloudConfig } from '../../utils/cloud-config.js';

const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{0,254}$/i;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'app';
}

/**
 * Derive a reverse-domain manifest_id when the user hasn't passed --manifest-id.
 * Order of precedence:
 *   1. artifact.manifest.id (if it looks like a reverse-domain id)
 *   2. local.<artifact.manifest.name slug>
 *   3. local.<artifact filename without extension>
 */
function deriveManifestId(artifact: any, artifactPath: string): string {
  const explicit = artifact?.manifest?.id;
  if (typeof explicit === 'string' && MANIFEST_ID_RE.test(explicit) && explicit.includes('.')) {
    return explicit;
  }
  const name = artifact?.manifest?.name;
  if (typeof name === 'string' && name.trim()) {
    return `local.${slugify(name)}`;
  }
  return `local.${slugify(basename(artifactPath).replace(/\.json$/i, ''))}`;
}

function deriveDisplayName(artifact: any, manifestId: string): string {
  const n = artifact?.manifest?.name;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return manifestId;
}

function deriveVersion(artifact: any, fallback: string | undefined): string {
  if (fallback) return fallback;
  const v = artifact?.manifest?.version;
  if (typeof v === 'string' && v.trim()) return v.trim();
  // Generate a timestamped pre-release as a last resort so users can publish
  // without bumping manifest.version every time during early iteration.
  const t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `0.0.0-dev.${t}`;
}

export default class PackagePublish extends Command {
  static override description =
    'Publish a compiled artifact as a versioned package in your organization (ADR-0006 v4 Phase B)';

  static override examples = [
    '$ os package publish',
    '$ os package publish --manifest-id com.acme.crm --version 1.2.0',
    '$ os package publish --env env_abc123 --install',
    '$ os package publish dist/objectstack.json --visibility org --note "first cut"',
    '$ OS_CLOUD_URL=http://localhost:4000 os package publish    # local dev (apps/cloud)',
  ];

  static override args = {
    artifact: Args.string({
      description: 'Path to the compiled artifact (default: dist/objectstack.json)',
      required: false,
    }),
  };

  static override flags = {
    server: Flags.string({
      char: 's',
      description: 'ObjectStack Cloud control-plane URL (override for self-hosted registries)',
      env: 'OS_CLOUD_URL',
      default: DEFAULT_CLOUD_URL,
    }),
    token: Flags.string({
      char: 't',
      description: 'API key for ObjectStack Cloud (bearer token; defaults to OS_CLOUD_API_KEY / OS_TOKEN)',
      env: 'OS_CLOUD_API_KEY',
    }),
    'manifest-id': Flags.string({
      description: 'Reverse-domain package id (e.g. com.acme.crm). Default: derived from artifact.manifest.id or name.',
      env: 'OS_PACKAGE_MANIFEST_ID',
    }),
    version: Flags.string({
      char: 'v',
      description: 'Semver version (default: artifact.manifest.version or 0.0.0-dev.<timestamp>)',
    }),
    'display-name': Flags.string({
      description: 'Human-readable name shown in the Marketplace (default: artifact.manifest.name)',
    }),
    description: Flags.string({
      description: 'Short package description',
    }),
    category: Flags.string({
      description: 'Marketplace category slug (e.g. crm, hr, devtools)',
    }),
    visibility: Flags.string({
      description: 'Who can see / install this package',
      options: ['private', 'org', 'marketplace'],
      default: 'private',
    }),
    org: Flags.string({
      description: 'owner_org_id (required when using a bearer key in service mode; ignored in user mode)',
      env: 'OS_ORG_ID',
    }),
    env: Flags.string({
      description: 'Environment id to install the new version into after publish',
      env: 'OS_ENVIRONMENT_ID',
    }),
    install: Flags.boolean({
      description: 'Auto-install the new version into --env after publishing',
      default: false,
    }),
    'seed-sample-data': Flags.boolean({
      description: 'Include sample data when auto-installing',
      default: false,
    }),
    'pre-release': Flags.boolean({
      description: 'Mark this version as a pre-release',
      default: false,
    }),
    note: Flags.string({
      char: 'n',
      description: 'Release notes (markdown ok)',
    }),
    timeout: Flags.integer({
      description: 'HTTP timeout in milliseconds (0 disables)',
      env: 'OS_CLOUD_TIMEOUT_MS',
      default: 120_000,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PackagePublish);

    printHeader('Publish Package');

    try {
      const artifactPath = args.artifact
        ? resolvePath(process.cwd(), args.artifact)
        : resolvePath(process.cwd(), 'dist/objectstack.json');

      printStep(`Loading artifact from ${artifactPath}...`);
      let artifactRaw: string;
      try {
        artifactRaw = await readFile(artifactPath, 'utf-8');
      } catch (err: any) {
        printError(`Cannot read artifact: ${err.message}. Run \`objectstack build\` first.`);
        this.exit(1);
        return;
      }

      let artifact: any;
      try {
        artifact = JSON.parse(artifactRaw);
      } catch (err: any) {
        printError(`Artifact is not valid JSON: ${err.message}`);
        this.exit(1);
        return;
      }
      printSuccess(`Loaded artifact (${(artifactRaw.length / 1024).toFixed(1)} KB)`);

      const manifestId = (flags['manifest-id'] ?? deriveManifestId(artifact, artifactPath)).trim();
      if (!MANIFEST_ID_RE.test(manifestId)) {
        printError(
          `Invalid manifest-id '${manifestId}'. Expected reverse-domain form like 'com.acme.crm' (a-z0-9._-).`,
        );
        this.exit(1);
        return;
      }
      const displayName = (flags['display-name'] ?? deriveDisplayName(artifact, manifestId)).trim();
      const version = deriveVersion(artifact, flags.version);

      // Resolve auth + server URL. Credential precedence:
      //   1. explicit --token flag  (or $OS_TOKEN env)
      //   2. ~/.objectstack/cloud.json (written by `os cloud login`)
      //   3. fail with a clear "run `os cloud login`" message
      //
      // Server URL precedence:
      //   1. explicit --server flag (or $OS_CLOUD_URL env)
      //   2. cloud.json's recorded url
      //   3. https://cloud.objectos.app (DEFAULT_CLOUD_URL)
      //
      // Note: we deliberately do NOT fall back to ~/.objectstack/credentials.json
      // (the *runtime* identity, written by `os login`). Publishing a package
      // and managing a local ObjectOS instance are two distinct identities —
      // see `os cloud login` for the cloud identity.
      let token = flags.token ?? process.env.OS_TOKEN ?? undefined;
      let baseUrl = flags.server.replace(/\/+$/, '');
      const serverFlagWasDefault = !process.env.OS_CLOUD_URL && baseUrl === DEFAULT_CLOUD_URL;
      if (!token || serverFlagWasDefault) {
        const stored = await tryReadCloudConfig();
        if (!token && stored?.token) token = stored.token;
        if (serverFlagWasDefault && stored?.url) baseUrl = stored.url.replace(/\/+$/, '');
      }
      if (!token) {
        printError(
          'Not logged in to ObjectStack Cloud. Run `os cloud login` first, or pass --token / set $OS_TOKEN.',
        );
        this.exit(1);
        return;
      }

      // ---- Step 1: ensure sys_package row ---------------------------------
      printStep(`Registering package '${manifestId}'...`);
      const pkgBody: Record<string, any> = {
        manifest_id: manifestId,
        display_name: displayName,
        visibility: flags.visibility,
      };
      if (flags.description) pkgBody.description = flags.description;
      if (flags.category) pkgBody.category = flags.category;
      if (flags.org) pkgBody.owner_org_id = flags.org;

      const pkgRes = await this.postJson(`${baseUrl}/api/v1/cloud/packages`, pkgBody, token, flags.timeout);
      if (!pkgRes.ok) {
        printError(`Register package failed (${pkgRes.status}): ${pkgRes.error}`);
        this.exit(1);
        return;
      }
      const pkg = pkgRes.body?.data ?? pkgRes.body;
      printSuccess(`${pkg?.created ? 'Created' : 'Updated'} sys_package ${pkg?.id} (${manifestId})`);

      // ---- Step 2: create sys_package_version -----------------------------
      printStep(`Publishing version ${version}...`);
      const verBody: Record<string, any> = {
        version,
        bundle: artifact,
        is_pre_release: flags['pre-release'] || /-(alpha|beta|rc|dev|preview|staging|pr)/i.test(version),
      };
      if (flags.note) verBody.release_notes = flags.note;

      const shouldInstall = flags.install && flags.env;
      if (shouldInstall) {
        verBody.install_env_id = flags.env;
        verBody.seed_sample_data = flags['seed-sample-data'];
      } else if (flags.install && !flags.env) {
        printError('`--install` requires `--env <id>`. Skipping auto-install.');
      }

      const verRes = await this.postJson(
        `${baseUrl}/api/v1/cloud/packages/${encodeURIComponent(pkg.id)}/versions`,
        verBody,
        token,
        flags.timeout,
      );
      if (!verRes.ok) {
        printError(`Publish version failed (${verRes.status}): ${verRes.error}`);
        this.exit(1);
        return;
      }
      const ver = verRes.body?.data ?? verRes.body;

      console.log('');
      printSuccess('Package published');
      printKV('  Package',        manifestId);
      printKV('  Package ID',     String(pkg?.id ?? '—'));
      printKV('  Version',        String(ver?.version ?? version));
      printKV('  Version ID',     String(ver?.id ?? '—'));
      if (ver?.checksum) printKV('  Checksum', String(ver.checksum).slice(0, 16));
      printKV('  Visibility',     String(pkg?.visibility ?? flags.visibility));
      if (pkg?.owner_org_id) printKV('  Owner Org', String(pkg.owner_org_id));
      if (ver?.installation) {
        console.log('');
        printSuccess('Installed into environment');
        printKV('  Environment', String(ver.installation.environment_id ?? flags.env ?? '—'));
        printKV('  Installation', String(ver.installation.installation_id ?? '—'));
      }
      printKV('  Server',         baseUrl);
    } catch (error) {
      printError((error as Error).message);
      this.exit(1);
    }
  }

  /**
   * Tiny fetch wrapper that returns a normalised envelope so the command
   * body can stay flat. Honours an AbortController timeout.
   */
  private async postJson(
    url: string,
    body: unknown,
    token: string | undefined,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed: any = null;
      try { parsed = await response.json(); } catch { /* empty/non-json */ }
      if (!response.ok) {
        const errMsg = parsed?.error ?? response.statusText ?? `HTTP ${response.status}`;
        return { ok: false, status: response.status, body: parsed, error: String(errMsg) };
      }
      return { ok: true, status: response.status, body: parsed };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return {
          ok: false,
          status: 0,
          body: null,
          error: `Request timed out after ${timeoutMs}ms. Use --timeout <ms> to extend it (0 disables).`,
        };
      }
      return { ok: false, status: 0, body: null, error: err?.message ?? String(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
