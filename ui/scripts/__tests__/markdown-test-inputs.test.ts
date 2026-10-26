/**
 * The firing control for objectui#8861 — a markdown-only pull request must now
 * run the shard that reads the markdown.
 *
 * ## Why a green run is not evidence here
 *
 * The defect this file guards is invisible in the one way that matters: it makes
 * CI green. objectui#8857 changed exactly one file,
 * `packages/plugin-dashboard/README.md`, and the test that reads that README
 * extracts its fences and evaluates them. Every check on the pull request page
 * was green — `Test (shard 1/4)` reported success in ten seconds having run
 * nothing — and the merge_group build then failed the same shard in 907 seconds
 * and dequeued the pull request.
 *
 * ⇒ a test that only checks the NEW behaviour cannot tell a working trigger from
 * one that always says `true`, and a test that runs the class derivation without
 * running the workflow cannot tell a correct class from a step that never asks
 * it. So this file drives the REAL step, extracted from `ci.yml` and executed by
 * bash against a real git repository, and it drives it in THREE directions:
 *
 *   fires   the objectui#8857 shape — one package README a test reads — now
 *           yields `should_run=true`.
 *   before  the SAME input through the `type-check` job's copy of the same step,
 *           which is the unwidened shape, yields `should_run=false`. That copy
 *           is not a reconstruction: `ci.yml` carries four copies of this step
 *           and the `type-check` and `e2e` ones are untouched by this change, so
 *           the "before" answer is a real one taken from the file rather than
 *           from history. (It was three copies until objectui#9499 moved the
 *           built-artifact pin lane into a job of its own; that job's copy is
 *           byte-identical to the `test` job's, which is asserted below.)
 *   inert   an excluded change nothing reads still yields `should_run=false`,
 *           through the WIDENED step. Without this leg, deleting the exclusions
 *           entirely would pass every other assertion in this file.
 *
 * ## ⚠️ objectui#9096 moved the inert leg off markdown, and that is the ruling
 *
 * The inert leg used to add a markdown document nothing reads. That leg is gone,
 * because after objectui#9096 added `scripts` to the scan roots there is no such
 * document: 1734 of 1734 tracked markdown files are opened by at least one test
 * under `scripts/__tests__`. ⛔ So this file does NOT pretend the class stayed
 * narrow. It pins the opposite — `every markdown path is an input` is asserted
 * outright below, so the day that stops being true someone is told — and it
 * moves the inert leg to what the exclusion list still buys: a NON-markdown
 * change under `apps/site/**`, which is the shape of the one commit in the
 * measured 513-merge window that still skips and should.
 *
 * ## ⚠️ objectstack#25712: the step is gone, and its legs with it
 *
 * The decision step lived in objectui's `ci.yml`, which runs nowhere under the
 * monorepo: GitHub runs the repository root's `.github/workflows/` alone. The
 * root `ci.yml` ported objectui's `Test` job as `test-ui` (row 7 of the
 * objectstack#25697 workflow roster) without the step, so every leg that ran it
 * retired: the four cases of `the decision step, as \`ci.yml\` writes it`, the
 * five of `the objectui#8857 pull request shape`, objectui#9142's `FIRES: the
 * planted root document runs the shards` and the real-step half of its depth-1
 * case. The property the step carried, that a markdown-only pull request runs
 * the tests that read the markdown, is the root's in two halves now: the
 * `filter` job's `ui` globs start `Test UI` on any change under `ui/` (pinned
 * below, by path), and `select-affected-tests.mjs` picks the tests, a package's
 * own for a file it owns and every `scripts/**` test always
 * (`select-affected-tests.test.ts`). Neither reads this ledger, which keeps its
 * audit and its derivation here.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globMatches, jobBlock, repoPath, rootCi, uiFilterGlobs, UI_JOBS } from './helpers/root-ci';

import {
  ADJUDICATED,
  SCAN_ROOTS,
  auditTree,
  declaredEntries,
  deriveCandidates,
  markdownTestInputsAmong,
  matchesEntry,
  missingDocuments,
} from '../markdown-test-inputs.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The document objectui#8857 changed, and the test that reads it. */
const INSTANCE_DOCUMENT = 'packages/plugin-dashboard/README.md';
const INSTANCE_READER =
  'packages/plugin-dashboard/src/__tests__/readme-dashboard-examples-spec-valid.test.ts';

/* ── the root job that runs the readers ───────────────────────────────────── */

describe('the root Test UI job starts on a markdown-only pull request', () => {
  it('the `ui` filter matches the documents the objectui#8857, #9096 and #9142 shapes changed', () => {
    const globs = uiFilterGlobs(rootCi());
    const missed = [INSTANCE_DOCUMENT, 'AGENTS.md', 'SECURITY.md']
      .map(repoPath)
      .filter((file) => !globs.some((glob) => globMatches(glob, file)));
    expect(missed, 'a markdown-only change under ui/ would skip Test UI').toEqual([]);
  });

  it('and the job reads that filter', () => {
    expect(jobBlock(rootCi(), UI_JOBS.test)).toMatch(/^ {4}if: .*needs\.filter\.outputs\.ui != 'false'/m);
  });
});

/* ── the derivation behind the answer ────────────────────────────────────── */

describe('the derived class', () => {
  it('names the objectui#8857 document and the test that reads it', () => {
    const verdict = ADJUDICATED.get(INSTANCE_READER);
    expect(verdict, `${INSTANCE_READER} must be adjudicated`).toBeDefined();
    expect(verdict?.reads).toContain(INSTANCE_DOCUMENT);
    expect(markdownTestInputsAmong([INSTANCE_DOCUMENT]).map((hit) => hit.path)).toEqual([
      INSTANCE_DOCUMENT,
    ]);
  });

  it('every candidate the scanner finds has been adjudicated, and every entry exists', () => {
    const candidates = deriveCandidates();
    // A collapsed scan reads as a pass — assert the population, not just the
    // verdict (objectui#8468).
    expect(candidates.size).toBeGreaterThan(20);
    expect(candidates.has(INSTANCE_READER)).toBe(true);
    expect(auditTree(candidates)).toEqual([]);
    expect(missingDocuments()).toEqual([]);
    expect(declaredEntries().length).toBeGreaterThan(0);
  });

  it('the audit can FAIL — an unadjudicated reader is a finding, not a shrug', () => {
    const planted = new Map([
      ['packages/plugin-grid/src/__tests__/invented.test.ts', { documents: ['README.md'], walks: false }],
    ]);
    const findings = auditTree(planted);
    expect(findings.map((finding) => finding.kind)).toContain('unadjudicated-test');
  });

  it('the audit can fail the other way — a rejected candidate is recorded, not dropped', () => {
    const planted = new Map([
      [INSTANCE_READER, { documents: [INSTANCE_DOCUMENT, 'ROADMAP.md'], walks: false }],
    ]);
    const findings = auditTree(planted);
    expect(findings.map((finding) => finding.kind)).toContain('unadjudicated-document');
  });

  it('a declared tree covers a document added inside it, and never a non-markdown sibling', () => {
    expect(declaredEntries()).toContain('content/docs/**');
    expect(markdownTestInputsAmong(['content/docs/guide/a-page-added-today.md'])).toHaveLength(1);
    // The extension is the discriminator that survives objectui#9096: the class
    // is total over markdown and empty over everything else, so a JSON file
    // beside a declared document is still not an input.
    expect(markdownTestInputsAmong(['content/docs/guide/a-page-added-today.json'])).toHaveLength(0);
    expect(markdownTestInputsAmong(['apps/site/src/app/page.tsx'])).toHaveLength(0);
  });
});

/* ── objectui#9096: the ruling, stated as an assertion ───────────────────── */

describe('objectui#9096 — `scripts` is a scan root, and the class is now total', () => {
  it('scans `scripts`, and the scan is what finds those tests', () => {
    expect(SCAN_ROOTS).toContain('scripts');
    const candidates = deriveCandidates();
    const fromScripts = [...candidates.keys()].filter((file) => file.startsWith('scripts/'));
    // A floor, not an exact count: the point is that the root is producing
    // candidates at all, so a root that silently stopped resolving is caught.
    // 45 files the day the root landed.
    expect(fromScripts.length).toBeGreaterThanOrEqual(40);
  });

  it('names the card\'s instance: three gate tests read `AGENTS.md`, so it is an input', () => {
    const hits = markdownTestInputsAmong(['AGENTS.md']);
    expect(hits).toHaveLength(1);
    expect(hits[0].readers.length).toBeGreaterThanOrEqual(3);
    for (const reader of hits[0].readers) expect(reader.startsWith('scripts/')).toBe(true);
  });

  it('EVERY tracked markdown document is an input — the cost of the ruling, pinned', () => {
    // ⚠️ This is not a target, it is a CONFESSION kept honest. objectui#9096
    // widened the class until it covered the whole tree, and the header argues
    // why that is acceptable (14 extra runs per 513 merges). An assertion is
    // the only form of that statement which cannot quietly stop being true:
    // if a future change re-narrows the class, this fails and the person doing
    // it has to come here and say so.
    const tracked = execFileSync('git', ['ls-files', '--', '*.md', '*.mdx'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((line) => line.trim() !== '');

    // Floor under the floor: an empty `git ls-files` would pass the next
    // assertion while proving nothing (objectui#8468).
    expect(tracked.length).toBeGreaterThanOrEqual(300);

    const uncovered = tracked.filter((file) => markdownTestInputsAmong([file]).length === 0);
    expect(
      uncovered,
      'the class is declared TOTAL over markdown; a document outside it means the ledger lost a tree',
    ).toEqual([]);
  });
});

/* ── objectui#9142: the repository root is a tree too ─────────────────────── */

describe('objectui#9142 — a root-level markdown file a pull request ADDS', () => {
  /**
   * The document this card is about: a root-level markdown file that exists in
   * no ledger entry, because nobody has written it down yet. `SECURITY.md` is
   * the card's own example and is deliberately NOT in this tree — a planted
   * document that already existed would prove nothing about the next one.
   */
  const PLANTED_ROOT_DOCUMENT = 'SECURITY.md';

  it('is not in the tree — the planted document has to be absent to be a control', () => {
    // If someone adds `SECURITY.md` for real, this fails and the next reader
    // picks a different name rather than silently testing a declared document.
    const tracked = execFileSync('git', ['ls-files', '--', '*.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(tracked).not.toContain(PLANTED_ROOT_DOCUMENT);
  });

  // `FIRES: the planted root document runs the shards, and the step says so`
  // retired with objectstack#25712, with the step it ran (see the header).

  it('names the reader that is waiting on it — the invariant that replaces the list', () => {
    const hits = markdownTestInputsAmong([PLANTED_ROOT_DOCUMENT]);
    expect(hits).toHaveLength(1);
    expect(hits[0].entries).toContain('./*');
    expect(hits[0].readers).toContain('scripts/__tests__/check-doc-links.test.ts');
  });

  it('the per-file spelling CANNOT express it — which is why a new spelling exists', () => {
    // The pre-fix vocabulary, asserted directly: an exact entry matches one
    // path and a `…/**` entry needs a directory above the document. A root
    // document has neither, so no combination of the two covers the NEXT one.
    for (const rootDocument of ['AGENTS.md', 'README.md', 'ROADMAP.md']) {
      expect(matchesEntry(PLANTED_ROOT_DOCUMENT, rootDocument)).toBe(false);
    }
    expect(matchesEntry(PLANTED_ROOT_DOCUMENT, './*')).toBe(true);
  });

  it('⛔ does NOT widen to every markdown file — `./*` is depth 1, markdown only', () => {
    // The fence objectui#9096 set and objectui#9142's triage carried: the
    // deliverable is the documents these tests actually read, ⛔ not a glob.
    // `./*` reaches the root and stops there.
    for (const deeper of ['docs/NOTES.md', 'packages/plugin-grid/NOTES.md', 'a/b/SECURITY.md']) {
      expect(matchesEntry(deeper, './*')).toBe(false);
    }
    for (const notMarkdown of ['SECURITY.txt', 'pnpm-lock.yaml', 'turbo.json']) {
      expect(matchesEntry(notMarkdown, './*')).toBe(false);
    }
  });

  it('the declared population is unchanged — every tracked root document is still an input', () => {
    const rootDocuments = execFileSync('git', ['ls-files', '--', '*.md', '*.mdx'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes('/'))
      .sort();

    // Floor under the floor: an empty enumeration would satisfy the next
    // assertion while proving nothing (objectui#8468).
    expect(rootDocuments.length).toBeGreaterThanOrEqual(8);
    expect(rootDocuments.filter((file) => markdownTestInputsAmong([file]).length === 0)).toEqual([]);
  });

  it('`missingDocuments()` does not red on a class entry — the trap triage named', () => {
    // The ledger reds on a declared path that is not in the tree. `./*` names a
    // rule, not a path, so it must be skipped the way `…/**` already is —
    // otherwise every run of the audit reports a missing document that cannot
    // exist.
    expect(declaredEntries()).toContain('./*');
    expect(missingDocuments()).toEqual([]);
    expect(missingDocuments()).not.toContain('./*');
  });

  it('reports EVERY entry that covers a document, so the class costs no reader', () => {
    // Entries overlap, and the root class makes that structural: `AGENTS.md` is
    // covered by `./*` and by its own exact entry. Reporting the first match
    // only would attribute it to whichever sorted first and drop the rest —
    // `should_run` would be unaffected, the readers named in the log would not.
    const hits = markdownTestInputsAmong(['AGENTS.md']);
    expect(hits).toHaveLength(1);
    expect(hits[0].entries).toEqual(expect.arrayContaining(['./*', 'AGENTS.md']));
    expect(hits[0].readers.length).toBeGreaterThanOrEqual(4);
    // The same overlap outside the root, which predates this card: a package
    // README declared exactly AND inside `packages/**`.
    const nested = markdownTestInputsAmong(['packages/app-shell/README.md']);
    expect(nested[0].entries).toEqual(expect.arrayContaining(['packages/**', 'packages/app-shell/README.md']));
    expect(nested[0].readers).toContain(
      'packages/app-shell/src/views/metadata-admin/previews/readme-flow-canvas-draft.test.ts',
    );
  });
});
