// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The lead line `bin/run-dev.js` prints when oclif's "command … not found" is
 * NOT about a missing command (#12964).
 *
 * ## The defect, measured
 *
 * In a fresh worktree with `pnpm install` done and nothing built, the root
 * script `pnpm i18n:extract` — `tsx packages/cli/bin/run-dev.js i18n extract …`
 * — ends on
 *
 *     Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found
 *
 * and exit 2. The command file is right there at `src/commands/i18n/extract.ts`.
 * What actually happened is that oclif's `findCommand` `import()`s every command
 * module while it builds its manifest, all 58 of them failed on
 *
 *     Cannot find module '…/packages/cli/node_modules/@objectstack/spec/dist/index.mjs'
 *
 * and a command whose module would not load is, to `Config.runCommand`,
 * indistinguishable from one that does not exist. The reader is handed the one
 * cause that is definitely not true.
 *
 * This is the class this repo already treats as a defect rather than a shrug:
 * `check:dev-prereqs` exists to refuse a missing/stale spec dist with a NAMED
 * remedy (its header carries the #5726 chase), and #5217 fixed the same
 * misdiagnosis for `check-i18n-bundles`, where "the CLI is not built" arrived as
 * nine per-package bundle problems. `bin/run-dev.js` exists so gates need not
 * depend on `packages/cli/dist` — but it still hard-depends on its DEPENDENCIES'
 * dists, and said nothing about them when that was what was missing.
 *
 * ## Nothing here is a new verdict or a new classifier
 *
 * Both facts are decided by `scripts/cli-build-prerequisite.mjs`, the module
 * #5217 and #7681 put this knowledge in, and the remedy is that module's own
 * `workspaceBuildFix`. This file contributes WORDING and nothing else, which is
 * the split that module's header asks for in as many words ("What is
 * deliberately NOT shared is the WORDING. Only the gate knows what it did not
 * check").
 *
 *   • `looksLikeMissingCliCommand` — is this oclif's "command … not found"? It
 *     is written to survive oclif's mid-token hard wrapping, which a per-line
 *     regex does not.
 *   • `looksLikeStaleWorkspaceDist` — did a package THIS REPO BUILDS cause the
 *     load failure? Deliberately narrow: a third party's `Cannot find module`
 *     returns null and this file then prints nothing, because the mirror-image
 *     defect of a misdiagnosis is a confident diagnosis pointing somewhere
 *     innocent.
 *
 * ⛔ `scripts/check-dev-prereqs.mjs` — the gate that owns the fuller verdict —
 * is NOT reachable from here and was not made reachable. It has no exports and
 * calls `process.exit(report(inspect(ROOT)))` at module scope, so importing it
 * would terminate the CLI; and spawning it would answer about the WHOLE
 * workspace ("67 of 67 packages … `pnpm build`") when the failure in hand names
 * one package and one build. Two remedies for one precondition is the shape
 * that gate's own header (#5726) exists to prevent, so this stays with the
 * narrower one its sibling module already spells.
 *
 * ## Why this is a separate file from `run-dev.js`
 *
 * `run-dev.js` ends in a top-level `await run(...)`, so it cannot be imported by
 * a test without running the CLI. The decision lives here, where it is a pure
 * function over the two strings the shim collected, and `run-dev.js` keeps only
 * the I/O. It is NOT published: `packages/cli`'s `files` is
 * `["dist","README.md","CHANGELOG.md"]` and npm packs the `bin` TARGET only,
 * which is `bin/run.js` — so this file, like `run-dev.js` beside it, is
 * repo-only and may speak the monorepo's vocabulary.
 */

import { looksLikeMissingCliCommand, looksLikeStaleWorkspaceDist, workspaceBuildFix } from '../../../scripts/cli-build-prerequisite.mjs';
import { INVOCATION_PREFIX } from '../src/utils/invocation.ts';

/**
 * The two lines, or `undefined` when this failure is not that one.
 *
 * BOTH conditions are required, and the second is what keeps a plain typo
 * (`os frobnicate`) silent even in a half-built tree: oclif emits no
 * module-load warning for a command that genuinely does not exist, so there is
 * nothing to classify and nothing is printed. A run that really is missing a
 * command keeps oclif's reporting exactly as it was.
 *
 * @param error the error `run()` rejected with
 * @param moduleLoadFailures `detail` of every warning the shim collected, in
 *   emission order — oclif attaches the failing specifier to its
 *   `ModuleLoadError` warnings there
 * @returns `[lead, fix]`, or `undefined`
 */
export function unbuiltWorkspaceLines(error, moduleLoadFailures) {
  if (!looksLikeMissingCliCommand(String(error))) return undefined;

  for (const detail of moduleLoadFailures) {
    // First classified failure wins: ONE unmet precondition, ONE fix. The 58
    // warnings the measured run emitted all name the same missing dist, and a
    // list of them would be the "9 bundle problems" shape #5217 removed.
    const cause = looksLikeStaleWorkspaceDist(String(detail));
    if (!cause) continue;
    return [
      `${INVOCATION_PREFIX}: NOT A MISSING COMMAND — @oclif/core reports a command module that failed to LOAD as "not found", and one did: ${cause.sentence}. The unmet precondition is ${cause.pkg}'s build output, not the invocation.`,
      `${INVOCATION_PREFIX}: Fix: ${workspaceBuildFix(cause.pkg)}`,
    ];
  }

  return undefined;
}
