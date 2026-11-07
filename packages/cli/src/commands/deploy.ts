// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os deploy` — put the app in this directory on your ObjectOS Cloud
 * environment, with no flags: build it, publish it as a dev version, install
 * that version into your organization's environment, and wait until the
 * environment serves it.
 *
 * ## Why one command whose defaults are the whole loop
 *
 * The same loop through `os package publish` is five things to remember — run
 * `os build` first, bump `manifest.version` every time (or the control plane
 * answers "version already exists"), know the environment id, pass
 * `--install`, and then guess when the environment has actually switched.
 * Every one of those is a default here; flags exist only for the uncommon
 * case (`--env` for an account that reaches several environments,
 * `--no-wait` to return as soon as the install is recorded).
 *
 * `os package publish` keeps its meaning: publish a RELEASE — the version the
 * manifest says — with `--install` optional. This command never publishes a
 * release version: what it mints is `<manifest.version>-dev.<YYYYMMDDHHMMSS>`
 * (`utils/dev-version.ts`).
 *
 * ## The order, and why every refusal comes before the first write
 *
 *   1. credential (`resolveCloudCredential`, shared with `os package publish`);
 *   2. environment (`resolveInstallTarget`, shared with `os package publish
 *      --install`) — none or several ⇒ refuse, naming `--env`;
 *   3. build (`compileForDeploy`) — a failed build prints its reasons and exits;
 *   4. version — a `manifest.version` that is not semver is refused;
 *   5. publish + install — `os package publish` itself, run in this process
 *      with the version and environment decided above, so the manifest id,
 *      namespace and `objectstack.manifest.json` rules stay in ONE place;
 *   6. wait (`waitUntilServed`, polling `data.served` — objectstack-ai/cloud#3651)
 *      — each poll first sends one request to the environment itself, because
 *      its builds are request-driven; live ⇒ 0; the environment's build failed
 *      ⇒ its reason and 1; timeout ⇒ what it waited for and 1.
 *
 * Steps 1–4 write nothing anywhere, so a refusal there leaves no package row,
 * no version and no installation behind.
 *
 * ⛔ No deploy on save, and no `os dev` watcher calls this: on ObjectOS Cloud
 * an organization's one environment is its production (cloud ADR-0024), so a
 * deploy is always a person's deliberate act — `os dev` offers it on a key.
 *
 * ⛔ Not the retired `os publish` id (see `package/publish.ts`'s header), on
 * purpose: that id is documented as removed and must stay unresolvable.
 *
 * ## A self-hosted runtime target
 *
 * When `os environments use-runtime` made a self-hosted runtime (the Docker
 * image, Community or Enterprise) the active deploy target, the same command
 * with no flags deploys THERE instead (`--env` still names a cloud environment
 * and deploys to it). There is no catalog and no version to mint: the build is
 * sent inline to the runtime's install-local door — `os package install` itself,
 * run in this process with the remembered url and key, so its refusals and
 * answers stay in ONE place:
 *
 *   1. build (`compileForDeploy`), as above;
 *   2. the dry run — the runtime's package upgrade plan of the installed
 *      version against this build, printed; nothing is installed. A runtime
 *      that refuses it, or does not serve install-local, stops the deploy here
 *      with its sentence and exit 1;
 *   3. the install, with `--confirm-access-upgrade` passed through; the door's
 *      refusals (an access upgrade to confirm, …) stop the deploy with exit 1;
 *   4. the answer — install-local registers the package in the live kernel
 *      before it answers, so the answer IS "live": `hotLoaded` ⇒ 0; a package
 *      the running kernel could not load ⇒ 1, naming the restart it waits for.
 *
 * Whether an upgrade is refused for a rename or a type change (epic
 * cloud#3652 Q3) is install-local's verdict, not this command's: a refusal it
 * answers is printed and stops the deploy like any other.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Command, Flags } from '@oclif/core';
import { printError, printHeader, printStep, printSuccess, printWarning, isExitSignal } from '../utils/format.js';
import { DEFAULT_CLOUD_URL, resolveCloudCredential } from '../utils/cloud-config.js';
import { describeEnvironment, resolveInstallTarget } from '../utils/install-target.js';
import { compileForDeploy } from '../utils/deploy-build.js';
import { devVersion } from '../utils/dev-version.js';
import { fetchEnvironmentOrigin, waitUntilServed, wakeEnvironment, type ServedVersionVerdict } from '../utils/served-version.js';
import { activeRuntimeTarget } from '../utils/runtime-target.js';
import type { RuntimeTarget } from '../utils/cloud-config.js';
import PackagePublish from './package/publish.js';
import PackageInstall from './package/install.js';

/** The artifact the build writes and the publish reads — `os build`'s default output. */
export const DEPLOY_ARTIFACT = 'dist/objectstack.json';

/** How often the wait asks the control plane. */
export const DEPLOY_POLL_INTERVAL_MS = 3_000;

export default class Deploy extends Command {
  static override description =
    'Deploy this app to your ObjectOS Cloud environment (build it, publish a dev version, install it, and wait until '
    + 'it is live), or to the self-hosted runtime `os environments use-runtime` made the active target';

  static override examples = [
    '$ os deploy',
    '$ os deploy --env env_abc123    # your account reaches several environments',
    '$ os deploy --no-wait           # return once the install is recorded',
    '$ os deploy --confirm-access-upgrade <finding-set>   # self-hosted: confirm the findings the runtime printed',
  ];

  static override flags = {
    env: Flags.string({
      description:
        'Environment id to deploy into. Defaults to the environment `os environments switch` recorded '
        + "for this control plane, then to your organization's only environment",
      env: 'OS_ENVIRONMENT_ID',
    }),
    wait: Flags.boolean({
      description: 'Wait until the environment serves the new version (default: on). Disable with --no-wait.',
      default: true,
      allowNo: true,
    }),
    // 600 s, not less: a failed build is reported only after three failed
    // rounds in a row (or a build that outruns its own timeout), so a broken
    // build can read `pending` for minutes before it reads `failed`.
    'wait-timeout': Flags.integer({
      description: 'Seconds to wait for the environment to serve the new version',
      default: 600,
      min: 1,
    }),
    server: Flags.string({
      char: 's',
      description: 'ObjectOS Cloud control-plane URL (override for self-hosted control planes)',
      env: 'OS_CLOUD_URL',
      default: DEFAULT_CLOUD_URL,
    }),
    token: Flags.string({
      char: 't',
      description: 'API key for ObjectOS Cloud (bearer token; defaults to OS_CLOUD_API_KEY / OS_TOKEN, then `os cloud login`)',
      env: 'OS_CLOUD_API_KEY',
    }),
    'confirm-access-upgrade': Flags.string({
      description:
        'Self-hosted runtime target: confirm the access findings of this upgrade with the finding-set token the '
        + "runtime's refusal printed (as `os package install --confirm-access-upgrade`)",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Deploy);
    printHeader('Deploy');

    try {
      // 0. Target: the self-hosted runtime when it is the active one and no
      // cloud environment was named.
      const runtime = flags.env ? undefined : await activeRuntimeTarget();
      if (runtime) {
        await this.deployToRuntime(runtime, flags['confirm-access-upgrade']);
        return;
      }
      if (flags['confirm-access-upgrade'] !== undefined) {
        printError(
          '`--confirm-access-upgrade` confirms a self-hosted runtime\'s refusal; the deploy target is ObjectOS Cloud. '
          + 'Drop the flag, or record the runtime with `os environments use-runtime <url> --token <key>`.',
        );
        this.exit(1);
        return;
      }

      // 1. Credential.
      const { token, baseUrl } = await resolveCloudCredential({ token: flags.token, server: flags.server });
      if (!token) {
        printError('Not logged in to ObjectOS Cloud. Run `os cloud login` first, then `os deploy` again.');
        this.exit(1);
        return;
      }

      // 2. Environment — before the build, so a deploy that has nowhere to go
      // says so in a second rather than after a compile.
      const target = await resolveInstallTarget({
        subject: '`os deploy`',
        explicit: flags.env,
        baseUrl,
        token,
        timeoutMs: 30_000,
      });
      if (target.kind === 'refused') {
        printError(target.message);
        this.exit(1);
        return;
      }
      const where = describeEnvironment({ id: target.environmentId, displayName: target.displayName });
      printStep(
        target.source === 'only'
          ? `Deploying to ${where}, your organization's only environment`
          : `Deploying to ${where}`,
      );

      // 3. Build.
      const artifactPath = resolvePath(process.cwd(), DEPLOY_ARTIFACT);
      printStep('Building...');
      if (compileForDeploy(artifactPath) !== 0) {
        printError('The build failed — fix the errors above, then run `os deploy` again. Nothing was published.');
        this.exit(1);
        return;
      }

      // 4. Version.
      let artifact: any;
      try {
        artifact = JSON.parse(await readFile(artifactPath, 'utf-8'));
      } catch (err: any) {
        printError(`The build reported success but ${DEPLOY_ARTIFACT} cannot be read: ${err.message}`);
        this.exit(1);
        return;
      }
      const versioned = devVersion(artifact?.manifest?.version, new Date());
      if (!versioned.ok) {
        printError(`${versioned.reason}. Fix \`manifest.version\` in objectstack.config.ts, then run \`os deploy\` again.`);
        this.exit(1);
        return;
      }

      // 5. Publish + install, through `os package publish` itself.
      const publish = new PackagePublish(
        [
          artifactPath,
          '--version', versioned.version,
          '--install',
          '--env', target.environmentId,
          '--server', baseUrl,
          ...(flags.token ? ['--token', flags.token] : []),
        ],
        this.config,
      );
      await publish.run();
      const outcome = publish.outcome;
      if (!outcome?.installedInto) {
        printError(
          `${baseUrl} published ${versioned.version} but did not report installing it into ${where}. `
          + 'Check the environment in the ObjectOS Cloud console.',
        );
        this.exit(1);
        return;
      }

      // 6. Wait.
      if (!flags.wait) {
        console.log('');
        printSuccess(`Installed ${outcome.manifestId} ${outcome.version} into ${where} (not waiting).`);
        console.log('  The environment rebuilds in the background and serves the previous build until then.');
        return;
      }
      console.log('');
      printStep(`Waiting until ${where} serves ${outcome.manifestId} ${outcome.version}...`);
      const served = {
        baseUrl: outcome.baseUrl,
        token: outcome.token,
        environmentId: target.environmentId,
        manifestId: outcome.manifestId,
        version: outcome.version,
        versionId: outcome.versionId,
      };
      // The environment rebuilds only when it gets a request, so the wait sends
      // it one per poll. Without its URL the rebuild waits for real traffic.
      const origin = await fetchEnvironmentOrigin(served);
      if (!origin) {
        printWarning(
          `${baseUrl} did not report ${where}'s URL, so this cannot nudge its rebuild: `
          + 'it starts when the environment next gets a request (open the app).',
        );
      }
      const verdict = await waitUntilServed(served, {
        timeoutMs: flags['wait-timeout'] * 1000,
        intervalMs: DEPLOY_POLL_INTERVAL_MS,
        wake: origin ? () => wakeEnvironment(origin) : undefined,
        onPending: (observed) => printStep(`  still waiting — ${observed}`),
      });
      const code = reportVerdict(verdict, { where, manifestId: outcome.manifestId, version: outcome.version, baseUrl });
      if (code !== 0) this.exit(code);
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError((error as Error).message);
      this.exit(1);
    }
  }

  /**
   * The self-hosted half (the header's "A self-hosted runtime target"):
   * build → dry run (plan printed) → install → the `hotLoaded` answer.
   */
  private async deployToRuntime(runtime: RuntimeTarget, confirmAccessUpgrade: string | undefined): Promise<void> {
    printStep(`Deploying to the self-hosted runtime ${runtime.url} (os environments use-runtime)`);

    printStep('Building...');
    const artifactPath = resolvePath(process.cwd(), DEPLOY_ARTIFACT);
    if (compileForDeploy(artifactPath) !== 0) {
      printError('The build failed — fix the errors above, then run `os deploy` again. Nothing was installed.');
      this.exit(1);
      return;
    }

    const install = async (extra: string[]) => {
      const command = new PackageInstall(
        [artifactPath, '--url', runtime.url, '--token', runtime.token, ...extra],
        this.config,
      );
      command.retryCommand = 'os deploy';
      command.embedded = true;
      await command.run();
      return command.outcome;
    };

    console.log('');
    printStep(`Asking ${runtime.url} for the upgrade plan (dry run — nothing is installed)...`);
    const plan = await install(['--dry-run']);
    if (plan?.kind !== 'dry-run') {
      printError(`${runtime.url} did not answer the dry run with a plan, so nothing more was sent. Upgrade the runtime, then run \`os deploy\` again.`);
      this.exit(1);
      return;
    }

    printStep(`Installing ${plan.manifestId} ${plan.version} into ${runtime.url}...`);
    const outcome = await install(confirmAccessUpgrade !== undefined ? ['--confirm-access-upgrade', confirmAccessUpgrade] : []);
    if (outcome?.kind !== 'installed') {
      printError(`${runtime.url} did not answer the install as a managed package install, so this cannot say ${plan.manifestId} is live (see above).`);
      this.exit(1);
      return;
    }
    if (!outcome.hotLoaded) {
      printError(
        `${runtime.url} recorded ${outcome.manifestId} ${outcome.version}, but its running kernel could not load it, so `
        + 'it is not live: it loads when the runtime restarts. Fix the cause above, then run `os deploy` again.',
      );
      this.exit(1);
      return;
    }
    printSuccess(`Live: ${runtime.url} now serves ${outcome.manifestId} ${outcome.version}.`);
  }
}

/** Print the wait's verdict; return the exit code it means. */
export function reportVerdict(
  verdict: ServedVersionVerdict,
  ctx: { where: string; manifestId: string; version: string; baseUrl: string },
): number {
  const what = `${ctx.manifestId} ${ctx.version}`;
  console.log('');
  switch (verdict.kind) {
    case 'served':
      printSuccess(`Live: ${ctx.where} now serves ${what}.`);
      if (verdict.incomplete) {
        printWarning(
          "Some functionality is incomplete: the environment's plan withholds a capability this app requires.",
        );
      }
      return 0;
    case 'failed':
      printError(`${ctx.where} could not build ${what}: ${verdict.reason}`);
      console.log('  It keeps serving the previous build. Fix the cause, then run `os deploy` again.');
      return 1;
    case 'timeout':
      printError(
        `Timed out after ${Math.round(verdict.waitedMs / 1000)}s waiting for ${ctx.where} to serve ${what} `
        + `(last report: ${verdict.lastObserved}). The install is recorded and the environment keeps serving the `
        + 'previous build meanwhile. A failing build is reported only after three failed rounds in a row, so it can '
        + 'read as still building for minutes; wait longer with --wait-timeout <seconds>, or open the environment '
        + 'in the ObjectOS Cloud console to see its build.',
      );
      return 1;
    case 'superseded':
      printError(
        `${ctx.where} no longer points at ${what}: another install replaced it (now version id `
        + `${verdict.desiredVersionId}), so whether ${ctx.version} went live no longer matters. Run \`os deploy\` again `
        + 'to put this build back.',
      );
      return 1;
    case 'unreadable':
      printError(
        `Installed ${what} into ${ctx.where}, but its installation could not be read back `
        + `(${verdict.status || 'no response'}: ${verdict.error}), so whether it is live is unknown.`,
      );
      return 1;
    case 'unsupported':
      printWarning(
        `Installed ${what} into ${ctx.where}, but ${ctx.baseUrl} does not report which version an environment `
        + 'serves yet, so this cannot confirm it is live. The environment rebuilds in the background and serves '
        + 'the previous build until then.',
      );
      return 0;
  }
}
