// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: eight spawns of the emitted projects' own scripts, each on its own fixture state (five `test` runs through vitest: init plugin, its empty-suite control, create plugin fresh, after `build`, and its empty-suite control; three tsc runs: `build`, `typecheck` clean and `typecheck` with the planted error); slowest CI reading 14.9 s (run 41217827347) of the five scheduled ci.yml runs 41199450735 to 41271604267 (slice 23's offender table), x 1.25, rounded up

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
 * it lands.
 *
 * The type layer of the emitted test is `scaffold-emission-typechecks.test.ts`'s
 * axis (it compiles every `srcFiles` entry under the shipped `tsconfig.json`),
 * so it is not restated here.
 *
 * ## `os create`
 *
 * `os create plugin` had the same defect (its script was bare `vitest`) and
 * ships `src/index.test.ts`. Its roster is derived from `create`'s
 * `templates`, in the default (standalone) placement: the `--in-repo`
 * placement's `tsconfig.json` extends this monorepo's root config, so it has no
 * meaning in a sandbox outside it. Two more cases than `os init` gets, because
 * `create`'s `build` is plain `tsc` and its starter test lives in `src/`, the
 * directory `tsc` compiles:
 *
 *   - after the emitted `build` script, `test` still runs exactly the shipped
 *     test files, and `dist/` holds no compiled test. Built through
 *     `tsconfig.json`, `tsc` emitted `dist/index.test.js` and vitest collected
 *     it beside the source: the suite ran twice and the package shipped its
 *     tests. `tsconfig.build.json` is what keeps them out;
 *   - the emitted `typecheck` script still type-checks the starter test: a type
 *     error planted in it fails the script. Moving the test out of `src/`, or
 *     excluding it in `tsconfig.json`, would have kept `dist/` clean by hiding
 *     the test from the type checker.
 *
 * `create`'s whole emission lands nowhere `scaffold-emission-typechecks`
 * compiles, so that second case is this file's to hold.
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
import { DEFAULT_PLACEMENT, templates as createTemplates } from '../src/commands/create.js';
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

/** Spawn any other emitted script in the project; its exit code and output. */
function runScript(root: string, manifest: Manifest, script: string): { code: number | null; output: string } {
  const [bin, ...args] = manifest.scripts![script].trim().split(/\s+/);
  const res = spawnSync(process.execPath, [resolveBin(root, manifest, bin), ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: childEnv({ NO_COLOR: '1', CI: '1' }),
  });
  return { code: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
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
        testResults: {
          name: string;
          status: string;
          message?: string;
          assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[];
        }[];
      })
    : null;
  // The JSON reporter replaces the console one, so a failing run prints little
  // of its own: the report says why it failed, a file that would not load in
  // its `message` and a failed test in its `failureMessages`.
  const failures = (json?.testResults ?? [])
    .filter((r) => r.status !== 'passed')
    .flatMap((r) => [
      ...(r.message ? [`${path.relative(root, r.name)}: ${r.message}`] : []),
      ...(r.assertionResults ?? [])
        .filter((a) => a.status !== 'passed')
        .map((a) => `${path.relative(root, r.name)} > ${a.fullName}: ${(a.failureMessages ?? []).join('\n')}`),
    ])
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

/** The `os create` templates whose emitted manifest declares a `test` script. */
const CREATE_ROSTER = Object.keys(createTemplates).filter((key) => {
  const render = createTemplates[key].filesFor(DEFAULT_PLACEMENT)['package.json'];
  return typeof (render(PROJECT_NAME) as Manifest).scripts?.test === 'string';
});

/** Materialise one `os create` template the way `Create.run()` writes it. */
function emitCreate(templateKey: string): { root: string; manifest: Manifest; testFiles: string[] } {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `create-${templateKey}-`));
  for (const [rel, render] of Object.entries(createTemplates[templateKey].filesFor(DEFAULT_PLACEMENT))) {
    const content = render(PROJECT_NAME);
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(root, rel),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n',
    );
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Manifest;
  linkDeclaredDependencies(root, manifest);
  const testFiles = Object.keys(createTemplates[templateKey].filesFor(DEFAULT_PLACEMENT)).filter((rel) =>
    /\.test\.[cm]?[jt]sx?$/.test(rel),
  );
  return { root, manifest, testFiles };
}

/** Every file under `dir`, relative to it. */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

describe('[#25175] an `os create` template with a `test` script passes it out of the box', () => {
  it('the roster is populated, and still holds the template the defect was measured on', () => {
    expect(CREATE_ROSTER.length).toBeGreaterThan(0);
    expect(CREATE_ROSTER).toContain('plugin');
  });

  it.each(CREATE_ROSTER)(
    '`os create %s`: the emitted `test` script runs the shipped tests and exits 0',
    (templateKey) => {
      const { root, manifest, testFiles } = emitCreate(templateKey);
      expect(testFiles.length, `\`os create ${templateKey}\` declares a test script and emits no test file`).toBeGreaterThan(0);

      const { code, output, json } = runTestScript(root, manifest);

      expect(code, `\`${manifest.scripts!.test}\` in a fresh \`os create ${templateKey}\` project:\n${output}`).toBe(0);
      expect(json, `the run wrote no JSON report:\n${output}`).not.toBeNull();
      expect(json!.numFailedTests).toBe(0);
      expect(json!.numPassedTests).toBeGreaterThan(0);
      expect(json!.testResults.map((r) => path.relative(root, r.name)).sort()).toEqual([...testFiles].sort());
    },
    120_000,
  );

  it.each(CREATE_ROSTER)(
    '`os create %s`: after the emitted `build`, `dist/` holds no test and `test` runs the shipped tests once',
    (templateKey) => {
      const { root, manifest, testFiles } = emitCreate(templateKey);

      const build = runScript(root, manifest, 'build');
      expect(build.code, `\`${manifest.scripts!.build}\`:\n${build.output}`).toBe(0);
      const dist = listFiles(path.join(root, 'dist'));
      // Calibration: a build that wrote nothing would pass the next line vacuously.
      expect(dist).toContain('index.js');
      expect(dist.filter((rel) => /\.test\./.test(rel)), 'the build compiled the starter test into dist/').toEqual([]);

      const { code, output, json } = runTestScript(root, manifest);
      expect(code, output).toBe(0);
      expect(json!.testResults.map((r) => path.relative(root, r.name)).sort()).toEqual([...testFiles].sort());
    },
    120_000,
  );

  it.each(CREATE_ROSTER)(
    '`os create %s`: the emitted `typecheck` script type-checks the starter test',
    (templateKey) => {
      const { root, manifest, testFiles } = emitCreate(templateKey);

      const clean = runScript(root, manifest, 'typecheck');
      expect(clean.code, `\`${manifest.scripts!.typecheck}\` on the fresh scaffold:\n${clean.output}`).toBe(0);

      const planted = path.join(root, testFiles[0]);
      fs.appendFileSync(planted, '\nexport const planted: number = \'not a number\';\n');
      const red = runScript(root, manifest, 'typecheck');
      expect(red.code, 'a type error in the starter test passed `typecheck`: the test is outside the checked program').not.toBe(0);
      expect(red.output).toContain(path.basename(testFiles[0]));
    },
    120_000,
  );

  it('CONTROL: the same project without its shipped tests fails the `test` script (the defect)', () => {
    const { root, manifest, testFiles } = emitCreate(CREATE_ROSTER[0]);
    for (const rel of testFiles) fs.rmSync(path.join(root, rel));

    const { code, json } = runTestScript(root, manifest);

    expect(code, 'an empty suite must fail; a harness that reads 0 here measures nothing').not.toBe(0);
    expect(json?.numPassedTests ?? 0).toBe(0);
  }, 120_000);
});
