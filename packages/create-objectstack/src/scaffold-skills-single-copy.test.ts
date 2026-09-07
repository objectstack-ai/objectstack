// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// #16331 — a scaffolded project's FIRST `git add -A` must stage the skills
// bundle exactly once, and a clone of that commit must yield readable
// `SKILL.md` files.
//
// ## The measurement this file encodes
//
// Taken against `skills@1.5.23` and the published `objectstack-ai/objectstack/
// skills` catalog (11 skills), each into an empty directory:
//
//   --all                                  .agents/ 46 real files (604,102 B)
//   (= --skill '*' --agent '*' -y)         agent/   46 real files (602,682 B)
//                                          .claude/ 11 symlinks into .agents/
//   --skill '*' --agent claude-code -y     .claude/ 46 real files (604,102 B)
//   --skill '*' --agent universal -y       .agents/ 46 real files (604,102 B)
//   --all --copy                           56 destination dirs, 33.8 MB total
//
// and then, with the template's `.gitignore` in place, `git init && git add -A`:
//
//   --all shape          22 staged SKILL.md paths + 11 staged symlinks
//   claude-code shape    11 staged SKILL.md paths, 0 symlinks
//
// 22 is the defect: the same eleven skills, staged twice as real files.
//
// ## Why the skills CLI is stubbed, and how the stub is kept honest
//
// The real installer needs the network and a GitHub clone, so a test that ran
// it would be measuring the runner. The stub instead encodes the DESTINATION
// MAP above — argv in, directory layout out — and `INSTALL_SHAPES` is that
// table verbatim. Two properties keep it from becoming a mirror that agrees
// with whatever we do:
//
//   * the stub REFUSES an argv it has no measured row for (exit 3). Change the
//     scaffolder's command to something nobody measured and the end-to-end
//     case fails loudly instead of passing against an invented layout.
//   * the `--all` row is exercised too, by the vacuity case, and the same
//     assertions must FAIL on it. An assertion that cannot fail is the one
//     failure mode a fixture-driven test really has.
//
// The end-to-end case runs the REAL CLI through `tsx` under a stubbed PATH —
// the pattern `scaffold-next-steps-pm.test.ts` established, and for the same
// reason: `index.ts` calls `program.parse()` at import, so nothing in it can
// be reached any other way. Its harness guard is the stub's own argv receipt:
// if the child resolved the ambient `npx` instead of ours, there is no receipt
// and the case fails rather than quietly measuring the network.

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
  SKILLS_CATALOG,
  SKILLS_INSTALL_COMMAND,
  skillsAddArgs,
  skillsInstallHint,
} from './skills-install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');
const TEMPLATE_GITIGNORE = path.join(
  PKG_ROOT,
  'src',
  'templates',
  'blank',
  '_gitignore',
);

/** The skills the stub installs. Three, so "twice" is unmistakably six. */
const STUB_SKILLS = ['objectstack-data', 'objectstack-query', 'objectstack-ui'];

/** The measured destination map — see the header table. */
const INSTALL_SHAPES = `
const SHAPES = {
  'agent:*': [
    { dir: '.agents/skills', kind: 'real' },
    { dir: 'agent/skills', kind: 'real' },
    { dir: '.claude/skills', kind: 'link', into: '../../.agents/skills' },
  ],
  'agent:claude-code': [{ dir: '.claude/skills', kind: 'real' }],
  'agent:universal': [{ dir: '.agents/skills', kind: 'real' }],
};
`;

/** A stub `npx` that reproduces INSTALL_SHAPES and records the argv it saw. */
function writeStubs(binDir: string, receipt: string): void {
  fs.mkdirSync(binDir, { recursive: true });

  const npxJs = path.join(binDir, 'npx-stub.mjs');
  fs.writeFileSync(
    npxJs,
    `import fs from 'node:fs';
import path from 'node:path';
${INSTALL_SHAPES}
const SKILLS = ${JSON.stringify(STUB_SKILLS)};
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(receipt)}, JSON.stringify(argv) + '\\n');

if (!argv.includes('skills') || !argv.includes('add')) process.exit(0);
const agents = argv.includes('--all')
  ? '*'
  : (argv[argv.indexOf('--agent') + 1] ?? '');
const shape = SHAPES['agent:' + agents];
if (!shape) {
  console.error('npx-stub: no measured install shape for --agent ' + agents);
  process.exit(3);
}
const cwd = process.cwd();
for (const dest of shape) {
  fs.mkdirSync(path.join(cwd, dest.dir), { recursive: true });
  for (const skill of SKILLS) {
    const at = path.join(cwd, dest.dir, skill);
    if (dest.kind === 'link') {
      fs.symlinkSync(dest.into + '/' + skill, at);
      continue;
    }
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(
      path.join(at, 'SKILL.md'),
      '---\\nname: ' + skill + '\\n---\\n\\n# ' + skill + '\\n',
    );
    fs.writeFileSync(path.join(at, 'reference.md'), '# reference for ' + skill + '\\n');
  }
}
fs.writeFileSync(
  path.join(cwd, 'skills-lock.json'),
  JSON.stringify({ version: 1, skills: Object.fromEntries(SKILLS.map((s) => [s, {}])) }, null, 2) + '\\n',
);
console.log('npx-stub: installed ' + SKILLS.length + ' skills');
`,
    'utf8',
  );

  const shim = (body: string) => `#!/bin/sh\n${body}\n`;
  fs.writeFileSync(path.join(binDir, 'npx'), shim(`exec "${process.execPath}" "${npxJs}" "$@"`));
  // `pnpm --version` must answer so detectPackageManager reports probe:'ok',
  // and `pnpm install` must be a no-op that succeeds: with no node_modules
  // written, readResolvedCliVersion has no opinion and the Dockerfile pin is
  // skipped, which keeps this file's subject to the skills phase alone.
  fs.writeFileSync(
    path.join(binDir, 'pnpm'),
    shim('if [ "$1" = "--version" ]; then echo 10.31.0; fi\nexit 0'),
  );
  for (const f of ['npx', 'pnpm']) fs.chmodSync(path.join(binDir, f), 0o755);
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
let RECEIPT: string;

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-single-copy-'));
  BIN = path.join(TMP, 'bin');
  RECEIPT = path.join(TMP, 'npx-argv.log');
  writeStubs(BIN, RECEIPT);
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── 1. the command itself ───────────────────────────────────────────────────
describe('the skills install command names exactly one agent', () => {
  it('never passes --all or --agent *', () => {
    expect(SKILLS_INSTALL_COMMAND).not.toContain('--all');
    expect(SKILLS_INSTALL_COMMAND).not.toMatch(/--agent\s+'?\*/);
  });

  it("selects every skill, with the glob quoted against the shell", () => {
    expect(SKILLS_INSTALL_COMMAND).toContain("--skill '*'");
  });

  it('names one agent, once', () => {
    const agents = SKILLS_INSTALL_COMMAND.match(/--agent\s+(\S+)/g) ?? [];
    expect(agents).toEqual([`--agent ${DEFAULT_SKILLS_AGENT}`]);
  });

  it('installs from the curated catalog subpath', () => {
    expect(SKILLS_INSTALL_COMMAND).toContain(`skills add ${SKILLS_CATALOG} `);
  });

  // The printed hint and the executed command must come out of ONE builder:
  // a user told to run something the scaffolder never ran is how a project
  // acquires the second copy this card removes.
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
    expect(skillsAddArgs(EXAMPLE_OTHER_AGENT)).toContain(`--agent ${EXAMPLE_OTHER_AGENT}`);
  });
});

// ── 2. end to end: a real scaffold, staged and cloned ───────────────────────
describe('a scaffolded project stages the bundle exactly once', () => {
  let project: string;
  let staged: Staged;

  beforeAll(() => {
    project = path.join(TMP, 'staged-once-app');
    execFileSync(TSX, [INDEX_TS, 'staged-once-app'], {
      cwd: TMP,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    staged = stageAll(project);
  });

  // Harness guard: without a receipt the child ran SOME other npx and every
  // assertion below would be measuring that instead.
  it("ran the stubbed skills CLI, with the scaffolder's own argv", () => {
    const lines = fs.readFileSync(RECEIPT, 'utf8').split('\n').filter(Boolean);
    const args: string[][] = lines.map((l) => JSON.parse(l));
    const add = args.find((a) => a.includes('add'));
    expect(add, 'the scaffolder never reached the stubbed npx').toBeDefined();
    expect(add).toContain(SKILLS_CATALOG);
    expect(add?.[add.indexOf('--agent') + 1]).toBe(DEFAULT_SKILLS_AGENT);
    expect(add).not.toContain('--all');
  });

  it('writes the bundle to exactly one directory', () => {
    const roots = new Set(staged.skillMd.map((p) => p.split('/')[0]));
    expect([...roots]).toEqual([DEFAULT_SKILLS_DIR.split('/')[0]]);
  });

  it('stages one SKILL.md per skill — not two, not three', () => {
    expect(staged.skillMd).toHaveLength(STUB_SKILLS.length);
  });

  it('stages no symlinks at all', () => {
    expect(staged.symlinks).toEqual([]);
  });

  it('stages the lockfile that records what was installed', () => {
    expect(staged.all).toContain('skills-lock.json');
  });

  it('yields readable SKILL.md files when that commit is cloned', () => {
    const clone = cloneAndRead(project, path.join(TMP, 'clone-staged-once'));
    expect(clone.skillMd).toHaveLength(STUB_SKILLS.length);
    expect(clone.readable).toEqual(clone.skillMd);
    expect(clone.dangling).toEqual([]);
  });
});

// ── 3. vacuity: the pre-fix shape must FAIL both assertions ─────────────────
//
// Same stub, same git steps, the `--all` row of the measured table. If these
// two cases ever go green the assertions above have stopped meaning anything.
describe('the pre-fix `--all` shape fails the same property', () => {
  function installAll(project: string, extraIgnores: string[] = []): void {
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, '.gitignore'),
      fs.readFileSync(TEMPLATE_GITIGNORE, 'utf8') +
        extraIgnores.map((l) => `${l}\n`).join(''),
    );
    execFileSync(path.join(BIN, 'npx'), ['-y', 'skills', 'add', SKILLS_CATALOG, '--all'], {
      cwd: project,
      encoding: 'utf8',
    });
  }

  it('stages the same skills twice with nothing ignored', () => {
    const project = path.join(TMP, 'all-shape');
    installAll(project);
    const staged = stageAll(project);
    expect(staged.skillMd).toHaveLength(STUB_SKILLS.length * 2);
    expect(staged.symlinks).toHaveLength(STUB_SKILLS.length);
  });

  // The route this card did NOT take, measured rather than argued: ignoring
  // the real trees while committing `.claude/` produces a clone with nothing
  // in it but broken links.
  it('leaves dangling symlinks when the real trees are gitignored instead', () => {
    const project = path.join(TMP, 'all-shape-ignored');
    installAll(project, ['.agents/', 'agent/']);
    const staged = stageAll(project);
    expect(staged.skillMd).toEqual([]);
    expect(staged.symlinks).toHaveLength(STUB_SKILLS.length);

    const clone = cloneAndRead(project, path.join(TMP, 'clone-all-ignored'));
    expect(clone.dangling).toHaveLength(STUB_SKILLS.length);
    expect(clone.skillMd).toEqual([]);
  });

  it('refuses an argv it has no measured shape for', () => {
    const project = path.join(TMP, 'unmeasured');
    fs.mkdirSync(project, { recursive: true });
    let code = 0;
    try {
      execFileSync(
        path.join(BIN, 'npx'),
        ['-y', 'skills', 'add', SKILLS_CATALOG, '--agent', 'no-such-runtime'],
        { cwd: project, encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (err) {
      code = (err as { status?: number }).status ?? 0;
    }
    expect(code, 'the stub agreed with an install shape nobody measured').toBe(3);
  });
});
