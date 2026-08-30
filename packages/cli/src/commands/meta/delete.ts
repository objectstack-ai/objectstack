// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { DeleteMetaItemOptions } from '@objectstack/client';
import { printError, printSuccess, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

/**
 * [#13024] The refusal an EMPTY `--if-match` earns, before anything reaches
 * the door.
 *
 * The SDK deliberately OMITS the `If-Match` header for `''` — on that layer
 * the rule is right, because the door reads the header's PRESENCE as "pin this
 * reset", so an emitted empty header would pin against the empty string and
 * refuse a reset nobody asked to pin. At the CLI boundary the same rule is a
 * trap: `os meta delete view x --if-match "$VERSION"` with `VERSION` unset
 * expands to an empty argument, and inheriting the SDK's omission would run
 * the UNPINNED, last-write-wins reset while the operator reads their own
 * command line as pinned. That is precisely the silent destruction this card
 * exists to make unreachable, so the CLI refuses rather than degrades
 * (AGENTS.md "Absence must be loud" / prefer failing to falling back).
 *
 * Refusal only — the value is never rewritten. A non-empty token is forwarded
 * VERBATIM, because the version is opaque (`DeleteMetaItemOptions.ifMatch`:
 * "echo it verbatim, never parse it").
 */
export const EMPTY_IF_MATCH_REFUSAL =
  '--if-match needs the metadata version to pin the reset to, and was given an empty value. '
  + 'Echo the `version` a previous `os meta` save or publish resolved, or omit --if-match '
  + 'to accept the unpinned (last-write-wins) reset.';

/**
 * [#13024] The `DeleteMetaItemOptions` bag this command's flags mean — the one
 * place the CLI decides what goes on the wire.
 *
 * Exported so the both-twins claim can be MEASURED rather than asserted: the
 * SDK carries two textually identical `deleteItem` declarations (unscoped and
 * environment-scoped), the trap #11713 records is a fix landing on one of a
 * pair, and a bag built inside `run()` could only ever be driven through the
 * one twin this command happens to call. Driving THIS value through both is
 * what makes "identical through both" a reading.
 *
 * Returns `undefined` — never `{}` — when no flag is set, so an ordinary
 * `os meta delete <type> <name>` hands the SDK the same argument list it has
 * always handed it and the request stays byte-identical.
 *
 * ⛔ `?dropStorage` is NOT here and gets no flag. #12181 shipped two of the
 * door's three carriers on purpose: the third ADDS destructive reach (it drops
 * the object's physical table), no caller was measured needing it, and the
 * door's repeated-parameter refusal exists because of that destructiveness.
 * Publishing it from the CLI would reverse that ruling from the layer above.
 */
export function metaDeleteOptions(flags: {
  'if-match'?: string;
  draft?: boolean;
}): DeleteMetaItemOptions | undefined {
  const pin = flags['if-match'];
  if (pin !== undefined && pin.trim() === '') {
    throw new Error(EMPTY_IF_MATCH_REFUSAL);
  }
  const options: DeleteMetaItemOptions = {};
  if (pin !== undefined) options.ifMatch = pin;
  // `state: 'active'` is never sent: it is the door's default said out loud,
  // and the SDK drops it. The flag is therefore a boolean, matching every
  // other binary opt-in in this CLI.
  if (flags.draft) options.state = 'draft';
  return Object.keys(options).length > 0 ? options : undefined;
}

export default class MetaDelete extends Command {
  static override description = 'Delete a metadata item';

  static override examples = [
    '$ os meta delete object my_custom_object',
    '$ os meta delete plugin my-plugin',
    '$ os meta delete object my_custom_object --format json',
    '$ os meta delete view shared_grid --if-match "$VERSION"',
    '$ os meta delete view shared_grid --draft',
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
    // [#13024] The ADR-0008 optimistic-concurrency pin. A string flag because
    // it carries an opaque token, like every other value-bearing flag here.
    'if-match': Flags.string({
      description:
        'Pin the reset to the version you last read (ADR-0008). Echo the `version` a previous '
        + 'save or publish resolved and a concurrent edit is refused with 409 metadata_conflict '
        + 'instead of being silently destroyed. Unpinned, this command is last-write-wins.',
    }),
    // [#13024] BOOLEAN, not `--state <active|draft>`, and the choice is the
    // CLI's own convention rather than a preference. Every value-listing flag
    // in `packages/cli/src/commands` (`--format`, `--visibility`,
    // `--log-level`, `--package-manager`, `--observability`) enumerates THREE
    // or more members with a meaningful non-boolean default; there is no
    // two-valued `options: [...]` flag anywhere in the tree. Binary opt-ins
    // that default off are `Flags.boolean` throughout (`--dry-run`, `--apply`,
    // `--strict`, `--pre-release`, `--submit`, `--fresh`, `--step`). And the
    // carrier itself is binary by construction: `state?: 'active' | 'draft'`
    // where `'active'` deliberately sends NOTHING, so `--state active` would
    // be a spelling with no effect on the wire — a boolean wearing a costume.
    draft: Flags.boolean({
      description:
        'Discard ONLY the pending draft overlay, leaving the published overlay serving. '
        + 'Without it the reset is the full one and drops the published overlay too.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MetaDelete);

    try {
      // FIRST — before the client exists and before anything can reach the
      // network. A malformed pin must not run the destructive default while
      // the operator's command line reads as pinned.
      const options = metaDeleteOptions(flags);

      const { client, token } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      const result = await client.meta.deleteItem(args.type, args.name, options);

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
        // [#13024] `--draft` discards the pending draft and leaves the
        // published overlay serving, so the full-reset sentence would be a
        // false report of what just happened — on the run where the operator
        // deliberately chose the narrower verb.
        printSuccess(
          flags.draft
            ? `Pending draft discarded: ${args.type}/${args.name}`
            : `Metadata deleted: ${args.type}/${args.name}`,
        );
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
