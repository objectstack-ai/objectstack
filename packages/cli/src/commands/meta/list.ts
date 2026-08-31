// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class MetaList extends Command {
  static override description = 'List metadata types or items';

  static override examples = [
    '$ os meta list',
    '$ os meta list object',
    '$ os meta list plugin --format json',
  ];

  static override args = {
    type: Args.string({
      description: 'Metadata type (object, plugin, view, etc.)',
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
    const { args, flags } = await this.parse(MetaList);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      if (!args.type) {
        // List all metadata types
        const types = await client.meta.getTypes();

        if (flags.format === 'json') {
          await formatOutput(types, 'json');
        } else if (flags.format === 'yaml') {
          await formatOutput(types, 'yaml');
        } else {
          console.log('\nAvailable metadata types:\n');
          if (Array.isArray(types)) {
            types.forEach(type => console.log(`  • ${type}`));
          } else {
            console.log('No types available');
          }
          console.log('');
        }
      } else {
        // List items of a specific type
        const items = await client.meta.getItems(args.type);

        if (flags.format === 'json') {
          await formatOutput(items, 'json');
        } else if (flags.format === 'yaml') {
          await formatOutput(items, 'yaml');
        } else {
          console.log(`\n${args.type} items:\n`);
          if (Array.isArray(items)) {
            if (items.length === 0) {
              console.log('  (no items)');
            } else {
              items.forEach(item => {
                const name = item.name || item.id || JSON.stringify(item);
                console.log(`  • ${name}`);
              });
            }
          }
          console.log('');
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
