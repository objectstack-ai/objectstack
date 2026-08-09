// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os login --json` is NDJSON — the CLI's ONE declared exception (#6531).
 *
 * ## What was broken
 *
 * Everywhere else in this CLI `--json` means "stdout is exactly one JSON
 * document" (#6217). The device-flow path could not honour that and did not
 * try: it wrote the RFC 8628 device-authorization payload compact, and then,
 * after the token poll succeeded, the result payload 2-space indented. Measured
 * against a live device endpoint, stdout came out as
 *
 * ```
 * {"device_code":"…","user_code":"…","verification_uri":"…","expires_in":600}
 * {
 *   "success": true,
 *   …
 * }
 * ```
 *
 * — which `JSON.parse` rejects (`Unexpected non-whitespace character after JSON
 * at position 200`) *and* which is not NDJSON either, because the second
 * document spans five lines: 5 of its 6 lines fail an independent parse. A
 * consumer had no shape to read it in at all. The same two-document stream
 * appeared on the failure path too — device record, then an indented error
 * payload when the poll timed out or was denied.
 *
 * ## Why a stream rather than one document
 *
 * Maintainer ruling, 2026-08-08 (#6531): this flow genuinely IS two events at
 * two points in time, and emitting the verification URL **before** the user
 * authorizes is the entire value of device flow in automation. Buffering both
 * halves into one trailing document would make stdout parseable by destroying
 * the thing the output exists for; putting the early record on stderr would
 * abuse the diagnostic stream for non-diagnostic content. So `os login --json`
 * is declared a newline-delimited stream, and — the ruling's binding condition
 * — declared *explicitly*: in this command's `--help` text and in the command
 * documentation (`content/docs/deployment/cli.mdx`, and the device-flow section
 * of `content/docs/permissions/authentication.mdx`). An undocumented exception
 * does the same harm to a consumer as the bug it replaces.
 *
 * ## Why EVERY write, not just the device flow's two
 *
 * The contract belongs to the command, not to one of its paths. If the
 * `--email`/`--password` result or the error payload stayed indented, a
 * consumer that read this command line-by-line — exactly what the docs now
 * tell it to do — would break on the first run that took another path, and the
 * failure path is reachable *after* the device record has already been written.
 * So every `--json` write goes through {@link emitRecord}, which is the only
 * emitter in this file; that makes "one compact document per line" a property
 * of the command instead of four call sites that each have to remember an
 * option. `packages/cli/test/login-json-ndjson.e2e.test.ts` holds both halves:
 * the stream contract, driven through a real child process against a real
 * device endpoint, and the source pin that keeps a future write from bypassing
 * the helper.
 */

import { Command, Flags } from '@oclif/core';
import type { CliExitCode } from '../utils/format.js';
import { printHeader, printSuccess, printError, printKV, emitJson } from '../utils/format.js';
import { writeAuthConfig, readAuthConfig } from '../utils/auth-config.js';
import { ObjectStackClient } from '@objectstack/client';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Emit ONE NDJSON record on stdout — the only `--json` writer in this command.
 *
 * Compact is not a formatting preference here, it is the contract: a record
 * that wrapped onto a second line would silently break every consumer reading
 * this command's stdout a line at a time. Routing all four call sites through
 * one helper is what makes that structural — see the file header for why the
 * whole command, and not only the device flow's two writes, has to hold it.
 */
async function emitRecord(payload: unknown, exitCode: CliExitCode = 0): Promise<void> {
  await emitJson(payload, exitCode, { compact: true });
}

/**
 * Prompt for a password with masked input (shows * per character).
 * Falls back to plain readline.question() in non-TTY environments.
 */
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
        case '\u0003': // Ctrl+C
          cleanup();
          process.kill(process.pid, 'SIGINT');
          break;
        case '\r':
        case '\n': // Enter
          cleanup();
          resolve(chars.join(''));
          break;
        case '\u007f': // Backspace
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
          break;
      }
    };

    process.stdin.on('data', handler);
  });
}

/**
 * Open a URL in the system default browser (cross-platform).
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const platform = process.platform;
  const cmd = platform === 'darwin' ? `open "${url}"` : platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* best-effort */ });
}

export default class AuthLogin extends Command {
  static override description = 'Authenticate and store session credentials';

  static override examples = [
    '$ os login',
    '$ os login --url https://api.example.com',
    '$ os login --email user@example.com --password mypassword',
    '$ os login --no-browser',
  ];

  static override flags = {
    url: Flags.string({
      char: 'u',
      description: 'ObjectStack runtime server URL (your local ObjectOS or self-hosted control plane). For the hosted package registry, use `os cloud login` instead.',
      default: 'http://localhost:3000',
      env: 'OS_RUNTIME_URL',
    }),
    email: Flags.string({
      char: 'e',
      description: 'Email address (skips browser flow)',
    }),
    password: Flags.string({
      char: 'p',
      description: 'Password (skips browser flow)',
    }),
    'no-browser': Flags.boolean({
      description: 'Print the login URL without opening a browser',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force login even if already authenticated',
      default: false,
    }),
    json: Flags.boolean({
      description:
        'Machine-readable output as NDJSON — one compact JSON document per line. Unlike every other ObjectStack command, whose --json stdout is a single document, this one is a stream: the device flow reports the verification URL as its own record BEFORE you authorize, then the result as a second record. Parse stdout line by line.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogin);

    try {
      // --- Already logged in guard ---
      if (!flags.force) {
        try {
          const existing = await readAuthConfig();
          if (existing?.token) {
            if (flags.json) {
              await emitRecord({ success: false, error: 'Already logged in', email: existing.email });
            } else {
              printSuccess(`Already logged in as ${existing.email || existing.userId}`);
              console.log('');
              console.log('  Run `os logout` first to switch accounts, or use --force to re-authenticate.');
              console.log('');
            }
            return;
          }
        } catch {
          // No credentials stored — proceed with login
        }
      }

      if (!flags.json) {
        printHeader('ObjectStack Login');
        printKV('Server', flags.url);
        console.log('');
      }

      const client = new ObjectStackClient({ baseUrl: flags.url });

      // --- CI / non-interactive path: email + password flags provided ---
      if (flags.email && flags.password) {
        await this.loginWithPassword(client, flags.url, flags.email, flags.password, flags.json);
        return;
      }

      // --- Interactive TTY: prompt style ---
      if (process.stdin.isTTY && !flags.email && !flags.password) {
        // Default: browser-based device flow
        await this.loginWithBrowser(client, flags.url, flags['no-browser'], flags.json);
        return;
      }

      // --- Non-TTY fallback: prompt for email/password ---
      const rl = readline.createInterface({ input, output });
      let email = flags.email;
      let password = flags.password;

      if (!email) email = await rl.question('Email: ');
      rl.close();
      if (!password) password = await promptPassword('Password: ');

      if (!email || !password) throw new Error('Email and password are required');

      await this.loginWithPassword(client, flags.url, email, password, flags.json);
    } catch (error: any) {
      if (flags.json) {
        // Reachable AFTER the device-authorization record has already been
        // written (an expired code, a denied approval, a poll failure), so an
        // indented payload here recreated the exact two-document stream #6531
        // is about — on the path a consumer is least able to recover from.
        await emitRecord({ success: false, error: error.message });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }

  private async loginWithPassword(
    client: ObjectStackClient,
    url: string,
    email: string,
    password: string,
    jsonOutput?: boolean,
  ): Promise<void> {
    const response = await client.auth.login({ type: 'email', email, password });

    if (!response.data?.token && !response.data?.user) {
      throw new Error('Login failed: Invalid response from server');
    }

    const token = response.data?.token || (response as any).token;
    const user = response.data?.user;

    if (!token) throw new Error('Login failed: No token received from server');

    await writeAuthConfig({
      url,
      token,
      email: user?.email || email,
      userId: user?.id,
      createdAt: new Date().toISOString(),
    });

    if (jsonOutput) {
      await emitRecord({ success: true, email: user?.email || email, userId: user?.id });
    } else {
      printSuccess('Authentication successful');
      printKV('Email', user?.email || email);
      if (user?.id) printKV('User ID', user.id);
      console.log('');
      console.log('  Credentials stored in ~/.objectstack/credentials.json');
      console.log('');
    }
  }

  private async loginWithBrowser(
    _client: ObjectStackClient,
    url: string,
    noBrowser: boolean,
    jsonOutput?: boolean,
  ): Promise<void> {
    const clientId = process.env.OS_CLI_CLIENT_ID || 'objectstack-cli';

    // RFC 8628 §3.1 — Device Authorization Request
    const res = await globalThis.fetch(`${url}/api/v1/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'openid profile email' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Device request failed (${res.status}): ${(err as any)?.error_description || (err as any)?.message || res.statusText}`);
    }
    const deviceData = await res.json() as any;
    const {
      device_code,
      user_code,
      verification_uri,
      verification_uri_complete,
      expires_in,
      interval = 5,
    } = deviceData ?? {};

    if (!device_code || !user_code || !verification_uri) {
      throw new Error('Server did not return RFC 8628 device authorization fields. Try `os login --email <email> --password <password>` instead.');
    }

    const verificationUrl = verification_uri_complete || `${verification_uri}?user_code=${encodeURIComponent(user_code)}`;

    if (jsonOutput) {
      // Record 1 of 2, and deliberately written BEFORE the poll loop: an
      // automation consumer needs the verification URL while it can still act
      // on it, which is the reason this command is a stream at all.
      await emitRecord({ device_code, user_code, verification_uri, verification_uri_complete, expires_in });
    } else {
      console.log('  To authorize this CLI, visit:');
      console.log('');
      console.log(`  ${verificationUrl}`);
      console.log('');
      console.log(`  User code: ${user_code}`);
      console.log('');
    }

    if (!noBrowser && !jsonOutput) {
      await openBrowser(verificationUrl);
      console.log('  (Browser opened automatically. Press Ctrl+C to cancel.)');
      console.log('');
    }

    // RFC 8628 §3.4 — Device Access Token Request (poll)
    let pollMs = (interval || 5) * 1000;
    const expiryTime = Date.now() + (expires_in || 600) * 1000;
    let spinner = 0;
    const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    while (Date.now() < expiryTime) {
      await new Promise(r => setTimeout(r, pollMs));

      const pollRes = await globalThis.fetch(`${url}/api/v1/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: clientId,
        }),
      });
      const pollJson = await pollRes.json() as any;

      if (pollRes.ok && pollJson?.access_token) {
        const accessToken = pollJson.access_token as string;

        // Resolve user info via the issued bearer token. The device-token
        // response intentionally omits user details (per RFC 8628), so we
        // call /get-session to populate the local credentials cache.
        let user: { id?: string; email?: string } | undefined;
        try {
          const sessionRes = await globalThis.fetch(`${url}/api/v1/auth/get-session`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json() as any;
            user = sessionData?.user ?? sessionData?.data?.user;
          }
        } catch {
          // Session lookup is best-effort
        }

        if (!jsonOutput) process.stdout.write('\r\x1b[K'); // clear spinner line

        await writeAuthConfig({
          url,
          token: accessToken,
          email: user?.email,
          userId: user?.id,
          createdAt: new Date().toISOString(),
        });

        if (jsonOutput) {
          // Record 2 of 2 — same line-per-document shape as record 1.
          await emitRecord({ success: true, email: user?.email, userId: user?.id });
        } else {
          printSuccess('Authentication successful');
          if (user?.email) printKV('Email', user.email);
          if (user?.id) printKV('User ID', user.id);
          console.log('');
          console.log('  Credentials stored in ~/.objectstack/credentials.json');
          console.log('');
        }
        return;
      }

      // Standard RFC 8628 error codes
      const errCode = pollJson?.error;
      if (errCode === 'authorization_pending') {
        // Keep polling
      } else if (errCode === 'slow_down') {
        pollMs += 5000;
      } else if (errCode === 'expired_token' || errCode === 'access_denied' || errCode === 'invalid_grant') {
        throw new Error(
          errCode === 'access_denied'
            ? 'Login denied by user.'
            : 'Login timed out or device code is no longer valid. Please run `os login` again.',
        );
      } else if (!pollRes.ok) {
        throw new Error(`Polling failed (${pollRes.status}): ${pollJson?.error_description || pollJson?.message || pollRes.statusText}`);
      }

      if (!jsonOutput) {
        process.stdout.write(`\r  ${spinChars[spinner % spinChars.length]} Waiting for browser approval...`);
        spinner++;
      }
    }

    throw new Error('Login timed out. Please run `os login` again.');
  }
}
