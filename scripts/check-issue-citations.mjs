#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-issue-citations (#17512) -- the repo's issue-NUMBER citations, resolved
 * against the board they name.
 *
 *   node scripts/check-issue-citations.mjs                 # judge what this change ADDS
 *   node scripts/check-issue-citations.mjs --base <ref>    # ...relative to <ref>
 *
 * A runner declares the base instead, through `OS_GATE_MERGE_GROUP_BASE_SHA`
 * -- see `baseSpellings` below for the `merge_group` reading that makes it the
 * only correct answer there.
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
 * and, through the citation grammar below, over the surfaces this gate declares
 * -- this gate's own `--census --json`, not a hand-rolled instrument:
 *
 *   33,750  citations judged, across 2,357 files
 *   28,359    resolve
 *    1,410    resolve as a PULL REQUEST, not an issue -- the #17444 near-miss class
 *    1,196    cross-repo, ⛔ UNJUDGED and never a finding
 *    2,785    UNRESOLVABLE: 103 sites / 71 distinct on the release pages,
 *             2,682 sites / 439 distinct in package docblocks (449 distinct overall)
 *
 * A second, independent instrument written before this gate existed (a scratch
 * scan over `git ls-files` with the same projection) answered 2,782 on the same
 * tree minutes earlier. The two agree to within the three citations the frontier
 * moved by while they ran, which is the control on the count.
 *
 * ⭐ So the card's five instances are the visible edge of ~2,785 sites. That
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
 *   cross-repo-unjudged   the citation NAMES another repo (`owner/repo#N`, or a
 *                         `KNOWN_REPOSITORIES` name). ⛔ Never resolved, never a
 *                         finding: one credential reads one board, as H19 does.
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
 *   - `NON_CITATION_HEADS`: `Directive #14`, `batch #127`, `PKCS#11` and their
 *     siblings are ordinals in a numbering system that is not the board's; a
 *     row stays only while it protects a measured population (#20636 closeout).
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
 * ⛔ NO WORKFLOW INVOKES THIS FILE. The root manifest carries
 * `check:issue-citations`, which runs the `--self-test` and nothing else -- the
 * shape `check:pm-half-states` uses for the same reason, because the live modes
 * need a board and a credential. But `.github/workflows/**` was out of the
 * dispatch's file surface for #17512, and a census of the manifest's 160
 * `check:*` keys found every one of them named by a workflow, directly or
 * through its alias. So this gate is presently a tool a seat runs, not a
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
 * Both are installed (#18224): the diff-scoped verdict in `lint.yml`'s
 * `Lint & Repo Gates` job, the `--census` in `half-state-patrol.yml`. The
 * verdict step also declares the base -- see `baseSpellings` below for why a
 * `merge_group` build cannot be left to guess one.
 *
 * ## The local route -- why this gate re-execs itself
 *
 * A seat runs the live modes from an agent container whose only way out is
 * `HTTPS_PROXY`, and node's `fetch` does not read that variable. Every board
 * read there answered HTTP 401 and the gate refused, correctly, with
 * `PREREQUISITE NOT MET` -- while holding, and printing, the very plan that
 * completes the read. `rearmThroughProxy` below now EXECUTES that plan instead
 * of prescribing it, on the shape `scripts/pm/post-stamped.mjs` and
 * `scripts/pm/board-snapshot.mjs` have run daily: re-exec this file under
 * `--use-env-proxy`, adopt the child's exit code, degrade loudly if the re-exec
 * cannot happen.
 *
 * ⛔ Two things it deliberately is not. It is not a relaxation: the child is
 * this same file, so a board that still cannot be read still exits with the
 * same `EXIT_PREREQUISITE_NOT_MET` refusal -- "cannot read" never
 * becomes "silently passes". And it is not taken by `--self-test` or `--list`,
 * which make no request; re-execing them would spawn a process to prove a route
 * nothing is about to use.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './git-env.mjs';
import { globToRegExp } from './glob-match.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { commentProse } from './symbol-anchors.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan } from './pm/check-half-states.mjs';

/** This file, as the re-exec below has to name it on a child's argv. */
const SELF_PATH = fileURLToPath(import.meta.url);

/**
 * THIS gate's OWN re-exec guard -- never a shared name, and never the
 * patrol's (#18939). A tool that reads a sibling instrument's guard out of
 * `process.env` is told "already re-armed" by a process that re-armed
 * something else; the un-re-armed run then bypasses the proxy and answers 401
 * Bad credentials, which is a false story about the credential rather than
 * about the route. The failure is SILENT, so the own name is the whole
 * defence and `--self-test` pins it.
 */
const PROXY_REARM_GUARD = 'OS_ISSUE_CITATIONS_PROXY_REARMED';

/**
 * POPULATION DECLARATION -- what `scripts/pm/dispatch-gates.mjs` is told this
 * gate reads. Provenance ONLY: nothing in this file reads this array; the
 * surfaces below are what the sweep walks, and `--self-test` pins the two
 * against each other in both directions.
 */
export const ROOT_DIR_WATCH_HINTS = ['content/docs/releases/**', 'packages/**'];

// dispatch-gates: local-env GITHUB_TOKEN OS_GATE_MERGE_GROUP_BASE_SHA -- the BARE invocation, the diff-scoped verdict lint.yml runs on every pull request, answers that run's question on a dev container with neither value: GITHUB_TOKEN (or GH_TOKEN) is used when present and never required, because the diff mode reads the PUBLIC board with one probe per distinct number the change adds (it enumerates the whole board only past 400 of them) and re-arms the session proxy itself (rearmThroughProxy); OS_GATE_MERGE_GROUP_BASE_SHA renders EMPTY on a pull_request run, since only a merge_group build sets it, and with it unset baseSpellings takes merge-base(origin/main, HEAD), the base the pull_request run itself judges against. A board this run cannot read, or a base it cannot resolve, still exits PREREQUISITE NOT MET and never 0. Not declared for --census, which enumerates every page of the board and needs the token.

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
  /* ⚠️ The frontier moved from 18219 to 18221 during the measuring session. It
   * is a reading with a timestamp, ⛔ never a constant. */
  citationsJudged: 33750,
  filesRead: 2357,
  resolves: 28359,
  resolvesAsPull: 1410,
  crossRepoUnjudged: 1196,
  unresolvableSites: Object.freeze({ 'release-pages': 103, 'package-docblocks': 2682 }),
  unresolvableDistinct: Object.freeze({ 'release-pages': 71, 'package-docblocks': 439 }),
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
 * ⭐ THE QUALIFIER IS A CLOSED SET (#20330). A token joined to `#N` is a
 * CANDIDATE, and it names a repository only when it is an `owner/repo` form or
 * a name in this table; any other prefix is PROSE, and the `#N` after it is
 * THIS repository's and is judged. Matched case-insensitively (GitHub's
 * repository names are), so `Framework#N` and `OBJECTUI#N` read as their
 * repositories.
 *
 * Why closed, measured on `288611e3e5` (2026-09-29) over the declared surfaces:
 * the open grammar took every `word#N` as a repository, and 27 distinct
 * candidates sat behind 1,655 sites. 306 of them were prose -- `pre-#N` 284,
 * `post-#N` 12, and `Pre-`/`Post-`/`PRE-`/`POST-` 10 -- so a dead number spelled
 * `pre-#12248` was classed cross-repo and never judged, the hole #20330 names.
 * The rest were ordinals (`PD#12`, `OQ#10`, `Prime-Directive-#12`, `PKCS#11`),
 * which `NON_CITATION_HEADS` now reads once the candidate is refused.
 *
 * ⛔ A name in this table is a measured citation population, never a guess.
 * A repository the tree cites that is missing here reads as THIS repository:
 * add its row, or write `owner/repo#N`, which is always a repository.
 *
 *   self     the name is THIS repository (the classifier judges it here).
 *   joined   recognised only JOINED to its number (`ui#N`), never in the prose
 *            form `REPO PR #N` below -- `UI #N` is ordinary English.
 */
export const KNOWN_REPOSITORIES = Object.freeze([
  Object.freeze({
    name: 'objectstack', slug: 'objectstack-ai/objectstack', self: true,
    why: 'This repository. 111 `objectstack#N` sites, e.g. `packages/client/src/index.ts`.',
  }),
  Object.freeze({
    name: 'framework', slug: 'objectstack-ai/objectstack', self: true,
    why: "This repository's FORMER name: `git ls-remote https://github.com/objectstack-ai/framework` "
      + 'answered this repository\'s refs (HEAD `288611e3e5` on both, 2026-09-29) while a nonexistent '
      + 'control name exited 128 and `objectui` answered its own. 257 sites, `Framework#N` included.',
  }),
  Object.freeze({
    name: 'objectui', slug: 'objectstack-ai/objectui',
    why: 'The Studio/Console sibling. 684 sites across `objectui#N` and `objectstack-ai/objectui#N`.',
  }),
  Object.freeze({
    name: 'ui', slug: 'objectstack-ai/objectui', joined: true,
    why: 'A short alias for objectui, 11 sites: `ui#6837` / `ui#6206` / `ui#6207` measured as objectui\'s '
      + 'records (`objectstack-ai/ui` does not exist). Joined only.',
  }),
  Object.freeze({
    name: 'cloud', slug: 'objectstack-ai/cloud',
    why: 'The commercial sibling (private: one credential cannot read it). 222 sites.',
  }),
  Object.freeze({
    name: 'hotcrm', slug: 'objectstack-ai/hotcrm',
    why: 'A public downstream application. 25 sites, `objectstack-ai/hotcrm#673` spelled in full once.',
  }),
  Object.freeze({
    name: 'hotcrm-heimao', slug: null,
    why: 'A downstream application repository; its owner is NOT MEASURED (not public under '
      + 'objectstack-ai). 1 site, `packages/spec/src/data/field.zod.ts`.',
  }),
  Object.freeze({
    name: 'os-tianshun-mtc', slug: null,
    why: 'A downstream application repository; owner NOT MEASURED. 2 sites, '
      + '`packages/lint/src/validate-security-posture.ts`.',
  }),
  Object.freeze({
    name: 'os-project-titanwind-ehr', slug: null,
    why: 'A downstream application repository; owner NOT MEASURED. 1 site, '
      + '`packages/objectql/src/validation/rule-validator.ts`.',
  }),
]);

const KNOWN_BY_NAME = new Map(KNOWN_REPOSITORIES.map((r) => [r.name, r]));
const KNOWN_BY_SLUG = new Map(KNOWN_REPOSITORIES.filter((r) => r.slug)
  .map((r) => [`${r.slug.split('/')[0]}/${r.name}`, r]));

/**
 * The repository a candidate qualifier NAMES, lower-cased -- its slug when
 * known, a former name resolved to the current one -- or `null` when the
 * candidate is prose. The ONE recogniser: extraction, the board's probe set and
 * the classifier all ask it, so the three can never disagree about a token.
 */
export function repositoryOf(candidate) {
  if (!candidate) return null;
  const text = candidate.toLowerCase();
  if (text.includes('/')) {
    const known = KNOWN_BY_SLUG.get(text);
    return known ? (known.slug ?? known.name) : text;
  }
  const known = KNOWN_BY_NAME.get(text);
  return known ? (known.slug ?? known.name) : null;
}

/**
 * Does this citation name the repository the board reads? A bare `#N` does, by
 * convention; so does any qualifier that resolves to `ownerRepo` or its name.
 */
export function namesThisRepository(cite, ownerRepo) {
  const repo = repositoryOf(cite.qualifier);
  if (!repo) return true;
  const own = ownerRepo.toLowerCase();
  return repo === own || repo === own.split('/')[1];
}

/**
 * The PROSE spelling of a qualifier, `objectui PR #10264` / `cloud #2937`,
 * matched against the text that ENDS immediately before a bare `#`. Measured on
 * `288611e3e5`: 27 sites, and on every one the named repository's record is the
 * one the sentence describes (objectui's board read for each objectui number)
 * while this repository's same number is unrelated -- 3 of them
 * (`objectui PR #8758`) were census deaths here that are not deaths at all.
 * ⛔ A qualifier does NOT carry across a pair: in `cloud#1013 and #10645` the
 * second number is this repository's (measured over the 48 pair sites -- the
 * `,` / `and` pairs name this repository's number, `/` ones mostly the
 * qualifier's but not always), so each number of a pair is qualified on its own.
 */
const PROSE_QUALIFIER_RE = new RegExp(
  `(?:^|[^\\w/-])(${KNOWN_REPOSITORIES.filter((r) => !r.joined).map((r) => r.name.replace(/[.-]/g, '\\$&')).join('|')})`
  + '\\s+(?:(?:PR|issue)\\s+)?$',
  'i',
);

/**
 * One citation. The leading group is CONTEXT (consumed so `a/b#12` and a bare
 * `#12` cannot both match the same characters), group 2 is the optional
 * CANDIDATE qualifier -- `repositoryOf` decides whether it names a repository
 * -- and group 3 is the number.
 *
 * ⭐ THE EXTRACTOR-SPELLING CLOSEOUT (#20636). Two exclusions here were wider
 * than anything they protected, and each hid real citations from the diff gate
 * and the census alike. Measured on `3693a1b50d` (2026-09-30) over the declared
 * surfaces, every arm judged against one enumerated board (frontier #20959):
 *
 *   A hyphen after the number, `(?![\w-])`. It hid 58 `#N-word` sites
 *     (`#13398-class`, `#5347-A`, `ui#6206-B`), 1 of them dead, and protected
 *     NONE there: 0 numeric ranges, 0 slugs, 0 hex-like tokens. Repo-wide the
 *     one non-citation shape it covered is a markdown in-page heading anchor,
 *     `[13. Risks](#13-risks--mitigations)` (16 lines, all in `docs/design/**`
 *     and `skills/**`), which keeps a narrower guard: the `](` row of
 *     `NON_CITATION_HEADS`. Now `(?!\w)`, which still keeps `#12ab34` out.
 *   A `/` before the `#`. It hid 528 sites, 10 of them dead: 523 slash-joined
 *     second numbers (`#7737/#10629`) and 5 `TOKEN/#N` (`ADR-0049/#1888`), and
 *     protected no path and no URL fragment there. What it does protect is a
 *     CANDIDATE starting mid-path -- `https://host/docs/page#12` would read
 *     `page` as prose and judge #12 -- so it stays on that arm only, and there
 *     it yields to a `/` that joins onto a number (`#3076/objectui#2614`).
 *
 * A slash-joined continuation reads as its chain; see `extractCitations`.
 */
export const CITATION_RE = new RegExp(
  '(^|[^\\w#-])(?:(?<!(?:^|\\D)/)([A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?)#|#)'
  + `(\\d{${CITATION_MIN_DIGITS},${CITATION_MAX_DIGITS}})(?!\\w)`,
  'g',
);

/**
 * The URL spelling (#20636): `https://github.com/OWNER/REPO/issues/N` or
 * `/pull/N` carries no `#`, so `CITATION_RE` never saw it. Measured on
 * `3693a1b50d`: 57 sites in the declared surfaces (56 in package comments, 1 on
 * a release page), 4 of them dead. Its qualifier is the URL's own `OWNER/REPO`,
 * read by `repositoryOf` like any other, so an `objectstack-ai/framework` URL is
 * this repository and every other repository's is cross-repo, never a finding.
 *
 * ⛔ Not `check:doc-authoring`'s: that gate asks whether a runtime STRING carries
 * a tracker reference at all, and reads string literals; this one asks whether a
 * citation RESOLVES, and reads comment prose. The projections are disjoint, so
 * neither counts the other's sites -- the same tree held 2 URL sites in strings
 * (`packages/runtime/src/route-ledger.ts`) against 56 in comments.
 */
export const CITATION_URL_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(?:issues|pull)\/(\d+)/g;

/**
 * Numbering systems that are NOT the board's, matched against the text that
 * ENDS immediately before the `#`. Every row is a measured population on this
 * tree, not a hypothetical -- and a row that protects nothing is a blind spot,
 * not a precaution: the grammar's two-digit floor already keeps a one-digit
 * ordinal (`acceptance #5`, `clause #2`) out, so a head only earns a row for
 * the two-digit-and-up ordinals it measurably covers.
 *
 * Retired by the #20636 closeout, each protecting 0 sites repo-wide and hiding
 * board citations (measured on `3693a1b50d`; "hid" counts the declared surfaces
 * and, where noted, the deferred test files):
 *
 *   `re-charter`  0 left; the 26 it hid (`re-charter #13135`, dead) were rewritten
 *   `acceptance`  1 (`the silent acceptance #6132 closed`, live)
 *   `clause`      0, and 4 in test files (`the clause #18510 removed`)
 *   `option`      1 (`option #14088 gave`, live), and 1 under `scripts/**`
 *   `§`           0, and 4 in test files (`§6 #11176's decisions`)
 */
export const NON_CITATION_HEADS = Object.freeze([
  Object.freeze({ re: /(?:prime\s+)?directive\s*$/i, why: 'AGENTS.md Prime Directive ordinals' }),
  Object.freeze({ re: /(?:^|[^a-z])pd\s*$/i, why: 'the abbreviated Prime Directive spelling' }),
  Object.freeze({ re: /(?:decision\s+)?batch\s*$/i, why: 'maintainer decision-batch ordinals' }),
  /* The two rows below came due when the qualifier closed (`KNOWN_REPOSITORIES`):
   * both were read as repositories before, so they were never judged at all. */
  Object.freeze({ re: /(?:^|[^a-z])oq\s*$/i, why: "an ADR's open-question ordinals (`ADR-0076 OQ#10`), 10 sites" }),
  Object.freeze({ re: /(?:^|[^a-z])pkcs\s*$/i, why: "a standard's own numbering (`PKCS#11`), 1 site" }),
  /* The narrower guard the hyphen exclusion leaves behind (see `CITATION_RE`). */
  Object.freeze({ re: /\]\($/, why: "a markdown link's in-page heading anchor (`[13. Risks](#13-risks--mitigations)`), 16 lines outside the declared surfaces" }),
]);

/**
 * Which of `NON_CITATION_HEADS` excuses this match, or `null`. A hyphen that
 * joins a head to its `#` is the same head -- `Prime-Directive-#12`, 2 sites.
 */
export function nonCitationHead(before) {
  const head = before.replace(/-+$/, '');
  for (const row of NON_CITATION_HEADS) if (row.re.test(head)) return row;
  return null;
}

/**
 * Extract every citation from one file's text, in line and column order.
 *
 * ⭐ A SLASH-JOINED CONTINUATION reads as its chain (#20636). In `#A/#B` the
 * second number is written with nothing of its own before the `#`, so it takes
 * the first one's reading: bare after a bare or prose head (513 chains on
 * `3693a1b50d`), the chain's repository after a qualified one, and an ordinal
 * after an ordinal. The qualified case is measured, not assumed: of the 8
 * chains headed by another repository there, the 5 on objectui's public board
 * (`objectui#2715/#2717` and four more) each name objectui's record -- the
 * issue, then the pull request that fixed it -- while this repository's same
 * numbers are unrelated; the other 3 (`cloud`, `hotcrm-heimao`) are boards one
 * credential cannot read, so they stay unjudged exactly as they were. ⛔ Only a
 * `/` JOINED to the number continues a chain: `objectui#1 / #2` and
 * `objectui#1 + #2` are two readings, and a second number that carries its own
 * qualifier (`#3076/objectui#2614`) is read by that qualifier.
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
    const context = (sourceLines[ix] ?? '').trim().slice(0, 160);
    const found = [];
    const re = new RegExp(CITATION_RE.source, 'g');
    let chain = null;
    let m;
    while ((m = re.exec(line)) !== null) {
      /* Everything up to the `#`, a refused candidate included: `pre-` is prose,
       * and `PD` in `PD#12` is the head `NON_CITATION_HEADS` reads. */
      const hashAt = m.index + m[0].length - m[3].length - 1;
      const before = line.slice(0, hashAt);
      const continues = m[1] === '/' && !m[2] && chain !== null && chain.end === m.index;
      let reading = continues ? chain.reading : null;
      if (!reading) {
        const joined = repositoryOf(m[2]) ? m[2] : null;
        const prose = joined ? null : PROSE_QUALIFIER_RE.exec(before);
        const qualifier = joined ?? prose?.[1] ?? null;
        reading = {
          qualifier,
          excused: !qualifier && nonCitationHead(before) !== null,
          spelled: joined ?? (prose ? before.slice(prose.index + prose[0].indexOf(prose[1])) : ''),
        };
      }
      chain = { end: re.lastIndex, reading };
      if (reading.excused) continue;
      found.push({ at: hashAt, cite: { number: Number(m[3]), qualifier: reading.qualifier, line: lineNo, raw: `${reading.spelled}#${m[3]}`, context } });
    }
    for (const u of line.matchAll(new RegExp(CITATION_URL_RE.source, 'g'))) {
      const number = Number(u[3]);
      /* `[#15325](https://github.com/…/issues/15325)` is ONE citation: the link's
       * text already carries it, so the target is not counted a second time. */
      const link = /\[[^\]]*\]\($/.exec(line.slice(0, u.index));
      if (link && found.some((f) => f.cite.number === number && f.at > link.index && f.at < u.index)) continue;
      found.push({ at: u.index, cite: { number, qualifier: `${u[1]}/${u[2]}`, line: lineNo, raw: u[0], context } });
    }
    found.sort((a, b) => a.at - b.at);
    for (const f of found) out.push(f.cite);
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
  /* ⛔ A citation naming ANOTHER repository is never resolved against this
   * board. One credential reads one repository -- the call `check-half-states`
   * makes for H19, and the reason the card refuses to let the cloud references
   * be reported as phantom numbers. A qualifier that names no repository at all
   * (`pre-`) is prose, and the number is this board's. */
  if (!namesThisRepository(cite, ownerRepo)) {
    return { cause: CAUSE.CROSS_REPO_UNJUDGED, detail: `names ${cite.qualifier}, a repository this credential does not read` };
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

/**
 * Every diff-base spelling a run may use, in order, each carrying the reason it
 * is on the list -- the refusal below prints them, so a reader who acts on it
 * looks where the run actually looked.
 *
 * ⭐ A runner that DECLARES a base replaces the ref guesses entirely, and on a
 * `merge_group` build that is not a convenience, it is the only correct answer.
 * A queue entry is built on the GROUP's base, which carries the entries AHEAD
 * of it in the queue and has NOT landed on `main` yet; the published
 * `origin/main` the runner fetched is therefore BEHIND that base, and
 * `merge-base origin/main HEAD` lands at the published tip. Everything between
 * the two -- other people's PRs -- then reads as "added by this change".
 *
 * MEASURED on the ejection this spelling exists for: on queue entry
 * `a7109d1f08` the ref guess resolved to the published main of 14:30Z and
 * judged 15 file(s) / 16 citations, 3 of them unresolvable and every one of
 * those written by the two entries ahead in the queue -- `#6361` twice from
 * `ada701220`, `#18003` from `8271c81425`, both landing on `main` AFTER that
 * checkout (14:36:53Z and 14:47:59Z). The declared base judged 0 file(s). So
 * the ref guess failed a PR for citations its author did not write, which is
 * the same defect class this gate's own diff scoping exists to prevent.
 *
 * ⛔ `pull_request` and `push` keep the ref guesses, deliberately: there the
 * checked-out merge ref already CONTAINS the main it was computed against, so
 * the merge base IS that main and nothing newer can leak into the added set.
 *
 * The variable is the name `lint.yml` already uses for this fact
 * (`scripts/ci/select-gate-families.sh`) -- one fact, one spelling. It is
 * deliberately NOT `PROXY_REARM_GUARD`'s own-name case: a re-exec guard is this
 * PROCESS's state, which a sibling instrument must never answer for, while a
 * group's `base_sha` is a fact about the build that every reader of it shares.
 */
export function baseSpellings({ base = null, env = process.env } = {}) {
  if (base) return [{ ref: base, verbatim: true, why: 'the `--base` argument' }];
  const declared = (env.OS_GATE_MERGE_GROUP_BASE_SHA ?? '').trim();
  if (declared) return [{ ref: declared, verbatim: true, why: 'OS_GATE_MERGE_GROUP_BASE_SHA -- `github.event.merge_group.base_sha`' }];
  return [
    { ref: 'origin/main', verbatim: false, why: 'the remote-tracking main a CI checkout fetches' },
    { ref: 'main', verbatim: false, why: 'a local main, for a clone that tracks no remote' },
  ];
}

/** @returns {string|null} what git printed, or null when the command refused. */
function gitLine(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch { return null; }
}

/**
 * The base a diff-scoped run is judged against, plus every spelling tried.
 *
 * ⛔ It never returns a base it did not VERIFY resolves to a commit in this
 * checkout. An unverified base reaches `git diff` as-is, which answers
 * `fatal: bad revision` and THROWS -- an uncaught exception whose exit code is
 * none of this gate's three answers, so a failed read arrives wearing an
 * unclassified number. "could not resolve" and "resolves" are not the same
 * answer, so an unresolvable spelling answers `{ base: null }` here and the
 * caller refuses loudly with `EXIT_PREREQUISITE_NOT_MET`.
 */
export function resolveDiffBase({ root = process.cwd(), base = null, env = process.env } = {}) {
  const tried = baseSpellings({ base, env });
  for (const spelling of tried) {
    /* A declared base is taken VERBATIM -- it already IS the fork point. A ref
     * guess goes through `merge-base`, because a branch TIP is not one. */
    const sha = spelling.verbatim
      ? gitLine(root, ['rev-parse', '--verify', '--quiet', `${spelling.ref}^{commit}`])
      : gitLine(root, ['merge-base', spelling.ref, 'HEAD']);
    if (sha) return { base: sha, used: spelling, tried };
  }
  return { base: null, used: null, tried };
}

/**
 * The refusal text for a base that does not resolve. It names every spelling
 * TRIED and what to pass instead: "no merge-base with `origin/main`" is a true
 * sentence about a run that never looked at `origin/main` at all, and a reader
 * who acts on it looks in the wrong place.
 */
export function unresolvedBaseMessage({ tried }) {
  const spellings = tried.map((s) => `\`${s.ref}\` (${s.why})`).join(', ');
  return `no diff base resolves to a commit in this checkout — tried ${spellings}. `
    + 'A diff-scoped run has no baseline to judge against. Pass one with `--base <ref>`, '
    + 'or set OS_GATE_MERGE_GROUP_BASE_SHA to a commit this checkout has, or fetch `main` '
    + '(a shallow clone carries no merge base).';
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
  '⛔ A number that names another repository is written `owner/repo#N` (or `repo#N` for a name',
  '   in KNOWN_REPOSITORIES), and each number of a pair carries its own: `objectui#1 + objectui#2`.',
  '   A bare `#N` -- and one after any other prefix, `pre-#N` included -- means THIS repository.',
].join('\n');

function renderFinding(f) {
  return `  [${f.cause}] ${f.path}:${f.line}  ${f.raw}\n      ${f.detail}\n      ${f.context}`;
}

/**
 * The numbers the board must answer: every citation judged HERE, qualified or
 * not. ⛔ Not "the unqualified ones" -- a probed board that never asked about
 * `objectstack#20330` classes that live issue as unresolvable, a false red the
 * diff-scoped verdict answered before this read `namesThisRepository`.
 */
export function boardWanted(rows, ownerRepo) {
  return [...new Set(rows.filter((r) => namesThisRepository(r, ownerRepo)).map((r) => r.number))];
}

async function buildBoard({ rows, ownerRepo, token, strategy }) {
  const wanted = boardWanted(rows, ownerRepo);
  if (strategy === 'enumerate' || wanted.length > 400) return enumerateBoard({ ownerRepo, token });
  return probeBoard(wanted, { ownerRepo, token });
}

/**
 * Route this process's `fetch` through `HTTPS_PROXY` before asking the board
 * anything: node's fetch does not read that variable, so in a container that
 * only reaches the network through a proxy every request answers 401 and the
 * gate refuses with `EXIT_PREREQUISITE_NOT_MET` -- loud and correct, one
 * re-exec short of an answer. The PLAN is imported (one implementation, in
 * `check-governed-merges.mjs`); only the guard variable is this file's.
 *
 * Three arms, and each one is an answer:
 *
 *   plan.hint   the route cannot be re-armed (the one re-exec was spent, or
 *               this node does not take the flag). SAY SO and carry on --
 *               a refusal below may be about the route, not the credential.
 *   plan.rearm  re-exec with the flag and ADOPT the child's exit code, so
 *               the verdict a caller reads is the re-armed run's verdict.
 *   re-exec failed   degrade in-process, and say plainly that every request
 *               from here on bypasses the proxy.
 *
 * ⛔ It never converts a failed read into a pass: the child runs this same
 * file, so an unreadable board still reaches `prerequisiteRefusal` below.
 *
 * @returns {number|null} the exit code to adopt, or null to continue here.
 */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

function prerequisiteRefusal(message) {
  console.error('❌ check-issue-citations: PREREQUISITE NOT MET — the board was not read.');
  console.error(`   ${message}`);
  console.error('   ⛔ Nothing below is a reading. "could not resolve" and "resolves" are not the same answer,');
  console.error(`   and this exits ${EXIT_PREREQUISITE_NOT_MET} rather than 0 so a failed read can never pass for a clean tree.`);
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

export async function run({ root = process.cwd(), scope = 'diff', base = null, json = false, probeCause = false, ownerRepo = 'objectstack-ai/objectstack', strategy = 'auto' } = {}) {
  let resolvedBase = null;
  if (scope === 'diff') {
    const attempt = resolveDiffBase({ root, base });
    if (!attempt.base) prerequisiteRefusal(unresolvedBaseMessage(attempt));
    resolvedBase = attempt.base;
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
    /* The route is re-armed at the dispatch, BEFORE this read, so on any run
     * that could re-arm `plan.rearm` is already false here. What is left to say
     * is why it could not: the plan's `hint` arm names the spent guard or the
     * node that will not take the flag, and that sentence is the difference
     * between "the credential is bad" and "the request never left the box". */
    const plan = proxyRearmPlan({
      env: process.env,
      execArgv: process.execArgv,
      flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
      guard: PROXY_REARM_GUARD,
    });
    const route = plan.rearm || plan.hint ? ` (${plan.reason} — re-run with \`node ${PROXY_FLAG} …\` or NODE_USE_ENV_PROXY=1)` : '';
    prerequisiteRefusal(`${err.message}${route}`);
  }

  const transferProbe = probeCause ? await makeTransferProbe({ ownerRepo }) : null;
  const classified = [];
  for (const cite of rows) {
    let probed = null;
    if (transferProbe && namesThisRepository(cite, ownerRepo) && !board.has(cite.number) && cite.number <= board.frontier) {
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
  'scope-contract': 12,
  'diff-scope': 13,
  'live-corpus': 7,
  'proxy-rearm': 10,
  qualifier: 40,
  spellings: 56,
});

/** Deleting a roster entry silences its floor, so the roster's size is pinned too. */
const SELF_TEST_BATTERY_FLOOR = 9;

/**
 * ⭐ THE ONE ENUMERATION OF CITATION SPELLINGS (#20636). Every spelling this
 * gate has been measured against, each asserted either "extracted as" the
 * readings in `reads` -- `#N` is THIS repository's number, `owner/repo#N`
 * another repository's -- or, with `reads: []`, "not a citation, because" the
 * reason given. A grammar change that moves any row turns the `spellings`
 * battery red instead of becoming another card: `#N-word`, `#A/#B`, `option #N`,
 * `clause #N`, `re-charter #N` and the URL form were each a card's worth of
 * blind spot before this table (the family's first was #20330, `pre-#N`).
 *
 * Two completeness rules ride on it: every `NON_CITATION_HEADS` row must excuse
 * at least one row here (a head with no measured spelling is the retired rows'
 * failure over again), and every spelling in `REQUIRED_SPELLINGS` must appear.
 */
const SPELLING_TABLE = Object.freeze([
  /* Extracted. */
  { spelling: '#N', text: 'see #12248 for the ruling', reads: ['#12248'] },
  { spelling: '(#N)', text: 'it landed (#12248), then', reads: ['#12248'] },
  { spelling: '#N.', text: 'as ruled in #12248.', reads: ['#12248'] },
  { spelling: 'PR #N', text: 'the PR #8546 landed', reads: ['#8546'] },
  { spelling: 'owner/repo#N', text: 'see objectstack-ai/cloud#861', reads: ['objectstack-ai/cloud#861'] },
  { spelling: 'owner/repo#N naming this repository', text: 'objectstack-ai/objectstack#12248 says', reads: ['#12248'] },
  { spelling: 'repo#N', text: 'see objectui#4356 there', reads: ['objectstack-ai/objectui#4356'] },
  { spelling: 'former-name#N', text: 'Framework#4443 said', reads: ['#4443'] },
  { spelling: 'repo PR #N', text: '(objectui PR #10264, merged)', reads: ['objectstack-ai/objectui#10264'] },
  { spelling: 'pre-#N', text: 'the pre-#12248 shape', reads: ['#12248'] },
  { spelling: 'post-#N', text: 'the post-#12248 shape', reads: ['#12248'] },
  { spelling: 'word#N', text: 'see foo#12248', reads: ['#12248'] },
  { spelling: '#N-word', text: 'a #13398-class blind spot', reads: ['#13398'] },
  { spelling: '#N-letter', text: 'the disposition #5347-A', reads: ['#5347'] },
  { spelling: 'repo#N-letter', text: 'the ui#6206-B family', reads: ['objectstack-ai/objectui#6206'] },
  { spelling: 'prefix-#N-word', text: 'Post-#11663-L4 the invariant', reads: ['#11663'] },
  { spelling: '#A-B', text: 'issues #712-714 point there', reads: ['#712'],
    because: 'the second number of a range carries no `#`, and a `#`-less number is no citation spelling' },
  { spelling: '#A/#B', text: 'the same ruling #7737/#10629 made', reads: ['#7737', '#10629'] },
  { spelling: '#A/#B/#C', text: 'the #5611/#5775/#6276 rule', reads: ['#5611', '#5775', '#6276'] },
  { spelling: 'repo#A/#B', text: 'lists paginate (objectui#2711/#2722)', reads: ['objectstack-ai/objectui#2711', 'objectstack-ai/objectui#2722'],
    because: 'a slash JOINED to the number continues the chain, which carries its repository' },
  { spelling: 'prefix-#A/#B', text: 'pre-#3912/#3994 databases', reads: ['#3912', '#3994'] },
  { spelling: '#A/repo#B', text: 'the #3076/objectui#2614 pair', reads: ['#3076', 'objectstack-ai/objectui#2614'] },
  { spelling: 'repo#A / #B', text: 'objectui#2715 / #12248', reads: ['objectstack-ai/objectui#2715', '#12248'],
    because: 'a spaced slash stands alone, so the second number is read as written' },
  { spelling: 'repo#A + #B', text: 'objectui#6110 + #12248', reads: ['objectstack-ai/objectui#6110', '#12248'] },
  { spelling: 'TOKEN/#N', text: 'unscoped (ADR-0049/#1888)', reads: ['#1888'] },
  { spelling: 'option #N', text: 'the option #14088 gave', reads: ['#14088'] },
  { spelling: 'clause #N', text: 'the clause #18510 removed', reads: ['#18510'] },
  { spelling: 're-charter #N', text: 're-charter #13135 said', reads: ['#13135'] },
  { spelling: 'acceptance #N', text: 'the silent acceptance #6132 closed', reads: ['#6132'] },
  { spelling: '§ #N', text: "§6 #11176's decisions", reads: ['#11176'] },
  { spelling: 'URL', text: 'see https://github.com/objectstack-ai/objectstack/issues/17590 for it', reads: ['#17590'] },
  { spelling: 'URL /pull/', text: 'https://github.com/objectstack-ai/objectstack/pull/20554', reads: ['#20554'] },
  { spelling: 'URL, former name', text: 'https://github.com/objectstack-ai/framework/issues/4443', reads: ['#4443'] },
  { spelling: 'URL, another repository', text: 'https://github.com/objectstack-ai/objectui/issues/9048', reads: ['objectstack-ai/objectui#9048'] },
  { spelling: '[#N](URL)', text: '([#15325](https://github.com/objectstack-ai/objectstack/issues/15325))', reads: ['#15325'],
    because: "the link's target is the citation its text already carries, counted once" },
  /* Not a citation. */
  { spelling: '#N, one digit', text: 'acceptance #5 and #7', reads: [],
    because: 'below the two-digit floor: all 133 one-digit tokens measured were ordinals' },
  { spelling: '#N, seven digits', text: 'colour #1234567 here', reads: [], because: 'beyond six digits, where a hex colour lives' },
  { spelling: '#N followed by a letter', text: 'the colour #12ab34', reads: [], because: 'digits running into a letter are a hex colour' },
  { spelling: '##N', text: 'a ##12 heading', reads: [], because: 'a `#` before the `#` is a markdown heading marker' },
  { spelling: 'Prime Directive #N', text: 'Prime Directive #14 binds', reads: [], because: 'an AGENTS.md Prime Directive ordinal' },
  { spelling: 'Prefix-Directive-#N', text: 'a Prime-Directive-#12 shape', reads: [], because: 'a hyphen joining a head to its `#` is the same head' },
  { spelling: 'PD#N', text: 'which PD#12 rejects', reads: [], because: 'the abbreviated Prime Directive spelling' },
  { spelling: 'batch #N', text: 'decision batch #127 ruled', reads: [], because: 'a maintainer decision-batch ordinal (276 sites, none above #227)' },
  { spelling: 'OQ#N', text: 'ADR-0076 OQ#10 says', reads: [], because: "an ADR's open-question ordinal" },
  { spelling: 'PKCS#N', text: 'PKCS#11 HSMs', reads: [], because: "a standard's own numbering" },
  { spelling: '](#N-slug)', text: 'see [13. Risks](#13-risks--mitigations)', reads: [],
    because: "a markdown link's in-page heading anchor -- the one non-citation the hyphen exclusion covered" },
  { spelling: 'path/page#N', text: 'https://example.com/docs/page#12', reads: [],
    because: 'a qualifier candidate never starts mid-path, so a URL fragment is no citation' },
  { spelling: 'ordinal #A/#B', text: 'Prime Directive #12/#14', reads: [], because: 'a slash-joined continuation reads as its chain, here an ordinal' },
]);

/** The spellings the closeout card and its folded positions named; each must stay in the table. */
const REQUIRED_SPELLINGS = Object.freeze([
  '#N', 'owner/repo#N', 'pre-#N', 'post-#N', '#N-word', '#A/#B', '(#N)', '#N.',
  'option #N', 'clause #N', 're-charter #N', 'URL',
]);

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
    check(cites('re-charter #13135 said').join() === '#13135', 'a retired head reads no ordinal: `re-charter` measured only tracker numbers, and hid 26 dead ones');
    check(cites('see [13. Risks](#13-risks--mitigations)').length === 0, "a markdown link's in-page heading anchor is not a citation, hyphen or not");
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
    check(CENSUS_17512.resolves + CENSUS_17512.resolvesAsPull + CENSUS_17512.crossRepoUnjudged
      + Object.values(CENSUS_17512.unresolvableSites).reduce((a, b) => a + b, 0) === CENSUS_17512.citationsJudged,
    'the declared census must add up (resolves + pulls + cross-repo + unresolvable = citations judged)');
    check(CENSUS_17512.neighbourControl.goneSince.length === 3 && CENSUS_17512.neighbourControl.resolving.length === 1,
      "the card's own neighbour control must be carried as re-measured, not as filed");
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

      /* ⭐ THE BASE, both directions. The base decides WHICH diff is judged, so
       * a wrong one does not fail loudly -- it judges somebody else's change
       * and reports the answer as this one's. */
      const absent = '0'.repeat(40);
      check(resolveDiffBase({ root: tmp, base }).base === base,
        'a resolvable explicit base must be used verbatim -- it already IS the fork point');
      check(resolveDiffBase({ root: tmp, base: absent }).base === null,
        '⛔ a `--base` naming no commit here must answer null, NEVER be handed to `git diff` -- unverified, it throws, and an uncaught throw is a failed read wearing an unclassified exit code');
      const refusal = unresolvedBaseMessage(resolveDiffBase({ root: tmp, base: absent }));
      check(refusal.includes(absent) && refusal.includes('--base <ref>') && refusal.includes('OS_GATE_MERGE_GROUP_BASE_SHA'),
        '...and the refusal must name the spelling that was TRIED and what to pass instead');
      check(resolveDiffBase({ root: tmp, env: { OS_GATE_MERGE_GROUP_BASE_SHA: base } }).base === base,
        'a runner-DECLARED merge-group base must become the base, so a queue build judges its own diff and not the entries ahead of it in the queue');
      check(resolveDiffBase({ root: tmp, env: { OS_GATE_MERGE_GROUP_BASE_SHA: absent } }).base === null,
        '⛔ ...and a declared base this checkout does not have must REFUSE, never fall back to a ref guess that would silently judge a different diff');
      check(baseSpellings({ env: {} }).map((s) => s.ref).join() === 'origin/main,main'
        && baseSpellings({ env: { OS_GATE_MERGE_GROUP_BASE_SHA: '' } }).map((s) => s.ref).join() === 'origin/main,main',
      'with nothing declared -- and on the events where that variable renders EMPTY -- the ref guesses are unchanged, so `pull_request` and `push` keep the base they already had');
      check(/if \(!attempt\.base\) prerequisiteRefusal\(unresolvedBaseMessage\(attempt\)\);/.test(readFileSync(SELF_PATH, 'utf8')),
        'structural: the null answer must reach `prerequisiteRefusal` -- exit 3, never 0 and never an uncaught throw');
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
    check(live.rows.every((r) => !r.qualifier || repositoryOf(r.qualifier) !== null),
      'every qualifier the live corpus keeps must name a repository — an unrecognised one kept is the open grammar back');
    /* The three arms the #20636 closeout opened each reach the tree -- the
     * floor that tells "no such spelling left" from "the arm went blind". A
     * row counts only when its number is spelled ONCE on its line, so the same
     * number cited elsewhere on that line cannot stand in for the arm. */
    const once = (r) => (r.context.match(new RegExp(`#${r.number}(?!\\d)`, 'g')) ?? []).length === 1;
    check(live.rows.some((r) => once(r) && new RegExp(`#${r.number}-[A-Za-z]`).test(r.context)),
      'the live corpus must yield a `#N-word` citation — the hyphen arm reaching the tree');
    check(live.rows.some((r) => once(r) && new RegExp(`\\d/#${r.number}(?!\\d)`).test(r.context)),
      'the live corpus must yield a slash-joined `#A/#B` second number — the continuation reaching the tree');
    check(live.rows.some((r) => /^https?:\/\//.test(r.raw)),
      'the live corpus must yield a URL-spelled citation — the URL arm reaching the tree');
  }

  /* 7. THE LOCAL ROUTE. Offline, over the imported plan: the arms that decide
   *    whether a live run re-execs, and the guard-name mix-up whose only
   *    symptom is a 401 blamed on the token. ⛔ Nothing here re-execs anything —
   *    a self-test that spawned a child would be a self-test with a network. */
  battery('proxy-rearm');
  {
    const PATROL_GUARD = 'OS_HALF_STATES_PROXY_REARMED';
    const proxied = { HTTPS_PROXY: 'http://127.0.0.1:1' };
    const rearm = (env) => proxyRearmPlan({ env, guard: PROXY_REARM_GUARD, flagSupported: true });
    const own = { ...proxied, [PROXY_REARM_GUARD]: '1' };
    const ownSource = readFileSync(SELF_PATH, 'utf8');
    check(PROXY_REARM_GUARD !== PATROL_GUARD, "this gate's guard must be its own name, never the patrol's");
    check(proxyRearmPlan({ env: { ...proxied, [PATROL_GUARD]: '1' } }).guarded === PATROL_GUARD,
      "…and the patrol name pinned here IS the plan's default, so a rename reds this battery rather than passing it");
    check(rearm(proxied).rearm === true && rearm(proxied).flag === PROXY_FLAG,
      'a proxied container with this guard unset must RE-EXEC — advising the operator is what this card was filed about');
    check(rearm({ ...proxied, [PATROL_GUARD]: '1' }).rearm === true,
      "a sibling instrument's inherited guard must NOT answer for this one — that silence is the 401-blamed-on-the-token failure");
    check(rearm(own).rearm === false && rearm(own).hint === true, 'having re-armed once, this gate must not loop');
    check(rearm(own).reason.includes(PROXY_REARM_GUARD), '…and must name the variable a reader has to unset');
    check(rearm({}).rearm === false && rearm({}).hint === false,
      'the Actions-runner leg is unchanged: no proxy, no re-exec, not one extra line of output');
    check(/\n\s+guard: PROXY_REARM_GUARD,\n/.test(ownSource), "structural: the dispatch really hands the plan THIS file's guard");
    check(/\bproxyRearmPlan\b/.test(ownSource) && !/function\s+proxyRearmPlan\b/.test(ownSource),
      'structural: the plan is imported, not restated here');
    check(/\} else if \(flag\('--list'\)\) list\(\);\n\s*else \{\n\s+const rearmed = rearmThroughProxy\(argv\);/.test(ownSource),
      'structural: the re-exec is taken by the LIVE modes only — never --self-test (offline, and pinned offline), never --list (no network at all)');
  }

  /* 8. THE QUALIFIER (#20330). A candidate names a repository only when it is
   *    `owner/repo` or a `KNOWN_REPOSITORIES` name; any other prefix is prose
   *    and its number is judged HERE. Every spelling is pinned both ways: read
   *    right on a live number, and a FINDING on a dead one. */
  battery('qualifier');
  {
    const OWN = 'objectstack-ai/objectstack';
    const board = boardFromSets({ numbers: [100, 20330], pulls: [], frontier: 30000, source: 'stub' });
    const one = (t) => extractCitations(t);
    const judge = (t) => one(t).map((c) => classifyCitation(c, board, { ownerRepo: OWN }).cause);
    const lit = (t) => judge(t).join() === CAUSE.RESOLVES;
    const red = (t) => { const causes = judge(t); return causes.length === 1 && FINDING_CAUSES.includes(causes[0]); };

    for (const p of ['pre-', 'post-', 'Pre-', 'Post-', 'PRE-', 'POST-']) {
      check(one(`the ${p}#12248 shape`).map((c) => `${c.qualifier}|${c.raw}`).join() === 'null|#12248',
        `\`${p}\` is prose, not a repository: its number is extracted bare`);
      check(lit(`the ${p}#100 shape`) && red(`the ${p}#12248 shape`),
        `\`${p}#N\` is judged HERE: a live number resolves and a dead one is a FINDING`);
    }

    check(one('Framework#4443 / cloud#983').map((c) => repositoryOf(c.qualifier)).join() === `${OWN},objectstack-ai/cloud`,
      '`Framework` is THIS repository (its former name, any case); `cloud` is not');
    for (const q of ['framework', 'Framework', 'objectstack-ai/framework', 'objectstack']) {
      check(lit(`${q}#100`) && red(`${q}#12248`), `\`${q}#N\` names THIS repository: judged, lit when live and red when dead`);
    }
    for (const q of ['objectui', 'OBJECTUI', 'ui', 'cloud', 'hotcrm', 'objectstack-ai/objectui', 'better-auth/better-auth']) {
      check(judge(`${q}#12248`).join() === CAUSE.CROSS_REPO_UNJUDGED,
        `\`${q}#N\` names another repository: never judged, so a number dead HERE is no finding`);
    }
    check(one('see foo#12248')[0]?.qualifier === null && red('see foo#12248'),
      'an UNKNOWN word prefix is prose too — the set of repositories is closed, not a list of exceptions');
    for (const t of ['which PD#12 rejects', 'ADR-0076 OQ#10 says', 'PKCS#11 HSMs', 'a Prime-Directive-#12 shape']) {
      check(one(t).length === 0, `\`${t}\` is an ordinal once its candidate is refused, not a citation`);
    }

    check(one('(objectui PR #10264, merged)').map((c) => `${c.qualifier}|${c.raw}`).join() === 'objectui|objectui PR #10264',
      'the prose spelling `objectui PR #N` names objectui');
    check([judge('(objectui PR #12248)'), judge('cloud #12248 contract'), judge('objectui issue #12248')]
      .every((c) => c.join() === CAUSE.CROSS_REPO_UNJUDGED), 'the prose form defers to its repository, dead here or not');
    check(lit('framework #100') && red('framework #12248'), 'the prose form of THIS repository is judged here');
    check(red('the PR #12248 landed') && red('Studio UI #12248'),
      '⛔ a bare `PR #N`, and the joined-only alias in `UI #N`, are NOT the prose form: judged here, red when dead');

    check(judge('objectui#6110 + #12248').join() === `${CAUSE.CROSS_REPO_UNJUDGED},${CAUSE.ALLOCATED_BUT_ABSENT}`,
      "⛔ a qualifier does NOT carry across a pair: the second number is this repository's, and red when dead");
    check(judge('objectui#6110 + objectui#12248').join() === `${CAUSE.CROSS_REPO_UNJUDGED},${CAUSE.CROSS_REPO_UNJUDGED}`,
      'a pair qualified number by number defers both');

    const rows = [{ number: 20330, qualifier: 'framework' }, { number: 11, qualifier: 'objectui' }, { number: 12, qualifier: null }];
    check(boardWanted(rows, OWN).sort((a, b) => a - b).join() === '12,20330',
      "the board's probe set is every citation judged HERE — a qualified this-repository number in, another repository's out");
    const probed = await probeBoard(boardWanted([{ number: 20330, qualifier: 'objectstack' }], OWN), {
      ownerRepo: OWN, token: '',
      fetchImpl: stubFetch([[/per_page=1/, { body: [{ number: 30000 }] }], [/issues\/20330$/, { body: { number: 20330 } }]]),
    });
    check(classifyCitation({ number: 20330, qualifier: 'objectstack' }, probed, { ownerRepo: OWN }).cause === CAUSE.RESOLVES,
      '⛔ a live `objectstack#N` RESOLVES on a probed board — probing only the unqualified numbers answered it allocated-but-absent, a false red');
    check(/const wanted = boardWanted\(rows, ownerRepo\);/.test(readFileSync(SELF_PATH, 'utf8')),
      'structural: the live board is built from `boardWanted`');

    check(KNOWN_REPOSITORIES.every((r) => r.name === r.name.toLowerCase() && typeof r.why === 'string' && r.why.length > 40),
      'every known repository is a lower-case name carrying the reading that put it in');
    check(KNOWN_REPOSITORIES.filter((r) => r.self).every((r) => r.slug === OWN) && KNOWN_REPOSITORIES.some((r) => r.self),
      'every name for THIS repository resolves to its slug');
  }

  /* 9. THE SPELLINGS (#20636). The one enumeration table, read row by row,
   *    then held complete against the heads and the required spellings. */
  battery('spellings');
  {
    const OWN = 'objectstack-ai/objectstack';
    const reads = (t) => extractCitations(t).map((c) => `${namesThisRepository(c, OWN) ? '' : repositoryOf(c.qualifier)}#${c.number}`);
    const excusedBy = (t) => [...t.matchAll(new RegExp(CITATION_RE.source, 'g'))]
      .map((m) => nonCitationHead(t.slice(0, m.index + m[0].length - m[3].length - 1))).filter(Boolean);
    for (const row of SPELLING_TABLE) {
      const got = reads(row.text);
      check(got.join() === row.reads.join(),
        `spelling \`${row.spelling}\` in ${JSON.stringify(row.text)} must read ${row.reads.length ? row.reads.join(', ') : 'as NOT a citation'}${row.because ? ` (${row.because})` : ''}; got ${got.length ? got.join(', ') : 'nothing'}`);
    }
    for (const head of NON_CITATION_HEADS) {
      check(SPELLING_TABLE.some((row) => row.reads.length === 0 && excusedBy(row.text).includes(head)),
        `the head row for ${head.why} must excuse at least one spelling in the table — a head with no measured spelling is a blind spot`);
    }
    const labels = new Set(SPELLING_TABLE.map((row) => row.spelling));
    check(REQUIRED_SPELLINGS.every((s) => labels.has(s)) && labels.size === SPELLING_TABLE.length,
      `the table must carry every required spelling once (missing: ${REQUIRED_SPELLINGS.filter((s) => !labels.has(s)).join(', ') || 'none'})`);
    check(SPELLING_TABLE.every((row) => row.reads.length > 0 || (typeof row.because === 'string' && row.because.length > 20)),
      'every "not a citation" row must say why');
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
  console.log(`✅ check-issue-citations --self-test: grammar narrowed, every spelling enumerated, qualifier a closed set of repositories, four 404 causes kept apart, both board strategies agree, diff scope red AND green, scope contract pinned (${total} cases, ${declared.length} batteries)`);
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
    const rearmed = rearmThroughProxy(argv);
    if (rearmed !== null) process.exit(rearmed);
    process.exit(await run({
      scope: flag('--census') ? 'census' : 'diff',
      base: value('--base'),
      json: flag('--json'),
      probeCause: flag('--probe-cause'),
      strategy: flag('--enumerate') ? 'enumerate' : 'auto',
    }));
  }
}
