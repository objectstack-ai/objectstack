// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The project name is refused BEFORE anything is written when npm would refuse
// it as a package name — with the rule stated and a suggested slug, and never
// a silent rewrite. Two layers:
//
//   - the predicate and the slug (package-name.ts), imported directly;
//   - the wiring, through the real CLI under `tsx` (index.ts calls
//     `program.parse()` on import, so it cannot be imported — the same
//     no-build subprocess pattern scaffold-description.test.ts uses). This is
//     the layer that proves the refusal happens before the first write: the
//     verdict is the exit code, the message, and an untouched directory.
//
// The legal-name legs are the control: a check that refused everything would
// pass every refusal leg, and only `my-app` / `@scope/my-app` scaffolding as
// before tells the two apart.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import validateNpmPackageName from 'validate-npm-package-name';
import {
  NPM_NAME_RULE,
  checkProjectName,
  describeInvalidProjectName,
  suggestPackageName,
} from './package-name.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');

describe('checkProjectName — npm\'s rule for a NEW package', () => {
  it.each(['my-app', '@scope/my-app', 'my.app', 'a_b', 'app2', 'x'])('accepts %s', (name) => {
    expect(checkProjectName(name)).toEqual({ valid: true });
  });

  it.each([
    ['My App!', /URL-friendly/],
    ['MyApp', /capital letters/],
    ['HTTP', /core module name/],
    ['http', /core module name/],
    ['.hidden', /start with a period/],
    ['_private', /start with an underscore/],
    [' my-app', /leading or trailing spaces/],
    ['node_modules', /not a valid package name/],
    ['apps/my-app', /URL-friendly/],
    ['a'.repeat(215), /214 characters/],
  ])('refuses %j, naming npm\'s reason', (name, reason) => {
    const verdict = checkProjectName(name);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join('; ')).toMatch(reason);
  });
});

describe('suggestPackageName — the slug a refusal offers', () => {
  it.each([
    ['My App!', 'my-app'],
    ['MyApp', 'my-app'],
    ['my app', 'my-app'],
    ['@Acme/My App', '@acme/my-app'],
    ['./my-app', 'my-app'],
    ['  Support   Desk  ', 'support-desk'],
    ['Ünïcode App', 'unicode-app'],
  ])('%j -> %j', (name, slug) => {
    expect(suggestPackageName(name)).toBe(slug);
  });

  it('suggests nothing rather than a name npm would refuse next', () => {
    // `HTTP` slugs to `http`, a core module name.
    expect(suggestPackageName('HTTP')).toBeUndefined();
    expect(suggestPackageName('!!!')).toBeUndefined();
  });

  it('every suggestion it does make is a valid new package name', () => {
    for (const name of ['My App!', 'MyApp', '@Acme/My App', 'A'.repeat(300), '@X/' + 'B'.repeat(300), 'Ünïcode App']) {
      const slug = suggestPackageName(name);
      expect(slug, name).toBeDefined();
      expect(validateNpmPackageName(slug!).validForNewPackages, `${name} -> ${slug}`).toBe(true);
    }
  });
});

describe('describeInvalidProjectName', () => {
  it('names the rule and the slug for a typed name', () => {
    const verdict = checkProjectName('My App!');
    if (verdict.valid) throw new Error('precondition: My App! is invalid');
    const lines = describeInvalidProjectName('My App!', verdict, { fromDirectory: false });
    expect(lines[0]).toContain('"My App!" is not a valid npm package name');
    expect(lines).toContain(NPM_NAME_RULE);
    expect(lines.join('\n')).toContain('create-objectstack my-app');
  });

  it('for the current-directory name, says the name came from the directory', () => {
    const verdict = checkProjectName('My App');
    if (verdict.valid) throw new Error('precondition: My App is invalid');
    const lines = describeInvalidProjectName('My App', verdict, { fromDirectory: true });
    expect(lines[0]).toContain('current directory');
    expect(lines.join('\n')).toContain('Rename this directory to "my-app"');
  });
});

// ─── The real CLI ──────────────────────────────────────────────────

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-npm-name-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Run the CLI in `cwd`; never throws — the exit status is part of the verdict. */
function run(cwd: string, args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(TSX, [INDEX_TS, ...args, '--skip-install', '--skip-skills'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '' };
  }
}

describe('the CLI refuses an illegal project name before writing anything', () => {
  it.each(['My App!', 'MyApp'])('%j: exit 1, the rule, the slug, and no directory', (name) => {
    const { status, stdout } = run(tmp, [name]);
    expect(status).toBe(1);
    expect(stdout).toContain(`"${name}" is not a valid npm package name`);
    expect(stdout).toContain(NPM_NAME_RULE);
    expect(stdout).toContain('Suggested name: create-objectstack my-app');
    expect(stdout).not.toContain('Template files written');
    expect(fs.readdirSync(tmp)).toEqual([]);
  }, 30_000);

  it('the current directory\'s name is checked too, and the directory stays empty', () => {
    const here = path.join(tmp, 'My App');
    fs.mkdirSync(here);
    const { status, stdout } = run(here, []);
    expect(status).toBe(1);
    expect(stdout).toContain('The current directory\'s name "My App" is the project name');
    expect(stdout).toContain('Rename this directory to "my-app"');
    expect(fs.readdirSync(here)).toEqual([]);
  }, 30_000);

  it.each([
    ['my-app', 'my-app'],
    ['@scope/my-app', path.join('@scope', 'my-app')],
  ])('control: %j scaffolds as before, written verbatim', (name, dir) => {
    const { status, stdout } = run(tmp, [name]);
    expect(status, stdout).toBe(0);
    const projectDir = path.join(tmp, dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'objectstack.manifest.json'), 'utf8'),
    );
    expect(pkg.name).toBe(name);
    expect(manifest.name).toBe(name);
  }, 30_000);
});
