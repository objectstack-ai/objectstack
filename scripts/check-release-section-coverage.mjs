#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-release-section-coverage — a PUBLISHED MINOR must appear on its major's
// release page, and the index must name the newest release of that major.
//
//   node scripts/check-release-section-coverage.mjs
//   node scripts/check-release-section-coverage.mjs --strict
//   node scripts/check-release-section-coverage.mjs --self-test
//
// ## The defect this closes — the half check-release-page-status cannot see
//
// `check-release-page-status.mjs` (#8892) asserts that a GA'd major's page SAYS
// it is released. Its predicate is keyed on the MAJOR: `releasedAssertionRe(17)`
// is satisfied by ANY `17.x.y` released-claim on the page. So a page that says
// "17.0.0 is released" passes forever, however many 17.x minors ship after it.
//
// Reconstructed from real history and measured on the base of this change — the
// v17 page and index as they stood between the 17.1.0 version commit and #10232,
// against today's CHANGELOG (which carries `## 17.1.0`):
//
//   $ node scripts/check-release-page-status.mjs   # in that reconstructed tree
//   EXIT=0
//   check-release-page-status: OK - 2 GA major(s) in scope (v16, v17); each
//   page's release-status blockquote and index entry describe a shipped release.
//
// The page carried NO `17.1` heading of any level and the index still read
// "(current series: 17.0.0, released 2026-08-14)". The gate certified both.
//
// This is the THIRD occurrence of the class: #8886/#8882 (v16 and v17 stale at
// the GA cut, which produced check:release-page-status), #8917 ("16.1.0 is
// documented on no page at all" — same defect, previous major, produced no
// gate), #10232 (17.1.0 published with a 69-package train and no section).
// `check:docs-image-tag`'s header states the threshold this clears: "Two
// occurrences of an identical drift is where a mechanical guard beats fixing the
// third one by hand."
//
// ## What is NOT mechanised here, and why that is the point
//
// Curated release prose cannot be generated from changesets without losing what
// makes it curated: #10232's 17.1.0 section took a full read of 69 package
// CHANGELOG sections (314 distinct entries) and real judgement about what is
// user-facing. This gate GENERATES NOTHING. It only detects the ABSENCE, from
// artifacts already in the tree, and says which minor is missing.
//
// ## Severity: findings are ADVISORY by default. This was measured, not assumed
//
// The obvious shape — fail the build when a published minor has no section — is
// rejected on evidence. Both gaps were timed from git history (the CHANGELOG
// heading lands in the version commit that publishes; the section lands whenever
// someone writes it):
//
//   minor    heading landed          section landed          gap        PRs
//   -------  ----------------------  ----------------------  ---------  -----
//   16.1.0   2026-07-22T00:56:45Z    2026-08-16T07:29:51Z    25d 6h33m  2712
//   17.1.0   2026-08-20T09:41:01Z    2026-08-20T15:24:58Z    5h 44m       36
//
// ("PRs" = squash-merge landings on `main` inside the window.) A hard failure
// would have red 2748 PRs for a debt not one of them created — and the 16.1.0
// row is the honest case, not the pathological one: it is what a normal month
// looks like when nobody has written the prose yet. Every hard-fail variant
// collapses to that same number:
//
//   • a `latest`-tag-only trigger — reproducible, but the tag moves in the same
//     commit the CHANGELOG heading does, so it fails at the identical instant.
//   • a shrink-only ledger seeded with today's uncovered minors — measured on
//     this tree, that seed is EMPTY (see "corpus" below), so the ledger
//     degenerates to a plain hard fail on the next minor.
//   • a grace window — time-dependent, so not reproducible in CI.
//
// So findings are reported, never fatal, and the run exits 0. That follows this
// repo's own precedent rather than inventing one. `half-state-patrol.yml`:
// "Findings never fail anything ... The job DOES fail when the sweep could not
// run" — because a half-state "is a fact about a live shared board, not about
// whichever PR happens to run CI next". An uncovered minor is a fact about the
// release history, not about whichever PR runs CI next. Same shape, same answer.
//
// Loud-but-non-blocking is `prerelease-pin-watch.yml`'s mechanism, reused here:
// a `::warning::` annotation plus a step-summary table, job GREEN. `--strict`
// promotes findings to exit 1 for a caller that OWNS the remedy (a standing
// patrol, or someone editing the release pages) — the same escape hatch that
// workflow's own `--strict` provides.
//
// ## What IS fatal: the instrument
//
// A gate that cannot measure must never report "nothing found". An unreadable or
// empty CHANGELOG parse, or a parse yielding no in-scope GA major, exits 1 in
// EVERY mode including advisory. That asymmetry is the whole design: silence
// about the corpus is loud, silence about the instrument is fatal.
//
// Page and index EXISTENCE are deliberately not re-asserted here.
// `check:release-notes` owns "a released major has a page" and
// `check:release-page-status` owns "the page and index entry exist and describe
// a shipped release". Two gates reporting one fact means two reds for one fix
// and two places to look; a missing page is noted and skipped instead.
//
// ## Scope — v16 and later, INHERITED from the sibling gate, and pinned
//
// The floor is not this gate's decision. check-release-page-status floors at v16
// under a maintainer ruling (2026-08-15, quoted verbatim in SCOPE_NOTE below),
// and a second gate reading the same pages under a different floor would be two
// answers to one question. Measured on this tree, below the floor assertion 1
// fires on 24 minors (v9 0/12, v12 0/7, v13 0/1, v14 5/9) and assertion 2 fires
// on three entries with no status parenthetical at all — so a gate that invented
// its own floor could only ship with a baseline, and "a new gate does not ship
// pre-compromised" is the sibling's rule. The self-test PINS the two floors
// equal by reading the sibling as text (never importing it: it runs its whole
// CLI at module load, which is why it is in KNOWN_IMPORT_UNSAFE), so moving one
// without the other fails here rather than drifting silently.
//
// ## Corpus at the time of writing (2026-08-21, base 699132f259)
//
// IN SCOPE: 4 GA minors — 16.0.0, 16.1.0, 17.0.0, 17.1.0 — all covered; both
// index entries current ("final release: 16.1.0", "current series: 17.1.0,
// released 2026-08-20"). Zero findings, so this lands green with no baseline,
// no ledger and no exception list.
//
// ## Two version traps, both live in the real corpus
//
//   1. MINOR 1 vs MINOR 10. Major 11 published both 11.1.0 and 11.10.0 (so did
//      major 9: 9.1.0 and 9.10.0/9.11.0). A `\b11\.1` match would read the
//      11.10.0 heading as coverage of 11.1. The matcher end-guards the minor.
//   2. `sort -V` IS NOT SEMVER — it ranks a prerelease ABOVE its release, so
//      `sort -V | tail -1` over `17.0.0` and `17.0.0-rc.6` answers `17.0.0-rc.6`.
//      Assertion 2 needs a newest-version comparison, which the sibling gate
//      avoided needing at all. It is done here as a numeric triple compare over
//      a GA-ONLY set (prereleases never enter it, because the heading regex is
//      end-anchored), so there is no prerelease left to mis-rank.
//
// ## Process note — this gate enforces a step the process already prescribes
//
// `docs/releases-maintenance.md` section 3 already says, under "Cadence that
// scales with rapid iteration":
//
//   "Minor / patch: do not add a page each. Fold them into the current major's
//    page under a 'What's new in N.x' running section, or leave them to the
//    generated per-package changelogs."
//
// So folding a minor into its major's page is already the documented first
// option — this gate makes the absence visible rather than inventing a new
// obligation. The trailing "or leave them to the generated per-package
// changelogs" is exactly why a finding here is a report and not a build failure:
// the process itself sanctions the other branch, and no gate should hard-fail a
// state its own process document permits.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

const SPEC_CHANGELOG = 'packages/spec/CHANGELOG.md';
const RELEASES_DIR = 'content/docs/releases';
const INDEX_PATH = `${RELEASES_DIR}/index.mdx`;
const SIBLING_GATE = 'scripts/check-release-page-status.mjs';

/** Inherited from check-release-page-status.mjs; the self-test pins them equal. */
const SCOPE_FLOOR_MAJOR = 16;

const SCOPE_NOTE =
  `Scope: v${SCOPE_FLOOR_MAJOR} and later ONLY, INHERITED from ${SIBLING_GATE} rather than chosen `
  + 'here — maintainer ruling 2026-08-15, quoted verbatim and untranslated: '
  + '「只负责 v16 以后的，需要的话之前的版本删除也可以的」. Below the floor this assertion has 24 '
  + 'uncovered minors to report (v9, v12, v13, v14), so inheriting the floor is what lets this gate '
  + 'ship with NO baseline and NO exception list. Do not move it without a new ruling, and do not '
  + 'move it on one gate only.';

const SEVERITY_NOTE =
  'Findings are ADVISORY: they never fail this run. A published minor whose section is not written '
  + 'yet is a fact about the release history, not about whichever PR runs CI next — measured, the '
  + 'two real gaps ran 5h44m (17.1.0) and 25 days (16.1.0), and hard-failing them would have red '
  + '2748 PRs that did not cause the debt. Pass --strict to make findings fatal for a caller that '
  + 'owns the remedy. Instrument failures are ALWAYS fatal, in every mode.';

// ── Instrument ───────────────────────────────────────────────────────────────

/**
 * Every GA (non-prerelease) version in the spec CHANGELOG, as numeric triples.
 *
 * End-anchored on purpose, exactly as the sibling gate's `gaMajors()` is: an
 * unanchored match also yields `17.0.0` out of `## 17.0.0-rc.0`, which would put
 * prereleases into the set that assertion 2 takes a maximum over.
 *
 * @param {string} changelogText
 * @returns {Array<[number, number, number]>} ascending, unique
 */
export function gaVersions(changelogText) {
  const seen = new Set();
  const out = [];
  const text = changelogText.replace(/\r\n?/g, '\n');
  for (const m of text.matchAll(/^##[^\S\n]+(\d+)\.(\d+)\.(\d+)[^\S\n]*$/gm)) {
    const key = `${m[1]}.${m[2]}.${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

/**
 * The `<major>.<minor>.0` releases — the unit a release-page section is written
 * for. A patch (15.1.1) folds into its minor's section and gets no heading of
 * its own, so demanding one would be a false red on every patch ever shipped.
 *
 * @param {Array<[number, number, number]>} versions
 * @returns {Array<[number, number]>}
 */
export function gaMinors(versions) {
  const seen = new Set();
  const out = [];
  for (const [maj, min, pat] of versions) {
    if (pat !== 0) continue;
    const key = `${maj}.${min}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([maj, min]);
  }
  return out;
}

/**
 * The newest GA version of `major`, or null.
 *
 * A numeric triple compare, NOT a string sort and NOT `sort -V` — see the header
 * trap 2. Safe because `versions` is GA-only by construction, so there is no
 * prerelease for a comparator to rank.
 *
 * @param {Array<[number, number, number]>} versions
 * @param {number} major
 * @returns {string | null}
 */
export function newestGaOfMajor(versions, major) {
  let best = null;
  for (const [maj, min, pat] of versions) {
    if (maj !== major) continue;
    if (best === null || min > best[0] || (min === best[0] && pat > best[1])) best = [min, pat];
  }
  return best === null ? null : `${major}.${best[0]}.${best[1]}`;
}

/**
 * Fatal in every mode. A gate that cannot measure must never report "nothing
 * found" — that is how a coverage gate goes quietly green over the whole corpus.
 *
 * @param {{ versions: Array<[number, number, number]>, inScopeMajors: number[] }} input
 * @returns {string[]}
 */
export function instrumentProblems({ versions, inScopeMajors }) {
  const problems = [];
  if (versions.length === 0) {
    problems.push(
      `read 0 GA versions out of ${SPEC_CHANGELOG}. That is a BROKEN INSTRUMENT, never evidence `
      + 'that nothing has shipped — this platform has shipped GA releases since v0.2. Something '
      + 'moved the file or changed its heading format; fix the parse.',
    );
  } else if (inScopeMajors.length === 0) {
    problems.push(
      `no GA major at or above v${SCOPE_FLOOR_MAJOR} was found in ${SPEC_CHANGELOG}, so this gate `
      + 'checked ZERO pages. v16 and v17 have both shipped and majors only go up, so this cannot be '
      + 'a true reading. Fix the parse.',
    );
  }
  return problems;
}

// ── Assertion 1: section coverage ────────────────────────────────────────────

/**
 * Does an ATX heading on this page name the `<major>.<minor>` series?
 *
 * The end guard `(?![\w.-])` after the optional patch carries both header traps
 * at once:
 *   • `11.10.0` does NOT satisfy minor 11.1 — after `11.1` the next character is
 *     `0`, the optional `.<patch>` cannot apply, and the guard rejects.
 *   • `17.2.0-rc.0` does NOT satisfy minor 17.2 — the guard rejects the `-`, and
 *     backtracking to bare `17.2` is rejected by the following `.`. An RC
 *     heading is the train, not the release, and accepting it would let a minor
 *     that only ever appeared as a prerelease read as documented.
 *
 * @param {string} pageText
 * @param {number} major
 * @param {number} minor
 * @returns {string[]} the matching heading lines
 */
export function headingsNamingMinor(pageText, major, minor) {
  const re = new RegExp(String.raw`^#{1,6}[^\S\n].*?\b${major}\.${minor}(?:\.\d+)?(?![\w.-])`);
  return pageText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => re.test(line));
}

/**
 * @param {number} major
 * @param {number} minor
 * @param {string} pagePath
 * @param {string} pageText
 * @returns {string[]}
 */
export function coverageFindings(major, minor, pagePath, pageText) {
  if (headingsNamingMinor(pageText, major, minor).length > 0) return [];
  return [
    `${pagePath}: @objectstack/spec ${major}.${minor}.0 is published (it has a \`## ${major}.${minor}.0\` `
    + `section in ${SPEC_CHANGELOG}) but NO heading on this page names the ${major}.${minor} series. `
    + `Fold it in under a running section — the shape both current pages use is "# What's new in `
    + `${major}.${minor}.0" plus "### ${major}.${minor}.0" in the upgrade checklist. This gate writes no `
    + 'prose and cannot: a curated section is a judgement about what is user-facing, read out of the '
    + 'per-package changelogs. It only reports that the section is absent.',
  ];
}

// ── Assertion 2: index currency ──────────────────────────────────────────────

/**
 * The single index.mdx line for a major, or null. Same lookup the sibling gate
 * uses, so the two gates cannot disagree about WHICH line is the entry.
 *
 * @param {string} indexText
 * @param {number} major
 * @returns {string | null}
 */
export function indexEntryLine(indexText, major) {
  const needle = `](/docs/releases/v${major})`;
  for (const line of indexText.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.includes(needle)) return line;
  }
  return null;
}

/**
 * The TRAILING parenthetical of an entry line, or null when it has none.
 *
 * Scoped to the trailing group for the same reason the sibling gate scopes it:
 * mid-sentence prose parentheticals ("(21 dead methods out, 40+ real ones in)")
 * are not status. Unlike the sibling, an ABSENT parenthetical is reported rather
 * than falling back to the whole line — a line with no status field cannot name
 * the newest release, and reading the prose instead would let "17.1 adds partial
 * field masking" satisfy a currency check.
 *
 * @param {string} line
 * @returns {string | null}
 */
export function indexStatusField(line) {
  const m = /\(([^()]*)\)[^\S\n]*\.?[^\S\n]*$/.exec(line);
  return m ? m[1] : null;
}

/**
 * @param {number} major
 * @param {string} newestVersion
 * @param {string | null} line
 * @returns {string[]}
 */
export function indexCurrencyFindings(major, newestVersion, line) {
  if (line === null) return [];  // existence is check:release-page-status's verdict, not this one's
  const field = indexStatusField(line);
  if (field === null) {
    return [
      `${INDEX_PATH}: the v${major} entry has no trailing status parenthetical, so it cannot name the `
      + `newest ${major}.x release (${newestVersion}). Add one, e.g. "(current series: ${newestVersion}, `
      + `released <date>)" or "(final release: ${newestVersion})".`,
    ];
  }
  const named = new RegExp(String.raw`\b${newestVersion.replace(/\./g, String.raw`\.`)}(?![\w.-])`);
  if (named.test(field)) return [];
  return [
    `${INDEX_PATH}: the v${major} entry's status reads "${field}", but the newest released ${major}.x `
    + `version is ${newestVersion}. The sibling gate only rejects a PRE-RELEASE here, so a superseded `
    + `STABLE version passes it — "(current series: ${major}.0.0)" while ${newestVersion} is on \`latest\` `
    + 'is the exact state that shipped. Name the newest release.',
  ];
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * The real v17 page heading set as it stood between #10232 and #13754, trimmed to
 * the lines that matter. HISTORICAL — a snapshot, like `PRE_10232_V17_HEADINGS`
 * below, and no longer the page as it reads today: #13754 (merged 2026-08-31)
 * cascaded the release-page headings, so this page's `# 17.0.0 in detail` is now
 * `## 17.0.0 in detail` and NO page under `content/docs/releases/` carries a
 * body-level h1 any more (measured on the merge commit: 0 such lines across the
 * ten pages, against 54 `## ` lines in the same files — so the zero is a reading,
 * not a broken query).
 *
 * Do NOT re-snapshot it from the live page. `headingsNamingMinor` is `^#{1,6}` by
 * construction and its breadth is pinned directly by the `'# 16.1.0'` /
 * `'###### 16.1.0'` case in the self-test below, which a re-snapshot would not
 * touch. What a re-snapshot WOULD remove is the last h1 reaching the matcher
 * through a whole-PAGE fixture — and it would remove it in silence: 17.0 is
 * covered here twice over (`## Highlights — 17.0.0` matches it too), so every case
 * in this file stays green with the `# ` demoted to `##`. Measured, not assumed.
 * The ban is written here because nothing mechanical enforces it.
 */
const PRE_13754_V17_HEADINGS = [
  '## Highlights — 17.0.0',
  '## Highlights — 17.1.0',
  '# 17.0.0 in detail',
  '### Node.js 22 is the supported floor (#3825)',
  '## Landed since 17.0.0-rc.0',
].join('\n');

/** The real v17 page as it stood between the 17.1.0 cut and #10232. */
const PRE_10232_V17_HEADINGS = [
  '## Highlights — 17.0.0',
  '# 17.0.0 in detail',
  '## Landed since 17.0.0-rc.0',
  '## Landed at the 17.0.0 GA cut',
].join('\n');

const CURRENT_INDEX_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records ... (21 dead methods out, '
  + '40+ real ones in) ... (current series: 17.1.0, released 2026-08-20).';
const PRE_10232_INDEX_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records ... (21 dead methods out, '
  + '40+ real ones in) ... (current series: 17.0.0, released 2026-08-14).';
const CURRENT_INDEX_V16 =
  '- [v16.0.0](/docs/releases/v16) — One org identifier (`organizationId`) across hooks and actions '
  + '(final release: 16.1.0).';
const NO_PARENTHETICAL_INDEX_V13 =
  '- [v13.0.0](/docs/releases/v13) — Permission Model v2 (ADR-0090): Roles and Profiles converge.';

export function selfTest() {
  const failures = [];
  let cases = 0;
  const expect = (label, cond) => {
    cases += 1;
    if (!cond) failures.push(label);
  };

  // ── Scope: the floor is INHERITED, and that inheritance is enforced ────────
  {
    // Read the sibling as TEXT. Importing it would run its entire CLI at module
    // load (it has no entry guard, which is why it sits in KNOWN_IMPORT_UNSAFE),
    // so a text read is the only way to pin the two floors together.
    let siblingFloor = null;
    try {
      const src = readFileSync(SIBLING_GATE, 'utf8');
      const m = /const\s+SCOPE_FLOOR_MAJOR\s*=\s*(\d+)\s*;/.exec(src);
      if (m) siblingFloor = Number(m[1]);
    } catch { /* reported by the expect below */ }
    expect(
      `scope — the floor is READ from ${SIBLING_GATE} and equals this gate's (sibling: `
      + `${siblingFloor === null ? 'UNREADABLE' : siblingFloor}, here: ${SCOPE_FLOOR_MAJOR}). Two `
      + 'gates reading the same pages under different floors is two answers to one question, so the '
      + 'inheritance is pinned rather than declared in a comment',
      siblingFloor === SCOPE_FLOOR_MAJOR,
    );
  }
  expect(
    'scope — SCOPE_NOTE carries the verbatim ruling and says the floor is INHERITED, so a reader of '
    + 'the output learns both the cutoff and that it is not this gate\'s to move',
    SCOPE_NOTE.includes('只负责 v16 以后的')
    && SCOPE_NOTE.includes('2026-08-15')
    && SCOPE_NOTE.includes('INHERITED'),
  );
  expect(
    'scope — SCOPE_NOTE states the gate has NO baseline, so "out of scope" is never read later as '
    + '"known-broken but tolerated"',
    /NO baseline/.test(SCOPE_NOTE),
  );
  expect(
    'scope — the cutoff is a hole-free `>=` over v0..v40: nothing at or above the floor is exempted '
    + 'and nothing below it is smuggled in',
    Array.from({ length: 41 }, (_, i) => i)
      .every((major) => inScope(major) === (major >= SCOPE_FLOOR_MAJOR)),
  );

  // ── Severity: advisory is the DEFAULT, and it is explained in the output ───
  expect(
    'severity — SEVERITY_NOTE carries the MEASUREMENT behind the advisory choice (the two real gaps '
    + 'and the PR count a hard fail would have charged), not just the choice',
    SEVERITY_NOTE.includes('25 days') && SEVERITY_NOTE.includes('2748'),
  );
  expect(
    'severity — findings alone exit 0 by default: no PR is failed for a debt it did not create',
    exitCodeFor({ instrument: [], findings: ['x'], strict: false }) === 0,
  );
  expect(
    'severity — the SAME findings exit 1 under --strict, for a caller that owns the remedy',
    exitCodeFor({ instrument: [], findings: ['x'], strict: true }) === 1,
  );
  expect(
    'severity — an INSTRUMENT problem is fatal in ADVISORY mode too. This is the asymmetry the '
    + 'design rests on: silence about the corpus is loud, silence about the instrument is fatal',
    exitCodeFor({ instrument: ['broken'], findings: [], strict: false }) === 1,
  );
  expect(
    'severity — a clean run exits 0 in both modes',
    exitCodeFor({ instrument: [], findings: [], strict: false }) === 0
    && exitCodeFor({ instrument: [], findings: [], strict: true }) === 0,
  );

  // ── Instrument guards ─────────────────────────────────────────────────────
  expect(
    'instrument — an EMPTY parse is a BROKEN INSTRUMENT, never "nothing shipped"',
    instrumentProblems({ versions: [], inScopeMajors: [] })
      .some((p) => p.includes('BROKEN INSTRUMENT')),
  );
  expect(
    'instrument — a parse that finds releases but NO in-scope major is also fatal: a gate that '
    + 'silently checks zero pages is worse than no gate',
    instrumentProblems({ versions: [[9, 1, 0]], inScopeMajors: [] })
      .some((p) => p.includes('checked ZERO pages')),
  );
  expect(
    'instrument — a healthy reading yields no problems',
    instrumentProblems({ versions: [[16, 1, 0], [17, 1, 0]], inScopeMajors: [16, 17] }).length === 0,
  );

  // ── The GA parse: prereleases never enter the set ─────────────────────────
  expect(
    'parse — a prerelease heading yields NO version; an unanchored match would put 17.0.0 into the '
    + 'set out of `## 17.0.0-rc.0` and then assertion 2 would take a maximum over prereleases',
    gaVersions('## 17.0.0-rc.6\n\n### Patch Changes\n').length === 0,
  );
  expect(
    'parse — CRLF does not break the end anchor, and a heading with trailing text is not a version '
    + 'heading',
    JSON.stringify(gaVersions('## 17.1.0\r\n## 16.0.0 (yanked)\r\n')) === JSON.stringify([[17, 1, 0]]),
  );
  expect(
    'parse — patches are parsed but are NOT minors: 15.1.1 folds into the 15.1 section, so demanding '
    + 'a heading for it would be a false red on every patch ever shipped',
    JSON.stringify(gaMinors(gaVersions('## 15.1.1\n## 15.1.0\n## 15.0.0\n')))
      === JSON.stringify([[15, 0], [15, 1]]),
  );

  // ── newest-of-major: the `sort -V` trap, structurally absent ──────────────
  {
    // To `sort -V | tail -1` the "latest" of these is 17.0.0-rc.6.
    const versions = gaVersions('## 17.0.0-rc.6\n## 17.1.0\n## 17.0.0\n## 16.1.0\n');
    expect(
      'newest — `sort -V` ranks a prerelease ABOVE its release, so a `sort -V | tail -1` gate would '
      + 'answer 17.0.0-rc.6 here. The prerelease never enters the set, and the compare is numeric',
      newestGaOfMajor(versions, 17) === '17.1.0',
    );
    expect(
      'newest — order of the headings does not change the answer',
      newestGaOfMajor(gaVersions('## 17.0.0\n## 17.1.0\n'), 17) === '17.1.0'
      && newestGaOfMajor(gaVersions('## 17.1.0\n## 17.0.0\n'), 17) === '17.1.0',
    );
  }
  expect(
    'newest — minor 10 outranks minor 1 NUMERICALLY. A string sort answers 11.1.0 here, and major 11 '
    + 'really did publish both',
    newestGaOfMajor(gaVersions('## 11.1.0\n## 11.10.0\n'), 11) === '11.10.0',
  );
  expect(
    'newest — a patch outranks its own minor.0',
    newestGaOfMajor(gaVersions('## 15.1.0\n## 15.1.1\n'), 15) === '15.1.1',
  );
  expect(
    'newest — a major with no GA release yields null rather than a wrong answer',
    newestGaOfMajor(gaVersions('## 17.1.0\n'), 18) === null,
  );

  // ── Assertion 1, against the REAL pages, both directions ──────────────────
  expect(
    'coverage/RED — THE DEFECT: the real pre-#10232 v17 headings do not cover 17.1, so 17.1.0 is '
    + 'reported. check-release-page-status returns EXIT=0 on this exact tree',
    coverageFindings(17, 1, 'v17.mdx', PRE_10232_V17_HEADINGS)
      .some((f) => f.includes('NO heading on this page names the 17.1 series')),
  );
  expect(
    'coverage/GREEN — the real v17 headings between #10232 and #13754 cover 17.1 via "## Highlights '
    + '— 17.1.0". A check that reds on everything is not a check',
    coverageFindings(17, 1, 'v17.mdx', PRE_13754_V17_HEADINGS).length === 0,
  );
  expect(
    'coverage/GREEN — and they cover 17.0 TWICE OVER, via "## Highlights — 17.0.0" and "# 17.0.0 in '
    + 'detail". Neither is load-bearing alone, so this case cannot catch a re-snapshot of the h1',
    coverageFindings(17, 0, 'v17.mdx', PRE_13754_V17_HEADINGS).length === 0,
  );
  expect(
    'coverage — TRAP 1: `## What\'s new in 11.10.0` does NOT cover minor 11.1. Major 11 published '
    + 'both 11.1.0 and 11.10.0, so an unguarded `\\b11\\.1` reads one as the other',
    headingsNamingMinor("## What's new in 11.10.0", 11, 1).length === 0
    && headingsNamingMinor("## What's new in 11.10.0", 11, 10).length === 1,
  );
  expect(
    'coverage — TRAP 2: `## Landed since 17.2.0-rc.0` does NOT cover minor 17.2. An RC heading is '
    + 'the train, not the release; accepting it lets a minor that only ever appeared as a prerelease '
    + 'read as documented',
    headingsNamingMinor('## Landed since 17.2.0-rc.0', 17, 2).length === 0,
  );
  expect(
    'coverage — a bare series heading counts: "## What\'s new in 17.1" needs no patch component',
    headingsNamingMinor("## What's new in 17.1", 17, 1).length === 1,
  );
  expect(
    'coverage — BODY prose is not a heading. The v17 page body and the index blurb both say "17.1 '
    + 'adds partial field masking"; a page-wide grep would read that as a section and certify a page '
    + 'that has none',
    headingsNamingMinor('17.1 adds partial field masking, record-view auditing.', 17, 1).length === 0,
  );
  expect(
    'coverage — heading level does not matter: h1 through h6 all count, because the checklist uses '
    + '`### 16.1.0` while the running section uses `# What\'s new in 16.1.0`',
    headingsNamingMinor('###### 16.1.0', 16, 1).length === 1
    && headingsNamingMinor('# 16.1.0', 16, 1).length === 1,
  );
  expect(
    'coverage — `#hashtag17.1` is not a heading: ATX requires whitespace after the hashes',
    headingsNamingMinor('#17.1 not a heading', 17, 1).length === 0,
  );
  expect(
    'coverage — the finding names the MISSING version and says the gate writes no prose, so nobody '
    + 'reads it as "generate the section"',
    coverageFindings(17, 1, 'v17.mdx', PRE_10232_V17_HEADINGS)
      .some((f) => f.includes('17.1.0 is published') && f.includes('writes no prose')),
  );

  // ── Assertion 2, against the REAL index entries, both directions ──────────
  expect(
    'index/RED — THE DEFECT: "(current series: 17.0.0, released 2026-08-14)" while 17.1.0 is the '
    + 'newest release. The sibling gate passes this — it only rejects a PRE-release here',
    indexCurrencyFindings(17, '17.1.0', PRE_10232_INDEX_V17)
      .some((f) => f.includes('newest released 17.x version is 17.1.0')),
  );
  expect(
    'index/GREEN — "(current series: 17.1.0, released 2026-08-20)" passes',
    indexCurrencyFindings(17, '17.1.0', CURRENT_INDEX_V17).length === 0,
  );
  expect(
    'index/GREEN — "(final release: 16.1.0)" passes: the wording of the parenthetical is not fixed, '
    + 'only the version it names',
    indexCurrencyFindings(16, '16.1.0', CURRENT_INDEX_V16).length === 0,
  );
  expect(
    'index/scan-scope — only the TRAILING parenthetical is read, so "(21 dead methods out, 40+ real '
    + 'ones in)" mid-sentence is never mistaken for status',
    indexStatusField(CURRENT_INDEX_V17) === 'current series: 17.1.0, released 2026-08-20',
  );
  expect(
    'index/RED — an entry with NO trailing parenthetical is reported rather than falling back to the '
    + 'whole line; the prose blurb says "17.1 adds ..." and would otherwise satisfy currency',
    indexStatusField(NO_PARENTHETICAL_INDEX_V13) === null
    && indexCurrencyFindings(13, '13.0.0', NO_PARENTHETICAL_INDEX_V13)
      .some((f) => f.includes('no trailing status parenthetical')),
  );
  expect(
    'index — a PRE-RELEASE of the newest version does not satisfy it: "(current series: 17.1.0-rc.1)" '
    + 'while 17.1.0 is out is still stale',
    indexCurrencyFindings(17, '17.1.0', '- [v17](/docs/releases/v17) — x (current series: 17.1.0-rc.1).')
      .length === 1,
  );
  expect(
    'index — 17.1.0 is not satisfied by 17.1.02 or 17.1.0.1: the version must end where it says it '
    + 'does',
    indexCurrencyFindings(17, '17.1.0', '- [v17](/docs/releases/v17) — x (current series: 17.1.02).')
      .length === 1,
  );
  expect(
    'index — a MISSING entry is not this gate\'s verdict: check:release-page-status already fails on '
    + 'it, and two gates reporting one fact means two reds for one fix',
    indexCurrencyFindings(17, '17.1.0', null).length === 0,
  );

  // ── The report itself ─────────────────────────────────────────────────────
  expect(
    'report — the advisory report carries SCOPE_NOTE and SEVERITY_NOTE, so a reader of the OUTPUT '
    + 'learns the blind spot and why the finding is not fatal without opening this file',
    renderFindings(['x'], false).includes(SCOPE_NOTE)
    && renderFindings(['x'], false).includes(SEVERITY_NOTE),
  );
  expect(
    'report — the OK path carries SCOPE_NOTE too: a green gate that hides its blind spot is how a '
    + 'limitation gets mistaken for coverage',
    renderOk([16, 17], 4).includes(SCOPE_NOTE),
  );
  expect(
    'report — under --strict the report says findings are FATAL, so the same text never claims both',
    renderFindings(['x'], true).includes('FATAL')
    && !renderFindings(['x'], true).includes(SEVERITY_NOTE),
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-release-section-coverage --self-test: ${failures.length} failure(s).\n`);
    return 1;
  }
  console.log(
    `OK  self-test: ${cases} cases pass — the pre-#10232 v17 state goes RED on both `
    + 'assertions and the post-#10232 state stays GREEN, minor 11.1 is told apart from 11.10 and an '
    + 'RC heading from a release, the newest-of-major compare is immune to the `sort -V` prerelease '
    + 'trap, findings are advisory while a broken instrument is fatal in every mode, and the v16 '
    + 'floor is READ from the sibling gate rather than restated.',
  );
  return 0;
}

// ── Scope, exit policy, rendering ────────────────────────────────────────────

/**
 * @param {number} major
 * @returns {boolean}
 */
export function inScope(major) {
  return major >= SCOPE_FLOOR_MAJOR;
}

/**
 * The whole severity policy, in one place so the self-test can pin it.
 *
 * @param {{ instrument: string[], findings: string[], strict: boolean }} input
 * @returns {0 | 1}
 */
export function exitCodeFor({ instrument, findings, strict }) {
  if (instrument.length > 0) return 1;
  if (strict && findings.length > 0) return 1;
  return 0;
}

function renderInstrumentFailure(problems) {
  return [
    `check-release-section-coverage: INSTRUMENT FAILURE — ${problems.length} problem(s)`,
    '',
    ...problems.map((p) => `  x ${p}`),
    '',
    'This is fatal in every mode, including advisory: a gate that cannot measure must never report '
    + '"nothing found".',
    '',
  ].join('\n');
}

function renderFindings(findings, strict) {
  return [
    `check-release-section-coverage: ${findings.length} finding(s)`
    + (strict ? ' — FATAL under --strict' : ' — advisory, this run still exits 0'),
    '',
    ...findings.map((f) => `  • ${f}`),
    '',
    ...(strict ? [] : [SEVERITY_NOTE, '']),
    SCOPE_NOTE,
    '',
  ].join('\n');
}

function renderOk(checked, minorCount) {
  const majors = checked.map((m) => `v${m}`).join(', ');
  return [
    `check-release-section-coverage: OK — ${minorCount} published minor(s) across `
    + `${checked.length} GA major(s) in scope (${majors}); every one has a heading on its major's `
    + 'release page, and every index entry names the newest release of its major.',
    `Instrument: ${SPEC_CHANGELOG} (GA = a version heading with no prerelease suffix).`,
    SCOPE_NOTE,
  ].join('\n');
}

/**
 * Loud-but-non-blocking, the `prerelease-pin-watch.yml` mechanism: a `::warning::`
 * annotation plus a step-summary table, job GREEN. Silent outside Actions.
 *
 * @param {string[]} findings
 */
function annotate(findings) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const f of findings) {
      console.log(`::warning title=Release section coverage::${f.replace(/\r?\n/g, ' ')}`);
    }
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  try {
    appendFileSync(
      summary,
      [
        '### Release section coverage',
        '',
        `${findings.length} advisory finding(s) — this job is GREEN.`,
        '',
        ...findings.map((f) => `- ${f}`),
        '',
        SEVERITY_NOTE,
        '',
      ].join('\n'),
    );
  } catch { /* a step summary that cannot be written is not a verdict */ }
}

// ── Run ──────────────────────────────────────────────────────────────────────

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const strict = argv.includes('--strict');

  const versions = gaVersions(readFileSync(SPEC_CHANGELOG, 'utf8'));
  const minors = gaMinors(versions).filter(([maj]) => inScope(maj));
  const inScopeMajors = [...new Set(minors.map(([maj]) => maj))].sort((a, b) => a - b);

  const instrument = instrumentProblems({ versions, inScopeMajors });
  if (instrument.length > 0) {
    console.error(renderInstrumentFailure(instrument));
    return 1;
  }

  const findings = [];
  const indexText = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : null;

  for (const major of inScopeMajors) {
    const pagePath = `${RELEASES_DIR}/v${major}.mdx`;
    if (!existsSync(pagePath)) {
      // check:release-notes and check:release-page-status both already fail on
      // this. Reporting it a third time is three reds for one fix.
      console.log(`  (v${major}: no ${pagePath} — page existence is check:release-notes' verdict; skipped)`);
      continue;
    }
    const pageText = readFileSync(pagePath, 'utf8');
    for (const [maj, min] of minors) {
      if (maj !== major) continue;
      findings.push(...coverageFindings(maj, min, pagePath, pageText));
    }
    if (indexText !== null) {
      const newest = newestGaOfMajor(versions, major);
      if (newest !== null) {
        findings.push(...indexCurrencyFindings(major, newest, indexEntryLine(indexText, major)));
      }
    }
  }

  if (findings.length > 0) {
    const out = renderFindings(findings, strict);
    if (strict) console.error(out);
    else {
      console.log(out);
      annotate(findings);
    }
  } else {
    console.log(renderOk(inScopeMajors, minors.length));
  }

  return exitCodeFor({ instrument, findings, strict });
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
