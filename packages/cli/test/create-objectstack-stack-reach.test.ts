// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20333) — `npm create objectstack` → `os g flow` → `os validate`
 * counts the flow, with `os g object` as the control.
 *
 * ## What was measured before the fix
 *
 * On `origin/main` `c74de10a9`, a project scaffolded by the on-ramp's real
 * `bin/` entry, then `os g object order_line` and `os g flow order_line`:
 *
 *   os g object   exit 0, "Reaches the stack"   (objects was always wired)
 *   os g flow     exit 0, "Not wired: … is not part of the stack"
 *   os validate   exit 0, `Data: 2 Objects` and `Logic: 0 Flows`
 *
 * The blank starter's config imported `./src/objects` alone, so the flow was
 * written and never loaded. The control is what makes the red readable: the
 * same chain counted the generated object, so a 0 for the flow is the wiring
 * and not a harness that counts nothing.
 *
 * ## The chain, through the real commands
 *
 *   node create-objectstack/bin/create-objectstack.js my-app --skip-install --skip-skills
 *   os g object order_line     → exit 0, reaches the stack
 *   os g flow order_line --object order_line
 *                              → exit 0, reaches the stack, no wiring lines to add
 *
 * `--object` because the starter declares an object of its own: with two in
 * the stack, which one a flow binds is the author's to say (#21325).
 *   os validate                → exit 0, `Data: 2 Objects`, `Logic: 1 Flows`
 *
 * Asserted: exit statuses, the named subjects, the absence of the wiring
 * lines `os g` prints for a scaffold that did not arrive (code an author
 * pastes), and the counts `os validate` prints. Prose is not pinned. The item
 * names are read off the generator roster, not written down.
 *
 * ## Why here, why a child process, and why this file is NOT named `.e2e`
 *
 * `os g` and `os validate` are this package's commands, and it already
 * depends on `create-objectstack`, so `@objectstack/cli#test`'s `^build`
 * builds the on-ramp's `dist/` — the tree its `bin/` copies from. The bin and
 * the blank template are declared cross-package inputs of this package
 * (scripts/cross-package-test-inputs.mjs, mirrored into turbo.json).
 *
 * The project lives under this package's `node_modules`, so the scaffolded
 * config's imports resolve to workspace copies without an install. Besides
 * `@objectstack/spec`, the blank config imports three connector packages;
 * they are this package's devDependencies for that reason alone, which is
 * also what puts them in this suite's build closure.
 *
 * An exit status is the contract, and `process.exit` inside a vitest worker
 * is not one, so the commands are spawned (the `integration` project). The
 * name keeps it in the per-PR run. The structural half — the blank config
 * wires exactly what `os init` wires — is `create-objectstack-wiring-parity.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

// One `resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs this read by SOURCE SCAN.
const ON_RAMP_BIN = resolve(HERE, '../../..', 'packages/create-objectstack/bin/create-objectstack.js');

/** One plain-node scaffold, then three oclif + tsx cold starts, sequential. */
const RUN_TIMEOUT_MS = 240_000;

const PROJECT = 'my-app';
const NS = 'my_app';
const STEM = 'order_line';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(file: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; a signalled child has none and
          // is reported as 1, never as 0.
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

const os = (args: string[], cwd: string) => run(TSX, [CLI, ...args], cwd);
const out = (r: Run) => r.stdout + r.stderr;

const target = (type: string) => {
  const t = GENERATOR_SCAFFOLD_TARGETS.find((g) => g.type === type);
  if (!t) throw new Error(`no '${type}' generator in the roster`);
  return t;
};
const OBJECT = target('object');
const FLOW = target('flow');

let root: string;
let project: string;
let scaffold: Run;
let genObject: Run;
let genFlow: Run;
let validate: Run;

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.create-objectstack-reach-'));
  project = join(root, PROJECT);
  scaffold = await run(process.execPath, [ON_RAMP_BIN, PROJECT, '--skip-install', '--skip-skills'], root);
  // Sequential on purpose: the object first, so the flow binds to something
  // declared, and cold starts in a container several agents share.
  genObject = await os(['g', 'object', STEM], project);
  genFlow = await os(['g', 'flow', STEM, '--object', STEM], project);
  validate = await os(['validate'], project);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#20333] `npm create objectstack` → `os g flow` → `os validate`', () => {
  it('the on-ramp scaffolded the project, under the namespace this file assumes', () => {
    expect(scaffold.code, out(scaffold)).toBe(0);
    expect(readFileSync(join(project, 'objectstack.config.ts'), 'utf-8')).toContain(`namespace: '${NS}'`);
  });

  it('CONTROL: `os g object` reaches the stack', () => {
    expect(genObject.code, out(genObject)).toBe(0);
    expect(genObject.stdout).toContain(`'${OBJECT.itemName(STEM, NS)}'`);
    expect(genObject.stdout).not.toContain(`import * as ${OBJECT.stackKey}`);
  });

  it('`os g flow` reaches the stack, with no wiring lines to add', () => {
    expect(genFlow.code, out(genFlow)).toBe(0);
    expect(genFlow.stdout).toContain(`'${FLOW.itemName(STEM, NS)}'`);
    expect(genFlow.stdout).not.toContain(`import * as ${FLOW.stackKey}`);
    // Nor a `requires` line: the starter already declares what a flow runs on.
    expect(genFlow.stdout).not.toContain('requires: [');
  });

  it('`os validate` exits 0 and counts the generated flow beside the control', () => {
    expect(validate.code, out(validate)).toBe(0);
    // The starter's own object plus the generated one.
    expect(validate.stdout).toMatch(/\bData: 2 Objects\b/);
    expect(validate.stdout).toMatch(/\bLogic: 1 Flows\b/);
  });
});
