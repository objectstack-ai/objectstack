// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20197), end to end: `os init -t app`, then `os g object order_line`,
 * then `os validate` exits 0, through the real commands.
 *
 * `generate-object-namespace-prefix.test.ts` holds the templates and the
 * namespace reader in-process, and is the per-PR guard. What only a real child
 * process can show is the WIRING between them: `runMetadataGeneration` reads
 * `manifest.namespace` from the project it is run in, applies it, and refuses
 * when it cannot read it. Measured before the fix, on the card's reproduction:
 * this `os validate` exited 1 with "Object 'order_line' is missing the package
 * namespace prefix".
 *
 * Three projects, all from one `os init my-app -t app --no-install`:
 *
 *   namespaced  as scaffolded (`namespace: 'my_app'`): `order_line` lands as
 *               `my_app_order_line`, and a name that already carries the prefix
 *               (`my_app_invoice`) lands as written, never doubled.
 *   control     the same project with `namespace` deleted from its manifest:
 *               no prefix is owed, so none is added.
 *   broken      a project whose config does not load (an unprefixed object, as
 *               the CLI wrote it before this fix): the namespace is unknown, so
 *               the command refuses and writes nothing.
 *
 * Projects live under this package's `node_modules`, so a config's
 * `@objectstack/spec` import resolves to the workspace copy without an
 * install. Spawned through `bin/run-dev.js` + tsx, so the suite does not
 * depend on `packages/cli/dist`. Commands print through `utils/format.ts`,
 * which writes to stdout, so stdout is what is read.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold starts, seven of them, sequential. */
const RUN_TIMEOUT_MS = 300_000;

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

const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf-8') : '');

let root: string;
let init: Run;
const runs: Record<string, Run> = {};
const dirs: Record<'namespaced' | 'control' | 'broken', string> = { namespaced: '', control: '', broken: '' };

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.generate-namespace-e2e-'));
  init = await runCli(['init', 'my-app', '-t', 'app', '--no-install'], root);

  dirs.namespaced = join(root, 'my-app');
  dirs.control = join(root, 'control-app');
  dirs.broken = join(root, 'broken-app');
  cpSync(dirs.namespaced, dirs.control, { recursive: true });
  cpSync(dirs.namespaced, dirs.broken, { recursive: true });

  // control: the manifest declares no namespace.
  const controlConfig = join(dirs.control, 'objectstack.config.ts');
  writeFileSync(controlConfig, read(controlConfig).replace(/^\s*namespace: 'my_app',\n/m, ''));

  // broken: an unprefixed object, which is what `os g object` wrote before.
  writeFileSync(
    join(dirs.broken, 'src', 'objects', 'legacy.object.ts'),
    read(join(dirs.namespaced, 'src', 'objects', 'my_app_item.object.ts')).replace("name: 'my_app_item'", "name: 'legacy'"),
  );
  writeFileSync(
    join(dirs.broken, 'src', 'objects', 'index.ts'),
    read(join(dirs.broken, 'src', 'objects', 'index.ts')) + "export { default as legacy } from './legacy.object';\n",
  );

  // Sequential on purpose: cold tsx starts in a container several agents share.
  runs.generate = await runCli(['g', 'object', 'order_line'], dirs.namespaced);
  runs.prefixed = await runCli(['g', 'object', 'my_app_invoice'], dirs.namespaced);
  runs.validate = await runCli(['validate'], dirs.namespaced);
  runs.controlGenerate = await runCli(['g', 'object', 'order_line'], dirs.control);
  runs.controlValidate = await runCli(['validate'], dirs.control);
  runs.broken = await runCli(['g', 'object', 'customer'], dirs.broken);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#20197] `os g object` in an `os init -t app` project', () => {
  it('the project was scaffolded with the namespace this file assumes', () => {
    expect(init.code, init.stdout + init.stderr).toBe(0);
    expect(read(join(dirs.namespaced, 'objectstack.config.ts'))).toContain("namespace: 'my_app'");
    // …and the control really has none, so its green below is about absence.
    expect(read(join(dirs.control, 'objectstack.config.ts'))).not.toContain('namespace:');
  });

  it('writes the object name the namespace-prefix gate demands, and says so', () => {
    expect(runs.generate.code, runs.generate.stdout + runs.generate.stderr).toBe(0);
    expect(read(join(dirs.namespaced, 'src', 'objects', 'order_line.object.ts'))).toContain("name: 'my_app_order_line',");
    expect(runs.generate.stdout).toContain('my_app_order_line');
  });

  it('a name that already carries the prefix is written as typed, never doubled', () => {
    expect(runs.prefixed.code, runs.prefixed.stdout + runs.prefixed.stderr).toBe(0);
    const source = read(join(dirs.namespaced, 'src', 'objects', 'my_app_invoice.object.ts'));
    expect(source).toContain("name: 'my_app_invoice',");
    expect(source).not.toContain('my_app_my_app');
  });

  it('`os validate` then exits 0', () => {
    expect(runs.validate.code, runs.validate.stdout + runs.validate.stderr).toBe(0);
  });

  it('control: with no namespace in the manifest, no prefix is added and validate exits 0', () => {
    expect(runs.controlGenerate.code, runs.controlGenerate.stdout + runs.controlGenerate.stderr).toBe(0);
    expect(read(join(dirs.control, 'src', 'objects', 'order_line.object.ts'))).toContain("name: 'order_line',");
    expect(runs.controlValidate.code, runs.controlValidate.stdout + runs.controlValidate.stderr).toBe(0);
  });

  it('a config that does not load is refused, and nothing is written', () => {
    expect(runs.broken.code).toBe(1);
    // Named subjects, not prose: the config that did not load, and the object
    // that made it fail.
    expect(runs.broken.stdout).toContain('objectstack.config.ts');
    expect(runs.broken.stdout).toContain("'legacy'");
    expect(existsSync(join(dirs.broken, 'src', 'objects', 'customer.object.ts'))).toBe(false);
    expect(read(join(dirs.broken, 'src', 'objects', 'index.ts'))).not.toContain('customer');
  });
});
