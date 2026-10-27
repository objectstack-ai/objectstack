// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#26332) — a fresh `os create plugin NAME --in-repo` passes its own
 * `typecheck` and `build` scripts.
 *
 * ## The defect
 *
 * Once the in-repo scaffold extended `tsconfig.base.json` and reached its own
 * `src/`, its first `pnpm typecheck` in the new package was red twice over:
 *
 *   - TS5103 "Invalid value for '--ignoreDeprecations'": the manifest declared
 *     `typescript` as `SCAFFOLD_TYPESCRIPT_RANGE` (`^5.3.0`, installed as
 *     5.9.3), while the base sets `ignoreDeprecations: "6.0"`, a value only
 *     TypeScript 6 accepts. Every sibling package declares the workspace's
 *     TypeScript 6 range.
 *   - TS6133 "'context' is declared but its value is never read": the starter
 *     `init(context)` against the base's `noUnusedParameters`.
 *
 * ## What is run, and where
 *
 * The in-repo emission is materialised through `create`'s own renderers into a
 * sandbox laid out like this repository: the real `tsconfig.base.json` copied
 * to the sandbox root, and the scaffold at `packages/plugins/plugin-NAME`
 * beneath it, so the emitted `extends` resolves exactly as it does in the
 * monorepo. The emitted `typecheck` and `build` scripts are then spawned with
 * the workspace's own `tsc`, the compiler the in-repo manifest now declares.
 *
 * The sandbox lives under this package's `node_modules` (git-ignored), the
 * placement `scaffold-emission-typechecks.test.ts` documents: an emitted
 * `import … from '@objectstack/spec/…'` resolves by the ordinary upward walk.
 * TS2307 on the spec package means its `dist/` is not built; build it with
 * `pnpm --filter '@objectstack/cli^...' build`.
 *
 * The TypeScript VERSION a contributor installs cannot be spawned here without
 * an install, so the TS5103 half is pinned on the declaration instead: the
 * in-repo range is the workspace's range, and its floor is a major that
 * accepts the base's `ignoreDeprecations`. The standalone range is pinned
 * unchanged beside it.
 *
 * ## The control
 *
 * A planted unused parameter must fail the same `typecheck` with TS6133. Green
 * there would mean the scaffold no longer compiles under the base's
 * strictness, and the verdict on the starter would mean nothing.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IN_REPO_TYPESCRIPT_RANGE, templates } from '../src/commands/create.js';
import { SCAFFOLD_TYPESCRIPT_RANGE } from '../src/commands/init.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const BASE_TSCONFIG = path.resolve(HERE, '../../..', 'tsconfig.base.json');
const PLUGINS_DIR = path.resolve(HERE, '../../..', 'packages/plugins');

const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');
const ts = require('typescript') as typeof import('typescript');

const PROJECT = 'probe';
const template = templates.plugin;

const TMP_ROOT = fs.mkdtempSync(path.join(HERE, '..', 'node_modules', '.create-in-repo-typecheck-'));
afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

interface Manifest {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

function manifestFor(placement: 'in-repo' | 'standalone'): Manifest {
  return template.filesFor(placement)['package.json'](PROJECT) as Manifest;
}

/** Materialise the in-repo emission under a copy of this repo's base; returns the scaffold dir. */
function emitInRepo(): string {
  const workspace = fs.mkdtempSync(path.join(TMP_ROOT, 'ws-'));
  fs.copyFileSync(BASE_TSCONFIG, path.join(workspace, 'tsconfig.base.json'));
  const dir = path.join(workspace, template.inRepoDir, template.dirName(PROJECT));
  for (const [filePath, render] of Object.entries(template.filesFor('in-repo'))) {
    const content = render(PROJECT);
    fs.mkdirSync(path.dirname(path.join(dir, filePath)), { recursive: true });
    fs.writeFileSync(
      path.join(dir, filePath),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n',
    );
  }
  return dir;
}

/** Spawn one emitted script, its `tsc` resolved to the workspace's compiler. */
function runScript(dir: string, script: string): { code: number | null; output: string } {
  const [bin, ...args] = manifestFor('in-repo').scripts[script].trim().split(/\s+/);
  expect(bin, `the in-repo \`${script}\` script no longer runs tsc`).toBe('tsc');
  const res = spawnSync(process.execPath, [TSC, '--pretty', 'false', ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: childEnv({ NO_COLOR: '1' }),
  });
  return { code: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/** The `ignoreDeprecations` value the base sets, read through the compiler's own config parser. */
function baseIgnoreDeprecations(): string {
  const read = ts.readConfigFile(BASE_TSCONFIG, ts.sys.readFile);
  expect(read.error, 'tsconfig.base.json did not parse').toBeUndefined();
  return String(read.config.compilerOptions.ignoreDeprecations);
}

describe('os create plugin --in-repo: the scaffold passes its own scripts', () => {
  it('a planted unused parameter fails `typecheck` with TS6133 (control)', () => {
    const dir = emitInRepo();
    fs.writeFileSync(path.join(dir, 'src', 'canary.ts'), 'export function canary(unusedProbe: string) {}\n');

    const { code, output } = runScript(dir, 'typecheck');

    expect(code, `the canary compiled, so the scaffold is not under the base's strictness:\n${output}`).not.toBe(0);
    expect(output).toContain('TS6133');
    expect(output).toContain('unusedProbe');
  }, 120_000);

  it('`typecheck` and `build` exit 0, and `build` leaves the starter test out of dist', () => {
    const dir = emitInRepo();

    const typecheck = runScript(dir, 'typecheck');
    expect(typecheck.code, `a fresh in-repo scaffold fails its own \`typecheck\`:\n${typecheck.output}`).toBe(0);

    const build = runScript(dir, 'build');
    expect(build.code, `a fresh in-repo scaffold fails its own \`build\`:\n${build.output}`).toBe(0);
    expect(fs.existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'dist', 'index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'dist', 'index.test.js'))).toBe(false);
  }, 120_000);
});

describe('os create plugin: the TypeScript each placement declares', () => {
  it('in-repo declares the workspace\'s TypeScript, the range the root and every sibling plugin declare', () => {
    const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;
    expect(manifestFor('in-repo').devDependencies.typescript).toBe(root.devDependencies.typescript);
    expect(IN_REPO_TYPESCRIPT_RANGE).toBe(root.devDependencies.typescript);

    const siblings = fs
      .readdirSync(PLUGINS_DIR)
      .map((name) => path.join(PLUGINS_DIR, name, 'package.json'))
      .filter((file) => fs.existsSync(file))
      .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Manifest>)
      .map((pkg) => pkg.devDependencies?.typescript)
      .filter((range): range is string => typeof range === 'string');
    expect(siblings.length, 'no sibling under packages/plugins declares typescript').toBeGreaterThan(0);
    expect([...new Set(siblings)]).toEqual([IN_REPO_TYPESCRIPT_RANGE]);
  });

  it('in-repo\'s TypeScript floor accepts the base\'s ignoreDeprecations (TS5103)', () => {
    const floorMajor = Number(/^\^?(\d+)\./.exec(manifestFor('in-repo').devDependencies.typescript)?.[1]);
    const acceptedFrom = Number(/^(\d+)\./.exec(baseIgnoreDeprecations())?.[1]);
    expect(Number.isFinite(acceptedFrom), 'the base sets no numeric ignoreDeprecations').toBe(true);
    expect(floorMajor).toBeGreaterThanOrEqual(acceptedFrom);
  });

  it('standalone still declares SCAFFOLD_TYPESCRIPT_RANGE', () => {
    expect(manifestFor('standalone').devDependencies.typescript).toBe(SCAFFOLD_TYPESCRIPT_RANGE);
  });
});
