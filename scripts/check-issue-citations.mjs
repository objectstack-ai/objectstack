#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-issue-citations (#17512) -- the repo's issue-NUMBER citations, resolved
 * against the board they name.
 *
 *   node scripts/check-issue-citations.mjs                 # judge what this change ADDS
 *   node scripts/check-issue-citations.mjs --base <ref>    # ...relative to <ref>
 *   node scripts/check-issue-citations.mjs --census        # the whole declared surface
 *   node scripts/check-issue-citations.mjs --list          # extraction only, no network
 *   node scripts/check-issue-citations.mjs --json          # machine-readable
 *   node scripts/check-issue-citations.mjs --self-test     # verify the checker itself
 *
 * ## The measured failure (#17512)
 *
 * The triage seat answering a `pm:retriage` found a card whose stated release
 * condition named an issue that does not exist: #16099 was recorded as waiting
 * on 「#16785's amendment landing」, a condition that can never be met. Four more
 * instances were measured the same day, three of them on `Blocked-by:` lines --
 * which at least REACH a sweep, `scripts/pm/check-half-states.mjs`'s H19, which
 * reports them as UNJUDGED because an unresolvable blocker is indistinguishable
 * from a live one. The other two, #16785 and #16685, were cited from a SOURCE
 * DOCBLOCK and from a PUBLISHED RELEASE PAGE, and nothing swept either.
 *
 * ## What the surface actually turned out to be
 *
 * Re-measured on `2d3d1c969` (2026-09-14) with the board enumerated in full:
 *
 *   18,219  the repository's allocation frontier -- the highest number minted
 *   15,834  numbers that resolve
 *    2,385  holes in [1, frontier] -- 13.1% of every number ever minted here
 *
 * and, through the citation grammar below, over the two surfaces this gate
 * declares:
 *
 *                       citations  cross-repo  non-citation  resolves  UNRESOLVABLE
 *   release pages           1,225          72             0     1,050   103 sites / 71 distinct
 *   package src docblocks  32,941       1,240           405    28,617 2,679 sites / 436 distinct
 *
 * ⭐ So the card's five instances are the visible edge of ~2,782 sites. That
 * number is what decides this gate's SHAPE, and it decides it twice over:
 *
 *   1. A gate that reds on all of them is the permanently-red gate this repo
 *      retired -- the same reason `check-scripts-symbol-anchors` declines its
 *      untracked line anchors rather than folding 96 findings in.
 *   2. ⛔ The predicate is NOT a function of this tree. #16783, #16786 and
 *      #16787 were measured RESOLVING on 2026-09-10 (they are the card's own
 *      control, the neighbours proving #16785 was a hole in a dense sequence)
 *      and measured 404 on 2026-09-14. A still tree goes red because somebody
 *      else deleted an issue. A blocking, tree-wide verdict would therefore
 *      fail PRs for a change their author did not make and cannot repair.
 *
 * ⇒ The default mode is DIFF-SCOPED: only the citations a change ADDS are
 * judged. That is the half of the class an author owns, it is small, it cannot
 * red on a still tree, and it stops the debt growing. The 2,782 standing sites
 * are enumerable with `--census` and are NOT this gate's verdict.
 *
 * ## ⛔ Four causes of a 404, never collapsed
 *
 * A 404 has at least four causes and the card refuses to let them merge, because
 * collapsing them reports `objectstack-ai/cloud` references as phantom numbers:
 *
 *   cross-repo-unjudged   the citation NAMES another repo (`owner/repo#N` or
 *                         `repo#N`). ⛔ Never resolved and never a finding: one
 *                         credential reads one board, exactly the call H19 makes.
 *   never-issued          N is beyond this repo's allocation frontier, so the
 *                         number was never minted. Decided from the frontier.
 *   transferred           the number was minted and the WEB endpoint still
 *                         redirects -- a transferred issue keeps a redirect at
 *                         its old URL, the API does not. Needs `--probe-cause`.
 *   deleted               minted, absent from the board, and the web endpoint
 *                         404s too -- the residual class, named as residual.
 *
 * Without `--probe-cause` the last two do not separate and the finding carries
 * `allocated-but-absent`, which is a REFUSAL to guess, not a third cause.
 *
 * ⚠️ NOT MEASURED on this tree: the `transferred` arm has no positive specimen
 * here. Every unresolvable instance re-probed on 2026-09-14 (#16785, #16783,
 * #14366 and twelve sampled at random from the census) answered 404 on BOTH
 * endpoints, so the arm is exercised only by `--self-test`'s stub. ⛔ Do not
 * read this gate's silence as evidence that no citation here was transferred.
 *
 * ## The grammar, and why it is narrower than `#\d+`
 *
 * A naive `#\d+` sweep drowns: the same instrument over `CHANGELOG.md` alone
 * returns 27,978 citations, which is why the changelogs are a DEFERRED surface
 * below rather than an omission. Three narrowings, each measured:
 *
 *   - Two digits minimum. All 133 one-digit `#N` tokens in the declared
 *     surfaces are ordinals, not citations (`Prime Directive #9`, `acceptance
 *     #5`, `ADR §3.10 #2`) -- zero of them name an issue.
 *   - Six digits maximum, and zero such tokens exist in the declared surfaces,
 *     which is what keeps a six-digit hex colour out of the finding set.
 *   - `NON_CITATION_HEADS`: `Directive #14`, `batch #127`, `re-charter #26` and
 *     their siblings are ordinals in a numbering system that is not the board's.
 *     405 sites in package source, measured.
 *
 * Source files are read through `scripts/symbol-anchors.mjs#commentProse`, so a
 * gate's own fixtures and any `#N` inside a string literal are blanked -- the
 * projection keeps the line numbers, so a finding names the line the author
 * opens.
 *
 * ## ⚠️ Siblings, not duplicates -- ⛔ do not fold
 *
 * #17242 (183 `packages/spec/src/**` PATH citations naming no tracked file) and
 * #15809 (96 of 128 LINE citations in `scripts/**` gate headers) are the same
 * defect shape with a different citation kind and a different extraction; the
 * card is explicit that folding them fails the fix. `scripts/**` is therefore a
 * DEFERRED surface here even though it carries 1,408 unresolvable ISSUE-number
 * sites of its own: that subtree belongs to #15809's lane until a card says
 * otherwise, and this gate declares the number rather than quietly sweeping it.
 *
 * ## Wiring -- read this before assuming the gate runs
 *
 * ⛔ NO WORKFLOW INVOKES THIS FILE. `.github/workflows/**` was out of the
 * dispatch's file surface for #17512, and every other gate in this tree is
 * named by a workflow step. So this gate is presently a tool a seat runs, not a
 * standing caller, and `scripts/pm/check-half-states.mjs`'s own header states
 * what that is worth: 「an alarm added to a script nobody runs is still
 * silence」. The two homes it wants, and they are different lanes:
 *
 *   diff-scoped verdict  -> `lint.yml`'s `Lint & Repo Gates` job, which already
 *                           carries a `GITHUB_TOKEN` and runs per PR.
 *   `--census`           -> the patrol lane (`half-state-patrol.yml`), which is
 *                           report-only and scheduled -- the right posture for a
 *                           reading whose verdict a third party can change.
 *
 * Neither is installed here. That is a DECLARED gap, recorded in the PR body and
 * the report, not an oversight.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv } from './git-env.mjs';
import { globToRegExp } from './glob-match.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { commentProse } from './symbol-anchors.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan } from './pm/check-half-states.mjs';

/**
 * POPULATION DECLARATION -- what `scripts/pm/dispatch-gates.mjs` is told this
 * gate reads. Provenance ONLY: nothing in this file reads this array; the
 * surfaces below are what the sweep walks, and `--self-test` pins the two
 * against each other in both directions.
 */
export const ROOT_DIR_WATCH_HINTS = ['content/docs/releases/**', 'packages/**'];

/* ─────────────────────────── the scope contract ─────────────────────────── */

/**
 * ⭐ THE SCOPE CONTRACT. The card's ruling is that the hard part is SCOPE, not
 * resolution, and that an unwritten scope is the defect: 「把你的取值面写下来当
 * 契约,不要让它含混」. Each row says what it reads, how it is projected, and
 * WHY it is in -- a row with no measured damage behind it is a row that grew by
 * habit.
 */
export const CITATION_SURFACES = Object.freeze([
  Object.freeze({
    id: 'release-pages',
    glob: 'content/docs/releases/**/*.mdx',
    projection: 'whole-file',
    why: 'The published release pages. Instance #16685 is cited from one of them '
      + '(a v17.4 aggregate note) and nothing swept it; a published page is the '
      + 'most durable reader-facing surface this repo has.',
  }),
  Object.freeze({
    id: 'package-docblocks',
    glob: 'packages/**/src/**/*.ts',
    projection: 'comment-prose',
    why: 'Source docblocks. Instance #16785 was cited from `dataset-compiler.ts`\'s '
      + 'scope note, the citation that recorded #16099 as waiting on a condition '
      + 'that can never be met.',
  }),
  Object.freeze({
    id: 'package-docblocks-tsx',
    glob: 'packages/**/src/**/*.tsx',
    projection: 'comment-prose',
    why: 'Same surface, the extension the glob above cannot spell. Split rather '
      + 'than widened so a reader can see both are deliberate.',
  }),
]);

/**
 * Surfaces that carry issue citations and are deliberately OUT, each with the
 * reading that put it out. ⛔ A deferred surface is a decision, not an
 * omission: an unlisted surface is indistinguishable from one nobody thought
 * of, which is the failure this table exists to prevent.
 */
export const DEFERRED_SURFACES = Object.freeze([
  Object.freeze({
    glob: '**/CHANGELOG.md',
    sites: 1323,
    why: 'Generated release prose. 27,978 citations, and a changelog entry is a '
      + 'HISTORICAL record of what a landing said -- repairing one rewrites '
      + 'history. This is the surface the card means by 「会被 changelog 引用淹没」.',
  }),
  Object.freeze({
    glob: 'scripts/**',
    sites: 1408,
    why: '#15809\'s lane. ⛔ Not folded: the card is explicit that folding the '
      + 'sibling cards fails the fix.',
  }),
  Object.freeze({
    glob: 'docs/adr/**',
    sites: 113,
    why: 'Governed surface (Prime Directive #14) with its own anchor corpus '
      + '(`check-adr-symbol-anchors`). A citation gate that reds an ADR forces a '
      + 'governed-surface PR for a number somebody else deleted.',
  }),
  Object.freeze({
    glob: '.changeset/**',
    sites: 55,
    why: 'Consumed and deleted at release. A finding whose carrier disappears on '
      + 'the next version bump is a finding nobody can act on.',
  }),
  Object.freeze({
    globs: Object.freeze(['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'packages/**/*.spec.ts', 'packages/**/*.spec.tsx', 'packages/**/__tests__/**']),
    sites: 2592,
    why: 'Test docblocks. Same shape as the source ones and a candidate for the '
      + 'next widening, held back so the first installation of this gate is '
      + 'judged on the surfaces the card actually measured damage on. ⭐ This row '
      + 'OVERLAPS the declared `packages/**/src/**/*.ts` glob, which is why the '
      + 'deferred table is applied as an EXCLUSION rather than kept as prose: a '
      + 'deferred surface nothing enforces is a surface that is swept anyway.',
  }),
]);

/** Every deferred glob, flattened — the exclusion `surfaceFor` applies. */
export const DEFERRED_GLOBS = Object.freeze(DEFERRED_SURFACES.flatMap((s) => (s.globs ? [...s.globs] : [s.glob])));

/** The census this gate was written against. ⛔ Readings, not a budget. */
export const CENSUS_17512 = Object.freeze({
  measuredOn: '2d3d1c96972ceeac98aa005c8a88706d7a12c116',
  measuredAt: '2026-09-14',
  allocationFrontier: 18219,
  resolvableNumbers: 15834,
  holes: 2385,
  holeRate: '13.1%',
  unresolvableSites: Object.freeze({ 'release-pages': 103, 'package-docblocks': 2679 }),
  unresolvableDistinct: Object.freeze({ 'release-pages': 71, 'package-docblocks': 436 }),
  /* The card's own control, and the reason a tree-wide verdict is refused: three
   * of the four neighbours it measured RESOLVING on 2026-09-10 answer 404 four
   * days later. */
  neighbourControl: Object.freeze({
    measuredResolvingOn: '2026-09-10',
    reMeasuredOn: '2026-09-14',
    resolving: Object.freeze([16784]),
    goneSince: Object.freeze([16783, 16786, 16787]),
  }),
});

/* ───────────────────────────── the grammar ──────────────────────────────── */

/** The smallest and largest citation this grammar admits. See the header. */
export const CITATION_MIN_DIGITS = 2;
export const CITATION_MAX_DIGITS = 6;

/**
 * One citation. The leading group is CONTEXT (consumed so `a/b#12` and a bare
 * `#12` cannot both match the same characters), group 2 is the optional
 * repository qualifier and group 3 is the number.
 */
export const CITATION_RE = new RegExp(
  '(^|[^\\w#/-])(?:([A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?)#|#)'
  + `(\\d{${CITATION_MIN_DIGITS},${CITATION_MAX_DIGITS}})(?![\\w-])`,
  'g',
);

/**
 * Numbering systems that are NOT the board's, matched against the text that
 * ENDS immediately before the `#`. Every row is a measured population on this
 * tree, not a hypothetical.
 */
export const NON_CITATION_HEADS = Object.freeze([
  Object.freeze({ re: /(?:prime\s+)?directive\s*$/i, why: 'AGENTS.md Prime Directive ordinals' }),
  Object.freeze({ re: /(?:^|[^a-z])pd\s*$/i, why: 'the abbreviated Prime Directive spelling' }),
  Object.freeze({ re: /(?:decision\s+)?batch\s*$/i, why: 'maintainer decision-batch ordinals' }),
  Object.freeze({ re: /re-charter\s*$/i, why: 're-charter round ordinals' }),
  Object.freeze({ re: /acceptance\s*$/i, why: "an issue's own acceptance-criterion ordinals" }),
  Object.freeze({ re: /clause\s*$/i, why: 'clause ordinals' }),
  Object.freeze({ re: /option\s*$/i, why: 'option ordinals inside a ruling' }),
  Object.freeze({ re: /§\s*[\d.]*\s*$/, why: 'a section ordinal' }),
]);

/** Which of `NON_CITATION_HEADS` excuses this match, or `null`. */
export function nonCitationHead(before) {
  for (const row of NON_CITATION_HEADS) if (row.re.test(before)) return row;
  return null;
}

/**
 * Extract every citation from one file's text.
 *
 * @param {string} text  the file's bytes
 * @param {{ projection?: 'whole-file'|'comment-prose', onlyLines?: Set<number> }} [opts]
 * @returns {{ number:number, qualifier:string|null, line:number, raw:string, context:string }[]}
 */
export function extractCitations(text, { projection = 'whole-file', onlyLines = null } = {}) {
  const projected = projection === 'comment-prose' ? commentProse(text) : text;
  const projectedLines = projected.split('\n');
  const sourceLines = text.split('\n');
  const out = [];
  projectedLines.forEach((line, ix) => {
    const lineNo = ix + 1;
    if (onlyLines && !onlyLines.has(lineNo)) return;
    const re = new RegExp(CITATION_RE.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      const before = line.slice(0, m.index + m[1].length);
      if (!m[2] && nonCitationHead(before)) continue;
      out.push({
        number: Number(m[3]),
        qualifier: m[2] ?? null,
        line: lineNo,
        raw: `${m[2] ?? ''}#${m[3]}`,
        context: (sourceLines[ix] ?? '').trim().slice(0, 160),
      });
    }
  });
  return out;
}

/* ──────────────────────────────── causes ────────────────────────────────── */

export const CAUSE = Object.freeze({
  RESOLVES: 'resolves',
  RESOLVES_AS_PULL: 'resolves-as-pull-request',
  CROSS_REPO_UNJUDGED: 'cross-repo-unjudged',
  NEVER_ISSUED: 'never-issued',
  TRANSFERRED: 'transferred',
  DELETED: 'deleted',
  ALLOCATED_BUT_ABSENT: 'allocated-but-absent',
});

/** The causes that are FINDINGS. Everything else is a reading, not a defect. */
export const FINDING_CAUSES = Object.freeze([
  CAUSE.NEVER_ISSUED, CAUSE.TRANSFERRED, CAUSE.DELETED, CAUSE.ALLOCATED_BUT_ABSENT,
]);

/**
 * A board reading: which numbers resolve, which of those are pull requests, and
 * where the allocation frontier sits. Both live strategies and the self-test's
 * stub produce THIS, so the classifier below has exactly one input shape.
 */
export function boardFromSets({ numbers, pulls = [], frontier, source }) {
  const resolvable = new Set(numbers);
  const pullSet = new Set(pulls);
  if (!Number.isInteger(frontier) || frontier <= 0) {
    throw new Error(`boardFromSets: frontier must be a positive integer, got ${String(frontier)}`);
  }
  return Object.freeze({
    source: source ?? 'unknown',
    frontier,
    size: resolvable.size,
    has: (n) => resolvable.has(n),
    isPull: (n) => pullSet.has(n),
    numbers: () => [...resolvable].sort((a, b) => a - b),
  });
}

/**
 * Classify ONE citation. Pure, and the only place a cause is decided.
 *
 * @param {{ number:number, qualifier:string|null }} cite
 * @param {ReturnType<typeof boardFromSets>} board
 * @param {{ ownerRepo?: string, transferProbe?: (n:number) => ('transferred'|'absent'|null) }} [opts]
 */
export function classifyCitation(cite, board, { ownerRepo = '', transferProbe = null } = {}) {
  if (cite.qualifier) {
    const [owner, name] = ownerRepo.split('/');
    const namesThisRepo = cite.qualifier === ownerRepo || (name && cite.qualifier === name);
    /* ⛔ A qualified citation is never resolved against this board. One
     * credential reads one repository -- the call `check-half-states` makes for
     * H19, and the reason the card refuses to let the cloud references be
     * reported as phantom numbers. */
    if (!namesThisRepo) return { cause: CAUSE.CROSS_REPO_UNJUDGED, detail: `names ${cite.qualifier}, a repository this credential does not read` };
  }
  if (board.has(cite.number)) {
    return board.isPull(cite.number)
      ? { cause: CAUSE.RESOLVES_AS_PULL, detail: 'resolves, but as a PULL REQUEST' }
      : { cause: CAUSE.RESOLVES, detail: 'resolves' };
  }
  if (cite.number > board.frontier) {
    return { cause: CAUSE.NEVER_ISSUED, detail: `beyond the allocation frontier (${board.frontier}) — this number was never minted` };
  }
  const probed = transferProbe ? transferProbe(cite.number) : null;
  if (probed === 'transferred') return { cause: CAUSE.TRANSFERRED, detail: 'the web endpoint still redirects — the issue was TRANSFERRED, not deleted' };
  if (probed === 'absent') return { cause: CAUSE.DELETED, detail: 'minted, gone from the board, and the web endpoint 404s too' };
  return {
    cause: CAUSE.ALLOCATED_BUT_ABSENT,
    detail: `minted (≤ ${board.frontier}) and absent from the board; deleted vs transferred NOT MEASURED — re-run with --probe-cause`,
  };
}

/* ───────────────────────────── the transport ────────────────────────────── */

const API = 'https://api.github.com';

/** Rewrite the numeric-id form GitHub's `Link` header uses back to the named one. */
export function normalizeNextUrl(url, ownerRepo) {
  if (!url) return null;
  return url.replace(/\/repositories\/\d+\//, `/repos/${ownerRepo}/`);
}

/** The `rel="next"` target of a `Link` header, or `null`. */
export function parseNextLink(linkHeader, ownerRepo) {
  if (!linkHeader) return null;
  for (const part of String(linkHeader).split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return normalizeNextUrl(m[1], ownerRepo);
  }
  return null;
}

function authHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'objectstack-check-issue-citations' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Strategy A -- enumerate the whole board once (cursor pagination), then judge
 * every citation offline. 159 requests on this repo, and the right shape for
 * `--census`, where the alternative is one request per distinct number.
 */
export async function enumerateBoard({ ownerRepo, token, fetchImpl = fetch, pageCap = 400 }) {
  const numbers = [];
  const pulls = [];
  let url = `${API}/repos/${ownerRepo}/issues?state=all&per_page=100&sort=created&direction=asc`;
  let pages = 0;
  while (url && pages < pageCap) {
    pages += 1;
    const res = await fetchImpl(url, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`GET ${url} -> not a list (${JSON.stringify(batch).slice(0, 200)})`);
    for (const row of batch) {
      numbers.push(row.number);
      if (row.pull_request) pulls.push(row.number);
    }
    url = parseNextLink(res.headers.get('link'), ownerRepo);
  }
  if (pages >= pageCap && url) throw new Error(`enumerateBoard: page cap ${pageCap} reached with more pages outstanding`);
  if (numbers.length === 0) throw new Error('enumerateBoard: the board enumerated ZERO numbers — that is a read failure, not an empty repository');
  return boardFromSets({ numbers, pulls, frontier: Math.max(...numbers), source: `enumerated (${pages} pages)` });
}

/**
 * Strategy B -- probe only the numbers asked about, plus one call for the
 * frontier. Cheaper whenever the citation set is small, which is every
 * diff-scoped run.
 *
 * ⛔ The two strategies must agree. `--self-test` asserts they produce
 * board-identical answers over one stubbed transport; measured against each
 * other on the live board on 2026-09-14, 28 of 28 numbers agreed (16 probes
 * chosen as the card's instances and controls, 12 sampled from the census).
 */
export async function probeBoard(wanted, { ownerRepo, token, fetchImpl = fetch }) {
  const head = await fetchImpl(`${API}/repos/${ownerRepo}/issues?state=all&per_page=1&sort=created&direction=desc`, { headers: authHeaders(token) });
  if (!head.ok) throw new Error(`GET issues?per_page=1 -> HTTP ${head.status}`);
  const newest = await head.json();
  if (!Array.isArray(newest) || newest.length === 0) throw new Error('probeBoard: could not read the allocation frontier');
  const frontier = newest[0].number;
  const numbers = [];
  const pulls = [];
  for (const n of [...new Set(wanted)].sort((a, b) => a - b)) {
    const res = await fetchImpl(`${API}/repos/${ownerRepo}/issues/${n}`, { headers: authHeaders(token) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GET issues/${n} -> HTTP ${res.status}`);
    const row = await res.json();
    numbers.push(n);
    if (row.pull_request) pulls.push(n);
  }
  /* The frontier always belongs to the board even when nothing else does, so a
   * run whose every citation 404s still carries a usable frontier. */
  if (!numbers.includes(frontier)) numbers.push(frontier);
  return boardFromSets({ numbers, pulls, frontier, source: `probed (${wanted.length} citations)` });
}

/**
 * The cause probe: a TRANSFERRED issue keeps a redirect at its web URL, a
 * deleted one does not. Separate from the API transport on purpose -- it reads
 * a different endpoint and answers a different question.
 */
export async function makeTransferProbe({ ownerRepo, fetchImpl = fetch }) {
  const cache = new Map();
  return async (n) => {
    if (cache.has(n)) return cache.get(n);
    let verdict = null;
    try {
      const res = await fetchImpl(`https://github.com/${ownerRepo}/issues/${n}`, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const to = res.headers.get('location') ?? '';
        verdict = to.includes(`/${ownerRepo}/`) ? 'absent' : 'transferred';
        /* A redirect INSIDE this repo is `/issues/N` -> `/pull/N`, which means
         * the number resolves and we should never have got here. */
        if (to.includes(`/${ownerRepo}/`)) verdict = 'absent';
      } else if (res.status === 404) verdict = 'absent';
    } catch { verdict = null; }
    cache.set(n, verdict);
    return verdict;
  };
}

/* ───────────────────────────── the sweep ────────────────────────────────── */

function tracked(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, maxBuffer: 1 << 28 })
    .toString().split('\n').filter(Boolean);
}

/** Which declared surface owns this path, or `null`. */
export function surfaceFor(path) {
  /* ⛔ The deferred table is checked FIRST and it wins. A declared surface's
   * glob can legitimately swallow a deferred one — the package-source glob
   * swallows every test file beside it — and prose that says otherwise while
   * the sweep reads them anyway is the shape this repo keeps having to fix. */
  for (const g of DEFERRED_GLOBS) if (globToRegExp(g).test(path)) return null;
  for (const s of CITATION_SURFACES) if (globToRegExp(s.glob).test(path)) return s;
  return null;
}

/**
 * Added line numbers per file, relative to `base`. The diff is taken with zero
 * context so an unchanged line next to an edit is never judged as added.
 */
export function addedLines(base, root) {
  const out = new Map();
  const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--diff-filter=ACMR', base, '--'], { cwd: root, maxBuffer: 1 << 28 }).toString();
  let file = null;
  let next = 0;
  for (const line of diff.split('\n')) {
    const plus = /^\+\+\+ b\/(.*)$/.exec(line);
    if (plus) { file = plus[1]; continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (!file) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file).add(next);
      next += 1;
    }
  }
  return out;
}

/** The merge-base this repo's PRs are judged against. */
export function defaultBase(root) {
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['merge-base', ref, 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* try the next spelling */ }
  }
  return null;
}

/**
 * Collect every citation the run should judge.
 *
 * @param {{ root?:string, scope?:'diff'|'census', base?:string|null }} opts
 */
export function collectCitations({ root = process.cwd(), scope = 'census', base = null } = {}) {
  const added = scope === 'diff' ? addedLines(base, root) : null;
  const rows = [];
  const files = [];
  for (const path of tracked(root)) {
    const surface = surfaceFor(path);
    if (!surface) continue;
    if (added && !added.has(path)) continue;
    let text;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { continue; }
    files.push(path);
    for (const cite of extractCitations(text, { projection: surface.projection, onlyLines: added ? added.get(path) : null })) {
      rows.push({ ...cite, path, surface: surface.id });
    }
  }
  return { rows, files };
}

/* ───────────────────────────── the report ──────────────────────────────── */

const REMEDY = [
  '⛔ Do NOT guess a replacement number — 「guessing an upstream is exactly how a dangling',
  '   reference becomes a wrong one」. Either name a target that resolves, or keep the number',
  '   and say IN PROSE that it no longer resolves and what the live record is.',
  '⛔ A number that names another repository is written `owner/repo#N`; a bare `#N` means',
  '   THIS repository by convention and is judged as one.',
].join('\n');

function renderFinding(f) {
  return `  [${f.cause}] ${f.path}:${f.line}  ${f.raw}\n      ${f.detail}\n      ${f.context}`;
}

async function buildBoard({ rows, ownerRepo, token, strategy }) {
  const wanted = [...new Set(rows.filter((r) => !r.qualifier).map((r) => r.number))];
  if (strategy === 'enumerate' || wanted.length > 400) return enumerateBoard({ ownerRepo, token });
  return probeBoard(wanted, { ownerRepo, token });
}

function prerequisiteRefusal(message) {
  console.error('❌ check-issue-citations: PREREQUISITE NOT MET — the board was not read.');
  console.error(`   ${message}`);
  console.error('   ⛔ Nothing below is a reading. "could not resolve" and "resolves" are not the same answer,');
  console.error(`   and this exits ${EXIT_PREREQUISITE_NOT_MET} rather than 0 so a failed read can never pass for a clean tree.`);
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

export async function run({ root = process.cwd(), scope = 'diff', base = null, json = false, probeCause = false, ownerRepo = 'objectstack-ai/objectstack', strategy = 'auto' } = {}) {
  const resolvedBase = scope === 'diff' ? (base ?? defaultBase(root)) : null;
  if (scope === 'diff' && !resolvedBase) {
    prerequisiteRefusal('no merge-base with `origin/main` or `main` — a diff-scoped run has no baseline to judge against.');
  }
  const { rows, files } = collectCitations({ root, scope, base: resolvedBase });

  if (rows.length === 0) {
    const where = scope === 'diff' ? `added against ${resolvedBase.slice(0, 9)}` : 'in the declared surfaces';
    console.log(`✅ check-issue-citations: no issue citations ${where} (${files.length} file(s) read).`);
    return 0;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  let board;
  try {
    board = await buildBoard({ rows, ownerRepo, token, strategy });
  } catch (err) {
    const plan = proxyRearmPlan({ env: process.env, execArgv: process.execArgv });
    const route = plan.rearm ? ` (${plan.reason} — re-run with \`node ${PROXY_FLAG} …\` or NODE_USE_ENV_PROXY=1)` : '';
    prerequisiteRefusal(`${err.message}${route}`);
  }

  const transferProbe = probeCause ? await makeTransferProbe({ ownerRepo }) : null;
  const classified = [];
  for (const cite of rows) {
    let probed = null;
    if (transferProbe && !cite.qualifier && !board.has(cite.number) && cite.number <= board.frontier) {
      probed = await transferProbe(cite.number);
    }
    const verdict = classifyCitation(cite, board, { ownerRepo, transferProbe: () => probed });
    classified.push({ ...cite, ...verdict });
  }

  const findings = classified.filter((c) => FINDING_CAUSES.includes(c.cause));
  const tally = {};
  for (const c of classified) tally[c.cause] = (tally[c.cause] ?? 0) + 1;

  if (json) {
    console.log(JSON.stringify({ scope, base: resolvedBase, board: { source: board.source, frontier: board.frontier, size: board.size }, tally, findings }, null, 2));
    return findings.length > 0 && scope === 'diff' ? 2 : 0;
  }

  console.log(`board: ${board.source}, frontier #${board.frontier}, ${board.size} numbers resolve`);
  console.log(`citations judged: ${classified.length} across ${files.length} file(s)`);
  for (const [cause, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${cause}`);

  if (scope === 'census') {
    /* ⛔ Report-only. A census verdict is a fact about a live shared board, not
     * about whichever change happens to run it — the posture `half-state-patrol`
     * takes for the same reason. */
    for (const f of findings.slice(0, 40)) console.log(renderFinding(f));
    if (findings.length > 40) console.log(`  … and ${findings.length - 40} more (use --json for the whole set)`);
    console.log(`\nℹ️  census: ${findings.length} unresolvable citation site(s). Report-only — this mode never fails.`);
    return 0;
  }

  if (findings.length === 0) {
    console.log(`✅ check-issue-citations: every citation this change adds resolves (or is a declared cross-repo reference).`);
    return 0;
  }
  console.error(`\n❌ check-issue-citations: ${findings.length} citation(s) THIS CHANGE ADDS do not resolve.\n`);
  for (const f of findings) console.error(renderFinding(f));
  console.error(`\n${REMEDY}`);
  return 2;
}

export function list({ root = process.cwd() } = {}) {
  const { rows, files } = collectCitations({ root, scope: 'census' });
  for (const r of rows) console.log(`${r.path}:${r.line}\t${r.raw}\t${r.surface}`);
  console.log(`# ${rows.length} citation(s) across ${files.length} file(s) in ${CITATION_SURFACES.length} declared surface(s)`);
}

/* ─────────────────────────────── self-test ─────────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ check-issue-citations --self-test: ${msg}`); process.exit(1); } }

/**
 * The self-test's own battery roster and FLOOR (#13489). A success decided by
 * "nothing threw" cannot tell "every case held" from "the cases never ran", and
 * this gate is squarely in that family: its production verdict on a still tree
 * is green, so weakening the grammar shrinks the finding set to the same empty
 * set it already prints.
 *
 * The count is a FLOOR, not an equality — adding cases is ordinary work. A
 * battery BELOW its floor means cases stopped running.
 */
const SELF_TEST_BATTERIES = Object.freeze({
  grammar: 14,
  causes: 12,
  transport: 7,
  'scope-contract': 10,
  'diff-scope': 6,
  'live-corpus': 3,
});

/** Deleting a roster entry silences its floor, so the roster's size is pinned too. */
const SELF_TEST_BATTERY_FLOOR = 6;

/** Where an assertion lands when no battery is open — never a declared name. */
const UNATTRIBUTED_BATTERY = '(no battery open)';

/**
 * Returned by `selfTest()` only after its verdict prints. The dispatch refuses
 * anything else: a `return` above that line prints nothing and still exits 0.
 */
const SELF_TEST_VERDICT = 'check-issue-citations self-test reached its verdict';

/** A `fetch` stand-in over a declared routing table. No network, ever. */
function stubFetch(routes) {
  return async (url) => {
    for (const [pattern, reply] of routes) {
      if (!pattern.test(url)) continue;
      const r = typeof reply === 'function' ? reply(url) : reply;
      return {
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        json: async () => r.body,
        headers: { get: (k) => (r.headers ?? {})[k.toLowerCase()] ?? null },
      };
    }
    return { ok: false, status: 599, json: async () => ({}), headers: { get: () => null } };
  };
}

export async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const check = (cond, message) => { registerCase(); assert(cond, message); };

  /* 1. THE GRAMMAR. Every narrowing in the header is a case here, because each
   *    one is a rule that can silently stop matching. */
  battery('grammar');
  {
    const cites = (t, o) => extractCitations(t, o).map((c) => c.raw);
    check(cites('see #12345 for the ruling').join() === '#12345', 'a bare citation must be extracted');
    check(cites('see objectui#4356 there').join() === 'objectui#4356', 'a repo-qualified citation must keep its qualifier');
    check(cites('see objectstack-ai/cloud#861').join() === 'objectstack-ai/cloud#861', 'an owner/repo-qualified citation must keep both segments');
    check(cites('acceptance #5 and #7').length === 0, 'one-digit tokens are outside the grammar');
    check(cites('colour #1234567 here').length === 0, 'a seven-digit token is outside the grammar');
    check(cites('Prime Directive #14 binds').length === 0, 'Prime Directive ordinals are not citations');
    check(cites('decision batch #127 ruled').length === 0, 'decision-batch ordinals are not citations');
    check(cites('re-charter #26 said').length === 0, 're-charter ordinals are not citations');
    check(cites('ADR §3.10 #12 says').length === 0, 'section ordinals are not citations');
    check(cites('PR #8546 landed').join() === '#8546', 'a `PR #N` head is a citation, not an ordinal');
    check(cites('the path a/b#12 is not a citation').join() === 'a/b#12', 'a slash-qualified token keeps its qualifier rather than reading as bare');
    const prose = extractCitations('const s = "#11111";\n// a note about #22222\n', { projection: 'comment-prose' });
    check(prose.length === 1 && prose[0].number === 22222, 'comment-prose projection must blank code and keep prose');
    check(prose[0].line === 2, 'the projection must PRESERVE line numbers — a finding names the line the author opens');
    check(extractCitations('#11111\n#22222\n', { onlyLines: new Set([2]) }).map((c) => c.number).join() === '22222', 'onlyLines must restrict extraction to the named lines');
  }

  /* 2. THE FOUR CAUSES. ⛔ The card's hardest constraint: they must not
   *    collapse. Each arm is provoked, including the two the live tree has no
   *    specimen for. */
  battery('causes');
  {
    const board = boardFromSets({ numbers: [100, 200, 300], pulls: [200], frontier: 300, source: 'stub' });
    const cls = (cite, probe) => classifyCitation(cite, board, { ownerRepo: 'objectstack-ai/objectstack', transferProbe: probe ? () => probe : null }).cause;
    check(cls({ number: 100, qualifier: null }) === CAUSE.RESOLVES, 'a live number resolves');
    check(cls({ number: 200, qualifier: null }) === CAUSE.RESOLVES_AS_PULL, 'a number that is a PULL REQUEST is told apart from an issue');
    check(cls({ number: 999, qualifier: null }) === CAUSE.NEVER_ISSUED, 'a number beyond the frontier was never minted');
    check(cls({ number: 150, qualifier: null }) === CAUSE.ALLOCATED_BUT_ABSENT, 'without a cause probe, deleted and transferred must NOT be guessed apart');
    check(cls({ number: 150, qualifier: null }, 'transferred') === CAUSE.TRANSFERRED, 'a redirecting web endpoint means TRANSFERRED');
    check(cls({ number: 150, qualifier: null }, 'absent') === CAUSE.DELETED, 'a 404 on both endpoints means DELETED');
    check(cls({ number: 861, qualifier: 'objectstack-ai/cloud' }) === CAUSE.CROSS_REPO_UNJUDGED, 'a cross-repo citation is UNJUDGED, never a phantom');
    check(cls({ number: 4356, qualifier: 'objectui' }) === CAUSE.CROSS_REPO_UNJUDGED, 'a bare-repo qualifier is cross-repo too');
    check(cls({ number: 100, qualifier: 'objectstack-ai/objectstack' }) === CAUSE.RESOLVES, 'a citation qualified with THIS repo is resolved, not deferred');
    check(cls({ number: 100, qualifier: 'objectstack' }) === CAUSE.RESOLVES, 'the bare name of THIS repo is this repo');
    check(!FINDING_CAUSES.includes(CAUSE.CROSS_REPO_UNJUDGED), '⛔ a cross-repo citation must never be a finding');
    check(FINDING_CAUSES.length === 4 && FINDING_CAUSES.includes(CAUSE.NEVER_ISSUED) && FINDING_CAUSES.includes(CAUSE.DELETED)
      && FINDING_CAUSES.includes(CAUSE.TRANSFERRED) && FINDING_CAUSES.includes(CAUSE.ALLOCATED_BUT_ABSENT),
    'the finding set is exactly the four unresolvable causes');
  }

  /* 3. THE TRANSPORT, and the agreement between its two strategies. */
  battery('transport');
  {
    check(normalizeNextUrl('https://api.github.com/repositories/123/issues?page=2', 'o/r') === 'https://api.github.com/repos/o/r/issues?page=2',
      "the numeric-id form GitHub's Link header uses must be rewritten to the named one");
    check(parseNextLink('<https://api.github.com/repositories/9/issues?p=2>; rel="next", <x>; rel="last"', 'o/r')
      === 'https://api.github.com/repos/o/r/issues?p=2', 'rel="next" must be picked out of a multi-part Link header');
    check(parseNextLink('<x>; rel="prev"', 'o/r') === null, 'a Link header with no next must answer null');
    check(parseNextLink(null, 'o/r') === null, 'an absent Link header must answer null');

    const page1 = { body: [{ number: 1 }, { number: 2, pull_request: {} }], headers: { link: '<https://api.github.com/repositories/9/issues?page=2>; rel="next"' } };
    const page2 = { body: [{ number: 4 }], headers: {} };
    const enumerated = await enumerateBoard({
      ownerRepo: 'o/r', token: '', fetchImpl: stubFetch([[/page=2/, page2], [/issues\?state=all/, page1]]),
    });
    check(enumerated.frontier === 4 && enumerated.size === 3 && enumerated.isPull(2) && !enumerated.has(3),
      'the enumerating strategy must follow the cursor and carry the pull-request flag');

    const probed = await probeBoard([1, 2, 3], {
      ownerRepo: 'o/r', token: '',
      fetchImpl: stubFetch([
        [/per_page=1/, { body: [{ number: 4 }] }],
        [/issues\/1$/, { body: { number: 1 } }],
        [/issues\/2$/, { body: { number: 2, pull_request: {} } }],
        [/issues\/3$/, { status: 404, body: {} }],
      ]),
    });
    /* ⛔ ONE classifier, so the two strategies must answer the same question the
     * same way. A strategy that disagreed would make a finding depend on which
     * mode the caller happened to pick. */
    for (const n of [1, 2, 3, 4]) {
      check(enumerated.has(n) === probed.has(n) && enumerated.isPull(n) === probed.isPull(n),
        `the two board strategies must agree on #${n} (enumerate=${enumerated.has(n)}/${enumerated.isPull(n)}, probe=${probed.has(n)}/${probed.isPull(n)})`);
    }
  }

  /* 4. THE SCOPE CONTRACT. The card's ruling is that scope is the hard part, so
   *    the contract is pinned against the live tree rather than described. */
  battery('scope-contract');
  {
    check(CITATION_SURFACES.length >= 3, 'the scope contract must declare its surfaces');
    check(CITATION_SURFACES.every((s) => typeof s.why === 'string' && s.why.length > 40), 'every declared surface must carry the reading that put it in');
    check(DEFERRED_SURFACES.every((s) => typeof s.why === 'string' && s.why.length > 40), 'every DEFERRED surface must carry the reading that kept it out');
    check(DEFERRED_GLOBS.some((g) => g.startsWith('scripts/')), "⛔ #15809's lane must be declared as deferred, not silently unswept");
    check(DEFERRED_GLOBS.some((g) => g.includes('CHANGELOG')), 'the changelog surface the card warns about must be declared as deferred');
    check(surfaceFor('packages/spec/src/data/thing.test.ts') === null && surfaceFor('packages/spec/src/data/thing.ts') !== null,
      '⛔ a deferred glob must EXCLUDE, not merely describe — a test file beside a swept source file must not be swept');
    check(surfaceFor('scripts/check-issue-citations.mjs') === null && surfaceFor('packages/spec/CHANGELOG.md') === null,
      'the two lanes the card refuses to fold must not be swept by this gate');
    check(ROOT_DIR_WATCH_HINTS.every((h) => CITATION_SURFACES.some((s) => s.glob.startsWith(h.replace(/\*+$/, '')))),
      'every watch hint must name a root a declared surface actually sweeps');
    check(CITATION_SURFACES.every((s) => ROOT_DIR_WATCH_HINTS.some((h) => s.glob.startsWith(h.replace(/\*+$/, '')))),
      'every declared surface must be covered by a watch hint — an unhinted surface is a gate no dispatch names');
    check(CENSUS_17512.allocationFrontier - CENSUS_17512.resolvableNumbers === CENSUS_17512.holes,
      'the declared census must be internally consistent (frontier − resolvable = holes)');
  }

  /* 5. DIFF SCOPE, over a real repository. ⭐ The both-directions proof the card
   *    asks for, mechanized: the same tree is GREEN before the citation is added
   *    and RED after, with nothing else changed. */
  battery('diff-scope');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'check-issue-citations-'));
    try {
      const write = (rel, body) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
      const git = (...args) => execFileSync('git', args, { cwd: tmp, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      write('packages/p/src/thing.ts', '// a settled note about #100\nexport const x = 1;\n');
      write('content/docs/releases/v1/1-0.mdx', 'Shipped in #100.\n');
      write('README.md', 'An unswept surface citing #999.\n');
      git('init', '-q');
      git('config', 'user.email', 'selftest@example.invalid');
      git('config', 'user.name', 'selftest');
      git('add', '-A');
      git('commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD').toString().trim();

      const before = collectCitations({ root: tmp, scope: 'diff', base });
      check(before.rows.length === 0, `GREEN direction: an unchanged tree adds no citations, got ${before.rows.length}`);

      write('packages/p/src/thing.ts', '// a settled note about #100\n// blocked on #999 landing\nexport const x = 1;\n');
      const after = collectCitations({ root: tmp, scope: 'diff', base });
      check(after.rows.length === 1 && after.rows[0].number === 999,
        `RED direction: the ADDED citation must be the only one judged, got ${JSON.stringify(after.rows.map((r) => r.number))}`);
      check(after.rows[0].line === 2, 'the added citation must be reported at the line it was added on');
      check(collectCitations({ root: tmp, scope: 'census' }).rows.map((r) => r.number).sort().join() === '100,100,999',
        'the census scope must see both surfaces and both citations, and nothing outside them');
      check(!collectCitations({ root: tmp, scope: 'census' }).files.some((f) => f === 'README.md'),
        '⛔ an undeclared surface must not be swept — the scope contract is the contract');
      const board = boardFromSets({ numbers: [100], pulls: [], frontier: 1000, source: 'stub' });
      check(classifyCitation(after.rows[0], board, { ownerRepo: 'o/r' }).cause === CAUSE.ALLOCATED_BUT_ABSENT,
        'the added citation must classify as unresolvable against a board that lacks it');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /* 6. THE LIVE CORPUS IS NOT EMPTY. The only thing separating a clean tree from
   *    an extractor that silently matches nothing — the failure that let this
   *    class sit unswept in the first place. */
  battery('live-corpus');
  {
    const live = collectCitations({ scope: 'census' });
    check(live.files.length > 100, `the declared surfaces must reach the tree, got ${live.files.length} file(s)`);
    check(live.rows.length > 1000, `the live corpus must yield its citations, got ${live.rows.length}`);
    check(live.rows.some((r) => r.qualifier), 'the live corpus must contain at least one cross-repo citation — the arm that must never be reported as a phantom');
  }

  /* ── The floor: every declared battery RAN, and ran its cases ───────────── */
  const floorMessages = [];
  const floorFailure = (m) => { floorMessages.push(m); };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let breached = false;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    breached = true;
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    breached = true;
    floorFailure(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    breached = true;
    floorFailure(count === 0
      ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
      : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`);
  }
  if (breached) {
    floorFailure('A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the number. Find what stopped registering (an early return, a deleted block, a guard that now skips) and restore it.');
  }
  assert(!breached, floorMessages.join('\n     '));

  const total = [...batterySeen.values()].reduce((a, b) => a + b, 0);
  console.log(`✅ check-issue-citations --self-test: grammar narrowed, four 404 causes kept apart, both board strategies agree, diff scope red AND green, scope contract pinned (${total} cases, ${declared.length} batteries)`);
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const ix = argv.indexOf(name);
    return ix >= 0 ? argv[ix + 1] : null;
  };
  // The `if` body is BRACED so the trailing `else if` cannot re-bind to the
  // inner refusal; the `else` arms stay unbraced, per the landed
  // `scripts/check-adr-symbol-anchors.mjs` precedent.
  if (flag('--self-test')) {
    const verdict = await selfTest();
    if (verdict !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-issue-citations self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else if (flag('--list')) list();
  else {
    process.exit(await run({
      scope: flag('--census') ? 'census' : 'diff',
      base: value('--base'),
      json: flag('--json'),
      probeCause: flag('--probe-cause'),
      strategy: flag('--enumerate') ? 'enumerate' : 'auto',
    }));
  }
}
