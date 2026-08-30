// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printHeader, printError, printKV, emitJson, errorCodeFields } from '../utils/format.js';
import { createApiClient, requireAuth } from '../utils/api-client.js';
import { formatOutput } from '../utils/output-formatter.js';

export default class Whoami extends Command {
  static override description = 'Show current session information';

  static override examples = [
    '$ os whoami',
    '$ os whoami --format json',
    '$ os whoami --url https://api.example.com --token <token>',
  ];

  static override flags = {
    url: Flags.string({
      char: 'u',
      description: 'Server URL',
      env: 'OS_CLOUD_URL',
    }),
    token: Flags.string({
      char: 't',
      description: 'Authentication token',
      env: 'OS_TOKEN',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Check if we have a token
      // Get current session info
      const response = await client.auth.me();

      const sessionData = response.data || response;

      if (flags.format === 'json') {
        await formatOutput(sessionData, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(sessionData, 'yaml');
      } else {
        printHeader('Current Session');

        if (sessionData.user) {
          printKV('User ID', sessionData.user.id || '-');
          printKV('Email', sessionData.user.email || '-');
          printKV('Name', sessionData.user.name || '-');
        }

        if (sessionData.session) {
          printKV('Session ID', sessionData.session.id || '-');
          printKV('Expires At', sessionData.session.expiresAt || '-');
        }

        console.log('');
      }
    } catch (error: any) {
      if (flags.format === 'json') {
        await emitJson({
          success: false,
          error: error.message,
          ...errorCodeFields(error),
        });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
