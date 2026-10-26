import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  EXIT_CODES,
  JSON_FENCE_LANGUAGES,
  KNOWN_BARE_ANY_EXAMPLES,
  KNOWN_ROOT_DEVDEP_EXAMPLES,
  KNOWN_SHADOWED_PUBLISHED_TYPES,
  MARKED_FLOOR,
  MARKER,
  SCAN_ROOTS,
  TS_FENCE_LANGUAGES,
  analyze,
  bareAnyRowKey,
  buildFilterArgs,
  classifyRootDevDep,
  classifyShadowedTypes,
  fenceSpans,
  findBareAny,
  findLocalTypeDeclarations,
  floorReport,
  listGuides,
  markedPopulation,
  parseJsonFence,
  reconcileFloors,
  rootDevDepRowKey,
  scanSkillFences,
  scopedBuildNotice,
  shadowCandidates,
  shadowedTypeRowKey,
  stripJsonComments,
} from '../check-skill-examples.mjs';
import {
  moduleSpecifiersOfBlock,
  resolvesOnlyThroughRootManifest,
  rootDeclaredSpecifiers,
  specifierRoot,
} from '../check-doc-snippet-types.mjs';

/**
 * objectui#7359 — the test for `scripts/check-skill-examples.mjs`.
 *
 * ## What this file covers, and what it deliberately leaves to `--self-test`
 *
 * Everything here runs on an UNBUILT tree: the fence scanner, the marker
 * convention, the JSON dialects, and the wiring. That boundary is not tidiness —
 * this suite runs inside `ci.yml`'s `Test (shard N/16)` jobs, which do not build
 * the workspace, and a test that needed `dist/*.d.ts` would either be flaky or
 * would quietly assert nothing there.
 *
 * The compiler half — a marked fence that holds up is clean, a marked fence with
 * a type error is red, an unparseable one is a SYNTAX failure and does not blind
 * the semantic phase for the rest — lives in the script's own `--self-test`,
 * which the workflow runs AFTER the build, and which refuses with
 * `PRECONDITION NOT MET` (exit 2) rather than skipping if the tree is not built.
 * `wiring` below pins that the workflow really runs it, because a probe nobody
 * runs is indistinguishable from a probe that passes.
 *
 * The fixtures are strings and throwaway trees, never the real guides: a
 * committed fixture guide would have to contain a deliberately broken example,
 * and something else in this repository would eventually scan it — the reasoning
 * `check-skills-paths.test.ts` states for its own trees.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Builds a throwaway tree and hands the caller its root. */
function withTree<T>(
  build: (write: (rel: string, contents: string) => void) => void,
  run: (dir: string) => T,
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-skill-examples-'));
  const write = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  try {
    build(write);
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Fence = { kind: string; language: string; fenceLine: number; body: string; marked: boolean };
type Scan = { fences: Fence[]; orphans: number[] };

describe('the marker, and what it opts in', () => {
  it('is the exact spelling objectstack uses — the convention is one convention', () => {
    // Byte-for-byte. A near-spelling would be a second convention that looks
    // like the first, and the orphan scan below is what makes the difference
    // loud instead of silent.
    expect(MARKER).toBe('<!-- os:check -->');
  });

  it('opts in the fence on the line DIRECTLY below it', () => {
    const scan: Scan = scanSkillFences([MARKER, '```typescript', 'export const a = 1;', '```'].join('\n'));
    expect(scan.fences).toHaveLength(1);
    expect(scan.fences[0].marked).toBe(true);
    expect(scan.fences[0].fenceLine).toBe(2);
    expect(scan.fences[0].body).toBe('export const a = 1;');
    expect(scan.orphans).toEqual([]);
  });

  it('does NOT reach across a blank line — that marker is an orphan', () => {
    // The rule that costs nothing to keep strict and everything to relax. A
    // marker one blank line away opts in NOTHING, and under a lenient
    // "nearest non-blank line above" rule the author would never learn that.
    const scan: Scan = scanSkillFences([MARKER, '', '```typescript', 'export const a = 1;', '```'].join('\n'));
    expect(scan.fences[0].marked).toBe(false);
    expect(scan.orphans).toEqual([1]);
  });

  it('reports a marker above a fence it cannot judge as an orphan', () => {
    const scan: Scan = scanSkillFences([MARKER, '```bash', 'pnpm install', '```'].join('\n'));
    expect(scan.fences).toEqual([]);
    expect(scan.orphans).toEqual([1]);
  });

  it('reports a marker left behind above prose', () => {
    const scan: Scan = scanSkillFences(['# Guide', '', MARKER, '', 'Some prose.'].join('\n'));
    expect(scan.orphans).toEqual([3]);
  });

  it('ignores leading and trailing whitespace on the marker line', () => {
    const scan: Scan = scanSkillFences([`  ${MARKER}  `, '```json', '{"a":1}', '```'].join('\n'));
    expect(scan.fences[0].marked).toBe(true);
    expect(scan.orphans).toEqual([]);
  });

  it('does not accept a marker with anything else on its line', () => {
    const scan: Scan = scanSkillFences([`${MARKER} and more`, '```json', '{"a":1}', '```'].join('\n'));
    expect(scan.fences[0].marked).toBe(false);
    // ...and it is not an orphan either: it is not the marker, it is prose that
    // contains it. Only the exact line makes a claim.
    expect(scan.orphans).toEqual([]);
  });
});

describe('fence-awareness — a marker shown as example text claims nothing', () => {
  /**
   * This gate's convention has to be documentable in the very guides it
   * governs, and in this file. So the two questions the walk answers — "is this
   * marker at top level?" and "does this line open a fence?" — read one array,
   * and a nested illustration is neither an opt-in nor an orphan.
   */
  it('extracts nothing from a fully worked illustration inside a wrapper fence', () => {
    const scan: Scan = scanSkillFences(
      ['````markdown', MARKER, '```typescript', 'const illustrative = 1;', '```', '````'].join('\n'),
    );
    expect(scan.fences).toEqual([]);
    expect(scan.orphans).toEqual([]);
  });

  it('extracts everything from the identical payload when it is NOT nested', () => {
    // The control on the case above: without it, a walk that extracted nothing
    // for the wrong reason would pass.
    const scan: Scan = scanSkillFences([MARKER, '```typescript', 'const illustrative = 1;', '```'].join('\n'));
    expect(scan.fences).toHaveLength(1);
    expect(scan.fences[0].marked).toBe(true);
  });

  it('reads the fence body to the closing line the SAME walk chose', () => {
    const { owners, closeOf } = fenceSpans(['```ts', 'a', '```', 'top level'].join('\n').split('\n'));
    expect(owners).toEqual([0, 0, 0, -1]);
    expect(closeOf.get(0)).toBe(2);
  });

  it('lets an unclosed fence run to end of file rather than throwing', () => {
    const scan: Scan = scanSkillFences(['```typescript', 'const a = 1;', '', '# still inside'].join('\n'));
    expect(scan.fences).toHaveLength(1);
    expect(scan.fences[0].body).toBe('const a = 1;\n\n# still inside');
  });

  it('normalises CRLF, so no regex has to decide whether \\s matches a carriage return', () => {
    const scan: Scan = scanSkillFences([MARKER, '```json', '{"a":1}', '```'].join('\r\n'));
    expect(scan.fences).toHaveLength(1);
    expect(scan.fences[0].marked).toBe(true);
    expect(scan.fences[0].body).toBe('{"a":1}');
  });
});

describe('languages', () => {
  it('recognises the three TypeScript spellings and the two JSON ones', () => {
    expect([...TS_FENCE_LANGUAGES].sort()).toEqual(['ts', 'tsx', 'typescript']);
    expect([...JSON_FENCE_LANGUAGES].sort()).toEqual(['json', 'jsonc']);
  });

  it('classifies each candidate by kind', () => {
    const scan: Scan = scanSkillFences(
      ['```tsx', 'const a = <div />;', '```', '', '```jsonc', '{}', '```'].join('\n'),
    );
    expect(scan.fences.map((f) => [f.language, f.kind])).toEqual([
      ['tsx', 'ts'],
      ['jsonc', 'json'],
    ]);
  });

  it('ignores a language it cannot judge', () => {
    const scan: Scan = scanSkillFences(['```css', '.a { color: red }', '```'].join('\n'));
    expect(scan.fences).toEqual([]);
  });
});

describe('JSON fences — `json` is strict, `jsonc` is exactly two things looser', () => {
  it('accepts valid JSON', () => {
    expect(parseJsonFence('{"a": 1}', 'json')).toBeNull();
  });

  it('rejects a trailing comma under `json`', () => {
    // A `json` fence is a claim about what a real `.json` file may contain, so a
    // tolerant parser here would bless a file no `JSON.parse` in the product
    // would accept.
    expect(parseJsonFence('{"a": 1,}', 'json')).not.toBeNull();
  });

  it('rejects a comment under `json`', () => {
    expect(parseJsonFence('{\n  // nope\n  "a": 1\n}', 'json')).not.toBeNull();
  });

  it('accepts both under `jsonc`', () => {
    expect(parseJsonFence('{"a": 1,}', 'jsonc')).toBeNull();
    expect(parseJsonFence('{\n  /* fine */\n  "a": 1\n}', 'jsonc')).toBeNull();
  });

  it('does not mistake a `//` inside a string for a comment', () => {
    // Written as a scanner rather than a regex for exactly this: a URL in a
    // guide example is not hypothetical.
    expect(stripJsonComments('{"url": "https://example.com/x"}')).toBe('{"url": "https://example.com/x"}');
    expect(parseJsonFence('{"url": "https://example.com/x"}', 'jsonc')).toBeNull();
  });

  it('does not mistake an escaped quote for the end of a string', () => {
    expect(stripJsonComments('{"a": "he said \\"//\\" here"}')).toBe('{"a": "he said \\"//\\" here"}');
  });

  it('keeps line count stable when it blanks a block comment', () => {
    // Diagnostics quote line numbers; a stripper that collapsed lines would
    // point at the wrong one.
    const source = '{\n/* one\n   two */\n"a": 1\n}';
    expect(stripJsonComments(source).split('\n')).toHaveLength(source.split('\n').length);
  });

  it('reports a truncated object rather than accepting it', () => {
    expect(parseJsonFence('{"a": 1', 'json')).not.toBeNull();
  });
});

describe('the scan surface is a decision, stated here rather than read off the walker', () => {
  it('walks the published bundle AND `.claude/skills`, and nothing else', () => {
    // objectui#7463 item 3 widened this to `.claude/skills`, the same widening
    // `check-skills-paths.mjs` took in objectui#7358 and for the same reason:
    // when objectui#7251 moved the contributor-only guides out of `skills/`,
    // a gate rooted only at `skills` silently stopped looking at them. It
    // stays a stated decision with a measurement, never a silent drift — the
    // widening added 9 candidate fences and ZERO marked ones.
    expect(SCAN_ROOTS).toEqual(['skills', '.claude/skills']);
  });

  it('collects every `.md` under the roots, recursively and in a stable order', () => {
    withTree(
      (write) => {
        write('skills/objectui/guides/b.md', '# b\n');
        write('skills/objectui/guides/a.md', '# a\n');
        write('skills/objectui/SKILL.md', '# skill\n');
        write('skills/objectui/notes.txt', 'not markdown\n');
        write('content/docs/elsewhere.md', '# not in scope\n');
      },
      (dir) => {
        expect(listGuides(dir)).toEqual([
          'skills/objectui/SKILL.md',
          'skills/objectui/guides/a.md',
          'skills/objectui/guides/b.md',
        ]);
      },
    );
  });

  it('returns an empty list rather than throwing when a root is absent', () => {
    withTree(
      (write) => write('README.md', '# nothing here\n'),
      (dir) => expect(listGuides(dir)).toEqual([]),
    );
  });

  it('really does read the published bundle in this checkout', () => {
    // Non-vacuity: every assertion above is about fixtures, and a gate pointed
    // at a root that does not exist would satisfy all of them while judging
    // nothing at all.
    const guides = listGuides(repoRoot) as string[];
    expect(guides.length).toBeGreaterThan(5);
    expect(guides.every((g) => SCAN_ROOTS.some((r) => g.startsWith(`${r}/`)))).toBe(true);
    // Both roots must actually be non-empty in this checkout, or the widening
    // would be a root list nothing reads — the vacuity this leg exists to deny.
    expect(guides.some((g) => g.startsWith('skills/'))).toBe(true);
    expect(guides.some((g) => g.startsWith('.claude/skills/'))).toBe(true);
  });
});

describe('the corpus this gate governs', () => {
  const guides = listGuides(repoRoot) as string[];
  const scans = guides.map((g) => ({
    guide: g,
    scan: scanSkillFences(fs.readFileSync(path.join(repoRoot, g), 'utf8')) as Scan,
  }));

  it('carries no orphan marker', () => {
    // The same verdict the gate reaches, asserted here too because this half
    // needs no build — so a stale marker is caught by the cheap job as well as
    // by the one that installs and builds.
    const orphans = scans.flatMap(({ guide, scan }) => scan.orphans.map((line) => `${guide}:${line}`));
    expect(
      orphans,
      `\`${MARKER}\` must be the line IMMEDIATELY above a ts/tsx/typescript/json/jsonc fence. ` +
        `At these sites it opts nothing in, so the example below reads as gated and is not:\n` +
        orphans.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('has a non-empty marked population — a gate that checks nothing must not report success', () => {
    const marked = scans.flatMap(({ scan }) => scan.fences.filter((f) => f.marked));
    expect(marked.length).toBeGreaterThan(0);
    // Both languages are really exercised. Without this the population could
    // collapse to one kind and the other half of the gate would be dead code
    // nobody noticed.
    expect(marked.some((f) => f.kind === 'ts')).toBe(true);
    expect(marked.some((f) => f.kind === 'json')).toBe(true);
  });

  it('leaves the majority unmarked — opt-in is the design, not a migration halfway done', () => {
    // Stated as a RATIO rather than a count on purpose, and it stays one now
    // that objectui#7550 has made the population shrink-only: that ratchet is a
    // FLOOR (`MARKED_FLOOR`, pinned below), which reds only downwards. An
    // equality pinned here would red on the next fence anyone opts IN, which is
    // the move this gate exists to encourage.
    const all = scans.flatMap(({ scan }) => scan.fences);
    const marked = all.filter((f) => f.marked);
    expect(marked.length).toBeLessThan(all.length);
  });

  it('spells every marker byte-identically', () => {
    // A near-spelling (`<!--os:check-->`, a smart dash, a stray space inside)
    // reads as a marker and claims nothing. It would surface as an orphan only
    // if it matched the orphan scan's own literal — which it does not.
    for (const guide of guides) {
      const source = fs.readFileSync(path.join(repoRoot, guide), 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        if (!/os:check/.test(line)) continue;
        expect(line, `${guide}:${index + 1} carries a near-spelling of the marker`).toBe(MARKER);
      }
    }
  });
});

/**
 * objectui#7550 — the marked population is SHRINK-ONLY, per category.
 *
 * objectui#7359 landed this gate with no ratchet and said so in as many words;
 * the ruling on objectstack #14909 item 2 took the deferred decision, as a
 * per-category FLOOR in `check-doc-fence-languages.mjs`'s shape. These pins
 * follow that gate's test file: both directions on fixtures, plus one reading of
 * the REAL corpus, so the committed numbers cannot drift away from the tree they
 * claim to describe while every fixture assertion stays green.
 *
 * All of it runs on an UNBUILT tree — the floor is a count over the scanner's
 * output, no compiler involved — so it belongs here rather than in `--self-test`.
 */
describe('the shrink-only floor on the marked population', () => {
  type Breach = { category: string; count: number; floor: number };
  const corpusMarked = (listGuides(repoRoot) as string[]).flatMap(
    (guide) =>
      (scanSkillFences(fs.readFileSync(path.join(repoRoot, guide), 'utf8')) as Scan).fences.filter(
        (f) => f.marked,
      ),
  );

  it('declares one floor per marked-fence category, and no others', () => {
    // The coupling pin, in the shape `check-doc-fence-languages.test.ts` uses
    // for its two walks: the categories are derived from the scanner rather
    // than restated, so a THIRD fence kind cannot be added without this line
    // going red and forcing a floor decision for it. A new kind that quietly
    // had no floor would be shrink-only in name over a population nothing
    // ratchets.
    const languages = [...TS_FENCE_LANGUAGES, ...JSON_FENCE_LANGUAGES] as string[];
    const scan: Scan = scanSkillFences(
      languages.flatMap((language) => [MARKER, `\`\`\`${language}`, '{}', '```']).join('\n'),
    );
    expect(scan.fences.every((f) => f.marked)).toBe(true);
    expect([...MARKED_FLOOR.keys()].sort()).toEqual([...new Set(scan.fences.map((f) => f.kind))].sort());
  });

  it('counts per category, and a category with no marker left reads as 0 rather than absent', () => {
    // "Shrank to nothing" and "was never a category here" are the two readings
    // a bare map of observed counts cannot tell apart, and the first is exactly
    // what this floor exists to catch.
    const population = markedPopulation([{ kind: 'ts' }, { kind: 'ts' }]) as Map<string, number>;
    expect(population.get('ts')).toBe(2);
    expect(population.has('json')).toBe(true);
    expect(population.get('json')).toBe(0);
  });

  it('is green when a category MEETS its floor, and when it is above it', () => {
    const floors = new Map([
      ['ts', 2],
      ['json', 1],
    ]);
    expect(reconcileFloors(new Map([['ts', 2], ['json', 1]]), floors)).toEqual([]);
    // Above the floor is deliberately NOT a failure: opting one more fence in is
    // the direction this gate travels, and a ratchet that reds on the good move
    // is one people route around — here, by unmarking.
    expect(reconcileFloors(new Map([['ts', 9], ['json', 4]]), floors)).toEqual([]);
  });

  it('reds BELOW the floor, naming the category, the count and the floor', () => {
    const floors = new Map([
      ['ts', 2],
      ['json', 1],
    ]);
    expect(reconcileFloors(new Map([['ts', 1], ['json', 1]]), floors)).toEqual([
      { category: 'ts', count: 1, floor: 2 },
    ]);
    expect(reconcileFloors(new Map([['ts', 0], ['json', 0]]), floors)).toEqual([
      { category: 'ts', count: 0, floor: 2 },
      { category: 'json', count: 0, floor: 1 },
    ]);
  });

  it('reports the population BESIDE its floor, which is what makes the number re-derivable', () => {
    expect(floorReport(new Map([['ts', 5]]), new Map([['ts', 3]]))).toBe('5 ts fence(s) (floor 3)');
    // And the real line names every governed category with both numbers on it.
    const line = floorReport(markedPopulation(corpusMarked)) as string;
    for (const [category, floor] of MARKED_FLOOR as Map<string, number>) {
      expect(line).toContain(`${category} fence(s) (floor ${floor})`);
    }
  });

  it('the committed floors are MET by the corpus in this checkout', () => {
    const breaches = reconcileFloors(markedPopulation(corpusMarked)) as Breach[];
    expect(
      breaches,
      'MARKED_FLOOR is shrink-only. If a marker was deliberately removed, lower the number ' +
        'in scripts/check-skill-examples.mjs and write the reason beside the row:\n' +
        breaches.map((b) => `  - ${b.category}: ${b.count} marked, floor ${b.floor}`).join('\n'),
    ).toEqual([]);
  });

  it('a floor ONE ABOVE the current count reds and names itself', () => {
    // The direction that has to fail, driven off the REAL population so it is a
    // statement about this corpus rather than about a fixture. Without this the
    // pin above could pass over an empty corpus, a floor of zero, or a
    // reconciler that never returns anything.
    const population = markedPopulation(corpusMarked) as Map<string, number>;
    const raised = new Map(
      [...(MARKED_FLOOR as Map<string, number>).keys()].map((c) => [c, (population.get(c) ?? 0) + 1]),
    );
    expect(reconcileFloors(population, raised)).toEqual(
      [...raised].map(([category, floor]) => ({ category, count: floor - 1, floor })),
    );
  });

  it('is READ by the gate, after the preconditions and never under `--measure`', () => {
    // Pinned as a source-level fact for the reason the harness-import pin
    // states for its own: a floor that is computed and never consulted passes
    // every assertion above. The ORDER is half the contract — an unbuilt tree
    // and an empty population are exit 2, and this ratchet must not be able to
    // re-label either of them as exit 1.
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-skill-examples.mjs'), 'utf8');
    const main = source.slice(source.indexOf('function main()'), source.indexOf('// ── Self-test'));
    expect(main, 'main() no longer reconciles the marked population against MARKED_FLOOR').toContain(
      'const breaches = reconcileFloors(population);',
    );
    expect(main, 'a floor breach no longer exits `examplesFailed`').toMatch(
      /if \(breaches\.length > 0\) \{[\s\S]*?return EXIT_CODES\.examplesFailed;[\s\S]*?\n {2}\}/,
    );
    expect(main.indexOf('PRECONDITION NOT MET')).toBeLessThan(main.indexOf('const breaches ='));
    expect(main.indexOf('if (measure) return EXIT_CODES.verified;')).toBeLessThan(
      main.indexOf('const breaches ='),
    );
  });
});

describe('exit codes — "could not run" is not "ran and found errors"', () => {
  it('names all three, and keeps them distinct', () => {
    expect(EXIT_CODES.verified).toBe(0);
    expect(EXIT_CODES.examplesFailed).toBe(1);
    expect(EXIT_CODES.couldNotRun).toBe(2);
  });
});

describe('the build filter carries the dependency closure', () => {
  it('emits sorted `--filter=<pkg>...` words', () => {
    expect(buildFilterArgs(['@object-ui/react', '@object-ui/core'])).toBe(
      '--filter=@object-ui/core... --filter=@object-ui/react...',
    );
  });

  it('emits nothing for an empty set, which the workflow refuses rather than expands', () => {
    // A bare `turbo run build` over the whole workspace is the one thing the
    // workflow's header forbids, so the empty case must be visibly empty here.
    expect(buildFilterArgs([])).toBe('');
  });
});

/**
 * The scoping notice under the printed build command — objectui#7811, porting
 * the shape objectui#7795 landed for `check-doc-snippet-types.mjs`.
 *
 * Two precondition paths tell the reader to build and print a command that
 * builds a CLOSURE rather than the tree, and neither said so. Measured on
 * `origin/main` `65ce8c576`: `--build-filter` names 10 of the workspace's 40
 * packages and turbo expands those to 30 in scope, so the reader who ran the
 * printed command is left looking at 10 packages with no `dist/` and nothing to
 * tell that apart from a build that half-failed.
 *
 * Pinned here is the half that rots unwatched — the notice must keep DERIVING
 * its numbers and must never grow a package list of its own — plus the half that
 * would make it worthless: both paths have to actually print it. That it reaches
 * a real terminal is shown on an unbuilt tree in the pull request; this suite
 * cannot get there, because those paths only open when this repository's own
 * packages are unbuilt, and CI has built them by the time it runs.
 */
describe('the printed build command says what it does NOT build (objectui#7811)', () => {
  const SCRIPT = 'scripts/check-skill-examples.mjs';
  /** A workspace package name, as the notice would spell one if it grew a list. */
  const PACKAGE_NAME = /@object-ui\//;
  const sourceOfScript = () => fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');

  /**
   * Every place the gate prints the build command, paired with the slice that
   * runs from it to the `couldNotRun` exit that site leaves through.
   *
   * Anchored on the printed COMMAND rather than on `PRECONDITION NOT MET`: the
   * empty-marked-population path prints that headline too and correctly prints
   * no build command, so a scan anchored on the headline would demand a notice
   * where there is nothing to scope.
   */
  const buildCommandSites = (source: string): string[] => {
    const marker = 'check-skill-examples.mjs --build-filter) --concurrency=2';
    const slices: string[] = [];
    for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
      const end = source.indexOf('EXIT_CODES.couldNotRun;', at);
      expect(end, 'a site that prints the build command must still leave through exit 2').toBeGreaterThan(at);
      slices.push(source.slice(at, end));
    }
    return slices;
  };

  it('interpolates the counts it is handed — without this, a fixed sentence passes every pin below', () => {
    expect(scopedBuildNotice(10, 40)).toContain('10 package(s)');
    expect(scopedBuildNotice(10, 40)).toContain('packages/ holds 40');
    // The control: different inputs, different text. A hard-coded "10 of 40" —
    // exactly the rotting summary this notice exists not to be — passes both
    // assertions above and fails these.
    const other = scopedBuildNotice(1, 2);
    expect(other).toContain('1 package(s)');
    expect(other).toContain('packages/ holds 2');
    expect(other).not.toContain('10');
    expect(other).not.toContain('40');
  });

  it('names no package of its own — the reader is sent to the filter, never to a copy of it', () => {
    const notice = scopedBuildNotice(10, 40);
    // The control, and it has to be taken from THIS tree: a matcher that catches
    // no package name anywhere would satisfy the refusal below while proving
    // nothing. The names come from the gate's own reading of the workspace,
    // which is the very set a second copy would be copied from.
    const named = [...(analyze({}) as unknown as { neededPackages: Set<string> }).neededPackages];
    expect(
      named.filter((n) => PACKAGE_NAME.test(n)),
      'nothing in this tree matches the matcher, so the refusal below is vacuous',
    ).not.toHaveLength(0);
    expect(
      notice,
      'a package name written here is a second list of what gets built, and it rots the first time the marked population moves',
    ).not.toMatch(PACKAGE_NAME);
    expect(notice).toContain('--build-filter');
    expect(notice, 'without a way to ask, the notice is one more thing the reader has to trust').toContain(
      '--dry=text',
    );
  });

  it('says the build is scoped and that what it leaves behind is the designed end state', () => {
    const notice = scopedBuildNotice(10, 40);
    expect(notice).toContain('not a whole-tree build');
    expect(notice).toContain('left exactly as it was');
    expect(notice).toContain('designed end state');
  });

  it('is printed on BOTH precondition paths that print the command, not merely defined', () => {
    const slices = buildCommandSites(sourceOfScript());
    expect(
      slices,
      'objectui#7811 named two sites — the regular path and the --self-test type-check leg',
    ).toHaveLength(2);
    for (const slice of slices) {
      expect(
        slice,
        'a notice nothing calls is a string in a file, and objectui#7811 was filed about a reader who was never told',
      ).toContain('scopedBuildNotice(');
    }
  });

  it('is handed numbers the gate read, never a literal at the call site', () => {
    for (const slice of buildCommandSites(sourceOfScript())) {
      const call = slice.slice(slice.indexOf('scopedBuildNotice('));
      expect(call).toContain('state.neededPackages.size');
      expect(call).toContain('state.packageDirOf');
      expect(
        call,
        'a number written at the call site is the rotting summary this notice exists not to be',
      ).not.toMatch(/scopedBuildNotice\(\s*\d/);
    }
  });

  it('counts the workspace from what the gate itself read, not from a number written down', () => {
    const names = withTree(
      (write) => {
        write('skills/objectui/guides/sample.md', '# Sample\n');
        write(
          'packages/pkg-a/package.json',
          JSON.stringify({ name: '@fixture/pkg-a', types: './dist/index.d.ts' }),
        );
        write(
          'packages/pkg-b/package.json',
          JSON.stringify({ name: '@fixture/pkg-b', types: './dist/index.d.ts' }),
        );
      },
      (dir) =>
        Object.keys(
          (analyze({ root: dir }) as unknown as { packageDirOf: Record<string, string> }).packageDirOf,
        ).sort(),
    );
    expect(names).toEqual(['@fixture/pkg-a', '@fixture/pkg-b']);
  });
});

describe('wiring — the gate is reachable and a markdown-only PR starts it', () => {
  const SCRIPT = 'scripts/check-skill-examples.mjs';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowPath = path.join(workflowDir, 'repo-gates.yml');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /**
   * A workflow's YAML with whole-line comments removed. Every workflow in this
   * repository discusses `paths`, `paths-ignore` and its neighbours' scripts in
   * prose; a scan that counted comments would report filters and duplicate homes
   * that no file has.
   */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:skill-examples']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(workflowPath), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf('repo-gates.yml');
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}\\s*$`, 'm'));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toMatch(/^\s*merge_group:/m);
  });

  it('runs the self-test too — a probe nobody runs is a probe that passes', () => {
    expect(yamlOf('repo-gates.yml')).toMatch(
      new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}\\s+--self-test`),
    );
  });

  it('derives its build filter from the gate rather than hand-maintaining one', () => {
    const yaml = yamlOf('repo-gates.yml');
    expect(yaml).toContain('--build-filter');
    // ⛔ The one thing the header forbids: an unfiltered workspace build.
    expect(yaml).not.toMatch(/turbo run build\s*$/m);
    expect(yaml).not.toMatch(/pnpm build/);
  });

  it('runs it in NO path-filtered workflow — the scan surface is entirely markdown', () => {
    // The whole reason this is its own workflow. `ci.yml` and `lint.yml` list
    // `'**/*.md'` under the `paths-ignore` of their `push` trigger and GitHub
    // has no per-job path filter, so a push that only edits a guide would never
    // start them. That is exactly the hole #3448 (docs links), control-bytes.yml
    // and skills-paths.yml were split out to close.
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore — a guide-only change would not start it`).not.toMatch(
        /paths-ignore:/,
      );
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    // A second copy in a path-filtered workflow is how a gate ends up looking
    // covered while the change it exists for still slips past.
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual(['repo-gates.yml']);
  });

  it('does not run a NEIGHBOUR gate from this workflow', () => {
    // `check-doc-snippet-types.test.ts` pins that its own script lives in
    // exactly one workflow. This gate imports that script's harness as a MODULE,
    // which is the intended reuse; invoking it from this YAML would break that
    // pin and give one gate two homes.
    // Since objectui#12214 every gate shares `repo-gates.yml`, so "this
    // workflow" is now this gate's OWN steps: the ones named after its check.
    const own = yamlOf('repo-gates.yml')
      .split(/^(?= {6}- name: )/m)
      .filter((step) => step.startsWith('      - name: Skill Example Check'));
    expect(own.length).toBeGreaterThan(0);
    for (const step of own) expect(step).not.toContain('scripts/check-doc-snippet-types.mjs');
  });

  it('is classified as a blocking context rather than defaulting into silence', () => {
    // `dependabot-merge-gate.test.ts` asserts its three buckets partition the
    // produced check-run set exactly, and `merge-queue-reporting.test.ts`
    // derives the `merge_group` floor from the required bucket. Asserted here
    // too, in this gate's own file, so the reason travels with the gate.
    // Since objectui#12214 the check reports as a step of the ONE `Repo Gates`
    // context, which is the name the classification and the floor read.
    const gate = fs.readFileSync(path.join(repoRoot, 'scripts/dependabot-merge-gate.mjs'), 'utf8');
    expect(gate).toContain("'Repo Gates'");
    expect(yamlOf('repo-gates.yml')).toContain('name: Skill Example Check');
  });

  it('has a section on the CI page, named by heading', () => {
    // `ci-cd-pipeline-doc.test.ts` enforces this repo-wide; restated here
    // because objectui#3212's lesson is that the omission happens at the moment
    // the workflow is added, not later.
    const doc = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    const headings = doc.split('\n').filter((line) => /^#{1,6}\s/.test(line));
    expect(headings.some((h) => h.includes('repo-gates.yml'))).toBe(true);
  });
});

describe('the harness is imported, not re-rolled', () => {
  /**
   * `check-doc-snippet-types.mjs` had its type-check harness hand-rolled three
   * separate times before it was consolidated, and its header records that one
   * of those three produced a FALSE GREEN. The harness carries the
   * syntax/semantics split and the four self-controls; a second copy here would
   * be a second answer to the same question, free to drift.
   *
   * Pinned as a source-level fact because it is invisible in behaviour: a forked
   * harness would pass every other assertion in this file.
   */
  it('imports the compiler and resolution helpers from the docs gate', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-skill-examples.mjs'), 'utf8');
    const importBlock = source.match(/import\s*\{[^}]*\}\s*from\s*'\.\/check-doc-snippet-types\.mjs';/);
    expect(importBlock, 'the shared harness import is gone — has it been forked?').not.toBeNull();
    for (const name of [
      'compileSnippets',
      'derivePackageTypePaths',
      'deriveDeclaredDependencyPaths',
      // objectui#7555: the import reader too. It was a private regex copy here,
      // and the `Unmapped specifiers` line it feeds is the REPORT of refusals
      // the harness derives from the AST — two readers, one claim.
      'moduleSpecifiersOfBlock',
    ]) {
      expect(importBlock![0]).toContain(name);
    }
  });

  it('does not JUDGE a snippet with a Program of its own', () => {
    // ⚠️ This pin was `not.toContain('ts.createProgram')` until objectui#7646,
    // and it is NARROWED here rather than deleted. What it exists to stop is a
    // FORKED SNIPPET HARNESS — a second answer to "does this fence compile",
    // free to drift from the shared one, which is how that harness produced a
    // false green when it existed three times.
    //
    // objectui#7646 needs one Program that answers a DIFFERENT question: what
    // does the published surface NAME (`derivePublishedTypeNames`). It is built
    // over the packages' entry `.d.ts` files, never over a fence body, and it
    // emits and judges nothing.
    //
    // So the pin now keys on the act that IS judging a snippet — reading
    // diagnostics — which no forked harness can avoid, and which the old
    // spelling did not actually check. The count pin keeps the exemption from
    // widening: a SECOND Program cannot arrive unnoticed.
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-skill-examples.mjs'), 'utf8');
    expect(source).not.toContain('getSemanticDiagnostics');
    expect(source).not.toContain('getSyntacticDiagnostics');
    expect(source).not.toContain('getPreEmitDiagnostics');
    expect(source.match(/ts\.createProgram/g) ?? []).toHaveLength(1);
    expect(source.match(/ts\.createCompilerHost/g) ?? []).toHaveLength(1);
    // …and the one Program is the inventory's, not a snippet's.
    expect(source).toMatch(/export function derivePublishedTypeNames[\s\S]*?ts\.createProgram/);
  });
});

/**
 * objectui#7463 item 1 — the bare-`any` assertion, ported from objectstack's
 * `packages/spec/scripts/check-skill-examples.ts`.
 *
 * The NEGATIVE half carries the weight. A bare `any` erases checking wholesale,
 * but an `any` nested in a larger type is a much broader question with a much
 * larger baseline, and a guard that flagged it would red on prose that is not
 * wrong — which is how gates get deleted. That boundary is the whole design, so
 * it is pinned rather than left to the implementation.
 */
describe('the ROOT BOUND, and its declared debt (objectui#7463 item 2)', () => {
  /**
   * The bound itself lives in the shared harness and is pinned in
   * `check-doc-snippet-types.test.ts`. What is this gate's own is the DEBT LIST:
   * a refused fence is not type-checked, and the four rows that were already
   * refused when the bound landed are carried here rather than unmarked in the
   * guides — those are a GOVERNED surface, and a gate that removes a marker to
   * make itself green is the exact move the shrink-only lists exist to prevent.
   */
  const refusal = (doc: string, fenceLine: number, specifiers: string[]) => ({
    block: { doc, fenceLine },
    specifiers,
  });

  it('builds a debt row key naming the guide, the fence line and the specifier', () => {
    expect(rootDevDepRowKey({ doc: 'skills/objectui/guides/x.md', fenceLine: 42 }, 'vitest')).toBe(
      'skills/objectui/guides/x.md:42 vitest',
    );
  });

  it('reports an UNDECLARED refusal as red', () => {
    const { undeclared, stale } = classifyRootDevDep(
      [refusal('skills/objectui/guides/x.md', 7, ['vitest'])],
      new Set<string>(),
    ) as { undeclared: { key: string }[]; stale: string[] };
    expect(undeclared.map((r) => r.key)).toEqual(['skills/objectui/guides/x.md:7 vitest']);
    expect(stale).toEqual([]);
  });

  it('does not report a DECLARED refusal as red', () => {
    const { rows, undeclared } = classifyRootDevDep(
      [refusal('skills/objectui/guides/x.md', 7, ['vitest'])],
      new Set(['skills/objectui/guides/x.md:7 vitest']),
    ) as { rows: { declared: boolean }[]; undeclared: unknown[] };
    expect(undeclared).toEqual([]);
    expect(rows.map((r) => r.declared)).toEqual([true]);
  });

  it('splits one fence importing two refused specifiers into two rows', () => {
    const { rows } = classifyRootDevDep(
      [refusal('skills/objectui/guides/x.md', 7, ['@playwright/test', 'vitest'])],
      new Set<string>(),
    ) as { rows: { key: string }[] };
    expect(rows.map((r) => r.key)).toEqual([
      'skills/objectui/guides/x.md:7 @playwright/test',
      'skills/objectui/guides/x.md:7 vitest',
    ]);
  });

  it('reports a declared row that is no longer refused as STALE — the list only shrinks', () => {
    const { stale } = classifyRootDevDep([], new Set(['skills/objectui/guides/x.md:7 vitest'])) as {
      stale: string[];
    };
    expect(stale).toEqual(['skills/objectui/guides/x.md:7 vitest']);
  });

  it('declares its debt list as a shrink-only Set of verbatim rows', () => {
    expect(KNOWN_ROOT_DEVDEP_EXAMPLES).toBeInstanceOf(Set);
    for (const row of KNOWN_ROOT_DEVDEP_EXAMPLES as Set<string>) {
      expect(row, `debt row is not \`GUIDE:LINE SPECIFIER\`: ${row}`).toMatch(
        /^[\w./-]+\.md:\d+ (@[\w.-]+\/)?[\w.-]+$/,
      );
      expect(SCAN_ROOTS.some((r: string) => row.startsWith(`${r}/`))).toBe(true);
    }
  });

  it('names only specifiers this repository ROOT actually declares', () => {
    // A row for something the root does not declare could never be refused, so
    // it would sit in the list forever covering nothing.
    const declared = rootDeclaredSpecifiers(repoRoot) as Set<string>;
    for (const row of KNOWN_ROOT_DEVDEP_EXAMPLES as Set<string>) {
      const specifier = row.slice(row.lastIndexOf(' ') + 1);
      expect(declared.has(specifier), `${specifier} is not declared by the root manifest`).toBe(true);
    }
  });

  it('names only fences that exist and carry the marker', () => {
    // Keyed on the fence LINE, so a guide edit above the fence forces a
    // re-declaration; this pin is what turns that into a test failure rather
    // than a row that silently stops covering anything.
    for (const row of KNOWN_ROOT_DEVDEP_EXAMPLES as Set<string>) {
      const [site] = row.split(' ');
      const lastColon = site.lastIndexOf(':');
      const guide = site.slice(0, lastColon);
      const line = Number(site.slice(lastColon + 1));
      const source = fs.readFileSync(path.join(repoRoot, guide), 'utf8');
      const { fences: all } = scanSkillFences(source) as {
        fences: { fenceLine: number; marked: boolean }[];
      };
      const fences = all.filter((f) => f.fenceLine === line);
      expect(fences.length, `no fence at ${site}`).toBe(1);
      expect(fences[0].marked, `the fence at ${site} carries no marker`).toBe(true);
    }
  });
});

/**
 * objectui#7555 — the `Unmapped specifiers` line reads imports the same way the
 * refusals it reports do.
 *
 * Since objectui#7463 item 2 that line is the REPORT of what the shared
 * harness's ROOT BOUND refuses. The bound has always walked the AST; the line
 * came from a private regex over the block text, so the two were two answers to
 * one question and were free to name different sets over the same fences. The
 * regex's error is one-directional and measured (`plugin-markdown.mdx:195` in
 * the DOCS corpus: `npm install project-name` inside a template literal read as
 * an import), so the line could name a specifier no fence imports — an
 * invented refusal, printed on every run, in the one line a reader consults to
 * learn what a green did NOT cover.
 */
describe('the `Unmapped specifiers` line and the refusals it reports (objectui#7555)', () => {
  type State = { unmappedSpecifiers: Set<string>; neededPackages: Set<string> };

  // ⚠️ `withTree` deletes the tree when its callback returns, so each case
  // builds and reads inside one call.
  const stateFor = (body: string): State =>
    withTree(
      (write) => {
        write(
          'skills/objectui/guides/sample.md',
          ['# Sample', '', MARKER, '```ts', body, '```', ''].join('\n'),
        );
        // The workspace scan reads `packages/` directly; an absent directory is
        // a throw, not an empty map.
        write('packages/.keep', '');
      },
      (dir) => analyze({ root: dir }) as unknown as State,
    );

  it('names a specifier a marked fence really imports — the control for the pin below', () => {
    // Without this half, the pin below would pass just as well over a tree
    // whose guide was never scanned at all.
    const state = stateFor("import { test } from 'some-runner';\nexport const t = test;");
    expect([...state.unmappedSpecifiers]).toEqual(['some-runner']);
  });

  it('does NOT name one that appears only inside a template literal', () => {
    const state = stateFor(
      "export const readme = `\n# Project\n\nimport { test } from 'some-runner';\n`;",
    );
    expect([...state.unmappedSpecifiers]).toEqual([]);
    expect([...state.neededPackages]).toEqual([]);
  });

  it('agrees with the bound over the real corpus, specifier for specifier', () => {
    // The build-free half of the claim the gate's own run prints: the line and
    // the refusals are now one reader, so over the SELECTED population the two
    // sets are equal. They can only diverge on a specifier that is unmapped and
    // NOT root-declared — which the bound leaves in the program, where it fails
    // to resolve and reds the semantic phase. So a divergence is never silent,
    // and a red here is a real finding rather than upkeep.
    //
    // ⛔ Scoped to the SELECTED population on purpose; it does NOT widen to
    // `--measure`. Measured while writing this: under `measure: true` all 121
    // candidate fences are selected and the two sets legitimately differ, 12
    // names on the line against 6 refused — the extra six (`@objectstack/*`,
    // `@tailwindcss/vite`, `@vitejs/plugin-react`) are unmapped and NOT
    // root-declared, so they belong on the line and are correctly left in the
    // program to fail there. Widening this pin would red on the design.
    const state = analyze({}) as unknown as {
      unmappedSpecifiers: Set<string>;
      tsBlocks: { body: string }[];
      paths: Record<string, string[]>;
    };
    const rootDeclared = rootDeclaredSpecifiers(repoRoot) as Set<string>;
    const read = new Set<string>();
    const refused = new Set<string>();
    for (const block of state.tsBlocks) {
      for (const specifier of moduleSpecifiersOfBlock(block.body) as string[]) {
        read.add(specifier);
        if (resolvesOnlyThroughRootManifest(specifier, { paths: state.paths, rootDeclared })) {
          refused.add(specifierRoot(specifier) as string);
        }
      }
    }
    expect([...state.unmappedSpecifiers].sort()).toEqual([...refused].sort());
    // And the reader really did run over this corpus — an equality between two
    // sets nothing ever put anything into would pass while proving nothing.
    //
    // ⛔ NOT `refused.size > 0`. That asserts the corpus still MARKS a fence
    // importing a root-only specifier, which is a fact about the markers, and
    // the markers belong to whoever is editing the guides: unmarking the four
    // fences in `skills/objectui/guides/testing.md` empties `refused`, leaves
    // the equality true, and would red this pin over a change that is not about
    // it (measured against objectui#7557's head while writing this). What this
    // pin owns is that the two READERS agree, so its non-vacuity clause has to
    // be about the reader.
    expect(read.size).toBeGreaterThan(0);
  });
});

describe('the bare-`any` assertion', () => {
  it.each([
    ['a parameter', 'export function f(ctx: any) { return ctx; }', 'parameter `ctx`'],
    ['a variable', 'export const x: any = 1;', 'variable `x`'],
    ['an interface property', 'export interface I { p: any }', 'property `p`'],
    ['a class property', 'export class C { p: any = 1; }', 'property `p`'],
    ['a type alias', 'export type A = any;', 'type alias `A`'],
    ['a return type', 'export function g(): any { return 1; }', 'return type'],
    ['an arrow return type', 'export const h = (): any => 1;', 'return type'],
    ['a method signature return', 'export interface J { m(): any }', 'return type'],
    ['an `as any` cast', 'export const y = ({} as any);', '`as any` assertion'],
    ['a `satisfies any`', 'export const z = ({} satisfies any);', '`satisfies any` assertion'],
  ])('flags %s', (_label, code, want) => {
    const hits = findBareAny(code) as { where: string }[];
    expect(hits.map((h) => h.where)).toEqual([want]);
  });

  it.each([
    ['Record<string, any>', 'export const a: Record<string, any> = {};'],
    ['any[]', 'export const b: any[] = [];'],
    ['Array<any>', 'export const c: Array<any> = [];'],
    ['Promise<any>', 'export async function d(): Promise<any> { return 1; }'],
    ['a union arm', 'export const e: string | any[] = [];'],
    ['the word "any" in a string or a comment', 'export const f = "any"; // any of them'],
  ])('does NOT flag a nested `any` in %s', (_label, code) => {
    expect(findBareAny(code)).toEqual([]);
  });

  // ── The two shapes whose LABEL was the defect (objectui#7653, ported from
  //    objectstack#14910). BOTH were already flagged before the fix, so a pin
  //    asserting only "it is a finding" passes on the broken code and proves
  //    nothing. Both legs therefore assert the LABEL STRING, because the label
  //    is the bug — and it is half a finding's baseline row key, so a wrong one
  //    is a finding that cannot be declared the day such a site is marked.
  it('labels an `any` index signature `index signature`, not `return type`', () => {
    // `ts.isFunctionLike` is true for every SignatureDeclaration kind and an
    // IndexSignatureDeclaration IS one, so before the fix this read
    // `return type` — a position the `any` does not occupy. Flagging is right
    // either way (an `any` index signature erases checking on every keyed
    // access), so the fix is a LABEL and the arm sits BEFORE the function-like
    // fallback. This pin fails on the broken code because it asserts the label.
    const hits = findBareAny('interface Bag {\n  [key: string]: any;\n}\n') as { where: string }[];
    expect(hits.map((h) => h.where)).toEqual(['index signature']);
  });

  it('keeps a return `any` on a function type inside a type argument as `return type`', () => {
    // The boundary is the DIRECT parent (`parent.type === node`), never
    // ancestry: in `Array<() => any>` the `any`'s parent is the FunctionTypeNode
    // whose return slot it fills, not the TypeReference above it. The three
    // shapes the header calls "nested" all have that predicate FALSE; this one
    // has it TRUE, so it is a finding and stays one.
    //
    // ⛔ This pin is the header's rule made executable, and its value is that it
    // can FAIL: the day someone reads "nested `any` is deliberately not flagged"
    // as ancestry and narrows the function-like arm, this goes red instead of
    // quietly handing authors the one-token evasion the rule already refuses for
    // parameters — wrap the offending function type in a type argument and the
    // gate would go green over an unchanged defect.
    const hits = findBareAny('const fns: Array<() => any> = [];\nvoid fns;\n') as { where: string }[];
    expect(hits.map((h) => h.where)).toEqual(['return type']);
  });

  it('parses as TSX, so a JSX example is not mis-read as a type assertion', () => {
    // `compileSnippets` parses every block as TSX regardless of the fence
    // label. A guard walking a different tree would be reporting about a
    // program `tsc` never judged.
    expect(findBareAny('export const El = () => <div className="x">hi</div>;')).toEqual([]);
  });

  it('yields nothing rather than throwing on a block too broken to parse', () => {
    // The `tsc` syntax leg owns that verdict; this guard must not double-report
    // it, and must not crash the run either.
    expect(() => findBareAny('export const three: = ;')).not.toThrow();
  });

  it('builds a baseline row key naming the guide, the fence line and the position', () => {
    const block = { doc: 'skills/objectui/guides/x.md', fenceLine: 42 };
    const finding = (findBareAny('export function f(ctx: any) {}') as { where: string }[])[0];
    expect(bareAnyRowKey(block, finding)).toBe('skills/objectui/guides/x.md:42 parameter `ctx`');
  });

  it('declares its baseline as a shrink-only Set of verbatim rows', () => {
    // Every row must be shaped like a key this gate can actually produce, or it
    // would sit in the list forever covering nothing — a parked exemption
    // wearing a ratchet's clothes.
    expect(KNOWN_BARE_ANY_EXAMPLES).toBeInstanceOf(Set);
    for (const row of KNOWN_BARE_ANY_EXAMPLES as Set<string>) {
      expect(row, `baseline row is not \`GUIDE:LINE POSITION\`: ${row}`).toMatch(
        /^[\w./-]+\.md:\d+ .+$/,
      );
      expect(SCAN_ROOTS.some((r: string) => row.startsWith(`${r}/`))).toBe(true);
    }
  });
});

describe('the shadowed-published-type assertion (objectui#7646)', () => {
  type Declaration = { name: string; line: number; kind: string };
  type Local = { declarations: Declaration[]; imported: Set<string> };
  type Candidate = { block: { doc: string; fenceLine: number }; name: string; line: number };
  type Row = Candidate & { key: string; declared: boolean; reason: string | null };
  type Split = { rows: Row[]; stale: string[]; undeclared: Row[] };

  const block = (doc: string, fenceLine: number, body: string, marked = true) => ({
    doc,
    fenceLine,
    body,
    marked,
    kind: 'ts',
    language: 'typescript',
    selected: marked,
  });

  describe('what a fence DECLARES, read off the block', () => {
    it('finds a local type alias and a local interface, with the line inside the block', () => {
      const found = findLocalTypeDeclarations(
        ['type A = { a: string };', '', 'interface B { b: number }'].join('\n'),
      ) as Local;
      expect(found.declarations).toEqual([
        { name: 'A', line: 1, kind: 'type' },
        { name: 'B', line: 3, kind: 'interface' },
      ]);
    });

    it('parses as TSX, matching the harness — a JSX example is not misread', () => {
      // `compileSnippets` parses every block as TSX regardless of the fence
      // label. A guard walking a different tree from the one `tsc` judged would
      // be reporting about a program that was never checked.
      const found = findLocalTypeDeclarations(
        'const El = () => <div className="x">hi</div>;\ntype P = { x: string };',
      ) as Local;
      expect(found.declarations.map((d) => d.name)).toEqual(['P']);
    });

    it('yields nothing rather than throwing on a block too broken to parse', () => {
      expect(() => findLocalTypeDeclarations('type = ;')).not.toThrow();
    });

    it('records the names a named, a default and a namespace import bind', () => {
      const found = findLocalTypeDeclarations(
        [
          "import type { AuthUser } from '@object-ui/auth';",
          "import React from 'react';",
          "import * as types from '@object-ui/types';",
        ].join('\n'),
      ) as Local;
      expect([...found.imported].sort()).toEqual(['AuthUser', 'React', 'types']);
    });

    it('records BOTH halves of an aliased import, which is what makes the good pattern legal', () => {
      // `import type { QueryResult as Published }` then a short local
      // `QueryResult` derived from it is ANCHORED to the published type and is
      // exactly what this assertion wants to encourage. Keying only on the
      // local binding would red on it.
      const found = findLocalTypeDeclarations(
        "import type { QueryResult as PublishedQueryResult } from '@object-ui/types';",
      ) as Local;
      expect([...found.imported].sort()).toEqual(['PublishedQueryResult', 'QueryResult']);
    });
  });

  describe('which declarations become candidates', () => {
    it('a fence that declares a name it does not import is a candidate', () => {
      const found = shadowCandidates([block('skills/g.md', 10, 'type QueryResult = { rows: unknown[] };')]) as Candidate[];
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('QueryResult');
    });

    it('a fence that IMPORTS the name is not a candidate — that is the remedy, not the defect', () => {
      const found = shadowCandidates([
        block(
          'skills/g.md',
          10,
          ["import type { QueryResult } from '@object-ui/types';", 'interface QueryResult { data: unknown }'].join(
            '\n',
          ),
        ),
      ]);
      expect(found).toEqual([]);
    });

    it('the aliased-derive pattern is not a candidate either', () => {
      const found = shadowCandidates([
        block(
          'skills/g.md',
          10,
          [
            "import type { QueryResult as PublishedQueryResult } from '@object-ui/types';",
            'type QueryResult = Pick<PublishedQueryResult, "data">;',
          ].join('\n'),
        ),
      ]);
      expect(found).toEqual([]);
    });

    it('runs on an UNBUILT tree, because it is purely syntactic', () => {
      // The suite's whole boundary: `ci.yml`'s test shards do not build the
      // workspace, so the half that needs `dist/*.d.ts` lives in `--self-test`
      // and this half must not.
      const state = withTree(
        (write) => {
          // The workspace scan reads `packages/` directly; an absent directory
          // is not the thing under test here.
          write('packages/.keep', '');
          write(
            'skills/g.md',
            [MARKER, '```typescript', 'type BaseSchema = { type: string };', '```', ''].join('\n'),
          );
        },
        (dir) => analyze({ root: dir }),
      ) as { localTypes: Candidate[]; markedLocalTypes: Candidate[] };
      expect(state.localTypes.map((c) => c.name)).toEqual(['BaseSchema']);
      expect(state.markedLocalTypes.map((c) => c.name)).toEqual(['BaseSchema']);
    });

    it('collects the MARKED half separately from the selected half', () => {
      // A ledger row is a claim about a GATED fence, so the stale side is read
      // off the marked population whatever mode the run is in. Under
      // `--measure` an unmarked fence is selected but must not appear to cover
      // a row.
      const state = withTree(
        (write) => {
          write('packages/.keep', '');
          write(
            'skills/g.md',
            [
              MARKER,
              '```typescript',
              'type AuthUser = { id: string };',
              '```',
              '',
              '```typescript',
              'type QueryResult = { data: unknown };',
              '```',
              '',
            ].join('\n'),
          );
        },
        (dir) => analyze({ root: dir, measure: true }),
      ) as { localTypes: Candidate[]; markedLocalTypes: Candidate[] };
      expect(state.localTypes.map((c) => c.name).sort()).toEqual(['AuthUser', 'QueryResult']);
      expect(state.markedLocalTypes.map((c) => c.name)).toEqual(['AuthUser']);
    });
  });

  describe('the shrink-only ledger reds in all four directions', () => {
    const fence = { doc: 'skills/objectui/guides/auth-permissions.md', fenceLine: 59 };
    const hit = { block: fence, name: 'AuthUser', line: 2, kind: 'type', specifiers: ['@object-ui/auth'] };
    const declared = new Map([['skills/objectui/guides/auth-permissions.md:59 AuthUser', 'a reason']]);

    it('1 — an offender with NO row is RED, and the row names the guide, the line and the name', () => {
      const split = classifyShadowedTypes([hit], [hit], new Map()) as Split;
      expect(split.undeclared).toHaveLength(1);
      expect(split.undeclared[0].key).toBe('skills/objectui/guides/auth-permissions.md:59 AuthUser');
      expect(split.stale).toEqual([]);
    });

    it('a declared offender is debt, not red — and it carries its reason', () => {
      const split = classifyShadowedTypes([hit], [hit], declared) as Split;
      expect(split.undeclared).toEqual([]);
      expect(split.stale).toEqual([]);
      expect(split.rows[0].reason).toBe('a reason');
    });

    it('2 — a row whose fence now IMPORTS the name is STALE', () => {
      // The fence is still there and still marked; it just no longer shadows,
      // so there is no live hit for the row to describe.
      const split = classifyShadowedTypes([], [], declared) as Split;
      expect(split.stale).toEqual(['skills/objectui/guides/auth-permissions.md:59 AuthUser']);
    });

    it('3 — a row naming a fence that is GONE is STALE', () => {
      const elsewhere = { ...hit, block: { doc: 'skills/objectui/guides/other.md', fenceLine: 4 } };
      const split = classifyShadowedTypes([elsewhere], [elsewhere], declared) as Split;
      expect(split.stale).toEqual(['skills/objectui/guides/auth-permissions.md:59 AuthUser']);
      expect(split.undeclared.map((r) => r.key)).toEqual(['skills/objectui/guides/other.md:4 AuthUser']);
    });

    it('4 — a row whose SHADOWED NAME changed reds TWICE, and says both halves', () => {
      // No extra machinery: the name is IN the key, so the old row goes stale
      // and the new name arrives undeclared in the same run.
      const renamed = { ...hit, name: 'AuthSession' };
      const split = classifyShadowedTypes([renamed], [renamed], declared) as Split;
      expect(split.stale).toEqual(['skills/objectui/guides/auth-permissions.md:59 AuthUser']);
      expect(split.undeclared.map((r) => r.key)).toEqual([
        'skills/objectui/guides/auth-permissions.md:59 AuthSession',
      ]);
    });

    it('an UNMARKED fence never covers a row — measured is not gated', () => {
      // `hits` may carry an unmarked fence under `--measure`; `markedHits` may
      // not. A row covered by a merely-measured fence would be an exemption
      // that no run enforces.
      const split = classifyShadowedTypes([hit], [], declared) as Split;
      expect(split.undeclared).toEqual([]);
      expect(split.stale).toEqual(['skills/objectui/guides/auth-permissions.md:59 AuthUser']);
    });

    it('builds a row key naming the guide, the fence line and the shadowed name', () => {
      expect(shadowedTypeRowKey({ doc: 'skills/objectui/guides/x.md', fenceLine: 42 }, 'AuthUser')).toBe(
        'skills/objectui/guides/x.md:42 AuthUser',
      );
    });
  });

  describe('the committed ledger', () => {
    it('is a shrink-only Map of verbatim rows, each carrying a reason', () => {
      // Every row must be shaped like a key this gate can actually produce, or
      // it would sit in the list forever covering nothing — a parked exemption
      // wearing a ratchet's clothes.
      expect(KNOWN_SHADOWED_PUBLISHED_TYPES).toBeInstanceOf(Map);
      for (const [row, reason] of KNOWN_SHADOWED_PUBLISHED_TYPES as Map<string, string>) {
        expect(row, `ledger row is not \`GUIDE:LINE NAME\`: ${row}`).toMatch(
          /^[\w./-]+\.md:\d+ [A-Za-z_$][\w$]*$/,
        );
        expect(SCAN_ROOTS.some((r: string) => row.startsWith(`${r}/`))).toBe(true);
        // A row with no reason is an allowlist entry wearing a ledger's
        // clothes: the reason is what makes the per-fence judgement it is
        // waiting on visible work rather than a silent exemption.
        expect(reason.length, `ledger row carries no reason: ${row}`).toBeGreaterThan(20);
      }
    });

    it('names the card that owns the repair, because the fences are a GOVERNED surface', () => {
      // `skills/**` and `.claude/skills/**` are agent-drafts / human-merges, so
      // the pull request that landed this assertion could not edit a fence. A
      // row with no owner would be debt nobody is carrying.
      for (const reason of (KNOWN_SHADOWED_PUBLISHED_TYPES as Map<string, string>).values()) {
        expect(reason).toMatch(/objectui#\d+/);
      }
    });

    it('every row sits on a fence that still exists and still carries the marker', () => {
      // The cheap half of direction 3, pinned here rather than only in the gate
      // run: a row pointing at a line no marked fence opens is stale on its
      // face, and this test says so on an unbuilt tree.
      const guides = new Map(
        (listGuides(repoRoot) as string[]).map((g) => [
          g,
          scanSkillFences(fs.readFileSync(path.join(repoRoot, g), 'utf8')) as Scan,
        ]),
      );
      for (const row of (KNOWN_SHADOWED_PUBLISHED_TYPES as Map<string, string>).keys()) {
        const [site] = row.split(' ');
        const doc = site.slice(0, site.lastIndexOf(':'));
        const line = Number(site.slice(site.lastIndexOf(':') + 1));
        const scan = guides.get(doc);
        expect(scan, `ledger row names a guide that is not in the scan set: ${row}`).toBeTruthy();
        const fence = scan?.fences.find((f) => f.fenceLine === line);
        expect(fence, `ledger row names no fence at that line: ${row}`).toBeTruthy();
        expect(fence?.marked, `ledger row names an UNMARKED fence: ${row}`).toBe(true);
        expect(fence?.kind).toBe('ts');
      }
    });

    it('every row names a type the fence really declares and does not import', () => {
      // The other cheap half, and the one that catches a row kept alive after
      // its fence was repaired: the row must correspond to a live candidate.
      const state = analyze({ root: repoRoot }) as { markedLocalTypes: Candidate[] };
      const keys = new Set(state.markedLocalTypes.map((c) => shadowedTypeRowKey(c.block, c.name)));
      for (const row of (KNOWN_SHADOWED_PUBLISHED_TYPES as Map<string, string>).keys()) {
        expect(keys.has(row), `ledger row describes no live re-declaration: ${row}`).toBe(true);
      }
    });
  });
});
