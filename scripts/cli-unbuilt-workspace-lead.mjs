#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// cli-unbuilt-workspace-lead -- what `packages/cli/bin/run-dev.js` says when
// oclif's "command … not found" is NOT about a missing command (#12964).
//
// ── The defect, measured ────────────────────────────────────────────────────
//
// In a fresh worktree with `pnpm install` done and nothing built, the root
// script `pnpm i18n:extract` -- `tsx packages/cli/bin/run-dev.js i18n extract …`
// -- ends on
//
//     Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found
//
// and exit 2. The command file is right there at `src/commands/i18n/extract.ts`.
// What actually happened is that oclif's `findCommand` `import()`s every command
// module while it builds its manifest, all 58 of them failed on
//
//     Cannot find module '…/packages/cli/node_modules/@objectstack/spec/dist/index.mjs'
//
// and a command whose module will not load is, to `Config.runCommand`,
// indistinguishable from one that does not exist. The reader is handed the one
// cause that is definitely not true.
//
// This is the class this repo already treats as a defect rather than a shrug:
// `check-dev-prereqs.mjs` exists to refuse a missing/stale spec dist with a
// NAMED remedy (its header carries the #5726 chase), and #5217 fixed the same
// misdiagnosis for `check-i18n-bundles`, where "the CLI is not built" arrived as
// nine per-package bundle problems. `bin/run-dev.js` exists so gates need not
// depend on `packages/cli/dist` -- but it still hard-depends on its
// DEPENDENCIES' dists, and said nothing about them when that was what was
// missing.
//
// ── Nothing here is a new verdict or a new classifier ───────────────────────
//
// Both facts are decided by `cli-build-prerequisite.mjs` next door, the module
// #5217 and #7681 put this knowledge in, and the remedy is that module's own
// `workspaceBuildFix`. This file contributes WORDING and nothing else, which is
// the split that module's header asks for in as many words ("What is
// deliberately NOT shared is the WORDING. Only the gate knows what it did not
// check").
//
//   * `looksLikeMissingCliCommand` -- is this oclif's "command … not found"? It
//     is written to survive oclif's mid-token hard wrapping, which a per-line
//     regex does not.
//   * `looksLikeStaleWorkspaceDist` -- did a package THIS REPO BUILDS cause the
//     load failure? Deliberately narrow: a third party's `Cannot find module`
//     returns null and this module then says nothing, because the mirror-image
//     defect of a misdiagnosis is a confident diagnosis pointing somewhere
//     innocent.
//
// ⛔ `check-dev-prereqs.mjs` -- the gate that owns the fuller verdict -- is NOT
// reachable from here and was not made reachable. It has no exports and calls
// `process.exit(report(inspect(ROOT)))` at module scope, so importing it would
// terminate the CLI; and spawning it would answer about the WHOLE workspace
// ("67 of 67 packages … `pnpm build`") when the failure in hand names one
// package and one build. Two remedies for one precondition is the shape that
// gate's own header (#5726) exists to prevent, so this stays with the narrower
// one its sibling already spells.
//
// ── Why it lives here, and why the prefix is a parameter ────────────────────
//
// `run-dev.js` ends in a top-level `await run(...)`, so it cannot be imported by
// a test without running the CLI. The decision lives here, as a pure function
// over the two strings the shim collected.
//
// This directory rather than `packages/cli/bin/` for one concrete reason: a
// hand-written `.d.mts` is what lets a `.ts` test import an untyped `.mjs`
// without TS7016, and `check:declaration-mirrors` only discovers
// `scripts/**/*.d.mts`. A declaration outside its corpus is exactly the
// unwatched drift that gate was built to make impossible (#10549), so the pair
// goes where the gate can see it.
//
// ⚠️ That gate `import()`s this module with bare `node`, so this file must stay
// loadable without tsx. It is why the CLI's name arrives as a PARAMETER instead
// of an `import { INVOCATION_PREFIX } from '…/invocation.ts'`: the shim already
// imports that module on its failure path and owns that coupling, and pulling a
// `.ts` in here would make the mirror check unrunnable.

import { looksLikeMissingCliCommand, looksLikeStaleWorkspaceDist, workspaceBuildFix } from './cli-build-prerequisite.mjs';

/**
 * Where a specifier actually resolved, when the caller can answer that.
 *
 * ## Why this module asks at all (#16547)
 *
 * The remedy below used to be unconditional: classify the failure, name the
 * package, prescribe its build. That is right whenever the failing import
 * REACHED the package's build output — and #16547 measured a whole class where
 * it did not, and where the prescription is therefore worse than silence.
 *
 * Run this CLI's dev entry from a directory whose tsconfig maps a workspace
 * package to its `src/`, and tsx — which reads the CWD's tsconfig, not the
 * entry's — re-routes the CLI's OWN imports to that source. The package's
 * `dist/` is present, fresh, and never consulted. The failure still arrives as
 * an export mismatch on a `@objectstack/*` specifier, so the classifier next
 * door still says "stale build output", and the operator is handed a build that
 * succeeds and changes nothing:
 *
 *     objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec
 *     $ pnpm exec turbo run build --filter=@objectstack/spec   # succeeds
 *     $ <the same command>                                     # fails identically
 *
 * The triage on #16547 graded that loop as the reason the card is p2 rather than
 * p3: a named, plausible, executable action that cannot converge leaves nothing
 * in the output to break the loop, which for an agent is worse than a bare
 * failure. So the remedy is now conditional on the one fact that separates the
 * two causes.
 *
 * ## Why RESOLUTION and not "does the dist exist, and is it fresh"
 *
 * Existence and freshness are proxies for the question that actually decides
 * the remedy, and both answer it WRONG here: `packages/spec/dist` is present AND
 * fresh in exactly the runs this exists to catch — #16547's repro verified both
 * of the blamed exports present in `dist` before the card was filed. Asking
 * where the specifier RESOLVED answers the question directly — was the build
 * output consulted at all — and needs no build-input hash, no stamp read, and no
 * second definition of "fresh" to keep in step with `check-dev-prereqs.mjs`,
 * which owns the only one this repo has.
 *
 * The criterion is that the answer is a TypeScript SOURCE file. No workspace
 * package's `exports` map points at one — every one targets `dist/` — so a `.ts`
 * answer cannot come out of node resolution alone, and is positive evidence of a
 * redirect rather than a guess about one.
 *
 * ⛔ The resolution is INJECTED rather than performed here, and that keeps this
 * module what its header promises: a decision over strings, with no filesystem
 * and no loader of its own. Only the shim knows which loader was in play, and
 * only the shim's `import.meta.resolve` answers for the very resolver that
 * produced the failure — one built here would answer for a DIFFERENT resolver
 * and could contradict the run it is describing.
 *
 * @callback ResolveSpecifier
 * @param {string} specifier the specifier the failure named
 * @returns {string | undefined} the resolved URL or path, or `undefined` when the
 *   caller cannot answer, which is read as "no evidence of a redirect" and leaves
 *   the build remedy exactly as it was
 */

/** Extensions no workspace `exports` map targets, so seeing one means a redirect. */
const TYPESCRIPT_SOURCE = /\.[cm]?tsx?$/;

/**
 * The source file a failing specifier was redirected to, or '' for no redirect.
 *
 * Narrowed to `export-mismatch` on purpose. A `missing-output` failure names a
 * PATH node could not find rather than a bare specifier, so re-resolving it asks
 * a different question — and a redirect cannot produce that shape anyway: a
 * `paths` target that does not exist on disk falls back to node resolution, so
 * the redirect either lands on a real source file or never happened.
 *
 * @param {{ kind: string, pkg: string, specifier: string }} cause
 * @param {ResolveSpecifier} [resolveSpecifier]
 * @returns {string}
 */
function sourceRedirectOf(cause, resolveSpecifier) {
  if (cause.kind !== 'export-mismatch') return '';
  if (typeof resolveSpecifier !== 'function') return '';
  let resolved;
  try {
    resolved = resolveSpecifier(cause.specifier);
  } catch {
    // A probe that throws must never become the report. No evidence is not
    // evidence of no redirect, so the caller keeps the remedy it already had.
    return '';
  }
  if (typeof resolved !== 'string' || !resolved) return '';
  // Compared on the PATH, so a `file://` URL and a bare path answer alike and a
  // query string cannot hide the extension.
  let pathname = resolved;
  if (resolved.includes('://')) {
    try {
      pathname = new URL(resolved).pathname;
    } catch {
      // Not a URL after all; the raw string is the path.
    }
  }
  return TYPESCRIPT_SOURCE.test(pathname) ? resolved : '';
}

/**
 * The two lines, or `undefined` when this failure is not that one.
 *
 * BOTH conditions are required, and the second is what keeps a plain typo
 * (`os frobnicate`) silent even in a half-built tree: oclif emits no
 * module-load warning for a command that genuinely does not exist, so there is
 * nothing to classify and nothing is printed. A run that really is missing a
 * command keeps oclif's reporting exactly as it was.
 *
 * @param {unknown} error the error `run()` rejected with
 * @param {readonly string[]} moduleLoadFailures `detail` of every warning the
 *   shim collected, in emission order -- oclif attaches the failing specifier to
 *   its `ModuleLoadError` warnings there
 * @param {string} prefix the CLI's own name, as every line it prints starts
 *   with (`INVOCATION_PREFIX` in `packages/cli/src/utils/invocation.ts`)
 * @param {ResolveSpecifier} [resolveSpecifier] the caller's own resolver, asked
 *   whether the failing specifier reached build output at all (#16547). Omitted,
 *   this module answers exactly as it did before that card.
 * @returns {[string, string] | undefined} `[lead, fix]`, or `undefined`
 */
export function unbuiltWorkspaceLines(error, moduleLoadFailures, prefix, resolveSpecifier = undefined) {
  if (!looksLikeMissingCliCommand(String(error))) return undefined;

  for (const detail of moduleLoadFailures) {
    // First classified failure wins: ONE unmet precondition, ONE fix. The 58
    // warnings the measured run emitted all name the same missing dist, and a
    // list of them would be the "9 bundle problems" shape #5217 removed.
    const cause = looksLikeStaleWorkspaceDist(String(detail));
    if (!cause) continue;
    // The build output was never consulted, so naming a build would send the
    // reader round a loop that cannot converge (#16547).
    const redirect = sourceRedirectOf(cause, resolveSpecifier);
    if (redirect) {
      return [
        `${prefix}: NOT A MISSING COMMAND — @oclif/core reports a command module that failed to LOAD as "not found", and one did: ${cause.sentence}. The unmet precondition is NOT ${cause.pkg}'s build output: '${cause.specifier}' resolved to ${redirect}, a TypeScript SOURCE file, so ${cause.pkg}'s build output was never consulted and rebuilding it changes nothing.`,
        `${prefix}: Fix: a tsconfig \`paths\` rule found from the current directory redirects '${cause.specifier}' to source, and tsx reads the CWD's tsconfig rather than the entry's. Run from the repository root, or pin tsx to this CLI's own: TSX_TSCONFIG_PATH=packages/cli/tsconfig.json`,
      ];
    }
    return [
      `${prefix}: NOT A MISSING COMMAND — @oclif/core reports a command module that failed to LOAD as "not found", and one did: ${cause.sentence}. The unmet precondition is ${cause.pkg}'s build output, not the invocation.`,
      `${prefix}: Fix: ${workspaceBuildFix(cause.pkg)}`,
    ];
  }

  return undefined;
}
