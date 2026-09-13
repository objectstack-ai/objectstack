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
 */
function runPublishedEntry(
  env: Record<string, string | undefined>,
  options: { neutralise?: boolean } = {},
) {
  const result = spawnSync(
    process.execPath,
    [...(options.neutralise ? [`--import=${NEUTRALISER}`] : []), PUBLISHED_ENTRY, '--version'],
    {
      cwd: fixtureCwd,
      encoding: 'utf8',
      timeout: 120_000,
      env: childEnv({ TSX_TSCONFIG_PATH: undefined, ...env }),
    },
  );
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('#12271 - the published entry does not reroute to src/ on an ambient NODE_ENV', () => {
  it('resolves commands from dist/ under an ambient NODE_ENV=development', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'development' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(output).not.toContain(SOURCE_COMMANDS);
    expect(status).toBe(0);
  });

  it('resolves commands from dist/ under an ambient NODE_ENV=test', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'test' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(output).not.toContain(SOURCE_COMMANDS);
    expect(status).toBe(0);
  });

  it('NODE_ENV=production stays green, the leg that was never broken', () => {
    const { status, output } = runPublishedEntry({ NODE_ENV: 'production' });
    expect(output).not.toContain(CARD_SIGNATURE);
    expect(status).toBe(0);
  });

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
  });

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
  });
});
