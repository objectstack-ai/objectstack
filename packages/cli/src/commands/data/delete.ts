// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
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

      // [#5638] `deleted` is THIS COMMAND's output key; its value is the
      // protocol's `DeleteDataResponse.success`. Two different booleans live
      // in this payload and must not be conflated: the top-level `success` is
      // the CLI envelope's "the command completed" flag (this branch is only
      // reached when it did), while the server's flag is its statement that
      // the deletion happened. Until now this read was `result.deleted` — a
      // key no server has ever returned — so it evaluated to `undefined` and
      // `JSON.stringify` dropped it: the documented key was simply absent
      // from every `os data delete --format json` run.
      if (flags.format === 'json') {
        await emitJson({
          success: true,
          object: result.object,
          id: result.id,
          deleted: result.success,
        });
      } else if (flags.format === 'yaml') {
        await formatOutput({ success: true, object: result.object, id: result.id, deleted: result.success }, 'yaml');
      } else {
        printSuccess(`Record deleted: ${result.id}`);
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
