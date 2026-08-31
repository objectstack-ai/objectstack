// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class MetaRegister extends Command {
  static override description = 'Register metadata (create or update)';

  static override examples = [
    '$ os meta register object --data object-def.json',
    '$ os meta register plugin --data plugin-manifest.json',
  ];

  static override args = {
    type: Args.string({
      description: 'Metadata type',
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
    data: Flags.string({
      char: 'd',
      description: 'Path to JSON file containing metadata definition',
      required: true,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MetaRegister);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Read metadata from file
      const { readFile } = await import('node:fs/promises');
      const fileContent = await readFile(flags.data, 'utf-8');
      let metadata: any;

      try {
        metadata = JSON.parse(fileContent);
      } catch (e) {
        throw new Error(`Invalid JSON in file: ${(e as Error).message}`);
      }

      // Extract name from metadata
      const name = metadata.name;
      if (!name) {
        throw new Error('Metadata definition must include a "name" field');
      }

      // Register the metadata
      const result = await client.meta.saveItem(args.type, name, metadata);

      if (flags.format === 'json') {
        await formatOutput(result, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(result, 'yaml');
      } else {
        printSuccess(`Metadata registered: ${args.type}/${name}`);
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
