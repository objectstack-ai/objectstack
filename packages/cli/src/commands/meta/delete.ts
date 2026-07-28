// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class MetaDelete extends Command {
  static override description = 'Delete a metadata item';

  static override examples = [
    '$ os meta delete object my_custom_object',
    '$ os meta delete plugin my-plugin',
    '$ os meta delete object my_custom_object --format json',
  ];

  static override args = {
    type: Args.string({
      description: 'Metadata type',
      required: true,
    }),
    name: Args.string({
      description: 'Item name (snake_case)',
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
    const { args, flags } = await this.parse(MetaDelete);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      const result = await client.meta.deleteItem(args.type, args.name);

      if (flags.format === 'json') {
        await formatOutput({ success: true, type: args.type, name: args.name, deleted: result.deleted }, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput({ success: true, type: args.type, name: args.name, deleted: result.deleted }, 'yaml');
      } else {
        printSuccess(`Metadata deleted: ${args.type}/${args.name}`);
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
