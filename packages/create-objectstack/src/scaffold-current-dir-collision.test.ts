// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A scaffold into the current directory (no name, or an empty one) used to
// copy the template straight over whatever was there: an existing project's
// README.md and package.json were replaced and the run exited 0, while a named
// non-empty directory was refused. The current directory now gets the same
// protection, scoped to collisions — a template file that would replace an
// existing one refuses the run before anything is written; files the template
// does not write may stay.
//
// Runs the real CLI through `tsx` (index.ts calls `program.parse()` on import,
// so it cannot be imported), the no-build pattern scaffold-description.test.ts
// uses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTemplateCollisions } from './template-copy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');
const BLANK_TEMPLATE = path.join(PKG_ROOT, 'src', 'templates', 'blank');

const USER_README = '# My notes\n\nWritten by hand, not by the scaffolder.\n';
const USER_PACKAGE_JSON = '{ "name": "my-existing-thing", "version": "3.1.4" }\n';
const USER_NOTES = 'keep me\n';

let tmp: string;
let projectDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-collide-'));
  projectDir = path.join(tmp, 'my-app');
  fs.mkdirSync(projectDir);
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(cwd: string, nameArgs: string[]) {
  const result = spawnSync(
    TSX,
    [INDEX_TS, ...nameArgs, '--template', 'blank', '--skip-install', '--skip-skills'],
    { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
  );
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

// Every path under `dir` with its bytes, so "nothing was written" is checked
// against the whole tree, not only the files a test happens to name.
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out[`${childRel}/`] = '';
        walk(childAbs, childRel);
      } else {
        out[childRel] = fs.readFileSync(childAbs, 'utf8');
      }
    }
  };
  walk(dir, '');
  return out;
}

describe('scaffold into the current directory', () => {
  for (const [label, nameArgs] of [
    ['no name', []],
    ['an empty name', ['']],
  ] as const) {
    it(`refuses with ${label} when template files would overwrite existing ones, writing nothing`, () => {
      fs.writeFileSync(path.join(projectDir, 'README.md'), USER_README);
      fs.writeFileSync(path.join(projectDir, 'package.json'), USER_PACKAGE_JSON);
      fs.writeFileSync(path.join(projectDir, 'notes.txt'), USER_NOTES);
      const before = snapshot(projectDir);

      const { status, out } = run(projectDir, [...nameArgs]);

      expect(status).toBe(1);
      expect(snapshot(projectDir)).toEqual(before);
      expect(out).toContain('the template would overwrite 2 existing files');
      expect(out).toMatch(/^\s+README\.md$/m);
      expect(out).toMatch(/^\s+package\.json$/m);
      expect(out).not.toMatch(/^\s+notes\.txt$/m);
      expect(out).not.toContain('Environment created!');
    }, 30_000);
  }

  it('scaffolds when the directory only holds files the template does not write, leaving them untouched', () => {
    fs.mkdirSync(path.join(projectDir, '.git'));
    fs.writeFileSync(path.join(projectDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(projectDir, 'notes.txt'), USER_NOTES);

    const { status, out } = run(projectDir, []);

    expect(status).toBe(0);
    expect(out).toContain('Environment created!');
    expect(out).toContain('the directory already had contents');
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')).name).toBe(
      'my-app',
    );
    expect(fs.readFileSync(path.join(projectDir, 'notes.txt'), 'utf8')).toBe(USER_NOTES);
    expect(fs.readFileSync(path.join(projectDir, '.git', 'HEAD'), 'utf8')).toBe(
      'ref: refs/heads/main\n',
    );
  }, 30_000);

  it('scaffolds an empty current directory as before', () => {
    const { status, out } = run(projectDir, []);

    expect(status).toBe(0);
    expect(out).toContain('Created files:');
    expect(fs.existsSync(path.join(projectDir, 'objectstack.config.ts'))).toBe(true);
  }, 30_000);
});

describe('scaffold into a named directory', () => {
  it('still refuses a named non-empty directory with the old message', () => {
    fs.writeFileSync(path.join(projectDir, 'notes.txt'), USER_NOTES);
    const before = snapshot(projectDir);

    const { status, out } = run(tmp, ['my-app']);

    expect(status).toBe(1);
    expect(out).toContain(`Directory already exists and is not empty: ${projectDir}`);
    expect(snapshot(projectDir)).toEqual(before);
  }, 30_000);
});

describe('findTemplateCollisions', () => {
  it('names aliased dotfiles by the name they land under', () => {
    fs.writeFileSync(path.join(projectDir, '.gitignore'), 'node_modules\n');
    expect(findTemplateCollisions(BLANK_TEMPLATE, projectDir)).toEqual(['.gitignore']);
  });

  it('reports a file standing where the template needs a directory', () => {
    fs.writeFileSync(path.join(projectDir, 'src'), 'not a directory\n');
    expect(findTemplateCollisions(BLANK_TEMPLATE, projectDir)).toEqual(['src']);
  });

  it('looks inside a directory the template shares with the user', () => {
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(path.join(projectDir, 'src', 'mine.ts'), 'export {};\n');
    expect(findTemplateCollisions(BLANK_TEMPLATE, projectDir)).toEqual([]);
  });
});
