// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DECISION half of #12964 — when oclif's "command … not found" is really a
 * dependency that has no build output, and when it is genuinely a missing
 * command and must be left alone.
 *
 * ## Where this corpus comes from
 *
 * Both fixtures below are TRANSCRIPT, not invention. They were read off a real
 * run at `8cb96ec41`, in a worktree created with `git worktree add` + `pnpm
 * install` and NOTHING built:
 *
 *     $ pnpm i18n:extract      # tsx packages/cli/bin/run-dev.js i18n extract …
 *     …58 ModuleLoadError warnings…
 *     Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found
 *     $ echo $?
 *     2
 *
 * The error object itself was probed in the same tree: `constructor.name`
 * `CLIError`, `name` `'Error'`, `oclif.exit` 2 — so `String(error)` is the
 * `Error: command … not found` spelling asserted here — and, decisively, own
 * properties `['code','oclif','skipOclifErrorHandling','suggestions']`, with
 * NEITHER `parse` nor `showHelp`. That is why `invocationFailureLine` (whose
 * `isInvocationError` requires both) answers `undefined` for this failure and
 * why it could not be the place this lands.
 *
 * ⚠️ This file pins the decision only. Whether `bin/run-dev.js` actually asks
 * the question and prints the answer is a different fact with its own test —
 * `run-dev-unbuilt-workspace.e2e.test.ts` drives the real binary, and deleting
 * the wiring reds THAT one, not this one.
 *
 * ## What this suite's verdict is really a function of
 *
 * Three files outside this package, all declared in
 * `scripts/cross-package-test-inputs.mjs` so a change to any of them re-runs
 * this suite:
 *
 *   - `scripts/cli-unbuilt-workspace-lead.mjs` — the module imported below.
 *   - `scripts/cli-build-prerequisite.mjs` — where the module delegates BOTH
 *     halves of its answer. `looksLikeStaleWorkspaceDist` decides whether there
 *     is anything to say, and `workspaceBuildFix` renders the remedy this file
 *     asserts character for character, so that module can move these
 *     expectations without either file above it changing.
 *   - `scripts/cli-unbuilt-workspace-lead.d.mts` — the hand-written declaration
 *     that lets a `.ts` file import an untyped `.mjs`. Without it this import is
 *     TS7016, and this file sits in `@objectstack/cli`'s ledgered hidden test
 *     layer, whose entry says the first new error in it goes red rather than
 *     being absorbed. `check:declaration-mirrors` keeps it in step with the
 *     module; it asserts name, kind and required arity, never types.
 */

import { describe, it, expect } from 'vitest';
import { unbuiltWorkspaceLines } from '../../../scripts/cli-unbuilt-workspace-lead.mjs';
import { INVOCATION_PREFIX } from '../src/utils/invocation.js';

/**
 * `warning.detail` of the first of the 58 `ModuleLoadError` warnings the
 * measured run emitted, verbatim.
 */
const MEASURED_DETAIL = [
  'module: @oclif/core@4.13.3',
  'task: findCommand (compile)',
  'plugin: @objectstack/cli',
  'root: /home/user/objectstack-12964/packages/cli',
  'code: MODULE_NOT_FOUND',
  "message: [MODULE_NOT_FOUND] import() failed to load /home/user/objectstack-12964/packages/cli/src/commands/compile.ts: Cannot find module '/home/user/objectstack-12964/packages/cli/node_modules/@objectstack/spec/dist/index.mjs' imported from /home/user/objectstack-12964/packages/cli/src/commands/compile.ts",
  'See more details with DEBUG=*',
].join('\n');

/** The measured `CLIError`, reproduced through the property the code reads. */
const notFound = () => new Error('command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found');

describe('unbuiltWorkspaceLines', () => {
  it('names the package whose build output is missing, and the one command that fixes it', () => {
    const lines = unbuiltWorkspaceLines(notFound(), [MEASURED_DETAIL], INVOCATION_PREFIX);

    expect(lines).toBeDefined();
    expect(lines).toHaveLength(2);
    // The whole point of the card: the line must contradict "not found" and
    // attribute the failure, rather than restate it.
    expect(lines?.[0]).toContain('NOT A MISSING COMMAND');
    expect(lines?.[0]).toContain('@objectstack/spec');
    expect(lines?.[0]).toContain("Cannot find module '/home/user/objectstack-12964/packages/cli/node_modules/@objectstack/spec/dist/index.mjs'");
    // The remedy is `workspaceBuildFix`'s, spelled out here because this string
    // is what a reader is told to type — a change to it is a change to them.
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('leaves a genuinely missing command alone — nothing failed to load', () => {
    // `os frobnicate` in a tree whose commands all load: oclif emits no
    // module-load warning, so there is nothing to classify and nothing to say.
    expect(unbuiltWorkspaceLines(new Error('command frobnicate not found'), [], INVOCATION_PREFIX)).toBeUndefined();
  });

  it('says nothing when the module that failed belongs to somebody else', () => {
    // A third party's missing module is not a build this repo can prescribe.
    // The two words are chosen so neither is a substring of the other: a
    // `lodash` specifier must not be read as an `@objectstack` one.
    const thirdParty = "message: [MODULE_NOT_FOUND] import() failed to load /repo/packages/cli/src/commands/x.ts: Cannot find module 'lodash/merge.js' imported from /repo/packages/cli/src/commands/x.ts";
    expect(unbuiltWorkspaceLines(notFound(), [thirdParty], INVOCATION_PREFIX)).toBeUndefined();
  });

  it('says nothing when the failure was not oclif reporting a missing command', () => {
    // A parse error, and a genuine runtime error, both keep oclif's reporting
    // exactly as it was even in a tree that really is unbuilt.
    expect(unbuiltWorkspaceLines(new Error('Nonexistent flag: --no-ui'), [MEASURED_DETAIL], INVOCATION_PREFIX)).toBeUndefined();
    expect(unbuiltWorkspaceLines(new Error('ENOENT: no such file or directory'), [MEASURED_DETAIL], INVOCATION_PREFIX)).toBeUndefined();
  });

  it('survives oclif hard-wrapping the sentence it has to recognise', () => {
    // oclif wraps that one sentence across ` › `-prefixed lines at a width that
    // depends on the argument, sometimes mid-token. A per-line regex matches
    // neither shape; `looksLikeMissingCliCommand` flattens first, and this case
    // is what keeps this file honest about depending on that.
    const wrapped = ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
    expect(unbuiltWorkspaceLines(wrapped, [MEASURED_DETAIL], INVOCATION_PREFIX)?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('covers the STALE dist as well as the missing one, with the same fix', () => {
    // #7681's other half: the dist exists and predates the export the source
    // added. Same environment fact, same one command.
    const stale =
      "message: import() failed to load /repo/packages/cli/src/commands/lint.ts: The requested module '@objectstack/spec/system' does not provide an export named 'authorisesIrreversibleAction'";
    const lines = unbuiltWorkspaceLines(notFound(), [stale], INVOCATION_PREFIX);
    expect(lines?.[0]).toContain('does not provide an export named');
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('reaches past a leading failure it has no standing to diagnose', () => {
    // Emission order is `Promise.all` order over the command modules, so the
    // classifiable warning is not reliably first.
    const thirdParty = "Cannot find module 'lodash/merge.js' imported from /repo/packages/cli/src/commands/x.ts";
    expect(unbuiltWorkspaceLines(notFound(), [thirdParty, MEASURED_DETAIL], INVOCATION_PREFIX)?.[0]).toContain('@objectstack/spec');
  });
});

/**
 * ## #16547 — the SAME classified failure, with the build output never consulted
 *
 * Transcript, not invention. Measured in a worktree at `de0bcdd44d` with
 * `packages/types/dist` present and fresh, running the dev entry from
 * `packages/plugins/plugin-security`, whose tsconfig maps `@objectstack/types`
 * to `../../types/src/index.ts` so its own typecheck grades against source:
 *
 *     $ TSX_TSCONFIG_PATH="$PWD/tsconfig.json" \
 *         ../../../node_modules/.bin/tsx ../../../packages/cli/bin/run-dev.js lint objectstack.config.ts
 *     …
 *     objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/types
 *     Error: command lint:objectstack.config.ts not found
 *     $ echo $?
 *     2
 *
 * The classifier is right that this is an export mismatch on a package this
 * repo builds. It is the REMEDY that was wrong: tsx honours the CWD's tsconfig,
 * so the import never reached `packages/types/dist` at all, and the build it
 * prescribed succeeds and changes nothing.
 */
const REDIRECTED_DETAIL = [
  'module: @oclif/core@4.13.3',
  'task: findCommand (start)',
  'plugin: @objectstack/cli',
  'root: /home/user/objectstack-issue-16547/packages/cli',
  "message: The requested module '@objectstack/types' does not provide an export named 'PLATFORM_OWNER_EMAIL_ENV'",
  'See more details with DEBUG=*',
].join('\n');

/** What the shim's own `import.meta.resolve` answered on that run, verbatim. */
const REDIRECTED_TO = 'file:///home/user/objectstack-issue-16547/packages/types/src/index.ts';

describe('unbuiltWorkspaceLines — build output that was never consulted (#16547)', () => {
  it('refuses the rebuild remedy and names the redirect instead', () => {
    const lines = unbuiltWorkspaceLines(notFound(), [REDIRECTED_DETAIL], INVOCATION_PREFIX, () => REDIRECTED_TO);

    expect(lines).toHaveLength(2);
    // Still contradicts "not found" — that half of #12964 is unchanged.
    expect(lines?.[0]).toContain('NOT A MISSING COMMAND');
    // …but the attribution is inverted, and says so in words a reader cannot
    // misread as the old line: the precondition is NOT the build output.
    expect(lines?.[0]).toContain("The unmet precondition is NOT @objectstack/types's build output");
    // The evidence is carried, not summarised — a reader can check it.
    expect(lines?.[0]).toContain(REDIRECTED_TO);
    // ⛔ The one assertion the whole card is about: the misdirection is GONE.
    // A `toContain` on the new text would pass while the old text sat beside it.
    expect(lines?.[1]).not.toContain('turbo run build');
    expect(lines?.[1]).toContain('tsx reads the CWD');
    expect(lines?.[1]).toContain('TSX_TSCONFIG_PATH=packages/cli/tsconfig.json');
  });

  it('CONTROL — the same failure whose specifier DID reach build output keeps the rebuild', () => {
    // The positive control for the case above. Without it, a probe that
    // answered "redirect" for everything would read green there and would have
    // silently retired #7681's remedy for the cause it was written for.
    const lines = unbuiltWorkspaceLines(notFound(), [REDIRECTED_DETAIL], INVOCATION_PREFIX, () => 'file:///repo/packages/types/dist/index.mjs');
    expect(lines?.[0]).toContain("The unmet precondition is @objectstack/types's build output");
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/types');
  });

  it('CONTROL — a caller that asks no question gets the pre-#16547 answer', () => {
    // The parameter is optional, and omitting it must not change a verdict.
    // `check:declaration-mirrors` holds the declaration to the same optionality.
    const lines = unbuiltWorkspaceLines(notFound(), [REDIRECTED_DETAIL], INVOCATION_PREFIX);
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/types');
  });

  it('a probe that throws is no evidence, and never becomes the report', () => {
    const lines = unbuiltWorkspaceLines(notFound(), [REDIRECTED_DETAIL], INVOCATION_PREFIX, () => {
      throw new Error('resolver exploded');
    });
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/types');
  });

  it('leaves the MISSING-OUTPUT shape alone even when the probe would answer source', () => {
    // The narrowing stated in `sourceRedirectOf`. A `missing-output` failure
    // names a PATH node could not find, so re-resolving it asks a different
    // question — and a `paths` target that does not exist on disk falls back to
    // node resolution, so a redirect cannot produce this shape in the first
    // place. Pinned so a future widening has to argue with this case.
    const lines = unbuiltWorkspaceLines(notFound(), [MEASURED_DETAIL], INVOCATION_PREFIX, () => REDIRECTED_TO);
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('reads a bare path as well as a file:// URL', () => {
    // `import.meta.resolve` answers a URL; a caller with a plain path must get
    // the same verdict, so the extension test runs on the PATH either way.
    const lines = unbuiltWorkspaceLines(notFound(), [REDIRECTED_DETAIL], INVOCATION_PREFIX, () => '/repo/packages/types/src/index.ts');
    expect(lines?.[1]).not.toContain('turbo run build');
  });
});
