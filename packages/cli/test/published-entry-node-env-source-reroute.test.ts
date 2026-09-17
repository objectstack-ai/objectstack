// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12271 — the PUBLISHED entry resolves its commands from `dist/`, whatever an
 * ambient `NODE_ENV` says.
 *
 * ## The defect
 *
 * `@oclif/core@4.13.3`'s `lib/config/ts-path.js` skips its TypeScript path
 * lookup only when `isProd()`, which `lib/util/util.js` defines as a negated
 * `['development', 'test'].includes(process.env.NODE_ENV ?? '')`. So an ambient
 * `NODE_ENV=development` — exported by a developer, or inherited by any child
 * `os dev` / `os start` spawns — made `bin/run.js` resolve the CLI's OWN
 * commands from `src/commands` and register tsx on the way. tsx honours the
 * tsconfig of the CURRENT WORKING DIRECTORY, so an application whose tsconfig
 * redirects a CommonJS package to its TypeScript source for TYPE resolution
 * then steered this CLI's runtime module graph into `.ts` files, after which
 * Node's CJS resolver walked their extensionless siblings and knew nothing
 * about `.ts`:
 *
 *     [MODULE_NOT_FOUND] import() failed to load …/packages/cli/src/commands/doctor.ts:
 *     Cannot find module './registry'
 *
 * ⭐ Note which file failed to LOAD — one of this CLI's own command modules.
 * The casualty is the command table, not the user's config, which is why the
 * failure was not specific to any command and why ⛔ no amount of scrubbing a
 * CHILD's environment could reach it: `os serve --dev` and `os start` are
 * top-level processes with no parent to scrub. Measured at `examples/app-crm`
 * before the fix, `NODE_ENV` the only variable: `os compile`,
 * `os dev --compile --fresh`, `os serve --dev` and `os start` each exit 1 on
 * that signature under `development`, and each compile/boot cleanly under
 * `production`.
 *
 * The fix is one line in `bin/run.js` — `settings.enableAutoTranspile = false`
 * — and its docblock carries the argument for why that, and not a
 * `TSX_TSCONFIG_PATH` pin or a child-env scrub. This file holds the behaviour.
 *
 * ## ⛔ Why the fixture is built here and not pointed at an example app
 *
 * `examples/app-crm` is where the defect was measured, and pointing at it would
 * make this suite read a second package — a cross-package test input, which has
 * to be declared in `scripts/cross-package-test-inputs.mjs` AND mirrored into
 * `turbo.json`, widening this package's test cache key over another package's
 * whole source tree. It would also make the pin depend on that app keeping a
 * `paths` block it maintains for its own reasons.
 *
 * So the trap is built here instead, and it is the SAME trap rather than an
 * analogue: a CommonJS module whose relative `require` has no extension, mapped
 * over a specifier every command module imports. It reproduces the card's
 * verbatim signature (asserted below), and it reads nothing outside this
 * package and its own temp directory.
 *
 * ⚠️ The trap has to be CommonJS with an EXTENSIONLESS relative require, and
 * that is a measured constraint rather than a stylistic choice — the first
 * fixture attempted here mapped the specifier onto an ESM `.ts` source inside
 * this package and stayed green in all six legs, because the failure needs
 * Node's CJS resolver walking a `.ts` file's siblings. A fixture that arms
 * nothing is the exact vacuity the control below exists to refuse.
 *
 * ## The legs
 *
 * Two independent variables, and both are needed:
 *
 *   • `NODE_ENV` — `development` and `test` are the two values oclif treats as
 *     non-production; `production` is the CONTROL that was green before the fix
 *     too, so on its own it proves nothing. It is here to show that the fixture
 *     is not simply inert.
 *   • the DECLARATION — present (the tree as shipped) or neutralised in the
 *     child by `fixtures/published-entry-auto-transpile-neutraliser.mjs`. That
 *     is the control that must FIRE: without it every assertion in this file is
 *     an absence, and an absence passes over a fixture that arms nothing.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { childEnv } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The BUILT entry — the file `bin.objectstack` / `bin.os` names and npm packs. */
const PUBLISHED_ENTRY = resolve(HERE, '../bin/run.js');

/** The control preload. See its own header for why it is an accessor pair. */
const NEUTRALISER = resolve(HERE, 'fixtures/published-entry-auto-transpile-neutraliser.mjs');

/**
 * The ONE bound on a leg of this file, and the reason it is stated once (#18590).
 *
 * ## The defect this closes
 *
 * Every leg here boots a real, cold Node process running the published oclif
 * entry and waits for it synchronously. Measured on an idle box, lock held,
 * with the budget lifted so the numbers are costs and not verdicts:
 *
 *     NODE_ENV=development            3000ms
 *     NODE_ENV=test                   2526ms
 *     NODE_ENV=production             2742ms
 *     CONTROL neutralised (dev)       3599ms
 *     CONTROL neutralised (prod)      2467ms
 *
 * The `spawnSync` below already declares this file's real bound — 120s, chosen,
 * and the same number the other spawning suites in this directory pin. But no
 * leg named a vitest budget, so every one of them was ALSO measured against
 * vitest's 5000ms DEFAULT, which nobody here chose. Against costs of 2.5-3.6s
 * that is a margin thinner than the run-to-run variance on an idle machine, so
 * WHICH leg reddens is decided by how busy the box is and by nothing this file
 * tests. Both halves of that were measured: in `Rerun Safety` (the workflow
 * that deliberately runs the whole suite twice on one runner) the three
 * non-neutralised legs timed out while both CONTROL legs passed; locally, on a
 * quiet box, the opposite happened — the neutralised CONTROL leg took 5710ms
 * and was the only one to fail. Same file, same commit, disjoint casualties.
 *
 * ## ⛔ Why this is not "raise the timeout until it passes"
 *
 * That move hides a real failure, and this one cannot, because it raises no
 * bound at all. The child is still killed by `spawnSync` at exactly the same
 * 120s it was before; what is removed is a SECOND, lower, unchosen bound that
 * was shadowing the chosen one. A leg that genuinely hangs still dies at 120s —
 * and now says so, see `runPublishedEntry`. Nor can a slow leg pass silently:
 * vitest prints each leg's duration, and the numbers above are the record to
 * compare against.
 *
 * ⛔ And it must not be tuned DOWN to "catch a slowdown". The 5000ms budget
 * proved exactly what a too-tight budget proves: nothing about the code, and a
 * red whose casualty list is a function of the runner's load.
 */
const CHILD_BUDGET_MS = 120_000;

/**
 * The card's verbatim signature. Asserted as text rather than as an exit code
 * alone because an exit code says only THAT the run failed — this says the run
 * failed for the reason the card names.
 */
const CARD_SIGNATURE = "Cannot find module './registry'";

/**
 * The reroute itself, visible in oclif's own warning block: it names the module
 * it failed to load, and under the reroute that path is under `src/commands`.
 */
const SOURCE_COMMANDS = join('packages', 'cli', 'src', 'commands');

let fixtureCwd: string;

beforeAll(() => {
  fixtureCwd = mkdtempSync(join(tmpdir(), 'os-12271-'));
  mkdirSync(join(fixtureCwd, 'trap'));
  // The CJS half: an extensionless relative require whose target the CJS
  // resolver cannot see, because the sibling on disk is a `.ts` file.
  writeFileSync(join(fixtureCwd, 'trap', 'index.ts'), "module.exports = require('./registry');\n");
  writeFileSync(join(fixtureCwd, 'trap', 'registry.ts'), 'module.exports = {};\n');
  // The `paths` half: a TYPE-resolution directive over a specifier every
  // command module imports. `chalk` is the carrier rather than a workspace
  // package for the cross-package reason in the header — what matters is that
  // the redirect is reachable from this CLI's own command modules.
  writeFileSync(
    join(fixtureCwd, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { chalk: ['./trap/index.ts'] } } }, null, 2)}\n`,
  );
});

afterAll(() => {
  if (fixtureCwd) rmSync(fixtureCwd, { recursive: true, force: true });
});

/**
 * Run the published entry from the armed fixture directory.
 *
 * `--version` is the probe on purpose: it is the cheapest invocation that still
 * makes oclif build its command table, which is where the reroute happens.
 * Measured — every command tried (`--version`, `doctor --help`, `compile
 * --help`) reproduces identically, so the cheapest one is the honest one.
 *
 * ⚠️ `TSX_TSCONFIG_PATH` is cleared explicitly. It is what `bin/run-dev.js`
 * sets to pin tsx away from the CWD's tsconfig, and a developer running the
 * suite under that shim would otherwise inherit the very mitigation this file
 * is measuring the absence of.
 *
 * ## The reading that tells a HUNG child from a SLOW one (#18590)
 *
 * Under the 5000ms default both arrived as the same line — `Error: Test timed
 * out in 5000ms`, attributed to the `it()` and naming nothing about the child,
 * its environment or how long it actually ran. That is why ten nights of this
 * file's red could be read as anything at all.
 *
 * `spawnSync` distinguishes them and always did: a child killed by its own
 * `timeout` comes back with `error.code === 'ETIMEDOUT'` and `signal ===
 * 'SIGTERM'`, where a slow-but-correct child comes back with a status. So the
 * hung case is now raised BY NAME, with the env and the elapsed time in the
 * message, and the slow case stays a pass whose duration vitest prints. ⛔ Do
 * not fold this back into a bare timeout: the two outcomes needing to be told
 * apart is the whole reason this file went unread for seventeen nights.
 */
function runPublishedEntry(
  env: Record<string, string | undefined>,
  options: { neutralise?: boolean } = {},
) {
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [...(options.neutralise ? [`--import=${NEUTRALISER}`] : []), PUBLISHED_ENTRY, '--version'],
    {
      cwd: fixtureCwd,
      encoding: 'utf8',
      timeout: CHILD_BUDGET_MS,
      env: childEnv({ TSX_TSCONFIG_PATH: undefined, ...env }),
    },
  );
  const elapsedMs = Date.now() - startedAt;

  const killedByOwnBound =
    (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' ||
    result.signal === 'SIGTERM';
  if (killedByOwnBound) {
    throw new Error(
      `The published entry did not exit within its own ${CHILD_BUDGET_MS}ms bound and was killed ` +
        `(signal=${result.signal ?? 'none'}, code=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? 'none'}, ` +
        `elapsed=${elapsedMs}ms, neutralised=${options.neutralise === true}, env=${JSON.stringify(env)}). ` +
        'This is a HUNG child, not a slow one — a slow child passes and vitest prints its duration. ' +
        'Do not respond by raising a budget: read what the entry is waiting on.',
    );
  }

  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('#12271 - the published entry does not reroute to src/ on an ambient NODE_ENV', () => {
  it('resolves commands from dist/ under an ambient NODE_ENV=development', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'development' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(output).not.toContain(SOURCE_COMMANDS);
    expect(status).toBe(0);
  }, CHILD_BUDGET_MS);

  it('resolves commands from dist/ under an ambient NODE_ENV=test', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'test' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(output).not.toContain(SOURCE_COMMANDS);
    expect(status).toBe(0);
  }, CHILD_BUDGET_MS);

  it('NODE_ENV=production stays green, the leg that was never broken', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'production' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(status).toBe(0);
  }, CHILD_BUDGET_MS);

  /**
   * THE CONTROL. If this ever goes green the three assertions above have
   * stopped measuring anything, and the correct response is to repair the
   * fixture - never to delete this case because "the bug is fixed".
   */
  it('CONTROL: neutralising the declaration in the child reproduces the card verbatim', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'development' }, { neutralise: true });
    expect(output).toContain(CARD_SIGNATURE);
    expect(output).toContain(SOURCE_COMMANDS);
    expect(status).not.toBe(0);
  }, CHILD_BUDGET_MS);

  /**
   * The second half of the control: with the declaration neutralised, the only
   * thing still standing between the fixture and the failure is `NODE_ENV`. So
   * this pins that the variable really is the variable - `isProd()` and nothing
   * else in the fixture is what makes the difference.
   */
  it('CONTROL: neutralised under NODE_ENV=production, the same fixture is green', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'production' }, { neutralise: true });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(status).toBe(0);
  }, CHILD_BUDGET_MS);
});
