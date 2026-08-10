// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack cloud login` — authenticate against the ObjectStack Cloud
 * package registry (`https://cloud.objectos.ai` by default).
 *
 * This is distinct from `os login`, which authenticates against your
 * *runtime* ObjectOS instance. Cloud credentials are persisted to
 * `~/.objectstack/cloud.json` and consumed by `os package publish`,
 * `os package install`, and any future marketplace commands.
 *
 * ## `--json` here is NDJSON — a declared exception, same as `os login` (#6730)
 *
 * Everywhere else in this CLI `--json` means "stdout is exactly one JSON
 * document" (#6217). Both device-flow login commands are declared exceptions to
 * that, and they are the SAME exception: one compact JSON document per line.
 *
 * ### What was broken
 *
 * This command used to pass `silent: flags.json` into the shared device flow
 * and nothing else. Formally that was impeccable — stdout carried a single
 * document and `JSON.parse` read it fine. Measured on `origin/main` against a
 * live RFC 8628 endpoint, `os cloud login --json --no-browser` emitted exactly
 * this and nothing more:
 *
 * ```
 * {
 *   "success": true,
 *   "email": "device@example.com",
 *   "userId": "usr_6730",
 *   "url": "http://127.0.0.1:<port>"
 * }
 * ```
 *
 * The verification URL never appeared — not on stdout, not on stderr. `silent`
 * suppressed the human-readable print and put nothing in its place, so the one
 * thing device flow exists to give a script was withheld from the only caller
 * that cannot ask a human for it. A consumer got a parseable document that
 * arrives *after* an authorization it had no way to trigger.
 *
 * ### Why a stream rather than one document
 *
 * Maintainer ruling, 2026-08-08 (#6730, extending #6531): device flow is two
 * events at two points in time, and emitting the verification URL **before**
 * the user authorizes is its entire value in automation. Buffering both halves
 * into one trailing document would keep stdout single-document by destroying
 * the thing the output exists for; putting the early record on stderr would
 * abuse the diagnostic stream for non-diagnostic content. And the ruling
 * refused to let the two sibling commands answer this differently: a script
 * author — human or AI — who learns the contract from the `os login` docs and
 * applies it here must be right.
 *
 * The ruling's binding condition is that the exception be *declared*: this
 * command's `--json` `--help` text says so, and so do
 * `content/docs/deployment/cli.mdx` and the cloud-deployment flow in
 * `content/docs/deployment/index.mdx`. An undocumented exception does the same
 * harm to a consumer as the bug it replaces.
 *
 * ### Why EVERY write, not just the device flow's
 *
 * The contract belongs to the command, not to one of its paths. The failure
 * record is reachable *after* the device record has already been written (a
 * denied approval, an expired code, a poll failure), so an indented payload
 * there would rebuild a two-document stream on the run a consumer can least
 * afford to misread. All four `--json` writes go through {@link emitRecord},
 * the only emitter in this file, which makes "one compact document per line" a
 * structural property of the command instead of four call sites that each have
 * to remember an option.
 * `packages/cli/test/cloud-login-json-ndjson.e2e.test.ts` pins both halves.
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command, Flags } from '@oclif/core';
import type { CliExitCode } from '../../utils/format.js';
import { printHeader, printKV, printSuccess, printError, emitJson } from '../../utils/format.js';
import { loginWithBrowser, loginWithPassword } from '../../utils/auth-flows.js';
import { DEFAULT_CLOUD_URL, readCloudConfig, writeCloudConfig } from '../../utils/cloud-config.js';

/**
 * Emit ONE NDJSON record on stdout — the only `--json` writer in this command.
 *
 * Compact is not a formatting preference here, it is the contract: a record
 * that wrapped onto a second line would silently break every consumer reading
 * this command's stdout a line at a time. Routing all four call sites through
 * one helper is what makes that structural — see the file header for why the
 * whole command, and not only the device flow, has to hold it.
 */
async function emitRecord(payload: unknown, exitCode: CliExitCode = 0): Promise<void> {
  await emitJson(payload, exitCode, { compact: true });
}

async function promptPassword(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(promptText);
    rl.close();
    return answer;
  }
  return new Promise((resolve) => {
    const chars: string[] = [];
    process.stdout.write(promptText);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', handler);
      process.stdout.write('\n');
    };
    const handler = (char: string) => {
      switch (char) {
        case '\u0003':
          cleanup();
          process.kill(process.pid, 'SIGINT');
          break;
        case '\r':
        case '\n':
          cleanup();
          resolve(chars.join(''));
          break;
        case '\u007f':
          if (chars.length > 0) {
            chars.pop();
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(promptText + '*'.repeat(chars.length));
          }
          break;
        default:
          chars.push(char);
          process.stdout.write('*');
      }
    };
    process.stdin.on('data', handler);
  });
}

export default class CloudLogin extends Command {
  static override description =
    'Authenticate against ObjectStack Cloud (the hosted package registry). Stores credentials in ~/.objectstack/cloud.json.';

  static override examples = [
    '$ os cloud login',
    '$ os cloud login --email me@acme.com --password secret',
    '$ os cloud login --no-browser',
    '$ os cloud login --url https://cloud.objectos.ai   # default',
  ];

  static override flags = {
    url: Flags.string({
      char: 'u',
      description: 'ObjectStack Cloud URL (override for self-hosted control planes)',
      default: DEFAULT_CLOUD_URL,
      env: 'OS_CLOUD_URL',
    }),
    email: Flags.string({ char: 'e', description: 'Email address (skips browser flow)' }),
    password: Flags.string({ char: 'p', description: 'Password (skips browser flow)' }),
    'no-browser': Flags.boolean({
      description: 'Print the verification URL without opening a browser',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Re-authenticate even if cloud credentials already exist',
      default: false,
    }),
    json: Flags.boolean({
      description:
        'Machine-readable output as NDJSON — one compact JSON document per line. Unlike every other ObjectStack command, whose --json stdout is a single document, this one is a stream: the device flow reports the verification URL as its own record BEFORE you authorize, then the result as a second record. Parse stdout line by line. `os login --json` is the same exception with the same shape.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudLogin);

    try {
      if (!flags.force) {
        try {
          const existing = await readCloudConfig();
          if (existing?.token) {
            if (flags.json) {
              await emitRecord({ success: false, error: 'Already logged in', email: existing.email, url: existing.url });
            } else {
              printSuccess(`Already logged in to ${existing.url} as ${existing.email || existing.userId}`);
              console.log('');
              console.log('  Run `os cloud logout` to switch accounts, or use --force to re-authenticate.');
              console.log('');
            }
            return;
          }
        } catch {
          // No stored credentials — proceed
        }
      }

      const url = flags.url.replace(/\/+$/, '');

      if (!flags.json) {
        printHeader('ObjectStack Cloud Login');
        printKV('Server', url);
        console.log('');
      }

      const result =
        flags.email && flags.password
          ? await loginWithPassword(url, flags.email, flags.password)
          : process.stdin.isTTY && !flags.email && !flags.password
          ? await loginWithBrowser(url, {
              noBrowser: flags['no-browser'],
              silent: flags.json,
              // Record 1 of 2, and deliberately written BEFORE the poll loop:
              // an automation consumer needs the verification URL while it can
              // still act on it, which is the reason this command is a stream
              // at all. `silent` alone is what made it vanish (#6730).
              // Undefined in human mode so the flow keeps its own printer.
              onDeviceCode: flags.json ? ({ record }) => emitRecord(record) : undefined,
            })
          : await this.fallbackPasswordPrompt(url, flags.email);

      await writeCloudConfig({
        url,
        token: result.token,
        email: result.user?.email,
        userId: result.user?.id,
        createdAt: new Date().toISOString(),
      });

      if (flags.json) {
        // Record 2 of 2 on the device path, and the only record on the
        // --email/--password path — same line-per-document shape either way.
        await emitRecord({ success: true, email: result.user?.email, userId: result.user?.id, url });
      } else {
        printSuccess('Cloud authentication successful');
        if (result.user?.email) printKV('Email', result.user.email);
        if (result.user?.id) printKV('User ID', result.user.id);
        console.log('');
        console.log('  Credentials stored in ~/.objectstack/cloud.json');
        console.log('  Next: `os package publish` to push a package, `os cloud whoami` to verify.');
        console.log('');
      }
    } catch (error: any) {
      if (flags.json) {
        // Reachable AFTER the device-authorization record has already been
        // written (an expired code, a denied approval, a poll failure), so an
        // indented payload here would recreate a two-document stream on the
        // path a consumer is least able to recover from.
        await emitRecord({ success: false, error: error.message });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }

  private async fallbackPasswordPrompt(url: string, providedEmail?: string) {
    const rl = readline.createInterface({ input, output });
    const email = providedEmail ?? (await rl.question('Email: '));
    rl.close();
    const password = await promptPassword('Password: ');
    if (!email || !password) throw new Error('Email and password are required');
    return loginWithPassword(url, email, password);
  }
}
