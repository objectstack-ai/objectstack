// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printHeader, printSuccess, printError, printKV, emitJson } from '../utils/format.js';
import { writeAuthConfig } from '../utils/auth-config.js';
import { ObjectStackClient } from '@objectstack/client';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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
        case '\n':
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

export default class Register extends Command {
  static override description = 'Create a new account and store credentials';

  static override examples = [
    '$ os register',
    '$ os register --email user@example.com --name "Jane Doe" --password mypassword',
    '$ os register --url https://api.example.com',
  ];

  static override flags = {
    url: Flags.string({
      char: 'u',
      description: 'Server URL',
      default: 'http://localhost:3000',
      env: 'OS_CLOUD_URL',
    }),
    email: Flags.string({
      char: 'e',
      description: 'Email address',
    }),
    name: Flags.string({
      char: 'n',
      description: 'Display name',
    }),
    password: Flags.string({
      char: 'p',
      description: 'Password',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Register);

    try {
      if (!flags.json) {
        printHeader('ObjectStack Register');
        printKV('Server', flags.url);
        console.log('');
      }

      const rl = readline.createInterface({ input, output });

      let email = flags.email;
      let name = flags.name;
      let password = flags.password;

      if (!email) {
        email = await rl.question('Email: ');
      }
      if (!name) {
        name = await rl.question('Name (optional): ');
      }
      rl.close();
      if (!password) {
        password = await promptPassword('Password: ');
      }

      if (!email) throw new Error('Email is required');
      if (!password) throw new Error('Password is required');

      const client = new ObjectStackClient({ baseUrl: flags.url });
      const registerPayload: { email: string; password: string; name?: string } = { email, password };
      if (name) registerPayload.name = name;
      const response = await client.auth.register(registerPayload as any);

      const token = response.data?.token ?? (response as any).token;
      const user = response.data?.user ?? (response as any).user;

      if (!token) throw new Error('Registration failed: No token received from server');

      await writeAuthConfig({
        url: flags.url,
        token,
        email: user?.email || email,
        userId: user?.id,
        createdAt: new Date().toISOString(),
      });

      if (flags.json) {
        await emitJson({ success: true, email: user?.email || email, userId: user?.id });
      } else {
        printSuccess('Account created and logged in');
        printKV('Email', user?.email || email);
        if (user?.id) printKV('User ID', user.id);
        console.log('');
        console.log('  Credentials stored in ~/.objectstack/credentials.json');
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
}
