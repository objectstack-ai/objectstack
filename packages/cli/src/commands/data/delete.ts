// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class DataDelete extends Command {
  static override description = 'Delete a record';

  static override examples = [
    '$ os data delete project_task abc123',
    '$ os data delete project_task abc123 --format json',
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
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataDelete);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Delete the record
      const result = await client.data.delete(args.object, args.id);

      if (flags.format === 'json') {
        await emitJson({
          success: true,
          object: result.object,
          id: result.id,
          deleted: result.deleted,
        });
      } else if (flags.format === 'yaml') {
        await formatOutput({ success: true, object: result.object, id: result.id, deleted: result.deleted }, 'yaml');
      } else {
        printSuccess(`Record deleted: ${result.id}`);
      }
    } catch (error: any) {
      if (flags.format === 'json') {
        await emitJson({
          success: false,
          error: error.message,
        });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
