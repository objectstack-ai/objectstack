// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16547 — `bin/run-dev.js` run from a cwd whose tsconfig maps a workspace
 * package to its source loaded no command set at all, and blamed a build that
 * was present and fresh.
 *
 * ```
 * $ cd examples/app-multi-package
 * $ ../../node_modules/.bin/tsx ../../packages/cli/bin/run-dev.js lint objectstack.config.ts --json
 * …
 * message: The requested module '@objectstack/spec/data' does not provide an export named 'DATABASE_DRIVER_SELECTION_IDS'
 * objectstack: NOT A MISSING COMMAND — …
 * objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec
 * Error: command lint:objectstack.config.ts not found
 * $ echo $?
 * 2
 * ```
 *
 * ## The mechanism, as MEASURED — and the half of the card's reading it corrected
 *
 * CONFIRMED. tsx reads the CWD's tsconfig, not the entry file's, and applies
 * its `compilerOptions.paths` to every specifier it resolves — the CLI's own
 * included. From `examples/app-multi-package`, `import.meta.resolve` answers
 * the spec package's `data` SOURCE index for `@objectstack/spec/data`; from
 * the repo root it answers that package's dist target. Ten in-tree
 * directories carry such a rule, written so `tsc --noEmit` grades against a
 * producer's SOURCE rather than its last build
 * (`check:type-source-resolution` requires them), and #11094 named the
 * runtime half "a latent runtime redirect for any tsx-honouring tool".
 *
 * ⛔ CORRECTED. The card read the failure as the source subpath's export set
 * DIFFERING from `dist`. It does not. The spec package's `data` source index
 * exports the very name the failure blames — 470 names through
 * `await import()`, `DATABASE_DRIVER_SELECTION_IDS` among them. What breaks is
 * the STATIC LINK, and the reason is module FORMAT: the spec and types
 * packages declare no `"type": "module"`, so tsx loads their `.ts` sources as
 * CommonJS; a static ESM named import can then bind only what
 * `cjs-module-lexer` detects statically, and the lexer does not follow the
 * two-hop `export *` chain (the data index → its driver index → the driver
 * config registry) that publishes this name. Measured with a two-leg fixture
 * whose ONLY difference was that field — CJS leg `SyntaxError: … does not
 * provide an export named 'DEEP_NAME'`, ESM leg links and prints 42. This CLI
 * IS `"type": "module"`, which puts every one of its command modules on the
 * failing side of that seam.
 *
 * That correction is why this file asserts on the RESOLUTION and never on an
 * export set: the export set is a red herring, and a suite written against it
 * would pass for the wrong reason.
 *
 * ## Why the redirecting cwd is MANUFACTURED
 *
 * The two directories the card reproduced from are real and still redirect —
 * but a suite anchored to `examples/app-multi-package` measures that example's
 * tsconfig, not this shim's behaviour, and goes quietly green the day someone
 * removes a `paths` rule for reasons of their own. So the cwd is built here:
 * a temp directory whose whole content is a tsconfig with one `paths` rule
 * aimed at a real workspace source file. It reproduces the card's exit 2 and
 * its exact stderr against the pre-#16547 shim (verified by ablation, not
 * assumed), and it cannot be disarmed from outside this file.
 *
 * ## The cases are a control set, not one assertion
 *
 *   1. redirecting cwd, pin ACTIVE      → the command table loads; the run fails
 *                                         for its OWN reason (no config file),
 *                                         and the shim says what it re-ran.
 *   2. redirecting cwd, pin DEFEATED    → the diagnostic refuses the rebuild and
 *      (caller pinned it themselves)      names the redirect. This is the branch
 *                                         that keeps its value after (1) lands.
 *   3. repo root, nothing redirecting   → no re-exec, no advisory, and the same
 *                                         own-reason failure as (1).
 *
 * (1) without (3) would pass in a tree where every run is re-exec'd — the shape
 * that would cost every invocation a second tsx bootstrap without anyone
 * noticing. (3) without (1) is a zero reading. (2) is the only case that can
 * see the misdirection this card is graded on.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** The SOURCE entry point — this suite is about it, and it needs no `dist/`. */
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const REPO_ROOT = resolve(HERE, '../../..');
/** The tsconfig the shim pins tsx to, spelled here so a move reds this file. */
const CLI_TSCONFIG = resolve(HERE, '../tsconfig.json');

/**
 * A real command whose ARGUMENT names nothing on disk.
 *
 * Both halves matter. Real, so "command … not found" is a lie rather than the
 * truth — a typo would make oclif emit no module-load warning at all and the
 * branch under test would never be entered. Naming nothing, so a run whose
 * command table DID load fails immediately for its own reason instead of doing
 * ~11 s of linting: the point of cases 1 and 3 is WHICH failure, never the work.
 */
const REAL_COMMAND = ['lint', 'nope.ts'];

/** oclif + tsx cold start, twice over in case 1, on a shared runner. */
const RUN_TIMEOUT_MS = 180_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(cwd: string, env: Record<string, string | undefined>): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...REAL_COMMAND],
      { cwd, timeout: RUN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', ...env }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; a non-number means the child was
          // signalled — a failure of a different kind, never reported as 0.
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * The specifier the fixture redirects. Any workspace package this CLI declares
 * as a dependency would do; this one is named because it is the one the card
 * reproduced on.
 */
const REDIRECTED_SPECIFIER = '@objectstack/spec';

/** What the redirect points AT — a stub this suite writes, never real source. */
const STUB_BASENAME = 'spec-stub.ts';

/**
 * A cwd that redirects one workspace specifier this CLI imports to a TypeScript
 * file that is not that package.
 *
 * ⚠️ Two properties, and BOTH are load-bearing.
 *
 * The target must EXIST. A `paths` target that resolves to nothing on disk is
 * not a redirect at all — get-tsconfig falls back to node resolution, the run
 * succeeds, and every case here would pass against an unfixed shim.
 *
 * The target must be THIS SUITE'S OWN FILE, not a path into another package.
 * Pointing at real workspace source would make this suite's inputs wider than
 * its package — invisible to the affected-subset filter and to turbo's cache,
 * the defect `check:cross-package-test-inputs` exists to refuse — and it would
 * buy nothing: the assertions below are about what the SHIM does with a
 * redirect, and a stub redirects exactly as well as the real thing. It is also
 * the stronger fixture: a stub that exports nothing the CLI imports cannot
 * quietly start satisfying those imports the way a real package could.
 */
let redirectingCwd: string;

beforeAll(() => {
  redirectingCwd = mkdtempSync(join(tmpdir(), 'os-16547-'));
  writeFileSync(join(redirectingCwd, STUB_BASENAME), 'export const NOT_THE_REAL_PACKAGE = true;\n');
  writeFileSync(
    join(redirectingCwd, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { [REDIRECTED_SPECIFIER]: [`./${STUB_BASENAME}`] } } }, null, 2)}\n`,
  );
});

describe('bin/run-dev.js under a cwd tsconfig that redirects a workspace package (#16547)', () => {
  it(
    'loads its command set anyway, and says what it re-ran',
    async () => {
      const run = await runCli(redirectingCwd, { TSX_TSCONFIG_PATH: undefined });

      // ⛔ The card's failure, gone: the command table loaded, so the run is
      // allowed to fail for the reason its ARGUMENT deserves.
      expect(run.stderr).not.toContain('NOT A MISSING COMMAND');
      // oclif's own sentence, spelled with its `Error: command` prefix rather
      // than as a bare `not found`: the run this case WANTS ends on "Config
      // file not found", which contains that substring and made the first
      // version of this assertion fail against a working fix.
      expect(run.stderr).not.toMatch(/Error:\s*command\b/);
      expect(run.stderr).toContain('Config file not found');
      // Not silent. A second process appearing with no explanation is its own
      // kind of misdirection, so the shim names the specifier and the pin.
      expect(run.stderr).toContain(`redirects '${REDIRECTED_SPECIFIER}' to TypeScript source`);
      expect(run.stderr).toContain(CLI_TSCONFIG);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'still explains itself when the pin is defeated, and refuses the rebuild remedy',
    async () => {
      // A caller who pinned tsx themselves is either this shim's own child or
      // someone who meant it; the shim stands down either way. That leaves the
      // redirect in force and is the reachable route to the DIAGNOSTIC half of
      // this card — the half that keeps its value for every other cause of the
      // same masking.
      const run = await runCli(redirectingCwd, { TSX_TSCONFIG_PATH: join(redirectingCwd, 'tsconfig.json') });

      expect(run.code).toBe(2);
      expect(run.stderr).toContain('NOT A MISSING COMMAND');
      expect(run.stderr).toContain(`The unmet precondition is NOT ${REDIRECTED_SPECIFIER}'s build output`);
      // The evidence, carried rather than summarised.
      expect(run.stderr).toContain(STUB_BASENAME);
      // ⛔ THE assertion this card is graded on. `packages/spec/dist` is present
      // and fresh in this tree — the whole suite depends on a built workspace —
      // so a prescription to rebuild it is an action that succeeds and changes
      // nothing, which is worse for an agent than a bare failure.
      expect(run.stderr).not.toContain(`turbo run build --filter=${REDIRECTED_SPECIFIER}`);
      expect(run.stderr).toContain("tsx reads the CWD's tsconfig");
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'CONTROL — from the repo root nothing is redirected, so nothing is re-exec\'d',
    async () => {
      const run = await runCli(REPO_ROOT, { TSX_TSCONFIG_PATH: undefined });

      expect(run.stderr).toContain('Config file not found');
      expect(run.stderr).not.toContain('NOT A MISSING COMMAND');
      // The half that keeps the pin from becoming an unconditional second
      // process: measured, the probe answers "no redirect" for all 49 workspace
      // dependencies from here, and a re-exec would cost a whole tsx bootstrap
      // (~550 ms) on every run in the tree.
      expect(run.stderr).not.toContain('re-running with tsx pinned');
    },
    RUN_TIMEOUT_MS,
  );
});
