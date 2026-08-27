// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `bin/run.js` build-state prerequisite says what to run, and says it in
 * the CALLER's terms (#12539).
 *
 * ── What this file is for ────────────────────────────────────────────────
 *
 * A handful of e2e files in this directory spawn `bin/run.js` rather than
 * `bin/run-dev.js`, because what they measure only exists when oclif resolves
 * the command from the BUILT artifact. On a worktree where only the dependency
 * closure was built — `pnpm --filter '@objectstack/cli^...' build`, the
 * documented first command — the child answers
 * ` ›   Error: command serve not found` and the harness reports
 * `serve exited 2 before "Server is ready"`. Neither sentence says "run the
 * build", so a build-state prerequisite arrives dressed as a regression on a
 * file with no visible connection to a build step. That is the card.
 *
 * `requireBuiltCli()` (`helpers/serve-process.ts`) is the answer, and the ONLY
 * part of it a reader ever acts on is the sentence it throws. That sentence can
 * only be produced on an unbuilt tree, and no test can produce an unbuilt tree
 * without breaking every neighbouring file in the same run — so without this
 * file the wording would be the one part of the guard nothing checks. A refusal
 * that forgets to name the build command is the false red restated, not fixed.
 *
 * ── Why the mechanism is a PARAMETER, and why that is pinned here ─────────
 *
 * Until #12539 the guard lived as three byte-identical private copies, each
 * carrying `"This file spawns bin/run.js with NODE_ENV unset…"` inline. That
 * sentence is true of the `bin/run.js` + unset-`NODE_ENV` spawn and of nothing
 * else: a `bin/run-dev.js` + tsx child reads `src/`, and a hoisted copy
 * carrying the text outward would be a FALSE EXPLANATION attached to a true
 * refusal — the class #12498 and #12561 were filed for. So the reason is the
 * caller's to supply, and `it('carries the caller's mechanism…')` below is what
 * keeps it that way: it passes a foreign mechanism and demands the `bin/run.js`
 * sentence be absent.
 *
 * ⚠️ `helpers/serve-process.ts` is a TEST helper, so `check:cross-package-test-
 * inputs` and the source-alias gate both already see it; nothing here reads
 * outside `packages/cli`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUN_JS_RESOLVES_FROM_DIST,
  requireBuiltCli,
  unbuiltCliError,
} from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');

/** A mechanism belonging to some OTHER entrypoint — the misuse the guard must not commit. */
const FOREIGN_MECHANISM = 'This file execs the packed tarball, which has no src/ to fall back to.';

describe('#12539: the unbuilt-CLI refusal is legible', () => {
  it('names the build command, so the reader knows what to run', () => {
    const message = unbuiltCliError('/repo/packages/cli/dist/commands/serve.js', RUN_JS_RESOLVES_FROM_DIST).message;
    // The whole point of the card. A refusal that stops at "not built" costs
    // the reader the same round the false red did.
    expect(message).toContain('Run: pnpm exec turbo run build --filter=@objectstack/cli');
  });

  it('names the artifact it looked for, not just the package', () => {
    const message = unbuiltCliError('/repo/packages/cli/dist/commands/serve.js', RUN_JS_RESOLVES_FROM_DIST).message;
    expect(message).toContain('/repo/packages/cli/dist/commands/serve.js');
    expect(message).toContain('packages/cli is not built');
  });

  it('says why CI never sees this, so a green CI is not read as a contradiction', () => {
    const message = unbuiltCliError('/x/serve.js', RUN_JS_RESOLVES_FROM_DIST).message;
    expect(message).toContain('@objectstack/cli#test dependsOn build');
    expect(message).toContain('a direct vitest run does not');
  });

  // ── The instrument can say no ──────────────────────────────────────────
  it("carries the CALLER's mechanism, and no other entrypoint's", () => {
    const message = unbuiltCliError('/x/serve.js', FOREIGN_MECHANISM).message;
    expect(message).toContain(FOREIGN_MECHANISM);
    // ⛔ The load-bearing half. If the `bin/run.js` sentence is ever inlined
    // back into the helper "so callers do not have to pass one", this goes red
    // — which is the only thing standing between a shared refusal and a shared
    // WRONG explanation.
    expect(message).not.toContain('bin/run.js');
    expect(message).not.toContain('transpiling src/');
  });

  it('reproduces, byte for byte, what the three private copies threw before the hoist', () => {
    // #12539 moved this refusal out of three files; it did not reword it. The
    // literal below is the message measured on `09b4f4e4e`, so a rewording has
    // to be a deliberate edit here rather than a side effect of the move.
    expect(unbuiltCliError('/repo/packages/cli/dist/commands/serve.js', RUN_JS_RESOLVES_FROM_DIST).message).toBe(
      'packages/cli is not built: /repo/packages/cli/dist/commands/serve.js does not exist.\n' +
        'This file spawns bin/run.js with NODE_ENV unset, which is what makes oclif resolve the ' +
        'command from dist/ instead of transpiling src/ — so on an unbuilt tree the child answers ' +
        '"command serve not found" and every boot below times out.\n' +
        'CI declares the build (turbo: @objectstack/cli#test dependsOn build); a direct vitest run does not.\n' +
        'Run: pnpm exec turbo run build --filter=@objectstack/cli',
    );
  });
});

describe('#12539: the guard probes the DECLARED command target, and is silent when it is there', () => {
  /**
   * The path the guard must be looking at, derived the same way it derives it —
   * from `oclif.commands.target`, which is where `dist/commands` is decided.
   * Restating `dist/commands` here would pin the guard to a path the CLI is
   * free to move, which is the copy this whole card is about.
   */
  const declared = (): string => {
    const target = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'))?.oclif?.commands?.target;
    expect(typeof target, 'oclif.commands.target is what the guard reads; a bare string breaks it').toBe('string');
    return resolve(PACKAGE_ROOT, String(target).replace(/^\.\//, ''), 'serve.js');
  };

  it('reads the target off the CLI declaration rather than restating it', () => {
    expect(declared().endsWith('serve.js')).toBe(true);
    expect(declared().startsWith(PACKAGE_ROOT)).toBe(true);
  });

  /**
   * ⭐ BOTH directions, decided by the tree this run is actually on — which is
   * why it is one `it()` and not two.
   *
   * On CI, and on any tree where `@objectstack/cli` is built, this asserts the
   * expensive half: the guard is SILENT. A guard that fires on a correctly
   * built tree is strictly worse than the false red it replaces, because then
   * every green in this directory is a coin flip. On an unbuilt tree it asserts
   * the other half — that it fires, and names the artifact it looked for.
   */
  it('is silent when the declared command file exists, and refuses naming it when it does not', () => {
    const commandFile = declared();
    if (existsSync(commandFile)) {
      expect(() => requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST)).not.toThrow();
    } else {
      expect(() => requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST)).toThrow(commandFile);
    }
  });
});
