// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20215), end to end: in a fresh `os init -t app` project, generate
 * every type, and `os validate` exits 0 with each generated item counted.
 *
 * Measured before the fix, on this chain: `os validate` exited 0 printing
 * `UI: 0 Apps` and `Logic: 0 Flows` — the config imported `./src/objects`
 * alone, so nothing else `os g` wrote was ever loaded. Wiring the barrels by
 * hand then surfaced two scaffolds the platform refuses once loaded: the flow
 * (a `record_change` trigger in a stack whose `requires` lacks `triggers`,
 * refused by `defineStack`) and the view (a container `name` that disagreed
 * with its object key, refused by `os serve` at boot).
 *
 * The chain, through the real commands, in the order the docs' workflow uses:
 * the object first, so every scaffold that binds to it (view, action, flow,
 * app) binds to something declared.
 *
 *   os init my-app -t app --no-install
 *   os g object|view|flow|action|dashboard|app|skill order_line [--object order_line]
 *   os validate          → exit 0, every generated item counted
 *   os compile           → the artifact carries every generated item
 *
 * A scaffold that binds metadata (#21325) is generated after what it binds —
 * the object before the flow, the flow before the action — and is handed the
 * object with `--object`: the template declares an object of its own, so with
 * two in the stack which one is bound is the author's to say. Both are read
 * off each generator's `binds`, never written down here.
 *
 * `os validate`'s summary has no row for skills, so the skill is held by the
 * compiled artifact instead: it is the same stack, emitted.
 *
 * Every `os g` must also not print the wiring lines it prints for a scaffold
 * that did not reach the stack — the per-PR guard for that report is
 * `generate-stack-reach.test.ts`, and the template and instruments are
 * `generate-scaffold-wiring.test.ts`.
 *
 * Nightly (`.e2e`): nine cold CLI starts. Projects live under this package's
 * `node_modules`, so a config's `@objectstack/spec` import resolves to the
 * workspace copy without an install. Commands print through `utils/format.ts`,
 * which writes to stdout, so stdout is what is read.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { registeredItemName } from '../src/utils/scaffold-wiring.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold starts, ten of them, sequential. */
const RUN_TIMEOUT_MS = 480_000;

const NS = 'my_app';
const STEM = 'order_line';

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

let root: string;
let project: string;
let init: Run;
const generated: Record<string, Run> = {};
let validate: Run;
let compile: Run;

/**
 * Every type after the ones it binds (#21325): a generator's `binds` keys are
 * the types it needs declared first. Derived, so a generator added later is
 * placed by what it declares.
 */
const ORDER: string[] = (() => {
  const placed: string[] = [];
  const pending = GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type);
  while (pending.length > 0) {
    const next = pending.findIndex((type) =>
      Object.keys(GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type)!.binds)
        .every((key) => key === type || placed.includes(key)));
    if (next < 0) throw new Error(`no generator order satisfies the binds of: ${pending.join(', ')}`);
    placed.push(...pending.splice(next, 1));
  }
  return placed;
})();

/** `os g <type> STEM`, with `--object STEM` for a generator that takes one. */
const argsFor = (type: string): string[] => {
  const target = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type)!;
  return ['g', type, STEM, ...(target.binds.object === 'flag' ? ['--object', STEM] : [])];
};

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-reach-e2e-'));
  init = await runCli(['init', 'my-app', '-t', 'app', '--no-install'], root);
  project = join(root, 'my-app');
  for (const type of ORDER) {
    generated[type] = await runCli(argsFor(type), project);
  }
  validate = await runCli(['validate'], project);
  compile = await runCli(['compile'], project);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#20215] `os init -t app` → `os g` every type → `os validate`', () => {
  it('the project was scaffolded with the namespace this file assumes', () => {
    expect(init.code, init.stdout + init.stderr).toBe(0);
    expect(readFileSync(join(project, 'objectstack.config.ts'), 'utf-8')).toContain(`namespace: '${NS}'`);
  });

  it.each(ORDER)('`os g %s` exits 0 and reports no wiring to add', (type) => {
    const run = generated[type];
    const target = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type)!;
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain(`'${target.itemName(STEM, NS)}'`);
    expect(run.stdout).not.toContain(`import * as ${target.stackKey}`);
  });

  it('`os validate` exits 0 and counts every generated item', () => {
    expect(validate.code, validate.stdout + validate.stderr).toBe(0);
    // The template's own object plus the generated one.
    expect(validate.stdout).toMatch(/Data: 2 Objects/);
    for (const [label, n] of [['Apps', 1], ['Views', 1], ['Dashboards', 1], ['Actions', 1], ['Flows', 1]] as const) {
      expect(validate.stdout, label).toMatch(new RegExp(`\\b${n} ${label}\\b`));
    }
  });

  it('`os compile` carries every generated item into the artifact, the skill included', () => {
    expect(compile.code, compile.stdout + compile.stderr).toBe(0);
    const artifact = JSON.parse(readFileSync(join(project, 'dist', 'objectstack.json'), 'utf-8')) as Record<string, unknown>;
    for (const target of GENERATOR_SCAFFOLD_TARGETS) {
      // The key each item is registered under: its `name`, or a views
      // container's object (it writes no `name`, #21325).
      const names = ((artifact[target.stackKey] ?? []) as unknown[]).map((i) => registeredItemName(target.stackKey, i));
      expect(names, target.stackKey).toContain(target.itemName(STEM, NS));
    }
  });
});
