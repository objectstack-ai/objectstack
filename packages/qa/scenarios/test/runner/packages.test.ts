// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--packages workspace` (`src/runner/packages.ts`) against a workspace of its
 * own: a two-package pnpm workspace in a temp directory — a skills catalog
 * holding a marker skill, and a stand-in `create-objectstack` that does what
 * the real one does in the order it does it (write `package.json` and
 * `pnpm-workspace.yaml`, `pnpm install`, copy each skill of the installed
 * catalog into `.claude/skills/`, as `skills experimental_sync --copy` does).
 * The pack, the `npx -y file:` scaffold, the pnpmfile and both installs are
 * the real tools. The packages carry a version npm has never published, so an
 * install that reached for the registry fails instead of quietly finding
 * something.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  pnpmfileSource,
  prepareWorkspacePackages,
  PROJECT_SKILLS_DIR,
  settleWorkspaceProject,
  verifyWorkspaceInstall,
  workspaceScaffolder,
  type WorkspacePackages,
} from '../../src/runner/packages.js';
import { scaffold } from '../../src/runner/project.js';

const VERSION = '0.0.0-scenario-workspace-test';
const MARKER = 'WORKSPACE-ONLY-SKILL-MARKER-7f3c';

/** The stand-in scaffolder, in the real one's order: files, `pnpm install`, then the skills sync's copy of the installed catalog. */
const SCAFFOLDER = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const dir = path.resolve(process.argv[2]);
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), version: '0.1.0', private: true, devDependencies: { '@objectstack/skills': '${VERSION}' } }, null, 2) + '\\n');
fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages: []\\n');
execSync('pnpm install --no-frozen-lockfile', { cwd: dir, stdio: 'inherit' });
const catalog = path.join(dir, 'node_modules/@objectstack/skills/dist/skills');
for (const skill of fs.readdirSync(catalog)) {
  if (fs.existsSync(path.join(catalog, skill, 'SKILL.md'))) fs.cpSync(path.join(catalog, skill), path.join(dir, '.claude/skills', skill), { recursive: true });
}
`;

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** A git-committed pnpm workspace: the skills catalog, the scaffolder, and a private package the release never publishes. */
function makeWorkspace(root: string) {
  writeJson(join(root, 'package.json'), { name: 'scenario-workspace-test', private: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const skills = join(root, 'packages', 'skills');
  writeJson(join(skills, 'package.json'), { name: '@objectstack/skills', version: VERSION, files: ['dist'] });
  mkdirSync(join(skills, 'dist', 'skills', 'objectstack-marker'), { recursive: true });
  writeFileSync(join(skills, 'dist', 'skills', 'objectstack-marker', 'SKILL.md'), `---\nname: objectstack-marker\n---\n\n${MARKER}\n`);
  writeFileSync(join(skills, 'dist', 'skills', 'README.md'), 'the catalog, described: not a skill, so never synced\n');
  writeFileSync(join(skills, 'NOT-SHIPPED.md'), 'outside `files`: a link would show it, a tarball never does\n');
  const create = join(root, 'packages', 'create-objectstack');
  writeJson(join(create, 'package.json'), { name: 'create-objectstack', version: VERSION, bin: { 'create-objectstack': 'bin.cjs' }, files: ['bin.cjs'] });
  writeFileSync(join(create, 'bin.cjs'), SCAFFOLDER, { mode: 0o755 });
  writeJson(join(root, 'packages', 'qa', 'package.json'), { name: '@objectstack/qa-private', version: VERSION, private: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'workspace');
}

describe('--packages workspace — the project installs the workspace build, the skills included', () => {
  const root = mkdtempSync(join(tmpdir(), 'scenario-ws-'));
  const repo = join(root, 'repo');
  let ws: WorkspacePackages;
  let project: string;
  let settled: Awaited<ReturnType<typeof settleWorkspaceProject>>;
  let built: string[] = [];

  beforeAll(async () => {
    makeWorkspace(repo);
    ws = await prepareWorkspacePackages(repo, join(root, 'packed'), {
      build: async (_repo, packages) => {
        built = packages.map((p) => p.name);
        return { command: 'build', exit: 0, tail: '', ms: 0 };
      },
    });
    mkdirSync(join(root, 'work'));
    const done = await scaffold(join(root, 'work'), 'demoapp', workspaceScaffolder(ws));
    expect([done.result.exit, done.result.tail.slice(-400)]).toEqual([0, expect.any(String)]);
    project = done.dir;
    settled = await settleWorkspaceProject(project, ws);
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('builds and packs exactly what the release publishes, and states the commit', () => {
    expect(built).toEqual(['@objectstack/skills', 'create-objectstack']);
    expect([...ws.tarballs.keys()]).toEqual(['@objectstack/skills', 'create-objectstack']);
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(ws.source).toEqual({ source: 'workspace', commit: head, uncommitted: false });
  });

  it('a marker present only in the workspace build is in .claude/skills/', () => {
    expect([settled.exit, settled.tail.slice(-400)]).toEqual([0, expect.any(String)]);
    expect(readFileSync(join(project, PROJECT_SKILLS_DIR, 'objectstack-marker', 'SKILL.md'), 'utf8')).toContain(MARKER);
    expect(verifyWorkspaceInstall(project, ws)).toEqual([]);
  });

  it('from the tarball, as npm would serve it: no workspace link, no file outside `files`', () => {
    const installed = realpathSync(join(project, 'node_modules', '@objectstack', 'skills'));
    expect(installed).toContain('@file+');
    expect(installed.startsWith(repo)).toBe(false);
    expect(existsSync(join(installed, 'NOT-SHIPPED.md'))).toBe(false);
  });

  it('the project pins the version as a published scaffold does, and keeps the tarballs for later installs', () => {
    expect(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).devDependencies).toEqual({ '@objectstack/skills': VERSION });
    const yaml = readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8');
    expect(yaml.startsWith('packages: []\n')).toBe(true);
    expect(yaml).toContain(`  "@objectstack/skills": "file:${ws.tarballs.get('@objectstack/skills')}"`);
    expect(readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8')).not.toContain('pnpmfileChecksum');
  });

  it('the pnpmfile rewrites every packed name in every dependency field, and nothing else', () => {
    const hook = { exports: {} as { hooks: { readPackage(p: Record<string, Record<string, string>>): unknown } } };
    new Function('module', pnpmfileSource(ws.tarballs))(hook);
    const pkg = {
      dependencies: { '@objectstack/skills': '^1', zod: '^4' },
      peerDependencies: { 'create-objectstack': '*' },
    };
    hook.exports.hooks.readPackage(pkg);
    expect(pkg).toEqual({
      dependencies: { '@objectstack/skills': `file:${ws.tarballs.get('@objectstack/skills')}`, zod: '^4' },
      peerDependencies: { 'create-objectstack': `file:${ws.tarballs.get('create-objectstack')}` },
    });
  });
});

describe('verifyWorkspaceInstall — ⛔ a project that is not on the workspace packages is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'scenario-ws-verify-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** A project laid out as an install leaves it; `store` names the `.pnpm` entries, `skills` the copied catalog. */
  function project(name: string, store: string[], skills: Record<string, string>) {
    const dir = join(root, name);
    writeJson(join(dir, 'package.json'), { devDependencies: { '@objectstack/skills': '18.3.0' } });
    for (const entry of store) mkdirSync(join(dir, 'node_modules', '.pnpm', entry, 'node_modules', '@objectstack', 'skills'), { recursive: true });
    for (const [rel, text] of Object.entries(skills)) {
      mkdirSync(join(dir, PROJECT_SKILLS_DIR, rel, '..'), { recursive: true });
      writeFileSync(join(dir, PROJECT_SKILLS_DIR, rel), text);
    }
    return dir;
  }
  const catalog = join(root, 'catalog');
  mkdirSync(join(catalog, 'objectstack-marker'), { recursive: true });
  writeFileSync(join(catalog, 'objectstack-marker', 'SKILL.md'), MARKER);
  const ws = { tarballs: new Map([['@objectstack/skills', '/packed/objectstack-skills-18.3.0.tgz']]), skillsCatalog: catalog };

  it('the published catalog in .claude/skills/ (no marker) is refused, file by file', () => {
    const dir = project('published-skills', ['@objectstack+skills@file+..+packed+objectstack-skills-18.3.0.tgz'], { 'objectstack-marker/SKILL.md': 'the released text', 'objectstack-old/SKILL.md': 'x' });
    const problems = verifyWorkspaceInstall(dir, ws);
    expect(problems.some((p) => p.includes('differ from the workspace catalog: objectstack-marker/SKILL.md'))).toBe(true);
    expect(problems.some((p) => p.includes('the workspace catalog does not: objectstack-old/SKILL.md'))).toBe(true);
  });

  it('a package the registry served is refused, by its store entry', () => {
    const dir = project('registry', ['@objectstack+skills@18.3.0'], { 'objectstack-marker/SKILL.md': MARKER });
    expect(verifyWorkspaceInstall(dir, ws).some((p) => p.includes('@objectstack/skills was installed from the registry'))).toBe(true);
  });

  it('a project with no pnpm store proves nothing, and is refused', () => {
    const dir = project('npm', [], { 'objectstack-marker/SKILL.md': MARKER });
    expect(verifyWorkspaceInstall(dir, ws).some((p) => p.includes('not installed with pnpm'))).toBe(true);
  });
});
