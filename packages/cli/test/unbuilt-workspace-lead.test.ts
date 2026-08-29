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
 */

import { describe, it, expect } from 'vitest';
import { unbuiltWorkspaceLines } from '../bin/unbuilt-workspace-lead.mjs';

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
    const lines = unbuiltWorkspaceLines(notFound(), [MEASURED_DETAIL]);

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
    expect(unbuiltWorkspaceLines(new Error('command frobnicate not found'), [])).toBeUndefined();
  });

  it('says nothing when the module that failed belongs to somebody else', () => {
    // A third party's missing module is not a build this repo can prescribe.
    // The two words are chosen so neither is a substring of the other: a
    // `lodash` specifier must not be read as an `@objectstack` one.
    const thirdParty = "message: [MODULE_NOT_FOUND] import() failed to load /repo/packages/cli/src/commands/x.ts: Cannot find module 'lodash/merge.js' imported from /repo/packages/cli/src/commands/x.ts";
    expect(unbuiltWorkspaceLines(notFound(), [thirdParty])).toBeUndefined();
  });

  it('says nothing when the failure was not oclif reporting a missing command', () => {
    // A parse error, and a genuine runtime error, both keep oclif's reporting
    // exactly as it was even in a tree that really is unbuilt.
    expect(unbuiltWorkspaceLines(new Error('Nonexistent flag: --no-ui'), [MEASURED_DETAIL])).toBeUndefined();
    expect(unbuiltWorkspaceLines(new Error('ENOENT: no such file or directory'), [MEASURED_DETAIL])).toBeUndefined();
  });

  it('survives oclif hard-wrapping the sentence it has to recognise', () => {
    // oclif wraps that one sentence across ` › `-prefixed lines at a width that
    // depends on the argument, sometimes mid-token. A per-line regex matches
    // neither shape; `looksLikeMissingCliCommand` flattens first, and this case
    // is what keeps this file honest about depending on that.
    const wrapped = ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
    expect(unbuiltWorkspaceLines(wrapped, [MEASURED_DETAIL])?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('covers the STALE dist as well as the missing one, with the same fix', () => {
    // #7681's other half: the dist exists and predates the export the source
    // added. Same environment fact, same one command.
    const stale =
      "message: import() failed to load /repo/packages/cli/src/commands/lint.ts: The requested module '@objectstack/spec/system' does not provide an export named 'authorisesIrreversibleAction'";
    const lines = unbuiltWorkspaceLines(notFound(), [stale]);
    expect(lines?.[0]).toContain('does not provide an export named');
    expect(lines?.[1]).toBe('objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec');
  });

  it('reaches past a leading failure it has no standing to diagnose', () => {
    // Emission order is `Promise.all` order over the command modules, so the
    // classifiable warning is not reliably first.
    const thirdParty = "Cannot find module 'lodash/merge.js' imported from /repo/packages/cli/src/commands/x.ts";
    expect(unbuiltWorkspaceLines(notFound(), [thirdParty, MEASURED_DETAIL])?.[0]).toContain('@objectstack/spec');
  });
});
