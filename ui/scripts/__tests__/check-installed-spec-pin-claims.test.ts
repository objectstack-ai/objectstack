import { describe, expect, it } from 'vitest';
import { lockfilePath } from '../workspace-root.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  CLAIM_MARKERS,
  HISTORICAL_CUES,
  LEDGER,
  LEDGER_CLASSES,
  attributePackage,
  bareMajorsFor,
  isScanned,
  judge,
  pinsFromLockfile,
  pinsFromResolvedTree,
  recogniseLine,
  reconcilePins,
  run,
} from '../check-installed-spec-pin-claims.mjs';

/**
 * objectui#8924 — the test for the installed-pin claim gate.
 *
 * ## Why the controls are shaped the way they are
 *
 * objectui#8897 corrected the "the pin is 17.3.0" sentences with a probe that
 * was version-literal on `17.3.0`. It could not have found the identical
 * sentence about 17.2.0, and it did not. The instrument, not the sentences, is
 * what this file is about — so every refusal below is demonstrated on a REAL
 * line of this tree, LOCATED AT RUN TIME by a stable substring rather than
 * copied in, and every refusal is paired with a FIRING CONTROL: the same line,
 * minimally mutated, which the recogniser DOES flag.
 *
 * ⚠️ The pairing is the whole point. A refusal shown only on lines where
 * nothing could have fired is not evidence of a distinction — it is evidence of
 * a probe that never fires, which passes exactly as green.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAJORS = ['17'];

/** The one line of `file` containing every fragment, or a failure naming what was missing. */
function lineContaining(file: string, ...fragments: string[]): string {
  const hits = fs
    .readFileSync(path.join(repoRoot, file), 'utf8')
    .split('\n')
    .filter((l) => fragments.every((f) => l.includes(f)));
  expect(
    hits.length,
    `expected exactly one line of ${file} containing ${JSON.stringify(fragments)}; found ${hits.length}. ` +
      'If the sentence was rewritten, re-read it and re-point this control — do not delete it.',
  ).toBe(1);
  return hits[0];
}

describe('the "when it changed" refusal, on real sentences, each with a firing control', () => {
  /**
   * REFUSAL 1 — refused at the MARKER, by a word boundary.
   *
   * The line is a textbook "when it changed" sentence: "New in
   * `@objectstack/spec` 17.3.0, which declares it with no top-level key at
   * all". It contains the letters `installed` only inside the identifier
   * `MarketplaceRowActions.installedAppsPins.test.tsx`. An unbounded
   * `/installed/` marker — the obvious spelling — puts this line in the
   * population, and "repairing" it would delete a true fact about 17.3.0.
   */
  const historicalMarkerLine = () =>
    lineContaining(
      'apps/console/src/__tests__/registry-inputs-spec-parity.test.ts',
      'installedAppsPins',
      '17.3.0',
      'New in',
    );

  it('refuses "New in @objectstack/spec 17.3.0 ... installedAppsPins"', () => {
    const line = historicalMarkerLine();
    expect(line).toMatch(/17\.3\.0/);
    expect(recogniseLine(line, MAJORS).verdict).toBe('none');
  });

  it('FIRING CONTROL: the same line fires once a real marker is put on it', () => {
    const line = historicalMarkerLine().replace('New in', 'the pin is');
    const verdict = recogniseLine(line, MAJORS);
    expect(verdict.verdict).toBe('claim');
    expect(verdict.claims.map((c: { version: string }) => c.version)).toContain('17.3.0');
  });

  /**
   * REFUSAL 2 — refused at a CUE, past-tense copula in front of the marker.
   * "What held them was the installed contract, not a judgement —
   * `@objectstack/spec` 17.0.0". The marker is genuinely there; the tense is
   * what declines it.
   */
  const historicalCueLine = () =>
    lineContaining('apps/console/src/__tests__/registry-inputs-spec-parity.test.ts', 'was the installed contract');

  it('refuses "was the installed contract ... @objectstack/spec 17.0.0"', () => {
    const line = historicalCueLine();
    const verdict = recogniseLine(line, MAJORS);
    expect(verdict.verdict).toBe('refused');
    expect(verdict.refusedBy).toBe('was-the-installed');
    // The marker and the version were both found: nothing here is declining on
    // a technicality, the sentence's TENSE is what declines it.
    expect(verdict.marker).toBe('installed');
    expect(verdict.claims.map((c: { version: string }) => c.version)).toContain('17.0.0');
  });

  it('FIRING CONTROL: the same line fires in the present tense', () => {
    const line = historicalCueLine().replace('was the installed', 'is the installed');
    const verdict = recogniseLine(line, MAJORS);
    expect(verdict.verdict).toBe('claim');
    expect(verdict.claims.map((c: { version: string }) => c.version)).toContain('17.0.0');
  });

  it('every historical cue still fires on the line it was taken from', () => {
    // A cue whose citation has drifted is a rule nobody can check. This walks
    // the whole set rather than the two featured above, so the set cannot rot
    // one entry at a time.
    for (const cue of HISTORICAL_CUES) {
      expect(cue.cited, `cue ${cue.id} carries no citation`).toBeTruthy();
      expect(cue.re.test(cue.cited), `cue ${cue.id} does not match its own citation`).toBe(true);
    }
  });
});

describe('the recogniser, on real claim shapes', () => {
  it('recognises the present-tense claim shapes objectui#8924 enumerated', () => {
    const lines = [
      ' * Measured against the installed `@objectstack/spec` 17.2.0 (ESM build):',
      " * `@objectstack/spec` 17.1.0 (this repo's pin resolves 17.2.0). Its published",
      ' * Interim, and it self-expires: the pin is still `@objectstack/spec` 17.2.0,',
      ' * installed pin (`@objectstack/spec@17.2.0`), the element at all four converted',
      ' * is pinned at 17.0.0, whose `I18nLabelSchema` is',
    ];
    for (const line of lines) expect(recogniseLine(line, MAJORS).verdict, line).toBe('claim');
  });

  it('declines a declared RANGE — a floor is not a statement about what is installed', () => {
    expect(recogniseLine(' * this repo is pinned to `^17.0.0-rc.6`, which has no such key', MAJORS).verdict).toBe('none');
    expect(recogniseLine(' * the installed spec satisfies `>=17.2.0`', MAJORS).verdict).toBe('none');
  });

  it('keeps a prerelease tail whole, and stops at the sentence full stop', () => {
    const v = recogniseLine(' * `LocaleConfigSchema` up to and including 17.0.0-rc.5. The pinned', MAJORS);
    expect(v.claims.map((c: { version: string }) => c.version)).toEqual(['17.0.0-rc.5']);
  });
});

describe('attribution — a version on the line is not automatically the anchor', () => {
  const at = (line: string, needle: string) => attributePackage(line, line.indexOf(needle), MAJORS);

  it('an ATTACHED foreign package declines outright', () => {
    expect(at('transitive dependency pinned to `zod@3.25.76`. It cannot convert', '3.25.76')).toBeNull();
  });

  it('a bare version on another package\'s major line declines', () => {
    // Real lines from this tree, each of which an unguarded default would have
    // read as a claim about the spec.
    expect(at("* current install state (\"Installed v1.0.0\" / \"Update to v1.0.1\")", '1.0.0')).toBeNull();
    expect(at(' * in the installed tree, all ten of them resolving to 1.7.3 before the pin:', '1.7.3')).toBeNull();
    expect(at(' * the installed recharts 3.10.1 for bar, line and area, clicking a mark and', '3.10.1')).toBeNull();
  });

  it('a NAMED foreign package declines even on the anchor major', () => {
    // The guard the major test cannot provide: same major, different package.
    expect(at(' * Measured on this repo\'s pinned React 17.0.2 while', '17.0.2')).toBeNull();
  });

  it('a bare version on the anchor major, after a connective, is the anchor', () => {
    expect(at(' * Measured on the installed 17.2.0 and asserted in `the instrument` below:', '17.2.0')).toBe('@objectstack/spec');
  });

  it('an attached anchor package wins over a second anchor named on the line', () => {
    expect(at(' * pointed at a copy of the installed `@objectstack/client@17.2.0` placed', '17.2.0')).toBe('@objectstack/client');
  });
});

describe('the pin, read from two faces', () => {
  const lock = pinsFromLockfile(fs.readFileSync(lockfilePath(), 'utf8'));
  const workspaces = execFileSync('git', ['-C', repoRoot, 'ls-files', '--', '*/package.json'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /^(packages|apps|examples)\/[^/]+\/package\.json$/.test(f))
    .map((f) => path.dirname(f));

  it('the lockfile and the resolved tree agree about @objectstack/spec', () => {
    const tree = pinsFromResolvedTree(repoRoot, workspaces);
    const { pins, conflicts } = reconcilePins(lock, tree);
    expect(conflicts.filter((c: { package: string }) => c.package === '@objectstack/spec')).toEqual([]);
    expect(pins.get('@objectstack/spec')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('a disagreement between the faces yields NO pin — it does not pick a side', () => {
    const twoFaced = reconcilePins(
      new Map([['@objectstack/spec', new Set(['17.4.0'])]]),
      new Map([['@objectstack/spec', new Set(['17.3.0'])]]),
    );
    expect(twoFaced.pins.has('@objectstack/spec')).toBe(false);
    expect(twoFaced.conflicts).toHaveLength(1);
  });

  it('follows a pinned-build `file:` resolution to the version its directory declares (objectui#12957)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-claims-'));
    try {
      const key = "  '@objectstack/spec@file:node_modules/.cache/objectstack/spec(ai@7.0.65(zod@4.6.7))':\n";
      expect(pinsFromLockfile(key, root).get('@objectstack/spec')).toEqual(
        new Set(['(pinned build absent: node_modules/.cache/objectstack/spec — run `pnpm objectstack:build`)']),
      );
      fs.mkdirSync(path.join(root, 'node_modules/.cache/objectstack/spec'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules/.cache/objectstack/spec/package.json'), '{"version":"18.0.0-next.3"}');
      expect(pinsFromLockfile(key, root).get('@objectstack/spec')).toEqual(new Set(['18.0.0-next.3']));
      // An absent build is a conflict that names it, never an empty face.
      const absent = reconcilePins(pinsFromLockfile(key, path.join(root, 'nowhere')), new Map([['@objectstack/spec', new Set(['18.0.0-next.3'])]]));
      expect(absent.pins.has('@objectstack/spec')).toBe(false);
      expect(absent.conflicts[0].lock[0]).toMatch(/pinned build absent/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a package in the lockfile but linked nowhere is transitive, not a conflict', () => {
    const transitive = reconcilePins(new Map([['@objectstack/core', new Set(['17.4.0'])]]), new Map());
    expect(transitive.conflicts).toEqual([]);
    expect(transitive.unlinked.map((u: { package: string }) => u.package)).toEqual(['@objectstack/core']);
  });
});

describe('the ledger ratchets in both directions', () => {
  const pins = new Map([['@objectstack/spec', '17.4.0']]);
  const claim = (file: string, line: number, version: string) => ({
    file,
    line,
    package: '@objectstack/spec',
    version,
    marker: 'installed',
    text: `installed ${version}`,
  });
  const entry = (sites: number) => ({
    file: 'a.ts',
    package: '@objectstack/spec',
    version: '17.2.0',
    sites,
    class: 'stale',
    why: 'a reason long enough to be a reason at all',
  });

  it('an UNLEDGERED drifting claim fails', () => {
    const v = judge({ pins, conflicts: [], claims: [claim('a.ts', 5, '17.2.0')], ledger: [] });
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toContain('the artifact resolves 17.4.0');
  });

  it('a ledgered drifting claim passes', () => {
    const v = judge({ pins, conflicts: [], claims: [claim('a.ts', 5, '17.2.0')], ledger: [entry(1)] });
    expect(v.findings).toEqual([]);
  });

  it('a ledger entry whose site was repaired fails — the list cannot rot into a hole', () => {
    const v = judge({ pins, conflicts: [], claims: [], ledger: [entry(1)] });
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toContain('LEDGER is stale');
  });

  it('a PARTIAL repair fails on the count, so half a fix cannot hide behind the entry', () => {
    const v = judge({ pins, conflicts: [], claims: [claim('a.ts', 5, '17.2.0')], ledger: [entry(2)] });
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toContain('LEDGER count is wrong');
  });

  it('a claim AT the pin needs no entry and is the half that goes red at the next bump', () => {
    const v = judge({ pins, conflicts: [], claims: [claim('a.ts', 5, '17.4.0')], ledger: [] });
    expect(v.findings).toEqual([]);
    expect(v.atPin).toHaveLength(1);

    // The same claim, judged against a moved pin: now it fails, unledgered.
    const bumped = judge({
      pins: new Map([['@objectstack/spec', '17.5.0']]),
      conflicts: [],
      claims: [claim('a.ts', 5, '17.4.0')],
      ledger: [],
    });
    expect(bumped.findings).toHaveLength(1);
  });

  it('an entry with no class, or no reason, fails', () => {
    const noClass = judge({
      pins,
      conflicts: [],
      claims: [claim('a.ts', 5, '17.2.0')],
      ledger: [{ ...entry(1), class: 'whatever' }],
    });
    expect(noClass.findings.join(' ')).toContain('one of stale, historical');

    const noWhy = judge({ pins, conflicts: [], claims: [claim('a.ts', 5, '17.2.0')], ledger: [{ ...entry(1), why: 'x' }] });
    expect(noWhy.findings.join(' ')).toContain('no usable reason');
  });

  it('bare-major attribution widens with the ledger, so a MAJOR bump does not empty the gate', () => {
    const majors = bareMajorsFor(new Map([['@objectstack/spec', '18.0.0']]), [{ version: '17.2.0' }]);
    expect(majors).toContain('18');
    expect(majors).toContain('17');
  });
});

describe('the scan surface', () => {
  it('excludes every CHANGELOG and every pending changeset by PATH', () => {
    expect(isScanned('packages/react-runtime/CHANGELOG.md')).toBe(false);
    expect(isScanned('CHANGELOG.md')).toBe(false);
    // ⛔ A synthetic name, never a PENDING changeset this repository carries
    // (objectui#9472). `scripts/markdown-test-inputs.mjs` resolves markdown
    // path literals out of test sources and offers only the ones that EXIST in
    // the tree, so a literal naming a pending declaration becomes a ledger
    // entry — and `pnpm changeset:version` deletes exactly those files, which
    // turned this assertion's old literal into a `stale-not-read` finding and
    // reddened `Validate the post-version tree` on every scheduled release run.
    // The exclusion under test is by PATH PREFIX, so the basename carries no
    // meaning here beyond sitting under the changeset directory.
    expect(isScanned('.changeset/fixture-pending-declaration.md')).toBe(false);
    expect(isScanned('pnpm-lock.yaml')).toBe(false);
    expect(isScanned('packages/types/src/field-types.ts')).toBe(true);
  });
});

describe('this repository, right now', () => {
  const result = run(repoRoot);

  it('has no unledgered drift and no rotted ledger entry', () => {
    expect(result.findings).toEqual([]);
  });

  it('resolves one pin per anchor package from both faces', () => {
    expect(result.conflicts).toEqual([]);
    expect(result.pins.get('@objectstack/spec')).toBeTruthy();
  });

  it('still sees a population — an empty scan is a FAILED run, not a clean one', () => {
    // The failure this guards is the one objectui#8897's probe had: an
    // instrument that stops matching reads exactly like a tree that got fixed.
    expect(result.claims.length).toBeGreaterThan(40);
    expect(LEDGER.length).toBeGreaterThan(20);
    expect(result.atPin.length).toBeGreaterThan(0);
  });

  it('every ledger entry carries a class from the closed set and a real reason', () => {
    for (const e of LEDGER) {
      expect(LEDGER_CLASSES, `${e.file} ${e.version}`).toContain(e.class);
      expect(e.why.length, `${e.file} ${e.version}`).toBeGreaterThan(20);
    }
  });

  it('every claim marker is one objectui#8924 named', () => {
    expect(CLAIM_MARKERS.map((m: { id: string }) => m.id)).toEqual([
      'installed',
      'repo-pin',
      'pin-is',
      'pinned',
      'at-that-pin',
    ]);
  });
});
