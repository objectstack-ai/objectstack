// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The skills phase of a real scaffold, end to end. Two properties:
//
//   1. Commit fd75728bc — a scaffolded project's FIRST `git add -A` stages the
//      skills catalog exactly once, as real files, and a clone of that commit
//      yields readable `SKILL.md` files.
//   2. Ruling A on the skills-catalog binding (record 6096124407) — the
//      installed skill set IS the catalog of the `@objectstack/skills` package
//      the project depends on, at `@objectstack/spec`'s range: the same names,
//      the same count, read out of the project's own node_modules and never
//      from GitHub.
//
// ## The measurement the stubs encode
//
// `skills-install.ts` carries it: `skills@1.7.2` against the published
// `@objectstack/skills@18.0.0-next.0`. `experimental_sync` discovers skills in
// the project's DIRECT dependencies only (`skills/` or `dist/skills/` of each),
// and writes, for `--agent claude-code`:
//
//   --copy -y    .claude/skills/<skill>  real files, plus skills-lock.json
//   -y           .agents/skills/<skill>  links into node_modules/<package>/…
//                .claude/skills/<skill>  links into .agents/skills/<skill>
//
// With nothing to read it prints "Nothing to sync." and exits 0; a skill whose
// directory is already there and whose lock entry is not a sync's (one from
// `skills add`) is SKIPPED, left as it was, and the run still exits 0.
//
// ## Why both CLIs are stubbed, and how the stubs are kept honest
//
// The real `<pm> install` and the real skills CLI need the network, so a test
// that ran them would be measuring the runner. The stubs encode the measured
// behaviour instead, and three properties keep them from becoming a mirror
// that agrees with whatever the scaffolder does:
//
//   * the `pnpm` stub's `install` materializes `@objectstack/skills` ONLY when
//     the project's `package.json` declares it, in the layout the package
//     publishes (`dist/skills/<skill>/SKILL.md`, beside the catalog README the
//     real tarball carries). A template that stops depending on the package
//     gets no catalog, exactly as a real install would.
//   * the `npx` stub REFUSES (exit 3) any argv it has no measured row for: a
//     CLI version nobody measured, any `skills add` (the GitHub path), an
//     agent nobody measured. Point the scaffolder back at GitHub, or move the
//     pin without re-measuring, and the end-to-end case fails loudly instead of
//     passing against an invented layout. `MEASURED_CLI` below is written out,
//     never imported, for that reason.
//   * the linked row is exercised too, by the vacuity case, and the
//     single-copy assertions must FAIL on it. An assertion that cannot fail is
//     the one failure mode a fixture-driven test really has.
//
// The catalog side of property 2 is read twice: off the project's own
// node_modules (what the package really holds), and against `STUB_CATALOG`
// (what the stub install put there). The second reading is the one that makes
// an empty install go red rather than compare empty with empty.
//
// The end-to-end cases run the REAL CLI through `tsx` under a stubbed PATH —
// the pattern `scaffold-next-steps-pm.test.ts` established, and for the same
// reason: `index.ts` calls `program.parse()` at import, so nothing in it can
// be reached any other way. Their harness guard is the stub's own argv
// receipt: if the child resolved the ambient `npx` instead of ours, there is
// no receipt and the case fails rather than quietly measuring the network.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SKILLS_AGENT,
  DEFAULT_SKILLS_DIR,
  EXAMPLE_OTHER_AGENT,
  SKILLS_CLI,
  SKILLS_INSTALL_COMMAND,
  SKILLS_PACKAGE,
  SKILLS_PACKAGE_CATALOG_DIR,
  listSkills,
  skillsInstallHint,
  skillsPackageDir,
  skillsSyncArgs,
} from './skills-install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');
const TEMPLATE_GITIGNORE = path.join(PKG_ROOT, 'src', 'templates', 'blank', '_gitignore');

/** The skills the stub install puts in the package. Three, so "twice" is unmistakably six. */
const STUB_CATALOG = ['objectstack-data', 'objectstack-query', 'objectstack-ui'];

/** The CLI version the rows below were measured with — written out, never imported. */
const MEASURED_CLI = 'skills@1.7.2';

/** A stub `pnpm` whose `install` materializes the declared catalog package. */
function pnpmStub(): string {
  return `import fs from 'node:fs';
import path from 'node:path';
const CATALOG = ${JSON.stringify(STUB_CATALOG)};
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('10.31.0'); process.exit(0); }
if (argv[0] !== 'install' || process.env.PNPM_STUB_REGISTRY === 'empty') process.exit(0);
const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const range = { ...pkg.dependencies, ...pkg.devDependencies }['@objectstack/skills'];
if (range === undefined) process.exit(0);
const root = path.join(cwd, 'node_modules', '@objectstack', 'skills');
const catalog = path.join(root, 'dist', 'skills');
fs.mkdirSync(catalog, { recursive: true });
fs.writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify({ name: '@objectstack/skills', version: String(range).replace(/^[~^]/, '') }) + '\\n',
);
fs.writeFileSync(path.join(catalog, 'README.md'), '# catalog\\n');
for (const skill of CATALOG) {
  fs.mkdirSync(path.join(catalog, skill, 'references'), { recursive: true });
  fs.writeFileSync(path.join(catalog, skill, 'SKILL.md'), '---\\nname: ' + skill + '\\n---\\n\\n# ' + skill + '\\n');
  fs.writeFileSync(path.join(catalog, skill, 'references', 'guide.md'), '# guide for ' + skill + '\\n');
}
`;
}

/** A stub `npx` reproducing the measured `experimental_sync` rows; it records every argv. */
function npxStub(): string {
  return `import fs from 'node:fs';
import path from 'node:path';
const MEASURED_CLI = ${JSON.stringify(MEASURED_CLI)};
const SHAPES = {
  'copy:claude-code': [{ dir: '.claude/skills', kind: 'copy' }],
  'link:claude-code': [
    { dir: '.agents/skills', kind: 'link-package' },
    { dir: '.claude/skills', kind: 'link', into: '../../.agents/skills' },
  ],
};
const argv = process.argv.slice(2);
if (process.env.NPX_STUB_RECEIPT) {
  fs.appendFileSync(process.env.NPX_STUB_RECEIPT, JSON.stringify(argv) + '\\n');
}
const args = argv[0] === '-y' ? argv.slice(1) : argv;
const [cli, command, ...rest] = args;
const at = rest.indexOf('--agent');
const key = (rest.includes('--copy') ? 'copy' : 'link') + ':' + (at < 0 ? '' : rest[at + 1]);
if (cli !== MEASURED_CLI || command !== 'experimental_sync' || !rest.includes('-y') || !SHAPES[key]) {
  console.error('npx-stub: no measured shape for: ' + args.join(' '));
  process.exit(3);
}
const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const deps = new Set(
  ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys(pkg[field] ?? {})),
);
const found = [];
for (const dep of deps) {
  const dir = path.join(cwd, 'node_modules', ...dep.split('/'));
  let version = null;
  try { version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch {}
  for (const sub of ['skills', 'dist/skills']) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch {}
    for (const name of names) {
      if (!fs.existsSync(path.join(dir, sub, name, 'SKILL.md'))) continue;
      found.push({ dep, name, version, src: path.join(dir, sub, name), skillPath: sub + '/' + name + '/SKILL.md' });
    }
  }
}
if (found.length === 0) { console.log('Nothing to sync.'); process.exit(0); }
const lockPath = path.join(cwd, 'skills-lock.json');
let prior = { version: 1, skills: {} };
try { prior = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
const synced = found.filter((skill) => {
  const taken = SHAPES[key].some((dest) => fs.existsSync(path.join(cwd, dest.dir, skill.name)));
  if (taken && prior.skills?.[skill.name]?.sourceType !== 'node_modules') {
    console.warn('Skipped ' + skill.name + ' from ' + skill.dep + ': installed with skills add');
    return false;
  }
  return true;
});
for (const dest of SHAPES[key]) {
  fs.mkdirSync(path.join(cwd, dest.dir), { recursive: true });
  for (const skill of synced) {
    const target = path.join(cwd, dest.dir, skill.name);
    if (dest.kind === 'copy') fs.cpSync(skill.src, target, { recursive: true });
    else if (dest.kind === 'link-package') fs.symlinkSync(path.relative(path.dirname(target), skill.src), target);
    else fs.symlinkSync(dest.into + '/' + skill.name, target);
  }
}
const lock = { version: 1, skills: { ...prior.skills } };
for (const s of synced) {
  lock.skills[s.name] = { source: s.dep, sourceType: 'node_modules', skillPath: s.skillPath, version: s.version };
}
fs.writeFileSync(path.join(cwd, 'skills-lock.json'), JSON.stringify(lock, null, 2) + '\\n');
console.log('npx-stub: synced ' + synced.length + ' skills');
`;
}

function writeStubs(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, body] of [
    ['npx', npxStub()],
    ['pnpm', pnpmStub()],
  ] as const) {
    const js = path.join(binDir, `${name}-stub.mjs`);
    fs.writeFileSync(js, body, 'utf8');
    fs.writeFileSync(path.join(binDir, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    fs.chmodSync(path.join(binDir, name), 0o755);
  }
}

interface Staged {
  skillMd: string[];
  symlinks: string[];
  all: string[];
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/** `git init && git add -A`, then what the index holds. */
function stageAll(project: string): Staged {
  git(project, 'init', '-q', '.');
  git(project, 'add', '-A');
  const all = git(project, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  const symlinks = git(project, 'ls-files', '-s')
    .split('\n')
    .filter((l) => l.startsWith('120000'))
    .map((l) => l.split('\t')[1]);
  return { all, symlinks, skillMd: all.filter((p) => p.endsWith('SKILL.md')) };
}

/** Commit, clone into a fresh directory, and report what a cloner can read. */
function cloneAndRead(project: string, into: string) {
  git(project, 'commit', '-qm', 'initial commit');
  execFileSync('git', ['clone', '-q', project, into], { encoding: 'utf8' });
  const tracked = git(into, 'ls-files').split('\n').filter(Boolean);
  const skillMd = tracked.filter((p) => p.endsWith('SKILL.md'));
  const readable = skillMd.filter((p) => {
    const abs = path.join(into, p);
    return fs.existsSync(abs) && fs.statSync(abs).size > 0;
  });
  const dangling = tracked.filter((p) => {
    const abs = path.join(into, p);
    return fs.lstatSync(abs).isSymbolicLink() && !fs.existsSync(abs);
  });
  return { tracked, skillMd, readable, dangling };
}

let TMP: string;
let BIN: string;

/** Run the real scaffolder under the stubs; returns its stdout and the argv the npx stub saw. */
function scaffold(name: string, flags: string[] = [], env: Record<string, string> = {}) {
  const receipt = path.join(TMP, `${name}.npx-argv.log`);
  const stdout = execFileSync(TSX, [INDEX_TS, name, ...flags], {
    cwd: TMP,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      NPX_STUB_RECEIPT: receipt,
      PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  const argv: string[][] = fs.existsSync(receipt)
    ? fs.readFileSync(receipt, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { project: path.join(TMP, name), stdout, argv };
}

/** The closing summary's skills block — what the run tells the reader about skills. */
function skillsBlock(stdout: string): string {
  return stdout.slice(stdout.lastIndexOf('AI Skills'));
}

const catalogOf = (project: string) =>
  listSkills(path.join(skillsPackageDir(project), SKILLS_PACKAGE_CATALOG_DIR));

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-single-copy-'));
  BIN = path.join(TMP, 'bin');
  writeStubs(BIN);
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── 1. the command itself ───────────────────────────────────────────────────
describe('the skills install command reads the installed package, for one agent', () => {
  it('syncs from node_modules and names no GitHub source', () => {
    expect(SKILLS_INSTALL_COMMAND).toContain(' experimental_sync ');
    expect(SKILLS_INSTALL_COMMAND).not.toMatch(/skills add|objectstack-ai\/|github/i);
  });

  it('copies the catalog instead of linking into node_modules', () => {
    expect(SKILLS_INSTALL_COMMAND.split(' ')).toContain('--copy');
  });

  it('names one agent, once, and never all of them', () => {
    const agents = SKILLS_INSTALL_COMMAND.match(/--agent\s+(\S+)/g) ?? [];
    expect(agents).toEqual([`--agent ${DEFAULT_SKILLS_AGENT}`]);
    expect(SKILLS_INSTALL_COMMAND).not.toMatch(/--agent\s+'?\*|--all/);
  });

  it('runs the skills CLI at a pinned version', () => {
    expect(SKILLS_CLI).toMatch(/^skills@\d+\.\d+\.\d+$/);
    expect(SKILLS_INSTALL_COMMAND.startsWith(`npx -y ${SKILLS_CLI} experimental_sync `)).toBe(true);
  });

  // The printed hint and the executed command must come out of ONE builder:
  // a user told to run something the scaffolder never ran is how a project
  // acquires a second copy, or a catalog from the wrong version.
  it('the printed hint differs from what runs only by the agent name', () => {
    expect(skillsInstallHint(DEFAULT_SKILLS_AGENT)).toBe(
      SKILLS_INSTALL_COMMAND.replace('npx -y ', 'npx '),
    );
    expect(skillsInstallHint(EXAMPLE_OTHER_AGENT)).toBe(
      skillsInstallHint(DEFAULT_SKILLS_AGENT).replace(
        `--agent ${DEFAULT_SKILLS_AGENT}`,
        `--agent ${EXAMPLE_OTHER_AGENT}`,
      ),
    );
    expect(skillsSyncArgs(EXAMPLE_OTHER_AGENT)).toContain(`--agent ${EXAMPLE_OTHER_AGENT}`);
  });

  it('listSkills reads real skill directories only, sorted', () => {
    const dir = path.join(TMP, 'list-skills');
    for (const skill of ['b-skill', 'a-skill']) {
      fs.mkdirSync(path.join(dir, skill), { recursive: true });
      fs.writeFileSync(path.join(dir, skill, 'SKILL.md'), '# x\n');
    }
    fs.mkdirSync(path.join(dir, 'not-a-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# catalog\n');
    fs.symlinkSync('a-skill', path.join(dir, 'linked-skill'));
    expect(listSkills(dir)).toEqual(['a-skill', 'b-skill']);
    expect(listSkills(path.join(TMP, 'no-such-dir'))).toEqual([]);
  });
});

// ── 2. end to end: a real scaffold, staged and cloned ───────────────────────
describe('a scaffolded project installs the package catalog, once', () => {
  let run: ReturnType<typeof scaffold>;
  let staged: Staged;

  beforeAll(() => {
    run = scaffold('staged-once-app');
    staged = stageAll(run.project);
  });

  // Harness guard: without a receipt the child ran SOME other npx and every
  // assertion below would be measuring that instead.
  it("ran the stubbed skills CLI, with the scaffolder's own argv", () => {
    expect(run.argv, 'the scaffolder never reached the stubbed npx').toEqual([
      SKILLS_INSTALL_COMMAND.split(' ').slice(1),
    ]);
  });

  it("depends on @objectstack/skills at @objectstack/spec's exact version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(run.project, 'package.json'), 'utf8'));
    const spec = pkg.dependencies?.['@objectstack/spec'];
    // An exact version, no `^`/`~`: the docs prescribe exact pins on the v18 line.
    expect(spec).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.devDependencies?.[SKILLS_PACKAGE]).toBe(spec);
  });

  it("installs exactly the package's catalog — the same count, the same names", () => {
    const catalog = catalogOf(run.project);
    expect(catalog, 'the stub install did not put the catalog in node_modules').toEqual(STUB_CATALOG);
    const installed = listSkills(path.join(run.project, DEFAULT_SKILLS_DIR));
    expect(installed).toHaveLength(catalog.length);
    expect(installed).toEqual(catalog);
  });

  it('writes the catalog to exactly one directory', () => {
    const roots = new Set(staged.skillMd.map((p) => p.split('/')[0]));
    expect([...roots]).toEqual([DEFAULT_SKILLS_DIR.split('/')[0]]);
    expect(fs.existsSync(path.join(run.project, '.agents'))).toBe(false);
  });

  it('stages one SKILL.md per skill — not two, not three', () => {
    expect(staged.skillMd).toHaveLength(STUB_CATALOG.length);
  });

  it('stages no symlinks at all', () => {
    expect(staged.symlinks).toEqual([]);
  });

  it('stages the lockfile, which records the package as the source of every skill', () => {
    expect(staged.all).toContain('skills-lock.json');
    const lock = JSON.parse(fs.readFileSync(path.join(run.project, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills).sort()).toEqual(STUB_CATALOG);
    for (const entry of Object.values(lock.skills) as Array<{ source: string; sourceType: string }>) {
      expect(entry).toMatchObject({ source: SKILLS_PACKAGE, sourceType: 'node_modules' });
    }
  });

  it('yields readable SKILL.md files when that commit is cloned', () => {
    const clone = cloneAndRead(run.project, path.join(TMP, 'clone-staged-once'));
    expect(clone.skillMd).toHaveLength(STUB_CATALOG.length);
    expect(clone.readable).toEqual(clone.skillMd);
    expect(clone.dangling).toEqual([]);
  });

  it('the summary names the package version and the re-install command, and no GitHub source', () => {
    const block = skillsBlock(run.stdout);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(skillsPackageDir(run.project), 'package.json'), 'utf8'),
    );
    expect(block).toContain(`${DEFAULT_SKILLS_DIR} from ${SKILLS_PACKAGE}@${pkg.version}`);
    expect(block).toContain(skillsInstallHint(DEFAULT_SKILLS_AGENT));
    expect(block).toContain(skillsInstallHint(EXAMPLE_OTHER_AGENT));
    expect(run.stdout).not.toMatch(/skills add|objectstack-ai\/objectstack/);
  });
});

// ── 3. the two opt-outs, and an absent package ──────────────────────────────
describe('without a package to read, no skills — and the run says how to get them', () => {
  it('--skip-install: nothing in node_modules, so no sync; the summary names install-then-sync', () => {
    const run = scaffold('no-install-app', ['--skip-install']);
    expect(run.argv).toEqual([]);
    expect(fs.existsSync(path.join(run.project, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(run.project, '.claude'))).toBe(false);
    const block = skillsBlock(run.stdout);
    expect(block).toContain('After `pnpm install`');
    expect(block).toContain(skillsInstallHint(DEFAULT_SKILLS_AGENT));
    expect(run.stdout).not.toMatch(/skills add|objectstack-ai\/objectstack/);
  });

  it('--skip-skills: the install runs and the sync does not; the summary recommends it', () => {
    const run = scaffold('no-skills-app', ['--skip-skills']);
    expect(catalogOf(run.project), 'the install step did not run').toEqual(STUB_CATALOG);
    expect(run.argv).toEqual([]);
    expect(fs.existsSync(path.join(run.project, '.claude'))).toBe(false);
    const block = skillsBlock(run.stdout);
    expect(block).toMatch(/^AI Skills \(recommended\)/);
    expect(block).toContain(skillsInstallHint(DEFAULT_SKILLS_AGENT));
  });

  // Scaffolding into the current directory is the one path onto existing
  // content. A skill that `skills add` put there earlier is SKIPPED by the
  // sync, exit 0, its directory still present — so neither the exit code nor
  // the directory can be the verdict; the lock entry naming the package is.
  it('a skill already there from `skills add` is reported, not counted as installed', () => {
    const project = path.join(TMP, 'here-app');
    const legacy = path.join(project, '.claude', 'skills', 'objectstack-data');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'SKILL.md'), '---\nname: objectstack-data\n---\n\n# from main\n');
    fs.writeFileSync(
      path.join(project, 'skills-lock.json'),
      JSON.stringify({ version: 1, skills: { 'objectstack-data': { source: 'objectstack-ai/objectstack', sourceType: 'github' } } }) + '\n',
    );
    const receipt = path.join(TMP, 'here-app.npx-argv.log');
    const stdout = execFileSync(TSX, [INDEX_TS], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, NPX_STUB_RECEIPT: receipt, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(fs.readFileSync(receipt, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(listSkills(path.join(project, DEFAULT_SKILLS_DIR))).toEqual(STUB_CATALOG);
    expect(fs.readFileSync(path.join(legacy, 'SKILL.md'), 'utf8')).toContain('# from main');
    expect(stdout).toContain('1 of 3 skill(s)');
    expect(stdout).toContain('(objectstack-data)');
    expect(stdout).not.toContain('Installed for');
  });

  // The sync exits 0 with "Nothing to sync." when there is no package, so a
  // scaffolder that trusted the exit code would print "Installed".
  it('an install that leaves no catalog: the run says so, and never claims Installed', () => {
    const run = scaffold('no-catalog-app', [], { PNPM_STUB_REGISTRY: 'empty' });
    expect(catalogOf(run.project)).toEqual([]);
    expect(run.argv).toEqual([]);
    expect(run.stdout).toContain(`node_modules holds no ${SKILLS_PACKAGE} catalog`);
    expect(run.stdout).not.toContain('Installed for');
    expect(skillsBlock(run.stdout)).toContain(skillsInstallHint(DEFAULT_SKILLS_AGENT));
  });
});

// ── 4. vacuity: the shapes NOT taken must FAIL ──────────────────────────────
//
// Same stubs, same git steps. If these cases ever go green the assertions
// above have stopped meaning anything.
describe('the shapes the scaffolder does not run fail the same properties', () => {
  /** A project holding only what these cases read: the ignore list, the dependency, the install. */
  function projectWithPackage(name: string): string {
    const project = path.join(TMP, name);
    fs.mkdirSync(project, { recursive: true });
    fs.copyFileSync(TEMPLATE_GITIGNORE, path.join(project, '.gitignore'));
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name, devDependencies: { [SKILLS_PACKAGE]: '^18.0.0' } }) + '\n',
    );
    execFileSync(path.join(BIN, 'pnpm'), ['install'], { cwd: project, encoding: 'utf8' });
    return project;
  }

  function npx(cwd: string, args: string[]): number {
    try {
      execFileSync(path.join(BIN, 'npx'), args, { cwd, encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (err) {
      return (err as { status?: number }).status ?? -1;
    }
  }

  // The route this card did NOT take, measured rather than argued: the sync's
  // default links point into node_modules, which is never committed, so the
  // clone holds nothing but broken links.
  it('the linked sync (no --copy) stages links only, and a clone of it reads nothing', () => {
    const project = projectWithPackage('linked-shape');
    expect(npx(project, ['-y', MEASURED_CLI, 'experimental_sync', '--agent', DEFAULT_SKILLS_AGENT, '-y'])).toBe(0);
    const staged = stageAll(project);
    expect(staged.skillMd).toEqual([]);
    expect(staged.symlinks).toHaveLength(STUB_CATALOG.length * 2);

    const clone = cloneAndRead(project, path.join(TMP, 'clone-linked'));
    expect(clone.dangling).toHaveLength(STUB_CATALOG.length * 2);
    expect(clone.readable).toEqual([]);
  });

  it('the sync with no package to read installs nothing and still exits 0', () => {
    const project = path.join(TMP, 'nothing-to-sync');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"nothing-to-sync"}\n');
    expect(npx(project, SKILLS_INSTALL_COMMAND.split(' ').slice(1))).toBe(0);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('refuses an argv it has no measured shape for — the GitHub path among them', () => {
    const project = projectWithPackage('unmeasured');
    for (const args of [
      ['-y', 'skills', 'add', 'objectstack-ai/objectstack/skills', '--skill', '*', '--agent', DEFAULT_SKILLS_AGENT, '-y'],
      ['-y', 'skills', 'experimental_sync', '--agent', DEFAULT_SKILLS_AGENT, '--copy', '-y'],
      ['-y', MEASURED_CLI, 'experimental_sync', '--agent', 'no-such-runtime', '--copy', '-y'],
    ]) {
      expect(npx(project, args), `the stub agreed with an unmeasured shape: ${args.join(' ')}`).toBe(3);
    }
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });
});
