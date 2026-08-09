#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectui-changeset-digest — build the `@objectstack/console` changeset body
// for an objectui pin bump FROM WHAT OBJECTUI DECLARED, not from commit titles.
//
//   node scripts/objectui-changeset-digest.mjs --from <sha> --to <sha> \
//        [--objectui-root <path>] [--framework-root <path>] \
//        [--out <file>] [--bump-override minor] [--max N] [--json]
//   node scripts/objectui-changeset-digest.mjs --self-test
//
// Prints the resolved bump level (`major` | `minor` | `patch`) on stdout; the
// human-readable accounting goes to stderr. With `--out` the full changeset
// file (frontmatter included) is written there, otherwise it goes to stdout
// after the bump line is emitted to stderr instead. Exit code 2 means "the
// range is not walkable in this checkout" — the caller degrades, loudly.
//
// WHY THIS EXISTS (#4731)
// -----------------------
// `bump-objectui.sh` used to GUESS which objectui commits belonged in the
// platform release record by matching conventional-commit types on the subject
// line — `grep -iE '^- (feat|fix)'`, then `head -40`, then `grep -ciE '^feat'`
// for the bump level. Every part of that guess was measured wrong on one real
// range (`7d9734d5e321..785b8a5d432c`, 53 non-merge commits):
//
//   * It dropped ALL 9 `refactor(...)` commits, 6 of them BREAKING (`!`) —
//     including `refactor(layout)!: delete PageNodeRenderer` and the burn-ledger
//     batches (objectui#3220 / #3224) — plus `chore(deps): lockstep the
//     @objectstack family onto 17.0.0-rc.1`. Breaking changes are the single
//     class that must never vanish from a release record, and the type filter
//     made them the only class structurally unable to appear.
//   * `head -40` truncated in silence. A truncated list and a complete list are
//     indistinguishable in the artifact — which is the exact silence this
//     changeset exists to prevent (#3340).
//   * It pulled IN commits that ship nothing: two `fix(ci)` commits
//     (objectui#3198 / #3186) matched the type filter while releasing no
//     package code at all.
//
// The question the script actually needs answered is "does this commit ship in
// the frontend release?" — and objectui already DECLARES the answer. Every
// releasing PR carries a `.changeset/*.md`; an empty frontmatter block is
// changesets' own spelling of "release-nothing". So we read the changesets
// added over the range: package names say whether it releases, and the declared
// level (major/minor/patch) IS the bump — nothing is inferred from a subject
// line any more. Declaration over inference, per AGENTS.md Prime Directive #12.
//
// WHY "BREAKING" IS BROADER THAN THE DECLARED LEVEL (#6099)
// --------------------------------------------------------
// #4731 got breaking changes back INTO the list. #6099 is the other half: they
// get in, but they could not be RECOGNISED. The criterion used to be `level ===
// 'major'`, and objectui never declares `major` inside a launch window — the
// same convention this repo's `check-changeset-no-major.mjs` enforces ships a
// breaking change as `minor` plus a prose annotation the author writes. Measured
// on the range `f5bc4c78be76..f995a452d2ca`: 64 releasing changesets, 14 `minor`
// / 50 `patch` / **0 `major`**. So the count was structurally pinned at 0 and the
// `⚠️` hint could never fire, while unmarked breaking migrations flowed into
// `@objectstack/console`'s CHANGELOG input layer.
//
// The criterion is therefore "declared level `major` OR the AUTHOR annotated the
// change as breaking in the changeset body" — see `hasBreakingAnnotation`. Note
// what it still refuses to read: the commit SUBJECT. A conventional-commit `!`
// is the tool's classification of a commit, not the author's statement about the
// release, and re-admitting subject parsing is precisely the inference #4731
// removed. Reading the body keeps this inside "declaration": it is the author's
// own prose, in the same file that already declares the level. It also measures
// strictly better than `!` would — over that same range `!` marks 2 commits,
// while the authors' own annotations mark 4, including `app.homePageId` being
// retired (a `feat(deps):` subject with no `!`).
//
// This criterion changes the ANNOTATION and the COUNT only. The collected set is
// untouched: nothing is admitted or dropped because of it.
//
// WHY THE FALLBACK IS QUIET, AND WHY IT STILL SAYS SO (#6175)
// ----------------------------------------------------------
// `readAt` reads each changeset at `to` and falls back to the commit that ADDED
// it, because a changeset consumed by a release INSIDE the range is gone at `to`
// (the reason `collectAddedChangesets` walks the log instead of diffing the
// endpoints). The fallback works, and the artifact it produces is complete.
//
// It used to ANNOUNCE ITSELF AS A FAILURE anyway. `execFileSync` sends the
// child's stderr to ours unless `stdio` says otherwise, so the first `git show`
// printed git's own `fatal: path … does not exist in …` before `catch` could run
// — one line per changeset, then one line saying everything succeeded. Measured
// on the real pin bump `f995a452d2ca..7dfbeb704e1e` (#6159 / PR #6173): 9
// `fatal:` lines, 9 complete entries, exit 0.
//
// That is the MIRROR of the rule this file already enforces. #4731 wrote "a
// degraded list and a complete one must never look alike"; here a COMPLETE list
// looked like a failure. The two failure modes cost the same, because the next
// reader's first instinct is "the digest is broken, write the changeset by hand
// with `--no-changeset`" — and that hand-written path really does drop all 9
// releasing entries. Noise that points at the wrong remedy is not merely noise.
//
// So the first attempt CAPTURES its stderr instead of inheriting it, and the
// fallback is reported once, as a fact, beside the accounting line
// (`absentAtTo`). Two things this deliberately does not do:
//
//   * It does not go silent. Silence would trade a misleading line for no line,
//     and "this range crossed a release" is worth exactly one sentence — the
//     same reason the cap and the degraded list announce themselves (#4731).
//   * It does not mute FAILURE. When BOTH reads fail nothing was read and the
//     entry would vanish, so both captured diagnostics are re-emitted, named by
//     attempt, and the error still propagates. Quiet is earned by the fallback
//     that worked; it is never extended to the one that did not.
//
// WHY THE UNDECLARED COMMITS ARE NAMED, NOT ONLY COUNTED (#6174)
// --------------------------------------------------------------
// "Read what objectui declared" is the right criterion, and this changes none
// of it. What it fixes is a REPORTING gap on the criterion's own shadow: a
// commit that declared nothing is correctly kept out of the releasing list, and
// used to leave the artifact as one digit inside `omitted: N commits carrying
// no changeset`. Which commits those were, the record did not say.
//
// Measured on the real pin bump `f995a452d2ca..7dfbeb704e1e` (#6159 / PR
// #6173), the 20 undeclared commits are 1 release commit, 3 dependabot bumps,
// 15 docs/ci/scripts commits — and `0e50440e8`, `fix(form): bind `previous` for
// field rules and stop resubmitting read-only fields` (objectui#3518): 26 files
// across 5 packages and all ten locale packs, a user-visible form behaviour
// change. Inside the number 20 it is indistinguishable from `chore(deps-dev):
// Bump postcss from 8.5.25 to 8.5.26`. It shipped in the console build and is
// in no CHANGELOG anywhere — not even objectui's, because there was no
// changeset to compile. A count cannot be read; a subject can.
//
// Three boundaries this deliberately keeps:
//
//   * It does not touch the CRITERION. `noChangesetCommits` is rendered exactly
//     as `classifyRange` produced it — unfiltered, unreordered. Nothing enters
//     or leaves the releasing list, no count moves, and the accounting line is
//     byte-for-byte what it was. Presentation only, the same separation
//     `objectui-range.mjs` already keeps; the rows are spelled in that script's
//     `--all` vocabulary (`- _(no changeset)_ …`) so the two artifacts read as
//     one, which is what "wire up the capability that already exists" means.
//   * It does not CLASSIFY them. `chore: release packages` and the form fix are
//     both listed, flatly. Deciding which undeclared commit "matters" means
//     inferring from a subject line — the exact move #4731 removed, and it
//     would fail the same way, since the commit worth naming here carries a
//     `fix(form)` subject no more distinctive than the `fix(ci)` beside it. The
//     reader judges; the tool only stops hiding.
//   * It is NOT the stderr fallback line (#6175). That one reports how the tool
//     READ A FILE, which is not a fact about the release, so it stays on stderr
//     beside the accounting. This one reports WHICH COMMITS entered the build
//     with nothing declared for them — which is precisely what a release record
//     is for. Adjacent facts, different readers, different destinations.
//
// The gate that would stop this at the source is objectui#3387 (a PR touching
// `packages/*/src/**` with no changeset fails). Until it lands, this is the only
// place the class is visible at all; after it lands, this list goes quiet on its
// own, because there will be nothing to name.
//
// WHY THE ARTIFACT CARRIES AN UNANSWERED ADR-0087 MARKER (#6494)
// --------------------------------------------------------------
// #6099 made this script DECLARE breaking changes (`**BREAKING**`), and #6148's
// gate requires every declared-breaking changeset to state an ADR-0087
// disposition. The first pin bump after #6289 hit exactly that (PR #6476), was
// patched by hand — and a hand-patched marker in a GENERATED file survives only
// until the next bump rewrites it. The recurrence condition is objectui's
// standing practice, not an edge case: its release window bans `major`, so
// breaking changes arrive as `minor` plus a body annotation, which is precisely
// what this script now recognises.
//
// So the artifact carries the QUESTION. `<!-- adr-0087: TODO … -->` is a marker
// the gate parses, refuses, and reports as unanswered — the operator answers it
// at bump time, in writing, every time. The generator never picks a disposition:
// #6148's whole design is that the gate does not answer for you, and a generator
// that answers for you is the same hole with a different author. The argument in
// full, including the two rejected alternatives, is at `ADR_0087_SCAFFOLD`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * Default cap on EACH rendered list. The releasing entries (#4731) and the
 * undeclared commits (#6174) are capped INDEPENDENTLY, so a long release can
 * never squeeze the other list down to nothing — one budget shared between them
 * would make the second list's length depend on the first's, which no reader
 * could infer. A cap that fires ANNOUNCES itself, with the real total (#4731).
 */
export const DEFAULT_MAX_ENTRIES = 100;

const LEVEL_RANK = { patch: 1, minor: 2, major: 3 };

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ captureStderr?: boolean }} [options] `captureStderr` routes the
 *   child's stderr into the thrown error instead of ours. Leave it OFF by
 *   default: an unset `stdio` inherits our stderr (`execFileSync`'s documented
 *   behaviour), which is what a call whose failure is a real failure should do.
 *   Turn it on only where a failure is EXPECTED and retried — `readAt` (#6175).
 */
function git(cwd, args, { captureStderr = false } = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(captureStderr ? { stdio: ['ignore', 'pipe', 'pipe'] } : {}),
  });
}

/**
 * Parse a changeset file: the frontmatter package→level map, the first
 * paragraph of the summary, and the FULL body after the frontmatter.
 *
 * An EMPTY frontmatter block (`---\n---`) is changesets' own "release-nothing"
 * marker — the file exists so the repo's own gate is satisfied, but it releases
 * no package. That is precisely the signal the old type filter could not see.
 *
 * `summary` stays the first paragraph — that is what an entry line renders. But
 * a breaking annotation is not reliably in the first paragraph (#6099: one of
 * the two live specimens puts it in the last), so `body` carries the whole text
 * for `hasBreakingAnnotation` to scan.
 *
 * The entry regex is deliberately the SAME shape the three changeset GATES use
 * (`check-changeset-no-major.mjs`, `check-empty-changeset.mjs`,
 * `check-adr-0087-registration.mjs`), and `check-empty-changeset.mjs`'s
 * self-test asserts all four are byte-identical (#7004). This file is the fourth
 * carrier and the one #7004's report did not name; it reads objectui's
 * changesets rather than this repo's, so its stake is the release RECORD, not a
 * gate: a bump entry the regex cannot see makes the changeset read
 * "release-nothing" and drops the commit from the digest entirely — which is
 * #4731's harm exactly, arrived at through the parser instead of a type filter.
 *
 * @param {string} text
 * @returns {{ packages: Record<string, string>, summary: string, body: string }}
 */
export function parseChangeset(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Record<string, string>} */
  const packages = {};
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    for (; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        i++;
        break;
      }
      if (/^\s*#/.test(lines[i])) continue; // a whole-line YAML comment declares nothing
      // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
      // with an optionally quoted bump value and an optional trailing ` # comment`.
      const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?(?:\s+#.*)?\s*$/.exec(lines[i]);
      if (m && LEVEL_RANK[m[2].toLowerCase()]) packages[m[1].trim()] = m[2].toLowerCase();
    }
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const body = lines.slice(i).join('\n');
  const firstParagraph = [];
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) break;
    firstParagraph.push(lines[i].trim());
  }
  return {
    packages,
    summary: firstParagraph.join(' ').replace(/\s+/g, ' ').trim(),
    body: body.trimEnd(),
  };
}

/** Highest declared level in a package→level map, or null when release-nothing. */
export function highestLevel(packages) {
  let best = null;
  for (const level of Object.values(packages)) {
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

/** One-line entry text, truncated AUDIBLY (never silently) at `limit` chars. */
export function clampSummary(summary, limit = 180) {
  if (summary.length <= limit) return summary;
  return `${summary.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * An emphasis run whose FIRST word is "breaking": `**BREAKING**`,
 * `**BREAKING (v17)**`, `__Breaking change__`.
 *
 * Scanned anywhere in the body, because bolding a word is a deliberate act —
 * nobody emphasises "breaking" by accident. Requiring it to OPEN the run is what
 * keeps an emphasised ordinary sentence that happens to contain the word (real
 * shape: `**Removed — … is technically breaking for anyone who wrote one**`)
 * from matching, and the bounded, `*`/`_`-free tail keeps a run from swallowing
 * a whole paragraph.
 */
const BREAKING_EMPHASIS_LABEL = /(\*\*|__)[ \t]*breaking\b[^*_\n]{0,48}\1/i;

/** The same label, but required to OPEN the text — used to avoid restating it. */
const OPENS_WITH_BREAKING_LABEL = /^[ \t]*(?:\*\*|__)[ \t]*breaking\b/i;

/**
 * A block (paragraph, heading or top-level bullet) that OPENS with the word
 * "breaking" — `## Breaking note …`, `Breaking for anyone reading \`node.ui\` …`,
 * `BREAKING CHANGE: …` (the conventional-commit footer needs no separate rule;
 * it opens a block by construction).
 */
const BREAKING_BLOCK_OPENER = /^[ \t]*(?:#{1,6}[ \t]+)?(?:[-*+][ \t]+)?(?:\*\*|__|\*|_)?[ \t]*breaking\b/i;

/**
 * Did the AUTHOR annotate this change as breaking, in the changeset body?
 *
 * THE PRECISION RULE IS POSITIONAL, NOT LEXICAL. "breaking" is an ordinary
 * English word that appears in changeset prose all the time; what makes an
 * occurrence a *declaration* is where the author put it — in an emphasis label,
 * or at the head of a block. It is never enough that the word merely occurs.
 *
 * Measured over `f5bc4c78be76..f995a452d2ca` (65 changesets, 5 mention the word):
 *
 *   FLAGGED   `042e09d77` `**BREAKING (v17)** — field widgets receive …`  (label)
 *   FLAGGED   `6e794a19e` `Breaking for anyone reading \`node.ui\` …`      (block, LAST paragraph)
 *   FLAGGED   `8ec406728` `## Breaking note — read before tracking …`     (heading)
 *   FLAGGED   `d22ae31ce` `Breaking semantics, in FROM → TO form:`        (block)
 *   NOT       `9e9e9a92f` `… is technically breaking for anyone who wrote one, but only in
 *                          the sense that TypeScript now reports what was already true`
 *
 * Two negatives fall out of the positional anchor with no lexical guard, which
 * is why there is none: a hedged mid-sentence mention is not at a block head,
 * and a negated form ("non-breaking", "not breaking", "no breaking changes" —
 * `d22ae31ce` carries the second) does not START with the word, so the anchor
 * rejects it. Same for words that merely CONTAIN it ("groundbreaking").
 *
 * Deliberately line-INSENSITIVE: block-initial, never line-initial. Changeset
 * prose is hard-wrapped, so any sentence containing "breaking" can land it first
 * on a line by accident — but only the author's own paragraphing puts it first
 * in a block.
 *
 * @param {string} body full changeset text after the frontmatter
 */
export function hasBreakingAnnotation(body) {
  if (!body) return false;
  if (BREAKING_EMPHASIS_LABEL.test(body)) return true;
  const lines = body.split(/\r?\n/);
  let atBlockStart = true;
  for (const line of lines) {
    if (!line.trim()) {
      atBlockStart = true;
      continue;
    }
    // A heading opens a block whether or not a blank line precedes it.
    if (atBlockStart || /^[ \t]*#{1,6}[ \t]+/.test(line)) {
      if (BREAKING_BLOCK_OPENER.test(line)) return true;
    }
    atBlockStart = false;
  }
  return false;
}

/**
 * The uniform marker the digest stamps on a breaking entry, so the compiled
 * release record shows the class without a human having to rescue it by hand
 * (#6110 did exactly that rescue, which is what #6099 records).
 *
 * Uniform, and deliberately WITHOUT a version tag: the digest cannot derive one,
 * and inventing "(v17)" would be the script asserting something no input says.
 * Where the author wrote their own richer label it survives verbatim instead —
 * `markBreaking` never restates a summary that already opens with one.
 */
export const BREAKING_MARKER = '**BREAKING**';

/** Prefix an entry's text with `BREAKING_MARKER` unless it already carries one. */
export function markBreaking(text) {
  if (OPENS_WITH_BREAKING_LABEL.test(text)) return text;
  return `${BREAKING_MARKER} — ${text}`;
}

/**
 * The ADR-0087 disposition SCAFFOLD — a question, never an answer (#6494).
 *
 * `scripts/check-adr-0087-registration.mjs` (#6148) requires every changeset
 * that DECLARES a breaking change to carry exactly one `adr-0087:` disposition
 * marker. From #6099 onward this script declares one as soon as an upstream
 * entry is annotated — and that is objectui's ORDINARY shape, not an exotic
 * one: its release window bans `major` (`scripts/check-changeset-no-major.mjs`),
 * so a breaking change ships as `minor` plus the author's own body annotation,
 * which is exactly what `hasBreakingAnnotation` above finds. Measured on the
 * range PR #6476 bumped: 24 changesets, 2 of them annotated-breaking. So the
 * gate's red is the COMMON case on any substantive pin bump, and a marker
 * patched in by hand lives exactly until the next bump regenerates the file.
 *
 * Hence a placeholder that the gate STILL JUDGES:
 *
 *   * `TODO` parses as neither `registered ...` nor `not-required (...) ...`,
 *     so the gate reports `unparseable disposition: "TODO …"` and stays RED.
 *     Present-but-unanswered reads differently from absent, and it lands the
 *     gate's own fix-it block listing the four accepted forms.
 *   * It is ONE marker. Two would produce a different red ("N markers -- exactly
 *     one disposition is expected") that names the tooling instead of the
 *     question, so nothing else in the emitted body may spell `adr-0087:`.
 *   * It says NOTHING about which disposition applies. Writing `not-required
 *     (...)` here — even the category that is usually right — would make this
 *     script perform the judgement #6148 exists to extract from a human, and it
 *     would then be written unread on every bump forever. That gate's whole
 *     design is that it never answers for you; a generator that answers for you
 *     is the same hole with a different author.
 *
 * An HTML comment for the reason the gate's own header gives: a changeset body
 * is copied VERBATIM into CHANGELOG.md, so the marker must render as nothing for
 * end users while staying fully visible in the diff, in `git grep` and in the
 * gate's log.
 */
export const ADR_0087_SCAFFOLD =
  '<!-- adr-0087: TODO — the pin bump cannot answer this; a human must (objectstack#6494) -->';

/**
 * Will `check-adr-0087-registration.mjs` judge THIS ARTIFACT as declaring a
 * breaking change? Read the artifact we actually rendered, not our belief about
 * it — the scaffold has to appear on exactly the files that gate will judge.
 *
 * That gate's `breakingDeclaration()` unions three signals, and this mirrors the
 * two a generated console changeset can ever raise:
 *
 *   1. a `major` bump in the frontmatter — reachable here in RC pre-mode and via
 *      `CONSOLE_BUMP=major`, and it arms the gate ON ITS OWN, with no marker
 *      anywhere in the body.
 *   2. `**BREAKING` (or a `BREAKING CHANGE:` line) in the body.
 *   3. a conventional-commit `!` on the summary line — UNREACHABLE, deliberately
 *      not mirrored: the first line of the emitted file is this script's own
 *      fixed sentence (`Console (objectui) refreshed to …`) and the gate's
 *      pattern `^[a-z]+(\([^)]*\))?!:` is case-sensitive, so nothing this
 *      generator writes can start it.
 *
 * Why the RENDERED body rather than the `breaking` count: the two nearly agree,
 * and the gap runs one way. `breaking > 0` always renders `**BREAKING**` (the ⚠️
 * note restates the marker by construction), so the count implies the signal;
 * the converse can fail. An entry whose own summary carries an emphasis run too
 * long for `BREAKING_EMPHASIS_LABEL`'s 48-character tail is NOT counted breaking
 * here, yet its text reaches the rendered line where the gate's looser
 * `/\*\*BREAKING/` matches it. Reading the artifact closes that by construction
 * instead of by agreement between two predicates.
 *
 * Why the gate's own function is not imported: it would put the release-critical
 * bump path one rename away from failing, and the claim being pinned is about
 * ANOTHER script's verdict -- only that script's own run settles it. (The gate's
 * former top-level CLI dispatch, which made any import execute the gate, was
 * entry-guarded in #6566; the coupling reason stands on its own.) The agreement
 * is pinned in the self-test instead, which runs the real gate as a child
 * process over a real temp repository.
 *
 * @param {{ bump: string, body: string }} artifact
 */
export function artifactDeclaresBreaking({ bump, body }) {
  if (bump === 'major') return true;
  return /\*\*BREAKING/i.test(body) || /^\s*BREAKING[ -]CHANGE/mi.test(body);
}

/**
 * Collect the `.changeset/*.md` files ADDED over `from..to`, newest first.
 *
 * Walks the log rather than diffing the two endpoints: a changeset consumed by
 * a release INSIDE the range is gone at `to`, and an endpoint diff would drop
 * it — the released frontend change would vanish from the release record, the
 * very failure this whole mechanism exists to prevent.
 *
 * `commits` is every non-merge commit in the range (newest first) and
 * `commitsWithChangesetShas` the subset that added one, so a caller can NAME
 * the commits it is leaving out instead of only counting them (#4843).
 *
 * @returns {{ entries: Array<{ path: string, sha: string, subject: string }>, commits: Array<{ sha: string, subject: string }>, totalCommits: number, commitsWithChangeset: number, commitsWithChangesetShas: Set<string> }}
 */
export function collectAddedChangesets(objectuiRoot, from, to) {
  const commits = git(objectuiRoot, ['log', '--no-merges', '--format=%H%x09%s', `${from}..${to}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  const totalCommits = commits.length;

  const raw = git(objectuiRoot, [
    'log',
    '--no-merges',
    '--diff-filter=A',
    '--name-only',
    '--format=%x01%H%x02%s',
    `${from}..${to}`,
    '--',
    '.changeset/',
  ]);

  /** @type {Array<{ path: string, sha: string, subject: string }>} */
  const entries = [];
  const seen = new Set();
  const commitsWithChangeset = new Set();
  let sha = '';
  let subject = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('\u0001')) {
      const sep = line.indexOf('\u0002');
      sha = line.slice(1, sep);
      subject = line.slice(sep + 1);
      continue;
    }
    const path = line.trim();
    if (!path.startsWith('.changeset/') || !path.endsWith('.md')) continue;
    if (path.endsWith('/README.md')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    commitsWithChangeset.add(sha);
    entries.push({ path, sha, subject });
  }
  return {
    entries,
    commits,
    totalCommits,
    commitsWithChangeset: commitsWithChangeset.size,
    commitsWithChangesetShas: commitsWithChangeset,
  };
}

/** A failed `execFileSync` rendered as the child's own diagnostic, indented. */
function gitDiagnostic(err) {
  const captured = typeof err?.stderr === 'string' ? err.stderr : '';
  const text = captured.trim() || err?.message || String(err);
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Read a changeset's content at `to`, falling back to the commit that added it.
 *
 * `fellBack` is the caller's only handle on "this range crossed a release".
 * git's own `fatal:` used to be that handle by accident — which made a complete
 * result read as a failed one, the defect #6175 records; see the header note.
 *
 * Exported for the self-test: the both-reads-failed branch cannot be reached
 * through `classifyRange`, whose `sha` always comes from `--diff-filter=A` and
 * therefore always has the path. An error path no test can enter is an error
 * path that quietly rots into silence, which is the one outcome #6175 forbids.
 *
 * @returns {{ text: string, fellBack: boolean }}
 */
export function readAt(objectuiRoot, to, sha, path) {
  try {
    return {
      text: git(objectuiRoot, ['show', `${to}:${path}`], { captureStderr: true }),
      fellBack: false,
    };
  } catch (atTo) {
    try {
      return {
        text: git(objectuiRoot, ['show', `${sha}:${path}`], { captureStderr: true }),
        fellBack: true,
      };
    } catch (atSha) {
      // BOTH reads failed: nothing was read, and this entry is about to be lost
      // from the release record. Say so with everything git told us, twice over.
      console.error(
        `✗ objectui-changeset-digest: cannot read ${path} — neither at \`to\` nor at the commit that added it.`,
      );
      console.error(`  at \`to\` (${to}):`);
      console.error(gitDiagnostic(atTo));
      console.error(`  at the commit that added it (${sha}):`);
      console.error(gitDiagnostic(atSha));
      throw atSha;
    }
  }
}

/**
 * Is the framework repo in changesets pre-release (RC) mode?
 *
 * Mirrors `scripts/check-changeset-no-major.mjs`: outside an RC window a
 * `major` on any package promotes the WHOLE lockstep group, and that gate
 * rejects it. Inside pre-mode a `major` only ever yields `X.0.0-<tag>.N`, which
 * is what an RC window is for — so the level passes through untouched.
 *
 * WHAT OBJECTUI ACTUALLY DECLARES (corrected #6099). This comment used to assert
 * that "objectui marks its breaking symbol renames `major` routinely", and the
 * `downgradedMajor` path below was written as the ROUTINE case that assertion
 * implies. Measured, the opposite holds: over `f5bc4c78be76..f995a452d2ca`,
 * **0 of 64** releasing changesets declared `major` — including both commits
 * whose subject carries a conventional-commit `!`. objectui observes the same
 * launch-window convention this repo does, and ships a breaking change as
 * `minor` plus an annotation the author writes in the changeset body.
 *
 * So `downgradedMajor` is a SAFETY NET for a level not observed in practice, not
 * the common path — it stays because it is still the right answer if a `major`
 * ever does arrive (an RC window closing upstream would do it), but nothing may
 * be built on the premise that it fires. In particular the breaking COUNT must
 * not be derived from it: that was the #6099 defect, and `hasBreakingAnnotation`
 * is what actually carries the class now.
 */
export function inPreMode(frameworkRoot) {
  try {
    const pre = JSON.parse(readFileSync(join(frameworkRoot, '.changeset', 'pre.json'), 'utf8'));
    return pre?.mode === 'pre';
  } catch {
    return false;
  }
}

/**
 * THE criterion: which objectui changes over `from..to` actually ship in the
 * frontend release, as objectui DECLARED it — plus a full account of what is
 * being left out and why.
 *
 * This is the single shared implementation. `bump-objectui.sh` (via
 * `buildDigest` below, #4731) and `scripts/objectui-range.mjs` (#4843) both go
 * through it, so the platform release record and the release page's Console
 * section can never disagree about what "a releasing frontend change" means.
 * Two copies of this rule would drift, and the first thing they would drift on
 * is the class that already went missing once: breaking `refactor(...)!`.
 *
 * Nothing here reads a commit type. Grouping output BY type is presentation and
 * belongs to the caller; it must never become a filter again.
 *
 * `absentAtTo` counts the changesets that were gone at `to` and had to be read
 * from the commit that added them — the readable form of what used to arrive as
 * a screenful of git `fatal:` lines (#6175).
 *
 * @returns {{ releasing: Array<object>, releaseNothingEntries: Array<object>, noChangesetCommits: Array<object>, releaseNothing: number, noChangeset: number, changesetsAdded: number, absentAtTo: number, totalCommits: number }}
 */
export function classifyRange({ objectuiRoot, from, to }) {
  const { entries, commits, totalCommits, commitsWithChangesetShas } = collectAddedChangesets(
    objectuiRoot,
    from,
    to,
  );

  const releasing = [];
  const releaseNothingEntries = [];
  let absentAtTo = 0;
  for (const entry of entries) {
    const read = readAt(objectuiRoot, to, entry.sha, entry.path);
    if (read.fellBack) absentAtTo++;
    const { packages, summary, body } = parseChangeset(read.text);
    const level = highestLevel(packages);
    if (!level) {
      releaseNothingEntries.push({ ...entry, summary: summary || entry.subject });
      continue;
    }
    // The breaking verdict lives HERE, in the single shared implementation, for
    // the same reason the releasing verdict does: two copies would drift, and
    // the first thing they would drift on is this exact class (#4731 / #6099).
    const annotated = hasBreakingAnnotation(body);
    releasing.push({
      ...entry,
      level,
      packages: Object.keys(packages),
      summary: summary || entry.subject,
      breaking: level === 'major' || annotated,
      breakingSource: level === 'major' ? 'declared-major' : annotated ? 'annotation' : null,
    });
  }

  // Breaking first, then by declared level, then in the log's own (newest-first)
  // order. The class the old filter could not represent at all now leads.
  const order = { major: 0, minor: 1, patch: 2 };
  releasing.sort((a, b) => order[a.level] - order[b.level]);

  const noChangesetCommits = commits.filter((c) => !commitsWithChangesetShas.has(c.sha));

  return {
    releasing,
    releaseNothingEntries,
    noChangesetCommits,
    releaseNothing: releaseNothingEntries.length,
    noChangeset: noChangesetCommits.length,
    changesetsAdded: entries.length,
    absentAtTo,
    totalCommits,
  };
}

/**
 * Build the digest for a range.
 *
 * @returns {{ bump: string, declaredLevel: string|null, breaking: number, breakingByLevel: number, breakingByAnnotation: number, releasing: Array<object>, releaseNothing: number, noChangeset: number, noChangesetCommits: Array<object>, changesetsAdded: number, absentAtTo: number, totalCommits: number, downgradedMajor: boolean, adr0087Scaffold: boolean, body: string }}
 */
export function buildDigest({
  objectuiRoot,
  frameworkRoot = REPO_ROOT,
  from,
  to,
  max = DEFAULT_MAX_ENTRIES,
  bumpOverride = '',
}) {
  const {
    releasing,
    releaseNothing,
    noChangeset,
    noChangesetCommits,
    changesetsAdded,
    absentAtTo,
    totalCommits,
  } = classifyRange({
    objectuiRoot,
    from,
    to,
  });

  const declaredLevel = releasing.length
    ? releasing.reduce(
        (best, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[best] ? r.level : best),
        'patch',
      )
    : null;
  // #6099: declared `major` OR the author's own breaking annotation. Level alone
  // pinned this at 0 for every launch-window range objectui has ever shipped.
  const breakingEntries = releasing.filter((r) => r.breaking);
  const breaking = breakingEntries.length;
  const breakingByLevel = breakingEntries.filter((r) => r.breakingSource === 'declared-major').length;
  const breakingByAnnotation = breaking - breakingByLevel;

  let bump = bumpOverride || declaredLevel || 'patch';
  let downgradedMajor = false;
  if (!bumpOverride && bump === 'major' && !inPreMode(frameworkRoot)) {
    bump = 'minor';
    downgradedMajor = true;
  }

  const shown = releasing.slice(0, Math.max(0, max));
  const hidden = releasing.length - shown.length;

  const lines = [];
  for (const r of shown) {
    // Mark AFTER clamping, so the marker can never be the thing truncation eats
    // — a breaking entry silently losing its marker is the #6099 failure again,
    // one layer down. The clamp budget stays spent on the author's own text.
    const text = r.breaking ? markBreaking(clampSummary(r.summary)) : clampSummary(r.summary);
    lines.push(`- **${r.level}** — ${text} (objectui \`${r.sha.slice(0, 9)}\`)`);
  }
  if (hidden > 0) {
    // A cap that fires SAYS SO, with the real count. Silent truncation and no
    // truncation are indistinguishable in the artifact (#4731).
    lines.push(
      `- …and ${hidden} more releasing changeset${hidden === 1 ? '' : 's'} in this range (list capped at ${max}; see the objectui range below).`,
    );
  }
  if (!lines.length) {
    lines.push(
      '- _No releasing changeset in this range — every objectui commit here declared release-nothing._',
    );
  }

  const omitted = [];
  if (releaseNothing > 0) {
    omitted.push(
      `${releaseNothing} release-nothing changeset${releaseNothing === 1 ? '' : 's'}`,
    );
  }
  if (noChangeset > 0) {
    omitted.push(`${noChangeset} commit${noChangeset === 1 ? '' : 's'} carrying no changeset`);
  }

  const accounting =
    `Derived from the changesets objectui declared over the range — ` +
    `${releasing.length} releasing of ${changesetsAdded} changeset${changesetsAdded === 1 ? '' : 's'} added ` +
    `across ${totalCommits} non-merge commit${totalCommits === 1 ? '' : 's'}` +
    (omitted.length ? `; omitted: ${omitted.join(', ')} (they ship no package code).` : '.');

  const notes = [];
  if (breaking > 0) {
    // The hint must NAME its source. Saying "declare a **major** bump" when the
    // source is a body annotation would be false on every launch-window range,
    // which is every range objectui has shipped so far (#6099).
    const byLevel = `${breakingByLevel} by a declared \`major\` level`;
    const byAnnotation = `${breakingByAnnotation} by the author's own breaking annotation in the changeset body`;
    const source =
      breakingByLevel && breakingByAnnotation
        ? `${byLevel}, ${byAnnotation}`
        : breakingByLevel
          ? byLevel
          : `${byAnnotation} — objectui declares no \`major\` inside a launch window ` +
            `(\`scripts/check-changeset-no-major.mjs\`)`;
    notes.push(
      `⚠️ ${breaking} of these ${breaking === 1 ? 'carries' : 'carry'} a breaking change: ${source}. ` +
        `Each is marked ${BREAKING_MARKER} in the list above — read them before compiling the release record` +
        (downgradedMajor
          ? `. The declared \`major\` is recorded here as \`minor\` because the launch-window convention ` +
            `ships breaking as minor (\`scripts/check-changeset-no-major.mjs\`) — the breaking entries are ` +
            `listed above, unabridged.`
          : '.'),
    );
  }

  // --- #6174: NAME the commits that declared nothing, don't only count them ---
  // Rendered straight from `classifyRange`'s own `noChangesetCommits`, in its
  // order, with no predicate of any kind: presentation, never a criterion (see
  // the header note). Zero-suppressed, and the silence is safe because this
  // block is never the SOLE record of the fact — whenever the count is non-zero
  // the accounting line above already carries it, so an absent block can only
  // mean "every commit in this range declared something", never "the section
  // was not written" (the same reasoning that lets #6175's fallback sentence
  // stay quiet on a range that crossed no release).
  const undeclared = [];
  if (noChangesetCommits.length > 0) {
    const n = noChangesetCommits.length;
    undeclared.push(
      `**In this console build, declared nowhere** — objectui merged ${n} ` +
        `commit${n === 1 ? '' : 's'} in this range with no \`.changeset/*.md\`. ` +
        `The code is inside the pin above and ships here, but nothing upstream declared ` +
        `${n === 1 ? 'it' : 'them'}, so ${n === 1 ? 'it appears' : 'they appear'} in no objectui ` +
        `CHANGELOG and in no entry above. Listed by subject rather than counted, because a ` +
        `count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); ` +
        `the upstream gate that would prevent this is objectui#3387.`,
      '',
    );
    const shownUndeclared = noChangesetCommits.slice(0, Math.max(0, max));
    for (const c of shownUndeclared) {
      undeclared.push(
        `- _(no changeset)_ ${clampSummary(c.subject)} (objectui \`${c.sha.slice(0, 9)}\`)`,
      );
    }
    const hiddenUndeclared = n - shownUndeclared.length;
    if (hiddenUndeclared > 0) {
      // Same rule as the releasing cap, and the reason it is worth repeating:
      // this list's whole purpose is that a number hides which commits it is
      // made of, so truncating it back into a number in silence would restore
      // the exact defect. The marker carries the REAL TOTAL and the command
      // that produces the rest (#4731: a degraded list and a complete one must
      // never look alike).
      undeclared.push(
        `- …and ${hiddenUndeclared} more commit${hiddenUndeclared === 1 ? '' : 's'} with no ` +
          `changeset — this list is capped at ${max}, the range has ${n} in total. ` +
          `Run \`node scripts/objectui-range.mjs --from ${from.slice(0, 12)} ` +
          `--to ${to.slice(0, 12)} --all\` for the complete list.`,
      );
    }
  }

  const rendered = [
    accounting,
    '',
    ...lines,
    ...(notes.length ? ['', ...notes] : []),
    ...(undeclared.length ? ['', ...undeclared] : []),
  ].join('\n');

  // --- #6494: the artifact carries the ADR-0087 QUESTION, never its answer ---
  // A changeset that declares breaking must carry a disposition marker (#6148),
  // and THIS changeset is generated: a marker written by hand survives exactly
  // until the next pin bump rewrites the file, which is how PR #6476's answer
  // was already scheduled to disappear. So the generator emits the question and
  // leaves it deliberately unanswered — see ADR_0087_SCAFFOLD.
  //
  // Zero-suppressed against the gate's own subject: on an artifact the gate does
  // not judge, an unanswered marker would sit there unjudged forever and teach
  // the next reader that this marker is decoration. It appears exactly where it
  // is enforced.
  const adr0087Scaffold = artifactDeclaresBreaking({ bump, body: rendered });
  const body = adr0087Scaffold ? `${rendered}\n\n${ADR_0087_SCAFFOLD}` : rendered;

  return {
    bump,
    declaredLevel,
    breaking,
    breakingByLevel,
    breakingByAnnotation,
    releasing,
    releaseNothing,
    noChangeset,
    noChangesetCommits,
    changesetsAdded,
    absentAtTo,
    totalCommits,
    downgradedMajor,
    adr0087Scaffold,
    body,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
  };

  if (has('-h') || has('--help')) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .map((l) => l.slice(3))
        .join('\n'),
    );
    return 0;
  }

  if (has('--self-test')) return selfTest();

  const objectuiRoot = val('--objectui-root', join(REPO_ROOT, '..', 'objectui'));
  const frameworkRoot = val('--framework-root', REPO_ROOT);
  const from = val('--from');
  const to = val('--to');
  const out = val('--out');
  const max = Number(val('--max', String(DEFAULT_MAX_ENTRIES)));
  const bumpOverride = val('--bump-override', '');

  if (!from || !to) {
    console.error('✗ objectui-changeset-digest: --from <sha> --to <sha> are required.');
    return 1;
  }
  if (!existsSync(join(objectuiRoot, '.git'))) {
    console.error(`✗ objectui-changeset-digest: no objectui checkout at ${objectuiRoot}`);
    return 2;
  }
  try {
    git(objectuiRoot, ['cat-file', '-e', `${from}^{commit}`]);
    git(objectuiRoot, ['cat-file', '-e', `${to}^{commit}`]);
  } catch {
    console.error(
      `✗ objectui-changeset-digest: cannot walk ${from.slice(0, 12)}..${to.slice(0, 12)} in ${objectuiRoot}`,
    );
    return 2;
  }

  const digest = buildDigest({ objectuiRoot, frameworkRoot, from, to, max, bumpOverride });

  if (has('--json')) {
    console.log(JSON.stringify(digest, null, 2));
    return 0;
  }

  const short = to.slice(0, 12);
  const rangeLabel = `${from.slice(0, 12)}...${to.slice(0, 12)}`;
  const file =
    `---\n"@objectstack/console": ${digest.bump}\n---\n\n` +
    `Console (objectui) refreshed to \`${short}\`. Frontend changes in this range:\n\n` +
    `${digest.body}\n\n` +
    `objectui range: \`${rangeLabel}\`\n`;

  console.error(
    `→ ${digest.releasing.length} releasing changeset(s), ` +
      `${digest.breaking} breaking (${digest.breakingByLevel} declared major, ` +
      `${digest.breakingByAnnotation} annotated), ` +
      `${digest.releaseNothing} release-nothing, ${digest.noChangeset} commit(s) without a changeset` +
      (digest.downgradedMajor ? ' — declared major recorded as minor (launch window)' : ''),
  );

  // #6175: the one sentence that replaces the screenful of git `fatal:` lines.
  // It lands HERE, beside the accounting line on stderr, and NOT in the
  // changeset body: the body records what the range released, and how the tool
  // had to read a file is not a fact about the release. The reader who needs it
  // is the operator watching this run — the same reader the `fatal:` lines used
  // to mislead. Printed only when it fires, so a range that crossed no release
  // gains no new line (silence here means "nothing to explain", never "nothing
  // happened" — the absence itself is not load-bearing).
  if (digest.absentAtTo > 0) {
    console.error(
      `→ ${digest.absentAtTo} of ${digest.changesetsAdded} changeset(s) added in this range ` +
        `no longer exist at ${short} — a release consumes the changesets it ships; ` +
        `each was read from the commit that added it, so the account above is complete.`,
    );
  }

  // #6494: the one line the operator running the bump must act on. It goes to
  // stderr beside the accounting, which is where a `BUMP="$(…)"` caller lets it
  // through — the shell driver captures stdout only. Saying it here is not the
  // enforcement (the gate is); it is what stops the operator discovering the red
  // one push later, and it names the marker so the fix is a search away.
  if (digest.adr0087Scaffold) {
    console.error(
      `→ this changeset DECLARES a breaking change, so it carries an UNANSWERED ADR-0087 ` +
        `disposition placeholder. Replace the \`adr-0087: TODO\` marker in ` +
        `${out ?? 'the changeset'} with the real disposition before you push: ` +
        `\`Check Changeset\` rejects the placeholder on purpose, and the generator cannot ` +
        `answer it for you (objectstack#6494).`,
    );
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file);
    console.log(digest.bump);
  } else {
    console.log(file);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test (#4731) — the repo idiom for a `scripts/` gate: build throwaway git
// repos, run the real code over them, assert the artifact.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, cond, detail = '') => {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const tmp = mkdtempSync(join(tmpdir(), 'objectui-digest-selftest-'));
  try {
    // --- a throwaway "objectui" whose commits mirror the #4731 range shapes ---
    const ui = join(tmp, 'objectui');
    mkdirSync(join(ui, '.changeset'), { recursive: true });
    const g = (...args) => git(ui, args);
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'selftest@objectstack.ai');
    g('config', 'user.name', 'self test');
    g('config', 'commit.gpgsign', 'false');

    const commit = (subject, files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui, path)), { recursive: true });
        writeFileSync(join(ui, path), content);
      }
      g('add', '-A');
      g('commit', '-q', '-m', subject);
      return g('rev-parse', 'HEAD').trim();
    };

    const base = commit('chore: base', { 'README.md': 'base\n' });

    commit('feat(grid): aggregate single-call mode for bulk actions', {
      '.changeset/bulk-action-aggregate.md':
        '---\n"@object-ui/plugin-grid": minor\n---\n\nGrid bulk actions gain an aggregate single-call mode.\n',
      'src/grid.ts': 'a\n',
    });
    // The class the old `feat|fix` type filter could not represent AT ALL.
    const breakingSha = commit(
      'refactor(layout)!: delete PageNodeRenderer, the unregistered page-node renderer (#3225)',
      {
        '.changeset/remove-dead-layout-page-node-renderer.md':
          '---\n"@object-ui/layout": major\n---\n\nRemove `PageNodeRenderer`, the dead page-node renderer (objectui#3223).\n',
        'src/layout.ts': 'b\n',
      },
    );
    commit('chore(deps): lockstep the @objectstack family onto 17.0.0-rc.1 (#3189)', {
      '.changeset/objectstack-family-rc1-lockstep.md':
        '---\n"@object-ui/app-shell": minor\n"@object-ui/core": minor\n---\n\nBring the whole `@objectstack` family to `17.0.0-rc.1`.\n',
      'package.json': '{}\n',
    });
    // Matches `fix|feat` on the subject but declares release-nothing.
    commit('fix(ci): hand the cross-repo token to github-script (#3186)', {
      '.changeset/fix-cross-repo-closer-require.md':
        '---\n---\n\nfix(ci): hand the cross-repo token to github-script\n\nRelease-nothing: touches a workflow only.\n',
      '.github/workflows/x.yml': 'on: push\n',
    });
    // Matches the type filter and carries no changeset at all.
    commit('fix(ci): never render a budget FAIL for a run that measured nothing (#3198)', {
      '.github/workflows/y.yml': 'on: push\n',
    });
    const head = g('rev-parse', 'HEAD').trim();

    // --- a "framework" root without pre.json (launch window, no RC) ---
    const fwPlain = join(tmp, 'fw-plain');
    mkdirSync(join(fwPlain, '.changeset'), { recursive: true });
    // --- and one in RC pre-mode ---
    const fwPre = join(tmp, 'fw-pre');
    mkdirSync(join(fwPre, '.changeset'), { recursive: true });
    writeFileSync(join(fwPre, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');

    const digest = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
    });

    console.log('objectui-changeset-digest --self-test');
    check(
      'releasing list is derived from changesets, not commit types (3 of 4 added)',
      digest.releasing.length === 3,
      `got ${digest.releasing.length}`,
    );
    check(
      'a breaking `refactor(...)!` commit IS represented',
      digest.body.includes('PageNodeRenderer') && digest.body.includes(breakingSha.slice(0, 9)),
    );
    check(
      'a non-feat/fix `chore(deps)` commit that releases IS represented',
      digest.body.includes('Bring the whole'),
    );
    check(
      'a `fix(ci)` commit with an EMPTY frontmatter changeset is NOT represented',
      !digest.body.includes('cross-repo token'),
    );
    check(
      'a `fix(ci)` commit with no changeset at all is NOT represented as a releasing entry',
      // #6174 repaired the PROXY, never the claim. This check has always meant
      // "the criterion did not admit it", and tested that by looking for the
      // subject ANYWHERE in the body — which stopped expressing it the moment
      // the body began naming undeclared commits on purpose. It now says what it
      // always meant, at both layers: the classified set, and the rendered
      // releasing lines. The other half — that it IS named, under the undeclared
      // block — is pinned in the #6174 group below.
      !digest.releasing.some((r) => r.subject.includes('budget FAIL')) &&
        !digest.body
          .split('\n')
          .some((l) => /^- \*\*(?:major|minor|patch)\*\* —/.test(l) && l.includes('budget FAIL')),
    );
    check('release-nothing changesets are counted, not dropped in silence', digest.releaseNothing === 1);
    check(
      'commits without a changeset are counted, not dropped in silence',
      digest.noChangeset === 1,
      `got ${digest.noChangeset}`,
    );
    check('the accounting states the omissions', digest.body.includes('omitted:'));
    check('the declared level drives the bump (major declared)', digest.declaredLevel === 'major');
    check(
      'breaking count is surfaced in the body, NAMING its source',
      digest.body.includes('⚠️ 1 of these carries a breaking change: 1 by a declared `major` level'),
      digest.body,
    );
    check(
      'a declared-major entry is marked in the list too',
      digest.body.includes('- **major** — **BREAKING** — Remove `PageNodeRenderer`'),
      digest.body,
    );
    check('in RC pre-mode a declared major stays major', digest.bump === 'major');

    const plain = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPlain,
      from: base,
      to: head,
    });
    check(
      'outside pre-mode a declared major records as minor — AUDIBLY',
      plain.bump === 'minor' && plain.downgradedMajor && plain.body.includes('launch-window'),
    );

    const overridden = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
      bumpOverride: 'patch',
    });
    check('CONSOLE_BUMP still overrides the derived level', overridden.bump === 'patch');

    const capped = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
      max: 1,
    });
    check(
      'a cap that fires ANNOUNCES itself with the real count',
      capped.body.includes('…and 2 more releasing changesets'),
      capped.body,
    );

    // --- #6099: the `minor` + prose-annotation family ----------------------
    // This is the form objectui ACTUALLY ships breaking changes in (0 of 64
    // declared `major` over the live range), so it needs its own repo: the
    // #4731 fixtures above pin exact counts and must not shift under it.
    //
    // Both recognised shapes are here, because the two live specimens differ in
    // WHERE the author put the annotation — one leads with it, one buries it in
    // the last paragraph — and a criterion that reads only the first paragraph
    // (which is all `summary` is) catches the first and misses the second.
    const ui2 = join(tmp, 'objectui-annotated');
    mkdirSync(join(ui2, '.changeset'), { recursive: true });
    const g2 = (...args) => git(ui2, args);
    g2('init', '-q', '-b', 'main');
    g2('config', 'user.email', 'selftest@objectstack.ai');
    g2('config', 'user.name', 'self test');
    g2('config', 'commit.gpgsign', 'false');
    const commit2 = (subject, files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui2, path)), { recursive: true });
        writeFileSync(join(ui2, path), content);
      }
      g2('add', '-A');
      g2('commit', '-q', '-m', subject);
      return g2('rev-parse', 'HEAD').trim();
    };

    const base2 = commit2('chore: base', { 'README.md': 'base\n' });

    // (A) RECOGNISED — the annotation LEADS, as an emphasis label the author
    //     spelled with their own version tag. Mirrors objectui `042e09d77`.
    commit2('refactor(fields)!: converge the widget metadata carrier to `field` (#3233)', {
      '.changeset/field-widget-single-metadata-carrier.md':
        '---\n"@object-ui/fields": minor\n---\n\n' +
        '**BREAKING (v17)** — field widgets receive their metadata on ONE key, `field`.\n' +
        '`schema` is removed from the widget contract (objectui#3233).\n\n' +
        '## What changed\n\n' +
        '`schema` was a second carrier for what `field` already means.\n',
      'src/fields.ts': 'a\n',
    });
    // (B) RECOGNISED — the annotation is in the LAST paragraph, opening a block
    //     in plain prose. Mirrors objectui `6e794a19e`, the specimen whose entry
    //     #6110 had to rescue by hand.
    commit2('fix(app-shell)!: converge flow node geometry to spec `FlowNode.position` (#3172)', {
      '.changeset/flow-node-geometry-is-spec-position.md':
        '---\n"@object-ui/app-shell": minor\n---\n\n' +
        "The flow designer writes node geometry as the spec's `FlowNode.position`, not\n" +
        'its own `ui: { x, y }` (objectui#3172).\n\n' +
        'FROM: dragging, adding-at-a-point and insert-on-edge each wrote `node.ui`.\n' +
        'TO: all three write `position: { x, y }`.\n\n' +
        'Breaking for anyone reading `node.ui` off a flow draft: after the first edit\n' +
        'the key is gone and the coordinates live under `node.position`.\n',
      'src/flow.ts': 'b\n',
    });
    // (C) RECOGNISED — the annotation is a HEADING. Mirrors objectui `8ec406728`,
    //     which the conventional-commit `!` convention does NOT mark.
    commit2('fix(app-shell): entitlement context reads `error.details.*` only (#3329)', {
      '.changeset/entitlement-error-context-reads-details.md':
        '---\n"@object-ui/app-shell": minor\n---\n\n' +
        'The environment entitlement dialog now reads its context from\n' +
        '`error.details.*` — the single declared location (objectui#3329).\n\n' +
        '## Breaking note — read before tracking objectui `main` directly\n\n' +
        'This is a wire-shape change with no consumer-side fallback.\n',
      'src/entitlement.ts': 'c\n',
    });
    // (D) NOT RECOGNISED — the word appears MID-SENTENCE inside an emphasised
    //     paragraph, hedged and then discounted. Mirrors objectui `9e9e9a92f`,
    //     the real near-miss: an ordinary entry that merely discusses breakage.
    commit2('fix(types): DrillDownConfig declares only keys a renderer reads (#3354)', {
      '.changeset/drilldown-config-declared-equals-delivered.md':
        '---\n"@object-ui/types": minor\n---\n\n' +
        '`DrillDownConfig` now declares only keys a renderer reads (objectui#3354).\n\n' +
        '**Removed — two keys no renderer has ever read.** Removing a declared key from\n' +
        'a published interface is technically breaking for anyone who wrote one, but\n' +
        'only in the sense that TypeScript now reports what was already true at\n' +
        'runtime: the key did nothing.\n',
      'src/types.ts': 'd\n',
    });
    // (E) NOT RECOGNISED — negated forms, and a word that merely CONTAINS it.
    //     "Fixes that are not breaking…" is verbatim objectui `d22ae31ce`.
    commit2('chore(deps): follow-up cleanups (#3287)', {
      '.changeset/rc2-followup-cleanups.md':
        '---\n"@object-ui/core": patch\n---\n\n' +
        'Fixes that are not breaking, but were only found because rc.2 stopped being\n' +
        'lenient — each had been passing vacuously.\n\n' +
        'Non-breaking cleanup throughout; this groundbreaking refactor changes no\n' +
        'contract.\n',
      'src/core.ts': 'e\n',
    });
    // (F) NOT RECOGNISED — hard wrapping lands the word first on a LINE, still
    //     mid-sentence. This is why the anchor is block-initial, not line-initial:
    //     an author's paragraphing is a choice, a wrap column is not.
    commit2('fix(fields): the record picker sends the authored option value (#3336)', {
      '.changeset/record-picker-authored-option-value.md':
        '---\n"@object-ui/fields": patch\n---\n\n' +
        'The record picker sends the AUTHORED value of a picked `select` option.\n\n' +
        'Radix `Select` speaks strings, so a numeric option value used to arrive as\n' +
        'its stringified form. Nothing about the change is\n' +
        'breaking for existing authors — the stored wire shape is unchanged.\n',
      'src/picker.ts': 'f\n',
    });
    const head2 = g2('rev-parse', 'HEAD').trim();

    const annotated = buildDigest({
      objectuiRoot: ui2,
      frameworkRoot: fwPlain,
      from: base2,
      to: head2,
    });

    check(
      '#6099 the whole family is collected, breaking or not (6 releasing)',
      annotated.releasing.length === 6,
      `got ${annotated.releasing.length}`,
    );
    check(
      '#6099 no `major` is declared anywhere — the form objectui actually ships',
      annotated.declaredLevel === 'minor' && annotated.breakingByLevel === 0,
      `declaredLevel=${annotated.declaredLevel} byLevel=${annotated.breakingByLevel}`,
    );
    check(
      '#6099 a `minor` whose FIRST paragraph carries the annotation is recognised',
      annotated.releasing.some(
        (r) => r.path.includes('field-widget') && r.breaking && r.breakingSource === 'annotation',
      ),
    );
    check(
      '#6099 a `minor` whose LAST paragraph carries the annotation is recognised',
      annotated.releasing.some(
        (r) => r.path.includes('flow-node') && r.breaking && r.breakingSource === 'annotation',
      ),
    );
    check(
      '#6099 a `minor` annotated by a HEADING is recognised',
      annotated.releasing.some((r) => r.path.includes('entitlement') && r.breaking),
    );
    check(
      '#6099 a hedged MID-SENTENCE "technically breaking" is NOT flagged',
      annotated.releasing.some((r) => r.path.includes('drilldown') && !r.breaking),
    );
    check(
      '#6099 "not breaking" / "Non-breaking" / "groundbreaking" are NOT flagged',
      annotated.releasing.some((r) => r.path.includes('rc2-followup') && !r.breaking),
    );
    check(
      '#6099 a wrapped line STARTING with the word mid-sentence is NOT flagged',
      annotated.releasing.some((r) => r.path.includes('record-picker') && !r.breaking),
    );
    check(
      '#6099 exactly the three annotated entries are flagged, no more',
      annotated.breaking === 3 && annotated.breakingByAnnotation === 3,
      `breaking=${annotated.breaking} byAnnotation=${annotated.breakingByAnnotation}`,
    );
    check(
      "#6099 the author's own label survives verbatim — never restated",
      // The `r.breaking` clause is load-bearing: the `(v17)` label is the
      // AUTHOR's text, so the two body clauses alone would pass whether or not
      // this entry is flagged at all — green for an empty reason.
      annotated.releasing.find((r) => r.path.includes('field-widget'))?.breaking === true &&
        annotated.body.includes('- **minor** — **BREAKING (v17)** — field widgets receive') &&
        !annotated.body.includes('**BREAKING** — **BREAKING'),
      annotated.body,
    );
    check(
      '#6099 markBreaking pins both directions directly (renderer, not criterion)',
      markBreaking('**BREAKING (v17)** — x') === '**BREAKING (v17)** — x' &&
        markBreaking('__Breaking change__ y') === '__Breaking change__ y' &&
        markBreaking('An ordinary summary.') === '**BREAKING** — An ordinary summary.',
    );
    check(
      '#6099 hasBreakingAnnotation pins both directions directly (criterion)',
      hasBreakingAnnotation('## Breaking note\n\nx') &&
        hasBreakingAnnotation('a\n\nBreaking for anyone reading `node.ui`.') &&
        hasBreakingAnnotation('**BREAKING (v17)** — x') &&
        !hasBreakingAnnotation('is technically breaking for anyone who wrote one') &&
        !hasBreakingAnnotation('Non-breaking cleanup; a groundbreaking refactor.') &&
        !hasBreakingAnnotation('wrapped so the word lands first on a line:\nbreaking for authors'),
    );
    check(
      '#6099 an entry annotated further down GETS the marker on its line (#6110 by hand)',
      annotated.body.includes(
        '- **minor** — **BREAKING** — The flow designer writes node geometry',
      ),
      annotated.body,
    );
    check(
      '#6099 an ordinary entry is NOT marked',
      annotated.body.includes('- **minor** — `DrillDownConfig` now declares') &&
        annotated.body.includes('- **patch** — The record picker sends'),
      annotated.body,
    );
    check(
      '#6099 the ⚠️ hint fires on a range with NO declared major — the whole point',
      annotated.body.includes('⚠️ 3 of these carry a breaking change') &&
        annotated.body.includes("by the author's own breaking annotation in the changeset body"),
      annotated.body,
    );
    check(
      '#6099 the hint no longer claims a **major** bump it cannot have',
      !annotated.body.includes('declare a **major**'),
      annotated.body,
    );
    check(
      '#6099 nothing was downgraded — there was no major to downgrade',
      annotated.bump === 'minor' && annotated.downgradedMajor === false,
      `bump=${annotated.bump} downgraded=${annotated.downgradedMajor}`,
    );

    // --- end-to-end through the shell driver -------------------------------
    const fwRun = join(tmp, 'fw-run');
    mkdirSync(join(fwRun, 'scripts'), { recursive: true });
    mkdirSync(join(fwRun, '.changeset'), { recursive: true });
    writeFileSync(join(fwRun, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');
    writeFileSync(join(fwRun, '.objectui-sha'), `${base}\n`);
    for (const f of ['bump-objectui.sh', 'objectui-changeset-digest.mjs']) {
      writeFileSync(join(fwRun, 'scripts', f), readFileSync(join(__dirname, f), 'utf8'));
    }
    const bumpStdout = execFileSync(
      'bash',
      [join(fwRun, 'scripts', 'bump-objectui.sh'), '--no-commit', head],
      {
        encoding: 'utf8',
        env: { ...process.env, OBJECTUI_ROOT: ui },
      },
    );
    // #5960: the pin bump is the ONLY trigger of ADR-0082 D4's declaration-parity
    // ratchet — no workflow produces `sdui.manifest.json`, by ruling — so the
    // procedure's second half lives in this script's output. Prose alone is
    // deletable in silence; pinning it here is what makes "the procedure gained a
    // line" a fact a gate can lose. Asserted on the `--no-commit` path on purpose:
    // that path moved the pin too, and it is the one that returns early.
    check(
      '#5960 a bump prints the `pnpm sdui:manifest` step (the ratchet has no other trigger)',
      bumpStdout.includes('pnpm sdui:manifest') && bumpStdout.includes('NEXT STEP'),
      bumpStdout,
    );
    const written = join(fwRun, '.changeset', `console-${head.slice(0, 12)}.md`);
    const body = existsSync(written) ? readFileSync(written, 'utf8') : '';
    check('bump-objectui.sh writes the digest-derived changeset', body.length > 0);
    check(
      'the emitted changeset declares the derived bump',
      body.startsWith('---\n"@objectstack/console": major\n---'),
      body.slice(0, 60),
    );
    check(
      'the emitted changeset carries the breaking entry and not the ci noise',
      body.includes('PageNodeRenderer') && !body.includes('cross-repo token'),
    );
    check('the pin file is updated', readFileSync(join(fwRun, '.objectui-sha'), 'utf8').trim() === head);

    // --- degraded range: the fallback must SAY it is degraded --------------
    const fwDegraded = join(tmp, 'fw-degraded');
    mkdirSync(join(fwDegraded, 'scripts'), { recursive: true });
    mkdirSync(join(fwDegraded, '.changeset'), { recursive: true });
    writeFileSync(join(fwDegraded, '.objectui-sha'), `${'0'.repeat(40)}\n`);
    for (const f of ['bump-objectui.sh', 'objectui-changeset-digest.mjs']) {
      writeFileSync(join(fwDegraded, 'scripts', f), readFileSync(join(__dirname, f), 'utf8'));
    }
    execFileSync('bash', [join(fwDegraded, 'scripts', 'bump-objectui.sh'), '--no-commit', head], {
      encoding: 'utf8',
      env: { ...process.env, OBJECTUI_ROOT: ui },
    });
    const degraded = readFileSync(
      join(fwDegraded, '.changeset', `console-${head.slice(0, 12)}.md`),
      'utf8',
    );
    check(
      'an unwalkable range degrades LOUDLY, not silently',
      degraded.includes('could not be walked') &&
        degraded.includes('**Degraded list**') &&
        degraded.includes('NOT a\ncomplete account'),
      degraded,
    );

    // --- #6175: a range whose `to` endpoint is a RELEASE COMMIT -------------
    // The shape that made a COMPLETE result look like a failure. A release
    // consumes the changesets it ships, so every changeset added in the range
    // is gone at `to` and every read falls back. Its own repo on purpose: the
    // #4731 / #6099 fixtures above pin exact counts and must not shift under it.
    const ui3 = join(tmp, 'objectui-released');
    mkdirSync(join(ui3, '.changeset'), { recursive: true });
    const g3 = (...args) => git(ui3, args);
    g3('init', '-q', '-b', 'main');
    g3('config', 'user.email', 'selftest@objectstack.ai');
    g3('config', 'user.name', 'self test');
    g3('config', 'commit.gpgsign', 'false');
    const commit3 = (subject, files, removals = []) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui3, path)), { recursive: true });
        writeFileSync(join(ui3, path), content);
      }
      for (const path of removals) rmSync(join(ui3, path), { force: true });
      g3('add', '-A');
      g3('commit', '-q', '-m', subject);
      return g3('rev-parse', 'HEAD').trim();
    };

    const base3 = commit3('chore: base', { 'README.md': 'base\n' });
    commit3('feat(grid): column pinning survives a layout reload (#3401)', {
      '.changeset/grid-column-pinning-survives-reload.md':
        '---\n"@object-ui/plugin-grid": minor\n---\n\nGrid column pinning survives a layout reload.\n',
      'src/grid.ts': 'a\n',
    });
    commit3('fix(fields): the lookup picker keeps the authored value (#3402)', {
      '.changeset/lookup-picker-keeps-authored-value.md':
        '---\n"@object-ui/fields": patch\n---\n\nThe lookup picker keeps the authored value.\n',
      'src/fields.ts': 'b\n',
    });
    const release3 = commit3(
      'chore: release packages (#3403)',
      { 'package.json': '{"version":"17.1.0"}\n' },
      [
        '.changeset/grid-column-pinning-survives-reload.md',
        '.changeset/lookup-picker-keeps-authored-value.md',
      ],
    );

    const released = buildDigest({
      objectuiRoot: ui3,
      frameworkRoot: fwPlain,
      from: base3,
      to: release3,
    });
    check(
      '#6175 a range crossing a release still collects every changeset',
      released.releasing.length === 2 && released.changesetsAdded === 2,
      `releasing=${released.releasing.length} added=${released.changesetsAdded}`,
    );
    check(
      '#6175 the fallback is COUNTED, not merely survived',
      released.absentAtTo === 2,
      `got ${released.absentAtTo}`,
    );

    // The CLI runs as a CHILD so its real stderr can be read: that stream is
    // where git's `fatal:` used to land, and no in-process assertion can see it.
    const selfPath = fileURLToPath(import.meta.url);
    const runCli = (root, from, to, label) =>
      spawnSync(
        process.execPath,
        [
          selfPath,
          '--objectui-root', root,
          '--framework-root', fwPlain,
          '--from', from,
          '--to', to,
          '--out', join(tmp, `cli-${label}.md`),
        ],
        { encoding: 'utf8' },
      );

    const fellBack = runCli(ui3, base3, release3, 'released');
    check(
      '#6175 the fallback no longer leaks git `fatal:` onto stderr',
      fellBack.status === 0 && !fellBack.stderr.includes('fatal:'),
      fellBack.stderr,
    );
    check(
      '#6175 the fallback SAYS SO — once, with the real count',
      /^→ 2 of 2 changeset\(s\) added in this range no longer exist at [0-9a-f]{12} —/m.test(
        fellBack.stderr,
      ) && fellBack.stderr.split('no longer exist at').length === 2,
      fellBack.stderr,
    );
    const quietArtifact = readFileSync(join(tmp, 'cli-released.md'), 'utf8');
    check(
      '#6175 the artifact stays COMPLETE — the quiet read is the whole read',
      quietArtifact.includes('Grid column pinning survives') &&
        quietArtifact.includes('lookup picker keeps the authored value'),
      quietArtifact,
    );

    const noFallback = runCli(ui, base, head, 'plain');
    check(
      '#6175 a range that crossed no release gains NO new line',
      noFallback.status === 0 &&
        !noFallback.stderr.includes('no longer exist at') &&
        !noFallback.stderr.includes('fatal:'),
      noFallback.stderr,
    );

    // Both reads failing is a REAL failure — nothing was read and the entry
    // would vanish from the record. Quiet is earned by the fallback that
    // worked; it is never extended to this. Driven through the exported
    // `readAt` because `classifyRange` cannot reach the branch: its `sha`
    // comes from `--diff-filter=A` and therefore always has the path.
    const probe = join(tmp, 'probe-both-reads-fail.mjs');
    writeFileSync(
      probe,
      `import { readAt } from ${JSON.stringify(pathToFileURL(selfPath).href)};\n` +
        `readAt(${JSON.stringify(ui3)}, ${JSON.stringify(release3)}, ${JSON.stringify(base3)}, ` +
        `'.changeset/never-existed.md');\n`,
    );
    const bothFail = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
    check(
      '#6175 when BOTH reads fail the failure is LOUD, naming both attempts',
      bothFail.status !== 0 &&
        bothFail.stderr.includes('cannot read .changeset/never-existed.md') &&
        bothFail.stderr.includes(release3) &&
        bothFail.stderr.includes(base3),
      bothFail.stderr,
    );
    check(
      "#6175 both attempts' git diagnostics are re-emitted, not swallowed",
      (bothFail.stderr.match(/fatal:/g) ?? []).length >= 2,
      bothFail.stderr,
    );

    // --- #6174: the undeclared commits are NAMED, not only counted -----------
    // Its own repos, for the reason the two groups above have theirs: the #4731
    // / #6099 / #6175 fixtures pin exact counts and must not shift underneath.
    // The row count here is deliberately > 1 so "the list agrees with the count"
    // is a real claim, and the cap can be made to fire without touching `max`
    // anywhere else.
    const SUBJECT_3518 =
      'fix(form): bind `previous` for field rules and stop resubmitting read-only fields (#3518)';

    const ui4 = join(tmp, 'objectui-undeclared');
    mkdirSync(join(ui4, '.changeset'), { recursive: true });
    const g4 = (...args) => git(ui4, args);
    g4('init', '-q', '-b', 'main');
    g4('config', 'user.email', 'selftest@objectstack.ai');
    g4('config', 'user.name', 'self test');
    g4('config', 'commit.gpgsign', 'false');
    const commit4 = (subject, files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui4, path)), { recursive: true });
        writeFileSync(join(ui4, path), content);
      }
      g4('add', '-A');
      g4('commit', '-q', '-m', subject);
      return g4('rev-parse', 'HEAD').trim();
    };

    const base4 = commit4('chore: base', { 'README.md': 'base\n' });
    commit4('feat(grid): row virtualization for long lists (#3600)', {
      '.changeset/grid-row-virtualization.md':
        '---\n"@object-ui/plugin-grid": patch\n---\n\nThe grid virtualizes long lists.\n',
      'src/grid.ts': 'a\n',
    });
    // The live specimen this issue is named after: a real, user-visible change
    // that declared nothing. Committed FIRST of the three so the newest-first
    // order puts it LAST — which is what lets the cap below hide it.
    const undeclared3518 = commit4(SUBJECT_3518, {
      'packages/plugin-form/src/rules.ts': 'previous\n',
      'packages/components/src/form.tsx': 'readonly\n',
    });
    const undeclaredDeps = commit4('chore(deps-dev): Bump postcss from 8.5.25 to 8.5.26 (#3519)', {
      'package.json': '{"devDependencies":{"postcss":"8.5.26"}}\n',
    });
    const undeclaredDocs = commit4('docs(guide): retarget two dead examples/ links (#3509)', {
      'docs/guide.md': 'links\n',
    });
    const head4 = g4('rev-parse', 'HEAD').trim();

    const named = buildDigest({
      objectuiRoot: ui4,
      frameworkRoot: fwPlain,
      from: base4,
      to: head4,
    });
    const namedRows = named.body
      .split('\n')
      .filter((l) => l.startsWith('- _(no changeset)_'));

    check(
      '#6174 every commit with no changeset is NAMED by subject, carrying its sha',
      namedRows.length === 3 &&
        named.body.includes(
          `- _(no changeset)_ ${SUBJECT_3518} (objectui \`${undeclared3518.slice(0, 9)}\`)`,
        ) &&
        named.body.includes(
          `- _(no changeset)_ chore(deps-dev): Bump postcss from 8.5.25 to 8.5.26 (#3519) (objectui \`${undeclaredDeps.slice(0, 9)}\`)`,
        ) &&
        named.body.includes(
          `- _(no changeset)_ docs(guide): retarget two dead examples/ links (#3509) (objectui \`${undeclaredDocs.slice(0, 9)}\`)`,
        ),
      named.body,
    );
    check(
      '#6174 the rendered rows AGREE with the count — no list/number drift',
      namedRows.length === named.noChangeset && named.noChangesetCommits.length === namedRows.length,
      `rows=${namedRows.length} noChangeset=${named.noChangeset}`,
    );
    check(
      '#6174 the block says WHAT it is — shipped in this build, declared nowhere',
      named.body.includes(
        '**In this console build, declared nowhere** — objectui merged 3 commits in this range with no `.changeset/*.md`.',
      ) && named.body.includes('objectui#3387'),
      named.body,
    );
    check(
      '#6174 naming is ADDITIVE — the releasing list is unchanged and still leads',
      named.releasing.length === 1 &&
        named.body.includes('- **patch** — The grid virtualizes long lists.') &&
        named.body.indexOf('- _(no changeset)_') > named.body.indexOf('- **patch** —'),
      named.body,
    );
    check(
      '#6174 the accounting line is untouched — a section was added, no count moved',
      named.body.includes(
        'Derived from the changesets objectui declared over the range — 1 releasing of 1 changeset added across 4 non-merge commits; omitted: 3 commits carrying no changeset (they ship no package code).',
      ),
      named.body,
    );

    const named2 = buildDigest({
      objectuiRoot: ui4,
      frameworkRoot: fwPlain,
      from: base4,
      to: head4,
      max: 2,
    });
    const named2Rows = named2.body.split('\n').filter((l) => l.startsWith('- _(no changeset)_'));
    check(
      '#6174 a capped undeclared list SAYS SO, with the real total and the way to the rest',
      named2Rows.length === 2 &&
        named2.body.includes(
          '- …and 1 more commit with no changeset — this list is capped at 2, the range has 3 in total.',
        ) &&
        named2.body.includes('--all'),
      named2.body,
    );
    check(
      '#6174 truncation CAN hide the one commit worth naming — which is why it is loud',
      // Not a restatement of the check above: it measures the stake. The
      // specimen is the oldest of the three, so a cap eats it first, and a
      // SILENT cap would restore exactly the defect this issue is about — a
      // number where objectui#3518 used to be.
      !named2.body.includes(SUBJECT_3518) && named2.body.includes('the range has 3 in total'),
      named2.body,
    );
    check(
      '#6174 the two caps are INDEPENDENT — truncating the releasing list empties nothing else',
      capped.body.includes('…and 2 more releasing changesets') &&
        capped.body.includes(
          '- _(no changeset)_ fix(ci): never render a budget FAIL for a run that measured nothing (#3198)',
        ),
      capped.body,
    );
    check(
      '#6174 the commit the old body could only COUNT is now in the record by name',
      digest.body.includes(
        '- _(no changeset)_ fix(ci): never render a budget FAIL for a run that measured nothing (#3198)',
      ),
      digest.body,
    );
    check(
      '#6174 only the no-changeset class is named — a release-nothing changeset DID declare',
      // The count clause is the load-bearing one: it goes red both if the block
      // disappears (1 → 0) and if release-nothing entries are swept in (1 → 2).
      // The substring clause alone would be green for an empty reason.
      digest.body.split('\n').filter((l) => l.startsWith('- _(no changeset)_')).length === 1 &&
        !digest.body.includes('- _(no changeset)_ fix(ci): hand the cross-repo token'),
      digest.body,
    );
    check(
      '#6174 body names the commits, #6175 keeps the read-fallback on stderr — adjacent, not merged',
      quietArtifact.includes('- _(no changeset)_ chore: release packages (#3403)') &&
        !quietArtifact.includes('no longer exist at') &&
        fellBack.stderr.includes('no longer exist at') &&
        !fellBack.stderr.includes('_(no changeset)_'),
      quietArtifact,
    );

    // NEGATIVE POLARITY, declared as such: this one cannot go red when the
    // feature is deleted, because deleting it also produces no line. It pins a
    // DIFFERENT regression — a block that fires on an empty list — so it stays,
    // with the two positive guards that keep it from passing vacuously: the
    // fixture must really be the zero case AND must really have produced a
    // digest. Without them "no new line" would also be satisfied by an empty
    // range, or by a `body` that failed to build at all.
    const ui5 = join(tmp, 'objectui-all-declared');
    mkdirSync(join(ui5, '.changeset'), { recursive: true });
    const g5 = (...args) => git(ui5, args);
    g5('init', '-q', '-b', 'main');
    g5('config', 'user.email', 'selftest@objectstack.ai');
    g5('config', 'user.name', 'self test');
    g5('config', 'commit.gpgsign', 'false');
    const commit5 = (subject, files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui5, path)), { recursive: true });
        writeFileSync(join(ui5, path), content);
      }
      g5('add', '-A');
      g5('commit', '-q', '-m', subject);
      return g5('rev-parse', 'HEAD').trim();
    };
    const base5 = commit5('chore: base', { 'README.md': 'base\n' });
    commit5('feat(core): every commit in this range declares (#3700)', {
      '.changeset/core-declares.md':
        '---\n"@object-ui/core": minor\n---\n\nA declared change.\n',
      'src/core.ts': 'a\n',
    });
    commit5('fix(fields): and so does this one (#3701)', {
      '.changeset/fields-declares.md':
        '---\n"@object-ui/fields": patch\n---\n\nAnother declared change.\n',
      'src/fields.ts': 'b\n',
    });
    const head5 = g5('rev-parse', 'HEAD').trim();

    const allDeclared = buildDigest({
      objectuiRoot: ui5,
      frameworkRoot: fwPlain,
      from: base5,
      to: head5,
    });
    check(
      '#6174 a range where every commit declared gains NO new line (negative polarity)',
      allDeclared.noChangeset === 0 &&
        allDeclared.releasing.length === 2 &&
        !allDeclared.body.includes('_(no changeset)_') &&
        !allDeclared.body.includes('declared nowhere'),
      allDeclared.body,
    );

    // --- #6494: the ADR-0087 disposition scaffold ---------------------------
    // The gate's own marker pattern (check-adr-0087-registration.mjs:416),
    // copied rather than imported: that module's CLI dispatch is top-level, so
    // importing it would RUN the gate. The copy is belt-and-braces — the REAL
    // gate binary judges a real artifact in the round trip below, and that, not
    // this regex, is the authority on what the marker means.
    const markersIn = (text) =>
      [...text.matchAll(/<!--\s*adr-0087\s*:\s*([\s\S]*?)-->/g)].map((m) =>
        m[1].replace(/\s+/g, ' ').trim(),
      );

    // A range with NOTHING breaking in it, forced to `major` the way
    // `CONSOLE_BUMP=major` does. The frontmatter alone is a breaking declaration
    // to the gate, so this is the artifact a `breaking > 0` proxy would miss.
    const majorOverride = buildDigest({
      objectuiRoot: ui5,
      frameworkRoot: fwPlain,
      from: base5,
      to: head5,
      bumpOverride: 'major',
    });

    check(
      '#6494 an artifact that DECLARES breaking carries EXACTLY ONE adr-0087 marker',
      annotated.adr0087Scaffold === true &&
        markersIn(annotated.body).length === 1 &&
        annotated.body.includes(ADR_0087_SCAFFOLD) &&
        digest.adr0087Scaffold === true &&
        markersIn(digest.body).length === 1,
      annotated.body,
    );
    check(
      '#6494 the marker is a PLACEHOLDER — it names no disposition at all',
      // Both legal forms must MISS it, or the generator would have answered the
      // question on the human's behalf — the one thing #6148 forbids.
      (markersIn(annotated.body)[0] ?? '').startsWith('TODO') &&
        !/^registered\b/i.test(markersIn(annotated.body)[0] ?? '') &&
        !/^not-required\b/i.test(markersIn(annotated.body)[0] ?? ''),
      markersIn(annotated.body)[0],
    );
    check(
      '#6494 a `major` FRONTMATTER alone arms the gate — the scaffold follows it there',
      // The gate declares breaking on the frontmatter ALONE, with no marker in
      // the body, so a `breaking > 0` proxy would have missed this artifact.
      majorOverride.bump === 'major' &&
        majorOverride.breaking === 0 &&
        !/\*\*BREAKING/i.test(majorOverride.body) &&
        majorOverride.adr0087Scaffold === true &&
        markersIn(majorOverride.body).length === 1,
      majorOverride.body,
    );
    check(
      '#6494 a NON-breaking artifact carries no marker at all (negative polarity)',
      // Declared as negative polarity: deleting the emission also produces no
      // marker, so this cannot go red under that ablation. It pins a DIFFERENT
      // regression — a marker on an artifact the gate never judges, which would
      // sit unanswered forever and teach the next reader to ignore it. The three
      // positive guards keep it from passing for the vacuous reason (an empty or
      // unbuilt body would satisfy "no marker" just as well).
      allDeclared.releasing.length === 2 &&
        allDeclared.breaking === 0 &&
        allDeclared.bump === 'minor' &&
        allDeclared.adr0087Scaffold === false &&
        markersIn(allDeclared.body).length === 0,
      allDeclared.body,
    );
    check(
      '#6494 the flag, the rendered marker and the gate criterion agree on EVERY fixture',
      [digest, plain, overridden, capped, annotated, named, named2, released, allDeclared, majorOverride].every(
        (d) =>
          d.adr0087Scaffold === (markersIn(d.body).length === 1) &&
          d.adr0087Scaffold === (d.bump === 'major' || /\*\*BREAKING/i.test(d.body)),
      ),
      [digest, plain, overridden, capped, annotated, named, named2, released, allDeclared, majorOverride]
        .map((d) => `${d.bump}/${d.adr0087Scaffold}/${markersIn(d.body).length}`)
        .join(' '),
    );

    // --- #6494 THE ROUND TRIP, through the REAL gate ------------------------
    // The claim "the gate recognises this as present-but-unanswered" is about
    // ANOTHER script, so nothing short of that script's own verdict settles it.
    // A throwaway repo carrying the gate's required inputs (#4690: it refuses to
    // report a verdict without them) plus a COPY of the gate, so its REPO_ROOT
    // resolves here — the same idiom the bump-objectui.sh run above uses.
    const gateRepo = join(tmp, 'fw-gate');
    mkdirSync(gateRepo, { recursive: true });
    const gg = (...args) => git(gateRepo, args);
    const gw = (rel, text) => {
      mkdirSync(dirname(join(gateRepo, rel)), { recursive: true });
      writeFileSync(join(gateRepo, rel), text);
    };
    gg('init', '-q', '-b', 'main');
    gg('config', 'user.email', 'selftest@objectstack.ai');
    gg('config', 'user.name', 'self test');
    gg('config', 'commit.gpgsign', 'false');
    const LEDGER_ENTRY = (id) =>
      `export const X = {\n  semantic: [\n    {\n      id: '${id}',\n      surface: 's',\n    },\n  ],\n};\n`;
    gw('packages/spec/src/migrations/registry.ts', LEDGER_ENTRY('old-entry-one'));
    gw('packages/spec/src/conversions/registry.ts', LEDGER_ENTRY('a-conversion'));
    gw(
      'packages/spec/spec-changes.json',
      `${JSON.stringify({ perMajor: [{ to: 17, migrated: [{ migrationId: 'old-entry-one' }] }] }, null, 2)}\n`,
    );
    // One declared-breaking changeset in STOCK (committed at base, so it is not
    // in the judged diff) — the gate's convention-rot assertion needs its
    // breaking detector to match something.
    gw('.changeset/stock-breaking.md', '---\n"@objectstack/spec": major\n---\n\nstock\n\n**BREAKING** something\n');
    gw(
      'scripts/check-adr-0087-registration.mjs',
      readFileSync(join(__dirname, 'check-adr-0087-registration.mjs'), 'utf8'),
    );
    gg('add', '-A');
    gg('commit', '-q', '-m', 'base');
    const gateBase = gg('rev-parse', 'HEAD').trim();

    // The range is the #6099 fixture: `minor` + the author's own annotation,
    // objectui's ORDINARY breaking shape and the one that reopens this every bump.
    const gateCs = join(gateRepo, '.changeset', `console-${head2.slice(0, 12)}.md`);
    const generated = spawnSync(
      process.execPath,
      [selfPath, '--objectui-root', ui2, '--framework-root', gateRepo, '--from', base2, '--to', head2, '--out', gateCs],
      { encoding: 'utf8' },
    );
    gg('add', '-A');
    gg('commit', '-q', '-m', 'chore(console): bump objectui pin');
    const runGate = () =>
      spawnSync(process.execPath, [join(gateRepo, 'scripts', 'check-adr-0087-registration.mjs'), '--base', gateBase], {
        encoding: 'utf8',
        cwd: gateRepo,
      });

    const gateRed = runGate();
    check(
      '#6494 ROUND TRIP (red): the REAL gate reads the marker and refuses it as UNANSWERED',
      generated.status === 0 &&
        gateRed.status !== 0 &&
        // The EXACT verdict, not merely "it is red": present-but-unparseable is a
        // different fact from absent, and only the first one proves the scaffold
        // reached the gate at all.
        /but unparseable disposition: "TODO/.test(gateRed.stderr) &&
        gateRed.stderr.includes(`console-${head2.slice(0, 12)}.md`) &&
        gateRed.stderr.includes('<!-- adr-0087: not-required (no-migration-prescription) why -->'),
      `generator=${generated.status} gate=${gateRed.status}\n${gateRed.stderr}`,
    );
    check(
      '#6494 the operator is told at BUMP time, not one push later',
      generated.stderr.includes('UNANSWERED ADR-0087') && generated.stderr.includes('adr-0087: TODO'),
      generated.stderr,
    );

    // The other half. Same file, same range, same generator — only the human's
    // answer is added, and the gate's verdict flips. A red that no answer can
    // clear would be a broken gate, not a scaffold.
    //
    // The replacement is CHECKED before it is committed, and the commit allows an
    // empty tree. Found while reverse-verifying this group: with the emission
    // ablated there is no placeholder to replace, so the write was a no-op, `git
    // commit` exited 1 on a clean tree and threw — the whole self-test died with
    // a raw `execFileSync` stack instead of naming a failed check. An ablation is
    // exactly when the next reader needs a NAME, not a stack trace.
    const answered = readFileSync(gateCs, 'utf8').replace(
      ADR_0087_SCAFFOLD,
      '<!-- adr-0087: not-required (already-registered old-entry-one) the pinned frontend range carries no spec surface beyond that entry -->',
    );
    check(
      '#6494 the answer replaces the placeholder IN PLACE — one marker before, one after',
      answered !== readFileSync(gateCs, 'utf8') &&
        !answered.includes('adr-0087: TODO') &&
        markersIn(answered).length === 1,
      answered.slice(-400),
    );
    writeFileSync(gateCs, answered);
    gg('add', '-A');
    gg('commit', '-q', '--allow-empty', '-m', 'answer the ADR-0087 question');
    const gateGreen = runGate();
    check(
      '#6494 ROUND TRIP (green): a real disposition written in that same place clears it',
      gateGreen.status === 0 &&
        gateGreen.stdout.includes(
          '✓ check-adr-0087-registration: 1 declared-breaking changeset(s), each carrying an ADR-0087 disposition.',
        ),
      `status=${gateGreen.status}\n${gateGreen.stdout}\n${gateGreen.stderr}`,
    );
    // ---- #7004: the frontmatter shapes the old entry anchor hid ------------
    //
    // This file is the FOURTH carrier of the family's entry regex and the one
    // #7004's report did not name. Its consequence is neither a false green nor
    // a false red but a silent DROP: an entry the regex cannot see makes the
    // changeset read `release-nothing`, so the commit leaves the digest — the
    // #4731 harm, reached through the parser instead of through a type filter.
    // Worst, as ever, for breaking changes, which is the one class that must
    // never vanish from a release record.
    //
    // Predicted direction on reverse verification: restoring the old anchor
    // (`([A-Za-z]+)\s*$`) turns C1-C5 red (packages goes `{}`) and C6 red in the
    // other direction (a phantom package named `# note`).
    const pkgsOf = (block) => JSON.stringify(parseChangeset(`---\n${block}\n---\n\nsummary\n`).packages);
    check('#7004 C1 a trailing YAML comment still declares its package', pkgsOf('"@object-ui/layout": major # keep') === '{"@object-ui/layout":"major"}', pkgsOf('"@object-ui/layout": major # keep'));
    check('#7004 C2 a trailing comment after a tab', pkgsOf('"@object-ui/layout": minor\t# keep') === '{"@object-ui/layout":"minor"}', pkgsOf('"@object-ui/layout": minor\t# keep'));
    check('#7004 C3 a double-quoted bump value', pkgsOf('"@object-ui/layout": "major"') === '{"@object-ui/layout":"major"}', pkgsOf('"@object-ui/layout": "major"'));
    check('#7004 C4 a single-quoted bump value with a comment', pkgsOf('"@object-ui/layout": \'minor\' # keep') === '{"@object-ui/layout":"minor"}', pkgsOf('"@object-ui/layout": \'minor\' # keep'));
    check(
      '#7004 C5 a commented entry beside an uncommented one — BOTH survive',
      pkgsOf('"@object-ui/a": major # keep\n"@object-ui/b": patch') === '{"@object-ui/a":"major","@object-ui/b":"patch"}',
      pkgsOf('"@object-ui/a": major # keep\n"@object-ui/b": patch'),
    );
    check(
      '#7004 C6 a whole-line comment containing a colon is NOT a package (it used to parse as one named `# note`)',
      pkgsOf('# note: major\n"@object-ui/real": patch') === '{"@object-ui/real":"patch"}',
      pkgsOf('# note: major\n"@object-ui/real": patch'),
    );
    check(
      '#7004 C7 control — the same shape with an unknown bump word still declares nothing, so C1-C6 are about the entry regex and not about LEVEL_RANK being bypassed',
      pkgsOf('"@object-ui/layout": enormous # keep') === '{}',
      pkgsOf('"@object-ui/layout": enormous # keep'),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n⛔ objectui-changeset-digest --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log('✓ objectui-changeset-digest --self-test: all checks passed');
  return 0;
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
