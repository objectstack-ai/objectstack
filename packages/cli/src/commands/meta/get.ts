// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class MetaGet extends Command {
  static override description = 'Get a metadata item';

  static override examples = [
    '$ os meta get object project_task',
    '$ os meta get plugin my-plugin --format json',
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
      default: 'json',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MetaGet);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Get the metadata item
      const item = await client.meta.getItem(args.type, args.name);

      await formatOutput(item, flags.format as any);
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
