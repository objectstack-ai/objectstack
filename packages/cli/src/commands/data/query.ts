// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

export default class DataQuery extends Command {
  static override description = 'Query records from an object';

  static override examples = [
    '$ os data query project_task',
    '$ os data query project_task --filter \'{"status":"open"}\'',
    '$ os data query project_task --limit 10 --offset 0',
    '$ os data query project_task --fields name,status,created_at',
    '$ os data query project_task --sort -created_at',
    '$ os data query project_task --format json',
  ];

  static override args = {
    object: Args.string({
      description: 'Object name (snake_case)',
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
    filter: Flags.string({
      description: 'Filter criteria as JSON object',
    }),
    fields: Flags.string({
      description: 'Comma-separated list of fields to retrieve',
    }),
    sort: Flags.string({
      description: 'Sort field (prefix with - for descending)',
    }),
    limit: Flags.integer({
      description: 'Maximum number of records to return',
      default: 50,
    }),
    offset: Flags.integer({
      description: 'Number of records to skip',
      default: 0,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataQuery);

    try {
      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      // Build query options
      const queryOptions: any = {
        limit: flags.limit,
        offset: flags.offset,
      };

      if (flags.filter) {
        try {
          queryOptions.where = JSON.parse(flags.filter);
        } catch (e) {
          throw new Error(`Invalid filter JSON: ${(e as Error).message}`);
        }
      }

      if (flags.fields) {
        queryOptions.fields = flags.fields.split(',').map(f => f.trim());
      }

      if (flags.sort) {
        queryOptions.orderBy = flags.sort;
      }

      // Execute query
      const result = await client.data.query(args.object, queryOptions);

      if (flags.format === 'json') {
        await formatOutput(result, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(result, 'yaml');
      } else {
        // Table format
        if (result.records && result.records.length > 0) {
          await formatOutput(result.records, 'table');
        } else {
          console.log('No records found.');
        }

        if (result.total !== undefined) {
          console.log(`\nTotal: ${result.total} record(s)`);
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
