// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { GetMetaItemResponse, SaveMetaItemOptions } from '@objectstack/client';
import type { MetadataValidationResult } from '@objectstack/spec/kernel';
import { printError, printInfo, printSuccess, printWarning, emitJson, errorCodeFields } from '../../utils/format.js';
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
 * [#34777, ruling D4] The refusal a `--mode draft` run that names no package
 * earns, before anything reaches the door — the rule the MCP draft door
 * follows. Studio's Changes lists drafts per package (`GET /meta/_drafts?package=`),
 * so a draft staged into no package is reviewable in no package's Changes,
 * while the author reads their run as having staged it for review.
 */
export const DRAFT_NEEDS_PACKAGE_REFUSAL =
  '--mode draft needs --package: Studio\'s Changes lists drafts per package, so a draft saved '
  + 'into no package is listed in no package\'s Changes. Name the package the draft is staged '
  + 'into with --package <id> (for example --package com.acme.crm).';

/**
 * [#23480] The line this command adds under the save door's
 * `409 DESTRUCTIVE_CHANGE` refusal: the door's message ends with its own
 * remedy, "re-submit with ?force=true", and this command's spelling of that
 * query parameter is `--force`. The server's message is passed through
 * verbatim and this line stands beside it, in the text face and as `hint` in
 * the `--format json` envelope. It is added only to a run that did not send
 * `--force`: one that did has nothing left to re-run with.
 */
export const DESTRUCTIVE_CHANGE_FORCE_HINT =
  'On this command, ?force=true is --force. Re-run with --force to apply the change and '
  + 'accept the data it drops or transforms.';

/**
 * [#23480] The remedy line a failed save earns, or `undefined` when it earns
 * none. Only a refusal carrying the ADR-0112 code `DESTRUCTIVE_CHANGE`, on a
 * run without `--force`, has one; every other failure is reported exactly as
 * before.
 */
export function metaRegisterRefusalHint(
  error: unknown,
  flags: { force?: boolean },
): string | undefined {
  if (flags.force === true) return undefined;
  return errorCodeFields(error).code === 'DESTRUCTIVE_CHANGE'
    ? DESTRUCTIVE_CHANGE_FORCE_HINT
    : undefined;
}

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
 * Two members are mapped:
 *  - `--package` → `packageId` (`?package=`), [#23350];
 *  - `--force` → `force: true` (`?force=true`), [#23480], the acknowledgement
 *    the door's `409 DESTRUCTIVE_CHANGE` names as its remedy. Mapped only when
 *    the flag is given: an absent `--force` (oclif hands `false`) adds no
 *    member, so the SDK sends no `force` at all rather than an opt-out
 *    spelling.
 *
 *  - `--mode draft` → `mode: 'draft'` (`?mode=draft`), [#34777]: the save
 *    stages a pending draft instead of publishing. Mapped only for `draft`:
 *    `--mode publish` is the default said out loud and, like the SDK's own
 *    `'publish'`, adds no member, so its request is the unflagged one. A
 *    draft needs a named package ({@link DRAFT_NEEDS_PACKAGE_REFUSAL}).
 *
 * `SaveMetaItemOptions` also carries `ifMatch`; this command declares no flag
 * for it, and adding one is a separate widening.
 */
export function metaRegisterOptions(flags: {
  package?: string;
  force?: boolean;
  mode?: string;
}): SaveMetaItemOptions | undefined {
  const options: SaveMetaItemOptions = {};
  const packageId = flags.package;
  if (packageId !== undefined) {
    if (packageId.trim() === '') {
      throw new Error(EMPTY_PACKAGE_SAVE_REFUSAL);
    }
    // Verbatim, as the SDK takes it: `packageId` → `?package=`.
    options.packageId = packageId;
  }
  // The opt-in only, as the SDK spells it: `force: true` → `?force=true`.
  if (flags.force === true) options.force = true;
  // [#34777] The draft opt-in only, as the SDK spells it: `mode: 'draft'` →
  // `?mode=draft`. `publish` (or no flag) adds nothing.
  if (flags.mode === 'draft') {
    // [#34777, ruling D4] Refused here, before the client exists: a draft
    // names the package whose Changes it is reviewed in.
    if (options.packageId === undefined) throw new Error(DRAFT_NEEDS_PACKAGE_REFUSAL);
    options.mode = 'draft';
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

/** [#34777] The publish verdict a draft read serves, as this command prints it. */
export interface DraftPublishVerdict {
  valid: boolean;
  errors: NonNullable<MetadataValidationResult['errors']>;
  warnings: NonNullable<MetadataValidationResult['warnings']>;
}

/**
 * [#34777] The publish verdict of the draft a `--mode draft` save just stored,
 * read off the strict draft read (`GET /meta/:type/:name?package=P&state=draft`,
 * `meta.getItem` with `state: 'draft'`): its `item._diagnostics`, into which
 * the runtime folds what publishing that draft would refuse (#26707). The
 * command computes no verdict of its own.
 *
 * The read is accepted as the saved draft's only when it answers the saved
 * draft row's `version` token. The door answers a caller it does not admit to
 * drafts with the published item instead, and a draft edited between the
 * save and the read is another body: either way the read's `_diagnostics` is
 * not this draft's verdict, so none is returned and `unread` says why.
 */
export function draftPublishVerdictOf(
  read: GetMetaItemResponse | undefined,
  savedVersion: unknown,
): { verdict: DraftPublishVerdict; unread?: undefined } | { verdict: null; unread: string } {
  if (typeof savedVersion === 'string' && read?.version !== savedVersion) {
    return {
      verdict: null,
      unread: `the draft read answered version ${String(read?.version ?? 'none')}, not the draft this save stored `
        + `(version ${savedVersion}): the draft changed since, or this caller is not served drafts.`,
    };
  }
  const diagnostics = (read?.item as { _diagnostics?: MetadataValidationResult } | undefined)?._diagnostics;
  if (!diagnostics || typeof diagnostics.valid !== 'boolean') {
    return { verdict: null, unread: 'the runtime served no publish verdict on this draft.' };
  }
  return {
    verdict: {
      valid: diagnostics.valid,
      errors: diagnostics.errors ?? [],
      warnings: diagnostics.warnings ?? [],
    },
  };
}

/** [#34777] One verdict entry as a line: its code, where it is, and what it says. */
function verdictEntryLine(entry: { path: string; message: string; code?: string }): string {
  return `${entry.code ? `${entry.code} ` : ''}${entry.path ? `at ${entry.path}: ` : ''}${entry.message}`;
}

/** [#34777] The publish verdict's text face, head line first; exported so the text is measured. */
export function draftVerdictLines(verdict: DraftPublishVerdict): {
  head: string;
  errors: string[];
  warnings: string[];
} {
  return {
    head: `Publish verdict: valid: ${verdict.valid}, ${verdict.errors.length} error(s), `
      + `${verdict.warnings.length} warning(s)`
      + (verdict.valid ? '.' : ' — publishing this draft as it stands is refused.'),
    errors: verdict.errors.map(verdictEntryLine),
    warnings: verdict.warnings.map(verdictEntryLine),
  };
}

/**
 * [#34777] What a `--mode draft` save prints, line by line, after the door
 * answered 2xx — the draft is stored and is NOT live. Exported so the text is
 * measured on this value.
 *
 * The door's 2xx says only that the draft was stored (`state: 'draft'`, its
 * `version`) and carries the save's own advisories. It does not carry what a
 * publish of the draft would answer: a draft save runs no publish rule
 * (`AUTHORING_SURFACES`, #4463 D1). That verdict is read back separately
 * ({@link draftPublishVerdictOf}); these lines name where a person reviews
 * the draft: Studio's Changes for the package it was staged into.
 */
export function draftSaveLines(args: {
  type: string;
  name: string;
  packageId?: string;
  version?: unknown;
}): string[] {
  const lines = [
    `Draft saved: ${args.type}/${args.name} — staged for review, not published`
      + `${typeof args.version === 'string' ? ` (version ${args.version})` : ''}.`,
  ];
  if (args.packageId) {
    lines.push(
      `Review and publish it in Studio's Changes for package ${args.packageId} `
        + `(/studio/${encodeURIComponent(args.packageId)}/interfaces?changes=review).`,
    );
  }
  return lines;
}

export default class MetaRegister extends Command {
  static override description = 'Register metadata (create or update)';

  static override examples = [
    '$ os meta register object --data object-def.json',
    '$ os meta register plugin --data plugin-manifest.json',
    '$ os meta register view --data view-def.json --package com.acme.crm',
    '$ os meta register object --data object-def.json --force',
    '$ os meta register view --data view-def.json --package com.acme.crm --mode draft',
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
    // [#23480] The acknowledgement the save door's `409 DESTRUCTIVE_CHANGE`
    // names as its remedy, forwarded as `SaveMetaItemOptions.force`
    // (`?force=true`) only when given. Boolean, off by default and with no
    // short alias, like this CLI's other `--force` flags: it lets the server
    // drop data, so it is spelled out in full on every run that uses it.
    force: Flags.boolean({
      description:
        'Apply the save even when it drops or transforms existing data (a removed field, an '
        + 'incompatible field type change). Without it the server refuses such a change with '
        + '409 DESTRUCTIVE_CHANGE and writes nothing.',
      default: false,
    }),
    // [#34777] The lifecycle the save writes into, forwarded as
    // `SaveMetaItemOptions.mode` (`?mode=draft`) only for `draft`. No default,
    // so an unflagged run hands the SDK no `mode` and its request is
    // byte-identical to the one this command always sent: an active save.
    mode: Flags.string({
      description:
        'draft stages the item as a pending draft for review (?mode=draft) in the --package it '
        + 'names, then reads the draft back and prints its publish verdict: nothing is published '
        + 'until a person publishes it in Studio\'s Changes. publish, the default, saves it live.',
      options: ['draft', 'publish'],
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

      if (options?.mode === 'draft') {
        await this.reportDraft(client, { type: args.type, name, packageId: options.packageId!, format: flags.format }, result);
        return;
      }

      if (flags.format === 'json') {
        await formatOutput(result, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(result, 'yaml');
      } else {
        printSuccess(`Metadata registered: ${args.type}/${name}`);
      }
    } catch (error: any) {
      // [#23480] The server's message stays verbatim; the hint, when there is
      // one, stands beside it and names this command's spelling of its remedy.
      const hint = metaRegisterRefusalHint(error, flags);
      if (flags.format === 'json') {
        await emitJson({
          success: false,
          error: error.message,
          ...errorCodeFields(error),
          ...(hint ? { hint } : {}),
        });
        this.exit(1);
      }
      printError(error.message || String(error));
      if (hint) printWarning(hint);
      this.exit(1);
    }
  }

  /**
   * [#34777] After a `--mode draft` save: read the draft back through the
   * strict draft read and print its publish verdict beside the door's answer.
   * Only a draft save reaches here, so an unflagged or `--mode publish` run
   * sends no second request. The draft is stored whatever the verdict says
   * (staging a draft that does not publish yet is what drafts are for), so a
   * `valid: false` verdict is printed, not turned into a failed run; a read
   * that fails is reported the same way, after the save it follows.
   */
  private async reportDraft(
    client: { meta: { getItem: (type: string, name: string, options: { packageId: string; state: 'draft' }) => Promise<GetMetaItemResponse> } },
    args: { type: string; name: string; packageId: string; format?: string },
    result: any,
  ): Promise<void> {
    let read: { verdict: DraftPublishVerdict | null; unread?: string };
    try {
      read = draftPublishVerdictOf(
        await client.meta.getItem(args.type, args.name, { packageId: args.packageId, state: 'draft' }),
        result?.version,
      );
    } catch (error: any) {
      read = { verdict: null, unread: `the draft read failed: ${error?.message ?? String(error)}` };
    }

    if (args.format === 'json' || args.format === 'yaml') {
      await formatOutput({
        ...result,
        publishVerdict: read.verdict,
        ...(read.unread ? { publishVerdictUnread: read.unread } : {}),
      }, args.format);
      return;
    }

    const [head, ...rest] = draftSaveLines({ type: args.type, name: args.name, packageId: args.packageId, version: result?.version });
    printSuccess(head);
    for (const line of rest) printInfo(line);
    if (read.verdict) {
      const lines = draftVerdictLines(read.verdict);
      (read.verdict.valid ? printSuccess : printWarning)(lines.head);
      for (const line of lines.errors) printError(line);
      for (const line of lines.warnings) printWarning(line);
    } else {
      printWarning(`Publish verdict not printed: ${read.unread}`);
    }
    // The save's own advisories (a draft hears no publish rule; these are what
    // the door said about the stored row), one line each, unless the verdict
    // already printed the same words.
    const printed = new Set((read.verdict?.warnings ?? []).map((w) => w.message));
    for (const advisory of result?.advisories ?? []) {
      if (!printed.has(advisory.message)) printWarning(`${advisory.rule}: ${advisory.message}`);
    }
  }
}
