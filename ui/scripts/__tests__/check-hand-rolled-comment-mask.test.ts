import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { collectSources } from '../check-comment-mask-corpus.mjs';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  carriersIn,
  CORPUS_FLOOR,
  DEBT,
  EXIT_BREACH,
  EXIT_REFUSED,
  EXIT_STALE,
  EXIT_USAGE,
  judge,
  removalPosition,
  selfTest,
  spansAComment,
  sweep,
} from '../check-hand-rolled-comment-mask.mjs';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(scriptsDir, '..');
const SCRIPT = path.join(scriptsDir, 'check-hand-rolled-comment-mask.mjs');

/**
 * objectui#9751. The card's load-bearing half was not the four carriers it
 * listed; it was that a FIFTH appeared 39 hours after the sweep that cleaned the
 * tree and nothing reported it. So the cases here are about the gate's ability to
 * SAY something, and only incidentally about today's population.
 *
 * Three failure modes are driven directly rather than inferred from a green run:
 *
 *   vacuity     -- "no carrier found" and "the detector is broken" print the same
 *                  line. `selfTest()` carries the shapes, and the sweep's corpus
 *                  is floored so a walk that found nothing is a refusal.
 *   growth      -- a carrier at a path DEBT does not name must be EXIT_BREACH.
 *   settlement  -- a DEBT entry whose site is fixed must be EXIT_STALE. That
 *                  direction is the whole difference between this list and an
 *                  allowlist, so it is pinned from both sides.
 *
 * Exit codes are read as NUMBERS from a spawned process: a test that greps stdout
 * for a word passes against a script that prints the word and exits 0.
 */

/** The carrier shapes, ASSEMBLED -- so this file is not itself a carrier. */
const B = String.fromCharCode(92);
const SLASH = '/';
const STAR = '*';
const OPEN = B + SLASH + B + STAR;
const CLOSE = B + STAR + B + SLASH;
const LINE = B + SLASH + B + SLASH;
const ANY = '[' + B + 's' + B + 'S]*?';

/** The exact projection `overlay-node-slot-doc-types-7082` carried before this card. */
const JSDOC_PAIR = `const bare = body.replace(${SLASH}${OPEN}${STAR}${ANY}${CLOSE}${SLASH}g, '').replace(${SLASH}^${B}s*${LINE}.*$${SLASH}gm, '');`;

/** The exact projection `LineItemsPanel.parentIdNoCast-9333` carried before this card. */
const HYBRID_PAIR = `const out = src.replace(${SLASH}${OPEN}${ANY}${CLOSE}${SLASH}g, (m) => m).replace(${SLASH}${LINE}[^${B}n]*${SLASH}g, '');`;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 300_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('the detector can fire (controls first)', () => {
  it('reports both halves of the JSDoc-only pair this card converted', () => {
    expect(carriersIn(JSDOC_PAIR)).toHaveLength(2);
  });

  it('reports both halves of the blanking hybrid this card converted', () => {
    expect(carriersIn(HYBRID_PAIR)).toHaveLength(2);
  });

  it('does NOT report a regex that only trims a delimiter off a known docblock', () => {
    expect(carriersIn(`const prose = block.replace(${SLASH}^${B}s*${OPEN}${STAR}${SLASH}, '');`)).toEqual([]);
  });

  it('does NOT report the same shape used to EXTRACT rather than remove', () => {
    expect(carriersIn(`const block = ${SLASH}${OPEN}${STAR}${ANY}${CLOSE}${SLASH}.exec(source);`)).toEqual([]);
  });

  it('does NOT report a carrier shape that is prose, or a string', () => {
    expect(carriersIn(`// x.replace(${SLASH}${OPEN}${ANY}${CLOSE}${SLASH}g, '')\nconst x = 1;`)).toEqual([]);
    expect(carriersIn(`const doc = "x.replace(${SLASH}${OPEN}${ANY}${CLOSE}${SLASH}g, '')";`)).toEqual([]);
  });

  it('separates the two predicates, so neither can carry the verdict alone', () => {
    // Spans a comment, but is a lookup.
    expect(spansAComment(`${OPEN}${ANY}${CLOSE}`)).toBe('block');
    expect(removalPosition(`const b = ${SLASH}`, 10)).toBeNull();
    // In a removal position, but mentions comment syntax without spanning one.
    expect(spansAComment(`^file:${LINE}`)).toBeNull();
    expect(removalPosition("s.replace(/", 10)).toBe('replace');
    expect(removalPosition('xs.filter((l) => !/', 18)).toBe('reject');
  });

  it('passes its own self-test, which pins the shapes rather than the tree', () => {
    expect(selfTest()).toBe(0);
  });
});

describe('the verdict, read as values', () => {
  const carrier = [{ line: 1, kind: 'block', position: 'replace', pattern: 'x' }];

  it('a carrier at a path DEBT does not name is a BREACH', () => {
    const result = { scanned: CORPUS_FLOOR + 1, byFile: new Map([['packages/new/thing.test.ts', carrier]]) };
    expect(judge(result, {}).code).toBe(EXIT_BREACH);
  });

  it('a DEBT entry whose site is fixed is STALE -- the line has to go', () => {
    const result = { scanned: CORPUS_FLOOR + 1, byFile: new Map() };
    expect(judge(result, { 'packages/old/fixed.test.ts': 'why' }).code).toBe(EXIT_STALE);
  });

  it('a BREACH outranks a STALE entry, so a fix cannot be paid for with a new line', () => {
    const result = { scanned: CORPUS_FLOOR + 1, byFile: new Map([['packages/new/thing.test.ts', carrier]]) };
    const verdict = judge(result, { 'packages/old/fixed.test.ts': 'why' });
    expect(verdict.code).toBe(EXIT_BREACH);
    expect(verdict.stale).toEqual(['packages/old/fixed.test.ts']);
  });

  it('a corpus below the floor is a REFUSAL, never a pass', () => {
    expect(judge({ scanned: CORPUS_FLOOR - 1, byFile: new Map() }, {}).code).toBe(EXIT_REFUSED);
  });

  it('an unknown argument is a usage error rather than a silent sweep', () => {
    expect(run(['--all-of-them']).status).toBe(EXIT_USAGE);
  });
});

/**
 * A fixture tree that IS a git repository, every file force-added (past any
 * ignore file) and nothing committed, so no identity config is needed.
 */
function gitFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-rolled-mask-'));
  for (const [rel, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), contents, 'utf8');
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '-A', '-f'], { cwd: root, stdio: 'pipe' });
  return root;
}

describe('objectui#11040 -- the sweep reads what git tracks, and a vanished path is absent', () => {
  /**
   * The failure: `cli-bin.test.ts` builds with tsup, which writes a temporary
   * `tsup.config.bundled_*.mjs` and deletes it. The working-tree walk listed it,
   * the build deleted it, and the read in `sweep` threw ENOENT, failing a Test
   * shard on a pull request that touched neither file. Both guards are driven
   * here with a fixture, not a race.
   */
  it('a path listed and then deleted before the read is absent, not thrown on', () => {
    const root = gitFixture({ 'src/kept.ts': HYBRID_PAIR, 'src/gone.ts': HYBRID_PAIR });
    try {
      const listed = collectSources(root);
      expect(listed.map((file: string) => path.relative(root, file).split(path.sep).join('/'))).toEqual([
        'src/gone.ts',
        'src/kept.ts',
      ]);
      fs.rmSync(path.join(root, 'src', 'gone.ts'));

      const result = sweep({ root, files: listed });
      expect(result.absent).toEqual(['src/gone.ts']);
      // Not counted toward the floor, and not scored as a file with nothing to report.
      expect(result.scanned).toBe(1);
      expect([...result.byFile.keys()]).toEqual(['src/kept.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('...but only absence is tolerated: a listed path that cannot be read still throws', () => {
    const root = gitFixture({ 'src/kept.ts': 'export const a = 1;\n' });
    try {
      fs.mkdirSync(path.join(root, 'src', 'dir.ts'));
      let code: unknown = null;
      try {
        sweep({ root, files: [path.join(root, 'src', 'dir.ts')] });
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code;
      }
      expect(code).toBe('EISDIR');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an untracked build temp file is never listed, while the same bytes tracked are read', () => {
    const root = gitFixture({ 'packages/cli/tsup.config.ts': HYBRID_PAIR });
    try {
      // Written after `git add`, the way tsup writes it mid-run: on disk, untracked.
      fs.writeFileSync(path.join(root, 'packages', 'cli', 'tsup.config.bundled_x1.mjs'), HYBRID_PAIR, 'utf8');
      const result = sweep({ root });
      expect(result.scanned).toBe(1);
      // The control: the tracked copy of the identical bytes IS a carrier, so the
      // untracked one is missing because it was never listed, not because it is clean.
      expect([...result.byFile.keys()]).toEqual(['packages/cli/tsup.config.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('this tree, today', () => {
  const result = sweep({ root: REPO_ROOT });

  it('read a real corpus, not an empty one', () => {
    expect(result.scanned).toBeGreaterThan(CORPUS_FLOOR);
  });

  it('holds no private comment projection outside DEBT', () => {
    const verdict = judge(result);
    expect(
      verdict.breaches,
      'a reader reached "is this span a comment" privately. Import scripts/js-comment-mask.mjs instead -- ' +
        '`maskComments` when the caller reports a line or an offset, `stripComments` when it reports neither. ' +
        'Adding a DEBT entry is not the remedy.',
    ).toEqual([]);
    expect(verdict.code).toBe(0);
  });

  it('carries no DEBT entry that has stopped excusing anything', () => {
    expect(judge(result).stale, 'delete these entries -- that deletion is what keeps the list shrink-only').toEqual([]);
  });

  it('names a reason on every DEBT entry, because a bare path is not actionable', () => {
    for (const [site, reason] of Object.entries(DEBT)) {
      expect(reason.length, `${site} needs a reason a reader can act on`).toBeGreaterThan(80);
    }
  });

  it('exits 0 as a process, which is what CI reads', () => {
    expect(run([]).status).toBe(0);
  });
});

describe('wiring -- a gate nobody runs is indistinguishable from a gate that passes', () => {
  it('rides the test project the root config already points at scripts/', async () => {
    const { readFileSync } = await import('node:fs');
    const config = readFileSync(path.join(REPO_ROOT, 'vitest.config.mts'), 'utf8');
    expect(config).toContain("'scripts/**/*.test.ts'");
  });

  it('needs no workflow of its own: nothing under .github names this gate', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = path.join(REPO_ROOT, '.github', 'workflows');
    const naming = readdirSync(dir).filter((f) =>
      readFileSync(path.join(dir, f), 'utf8').includes('check-hand-rolled-comment-mask'),
    );
    expect(
      naming,
      'this gate is deliberately wired through the existing test job and adds no CI context; ' +
        'if that changed, the claim in its header changed with it',
    ).toEqual([]);
  });
});
