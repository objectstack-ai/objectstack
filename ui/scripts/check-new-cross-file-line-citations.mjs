#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The DIFFERENTIAL cross-file line-address citation gate (objectui#8875).
 *
 *   Run:  node scripts/check-new-cross-file-line-citations.mjs
 *         node scripts/check-new-cross-file-line-citations.mjs --base <ref>
 *         node scripts/check-new-cross-file-line-citations.mjs --strict
 *         node scripts/check-new-cross-file-line-citations.mjs --json
 *
 *   Exit: 0 = no new citation, or new citations while ENFORCEMENT is
 *             `report-only`
 *         1 = new citations under blocking enforcement, OR one of this gate's
 *             own controls failed
 *         2 = PREREQUISITE NOT MET -- the base could not be resolved, so this
 *             run measured nothing. Never a silent zero.
 *
 * ## The ruling this implements, and the one word that decides its shape
 *
 * The maintainer ruled on 2026-09-10, verbatim and untranslated:
 *
 *   跨文件的「某文件第几行」引用， 这种完全没必要吧，是否应该避免
 *
 * The direction taken from it (objectui#8875, comment 5617612419) has five
 * clauses. Clause 2 is this file, and its load-bearing word is DIFFERENTIAL:
 *
 *   > 相对 base 新增的跨文件 `path:line` 形引用（卡面测过的四种语法 + 无文件名
 *   > 的续写地址）即红；存量 540 条不作为门的分母，⛔ 不搭车清扫。指向重生成
 *   > 文件（`dist/*.d.ts`）的记 unresolvable，不计。
 *
 * ⛔ AN ABSOLUTE COUNT WAS EXPLICITLY REFUSED, and not on taste. It was refused
 * on a measurement: PR #8887's line shifts flipped one citation from `drifted`
 * to `resolves` BY ACCIDENT, moving the tree-wide false count 540 -> 539, and
 * the executing seat had to name that in its own pull request body as an
 * UNEARNED GREEN that belonged to nobody. A gate reading an absolute number
 * scores that as progress. So this gate never reads a total: it reads what THIS
 * BRANCH ADDED, and the existing citations are ⛔ not its denominator and ⛔ not
 * swept in by it.
 *
 * ## What is NEW, and why identity is content-shaped rather than positional
 *
 * A citation is identified, WITHIN ONE CITING FILE, by
 *
 *     syntax | the written path | the cited line number
 *
 * and compared as a MULTISET between the base blob and the head text of that
 * same file. The citing file's OWN line number is deliberately not part of the
 * identity, and neither is the prose around it:
 *
 *   - if it were, re-indenting a file, re-wrapping a paragraph or adding an
 *     import above would report every citation below as newly added. That is
 *     the positional fragility this whole card is about, rebuilt inside the
 *     instrument meant to measure it.
 *   - a citation whose CITED line number changes (`:112` edited to `:113`) IS
 *     new, and that is correct rather than a side effect: clause 4 repairs an
 *     existing address by converting it to a content anchor, never by moving
 *     the number to a different number.
 *
 * Renames are followed (`git diff -M`), so moving a file does not report its
 * citations as freshly written.
 *
 * ## The population, inherited rather than re-implemented
 *
 * The scanner, the five syntaxes, the released-CHANGELOG carve-out, the
 * same-file exclusion and the four verdicts all come from
 * `cross-file-line-citation-census.mjs` BY IMPORT. This repository treats a
 * second copy of a reader as a defect: two readers over one population is how
 * the two answers start disagreeing, and the census is already the measured
 * one. This file adds exactly one thing to it -- the base comparison.
 *
 * ⇒ everything the census excludes, this gate excludes:
 *
 *   - SAME-FILE citations. objectui#8047's carve-out reasoning ("a human reads
 *     them beside the code they annotate") still holds there, and the ruling
 *     says so in as many words: 同文件行号照 objectui#8047 的既有豁免.
 *   - RELEASED CHANGELOG SECTIONS. A changelog entry is a dated record of what
 *     was true at that release; clause 4 says they are ⛔ never re-addressed.
 *   - citations reaching a TEST NAME, which objectui#8047's ESLint rule owns at
 *     `error`. Counted and printed separately so an overlap is visible rather
 *     than silent.
 *
 * ## `unresolvable` is a THIRD answer, and it must never collapse into `false`
 *
 * The ruling: 指向重生成文件（`dist/*.d.ts`）的记 unresolvable，不计. A citation
 * into a build artifact is untracked and regenerated -- no instrument can ever
 * decide it, so calling it false would be an assertion, and calling it true
 * would be worse. The census reports that class under `no-such-file` and keeps
 * it out of its false count; this gate keeps the same three-way split and
 * asserts it in `SYNTHETIC_CASES` below, because an earlier census reported it
 * correctly and a regression here would be invisible.
 *
 * ⚠️ `unresolvable` is a VERDICT, not an exemption. A newly written citation is
 * a finding whatever it resolves to -- the convention is that the address is
 * not written, not that it is written accurately. The verdict column says what
 * a reader would find if they followed it.
 *
 * ## Enforcement: report-only first, and what flips it
 *
 * The ruling: report-only 起步，零新增后翻阻断. `ENFORCEMENT` below is the whole
 * switch, and flipping it is a one-line change plus the pin in this gate's test
 * that reads it. It ships `report-only` so that pull requests already in flight
 * are not failed by a rule whose convention text (clause 1, `AGENTS.md`) has
 * not landed yet -- that document is a governed surface and is a separate,
 * human-merged pull request.
 *
 * ⛔ Report-only does NOT mean "cannot fail". A control failure exits 1 in
 * either mode: a differential gate that reports zero because its differ is
 * broken is indistinguishable from a clean branch, which is the exact failure
 * this card exists to name one level up. Hence `SYNTHETIC_CASES`.
 *
 * ## The controls, printed on every run, fatal in both modes
 *
 * The firing control cannot be a citation that already exists in the tree: a
 * differential gate is blind to those by construction, which is the point of
 * it. It is therefore SYNTHETIC -- a base text and a head text handed to the
 * same differ the real run uses. Four cases, each pinning a different way this
 * gate could be wrong:
 *
 *   FIRES         a cross-file address added to the head text is reported.
 *   DOES NOT FIRE the same citation present in both, with the citing prose
 *                 moved down the file, is NOT reported. This is the
 *                 anti-absolute-count control and the reason the gate exists in
 *                 this shape.
 *   UNRESOLVABLE  an added citation into `packages/types/dist/*.d.ts` is
 *                 reported NEW with verdict `unresolvable`, never `false`.
 *   SAME-FILE     an added citation into the citing file itself is not in the
 *                 population at all.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';

import {
  FALSE_VERDICTS,
  SELF_FILES,
  UNJUDGED_VERDICTS,
  anchorsFor,
  judge,
  scanFile,
} from './cross-file-line-citation-census.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { uiRoot } from './ui-root.mjs';

/**
 * `report-only` | `blocking`. THE flip, and the only one.
 *
 * ⚠️ Changing this value changes whether a pull request can be merged, so it is
 * a decision and not a tidy-up. `check-new-cross-file-line-citations.test.ts`
 * reads it and states the landed state in its own assertion, so the flip cannot
 * happen without the pin moving with it, and the row in
 * `content/docs/guide/ci-cd-pipeline.md` says report-only in prose.
 *
 * WHAT FLIPS IT (objectui#8875, ruling clause 2): once this gate has read ZERO
 * new citations across the in-flight population -- i.e. it is no longer
 * reporting findings that belong to branches written before the convention --
 * and clause 1's convention text has landed in `AGENTS.md`, so an author who is
 * failed by it has a document to be failed against.
 */
export const ENFORCEMENT = 'report-only';

/**
 * The instrument may not count itself. ⛔ Re-exported from the census, ⛔ never
 * re-declared: one population, one carve-out list. A second copy drifts, and a
 * file carved out of one reader while counted by the other makes the two
 * disagree with nothing anywhere reporting it.
 */
export { SELF_FILES };

/** Extensions this gate reads, kept in step with the census's own whitelist. */
const SCANNED_EXT = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml', 'txt',
  'css', 'scss', 'html', 'vue', 'svelte', 'sh', 'py', 'toml',
]);

/** Generated or vendored text nothing authors by hand. */
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'skills-lock.json']);

export const EXIT_CODES = { ok: 0, newCitations: 1, controlFailed: 1, couldNotRun: 2 };

/**
 * The identity of one citation inside one citing file. ⛔ Never includes the
 * citing line number -- see the header on why positional identity would rebuild
 * the defect inside the instrument.
 */
export function citationKey(hit) {
  return `${hit.syntax}|${hit.citedWritten}|${hit.citedLine}`;
}

/**
 * The multiset difference for ONE file: the hits present in `headText` beyond
 * those already present in `baseText`.
 *
 * Pure, so the synthetic controls and the real run go through the same code.
 * A file absent from the base (added, untracked, renamed from nothing) is
 * handed `''` and every hit in it is new.
 *
 * `of` picks WHICH of `scanFile`'s two populations is differenced -- the
 * citations (`hits`, the default) or the addresses the citing file DECLARES as
 * fixture data (`declared`, objectui#9865). ⛔ One differ for both, ⛔ never a
 * second copy: the census's carve-out list is shared with this gate for exactly
 * that reason, and a declaration read by one reader and not the other would
 * make the two answers disagree with nothing anywhere reporting it.
 */
export function newCitationsIn({ relPath, baseText, headText, of = 'hits' }) {
  const head = scanFile(relPath, headText);
  const base = scanFile(relPath, baseText ?? '');

  const budget = new Map();
  for (const hit of base[of]) {
    const key = citationKey(hit);
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }

  const added = [];
  for (const hit of head[of]) {
    const key = citationKey(hit);
    const left = budget.get(key) ?? 0;
    if (left > 0) {
      budget.set(key, left - 1);
      continue;
    }
    added.push({ ...hit, anchors: anchorsFor(head.lines, hit.line - 1, hit.citedWritten) });
  }
  return added;
}

/**
 * The verdict a reader would reach by following one citation, plus the class it
 * is reported under. Three classes, and the third is the one that must never
 * collapse into the second.
 */
export function classify(verdict) {
  if (verdict === 'resolves') return 'resolving';
  if (FALSE_VERDICTS.has(verdict)) return 'false';
  if (UNJUDGED_VERDICTS.has(verdict)) return 'unresolvable';
  return 'unresolvable';
}

/**
 * The four synthetic control cases. Each is a base text and a head text for one
 * notional citing file; the differ that judges them is the one the real run
 * uses, so a differ that stopped working fails here before it reports a clean
 * branch.
 */
export const SYNTHETIC_CASES = [
  {
    id: 'fires',
    why: 'a cross-file address added by the head text must be reported',
    relPath: 'packages/example/src/notes.ts',
    baseText: '// the action vocabulary is declared by `ActionDef`\n',
    headText:
      '// the action vocabulary is declared at packages/core/src/actions/ActionRunner.ts:112\n',
    want: (added) => added.length === 1 && added[0].citedLine === 112,
    describe: (added) => added.map((a) => `${a.citedWritten}:${a.citedLine}`).join(', ') || '(none)',
  },
  {
    id: 'does-not-fire-on-a-moved-citing-line',
    why:
      'the same citation, with its citing prose pushed down the file, is NOT new -- this is the ' +
      'control that separates a differential gate from the absolute count the ruling refused',
    relPath: 'packages/example/src/notes.ts',
    baseText: '// see packages/core/src/actions/ActionRunner.ts:112\n',
    headText:
      "import { x } from './x';\nimport { y } from './y';\n\n// see packages/core/src/actions/ActionRunner.ts:112\n",
    want: (added) => added.length === 0,
    describe: (added) => added.map((a) => `${a.citedWritten}:${a.citedLine}`).join(', ') || '(none)',
  },
  {
    id: 'unresolvable-is-not-false',
    why:
      'a citation into a regenerated build artifact is reported NEW with verdict `unresolvable`; ' +
      'the ruling records that class and ⛔ never counts it false',
    relPath: 'packages/example/src/notes.ts',
    baseText: '',
    headText: '// the emitted shape is at packages/types/dist/overlay.d.ts:334\n',
    want: (added) => added.length === 1 && added[0].citedWritten.includes('dist/'),
    describe: (added) => added.map((a) => `${a.citedWritten}:${a.citedLine}`).join(', ') || '(none)',
  },
  {
    id: 'a-declared-fixture-address-is-not-a-finding',
    why:
      'objectui#9865: an address the citing file DECLARES as fixture data is carved out per ADDRESS '
      + 'by the shared scanner, so this gate ⛔ cannot report it while the census excludes it',
    relPath: 'packages/example/src/notes.ts',
    baseText: '',
    headText:
      '// fixture-address: control input, the reader under test is what reads this address\n'
      + '// the action vocabulary is declared at packages/core/src/actions/ActionRunner.ts:112\n',
    want: (added) => added.length === 0,
    describe: (added) => added.map((a) => `${a.citedWritten}:${a.citedLine}`).join(', ') || '(none)',
  },
  {
    id: 'a-declaration-without-a-reason-still-reports',
    why:
      'a bare marker is a mute button, ⛔ not a declaration -- without this leg the case above '
      + 'would pass on a gate that had stopped reading the reason at all',
    relPath: 'packages/example/src/notes.ts',
    baseText: '',
    headText:
      '// fixture-address:\n'
      + '// the action vocabulary is declared at packages/core/src/actions/ActionRunner.ts:112\n',
    want: (added) => added.length === 1 && added[0].citedLine === 112,
    describe: (added) => added.map((a) => `${a.citedWritten}:${a.citedLine}`).join(', ') || '(none)',
  },
  {
    id: 'same-file-is-not-in-the-population',
    why:
      "a citation into the citing file itself keeps objectui#8047's carve-out and is out of scope",
    relPath: 'packages/example/src/notes.ts',
    baseText: '',
    headText: '// see notes.ts:12 for the other half\n',
    want: (added, verdicts) => added.length === 1 && verdicts[0] === 'same-file',
    describe: (added, verdicts) => verdicts.join(', ') || '(none)',
  },
];

/**
 * The judge the controls run under: HERMETIC, over an index that contains only
 * the cases' own notional file.
 *
 * ⚠️ Deliberately not the live tree. A control that resolves against
 * `git ls-files` is a control that rots when the tree moves, and it answers a
 * different question in a scratch repository than it does here — which would
 * make this gate report "instrument broken" wherever it is not run from its own
 * checkout. These four cases are about the DIFFER and the CLASSIFIER, so they
 * are judged against a fixed index and depend on nothing outside this file.
 */
export function hermeticJudge(hit) {
  const index = new Map([['notes.ts', ['packages/example/src/notes.ts']]]);
  return judge(hit, '/nonexistent-control-root', index, new Map());
}

/**
 * Runs every synthetic case through the real differ. `judgeFor` is injectable so
 * a test can show that a judge which lies fails the controls rather than passing
 * them; the real run uses the hermetic one.
 */
export function evaluateSyntheticCases(judgeFor = hermeticJudge) {
  return SYNTHETIC_CASES.map((c) => {
    const added = newCitationsIn({ relPath: c.relPath, baseText: c.baseText, headText: c.headText });
    const verdicts = added.map((hit) => judgeFor(hit).verdict);
    let ok = false;
    let detail = '';
    try {
      ok = c.want(added, verdicts) === true;
      detail = c.describe(added, verdicts);
    } catch (error) {
      ok = false;
      detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { id: c.id, why: c.why, ok, detail };
  });
}

/** Every tracked path at HEAD, as git sees them. */
function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * The base this branch is measured against, and the merge base with it.
 *
 * ⚠️ Resolution FAILS LOUDLY. A gate that cannot compute its base has measured
 * nothing, and "nothing found" is the one answer it must never print
 * (objectstack#4928 named the direction: a swallowed diff failure is
 * indistinguishable from a clean tree).
 */
export function resolveBase(root, argv, env) {
  const flagAt = argv.indexOf('--base');
  const explicit =
    flagAt >= 0 && argv[flagAt + 1]
      ? argv[flagAt + 1]
      : env.CITATION_GATE_BASE ||
        (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : '') ||
        'origin/main';
  try {
    const mergeBase = execFileSync('git', ['merge-base', explicit, 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { ref: explicit, mergeBase, error: null };
  } catch (error) {
    return {
      ref: explicit,
      mergeBase: null,
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
    };
  }
}

/**
 * `head path -> base path` for everything this branch touched, plus the set of
 * paths with no base blob at all.
 *
 * The diff is taken against the WORKING TREE, not `HEAD`: this gate is most
 * useful before a commit exists, and a reading that ignored uncommitted edits
 * would tell an author their new citation is fine right up until CI disagrees.
 * Untracked files are collected separately for the same reason.
 *
 * `--relative`: paths come back relative to `root` (the objectui tree, from
 * `scripts/ui-root.mjs`), not to the git toplevel. Standalone the two are the
 * same directory and the flag changes nothing; inside the objectstack monorepo
 * (objectui as `ui/`) it confines the reading to this tree and keeps every
 * path joinable with `root`, which is also why `blobAt` spells `rev:./path`.
 */
export function changedPaths(root, mergeBase) {
  const status = execFileSync(
    'git',
    ['diff', '--name-status', '-M', '--relative', '--diff-filter=ACMRT', mergeBase, '--'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const map = new Map();
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0];
    if (code.startsWith('R') && parts.length >= 3) map.set(parts[2], parts[1]);
    else if (code.startsWith('A')) map.set(parts[1], null);
    else map.set(parts[1], parts[1]);
  }
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  for (const path of untracked) if (!map.has(path)) map.set(path, null);
  return map;
}

/** The blob at `rev:./path` (`path` relative to `root`, the cwd), or `null` when the path did not exist there. */
function blobAt(root, rev, path) {
  if (path === null) return null;
  try {
    return execFileSync('git', ['show', `${rev}:./${path}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function scannable(relPath) {
  const ext = relPath.includes('.') ? relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!SCANNED_EXT.has(ext)) return false;
  if (SKIP_FILES.has(basename(relPath))) return false;
  if (SELF_FILES.has(relPath)) return false;
  return true;
}

/**
 * The tree this gate reads. Its subject is the REPOSITORY AT THE CWD -- `git
 * rev-parse --show-toplevel`, so a run from any subdirectory works and the
 * self-test can drive the gate against a scratch repository -- narrowed to the
 * objectui tree (`scripts/ui-root.mjs`) when that tree lies inside it.
 * Standalone the two coincide. Under the objectstack monorepo (objectui as
 * `ui/`) the toplevel is the objectstack root and the narrowing is what
 * `--relative` in `changedPaths` and `rev:./path` in `blobAt` rest on. In a
 * scratch repository the objectui tree is OUTSIDE it, so the toplevel is read.
 */
export function gateRoot(cwd = process.cwd()) {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  const ui = uiRoot();
  const below = relative(top, ui);
  const inside = below === '' || (!below.startsWith('..') && !isAbsolute(below));
  return inside ? ui : top;
}

function main(argv, env = process.env) {
  const root = gateRoot();
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const asJson = argv.includes('--json');
  const blocking = argv.includes('--strict') || ENFORCEMENT === 'blocking';

  const base = resolveBase(root, argv, env);
  if (base.mergeBase === null) {
    console.error(
      `PREREQUISITE NOT MET -- no merge base between \`${base.ref}\` and HEAD (${base.error}).`,
    );
    console.error(
      '  This run measured NOTHING. It is not a green, and it is not a red about any citation.',
    );
    console.error(
      '  In CI the checkout needs `fetch-depth: 0`; locally, `git fetch origin main` first, or',
    );
    console.error('  name a base explicitly with `--base <ref>`.');
    return EXIT_CODES.couldNotRun;
  }

  const index = new Map();
  for (const path of trackedFiles(root)) {
    const name = basename(path);
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(path);
  }
  const fileCache = new Map();
  const judgeFor = (hit) => judge(hit, root, index, fileCache);

  const controls = evaluateSyntheticCases();

  const touched = changedPaths(root, base.mergeBase);
  const scanned = [];
  const added = [];
  const declared = [];
  for (const [headPath, basePath] of touched) {
    if (!scannable(headPath)) continue;
    if (!existsSync(join(root, headPath))) continue;
    let headText;
    try {
      headText = readFileSync(join(root, headPath), 'utf8');
    } catch {
      continue;
    }
    scanned.push(headPath);
    const baseText = blobAt(root, base.mergeBase, basePath);
    for (const hit of newCitationsIn({ relPath: headPath, baseText, headText })) {
      added.push({ ...hit, ...judgeFor(hit) });
    }
    // ⛔ Counted and printed, never silently dropped: a branch that ADDS a
    // declaration is the one moment a reader can still object to it, and a
    // carve-out whose size this gate does not report is indistinguishable from
    // a scanner that cannot see the file.
    for (const hit of newCitationsIn({ relPath: headPath, baseText, headText, of: 'declared' })) {
      declared.push(hit);
    }
  }

  const sameFile = added.filter((row) => row.verdict === 'same-file');
  const population = added.filter((row) => row.verdict !== 'same-file');
  const inTestName = population.filter((row) => row.inTestName);
  const findings = population.filter((row) => !row.inTestName);
  const byClass = { false: 0, resolving: 0, unresolvable: 0 };
  for (const row of findings) byClass[classify(row.verdict)] += 1;

  const failedControls = controls.filter((c) => !c.ok);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          head,
          base: base.ref,
          mergeBase: base.mergeBase,
          enforcement: blocking ? 'blocking' : ENFORCEMENT,
          scannedFiles: scanned.length,
          newCitations: findings.length,
          byClass,
          excludedSameFile: sameFile.length,
          excludedTestName: inTestName.length,
          excludedDeclaredFixture: declared.length,
          declaredRows: declared.map((row) => ({
            file: row.file,
            line: row.line,
            cited: `${row.citedWritten}:${row.citedLine}`,
            declaredReason: row.declaredReason,
            declaredOnLine: row.declaredOnLine,
          })),
          controls,
          rows: findings.map((row) => ({
            file: row.file,
            line: row.line,
            syntax: row.syntax,
            cited: `${row.citedWritten}:${row.citedLine}`,
            verdict: row.verdict,
            class: classify(row.verdict),
            text: row.text,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `# New cross-file line-address citations -- objectui#8875 clause 2 (HEAD ${head})\n`,
    );
    console.log(`Base            : ${base.ref}`);
    console.log(`Merge base      : ${base.mergeBase}`);
    console.log(`Enforcement     : ${blocking ? 'blocking' : ENFORCEMENT}`);
    console.log(`Files compared  : ${scanned.length} (this branch's own diff, not the tree)\n`);

    console.log('## Controls -- synthetic, and fatal in BOTH modes\n');
    for (const control of controls) {
      console.log(`${control.ok ? 'PASS' : 'FAIL'}  ${control.id}: ${control.detail}`);
      console.log(`      why: ${control.why}`);
    }
    console.log('');

    console.log('## The number\n');
    console.log(`Cross-file line-address citations ADDED by this branch : ${findings.length}`);
    console.log(`  of which FALSE against today's tree                  : ${byClass.false}`);
    console.log(`  of which resolve to their content                    : ${byClass.resolving}`);
    console.log(`  of which are UNRESOLVABLE (regenerated / ambiguous)   : ${byClass.unresolvable}`);
    console.log(`Excluded, added same-file citations (objectui#8047)     : ${sameFile.length}`);
    console.log(`Excluded, added citations reaching a test name          : ${inTestName.length}`);
    console.log(`Excluded, added addresses DECLARED as fixture data      : ${declared.length}`);
    for (const row of declared) {
      console.log(`  ${row.file}:${row.line}  ${row.citedWritten}:${row.citedLine}`);
      console.log(`      declared at :${row.declaredOnLine} -- ${row.declaredReason}`);
    }
    console.log(
      '\n⛔ The existing citations in this tree are NOT this gate\'s denominator and are ⛔ not',
    );
    console.log(
      '   swept in by it: shifting an already-false address by a hunk delta moves a wrong',
    );
    console.log('   pointer to a differently wrong place while making the diff look diligent.\n');

    if (findings.length > 0) {
      console.log('## What this branch added\n');
      for (const row of findings) {
        console.log(
          `  ${row.file}:${row.line}  adds  ${row.citedWritten}:${row.citedLine}  ` +
            `[${row.syntax}] -> ${classify(row.verdict)} (${row.verdict})`,
        );
        console.log(`      ${row.text}`);
      }
      console.log('');
      console.log('Cite the thing by CONTENT instead -- the symbol name, the anchor text, the');
      console.log('test name. A cross-file line address is not read beside the code it annotates,');
      console.log('nothing puts the cited line in front of the reader, and nothing tells them it');
      console.log('moved (objectui#7853, objectui#8875).\n');
    }
  }

  if (failedControls.length > 0) {
    console.error(
      `VERDICT new-cross-file-line-citations: ${failedControls.length} CONTROL(S) FAILED -- ` +
        'this run is NOT a reading -> exit 1',
    );
    return EXIT_CODES.controlFailed;
  }
  if (findings.length > 0 && blocking) {
    console.error(
      `VERDICT new-cross-file-line-citations: ${findings.length} new citation(s), enforcement ` +
        'blocking -> exit 1',
    );
    return EXIT_CODES.newCitations;
  }
  // Every VERDICT line goes to stderr, so `--json` leaves stdout parseable and a
  // caller never has to choose between reading the machine answer and reading
  // the one line that says which of the exit codes this was.
  console.error(
    `VERDICT new-cross-file-line-citations: ${findings.length} new citation(s), enforcement ` +
      `${blocking ? 'blocking' : ENFORCEMENT} -> exit 0`,
  );
  return EXIT_CODES.ok;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
