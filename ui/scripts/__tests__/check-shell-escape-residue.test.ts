import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — see
// objectui#3494.
import {
  COVERAGE_TREES,
  FENCE_FLOOR,
  RESIDUE_PATTERNS,
  SCAN_ROOTS,
  findResidue,
  listDocuments,
  resolveRoot,
  scan,
  summarise,
} from '../check-shell-escape-residue.mjs';
import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';

/**
 * objectui#5151 — the test for `scripts/check-shell-escape-residue.mjs`.
 *
 * ## Why this file carries the weight
 *
 * The gate is GREEN AT REST. objectui#5150's fix (PR #5152) removed the only
 * occurrence that has ever existed, and the measured population across all four
 * scan roots is ZERO. So a green run of the gate over this repository proves
 * only that this repository is clean; it cannot distinguish a working gate from
 * one that matches nothing at all — which is objectui#5151's own defect, one
 * level up. ⭐ THE ABLATION BELOW IS THE ONLY EVIDENCE THE GATE EXISTS.
 *
 * It is not synthetic. `HISTORICAL_LINE` reconstructs the exact line objectui#5150
 * shipped, in its exact geometry: two-space indented (it sat inside a numbered
 * list) inside a ```bash fence, carrying the escape run twice — once around the
 * heredoc introducer's terminator and once around its repeat.
 *
 * ## ⛔ The limitation is asserted as a FACT, never as a sentence
 *
 * The gate's header says executability is unguarded. A `toContain` pin over that
 * sentence would assert that the CLAIM EXISTS, not that it is TRUE — the failure
 * this lane spent a round on in objectui#6186, where a pin read as coverage while
 * the claim underneath it rotted. So the boundary cases below FEED THE GATE
 * broken shell and require a PASS. If someone ever widens this gate into a real
 * syntax check, those cases go red and have to be rewritten deliberately, which
 * is the correct amount of friction for changing what a gate promises.
 *
 * ## Fixture discipline
 *
 * `scripts/` is not in `SCAN_ROOTS`, so this file could carry the literal
 * plainly. It builds it from code points anyway — belt and braces against a
 * future widening of the scan surface turning this suite into the gate's own
 * first finding — and then PINS the constructed value against the shipped
 * `RESIDUE_PATTERNS` entry, so a typo in the source literal reddens here.
 *
 * ## The second skills root (objectui#7403)
 *
 * `SCAN_ROOTS` carries TWO skills trees: the published `skills/` and the
 * contributor tree `.claude/skills/`, which objectui#7251 moved two guides into
 * while nothing reached the new location. The fixtures below therefore declare
 * both, and three cases exist only for the second one: the declared roots, a
 * residue planted under `.claude/skills`, and — the case the miss itself asks
 * for — a root that walks to ZERO documents while every other root is healthy,
 * which must be NAMED AND RED rather than absorbed by a healthy total.
 *
 * ## Coverage, which is a different question from residue (objectui#7413)
 *
 * `SCAN_ROOTS` answers "what is scanned"; `COVERAGE_TREES` answers "is anything
 * in the agent tree NOT scanned". The second question has no floor that can
 * express it — a `minFiles` row detects a root that collapsed, never a document
 * that was never on the surface — so the coverage block below carries its own
 * ablation: the card's literal scenario, a planted `.claude/agents/reviewer.md`,
 * which must be RED AND NAMED while every other signal in the same run reads
 * healthy. That "everything else looks fine" assertion is the load-bearing half;
 * without it the case would pass for a gate that reddened on anything.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SQ = String.fromCharCode(39); // '
const DQ = String.fromCharCode(34); // "

/** The residue, rebuilt from code points. */
const RESIDUE = SQ + DQ + SQ + DQ + SQ;

/**
 * objectui#5150's shipped line, byte-for-byte, indent included. The indent is
 * not decoration: the block sat inside a numbered list, and a heredoc terminator
 * has to reach column 0 — which is the separate defect the triage note recorded
 * against direction 1 and which this gate deliberately does not judge.
 */
const HISTORICAL_LINE = `  git commit -F - <<${RESIDUE}EOF${RESIDUE}`;

/** A fenced block, as document source. */
const fence = (language: string, ...body: string[]) => ['```' + language, ...body, '```'].join('\n');

/** Build a throwaway document tree and hand back its root. */
function fixtureTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-shell-residue-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

/** The fixture roots: same shape as `SCAN_ROOTS`, floors a fixture can meet. */
const FIXTURE_ROOTS = [
  { spec: 'AGENTS.md', kind: 'file', minFiles: 1 },
  { spec: 'CLAUDE.md', kind: 'file', minFiles: 1 },
  { spec: 'skills', kind: 'dir', minFiles: 1 },
  { spec: '.claude/skills', kind: 'dir', minFiles: 1 },
  { spec: 'content/docs', kind: 'dir', minFiles: 1 },
];

/** The fixture coverage trees, mirroring `COVERAGE_TREES` (objectui#7413). */
const FIXTURE_COVERAGE_TREES = [
  { spec: '.claude', kind: 'dir' },
  { spec: 'skills', kind: 'dir' },
];

const scanFixture = (root: string, roots = FIXTURE_ROOTS, extra: Record<string, unknown> = {}) =>
  scan(root, { roots, fenceFloor: 0, coverageTrees: FIXTURE_COVERAGE_TREES, ...extra });

/** One `SCAN_ROOTS` entry, as declared. */
type DeclaredRoot = { spec: string; kind: string; minFiles: number };
/** One `COVERAGE_TREES` entry, as declared. */
type DeclaredTree = { spec: string; kind: string };
/** One `census.coverage` row, as `scan` returns it. */
type CoverageRow = { spec: string; documents: number; uncovered: number; resolved: boolean };
/** One coverage finding: a document under a coverage tree that no root reached. */
type Uncovered = { file: string; tree: string };
/** One `census.perRoot` row, as `scan` returns it. */
type RootRow = { spec: string; files: number; fences: number; minFiles: number; resolved: boolean };
/** A finding as `findResidue` returns it — no file, because it scans one source. */
type Hit = { line: number; column: number; language: string; fenceLine: number; patternId: string };
/** The same finding as `scan` returns it, carrying the document it came from. */
type ScanHit = Hit & { file: string; root: string };

// ---------------------------------------------------------------------------
// The literal itself
// ---------------------------------------------------------------------------

describe('the enumeration', () => {
  it('ships exactly the literal objectui#5150 leaked, rebuilt from code points', () => {
    // Pins the source constant against an independent construction: a typo in
    // `RESIDUE_PATTERNS` — a gate matching a sequence that never occurs — is
    // otherwise invisible, because both a working gate and a broken one are
    // green on this tree.
    expect(RESIDUE_PATTERNS.map((p: { literal: string }) => p.literal)).toEqual([RESIDUE]);
  });

  it('has ONE entry — a second needs an observed instance, not an argument', () => {
    // The whole value of this direction over `bash -n` is a zero false-positive
    // rate. The first speculative literal spends it, so the count is pinned and
    // widening it is a deliberate edit to this line.
    expect(RESIDUE_PATTERNS).toHaveLength(1);
  });

  it('reconstructs the historical line with the run appearing twice', () => {
    expect(HISTORICAL_LINE.split(RESIDUE).length - 1).toBe(2);
    expect(HISTORICAL_LINE.startsWith('  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findResidue — the unit
// ---------------------------------------------------------------------------

describe('findResidue — what is judged', () => {
  it('flags every occurrence inside a fenced block, with line and column', () => {
    const source = ['# Doc', '', fence('bash', HISTORICAL_LINE, '  EOF'), ''].join('\n');
    const { hits } = findResidue(source);

    expect(hits.map((h: Hit) => [h.line, h.column])).toEqual([
      [4, 21],
      [4, 29],
    ]);
    expect(hits.every((h: Hit) => h.language === 'bash')).toBe(true);
    expect(hits.every((h: Hit) => h.fenceLine === 3)).toBe(true);
  });

  it('judges a fence whatever its info string says — no language vocabulary to rot', () => {
    // Deliberately NOT an allow-list of shell fence spellings. `sh`, `shell`,
    // `console`, or no info string at all are all how this could be written, and
    // an enumeration is the thing that rots (objectui#6135's standing lesson).
    for (const language of ['bash', 'sh', 'shell', 'console', '']) {
      const { hits } = findResidue(fence(language, HISTORICAL_LINE));
      expect(hits, `a ${language || '(bare)'} fence must be judged`).toHaveLength(2);
    }
  });

  it('COUNTS an occurrence outside a fence and does not judge it', () => {
    // The one deliberate narrowing. Prose about this defect class has to be able
    // to NAME the literal — objectui#5151's own body does — and no mechanical
    // rule separates quoting it from shipping it in running text. The census
    // figure is what keeps the exclusion visible rather than silent.
    const { hits, outsideFences } = findResidue(`The leaked run is \`${RESIDUE}\`, five printable bytes.`);
    expect(hits).toEqual([]);
    expect(outsideFences).toBe(1);
  });

  it('splits a document carrying both, so neither figure absorbs the other', () => {
    const source = [`prose ${RESIDUE} prose`, '', fence('bash', HISTORICAL_LINE)].join('\n');
    const { hits, outsideFences } = findResidue(source);
    expect(hits).toHaveLength(2);
    expect(outsideFences).toBe(1);
  });

  it('counts the fences it examined, including clean ones', () => {
    const source = [fence('ts', 'const a = 1;'), '', fence('bash', 'echo hi')].join('\n');
    const { fences, hits } = findResidue(source);
    expect(fences).toBe(2);
    expect(hits).toEqual([]);
  });

  it('is green on a document with no fences at all', () => {
    expect(findResidue('# Just prose\n\nNothing fenced here.\n')).toEqual({ fences: 0, hits: [], outsideFences: 0 });
  });
});

// ---------------------------------------------------------------------------
// ⛔ The boundary, asserted as a fact — see the header
// ---------------------------------------------------------------------------

describe('⛔ what this gate does NOT do — asserted by behaviour, not by prose', () => {
  it('PASSES a ```bash fence that cannot execute — executability is unguarded', () => {
    // Every line here is broken shell. The gate is green on all of it, because
    // it checks an enumerated literal and nothing else. Nothing in this
    // repository checks that a fenced shell example runs; objectui#5151's
    // "direction 1" (`bash -n` per block) is the unbuilt option.
    const broken = fence(
      'bash',
      'if [ -f x ]',                 // no `then`, no `fi`
      'for i in',                    // truncated
      'echo "unterminated',          // unbalanced quote
      'cat <<MISSING_TERMINATOR',    // heredoc that never closes
    );
    expect(findResidue(broken).hits).toEqual([]);
  });

  it('PASSES the indented-terminator hang the triage note recorded', () => {
    // The scenario the triage note attached to direction 1: inside a numbered
    // list both lines carry the container indent, and a quoted heredoc
    // terminator must reach COLUMN 0. Rendered markdown hides it; agents read
    // these files by `cat`. This gate does not judge it — stated in its header
    // and pinned here, so the claim cannot rot into a false one.
    const indented = fence('bash', `  git commit -F - <<${SQ}EOF${SQ}`, '  message', '  EOF');
    expect(indented).not.toContain(RESIDUE);
    expect(findResidue(indented).hits).toEqual([]);
  });

  it("PASSES the equivalent '\\'' spelling — the documented remedy is not matched", () => {
    const alternative = fence('bash', `git commit -F - <<${SQ}\\${SQ}${SQ}EOF`);
    expect(findResidue(alternative).hits).toEqual([]);
  });

  it('JUDGES nothing outside SCAN_ROOTS — but says so, for the agent tree', () => {
    const root = fixtureTree({
      'AGENTS.md': fence('bash', 'echo ok'),
      'CLAUDE.md': fence('bash', 'echo ok'),
      'skills/s/SKILL.md': fence('bash', 'echo ok'),
      '.claude/skills/s/SKILL.md': fence('bash', 'echo ok'),
      'content/docs/a.md': fence('bash', 'echo ok'),
      // Residue under neither. `.claude/` is on the SCAN surface only BELOW
      // `skills/`, so neither line is judged and `hits` stays empty for both.
      '.claude/hooks/notes.md': fence('bash', HISTORICAL_LINE),
      'packages/thing/README.md': fence('bash', HISTORICAL_LINE),
    });
    const result = scanFixture(root);
    expect(result.hits, 'residue outside every scan root is not judged').toEqual([]);

    // objectui#7413 — and the two files are not equivalent, which is the whole
    // point of a coverage tree. `.claude/hooks/notes.md` is agent-tree markdown
    // that no row reaches, so it is REPORTED; `packages/thing/README.md` is
    // outside every coverage tree and stays out of this gate's business
    // entirely. Before this, both were silent.
    expect(result.uncovered).toEqual([{ file: '.claude/hooks/notes.md', tree: '.claude' }]);
  });
});

// ---------------------------------------------------------------------------
// ⭐ The ablation — the gate's only evidence, because it is green at rest
// ---------------------------------------------------------------------------

describe('⭐ ablation — objectui#5150 replanted in every scan root', () => {
  const clean = {
    'AGENTS.md': ['# AGENTS', '', fence('bash', `git commit -F - <<${SQ}EOF${SQ}`, 'msg', 'EOF')].join('\n'),
    'CLAUDE.md': ['# CLAUDE', '', fence('bash', 'pnpm install')].join('\n'),
    'skills/objectui/SKILL.md': ['# Skill', '', fence('bash', 'pnpm build')].join('\n'),
    // objectui#7403 — the tree objectui#7251 moved the contributor guides into.
    '.claude/skills/objectui-contributor/guides/console-development.md': [
      '# Console development',
      '',
      fence('bash', 'pnpm dev'),
    ].join('\n'),
    'content/docs/guide/a.md': ['# Guide', '', fence('bash', 'pnpm test')].join('\n'),
  };

  it('is GREEN on the clean fixture — the control leg', () => {
    const result = scanFixture(fixtureTree(clean));
    expect(result.hits).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.uncovered).toEqual([]);
    expect(result.vacuous).toEqual([]);
    expect(result.census.fences).toBe(5);
  });

  it('goes RED in each root separately, naming the file and the line', () => {
    for (const target of Object.keys(clean)) {
      const planted = { ...clean, [target]: `${clean[target as keyof typeof clean]}\n\n${fence('bash', HISTORICAL_LINE, '  EOF')}\n` };
      const result = scanFixture(fixtureTree(planted));

      const hits: ScanHit[] = result.hits;
      expect(hits.map((h) => h.file), `planting in ${target} must be found there and nowhere else`).toEqual([
        target,
        target,
      ]);
      // The run appears twice on the one line: around the introducer's
      // terminator and around its repeat.
      expect(new Set(hits.map((h) => h.line)).size).toBe(1);
      expect(hits[0].column).toBeLessThan(hits[1].column);
      expect(hits[0].patternId).toBe(RESIDUE_PATTERNS[0].id);
    }
  });

  it('finds all five at once, and is loud about none of the roots collapsing', () => {
    const planted = Object.fromEntries(
      Object.entries(clean).map(([rel, body]) => [rel, `${body}\n\n${fence('bash', HISTORICAL_LINE)}\n`]),
    );
    const result = scanFixture(fixtureTree(planted));
    expect(result.hits).toHaveLength(10);
    expect(result.census.rootsResolved).toBe(5);
    expect(result.census.outsideFences).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Non-vacuity — a scan that found nothing must FAIL, not pass
// ---------------------------------------------------------------------------

describe('non-vacuity — zero roots or zero files is a failure, not a green', () => {
  it('⚠️ reports a MISSING root by name instead of scanning zero files quietly', () => {
    // A mistyped root and a clean root produce identical output otherwise, and
    // the mistyped one reads as coverage for as long as nobody checks.
    const root = fixtureTree({ 'AGENTS.md': fence('bash', 'echo ok') });
    const result = scanFixture(root);
    expect(result.unresolved.map((u: { spec: string }) => u.spec)).toEqual([
      'CLAUDE.md',
      'skills',
      '.claude/skills',
      'content/docs',
      // objectui#7413 — a coverage tree gets the same treatment for the same
      // reason: a mistyped `.claude` would cover nothing and read as coverage
      // forever, which is precisely the failure the tree was added to stop.
      '.claude',
      'skills',
    ]);
    // …and the two kinds are told apart, so the remedy text can name the right
    // declaration list.
    expect(result.unresolved.map((u: { role: string }) => u.role)).toEqual([
      'scan root',
      'scan root',
      'scan root',
      'scan root',
      'coverage tree',
      'coverage tree',
    ]);
    expect(result.census.rootsResolved).toBe(1);
  });

  it('reports a root whose KIND changed — a file where a directory was declared', () => {
    const root = fixtureTree({ 'skills': fence('bash', 'echo ok') });
    expect(resolveRoot(root, { spec: 'skills', kind: 'dir' })).toMatchObject({
      ok: false,
      problem: 'is declared a directory but is a file',
    });
    expect(resolveRoot(root, { spec: 'AGENTS.md', kind: 'file' })).toMatchObject({ ok: false, problem: 'does not exist' });
  });

  it('reports a resolved-but-empty root as a COLLAPSE, not as clean', () => {
    const root = fixtureTree({
      'AGENTS.md': '',
      'CLAUDE.md': '',
      'skills/.keep': '',
      '.claude/skills/.keep': '',
      'content/docs/.keep': '',
    });
    const result = scanFixture(root);
    // `.keep` is not a document, so all three directory roots resolve and walk to nothing.
    expect(result.vacuous.map((v: { what: string }) => v.what)).toEqual([
      'files under skills',
      'files under .claude/skills',
      'files under content/docs',
    ]);
  });

  it('treats a fence count under the floor as a collapse of the walk', () => {
    const root = fixtureTree({
      'AGENTS.md': fence('bash', 'echo ok'),
      'CLAUDE.md': '# no fences',
      'skills/s/SKILL.md': '# no fences',
      '.claude/skills/s/SKILL.md': '# no fences',
      'content/docs/a.md': '# no fences',
    });
    const result = scanFixture(root, FIXTURE_ROOTS, { fenceFloor: 400 });
    expect(result.vacuous).toEqual([{ what: 'fenced blocks examined', value: 1, floor: 400 }]);
  });

  it('⭐ NAMES a root that reads nothing instead of passing on a healthy total (objectui#7403)', () => {
    // This is objectui#7251's miss as a fixture, and the reason the floors are
    // per root. Every other root is healthy, so a whole-surface floor — files,
    // or the global fence floor — is green through the entire outage while the
    // widened root walks to zero documents. The per-root floor is what turns it
    // red, and it names the root rather than reporting a total.
    const root = fixtureTree({
      'AGENTS.md': fence('bash', 'echo ok'),
      'CLAUDE.md': fence('bash', 'echo ok'),
      'skills/objectui/SKILL.md': fence('bash', 'echo ok'),
      'skills/objectui/guides/a.md': fence('bash', 'echo ok'),
      '.claude/skills/.keep': '', // resolves, walks to no document at all
      'content/docs/a.md': fence('bash', 'echo ok'),
    });
    const result = scanFixture(root);

    expect(result.unresolved, 'the root EXISTS — this is emptiness, not absence').toEqual([]);
    expect(result.vacuous).toEqual([{ what: 'files under .claude/skills', value: 0, floor: 1 }]);
    // The reading that hid it for a whole move: the totals look healthy.
    expect(result.census.files).toBe(5);
    expect(result.census.fences).toBe(5);
    expect(result.census.perRoot.find((r: RootRow) => r.spec === '.claude/skills')).toMatchObject({
      files: 0,
      fences: 0,
      resolved: true,
    });
  });

  it('exits 1 for a collapsed population even with nothing to report', () => {
    // The direction that matters: a broken walk must not be reported as OK.
    const root = fixtureTree({ 'AGENTS.md': fence('bash', 'echo ok') });
    const result = scanFixture(root, FIXTURE_ROOTS, { fenceFloor: 400 });
    expect(result.hits).toEqual([]);
    expect(result.unresolved.length + result.vacuous.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⭐ Coverage — the half a floor cannot do (objectui#7413)
// ---------------------------------------------------------------------------

describe('⭐ coverage — an agent-tree document under no scan root is RED (objectui#7413)', () => {
  /** Every root populated, every agent-tree document covered. */
  const healthy = {
    'AGENTS.md': fence('bash', 'echo ok'),
    'CLAUDE.md': fence('bash', 'echo ok'),
    'skills/objectui/SKILL.md': fence('bash', 'echo ok'),
    '.claude/skills/objectui-contributor/SKILL.md': fence('bash', 'echo ok'),
    'content/docs/a.md': fence('bash', 'echo ok'),
  };

  it('declares the two agent trees — and deliberately not the published docs tree', () => {
    expect(COVERAGE_TREES.map((t: DeclaredTree) => t.spec)).toEqual(['.claude', 'skills']);
    expect(COVERAGE_TREES.every((t: DeclaredTree) => t.kind === 'dir')).toBe(true);
    // ⛔ Same mechanism, different claim: `content/docs` is published prose that
    // shares this scan, not the agent surface objectui#5151 ruled. Declaring
    // coverage over it would assert a completeness promise no card has made.
    expect(COVERAGE_TREES.map((t: DeclaredTree) => t.spec)).not.toContain('content/docs');
  });

  it('is GREEN on the healthy fixture — the control leg', () => {
    const result = scanFixture(fixtureTree(healthy));
    expect(result.uncovered).toEqual([]);
    expect(result.census.coverage).toEqual([
      { spec: '.claude', documents: 1, uncovered: 0, resolved: true },
      { spec: 'skills', documents: 1, uncovered: 0, resolved: true },
    ]);
  });

  it('⭐ REDS on this card\'s own scenario — a new .claude/agents/reviewer.md', () => {
    // objectui#7413, verbatim: "The day someone adds `.claude/agents/reviewer.md`
    // […] with a fenced shell example, it is agent-written and agent-read prose
    // carrying fences that no root reaches — and nothing goes red."
    const result = scanFixture(
      fixtureTree({ ...healthy, '.claude/agents/reviewer.md': fence('bash', HISTORICAL_LINE, '  EOF') }),
    );

    const uncovered: Uncovered[] = result.uncovered;
    expect(uncovered).toEqual([{ file: '.claude/agents/reviewer.md', tree: '.claude' }]);

    // ⭐ And every OTHER signal reads healthy — which is exactly why a floor
    // could never have caught this. `.claude/skills` still returns its file, no
    // root is unresolved, nothing collapsed, and the residue inside the planted
    // fence is not even judged because the document is not on the surface.
    expect(result.hits, 'the residue is UNJUDGED — that is the defect').toEqual([]);
    expect(result.vacuous, 'no floor fires: nothing collapsed').toEqual([]);
    expect(result.unresolved, 'no root is missing: nothing moved').toEqual([]);
    expect(result.census.rootsResolved).toBe(FIXTURE_ROOTS.length);
    expect(result.census.perRoot.find((r: RootRow) => r.spec === '.claude/skills')).toMatchObject({
      files: 1,
      resolved: true,
    });
  });

  it('is GREEN again once the same document moves under a declared root — the restore leg', () => {
    // Same bytes, same fences, one directory over. A finding that does not go
    // away when the gap is closed is a finding about the wrong thing.
    const result = scanFixture(
      fixtureTree({
        ...healthy,
        '.claude/skills/objectui-contributor/reviewer.md': fence('bash', HISTORICAL_LINE, '  EOF'),
      }),
    );
    expect(result.uncovered).toEqual([]);
    // …and now that it IS on the surface, the residue in it is judged.
    expect(result.hits.map((h: ScanHit) => h.file)).toEqual([
      '.claude/skills/objectui-contributor/reviewer.md',
      '.claude/skills/objectui-contributor/reviewer.md',
    ]);
  });

  it('⭐ REDS when a SCAN_ROOTS ROW IS DELETED — the shape with no other signal', () => {
    // A root that VANISHES from disk is loud (`unresolved`). A root someone
    // DELETES from the declaration list leaves nothing behind to be loud about:
    // the remaining roots resolve, their floors are met, and a whole tree walks
    // off the surface silently. This is why `skills` is a coverage tree even
    // though its row covers the whole tree and the test is a tautology today.
    const withoutSkills = FIXTURE_ROOTS.filter((r) => r.spec !== 'skills');
    const result = scanFixture(fixtureTree(healthy), withoutSkills);

    expect(result.unresolved, 'nothing is missing from DISK').toEqual([]);
    expect(result.vacuous, 'every remaining floor is satisfied').toEqual([]);
    expect(result.uncovered).toEqual([{ file: 'skills/objectui/SKILL.md', tree: 'skills' }]);
  });

  it('counts documents by the scan\'s OWN walk, so the two cannot disagree', () => {
    // Coverage is membership in the set `listDocuments` returned, not a second
    // glob and not a prefix match on the row spec. So `DOC_EXTENSIONS` decides
    // for both: settings and hooks under `.claude/` are not documents and are
    // never reported, while both markdown extensions are.
    const root = fixtureTree({
      ...healthy,
      '.claude/settings.json': '{}',
      '.claude/hooks/guard.sh': '#!/bin/sh\n',
      '.claude/launch.json': '{}',
      '.claude/commands/ship.mdx': fence('bash', 'echo ship'),
    });
    const result = scanFixture(root);

    expect(result.uncovered).toEqual([{ file: '.claude/commands/ship.mdx', tree: '.claude' }]);
    // The membership claim itself, stated against the walk rather than inferred.
    const walked: string[] = listDocuments(root, '.claude', 'dir');
    expect(walked).toEqual([
      '.claude/commands/ship.mdx',
      '.claude/skills/objectui-contributor/SKILL.md',
    ]);
  });

  it('⚠️ reports a coverage tree that does not resolve, rather than covering nothing quietly', () => {
    // The `SCAN_ROOTS` rule applied to this list: a mistyped tree spec and a
    // fully-covered tree are otherwise identical output, and the mistyped one
    // reads as coverage forever.
    const result = scanFixture(fixtureTree(healthy), FIXTURE_ROOTS, {
      coverageTrees: [{ spec: '.cluade', kind: 'dir' }],
    });
    expect(result.unresolved).toEqual([
      { spec: '.cluade', kind: 'dir', ok: false, problem: 'does not exist', role: 'coverage tree' },
    ]);
    expect(result.census.coverage).toEqual([{ spec: '.cluade', documents: 0, uncovered: 0, resolved: false }]);
  });
});

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

describe('repo state — the gate is green on this tree, over a real population', () => {
  const result = scan(repoRoot);

  it('scans the five roots — objectui#5151 ruled four, objectui#7403 added the contributor tree', () => {
    expect(SCAN_ROOTS.map((r: DeclaredRoot) => r.spec)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'skills',
      '.claude/skills',
      'content/docs',
    ]);
    // Every floor is PER ROOT. A whole-surface floor is the shape that let
    // objectui#7251's move through, so there is deliberately no such row here.
    expect(SCAN_ROOTS.every((r: DeclaredRoot) => Number.isInteger(r.minFiles) && r.minFiles >= 1)).toBe(true);
    expect(SCAN_ROOTS.find((r: DeclaredRoot) => r.spec === '.claude/skills')).toEqual({
      spec: '.claude/skills',
      kind: 'dir',
      minFiles: 3,
    });
  });

  it('⭐ actually reads the two guides objectui#7251 moved — asserted on the POPULATION', () => {
    // `hits` being empty is true both when these guides are clean and when
    // nothing scans them at all; that ambiguity is how 18 fenced blocks left
    // this surface unnoticed. So the claim is made against the population the
    // walk returns, which is false in exactly one of those two worlds.
    const docs: string[] = listDocuments(repoRoot, '.claude/skills', 'dir');
    expect(docs).toContain('.claude/skills/objectui-contributor/guides/console-development.md');
    expect(docs).toContain('.claude/skills/objectui-contributor/rules/no-touch-zones.md');

    const row: RootRow | undefined = result.census.perRoot.find((r: RootRow) => r.spec === '.claude/skills');
    expect(row?.resolved).toBe(true);
    expect(row?.files).toBeGreaterThanOrEqual(3);
    // Floors, not exact counts: 4 files / 20 fences measured when this landed.
    expect(row?.fences).toBeGreaterThan(0);
  });

  it('⭐ reaches every agent-tree document on this tree — asserted on the POPULATION (objectui#7413)', () => {
    // Measured on `e1545cf`: 4 of 4 `.claude` documents under `.claude/skills`,
    // 16 of 16 under `skills`. `uncovered` being empty is true both when every
    // document is covered and when the coverage walk returned nothing at all —
    // the same ambiguity objectui#7403 was filed about — so the population is
    // asserted alongside it.
    expect(result.uncovered).toEqual([]);
    const rows: CoverageRow[] = result.census.coverage;
    expect(rows.map((c) => c.spec)).toEqual(['.claude', 'skills']);
    for (const row of rows) {
      expect(row.resolved, `${row.spec} must resolve`).toBe(true);
      expect(row.documents, `${row.spec} walked to nothing`).toBeGreaterThan(0);
    }
    // The `.claude` tree is the card's own case: its declared row is a PROPER
    // SUBTREE, so this is the row that stops being a tautology first.
    const claude = rows.find((c) => c.spec === '.claude');
    expect(claude?.documents).toBeGreaterThanOrEqual(4);
    expect(listDocuments(repoRoot, '.claude', 'dir')).toEqual(
      expect.arrayContaining(['.claude/skills/objectui-contributor/SKILL.md']),
    );
  });

  it('has no residue in any fenced block', () => {
    expect(
      result.hits.map((h: ScanHit) => `${h.file}:${h.line}:${h.column}`),
      'Run `pnpm check:shell-escape-residue` for the full report and the remedy.',
    ).toEqual([]);
  });

  it('resolved every root and actually walked them', () => {
    // Without this the assertion above passes for the wrong reason the day a
    // root moves. Floors, not exact counts — measured 204 files / 1305 fences
    // when this landed.
    expect(result.unresolved).toEqual([]);
    expect(result.census.rootsResolved).toBe(SCAN_ROOTS.length);
    expect(result.census.files).toBeGreaterThan(100);
    expect(result.census.fences).toBeGreaterThan(FENCE_FLOOR);
    expect(result.vacuous).toEqual([]);
    expect(result.uncovered).toEqual([]);
  });

  it('puts the per-root census in the verdict, so a reader sees the population', () => {
    // "OK" alone is what a gate that does nothing also prints.
    const line = summarise(result);
    for (const root of SCAN_ROOTS) expect(line).toContain(`${root.spec}: `);
    expect(line).toMatch(/\d+ file\(s\) and \d+ fenced block\(s\) examined/);
    // objectui#7413 — the coverage figure rides in the verdict for the same
    // reason the per-root census does: a green must show what it was computed
    // over, or a reader cannot tell it from a green that examined nothing.
    expect(line).toMatch(/coverage -- .*document\(s\) under a declared root/);
    for (const tree of COVERAGE_TREES) expect(line).toContain(`${tree.spec}: `);

    const out = execFileSync('node', ['scripts/check-shell-escape-residue.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    expect(out).toMatch(/check-shell-escape-residue: OK/);
    expect(out).toContain(`${result.census.fences} fenced block(s) examined`);
  });

  it('needs no install and no build — it is a cheap-tier gate', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'scripts/check-shell-escape-residue.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(2);
    for (const spec of imports) {
      expect(spec.startsWith('node:') || spec.startsWith('./'), `${spec} would need an install`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('wiring — the gate is reachable and every PR shape starts it', () => {
  const SCRIPT = 'scripts/check-shell-escape-residue.mjs';
  const WORKFLOW = 'repo-gates.yml';
  const CHECK_NAME = 'Shell Escape Residue Scan';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /** A workflow's YAML with whole-line comments removed — headers discuss
   *  `paths` and each other's scripts in prose. */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:shell-escape-residue']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(path.join(workflowDir, WORKFLOW)), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf(WORKFLOW);
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}`));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toContain(`name: ${CHECK_NAME}`);
  });

  it('subscribes merge_group — a required check that skips a queue build stalls it', () => {
    // objectui#3523: `main` sits behind an enforced queue, and a required
    // context that never reports does not fail the queue, it hangs it until the
    // ruleset's 60-minute timeout.
    expect(yamlOf(WORKFLOW)).toMatch(/^\s*merge_group:/m);
  });

  it('is classified as a required context — the merge_group floor DERIVES from that list', () => {
    // objectui#6160 / PR #6187: `merge-queue-reporting.test.ts` reads
    // `REQUIRED_CONTEXTS` to decide which workflows must subscribe the queue,
    // and `dependabot-merge-gate.mjs` would let a Dependabot merge past an
    // unclassified blocking check (objectui#6135).
    // Since objectui#12214 the check reports as a step of the ONE `Repo Gates`
    // context, which is the name the classification and the floor read.
    expect(REQUIRED_CONTEXTS).toContain('Repo Gates');
  });

  it('runs it in NO path-filtered workflow', () => {
    // The scan surface is markdown that any pull request shape can touch, and
    // reporting on every shape is also what makes the check requirable.
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore`).not.toMatch(/paths-ignore:/);
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual([WORKFLOW]);
  });

  it('installs nothing before running the gate — the cheap tier, mechanically', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf(WORKFLOW);
    const gateAt = yaml.indexOf(SCRIPT);
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);
  });
});
