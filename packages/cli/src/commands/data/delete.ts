// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, printSuccess, printWarning, emitJson, errorCodeFields } from '../../utils/format.js';
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
        // [#19413] The human arm reads the SAME `result.success` the two
        // machine arms lower into `deleted` above. It used to print
        // `Record deleted` unconditionally, so one command and one call could
        // state opposite facts about the same row depending only on
        // `--format`. The distinction the `[#5638]` note above draws — the
        // CLI envelope's "the command completed" versus the server's "the
        // deletion happened" — is the one this arm was missing.
        //
        // Read as `=== false`, NOT as falsiness, for the reason
        // `MetadataProtocol.deleteData` states where it reads the driver
        // contract: `false` is the protocol's positive "no row was deleted"
        // value, while an absent or `undefined` flag from an off-contract
        // server is not a signal at all — and turning "no signal" into "not
        // deleted" would make this command deny deletions that really
        // happened.
        //
        // The exit code does NOT move, on either arm. The two machine arms
        // publish `success: true` — the envelope's command-completed flag —
        // beside `deleted: false`, and they exit `0`; moving only this arm
        // off `0` would re-create this very defect one layer down, with the
        // same call exiting `0` under `--format json` and non-zero by
        // default. Moving it on all three arms would narrow a published CLI
        // accept set (a script that succeeds today would start failing),
        // which is a contract change and not this fix. `delete-arms-agree`
        // pins the code in both directions so the next change cannot move it
        // silently.
        if (result.success === false) {
          printWarning(`Not deleted: ${result.id} — the server reported the deletion did not happen`);
        } else {
          printSuccess(`Record deleted: ${result.id}`);
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
