// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The scaffolded Dockerfile's build stage must install from the lockfile the
// scaffolded project actually carries.
//
// ## The defect
//
// The stage was `COPY package*.json ./` + `RUN npm ci`. Where pnpm is on PATH
// the scaffolder installs with pnpm and writes `pnpm-lock.yaml` and no
// `package-lock.json`, so `npm ci` exited 1 with EUSAGE and `docker build`
// stopped before `os build` ran: the README's "Ship it" step failed for every
// project scaffolded that way.
//
// ## What is pinned here, and why by RUNNING the stage
//
// A grep for `pnpm install` in the file would stay green against a stage that
// copies the wrong files, which is the shape the defect had. So each leg reads
// the stage out of SCAFFOLDED output (`copyDir`, as `runtime-image.test.ts`
// does), emulates its `COPY` into an empty directory (no `node_modules`, only
// what the stage names), and runs its `RUN` line under `/bin/sh`, which is
// dash in `node:22-slim` and here. A leg passes only if the real install
// command succeeds from that clean copy.
//
// ## Hermetic by construction
//
// The real stage downloads from the registry, and Corepack fetches pnpm.
// Neither may decide this file's verdict (`scaffold-next-steps-pm.test.ts`
// records the merge-queue red an ambient pnpm outside the repo once caused).
// So:
//
//   - the fixture is the scaffolded project with its registry dependencies
//     replaced by ONE local-directory dependency. A project with no
//     dependencies would not do: `pnpm install --frozen-lockfile` answers
//     "Already up to date" for it even with NO lockfile. With one dependency
//     both package managers refuse a missing or drifted lockfile, offline.
//     pnpm spells it `link:`, npm `file:`; each creates a symlink, and the
//     stage's COPY leaves its target behind, as Docker would.
//   - `corepack` is a stub that runs this repository's own pinned pnpm
//     against the stage's directory, and refuses when that pnpm is outside
//     the major the Dockerfile asks for, so a substitute never stands in
//     silently. pnpm itself is not on the stage's PATH.
//   - every install runs with `npm_config_offline=true`.
//
// What only the registry and a real Corepack can answer was measured once,
// when this stage landed, against projects scaffolded for real: both package
// managers' projects built their artifact through this stage, and an UNPINNED
// Corepack resolved the registry's newest pnpm, which the Corepack bundled
// with Node 22 could not run. That is why the stage pins a major, and why the
// last block below holds it to the one the template's CI workflow pins.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { copyDir } from './template-copy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const BLANK = path.join(PKG_ROOT, 'src', 'templates', 'blank');
const CI_WORKFLOW = path.join(BLANK, '.github', 'workflows', 'ci.yml');
const DOCS_PAGE = path.resolve(HERE, '..', '..', '..', 'content', 'docs', 'deployment', 'self-hosting.mdx');

/** The build stage's dependency install: the COPY ahead of it and its RUN line. */
interface InstallStep {
  copySources: string[];
  run: string;
}

/**
 * Read the install step out of a Dockerfile: the first `COPY` after the
 * `FROM node:… AS build` line and the first `RUN` after that `COPY`, with
 * backslash continuations joined. Throws on any other shape, so a reshaped
 * stage fails here by name instead of passing over nothing.
 */
function readInstallStep(dockerfile: string): InstallStep {
  const instructions: string[] = [];
  let pending = '';
  for (const line of dockerfile.split('\n')) {
    if (pending === '' && /^\s*(#|$)/.test(line)) continue;
    if (line.endsWith('\\')) {
      pending += line.slice(0, -1);
      continue;
    }
    instructions.push((pending + line).trim());
    pending = '';
  }
  const from = instructions.findIndex((i) => /^FROM node:\S+ AS build$/.test(i));
  const copy = instructions.findIndex((i, n) => n > from && i.startsWith('COPY '));
  const run = instructions.findIndex((i, n) => n > copy && i.startsWith('RUN '));
  if (from === -1 || copy === -1 || run === -1) {
    throw new Error('Dockerfile has no `FROM node:… AS build` stage with a COPY followed by a RUN');
  }
  const words = instructions[copy].split(/\s+/).slice(1);
  if (words.length < 2 || words.some((w) => w.startsWith('--'))) {
    throw new Error(`unexpected COPY shape in the build stage: ${instructions[copy]}`);
  }
  return { copySources: words.slice(0, -1), run: instructions[run].slice('RUN '.length) };
}

/**
 * Docker's COPY of top-level sources into an empty directory: a literal
 * source that is missing fails the build; a wildcard may match nothing.
 * Returns the names copied.
 */
function dockerCopy(fromDir: string, toDir: string, sources: string[]): string[] {
  const copied: string[] = [];
  const entries = fs.readdirSync(fromDir);
  for (const source of sources) {
    if (!source.includes('*')) {
      if (!entries.includes(source)) throw new Error(`COPY failed: ${source} not found`);
      fs.copyFileSync(path.join(fromDir, source), path.join(toDir, source));
      copied.push(source);
      continue;
    }
    const re = new RegExp(
      `^${source.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
    );
    for (const name of entries.filter((e) => re.test(e))) {
      fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
      copied.push(name);
    }
  }
  return copied.sort();
}

/** POSIX single-quoting for a value baked into a shell script. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function which(cmd: string): string {
  try {
    return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`\`${cmd}\` is not on PATH; this test runs the stage's real ${cmd}`);
  }
}

/** Offline, and nothing else changed: the env every install below runs under. */
const OFFLINE = { ...process.env, npm_config_offline: 'true' };

let work: string;
let bin: string;
let corepackLog: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-build-stage-'));
  bin = path.join(work, 'bin');
  corepackLog = path.join(work, 'corepack.log');
  fs.mkdirSync(bin);
  // The stage's PATH: node and npm, a stub corepack, and no pnpm.
  fs.symlinkSync(which('node'), path.join(bin, 'node'));
  fs.symlinkSync(which('npm'), path.join(bin, 'npm'));
  const pnpm = which('pnpm');
  fs.writeFileSync(
    path.join(bin, 'corepack'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${shq(corepackLog)}`,
      'case "$1" in',
      '  pnpm@*) want="${1#pnpm@}"; shift ;;',
      '  *) echo "corepack stub: unexpected invocation: corepack $*" >&2; exit 64 ;;',
      'esac',
      'dir=$PWD',
      // From inside this package, Corepack resolves the repository's pinned
      // pnpm, which CI has already materialised: no fetch, no ambient default.
      `cd ${shq(PKG_ROOT)} || exit 70`,
      `PATH=${shq(process.env.PATH ?? '')}; export PATH`,
      `have=$(${shq(pnpm)} -C "$dir" --version) || exit 71`,
      'case "$have" in',
      '  "$want"|"$want".*) ;;',
      '  *) echo "corepack stub: the stage asks for pnpm@$want; the pnpm standing in for it is $have" >&2; exit 65 ;;',
      'esac',
      `exec ${shq(pnpm)} -C "$dir" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/**
 * Scaffold the blank template into `name`, swap its registry dependencies for
 * one local-directory dependency (see the header), and run `install` there.
 */
function scaffoldFixture(name: string, spec: 'link:' | 'file:', install: string[] | null): string {
  const dir = path.join(work, name);
  copyDir(BLANK, dir, []);
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  delete pkg.devDependencies;
  pkg.dependencies = { 'local-dep': `${spec}./local-dep` };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  fs.mkdirSync(path.join(dir, 'local-dep'));
  fs.writeFileSync(
    path.join(dir, 'local-dep', 'package.json'),
    JSON.stringify({ name: 'local-dep', version: '1.0.0' }) + '\n',
  );
  if (install) {
    const [cmd, ...args] = install;
    // pnpm runs from inside this package for the same reason the stub does.
    const cwd = cmd === 'pnpm' ? PKG_ROOT : dir;
    const argv = cmd === 'pnpm' ? ['-C', dir, ...args] : args;
    execFileSync(which(cmd), argv, { cwd, env: OFFLINE, stdio: 'pipe' });
  }
  return dir;
}

interface StageRun {
  status: number | null;
  output: string;
  copied: string[];
  corepackCalls: string[];
  app: string;
}

/** Run the scaffolded Dockerfile's install step against `project`, from a clean copy. */
function runInstallStep(project: string): StageRun {
  const step = readInstallStep(fs.readFileSync(path.join(project, 'Dockerfile'), 'utf8'));
  const app = fs.mkdtempSync(path.join(work, 'app-'));
  const copied = dockerCopy(project, app, step.copySources);
  fs.rmSync(corepackLog, { force: true });
  const result = spawnSync('/bin/sh', ['-c', step.run], {
    cwd: app,
    env: { ...OFFLINE, PATH: `${bin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  const corepackCalls = fs.existsSync(corepackLog)
    ? fs.readFileSync(corepackLog, 'utf8').trim().split('\n')
    : [];
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    copied,
    corepackCalls,
    app,
  };
}

/** The dependency link an install leaves behind; its target is absent by design. */
const installedLink = (app: string): boolean =>
  fs.lstatSync(path.join(app, 'node_modules', 'local-dep'), { throwIfNoEntry: false })?.isSymbolicLink() ??
  false;

describe('scaffolded Dockerfile build stage installs from the project lockfile', () => {
  it('a pnpm-installed project: the stage takes pnpm-lock.yaml and runs a frozen pnpm install', () => {
    const project = scaffoldFixture('pnpm-project', 'link:', ['pnpm', 'install']);
    expect(fs.existsSync(path.join(project, 'pnpm-lock.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'package-lock.json'))).toBe(false);

    const run = runInstallStep(project);
    expect(run.status, `the stage's install failed for a pnpm project:\n${run.output}`).toBe(0);
    expect(run.copied).toEqual(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
    expect(run.corepackCalls).toEqual([expect.stringMatching(/^pnpm@\d+ install --frozen-lockfile$/)]);
    expect(installedLink(run.app), 'no install ran: node_modules/local-dep is missing').toBe(true);
  }, 30_000);

  it('an npm-installed project: the stage takes package-lock.json and runs npm ci', () => {
    const project = scaffoldFixture('npm-project', 'file:', ['npm', 'install', '--no-audit', '--no-fund']);
    expect(fs.existsSync(path.join(project, 'package-lock.json'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'pnpm-lock.yaml'))).toBe(false);

    const run = runInstallStep(project);
    expect(run.status, `the stage's install failed for an npm project:\n${run.output}`).toBe(0);
    expect(run.copied).toEqual(expect.arrayContaining(['package-lock.json', 'package.json']));
    expect(run.copied).not.toContain('pnpm-lock.yaml');
    expect(run.corepackCalls).toEqual([]);
    expect(installedLink(run.app), 'no install ran: node_modules/local-dep is missing').toBe(true);
  }, 30_000);

  // The leg that proves the two above can fail: with no lockfile there is
  // nothing to install from, and the stage has to say so rather than install
  // something unpinned.
  it('a project with no lockfile: the stage stops and names the remedy', () => {
    const project = scaffoldFixture('no-lockfile', 'file:', null);

    const run = runInstallStep(project);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/lockfile/i);
    expect(run.corepackCalls).toEqual([]);
    expect(installedLink(run.app)).toBe(false);
  }, 30_000);
});

describe('the build stage has one source', () => {
  const buildStage = (text: string): string => {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith('# ── Build stage'));
    const end = lines.findIndex((l, n) => n > start && l.startsWith('RUN npx os build'));
    if (start === -1 || end === -1) throw new Error('no build stage found');
    return lines.slice(start, end + 1).join('\n');
  };

  // The docs page repeated the broken stage; this keeps it showing the file
  // the scaffolder writes. The runtime stage is not compared: the page pins a
  // release tag, the template a tag the scaffolder resolves.
  it('the self-hosting guide shows the same build stage the template ships', () => {
    const page = fs.readFileSync(DOCS_PAGE, 'utf8');
    const fence = /```dockerfile title="Dockerfile"\n([\s\S]*?)```/.exec(page);
    expect(fence, 'self-hosting.mdx has no ```dockerfile title="Dockerfile" block').not.toBeNull();
    expect(
      buildStage(fence![1]),
      'content/docs/deployment/self-hosting.mdx shows a build stage the scaffolder does not write',
    ).toBe(buildStage(fs.readFileSync(path.join(BLANK, 'Dockerfile'), 'utf8')));
  });

  it('pins the same pnpm major as the template CI workflow', () => {
    const run = readInstallStep(fs.readFileSync(path.join(BLANK, 'Dockerfile'), 'utf8')).run;
    const dockerMajor = /\bcorepack pnpm@(\d+)\b/.exec(run)?.[1];
    expect(dockerMajor, 'the build stage no longer runs pnpm through `corepack pnpm@MAJOR`').toBeDefined();

    const doc = parseYaml(fs.readFileSync(CI_WORKFLOW, 'utf8')) as {
      jobs: Record<string, { steps?: Array<{ uses?: string; with?: { version?: unknown } }> }>;
    };
    const setup = Object.values(doc.jobs)
      .flatMap((job) => job.steps ?? [])
      .find((step) => step.uses?.startsWith('pnpm/action-setup'));
    const ciMajor = String(setup?.with?.version ?? '').split('.')[0];
    expect(
      dockerMajor,
      'the Dockerfile and .github/workflows/ci.yml install with different pnpm majors',
    ).toBe(ciMajor);
  });
});
