import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parser } from 'typescript-eslint';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  adaptParse,
  collectSources,
  compareFile,
  CORPUS_FLOOR,
  EXIT_DISAGREEMENT,
  EXIT_USAGE,
  judge,
  KNOWN_RESIDUE,
  oracleComments,
  parseArgs,
  SELF_TEST_CASE_FLOOR,
  SKIPPED_DIRECTORIES,
  SOURCE_EXTENSIONS,
  sweep,
  UnparseableSource,
} from '../check-comment-mask-corpus.mjs';

import { scanSource } from '../js-comment-mask.mjs';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(scriptsDir, 'check-comment-mask-corpus.mjs');

const parse = adaptParse(parser);

/**
 * objectui#7882. This gate is a PORT of objectstack's corpus sweep, landed to
 * take a measurement the card's ruling asked for rather than to turn the tree
 * red. Two things about that make the cases below what they are.
 *
 * First, the failure mode a sweep has is VACUITY: "0 files disagree" and "the
 * comparison is broken" print the same line, and a comparator that can never
 * report is a green gate forever. So the red direction is driven directly --
 * `sweep()` over a fixture tree with a masker that is wrong on purpose -- rather
 * than inferred from a green run over the real tree.
 *
 * Second, this port's one real divergence from upstream is its VERDICT: upstream
 * fails on any disagreement, and this copy splits the two directions because
 * objectui#7882's residue is live and pinned. `judge()` is therefore read as
 * VALUES here, never by matching prose, and every boundary of the declared
 * ceiling is pinned from both sides.
 *
 * Exit codes are read as NUMBERS from a spawned process for the same reason: a
 * test that greps stdout for a word passes against a script that prints the word
 * and exits 0.
 */

/** Run the CLI and hand back the raw exit code -- never a prose match. */
function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A throwaway tree; the caller gets an absolute root and cleans up. It is a git
 * repository with every file force-added (past any ignore file) and nothing
 * committed, because the corpus is what git tracks (objectui#11040).
 */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '-A', '-f'], { cwd: root, stdio: 'pipe' });
  return root;
}

const flagNothing = (source: string) => ({ comment: new Uint8Array(source.length) });

describe('check-comment-mask-corpus — the CLI contract, read as exit codes', () => {
  it('--self-test exits 0 and reaches its printed verdict', () => {
    const { status, stdout } = run(['--self-test']);
    expect(status).toBe(0);
    // The verdict line is what makes exit 0 mean something: a `return` above it
    // would print nothing and still exit 0.
    expect(stdout).toMatch(/All \d+ self-test cases passed\./);
  });

  it('...and it runs at or above its pinned case floor', () => {
    const { stdout } = run(['--self-test']);
    const match = stdout.match(/All (\d+) self-test cases passed\./);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(SELF_TEST_CASE_FLOOR);
  });

  it('an unknown option is a USAGE error, distinct from a finding', () => {
    const { status } = run(['--no-such-flag']);
    expect(status).toBe(EXIT_USAGE);
    expect(status).not.toBe(EXIT_DISAGREEMENT);
  });

  it('--masker with no path is a usage error rather than a silent default', () => {
    expect(run(['--masker']).status).toBe(EXIT_USAGE);
  });
});

describe('check-comment-mask-corpus — argument parsing, read as values', () => {
  /**
   * The case that caught the defect this port fixed relative to upstream: with
   * `--masker` absent, `indexOf` returns -1 and the naive filter drops index 0
   * instead of the flag pair, so an unknown FIRST option vanished from the list
   * the unknown-option check reads. The symptom was a full sweep and exit 0 for
   * a misspelled flag -- a gate reporting on something other than what it was
   * asked for.
   */
  it('an unknown option is reported even when it is argv[0] and --masker is absent', () => {
    expect(parseArgs(['--no-such-flag']).errors).toHaveLength(1);
    expect(parseArgs(['--no-such-flag']).errors[0]).toContain('--no-such-flag');
  });

  it('...and in any other position too', () => {
    expect(parseArgs(['--self-test', '--no-such-flag']).errors).toHaveLength(1);
    expect(parseArgs(['--masker', 'm.mjs', '--no-such-flag']).errors).toHaveLength(1);
  });

  it('a well-formed command line parses to values and no errors', () => {
    expect(parseArgs([])).toEqual({ maskerPath: null, selfTest: false, errors: [] });
    expect(parseArgs(['--self-test'])).toEqual({ maskerPath: null, selfTest: true, errors: [] });
    expect(parseArgs(['--masker', 'scripts/m.mjs'])).toEqual({
      maskerPath: 'scripts/m.mjs',
      selfTest: false,
      errors: [],
    });
  });

  it('--masker without a path is an error, and a following flag is not eaten as its value', () => {
    expect(parseArgs(['--masker']).errors).toHaveLength(1);
    expect(parseArgs(['--masker']).maskerPath).toBeNull();
    // Parsed BEFORE the mode dispatch, so a mode flag later in argv cannot skip
    // the malformed `--masker` silently.
    expect(parseArgs(['--masker', '--self-test']).errors).toHaveLength(1);
    expect(parseArgs(['--masker', '--self-test']).maskerPath).toBeNull();
  });
});

describe('check-comment-mask-corpus — the comparator can REPORT (the anti-vacuity cases)', () => {
  it('a masker that flags no comment is reported as FABRICATES, with an exact byte count', () => {
    const source = '// a line comment\nconst a = 1;\n';
    const result = compareFile('a.ts', source, { scan: flagNothing, parse });
    expect(result.fabricates).toBe('// a line comment'.length);
    expect(result.overMasks).toBe(0);
    expect(result.firstDivergence?.direction).toBe('FABRICATES');
  });

  it('a masker that flags everything is reported as OVER-MASKS', () => {
    const source = 'const a = 1;\n';
    const flagEverything = (s: string) => ({ comment: new Uint8Array(s.length).fill(1) });
    const result = compareFile('a.ts', source, { scan: flagEverything, parse });
    expect(result.overMasks).toBeGreaterThan(0);
    expect(result.fabricates).toBe(0);
  });

  it('the real masker and the parser agree on an ordinary source', () => {
    const source = '// one\nconst a = 1; /* two */\n';
    const result = compareFile('a.ts', source, { scan: scanSource, parse });
    expect(result.fabricates).toBe(0);
    expect(result.overMasks).toBe(0);
  });

  it('an unparseable source REFUSES rather than scoring clean', () => {
    expect(() => compareFile('a.ts', 'const = = ;;;\nfunction (', { scan: scanSource, parse })).toThrow(
      UnparseableSource,
    );
  });

  it('the shebang is reconciled — the parser reports no comment for it', () => {
    const shebang = '#!/usr/bin/env node\nconst a = 1;\n';
    expect(compareFile('a.mjs', shebang, { scan: scanSource, parse }).fabricates).toBe(0);
    // ...and the reconciliation is real, not a coincidence of both sides
    // ignoring it: the oracle flags those bytes.
    expect(oracleComments('a.mjs', shebang, parse)[0]).toBe(1);
  });
});

describe('check-comment-mask-corpus — objectui#7882, the residue this port measures', () => {
  /**
   * The card leads with a phantom REGEX. The shape that actually reaches this
   * tree's comment array is a phantom BLOCK COMMENT: a `/` in JSX text whose
   * next byte is `*`. Pinned here because the ceiling in `KNOWN_RESIDUE` is only
   * honest while the instrument behind it can still see the thing it bounds.
   */
  it('a `/` in JSX text followed by `*` over-masks, and fabricates nothing', () => {
    const source = 'export const D = () => <code>src/docs/*.md</code>;\n';
    const result = compareFile('a.tsx', source, { scan: scanSource, parse });
    expect(result.overMasks).toBeGreaterThan(0);
    expect(result.fabricates).toBe(0);
    expect(result.firstDivergence?.direction).toBe('OVER-MASKS');
  });

  it('the phantom runs to end of FILE when no terminator follows', () => {
    // Two lines, and the second is swallowed whole: this is why one file cost
    // 1,517 bytes rather than the tail of one line.
    const source = 'export const D = () => <code>a/*b</code>;\nexport const E = 1;\n';
    const result = compareFile('a.tsx', source, { scan: scanSource, parse });
    expect(result.overMasks).toBeGreaterThan('export const E = 1;'.length);
  });
});

describe('check-comment-mask-corpus — the verdict, which is this port\'s divergence', () => {
  const clean = { fabricatedBytes: 0, overMaskedBytes: 0, disagreements: [], unparseable: [] };

  it('a clean sweep is ok', () => {
    expect(judge(clean).ok).toBe(true);
  });

  it('ONE fabricated byte is fatal, even though the tree declares residue', () => {
    const verdict = judge({ ...clean, fabricatedBytes: 1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.breaches).toHaveLength(1);
  });

  it('over-masked bytes AT the ceiling are a report, and one byte over is not', () => {
    const at = judge({ ...clean, overMaskedBytes: KNOWN_RESIDUE.maxOverMaskedBytes, disagreements: [{}] });
    expect(at.ok).toBe(true);
    const over = judge({ ...clean, overMaskedBytes: KNOWN_RESIDUE.maxOverMaskedBytes + 1, disagreements: [{}] });
    expect(over.ok).toBe(false);
  });

  it('a second disagreeing file breaches the file ceiling', () => {
    expect(judge({ ...clean, disagreements: [{}] }).ok).toBe(true);
    expect(judge({ ...clean, disagreements: [{}, {}] }).ok).toBe(false);
  });

  it('an unparseable file is fatal on its own — never scored as nothing to report', () => {
    expect(judge({ ...clean, unparseable: [{}] }).ok).toBe(false);
  });

  it('the declared residue asserts ZERO fabricated bytes', () => {
    // The ceiling is over-masking only. If this ever becomes nonzero, the
    // direction the masker's header calls worse than no verifier at all has
    // been given an allowance, which is a decision and not a bump.
    expect(KNOWN_RESIDUE.fabricatedBytes).toBe(0);
    expect(KNOWN_RESIDUE.card).toBe('objectui#7882');
  });
});

describe('check-comment-mask-corpus — the sweep, driven RED over a fixture tree', () => {
  it('reports a disagreeing file and judges it a breach', () => {
    const root = fixture({ 'src/a.ts': '// a comment\nconst a = 1;\n' });
    try {
      const result = sweep({ root, parse, scan: flagNothing });
      expect(result.files).toHaveLength(1);
      expect(result.disagreements).toHaveLength(1);
      expect(result.fabricatedBytes).toBe('// a comment'.length);
      expect(judge(result).ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('...and is GREEN over the same tree with the real masker', () => {
    const root = fixture({ 'src/a.ts': '// a comment\nconst a = 1;\n' });
    try {
      const result = sweep({ root, parse, scan: scanSource });
      expect(result.disagreements).toHaveLength(0);
      expect(judge(result).ok).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an unparseable file is collected and reported, not skipped', () => {
    const root = fixture({ 'src/broken.ts': 'const = = ;;;\nfunction (\n' });
    try {
      const result = sweep({ root, parse, scan: scanSource });
      expect(result.unparseable).toHaveLength(1);
      expect(judge(result).ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check-comment-mask-corpus — the walk', () => {
  it('excludes a skipped directory by LOCATION, not by content', () => {
    const same = 'export const Probe = () => null;\n';
    const root = fixture({ 'src/probe.tsx': same, 'dist/probe.tsx': same });
    try {
      const collected = collectSources(root).map((file: string) => path.relative(root, file));
      expect(collected).toContain(path.join('src', 'probe.tsx'));
      expect(collected).not.toContain(path.join('dist', 'probe.tsx'));
      // The identical bytes would have disagreed if they had been walked, so
      // the exclusion is doing the work and not the file being clean.
      const wouldDisagree = compareFile(path.join(root, 'dist', 'probe.tsx'), same, { scan: flagNothing, parse });
      expect(wouldDisagree.fabricates + wouldDisagree.overMasks).toBe(0);
      const flagEverything = (s: string) => ({ comment: new Uint8Array(s.length).fill(1) });
      expect(compareFile(path.join(root, 'dist', 'probe.tsx'), same, { scan: flagEverything, parse }).overMasks)
        .toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('collects only TRACKED files: an untracked build temp file beside a tracked source is not listed', () => {
    // objectui#11040. tsup writes `tsup.config.bundled_*.mjs` mid-build and
    // deletes it; a walk of the working tree listed it and the read threw.
    const root = fixture({ 'packages/cli/tsup.config.ts': 'export default {};\n' });
    try {
      fs.writeFileSync(path.join(root, 'packages', 'cli', 'tsup.config.bundled_x1.mjs'), 'export default {};\n', 'utf8');
      const collected = collectSources(root).map((file: string) => path.relative(root, file));
      expect(collected).toEqual([path.join('packages', 'cli', 'tsup.config.ts')]);
      // The control: the same file, once added, IS listed.
      execFileSync('git', ['add', '-f', '--', path.join('packages', 'cli', 'tsup.config.bundled_x1.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
      expect(collectSources(root)).toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a path listed and then deleted before the read is absent in the sweep, not thrown on', () => {
    const root = fixture({ 'src/kept.ts': '// a comment\nconst a = 1;\n', 'src/gone.ts': '// a comment\nconst b = 2;\n' });
    try {
      const listed = collectSources(root);
      expect(listed).toHaveLength(2);
      fs.rmSync(path.join(root, 'src', 'gone.ts'));
      const result = sweep({ root, files: listed, parse, scan: flagNothing });
      expect(result.absent).toEqual([path.join('src', 'gone.ts')]);
      // Only the file that was read is judged.
      expect(result.disagreements.map((row: { file: string }) => row.file)).toEqual([path.join('src', 'kept.ts')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores files whose extension is not a source extension', () => {
    const root = fixture({ 'src/a.ts': 'const a = 1;\n', 'src/notes.md': '# hi\n', 'src/data.json': '{}\n' });
    try {
      expect(collectSources(root)).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips apps/site/.source — generated, gitignored, and not this tree to judge', () => {
    // Dropped upstream's `.cache` (objectstack-only) and added this repo's own
    // generated trees; `.source` is the one that exists today and really was in
    // the corpus before this entry.
    expect(SKIPPED_DIRECTORIES.has('.source')).toBe(true);
    expect(SKIPPED_DIRECTORIES.has('node_modules')).toBe(true);
    expect(SKIPPED_DIRECTORIES.has('dist')).toBe(true);
  });

  it('the real tree is above the corpus floor, so a green run is not a green over nothing', () => {
    const files = collectSources();
    expect(files.length).toBeGreaterThanOrEqual(CORPUS_FLOOR);
    expect(files.every((file: string) => SOURCE_EXTENSIONS.has(path.extname(file)))).toBe(true);
  });
});
