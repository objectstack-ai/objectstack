// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class DataCreate extends Command {
  static override description = 'Create a new record';

  static override examples = [
    '$ os data create project_task \'{"name":"New Task","status":"open"}\'',
    '$ os data create project_task --data task-data.json',
    '$ os data create project_task --data task-data.json --format json',
  ];

  static override args = {
    object: Args.string({
      description: 'Object name (snake_case)',
      required: true,
    }),
    data: Args.string({
      description: 'Record data as JSON string (or use --data flag for file)',
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
      description: 'Path to JSON file containing record data',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataCreate);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Parse record data
      let recordData: any;

      if (flags.data) {
        // Read from file
        const { readFile } = await import('node:fs/promises');
        const fileContent = await readFile(flags.data, 'utf-8');
        try {
          recordData = JSON.parse(fileContent);
        } catch (e) {
          throw new Error(`Invalid JSON in file: ${(e as Error).message}`);
        }
      } else if (args.data) {
        // Parse from argument
        try {
          recordData = JSON.parse(args.data);
        } catch (e) {
          throw new Error(`Invalid JSON: ${(e as Error).message}`);
        }
      } else {
        throw new Error('Record data is required (provide JSON string or use --data flag)');
      }

      // Create the record
      const result = await client.data.create(args.object, recordData);

      if (flags.format === 'json') {
        await formatOutput(result, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(result, 'yaml');
      } else {
        printSuccess(`Record created: ${result.id}`);
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
