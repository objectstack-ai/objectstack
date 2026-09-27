// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20197) — the two refusals the namespace prefix added to
 * `os generate`, in the run that gates the merge queue.
 *
 * `os g` gives an object name the project's `manifest.namespace` prefix. That
 * brought two new ways for the command to refuse, both in
 * `runMetadataGeneration`, both before anything is rendered or written:
 *
 *   1. RESIDUAL — a name the namespace-prefix gate refuses even after the
 *      prefix is applied. Prefixing answers only a MISSING prefix; the legacy
 *      `NS__SHORT` form (`order__line`) is still refused by
 *      `validateObjectNamespacePrefix` as `my_app_order__line`. The command
 *      refuses it in the gate's own words instead of writing a file
 *      `os validate` would refuse.
 *   2. LOAD-FAILED — the project has a config and it does not load, so its
 *      namespace is UNKNOWN. Reading that as "no namespace" would write the
 *      unprefixed name this card exists to stop, so a generator that names an
 *      object refuses and writes nothing.
 *
 * Each refusal is held to three facts: exit 1, no scaffold written, and the
 * barrel `index.ts` byte-identical to what it was. Two controls keep the
 * refusals from being satisfied by a command that refuses everything: in the
 * SAME namespaced project `os g object order_line` generates, prefixed; and in
 * the SAME broken project `os g dashboard sales` generates, because a
 * dashboard names no object and never reads the config.
 *
 * The residual refusal's rule is compared against what
 * `validateObjectNamespacePrefix` itself says about the prefixed name, so the
 * command cannot drift to a wording of its own. The same shape as the charset
 * pin beside this file, which compares against the schema's message.
 *
 * ## Why a child process, and why this file is NOT named `.e2e`
 *
 * The same reasons `generate-refuses-name-outside-charset.test.ts` gives: an
 * exit code plus bytes on disk are the contract, `process.exitCode` inside a
 * vitest worker is not an exit status, and `printError` writes to stdout.
 * Spawning puts the file in the `integration` project; the name keeps it in
 * the per-PR run. `generate-object-namespace-prefix.e2e.test.ts` measures the
 * whole `os init` → `os g` → `os validate` chain nightly. This file is the
 * per-PR guard for the two branches.
 *
 * Projects live under this package's `node_modules` so each config's
 * `@objectstack/spec` import resolves to the workspace copy without an
 * install. The object files in them are written by the object generator's own
 * template, so the broken project holds exactly what `os g object` wrote
 * before the prefix existed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold starts, five of them, sequential. */
const RUN_TIMEOUT_MS = 240_000;

const NS = 'my_app';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
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

const objectTemplate = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'object');

/**
 * A project with one object, `objectstack.config.ts` importing the
 * `src/objects` barrel into `defineStack` under `namespace: 'my_app'`.
 *
 * `objectNamespace` is what the object file was generated with: `NS` writes
 * `my_app_<stem>` (a project that loads), `undefined` writes the bare `<stem>`
 * the pre-fix CLI wrote (a project whose config `defineStack` refuses).
 */
function writeProject(dir: string, stem: string, objectNamespace: string | undefined): void {
  mkdirSync(join(dir, 'src', 'objects'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.my-app',
    namespace: '${NS}',
    version: '0.1.0',
    type: 'app',
    name: 'My App',
  },
  objects: Object.values(objects),
});
`,
  );
  writeFileSync(join(dir, 'src', 'objects', `${stem}.object.ts`), objectTemplate!.generate(stem, objectNamespace));
  writeFileSync(join(dir, 'src', 'objects', 'index.ts'), `export { default as ${stem} } from './${stem}.object';\n`);
}

const barrelOf = (dir: string) => readFileSync(join(dir, 'src', 'objects', 'index.ts'), 'utf-8');
const objectFilesIn = (dir: string) => readdirSync(join(dir, 'src', 'objects')).sort();

let root: string;
let namespaced: string;
let broken: string;

let namespacedBarrel: string;
let namespacedFiles: string[];
let brokenBarrel: string;
let brokenFiles: string[];

let residual: Run;
let residualDryRun: Run;
let loadFailed: Run;
let namespacedControl: Run;
let brokenControl: Run;

/** Each project as its refusal left it, read before the controls write anything. */
let residualAfter: { barrel: string; files: string[]; views: boolean };
let loadFailedAfter: { barrel: string; files: string[] };

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-refuses-namespace-'));
  namespaced = join(root, 'namespaced');
  broken = join(root, 'broken');
  writeProject(namespaced, 'item', NS);
  writeProject(broken, 'legacy', undefined);

  namespacedBarrel = barrelOf(namespaced);
  namespacedFiles = objectFilesIn(namespaced);
  brokenBarrel = barrelOf(broken);
  brokenFiles = objectFilesIn(broken);

  // Sequential on purpose: cold tsx starts in a container several agents share.
  // Every refusal runs BEFORE its project's control, so the barrel and file
  // snapshots above are what each refusal was measured against.
  residual = await runTsx([CLI, 'generate', 'object', 'order__line'], namespaced);
  residualDryRun = await runTsx([CLI, 'generate', 'view', 'order__line', '--dry-run'], namespaced);
  loadFailed = await runTsx([CLI, 'generate', 'object', 'customer'], broken);

  residualAfter = {
    barrel: barrelOf(namespaced),
    files: objectFilesIn(namespaced),
    views: existsSync(join(namespaced, 'src', 'views')),
  };
  loadFailedAfter = { barrel: barrelOf(broken), files: objectFilesIn(broken) };

  namespacedControl = await runTsx([CLI, 'generate', 'object', 'order_line'], namespaced);
  brokenControl = await runTsx([CLI, 'generate', 'dashboard', 'sales'], broken);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#20197] a name the namespace-prefix rule refuses even after prefixing', () => {
  it('exits 1', () => {
    expect(residual.code, residual.stdout + residual.stderr).toBe(1);
  });

  it('names the value, and the rule is the gate`s own verdict on the prefixed name', () => {
    const verdict = validateObjectNamespacePrefix(`${NS}_order__line`, NS);
    // Non-null guard: a gate that stopped refusing this shape would make the
    // assertion below vacuous rather than wrong.
    expect(verdict).not.toBeNull();
    expect(residual.stdout).toContain('order__line');
    expect(residual.stdout).toContain(verdict!);
  });

  it('writes nothing: no scaffold, and the barrel is byte-identical', () => {
    expect(residualAfter.files).toEqual(namespacedFiles);
    expect(residualAfter.barrel).toBe(namespacedBarrel);
    expect(residual.stdout).not.toContain('Created');
  });

  it('fires for a binding generator too, and ahead of the preview', () => {
    // `view` writes `object: '<name>'`, so the same object name is refused
    // there. `--dry-run` shows the refusal sits above the preview: a preview
    // of a view bound to a name the gate refuses would be the same defect.
    expect(residualDryRun.code, residualDryRun.stdout + residualDryRun.stderr).toBe(1);
    expect(residualDryRun.stdout).toContain('order__line');
    expect(residualDryRun.stdout).not.toContain('UI.View');
    expect(residualAfter.views).toBe(false);
  });
});

describe('[#20197] a config that does not load: the namespace is unknown, so nothing is written', () => {
  it('exits 1', () => {
    expect(loadFailed.code, loadFailed.stdout + loadFailed.stderr).toBe(1);
  });

  it('names the config that did not load, and the object that made it fail', () => {
    expect(loadFailed.stdout).toContain('objectstack.config.ts');
    expect(loadFailed.stdout).toContain("'legacy'");
  });

  it('writes no object file', () => {
    expect(loadFailedAfter.files).toEqual(brokenFiles);
    expect(existsSync(join(broken, 'src', 'objects', 'customer.object.ts'))).toBe(false);
    expect(loadFailed.stdout).not.toContain('Created');
  });

  it('leaves the barrel byte-identical', () => {
    expect(loadFailedAfter.barrel).toBe(brokenBarrel);
  });
});

describe('[#20197] CONTROLS — neither refusal is a command that refuses everything', () => {
  it('in the same namespaced project, `os g object order_line` generates, prefixed', () => {
    expect(namespacedControl.code, namespacedControl.stdout + namespacedControl.stderr).toBe(0);
    expect(readFileSync(join(namespaced, 'src', 'objects', 'order_line.object.ts'), 'utf-8'))
      .toContain(`name: '${NS}_order_line',`);
    // The object name is said out loud, not left to be discovered.
    expect(namespacedControl.stdout).toContain(`${NS}_order_line`);
    expect(barrelOf(namespaced)).toContain("from './order_line.object'");
  });

  it('in the same broken project, `os g dashboard sales` generates: a dashboard names no object', () => {
    expect(brokenControl.code, brokenControl.stdout + brokenControl.stderr).toBe(0);
    expect(existsSync(join(broken, 'src', 'dashboards', 'sales.dashboard.ts'))).toBe(true);
  });
});
