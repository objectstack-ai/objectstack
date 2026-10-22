// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#25175) — an `os init` template that declares a `test` script ships a
 * project whose `test` script passes out of the box.
 *
 * ## The defect
 *
 * `os init NAME -t plugin` emitted `scripts.test: 'vitest run'` and no test
 * file. Measured after `npm install`: `npm test` exited 1 with `No test files
 * found, exiting with code 1`, on vitest 4.1.12 and on 4.0.18 alike. A
 * scaffold whose `test` script is red out of the box teaches its user to
 * ignore tests. The template now ships one starter test (`package.test.ts`).
 *
 * ## What is run, and why the project lives OUTSIDE this repository
 *
 * Every template is materialised through `init`'s own renderers, exactly as
 * `Init.run()` writes it, and the command in its emitted `scripts.test` is
 * spawned in that directory. The one addition is a JSON reporter, which
 * counts the test files and tests that ran rather than trusting an exit code
 * alone: `--passWithNoTests` would exit 0 having run nothing.
 *
 * vitest looks for a config file in the project directory AND EVERY PARENT,
 * so a project nested in this package would run under
 * `packages/cli/vitest.config.ts`, a config no user's project has (measured:
 * it did). The project is therefore created under the OS temp directory, and
 * a case below asserts no ancestor of it carries a vitest or vite config. Its
 * `node_modules` holds one symlink per DECLARED dependency, to the copy this
 * package resolves — the workspace's own build, the stand-in for an install
 * the other in-package scaffold pins use too
 * (`scaffold-emission-typechecks.test.ts`). A declared dependency this
 * package cannot resolve fails the case: the sandbox would not stand in for
 * an install.
 *
 * ## The control
 *
 * The same project with its emitted test files deleted must FAIL its `test`
 * script, which is the defect's own signature. Without it a harness that
 * swallowed the child's exit status would read green on every template.
 *
 * ## Roster
 *
 * Derived from `TEMPLATES`: every template whose rendered `package.json`
 * declares a `test` script. A template that grows one later is swept the day
 * it lands. `os create plugin` emits a `test` script too and is not swept
 * here yet; its starter test ships with the docs listings its file tree is
 * pinned against (`create-plugin-docs-parity.test.ts`).
 *
 * The type layer of the emitted test is `scaffold-emission-typechecks.test.ts`'s
 * axis (it compiles every `srcFiles` entry under the shipped `tsconfig.json`),
 * so it is not restated here.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPLATES,
  renderScaffoldPackageJson,
  renderScaffoldTsconfig,
  sanitizeNamespace,
  SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
  writeTemplateSrcFiles,
} from '../src/commands/init.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** This package's root: where its declared dependencies resolve from. */
const PKG = path.resolve(HERE, '..');
const PKG_NAME = (JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')) as { name: string }).name;

const PROJECT_NAME = 'my-app';

// Real path: vitest reports test files by it, and the OS temp directory may be
// reached through a symlink (macOS `/var` is `/private/var`).
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-scaffold-test-script-')));
afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** The config file names vitest (and vite under it) would pick up from a parent. */
const RUNNER_CONFIG = /^(?:vitest|vite)\.(?:config|workspace)\.[cm]?[jt]s$/;

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The `os init` templates whose emitted manifest declares a `test` script. */
const ROSTER = Object.keys(TEMPLATES).filter((key) => {
  const manifest = renderScaffoldPackageJson(PROJECT_NAME, TEMPLATES[key]) as Manifest;
  return typeof manifest.scripts?.test === 'string';
});

/** Materialise one template the way `Init.run()` writes it; returns the project root. */
function emit(templateKey: string): { root: string; manifest: Manifest; testFiles: string[] } {
  const template = TEMPLATES[templateKey];
  const namespace = sanitizeNamespace(PROJECT_NAME);
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `${templateKey}-`));
  const manifest = renderScaffoldPackageJson(PROJECT_NAME, template) as Manifest;
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'objectstack.config.ts'), template.configContent(PROJECT_NAME, namespace));
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify(
      renderScaffoldTsconfig({ rootDir: '.', include: SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG }),
      null,
      2,
    ) + '\n',
  );
  const written = writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);
  linkDeclaredDependencies(root, manifest);
  return { root, manifest, testFiles: written.filter((rel) => /\.test\.[cm]?[jt]sx?$/.test(rel)) };
}

/** One symlink per declared dependency, to the copy this package resolves. */
function linkDeclaredDependencies(root: string, manifest: Manifest): void {
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  for (const name of names) {
    const target = name === PKG_NAME ? PKG : path.join(PKG, 'node_modules', name);
    if (!fs.existsSync(target)) {
      throw new Error(
        `the emitted manifest declares ${name}, which ${PKG_NAME} does not resolve — this sandbox ` +
          'cannot stand in for an install of it',
      );
    }
    const link = path.join(root, 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fs.realpathSync(target), link, 'junction');
  }
}

/** The installed bin a script's first word names, resolved inside the project. */
function resolveBin(root: string, manifest: Manifest, bin: string): string {
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  for (const name of names) {
    const dir = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      name: string;
      bin?: string | Record<string, string>;
    };
    const entry = typeof pkg.bin === 'string' ? (pkg.name === bin ? pkg.bin : undefined) : pkg.bin?.[bin];
    if (entry) return path.join(dir, entry);
  }
  throw new Error(`no declared dependency of the emitted project provides the \`${bin}\` bin`);
}

/** Spawn the emitted `test` script, plus a JSON reporter, in the project. */
function runTestScript(root: string, manifest: Manifest) {
  const [bin, ...args] = manifest.scripts!.test.trim().split(/\s+/);
  const report = path.join(root, '.vitest-report.json');
  const res = spawnSync(
    process.execPath,
    [resolveBin(root, manifest, bin), ...args, '--reporter=json', `--outputFile=${report}`],
    { cwd: root, encoding: 'utf-8', env: childEnv({ NO_COLOR: '1', CI: '1' }) },
  );
  const json = fs.existsSync(report)
    ? (JSON.parse(fs.readFileSync(report, 'utf8')) as {
        numPassedTests: number;
        numFailedTests: number;
        testResults: { name: string; status: string; message?: string }[];
      })
    : null;
  // The JSON reporter replaces the console one, so a failing run prints little
  // of its own; the report's per-file messages are what says why it failed.
  const failures = (json?.testResults ?? [])
    .filter((r) => r.status !== 'passed')
    .map((r) => `${path.relative(root, r.name)}: ${r.message ?? r.status}`)
    .join('\n');
  return { code: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}${failures}`, json };
}

describe('[#25175] an `os init` template with a `test` script passes it out of the box', () => {
  it('the roster is populated, and still holds the template the defect was measured on', () => {
    // An `it.each` over an empty roster passes having measured nothing.
    expect(ROSTER.length).toBeGreaterThan(0);
    expect(ROSTER).toContain('plugin');
  });

  it('no ancestor of the sandbox carries a runner config the emitted project would inherit', () => {
    const found: string[] = [];
    for (let dir = TMP_ROOT; ; dir = path.dirname(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (RUNNER_CONFIG.test(entry)) found.push(path.join(dir, entry));
      }
      if (path.dirname(dir) === dir) break;
    }
    expect(found, 'vitest would load these instead of the defaults a user project runs under').toEqual([]);
  });

  it.each(ROSTER)(
    '`os init -t %s`: the emitted `test` script runs the shipped tests and exits 0',
    (templateKey) => {
      const { root, manifest, testFiles } = emit(templateKey);
      expect(testFiles.length, `\`os init -t ${templateKey}\` declares a test script and emits no test file`).toBeGreaterThan(0);

      const { code, output, json } = runTestScript(root, manifest);

      expect(code, `\`${manifest.scripts!.test}\` in a fresh \`os init -t ${templateKey}\` project:\n${output}`).toBe(0);
      expect(json, `the run wrote no JSON report:\n${output}`).not.toBeNull();
      expect(json!.numFailedTests).toBe(0);
      expect(json!.numPassedTests).toBeGreaterThan(0);
      expect(json!.testResults.map((r) => path.relative(root, r.name)).sort()).toEqual([...testFiles].sort());
      expect(json!.testResults.every((r) => r.status === 'passed')).toBe(true);
    },
    120_000,
  );

  it('CONTROL: the same project without its shipped tests fails the `test` script (the defect)', () => {
    const { root, manifest, testFiles } = emit(ROSTER[0]);
    for (const rel of testFiles) fs.rmSync(path.join(root, rel));

    const { code, json } = runTestScript(root, manifest);

    expect(code, 'an empty suite must fail; a harness that reads 0 here measures nothing').not.toBe(0);
    expect(json?.numPassedTests ?? 0).toBe(0);
  }, 120_000);
});
