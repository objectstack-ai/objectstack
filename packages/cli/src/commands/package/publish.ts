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
import { resolve as resolvePath, basename, dirname, isAbsolute } from 'node:path';
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

/**
 * Load `objectstack.manifest.json` from `cwd` if it exists. Returns the
 * parsed JSON plus the directory it was loaded from (used to resolve
 * relative `readmePath` / per-locale README paths). Returns `null` when
 * no manifest is present — publishing remains pure-flag-driven for
 * users without one.
 */
async function tryLoadTemplateManifest(
  cwd: string,
): Promise<{ data: Record<string, any>; baseDir: string } | null> {
  const path = resolvePath(cwd, 'objectstack.manifest.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      return { data, baseDir: dirname(path) };
    }
  } catch {
    // Malformed — surface as null; flags-only mode still works.
  }
  return null;
}

/**
 * Read a string that is EITHER inlined markdown OR a path relative to
 * the template manifest directory. Treats short, single-line `.md` /
 * `.markdown` strings as paths and reads them; everything else is
 * returned as-is. Path resolution honours absolute paths.
 */
async function resolveLocalizedMarkdown(
  value: string,
  baseDir: string,
): Promise<string> {
  const looksLikePath =
    value.length < 256 &&
    !value.includes('\n') &&
    /\.(md|markdown)$/i.test(value.trim());
  if (!looksLikePath) return value;
  const path = isAbsolute(value) ? value : resolvePath(baseDir, value);
  return await readFile(path, 'utf-8');
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
      description:
        "Who can see / install this package. " +
        "'org' (default): auto-visible/installable across your organization's environments. " +
        "'private': only explicitly-granted orgs/envs. " +
        "'marketplace': public after review.",
      options: ['private', 'org', 'marketplace'],
      default: 'org',
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
    submit: Flags.boolean({
      description:
        'After publishing, submit the new version for marketplace review ' +
        '(requires --visibility=marketplace and a complete listing).',
      default: false,
    }),
    'auto-approve': Flags.boolean({
      description:
        'Platform admin only: skip the review queue and publish straight to the ' +
        'marketplace catalog. Used by first-party CI / dogfood publishes.',
      default: false,
    }),
    readme: Flags.string({
      description:
        'Inline marketplace README (markdown). Required for marketplace listings unless ' +
        'already stored on the package row. Mutually exclusive with --readme-file.',
    }),
    'readme-file': Flags.string({
      description: 'Path to a marketplace README file (markdown). Read at publish time.',
    }),
    'icon-url': Flags.string({
      description:
        'Public http(s) icon URL shown in the marketplace catalog. Required for ' +
        'marketplace listings unless already stored on the package row. ' +
        'Mutually exclusive with --icon-file.',
    }),
    'icon-file': Flags.string({
      description:
        'Local image file (PNG/JPEG/WebP/SVG, ≤256 KB) to upload to the cloud icon ' +
        'CDN. The server returns a stable URL (e.g. /icons/<manifest>.png) and ' +
        'rewrites sys_package.icon_url for you. Mutually exclusive with --icon-url.',
    }),
    'homepage-url': Flags.string({
      description: 'Public project / docs URL (optional, surfaced in the catalog).',
    }),
    license: Flags.string({
      description: 'SPDX license identifier (e.g. Apache-2.0, MIT).',
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

      // Load `objectstack.manifest.json` (optional). Provides declarative
      // defaults for manifestId / displayName / category / tagline / readme
      // / per-locale translations etc. CLI flags always win over manifest.
      const tplManifest = await tryLoadTemplateManifest(process.cwd());
      if (tplManifest) {
        printStep(`Loaded objectstack.manifest.json`);
      }
      const m = tplManifest?.data ?? {};
      const baseDir = tplManifest?.baseDir ?? process.cwd();

      const manifestId = (
        flags['manifest-id']
        ?? (typeof m.manifestId === 'string' ? m.manifestId : undefined)
        ?? deriveManifestId(artifact, artifactPath)
      ).trim();
      if (!MANIFEST_ID_RE.test(manifestId)) {
        printError(
          `Invalid manifest-id '${manifestId}'. Expected reverse-domain form like 'com.acme.crm' (a-z0-9._-).`,
        );
        this.exit(1);
        return;
      }
      const displayName = (
        flags['display-name']
        ?? (typeof m.displayName === 'string' ? m.displayName : undefined)
        ?? deriveDisplayName(artifact, manifestId)
      ).trim();
      const version = deriveVersion(artifact, flags.version);

      // Resolve auth + server URL. Credential precedence:
      //   1. explicit --token flag  (or $OS_TOKEN env)
      //   2. ~/.objectstack/cloud.json (written by `os cloud login`)
      //   3. fail with a clear "run `os cloud login`" message
      //
      // Server URL precedence:
      //   1. explicit --server flag (or $OS_CLOUD_URL env)
      //   2. cloud.json's recorded url
      //   3. https://cloud.objectos.ai (DEFAULT_CLOUD_URL)
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
      // Manifest defaults already loaded above; CLI flags win.
      printStep(`Registering package '${manifestId}'...`);
      const pkgBody: Record<string, any> = {
        manifest_id: manifestId,
        display_name: displayName,
        visibility: flags.visibility,
      };
      const desc = flags.description ?? (typeof m.description === 'string' ? m.description : undefined);
      if (desc) pkgBody.description = desc;
      const cat = flags.category ?? (typeof m.category === 'string' ? m.category : undefined);
      if (cat) pkgBody.category = cat;
      if (typeof m.tagline === 'string' && m.tagline.trim()) pkgBody.tagline = m.tagline.trim();
      if (flags.org) pkgBody.owner_org_id = flags.org;
      if (flags['icon-url'] && flags['icon-file']) {
        printError('Pass either --icon-url or --icon-file, not both.');
        this.exit(1);
        return;
      }
      const iconUrl = flags['icon-url'] ?? (typeof m.iconUrl === 'string' ? m.iconUrl : undefined);
      if (iconUrl) pkgBody.icon_url = iconUrl;
      const homepage = flags['homepage-url'] ?? (typeof m.homepageUrl === 'string' ? m.homepageUrl : undefined);
      if (homepage) pkgBody.homepage_url = homepage;
      const license = flags.license ?? (typeof m.license === 'string' ? m.license : undefined);
      if (license) pkgBody.license = license;

      // Resolve readme: --readme wins, then --readme-file, then manifest.readmePath.
      // Don't auto-discover a README.md in cwd — that often leaks dev
      // notes into the catalog.
      if (flags.readme && flags['readme-file']) {
        printError('Pass either --readme or --readme-file, not both.');
        this.exit(1);
        return;
      }
      if (flags.readme) {
        pkgBody.readme = flags.readme;
      } else if (flags['readme-file']) {
        const readmePath = resolvePath(process.cwd(), flags['readme-file']);
        try {
          pkgBody.readme = await readFile(readmePath, 'utf-8');
        } catch (err: any) {
          printError(`Cannot read --readme-file '${readmePath}': ${err.message}`);
          this.exit(1);
          return;
        }
      } else if (typeof m.readmePath === 'string' && m.readmePath.trim()) {
        const readmePath = isAbsolute(m.readmePath) ? m.readmePath : resolvePath(baseDir, m.readmePath);
        try {
          pkgBody.readme = await readFile(readmePath, 'utf-8');
        } catch (err: any) {
          printError(`Cannot read manifest.readmePath '${readmePath}': ${err.message}`);
          this.exit(1);
          return;
        }
      }

      // Marketplace per-locale translations. Schema is
      // `PackageTranslationsSchema` from @objectstack/spec/cloud. Per-entry
      // `readme` may be inlined markdown OR a path (e.g. `README.zh-CN.md`)
      // — we resolve paths against the manifest directory.
      if (m.translations && typeof m.translations === 'object') {
        const out: Record<string, Record<string, any>> = {};
        for (const [locale, entryRaw] of Object.entries(m.translations as Record<string, unknown>)) {
          if (!entryRaw || typeof entryRaw !== 'object') continue;
          const entry = entryRaw as Record<string, any>;
          const resolved: Record<string, any> = {};
          for (const key of ['displayName', 'description', 'tagline'] as const) {
            if (typeof entry[key] === 'string' && entry[key].trim()) resolved[key] = entry[key];
          }
          if (typeof entry.readme === 'string' && entry.readme.trim()) {
            try {
              resolved.readme = await resolveLocalizedMarkdown(entry.readme, baseDir);
            } catch (err: any) {
              printError(`Cannot read translations['${locale}'].readme: ${err.message}`);
              this.exit(1);
              return;
            }
          }
          if (entry.screenshotCaptions && typeof entry.screenshotCaptions === 'object') {
            resolved.screenshotCaptions = entry.screenshotCaptions;
          }
          if (Object.keys(resolved).length > 0) out[locale] = resolved;
        }
        if (Object.keys(out).length > 0) pkgBody.translations = out;
      }

      const pkgRes = await this.postJson(`${baseUrl}/api/v1/cloud/packages`, pkgBody, token, flags.timeout);
      if (!pkgRes.ok) {
        printError(`Register package failed (${pkgRes.status}): ${pkgRes.error}`);
        this.exit(1);
        return;
      }
      const pkg = pkgRes.body?.data ?? pkgRes.body;
      printSuccess(`${pkg?.created ? 'Created' : 'Updated'} sys_package ${pkg?.id} (${manifestId})`);

      // ---- Step 1b: optional icon upload ---------------------------------
      // When --icon-file is set we upload raw bytes BEFORE version publish.
      // The icon route updates sys_package.icon_url to a stable served URL
      // (e.g. /icons/<manifest>.png) — that way the marketplace-policy
      // validator at version-publish time sees an icon and won't 422.
      if (flags['icon-file']) {
        const iconPath = resolvePath(process.cwd(), flags['icon-file']);
        try {
          const iconBytes = await readFile(iconPath);
          const contentType = guessImageContentType(iconPath);
          if (!contentType) {
            printError(
              `Cannot infer image type from '${iconPath}'. Use a .png/.jpg/.jpeg/.webp/.svg file.`,
            );
            this.exit(1);
            return;
          }
          printStep(`Uploading icon (${iconBytes.length} bytes, ${contentType})...`);
          const iconRes = await this.postBinary(
            `${baseUrl}/api/v1/cloud/packages/${encodeURIComponent(pkg.id)}/icon`,
            iconBytes,
            contentType,
            token,
            flags.timeout,
          );
          if (!iconRes.ok) {
            printError(`Icon upload failed (${iconRes.status}): ${iconRes.error}`);
            this.exit(1);
            return;
          }
          const iconUrl = iconRes.body?.data?.icon_url ?? iconRes.body?.icon_url;
          if (iconUrl) printKV('  Icon URL', String(iconUrl));
        } catch (err: any) {
          printError(`Cannot read --icon-file '${iconPath}': ${err.message}`);
          this.exit(1);
          return;
        }
      }

      // ---- Step 2: create sys_package_version -----------------------------
      printStep(`Publishing version ${version}...`);
      const verBody: Record<string, any> = {
        version,
        bundle: artifact,
        is_pre_release: flags['pre-release'] || /-(alpha|beta|rc|dev|preview|staging|pr)/i.test(version),
      };
      if (flags.note) verBody.release_notes = flags.note;
      if (flags.submit) verBody.submit_for_review = true;
      if (flags['auto-approve']) verBody.auto_approve = true;

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
        // 422 surfaces marketplace policy violations — show them so the author
        // knows what to fix without crawling the server log.
        const failViolations = Array.isArray(verRes.body?.violations) ? verRes.body.violations : [];
        if (failViolations.length > 0) {
          console.log('');
          console.log('  Marketplace policy violations:');
          for (const v of failViolations) console.log(`    • ${v}`);
          console.log('');
          console.log(
            '  Fix the items above on the sys_package row (use --readme / --readme-file,\n' +
            '  --icon-url, --description, --category) and re-run with --submit or --auto-approve.',
          );
        }
        this.exit(1);
        return;
      }
      const ver = verRes.body?.data ?? verRes.body;
      const violations = Array.isArray(verRes.body?.violations) ? verRes.body.violations : [];
      const warnings = Array.isArray(ver?.warnings) ? ver.warnings : [];

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

      // Surface the listing state so authors know whether their package is
      // public yet. With --submit it lands in pending_review; with
      // --auto-approve it goes straight to approved (admins only).
      if (ver?.listing_status) {
        console.log('');
        printKV('  Listing', String(ver.listing_status));
        if (ver.listing_status === 'draft' && flags.visibility === 'marketplace') {
          console.log('');
          console.log(
            '  Hint: visibility is marketplace but the version is still draft. Pass --submit on the\n' +
            '        next publish (or POST /cloud/packages/:id/versions/:vid/submit) to request review.',
          );
        }
        if (ver.listing_status === 'pending_review') {
          console.log('');
          console.log('  A platform admin will review this version and either approve or reject it.');
        }
        if (ver.listing_status === 'approved') {
          console.log('');
          console.log('  Version is live in the public marketplace catalog.');
        }
      }
      if (warnings.length > 0) {
        console.log('');
        for (const w of warnings) console.log(`  ⚠️  ${w}`);
      }
      if (violations.length > 0) {
        console.log('');
        console.log('  Marketplace policy violations:');
        for (const v of violations) console.log(`    • ${v}`);
      }
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

  /**
   * POST raw bytes with a binary Content-Type. Used by the icon upload
   * step — the cloud icon route reads `req.rawBody()`.
   */
  private async postBinary(
    url: string,
    body: Uint8Array,
    contentType: string,
    token: string | undefined,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: new Blob([new Uint8Array(body)]),
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
        return { ok: false, status: 0, body: null, error: `Request timed out after ${timeoutMs}ms.` };
      }
      return { ok: false, status: 0, body: null, error: err?.message ?? String(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Map a local file extension to the cloud icon route's accepted Content-Type. */
function guessImageContentType(filePath: string): string | null {
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return null;
  switch (m[1]) {
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'svg':  return 'image/svg+xml';
    default:     return null;
  }
}
