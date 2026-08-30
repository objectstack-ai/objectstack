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

      // [#13023] `deleted` is THIS COMMAND's output key; its value is the reset
      // door's `DeleteMetaItemResponse.reset`. Two different booleans live in
      // this payload and must not be conflated — the top-level `success` is the
      // CLI envelope's "the command completed", while `deleted` reports whether
      // a customization overlay row actually went away (`reset: false` means
      // none existed and the item was already at its artifact default). This
      // read was `result.deleted` until now — a key no branch of the door has
      // ever sent, so it evaluated to `undefined` and `JSON.stringify` /
      // `yaml.stringify` dropped it: the key this command has always declared
      // never appeared in a single run. Exactly the treatment #5638 gave the
      // sibling `os data delete`, one door over.
      if (flags.format === 'json') {
        await formatOutput({ success: true, type: args.type, name: args.name, deleted: result.reset }, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput({ success: true, type: args.type, name: args.name, deleted: result.reset }, 'yaml');
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
