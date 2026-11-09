// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { isExitSignal, printError, printStep, printSuccess } from '../../utils/format.js';
import { forgetRuntimeTarget, recordRuntimeTarget } from '../../utils/runtime-target.js';
import { getCloudCredentialsPath } from '../../utils/cloud-config.js';

/**
 * `os environments use-runtime <url> --token <key>` — remember a SELF-HOSTED
 * runtime (ObjectStack's Docker image, Community or Enterprise) as the deploy
 * target, beside `os environments switch`, which picks an ObjectOS Cloud
 * environment. Whichever of the two ran last is the target `os deploy` and
 * `os dev`'s `d` key use; `os package install` falls back to this runtime when
 * `-u` / `-t` are not given.
 *
 * The url and an API key the runtime issued are stored in
 * `~/.objectstack/cloud.json` (0600), the file the cloud token lives in, as
 * their own record (`utils/cloud-config.ts` states the split; storage and
 * resolution are `utils/runtime-target.ts`). The key is sent only to this url.
 *
 * Before anything is written the key is tried on the runtime's install-local
 * door (`GET /api/v1/marketplace/install-local`, which answers only an
 * authenticated caller): a key the runtime rejects, a runtime that does not
 * serve the door, or one that cannot be reached is refused, naming why —
 * `--no-verify` records it anyway (a container that is not up yet).
 *
 * `--forget` drops the record; the cloud is the deploy target again.
 */
export default class EnvironmentsUseRuntime extends Command {
  static override description =
    'Remember a self-hosted runtime (url + API key) as the deploy target for `os deploy`, the `d` key in `os dev`, '
    + 'and `os package install`';

  static override examples = [
    '$ os environments use-runtime http://localhost:8080 --token osk_…',
    '$ OS_RUNTIME_TOKEN=osk_… os environments use-runtime https://objectos.example.com',
    '$ os environments use-runtime --forget          # deploy to ObjectOS Cloud again',
  ];

  static override args = {
    url: Args.string({ description: 'Base URL of the self-hosted runtime (e.g. http://localhost:8080)' }),
  };

  static override flags = {
    token: Flags.string({
      char: 't',
      description: 'An API key the runtime issued (sent only to this runtime)',
      env: 'OS_RUNTIME_TOKEN',
    }),
    verify: Flags.boolean({
      description: 'Try the key on the runtime before recording it (default: on). Disable with --no-verify.',
      default: true,
      allowNo: true,
    }),
    forget: Flags.boolean({
      description: 'Forget the remembered runtime; ObjectOS Cloud is the deploy target again',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvironmentsUseRuntime);

    try {
      if (flags.forget) {
        if (args.url) {
          printError('Pass either a runtime url or --forget, not both.');
          this.exit(1);
          return;
        }
        const forgotten = await forgetRuntimeTarget();
        console.log(forgotten
          ? `\n✓ Forgot the self-hosted runtime ${forgotten.url}. \`os deploy\` deploys to ObjectOS Cloud again.\n`
          : '\n✓ No self-hosted runtime was remembered. `os deploy` deploys to ObjectOS Cloud.\n');
        return;
      }

      const url = normalizeRuntimeUrl(args.url);
      if (!url.ok) {
        printError(url.message);
        this.exit(1);
        return;
      }
      if (!flags.token) {
        printError(
          'A self-hosted runtime needs an API key it issued: pass --token <key> (or set $OS_RUNTIME_TOKEN). '
          + 'Create one in the runtime\'s Setup → API Keys.',
        );
        this.exit(1);
        return;
      }

      if (flags.verify) {
        printStep(`Trying the key on ${url.value}...`);
        const probe = await probeRuntime(url.value, flags.token);
        if (!probe.ok) {
          printError(`${probe.message} Nothing was recorded. (Record it anyway with --no-verify.)`);
          this.exit(1);
          return;
        }
      }

      await recordRuntimeTarget(url.value, flags.token);
      printSuccess(`Deploy target: the self-hosted runtime ${url.value}`);
      console.log(`  Recorded in ${getCloudCredentialsPath()}. \`os deploy\` and the \`d\` key in \`os dev\` install there,`);
      console.log('  and `os package install` uses it when -u/-t are not given.');
      console.log('  Deploy to ObjectOS Cloud again: `os environments switch <id>` or `os environments use-runtime --forget`.');
      console.log('');
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      printError(error?.message || String(error));
      this.exit(1);
    }
  }
}

/** An http(s) url with no query or fragment, trailing slashes dropped. */
export function normalizeRuntimeUrl(raw: string | undefined): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { ok: false, message: 'Name the runtime: `os environments use-runtime <url> --token <key>` (or --forget).' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: `'${trimmed}' is not a url. Pass the runtime's base url, e.g. http://localhost:8080.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `'${trimmed}' is not an http(s) url. Pass the runtime's base url, e.g. http://localhost:8080.` };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, message: `'${trimmed}' carries a query or fragment. Pass the runtime's base url only.` };
  }
  return { ok: true, value: `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}` };
}

/**
 * One authenticated read of the install-local door — the door `os deploy`
 * will POST to. Never throws.
 */
export async function probeRuntime(
  url: string,
  token: string,
  timeoutMs = 15_000,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/v1/marketplace/install-local`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: `${url} rejected the key (${response.status}). Pass an API key this runtime issued (Setup → API Keys).`,
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        message:
          `${url} does not serve install-local (GET /api/v1/marketplace/install-local answered 404), so it cannot `
          + 'take a deploy. A runtime booted from a composed artifact takes no package installs; any other runtime '
          + 'must mount MarketplaceInstallLocalPlugin (@objectstack/cloud-connection).',
      };
    }
    return { ok: false, message: `${url} answered ${response.status} ${response.statusText} to an authenticated read.` };
  } catch (err: any) {
    const why = err?.name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : (err?.message ?? String(err));
    return { ok: false, message: `${url} cannot be reached (${why}). Is the runtime running, and is this its url?` };
  } finally {
    clearTimeout(timer);
  }
}
