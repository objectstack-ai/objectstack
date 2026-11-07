// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a run's `@objectstack/*` packages come from — `run-scenarios
 * --packages published|workspace` — and the one line every record and
 * scorecard states it in.
 *
 *   published  (default) `npx -y create-objectstack@<version>`, and whatever
 *              that scaffolder installs from npm: what a customer gets. The
 *              line names the `@objectstack/spec` version each scaffolded
 *              project installed (`packages: published 18.3.0`).
 *   workspace  the next release, before it is released: this checkout's
 *              packages, built and packed exactly as the release would publish
 *              them, and installed from those tarballs. The line names the
 *              commit (`packages: workspace @ 1a2b3c4 (unreleased)`), and says
 *              so when the tree had uncommitted changes. ⛔ A workspace run is
 *              never exported to the gallery or shown (`export/record.ts`).
 *
 * How a workspace run installs, each step measured on pnpm 10.31 (the PR that
 * added this file records the readings):
 *
 *   1. Build what the release builds, for the packages it publishes: every
 *      workspace package named `@objectstack/*` or `create-objectstack` that is
 *      not `private` (`turbo run build build:dist` — `build:dist` is the
 *      Console's copy of the ui/ build, the release's `console:build`).
 *   2. `pnpm pack` each one: the tarball npm would serve — `files[]` only, and
 *      every `workspace:` range rewritten to the version. A link would let the
 *      project see files the package never ships.
 *   3. Scaffold with that `create-objectstack` tarball (`npx -y --package=`),
 *      untouched: its own install, its own skills sync, its own summary. Its
 *      `pnpm install` is pointed at the tarballs by a global pnpmfile
 *      (`npm_config_global_pnpmfile`, the one pnpm 10 reads from the
 *      environment; `pnpm_config_*` is not read) whose `readPackage` hook
 *      rewrites every `@objectstack/*` range, in every manifest, to its
 *      tarball. The project's own `package.json` is never rewritten: it pins
 *      the version, as a published scaffold does.
 *   4. Persist it: the same map as `overrides` in the project's
 *      `pnpm-workspace.yaml`, then `pnpm install` again. The pnpmfile reached
 *      only the scaffolder's install; without the overrides a later install
 *      (the agent's `pnpm add`) would re-resolve every package from npm.
 *   5. Verify, and refuse the scaffold on any miss — a silent fallback to npm
 *      would measure the release already out, under a line that says it did
 *      not: every `@objectstack/*` entry in `node_modules/.pnpm` must be a
 *      tarball (`@file+…`), and `.claude/skills/` must hold the workspace
 *      build's catalog, file for file (`packages/skills/dist/skills`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { runCommand, type CommandResult } from './project.js';

export const PACKAGES_MODES = ['published', 'workspace'] as const;
export type PackagesMode = (typeof PACKAGES_MODES)[number];

/** The package source a run states, in its record (`env.packages`) and its scorecard. */
export type PackageSource =
  | {
      source: 'published';
      /** The `@objectstack/spec` version each scaffolded project installed, distinct and sorted; empty when none was read. */
      versions: string[];
    }
  | {
      source: 'workspace';
      /** The checkout's commit, short. */
      commit: string;
      /** The tree had changes no commit holds: the packages are the commit plus those. */
      uncommitted: boolean;
    };

/** `packages: published 18.3.0` · `packages: workspace @ 1a2b3c4 (unreleased)`. */
export function packagesLine(p: PackageSource): string {
  if (p.source === 'published') {
    return `packages: published ${p.versions.length ? p.versions.join(', ') : '(no version read: no project was installed)'}`;
  }
  return `packages: workspace @ ${p.commit}${p.uncommitted ? ' + uncommitted changes' : ''} (unreleased)`;
}

/** The `@objectstack/spec` version a scaffolded project installed, or `undefined` when it holds none. */
export function installedSpecVersion(projectDir: string): string | undefined {
  try {
    const v = (JSON.parse(readFileSync(join(projectDir, 'node_modules', '@objectstack', 'spec', 'package.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && v !== '' ? v : undefined;
  } catch {
    return undefined;
  }
}

// ── workspace ───────────────────────────────────────────────────────────────

/** The scaffolder: packed with the rest, run from its tarball. */
export const SCAFFOLDER_PACKAGE = 'create-objectstack';
/** The skills catalog package, and where it ships the catalog (`create-objectstack` `skills-install.ts`). */
export const SKILLS_PACKAGE = '@objectstack/skills';
export const SKILLS_CATALOG_DIR = join('dist', 'skills');
/** Where the scaffolder's skills sync lands the catalog for its one agent. */
export const PROJECT_SKILLS_DIR = join('.claude', 'skills');

export interface WorkspacePackage {
  name: string;
  version: string;
  dir: string;
}

/** A package the release publishes: `@objectstack/*` or `create-objectstack`, and not `private`. */
export const isReleasedPackage = (p: { name?: string; private?: boolean }): boolean =>
  !p.private && typeof p.name === 'string' && (p.name.startsWith('@objectstack/') || p.name === SCAFFOLDER_PACKAGE);

/** Every workspace package the release publishes, by name (`pnpm -r ls`). */
export function releasedPackages(repo: string): WorkspacePackage[] {
  const listed = JSON.parse(execFileSync('pnpm', ['-r', 'ls', '--depth', '-1', '--json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as Array<{
    name?: string;
    version?: string;
    path: string;
    private?: boolean;
  }>;
  return listed
    .filter(isReleasedPackage)
    .map((p) => ({ name: p.name!, version: p.version ?? '', dir: p.path }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The commit a workspace run states, and whether the tree had uncommitted changes. */
export function workspaceSource(repo: string): Extract<PackageSource, { source: 'workspace' }> {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  return { source: 'workspace', commit: git('rev-parse', '--short', 'HEAD'), uncommitted: git('status', '--porcelain') !== '' };
}

/** `pnpm pack`'s file name for a package: `@objectstack/spec` 18.3.0 → `objectstack-spec-18.3.0.tgz`. */
export const tarballName = (p: { name: string; version: string }): string => `${p.name.replace(/^@/, '').replace('/', '-')}-${p.version}.tgz`;

/** The global pnpmfile: its `readPackage` hook points every packed package's range, in every manifest, at its tarball. */
export function pnpmfileSource(tarballs: ReadonlyMap<string, string>): string {
  const map = JSON.stringify(Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file}`])), null, 2);
  return [
    '// Written by run-scenarios --packages workspace. Every @objectstack/* range in every manifest',
    "// resolves to this workspace's packed build (unreleased), never to npm.",
    `const TARBALLS = ${map};`,
    "const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];",
    'module.exports = {',
    '  hooks: {',
    '    readPackage(pkg) {',
    '      for (const field of FIELDS) {',
    '        const deps = pkg[field];',
    '        if (!deps) continue;',
    '        for (const name of Object.keys(deps)) if (TARBALLS[name]) deps[name] = TARBALLS[name];',
    '      }',
    '      return pkg;',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n');
}

/** The `overrides` block appended to the project's `pnpm-workspace.yaml` (JSON strings are YAML strings). */
export function overridesBlock(tarballs: ReadonlyMap<string, string>): string {
  return [
    '',
    "# run-scenarios --packages workspace: every @objectstack/* package resolves to this workspace's",
    '# packed build (unreleased), never to npm.',
    'overrides:',
    ...[...tarballs].map(([name, file]) => `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${file}`)}`),
    '',
  ].join('\n');
}

export interface WorkspacePackages {
  source: Extract<PackageSource, { source: 'workspace' }>;
  /** Package name → absolute path of its tarball. */
  tarballs: Map<string, string>;
  /** The global pnpmfile the scaffolder's install runs under. */
  pnpmfile: string;
  /** The workspace build of the skills catalog, which `.claude/skills/` must equal. */
  skillsCatalog: string;
}

export class WorkspacePackagesError extends Error {
  constructor(message: string) {
    super(`--packages workspace: ${message}`);
    this.name = 'WorkspacePackagesError';
  }
}

export interface PrepareOptions {
  /** Run a command; the real one by default. */
  run?: typeof runCommand;
  /**
   * Build the packages before they are packed. Default: the release's own
   * build, `turbo run build build:dist`, filtered to them. A turbo cache hit
   * makes a second run cheap.
   */
  build?: (repo: string, packages: readonly WorkspacePackage[], run: typeof runCommand) => Promise<CommandResult>;
}

const failed = (r: CommandResult) => `\`${r.command}\` exited ${r.exit}:\n${r.tail}`;

export function releaseBuild(repo: string, packages: readonly WorkspacePackage[], run: typeof runCommand): Promise<CommandResult> {
  return run('pnpm', ['exec', 'turbo', 'run', 'build', 'build:dist', ...packages.map((p) => `--filter=${p.name}`)], repo, 90 * 60_000);
}

/** Steps 1 and 2: build and pack every released package into `dest`. */
export async function prepareWorkspacePackages(repo: string, dest: string, opts: PrepareOptions = {}): Promise<WorkspacePackages> {
  const run = opts.run ?? runCommand;
  const source = workspaceSource(repo); // read before the build: the commit the packages are built from
  const packages = releasedPackages(repo);
  for (const required of [SCAFFOLDER_PACKAGE, SKILLS_PACKAGE]) {
    if (!packages.some((p) => p.name === required)) throw new WorkspacePackagesError(`${repo} holds no publishable ${required}`);
  }
  const built = await (opts.build ?? releaseBuild)(repo, packages, run);
  if (built.exit !== 0) throw new WorkspacePackagesError(`the build failed, so nothing was packed: ${failed(built)}`);

  mkdirSync(dest, { recursive: true });
  const tarballs = new Map<string, string>();
  const queue = [...packages];
  const pack = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const r = await run('pnpm', ['pack', '--pack-destination', dest], p.dir);
      const file = join(dest, tarballName(p));
      if (r.exit !== 0 || !existsSync(file)) throw new WorkspacePackagesError(`${p.name} did not pack to ${file}: ${failed(r)}`);
      tarballs.set(p.name, file);
    }
  };
  await Promise.all(Array.from({ length: 4 }, pack));
  const ordered = new Map([...tarballs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  const pnpmfile = join(dest, 'workspace-packages.pnpmfile.cjs');
  writeFileSync(pnpmfile, pnpmfileSource(ordered));
  const skillsDir = packages.find((p) => p.name === SKILLS_PACKAGE)!.dir;
  return { source, tarballs: ordered, pnpmfile, skillsCatalog: join(skillsDir, SKILLS_CATALOG_DIR) };
}

/** Step 3's command and environment: the packed scaffolder, its install pointed at the tarballs. */
export function workspaceScaffolder(ws: WorkspacePackages): { createCommand: string[]; env: Record<string, string> } {
  return {
    createCommand: ['npx', '-y', `--package=${ws.tarballs.get(SCAFFOLDER_PACKAGE)!}`, SCAFFOLDER_PACKAGE],
    env: { npm_config_global_pnpmfile: ws.pnpmfile },
  };
}

/** Every file under `dir`, relative, sorted; a symbolic link is listed as one (and never matches a file). */
function treeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const child = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(child);
      else out.push(e.isSymbolicLink() ? `${child} (symbolic link)` : child);
    }
  };
  if (existsSync(dir)) walk('');
  return out.sort();
}

/**
 * Step 5: what keeps the project from being the workspace's, one line each;
 * empty when every `@objectstack/*` package is a tarball and `.claude/skills/`
 * is the workspace catalog, file for file.
 */
export function verifyWorkspaceInstall(projectDir: string, ws: Pick<WorkspacePackages, 'tarballs' | 'skillsCatalog'>): string[] {
  const problems: string[] = [];
  const store = join(projectDir, 'node_modules', '.pnpm');
  if (!existsSync(store)) {
    problems.push(`${relative(projectDir, store)} does not exist: the project was not installed with pnpm, so nothing proves where its packages came from`);
  } else {
    for (const entry of readdirSync(store).sort()) {
      const packed = [...ws.tarballs.keys()].find((name) => entry.startsWith(`${name.replace('/', '+')}@`));
      if (packed && !entry.startsWith(`${packed.replace('/', '+')}@file+`)) problems.push(`${packed} was installed from the registry (node_modules/.pnpm/${entry}), not from the workspace tarball`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!ws.tarballs.has(name)) continue;
    const at = join(projectDir, 'node_modules', name);
    let real = '';
    try {
      real = realpathSync(at);
    } catch {
      problems.push(`${name} is not installed`);
      continue;
    }
    if (!real.includes('@file+')) problems.push(`${name} resolves to ${real}, not to the workspace tarball`);
  }

  const want = treeFiles(ws.skillsCatalog);
  const skills = join(projectDir, PROJECT_SKILLS_DIR);
  const got = treeFiles(skills);
  if (want.length === 0) problems.push(`the workspace catalog ${ws.skillsCatalog} holds no file`);
  const missing = want.filter((f) => !got.includes(f));
  const extra = got.filter((f) => !want.includes(f));
  const differ = want.filter((f) => got.includes(f) && !readFileSync(join(skills, f)).equals(readFileSync(join(ws.skillsCatalog, f))));
  if (missing.length) problems.push(`${PROJECT_SKILLS_DIR}/ lacks ${missing.length} file(s) of the workspace catalog: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  if (extra.length) problems.push(`${PROJECT_SKILLS_DIR}/ holds ${extra.length} file(s) the workspace catalog does not: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}`);
  if (differ.length) problems.push(`${PROJECT_SKILLS_DIR}/ holds ${differ.length} file(s) that differ from the workspace catalog: ${differ.slice(0, 5).join(', ')}${differ.length > 5 ? ', …' : ''}`);
  return problems;
}

/**
 * Steps 4 and 5, after the scaffolder ran: persist the overrides, install
 * again, verify. Answers the install's result, or a failed result whose tail
 * names every problem — the scaffold is then refused like a failed one.
 */
export async function settleWorkspaceProject(projectDir: string, ws: WorkspacePackages, run: typeof runCommand = runCommand): Promise<CommandResult> {
  const yamlFile = join(projectDir, 'pnpm-workspace.yaml');
  const before = existsSync(yamlFile) ? readFileSync(yamlFile, 'utf8') : '';
  const refuse = (why: string): CommandResult => ({ command: 'run-scenarios --packages workspace', exit: 1, tail: why, ms: 0 });
  if (/^overrides\s*:/m.test(before)) return refuse(`${yamlFile} already declares \`overrides\`: the workspace tarballs cannot be added to it without rewriting the scaffold's own`);
  writeFileSync(yamlFile, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${overridesBlock(ws.tarballs)}`);
  // The lockfile was written under the pnpmfile, and the overrides change it: never a frozen install (pnpm's default under `CI`).
  const installed = await run('pnpm', ['install', '--no-frozen-lockfile'], projectDir);
  if (installed.exit !== 0) return installed;
  const problems = verifyWorkspaceInstall(projectDir, ws);
  if (problems.length) return refuse(`the project is not on the workspace packages:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  return installed;
}
