// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { SaveMetaItemOptions } from '@objectstack/client';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

/**
 * [#23350] The refusal an EMPTY `--package` earns, before anything reaches the
 * door — the rule `os meta delete --package` follows, for the same reason.
 *
 * The SDK sends nothing for `packageId: ''` (`SaveMetaItemOptions.packageId`
 * is truthy-guarded), and a save that names no package is not a refusal on
 * every item: the door resolves it, writing the row of the one package that
 * holds the item, or the package-unbound overlay when none does. So
 * `os meta register view --data v.json --package "$PKG"` with `PKG` unset would
 * write whichever row that resolution picks while the operator reads their
 * command line as naming one package. The CLI refuses rather than degrades. A
 * non-empty id is forwarded verbatim: the door, not this command, decides what
 * an id names.
 */
export const EMPTY_PACKAGE_SAVE_REFUSAL =
  '--package needs the id of the package the save writes into, and was given an empty value. '
  + 'Name the package (for example com.acme.crm), or omit --package to save into the row '
  + 'the server resolves when the item belongs to one package.';

/**
 * [#23350] The `SaveMetaItemOptions` bag this command's flags mean — the one
 * place the command decides what goes on the wire, as `metaDeleteOptions` is
 * for `os meta delete`. Exported so the wire claim is measured on this value.
 *
 * Returns `undefined` — never `{}` — when no flag is set, so an ordinary
 * `os meta register <type> --data <file>` hands the SDK no options and the
 * request stays byte-identical to what it sent before the flag existed: an
 * active (published) save, `PUT /meta/:type/:name` with no query string.
 *
 * Only `packageId` is mapped. `SaveMetaItemOptions` also carries `ifMatch`,
 * `force` and `mode`; this command declares no flag for them, and adding one
 * is a separate widening.
 */
export function metaRegisterOptions(flags: {
  package?: string;
}): SaveMetaItemOptions | undefined {
  const packageId = flags.package;
  if (packageId === undefined) return undefined;
  if (packageId.trim() === '') {
    throw new Error(EMPTY_PACKAGE_SAVE_REFUSAL);
  }
  // Verbatim, as the SDK takes it: `packageId` → `?package=`.
  return { packageId };
}

export default class MetaRegister extends Command {
  static override description = 'Register metadata (create or update)';

  static override examples = [
    '$ os meta register object --data object-def.json',
    '$ os meta register plugin --data plugin-manifest.json',
    '$ os meta register view --data view-def.json --package com.acme.crm',
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
    // [#23350] The package whose row the save writes, forwarded verbatim as
    // `SaveMetaItemOptions.packageId` (`?package=`). It is the remedy the save
    // door's `409 RESOURCE_CONFLICT` prescribes for an item two packages hold.
    package: Flags.string({
      description:
        'Save into this package\'s row (a package id, e.g. com.acme.crm). Required when two or '
        + 'more packages hold the item: without it the server refuses with 409 RESOURCE_CONFLICT '
        + 'and names the packages.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MetaRegister);

    try {
      // FIRST — before the client exists and before anything can reach the
      // network, as in `os meta delete`: an empty `--package` must not run a
      // save the operator's command line reads as addressed to one package.
      const options = metaRegisterOptions(flags);

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
      const result = await client.meta.saveItem(args.type, name, metadata, options);

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
