// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack package install` — install a package into a RUNNING ObjectStack
 * runtime through its install-local endpoint (ADR-0008 Phase 3).
 *
 * Two sources, by argument shape:
 *
 *   os package install com.acme.crm [--version 1.2.0]
 *     Catalog source: the runtime fetches the manifest snapshot from ITS
 *     configured catalog (`OS_CLOUD_URL` of the runtime, public R2
 *     fast-path first) and installs it.
 *
 *   os package install ./dist/objectstack.json
 *     Air-gapped source: the compiled artifact is read locally and sent
 *     inline — no catalog round-trip, works fully offline.
 *
 * Two install MODES, by `--install-mode` (ADR-0131 D6), either source:
 *
 *   managed (the default) — the package is registered into the live kernel as
 *     code and stays the authority: it upgrades, and nothing it ships is
 *     edited in place.
 *   unmanaged — the package's metadata is copied ONCE into the environment as
 *     a new writable base: the environment's own metadata, followed by no
 *     upgrade, and
 *     refused by a runtime whose tenancy posture walls organizations. Only for
 *     a package whose manifest's `installModes` permits it. The package's
 *     protection locks are not copied, in either spelling; each one dropped
 *     is printed as
 *     `<type>.<name>: <lock> — <reason>`.
 *
 * "Source" and "mode" are two words for two questions on purpose: where the
 * package comes from, and how it is installed.
 *
 * A base's paired customization package — `<base>.custom`, what
 * `os package export` writes for the overrides an administrator authored
 * (ADR-0146 D2 / D3) — is neither: the runtime writes its items into ITS OWN
 * writable pair of that base, as Studio would, so the overrides are served,
 * listed by the base's customization read, and stay editable there. Printed
 * as such; a runtime that answers it as a managed install (one that predates
 * the pair install, and registered it as read-only code) is printed as the
 * failure it is, with the way back.
 *
 * This complements `os package publish` (which uploads to the CLOUD): the
 * pairing is publish-to-cloud / install-into-runtime. The target runtime
 * authenticates the call itself — pass a token it issued (-t/--token, or
 * OS_RUNTIME_TOKEN), or --email/--password (or OS_RUNTIME_EMAIL /
 * OS_RUNTIME_PASSWORD) for an account on the TARGET runtime, not your cloud
 * login.
 *
 * [#30126 row 13, ruling A] The server and the credential are spelled as
 * `os package export` and the other server-talking commands spell them:
 * `-u/--url` and `-t/--token`. `-r/--runtime` is retired with no alias — the
 * startup rule keeps no window for an old spelling — so `os package install
 * -r URL` is refused by the parser as an unknown flag and the fix is `-u URL`.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { INSTALL_MODES, customizationBasePackageId, type InstallMode } from '@objectstack/spec/kernel';
import { printHeader, printKV, printSuccess, printWarning, printError, printStep, isExitSignal } from '../../utils/format.js';

/**
 * [#28640 ruling ③A] The connector maps the package export withheld whole,
 * as the install-local answer names them (`withheldMaps`, either install
 * mode): one warning, one line per map — `connector 'NAME' PATH`, the
 * answer's own position spelling — and the remedy. The connector is installed
 * and runs, but sends none of those headers or environment variables until
 * each map is supplied again, so an operator who installs an export from the
 * command line is told here; the runtime's `warn` line lands in a log the
 * operator may never read.
 *
 * Printed from the answer only: an answer without the list (nothing was
 * withheld, or a runtime that predates the key) prints nothing, and nothing
 * is guessed from the artifact the command sent.
 */
function printWithheldMaps(withheldMaps: unknown): void {
  const maps: Array<{ type?: unknown; name?: unknown; path?: unknown }> =
    Array.isArray(withheldMaps) ? withheldMaps : [];
  if (maps.length === 0) return;
  console.log('');
  printWarning(
    `${maps.length} connector map(s) arrived empty — the package export withheld each one whole, so the connector `
    + 'sends none of those headers or environment variables:',
  );
  for (const map of maps) console.log(`    ${String(map.type)} '${String(map.name)}' ${String(map.path)}`);
  console.log('  Re-enter each map where the connector is authored.');
}

export default class PackageInstall extends Command {
  static override description =
    'Install a package into a running ObjectStack runtime (catalog id or local artifact file)';

  static override examples = [
    '$ os package install com.acme.crm',
    '$ os package install com.acme.crm --version 1.2.0 --url http://localhost:3000',
    '$ os package install ./dist/objectstack.json                     # air-gapped, no catalog',
    '$ os package install ./dist/objectstack.json --install-mode unmanaged   # copy into the environment as its own metadata',
    '$ OS_RUNTIME_EMAIL=admin@local.test OS_RUNTIME_PASSWORD=… os package install com.acme.crm',
    '$ os package install ./dist/objectstack.json --url https://app.example.com --token osk_…',
  ];

  static override args = {
    package: Args.string({
      description: 'Package manifest id (e.g. com.acme.crm) OR a path to a compiled artifact JSON',
      required: true,
    }),
  };

  static override flags = {
    url: Flags.string({
      char: 'u',
      description: 'Server URL of the runtime to install INTO',
      env: 'OS_RUNTIME_URL',
      default: 'http://localhost:3000',
    }),
    token: Flags.string({
      char: 't',
      description: 'Authentication token issued by the target runtime (an API key); instead of --email/--password',
      env: 'OS_RUNTIME_TOKEN',
    }),
    version: Flags.string({
      char: 'v',
      description: "Version to install from the catalog (default: 'latest')",
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
    // platform-wide") into the install manifest, rather than overriding a
    // check. `os doctor` reads that record back on every later run, but only
    // to SUPPRESS re-reporting the constraints this ceremony already answered
    // for (`unconfirmedGlobalUniques` in `@objectstack/types`) — an attested
    // install does not become the recurring nag the gate exists to avoid. It
    // does not display who affirmed it or when.
    // [ADR-0131 D6] How the package is installed — the install-local body's
    // `installMode`, spelled by the manifest key's own enum. Not defaulted
    // here: an absent flag sends no `installMode`, which the runtime reads as
    // `managed`, so a runtime that predates the key receives the body it
    // always did.
    'install-mode': Flags.string({
      description:
        "How to install: 'managed' (default — registered as code, upgradeable) or 'unmanaged' (copied once into the "
        + "environment as its own metadata, no upgrade; the package's `installModes` must permit it, and a runtime "
        + 'that walls organizations refuses it)',
      options: [...INSTALL_MODES],
    }),
    'confirm-global-uniques': Flags.boolean({
      description:
        "Confirm this app's installation-wide (`unique: 'global'`) constraints are genuinely platform-wide when "
        + "installing into an 'isolated'-posture runtime (ADR-0120 D5e). Recorded in the install manifest; asked once.",
      default: false,
    }),
    // [ADR-0126 §6 wall 3] The confirmation of an upgrade's access findings —
    // a switch-off a vendor rename re-enables, a choice whose name the
    // package no longer ships. A TOKEN, not a boolean: the finding set's
    // digest the runtime's refusal printed, so it confirms exactly the
    // findings shown, and a set that changed since is refused again.
    'confirm-access-upgrade': Flags.string({
      description:
        "Confirm the access findings of this upgrade with the finding-set token the runtime's refusal printed "
        + '(ACCESS_UPGRADE_CONFIRMATION_REQUIRED). It confirms exactly those findings; a changed set is refused again.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PackageInstall);

    printHeader('Install Package');
    const runtime = flags.url.replace(/\/+$/, '');

    // One credential per call: a token and a password sign-in name two
    // identities, and picking one silently would install as whichever the
    // command happened to prefer.
    if (flags.token && (flags.email || flags.password)) {
      printError(
        'Pass either --token or --email/--password, not both '
        + '(OS_RUNTIME_TOKEN counts as --token; OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD count as --email/--password).',
      );
      this.exit(1);
      return;
    }

    try {
      // ---- Resolve the source: inline artifact file vs catalog id ---------
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
      if (flags.token) {
        printStep(`Authenticating to ${runtime} with a token`);
      } else if (flags.email && flags.password) {
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
      if (flags['confirm-access-upgrade'] !== undefined) body.confirmAccessUpgrade = flags['confirm-access-upgrade'];
      const installMode = flags['install-mode'] as InstallMode | undefined;
      if (installMode !== undefined) body.installMode = installMode;
      const res = await this.request(`${runtime}/api/v1/marketplace/install-local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(flags.token ? { Authorization: `Bearer ${flags.token}` } : {}),
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
        // [ADR-0126 §6 wall 3] The access upgrade stop: every finding, then
        // the exact retry — the decision is the installer's, per finding.
        if (res.body?.error?.code === 'ACCESS_UPGRADE_CONFIRMATION_REQUIRED') {
          const details = res.body.error.details ?? {};
          const findings: Array<{ describe?: string }> = Array.isArray(details.findings) ? details.findings : [];
          printError("Upgrade stopped — it would change what this system's access choices cover");
          console.log('');
          for (const finding of findings) console.log(`  • ${finding.describe ?? JSON.stringify(finding)}`);
          console.log('');
          console.log('  Review each finding. To upgrade anyway, confirm exactly these findings:');
          console.log(`    os package install ${args.package} --confirm-access-upgrade ${details.findingSet}`);
          this.exit(1);
          return;
        }
        if (res.status === 401) {
          printError(
            'The runtime rejected the call as unauthenticated. Pass --token (or OS_RUNTIME_TOKEN) with a ' +
            'token the target runtime issued, or --email/--password (or OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD) ' +
            'for an account on the target runtime.',
          );
        } else if (res.status === 404) {
          printError(
            `install-local endpoint not found on ${runtime}. The target runtime must mount ` +
            'MarketplaceInstallLocalPlugin (see @objectstack/cloud-connection).',
          );
        } else {
          // [#21489] The runtime's refusal is printed with its CODE beside the
          // status, for every refusal alike — the code is the machine-readable
          // half an installer (human or AI) branches on, and the message carries
          // the remedy (e.g. a package whose enabled job has no `body`:
          // `422 VALIDATION_ERROR`, "give the job a `body`, or boot it with
          // `os start --artifact`"). No case per code: a refusal this command
          // has never heard of renders the same way.
          const code = typeof res.body?.error?.code === 'string' ? ` ${res.body.error.code}` : '';
          printError(`Install failed (${res.status}${code}): ${res.error}`);
        }
        this.exit(1);
        return;
      }

      const data = res.body?.data ?? res.body ?? {};

      // [ADR-0146 D3, #30106] A base's paired customization package answers
      // its own shape too: the writable pair its items were written into,
      // never a kernel registration or a cached manifest — so, as for an
      // unmanaged install, none of the managed lines below is true of it.
      const pair = data.customizationPair;
      if (pair && typeof pair === 'object' && typeof pair.packageId === 'string') {
        console.log('');
        printSuccess(
          `Customization package installed into the writable pair of '${String(pair.basePackageId)}' — `
          + 'its overrides are served now, and the pair stays editable on this runtime',
        );
        printKV('  Package',   String(data.manifestId ?? label));
        printKV('  Version',   String(data.version ?? flags.version));
        printKV('  Runtime',   runtime);
        printKV('  Pair',      `${pair.packageId}${pair.created === true ? ' (created by this install)' : ''}`);
        if (typeof data.writtenCount === 'number') printKV('  Items written', String(data.writtenCount));
        if (data.seeded?.mode === 'skipped' && typeof data.seeded.reason === 'string') {
          printKV('  Sample data', `not loaded — ${data.seeded.reason}`);
        }
        printWithheldMaps(data.withheldMaps);
        console.log('');
        return;
      }
      // Sent a pair, answered as a managed install: the runtime predates the
      // pair install and registered the pair as CODE — read-only, serving none
      // of its overrides. Said out loud, never printed as a success: that
      // answer is what #30106 measured.
      if (customizationBasePackageId(String(data.manifestId ?? label)) !== null) {
        const pairId = String(data.manifestId ?? label);
        printError(
          `The runtime at ${runtime} installed ${pairId} as code, not into its writable pair: it serves none of the `
          + 'package\'s overrides and leaves the pair read-only. Uninstall it '
          + `(\`DELETE ${runtime}/api/v1/marketplace/install-local/${pairId}\`), upgrade and restart the runtime, `
          + 'then install it again.',
        );
        this.exit(1);
        return;
      }

      // [ADR-0131 D6] An unmanaged install answers its own shape: what was
      // copied and where, never a kernel registration — so none of the
      // managed lines below (hot-load, the cached-manifest directory that
      // "re-registers on every boot") is true of it, and none is printed.
      if (data.installMode === 'unmanaged') {
        console.log('');
        printSuccess('Package copied into the environment (unmanaged) — its items are this environment\'s own metadata, and it follows no upgrade');
        printKV('  Package',   String(data.manifestId ?? label));
        printKV('  Version',   String(data.version ?? flags.version));
        printKV('  Runtime',   runtime);
        if (typeof data.targetPackageId === 'string') printKV('  Base', data.targetPackageId);
        if (typeof data.copiedCount === 'number') printKV('  Items copied', String(data.copiedCount));
        // [ADR-0131 D6, ADR-0010 §3.3] Every lock the package shipped and the
        // copy does not keep, one line each, with the package's reason
        // verbatim (the D6 lock-fork ruling's own spelling, record 6119681934)
        // — so the installer reads why the vendor locked an item before
        // editing it. A runtime that predates the list states none: nothing
        // is printed, and nothing is guessed.
        const strippedLocks: Array<{ type?: unknown; name?: unknown; lock?: unknown; reason?: unknown }> =
          Array.isArray(data.strippedLocks) ? data.strippedLocks : [];
        if (strippedLocks.length > 0) {
          printKV('  Locks removed', `${strippedLocks.length} — the package locked these items; the copy is editable`);
          for (const entry of strippedLocks) {
            const reason = typeof entry.reason === 'string' ? ` — ${entry.reason}` : '';
            console.log(`    ${String(entry.type)}.${String(entry.name)}: ${String(entry.lock)}${reason}`);
          }
        }
        const from = data.installedFrom;
        if (from && typeof from.packageId === 'string') {
          printKV('  Installed from', typeof from.version === 'string' ? `${from.packageId}@${from.version}` : from.packageId);
        }
        if (data.seeded?.mode === 'skipped' && typeof data.seeded.reason === 'string') {
          printKV('  Sample data', `not loaded — ${data.seeded.reason}`);
        }
        printWithheldMaps(data.withheldMaps);
        console.log('');
        return;
      }
      // Asked for `unmanaged`, answered without it: the runtime predates the
      // install mode, read no `installMode`, and installed the package
      // MANAGED. Said out loud — the opposite of what was asked happened.
      if (installMode === 'unmanaged') {
        printError(
          `The runtime at ${runtime} does not support unmanaged installs: it ignored \`--install-mode unmanaged\` `
          + `and installed ${label} MANAGED (registered as code, not copied). Upgrade the runtime, then uninstall `
          + 'the package and install it again with `--install-mode unmanaged`.',
        );
        this.exit(1);
        return;
      }
      // [#22729] A `200` is not by itself a hot install. install-local's
      // LENIENT path — a cloud-fetched manifest whose `manifest.register`
      // throws — writes the ledger entry and answers `200` with
      // `hotLoaded: false` and the register error's message as `hotLoadError`
      // (#22695): the package is installed and loads at the runtime's next
      // restart, and the running kernel does not hold it. Only an explicit
      // `false` is read that way; an answer without the key (a host that
      // predates it) prints as it always did. The air-gapped file path never
      // reaches this answer — an inline manifest whose register throws is
      // refused `422 PLUGIN_REGISTER_FAILED` — but the read is the same code.
      //
      // ⛔ No invented reason: a `hotLoaded: false` whose `hotLoadError` is
      // missing, blank or not a string prints no reason line at all.
      const notHotLoaded = data.hotLoaded === false;
      const hotLoadError = typeof data.hotLoadError === 'string' ? data.hotLoadError.trim() : '';
      console.log('');
      if (notHotLoaded) {
        printWarning(
          "Package installed, but the running kernel could not load it — it loads at the runtime's next restart",
        );
      } else {
        printSuccess('Package installed into the running kernel');
      }
      printKV('  Package',   String(data.manifestId ?? data.packageId ?? label));
      printKV('  Version',   String(data.version ?? flags.version));
      printKV('  Runtime',   runtime);
      if (data.installedAt) printKV('  Installed', String(data.installedAt));
      if (notHotLoaded && hotLoadError) printKV('  Hot-load error', hotLoadError);
      printWithheldMaps(data.withheldMaps);
      console.log('');
      // #6721: the cache directory is quoted from the RESPONSE, never from a
      // literal or a locally-resolved constant. The directory lives on the
      // REMOTE host — everything above this line came back over HTTP from
      // `runtime`, and this command never touches the target's disk — so the
      // only truthful source is the host itself. #6643 documented at length why
      // no consumer-side answer works (a local constant describes the machine
      // typing the command; it is only the *default*, wrong the moment a host
      // configures `storageDir`; a static import of
      // `@objectstack/cloud-connection` would make a pure-HTTP command fail at
      // module load). The fix was upstream, and it landed: the POST response now
      // carries `storageDir: this.storageDir` — the same resolved value
      // (`ledger.dir`) its GET listing sibling already served.
      //
      // ⛔ No fallback. When the field is missing — an older host that predates
      // the producer half — this block prints NOTHING. A `??
      // '.objectstack/installed-packages/'` would re-introduce exactly the
      // defect Prime Directive #12 forbids and #5996 deleted: a consumer
      // inventing a value the producer declined to state. Saying less is
      // correct; guessing is not. An empty or non-string value is the same
      // "host did not state it" case, not a reason to print a blank path.
      const storageDir = typeof data.storageDir === 'string' ? data.storageDir.trim() : '';
      if (storageDir) {
        console.log('  The manifest is cached on the runtime host and re-registers on every');
        console.log('  boot (survives restarts):');
        console.log(`    ${storageDir}`);
      }
    } catch (error) {
      if (isExitSignal(error)) throw error;
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
