// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack package install` — install a package into a RUNNING ObjectStack
 * runtime through its install-local endpoint (ADR-0008 Phase 3).
 *
 * Two modes, by argument shape:
 *
 *   os package install com.acme.crm [--version 1.2.0]
 *     Catalog mode: the runtime fetches the manifest snapshot from ITS
 *     configured catalog (`OS_CLOUD_URL` of the runtime, public R2
 *     fast-path first) and registers it into the live kernel.
 *
 *   os package install ./dist/objectstack.json
 *     Air-gapped mode: the compiled artifact is read locally and sent
 *     inline — no catalog round-trip, works fully offline.
 *
 * This complements `os package publish` (which uploads to the CLOUD): the
 * pairing is publish-to-cloud / install-into-runtime. The target runtime
 * authenticates the call with its own better-auth session — pass
 * --email/--password (or OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD) for an
 * account on the TARGET runtime, not your cloud login.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, printStep } from '../../utils/format.js';

export default class PackageInstall extends Command {
  static override description =
    'Install a package into a running ObjectStack runtime (catalog id or local artifact file)';

  static override examples = [
    '$ os package install com.acme.crm',
    '$ os package install com.acme.crm --version 1.2.0 --runtime http://localhost:3000',
    '$ os package install ./dist/objectstack.json                     # air-gapped, no catalog',
    '$ OS_RUNTIME_EMAIL=admin@local.test OS_RUNTIME_PASSWORD=… os package install com.acme.crm',
  ];

  static override args = {
    package: Args.string({
      description: 'Package manifest id (e.g. com.acme.crm) OR a path to a compiled artifact JSON',
      required: true,
    }),
  };

  static override flags = {
    runtime: Flags.string({
      char: 'r',
      description: 'Target runtime base URL (the instance to install INTO)',
      env: 'OS_RUNTIME_URL',
      default: 'http://localhost:3000',
    }),
    version: Flags.string({
      char: 'v',
      description: "Version to install in catalog mode (default: 'latest')",
      default: 'latest',
    }),
    email: Flags.string({
      description: 'Runtime account email (better-auth session on the target runtime)',
      env: 'OS_RUNTIME_EMAIL',
    }),
    password: Flags.string({
      description: 'Runtime account password',
      env: 'OS_RUNTIME_PASSWORD',
    }),
    timeout: Flags.integer({
      description: 'HTTP timeout in milliseconds (0 disables)',
      env: 'OS_CLOUD_TIMEOUT_MS',
      default: 120_000,
    }),
    // [ADR-0120 D5e] The installer's answer to the `isolated`-posture question.
    // Deliberately NOT default-on and deliberately not named `--force`: it
    // records an affirmative fact ("these constraints are genuinely
    // platform-wide") into the install manifest, where `os doctor` can later
    // show who affirmed it and when.
    'confirm-global-uniques': Flags.boolean({
      description:
        "Confirm this app's installation-wide (`unique: 'global'`) constraints are genuinely platform-wide when "
        + "installing into an 'isolated'-posture runtime (ADR-0120 D5e). Recorded in the install manifest; asked once.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PackageInstall);

    printHeader('Install Package');
    const runtime = flags.runtime.replace(/\/+$/, '');

    try {
      // ---- Resolve mode: inline artifact file vs catalog id ---------------
      const looksLikeFile = args.package.endsWith('.json')
        || args.package.startsWith('./')
        || args.package.startsWith('../')
        || args.package.startsWith('/')
        || existsSync(resolvePath(process.cwd(), args.package));

      let body: Record<string, any>;
      let label: string;
      if (looksLikeFile) {
        const artifactPath = resolvePath(process.cwd(), args.package);
        printStep(`Loading artifact from ${artifactPath}...`);
        let raw: string;
        try {
          raw = await readFile(artifactPath, 'utf-8');
        } catch (err: any) {
          printError(`Cannot read artifact: ${err.message}. Run \`objectstack build\` first.`);
          this.exit(1);
          return;
        }
        let artifact: any;
        try {
          artifact = JSON.parse(raw);
        } catch (err: any) {
          printError(`Artifact is not valid JSON: ${err.message}`);
          this.exit(1);
          return;
        }
        // install-local's inline (air-gapped) path expects the manifest
        // object; a compiled artifact nests it under `manifest` alongside
        // the metadata payload — send the whole artifact so objects/views
        // travel with it, but make sure an id is present at the top level.
        const manifest = artifact?.manifest && typeof artifact.manifest === 'object'
          ? { ...artifact, id: artifact.manifest.id ?? artifact.id, version: artifact.manifest.version ?? artifact.version }
          : artifact;
        body = { manifest };
        label = String(manifest.id ?? manifest.name ?? artifactPath);
        printSuccess(`Loaded artifact (${(raw.length / 1024).toFixed(1)} KB) — air-gapped inline install`);
      } else {
        body = { packageId: args.package, versionId: flags.version };
        label = `${args.package}@${flags.version}`;
        printStep(`Catalog install — the runtime resolves '${label}' from its configured catalog`);
      }

      // ---- Authenticate against the TARGET runtime ------------------------
      let cookie: string | undefined;
      if (flags.email && flags.password) {
        printStep(`Signing in to ${runtime} as ${flags.email}...`);
        // `Origin` is required: better-auth's CSRF check 403s origin-less
        // non-browser POSTs to the sign-in route.
        const signIn = await this.request(`${runtime}/api/v1/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: runtime },
          body: JSON.stringify({ email: flags.email, password: flags.password }),
        }, flags.timeout);
        if (!signIn.ok) {
          printError(`Runtime sign-in failed (${signIn.status}): ${signIn.error}`);
          this.exit(1);
          return;
        }
        cookie = signIn.setCookie;
        if (!cookie) {
          printError('Runtime sign-in returned no session cookie.');
          this.exit(1);
          return;
        }
        printSuccess('Signed in');
      }

      // ---- Install ---------------------------------------------------------
      printStep(`Installing ${label} into ${runtime}...`);
      if (flags['confirm-global-uniques']) body.confirmGlobalUniques = true;
      const res = await this.request(`${runtime}/api/v1/marketplace/install-local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      }, flags.timeout);

      if (!res.ok) {
        // [ADR-0120 D5e] The `isolated`-posture stop. Rendered as its own case
        // rather than a bare "Install failed (409)": the whole point of the gate
        // is that the installer READS the list and decides per index, so the
        // list has to survive the trip through the CLI intact.
        if (res.body?.error?.code === 'UNIQUE_SCOPE_CONFIRMATION_REQUIRED') {
          printError('Install stopped — installation-wide unique constraints need a decision (ADR-0120 D5e)');
          console.log('');
          for (const line of String(res.body.error.message).split('\n')) {
            console.log(`  ${line}`);
          }
          console.log('');
          console.log('  Confirm them as genuinely platform-wide:');
          console.log(`    os package install ${args.package} --confirm-global-uniques`);
          console.log("  …or edit the app's metadata to `unique: 'organization'` and rebuild.");
          this.exit(1);
          return;
        }
        if (res.status === 401) {
          printError(
            'The runtime rejected the call as unauthenticated. Pass --email/--password ' +
            '(or set OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD) for an account on the target runtime.',
          );
        } else if (res.status === 404) {
          printError(
            `install-local endpoint not found on ${runtime}. The target runtime must mount ` +
            'MarketplaceInstallLocalPlugin (see @objectstack/cloud-connection).',
          );
        } else {
          printError(`Install failed (${res.status}): ${res.error}`);
        }
        this.exit(1);
        return;
      }

      const data = res.body?.data ?? res.body ?? {};
      console.log('');
      printSuccess('Package installed into the running kernel');
      printKV('  Package',   String(data.manifestId ?? data.packageId ?? label));
      printKV('  Version',   String(data.version ?? flags.version));
      printKV('  Runtime',   runtime);
      if (data.installedAt) printKV('  Installed', String(data.installedAt));
      console.log('');
      // ⚠️ This path is a DESCRIPTION OF THE DEFAULT CONVENTION, deliberately
      // left as a literal — not a consumer restating a value it could have read
      // (#6643, the sibling half of #5996). Do not "fix" it into a reference to
      // `DEFAULT_INSTALLED_PACKAGES_DIR`. Four measured reasons, in order:
      //
      //   1. **The directory is on the REMOTE host.** Everything above this
      //      line came back over HTTP from `runtime`; this command never
      //      touches the target's disk. A constant resolved HERE describes the
      //      machine typing the command, not the one that stored the manifest.
      //   2. **The remote's directory is configurable, so the constant is only
      //      its default.** `MarketplaceInstallLocalPlugin` builds its ledger as
      //      `new LocalManifestSource(config.storageDir)` — the export is the
      //      fallback that ctor applies when the host configured nothing.
      //      Interpolating it would state a default as an observed fact.
      //   3. **The response we just read does not carry the real answer.** The
      //      POST returns `{ manifestId, version, versionId, installedAt,
      //      hotLoaded, upgradedFrom, translationsLoaded, seeded, note }` — no
      //      `storageDir`. The GET listing endpoint does carry one; this one
      //      does not, and asking for it would be an extra round-trip (and a
      //      new failure mode) bolted onto a success hint.
      //   4. **Importing it would cost this command its independence.** Every
      //      CLI reference to `@objectstack/cloud-connection` is a DYNAMIC load
      //      behind `loadOptionalPackage()` (doctor.ts) or a guarded `import()`
      //      (serve.ts), because the CLI must keep working where that package
      //      is absent or unbuilt. A static import for one hint line would make
      //      a pure-HTTP command fail at module load; a dynamic one needs a
      //      literal fallback — the exact `??` Prime Directive #12 forbids and
      //      #5996 deleted.
      //
      // So the divergence surface is accepted here, knowingly: if the constant
      // ever changes value, this sentence goes stale and no gate will say so.
      // The honest fix is upstream — the POST response carrying `storageDir`
      // like its GET sibling — which would let this line quote the real remote
      // directory. Tracked separately; `@objectstack/cloud-connection` is out
      // of scope for #6643.
      console.log('  The manifest is cached under .objectstack/installed-packages/ on the');
      console.log('  runtime host and re-registers on every boot (survives restarts).');
    } catch (error) {
      printError((error as Error).message);
      this.exit(1);
    }
  }

  /** Fetch wrapper: normalised envelope + captured Set-Cookie + timeout. */
  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; body: any; setCookie?: string; error?: string }> {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      let parsed: any = null;
      try { parsed = await response.json(); } catch { /* empty/non-json */ }
      // Session cookie: keep only the key=value pairs (drop attributes) so
      // it can be replayed as a request Cookie header.
      const rawSetCookie = response.headers.get('set-cookie') ?? undefined;
      const setCookie = rawSetCookie
        ?.split(/,(?=[^;]+?=)/)
        .map((p) => p.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
      if (!response.ok) {
        const errMsg = parsed?.error?.message ?? parsed?.error ?? response.statusText ?? `HTTP ${response.status}`;
        return { ok: false, status: response.status, body: parsed, setCookie, error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) };
      }
      return { ok: true, status: response.status, body: parsed, setCookie };
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
