#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * changeset-deadline-census — the census of open cards whose named
 * `.changeset/<name>.md` target has a hard, unwatched deadline (#16850).
 * REPORT-ONLY: it fails nothing and gates nothing.
 *
 *   node scripts/pm/changeset-deadline-census.mjs                 # live census
 *   node scripts/pm/changeset-deadline-census.mjs --json          # the same run, as one document
 *   node scripts/pm/changeset-deadline-census.mjs --issues-json p.json   # offline population
 *   node scripts/pm/changeset-deadline-census.mjs --self-test     # offline, no network at all
 *   node scripts/pm/changeset-deadline-census.mjs --help
 *
 * ## The class this measures
 *
 * A card of the shape 「a pending changeset carries a sentence the tree has
 * falsified」 is cheap to fix — one line in a `.changeset/*.md`, which the
 * Documentation Guardrails explicitly permit a PR to touch. It is cheap **only
 * until the next release cuts**: after that the sentence is compiled into
 * `packages/<pkg>/CHANGELOG.md`, published to npm, and the one-line edit is gone.
 * The card's own prose keeps asserting the file is "still pending" forever,
 * because prose does not re-measure itself — so the deadline is real, and
 * nothing watched it. #16850 measured three cards that blew it silently.
 *
 * ⛔ This file is deliberately NOT the enforcement half. #16850 lays out three
 * mechanisms and the dispatch ruling took option 1 — DETECT the consumption —
 * under this lane's standing rule: **report-only first, the census is the
 * deliverable, expansion only when the census reads zero including its blind
 * spot.** The population here (issue BODIES) is a new scan population, and a
 * new population is censused before anything is switched on.
 *
 * ## ⚠️ The measuring trap, and the controls that answer it
 *
 * `git ls-tree <ref> -- <path>` exits **0 even when nothing matches**, so the
 * `&& echo PRESENT` idiom reports PRESENT for a file that does not exist. ⛔ No
 * verdict here reads an exit code. Presence is a **line count** of
 * `git show <ref>:<path>` corroborated against a single `.changeset/` listing
 * read once per run — two instruments, neither of them a status.
 *
 * A zero is only a reading when a same-corpus positive control is non-zero, so
 * every run establishes three controls BEFORE it judges a row:
 *
 *   corpus    the `.changeset/` listing is non-empty
 *   positive  `.changeset/README.md` is in the listing AND reads ≥ 1 line
 *   negative  a synthetic path is absent from the listing AND reads 0 lines
 *
 * If any control fails the run REFUSES (`EXIT_PREREQUISITE_NOT_MET`) and
 * reports NOTHING about the board: with a broken reader every row would read
 * "consumed", which is the same silent-success shape the card was filed about.
 *
 * ## Absent ≠ consumed — the history leg
 *
 * A target absent from `<ref>` has two other explanations besides a release
 * having eaten it: it may live on an unmerged PR branch, or it may be proposed
 * and not yet written. Those carry no deadline at all, and calling them
 * "consumed" would inflate the very number this census exists to report. So an
 * absent path is asked one more question — did it land on `<ref>`? — through
 * `git log --diff-filter=A`, and the answer is only accepted inside a history
 * horizon proved by `historyHorizon()` (imported: agent containers clone
 * shallow, and shallow `git log` answers from truncated history at exit 0 with
 * no warning). Outside the horizon the row is `inconclusive`, never a guess,
 * and the run exits `EXIT_INCONCLUSIVE` so "not measured" cannot be read as
 * "clean" (#4690).
 *
 * ⚠️ The horizon is anchored PER ROW on the card's own `created_at`, and the
 * verdict is named for exactly what that proves: `not-landed-since-filed`. It
 * does NOT say the path never existed — a path consumed before its card was
 * even written would read the same, and no shallow clone can tell those apart.
 * What it does say is that no window opened and closed while the card was
 * waiting, which is the question #16850 asks.
 *
 * ## What a machine cannot decide here, printed every run
 *
 * ⚠️ **A mention is not a deliverable.** A card naming `.changeset/foo.md` may
 * be a card whose whole fix is one line in it, or a card that cites it as
 * historical precedent, or a reading table that happens to quote a filename.
 * Nothing in a body scan separates those, and this file does not pretend to: it
 * reports the state of the PATH and leaves the card's intent to the reader.
 * Two mechanical refinements narrow the noise without judging intent:
 *
 *   - a mention prefixed by a commit sha (`6acb37eb9:.changeset/foo.md`) is
 *     PINNED to history on purpose, so its absence from the tip is expected and
 *     it is bucketed away from the exposed rows;
 *   - a mention whose body ALSO asserts pendency in so many words ("still
 *     unconsumed", "still pending", …) is flagged `asserts-pending`. That flag
 *     is a HINT with a silent false-negative direction — a card can carry the
 *     deadline without using any of these phrases — ⛔ never a verdict. When it
 *     coincides with an absent target it is the highest-value row the census
 *     produces: a card asserting, right now, something the tree has falsified.
 *
 * The remaining blind spots are printed by every run rather than buried here:
 * bodies only (not comments), this board only (a named path may belong to a
 * sibling repo), and `window-open` means the FILE exists, never that the card's
 * sentence about it is still correct.
 *
 * ## Cost
 *
 * One listing page per 100 open items (measured 2026-09-09: 7 requests for 648
 * open items), one `ls-tree` of `.changeset/`, one `git show` per named path,
 * and one `git log` per ABSENT path. No write of any kind.
 *
 * ## Exit codes
 *
 *   0  the census was taken. Findings never fail this run — it is report-only.
 *   1  usage.
 *   2  at least one row is INCONCLUSIVE: the history leg could not be answered
 *      inside the proved horizon. Every other row still stands.
 *   3  PREREQUISITE NOT MET — a control failed, or the population could not be
 *      read. Nothing here is a reading about the board.
 */

import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { historyHorizon } from './git-history.mjs';
import { PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

/**
 * The re-exec guard, per script: two scripts sharing one guard name means the
 * first one's re-exec silently disarms the second's in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_CHANGESET_CENSUS_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCONCLUSIVE = 2;
export const EXIT_PREREQUISITE_NOT_MET = 3;

/** The ref the census is about. A reading is a count plus the tree it was taken against. */
export const DEFAULT_REF = 'origin/main';

/** The backstop on the open-issue listing — a ceiling that announces itself. */
export const LISTING_PAGE_CEILING = 25;

/**
 * Files under `.changeset/` that a release never consumes. They are checked in
 * and permanent, so a card naming one carries no deadline — and the first of
 * them is this census's own positive control.
 */
export const NON_PENDING_CHANGESET_FILES = Object.freeze(['README.md', 'config.json']);

/** The positive control: same corpus, same reader, known non-empty. */
export const POSITIVE_CONTROL_PATH = '.changeset/README.md';

/**
 * The negative control. Its only job is to be absent, so it is spelled to be
 * unwritable-by-accident rather than to be pretty.
 */
export const NEGATIVE_CONTROL_PATH = '.changeset/zzz-negative-control-no-such-changeset-16850.md';

/**
 * Phrases by which a body ASSERTS its target is still pending. A hint, ⛔ never
 * a verdict: the false-negative direction is silent, and a card can carry the
 * deadline in words nobody listed. Matched case-insensitively; the matched
 * phrase is printed on the row so a reader can check it rather than trust it.
 */
export const PENDING_ASSERTION_PHRASES = Object.freeze([
  'still unconsumed',
  'still pending',
  'not yet consumed',
  'unconsumed',
  'before the release',
  'still on `main`',
  'is on `main`',
  'window is still open',
  'pending changeset',
  'the changeset is still',
]);

// ---------------------------------------------------------------------------
// Pure core — everything below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/**
 * Concrete `.changeset/<name>.md` paths named in a body, in order of first
 * occurrence. The character class deliberately excludes `*`, `<` and `>`, so
 * the glob (`.changeset/*.md`), the placeholder (`.changeset/<name>.md`) and
 * the directory form (`.changeset/**`) are NOT members: none of them names a
 * file whose presence could be measured, and counting them would manufacture
 * population out of prose.
 */
const MENTION_RE = /(^|[\s\S]?)\.changeset\/([A-Za-z0-9._-]+\.md)\b/g;

/** A mention prefixed by a commit sha is pinned to history on purpose. */
const SHA_PREFIX_RE = /\b[0-9a-f]{7,40}:$/;

export function namedChangesetTargets(body) {
  const text = String(body ?? '');
  const byPath = new Map();
  MENTION_RE.lastIndex = 0;
  let m;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const name = m[2];
    const path = `.changeset/${name}`;
    const at = m.index + m[1].length;
    const before = text.slice(Math.max(0, at - 41), at);
    const pinned = SHA_PREFIX_RE.test(before);
    const seen = byPath.get(path);
    if (seen === undefined) byPath.set(path, { path, name, mentions: 1, everUnpinned: !pinned });
    else {
      seen.mentions += 1;
      if (!pinned) seen.everUnpinned = true;
    }
  }
  return [...byPath.values()];
}

/** The pendency assertion a body makes in so many words, or null. A HINT. */
export function assertedPendingPhrase(body) {
  const text = String(body ?? '').toLowerCase();
  for (const phrase of PENDING_ASSERTION_PHRASES) if (text.includes(phrase)) return phrase;
  return null;
}

/**
 * The three controls, judged together. `ok: false` is a REFUSAL to say anything
 * about the board — with a broken reader every row reads "consumed".
 */
export function controlsVerdict({ listing, positiveLines, negativeLines }) {
  const failures = [];
  const paths = new Set(listing ?? []);
  if (!Array.isArray(listing) || listing.length === 0) {
    failures.push(
      'corpus control: the `.changeset/` listing came back EMPTY. Either the ref does not resolve or the '
        + 'reader is broken; either way every target below would read absent for a reason that is not a release.',
    );
  }
  if (!paths.has(POSITIVE_CONTROL_PATH)) {
    failures.push(`positive control: ${POSITIVE_CONTROL_PATH} is not in the listing — the listing is not this corpus.`);
  }
  if (!(positiveLines > 0)) {
    failures.push(
      `positive control: ${POSITIVE_CONTROL_PATH} read ${positiveLines} line(s). A zero here means the READER `
        + 'returns zero for files that exist, so no zero below is a reading.',
    );
  }
  if (paths.has(NEGATIVE_CONTROL_PATH) || negativeLines !== 0) {
    failures.push(
      `negative control: ${NEGATIVE_CONTROL_PATH} read ${negativeLines} line(s) / listing hit `
        + `${paths.has(NEGATIVE_CONTROL_PATH)} — a path that cannot exist must read absent.`,
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * The verdict for one named path. Pure over already-taken readings, so the
 * self-test drives the whole truth table without git or network.
 *
 *   permanent               a release never consumes it (README.md, config.json)
 *   window-open             present on the ref — the one-line edit is still available
 *   consumed                absent, and it DID land on the ref: a release ate it
 *   not-landed-since-filed  absent, and it has not landed on the ref at any
 *                           point since the card was filed — an unmerged branch,
 *                           a proposal, or a path that predates the card
 *   inconclusive            absent, and the horizon does not reach the card
 */
export function classifyTarget({ path, lines, inListing, addCommit, horizonCovered }) {
  const base = String(path ?? '').replace(/^\.changeset\//, '');
  if (NON_PENDING_CHANGESET_FILES.includes(base)) return 'permanent';
  const present = lines > 0 || inListing === true;
  if (present) return 'window-open';
  if (addCommit) return 'consumed';
  if (horizonCovered) return 'not-landed-since-filed';
  return 'inconclusive';
}

/** Rows whose absence is a closed window a card may still be relying on. */
export const EXPOSED_VERDICTS = Object.freeze(['consumed']);

/**
 * Assemble the census from already-taken readings. `issues` are REST issue
 * shapes (PRs already filtered out by the caller); `readingFor(path, issue)`
 * returns `{ lines, inListing, addCommit, horizonCovered }` — the issue is
 * passed because the horizon is anchored on the CARD's own filing date.
 */
export function censusFrom({ issues, readingFor }) {
  const rows = [];
  for (const issue of issues ?? []) {
    const targets = namedChangesetTargets(issue.body);
    if (targets.length === 0) continue;
    const asserted = assertedPendingPhrase(issue.body);
    for (const target of targets) {
      const reading = readingFor(target.path, issue) ?? {};
      rows.push({
        issue: issue.number,
        title: String(issue.title ?? ''),
        path: target.path,
        mentions: target.mentions,
        shaPinnedOnly: !target.everUnpinned,
        assertsPending: asserted,
        lines: reading.lines ?? 0,
        inListing: reading.inListing === true,
        addCommit: reading.addCommit ?? null,
        verdict: classifyTarget({ path: target.path, ...reading }),
      });
    }
  }
  rows.sort((a, b) => b.issue - a.issue || a.path.localeCompare(b.path));
  const tally = {};
  for (const row of rows) tally[row.verdict] = (tally[row.verdict] ?? 0) + 1;
  const cards = new Set(rows.map((r) => r.issue));
  const exposed = rows.filter((r) => EXPOSED_VERDICTS.includes(r.verdict) && !r.shaPinnedOnly);
  return {
    rows,
    tally,
    cardCount: cards.size,
    pathCount: new Set(rows.map((r) => r.path)).size,
    exposed,
    falsifiedAssertions: exposed.filter((r) => r.assertsPending !== null),
    inconclusive: rows.filter((r) => r.verdict === 'inconclusive'),
  };
}

/** The blind spots, printed by every run — a census that hides them is not one. */
export const BLIND_SPOTS = Object.freeze([
  'BODIES ONLY — a target named in a card COMMENT rather than its body is invisible here.',
  'THIS BOARD ONLY — a named path may belong to a sibling repo (objectui / cloud), where its state differs.',
  'A MENTION IS NOT A DELIVERABLE — the census reports the state of the PATH; whether the card\'s fix IS that line is the reader\'s call.',
  '`window-open` means the FILE exists, never that the card\'s sentence about it is still correct.',
  '`asserts-pending` is a phrase HINT with a silent false-negative direction — a card can carry the deadline in words nobody listed.',
]);

// ---------------------------------------------------------------------------
// Reading layer — git
// ---------------------------------------------------------------------------

function git(args, { cwd, allowFail = true } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

/** Every path under `.changeset/` on the ref. Read ONCE per run. */
export function readChangesetListing(cwd, ref) {
  const out = git(['ls-tree', '-r', '--name-only', ref, '--', '.changeset'], { cwd });
  if (out === null) return null;
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Lines of `<ref>:<path>`. ⛔ The exit status is deliberately not consulted:
 * this is the line-count form, and an absent file reads 0.
 */
export function countLines(cwd, ref, path) {
  const out = git(['show', `${ref}:${path}`], { cwd });
  if (out === null || out === '') return 0;
  return out.endsWith('\n') ? out.split('\n').length - 1 : out.split('\n').length;
}

/** The commit that ADDED this path on the ref, inside whatever history is present. */
export function addCommitFor(cwd, ref, path) {
  const out = git(['log', '--diff-filter=A', '--format=%h %cI', '-1', ref, '--', path], { cwd });
  const line = (out ?? '').trim();
  if (!line) return null;
  const [sha, date] = line.split(/\s+/);
  return { sha, date };
}

// ---------------------------------------------------------------------------
// Reading layer — REST
// ---------------------------------------------------------------------------

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
  });
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Every OPEN issue on the board. ⛔ The `Link: rel="next"` cursor is not
 * followed — it is measured to exhaust early on this board; page numbers are
 * walked to a short page instead, and the total is reconciled against the
 * repo's own `open_issues_count` so an enumeration that quietly stopped short
 * cannot pass for a complete one.
 */
async function listOpenIssues(repo, stats) {
  const items = [];
  let exhausted = false;
  for (let page = 1; page <= LISTING_PAGE_CEILING; page++) {
    const batch = await rest(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
    stats.listingRequests += 1;
    if (!Array.isArray(batch)) break;
    items.push(...batch);
    if (batch.length < 100) { exhausted = true; break; }
  }
  stats.truncated = !exhausted;
  stats.openItems = items.length;
  stats.openPulls = items.filter((i) => i.pull_request).length;
  return items.filter((i) => !i.pull_request);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function usage() {
  console.log(
    'changeset-deadline-census — open cards whose named `.changeset/*.md` target may already be consumed (#16850).\n\n'
      + '  node scripts/pm/changeset-deadline-census.mjs [--ref=<ref>] [--json]\n'
      + '  node scripts/pm/changeset-deadline-census.mjs --issues-json <file|->   # offline population\n'
      + '  node scripts/pm/changeset-deadline-census.mjs --self-test\n\n'
      + 'REPORT-ONLY. Exit 0 census taken · 1 usage · 2 a row is inconclusive · 3 prerequisite not met.\n',
  );
}

export const KNOWN_FLAGS = Object.freeze(['--json', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['ref', 'issues-json']);

export function readOption(argv, name, fallback) {
  const prefix = `--${name}=`;
  const hit = (argv ?? []).find((a) => a.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
}

export function unknownArgs(argv) {
  return (argv ?? []).filter((a) => {
    if (KNOWN_FLAGS.includes(a)) return false;
    if (a.startsWith('--') && KNOWN_OPTIONS.some((o) => a.startsWith(`--${o}=`))) return false;
    return true;
  });
}

function renderRow(row) {
  const marks = [];
  if (row.shaPinnedOnly) marks.push('sha-pinned');
  if (row.assertsPending) marks.push(`asserts-pending:"${row.assertsPending}"`);
  const evidence = row.verdict === 'consumed'
    ? `added ${row.addCommit.sha} ${row.addCommit.date.slice(0, 10)}, now 0 lines`
    : row.verdict === 'window-open'
      ? `${row.lines} line(s) on the ref`
      : row.verdict === 'permanent'
        ? `${row.lines} line(s), never consumed by a release`
        : row.verdict === 'not-landed-since-filed'
          ? '0 lines, and no add-commit on the ref since this card was filed'
          : '0 lines, and the history horizon does not reach this card — NOT MEASURED';
  return `  #${row.issue}  ${row.verdict.padEnd(20)} ${row.path}\n`
    + `        ${evidence}${marks.length ? `  [${marks.join(' · ')}]` : ''}\n`
    + `        ${row.title.slice(0, 96)}`;
}

async function run(argv) {
  const strays = unknownArgs(argv);
  if (strays.length) {
    console.error(`❌ unknown argument(s): ${strays.join(' ')}`);
    usage();
    return EXIT_USAGE;
  }
  const asJson = argv.includes('--json');
  const ref = readOption(argv, 'ref', DEFAULT_REF);
  const issuesJson = readOption(argv, 'issues-json', null);
  const cwd = process.cwd();
  const repoRes = resolveSweepRepo(process.env);
  const stats = { listingRequests: 0, openItems: 0, openPulls: 0, truncated: false };

  // ── population ──────────────────────────────────────────────────────────
  let issues;
  try {
    if (issuesJson !== null) {
      const raw = issuesJson === '-' ? readFileSync(0, 'utf8') : readFileSync(issuesJson, 'utf8');
      const parsed = JSON.parse(raw);
      const all = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);
      stats.openItems = all.length;
      stats.openPulls = all.filter((i) => i.pull_request).length;
      issues = all.filter((i) => !i.pull_request);
    } else {
      issues = await listOpenIssues(repoRes.repo, stats);
    }
  } catch (err) {
    console.error(`❌ PREREQUISITE NOT MET: the open-issue population could not be read — ${err.message}`);
    console.error('   Nothing here is a reading about the board.');
    return EXIT_PREREQUISITE_NOT_MET;
  }
  if (issues.length === 0) {
    console.error('❌ PREREQUISITE NOT MET: the population came back EMPTY. A board with no open issues and a '
      + 'listing that silently failed are the two readings this refusal keeps apart.');
    return EXIT_PREREQUISITE_NOT_MET;
  }

  // ── controls, before any row is judged ──────────────────────────────────
  const listing = readChangesetListing(cwd, ref);
  const controls = controlsVerdict({
    listing: listing ?? [],
    positiveLines: countLines(cwd, ref, POSITIVE_CONTROL_PATH),
    negativeLines: countLines(cwd, ref, NEGATIVE_CONTROL_PATH),
  });
  if (!controls.ok) {
    console.error(`❌ PREREQUISITE NOT MET: the reader failed its own controls against '${ref}'.\n`);
    for (const f of controls.failures) console.error(`   ✗ ${f}`);
    console.error('\n   ⛔ No row is reported: with a broken reader every target reads "consumed".');
    return EXIT_PREREQUISITE_NOT_MET;
  }

  // ── readings ────────────────────────────────────────────────────────────
  const listingSet = new Set(listing);
  const tip = (git(['rev-parse', ref], { cwd }) ?? '').trim().slice(0, 10);
  // The horizon is anchored on the CARD's own filing date, so it is resolved
  // per distinct date rather than once — a 2026-06 card and a 2026-09 card ask
  // different questions of the same shallow clone, and collapsing them to the
  // oldest would report the newer one as unmeasured when it is not.
  const horizons = new Map();
  const horizonFor = (iso) => {
    if (!horizons.has(iso)) horizons.set(iso, historyHorizon({ cwd, ref, sinceMs: Date.parse(iso) }));
    return horizons.get(iso);
  };
  const oldestCardIso = issues.reduce((a, i) => (i.created_at && i.created_at < a ? i.created_at : a), '9999-12-31T00:00:00Z');
  const floorHorizon = horizonFor(oldestCardIso);
  const cache = new Map();
  const readingFor = (path, issue) => {
    if (!cache.has(path)) {
      const lines = countLines(cwd, ref, path);
      const inListing = listingSet.has(path);
      cache.set(path, { lines, inListing, addCommit: (lines === 0 && !inListing) ? addCommitFor(cwd, ref, path) : null });
    }
    const base = cache.get(path);
    const needsHorizon = base.lines === 0 && !base.inListing && !base.addCommit;
    const iso = issue?.created_at ?? oldestCardIso;
    return { ...base, horizonCovered: needsHorizon ? horizonFor(iso).covered === true : true };
  };
  const census = censusFrom({ issues, readingFor });

  // ── report ──────────────────────────────────────────────────────────────
  if (asJson) {
    console.log(JSON.stringify({
      board: repoRes.repo,
      boardSource: repoRes.source,
      ref,
      refSha: tip,
      historyFloor: floorHorizon.floor,
      historyCovered: floorHorizon.covered,
      changesetCorpusFiles: listing.length,
      openIssuesScanned: issues.length,
      openPullsFiltered: stats.openPulls,
      listingTruncated: stats.truncated,
      ...census,
      blindSpots: BLIND_SPOTS,
    }, null, 2));
  } else {
    console.log(`changeset-deadline-census — board ${repoRes.repo} (via ${repoRes.source}), ref '${ref}' = ${tip}`);
    console.log(`  corpus: ${listing.length} file(s) under .changeset/ · controls: positive ${POSITIVE_CONTROL_PATH} non-empty, negative absent — both held`);
    console.log(`  history: floor ${floorHorizon.floor ?? 'none (complete clone)'} — the horizon is anchored per row on the card's own filing date; oldest card in the population ${oldestCardIso.slice(0, 10)}`);
    console.log(`  population: ${issues.length} open issue(s) scanned (${stats.openPulls} open PR(s) filtered out${stats.truncated ? ', ⚠️ LISTING TRUNCATED' : ''})\n`);
    console.log(`⭐ CENSUS: ${census.cardCount} open card(s) name ${census.pathCount} concrete .changeset/*.md path(s).`);
    const tallyLine = Object.entries(census.tally).map(([k, v]) => `${k} ${v}`).join(' · ');
    console.log(`   verdicts: ${tallyLine || '(none)'}`);
    console.log(`   exposed (absent, not sha-pinned): ${census.exposed.length}`);
    console.log(`   of those, asserting pendency in prose the tree has falsified: ${census.falsifiedAssertions.length}\n`);
    if (census.falsifiedAssertions.length) {
      console.log('⚠️  CARDS ASSERTING A WINDOW THAT IS CLOSED:');
      for (const row of census.falsifiedAssertions) console.log(renderRow(row));
      console.log('');
    }
    console.log('ALL ROWS:');
    for (const row of census.rows) console.log(renderRow(row));
    console.log('\nBLIND SPOTS (this census does not see):');
    for (const spot of BLIND_SPOTS) console.log(`  · ${spot}`);
    console.log('\nREPORT-ONLY: nothing here fails a build. #16850 takes the census before anything is enforced.');
  }
  if (census.inconclusive.length) {
    console.error(`\n⚠️  ${census.inconclusive.length} row(s) INCONCLUSIVE — the history leg was outside the proved horizon.`);
    if (floorHorizon.remedy) console.error(`   remedy: ${floorHorizon.remedy}`);
    return EXIT_INCONCLUSIVE;
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const SELF_TEST_VERDICT = 'changeset-deadline-census self-test reached its verdict';

// The roster and its floor (#13489): what is pinned is the registered NAMES,
// not a total. A battery below its floor means cases STOPPED RUNNING, and the
// remedy is to find what stopped registering — ⛔ never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'population extraction — what counts as a named target': 14,
  'the measuring trap — controls, and the refusal when one fails': 10,
  'the verdict truth table': 9,
  'assembly, buckets and the printed blind spots': 10,
  'the CLI surface': 6,
});
const SELF_TEST_BATTERY_FLOOR = 5;
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  let failed = 0;
  const t = (name, actual, expected) => {
    registerCase();
    if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`  ✓ ${name}`);
    else {
      failed++;
      console.error(`  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
    }
  };

  // ── population extraction ───────────────────────────────────────────────
  battery('population extraction — what counts as a named target');
  const paths = (body) => namedChangesetTargets(body).map((x) => x.path);
  t('a bare mention is a target', paths('see .changeset/foo-bar.md for it'), ['.changeset/foo-bar.md']);
  t('a backticked mention is the same target', paths('`.changeset/foo-bar.md`'), ['.changeset/foo-bar.md']);
  t('two mentions of one path collapse to one target', namedChangesetTargets('.changeset/a.md and .changeset/a.md')[0].mentions, 2);
  t('two different paths are two targets', paths('.changeset/a.md .changeset/b.md'), ['.changeset/a.md', '.changeset/b.md']);
  t('⛔ the GLOB is not a target', paths('every PR adds a `.changeset/*.md`'), []);
  t('⛔ the PLACEHOLDER is not a target', paths('a line in `.changeset/<name>.md`'), []);
  t('⛔ the directory form is not a target', paths('editing `.changeset/**` pulls two gates in'), []);
  t('⛔ a non-.md file under .changeset is not a target', paths('.changeset/config.json'), []);
  t('a dotted/underscored name is a target', paths('.changeset/a_b.c-d.md'), ['.changeset/a_b.c-d.md']);
  t('an empty body yields nothing', paths(''), []);
  t('a null body yields nothing', paths(null), []);
  const pinned = namedChangesetTargets('git show 6acb37eb9:.changeset/org-hierarchy-timezone-columns.md');
  t('a sha-prefixed mention is pinned to history', pinned[0].everUnpinned, false);
  t('⛔ `origin/main:` is NOT a sha pin — it names the tip', namedChangesetTargets('git show origin/main:.changeset/seed-locale-axis.md')[0].everUnpinned, true);
  t('one unpinned mention un-pins the path even when another is pinned',
    namedChangesetTargets('d8024f050e:.changeset/a.md — and `.changeset/a.md` is the target')[0].everUnpinned, true);

  // ── the measuring trap ──────────────────────────────────────────────────
  battery('the measuring trap — controls, and the refusal when one fails');
  const goodListing = [POSITIVE_CONTROL_PATH, '.changeset/live-one.md'];
  t('all three controls holding is a pass',
    controlsVerdict({ listing: goodListing, positiveLines: 8, negativeLines: 0 }).ok, true);
  t('an EMPTY listing refuses', controlsVerdict({ listing: [], positiveLines: 8, negativeLines: 0 }).ok, false);
  t('…and says so in the corpus control',
    controlsVerdict({ listing: [], positiveLines: 8, negativeLines: 0 }).failures.some((f) => f.startsWith('corpus control')), true);
  t('a positive control reading ZERO refuses — the reader returns 0 for files that exist',
    controlsVerdict({ listing: goodListing, positiveLines: 0, negativeLines: 0 }).ok, false);
  t('…and the refusal names the reader, not the board',
    controlsVerdict({ listing: goodListing, positiveLines: 0, negativeLines: 0 }).failures.some((f) => f.includes('no zero below is a reading')), true);
  t('a positive control missing from the listing refuses',
    controlsVerdict({ listing: ['.changeset/live-one.md'], positiveLines: 8, negativeLines: 0 }).ok, false);
  t('a negative control that READS refuses — the reader invents content',
    controlsVerdict({ listing: goodListing, positiveLines: 8, negativeLines: 3 }).ok, false);
  t('a negative control present in the listing refuses',
    controlsVerdict({ listing: [...goodListing, NEGATIVE_CONTROL_PATH], positiveLines: 8, negativeLines: 0 }).ok, false);
  t('every control failure is reported, not just the first',
    controlsVerdict({ listing: [], positiveLines: 0, negativeLines: 5 }).failures.length >= 3, true);
  t('the negative control path is spelled so it cannot be created by accident',
    NEGATIVE_CONTROL_PATH.includes('no-such-changeset'), true);

  // ── the verdict truth table ─────────────────────────────────────────────
  battery('the verdict truth table');
  const v = (o) => classifyTarget({ path: '.changeset/x.md', lines: 0, inListing: false, addCommit: null, horizonCovered: true, ...o });
  t('present by line count is window-open', v({ lines: 27 }), 'window-open');
  t('present by LISTING alone is window-open too — two instruments, not one', v({ inListing: true }), 'window-open');
  t('absent with an add-commit is consumed', v({ addCommit: { sha: 'abc1234', date: '2026-09-08T10:55:45+00:00' } }), 'consumed');
  t('absent with no add-commit inside a covered horizon has not landed since filing', v({}), 'not-landed-since-filed');
  t('⛔ absent with no add-commit OUTSIDE the horizon is INCONCLUSIVE, never consumed',
    v({ horizonCovered: false }), 'inconclusive');
  t('README.md is permanent even when it reads', classifyTarget({ path: POSITIVE_CONTROL_PATH, lines: 8, inListing: true }), 'permanent');
  t('config.json is permanent', classifyTarget({ path: '.changeset/config.json', lines: 4, inListing: true }), 'permanent');
  t('a permanent file that somehow reads zero is still permanent, never consumed',
    classifyTarget({ path: POSITIVE_CONTROL_PATH, lines: 0, inListing: false, addCommit: { sha: 'a' } }), 'permanent');
  t('only `consumed` is an exposed verdict', EXPOSED_VERDICTS, ['consumed']);

  // ── assembly ────────────────────────────────────────────────────────────
  battery('assembly, buckets and the printed blind spots');
  const issues = [
    { number: 100, title: 'a live one', body: 'the fix is one line in `.changeset/open.md`, still unconsumed', created_at: '2026-09-01T00:00:00Z' },
    { number: 101, title: 'a blown one', body: '`.changeset/gone.md` is on `main` and still unconsumed', created_at: '2026-09-02T00:00:00Z' },
    { number: 102, title: 'a citation', body: 'precedent d8024f050e:.changeset/hist.md shipped the same shape', created_at: '2026-09-03T00:00:00Z' },
    { number: 103, title: 'no changeset at all', body: 'nothing here', created_at: '2026-09-04T00:00:00Z' },
  ];
  const readings = {
    '.changeset/open.md': { lines: 12, inListing: true, addCommit: null, horizonCovered: true },
    '.changeset/gone.md': { lines: 0, inListing: false, addCommit: { sha: '7f745c3', date: '2026-09-08T10:55:45+00:00' }, horizonCovered: true },
    '.changeset/hist.md': { lines: 0, inListing: false, addCommit: { sha: 'd8024f0', date: '2026-09-02T15:06:06+00:00' }, horizonCovered: true },
  };
  const c = censusFrom({ issues, readingFor: (p) => readings[p] });
  t('a card naming nothing is not in the population', c.cardCount, 3);
  t('every named path is a row', c.rows.length, 3);
  t('the tally counts each verdict', c.tally, { consumed: 2, 'window-open': 1 });
  t('a sha-pinned citation is NOT exposed', c.exposed.map((r) => r.issue), [101]);
  t('…and the falsified-assertion bucket is the exposed row that says so', c.falsifiedAssertions.map((r) => r.issue), [101]);
  t('the pendency phrase is carried on the row as evidence', c.falsifiedAssertions[0].assertsPending, 'still unconsumed');
  t('a card whose body asserts nothing carries a null hint',
    censusFrom({ issues: [{ number: 1, title: '', body: '.changeset/q.md' }], readingFor: () => readings['.changeset/open.md'] }).rows[0].assertsPending, null);
  t('the reading callback is handed the CARD, because the horizon is anchored on its filing date',
    censusFrom({ issues: [{ number: 7, title: '', body: '.changeset/q.md', created_at: '2026-05-01T00:00:00Z' }],
      readingFor: (p, issue) => ({ lines: 0, inListing: false, addCommit: null, horizonCovered: issue.created_at > '2026-08-01' }) }).rows[0].verdict,
    'inconclusive');
  t('rows are ordered newest card first', c.rows.map((r) => r.issue), [102, 101, 100]);
  t('the blind spots are printed, not buried — bodies-only is one of them',
    BLIND_SPOTS.some((s) => s.startsWith('BODIES ONLY')), true);

  // ── CLI ─────────────────────────────────────────────────────────────────
  battery('the CLI surface');
  t('a typo is an unknown argument', unknownArgs(['--jsom']), ['--jsom']);
  t('the known flags pass', unknownArgs(['--json', '--self-test']), []);
  t('an option with a value passes', unknownArgs(['--ref=origin/main']), []);
  t('the exit register is distinct', new Set([EXIT_OK, EXIT_USAGE, EXIT_INCONCLUSIVE, EXIT_PREREQUISITE_NOT_MET]).size, 4);
  const spawned = spawnSync(process.execPath, [SELF_PATH, '--nope'], { encoding: 'utf8' });
  t('an unknown flag exits usage without touching the network', spawned.status, EXIT_USAGE);
  t('…and --help exits 0', spawnSync(process.execPath, [SELF_PATH, '--help'], { encoding: 'utf8' }).status, EXIT_OK);

  // ── the floor ───────────────────────────────────────────────────────────
  const floorFailures = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailures.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const message of floorFailures) console.error(`  ✗ ${message}`);
  failed += floorFailures.length;

  if (failed) {
    console.error(`\n❌ changeset-deadline-census --self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ changeset-deadline-census --self-test: all cases passed across ${declared.length} batteries `
    + '(what counts as a named target, the controls that make a zero a reading, the verdict truth table '
    + 'including the inconclusive refusal, the buckets, and the CLI surface).');
  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process.`);
  return null;
}

const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error('\n✗ changeset-deadline-census self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test that never finished\n'
        + 'as a self-test that passed.\n');
      process.exit(1);
    }
  } else if (args.includes('--help') || args.includes('-h')) {
    usage();
  } else {
    const offline = args.some((a) => a.startsWith('--issues-json='));
    const rearmed = offline ? null : rearmThroughProxy(args);
    if (rearmed !== null) process.exit(rearmed);
    process.exit(await run(args));
  }
}
