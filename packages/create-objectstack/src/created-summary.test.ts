// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins the PROPERTY the closing scaffold summary exists to hold: every path
// the run wrote is reachable from what the run printed — named outright, or
// lying beneath a directory line that is.
//
// ## Why a property and not a file count
//
// The defect this guards against was a hard-coded-by-construction list: the
// summary printed `copyDir`'s collected array, which is the template files and
// nothing else, so `AGENTS.md`, `.github/copilot-instructions.md`,
// `pnpm-lock.yaml`, `skills-lock.json`, `node_modules/` and two ~968 KB trees
// of agent instructions were written and never named. Measured against
// published `create-objectstack@17.1.0`: 12 entries printed, 18,045 paths on
// disk, 18,033 of them unreachable from the summary.
//
// An assertion of the shape "the summary lists 40 files" would fail the moment
// the template gains or loses a file, and would be re-baselined rather than
// investigated — which is the exact mechanism that produced the stale 12. So
// nothing below counts files. Each case builds a tree, summarizes it, and
// asserts reachability over whatever that tree happens to contain.
//
// ## Why synthetic trees rather than a real scaffold
//
// The real run's last two write phases are `<pm> install` and
// `npx skills add …` — a package manager and a third-party CLI, both needing
// the network. A unit test that depended on them would be a network test that
// fails for reasons unrelated to this property. The shapes that matter are
// reproduced directly instead: a large tree that must collapse, a symlink farm
// that must be counted without being followed, a single-child chain that must
// compress, and a tree past the measurement budget.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  summarizeTree,
  unreachablePaths,
  describeEntry,
  formatBytes,
  COLLAPSE_AT,
  MEASURE_BUDGET,
} from './created-summary.js';

let root: string;

/** The published catalog as measured — `Found 11 skills` in the real run. */
const SKILLS = [
  'objectstack-ai',
  'objectstack-api',
  'objectstack-automation',
  'objectstack-data',
  'objectstack-formula',
  'objectstack-i18n',
  'objectstack-platform',
  'objectstack-pm-dispatch',
  'objectstack-query',
  'objectstack-ui',
  'objectstack-upgrade',
];

/** Every file and symlink under `dir`, project-relative — what the summary must cover. */
function walkWritten(dir: string, rel = '', out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) out.push(r);
    else if (entry.isDirectory()) walkWritten(path.join(dir, entry.name), r, out);
    else out.push(r);
  }
  return out;
}

function write(rel: string, contents: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'created-summary-'));

  // The shape of a real scaffold, reproduced without the network.
  // Phase 1 — template copy + identity rewrite + agent guides.
  for (const f of [
    '.dockerignore',
    '.gitignore',
    'AGENTS.md',
    'Dockerfile',
    'README.md',
    'docker-compose.yml',
    'objectstack.config.ts',
    'objectstack.manifest.json',
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.json',
  ]) {
    write(f, `${f}\n`);
  }
  write('.github/copilot-instructions.md', 'copilot\n');
  write('src/objects/index.ts', 'export {};\n');
  write('src/objects/note.object.ts', 'export {};\n');

  // Phase 2 — the package manager.
  write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n'.repeat(400));
  for (let i = 0; i < MEASURE_BUDGET + 50; i += 1) {
    write(`node_modules/pkg-${i}/index.js`, 'module.exports = {};\n');
  }

  // Phase 3 — the skills installer: two real trees plus a symlink farm, the
  // layout measured from `npx skills add … --all` (11 skills, 49 real files
  // per tree, `.claude/skills/*` symlinked into `.agents/skills/`). The COUNT
  // is faithful on purpose — a 3-skill fixture sits under COLLAPSE_AT and
  // would exercise the enumerate path while the real tree takes the collapse
  // path, testing the branch the product does not use.
  write('skills-lock.json', '{"version":1}\n');
  for (const skill of SKILLS) {
    for (const tree of ['.agents/skills', 'agent/skills']) {
      write(`${tree}/${skill}/SKILL.md`, '---\nname: x\n---\n'.repeat(60));
      write(`${tree}/${skill}/references/guide.md`, 'guide\n'.repeat(60));
    }
    fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
    fs.symlinkSync(
      path.join('..', '..', '.agents', 'skills', skill),
      path.join(root, '.claude/skills', skill),
    );
  }
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('created-summary — reachability', () => {
  // Vacuity guard. Every assertion below is quantified over the tree, so a
  // test that summarized the wrong directory would assert nothing at all and
  // stay green. This proves the fixture really was built and really was read.
  it('reads a tree with all three write phases in it', () => {
    const written = walkWritten(root);
    expect(written).toContain('AGENTS.md');
    expect(written).toContain('skills-lock.json');
    expect(written).toContain('pnpm-lock.yaml');
    expect(written.filter((p) => p.startsWith('.agents/')).length).toBeGreaterThan(0);
    expect(written.filter((p) => p.startsWith('agent/')).length).toBeGreaterThan(0);
    expect(written.filter((p) => p.startsWith('node_modules/')).length).toBeGreaterThan(
      MEASURE_BUDGET,
    );
    expect(summarizeTree(root).length).toBeGreaterThan(0);
  });

  // THE property. Not "the summary is long enough" — every single written
  // path is reachable, whatever the tree happens to hold.
  it('names, or covers by an ancestor line, every path on disk', () => {
    const written = walkWritten(root);
    const missed = unreachablePaths(summarizeTree(root), written);
    expect(
      missed,
      `The scaffold summary would not disclose ${missed.length} written path(s), ` +
        `e.g. ${missed.slice(0, 5).join(', ')}. Every path the run writes must be ` +
        'reachable from what it prints — a path nobody was shown is a path nobody ' +
        'can review.',
    ).toEqual([]);
  });

  // The regression in its original form: the files written after the template
  // copy are exactly the ones the old summary could not see.
  it('discloses the post-copy writes the old list structurally could not', () => {
    const entries = summarizeTree(root);
    const missed = unreachablePaths(entries, [
      'AGENTS.md',
      '.github/copilot-instructions.md',
      'pnpm-lock.yaml',
      'skills-lock.json',
      '.agents/skills/objectstack-ai/SKILL.md',
      'agent/skills/objectstack-ai/SKILL.md',
      '.claude/skills/objectstack-ai',
      'node_modules/pkg-0/index.js',
    ]);
    expect(missed).toEqual([]);
  });

  it('is not vacuous — a path the summary does not cover is reported', () => {
    // Without this, `unreachablePaths` returning `[]` unconditionally would
    // make every assertion above pass while proving nothing.
    const missed = unreachablePaths(summarizeTree(root), ['not-written-by-anyone.txt']);
    expect(missed).toEqual(['not-written-by-anyone.txt']);
  });
});

describe('created-summary — readability', () => {
  it('collapses big trees instead of enumerating them', () => {
    const entries = summarizeTree(root);
    // 11 skills x 2 files x 2 trees plus a 2050-entry node_modules: an
    // enumeration would be thousands of lines. The bar is reachability AND a
    // summary a human reads, so bulk arrives as directory lines.
    expect(entries.length).toBeLessThan(60);
    const dirs = entries.filter((e) => e.kind === 'dir').map((e) => e.path);
    expect(dirs).toContain('node_modules/');
  });

  it('compresses single-child chains down to the directory worth opening', () => {
    // `.agents/` holds only `skills/`, so the line must read `.agents/skills/`
    // — the path the "review your skills" advice actually sends people to.
    const dirs = summarizeTree(root)
      .filter((e) => e.kind === 'dir')
      .map((e) => e.path);
    expect(dirs).toContain('.agents/skills/');
    expect(dirs).toContain('agent/skills/');
    expect(dirs).not.toContain('.agents/');
  });

  it('counts symlinks without following them', () => {
    // `.claude/skills/*` are symlinks into `.agents/skills/`. Following them
    // would double-count that tree and report a size the disk does not hold.
    const claude = summarizeTree(root).find((e) => e.path === '.claude/skills/');
    const agents = summarizeTree(root).find((e) => e.path === '.agents/skills/');
    expect(claude, '.claude/skills/ must appear as its own line').toBeTruthy();
    expect(claude!.entries).toBe(SKILLS.length);
    expect(claude!.bytes).toBeLessThan(agents!.bytes);
  });

  it('reports a lower bound rather than a wrong number past the budget', () => {
    const nm = summarizeTree(root).find((e) => e.path === 'node_modules/')!;
    expect(nm.truncated).toBe(true);
    expect(describeEntry(nm)).toMatch(/^over [\d,]+ files$/);
    // A truncated entry must not print a size: the walk stopped early, so any
    // byte total it carries is a fraction presented as a whole.
    expect(describeEntry(nm)).not.toMatch(/KB|MB|B$/);
  });

  it('describes a fully measured directory with both count and size', () => {
    const skills = summarizeTree(root).find((e) => e.path === '.agents/skills/')!;
    expect(skills.truncated).toBe(false);
    expect(describeEntry(skills)).toMatch(/^\d+ files, [\d.]+ (B|KB|MB)$/);
  });

  it('enumerates small directories file by file', () => {
    const paths = summarizeTree(root).map((e) => e.path);
    expect(paths).toContain('src/objects/note.object.ts');
    expect(paths).toContain('.github/copilot-instructions.md');
    expect(paths).not.toContain('src/');
  });

  it('formats byte counts at each magnitude', () => {
    expect(formatBytes(46)).toBe('46 B');
    expect(formatBytes(4837)).toBe('4.7 KB');
    expect(formatBytes(991232)).toBe('968 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('agrees with its own collapse threshold', () => {
    // Pins the rule, not a number: a directory at the threshold is
    // enumerated, one past it collapses.
    const small = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-small-'));
    try {
      for (let i = 0; i < COLLAPSE_AT; i += 1) {
        fs.mkdirSync(path.join(small, 'many'), { recursive: true });
        fs.writeFileSync(path.join(small, 'many', `f${i}.txt`), 'x');
      }
      expect(summarizeTree(small).every((e) => e.kind === 'file')).toBe(true);

      fs.writeFileSync(path.join(small, 'many', 'one-more.txt'), 'x');
      const after = summarizeTree(small);
      expect(after.map((e) => e.path)).toEqual(['many/']);
      expect(unreachablePaths(after, walkWritten(small))).toEqual([]);
    } finally {
      fs.rmSync(small, { recursive: true, force: true });
    }
  });
});
