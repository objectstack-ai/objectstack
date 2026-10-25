import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENFORCEMENT,
  EXIT_CODES,
  SELF_FILES,
  SYNTHETIC_CASES,
  citationKey,
  classify,
  evaluateSyntheticCases,
  newCitationsIn,
} from '../check-new-cross-file-line-citations.mjs';
import { judge } from '../cross-file-line-citation-census.mjs';

/**
 * objectui#8875 clause 2 — the DIFFERENTIAL cross-file line-address citation
 * gate.
 *
 * The maintainer ruled the class on 2026-09-10, verbatim and untranslated:
 * 跨文件的「某文件第几行」引用， 这种完全没必要吧，是否应该避免. The mechanism
 * half is a gate that reds on what a pull request ADDS, and the load-bearing
 * word is DIFFERENTIAL — an absolute count was refused on a measurement, not a
 * preference: PR #8887's line shifts flipped one citation from `drifted` to
 * `resolves` by accident and moved the tree-wide false count 540 -> 539, an
 * unearned green a total-reading gate would have scored as progress.
 *
 * ⛔ THE ONE THING THESE TESTS EXIST TO STOP is a gate that cannot fail. A
 * differential gate reporting zero because its differ is broken is
 * indistinguishable from a clean branch — which is this card's own subject one
 * level up. So the firing direction is asserted first, and every non-firing
 * assertion below is paired with a firing one on the same code path.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gatePath = path.join(repoRoot, 'scripts/check-new-cross-file-line-citations.mjs');
const workflowPath = path.join(repoRoot, '.github/workflows/line-citation-gate.yml');
const docPath = path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md');

/** Judges a hit against the real tree, the way the gate's own run does. */
function judgeAgainstTree(hit: { citedWritten: string; citedLine: number; file: string; anchors: string[] }) {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const index = new Map<string, string[]>();
  for (const p of tracked) {
    const name = path.basename(p);
    if (!index.has(name)) index.set(name, []);
    (index.get(name) as string[]).push(p);
  }
  return judge(hit, repoRoot, index, new Map());
}

const NOTES = 'packages/example/src/notes.ts';

describe('the differ FIRES — the direction that makes this a gate at all', () => {
  it('reports a cross-file address the head text added', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '// the action vocabulary is declared by `ActionDef`\n',
      headText: '// declared at packages/core/src/actions/ActionRunner.ts:112\n',
    });
    expect(added).toHaveLength(1);
    expect(added[0].citedWritten).toBe('packages/core/src/actions/ActionRunner.ts');
    expect(added[0].citedLine).toBe(112);
  });

  /**
   * The four spellings the card measured, keyed by syntax name.
   *
   * ⛔ The fixtures live HERE and not in the `each` table on purpose: an address
   * in a case table reaches the test name through the title interpolation, and
   * `object-ui/no-line-address-in-test-name` refuses that at `error`. That rule
   * is objectui#8047's mechanization of the very convention this gate extends,
   * so working around it here would be the card contradicting itself in its own
   * test file. The table carries the syntax NAME; the address stays data.
   */
  const SYNTAX_FIXTURES: Record<string, string> = {
    colon: 'see packages/core/src/actions/ActionRunner.ts:112',
    permalink: 'see packages/core/src/actions/ActionRunner.ts#L112',
    'line-before-name': 'see line 112 of packages/core/src/actions/ActionRunner.ts',
    'name-before-line': 'see packages/core/src/actions/ActionRunner.ts line 112',
  };

  it.each(Object.keys(SYNTAX_FIXTURES))('reads the %s syntax the card measured', (syntax) => {
    // The card's own evidence is that a single-syntax probe under-reads this
    // class by construction: the filing seat's first probe was `path:line` only
    // and missed a `#L` permalink among its own 73 hits.
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: `// ${SYNTAX_FIXTURES[syntax]}\n`,
    });
    expect(added).toHaveLength(1);
    expect(added[0].citedLine).toBe(112);
    expect(added[0].syntax).toBe(syntax);
  });

  it('reads the CONTINUATION address, which carries no filename at all', () => {
    // `packages/types/src/crud.ts` writes an address and then a bare `:NNN`
    // beside it. No basename-anchored probe can match the second one, and the
    // ruling names it explicitly alongside the four syntaxes.
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: '// see packages/core/src/actions/ActionRunner.ts:1787 and :1793\n',
    });
    expect(added).toHaveLength(2);
    expect(added.map((a) => a.citedLine)).toEqual([1787, 1793]);
    expect(added[1].syntax).toBe('continuation');
    expect(added[1].citedWritten).toBe('packages/core/src/actions/ActionRunner.ts');
  });

  /**
   * objectui#9026 — THE GATE'S OWN ZERO, reproduced and then made to fire.
   *
   * ⭐ This is the assertion the card is about. A pull request whose docblock
   * carried six cross-file addresses — all of them already rotted — was scored
   * `0 new citation(s)` by this gate, because scope opened only on a full
   * `NAME:NNN` and the docblock named its file without one. Report-only was
   * never the problem: the gate was SILENT on the class, and a reader who knows
   * a number is report-only still reads a clean sheet as nothing to look at.
   *
   * ⛔ A green run proves nothing here. The paired ablation below removes the
   * filename and asserts the gate falls back to the zero it used to print, so
   * the firing direction is the thing under test.
   */
  const KANBAN_DOCBLOCK = [
    ' * `packages/plugin-kanban/src/ObjectKanban.tsx` reads `schema.groupBy` at',
    ' * thirteen sites: lane materialisation (`:601`, `:625`, `:640`), card moves',
    ' * (`:747`, `:865`) and their effect deps.',
    '',
  ].join('\n');

  it('reports the continuation addresses under a filename that carries no number', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: KANBAN_DOCBLOCK,
    });
    expect(added.map((a) => a.citedLine)).toEqual([601, 625, 640, 747, 865]);
    for (const a of added) {
      expect(a.syntax).toBe('continuation');
      expect(a.citedWritten).toBe('packages/plugin-kanban/src/ObjectKanban.tsx');
    }
  });

  it('⛔ ABLATION — with the filename gone the gate prints the zero it used to', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: KANBAN_DOCBLOCK.replace('`packages/plugin-kanban/src/ObjectKanban.tsx` reads', 'the renderer reads'),
    });
    expect(added).toHaveLength(0);
  });

  it('a RE-ADDRESSED citation is new — moving the number is not a repair', () => {
    // Clause 4 repairs an existing address by converting it to a content
    // anchor, never by moving the number to a different number. So an edited
    // address is a fresh one, and the gate says so.
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '// see packages/core/src/actions/ActionRunner.ts:112\n',
      headText: '// see packages/core/src/actions/ActionRunner.ts:113\n',
    });
    expect(added).toHaveLength(1);
    expect(added[0].citedLine).toBe(113);
  });

  it('a file with no base blob at all has every citation in it reported', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: null as unknown as string,
      headText: '// a packages/core/src/actions/ActionRunner.ts:112\n// b packages/types/src/crud.ts:57\n',
    });
    expect(added).toHaveLength(2);
  });
});

describe('the differ does NOT fire — and each case is paired with the firing one above', () => {
  it('is blind to a citation that only MOVED down the citing file', () => {
    // The anti-absolute-count control. Adding two imports above an existing
    // citation must report nothing: if it did, the instrument would carry the
    // positional fragility it exists to measure.
    const citation = '// see packages/core/src/actions/ActionRunner.ts:112\n';
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: citation,
      headText: `import { x } from './x';\nimport { y } from './y';\n\n${citation}`,
    });
    expect(added).toEqual([]);
  });

  it('is blind to prose re-wrapped around an unchanged citation', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '// the action vocabulary lives at packages/core/src/actions/ActionRunner.ts:112\n',
      headText: '// the action vocabulary lives\n// at packages/core/src/actions/ActionRunner.ts:112\n',
    });
    expect(added).toEqual([]);
  });

  it('counts a SECOND copy of an existing citation, because the comparison is a multiset', () => {
    // Paired with the two above: "unchanged is invisible" must not degrade into
    // "any citation already somewhere in the file is forgiven".
    const citation = '// see packages/core/src/actions/ActionRunner.ts:112\n';
    const added = newCitationsIn({ relPath: NOTES, baseText: citation, headText: citation + citation });
    expect(added).toHaveLength(1);
  });

  it('keeps the citing line number out of the identity, and the cited one in', () => {
    const key = citationKey({ syntax: 'colon', citedWritten: 'a/b.ts', citedLine: 12, line: 99 } as never);
    expect(key).toBe('colon|a/b.ts|12');
    expect(key).not.toContain('99');
  });
});

describe('released CHANGELOG sections stay carved out', () => {
  it('does not report a citation added under a released version heading', () => {
    // Clause 4: a changelog entry is a dated record of what was true at that
    // release. Re-addressing it would make it false AS HISTORY, so the gate must
    // not ask an author to.
    const head =
      '# pkg\n\n## 17.6.0\n\n- fixed per packages/core/src/actions/ActionRunner.ts:112\n';
    expect(newCitationsIn({ relPath: 'packages/pkg/CHANGELOG.md', baseText: '', headText: head })).toEqual([]);
  });

  it('DOES report one added above the first released heading — the carve-out is not the whole file', () => {
    const head =
      '# pkg\n\n- unreleased, per packages/core/src/actions/ActionRunner.ts:112\n\n## 17.6.0\n\n- old\n';
    expect(
      newCitationsIn({ relPath: 'packages/pkg/CHANGELOG.md', baseText: '', headText: head }),
    ).toHaveLength(1);
  });
});

describe('`unresolvable` is a third answer and never collapses into `false`', () => {
  it('records a citation into a regenerated build artifact as unresolvable', () => {
    // The ruling: 指向重生成文件（`dist/*.d.ts`）的记 unresolvable，不计. Those
    // files are untracked and rebuilt, so no instrument can ever decide them —
    // calling one false would be an assertion. An earlier census reported this
    // correctly and the split must not regress.
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: '// the emitted shape is at packages/types/dist/overlay.d.ts:334\n',
    });
    expect(added).toHaveLength(1);
    const verdict = judgeAgainstTree(added[0] as never).verdict;
    expect(classify(verdict)).toBe('unresolvable');
    expect(classify(verdict)).not.toBe('false');
  });

  it('still reports it as ADDED — unresolvable is a verdict, not an exemption', () => {
    const added = newCitationsIn({
      relPath: NOTES,
      baseText: '',
      headText: '// packages/types/dist/overlay.d.ts:334\n',
    });
    expect(added).toHaveLength(1);
  });

  it('classifies the three buckets apart', () => {
    expect(classify('resolves')).toBe('resolving');
    expect(classify('drifted')).toBe('false');
    expect(classify('out-of-range')).toBe('false');
    expect(classify('non-substantive')).toBe('false');
    expect(classify('no-such-file')).toBe('unresolvable');
    expect(classify('ambiguous-basename')).toBe('unresolvable');
    expect(classify('anchor-absent')).toBe('unresolvable');
  });
});

describe("the gate's own synthetic controls", () => {
  it('all pass on this tree', () => {
    const results = evaluateSyntheticCases();
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
    expect(results.length).toBe(SYNTHETIC_CASES.length);
  });

  it('the FIRING control is synthetic, and it has to be', () => {
    // A differential gate is blind to citations that already exist in the tree —
    // that is the point of it — so the tree's own known-wrong citation cannot
    // serve as this gate's firing control the way it serves the census's.
    // objectui#8875 clause 5 asks for a known-wrong citation to be KEPT as the
    // firing control; the one it names by line address has moved, and the
    // census still holds it BY CONTENT. This gate needs its own, and a fixture
    // is the only shape that can be new on every run.
    const firing = SYNTHETIC_CASES.find((c) => c.id === 'fires');
    expect(firing).toBeDefined();
    expect(firing?.baseText).not.toContain(':112');
    expect(firing?.headText).toContain(':112');
  });

  it('a broken differ fails the controls instead of reporting a clean branch', () => {
    // The controls are evaluated through the real differ, so this asserts the
    // wiring rather than the fixtures: hand `evaluateSyntheticCases` a judge
    // that lies and the same-file case, which is the only one that consults it,
    // must fail rather than pass.
    const results = evaluateSyntheticCases(() => ({ verdict: 'resolves' }) as never);
    expect(results.find((r) => r.id === 'same-file-is-not-in-the-population')?.ok).toBe(false);
  });
});

describe('the enforcement state is declared once, and this pin states what landed', () => {
  it('ships REPORT-ONLY', () => {
    // objectui#8875 clause 2: report-only 起步，零新增后翻阻断. Flipping this to
    // `blocking` changes whether a pull request can be merged, so it is a
    // decision and not a tidy-up — this assertion is what makes the flip
    // visible in a diff instead of arriving as a one-word edit.
    expect(ENFORCEMENT).toBe('report-only');
  });

  it('exits 0 on findings under report-only and 1 under --strict, so it CAN fail', () => {
    // Run twice over a real fixture through the real CLI, since exit codes are
    // the only thing CI reads. A gate whose failing path is never exercised is
    // one nobody has shown can fail.
    // The throwaway repo goes under `node_modules/`, never straight into the
    // repo root. `textFootprint()` in `scripts/check-i18n-dead-keys.mjs` sweeps
    // the repo root in one `grep -rFn` pass, and a directory that disappears
    // between that grep enumerating it and descending into it makes grep exit
    // 2 — a status that sweep rethrows deliberately, taking the whole shard
    // down with it. objectui#9468 holds the occurrences, one of them an
    // already-green pull request ejected from the merge queue. `node_modules`
    // is skipped by the repo-wide scanners under `scripts/`, so nothing
    // transient placed here is ever walked by one.
    const scratch = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.tmp-citation-gate-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: scratch });
      execFileSync('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: scratch });
      execFileSync('git', ['config', 'user.name', 'gate'], { cwd: scratch });
      fs.writeFileSync(path.join(scratch, 'seed.md'), 'nothing here\n');
      execFileSync('git', ['add', '-A'], { cwd: scratch });
      execFileSync('git', ['commit', '-qm', 'base'], { cwd: scratch });
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim();
      fs.writeFileSync(
        path.join(scratch, 'seed.md'),
        'see packages/core/src/actions/ActionRunner.ts:112\n',
      );

      const run = (args: string[]) => {
        const res = execFileSync('node', [gatePath, '--base', base, '--json', ...args], {
          cwd: scratch,
          encoding: 'utf8',
          env: { ...process.env, CITATION_GATE_BASE: base },
          // The gate exits non-zero on purpose in the strict arm; capture it.
        });
        return res;
      };

      const reportOnly = JSON.parse(run([]));
      expect(reportOnly.newCitations).toBe(1);
      expect(reportOnly.enforcement).toBe('report-only');

      let strictStatus = 0;
      try {
        run(['--strict']);
      } catch (error) {
        strictStatus = (error as { status: number }).status;
      }
      expect(strictStatus, 'the gate must exit 1 on a new citation under --strict').toBe(
        EXIT_CODES.newCitations,
      );
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('a base it cannot resolve is PREREQUISITE NOT MET, never a green', () => {
  it('exits 2 and says so', () => {
    // objectstack#4928 named the direction: a swallowed diff failure is
    // indistinguishable from a clean tree, and it fails towards "nothing to
    // report" — the most reassuring wrong answer available.
    let status = 0;
    let output: string;
    try {
      output = execFileSync('node', [gatePath, '--base', 'refs/heads/no-such-base-ref-8875'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const e = error as { status: number; stderr: string };
      status = e.status;
      output = e.stderr;
    }
    expect(status).toBe(EXIT_CODES.couldNotRun);
    expect(output).toContain('PREREQUISITE NOT MET');
  });
});

describe('the instrument does not count itself', () => {
  it('carves out both citation readers and both their tests', () => {
    for (const file of SELF_FILES) {
      expect(fs.existsSync(path.join(repoRoot, file)), `${file} is carved out but does not exist`).toBe(
        true,
      );
    }
    expect(SELF_FILES.has('scripts/check-new-cross-file-line-citations.mjs')).toBe(true);
    expect(SELF_FILES.has('scripts/__tests__/check-new-cross-file-line-citations.test.ts')).toBe(true);
  });

  it('reads the census rather than keeping a second copy of it', () => {
    // Two readers over one population is how the two answers start disagreeing.
    // The census is the measured one; this gate adds the base comparison and
    // nothing else.
    const source = fs.readFileSync(gatePath, 'utf8');
    expect(source).toContain("from './cross-file-line-citation-census.mjs'");
    expect(source).not.toMatch(/const RE_COLON\s*=/);
  });
});

describe('wiring — a gate nothing runs is not a gate', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  it('runs the gate in its own workflow', () => {
    expect(workflow).toContain('node scripts/check-new-cross-file-line-citations.mjs');
  });

  it('checks out deep enough to have a merge base', () => {
    expect(workflow).toContain('fetch-depth: 0');
  });

  it('filters no pull request at the trigger', () => {
    // The population is comments, message strings, documentation and changesets.
    // A path filter on any of those is the hole the gate exists to close, and
    // `lint.yml`'s in-job short-circuit excludes exactly them, which is why this
    // is its own workflow.
    const trigger = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
    expect(trigger).toContain('pull_request');
    expect(trigger).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it('is written up on the page objectui#3653 pins, and declared report-only there', () => {
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('node scripts/check-new-cross-file-line-citations.mjs');

    const at = doc.indexOf('node scripts/check-new-cross-file-line-citations.mjs');
    const start = doc.lastIndexOf('\n\n', at);
    const end = doc.indexOf('\n\n', at);
    // Whitespace-normalised: the page hard-wraps, so a sentence that must be
    // present is split across lines in the source and matches nothing verbatim.
    const around = doc
      .slice(start, end === -1 ? doc.length : end + 400)
      .toLowerCase()
      .replace(/\s+/g, ' ');
    expect(around, 'a step the page does not declare report-only is a guardrail readers believe in')
      .toContain('report-only');
    expect(around).toContain('exits 0 regardless of what it finds');
  });

  it('has a heading naming the workflow file, which the inventory pin also requires', () => {
    const doc = fs.readFileSync(docPath, 'utf8');
    const headings = doc.split('\n').filter((line) => /^#{1,6}\s/.test(line));
    expect(headings.some((h) => h.includes('line-citation-gate.yml'))).toBe(true);
  });

  it('is classified by the Dependabot merge gate, with its reason', () => {
    // An unclassified blocking check is one a Dependabot merge would be let
    // past (objectui#6135); an unclassified NON-blocking one fails that gate's
    // partition test instead, which is where a new context is meant to be
    // noticed.
    const gate = fs.readFileSync(path.join(repoRoot, 'scripts/dependabot-merge-gate.mjs'), 'utf8');
    expect(gate).toContain("'Line Citation Gate':");
  });

  it('the workflow job name matches the classified context name', () => {
    expect(workflow).toMatch(/^\s*name: Line Citation Gate$/m);
  });
});

/**
 * objectui#9865 — a declared fixture address is one class, read once.
 *
 * ⭐ THE POINT OF PUTTING IT HERE. The census and this gate share ONE carve-out
 * list for the reason its docblock gives: two lists over one population drift,
 * and the direction they drift in is silent. A declaration read by only one of
 * the two readers would be that same failure wearing a new shape — the census
 * would report a row carved out while this gate reddened a branch for adding
 * it, with nothing anywhere saying which answer was meant.
 *
 * ⛔ So the firing leg comes first and every non-firing assertion is paired
 * with it on the same code path: a gate that carves out everything reports zero
 * for the same reason a broken differ does.
 */
describe('a declared fixture address is carved out by BOTH readers (objectui#9865)', () => {
  const ADDRESS = '// the vocabulary is declared at packages/core/src/actions/ActionRunner.ts:112\n';
  const DECLARED = `// fixture-address: control input, the reader under test reads it\n${ADDRESS}`;
  const added = (headText: string, baseText = '') =>
    newCitationsIn({ relPath: 'packages/example/src/notes.ts', baseText, headText }) as {
      citedLine: number;
    }[];

  it('⛔ FIRING CONTROL — the undeclared address IS reported as added', () => {
    // Without this leg every assertion below is satisfied by a differ that
    // reports nothing at all, which is the one failure this file exists to stop.
    expect(added(ADDRESS).map((a) => a.citedLine)).toEqual([112]);
  });

  it('does not report an added address the citing text declares', () => {
    expect(added(DECLARED)).toEqual([]);
  });

  it('⛔ a marker with no reason is a mute button and the address is still reported', () => {
    expect(added(`// fixture-address:\n${ADDRESS}`).map((a) => a.citedLine)).toEqual([112]);
  });

  it('differences the DECLARED population too, so a branch that adds one is visible', () => {
    // Report-only, and printed: the moment a declaration is added is the one
    // moment a reader can still object to it.
    const declaredAdded = newCitationsIn({
      relPath: 'packages/example/src/notes.ts',
      baseText: '',
      headText: DECLARED,
      of: 'declared',
    }) as { citedLine: number; declaredReason: string }[];
    expect(declaredAdded).toHaveLength(1);
    expect(declaredAdded[0].citedLine).toBe(112);
    expect(declaredAdded[0].declaredReason).toBe('control input, the reader under test reads it');

    // ...and a declaration already present at the base is NOT re-reported.
    const unchanged = newCitationsIn({
      relPath: 'packages/example/src/notes.ts',
      baseText: DECLARED,
      headText: DECLARED,
      of: 'declared',
    }) as unknown[];
    expect(unchanged).toEqual([]);
  });

  it('reads the declaration from the shared scanner rather than re-declaring it', () => {
    // Same discipline as `SELF_FILES` above: one reader, ⛔ never a second copy.
    const source = fs.readFileSync(gatePath, 'utf8');
    expect(source).not.toMatch(/fixture-address:\[/);
    expect(source).not.toMatch(/const DECLARATION\s*=/);
  });

  it('carries both legs as synthetic controls, so a live run proves them again', () => {
    const ids = (SYNTHETIC_CASES as { id: string }[]).map((c) => c.id);
    expect(ids).toContain('a-declared-fixture-address-is-not-a-finding');
    expect(ids).toContain('a-declaration-without-a-reason-still-reports');
    for (const c of evaluateSyntheticCases() as { id: string; ok: boolean; detail: string }[]) {
      expect(c.ok, `${c.id} -- ${c.detail}`).toBe(true);
    }
  });
});
