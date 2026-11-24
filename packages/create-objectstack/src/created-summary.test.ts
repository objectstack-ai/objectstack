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
// `npx skills experimental_sync …` — a package manager and a third-party CLI,
// both needing the network. A unit test that depended on them would be a
// network test that fails for reasons unrelated to this property. The shapes
// that matter are reproduced directly instead: a large tree that must
// collapse, a single-child chain that must compress, a tree past the
// measurement budget, and — in a tree of its own — a symlink farm that must be
// counted without being followed.

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

/**
 * The published catalog — one entry per `skills/objectstack-*\/SKILL.md` on this
 * tree. Eleven: ten since the published PM Dispatch skill was deleted
 * (2026-09-10), then `objectstack-ask` joined.
 */
const SKILLS = [
  'objectstack-ai',
  'objectstack-api',
  'objectstack-ask',
  'objectstack-automation',
  'objectstack-data',
  'objectstack-formula',
  'objectstack-i18n',
  'objectstack-platform',
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

  // Phase 2 — the package manager, which also brings the catalog's source:
  // the `@objectstack/skills` package the template depends on.
  write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n'.repeat(400));
  for (let i = 0; i < MEASURE_BUDGET + 50; i += 1) {
    write(`node_modules/pkg-${i}/index.js`, 'module.exports = {};\n');
  }
  for (const skill of SKILLS) {
    write(`node_modules/@objectstack/skills/dist/skills/${skill}/SKILL.md`, '---\nname: x\n---\n');
  }

  // Phase 3 — the skills installer, in the shape the scaffolder runs it:
  // `experimental_sync --agent claude-code --copy` copies the installed
  // package's catalog into ONE real tree, `.claude/skills/<skill>/`, and
  // writes `skills-lock.json` (skills-install.ts carries the measurement).
  // The COUNT is faithful on purpose: two files per skill put the tree above
  // COLLAPSE_AT, so it takes the collapse path the product takes — a 3-skill
  // fixture would put it on the enumerate path, testing the branch the
  // product does not use.
  write('skills-lock.json', '{"version":1}\n');
  for (const skill of SKILLS) {
    write(`.claude/skills/${skill}/SKILL.md`, '---\nname: x\n---\n'.repeat(60));
    write(`.claude/skills/${skill}/references/guide.md`, 'guide\n'.repeat(60));
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
    expect(written.filter((p) => p.startsWith('.claude/skills/')).length).toBeGreaterThan(
      COLLAPSE_AT,
    );
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
      '.claude/skills/objectstack-ai/SKILL.md',
      '.claude/skills/objectstack-ai/references/guide.md',
      'node_modules/@objectstack/skills/dist/skills/objectstack-ai/SKILL.md',
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
    // 11 skills x 2 files plus a 2050-entry node_modules: an
    // enumeration would be thousands of lines. The bar is reachability AND a
    // summary a human reads, so bulk arrives as directory lines.
    expect(entries.length).toBeLessThan(60);
    const dirs = entries.filter((e) => e.kind === 'dir').map((e) => e.path);
    expect(dirs).toContain('node_modules/');
  });

  it('compresses single-child chains down to the directory worth opening', () => {
    // `.claude/` holds only `skills/`, so the line must read `.claude/skills/`
    // — the path the "review your skills" advice actually sends people to.
    const dirs = summarizeTree(root)
      .filter((e) => e.kind === 'dir')
      .map((e) => e.path);
    expect(dirs).toContain('.claude/skills/');
    expect(dirs).not.toContain('.claude/');
  });

  it('counts symlinks without following them', () => {
    // The scaffolder's own phase 3 writes no links any more (`--copy`), but the
    // walk still meets them: pnpm builds node_modules out of them, and the same
    // sync WITHOUT `--copy` writes two farms — `.agents/skills/*` into the
    // package in node_modules and `.claude/skills/*` into `.agents/skills/`
    // (measured, skills-install.ts). That shape is built here in a tree of its
    // own. Following the links would double-count the catalog and report a
    // size the disk does not hold. An eleven-skill catalog puts each farm
    // ABOVE COLLAPSE_AT, so it collapses to one line, and the property is read
    // off that line's `entries` and `bytes`: one entry per link, sized as the
    // links' own bytes — the target path strings, as `lstat` reports them —
    // never the trees they point at. Should the catalog shrink to COLLAPSE_AT
    // or under, the farms are enumerated and this test moves to asserting on
    // the symlink lines themselves.
    expect(
      SKILLS.length,
      'the farm must sit above COLLAPSE_AT for the collapse-path reading below',
    ).toBeGreaterThan(COLLAPSE_AT);
    const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-linked-'));
    try {
      const pkgSkills = path.join('node_modules', '@objectstack', 'skills', 'dist', 'skills');
      const farmBytes = new Map<string, number>();
      for (const skill of SKILLS) {
        for (const f of ['SKILL.md', 'references/guide.md']) {
          const abs = path.join(linked, pkgSkills, skill, f);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, 'guide\n'.repeat(60));
        }
        for (const [farm, target] of [
          ['.agents/skills', path.join('..', '..', pkgSkills, skill)],
          ['.claude/skills', path.join('..', '..', '.agents', 'skills', skill)],
        ] as const) {
          fs.mkdirSync(path.join(linked, farm), { recursive: true });
          fs.symlinkSync(target, path.join(linked, farm, skill));
          farmBytes.set(farm, (farmBytes.get(farm) ?? 0) + Buffer.byteLength(target));
        }
      }
      const entries = summarizeTree(linked);
      expect(unreachablePaths(entries, walkWritten(linked))).toEqual([]);
      const real = entries.find((e) => e.path === `${pkgSkills.split(path.sep).join('/')}/`);
      expect(real, 'the real catalog tree must still collapse — two files per skill').toBeTruthy();
      expect(farmBytes.size).toBe(2);
      for (const [farm, bytes] of farmBytes) {
        const line = entries.find((e) => e.path === `${farm}/`);
        expect(line, `${farm}/ must collapse to one line`).toBeTruthy();
        expect(line!.kind).toBe('dir');
        expect(line!.truncated).toBe(false);
        expect(line!.entries, `${farm}/ must count each link once, not the tree behind it`).toBe(SKILLS.length);
        expect(line!.bytes, `${farm}/ must be sized as its links, not as their targets`).toBe(bytes);
        expect(line!.bytes).toBeLessThan(real!.bytes);
      }
    } finally {
      fs.rmSync(linked, { recursive: true, force: true });
    }
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
    const skills = summarizeTree(root).find((e) => e.path === '.claude/skills/')!;
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
