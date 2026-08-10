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
 *
 * ## `--json` never prompts, and a prompt never outlives its input (#6728)
 *
 * Below the device flow sat a second path with the same harm class and a
 * different cause: with no TTY and no `--email`/`--password` — precisely what a
 * CI runner produces when a secret fails to interpolate — the command fell
 * through to `readline`, which writes its prompt to the `output` stream it was
 * built on. That stream is `process.stdout`, unconditionally, `--json` or not.
 * Measured on `origin/main` @ `73bff86`:
 *
 * ```
 * $ os login --json --url http://127.0.0.1:1 < /dev/null > out.txt 2> err.txt
 * exit=13
 * $ cat -A out.txt
 * Email:
 * ```
 *
 * The whole of stdout under a declared machine-readable flag was the string
 * `Email: `, with no trailing newline: not a JSON document, not NDJSON, no
 * payload at all — while stderr carried only `Warning: Detected unsettled
 * top-level await`. Two defects in one run, ruled on together (2026-08-09) and
 * fixed together here:
 *
 * 1. **`--json` refuses instead of prompting.** `--json` means non-interactive
 *    by definition, so a run that would have to ask emits
 *    `{"success":false,"error":"email and password are required in a
 *    non-interactive shell"}` — one record, through the same
 *    {@link emitRecord} as every other `--json` write in this file — and
 *    exits 1.
 * 2. **EOF produces a defined `CliExitCode`.** Exit 13 is Node's
 *    unsettled-top-level-await teardown, not a decision this CLI made;
 *    {@link askOrFailAtEof} makes the abandoned question reject, so the failure
 *    reaches the exit code. That half is deliberately not a side effect of the
 *    first: without `--json` the prompts remain, and an EOF at either of them
 *    now names its cause and exits 1 instead of 13.
 *
 * Pinned by `packages/cli/test/login-json-noninteractive.e2e.test.ts`.
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
 * The refusal `--json` gives when it would otherwise have to prompt (#6728).
 *
 * Verbatim from the maintainer ruling of 2026-08-09, and deliberately a
 * constant rather than an inline literal: it is the string a CI step reads out
 * of the record to tell "you forgot the credentials" apart from "the server
 * rejected them", so rewording it is a contract change, not a copy edit.
 */
const NON_INTERACTIVE_CREDENTIALS_REQUIRED =
  'email and password are required in a non-interactive shell';

/**
 * The failure a prompt reports when stdin ends before it is answered (#6728).
 *
 * Names the remedy rather than the mechanism, because every audience that
 * reaches it — a CI step without `--json`, a `< /dev/null` redirect, a piped
 * heredoc that ran out of lines — fixes it the same way: pass the flags.
 */
const STDIN_EOF_BEFORE_CREDENTIALS =
  'stdin reached end of input before the credentials were entered. Pass --email and --password to log in non-interactively.';

/**
 * Ask one question, and FAIL on end-of-input instead of hanging forever (#6728).
 *
 * `readline`'s `question()` promise settles only when a line arrives. When
 * stdin is already at EOF — `os login < /dev/null`, the shape a CI runner that
 * forgot `--email`/`--password` actually produces — no line ever arrives, the
 * interface emits `'close'`, and the promise is simply abandoned. Nothing
 * throws, so the outer `catch` never runs and the command never reaches an
 * exit code of its own: Node finds the top-level `await` in `bin/run.js`
 * permanently unsettled and tears the process down with **exit 13**. Measured
 * on `origin/main` @ `73bff86`, `os login --json --url … < /dev/null` exited 13
 * with `Warning: Detected unsettled top-level await` on stderr — a code
 * {@link CliExitCode} does not define, from a command that never decided
 * anything.
 *
 * So the fix is not a `try`/`catch` around the question — there is no error to
 * catch — it is making the question settleable: `'close'` aborts the signal
 * `question()` is watching, which rejects it, which puts the failure back on
 * the path that ends in `this.exit(1)`.
 */
async function askOrFailAtEof(
  rl: readline.Interface,
  signal: AbortSignal,
  promptText: string,
): Promise<string> {
  // Already closed before we got here (stdin was at EOF when the interface was
  // created): `question()` would reject on the next tick anyway, but only after
  // writing the prompt no one can answer.
  if (signal.aborted) throw new Error(STDIN_EOF_BEFORE_CREDENTIALS);
  try {
    return await rl.question(promptText, { signal });
  } catch (error) {
    if (signal.aborted) throw new Error(STDIN_EOF_BEFORE_CREDENTIALS);
    throw error;
  }
}

/**
 * Prompt for a password with masked input (shows * per character).
 *
 * **TTY only** — the caller checks `process.stdin.isTTY` first. This used to
 * open a second `readline` interface for the non-TTY case, which was where the
 * unsettleable question of #6728 lived; the non-TTY prompts now share the one
 * interface in `run()`, which is what makes {@link askOrFailAtEof} cover both
 * of them. Reintroducing a private interface here would reintroduce the hang.
 */
async function promptPassword(promptText: string): Promise<string> {
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
        'Machine-readable output as NDJSON — one compact JSON document per line. Unlike every other ObjectStack command, whose --json stdout is a single document, this one is a stream: the device flow reports the verification URL as its own record BEFORE you authorize, then the result as a second record. Parse stdout line by line. Implies non-interactive: without --email and --password to work from, the command refuses with a record instead of prompting.',
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

      // --- Prompt fallback: one or both credentials are still missing ---

      // `--json` declares this run machine-readable, and a machine cannot answer
      // a prompt — so under it the command refuses here instead of writing
      // `Email: ` onto the payload stream (#6728, maintainer ruling 2026-08-09:
      // "`--json` means non-interactive by definition"). The check is on the
      // flag alone, not on `isTTY`: reaching this line under `--json` means the
      // only way forward is a prompt, and what a TTY happens to be attached to
      // does not un-declare the run.
      if (flags.json) {
        await emitRecord({ success: false, error: NON_INTERACTIVE_CREDENTIALS_REQUIRED }, 1);
        return;
      }

      let email = flags.email;
      let password = flags.password;

      // ONE interface for both prompts, with `'close'` wired to an abort so a
      // question can never outlive its input — see {@link askOrFailAtEof} for
      // the exit-13 teardown that shape replaces.
      const rl = readline.createInterface({ input, output });
      const atEof = new AbortController();
      const abortOnClose = () => atEof.abort();
      rl.once('close', abortOnClose);
      try {
        if (!email) email = await askOrFailAtEof(rl, atEof.signal, 'Email: ');
        // The masked prompt needs raw mode on `process.stdin`, which cannot
        // coexist with an open interface, so a TTY takes it below instead.
        if (!password && !process.stdin.isTTY) {
          password = await askOrFailAtEof(rl, atEof.signal, 'Password: ');
        }
      } finally {
        rl.off('close', abortOnClose);
        rl.close();
      }
      if (!password && process.stdin.isTTY) password = await promptPassword('Password: ');

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
