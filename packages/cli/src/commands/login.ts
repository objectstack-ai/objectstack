// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printHeader, printSuccess, printError, printKV, emitJson } from '../utils/format.js';
import { writeAuthConfig, readAuthConfig } from '../utils/auth-config.js';
import { ObjectStackClient } from '@objectstack/client';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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
        case '': // Ctrl+C
          cleanup();
          process.kill(process.pid, 'SIGINT');
          break;
        case '\r':
        case '\n': // Enter
          cleanup();
          resolve(chars.join(''));
          break;
        case '': // Backspace
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
      description: 'Output as JSON',
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
              await emitJson({ success: false, error: 'Already logged in', email: existing.email }, 0, { compact: true });
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
        await emitJson({ success: false, error: error.message });
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
      await emitJson({ success: true, email: user?.email || email, userId: user?.id });
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
      await emitJson({ device_code, user_code, verification_uri, verification_uri_complete, expires_in }, 0, { compact: true });
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
          await emitJson({ success: true, email: user?.email, userId: user?.id });
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
