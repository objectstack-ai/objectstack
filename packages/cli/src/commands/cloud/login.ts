// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack cloud login` — authenticate against the ObjectStack Cloud
 * package registry (`https://cloud.objectos.ai` by default).
 *
 * This is distinct from `os login`, which authenticates against your
 * *runtime* ObjectOS instance. Cloud credentials are persisted to
 * `~/.objectstack/cloud.json` and consumed by `os package publish`,
 * `os package install`, and any future marketplace commands.
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, emitJson } from '../../utils/format.js';
import { loginWithBrowser, loginWithPassword } from '../../utils/auth-flows.js';
import { DEFAULT_CLOUD_URL, readCloudConfig, writeCloudConfig } from '../../utils/cloud-config.js';

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
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudLogin);

    try {
      if (!flags.force) {
        try {
          const existing = await readCloudConfig();
          if (existing?.token) {
            if (flags.json) {
              await emitJson({ success: false, error: 'Already logged in', email: existing.email, url: existing.url }, 0, { compact: true });
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
          ? await loginWithBrowser(url, { noBrowser: flags['no-browser'], silent: flags.json })
          : await this.fallbackPasswordPrompt(url, flags.email);

      await writeCloudConfig({
        url,
        token: result.token,
        email: result.user?.email,
        userId: result.user?.id,
        createdAt: new Date().toISOString(),
      });

      if (flags.json) {
        await emitJson({ success: true, email: result.user?.email, userId: result.user?.id, url });
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
        await emitJson({ success: false, error: error.message });
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
