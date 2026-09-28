// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';
import type { LoadedConfig } from './config.js';

/**
 * [#20367 ruling B] The author-time doors' provenance refusal: `os validate`
 * and `os build` accept only a config whose default export a stack producer
 * built — `defineStack(...)` (either mode) or `composeStacks(...)`.
 *
 * ## Why the doors check provenance instead of judging the export
 *
 * The cross-field refusals of the `STACK_*` family (capability vocabulary,
 * cross-references, namespace prefix, single app, hierarchy-scope and trigger
 * capability) run inside `defineStack`, and only there. A plain-object export
 * reached both doors unjudged — the schema parse alone passed it at exit 0 and
 * `os build` shipped the artifact — while the same stack inside `defineStack`
 * was refused. Judging the export at the door instead is not an option: a built
 * stack carries each bound action twice (top level and merged into its
 * object), so re-running the family on `defineStack`'s own output refuses every
 * correct project with a bound action. One authoring shape closes it: the door
 * asks "did the producer build this?" (`hasStackProvenance`, read by
 * `loadConfig` off the default export before its named-export merge) and
 * refuses when it did not, so the family is raised at both doors by
 * construction.
 *
 * ## Where it sits, and what it answers
 *
 * Right after `loadConfig`, before any other judgement — nothing the door
 * could say about an unjudged stack is worth reading ahead of "it was never
 * judged". It THROWS rather than printing, so it answers through each
 * command's existing catch-all exactly as a `defineStack` refusal raised at
 * load does: `--json` carries `error` + `code` (+ the `warnings` /
 * `conversions` lists, empty at this point) and exits 1; the text face prints
 * the message. The envelope gains no field.
 *
 * `status: 422` is the family's (`StackRefusalError`, `@objectstack/spec`):
 * an unprocessable authored entity. The code is the one `composeStacks`
 * raises for an unbuilt input — one condition, one vocabulary, two emitters,
 * registered under both packages in the ADR-0112 ledger.
 */
export class StackProvenanceMissingError extends Error {
  readonly code = 'STACK_PROVENANCE_MISSING';
  readonly status = 422;
  /** One entry: the config file whose default export is refused. */
  readonly issues: readonly string[];

  constructor(message: string, configFile: string) {
    super(message);
    this.name = 'StackProvenanceMissingError';
    this.issues = [configFile];
  }
}

/**
 * The prescription an author (or an AI writing the config) reads. It names
 * the one-line fix first, then the two ways a correct-looking export loses the
 * mark, because both have the same fix.
 */
export function stackProvenanceMissingMessage(configFile: string): string {
  return (
    `${configFile}: the default export was not built by \`defineStack\` — ` +
    `\`os validate\` and \`os build\` accept only a stack that \`defineStack(...)\` ` +
    `(or \`composeStacks(...)\`) returned, because the stack's cross-field checks ` +
    `(capabilities, cross-references, namespace prefix, single app, hierarchy scope, ` +
    `triggers) run inside it. Wrap the export: ` +
    `\`import { defineStack } from '@objectstack/spec'; export default defineStack({ … });\`. ` +
    `A spread (\`{ ...stack, api: { … } }\`) or JSON copy of a built stack is not the built ` +
    `stack either — put every key inside \`defineStack({ … })\` and export what it returns.`
  );
}

/**
 * Refuse a loaded config whose default export no stack producer built. Called
 * by `os validate` and `os build` right after `loadConfig`; a no-op for every
 * `defineStack` / `composeStacks` export.
 */
export function refuseUnbuiltStack(loaded: Pick<LoadedConfig, 'stackProvenance' | 'absolutePath'>): void {
  if (loaded.stackProvenance) return;
  const configFile = path.basename(loaded.absolutePath);
  throw new StackProvenanceMissingError(stackProvenanceMissingMessage(configFile), configFile);
}
