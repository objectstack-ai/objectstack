// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class DataUpdate extends Command {
  static override description = 'Update an existing record';

  static override examples = [
    '$ os data update project_task abc123 \'{"status":"completed"}\'',
    '$ os data update project_task abc123 --data update-data.json',
    '$ os data update project_task abc123 --data update-data.json --format json',
  ];

  static override args = {
    object: Args.string({
      description: 'Object name (snake_case)',
      required: true,
    }),
    id: Args.string({
      description: 'Record ID',
      required: true,
    }),
    data: Args.string({
      description: 'Update data as JSON string (or use --data flag for file)',
    }),
  };

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
    data: Flags.string({
      char: 'd',
      description: 'Path to JSON file containing update data',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataUpdate);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Parse update data
      let updateData: any;

      if (flags.data) {
        // Read from file
        const { readFile } = await import('node:fs/promises');
        const fileContent = await readFile(flags.data, 'utf-8');
        try {
          updateData = JSON.parse(fileContent);
        } catch (e) {
          throw new Error(`Invalid JSON in file: ${(e as Error).message}`);
        }
      } else if (args.data) {
        // Parse from argument
        try {
          updateData = JSON.parse(args.data);
        } catch (e) {
          throw new Error(`Invalid JSON: ${(e as Error).message}`);
        }
      } else {
        throw new Error('Update data is required (provide JSON string or use --data flag)');
      }

      // Update the record
      const result = await client.data.update(args.object, args.id, updateData);

      if (flags.format === 'json') {
        await formatOutput(result, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(result, 'yaml');
      } else {
        printSuccess(`Record updated: ${result.id}`);
        if (result.record) {
          console.log('');
          await formatOutput(result.record, 'table');
        }
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
