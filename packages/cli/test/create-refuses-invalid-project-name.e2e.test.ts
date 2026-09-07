// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os create` refuses a project name npm refuses, BEFORE it writes.
 *
 * ## The defect
 *
 * Measured on `origin/main` e75a9040b02, driving the published entry:
 *
 * ```
 * $ os create plugin "My App"
 * exit 0 — wrote ./plugin-My App/, manifest name "@objectstack/plugin-My App"
 * $ os init "My App"
 * exit 2 — "Project name must be lowercase", wrote NOTHING
 * ```
 *
 * Both spellings are npm-invalid. One scaffolder refused before touching the
 * disk; the other emitted a directory and an unpublishable manifest with every
 * gate green, so the failure was deferred to `npm publish` in the terminal of
 * whoever ran it next.
 *
 * ## Why the refusal, and not just the message, is what is asserted
 *
 * `os init` refuses BEFORE the first write. A repair that refuses AFTER
 * `mkdirSync` has fixed the message and not the defect — the invalid directory
 * still lands. So every refusal case here asserts the directory is ABSENT, and
 * `accepts a valid name` is the positive control for that predicate: it runs
 * the same `scaffoldDir()` check against the same shape of temp directory and
 * finds the directory PRESENT. An absence assertion whose predicate cannot
 * fail is not evidence.
 *
 * ## Why the two commands do NOT refuse identically
 *
 * `os init`'s argument IS the package name. `os create`'s argument is composed
 * into a SCOPED one (`@objectstack/plugin-<name>`), and npm's 214-character
 * ceiling counts the scope — so a name that is legal for `init` can compose to
 * one npm refuses. `refuses a name only the composed length catches` pins that
 * asymmetry from both ends: the shared validator passes the name (asserted
 * directly), `create` refuses it, and `init` still accepts it. ⛔ Moving that
 * length rule into the shared validator would break `init` for a name npm
 * accepts; this test is what says so.
 *
 * Spawned through `bin/run-dev.js` + tsx, so the suite does not depend on
 * `packages/cli/dist` having been built — `@objectstack/cli#test` depends on
 * `^build` only (the reason `invocation-loudness.e2e.test.ts` spawns that way).
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import {
  emittedPackageName,
  templates,
  validateEmittedPackageName,
  DEFAULT_PLACEMENT,
  type ScaffoldPlacement,
} from '../src/commands/create.js';
import { NPM_PACKAGE_NAME_MAX_LENGTH, validateProjectName } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

/** The card's input: a capital and a space, both npm-invalid. */
const INVALID_NAME = 'My App';
const VALID_NAME = 'my-app';

/**
 * A name the SHARED validator accepts and the composed one cannot: exactly at
 * `init`'s ceiling, so `@objectstack/plugin-` pushes it past the same ceiling.
 * Derived from the constant rather than written as a number, so a change to the
 * limit moves this case with it.
 */
const COMPOSED_TOO_LONG = 'a'.repeat(NPM_PACKAGE_NAME_MAX_LENGTH);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** A fresh empty directory to scaffold into, removed by the caller. */
function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'os-create-name-'));
}

/** The path `os create plugin <name>` writes, present or not. */
function scaffoldDir(cwd: string, name: string): string {
  return join(cwd, templates.plugin.dirName(name));
}

describe('os create: a name npm refuses is refused before anything is written', () => {
  it(
    'refuses the card\'s input and writes NOTHING',
    async () => {
      const cwd = workspace();
      try {
        const run = await runCli(['create', 'plugin', INVALID_NAME], cwd);

        expect(run.code).not.toBe(0);
        // The message is the SHARED validator's own return value, not a second
        // copy of it written here — that identity is what stops the two
        // scaffolders drifting apart again.
        expect(validateProjectName(INVALID_NAME)).not.toBeNull();
        expect(run.stderr).toContain(validateProjectName(INVALID_NAME)!);

        // The load-bearing half: refused BEFORE the first write.
        expect(existsSync(scaffoldDir(cwd, INVALID_NAME))).toBe(false);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'accepts a valid name — the positive control for the absence check above',
    async () => {
      const cwd = workspace();
      try {
        const run = await runCli(['create', 'plugin', VALID_NAME], cwd);

        expect(run.code).toBe(0);
        // Same predicate, same shape of directory, opposite verdict: the
        // absence assertion above is capable of failing.
        expect(existsSync(scaffoldDir(cwd, VALID_NAME))).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'refuses a name only the COMPOSED length catches, which `os init` must keep accepting',
    async () => {
      const createCwd = workspace();
      const initCwd = workspace();
      try {
        // The shared validator passes it — so whatever refuses it below is the
        // composed-name rule and nothing else.
        expect(validateProjectName(COMPOSED_TOO_LONG)).toBeNull();

        const created = await runCli(['create', 'plugin', COMPOSED_TOO_LONG], createCwd);
        expect(created.code).not.toBe(0);
        expect(created.stderr).toContain(String(NPM_PACKAGE_NAME_MAX_LENGTH));
        expect(existsSync(scaffoldDir(createCwd, COMPOSED_TOO_LONG))).toBe(false);

        // ⛔ The asymmetry is correct, not a second defect: `init`'s argument is
        // the package name, so npm's ceiling is already measured against it.
        const inited = await runCli(['init', COMPOSED_TOO_LONG], initCwd);
        expect(inited.code).toBe(0);
      } finally {
        rmSync(createCwd, { recursive: true, force: true });
        rmSync(initCwd, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT_MS,
  );
});

describe('os create: the composed package name is judged for every template', () => {
  const PLACEMENTS: ScaffoldPlacement[] = ['standalone', 'in-repo'];

  // Derived from the template map, never a list of `plugin` and `example`: a
  // third template must arrive already covered.
  for (const key of Object.keys(templates)) {
    for (const placement of PLACEMENTS) {
      it(`${key} / ${placement}: the emitted name is readable and judged`, () => {
        const emitted = emittedPackageName(templates[key], placement, VALID_NAME);
        expect(typeof emitted).toBe('string');
        expect(emitted).toContain(VALID_NAME);
        expect(validateEmittedPackageName(emitted!)).toBeNull();

        const overlong = emittedPackageName(templates[key], placement, COMPOSED_TOO_LONG);
        expect(overlong!.length).toBeGreaterThan(NPM_PACKAGE_NAME_MAX_LENGTH);
        expect(validateEmittedPackageName(overlong!)).toContain(
          String(NPM_PACKAGE_NAME_MAX_LENGTH),
        );
      });
    }
  }

  it('reads the name off the DEFAULT placement the same way the command does', () => {
    const emitted = emittedPackageName(templates.plugin, DEFAULT_PLACEMENT, VALID_NAME);
    expect(emitted).toBe(`@objectstack/plugin-${VALID_NAME}`);
  });
});
