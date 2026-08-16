#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-release-page-status — a GA'd major's release page must SAY it is released.
//
//   node scripts/check-release-page-status.mjs
//   node scripts/check-release-page-status.mjs --self-test
//
// ## The defect this closes
//
// check-release-notes.mjs verifies that every released major has a curated,
// navigable page. It does not verify that the page says the release HAPPENED.
// That gap produced the same defect on both of the last two GA cuts:
//
//   • v17 — the page was compiled FOR the GA cut and never updated AFTER it.
//     Published for a day reading "development is complete and the train is
//     preparing to ship".
//   • v16 — the page read "the 16.0.0 train is currently published as
//     `16.0.0-rc.0`" for over three weeks after 16.0.0 AND 16.1.0 had shipped.
//
// Both times CI was fully green. Both times a human reading the page found it.
// This gate is the ratchet that removes "someone happens to read the page" from
// the loop: for every GA'd major in scope, the release page's status blockquote
// and the releases index entry must both describe a shipped release.
//
// ## Scope — v16 and later, on purpose, with nothing baselined
//
// SCOPE_NOTE below carries the cutoff and its reason, and it is printed on BOTH
// the OK path and the failure path. A deliberate limitation documented only
// inside an implementation is indistinguishable from a bug to everyone who does
// not read the implementation, so the limitation is in the output, not only
// here. There is no baseline and no exception set: "out of scope" and
// "known-broken but tolerated" are different states and only the first applies
// to v15 and earlier. A new gate does not ship pre-compromised.
//
// ## How the gate learns what actually shipped — and why not the two obvious ways
//
// The instrument is `packages/spec/CHANGELOG.md`, cross-checked against
// `packages/spec/package.json`. The platform is one version-locked train
// (changesets `fixed` group), so the @objectstack/spec major IS the platform
// major, and the CHANGELOG is what `changeset version` writes at release time.
// Both files are IN THE TREE, so the reading cannot vary with checkout depth or
// network reachability. The two rejected alternatives failed on exactly that:
//
//   1. GIT TAGS silently under-report in an incomplete clone. Measured while
//      building this gate, in a clone of this repo:
//
//        $ git tag --list '@objectstack/spec@17*'
//        @objectstack/spec@17.0.0-rc.0 … rc.1 rc.2 rc.5 rc.6     # no 17.0.0
//        $ git ls-remote --tags origin 'refs/tags/@objectstack/spec@17*'
//        … @objectstack/spec@17.0.0                              # it exists
//
//      The clone was incomplete; the tag was not missing. A tag-sourced gate in
//      that checkout concludes "v17 never went GA" and goes RED on a page that
//      is correct — the precise inverse of this gate's job. An empty or short
//      tag list must never be read as "nothing shipped".
//   2. NPM DIST-TAGS (`npm view @objectstack/spec dist-tags`) do not depend on
//      checkout depth, but they put a network round-trip inside a lint gate.
//      This repo's check:* family is offline by construction; a gate that reds
//      when a runner cannot reach the registry teaches people to ignore it.
//
// Tags are still USED here — as corroboration only, in the one direction that
// cannot be wrong. A tag that EXISTS proves that release shipped; a tag that is
// ABSENT proves nothing at all. So `readGaTagMajors()` can only ever ADD a
// problem ("a tag proves major N shipped and the CHANGELOG parse missed it"),
// and an empty tag list is silently accepted. That is the hazard-1 lesson built
// into the gate rather than trusted: two sources, and the unreliable one is
// wired so its unreliability is harmless.
//
// ## No version ORDERING anywhere — the `sort -V` trap, structurally avoided
//
// `sort -V` is not semver: it ranks a prerelease ABOVE its release.
//
//   $ printf '%s\n' '17.0.0-rc.6' '17.0.0' | sort -V
//   17.0.0
//   17.0.0-rc.6      ← last, i.e. "latest" to a `sort -V | tail -1` gate
//
// A gate that picks "the latest tag for this major" that way gets 17.0.0-rc.6,
// concludes v17 is still a prerelease, and reds a correct page. This gate never
// asks which version is latest. The only question it asks is SET MEMBERSHIP —
// "does a GA release exist for major N?" — which is order-independent by
// construction, and the self-test pins that by feeding the same headings in
// both orders. The prerelease exclusion is an END-ANCHORED heading match, not a
// comparison: `## 17.0.0-rc.6` is not a GA heading, wherever it appears.
//
// ## Scanning discipline — the blockquote, not the page
//
// v17.mdx contains hundreds of legitimate `rc.N` mentions (the whole "Landed
// since 17.0.0-rc.0 … rc.6" history, `better-auth 1.7.0-rc.2`, pin chains). A
// page-wide grep for `rc.` is all false positives and would be reverted within
// a week. The scan is scoped to the FIRST blockquote after the frontmatter —
// where both v16 and v17 put the claim — plus the SINGLE index.mdx line for
// that major (its trailing status parenthetical when it has one). Both current
// pages legitimately mention their own RC train in the past tense inside that
// blockquote ("closing a train that ran through 16.0.0-rc.0 and 16.0.0-rc.1"),
// so the matchers key on PRESENT-TENSE claims of unreleasedness, never on the
// mere presence of an rc version. The self-test pins that discrimination in
// both directions against the four real wordings — the two stale ones that
// shipped, and the two corrected ones that replaced them.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SPEC_CHANGELOG = 'packages/spec/CHANGELOG.md';
const SPEC_PKG = 'packages/spec/package.json';
const RELEASES_DIR = 'content/docs/releases';
const INDEX_PATH = `${RELEASES_DIR}/index.mdx`;

/**
 * The cutoff. A plain `>=` with NO exception set — that is load-bearing, not
 * incidental: a cutoff with holes in it is a baseline wearing a cutoff's name,
 * and the self-test asserts the cutoff is hole-free.
 */
const SCOPE_FLOOR_MAJOR = 16;

/**
 * Printed on the OK path and the failure path both. Whoever reads a red build —
 * or a green one — learns what this gate does NOT cover and why, without
 * opening this file.
 */
const SCOPE_NOTE =
  `Scope: v${SCOPE_FLOOR_MAJOR} and later ONLY. Release pages for v${SCOPE_FLOOR_MAJOR - 1} and `
  + 'earlier are deliberately NOT checked — maintainer ruling 2026-08-15, quoted verbatim and '
  + 'untranslated: 「只负责 v16 以后的，需要的话之前的版本删除也可以的」, confirming the boundary '
  + 'with 「v14 也不用管」. Older pages being stale is an ACCEPTED state, not a tolerated defect: '
  + 'this gate has NO baseline and NO exception list, and the clean cutoff is what keeps those two '
  + "things apart. If an older page's status ever starts to matter, rewrite or delete that page — do "
  + `not add an exception here, and do not move the v${SCOPE_FLOOR_MAJOR} floor without a new ruling.`;

// ── Instrument: which majors have a GA (non-prerelease) release ──────────────

/**
 * GA majors, read from the spec CHANGELOG.
 *
 * The regex is END-ANCHORED, which is the whole difference from
 * check-release-notes.mjs's `releasedMajors()`. That one matches
 * `/^##\s+(\d+)\.\d+\.\d+/` unanchored, so `## 17.0.0-rc.0` also yields major
 * 17 — correct for ITS question (a page should exist during the RC window too)
 * and actively wrong for this one, where reusing it would demand that v18's
 * page claim to be released the moment 18.0.0-rc.0 publishes, inverting the
 * defect. Two deliberately different predicates, each stated where it is used,
 * beats one shared helper that has to be read twice to be trusted.
 *
 * @param {string} changelogText
 * @returns {number[]} ascending, unique
 */
export function gaMajors(changelogText) {
  const majors = new Set();
  const text = changelogText.replace(/\r\n?/g, '\n');
  for (const m of text.matchAll(/^##[^\S\n]+(\d+)\.\d+\.\d+[^\S\n]*$/gm)) {
    majors.add(Number.parseInt(m[1], 10));
  }
  return [...majors].sort((a, b) => a - b);
}

/**
 * GA majors proved by a local tag. Corroboration ONLY — see the header. An
 * empty result is returned for "no tags", "not a git repo" and "git missing"
 * alike, and every caller treats an empty result as NO CONCLUSION.
 *
 * @param {string} tagListText output of `git tag --list '@objectstack/spec@*'`
 * @returns {number[]}
 */
export function gaTagMajors(tagListText) {
  const majors = new Set();
  for (const raw of tagListText.split('\n')) {
    const m = /^@objectstack\/spec@(\d+)\.\d+\.\d+$/.exec(raw.trim());
    if (m) majors.add(Number.parseInt(m[1], 10));
  }
  return [...majors].sort((a, b) => a - b);
}

function readGaTagMajors() {
  try {
    return gaTagMajors(
      execFileSync('git', ['tag', '--list', '@objectstack/spec@*'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Guards on the instrument itself, before any verdict is drawn from it. Every
 * one of these fires on "the reading is not measuring what it appears to
 * measure" — the family both of this gate's design hazards belong to.
 *
 * @param {{ gaMajorList: number[], specVersion: unknown, tagMajorList: number[] }} input
 * @returns {string[]}
 */
export function instrumentProblems({ gaMajorList, specVersion, tagMajorList }) {
  const problems = [];
  const gaSet = new Set(gaMajorList);

  if (gaMajorList.length === 0) {
    problems.push(
      `read 0 GA majors out of ${SPEC_CHANGELOG}. That is a BROKEN INSTRUMENT, never evidence `
      + 'that nothing has shipped — this platform has shipped GA majors since v6. Something moved '
      + 'the file or changed its heading format; fix the parse. Reading an empty result as "nothing '
      + 'shipped" is how a status gate goes quietly green over every page it exists to check.',
    );
  }

  if (typeof specVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(specVersion)) {
    problems.push(
      `could not read a version out of ${SPEC_PKG} (got ${JSON.stringify(specVersion)}). The `
      + 'CHANGELOG parse has no second source to be checked against, so no verdict from it is '
      + 'trustworthy. Fix the read.',
    );
  } else {
    const m = /^(\d+)\.\d+\.\d+(-[0-9A-Za-z.-]+)?/.exec(specVersion);
    const major = Number.parseInt(m[1], 10);
    // Only the GA direction is asserted. During a `changeset pre` window the
    // package sits at e.g. 18.0.0-rc.0 while the CHANGELOG's GA set correctly
    // stops at 17 — and a pre window on a MINOR (18.1.0-rc.0) coexists with a
    // GA 18 in the set. Neither is a contradiction, so neither is asserted.
    if (!m[2] && !gaSet.has(major)) {
      problems.push(
        `cross-check FAILED: ${SPEC_PKG} is at ${specVersion} — a GA version, major ${major} — but `
        + `the ${SPEC_CHANGELOG} parse yielded no GA release for major ${major} (it found: `
        + `${gaMajorList.join(', ') || 'nothing'}). Two in-tree sources disagree, so the CHANGELOG `
        + 'parse is not measuring what it appears to measure. Fix the parse; do not widen the gate.',
      );
    }
  }

  // Tags can only ADD a problem, never resolve one, and only inside this gate's
  // scope. An absent tag proves nothing (an incomplete clone drops tags without
  // saying so), which is why there is no "tag exists but CHANGELOG says GA"
  // direction and no failure when the list is empty.
  for (const major of tagMajorList) {
    if (major < SCOPE_FLOOR_MAJOR) continue;
    if (!gaSet.has(major)) {
      problems.push(
        `cross-check FAILED: the local tag @objectstack/spec@${major}.x.y proves major ${major} `
        + `shipped a GA release, but the ${SPEC_CHANGELOG} parse missed it. A tag that exists is `
        + 'authoritative (only its ABSENCE is unreliable), so the CHANGELOG reading is wrong here. '
        + 'Fix the parse.',
      );
    }
  }

  return problems;
}

// ── Extracting the two things that get scanned ───────────────────────────────

/**
 * The first blockquote after the frontmatter — the release-status blockquote by
 * this section's convention, and where both v16 and v17 put the claim.
 *
 * @param {string} pageText
 * @returns {string | null} the raw `>`-prefixed lines, or null if there is none
 */
export function statusBlockquote(pageText) {
  const text = pageText.replace(/\r\n?/g, '\n');
  let body = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 3);
    if (end !== -1) body = text.slice(end + 5);
  }
  const picked = [];
  for (const line of body.split('\n')) {
    if (/^[^\S\n]*>/.test(line)) picked.push(line);
    else if (picked.length > 0) break;
  }
  return picked.length > 0 ? picked.join('\n') : null;
}

/**
 * Blockquote markers off, wrapped lines joined, inline markdown flattened,
 * whitespace collapsed. Without the join, a phrase that WRAPS escapes every
 * matcher — and the real stale v17 status broke "preparing to ship" across a
 * line break, so this is the difference between catching that page and not.
 *
 * @param {string} raw
 * @returns {string}
 */
export function flattenStatusText(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[^\S\n]*>[^\S\n]?/, ''))
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The single index.mdx line for a major.
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
 * The status field of an index entry: its TRAILING parenthetical when it has
 * one (`… (final release: 16.1.0).`), else the whole line. Scoping to the
 * trailing group is the same "don't scan the whole thing" discipline applied at
 * line level — mid-sentence parentheticals like "(21 dead methods out, 40+ real
 * ones in)" are prose, not status.
 *
 * @param {string} line
 * @returns {string}
 */
export function indexStatusField(line) {
  const m = /\(([^()]*)\)[^\S\n]*\.?[^\S\n]*$/.exec(line);
  return m ? m[1] : line;
}

// ── The two matchers ─────────────────────────────────────────────────────────

/**
 * Present-tense claims that the train has not shipped. Each one is a phrase
 * that appeared in a status blockquote that WAS wrong, chosen so that the
 * corrected wording which replaced it does not match: the fix for v16 says "no
 * longer publish as 16.0.0-rc.N" where the stale one said "is currently
 * published as", and the fix for v17 says "`changeset pre exit` ran with the
 * cut" where the stale one said "Until `changeset pre exit`". Mentioning an rc
 * version is never itself a signal.
 */
const PAGE_STALE_SIGNALS = [
  {
    id: 'preparing-to-ship',
    re: /\bpreparing\s+to\s+ship\b/i,
    says: 'the train is still preparing to ship',
  },
  {
    id: 'currently-published-as',
    re: /\b(?:is|are)\s+currently\s+published\s+as\b/i,
    says: 'what is published today is something other than the GA release',
  },
  {
    id: 'latest-published-prerelease',
    re: /\bthe\s+latest\s+published\s+pre-?release\s+is\b/i,
    says: 'the newest published artifact is a pre-release',
  },
  {
    id: 'nothing-reaches-latest-tag',
    re: /\bnothing\s+reaches\s+the\s+latest\s+tag\b/i,
    says: 'the npm `latest` tag is still empty for this train',
  },
  {
    id: 'until-pre-exit',
    re: /\buntil\s+changeset\s+pre\s+exit\b/i,
    says: 'the release is still conditional on a `changeset pre exit` that has not run',
  },
  {
    id: 'ships-through-pre-mode',
    re: /\bship(?:s|ping)?\s+through\s+changesets?\s+pre-?mode\b/i,
    says: 'the train still ships through Changesets pre-mode',
  },
];

/** The forms that count as "this page states the release happened". */
const RELEASED_ASSERTION_FORMS =
  '`<major>.<minor>.<patch> is|was|has been released|published|generally available|GA|shipped`, '
  + 'or `<major>.<minor>.<patch> released|published|shipped on …`';

/**
 * @param {number} major
 * @returns {RegExp}
 */
export function releasedAssertionRe(major) {
  return new RegExp(
    String.raw`\b${major}\.\d+\.\d+(?![\w.-])\s+(?:`
    + String.raw`(?:is|was|has\s+been)\s+(?:released|published|generally\s+available|GA|shipped)`
    + String.raw`|(?:released|published|shipped)\s+on`
    + String.raw`)\b`,
    'i',
  );
}

/**
 * @param {number} major
 * @param {string} pagePath
 * @param {string | null} blockquoteRaw
 * @returns {string[]}
 */
export function pageStatusProblems(major, pagePath, blockquoteRaw) {
  if (blockquoteRaw === null) {
    return [
      `${pagePath}: no release-status blockquote. @objectstack/spec ${major}.x has a GA release, so `
      + 'this page has to say so where a reader (and this gate) will find it: the first blockquote '
      + `after the frontmatter, e.g. "> **Release status: ${major}.0.0 is released.** It was `
      + 'published on <date> …".',
    ];
  }
  const flat = flattenStatusText(blockquoteRaw);
  const problems = [];
  for (const signal of PAGE_STALE_SIGNALS) {
    if (signal.re.test(flat)) {
      problems.push(
        `${pagePath}: the release-status blockquote still says ${signal.says} [signal: ${signal.id}], `
        + `but @objectstack/spec ${major}.x has a GA release. Update the blockquote to describe the `
        + 'shipped release — a GA announcement page that tells readers the thing is not out yet is '
        + 'the exact defect this gate exists for.',
      );
    }
  }
  if (!releasedAssertionRe(major).test(flat)) {
    problems.push(
      `${pagePath}: the release-status blockquote never states that a ${major}.x version is `
      + `released. @objectstack/spec ${major}.x is GA, so the page must say so in a form a reader `
      + `and this gate can both find: ${RELEASED_ASSERTION_FORMS}. This is the check that catches a `
      + 'stale page whose wording nobody has seen before — the phrase list alone only catches the '
      + 'two shapes that already shipped.',
    );
  }
  return problems;
}

/**
 * @param {number} major
 * @param {string | null} line the index.mdx entry line, or null if absent
 * @returns {string[]}
 */
export function indexStatusProblems(major, line) {
  if (line === null) {
    return [
      `${INDEX_PATH}: no entry linking /docs/releases/v${major}. @objectstack/spec ${major}.x is GA `
      + 'and the index is where readers pick a release, so the entry has to exist before its status '
      + 'can be checked at all.',
    ];
  }
  const field = flattenStatusText(indexStatusField(line));
  const signals = [
    {
      id: 'prerelease-word',
      re: /\bpre-?release\b/i,
      says: 'labels the series a pre-release',
    },
    {
      id: 'prerelease-version',
      re: new RegExp(String.raw`\b${major}\.\d+\.\d+-[0-9A-Za-z][\w.-]*`),
      says: `presents a ${major}.x PRE-RELEASE version as the series status`,
    },
  ];
  const problems = [];
  for (const signal of signals) {
    if (signal.re.test(field)) {
      problems.push(
        `${INDEX_PATH}: the v${major} entry's status ${signal.says} [signal: ${signal.id}] — "${field}" `
        + `— but @objectstack/spec ${major}.x has a GA release. Replace it with the shipped state, `
        + 'e.g. "(current series: <version>, released <date>)" or "(final release: <version>)".',
      );
    }
  }
  return problems;
}

// ── Self-test ────────────────────────────────────────────────────────────────

// The four REAL wordings this gate is judged against, kept verbatim as arrays
// of lines so a diff stays readable. Two of them shipped to the docs site and
// are the defect; two are the corrections that replaced them and must stay
// green forever. A gate for "nothing fails when a GA'd major still says
// pre-release" that has never been seen failing is the same defect one layer
// up, so both directions are pinned, not just the happy one.

/** v17.mdx as published before the GA-cut fix — the real stale text. */
const STALE_V17 = [
  '> **Release status: development is complete and the train is preparing to',
  '> ship.** The latest published pre-release is **17.0.0-rc.6** (cut 2026-08-10);',
  '> one window of 374 changesets is still open on `main` and rolls into the cut',
  '> that exits pre-mode. Until `changeset pre exit`, the 17.0.0 train ships',
  '> through Changesets **pre-mode**, so it publishes as `17.0.0-rc.N` and nothing',
  '> reaches the `latest` tag. Section headings say 17.0.0 for brevity. Caret ranges on',
  '> `^16.x` hold at 16.x until you opt in, which is the reason this train is a',
  '> major at all: its breaking density (the `ApiMethod` shrink, the GraphQL',
  '> removal, the ADR-0104 write cutover, the dead-cluster retirements) is too high',
  '> to auto-upgrade `^16.x` consumers into on their next install.',
].join('\n');

/** v16.mdx as published before the GA-cut fix — the real stale text. */
const STALE_V16 = [
  '> **Release status:** the 16.0.0 train is currently published as',
  '> `16.0.0-rc.0`. This page describes the 16.0.0 content; section headings say',
  '> 16.0.0 for brevity. (15.1.1 was a small patch on the previous line —',
  '> better-auth family pinning and auth-plugin init isolation — covered by the',
  '> [v15 page](/docs/releases/v15).)',
].join('\n');

/** v17.mdx after the fix — mentions its whole RC train, in the past tense. */
const CURRENT_V17 = [
  '> **Release status: 17.0.0 is released.** It was published to the `latest` tag',
  '> on 2026-08-14, closing a train that ran through `17.0.0-rc.0` … `rc.6` (the',
  '> last of them cut 2026-08-10). `changeset pre exit` ran with the cut, so the',
  '> `@objectstack/*` packages no longer publish as `17.0.0-rc.N` and a plain',
  '> install resolves 17.0.0. Caret ranges on `^16.x` hold at 16.x until you opt',
  '> in, which is the reason this train is a major at all: its breaking density',
  '> (the `ApiMethod` shrink, the GraphQL removal, the ADR-0104 write cutover, the',
  '> dead-cluster retirements) is too high to auto-upgrade `^16.x` consumers into',
  '> on their next install.',
].join('\n');

/** v16.mdx after the fix — same shape, two RC versions named in the past tense. */
const CURRENT_V16 = [
  '> **Release status: 16.0.0 is released.** It was published on 2026-07-21,',
  '> closing a train that ran through `16.0.0-rc.0` and `16.0.0-rc.1` (cut',
  '> 2026-07-19 and 2026-07-20). `changeset pre exit` ran with that cut, so the',
  '> `@objectstack/*` packages no longer publish as `16.0.0-rc.N`. The v16 line is',
  '> closed: `16.1.0` followed on 2026-07-22 and is its final release, and the',
  '> current series is [17.0.0](/docs/releases/v17). This page describes the',
  '> 16.0.0 content; the 16.1.0 minor is not covered here. (15.1.1 was a small',
  '> patch on the previous line — better-auth family pinning and auth-plugin init',
  '> isolation — covered by the [v15 page](/docs/releases/v15).)',
].join('\n');

const STALE_INDEX_V16 =
  '- [v16.0.0](/docs/releases/v16) — One org identifier (`organizationId`) across hooks and '
  + 'actions, quorum + per-group sign-off (会签) approvals (current series: 16.0.0-rc.0).';
const STALE_INDEX_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records, the SDK is reconciled '
  + 'against the routes the server actually mounts (21 dead methods out, 40+ real ones in) '
  + '(current series: 17.0.0-rc.N, pre-release).';
const CURRENT_INDEX_V16 =
  '- [v16.0.0](/docs/releases/v16) — One org identifier (`organizationId`) across hooks and '
  + 'actions, quorum + per-group sign-off (会签) approvals (final release: 16.1.0).';
const CURRENT_INDEX_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records, the SDK is reconciled '
  + 'against the routes the server actually mounts (21 dead methods out, 40+ real ones in) '
  + '(current series: 17.0.0, released 2026-08-14).';

function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // ── Scope: the cutoff is stated in the OUTPUT, and it has no holes ─────────
  expect(
    'scope — SCOPE_NOTE names the v16 floor, so a reader of the output learns the cutoff without '
    + 'opening this file',
    SCOPE_NOTE.includes(`v${SCOPE_FLOOR_MAJOR}`) && SCOPE_NOTE.includes(`v${SCOPE_FLOOR_MAJOR - 1}`),
  );
  expect(
    'scope — SCOPE_NOTE carries the REASON (the verbatim maintainer ruling), not just the number; a '
    + 'bare cutoff is indistinguishable from a bug to everyone who did not read the ruling',
    SCOPE_NOTE.includes('只负责 v16 以后的') && SCOPE_NOTE.includes('2026-08-15'),
  );
  expect(
    'scope — SCOPE_NOTE says the gate has NO baseline, so "out of scope" is not read later as '
    + '"known-broken but tolerated"',
    /NO baseline/.test(SCOPE_NOTE),
  );
  expect(
    'scope — failure OUTPUT carries SCOPE_NOTE (this is the text the requirement is about: a red '
    + 'build must explain what it does not cover)',
    renderFailure(['x']).includes(SCOPE_NOTE),
  );
  expect(
    'scope — OK output carries SCOPE_NOTE too (a green gate that hides its blind spot is how a '
    + 'limitation gets mistaken for coverage)',
    renderOk([16, 17], 2).includes(SCOPE_NOTE),
  );
  {
    // A cutoff with holes in it is a baseline wearing a cutoff's name. This
    // asserts the shape, not just today's values.
    const out = [];
    for (let major = 6; major <= 40; major += 1) {
      if (inScope(major) !== (major >= SCOPE_FLOOR_MAJOR)) out.push(major);
    }
    expect(
      'scope — the cutoff is a hole-free `>=` over v6..v40: nothing at or above the floor is '
      + `exempted and nothing below it is smuggled in (offenders: ${out.join(', ') || 'none'})`,
      out.length === 0,
    );
  }

  // ── Hazard 1: the GA predicate excludes prereleases, WITHOUT ordering ──────
  expect(
    'hazard-1 — a prerelease heading alone yields NO GA major (reusing the unanchored '
    + "`releasedMajors()` pattern would make v18's page claim GA the moment 18.0.0-rc.0 publishes)",
    gaMajors('## 17.0.0-rc.6\n\n### Patch Changes\n').length === 0,
  );
  {
    // The `sort -V` trap, pinned as a property: to `sort -V | tail -1` the
    // "latest" of these is 17.0.0-rc.6, so an ordering-based gate would call
    // v17 a prerelease. Membership is order-independent — proven by feeding
    // both orders and demanding the same answer.
    const gaFirst = '## 17.0.0\n\n## 17.0.0-rc.6\n\n## 16.1.0\n';
    const preFirst = '## 17.0.0-rc.6\n\n## 17.0.0\n\n## 16.1.0\n';
    expect(
      'hazard-1 — GA detection is SET MEMBERSHIP, not "latest version": the same headings in either '
      + 'order give the same answer, so the `sort -V` prerelease-ranks-above-release trap has no '
      + 'surface here',
      JSON.stringify(gaMajors(gaFirst)) === JSON.stringify([16, 17])
      && JSON.stringify(gaMajors(preFirst)) === JSON.stringify([16, 17]),
    );
  }
  expect(
    'hazard-1 — a heading with trailing text is not a version heading, and CRLF does not break the '
    + 'end anchor',
    JSON.stringify(gaMajors('## 17.0.0\r\n## 16.0.0 (yanked)\r\n')) === JSON.stringify([17]),
  );

  // ── Hazard 2: the instrument is guarded, and the unreliable source is wired
  //    so that its unreliability cannot produce a verdict ────────────────────
  expect(
    'hazard-2 — an EMPTY parse is reported as a broken instrument, never accepted as "nothing '
    + 'shipped"',
    instrumentProblems({ gaMajorList: [], specVersion: '17.0.0', tagMajorList: [] })
      .some((p) => p.includes('BROKEN INSTRUMENT')),
  );
  expect(
    'hazard-2 — the package.json cross-check fires when the two in-tree sources disagree (spec at a '
    + 'GA 17.0.0 while the CHANGELOG parse found no GA 17)',
    instrumentProblems({ gaMajorList: [16], specVersion: '17.0.0', tagMajorList: [] })
      .some((p) => p.includes('cross-check FAILED') && p.includes(SPEC_PKG)),
  );
  expect(
    'hazard-2 — the cross-check does NOT fire during a `changeset pre` window: spec at 18.0.0-rc.0 '
    + 'with a GA set stopping at 17 is the correct state, not a contradiction',
    instrumentProblems({ gaMajorList: [16, 17], specVersion: '18.0.0-rc.0', tagMajorList: [] })
      .length === 0,
  );
  expect(
    'hazard-2 — nor during a pre window on a MINOR: spec at 18.1.0-rc.0 coexists with a GA 18 in '
    + 'the set (asserting the reverse direction would red the whole pre window)',
    instrumentProblems({ gaMajorList: [17, 18], specVersion: '18.1.0-rc.0', tagMajorList: [] })
      .length === 0,
  );
  expect(
    'hazard-2 — an EMPTY tag list draws NO conclusion. This is the measured failure: a clone that '
    + 'listed rc.0/1/2/5/6 for v17 and no 17.0.0 tag at all, while the tag existed on the remote. '
    + 'Absence of a tag must never mean absence of a release',
    instrumentProblems({ gaMajorList: [16, 17], specVersion: '17.0.0', tagMajorList: [] }).length === 0,
  );
  expect(
    'hazard-2 — a tag that EXISTS is authoritative in the one direction it can be: it proves the '
    + 'release shipped, so a CHANGELOG parse that missed it is wrong',
    instrumentProblems({ gaMajorList: [16], specVersion: '16.1.0', tagMajorList: [16, 17] })
      .some((p) => p.includes('cross-check FAILED') && p.includes('tag')),
  );
  expect(
    'hazard-2 — tag corroboration stays inside the gate\'s scope, so an ancient tag whose CHANGELOG '
    + 'entry has been trimmed cannot red a v16+ gate',
    instrumentProblems({ gaMajorList: [16, 17], specVersion: '17.0.0', tagMajorList: [7, 16, 17] })
      .length === 0,
  );
  expect(
    'hazard-2 — GA tags are told apart from prerelease tags',
    JSON.stringify(gaTagMajors(
      '@objectstack/spec@17.0.0\n@objectstack/spec@17.0.0-rc.6\n@objectstack/spec@16.1.0\n',
    )) === JSON.stringify([16, 17]),
  );

  // ── The page matcher, both directions, against the REAL wordings ───────────
  {
    const p = pageStatusProblems(17, 'v17.mdx', STALE_V17);
    expect(
      'page/RED — the real stale v17 status (the one that shipped) is caught, and by the phrases '
      + 'that make it stale',
      p.length > 0
      && p.some((x) => x.includes('preparing-to-ship'))
      && p.some((x) => x.includes('until-pre-exit'))
      && p.some((x) => x.includes('nothing-reaches-latest-tag')),
    );
    expect(
      'page/RED — "preparing to ship" is caught although it WRAPS across a line break in the real '
      + 'page; without joining the blockquote lines this exact defect escapes',
      STALE_V17.includes('preparing to\n> ship') && p.some((x) => x.includes('preparing-to-ship')),
    );
  }
  {
    const p = pageStatusProblems(16, 'v16.mdx', STALE_V16);
    expect(
      'page/RED — the real stale v16 status (three weeks live) is caught by the present-tense claim',
      p.some((x) => x.includes('currently-published-as')),
    );
    expect(
      'page/RED — and independently by the missing released-assertion, so a NOVEL stale wording is '
      + 'caught even when no phrase in the list matches',
      p.some((x) => x.includes('never states that a 16.x version is released')),
    );
  }
  expect(
    'page/GREEN — the corrected v17 status does not match, although it names its whole RC train and '
    + '`changeset pre exit` in the past tense. This is the false-positive that would get the gate '
    + 'reverted within a week',
    pageStatusProblems(17, 'v17.mdx', CURRENT_V17).length === 0,
  );
  expect(
    'page/GREEN — the corrected v16 status does not match, although it names 16.0.0-rc.0 and '
    + '16.0.0-rc.1 inside the blockquote',
    pageStatusProblems(16, 'v16.mdx', CURRENT_V16).length === 0,
  );
  expect(
    'page/RED — a GA\'d major whose page has no status blockquote at all is a failure, not a pass; '
    + '"nothing to scan" is the quietest way for a status gate to certify nothing',
    pageStatusProblems(16, 'v16.mdx', null).some((x) => x.includes('no release-status blockquote')),
  );

  // ── Scanning discipline: the blockquote, not the page ─────────────────────
  {
    const page = [
      '---',
      'title: v17.0.0',
      'description: whatever',
      '---',
      '',
      '**The v17 line** is a truth-telling release.',
      '',
      CURRENT_V17,
      '',
      '## Landed since 17.0.0-rc.0',
      '',
      'The 17.0.0 train is currently published as `17.0.0-rc.6`; nothing reaches the `latest` tag.',
      'This paragraph is history, not status, and pins `better-auth 1.7.0-rc.2`.',
    ].join('\n');
    const bq = statusBlockquote(page);
    expect(
      'scan-scope — statusBlockquote() picks the FIRST blockquote after the frontmatter',
      bq !== null && bq.startsWith('> **Release status: 17.0.0 is released.**'),
    );
    expect(
      'scan-scope — stale phrasing in the page BODY is not the page\'s status and must not fail the '
      + 'gate: v17.mdx carries hundreds of legitimate rc.N mentions, and a page-wide grep is all '
      + 'false positives',
      pageStatusProblems(17, 'v17.mdx', bq).length === 0,
    );
  }

  // ── The index matcher, both directions, against the REAL entries ──────────
  expect(
    'index/RED — the real stale v16 entry "(current series: 16.0.0-rc.0)" is caught',
    indexStatusProblems(16, STALE_INDEX_V16).some((x) => x.includes('prerelease-version')),
  );
  expect(
    'index/RED — the real stale v17 entry "(current series: 17.0.0-rc.N, pre-release)" is caught by '
    + 'both signals',
    indexStatusProblems(17, STALE_INDEX_V17).some((x) => x.includes('prerelease-word'))
    && indexStatusProblems(17, STALE_INDEX_V17).some((x) => x.includes('prerelease-version')),
  );
  expect(
    'index/GREEN — "(final release: 16.1.0)" passes: the matcher tells "pre-release" apart from the '
    + 'word "release", which every correct entry contains',
    indexStatusProblems(16, CURRENT_INDEX_V16).length === 0,
  );
  expect(
    'index/GREEN — "(current series: 17.0.0, released 2026-08-14)" passes',
    indexStatusProblems(17, CURRENT_INDEX_V17).length === 0,
  );
  expect(
    'index/scan-scope — only the TRAILING status parenthetical is read, so mid-sentence prose like '
    + '"(21 dead methods out, 40+ real ones in)" is never mistaken for status',
    indexStatusField(CURRENT_INDEX_V17) === 'current series: 17.0.0, released 2026-08-14',
  );
  expect(
    'index/RED — a GA\'d major with no index entry fails rather than passing vacuously',
    indexStatusProblems(16, null).some((x) => x.includes('no entry linking')),
  );

  // ── The released-assertion form, spelled out where an author will read it ──
  expect(
    'remedy — the missing-assertion message names the accepted forms, so an author reworded into a '
    + 'red build is told what to write rather than left to guess',
    pageStatusProblems(16, 'v16.mdx', '> **Release status:** something new.')
      .some((x) => x.includes(RELEASED_ASSERTION_FORMS)),
  );
  expect(
    'remedy — "17.0.0 was published on 2026-08-14" is accepted; the assertion is a small family of '
    + 'forms, not one frozen sentence',
    releasedAssertionRe(17).test('Release status: 17.0.0 was published on 2026-08-14.')
    && releasedAssertionRe(17).test('17.0.0 shipped on 2026-08-14')
    && releasedAssertionRe(17).test('17.1.0 has been released'),
  );
  expect(
    'remedy — but a PRE-RELEASE version does not satisfy it: "17.0.0-rc.6 is released" is exactly '
    + 'the claim this gate rejects',
    !releasedAssertionRe(17).test('17.0.0-rc.6 is released'),
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-release-page-status --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the GA predicate excludes prereleases without ordering versions, an empty '
    + 'CHANGELOG parse and an empty tag list are both treated as a broken instrument rather than as '
    + '"nothing shipped", the two real stale statuses and both stale index entries go RED, the two '
    + 'corrected ones stay GREEN with their RC trains named, and the cutoff is printed on both paths.',
  );
  process.exit(0);
}

// ── Rendering + scope, shared by the run and the self-test ───────────────────

/**
 * @param {number} major
 * @returns {boolean}
 */
export function inScope(major) {
  return major >= SCOPE_FLOOR_MAJOR;
}

function renderFailure(problems) {
  return [
    `check-release-page-status: ${problems.length} problem(s)`,
    '',
    ...problems.map((p) => `  • ${p}`),
    '',
    SCOPE_NOTE,
    '',
  ].join('\n');
}

function renderOk(checked, tagCorroborations) {
  const majors = checked.map((m) => `v${m}`).join(', ');
  return [
    `check-release-page-status: OK — ${checked.length} GA major(s) in scope (${majors}); each page's `
    + 'release-status blockquote and index entry describe a shipped release.',
    `Instrument: ${SPEC_CHANGELOG} (GA = a version heading with no prerelease suffix), cross-checked `
    + `against ${SPEC_PKG}${
      tagCorroborations > 0
        ? ` and corroborated by ${tagCorroborations} local GA tag(s)`
        : ' (no in-scope GA tags in this checkout — corroboration skipped, which is never a verdict)'
    }.`,
    SCOPE_NOTE,
  ].join('\n');
}

// ── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) selfTest();

const changelogText = readFileSync(SPEC_CHANGELOG, 'utf8');
const gaMajorList = gaMajors(changelogText);
const specVersion = JSON.parse(readFileSync(SPEC_PKG, 'utf8')).version;
const tagMajorList = readGaTagMajors();

const problems = instrumentProblems({ gaMajorList, specVersion, tagMajorList });

const checked = gaMajorList.filter(inScope);
if (problems.length === 0 && checked.length === 0) {
  problems.push(
    `no GA major at or above v${SCOPE_FLOOR_MAJOR} was found in ${SPEC_CHANGELOG}, so this gate `
    + 'checked ZERO pages. v16 and v17 have both shipped and majors only go up, so this cannot be a '
    + 'true reading — a gate that silently checks nothing is worse than no gate. Fix the parse.',
  );
}

if (problems.length === 0) {
  const indexText = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : null;
  if (indexText === null) {
    problems.push(`${INDEX_PATH} is missing — there is no releases index to check entries against.`);
  }
  for (const major of checked) {
    const pagePath = `${RELEASES_DIR}/v${major}.mdx`;
    if (!existsSync(pagePath)) {
      problems.push(
        `${pagePath} is missing — @objectstack/spec ${major}.x is GA but there is no release page to `
        + 'check. (check:release-notes is the gate that owns page existence; this one owns what the '
        + 'page SAYS.)',
      );
      continue;
    }
    problems.push(
      ...pageStatusProblems(major, pagePath, statusBlockquote(readFileSync(pagePath, 'utf8'))),
    );
    if (indexText !== null) {
      problems.push(...indexStatusProblems(major, indexEntryLine(indexText, major)));
    }
  }
}

if (problems.length > 0) {
  console.error(renderFailure(problems));
  process.exit(1);
}

console.log(renderOk(checked, tagMajorList.filter(inScope).length));
