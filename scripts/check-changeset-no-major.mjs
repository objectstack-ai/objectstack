#!/usr/bin/env node
/**
 * Two questions about the changesets a PR INTRODUCES, answered in one run:
 *
 *   1. LAUNCH-WINDOW GUARD — a PR may not introduce a changeset that declares a
 *      `major` bump. Everything above "The LEVEL axis" below is this.
 *   2. THE LEVEL AXIS (#16055) — a PR that DECLARES clause ② (a new key on a
 *      published payload) must grade AT LEAST ONE package whose published
 *      source it moves `minor` or above; and (#16776) a PR that
 *      grades none of them that way must not leave the declaration UNREADABLE:
 *      where the missing reading is what decides the verdict, this refuses
 *      rather than exiting 0 into a check run that concludes `success`. The
 *      "at least one" is #16361 — the declaration is PR-scoped and names no
 *      package, so a PR-scoped predicate is the whole of what it entails. Read
 *      the block headed "The LEVEL axis" for what it cross-checks, where the
 *      declaration comes from, and the residual it records.
 *
 * The run exits with the WORSE of the two verdicts and prints both, because
 * they are independent facts about one changeset set.
 *
 * Run:  node scripts/check-changeset-no-major.mjs --base <ref-or-sha> [--head <ref>]
 *       node scripts/check-changeset-no-major.mjs              # base defaults to origin/main
 *       node scripts/check-changeset-no-major.mjs --self-test  # verify the checker itself
 *       node scripts/check-changeset-no-major.mjs --list       # audit the whole .changeset dir
 *
 *       # the level axis driven offline: `--event` names a GitHub Actions
 *       # `pull_request` payload and makes it the WHOLE declaration input, so a
 *       # verdict is exactly reproducible and never half a document and half a
 *       # live board. In CI the same payload is already on disk at
 *       # `$GITHUB_EVENT_PATH` and is read with no flag, no token and no network.
 *       node scripts/check-changeset-no-major.mjs --base <sha> --event event.json
 *
 * `--base` names the BRANCH POINT to judge against, not the first commit of the
 * diff: the scan always starts at `merge-base(<base>, <head>)`. See "Where the
 * diff starts" below — getting this wrong is #6129, and #7005 is this file's own
 * instance of it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every publishable package is enumerated in the Changesets `fixed` group
 * (see `.changeset/config.json` + `check-changeset-fixed.mjs`), so the whole
 * monorepo versions in LOCKSTEP. Changesets applies the HIGHEST bump found
 * across the group to EVERY package in it. That means a single `major` on any
 * one package — even a tiny spec helper — silently promotes the entire release
 * (all ~70 packages) from e.g. `14.2.0` to `15.0.0`.
 *
 * During the launch window we ship breaking changes as `minor` (pre-1.0
 * semantics: a breaking change does not burn a major version number while the
 * stack is in lockstep). This guard makes that convention enforceable instead
 * of tribal, so an over-strict `major` marker can never again turn an ordinary
 * PR into a whole-stack major release by accident.
 *
 * ## END CONDITION: the convention above expires at GA (#14043)
 *
 * The convention applies during the LAUNCH WINDOW ONLY. It is recorded here,
 * with its expiry, because a window-period convention carrying no written end
 * condition erodes into a permanent exception — the reader two years from now
 * finds a guard that forbids `major` and no statement that it was ever meant to
 * stop.
 *
 * **End condition: at GA — the fixed group's first general-availability major —
 * the group returns to STRICT SEMVER.** From that point a required member on a
 * published interface, an accept-set narrowing, or any compile-breaking change
 * to implementers grades `major`, and grades it for the reason semver says so:
 * the bump level is the carrier again.
 *
 * Until then it is NOT the carrier, and that is the whole cost of the window:
 * a breaking change ships as `minor`, so the bump level tells a consumer
 * nothing about whether the release breaks them. The mandatory information
 * carriers for breaking-ness in the meantime are the **BREAKING** banner the
 * author writes in the changeset body and the ADR-0087 migration-ledger
 * disposition (`check-adr-0087-registration.mjs` refuses a declared breaking
 * change that states neither). They are not documentation niceties — during the
 * window they are the only signal there is.
 *
 * CHOOSING BETWEEN THE TWO LEVELS THIS GUARD LEAVES: a purely additive widening
 * of a published package's public surface takes at least `minor`, and the commit
 * type may raise a bump but never lower it — the rule is written out in full in
 * the `Check Changeset` step's prose in `.github/workflows/pr-automation.yml`
 * ("WHICH LEVEL"), where the author who is told a changeset is missing reads it
 * (maintainer ruling, 2026-09-04 decision batch #35, on #15294).
 *
 * ⇒ **THIS GUARD IS WHAT GETS DISARMED AT GA.** The end condition lives in the
 * file that enforces the convention, rather than in a prose home elsewhere, so
 * that declared = enforced stays in one place: whoever closes the launch window
 * retires this check (and with it the `allow-major` escape hatch, whose error
 * message — "a whole-stack major release is genuinely intended" — becomes
 * ordinarily true again). Reaching GA without touching this file means the
 * window did not actually close.
 *
 * Exits with code 1 (and a clear list of offenders) if the diff introduces a
 * changeset that bumps a package `major`.
 *
 * RC EXEMPTION: when Changesets is in pre-release mode (`.changeset/pre.json`
 * with `"mode": "pre"`, entered via `changeset pre enter <tag>`), a `major`
 * bump only ever produces a `X.0.0-<tag>.N` PRE-RELEASE version — nothing final
 * publishes until `changeset pre exit`. Accumulating the next major's breaking
 * changes is precisely what an RC window is FOR, so this guard stands aside for
 * the duration and re-arms automatically once pre-mode is exited. The majors the
 * diff introduces are still printed (informationally) so the RC curator can see
 * them go by; the whole pending stock is `--list`.
 *
 * ESCAPE HATCH: outside pre-mode, when a major release is genuinely intended,
 * gate this check off in CI with the `allow-major` PR label (see
 * `.github/workflows/pr-automation.yml`).
 *
 * The script has zero THIRD-PARTY dependencies, so it still runs before
 * `pnpm install`. It does now depend on `git` and on being run inside the
 * repository with a resolvable base — see "The cost of the branch point" below.
 *
 * ## Where the diff starts (#7005, and it is #6129 again)
 *
 * This guard used to read the whole `.changeset` directory (`readdirSync`, no
 * branch point) and fail if ANY pending changeset declared a `major`. Its
 * verdict was therefore a function of what main carried, not of what the author
 * wrote — the same defect `check-empty-changeset.mjs` carries a long note about,
 * reached by a different route: not a frozen base ref, but no base ref at all.
 *
 * It went unnoticed because the enforcing half has never run: the RC exemption
 * above stands the guard down for the whole pre-release window. What made it
 * urgent is that the window ENDS. Measured on `origin/main` @ `d3e53f2d8`, under
 * `@changesets/cli` v2, with `pre.json` still at `"mode": "pre"`:
 *
 *   total .changeset/*.md (excl README):  1552
 *   FILES declaring a major:               171
 *   total major package entries:           222
 *   pre.changesets recorded:              1279
 *
 * Those files were on disk because pre-mode `changeset version` under v2 did not
 * delete the changesets it consumed — it recorded them in `pre.json.changesets`
 * so the final release could re-apply them, and only the POST-EXIT
 * `changeset version` deleted them. So `changeset pre exit` rewrote the mode to
 * `"exit"`, that commit landed on main, and from that moment until the Version PR
 * merged, the stock-scoped guard would have failed EVERY unlabelled PR in the
 * repo — each one listing 171 files it never touched, with `allow-major` as the
 * only route out. That label's own error message says "a whole-stack major
 * release is genuinely intended", which is false for a PR fixing a typo, so the
 * escape hatch would have meant something different from what it says for the
 * duration of the window.
 *
 * ### What `@changesets/cli` v3 changes here, and what it does not
 *
 * v3 MOVES each consumed changeset into `.changeset/pre/NAME.md` at the cut that
 * consumes it (changesets#2190) instead of leaving it in the root. Measured on a
 * v3 cut of this repo's own stock — 209 pending changesets, 17.0.0 ->
 * 17.1.0-rc.0, a full `pnpm run version` in a throwaway clone: afterwards the
 * root holds only the UNCONSUMED residue, all 209 consumed files sit under
 * `.changeset/pre/`, and `readChangesets` below — a root-only `readdirSync`
 * filtered to `.md` — does not enumerate them (`pre` is a directory, not a
 * `.md`). The 1552-file high-water mark and the single post-exit deletion event
 * that made this urgent are both gone; the stock this guard could ever read is
 * bounded now.
 *
 * NONE OF THAT RETIRES A LINE OF THE FIX BELOW, and this section is written to
 * be unreadable as though it did. Stock size was the URGENCY; it was never the
 * ARGUMENT. The argument is #6129's — "what this PR introduced" is a claim about
 * one side of a fork and cannot be evaluated without the fork — and it is exactly
 * as true at a stock of 2 as at 1552. What v3 does add is a new population of `R`
 * rows on the ORDINARY path; see the diff-row table below.
 *
 * The fix is the sibling's, deliberately rather than coincidentally: judge only
 * what the diff INTRODUCES, starting at `merge-base(base, head)` and never at
 * `base` itself. Both halves of #6129's argument apply here unchanged —
 *
 *   - fed a FROZEN commit, every changeset main gained while the PR sat open
 *     reads as added by this PR;
 *   - fed a moving BRANCH, a two-dot diff misreads DELETIONS on the base branch
 *     as additions on this one — and the post-exit `changeset version` deleting
 *     all 1279 consumed changesets at once is exactly that event.
 *
 * `merge-base(X, head)` is `X` again whenever `X` is already the branch point, so
 * a caller handing over an exact merge base loses nothing by this.
 *
 * The stock is therefore exempt with no list and no maintenance: "absent-or-
 * non-major at the branch point" says it once, where a roster of 171 names would
 * be a high-water mark that rots on the first merge (the #5471 shape).
 *
 * What this does NOT change: at `changeset pre exit` a whole-stack major really
 * IS intended, and the release's own Version PR is what carries it. That PR is
 * exempt at the job level (`changeset-check` skips `changeset-release/main`), so
 * the intended major still lands. What moves is who pays: the release, not the
 * author of an unrelated PR.
 *
 * ## The three diff rows, and why `M` and `R` are judged rather than skipped
 *
 *   A  added, declares a major at head                     -> offence
 *   M  declares a major at head, not at the branch point   -> offence (majored in place)
 *   M  declares the same major at the branch point         -> exempt  (stock, prose edited)
 *   R  renamed AND newly declares a major                  -> offence
 *   R  renamed, same major as at the branch point          -> exempt  (stock, moved)
 *   *  no major at head                                    -> ok
 *
 * Row 2 removes the obvious bypass: taking a stock `minor` changeset and editing
 * the bump word to `major` introduces a brand-new whole-stack major — exactly
 * the harm — while `--diff-filter=A` alone sees nothing. Row 3 keeps the stock
 * exempt when a PR legitimately edits an existing major changeset's prose.
 *
 * The comparison is per PACKAGE, not per file, so a PR that adds
 * `"@objectstack/cli": major` to a changeset already declaring
 * `"@objectstack/spec": major` is reported for `@objectstack/cli` alone. The
 * report naming only what the PR introduced is the entire point of the card.
 *
 * `R` is in the filter because of a bypass measured here first. On git 2.43.0,
 * renaming `.changeset/old.md` to `.changeset/new.md` while flipping its bump to
 * `major` reports as `R075 .changeset/old.md .changeset/new.md` and is dropped
 * entirely by `--diff-filter=AM` — a silent bypass. `AMR` plus reading the base
 * side at the OLD path closes it and costs nothing, because a pure rename
 * compares equal and stays exempt.
 *
 * This paragraph used to say the two siblings `check-empty-changeset.mjs` and
 * `check-adr-0087-registration.mjs` "both use `--diff-filter=AM`", i.e. that they
 * still carried the hole. That stopped being true at #7045 and is corrected here
 * rather than repeated: measured on the tree this line ships in, both siblings
 * pass `AMR` today. A stale claim about a sibling's filter is worse than no
 * claim — it is the kind a reader acts on.
 *
 * Under `@changesets/cli` v3 the `R` row also stops being a hand-crafted-bypass
 * shape and becomes the ORDINARY one. A cut renames every consumed changeset into
 * `.changeset/pre/`, and git's `.changeset/*.md` pathspec reaches into that
 * directory (`*` crosses `/` in a pathspec). Measured on a real v3 cut commit of
 * this repo: `git diff --name-status --diff-filter=AMR <cut>^ <cut> --
 * '.changeset/*.md'` returns exactly 209 `R100` rows, every one under `pre/`. So
 * any PR that merges main after a cut now carries a whole cut's worth of `R` rows
 * through this gate. They are pure renames, so the base-side read at the OLD path
 * compares equal and every one is exempt — but only because the filter says
 * `AMR`. Dropping the `R` would no longer hide one crafted rename; it would hide
 * a cut.
 *
 * ## The cost of the branch point, stated rather than slipped in
 *
 * This file used to have no dependency on `git` at all, which let it run in a
 * checkout with no history. It now shells out to `git merge-base`, `git diff`
 * and `git show`. That is a real reduction in where it can run, and it is the
 * price of the fix: "what this PR introduces" is a claim about one side of a
 * fork, and there is no way to evaluate it without the fork. The sibling already
 * pays exactly this cost for exactly this reason. Zero THIRD-PARTY dependencies
 * still holds — `node:child_process` and the `git` binary are both already
 * required by the two steps that run beside this one.
 *
 * A base that cannot be resolved, or that has no merge base with head, exits 1
 * rather than 0 (#4690): a gate that cannot read its input has verified nothing,
 * and exiting 0 there reads as "no violations" in every checks list.
 *
 * ## What `--self-test` covers, and what a green tick from this file means (#6923)
 *
 * Read this before trusting a green tick. Both halves below are stated as a
 * condition rather than as a reading of the release phase the repo happens to be
 * in — the wording they replace was the latter, and `changeset pre exit`
 * falsified it without touching a line of code (see RE-DERIVED at the end).
 *
 *   COVERED, IN EVERY REPO PHASE — every decision this file makes: the
 *   frontmatter dialects, the pre-mode/exit-mode switch in BOTH directions, the
 *   diff scoping driven through real temp git repositories (including a real
 *   `refs/pull/N/merge` shape with a base branch that keeps moving), and the
 *   rendered text of the offenders report. None of it can move with the release
 *   train: the fixtures pass `judge()` its `pre` argument directly and build
 *   their own throwaway repos, and the assertions that did read the real
 *   `.changeset/` for its PHASE were removed at #8654 (see the reader block in
 *   `--self-test`). They run in a job with no label exemption —
 *   `check:changeset-gate-self-tests`, lint.yml's ESLint job (#6509/PR #6917) —
 *   so they execute on every PR.
 *
 *   WHICH GREEN TICK — this file has two, they rule out different things, and
 *   the text is what distinguishes them:
 *
 *     "introduces no `major` bump"      the `clean` verdict. Decided BEFORE
 *                                       pre-mode is consulted — the verdict
 *                                       ORDER in `judge` is contract, and pinned
 *                                       by `--self-test` — so it means what it
 *                                       says in every phase.
 *
 *     "in pre-release mode (tag: …)"    the `exempt` verdict. A `major` WAS
 *                                       introduced and stood aside for the
 *                                       window. Reachable ONLY while
 *                                       `.changeset/pre.json` parses with
 *                                       `"mode": "pre"`.
 *
 *   So the question a reader must answer is not "green or red" but WHICH green.
 *   What the phase governs is only whether the real scan can reach `enforce` at
 *   all: never inside a pre-release window, always outside one — absent, `"exit"`
 *   and unreadable all enforce. `--list` prints the mode it read; an ordinary run
 *   does not, which is exactly why the two ticks are worded apart.
 *
 *   Fixtured is still not the same as executed, and keeping those two apart is
 *   what this note is for. The enforcing branch is reached by the real scan only
 *   on a PR that introduces a `major` outside a pre-release window — rare by
 *   construction, since the guard exists to make that PR rare — so `--self-test`
 *   remains the only thing that exercises it on a routine basis.
 *
 *   RE-DERIVED, not re-worded. This paragraph used to read "`.changeset/pre.json`
 *   says `"mode": "pre"`, so the real scan below still takes the exemption branch
 *   and exits 0 on every run; the `enforce` verdict has never been produced by a
 *   CI invocation of this script". That was a measurement of the RC window the
 *   repo was in, not a property of this file, and it understated the gate in the
 *   direction that flatters it. It is replaced by the condition above rather than
 *   re-dated, because a dated reading of this paragraph goes stale again at the
 *   next `changeset pre enter`.
 *
 * ## The frontmatter dialects, measured against the real parser
 *
 * `majorPackagesIn` is a hand-written parser standing in for `@changesets/parse`
 * (which is a third-party dep this file may not take). Standing in for it is
 * only sound where the two agree, so they were compared rather than assumed —
 * `@changesets/parse@0.4.3`, the version this repo resolves, on 2026-08-09:
 *
 *   input                              | @changesets/parse | this file
 *   -----------------------------------|-------------------|------------------
 *   "@objectstack/spec": major         | major             | caught
 *   '@objectstack/spec': major         | major             | caught
 *   docs: major            (unquoted)  | major             | caught
 *   @objectstack/spec: major (unquoted)| THROWS invalid YAML | caught (harmless)
 *   CRLF line endings                  | major             | caught
 *   a leading blank line before `---`  | major             | caught (see below)
 *   "@objectstack/spec": MAJOR         | THROWS invalid type | caught (harmless)
 *   no closing `---` fence             | THROWS missing fm | caught (harmless)
 *   "@objectstack/spec": major # note  | major             | caught (#7004)
 *   "@objectstack/spec": "major"       | major             | caught (#7004)
 *   "@objectstack/spec": 'major' # n   | major             | caught (#7004)
 *   # note: major       (comment line) | declares NOTHING  | ignored (#7004)
 *   "@objectstack/spec": major# note   | THROWS invalid type | missed (harmless)
 *
 * Rows marked "harmless" are this file being STRICTER than changesets on a file
 * changesets refuses outright: the guard names a major in a changeset that could
 * never version anything. That direction costs an author one confusing message
 * about a file that is already broken. The opposite direction is the one that
 * matters, because it is silent.
 *
 * The last row is the one place a `#` does NOT start a comment: YAML requires
 * whitespace before an inline `#`, so `major# note` is the scalar `major# note`
 * and changesets throws `invalid version type`. The regex therefore spells the
 * comment `(?:\s+#.*)?` rather than `(?:#.*)?` — matching YAML exactly, so this
 * file misses only what changesets refuses.
 *
 * LEADING BLANK LINES (fixed in #6923). This parser used to require the fence on
 * line 1 (`if (lines[0]?.trim() !== '---') return []`), so a changeset opening
 * with one blank line declared, to this guard, nothing at all — while changesets
 * honoured its `major` and promoted the whole lockstep group. Both sibling
 * parsers (`check-empty-changeset.mjs`'s `declaredBumpsIn`,
 * `check-adr-0087-registration.mjs`'s `parseChangeset`) already skipped leading
 * blanks, and all three carry a comment saying the three read the same block —
 * so this was also the one place that comment was false. It now skips them too.
 *
 * TRAILING YAML COMMENTS were missed until #7004, together with two more shapes
 * the same anchoring hid. The entry regex used to end `([A-Za-z]+)\s*$`, which
 * accepts nothing after the bump word, so all of these read as no declaration at
 * all while changesets read a real bump:
 *
 *   "@objectstack/spec": major # keep     a trailing comment
 *   "@objectstack/spec": "major"          a QUOTED bump value  (not in #7004's report)
 *   "@objectstack/spec": 'major' # keep   both at once
 *
 * And one shape ran the other way — invented rather than hidden. A whole-line
 * comment that happens to contain a colon is entry-shaped, so `# note: major`
 * parsed as a package literally named `# note` bumped `major`. Measured against
 * @changesets/parse@0.4.3, which declares nothing for it.
 *
 * All four parsers in this family shared the regex and therefore all four gaps,
 * with a different consequence in each, so #7004 closed them family-wide in one
 * change. Measured after: 19 shapes changesets ACCEPTS now agree, 0 regressions,
 * and every surviving difference is on a file changesets throws on.
 *
 * ## RESOLVED HERE: the unreadable-input residual (#7006)
 *
 * The stock-scoped version returned a `no-changeset-dir` verdict when
 * `readdirSync('.changeset')` failed, and rendered it as exit 0 — the #4690
 * shape, a gate that could not read its input reporting "no violations". #7008
 * pinned that as current behaviour rather than endorsing it, and filed #7006 to
 * flip it.
 *
 * Diff scoping dissolves it rather than fixing it: the enforcing path no longer
 * reads the directory at all, so there is no `no-changeset-dir` verdict left to
 * exit 0 from. Its replacement is `unreadable-diff`, and that one exits 1. Every
 * way the input can now go missing — an unresolvable `--base`, no merge base at
 * all, a `git` that fails — is a failure. The self-test assertion #7008 wrote as
 * a pin on exit 0 is FLIPPED below, not deleted, so the change of direction is
 * visible in the diff. `readChangesets` survives only to serve `--list`, where
 * "no .changeset directory" is a report, not a verdict.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
// #16055, the level axis below. Both are IMPORTED rather than restated: the
// clause-② declaration has exactly one legal spelling and exactly one label
// carrier, and a second copy of either here would be a reader that can drift
// from the gate the PM protocol actually runs. Both modules import node
// builtins only, so this file still runs before `pnpm install`.
import { CONTRACT_REVIEW_LABEL } from './pm/check-half-states.mjs';
import { readClause2Line } from './pm/check-clause2-carriers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Frontmatter ──────────────────────────────────────────────────────────────

/**
 * Extract the YAML frontmatter block (between the first two `---` fences) and
 * return EVERY entry declared in it, as `{ pkg, bump }` with the bump
 * lower-cased.
 *
 * A frontmatter line looks like:  "@objectstack/spec": major
 * (single or double quotes, any surrounding whitespace).
 *
 * The entry regex is deliberately the SAME shape `check-empty-changeset.mjs`,
 * `check-adr-0087-registration.mjs` and `objectui-changeset-digest.mjs` use.
 * Four readers of one block must agree on what counts as a declaration, or one
 * of them is judging a different file than it appears to. That agreement is no
 * longer only a comment: `check-empty-changeset.mjs`'s self-test extracts the
 * regex literal from all four files and asserts they are byte-identical (#7004).
 * See the dialect table in the header for where they agree with
 * `@changesets/parse` and where they deliberately do not.
 *
 * ⛔ This function holds the family's ONE copy of that literal in this file, and
 * `majorPackagesIn` below is a filter over it rather than a second parse. A
 * second `.exec(` of the same shape anywhere in this file breaks the sibling's
 * `found.length === 1` extraction — which is the mechanism that keeps the four
 * readers byte-identical — so the level reading added by #16055 reads THIS list
 * instead of parsing the block again.
 *
 * @param {string} text
 * @returns {{ pkg: string, bump: string }[]}
 */
export function entriesIn(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines
  if (lines[i]?.trim() !== '---') return [];

  const entries = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') break; // end of frontmatter
    if (/^\s*#/.test(lines[j])) continue; // a whole-line YAML comment declares nothing
    // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
    // with an optionally quoted bump value and an optional trailing ` # comment`.
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?(?:\s+#.*)?\s*$/.exec(lines[j]);
    if (m) entries.push({ pkg: m[1].trim(), bump: m[2].toLowerCase() });
  }
  return entries;
}

/**
 * The `major`-bumped package names declared in a changeset's frontmatter.
 *
 * A filter over `entriesIn`, deliberately: see the note there on why this file
 * may hold only one copy of the family's entry regex.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function majorPackagesIn(text) {
  return entriesIn(text)
    .filter((entry) => entry.bump === 'major')
    .map((entry) => entry.pkg);
}

/** `.changeset/README.md` is documentation, never a changeset. */
const isChangesetFile = (p) => p.startsWith('.changeset/') && p.endsWith('.md') && !p.endsWith('/README.md');

// ── git helpers ──────────────────────────────────────────────────────────────
//
// Copied in shape from `check-empty-changeset.mjs` on purpose. Two gates that
// answer "what did this PR introduce" must start their diff at the same commit,
// or one of them is judging a different side of the fork than the other.

function git(args, cwd, { quiet = false } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // `execFileSync` inherits the child's stderr by default. That is right for
    // every call here except `git show` on a path that is absent at the rev,
    // where "absent" is an ANSWER rather than an error and git's `fatal: path
    // ... exists on disk, but not in <sha>` would print on a perfectly ordinary
    // run — noise on a gate's output reads as a gate failing.
    ...(quiet ? { stdio: ['ignore', 'pipe', 'ignore'] } : {}),
  });
}

/** File contents at a rev, or `null` when the path does not exist there. */
function showOrNull(rev, path, cwd) {
  try {
    return git(['show', `${rev}:${path}`], cwd, { quiet: true });
  } catch {
    return null;
  }
}

/** Resolve a ref to a commit sha, or `null`. */
export function resolveCommit(ref, cwd) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The commit the diff actually starts at: the merge base of `base` and `head`.
 * `null` when the two have no common ancestor — the caller fails on that rather
 * than falling back to `base`, see "Where the diff starts" (#6129 / #7005).
 *
 * @param {string} base
 * @param {string} head
 * @param {string} cwd
 * @returns {string|null}
 */
export function mergeBase(base, head, cwd) {
  try {
    return git(['merge-base', base, head], cwd).trim() || null;
  } catch {
    return null;
  }
}

// ── The scan ─────────────────────────────────────────────────────────────────

/**
 * The `major` declarations this diff INTRODUCES, per file.
 *
 * `base` is the branch point to judge against; the diff itself starts at
 * `merge-base(base, head)`, which is what makes the verdict a function of THIS
 * side of the fork alone (#6129 / #7005). Resolving it HERE rather than in the
 * caller is deliberate: this is the function the self-test drives, and a
 * correction that lived in the CLI could be dropped from it without a single
 * fixture noticing.
 *
 * `levels` (#16055) is the SAME diff read one axis over: every `{ pkg, bump }`
 * entry this side of the fork introduces, majors included. It is collected in
 * the same pass and from the same `entriesIn` list, so the level reading can
 * never be computed against a different set of files, a different branch point
 * or a different frontmatter dialect than the major reading it sits beside.
 *
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{
 *   introduced: { file: string, majors: string[] }[],
 *   levels: { file: string, entries: { pkg: string, bump: string }[] }[],
 *   exempt: string[],
 *   base: string,
 * }}
 * @throws when `base` and `head` have no merge base (#4690: not a pass)
 */
export function scan({ cwd, base, head = 'HEAD' }) {
  const from = mergeBase(base, head, cwd);
  if (!from) {
    throw new Error(
      `no merge base between '${base}' and '${head}' — the diff has no trustworthy starting point. ` +
        'Refusing to fall back to the raw base, which is the #6129 defect.',
    );
  }
  // `AMR`, one letter more than the two siblings: see "The three diff rows" in
  // the header for the measured rename bypass `AM` leaves open.
  const out = git(['diff', '--name-status', '--diff-filter=AMR', from, head, '--', '.changeset/*.md'], cwd);

  const introduced = [];
  const levels = [];
  const exempt = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    // `R` is `R<score>\t<old path>\t<new path>`; `A` and `M` are `<status>\t<path>`.
    const status = fields[0][0];
    const file = status === 'R' ? fields[2] : fields[1];
    // What to compare against at the branch point. For `A` this path does not
    // exist there and `showOrNull` returns null, which is the right answer; for
    // `R` it is the pre-rename name, which is the whole reason `R` is readable.
    const basePath = fields[1];
    if (!file || !isChangesetFile(file)) continue;

    const headText = showOrNull(head, file, cwd);
    if (headText === null) continue; // vanished under us; nothing to judge
    const headEntries = entriesIn(headText);

    // `A` means the path is not at the branch point at all, so there is nothing
    // to read and nothing it could already have declared.
    //
    // ...and for `M`/`R` the base side is read ONLY when that path was itself a
    // changeset. Git pairs renames by CONTENT, not by name, so under this
    // pathspec an `R` row can legitimately arrive as
    // `.changeset/README.md -> .changeset/anything.md` (measured, git 2.43.0).
    // README is documentation and declares nothing BY DEFINITION — so any major
    // it appears to declare is a phantom, and subtracting it here would report a
    // genuinely NEW major as exempt, which is this gate's expensive direction.
    // For `M` the guard is a no-op, because `basePath` is the path already
    // accepted above. Same guard, same reason, as the two siblings (#7106).
    const baseText = status === 'A' || !isChangesetFile(basePath) ? null : showOrNull(from, basePath, cwd);
    const baseEntries = baseText === null ? [] : entriesIn(baseText);

    // #16055, the level axis. An entry is INTRODUCED when the branch point did
    // not already carry that package at that same bump — so a PR that rewrites
    // `"@objectstack/cli": minor` down to `patch` introduces the `patch`, which
    // is the direction this reading exists for, while an untouched entry it
    // merely carries along introduces nothing.
    const introducedEntries = headEntries.filter(
      (entry) => !baseEntries.some((prior) => prior.pkg === entry.pkg && prior.bump === entry.bump),
    );
    if (introducedEntries.length) levels.push({ file, entries: introducedEntries });

    const majors = headEntries.filter((entry) => entry.bump === 'major').map((entry) => entry.pkg);
    if (majors.length === 0) continue;
    const already = baseEntries.filter((entry) => entry.bump === 'major').map((entry) => entry.pkg);
    // Per PACKAGE, not per file: adding a second `major` entry to a changeset
    // that already declared one is still introducing that second one.
    const added = majors.filter((pkg) => !already.includes(pkg));

    if (added.length) introduced.push({ file, majors: added });
    else exempt.push(file);
  }

  return { introduced, levels, exempt, base: from };
}

// ── The judgement ────────────────────────────────────────────────────────────

/**
 * Decide what this run should do.
 *
 * Pure: every input is an argument, so `--self-test` exercises the real decision
 * instead of a parallel imitation of it. That matters more here than in most of
 * the family, because the branch this returns `enforce` from cannot be reached
 * by ANY invocation of the real scan while the repo is in pre-mode.
 *
 * The verdicts, and the order they are decided in (the order is itself contract:
 * a clean diff in pre-mode prints the ordinary tick, never the RC notice):
 *
 *   unreadable-diff   the diff could not be computed at all       -> exit 1 (#4690)
 *   clean             the diff introduces no `major`              -> exit 0
 *   exempt            it introduces one, but pre-mode is active   -> exit 0 + notices
 *   enforce           it introduces one, pre-mode is NOT active   -> exit 1
 *
 * `introduced` is `scan()`'s list — the majors THIS DIFF adds, never the pending
 * stock. A `null` there means the scan could not be performed, and unlike the
 * `no-changeset-dir` verdict it replaces, it fails (see the #7006 note in the
 * header).
 *
 * `pre` is whatever `.changeset/pre.json` parsed to, or `null` when it is
 * absent, unreadable or malformed. All three of those collapse to `enforce`,
 * which is the safe direction: an exemption is a licence to promote every
 * package in the repo to a new major, and handing one out because a file could
 * not be read is the #4690 anti-pattern pointed at the release train.
 *
 * @param {{
 *   introduced: { file: string, majors: string[] }[] | null,
 *   pre: { mode?: string, tag?: string } | null,
 * }} input
 * @returns {{ verdict: string, offenders: { file: string, majors: string[] }[], tag: string | null }}
 */
export function judge({ introduced, pre }) {
  if (!introduced) return { verdict: 'unreadable-diff', offenders: [], tag: null };
  if (introduced.length === 0) return { verdict: 'clean', offenders: [], tag: null };
  if (pre?.mode === 'pre') return { verdict: 'exempt', offenders: introduced, tag: pre.tag ?? 'unknown' };
  return { verdict: 'enforce', offenders: introduced, tag: null };
}

// ── Reporting ────────────────────────────────────────────────────────────────

/**
 * Render a verdict into the lines this script prints and the code it exits with.
 *
 * Separated from `judge` and from `console` so the self-test can assert the
 * MESSAGE, not merely the exit code. On the day the enforcing half re-arms, its
 * report is the only thing standing between a curator and a whole-stack major,
 * and "exits 1" does not tell anyone which file to look at.
 *
 * @param {ReturnType< typeof judge >} result
 * @returns {{ exitCode: number, stdout: string[], stderr: string[] }}
 */
export function render(result) {
  const stdout = [];
  const stderr = [];

  switch (result?.verdict) {
    // #7006, resolved by #7005 rather than pinned: the input this gate cannot
    // read is now a diff, and a diff it could not compute is a FAILURE. The
    // predecessor verdict (`no-changeset-dir`) exited 0 here.
    case 'unreadable-diff':
      stderr.push(
        '⛔ check-changeset-no-major: the diff against the branch point could not be computed, ' +
          'so nothing was verified. Missing input is a failure, never a pass (#4690).',
      );
      return { exitCode: 1, stdout, stderr };

    case 'clean':
      stdout.push('✓ This diff introduces no `major` bump.');
      return { exitCode: 0, stdout, stderr };

    // RC exemption: in Changesets pre-release mode a `major` only yields a
    // `X.0.0-<tag>.N` pre-release — the intended product of an RC window — and
    // nothing final ships until `changeset pre exit`. Surface the introduced
    // majors for the RC curator, but do not fail. The guard re-arms once
    // pre-mode exits: `changeset pre exit` rewrites pre.json's mode to `"exit"`
    // (@changesets/pre@2.0.2, its `changesets-pre.cjs.js` bundle, line 117 as
    // pinned — a dependency file, outside this tree), which is not `pre`.
    case 'exempt':
      stdout.push(
        `✓ Changesets is in pre-release mode (tag: ${result.tag}) — ` +
          '`major` bumps are the expected product of an RC window; skipping the no-major guard.',
      );
      for (const { file, majors } of result.offenders) {
        stdout.push(`::notice file=${file}::major introduced by this diff in ${file}: ${majors.join(', ')}`);
      }
      return { exitCode: 0, stdout, stderr };

    case 'enforce':
      stderr.push('⛔ This PR introduces changeset(s) that declare a `major` bump.\n');
      for (const { file, majors } of result.offenders) {
        stderr.push(`   ${file}`);
        for (const pkg of majors) stderr.push(`     - ${pkg}: major`);
      }
      stderr.push(
        '\nEvery publishable package is in the Changesets `fixed` (lockstep) group, so a single\n' +
          '`major` promotes the ENTIRE monorepo to a new major version. During the launch window\n' +
          'ship breaking changes as `minor` instead (they do not burn a major version number).\n' +
          '\n' +
          'Only what THIS diff introduces is listed above. The `major` changesets already pending\n' +
          'on the base branch are exempt and must not be cleaned up here — this gate judges diffs,\n' +
          'not stock (#7005). `--list` audits the whole pending directory.\n' +
          '\n' +
          'If a whole-stack major release is genuinely intended, add the `allow-major` label to\n' +
          'the PR to skip this check.',
      );
      return { exitCode: 1, stdout, stderr };

    default:
      // Unreachable by construction, and exiting 1 anyway. A checker that cannot
      // classify its own verdict has verified nothing, and the one thing it must
      // not do is print a tick (#4690).
      stderr.push(
        `⛔ internal: check-changeset-no-major produced an unknown verdict ${JSON.stringify(result?.verdict ?? null)}. ` +
          'A guard that cannot classify its own input has verified nothing.',
      );
      return { exitCode: 1, stdout, stderr };
  }
}

// ── The LEVEL axis (#16055) ──────────────────────────────────────────────────
//
// Everything above this line answers "is this bump `major`". Nothing answered
// "is this bump RIGHT", and #16055 measured what that costs: on PR #16044 the
// same source tree at two heads — `e0938d3fdce` grading `@objectstack/cli`
// `patch`, `98179cae022` grading it `minor`, and `git diff` between them
// returning the one changeset path and nothing else — every level-sensitive
// gate was green on BOTH. `Check Changeset`'s green is routinely read as "the
// changeset is OK"; on this axis it could not fail, so it carried no
// information about the level at all while looking exactly like a green that
// does.
//
// The repair principle the card states, and the one this block is built to
// satisfy: NAME THE AXIS YOUR CONTROL DISCRIMINATES ON, AND CHECK IT IS THE
// AXIS THAT CAN FAIL. So the self-test drives the two real heads' changeset
// bytes and asserts red on `patch` and green on `minor` for a byte-identical
// tree — a control that would have caught #16044 rather than one that grades
// the checker's own fixtures.
//
// ## What is cross-checked, and why nothing new is asked of an author
//
// Two declarations about the same PR already exist and were never compared:
//
//   ① the CLAUSE-② declaration — "this PR puts a new key on a published
//      payload" — carried by the `needs:contract-review` gate label and/or by
//      the fixed `Clause-②: yes` line the PM protocol spells (read here through
//      `check-clause2-carriers.mjs`'s own `readClause2Line`, imported rather
//      than restated, so the two readers cannot drift);
//   ② the CHANGESET LEVEL for the package whose `packages/**/src/**` the diff
//      moves.
//
// A declaration of ① plus a `patch` in ② is a self-contradiction inside one
// PR. The maintainer's ruling of 2026-09-04 (decision batch #35, on #15294) is
// already written out in the `Check Changeset` step's "WHICH LEVEL" prose: a
// purely additive widening of a published package's public surface takes AT
// LEAST `minor`, and the commit type may raise a bump but never lower it. This
// block mechanizes that sentence for exactly the PRs where the widening is
// already DECLARED, and for no others. It invents no author obligation — the
// input is a declaration the seat has already made — which is why sketch 3 of
// the filing card (a precedent lookup, a new obligation on every PR) is
// deliberately NOT here.
//
// ⭐ And it can only ever fire on a PR that is ALREADY held: the clause-②
// carrier is what keeps a PR outside the merge queue until the contract review
// clears it. So the refusal adds no new blocking state to the board; it turns a
// silent wrong level into a loud one inside a window the PR is already waiting
// out.
//
// ## THE GRAIN: the declaration is PR-scoped, so the predicate is too (#16361)
//
// ⭐ The rule above is right and is NOT what this section changes. What changed
// is the LEVEL THE RULE IS APPLIED AT, and it was measured on two PRs from one
// dispatch round — the pair, not either half alone:
//
//   * PR #16342 (head `273247e56f24`) — spec and runtime, both moved under
//     `src/**`, both graded `patch`. Six new published `STACK_*` error codes.
//     A CORRECT fire.
//   * PR #16347 (head `23443ce169af`) — `@objectstack/lint` graded `minor`, and
//     that is where the widening is (a new field-typed refusal arm on
//     `filter-preset-comparand`); `@objectstack/spec` graded `patch`, and what
//     it received is ONE re-worded TSDoc comment at `date-range-presets.ts:101`.
//     The gate refused, and it refused the SPEC line — the package that did not
//     grow — while never naming the package that did.
//
// The per-package predicate could not have done otherwise. Clause ② is declared
// ONCE, FOR THE PR: the carrier is a PR label and the `Clause-②:` line is a PR
// body line, and NEITHER NAMES A PACKAGE. Applying a PR-scoped declaration to
// every package the diff moved `src/**` of asserts something the declaration
// never said — that EACH of them was widened — and #16347 is that assertion
// being false while the gate printed it as the reason for a refusal.
//
// ⇒ The predicate is now the strongest thing the declaration actually entails,
// asked at the declaration's own grain:
//
//     A PR that declares clause-② `yes` must grade AT LEAST ONE package whose
//     `packages/**/src/**` it moves at `minor` or above.
//
// The widened package IS one of the packages the diff moved src of — a widening
// moves source — so "the widened package is graded `minor`+" IMPLIES "some
// moved package is graded `minor`+. The converse does not hold, and that gap is
// the residual this gate now NAMES rather than papering over (see `discharged`
// below). On a single-package PR the two predicates are identical; they diverge
// only where a PR moves several packages' src, which is exactly the shape that
// produced the false refusal.
//
// ⛔ WHAT THIS IS NOT. It is not a tolerance, not an allowlist, and not "skip if
// the diff is comment-only" — the filing card forbids all three and is right to:
// a comment-only heuristic goes quiet on precisely the case it was built for.
// Nothing here reads the CONTENT of a diff hunk. The inputs are unchanged — the
// packages whose `src/**` moved, the levels the changesets grade them, and the
// PR-scoped declaration — and the only thing that moved is the quantifier.
//
// ⚠️ WHAT IT CANNOT SEE, stated because an instrument that under-reads must say
// where: it cannot see WHICH package the declared act landed in, so it cannot
// catch a PR that widens TWO packages, grades one `minor` and the other `patch`.
// That was never readable from a declaration that names no package; before
// #16361 the gate did not read it either, it demanded `minor` on every moved
// package and called the demand a finding about each. The `discharged` verdict
// exists so this residual is printed on the green rather than left silent.
//
// ## Where the declaration is read from — the event payload, and nothing else
//
// This gate makes NO API call and needs NO token. Its whole input is the
// `pull_request` payload the job already receives on disk at
// `$GITHUB_EVENT_PATH` (labels + body) plus the diff it already has. That is a
// deliberate boundary, not a shortcut: the sibling reading — the card's claim
// comment — needs a credentialled network read inside a required gate, and
// MEASURED ON THE ACCEPTANCE CASE it would have answered nothing anyway.
// `cardDeclaration()` over card #15549's real comment thread returns
// `{ state: 'absent' }`: that card's claim comment is a `## Claim` heading with
// no `Clause-②:` line at all. The carrier label is what the #16044 heads
// actually carried — labelled on the PR at 2026-09-05T21:43:58Z, stripped at
// 22:38:26Z when the review passed, so it was on for the whole life of BOTH
// heads (`e0938d3fdce` was HEAD from 21:43:58Z until 22:18:39Z, `98179cae022`
// from then until the strip).
//
// ## What the payload is read on, and the one residual left
//
//   * THE PAYLOAD IS A SNAPSHOT, and both carriers move after it is taken. A
//     LABEL applied after the event fired is invisible to that run — the same
//     stale cell this job documents at length for `skip-changeset` and
//     `allow-major`, and closed the same way: `pull_request` here is triggered
//     on `labeled`/`unlabeled` too, so hanging the carrier fires a run that DOES
//     see it. Measured on #16044: the `opened` run at 21:40Z would have read NOT
//     MEASURED, and the `labeled` run three minutes later reads the carrier and
//     refuses the `patch`. The BODY moved on no trigger at all until #16776:
//     there was no `edited` type, so a `Clause-②:` line added to the body after
//     the last push was never read until somebody pushed again. That is now
//     subscribed, for the same reason and by the same argument the two other
//     PR-body-scoped gates in this repo already carry (`duplicate-fix-guard`,
//     `partof-closing-keyword-guard`): a verdict whose input is the body must
//     re-fire when the body changes, or its red cannot be cleared without a push
//     — `rerun_failed_jobs` replays the SAME frozen payload.
//   * THE CARRIER IS STRIPPED AT REVIEW PASS, so a run after the PASS no longer
//     reads a `yes` from it. That is the intended order — the human review that
//     clears the carrier is the authority on the level, and on #16044 its verdict
//     comment concurred with the `minor` grading explicitly. What it USED to mean
//     was that the axis silently stood down at exactly that moment (#16776's
//     composed failure: strip the carrier, add the durable line, push nothing,
//     and the gate concludes `success` having judged nothing). It no longer does:
//     a run with no readable declaration and a `patch` on a package the diff grew
//     REFUSES, so the standing-down is now confined to the diffs where the
//     declaration could not have changed the answer. The axis is still a
//     pre-review reading rather than a landing-time one; what it is not any more
//     is a reading that can vanish without saying so.
//   * THE `allow-major` LABEL SKIPS THE WHOLE STEP, this block included,
//     because the step it lives in is the launch-window major guard. A PR that
//     is granted a whole-stack major and ALSO grades a clause-②-declared
//     package `patch` in the same changeset set is therefore not caught. It is
//     a two-condition case with no motive, and the alternative — a second step
//     — is refused by `check-empty-changeset.mjs`'s pin on this job's failable
//     step count.
//
// ## THE DEPTH: which packages this axis can see at all (#16713)
//
// ⭐ Everything above describes what the axis DOES with a package it can see.
// Until #16713 it could see 23 of this workspace's 74 packages, because the
// package half of the path reading was one path segment wide and 51 packages
// sit at `packages/<group>/<name>/`. That is not a weaker verdict on the other
// 51 — it is NO verdict, rendered identically to a pass, and it is the failure
// this whole file is otherwise built to refuse: the green printed for them said
// "the axis looked and approved" while meaning "the axis did not look".
//
// It also escaped the one instrument that should have caught it. `unreadable`
// exists so a package this reading cannot NAME is never mistaken for a package
// the diff did not TOUCH (#4690) — and it stayed empty here, because a nested
// package was not an unreadable reading, it was never a candidate. ⇒ A gate
// cannot report a limb it never grew, and the residual an instrument names is
// only ever a residual of what it looks at.
//
// The reach is now the manifest set rather than a depth, and the widening was
// measured before it was chosen rather than after: over the 150 most recently
// merged PRs, driving this file's own `judgeLevel` at each merge commit against
// its parent, SEVEN verdicts move from exit 0 to exit 1 — six of them
// `not-measured-moot` -> `not-measured-material`, which one `Clause-②:` line in
// the PR body clears with no push, and one — PR #16650, `@objectstack/driver-sql`
// and `@objectstack/driver-turso` graded `patch` under a durable `Clause-②: yes`
// body line — `clean` -> `enforce`, which is this gate's own rule finding, on a
// merged PR, the thing it exists to find. ⛔ That count is a reading for the
// maintainer, never an argument for a tolerance: there is no allowlist and no
// grandfathering here, and the six are cleared by declaring, not by softening.

/**
 * The compiled-source root whose movement makes a package's PUBLISHED surface
 * the thing that grew — the FIRST of this reading's two legs.
 *
 * ⚠️ It is deliberately a path shape and not a question about the packed set,
 * and the difference is load-bearing enough to write down: `packages/cli`'s
 * `files` is `["dist","README.md","CHANGELOG.md"]`, so `src/**` is NOT packed —
 * it is what `dist` is COMPILED FROM. A predicate rewritten to ask "is this
 * path in the tarball?" would therefore stop counting `src/**` as growth, gut
 * this axis outright, and print a tick while doing it: the exact shape #16692
 * and #16713 both document. ⇒ The packed set is the reason for a SECOND leg
 * below, never a replacement for this one.
 */
const PUBLISHED_SOURCE_ROOT = 'src';

/**
 * The `bin` targets a manifest declares, as package-relative paths.
 *
 * npm packs a `bin` target REGARDLESS of `files` (#14874), which is what makes
 * this leg a published surface rather than a convenience: `packages/cli`'s
 * `files` names only `dist`, and `bin/run.js` ships anyway.
 *
 * Both spellings npm accepts are read — a bare string, and an object of command
 * names to paths — because a package that grew a second command would otherwise
 * change shape out from under a string-only reading. Anything else (an array, a
 * number, a `null`) declares no target and yields none: this is a reader, and a
 * malformed field is not a licence to guess.
 *
 * ⛔ The returned paths are the target FILES, not the directory holding them,
 * and that is measured rather than tidy. `packages/cli/bin/` holds two files:
 * `run.js`, which `bin` names and npm packs, and `run-dev.js`, which nothing
 * names and `files` excludes — it does not ship. Counting the whole directory
 * would call a non-shipping developer script a published surface, and this gate
 * may over-include only where it cannot tell the difference; here it can.
 *
 * @param {unknown} manifest a parsed package.json, or anything at all
 * @returns {string[]} package-relative target paths, `./` stripped, deduped
 */
export function binTargetsOf(manifest) {
  const bin = /** @type {{ bin?: unknown }} */ (manifest ?? {}).bin;
  const raw = typeof bin === 'string' ? [bin] : bin !== null && typeof bin === 'object' && !Array.isArray(bin) ? Object.values(bin) : [];
  const targets = new Set();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    // `./bin/run.js` and `bin/run.js` are the same target; a trailing slash and
    // a doubled separator are not, until they are normalised.
    // Order matters: separators collapse FIRST, or `.//bin/x.js` strips to
    // `/bin/x.js` and reads as absolute — a real target dropped by its spelling.
    const rel = value
      .replace(/\/+/g, '/')
      .replace(/^(?:\.\/)+/, '')
      .replace(/\/+$/, '');
    // An absolute path or one that climbs out of the package names nothing this
    // package publishes, so it is dropped rather than resolved.
    if (rel === '' || rel === '.' || rel.startsWith('/') || rel.split('/').includes('..')) continue;
    targets.add(rel);
  }
  return [...targets];
}

/**
 * Every directory this path could be the published surface OF: each ancestor
 * `D` under `packages/` that publishes the path, SHALLOWEST FIRST.
 *
 * ## Two legs, and why the second one cannot be a list (#16692)
 *
 * `D` owns the path when EITHER holds:
 *
 *   1. **compiled source** — the path reads `D/src/**`. Shape only, no manifest
 *      needed, and byte-for-byte the reading #16713 landed.
 *   2. **a packed `bin` target** — `D`'s own manifest names the path in `bin`.
 *      Manifest-derived, so it is not a written-down list of roots and cannot
 *      drift the way the one this card was filed against did.
 *
 * ⛔ Leg 2 is NOT "`bin/**` added to a list of roots". Triage ruled that out in
 * this card's own words — «it is a list, and lists drift — this finding exists
 * because of a list» — and the difference is real, not stylistic: a package that
 * points `bin` at `dist/cli.js` or `scripts/run.js` is read here and would be
 * invisible to a directory-name list.
 *
 * ## Why this is shape only for leg 1, and not a deeper pattern (#16713)
 *
 * The reading used to be a single regular expression whose package segment was
 * one-path-segment-wide, so it saw `packages/<name>/src/**` and nothing else.
 * This workspace is not flat: 51 of its 74 packages live at
 * `packages/<group>/<name>/` — every driver, service, plugin, connector,
 * trigger, adapter and app — and for all of them the segment after `packages/`
 * is the GROUP, which no `/src/` follows. So 69% of the workspace was not a
 * candidate this gate could refuse, and — worse than unrefusable — not even
 * REPORTABLE: `unreadable` stayed empty too, because a nested package never
 * entered the reading at all. #4690's distinction ("a name it could not read
 * must not look like a package the diff did not touch") was kept for an
 * unreadable manifest and could not be kept here, because the gate cannot
 * report a limb it never grew.
 *
 * ⛔ The repair is NOT a second segment in the pattern. That re-encodes today's
 * layout in a second place and goes blind again the day a package sits one
 * level deeper — the same defect by the same means, its recurrence merely
 * postponed. What is enumerated here is SHAPE ONLY, at any depth; WHICH of the
 * candidates is a real package is decided by reading its manifest out of the
 * tree in `packagesTouched`, so the layout is read rather than written down.
 *
 * ## Why SHALLOWEST first — measured, not assumed
 *
 * A path can have more than one candidate, and this repo contains the case:
 * `packages/create-objectstack/src/templates/blank/src/objects/note.object.ts`
 * is `D/src/**` for BOTH `packages/create-objectstack` and the scaffold
 * template dir `packages/create-objectstack/src/templates/blank`, which carries
 * its own manifest (`objectstack-blank`, `private: true`) — template CONTENT
 * that create-objectstack ships, not a workspace member. Resolving to the
 * NEAREST manifest would name that private template and drop the real package:
 * a regression against the one-segment reading this replaces. Shallowest first
 * returns the old answer on every path the old pattern matched and adds the
 * nested ones — measured over the whole tree, 22 package dirs matched before,
 * 72 after, and none lost.
 *
 * ## SUPERSET-ONLY, and why the reader is a required argument
 *
 * Leg 1 runs first and unconditionally, so every path that owned a directory
 * before this card owns it still: the two legs are a union and leg 2 only adds.
 * That is a SAFETY property, not a nicety — this axis may over-include
 * harmlessly and can never under-include harmlessly — and it is pinned by a
 * control rather than argued.
 *
 * ⛔ `manifestOf` is therefore REQUIRED and this throws without it. A default
 * that quietly skipped leg 2 would restore precisely the blindness this card
 * closes, at a call site that reads as if it asked the whole question, and the
 * gate would print a tick meaning "the axis did not look" (#4690). Missing
 * input is a failure, never a pass — including when the missing input is a
 * collaborator.
 *
 * @param {string} path a repo-relative path, as `git diff --name-only` prints it
 * @param {(dir: string) => object | false | null} manifestOf reads `<dir>/package.json`
 *   out of the tree under judgement: the parsed object, `false` when a manifest is
 *   THERE but will not parse, `null` when there is none. The three answers are not
 *   two: `false` makes `D` a candidate whose name cannot be read, so the path lands
 *   in `packagesTouched`'s `unreadable` set instead of in neither set — the same
 *   invariant leg 1 owes, extended to leg 2. ⚠️ Residual, stated rather than
 *   implied: where a manifest is ABSENT there is no `bin` field to have named
 *   anything, so leg 2 contributes no candidate and none is owed.
 * @returns {string[]} candidate package directories, shallowest first, deduped
 */
export function publishedSourceOwners(path, manifestOf) {
  if (typeof manifestOf !== 'function') {
    throw new TypeError(
      'publishedSourceOwners(path, manifestOf): the manifest reader is required — the `bin` leg (#16692) ' +
        'is manifest-derived, and a call that omits it would silently read `src/**` alone while looking ' +
        'like it asked the whole question (#4690).',
    );
  }
  const segments = path.split('/');
  if (segments[0] !== 'packages') return [];
  const owners = [];
  // `i` indexes the segment AFTER the candidate directory, so the candidate is
  // `segments.slice(0, i)`. It starts at 2 so the owner is at least
  // `packages/<something>` — `packages/src/**` names no package — and runs to
  // the last segment, so the candidate is always a proper ancestor of the path.
  for (let i = 2; i < segments.length; i += 1) {
    const dir = segments.slice(0, i).join('/');
    // LEG 1, compiled source. `i < segments.length - 1` keeps the path INSIDE
    // `src/` rather than being a file called `src`.
    if (segments[i] === PUBLISHED_SOURCE_ROOT && i < segments.length - 1) {
      owners.push(dir);
      continue;
    }
    // LEG 2, a packed `bin` target. `false` is a candidate on purpose: a
    // manifest that is present and will not parse cannot be asked what it
    // publishes, and that must be REPORTED rather than read as a no.
    const manifest = manifestOf(dir);
    if (manifest === false) {
      owners.push(dir);
      continue;
    }
    if (manifest && binTargetsOf(manifest).some((target) => path === `${dir}/${target}`)) owners.push(dir);
  }
  return owners;
}

/**
 * The workspace package names whose PUBLISHED surface this diff moves — its
 * `src/**` or a `bin` target it packs — read from the HEAD tree rather than
 * from the working directory, because the self-test and the acceptance run both
 * drive commits that are not checked out.
 *
 * `unreadable` is returned beside them, never folded into them: a path this
 * reading matched but whose owning manifest could not be read is a package it
 * could not name, and a name it could not read must not look like a package the
 * diff did not touch (#4690).
 *
 * ⭐ That distinction is the bill each widening has to keep paying, and both
 * widenings pay it here. #16713: a nested path now MATCHES, so a nested
 * directory whose manifest is missing or unparseable is REPORTED as unreadable
 * instead of vanishing the way every nested path used to. #16692: a directory
 * whose manifest is THERE but will not parse cannot be asked what it packs, so
 * it becomes a candidate the reader cannot name and lands in `unreadable` too
 * — rather than being read as a package that publishes nothing. The invariant,
 * stated so it can be tested: a path this reading matches lands in `packages`
 * or in `unreadable` — never in neither.
 *
 * @param {{ cwd: string, from: string, head: string }} opts
 * @returns {{ packages: string[], unreadable: string[] }}
 */
export function packagesTouched({ cwd, from, head }) {
  let out = '';
  try {
    out = git(['diff', '--name-only', from, head], cwd);
  } catch {
    return { packages: [], unreadable: [] };
  }
  // One manifest read per candidate DIRECTORY rather than per changed file: a
  // diff that moves forty files in one package would otherwise ask forty times.
  //
  // ⚠️ The cache is on the MANIFEST rather than on the name, because the `bin`
  // leg (#16692) needs the whole object and the name leg needs one field of it;
  // caching the name would make the reader read the same blob twice per dir.
  //
  // Three answers, never two — `false` is a manifest that is THERE and will not
  // parse, and it is what keeps #4690's distinction alive through leg 2: such a
  // directory becomes a candidate that cannot be NAMED, so its path lands in
  // `unreadable` below instead of in neither set.
  const manifestOfDir = new Map();
  /** @returns {object | false | null} */
  const manifestOf = (dir) => {
    if (!manifestOfDir.has(dir)) {
      const blob = showOrNull(head, `${dir}/package.json`, cwd);
      let value = null;
      if (blob !== null) {
        try {
          const parsed = JSON.parse(blob);
          value = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : false;
        } catch {
          value = false;
        }
      }
      manifestOfDir.set(dir, value);
    }
    return manifestOfDir.get(dir);
  };
  const nameFor = (dir) => {
    const manifest = manifestOf(dir);
    const name = manifest === false || manifest === null ? null : manifest.name;
    return typeof name === 'string' && name ? name : null;
  };

  const packages = new Set();
  const unreadable = new Set();
  for (const line of out.split('\n')) {
    const owners = publishedSourceOwners(line.trim(), manifestOf);
    if (owners.length === 0) continue;
    const owner = owners.find((dir) => nameFor(dir) !== null);
    if (owner) packages.add(nameFor(owner));
    // Nothing nameable on the chain: the SHALLOWEST candidate is what gets
    // reported, because it is the directory the old one-segment reading named,
    // so an unreadable manifest keeps reporting the dir it always reported.
    else unreadable.add(owners[0]);
  }
  return { packages: [...packages].sort(), unreadable: [...unreadable].sort() };
}

/**
 * The clause-② declaration this PR carries, read from the event payload alone.
 *
 * Three answers, never two — `null` is NOT MEASURED and is the reason this
 * function returns readings alongside the value: a run that could not read a
 * declaration must say which carriers it looked at, or its silence is
 * indistinguishable from a `no` (#4690, and the shape `check-clause2-carriers`
 * calls "a missing reading and a decision must not look the same").
 *
 * The disjunction is the filing card's own wording — the carrier OR the
 * declaration line — so a seat that hangs the gate without writing the line,
 * which is what #16044 did, is still read.
 *
 * @param {{ labels?: ({ name?: string }|string)[], body?: string }|null} pr
 * @returns {{ value: 'yes'|'no'|null, payload: boolean, readings: string[] }}
 */
export function declarationFromPullRequest(pr) {
  const readings = [];
  if (!pr || typeof pr !== 'object') {
    // `payload: false` is returned beside the null value, never folded into it:
    // "no pull request to read" and "a pull request that declared nothing" are
    // different facts about different runs, and #16776 is the card about two
    // facts sharing one exit code. `judgeLevel` routes on this flag.
    return { value: null, payload: false, readings: ['no `pull_request` payload was available to read a declaration from'] };
  }

  const labels = Array.isArray(pr.labels)
    ? pr.labels.map((l) => (typeof l === 'string' ? l : String(l?.name ?? ''))).filter(Boolean)
    : null;
  let carrier = false;
  if (labels === null) {
    readings.push('the payload carried no readable label list, so the clause-② carrier could not be read');
  } else if (labels.includes(CONTRACT_REVIEW_LABEL)) {
    carrier = true;
    readings.push(`carrier: \`${CONTRACT_REVIEW_LABEL}\` IS on this PR`);
  } else {
    readings.push(`carrier: \`${CONTRACT_REVIEW_LABEL}\` is not on this PR (${labels.length} label(s) read)`);
  }

  const line = readClause2Line(pr.body ?? '');
  if (line?.kind === 'declared') readings.push(`declaration line: \`${line.line}\``);
  else if (line?.kind === 'malformed') readings.push(`declaration line: MALFORMED, not a declaration — ${line.line}`);
  else if (line?.kind === 'near-miss') readings.push(`declaration line: a near miss, not a declaration — ${line.line}`);
  else readings.push('declaration line: the PR body carries no `Clause-②:` line');

  if (carrier || (line?.kind === 'declared' && line.value === 'yes')) return { value: 'yes', payload: true, readings };
  if (line?.kind === 'declared' && line.value === 'no') return { value: 'no', payload: true, readings };
  return { value: null, payload: true, readings };
}

/**
 * Decide the level axis. Pure, for the same reason `judge` is: the self-test
 * drives the real decision rather than an imitation of it.
 *
 *   unreadable-diff       the diff could not be computed               -> exit 1 (#4690)
 *   payload-unreadable    a `pull_request` run whose payload would not read -> exit 1 (#4690)
 *   no-pull-request       not a PR run at all (RC cut, local run)      -> exit 0
 *   not-measured-moot     no declaration, and nothing a `yes` could have refused -> exit 0
 *   not-measured-material no declaration, and a `yes` WOULD have refused  -> exit 1
 *   not-declared          the declaration reads `no`                   -> exit 0
 *   clean                 declared `yes`, no moved package graded `patch` -> exit 0
 *   discharged            declared `yes`, a moved package IS graded `minor`+,
 *                         and others are graded `patch`                -> exit 0
 *   enforce               declared `yes`, moved packages graded `patch` and
 *                         NONE of them graded `minor` or above         -> exit 1
 *
 * Nine verdicts and no two of them collapse, because every collapse in this
 * family has been a defect. `not-measured-*` and `not-declared` are a missing
 * reading and a decision (#16055). The two `not-measured-*` are a missing
 * reading that could not have mattered and one that decided the verdict
 * (#16776) — sharing exit 0 is what let a gate that judged nothing conclude
 * `success` on the surfaces that read conclusions rather than logs. `clean` and
 * `discharged` are #16361's: "no moved package is graded `patch`" and "some are,
 * and this gate is deliberately not refusing them" are different facts, and the
 * second one carries a residual that must be printed rather than implied by a
 * tick.
 *
 * @param {{
 *   levels: { file: string, entries: { pkg: string, bump: string }[] }[] | null,
 *   touched: { packages: string[], unreadable: string[] },
 *   declaration: { value: 'yes'|'no'|null, readings: string[], payload?: boolean },
 *   prEvent?: boolean,
 * }} input
 */
export function judgeLevel({ levels, touched, declaration, prEvent = false }) {
  const readings = declaration?.readings ?? [];
  if (!levels) return { verdict: 'unreadable-diff', offenders: [], raised: [], readings, unreadable: [] };
  const unreadable = touched?.unreadable ?? [];

  // NO PR TO READ A DECLARATION FROM. This is a different fact from "a PR that
  // did not declare", and #16776 is what happens when the two share an exit
  // code, so they do not share a verdict either. Two callers reach it and
  // neither is a PR: the RC cut (`cut-rc.yml`, `workflow_dispatch`, no
  // `--event`) and a developer running this script in a checkout. The
  // declaration lives on a pull request; where there is none, this axis has no
  // input by construction rather than by omission, and it stands down.
  //
  // ⚠️ `prEvent` is what stops that from becoming the hole this card closes: on
  // a real `pull_request` run the payload is written by the runner, so an
  // unreadable one is a broken job rather than a non-PR context, and a gate
  // that could not read the input it was owed has verified nothing (#4690).
  //
  // The test is `payload === false`, never `!== true`, and the difference is the
  // direction it fails in. `false` is written by ONE place — the reader above,
  // when there was no `pull_request` object at all — so standing down requires a
  // positive statement that there was nothing to read. A caller that omits the
  // flag entirely falls through to the lanes below, where an undeclared PR can
  // still be refused: unknown provenance enforces, which is the #4690 direction
  // this file takes everywhere else.
  if (declaration?.payload === false) {
    return prEvent
      ? { verdict: 'payload-unreadable', offenders: [], raised: [], readings, unreadable }
      : { verdict: 'no-pull-request', offenders: [], raised: [], readings, unreadable };
  }

  // The offenders are computed BEFORE the declaration is consulted, because
  // #16776's whole repair turns on a question the old order could not ask:
  // would the missing declaration have CHANGED anything? The shape a `yes`
  // refuses is exactly the materiality of the reading that did not happen, so
  // that shape has to be known first.
  //
  // #16361 changes what that shape IS, and the two halves are computed
  // separately because the message needs both. `offenders` are the moved
  // packages graded `patch` — the lines an author is being asked about.
  // `raised` are the moved packages graded `minor` or above — the ones that
  // ACCOUNT for the declared widening. A `yes` refuses only when the first set
  // is non-empty and the second is EMPTY: the declaration names no package, so
  // the most it can entail is that one of the moved packages carries the level,
  // and one that does discharges it for the PR.
  const grown = new Set(touched?.packages ?? []);
  const offenders = [];
  const raised = [];
  for (const { file, entries } of levels) {
    const bad = entries.filter((entry) => entry.bump === 'patch' && grown.has(entry.pkg)).map((entry) => entry.pkg);
    if (bad.length) offenders.push({ file, packages: bad });
    for (const entry of entries) {
      if (grown.has(entry.pkg) && (entry.bump === 'minor' || entry.bump === 'major')) raised.push({ file, pkg: entry.pkg, bump: entry.bump });
    }
  }
  // The one condition a `yes` refuses. Written once and read by both the
  // declared lane and the NOT MEASURED lane, so materiality cannot drift from
  // enforcement — two copies of this predicate is how the two would come to
  // disagree about whether an unread declaration mattered.
  const refusable = offenders.length > 0 && raised.length === 0;

  if (declaration?.value === null || declaration?.value === undefined) {
    // ⭐ #16776. `NOT MEASURED` used to be one verdict at exit 0, and the check
    // run therefore concluded `success` whether the reading was IMMATERIAL or
    // whether it was the one thing the gate needed. Those are the two halves
    // split here, and only the second one fails:
    //
    //   * MOOT — no candidate offender exists, so `yes` and `no` reach the same
    //     verdict. The exit 0 is a DECIDED one: the missing input could not have
    //     moved it, and the reader is told exactly that rather than being handed
    //     a tick that means nothing.
    //   * MATERIAL — a `patch` sits on a package this PR grew, so the declaration
    //     is the difference between `clean` and `enforce`, and it was not
    //     readable. The gate refuses. Not because the level is wrong — it may
    //     well be right — but because nobody can tell, and a reading that did
    //     not happen must not be indistinguishable from one that passed at the
    //     only layer anything downstream reads (#4690).
    return refusable
      ? { verdict: 'not-measured-material', offenders, raised, readings, unreadable }
      : { verdict: 'not-measured-moot', offenders, raised, readings, unreadable };
  }
  if (declaration.value === 'no') return { verdict: 'not-declared', offenders: [], raised: [], readings, unreadable };

  // An unread manifest can only ever hide an offender, so it cannot be reported
  // under a tick: every green below states it, and the reader is told what was
  // not named.
  if (refusable) return { verdict: 'enforce', offenders, raised, readings, unreadable };
  // #16361. A `patch` on a moved package that this gate is NOT refusing is a
  // reading it made and set aside, not an absence — it gets its own verdict so
  // the residual is printed rather than folded into a tick that means "nothing
  // to see".
  if (offenders.length) return { verdict: 'discharged', offenders, raised, readings, unreadable };
  return { verdict: 'clean', offenders: [], raised, readings, unreadable };
}

/**
 * Render the level verdict. Separated from `judgeLevel` and from `console` for
 * the same reason `render` is: the self-test asserts the MESSAGE, and "exits 1"
 * does not tell an author which word to change.
 *
 * @param {ReturnType< typeof judgeLevel >} result
 * @returns {{ exitCode: number, stdout: string[], stderr: string[] }}
 */
export function renderLevel(result) {
  const stdout = [];
  const stderr = [];
  const readings = (result?.readings ?? []).map((r) => `   · ${r}`);
  // The `patch` lines, listed WITHOUT a per-package claim about what the diff
  // did to each one. The old rendering appended "← this PR moves <pkg>'s
  // packages/*/src/**" to every line, which is true, directly under a headline
  // that said the PR "grew" them — and a reader took the pair for the finding.
  // It was not one: moving a file under `src/**` is all this gate reads, and a
  // re-worded TSDoc comment moves one (#16361, PR #16347). What each line now
  // carries is the reading itself, and the claim is made once, in prose, at the
  // grain it holds at.
  const patchLines = (offenders) => {
    const lines = [];
    for (const { file, packages } of offenders ?? []) {
      lines.push(`   ${file}`);
      for (const pkg of packages) lines.push(`     - ${pkg}: patch`);
    }
    return lines;
  };
  const raisedLines = (raised) => (raised ?? []).map(({ file, pkg, bump }) => `     - ${pkg}: ${bump}   (${file})`);
  const unreadableNote =
    (result?.unreadable ?? []).length > 0
      ? [`   ⚠️ ${result.unreadable.length} touched package dir(s) could not be named: ${result.unreadable.join(', ')} — an offender there could not be seen.`]
      : [];

  switch (result?.verdict) {
    case 'unreadable-diff':
      stderr.push(
        '⛔ check-changeset-no-major (level axis): the diff against the branch point could not be computed, ' +
          'so the changeset level was not judged either. Missing input is a failure, never a pass (#4690).',
      );
      return { exitCode: 1, stdout, stderr };

    case 'payload-unreadable':
      stderr.push(
        '⛔ check-changeset-no-major (level axis): this is a `pull_request` run and its event payload could not be ' +
          'read, so the clause-② declaration had no carrier to come from. The runner writes that file; a run that ' +
          'cannot read it has verified nothing, and missing input is a failure, never a pass (#4690).',
        ...readings,
      );
      return { exitCode: 1, stdout, stderr };

    case 'no-pull-request':
      stdout.push(
        'ℹ️ LEVEL AXIS: NOT APPLICABLE — this run has no `pull_request` to read a declaration from, so the ' +
          'clause-② axis has no input by construction rather than by omission. It is a PR-scoped reading: the RC cut ' +
          '(`cut-rc.yml`) and a local run reach here, and neither is a PR that could have declared.',
        ...readings,
        ...unreadableNote,
      );
      return { exitCode: 0, stdout, stderr };

    case 'not-measured-moot':
      stdout.push(
        'ℹ️ LEVEL AXIS: NOT MEASURED, and it could not have changed this verdict — no clause-② declaration was ' +
          'readable for this PR, AND there is nothing here a `yes` would have refused: either no changeset grades ' +
          '`patch` a package whose `packages/**/src/**` this PR moves, or one of the packages it moves is already ' +
          'graded `minor` or above and carries the level for the PR (#16361). ' +
          '`yes` and `no` reach the same answer on this diff, so this exit 0 is a decided one rather than an unread one (#16776).',
        ...readings,
        ...unreadableNote,
      );
      return { exitCode: 0, stdout, stderr };

    case 'not-measured-material':
      stderr.push('⛔ LEVEL AXIS: NOT MEASURED, and it is the one reading this PR needed.\n');
      stderr.push('   The packages this PR moves `packages/**/src/**` of, and the level each is graded:');
      stderr.push(...patchLines(result.offenders));
      stderr.push('   ⇒ none of them is graded `minor` or above, so a `yes` here would REFUSE (#16361).\n');
      stderr.push(
        'No clause-② declaration was readable, so whether this PR widened a published surface at all was not judged:\n' +
          `${(result.readings ?? []).map((r) => `   · ${r}`).join('\n')}\n` +
          '\n' +
          'This is a REFUSAL rather than the tick it used to be, and the reason is the layer above this log. A check run\n' +
          'concludes `success` or `failure`; it has no third word for "did not judge". Exiting 0 published the same\n' +
          'conclusion for a reading that passed and a reading that never happened, on every surface that reads\n' +
          'conclusions rather than step logs (#16776, and #4690: a reading that cannot fail is indistinguishable from\n' +
          'one that passed). Where the declaration could not have mattered this gate still exits 0 and says so — it is\n' +
          'refusing HERE because every package this diff moves under `packages/**/src/**` is graded `patch`, which is\n' +
          'exactly the shape a `yes` refuses (#16361).\n' +
          '\n' +
          'DECLARE IT. One line, at the START of a line in the PR BODY (a `- `, `> ` or `**` prefix is read too):\n' +
          '\n' +
          '  Clause-②: no    — this PR puts no new key on a published payload. The axis stands down and the `patch`\n' +
          '                    above is yours to keep. Say it in the line, not only in the prose around it.\n' +
          '  Clause-②: yes   — it does. Then the level rule applies, and ONE of the packages listed above — the one\n' +
          '                    that actually grew — must be graded at least `minor`. This gate cannot read which of\n' +
          '                    them that is, so it asks only that one of them carries it (maintainer ruling\n' +
          '                    2026-09-04, decision batch #35, on #15294 — written out under "WHICH LEVEL" in the\n' +
          '                    `Check Changeset` step of pr-automation.yml).\n' +
          '\n' +
          'The review seat\'s `' + CONTRACT_REVIEW_LABEL + '` carrier declares `yes` on its own and needs no line.\n' +
          '\n' +
          '⛔ The remedy is the declaration, never the deletion: dropping the changeset, or regrading the package to\n' +
          'dodge this message, changes what ships in order to quiet a gate. And the line is read from the body on the\n' +
          'next `edited` event (pr-automation.yml subscribes to it), so this red clears with no push and no re-run.',
      );
      return { exitCode: 1, stdout, stderr };

    case 'not-declared':
      stdout.push('✓ LEVEL AXIS: this PR declares clause-② `no`, so no package here is declared to have grown a published surface.', ...readings, ...unreadableNote);
      return { exitCode: 0, stdout, stderr };

    case 'clean':
      stdout.push(
        '✓ LEVEL AXIS: this PR declares clause-② `yes`, and no package whose `packages/**/src/**` it moves is graded `patch`.',
        ...readings,
        ...unreadableNote,
      );
      return { exitCode: 0, stdout, stderr };

    // #16361. A green that judged something and set it aside, printed as such.
    // It is separate from `clean` because `clean` means there was nothing of
    // this shape in the diff at all, and a tick that covers both would hide the
    // one case where this gate knowingly does not look — which is the failure
    // mode the filing card is about, one layer along.
    case 'discharged':
      stdout.push(
        '✓ LEVEL AXIS: this PR declares clause-② `yes`, and it grades a package whose `packages/**/src/**` ' +
          'it moves at `minor` or above — the declared widening is accounted for:',
        ...raisedLines(result.raised),
        '',
        '   These packages the diff also moves are graded `patch`, and are NOT refused:',
        ...patchLines(result.offenders),
        '',
        '   ⚠️ Because clause ② is declared once FOR THE PR and names no package, this gate cannot read WHICH ' +
          'package the act landed in. It therefore does not ask every moved package to carry the level — it asks ' +
          'that ONE of them does (#16361). The residual, named rather than left silent: a SECOND widening in this ' +
          'PR, graded `patch` beside the `minor` above, would not be seen here. The contract review that placed the ' +
          `\`${CONTRACT_REVIEW_LABEL}\` carrier is what reads the diff; this axis only cross-checks the levels.`,
        ...readings,
        ...unreadableNote,
      );
      return { exitCode: 0, stdout, stderr };

    case 'enforce':
      stderr.push(
        '⛔ This PR declares clause-② YES, and it grades NO package whose `packages/**/src/**` it moves\n' +
          '   at `minor` or above.\n',
      );
      stderr.push('   The packages this PR moves `packages/**/src/**` of, and the level each is graded:');
      stderr.push(...patchLines(result.offenders));
      stderr.push('   ⇒ none of them is graded `minor` or above.\n');
      stderr.push(
        'The two declarations disagree, inside one PR:\n' +
          `${(result.readings ?? []).map((r) => `   · ${r}`).join('\n')}\n` +
          '\n' +
          'A purely additive widening of a published package\'s public surface takes AT LEAST `minor`;\n' +
          'the commit type may raise a bump but never lower it below what the act requires (maintainer\n' +
          'ruling 2026-09-04, decision batch #35, on #15294 — written out in full under "WHICH LEVEL" in\n' +
          'the `Check Changeset` step of .github/workflows/pr-automation.yml).\n' +
          '\n' +
          '⚠️ WHICH of the packages above received that widening is NOT something this gate can read, and it\n' +
          'does not claim to. Clause ② is declared ONCE, FOR THE PR — the `' + CONTRACT_REVIEW_LABEL + '`\n' +
          'carrier is a PR label and the `Clause-②:` line is a PR-body line, and neither names a package. So\n' +
          'the finding above is not "each of these was widened"; it is the whole of what a PR-scoped\n' +
          'declaration entails: THE WIDENED PACKAGE IS ONE OF THEM, AND NONE OF THEM CARRIES THE LEVEL.\n' +
          'Raise the one that actually grew. Raising a package that only received a comment is not asked\n' +
          'for here, and one `minor` on a package this diff moved clears this red for the PR (#16361).\n' +
          '\n' +
          'TWO ways forward, and they are not interchangeable:\n' +
          '  1. The declaration is right and the level is wrong -> raise the widened package to `minor`.\n' +
          '     This is the ordinary case; #16044 is the measured one, one word in one changeset.\n' +
          '  2. The level is right and the DECLARATION is wrong -> correct it at the producer: the\n' +
          `     \`${CONTRACT_REVIEW_LABEL}\` carrier is the review seat's to place and to clear, and the\n` +
          '     `Clause-②:` line is the claim\'s. ⛔ Do not add a tolerance here to route around a\n' +
          '     declaration that says something its author did not mean.\n' +
          '\n' +
          'Only what THIS diff introduces is listed above — an entry the branch point already carried at\n' +
          'the same bump is not this PR\'s to answer for (#7005).',
      );
      return { exitCode: 1, stdout, stderr };

    default:
      stderr.push(
        `⛔ internal: check-changeset-no-major produced an unknown level verdict ${JSON.stringify(result?.verdict ?? null)}. ` +
          'A guard that cannot classify its own input has verified nothing.',
      );
      return { exitCode: 1, stdout, stderr };
  }
}

/**
 * The `pull_request` object out of a GitHub Actions event payload, or `null`
 * when there is none to read.
 *
 * Naming a file with `--event` makes it the WHOLE input — nothing is fetched
 * and nothing else is consulted — which is what makes the two #16044 heads
 * drivable offline and exactly reproducible. The same shape arrives for free in
 * CI at `$GITHUB_EVENT_PATH`, which is why this gate needs no token.
 *
 * @param {string|null|undefined} path
 * @returns {{ labels?: unknown[], body?: string }|null}
 */
export function readEventPullRequest(path) {
  if (!path) return null;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(text);
    const pr = payload?.pull_request ?? null;
    return pr && typeof pr === 'object' ? pr : null;
  } catch {
    return null;
  }
}

// ── Reading the real tree ────────────────────────────────────────────────────

/**
 * Every changeset in `<root>/.changeset`, keyed by file name.
 *
 * Serves `--list` only. The judgement above never reads the stock — that was the
 * whole of #7005 — so a null here can no longer produce a silent pass; it
 * produces a `--list` that says the directory is not there.
 *
 * `null` — never an empty Map — when the directory cannot be read, so the two
 * facts stay distinguishable downstream. `README.md` is documentation, never a
 * changeset.
 *
 * An individual file that cannot be read is deliberately NOT caught: it throws,
 * which is loud. Swallowing it would drop a changeset from the audit and report
 * the remainder as the whole.
 *
 * @param {string} root
 * @returns {Map< string, string > | null}
 */
export function readChangesets(root) {
  const dir = join(root, '.changeset');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const changesets = new Map();
  for (const name of entries) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    changesets.set(name, readFileSync(join(dir, name), 'utf8'));
  }
  return changesets;
}

/**
 * `<root>/.changeset/pre.json`, or `null` when it is absent, unreadable or not
 * JSON. All three collapse to the same thing for `judge`: no exemption.
 *
 * @param {string} root
 * @returns {{ mode?: string, tag?: string } | null}
 */
export function readPre(root) {
  try {
    return JSON.parse(readFileSync(join(root, '.changeset', 'pre.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * `--list`: the whole pending `.changeset` directory, majors called out.
 *
 * This is where the stock view went when the gate stopped judging it. During an
 * RC window it is how a curator sees what has accumulated, which used to be a
 * side effect of every PR run — 171 `::notice` lines on a PR that introduced
 * none of them, well past the 10-annotation cap, on every PR in the repo.
 */
function list() {
  const changesets = readChangesets(REPO_ROOT);
  if (!changesets) {
    console.log('No .changeset directory found.');
    return;
  }
  let declaring = 0;
  for (const name of [...changesets.keys()].sort()) {
    const majors = majorPackagesIn(changesets.get(name));
    if (majors.length === 0) continue;
    declaring++;
    console.log(`major      .changeset/${name}  (${majors.join(', ')})`);
  }
  const pre = readPre(REPO_ROOT);
  console.log(`\n${changesets.size} pending changeset(s), ${declaring} declaring a major.`);
  console.log(`.changeset/pre.json mode: ${pre?.mode ?? '(absent or unreadable)'}`);
  console.log('All of the above are EXEMPT for any PR that does not introduce them — this gate judges diffs, not stock (#7005).');
}

// ── The scan, on the real tree ───────────────────────────────────────────────

function main(argv) {
  const readFlag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const head = readFlag('--head') ?? 'HEAD';
  const requested = readFlag('--base');
  // `--event` names a GitHub Actions `pull_request` payload and makes it the
  // WHOLE declaration input (#16055); with no flag the reading comes from the
  // payload CI already put on disk. Neither path makes a network call.
  const eventPath = readFlag('--event') ?? process.env.GITHUB_EVENT_PATH ?? null;

  let base = null;
  let baseLabel = requested;
  if (requested) {
    base = resolveCommit(requested, REPO_ROOT);
    if (!base) {
      console.error(`⛔ check-changeset-no-major: --base '${requested}' does not resolve to a commit.`);
      console.error('   A gate that cannot read its input has verified nothing, so this is a failure, not a pass (#4690).');
      process.exit(1);
    }
  } else {
    for (const candidate of ['origin/main', 'main']) {
      base = resolveCommit(candidate, REPO_ROOT);
      if (base) {
        baseLabel = candidate;
        break;
      }
    }
    if (!base) {
      console.error('⛔ check-changeset-no-major: no base to diff against (tried origin/main, main).');
      console.error('   Pass one explicitly: --base <ref-or-sha>. Missing input is a failure, never a pass (#4690).');
      process.exit(1);
    }
  }

  let scanned = null;
  try {
    scanned = scan({ cwd: REPO_ROOT, base, head });
  } catch (error) {
    console.error(`⛔ check-changeset-no-major: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = judge({ introduced: scanned?.introduced ?? null, pre: readPre(REPO_ROOT) });
  const { exitCode, stdout, stderr } = render(result);

  // The starting commit is printed on every verdict, and it is not decoration:
  // #6129 hid for as long as it did because nothing in any log said where the
  // diff began, so a gate reading the wrong side of a fork looked exactly like a
  // gate reading the right one. #7005 is the same fact with no side at all.
  if (scanned) {
    const touched = scanned.introduced.length + scanned.exempt.length;
    console.log(`Diffing ${head} from ${scanned.base.slice(0, 9)} (merge base with ${baseLabel}).`);
    if (scanned.exempt.length) {
      console.log(`${scanned.exempt.length} of the ${touched} major-declaring changeset(s) in this diff were already declared at the branch point — exempt.`);
    }
  }

  for (const line of stdout) console.log(line);
  for (const line of stderr) console.error(line);

  // ── The level axis (#16055) ───────────────────────────────────────────────
  //
  // Run unconditionally beside the major verdict rather than instead of it, and
  // the exit code is the MAX of the two: two independent facts about one
  // changeset set, and a gate that reported only the first one it found would
  // hand an author one word to change and then fail them again on the next run.
  // `prEvent` separates "not a pull request" from "a pull request whose payload
  // would not read" (#16776). It is read from the event NAME rather than from
  // the payload's shape, because the payload's shape is the thing in doubt: on a
  // `pull_request` run the runner has written a `pull_request` object, so its
  // absence is a broken job and not a context this axis may stand down in.
  const eventName = process.env.GITHUB_EVENT_NAME ?? null;
  const levelResult = judgeLevel({
    levels: scanned?.levels ?? null,
    touched: scanned ? packagesTouched({ cwd: REPO_ROOT, from: scanned.base, head }) : { packages: [], unreadable: [] },
    declaration: declarationFromPullRequest(readEventPullRequest(eventPath)),
    prEvent: eventName === 'pull_request' || eventName === 'pull_request_target',
  });
  const level = renderLevel(levelResult);
  for (const line of level.stdout) console.log(line);
  for (const line of level.stderr) console.error(line);

  process.exit(Math.max(exitCode, level.exitCode));
}

// ── Self-test ────────────────────────────────────────────────────────────────

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-changeset-no-major self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'The three quoting dialects the header names': 8,
  'THE FIX (#6923): a leading blank line': 3,
  'What must NOT be caught, each paired with its control': 9,
  'THE FIX (#7004): the shapes the old `([A-Za-z]+)\\s*$` anchor hid': 13,
  'The exemption switch, in BOTH directions': 17,
  'Order of operations is contract': 3,
  'Missing input is a failure, never a pass (#4690 / #7006)': 5,
  'The readers': 12,
  'The diff scoping, on real temp git repositories': 18,
  '#7107: an `R` row whose BASE side is README.md subtracts NOTHING': 4,
  '#6129 proper: main drift must not move the verdict': 5,
  'Missing input is a failure, never a pass (#4690)': 4,
  'The wiring: these fixtures must actually run on every PR': 22,
  "The LEVEL axis: #16044's two heads, one word apart (#16055)": 56,
  'The GRAIN: a PR-scoped declaration judged at PR scope (#16361)': 25,
  'THE DEPTH: a nested package is a candidate the axis can refuse (#16713)': 21,
  'THE ROOT: a packed `bin` target is a published surface the axis can refuse (#16692)': 37,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 17;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
  };
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
    registerCase();
    checked += 1;
    if (!condition) failures.push(description);
  };

  const MAJOR = '---\n"@objectstack/spec": major\n---\n\nbody\n';
  const MINOR = '---\n"@objectstack/spec": minor\n---\n\nbody\n';

  /**
   * A dialect that must be CAUGHT, asserted against a control that differs by
   * exactly the dialect under test.
   *
   * The paired control is the point. A synthetic fixture has no anchor to go
   * stale, but it has the same failure mode by another route: a typo in the
   * fixture text yields a file that declares nothing, and "declares nothing"
   * satisfies every negative assertion for the wrong reason. So each negative
   * below states which positive it differs from, and each positive is asserted
   * to name the package — never merely to be non-empty.
   */
  const caught = (label, text, expected) => {
    const majors = majorPackagesIn(text);
    assert(
      majors.length === expected.length && expected.every((p) => majors.includes(p)),
      `parser: ${label} ⇒ ${JSON.stringify(expected)} — got ${JSON.stringify(majors)}`,
    );
  };

  // ── The three quoting dialects the header names ───────────────────────────
  battery('The three quoting dialects the header names');
  caught('a double-quoted name', MAJOR, ['@objectstack/spec']);
  caught('a single-quoted name', "---\n'@objectstack/spec': major\n---\n\nbody\n", ['@objectstack/spec']);
  caught('an unquoted name', '---\ndocs: major\n---\n\nbody\n', ['docs']);
  caught('CRLF line endings', '---\r\n"@objectstack/spec": major\r\n---\r\n\r\nbody\r\n', ['@objectstack/spec']);
  caught('mixed quoting in one block', '---\n"@objectstack/a": major\n\'@objectstack/b\': major\n---\n\nbody\n', [
    '@objectstack/a',
    '@objectstack/b',
  ]);
  caught('a major among non-majors', '---\n"@objectstack/a": patch\n"@objectstack/b": major\n"@objectstack/c": minor\n---\n\nbody\n', [
    '@objectstack/b',
  ]);

  // Case-insensitive, because the comparison is `.toLowerCase() === 'major'`.
  // Measured: @changesets/parse THROWS on these rather than accepting them, so
  // catching them is this file being stricter on a file that cannot version
  // anything — a message about an already-broken file, never a missed major.
  caught('an uppercase MAJOR', '---\n"@objectstack/spec": MAJOR\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a capitalised Major', '---\n"@objectstack/spec": Major\n---\n\nbody\n', ['@objectstack/spec']);

  // ── THE FIX (#6923): a leading blank line ─────────────────────────────────
  // Predicted direction on reverse verification: restoring the old
  // `lines[0]?.trim() !== '---'` turns exactly these two red. Measured with
  // @changesets/parse@0.4.3: both of these DO release a major, so a miss here is
  // a whole-stack major promoted past a guard that printed a tick.
  battery('THE FIX (#6923): a leading blank line');
  caught('a leading blank line before the fence', '\n' + MAJOR, ['@objectstack/spec']);
  caught('two leading blank lines', '\n\n' + MAJOR, ['@objectstack/spec']);
  caught('a leading blank line, single-quoted', "\n---\n'@objectstack/spec': major\n---\n\nbody\n", ['@objectstack/spec']);

  // ── What must NOT be caught, each paired with its control ─────────────────
  battery('What must NOT be caught, each paired with its control');
  assert(majorPackagesIn(MINOR).length === 0, 'parser: a `minor` bump is not a major');
  assert(majorPackagesIn('---\n"@objectstack/spec": patch\n---\n\nbody\n').length === 0, 'parser: a `patch` bump is not a major');
  // Control for both: the SAME text with `major` in the bump slot is caught, so
  // the two assertions above cannot be passing because the fixture parses as
  // nothing at all.
  assert(majorPackagesIn(MAJOR).length === 1, "parser: control — the same shape with `major` IS caught (so the two negatives above are about the bump word, not a broken fixture)");

  // The word `major` after the closing fence is prose, not a declaration. Same
  // control discipline: the identical entry ABOVE the fence is caught.
  const bodyOnly = '---\n"@objectstack/spec": minor\n---\n\nThis is a major rewrite.\n"@objectstack/other": major\n';
  assert(majorPackagesIn(bodyOnly).length === 0, 'parser: an entry-shaped line in the BODY is not a declaration');
  assert(
    majorPackagesIn('---\n"@objectstack/spec": minor\n"@objectstack/other": major\n---\n\nThis is a major rewrite.\n').length === 1,
    'parser: control — the same line INSIDE the fence is caught (so the body assertion is about position, not about the line)',
  );

  assert(majorPackagesIn('no fence at all\n"@objectstack/spec": major\n').length === 0, 'parser: a file with no opening fence declares nothing');
  assert(majorPackagesIn('').length === 0, 'parser: an empty file declares nothing');
  assert(majorPackagesIn('---\n---\n\nbody\n').length === 0, 'parser: an empty frontmatter block declares nothing');
  assert(
    majorPackagesIn('---\n- @objectstack/spec major\nsome prose\n---\n\nbody\n').length === 0,
    'parser: lines that are not `<name>: <bump>` are not declarations',
  );

  // ── THE FIX (#7004): the shapes the old `([A-Za-z]+)\s*$` anchor hid ──────
  //
  // This block is #6923's KNOWN-GAP pin, FLIPPED rather than deleted, as the
  // note it carried asked. It used to assert `.length === 0` — the gap — with
  // the instruction to invert it on the day the family-wide regex was fixed.
  // That day is #7004, so the same inputs are asserted to be CAUGHT now.
  //
  // Predicted direction on reverse verification: restoring the old anchor
  // (`([A-Za-z]+)\s*$`) turns exactly these red. Measured with
  // @changesets/parse@0.4.3: every one of them DOES release a major, so a miss
  // here is a whole-stack major promoted past a guard that printed a tick.
  battery('THE FIX (#7004): the shapes the old `([A-Za-z]+)\\s*$` anchor hid');
  caught('a trailing YAML comment', '---\n"@objectstack/spec": major # keep\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a trailing comment after a tab', '---\n"@objectstack/spec": major\t# keep\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a trailing comment containing a colon', '---\n"@objectstack/spec": major # note: keep\n---\n\nbody\n', ['@objectstack/spec']);
  caught('an empty trailing comment', '---\n"@objectstack/spec": major #\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a double-quoted bump value', '---\n"@objectstack/spec": "major"\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a single-quoted bump value', '---\n"@objectstack/spec": \'major\'\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a quoted bump value AND a comment', '---\n"@objectstack/spec": "major" # keep\n---\n\nbody\n', ['@objectstack/spec']);
  caught('a package name containing #, plus a comment', '---\n"@objectstack/a#b": major # keep\n---\n\nbody\n', ['@objectstack/a#b']);
  caught('a commented major beside an uncommented minor', '---\n"@objectstack/a": major # keep\n"@objectstack/b": minor\n---\n\nbody\n', [
    '@objectstack/a',
  ]);

  // The other direction #7004 measured: a whole-line comment that happens to
  // contain a colon is entry-shaped, and used to parse as a package literally
  // named `# note`. @changesets/parse declares nothing for it, so neither does
  // this. The control below is what keeps this from passing vacuously.
  assert(
    majorPackagesIn('---\n# note: major\n---\n\nbody\n').length === 0,
    'parser: a whole-line YAML comment is not a declaration, even when it contains a colon (#7004)',
  );
  assert(
    majorPackagesIn('---\n   # note: major\n---\n\nbody\n').length === 0,
    'parser: an INDENTED whole-line comment is not a declaration either (#7004)',
  );
  caught('control — a real entry beside a colon-bearing comment line', '---\n# note: major\n"@objectstack/real": major\n---\n\nbody\n', [
    '@objectstack/real',
  ]);

  // YAML requires whitespace before an inline `#`, so this one is the scalar
  // `major# keep` and @changesets/parse THROWS `invalid version type`. Missing
  // it is the harmless direction (a file that can version nothing), and the
  // regex spells the comment `(?:\s+#.*)?` precisely to keep it that way.
  assert(
    majorPackagesIn('---\n"@objectstack/spec": major# keep\n---\n\nbody\n').length === 0,
    'parser: `major# keep` (no space before #) is not a comment in YAML — changesets throws on it, so missing it is the harmless direction (#7004)',
  );

  // ── The exemption switch, in BOTH directions ──────────────────────────────
  // This is the half that no CI run has ever executed. Everything below drives
  // it directly. `introduced` is now scan()'s output shape, never the stock.
  battery('The exemption switch, in BOTH directions');
  const pending = [{ file: '.changeset/a.md', majors: ['@objectstack/spec'] }];

  const exempt = judge({ introduced: pending, pre: { mode: 'pre', tag: 'rc' } });
  assert(exempt.verdict === 'exempt', `pre-mode with an introduced major ⇒ exempt — got ${exempt.verdict}`);
  assert(exempt.offenders.length === 1 && exempt.offenders[0].file === '.changeset/a.md', 'the exempt verdict still names the offender, so the RC curator can see it');
  assert(render(exempt).exitCode === 0, 'pre-mode exits 0');
  assert(
    render(exempt).stdout.some((l) => l.includes('pre-release mode (tag: rc)')) &&
      render(exempt).stdout.some((l) => l === '::notice file=.changeset/a.md::major introduced by this diff in .changeset/a.md: @objectstack/spec'),
    'pre-mode prints the RC notice AND one ::notice per offender',
  );
  assert(render(exempt).stderr.length === 0, 'pre-mode writes nothing to stderr — it is not a complaint');
  assert(judge({ introduced: pending, pre: { mode: 'pre' } }).tag === 'unknown', 'a pre.json with no tag reports the tag as `unknown` rather than `undefined`');

  // THE ENFORCING HALF. `changeset pre exit` rewrites mode to `"exit"`
  // (@changesets/pre@2.0.2), so this exact input is the shape of the first run
  // after the window closes.
  const enforced = judge({ introduced: pending, pre: { mode: 'exit' } });
  assert(enforced.verdict === 'enforce', `mode "exit" with an introduced major ⇒ enforce — got ${enforced.verdict}`);
  assert(render(enforced).exitCode === 1, 'the enforcing half exits 1 — the whole point of the guard, and unreached on CI while the repo is in pre-mode');
  assert(
    render(enforced).stderr.some((l) => l.includes('⛔ This PR introduces changeset(s) that declare a `major` bump.')) &&
      render(enforced).stderr.includes('   .changeset/a.md') &&
      render(enforced).stderr.includes('     - @objectstack/spec: major'),
    'the offenders report names every offending file and every package in it',
  );
  assert(
    render(enforced).stderr.some((l) => l.includes('allow-major')),
    'the offenders report names the `allow-major` escape hatch — a red with no route out is a wall, not a gate',
  );
  assert(
    render(enforced).stderr.some((l) => l.includes('judges diffs,')) && render(enforced).stderr.some((l) => l.includes('#7005')),
    'the offenders report says the pending stock is exempt — an author told to "remove the major bumps" would otherwise reach for 171 files that are not theirs',
  );

  // Every other reading of pre.json is also "no exemption". An exemption is a
  // licence to major the whole repo; it is granted only by an explicit
  // `"mode": "pre"`, never by an absence.
  for (const [label, pre] of [
    ['no pre.json at all', null],
    ['pre.json that did not parse', null],
    ['pre.json with no mode key', {}],
    ['mode: exit', { mode: 'exit' }],
    ['mode: some future spelling', { mode: 'paused' }],
    ['mode: PRE (wrong case)', { mode: 'PRE' }],
  ]) {
    assert(judge({ introduced: pending, pre }).verdict === 'enforce', `${label} ⇒ enforce, never an exemption`);
  }

  // ── Order of operations is contract ───────────────────────────────────────
  battery('Order of operations is contract');
  const cleanInPre = judge({ introduced: [], pre: { mode: 'pre', tag: 'rc' } });
  assert(cleanInPre.verdict === 'clean', 'a diff introducing no major, in pre-mode ⇒ the ordinary tick, not the RC notice');
  assert(
    render(cleanInPre).stdout.length === 1 && render(cleanInPre).stdout[0] === '✓ This diff introduces no `major` bump.',
    'a clean diff prints exactly one line and never mentions the RC window',
  );
  assert(judge({ introduced: [], pre: { mode: 'exit' } }).verdict === 'clean', 'a diff introducing no major, outside pre-mode ⇒ clean');

  // ── #7005 against a stock of majors: MOVED to the temp-repo STOCK block ───
  //
  // This spot used to state #7005's acceptance criterion against the REAL
  // `.changeset` directory, anchored by a control requiring the real stock to
  // actually contain major-declaring changesets. That anchor was an assertion
  // of repo PHASE, not of checker health: a release's post-exit
  // `changeset version` consumes exactly that population, so the self-test
  // went red on every PR in the post-cut window while saying nothing about
  // this checker (#8654). `judge()` takes only `{ introduced, pre }` — it
  // never reads the stock — so the one guarantee that genuinely needed a
  // major-declaring stock was the report-scope negative ("the report names
  // ONLY what this diff introduced, never a pending stock file"). That
  // negative now lives in the temp-repo STOCK block below, where the stock is
  // synthetic, really on disk at the branch point, read by the real scan, and
  // therefore present on EVERY run, whatever the release train last did. The
  // repo-phase halves (majors pending NOW, pre.json present NOW) are removed
  // deliberately — asserting the repo is mid-cycle was never this control's
  // contract.

  // ── Missing input is a failure, never a pass (#4690 / #7006) ──────────────
  battery('Missing input is a failure, never a pass (#4690 / #7006)');
  const unreadable = judge({ introduced: null, pre: { mode: 'exit' } });
  assert(unreadable.verdict === 'unreadable-diff', 'a diff that could not be computed is its OWN verdict, not `clean`');
  assert(
    render(unreadable).exitCode === 1,
    'FLIPPED by #7005 (was pinned at exit 0 as the #7006 residual): a gate that could not read its input now FAILS. The `no-changeset-dir` verdict it replaced is gone with the directory read',
  );
  assert(render(unreadable).stdout.length === 0, 'the unreadable verdict prints no tick on stdout — that was the whole of the #4690 shape');
  assert(render({ verdict: 'something-new' }).exitCode === 1, 'an unknown verdict exits 1 — a guard that cannot classify itself prints no tick');
  assert(render(undefined).exitCode === 1, 'no verdict at all exits 1');

  // ── The readers ──────────────────────────────────────────────────────────
  // `readChangesets` no longer feeds the verdict; it feeds `--list`. These pins
  // stay because `--list` is now the only stock view a curator has.
  battery('The readers');
  {
    const real = readChangesets(REPO_ROOT);
    // Reachability only, never SIZE (#8654): `.changeset/` itself is tracked
    // (README.md + config.json), so it exists in every repo phase — but its
    // `.md` population is exactly what a release's `version packages`
    // consumes, and "non-empty" here was an assertion of repo phase that went
    // red on every PR in the post-cut window. What the reader must do with a
    // POPULATED directory is asserted on the synthetic one below, which this
    // test populates itself and is therefore populated on every run.
    assert(real instanceof Map, 'reader: the real .changeset directory is reachable from this script (it is what `--list` audits)');
    assert(real !== null && !real.has('README.md'), 'reader: .changeset/README.md is documentation, never a changeset');
    assert(existsSync(join(REPO_ROOT, '.changeset', 'README.md')), 'reader: control — that README really exists, so the exclusion above is exercised rather than vacuous');
    assert(real !== null && [...real.keys()].every((k) => k.endsWith('.md')), 'reader: only .md files are read (pre.json and config.json are not changesets)');
    // No third state for the real pre.json (#8654). PRESENT-and-parsing (a
    // pre-release window) and ABSENT (post-GA — `changeset pre exit` +
    // `version packages` legitimately removes it; absent ⇒ null ⇒ no
    // exemption, pinned in the temp-dir block below) are both legal terminal
    // states of the repo. The one shape that must fail here is
    // PRESENT-but-unparsable: `readPre` collapses it to null, silently
    // dropping an exemption nobody decided to drop — the #4690 direction
    // pointed at the release train. Requiring presence itself was an
    // assertion of repo phase, red on every post-cut PR, and is removed.
    const realPre = readPre(REPO_ROOT);
    if (existsSync(join(REPO_ROOT, '.changeset', 'pre.json'))) {
      assert(
        realPre !== null && typeof realPre === 'object',
        'reader: the real .changeset/pre.json is PRESENT but does not parse — readPre collapses that to "no exemption" silently, a state someone must notice (#8654)',
      );
    } else {
      assert(
        realPre === null,
        'reader: an absent real pre.json reads as null (⇒ no exemption) — absence is a legal post-GA state, never a failure (#8654)',
      );
    }
  }

  const empty = mkdtempSync(join(tmpdir(), 'changeset-no-major-'));
  try {
    assert(readChangesets(empty) === null, 'reader: a root with no .changeset directory reads as null, never as an empty Map');
    assert(readPre(empty) === null, 'reader: an absent pre.json reads as null (⇒ no exemption)');
    mkdirSync(join(empty, '.changeset'), { recursive: true });
    assert(readChangesets(empty) instanceof Map && readChangesets(empty).size === 0, 'reader: an existing but empty .changeset directory reads as an empty Map');
    writeFileSync(join(empty, '.changeset', 'pre.json'), '{ not json');
    assert(readPre(empty) === null, 'reader: a malformed pre.json reads as null (⇒ no exemption), never as a partial object');
    writeFileSync(join(empty, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}');
    assert(readPre(empty)?.mode === 'pre', 'reader: control — a well-formed pre.json DOES parse, so the two nulls above are about the input, not a broken reader');
    // The populated-directory control (#8654): what "reader: the real
    // .changeset directory is non-empty" used to prove, on a directory this
    // test populates itself so the proof survives every repo phase.
    writeFileSync(join(empty, '.changeset', 'stocked.md'), MAJOR);
    writeFileSync(join(empty, '.changeset', 'README.md'), MAJOR);
    const stocked = readChangesets(empty);
    assert(
      stocked instanceof Map && stocked.size === 1 && stocked.get('stocked.md') === MAJOR,
      `reader: a changeset on disk is read back verbatim, keyed by file name, with pre.json and README.md beside it not counted — got ${stocked === null ? 'null' : [...(stocked ?? new Map()).keys()].join(', ')} (#8654: replaces the phase-dependent "real directory is non-empty" assertion)`,
    );
    assert(!stocked?.has('README.md'), 'reader: README.md is excluded even when it is shaped exactly like a major-declaring changeset');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  // ── The diff scoping, on real temp git repositories ───────────────────────
  //
  // The sibling's convention (`check-empty-changeset.mjs`), for the sibling's
  // reason: this gate's whole subject is now a diff between two commits, so a
  // fixture that is not two real commits would be testing an imitation of the
  // code path that ships.

  battery('The diff scoping, on real temp git repositories');
  const repos = [];
  const initRepo = (prefix) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    repos.push(dir);
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'selftest@example.invalid'], dir);
    git(['config', 'user.name', 'self test'], dir);
    git(['config', 'commit.gpgsign', 'false'], dir);
    return dir;
  };
  const writeInto = (dir, files) => {
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel);
      if (contents === null) rmSync(full);
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
      }
    }
    git(['add', '-A'], dir);
  };
  /** @param {Record<string,string>} baseFiles @param {Record<string,string|null>} headFiles */
  const makeRepo = (baseFiles, headFiles) => {
    const dir = initRepo('changeset-no-major-scan-');
    writeInto(dir, baseFiles);
    git(['commit', '-q', '-m', 'base', '--allow-empty', '--no-gpg-sign'], dir);
    const base = git(['rev-parse', 'HEAD'], dir).trim();
    writeInto(dir, headFiles);
    git(['commit', '-q', '-m', 'head', '--allow-empty', '--no-gpg-sign'], dir);
    return { dir, base };
  };
  /**
   * The `R` row for `old -> new` in this repo's diff, or null. Both paths are
   * regex source, so a caller escapes its dots. Matching the WHOLE row (rather
   * than `/^R\d/` on the output) is what makes an `R` control specific: it pins
   * which two paths git paired, not merely that something was scored a rename.
   */
  const renameRow = (dir, base, oldPath, newPath) =>
    git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir)
      .split('\n')
      .find((l) => new RegExp(`^R\\d+\t${oldPath}\t${newPath}$`).test(l)) ?? null;

  try {
    // A stock of pending majors on the base commit, the shape of the real tree
    // at `changeset pre exit`. Three rather than 171: the count is irrelevant to
    // the property, and a hardcoded 171 would rot on the next merge. The REAL
    // count is asserted against the real directory in the #7005 block above.
    const STOCK = {
      '.changeset/stock-1.md': MAJOR,
      '.changeset/stock-2.md': '---\n"@objectstack/cli": major\n---\n\nstock body\n',
      '.changeset/stock-3.md': MINOR,
      '.changeset/README.md': MAJOR, // documentation, never a changeset
    };

    // THE CARD, end to end. A PR that adds an ordinary `minor` changeset on top
    // of a stock full of majors introduces nothing.
    {
      const { dir, base } = makeRepo(STOCK, { '.changeset/mine.md': MINOR });
      const { introduced, exempt } = scan({ cwd: dir, base });
      assert(introduced.length === 0, `#7005: a PR adding a non-major changeset over a stock of majors introduces nothing — got ${JSON.stringify(introduced)}`);
      assert(exempt.length === 0, 'the stock is not even touched by the diff, so it is not "exempt" either — it is simply not read');
      assert(judge({ introduced, pre: { mode: 'exit' } }).verdict === 'clean', '#7005: ... and with pre-mode exited that PR is CLEAN');
    }

    // The control that keeps the row above from being green because the scan
    // returns nothing at all: the SAME stock, a PR that does add a major.
    {
      const { dir, base } = makeRepo(STOCK, { '.changeset/mine.md': MAJOR });
      const { introduced } = scan({ cwd: dir, base });
      assert(
        introduced.length === 1 && introduced[0].file === '.changeset/mine.md' && introduced[0].majors.join() === '@objectstack/spec',
        `#7005: a PR that DOES add a major is caught, and names only its own file — got ${JSON.stringify(introduced)}`,
      );
      assert(judge({ introduced, pre: { mode: 'exit' } }).verdict === 'enforce', '#7005: ... and with pre-mode exited that PR is RED');
      assert(judge({ introduced, pre: { mode: 'pre', tag: 'rc' } }).verdict === 'exempt', '#7005: ... and inside the RC window it is still exempt');

      // The report-scope negative, rebuilt HERE from the real-stock block this
      // file used to carry (#8654): the enforce report names ONLY the changeset
      // this diff introduced, never one of the pending stock files. The control
      // right below keeps it non-vacuous — the synthetic stock really declares
      // majors, really sits on disk at the branch point, and the real scan just
      // read past it — without asserting anything about the phase of the real
      // repository.
      assert(
        [STOCK['.changeset/stock-1.md'], STOCK['.changeset/stock-2.md']].every((t) => majorPackagesIn(t).length > 0),
        'control (#7005/#8654): the synthetic stock must actually contain major-declaring changesets, or the report-scope negative below is green for the wrong reason',
      );
      const rendered = render(judge({ introduced, pre: { mode: 'exit' } }));
      assert(
        rendered.stderr.includes('   .changeset/mine.md') &&
          !rendered.stderr.some((l) => l.includes('stock-1.md') || l.includes('stock-2.md') || l.includes('stock-3.md')),
        '#7005: the report names ONLY the changeset this diff introduced, never one of the pending stock files',
      );
    }

    // Row 2: majored in place. `--diff-filter=A` alone would see nothing here.
    {
      const { dir, base } = makeRepo({ '.changeset/x.md': MINOR }, { '.changeset/x.md': MAJOR });
      const { introduced } = scan({ cwd: dir, base });
      assert(
        introduced.length === 1 && introduced[0].file === '.changeset/x.md',
        `a stock changeset edited from minor to major is an offence (the bypass \`--diff-filter=A\` cannot see) — got ${JSON.stringify(introduced)}`,
      );
    }

    // Row 3: the same file, prose edited, bump untouched. This is the row that
    // keeps the stock exempt for a PR that legitimately touches one of its files.
    {
      const { dir, base } = makeRepo({ '.changeset/x.md': MAJOR }, { '.changeset/x.md': MAJOR.replace('body', 'a better body') });
      const { introduced, exempt } = scan({ cwd: dir, base });
      assert(introduced.length === 0, `editing the prose of a changeset that ALREADY declared its major introduces nothing — got ${JSON.stringify(introduced)}`);
      assert(exempt.join() === '.changeset/x.md', `... and it is reported as exempt rather than silently dropped — got ${JSON.stringify(exempt)}`);
    }

    // Per PACKAGE, not per file: the second entry is introduced even though the
    // file already declared a major.
    {
      const two = '---\n"@objectstack/spec": major\n"@objectstack/cli": major\n---\n\nbody\n';
      const { dir, base } = makeRepo({ '.changeset/x.md': MAJOR }, { '.changeset/x.md': two });
      const { introduced } = scan({ cwd: dir, base });
      assert(
        introduced.length === 1 && introduced[0].majors.join() === '@objectstack/cli',
        `adding a SECOND major to a changeset that already declared one names only the new package — got ${JSON.stringify(introduced)}`,
      );
    }

    // The rename rows. Measured on git 2.43.0: this reports as `R<score>` and is
    // dropped entirely by `--diff-filter=AM` (which is what this gate and both
    // its siblings passed until #7045).
    {
      const long = '\n\nbody long enough for git to score this as a rename rather than an add plus a delete\n';
      const oldMinor = '---\n"@objectstack/spec": minor\n---' + long;
      const newMajor = '---\n"@objectstack/spec": major\n---' + long;
      const { dir, base } = makeRepo({ '.changeset/old.md': oldMinor }, { '.changeset/old.md': null, '.changeset/new.md': newMajor });
      assert(
        renameRow(dir, base, '\\.changeset/old\\.md', '\\.changeset/new\\.md') !== null,
        `control: git must really pair .changeset/old.md with .changeset/new.md as a rename, or the row below is about an ordinary add — got ${JSON.stringify(git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir))}`,
      );
      const { introduced } = scan({ cwd: dir, base });
      assert(
        introduced.length === 1 && introduced[0].file === '.changeset/new.md',
        `a changeset renamed AND flipped to major is an offence (\`--diff-filter=AM\` drops it entirely) — got ${JSON.stringify(introduced)}`,
      );
    }
    {
      // The paired control: a PURE rename of a stock major is NOT an offence,
      // because the same declaration was already at the branch point.
      const long = '\n\nbody long enough for git to score this as a rename rather than an add plus a delete\n';
      const text = '---\n"@objectstack/spec": major\n---' + long;
      const { dir, base } = makeRepo({ '.changeset/old.md': text }, { '.changeset/old.md': null, '.changeset/new.md': text });
      const { introduced, exempt } = scan({ cwd: dir, base });
      assert(introduced.length === 0, `control: a pure rename of a stock major introduces nothing — got ${JSON.stringify(introduced)}`);
      assert(exempt.join() === '.changeset/new.md', `... and is reported as exempt at its new path — got ${JSON.stringify(exempt)}`);
    }

    // `.changeset/README.md` is documentation, even when it is shaped exactly
    // like a changeset declaring a major — asserted with its own control, so the
    // green cannot be "the diff found nothing at all".
    {
      const { dir, base } = makeRepo({}, { '.changeset/README.md': MAJOR, '.changeset/mine.md': MINOR });
      const { introduced } = scan({ cwd: dir, base });
      assert(introduced.length === 0, `a major-shaped .changeset/README.md is documentation, not a changeset — got ${JSON.stringify(introduced)}`);
      const control = makeRepo({}, { '.changeset/README.md': MAJOR, '.changeset/mine.md': MAJOR });
      assert(
        scan({ cwd: control.dir, base: control.base }).introduced.map((o) => o.file).join() === '.changeset/mine.md',
        'control: the identical diff with the major in a NON-README file is caught, so the row above is about the filename and not about an empty diff',
      );
    }

    // ── #7107: an `R` row whose BASE side is README.md subtracts NOTHING ──────
    //
    // The row above pins README at the HEAD side. This one is the same fact at
    // the BASE side, which is a different code path: `basePath` is read to work
    // out what the file "already declared" at the branch point, and git pairs
    // renames by CONTENT rather than by name — so under the `.changeset/*.md`
    // pathspec an `R` row can legitimately arrive as
    // `.changeset/README.md -> .changeset/x.md` (measured, git 2.43.0; the two
    // siblings pin the same shape as RED 5 / R16 since #7106).
    //
    // Both sides are byte-identical here, which is exactly what makes the case
    // sharp: the head file is a brand-new changeset declaring a major, and the
    // only thing that could excuse it is a major read off README. Delete the
    // `isChangesetFile(basePath)` guard in the scan and `already` becomes
    // `['@objectstack/spec']`, `added` empties, and this row flips from
    // `introduced` to `exempt` — a whole-stack major reported as inherited.
    //
    // DORMANT, said plainly: the real `.changeset/README.md` is boilerplate with
    // no frontmatter fence, so `majorPackagesIn` returns `[]` on it and nothing
    // is subtracted today. The fixture therefore has to COMMIT a major-shaped
    // README to reach the path at all — without that, the case would pass with
    // or without the guard and would certify the hole instead of closing it.
    battery('#7107: an `R` row whose BASE side is README.md subtracts NOTHING');
    {
      const long = '\n\nbody long enough for git to score this as a rename rather than an add plus a delete\n';
      const majorReadme = '---\n"@objectstack/spec": major\n---' + long;
      const { dir, base } = makeRepo(
        { '.changeset/README.md': majorReadme },
        { '.changeset/README.md': null, '.changeset/was-the-readme.md': majorReadme },
      );
      assert(
        renameRow(dir, base, '\\.changeset/README\\.md', '\\.changeset/was-the-readme\\.md') !== null,
        `#7107 control: git must really pair the new changeset with README.md, or this case is an ordinary \`A\` and says nothing about the base side — got ${JSON.stringify(git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir))}`,
      );
      const { introduced, exempt } = scan({ cwd: dir, base });
      assert(
        introduced.length === 1 &&
          introduced[0].file === '.changeset/was-the-readme.md' &&
          introduced[0].majors.join() === '@objectstack/spec',
        `#7107: a changeset paired with a major-shaped README.md by rename detection inherits NOTHING — got ${JSON.stringify(introduced)}`,
      );
      assert(exempt.length === 0, `#7107: ... and it is certainly not exempt — got ${JSON.stringify(exempt)}`);
      assert(judge({ introduced, pre: { mode: 'exit' } }).verdict === 'enforce', '#7107: ... so with pre-mode exited that PR is RED');
    }

    // ── #6129 proper: main drift must not move the verdict ───────────────────
    //
    // The CI shape built for real — a base branch that keeps moving after the PR
    // forks off it, and the `refs/pull/N/merge` commit GitHub builds from the
    // two. Faking it with two linear commits would test an imitation: the whole
    // defect lives in the difference between a merge commit's two parents, so
    // the fixture has to have two parents.
    //
    // Predicted direction, written before the run: judged from the merge base,
    // the major main gained after the fork is invisible to this PR (0
    // offenders); judged from the moved main tip it would be 0 too — but judged
    // as this gate USED to judge, reading the stock at HEAD, it is 1. All three
    // are asserted, so the fixture cannot be green because nothing is produced.
    battery('#6129 proper: main drift must not move the verdict');
    {
      const dir = initRepo('changeset-no-major-mergeref-');
      writeInto(dir, { '.changeset/stock.md': MINOR });
      git(['commit', '-q', '-m', 'base', '--allow-empty', '--no-gpg-sign'], dir);
      const forkPoint = git(['rev-parse', 'HEAD'], dir).trim();

      git(['checkout', '-q', '-b', 'pr'], dir);
      writeInto(dir, { '.changeset/mine.md': MINOR });
      git(['commit', '-q', '-m', 'pr side', '--no-gpg-sign'], dir);
      const prTip = git(['rev-parse', 'HEAD'], dir).trim();

      git(['checkout', '-q', 'main'], dir);
      // main gains a whole-stack major while the PR sits open — the release's
      // own doing, at `changeset pre exit`, not this author's.
      writeInto(dir, { '.changeset/drift-major.md': MAJOR });
      git(['commit', '-q', '-m', 'main drift: the release major', '--no-gpg-sign'], dir);
      const mainTip = git(['rev-parse', 'HEAD'], dir).trim();

      // The merge ref actions/checkout puts at HEAD on a `pull_request` event.
      git(['checkout', '-q', '-b', 'mergeref', prTip], dir);
      git(['merge', '-q', '--no-ff', '-m', 'merge ref', mainTip], dir);

      assert(mergeBase('main', 'HEAD', dir) !== forkPoint, 'control: on a merge ref the merge base is the MERGED main tip, not the fork point — the fixture is the CI shape, not a linear one');

      const fromMain = scan({ cwd: dir, base: 'main' });
      assert(
        fromMain.introduced.length === 0,
        `#6129/#7005: a major MAIN gained while this PR was open is not this PR's — got ${JSON.stringify(fromMain.introduced)}`,
      );
      // Judged from the fork point instead, main's drift reads as introduced by
      // this PR. That is the defect, pinned so the correction above cannot be
      // mistaken for a scan that simply finds nothing.
      const fromForkPoint = scan({ cwd: dir, base: forkPoint });
      assert(
        fromForkPoint.introduced.length === 1 && fromForkPoint.introduced[0].file === '.changeset/drift-major.md',
        `#6129 control: from a FROZEN fork point the same repo blames this PR for main's major — the defect, pinned — got ${JSON.stringify(fromForkPoint.introduced)}`,
      );
      // And the stock-scoped reading this card replaces: at HEAD the directory
      // contains main's major, so the old gate failed this PR over it.
      const stockAtHead = readChangesets(dir);
      assert(
        [...stockAtHead.entries()].filter(([, t]) => majorPackagesIn(t).length > 0).length === 1,
        '#7005 control: the STOCK at HEAD does contain the drift major — which is exactly what the old stock-scoped gate read, and why it reddened this PR',
      );

      // The other half of #6129: a base branch that DELETES. The post-exit
      // `changeset version` removes every consumed changeset from main at once,
      // and a two-dot diff from the moved tip reads those deletions as this
      // branch's additions.
      git(['checkout', '-q', 'main'], dir);
      writeInto(dir, { '.changeset/drift-major.md': null });
      git(['commit', '-q', '-m', 'main: the Version PR deletes the consumed changesets', '--no-gpg-sign'], dir);
      git(['checkout', '-q', 'mergeref'], dir);
      const afterDeletion = scan({ cwd: dir, base: 'main' });
      assert(
        afterDeletion.introduced.length === 0,
        `#6129 DELETED-ON-MAIN: majors deleted on main must not read as introduced by a branch that still carries them — got ${JSON.stringify(afterDeletion.introduced)}`,
      );
    }

    // ── Missing input is a failure, never a pass (#4690) ─────────────────────
    battery('Missing input is a failure, never a pass (#4690)');
    {
      const { dir } = makeRepo({}, { 'a.txt': 'x\n' });
      assert(resolveCommit('definitely-not-a-ref', dir) === null, 'an unresolvable base resolves to null (⇒ exit 1)');
      assert(resolveCommit('HEAD', dir) !== null, 'control — a resolvable ref DOES resolve, so the null above is about the ref, not a broken resolver');

      const other = initRepo('changeset-no-major-unrelated-');
      writeInto(other, { 'b.txt': 'y\n' });
      git(['commit', '-q', '-m', 'unrelated', '--no-gpg-sign'], other);
      const unrelatedSha = git(['rev-parse', 'HEAD'], other).trim();
      git(['fetch', '-q', other, 'main'], dir);
      assert(mergeBase(unrelatedSha, 'HEAD', dir) === null, 'unrelated histories have no merge base');
      let threw = false;
      try {
        scan({ cwd: dir, base: unrelatedSha });
      } catch {
        threw = true;
      }
      assert(threw, '#4690: no merge base is a failure rather than a silent pass — scan throws rather than falling back to the raw base');
    }
    // ── The LEVEL axis: #16044's two heads, one word apart (#16055) ──────────
    //
    // The acceptance condition the filing card sets, discharged with the real
    // bytes rather than with a synthetic pair: the SAME changeset body, the two
    // bump words #16044 actually shipped, and the level verdict required to
    // differ. `LEVEL_BODY` is written once and the word substituted into it, so
    // the two fixtures are byte-identical BY CONSTRUCTION — a typo cannot make
    // the negative pass for the wrong reason, which is the failure mode a
    // hand-copied pair has.
    //
    // Measured out of the tree, not recalled: `git show <head>:.changeset/
    // lint-eval-generator-load-envelope.md` at `e0938d3fdce` and `98179cae022`
    // differ in exactly the bump word, and `git diff` between the two commits
    // returns that one path.
    //
    // Every negative below states which positive it differs from, the same
    // control discipline the parser batteries above use.
    battery('The LEVEL axis: #16044\'s two heads, one word apart (#16055)');
    {
      const LEVEL_BODY = '\n---\n\n`os lint --eval --json` now carries the ADR-0112 error carriers on its generator-load failure, instead of a bare `{error}`.\n';
      const PATCH_HEAD = `---\n"@objectstack/cli": patch${LEVEL_BODY}`;
      const MINOR_HEAD = `---\n"@objectstack/cli": minor${LEVEL_BODY}`;
      const CHANGESET = '.changeset/lint-eval-generator-load-envelope.md';
      const CLI = '@objectstack/cli';
      const declaredYes = { value: 'yes', readings: ['carrier: on'] };
      const touchedCli = { packages: [CLI], unreadable: [] };
      const levelsFor = (text) => [{ file: CHANGESET, entries: entriesIn(text) }];

      // The pair. One word apart, opposite verdicts — this is the axis.
      const patchVerdict = judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: declaredYes });
      const minorVerdict = judgeLevel({ levels: levelsFor(MINOR_HEAD), touched: touchedCli, declaration: declaredYes });
      assert(patchVerdict.verdict === 'enforce', `#16044's patch head must be REFUSED — got ${patchVerdict.verdict}`);
      assert(minorVerdict.verdict === 'clean', `#16044's minor head must PASS — got ${minorVerdict.verdict}`);
      assert(
        renderLevel(patchVerdict).exitCode === 1 && renderLevel(minorVerdict).exitCode === 0,
        'the two heads must differ in EXIT CODE, not merely in verdict name — that is what CI reads',
      );
      assert(
        PATCH_HEAD.replace('patch', 'minor') === MINOR_HEAD,
        'control: the two fixtures must differ by exactly the bump word — a fixture pair that differs elsewhere is not the #16044 measurement',
      );
      assert(
        patchVerdict.offenders.length === 1 &&
          patchVerdict.offenders[0].file === CHANGESET &&
          patchVerdict.offenders[0].packages.includes(CLI),
        `the refusal must NAME the file and the package — got ${JSON.stringify(patchVerdict.offenders)}`,
      );
      const patchText = renderLevel(patchVerdict).stderr.join('\n');
      assert(patchText.includes(CLI) && patchText.includes(CHANGESET), 'the refusal MESSAGE must name the package and the changeset, not merely exit 1');
      assert(patchText.includes('`minor`'), 'the refusal message must name the level to raise to — an author reading it must know which word to change');

      // The declaration axis, held against the SAME patch head. Each of these
      // is the byte-identical offending tree with one input changed, so a green
      // here is about the declaration and cannot be about the changeset.
      //
      // ⭐ #16776 splits the old single `not-measured` in two, and the pair below
      // is the whole of it: the SAME missing declaration, over two trees that
      // differ by exactly the bump word, must reach two different EXIT CODES.
      // The old verdict exited 0 on both, so the check run concluded `success`
      // whether the unread declaration was immaterial or whether it was the one
      // input that decided the answer — indistinguishable at every surface that
      // reads a conclusion rather than a step log.
      const noDeclaration = { value: null, payload: true, readings: ['carrier: not on this PR', 'declaration line: the PR body carries no `Clause-②:` line'] };
      const notMeasuredMaterial = judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: noDeclaration });
      const notMeasuredMoot = judgeLevel({ levels: levelsFor(MINOR_HEAD), touched: touchedCli, declaration: noDeclaration });
      assert(
        notMeasuredMaterial.verdict === 'not-measured-material',
        `an unread declaration over a \`patch\` on a package this diff grew is MATERIAL — got ${notMeasuredMaterial.verdict}`,
      );
      assert(
        notMeasuredMoot.verdict === 'not-measured-moot',
        `an unread declaration that could not have changed the verdict is MOOT — got ${notMeasuredMoot.verdict}`,
      );
      assert(
        renderLevel(notMeasuredMaterial).exitCode === 1 && renderLevel(notMeasuredMoot).exitCode === 0,
        'the two must differ in EXIT CODE, not merely in verdict name — the exit code is what becomes the check-run conclusion, and that conclusion is the whole of #16776',
      );
      assert(
        PATCH_HEAD.replace('patch', 'minor') === MINOR_HEAD,
        'control: the material/moot pair must differ by exactly the bump word, and by nothing about the declaration — both are judged on the same `noDeclaration` reading',
      );
      const materialText = renderLevel(notMeasuredMaterial).stderr.join('\n');
      assert(materialText.includes('NOT MEASURED'), 'the refusal must still SAY it did not measure — #16055 bought that honesty and #16776 does not spend it');
      assert(
        materialText.includes(CLI) && materialText.includes(CHANGESET),
        'the refusal must NAME the package and the changeset whose `patch` made the missing reading material — an author must not have to guess which line asked the question',
      );
      assert(
        materialText.includes('Clause-②: no') && materialText.includes('Clause-②: yes'),
        'the refusal must spell BOTH declarations — the way out of this red is a declaration, and a message that names only the `yes` reads as a demand to raise the level',
      );
      assert(
        renderLevel(notMeasuredMoot).stdout.join('\n').includes('could not have changed this verdict'),
        'the moot green must say WHY it is green — an exit 0 that means "the missing input could not have moved this" is a different claim from a tick, and #16776 is what happens when they print alike',
      );
      assert(
        renderLevel(notMeasuredMaterial).stderr.join('\n') !== renderLevel(judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: declaredYes })).stderr.join('\n'),
        'a missing reading and a self-contradiction must not print the same refusal: one asks for a declaration, the other says the declaration and the level disagree',
      );
      const declaredNo = judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: { value: 'no', payload: true, readings: [] } });
      assert(declaredNo.verdict === 'not-declared', `a declaration of \`no\` is a DECISION, distinct from an unread one — got ${declaredNo.verdict}`);
      assert(
        renderLevel(declaredNo).exitCode === 0,
        'the explicit `no` is the opt-out this refusal is built around: it must stay a PASS on the very tree the unread reading refuses, or #16776 has been closed by making the gate uncloseable',
      );
      assert(
        renderLevel(declaredNo).stdout.join('\n') !== renderLevel(notMeasuredMoot).stdout.join('\n'),
        'a decision and a missing reading must not print the same thing — collapsing them is the defect #16055 records',
      );

      // The two contexts that are NOT a pull request, and the one that only
      // looks like it. `cut-rc.yml` runs this script on a `workflow_dispatch`
      // with no `--event` at all, over a whole RC snapshot range that certainly
      // contains `patch` bumps on packages whose src moved; a rule that reddened
      // there would have made the material refusal above unshippable.
      const noPayload = declarationFromPullRequest(readEventPullRequest(null));
      assert(noPayload.payload === false && noPayload.value === null, 'no payload at all reports `payload: false` beside the null value — the two facts are read separately');
      assert(
        judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: noPayload, prEvent: false }).verdict === 'no-pull-request',
        'a run with no pull request is NOT APPLICABLE, never an unread declaration: the RC cut and a local run reach here and neither could have declared',
      );
      assert(
        renderLevel(judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: noPayload, prEvent: false })).exitCode === 0,
        'and it exits 0 — `cut-rc.yml` gates a whole snapshot range through this script with no event payload, and reddening it would be a rule that cannot ship',
      );
      assert(
        judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: noPayload, prEvent: true }).verdict === 'payload-unreadable',
        'the same absence ON a `pull_request` run is a FAILURE: the runner writes that payload, so a run that cannot read it is broken, and standing down there would reopen this card through the back door (#4690)',
      );
      assert(
        renderLevel(judgeLevel({ levels: levelsFor(MINOR_HEAD), touched: touchedCli, declaration: noPayload, prEvent: true })).exitCode === 1,
        'control: the unreadable payload on a PR run fails on the MOOT tree too — it is about the input this run owed, not about what the diff happens to contain',
      );
      assert(
        declarationFromPullRequest({ labels: [], body: 'nothing here\n' }).payload === true,
        'control: a payload that WAS read but declared nothing reports `payload: true` — otherwise every undeclared PR would take the not-applicable lane and this card would be closed by relabelling it',
      );
      assert(
        judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: touchedCli, declaration: { value: null, readings: [] } }).verdict === 'not-measured-material',
        'a declaration with NO `payload` field at all enforces rather than standing down — the stand-down lane needs a positive `payload: false` from the reader, so a caller that forgets the flag fails closed (#4690)',
      );

      // The package axis, same patch head: `patch` for a package this diff did
      // not grow is not this gate's business.
      const untouched = judgeLevel({ levels: levelsFor(PATCH_HEAD), touched: { packages: ['@objectstack/spec'], unreadable: [] }, declaration: declaredYes });
      assert(untouched.verdict === 'clean', `\`patch\` for a package the diff does not move under packages/**/src/** is not refused — got ${untouched.verdict}`);

      // #4690, on this axis too.
      assert(judgeLevel({ levels: null, touched: touchedCli, declaration: declaredYes }).verdict === 'unreadable-diff', 'an uncomputable diff is a failure on the level axis as well');
      assert(renderLevel({ verdict: 'unreadable-diff', offenders: [], readings: [], unreadable: [] }).exitCode === 1, 'unreadable-diff exits 1');
      assert(renderLevel({ verdict: 'no-such-verdict' }).exitCode === 1, 'an unclassifiable level verdict exits 1 rather than printing a tick');
      const withUnread = renderLevel(judgeLevel({ levels: levelsFor(MINOR_HEAD), touched: { packages: [CLI], unreadable: ['packages/mystery'] }, declaration: declaredYes }));
      assert(withUnread.stdout.join('\n').includes('packages/mystery'), 'a touched package dir that could not be NAMED is printed beside the tick — an offender there could not have been seen');

      // The declaration reader, against the real #16044 PR body.
      const prBody = '## Clause ② — declared per limb, from the delivered diff\n\n- **Mechanical floor — YES.**\n';
      assert(
        declarationFromPullRequest({ labels: [{ name: 'needs:contract-review' }], body: prBody }).value === 'yes',
        'the carrier alone is a declaration — it is what #16044 actually carried',
      );
      assert(
        declarationFromPullRequest({ labels: [{ name: 'tooling' }], body: prBody }).value === null,
        "control: #16044's own PR-body prose is NOT a declaration — the same body with the carrier off reads NOT MEASURED, so the positive above is about the label",
      );
      assert(
        declarationFromPullRequest({ labels: [{ name: 'tooling' }], body: prBody }).readings.some((r) => /near miss/.test(r)),
        'and the near miss is QUOTED, so an unread declaration is actionable rather than silent',
      );
      assert(declarationFromPullRequest({ labels: [], body: 'Clause-②: yes\n' }).value === 'yes', 'the fixed declaration line is read with no carrier at all');
      assert(declarationFromPullRequest({ labels: [], body: 'Clause-②: no\n' }).value === 'no', 'and `no` is read as `no`, not as absent');
      assert(declarationFromPullRequest({ labels: [], body: 'Clause-②: probably\n' }).value === null, 'a malformed value is NOT a declaration (#12409: no tolerant reading)');
      assert(declarationFromPullRequest({ labels: [], body: 'nothing here\n' }).value === null, 'control: a body with neither reads null, so the three above are about their lines');
      assert(declarationFromPullRequest(null).value === null && declarationFromPullRequest(null).readings.length > 0, 'no payload is NOT MEASURED and says which carrier it could not read');
      assert(
        declarationFromPullRequest({ labels: [{ name: 'needs:contract-review' }], body: 'Clause-②: no\n' }).value === 'yes',
        'the carrier wins over a body that says `no`: the carrier is the review seat\'s, and only the seat clears it',
      );

      // The event payload reader — `--event` makes the file the WHOLE input.
      const evDir = initRepo('changeset-no-major-event-');
      writeFileSync(join(evDir, 'ev.json'), JSON.stringify({ pull_request: { labels: [{ name: 'needs:contract-review' }], body: '' } }));
      writeFileSync(join(evDir, 'not-json.txt'), 'nope');
      writeFileSync(join(evDir, 'no-pr.json'), JSON.stringify({ action: 'opened' }));
      assert(declarationFromPullRequest(readEventPullRequest(join(evDir, 'ev.json'))).value === 'yes', 'a real event payload on disk is read');
      assert(readEventPullRequest(join(evDir, 'not-json.txt')) === null, 'an unparseable payload reads null (⇒ NOT MEASURED), never a fabricated declaration');
      assert(readEventPullRequest(join(evDir, 'no-pr.json')) === null, 'a payload with no `pull_request` reads null');
      assert(readEventPullRequest(join(evDir, 'absent.json')) === null, 'an absent payload reads null');
      assert(readEventPullRequest(null) === null, 'no path at all reads null');

      // End to end over a real temp git repository: the diff, the manifest
      // lookup and the verdict, with nothing stubbed.
      const MANIFEST = JSON.stringify({ name: CLI, version: '0.0.0' });
      const e2e = (bump, extra = {}) =>
        makeRepo(
          { 'packages/cli/package.json': MANIFEST, 'packages/cli/src/commands/lint.ts': 'export const before = 1;\n' },
          { 'packages/cli/src/commands/lint.ts': 'export const after = 2;\n', [CHANGESET]: bump, ...extra },
        );
      {
        const { dir, base } = e2e(PATCH_HEAD);
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        assert(touched.packages.includes(CLI), `packagesTouched must name the package from its own manifest — got ${JSON.stringify(touched)}`);
        assert(touched.unreadable.length === 0, 'and report nothing unreadable when every touched dir has a manifest');
        assert(
          judgeLevel({ levels: scanned.levels, touched, declaration: declaredYes }).verdict === 'enforce',
          'end to end: a real diff that moves packages/cli/src/** and grades it `patch` under a `yes` declaration is REFUSED',
        );
      }
      {
        const { dir, base } = e2e(MINOR_HEAD);
        const scanned = scan({ cwd: dir, base });
        assert(
          judgeLevel({ levels: scanned.levels, touched: packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' }), declaration: declaredYes }).verdict === 'clean',
          'end to end control: the same repository one word along PASSES — so the refusal above is about the level, not about the diff',
        );
      }
      {
        // The same `patch`, but the diff moves only the package's TESTS.
        const { dir, base } = makeRepo(
          { 'packages/cli/package.json': MANIFEST, 'packages/cli/test/x.test.ts': 'a\n' },
          { 'packages/cli/test/x.test.ts': 'b\n', [CHANGESET]: PATCH_HEAD },
        );
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        assert(touched.packages.length === 0, `a diff outside packages/**/src/** grows no published surface — got ${JSON.stringify(touched.packages)}`);
        assert(
          judgeLevel({ levels: scanned.levels, touched, declaration: declaredYes }).verdict === 'clean',
          'end to end: `patch` beside a tests-only diff is not this gate\'s business, even under a `yes` declaration',
        );
      }
      {
        // #7005 on this axis: an entry the branch point ALREADY carried at the
        // same bump is not introduced by this PR.
        const { dir, base } = makeRepo(
          { 'packages/cli/package.json': MANIFEST, 'packages/cli/src/a.ts': 'a\n', [CHANGESET]: PATCH_HEAD },
          { 'packages/cli/src/a.ts': 'b\n', '.changeset/second.md': '---\n"@objectstack/cli": minor\n---\n\nbody\n' },
        );
        const scanned = scan({ cwd: dir, base });
        assert(
          judgeLevel({ levels: scanned.levels, touched: packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' }), declaration: declaredYes }).verdict === 'clean',
          '#7005 on the level axis: a `patch` entry already on the branch point is stock, not something this PR introduced',
        );
      }
      {
        // ...and the direction that MUST still fire: a PR that rewrites an
        // existing `minor` DOWN to `patch` introduces the `patch`.
        const { dir, base } = makeRepo(
          { 'packages/cli/package.json': MANIFEST, 'packages/cli/src/a.ts': 'a\n', [CHANGESET]: MINOR_HEAD },
          { 'packages/cli/src/a.ts': 'b\n', [CHANGESET]: PATCH_HEAD },
        );
        const scanned = scan({ cwd: dir, base });
        assert(
          judgeLevel({ levels: scanned.levels, touched: packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' }), declaration: declaredYes }).verdict === 'enforce',
          'a DOWNGRADE of an existing entry to `patch` is introduced by this PR and is refused — the control for the exemption above',
        );
      }
      {
        // A touched dir with no readable manifest is reported, never silently
        // dropped: it is a package this reading could not name.
        const { dir, base } = makeRepo(
          { 'packages/mystery/src/a.ts': 'a\n' },
          { 'packages/mystery/src/a.ts': 'b\n', [CHANGESET]: PATCH_HEAD },
        );
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        assert(
          touched.packages.length === 0 && touched.unreadable.includes('packages/mystery'),
          `an unnameable package dir is reported as unreadable, not as absent (#4690) — got ${JSON.stringify(touched)}`,
        );
      }

      // The refactor's own control: `majorPackagesIn` is now a FILTER over
      // `entriesIn`, and the family's byte-identical entry regex lives in the
      // latter. If the two ever disagree, the major half of this gate is
      // reading a different block than the level half.
      assert(entriesIn(MINOR_HEAD).length === 1 && entriesIn(MINOR_HEAD)[0].bump === 'minor', 'entriesIn reads the non-major bumps the old reader threw away');
      assert(
        JSON.stringify(majorPackagesIn(MAJOR)) === JSON.stringify(entriesIn(MAJOR).filter((e) => e.bump === 'major').map((e) => e.pkg)),
        'majorPackagesIn must equal the `major` filter over entriesIn — one block, one parse',
      );
    }

    // ── The GRAIN: a PR-scoped declaration judged at PR scope (#16361) ───────
    //
    // The fixtures are the two PRs of one dispatch round, at the heads that
    // actually carried the `patch` the gate judged, and THE PAIR IS THE CONTROL.
    // #16347 alone going green would be a gate that stopped firing; #16342 still
    // redding beside it is what says the rule survived the regrain.
    //
    //   #16342 @ 273247e56f24 — spec `patch` + runtime `patch`, both moved under
    //     src/. Six new published STACK_* error codes. Must STAY refused.
    //   #16347 @ 23443ce169af — lint `minor` (the real widening: a field-typed
    //     refusal arm) + spec `patch` (one re-worded TSDoc comment). Must PASS,
    //     and must SAY what it is not refusing.
    battery('The GRAIN: a PR-scoped declaration judged at PR scope (#16361)');
    {
      const SPEC = '@objectstack/spec';
      const RUNTIME = '@objectstack/runtime';
      const LINT = '@objectstack/lint';
      const yes = { value: 'yes', payload: true, readings: ['carrier: on'] };
      const unread = { value: null, payload: true, readings: ['carrier: not on this PR'] };
      const cs = (file, entries) => ({ file, entries });

      // ---- #16342: every moved package graded `patch` -> REFUSED ------------
      const p16342 = {
        levels: [cs('.changeset/stack-refusal-envelopes.md', [
          { pkg: SPEC, bump: 'patch' },
          { pkg: RUNTIME, bump: 'patch' },
        ])],
        touched: { packages: [SPEC, RUNTIME], unreadable: [] },
      };
      // ---- #16347: one moved package graded `minor`, another `patch` -> PASS -
      const p16347 = {
        levels: [
          cs('.changeset/lint-preset-comparand-field-typed-arm.md', [{ pkg: LINT, bump: 'minor' }]),
          cs('.changeset/spec-preset-comparand-message-tsdoc.md', [{ pkg: SPEC, bump: 'patch' }]),
        ],
        touched: { packages: [LINT, SPEC], unreadable: [] },
      };

      const fire = judgeLevel({ ...p16342, declaration: yes });
      const pass = judgeLevel({ ...p16347, declaration: yes });
      assert(fire.verdict === 'enforce', `#16342 is the CORRECT fire and must stay refused — got ${fire.verdict}`);
      assert(pass.verdict === 'discharged', `#16347 fired on the wrong package and must now pass — got ${pass.verdict}`);
      assert(
        renderLevel(fire).exitCode === 1 && renderLevel(pass).exitCode === 0,
        'the pair must differ in EXIT CODE: #16347 going green proves nothing unless #16342 still reds beside it in the same harness',
      );

      // The ablation that makes the green about the RAISE and not about the
      // diff: strip the lint `minor` from #16347 and the identical spec `patch`
      // must be refused again.
      const withoutRaise = judgeLevel({
        levels: [cs('.changeset/spec-preset-comparand-message-tsdoc.md', [{ pkg: SPEC, bump: 'patch' }])],
        touched: p16347.touched,
        declaration: yes,
      });
      assert(
        withoutRaise.verdict === 'enforce',
        `control: with the lint \`minor\` removed, #16347's spec \`patch\` is refused again — the green above is about the raise, not about the diff (got ${withoutRaise.verdict})`,
      );
      // ...and the raise has to be on a package the diff MOVED. A `minor` on a
      // package whose src this PR never touched cannot be the declared widening.
      const raiseOffDiff = judgeLevel({
        levels: p16347.levels,
        touched: { packages: [SPEC], unreadable: [] },
        declaration: yes,
      });
      assert(
        raiseOffDiff.verdict === 'enforce',
        `control: a \`minor\` on a package this diff does NOT move under packages/[pkg]/src/ does not discharge the declaration — got ${raiseOffDiff.verdict}`,
      );
      // A `major` is a raise too — the vocabulary is "minor or above", not
      // "exactly minor". (The major guard reds it on its own axis; this axis
      // must not ALSO call it an unraised package.)
      assert(
        judgeLevel({
          levels: [cs('.changeset/x.md', [{ pkg: LINT, bump: 'major' }, { pkg: SPEC, bump: 'patch' }])],
          touched: p16347.touched,
          declaration: yes,
        }).verdict === 'discharged',
        '`major` counts as a raise on this axis — the level rule says "AT LEAST `minor`", and the major guard is a separate verdict',
      );

      // ---- the messages. This is the deliverable, not cleanup ---------------
      const fireText = renderLevel(fire).stderr.join('\n');
      assert(
        !/← this PR moves/.test(fireText),
        'THE FALSE PREMISE IS GONE: the refusal must no longer tag each listed package with a per-package claim about what the diff did to it — that arrow, under a headline saying the PR "grew" them, is what made #16347 read as a finding about @objectstack/spec',
      );
      assert(
        fireText.includes('WHICH of the packages above received that widening is NOT something this gate can read'),
        'the refusal must SAY it cannot tell which package was widened — a false premise in a refusal message trains readers to stop checking premises, and that is the cost this card is paying off',
      );
      assert(
        fireText.includes('THE WIDENED PACKAGE IS ONE OF THEM, AND NONE OF THEM CARRIES THE LEVEL'),
        'and it must state the claim it DOES make, at the grain a PR-scoped declaration holds at',
      );
      assert(
        fireText.includes(SPEC) && fireText.includes(RUNTIME) && fireText.includes('.changeset/stack-refusal-envelopes.md'),
        'the refusal must still name every candidate line and its file — an author who cannot see the lines cannot raise the right one',
      );
      assert(
        fireText.includes('Raise the one that actually grew'),
        'the refusal must ask for the RIGHT package, not for all of them — asking an author to raise a package that only received a comment is the defect, restated as an instruction',
      );

      const passText = renderLevel(pass).stdout.join('\n');
      assert(passText.includes(LINT) && passText.includes('minor'), 'the green must NAME the package that carries the level — the old gate never named it, and it is the only package the declaration is about');
      assert(
        passText.includes(SPEC) && passText.includes('are NOT refused'),
        'ANTI-QUIET: the green must print the `patch` lines it is deliberately not refusing. A gate that stops firing silently is the failure mode this repo has three open cards about; this one says out loud what it set aside',
      );
      assert(
        passText.includes('a SECOND widening in this PR, graded `patch` beside the `minor` above, would not be seen here'),
        'and it must name its own residual: what this predicate cannot see is stated on the green, not left for a reader to discover on the case it misses',
      );
      assert(
        !/tolerance|allowlist|comment-only/i.test(passText),
        'control: the green is not a tolerance, an allowlist, or a comment-only skip — none of those words appear because none of those mechanisms is here. Nothing reads the CONTENT of a diff hunk',
      );

      // `clean` and `discharged` are two different greens and must not print
      // alike: one means there was nothing of this shape, the other means there
      // was and this gate knowingly did not refuse it.
      const cleanGreen = judgeLevel({
        levels: [cs('.changeset/lint-preset-comparand-field-typed-arm.md', [{ pkg: LINT, bump: 'minor' }])],
        touched: { packages: [LINT], unreadable: [] },
        declaration: yes,
      });
      assert(cleanGreen.verdict === 'clean', `no moved package graded \`patch\` at all is still \`clean\` — got ${cleanGreen.verdict}`);
      assert(
        renderLevel(cleanGreen).stdout.join('\n') !== passText,
        'a green with nothing to set aside and a green that set something aside must not print the same thing — collapsing them is the defect #16055 records, one lane along',
      );

      // ---- materiality moved with the predicate, and had to (#16776) --------
      // The unread declaration is MATERIAL exactly where a `yes` would have
      // refused. Both halves are read from one `refusable`, so the NOT MEASURED
      // lane cannot drift from the enforcing lane.
      assert(
        judgeLevel({ ...p16342, declaration: unread }).verdict === 'not-measured-material',
        "#16342's shape with no declaration is MATERIAL — a `yes` would have refused it, so the missing reading decided the verdict",
      );
      assert(
        judgeLevel({ ...p16347, declaration: unread }).verdict === 'not-measured-moot',
        "#16347's shape with no declaration is MOOT — `yes` and `no` reach the same answer once a moved package carries the level, and refusing here would re-open this card through the NOT MEASURED lane",
      );
      assert(
        renderLevel(judgeLevel({ ...p16342, declaration: unread })).exitCode === 1 &&
          renderLevel(judgeLevel({ ...p16347, declaration: unread })).exitCode === 0,
        'and the two differ in EXIT CODE — #16776 bought that split and #16361 must not spend it',
      );
      assert(
        renderLevel(judgeLevel({ ...p16347, declaration: unread })).stdout.join('\n').includes('carries the level for the PR'),
        'the moot green must say WHICH of the two reasons made it moot — "no `patch` at all" and "a raise already carries it" are different facts about the diff',
      );
      assert(
        judgeLevel({ ...p16342, declaration: { value: 'no', payload: true, readings: [] } }).verdict === 'not-declared',
        'control: an explicit `no` is still a DECISION on the very tree the unread reading refuses — the opt-out survives the regrain',
      );

      // ---- end to end, on a real temp git repository ------------------------
      // #16347's shape with nothing stubbed: two packages' src moved, two
      // changesets, one `minor` and one `patch`.
      {
        const manifest = (name) => JSON.stringify({ name, version: '0.0.0' });
        const { dir, base } = makeRepo(
          {
            'packages/lint/package.json': manifest(LINT),
            'packages/spec/package.json': manifest(SPEC),
            'packages/lint/src/rules/filter-preset-comparand.ts': 'export const arm = 1;\n',
            'packages/spec/src/data/date-range-presets.ts': '/** old wording */\nexport const m = 1;\n',
          },
          {
            'packages/lint/src/rules/filter-preset-comparand.ts': 'export const arm = 1;\nexport const fieldTyped = 2;\n',
            'packages/spec/src/data/date-range-presets.ts': '/** new wording */\nexport const m = 1;\n',
            '.changeset/lint-preset-comparand-field-typed-arm.md': `---\n'${LINT}': minor\n---\n\nbody\n`,
            '.changeset/spec-preset-comparand-message-tsdoc.md': `---\n'${SPEC}': patch\n---\n\nbody\n`,
          },
        );
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        assert(
          touched.packages.includes(LINT) && touched.packages.includes(SPEC),
          `end to end: both packages' src moved and both must be read — got ${JSON.stringify(touched)}`,
        );
        assert(
          judgeLevel({ levels: scanned.levels, touched, declaration: yes }).verdict === 'discharged',
          'end to end: the real #16347 shape passes, and passes as `discharged` rather than as an empty tick',
        );
        // The same repository with the lint changeset graded `patch` instead:
        // now nothing carries the level and the refusal is right again.
        const { dir: dir2, base: base2 } = makeRepo(
          {
            'packages/lint/package.json': manifest(LINT),
            'packages/spec/package.json': manifest(SPEC),
            'packages/lint/src/rules/filter-preset-comparand.ts': 'export const arm = 1;\n',
            'packages/spec/src/data/date-range-presets.ts': '/** old wording */\nexport const m = 1;\n',
          },
          {
            'packages/lint/src/rules/filter-preset-comparand.ts': 'export const arm = 1;\nexport const fieldTyped = 2;\n',
            'packages/spec/src/data/date-range-presets.ts': '/** new wording */\nexport const m = 1;\n',
            '.changeset/lint-preset-comparand-field-typed-arm.md': `---\n'${LINT}': patch\n---\n\nbody\n`,
            '.changeset/spec-preset-comparand-message-tsdoc.md': `---\n'${SPEC}': patch\n---\n\nbody\n`,
          },
        );
        const scanned2 = scan({ cwd: dir2, base: base2 });
        assert(
          judgeLevel({
            levels: scanned2.levels,
            touched: packagesTouched({ cwd: dir2, from: scanned2.base, head: 'HEAD' }),
            declaration: yes,
          }).verdict === 'enforce',
          'end to end control: one word along — the lint entry graded `patch` — and the same two-package diff is refused, so the pass above is about the level and not about the shape of the diff',
        );
      }
    }

    // ── THE DEPTH: a nested package is a candidate at all (#16713) ───────────
    //
    // The axis used to read the package segment one path segment wide, so it
    // saw 23 of this workspace's 74 packages and the other 51 — every driver,
    // service, plugin, connector, trigger, adapter and app — could pair a
    // `Clause-②: yes` with a `patch` and stay green. THE PAIR IS THE CONTROL
    // here exactly as it is above: the nested leg going red proves nothing on
    // its own, because "the matcher was widened" and "the gate now refuses
    // everything" produce the same red. So every fixture below is answered by a
    // control that must STAY green, and the flat leg is re-asserted in this
    // same harness so a nested red is readable as a widening rather than as a
    // gate that lost its discrimination.
    battery('THE DEPTH: a nested package is a candidate the axis can refuse (#16713)');
    {
      // ⚠️ #16692 made this reading TWO-legged, so the shape helper has to be
      // handed a manifest reader. This one answers for exactly ONE directory,
      // which is what keeps every assertion in this battery about DEPTH: no
      // other candidate on any walk below can resolve a `bin` target, so a
      // green here cannot be coming from the other leg.
      const cliManifest = { name: '@objectstack/cli', version: '0.0.0', files: ['dist'], bin: { os: './bin/os.mjs' } };
      const owners = (p) => JSON.stringify(publishedSourceOwners(p, (dir) => (dir === 'packages/cli' ? cliManifest : null)));
      const declaredYes = { value: 'yes', payload: true, readings: ['carrier: on'] };

      // The shape reading, at three depths and its controls. Depth-agnostic is
      // the whole point: a repair that merely allowed ONE extra segment passes
      // the first two of these and fails the third.
      assert(owners('packages/cli/src/commands/lint.ts') === '["packages/cli"]', `flat: one segment ⇒ the package dir — got ${owners('packages/cli/src/commands/lint.ts')}`);
      assert(
        owners('packages/drivers/driver-sql/src/sql-driver.ts') === '["packages/drivers/driver-sql"]',
        `nested: the GROUP is not the package, the dir under it is — got ${owners('packages/drivers/driver-sql/src/sql-driver.ts')}`,
      );
      assert(
        owners('packages/a/b/c/src/x.ts') === '["packages/a/b/c"]',
        `three levels deep reads the same way — a fix that hard-codes ONE optional group segment fails HERE, which is why the reading is a walk and not a wider pattern — got ${owners('packages/a/b/c/src/x.ts')}`,
      );
      assert(owners('packages/drivers/driver-sql/README.md') === '[]', 'control: a path with no `src/` segment owns nothing — otherwise the three positives above would hold for every file in the repo');
      // ⭐ INVERTED by #16692, deliberately and in place. This control was
      // written by #16713 to hold the ROOT axis OPEN — «`bin/**` is still NOT
      // read … a fix that reddened here would be answering a different card» —
      // and it did its job: the boundary could not close by accident, and this
      // is the card that came to close it on purpose. The reasoning is kept and
      // the direction is flipped, because that is the difference between a
      // boundary that was moved and one that was forgotten.
      assert(
        owners('packages/cli/bin/os.mjs') === '["packages/cli"]',
        'INVERTED (#16692): a `bin` target IS read now — npm packs it regardless of `files` (#14874), so a diff confined to it names its package. ' +
          'What is STILL not read, and is a different instrument entirely: whether an `src/**` change grew the PUBLIC FACE at all. A package-internal ' +
          'data line under `src/` is counted as growth on path alone — the 误判 half, filed separately — and no reading of the PACKED set can answer it. ' +
          `got ${owners('packages/cli/bin/os.mjs')}`,
      );
      assert(owners('scripts/check-changeset-no-major.mjs') === '[]', 'control: outside `packages/` there is no owner at all');
      assert(owners('packages/src/x.ts') === '[]', 'control: the owner must be at least `packages/<something>` — `packages` itself is not a package');
      assert(owners('packages/cli/src') === '[]', 'control: a path that IS `src` is not a path INSIDE `src/` — the walk stops one short of the end');

      // The multi-candidate case, which this repo really contains, and the
      // reason the walk resolves SHALLOWEST first. `packages/create-objectstack`
      // ships a scaffold template that carries its own `package.json`
      // (`objectstack-blank`, private, not a workspace member), and the template
      // has a `src/` of its own. Resolving to the NEAREST manifest would name
      // the private template and DROP the real package — a regression against
      // the one-segment reading this replaces.
      const twin = 'packages/create-objectstack/src/templates/blank/src/objects/note.object.ts';
      assert(
        owners(twin) === '["packages/create-objectstack","packages/create-objectstack/src/templates/blank"]',
        `a path can own two candidates and they are ordered SHALLOWEST first — got ${owners(twin)}`,
      );

      const NESTED = '@objectstack/driver-sql';
      const NESTED_DIR = 'packages/drivers/driver-sql';
      const CS = '.changeset/depth-leg.md';
      const nestedRepo = (bump) =>
        makeRepo(
          { [`${NESTED_DIR}/package.json`]: JSON.stringify({ name: NESTED, version: '0.0.0' }), [`${NESTED_DIR}/src/sql-driver.ts`]: 'export const before = 1;\n' },
          { [`${NESTED_DIR}/src/sql-driver.ts`]: 'export const after = 2;\n', [CS]: `---\n"${NESTED}": ${bump}\n---\n\nbody\n` },
        );
      const levelOf = ({ dir, base }) => {
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        return { touched, result: judgeLevel({ levels: scanned.levels, touched, declaration: declaredYes }) };
      };

      // THE LEG THIS CARD IS ABOUT. Byte for byte the assertion the flat leg
      // has carried since #16055, with the package one directory deeper.
      const nestedPatch = levelOf(nestedRepo('patch'));
      assert(
        nestedPatch.touched.packages.includes(NESTED),
        `end to end: a nested package's src moved must NAME the package from its own manifest — got ${JSON.stringify(nestedPatch.touched)}`,
      );
      assert(
        nestedPatch.result.verdict === 'enforce',
        `end to end: a real diff that moves ${NESTED_DIR}/src/** and grades it \`patch\` under a \`yes\` declaration is REFUSED — got ${nestedPatch.result.verdict}`,
      );
      assert(renderLevel(nestedPatch.result).exitCode === 1, 'and it EXITS 1 — the exit code is what becomes the check-run conclusion, and a verdict name CI never reads is not a refusal');
      assert(
        renderLevel(nestedPatch.result).stderr.join('\n').includes(NESTED),
        'the refusal must NAME the nested package — an author who cannot see which line is being asked about cannot act on it',
      );

      // CONTROL 1, the level: the same repository one word along. Without this,
      // the red above is equally consistent with "any nested diff is now
      // refused", which is the shape a tolerance-free fix must not have.
      const nestedMinor = levelOf(nestedRepo('minor'));
      assert(
        nestedMinor.touched.packages.includes(NESTED) && nestedMinor.result.verdict === 'clean',
        `control: the same nested diff graded \`minor\` PASSES while still being SEEN — so the refusal is about the level, not about the depth — got ${JSON.stringify(nestedMinor.touched)} / ${nestedMinor.result.verdict}`,
      );
      assert(renderLevel(nestedMinor.result).exitCode === 0, 'and the two nested legs differ in EXIT CODE, one word apart');

      // CONTROL 2, the flat leg, re-driven HERE. #16055's assertion lives in
      // its own battery; re-stating it inside this harness is what makes the
      // nested red above readable as a WIDENING rather than as a gate that
      // stopped discriminating.
      const flat = levelOf(
        makeRepo(
          { 'packages/cli/package.json': JSON.stringify({ name: '@objectstack/cli', version: '0.0.0' }), 'packages/cli/src/commands/lint.ts': 'export const before = 1;\n' },
          { 'packages/cli/src/commands/lint.ts': 'export const after = 2;\n', [CS]: '---\n"@objectstack/cli": patch\n---\n\nbody\n' },
        ),
      );
      assert(
        flat.result.verdict === 'enforce' && renderLevel(flat.result).exitCode === 1,
        `control: the FLAT leg still reds in this same harness — a nested red beside a flat green would mean the reading moved rather than widened — got ${flat.result.verdict}`,
      );

      // CONTROL 3, the nonsense leg: a diff that publishes nothing must stay
      // green under the very same `yes`. An implementation that simply always
      // enforced would satisfy every positive above and fail only here.
      const nonsense = levelOf(
        makeRepo(
          { 'packages/cli/package.json': JSON.stringify({ name: '@objectstack/cli', version: '0.0.0' }), 'content/docs/a.mdx': 'a\n' },
          { 'content/docs/a.mdx': 'b\n', [CS]: '---\n"@objectstack/cli": patch\n---\n\nbody\n' },
        ),
      );
      assert(
        nonsense.touched.packages.length === 0 && nonsense.result.verdict === 'clean' && renderLevel(nonsense.result).exitCode === 0,
        `control: a diff that moves no published source is still not this gate's business under a \`yes\` — got ${JSON.stringify(nonsense.touched)} / ${nonsense.result.verdict}`,
      );

      // ⭐ THE NEW FAILURE MODE. Widening the shape means nested paths now
      // MATCH, so a nested dir whose manifest cannot be read has somewhere to
      // land. Before this change it landed in NEITHER set — the exact shape
      // #4690 forbids, and the one the filing card names: the gate could not
      // report a limb it never grew. `packages/mystery` pins this for a flat
      // dir in the battery above; this pins it at depth.
      const { dir: nmDir, base: nmBase } = makeRepo(
        { 'packages/newgroup/newpkg/src/a.ts': 'a\n' },
        { 'packages/newgroup/newpkg/src/a.ts': 'b\n', [CS]: '---\n"@objectstack/cli": patch\n---\n\nbody\n' },
      );
      const nmScanned = scan({ cwd: nmDir, base: nmBase });
      const nmTouched = packagesTouched({ cwd: nmDir, from: nmScanned.base, head: 'HEAD' });
      assert(
        nmTouched.unreadable.includes('packages/newgroup/newpkg'),
        `a NESTED dir whose manifest cannot be read is reported as unreadable, not as absent (#4690) — got ${JSON.stringify(nmTouched)}`,
      );
      assert(nmTouched.packages.length === 0, 'and it is not named as a package either — an unreadable manifest yields no name to report');
      assert(
        nmTouched.unreadable.length + nmTouched.packages.length === 1,
        'the invariant the widening owes: a path that MATCHES the shape lands in exactly one of the two sets, never in neither — landing in neither is the whole finding this battery closes',
      );
      assert(
        renderLevel(judgeLevel({ levels: nmScanned.levels, touched: nmTouched, declaration: declaredYes })).stdout.join('\n').includes('packages/newgroup/newpkg'),
        'and the tick PRINTS it — an offender that could not be seen must be stated beside the green, or the green is the same silent pass this card is about',
      );
    }

    // ── THE ROOT: a packed `bin` target is a published surface (#16692) ──────
    //
    // The DEPTH battery above answers HOW DEEP the package owning a root may
    // sit. This one answers WHICH ROOTS SHIP, and it is the other half of the
    // same finding: a diff confined to `packages/cli/bin/**` paired a
    // `Clause-②: yes` with a `patch` and stayed GREEN on PR #16686, while the
    // byte-for-byte same declaration over `src/**` went RED on PR #16672 the
    // same day. ⇒ Same declaration, same grade, opposite verdicts, because
    // `bin/` ships (npm packs a `bin` target REGARDLESS of `files`, #14874) and
    // the axis could not see it. The dispatching seat then read that green as
    // "the axis looked and approved" and had to correct itself publicly — the
    // concrete cost this card records.
    //
    // ⛔ THE TRAP THIS BATTERY GUARDS, stated because it is the failure this
    // repair could most plausibly have shipped: triage's ruling said to judge a
    // package by its PACKED set. Taken literally that GUTS the axis, because
    // `files` is `["dist", ...]` and `src/**` is not packed — it is compiled
    // into what is. Such a fix reds nothing and prints ticks. So the `src/**`
    // leg is untouched and the packed reading is an ADDITIONAL leg, and the
    // superset control below is what proves that rather than asserting it.
    //
    // Every count here is paired the way the DEPTH battery pairs its own: a red
    // proves nothing alone, because "the reading widened" and "the gate refuses
    // everything now" produce the same red.
    battery('THE ROOT: a packed `bin` target is a published surface the axis can refuse (#16692)');
    {
      const declaredYes = { value: 'yes', payload: true, readings: ['carrier: on'] };
      const CLI = '@objectstack/cli';
      const CS = '.changeset/root-leg.md';

      // ── The reader for `bin`, in both spellings npm accepts and its junk ───
      const targets = (bin) => JSON.stringify(binTargetsOf({ bin }));
      assert(targets({ os: './bin/run.js' }) === '["bin/run.js"]', `the object spelling, with \`./\` stripped — got ${targets({ os: './bin/run.js' })}`);
      assert(targets('bin/run.js') === '["bin/run.js"]', `the STRING spelling is the same target — a package with one command may write either — got ${targets('bin/run.js')}`);
      assert(
        targets({ objectstack: './bin/run.js', os: './bin/run.js' }) === '["bin/run.js"]',
        `two command NAMES pointing at one file is one target — this is the real manifest of packages/cli — got ${targets({ objectstack: './bin/run.js', os: './bin/run.js' })}`,
      );
      assert(
        targets({ a: './bin/a.js', b: 'bin/b.js' }) === '["bin/a.js","bin/b.js"]',
        `two DIFFERENT targets are both read — a package that grew a second command must not be read through its first — got ${targets({ a: './bin/a.js', b: 'bin/b.js' })}`,
      );
      assert(targets(undefined) === '[]', 'control: no `bin` field declares no target — otherwise every package would own its whole tree through this leg');
      assert(targets(['bin/run.js']) === '[]', 'control: an ARRAY is not a spelling npm accepts, and a reader that guessed here would be inventing a published surface');
      assert(targets({ a: 42, b: null }) === '[]', 'control: non-string values name nothing — a malformed manifest is not a licence to guess');
      assert(targets({ a: '../../etc/passwd', b: '/abs.js' }) === '[]', 'control: a target that climbs out of the package, or is absolute, names nothing THIS package publishes');
      assert(targets({ a: './/bin//run.js/' }) === '["bin/run.js"]', `control: a target is normalised before it is compared, or the same file spelt twice is two targets — got ${targets({ a: './/bin//run.js/' })}`);

      // ── The walk, with a manifest under `packages/cli` and nowhere else ────
      const manifestWith = (bin) => (dir) => (dir === 'packages/cli' ? { name: CLI, version: '0.0.0', files: ['dist'], bin } : null);
      const seen = (p, bin) => JSON.stringify(publishedSourceOwners(p, manifestWith(bin)));

      assert(seen('packages/cli/bin/run.js', { os: './bin/run.js' }) === '["packages/cli"]', `THE CARD: a packed \`bin\` target names its package — got ${seen('packages/cli/bin/run.js', { os: './bin/run.js' })}`);
      assert(seen('packages/cli/bin/run.js', 'bin/run.js') === '["packages/cli"]', `... in the string spelling too — got ${seen('packages/cli/bin/run.js', 'bin/run.js')}`);
      // ⭐ THE CONTROL THAT SAYS THIS IS NOT A LIST OF ROOTS. `bin/run-dev.js`
      // really sits beside `bin/run.js` in this repo; `bin` does not name it and
      // `files` is `["dist","README.md","CHANGELOG.md"]`, so it does NOT ship.
      // A repair that added `bin/**` as a root — the option triage refused —
      // would count it, and would be over-including where the tree can tell.
      assert(
        seen('packages/cli/bin/run-dev.js', { os: './bin/run.js' }) === '[]',
        `control: a sibling in the SAME directory that \`bin\` does not name is not published — this leg reads the manifest, it does not add \`bin/\` to a list of roots — got ${seen('packages/cli/bin/run-dev.js', { os: './bin/run.js' })}`,
      );
      // And the converse, which no directory list could ever get right.
      assert(
        seen('packages/cli/dist/cli.js', { os: './dist/cli.js' }) === '["packages/cli"]',
        `control: a \`bin\` that points OUTSIDE \`bin/\` is read — «add \`bin/**\` to the roots» is blind here, and lists drifting is why this card exists — got ${seen('packages/cli/dist/cli.js', { os: './dist/cli.js' })}`,
      );
      assert(
        JSON.stringify(publishedSourceOwners('packages/cli/bin/run.js', () => null)) === '[]',
        'FIRING control: the identical path owns nothing when no manifest answers — so the positives above are the MANIFEST being read, not the path shape',
      );
      const unparseableAt = (at) => (dir) => (dir === at ? false : null);
      assert(
        JSON.stringify(publishedSourceOwners('packages/cli/bin/run.js', unparseableAt('packages/cli'))) === '["packages/cli"]',
        `#4690 extended to this leg: a manifest that is THERE and will not parse cannot be asked what it packs, so its directory is a CANDIDATE that cannot be named — it lands in \`unreadable\`, never in neither set — got ${JSON.stringify(publishedSourceOwners('packages/cli/bin/run.js', unparseableAt('packages/cli')))}`,
      );
      assert(
        JSON.stringify(publishedSourceOwners('packages/cli/README.md', unparseableAt('packages/cli'))) === '["packages/cli"]',
        'and the residual is honest about its own width: with the manifest unparseable, NO path under that directory can be ruled out either, so an ordinary file there is reported too — over-reporting a residual is this axis\'s safe direction, under-reporting it is #4690',
      );
      let threw = null;
      try {
        publishedSourceOwners('packages/cli/bin/run.js');
      } catch (error) {
        threw = error;
      }
      assert(
        threw instanceof TypeError && /manifest reader is required/.test(threw.message),
        `the reader is REQUIRED: a default would silently read \`src/**\` alone at a call site that reads as if it asked the whole question — got ${threw && threw.message}`,
      );

      // ── SUPERSET-ONLY, measured rather than argued ────────────────────────
      //
      // The safety property this card owes: no path that was «grown» before may
      // stop being «grown». Driven with a bin-bearing manifest under EVERY
      // ancestor — the most a second leg could ever perturb — every answer the
      // DEPTH battery pins must come back byte for byte.
      const everywhere = () => ({ name: 'x', version: '0.0.0', bin: { x: './bin/x.js' } });
      for (const [path, expected] of [
        ['packages/cli/src/commands/lint.ts', '["packages/cli"]'],
        ['packages/drivers/driver-sql/src/sql-driver.ts', '["packages/drivers/driver-sql"]'],
        ['packages/a/b/c/src/x.ts', '["packages/a/b/c"]'],
        ['packages/create-objectstack/src/templates/blank/src/objects/note.object.ts', '["packages/create-objectstack","packages/create-objectstack/src/templates/blank"]'],
      ]) {
        const got = JSON.stringify(publishedSourceOwners(path, everywhere));
        assert(got === expected, `superset: \`${path}\` still resolves exactly as it did before the \`bin\` leg — got ${got}, want ${expected}`);
      }
      assert(
        JSON.stringify(publishedSourceOwners('packages/drivers/driver-sql/README.md', everywhere)) === '[]',
        'nonsense control on the superset run: a manifest under every ancestor must NOT make an ordinary file owned — otherwise the four rows above would hold for any input at all',
      );

      // ── End to end, on real temp git repositories ─────────────────────────
      const manifestJson = (bin) => JSON.stringify({ name: CLI, version: '0.0.0', files: ['dist', 'README.md'], bin });
      const levelOf = ({ dir, base }) => {
        const scanned = scan({ cwd: dir, base });
        const touched = packagesTouched({ cwd: dir, from: scanned.base, head: 'HEAD' });
        return { touched, result: judgeLevel({ levels: scanned.levels, touched, declaration: declaredYes }) };
      };
      const binRepo = (bump, file, bin = { objectstack: './bin/run.js', os: './bin/run.js' }) =>
        makeRepo(
          { 'packages/cli/package.json': manifestJson(bin), [file]: '#!/usr/bin/env node\nrun(1);\n' },
          { [file]: '#!/usr/bin/env node\nrun(2);\n', [CS]: `---\n"${CLI}": ${bump}\n---\n\nbody\n` },
        );

      // THE LEG THIS CARD IS ABOUT — the pairing that was green on PR #16686.
      const binPatch = levelOf(binRepo('patch', 'packages/cli/bin/run.js'));
      assert(binPatch.touched.packages.includes(CLI), `end to end: a diff confined to a packed \`bin\` target must NAME the package from its own manifest — got ${JSON.stringify(binPatch.touched)}`);
      assert(binPatch.result.verdict === 'enforce', `end to end: \`bin/**\` + \`Clause-②: yes\` + \`patch\` is REFUSED — got ${binPatch.result.verdict}`);
      assert(renderLevel(binPatch.result).exitCode === 1, 'and it EXITS 1 — a verdict name CI never reads is not a refusal');
      assert(renderLevel(binPatch.result).stderr.join('\n').includes(CLI), 'and the refusal NAMES the package — an author who cannot see which line is being asked about cannot act on it');
      assert(levelOf(binRepo('patch', 'packages/cli/bin/run.js', 'bin/run.js')).result.verdict === 'enforce', 'end to end: the STRING spelling of `bin` refuses identically — a package with one command must not be graded by which spelling it chose');

      // CONTROL 1, the level. Without it the red above is equally consistent
      // with "any diff under a package is now refused".
      const binMinor = levelOf(binRepo('minor', 'packages/cli/bin/run.js'));
      assert(
        binMinor.touched.packages.includes(CLI) && binMinor.result.verdict === 'clean' && renderLevel(binMinor.result).exitCode === 0,
        `control: the same \`bin\` diff graded \`minor\` PASSES while still being SEEN — the refusal is about the LEVEL, not about the root — got ${JSON.stringify(binMinor.touched)} / ${binMinor.result.verdict}`,
      );

      // CONTROL 2, the `src` leg re-driven in THIS harness, so the red above
      // reads as a widening rather than as a reading that moved.
      const srcLeg = levelOf(
        makeRepo(
          { 'packages/cli/package.json': manifestJson({ os: './bin/run.js' }), 'packages/cli/src/commands/lint.ts': 'export const before = 1;\n' },
          { 'packages/cli/src/commands/lint.ts': 'export const after = 2;\n', [CS]: `---\n"${CLI}": patch\n---\n\nbody\n` },
        ),
      );
      assert(
        srcLeg.result.verdict === 'enforce' && renderLevel(srcLeg.result).exitCode === 1,
        `control: the \`src/**\` leg still reds in this same harness — a \`bin\` red beside an \`src\` green would mean the reading MOVED rather than widened, which is the fix this card must not ship — got ${srcLeg.result.verdict}`,
      );

      // CONTROL 3, the non-target sibling, end to end. The unit row above says
      // the walk does not own it; this says the GATE does not refuse it.
      const sibling = levelOf(binRepo('patch', 'packages/cli/bin/run-dev.js'));
      assert(
        sibling.touched.packages.length === 0 && sibling.result.verdict === 'clean' && renderLevel(sibling.result).exitCode === 0,
        `control: a file beside the target that \`bin\` does not name and \`files\` excludes does NOT ship, and is not refused — got ${JSON.stringify(sibling.touched)} / ${sibling.result.verdict}`,
      );

      // CONTROL 4, the NEGATIVE control triage made mandatory: a diff touching
      // no published surface at all must still pass under the very same `yes`.
      // ⛔ Without this leg an implementation that simply always enforced would
      // satisfy every positive above and be indistinguishable from a correct one.
      for (const [label, file] of [
        ['content/docs/**', 'content/docs/a.mdx'],
        ['.github/**', '.github/workflows/x.yml'],
      ]) {
        const nothing = levelOf(
          makeRepo({ 'packages/cli/package.json': manifestJson({ os: './bin/run.js' }), [file]: 'a\n' }, { [file]: 'b\n', [CS]: `---\n"${CLI}": patch\n---\n\nbody\n` }),
        );
        assert(
          nothing.touched.packages.length === 0 && nothing.touched.unreadable.length === 0 && nothing.result.verdict === 'clean' && renderLevel(nothing.result).exitCode === 0,
          `NEGATIVE control (${label}): a diff that publishes nothing still PASSES under a \`yes\` — got ${JSON.stringify(nothing.touched)} / ${nothing.result.verdict}`,
        );
      }

      // ⭐ #4690, extended to this leg end to end. A manifest that is THERE and
      // will not parse cannot be asked what it packs. Before this change such a
      // directory was simply not a candidate for anything outside `src/**`, so a
      // `bin` change under it landed in NEITHER set — the shape this whole file
      // is built to refuse.
      const { dir: brokenDir, base: brokenBase } = makeRepo(
        { 'packages/broken/package.json': '{ "name": "@objectstack/broken",\n', 'packages/broken/bin/run.js': 'a\n' },
        { 'packages/broken/bin/run.js': 'b\n', [CS]: `---\n"${CLI}": patch\n---\n\nbody\n` },
      );
      const brokenScanned = scan({ cwd: brokenDir, base: brokenBase });
      const brokenTouched = packagesTouched({ cwd: brokenDir, from: brokenScanned.base, head: 'HEAD' });
      assert(brokenTouched.unreadable.includes('packages/broken'), `a dir whose manifest will not parse is reported as unreadable, not as absent (#4690) — got ${JSON.stringify(brokenTouched)}`);
      assert(brokenTouched.packages.length === 0, 'and it is not named as a package either — an unparseable manifest yields no name to report');
      assert(
        brokenTouched.unreadable.length + brokenTouched.packages.length === 1,
        'the invariant this leg owes: a path this reading matches lands in exactly one of the two sets, never in neither',
      );
      assert(
        renderLevel(judgeLevel({ levels: brokenScanned.levels, touched: brokenTouched, declaration: declaredYes })).stdout.join('\n').includes('packages/broken'),
        'and the tick PRINTS it — an offender that could not be seen must be stated beside the green, or the green is the silent pass this card is about',
      );
      // The nonsense control on that reading: a dir with NO manifest at all has
      // no `bin` field to have named anything, so an ordinary file under it is
      // not a candidate and nothing is owed. ⛔ Otherwise the row above would
      // hold for every path in the repo and `unreadable` would mean nothing.
      const { dir: bareDir, base: bareBase } = makeRepo({ 'packages/bare/bin/run.js': 'a\n' }, { 'packages/bare/bin/run.js': 'b\n', [CS]: `---\n"${CLI}": patch\n---\n\nbody\n` });
      const bareScanned = scan({ cwd: bareDir, base: bareBase });
      const bareTouched = packagesTouched({ cwd: bareDir, from: bareScanned.base, head: 'HEAD' });
      assert(
        bareTouched.packages.length === 0 && bareTouched.unreadable.length === 0,
        `nonsense control: an ABSENT manifest declares no \`bin\`, so nothing under it is a candidate and no residual is owed — got ${JSON.stringify(bareTouched)}`,
      );
    }

  } finally {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true });
  }

  // ── The wiring: these fixtures must actually run on every PR ──────────────
  //
  // Same shape and the same honesty as check-empty-changeset's consumer block
  // (#6509): assertions are only as real as the step that runs them, and a gate
  // nobody invokes is #4690's phantom check with extra ceremony.
  //
  // This file is the third member of that family and the last to be wired. The
  // two halves it pins are DIFFERENT places on purpose:
  //
  //   * the SELF-TEST runs in lint.yml's ESLint job, which has no PR-level
  //     exemption — that is what #6509/PR #6917 built the step for;
  //   * the REAL SCAN stays in pr-automation.yml, because its `allow-major` and
  //     `skip-changeset` exemptions are deliberate, AND because after #7005 it
  //     needs the `$MERGE_BASE` that job derives. Moving it into lint.yml would
  //     silently revoke the escape hatch the offenders report prescribes, and
  //     leave it with no branch point to judge against — which is #6129 in the
  //     false-RED direction, the very thing this card fixed.
  //
  // RESIDUAL, recorded rather than implied: this block is run BY the step it
  // pins, so a PR deleting both the step and this script is not caught here.
  // That is a deletion plainly visible in a `.github/**` diff rather than a
  // silent no-op.
  battery('The wiring: these fixtures must actually run on every PR');
  {
    const uncommented = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

    const lintPath = join(REPO_ROOT, '.github/workflows/lint.yml');
    assert(existsSync(lintPath), 'wiring: .github/workflows/lint.yml must exist — it is where this self-test runs unconditionally (#6509)');
    const lintYaml = existsSync(lintPath) ? readFileSync(lintPath, 'utf8') : '';

    const lintJobStart = lintYaml.indexOf('\n  lint:');
    const lintJobEnd = lintYaml.indexOf('\n  typecheck:');
    const lintJob = uncommented(lintJobStart === -1 ? '' : lintYaml.slice(lintJobStart, lintJobEnd === -1 ? undefined : lintJobEnd));
    // The anti-vacuous-green guard #6983 wrote down: an anchor that stops
    // matching yields an empty slice, and every assertion below it would then be
    // judging an empty string and passing for the wrong reason, permanently and
    // silently. So the slice is asserted to have found something first.
    assert(lintJob.length > 0, 'wiring: the `lint:` job could not be sliced out of lint.yml — its anchors went stale, and every assertion below would judge an empty string');

    const steps = lintJob.split(/\n(?=      - name: )/);
    const wired = steps.filter((s) => /run: pnpm check:changeset-gate-self-tests\b/.test(s));
    assert(wired.length === 1, `wiring: lint.yml's ESLint job must run \`pnpm check:changeset-gate-self-tests\` exactly once (found ${wired.length})`);
    assert(
      wired.every((s) => !/^\s*if:/m.test(s)),
      'wiring: that step must carry NO `if:` — whatever a condition reads is a way for a PR to arrange that these fixtures do not run on it, which is #6509 itself',
    );

    const pkgPath = join(REPO_ROOT, 'package.json');
    assert(existsSync(pkgPath), 'wiring: the repository root package.json must exist — it carries the script lint.yml runs');
    let wiring = '';
    try {
      wiring = JSON.parse(existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '{}').scripts?.['check:changeset-gate-self-tests'] ?? '';
    } catch {
      wiring = '';
    }
    assert(
      /check-changeset-no-major\.mjs --self-test/.test(wiring),
      'wiring: `check:changeset-gate-self-tests` must run `check-changeset-no-major.mjs --self-test` — the step in lint.yml is only as real as the script it resolves to (#6923)',
    );
    assert(
      !/check-changeset-no-major\.mjs(?! --self-test)/.test(wiring),
      'wiring: `check:changeset-gate-self-tests` must invoke this file ONLY with `--self-test` — the real scan needs $MERGE_BASE and belongs in pr-automation.yml, where its `allow-major` exemption is',
    );

    // The real scan's home. If this moves or vanishes, the guard stops guarding
    // and nothing else in the repo would say so.
    const prAutomationPath = join(REPO_ROOT, '.github/workflows/pr-automation.yml');
    assert(existsSync(prAutomationPath), 'wiring: .github/workflows/pr-automation.yml must exist — it is where the REAL scan runs');
    const prAutomation = uncommented(existsSync(prAutomationPath) ? readFileSync(prAutomationPath, 'utf8') : '');
    assert(
      /run: node scripts\/check-changeset-no-major\.mjs --base "\$MERGE_BASE"\s*$/m.test(prAutomation),
      'wiring: pr-automation.yml must invoke the real scan with `--base "$MERGE_BASE"` — the self-test fixtures replace none of the enforcement, and a scan with no branch point is #7005 restored',
    );
    // FLIPPED by #7005. The predecessor assertion required the BARE invocation
    // (`node scripts/check-changeset-no-major.mjs` with nothing after it); that
    // spelling is the stock-scoped gate, so it is now the thing forbidden.
    // Every `--base` handed to this script, not just the one that exists today:
    // a second call site added later with a pinned sha is #6129 again.
    const bases = [...prAutomation.matchAll(/check-changeset-no-major\.mjs --base (\S+)/g)].map((m) => m[1]);
    assert(bases.length === 1, `wiring: exactly one \`check-changeset-no-major.mjs --base\` call site is expected in the workflow (found ${bases.length})`);
    assert(
      bases.every((b) => b === '"$MERGE_BASE"'),
      `wiring: every \`check-changeset-no-major.mjs --base\` in the workflow must be handed $MERGE_BASE, never a pinned sha (#6129) — got ${JSON.stringify(bases)}`,
    );
    assert(
      !/node scripts\/check-changeset-no-major\.mjs\s*$/m.test(prAutomation),
      'wiring: the BARE `node scripts/check-changeset-no-major.mjs` is forbidden — with no `--base` it defaults to origin/main, which on a stale checkout is the two-dot reading #6129 rules out, and it was the stock-scoped spelling #7005 removed',
    );
    // The step must actually be handed the value it interpolates. `$MERGE_BASE`
    // is a shell variable, so a step that spells it without the `env:` key runs
    // the scan against an empty string and the gate would fail on every PR.
    const majorStep = prAutomation
      .split(/\n(?=      - name: )/)
      .find((s) => /check-changeset-no-major\.mjs --base/.test(s));
    assert(majorStep !== undefined, 'wiring: the step running the real scan could not be sliced out of pr-automation.yml — the assertion below would judge undefined');
    assert(
      /MERGE_BASE:\s*\$\{\{\s*steps\.diffbase\.outputs\.merge_base\s*\}\}/.test(majorStep ?? ''),
      'wiring: that step must set `MERGE_BASE: ${{ steps.diffbase.outputs.merge_base }}` in its own `env:` — `$MERGE_BASE` is a shell variable, and a step that never receives it scans against an empty base',
    );
    assert(
      !/check-changeset-no-major\.mjs/.test(uncommented(lintYaml)),
      'wiring: lint.yml must NOT invoke this script directly — the self-test reaches it through `check:changeset-gate-self-tests`, and a real scan here would bypass the `allow-major` escape hatch its own error message prescribes and have no branch point to judge against',
    );

    // ── The trigger the `not-measured-material` refusal depends on (#16776) ──
    //
    // This is the A-and-B coupling of that card, pinned rather than trusted to
    // prose. The refusal above is cleared by writing `Clause-②: no` (or `yes`
    // plus a level) into the PR BODY. A `pull_request` payload is a snapshot and
    // `rerun_failed_jobs` replays the frozen one, so WITHOUT `edited` in this
    // trigger list the body a author just fixed is never re-read and the red
    // cannot be cleared by any action short of pushing a commit — measured on PR
    // #16342, which took a deliberate `git merge origin/main` after a body edit
    // purely to manufacture a `synchronize`. Removing `edited` therefore does not
    // merely lose a convenience: it turns this gate's own refusal into the
    // permanently-red-by-construction shape #5580 and #6378 exist to remove.
    const triggerTypes = prAutomation.match(/\n\s*types:\s*\[([^\]]*)\]/);
    assert(triggerTypes !== null, 'wiring: pr-automation.yml must name its `pull_request` activity types explicitly — the assertion below would judge nothing');
    const types = (triggerTypes?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    assert(
      types.includes('edited'),
      `wiring: pr-automation.yml must subscribe to \`edited\` — the level axis reads the clause-② declaration out of the PR BODY, and a verdict whose input is the body must re-fire when the body changes or its refusal cannot be cleared without a push (#16776). Got ${JSON.stringify(types)}`,
    );
    assert(
      ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'].every((t) => types.includes(t)),
      `wiring: naming \`types:\` REPLACES GitHub's default set, so the five this job already needed must all still be listed beside \`edited\` — the label carriers are read on \`labeled\`/\`unlabeled\` and the diff on \`opened\`/\`synchronize\`/\`reopened\`. Got ${JSON.stringify(types)}`,
    );

    // The OTHER consumer, and why the refusal above may exit 1 at all: the RC cut
    // runs this same script over a whole snapshot range on a `workflow_dispatch`,
    // where there is no pull request and therefore no declaration to read. It
    // reaches the `no-pull-request` lane BECAUSE it hands over no `--event` and
    // GitHub sets no `pull_request` payload there. A `--event` grown onto that
    // call site, or a second one that is a PR run, would put an RC cut into the
    // lane that can refuse — so the shape is pinned where the refusal lives.
    const cutRcPath = join(REPO_ROOT, '.github/workflows/cut-rc.yml');
    assert(existsSync(cutRcPath), 'wiring: .github/workflows/cut-rc.yml must exist — it is this script\'s other consumer, and the one the level axis must never red');
    const cutRc = uncommented(existsSync(cutRcPath) ? readFileSync(cutRcPath, 'utf8') : '');
    const cutRcCalls = [...cutRc.matchAll(/node scripts\/check-changeset-no-major\.mjs([^\n]*)/g)].map((m) => m[1]);
    assert(
      cutRcCalls.length === 2 && cutRcCalls.some((c) => /^\s*--self-test\s*$/.test(c)),
      `wiring: cut-rc.yml is expected to invoke this script exactly twice — \`--self-test\` then the real scan (found ${cutRcCalls.length}: ${JSON.stringify(cutRcCalls)})`,
    );
    assert(
      cutRcCalls.every((c) => !/--event\b/.test(c)),
      'wiring: no cut-rc.yml call site may pass `--event` — the RC cut is a `workflow_dispatch` with no pull request, and the level axis stands down there by having no declaration carrier at all. Handing it one would put a whole snapshot range into the lane that can refuse (#16776)',
    );
    assert(
      !/pull_request/.test((cutRc.match(/^on:[\s\S]*?\njobs:/m) ?? [''])[0]),
      'wiring: cut-rc.yml must stay off `pull_request` triggers — its `no-pull-request` lane is what keeps the #16776 refusal shippable, and a PR trigger there would make it a PR run with a payload',
    );
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }
  if (failures.length > 0) {
    console.error(`✗ check-changeset-no-major --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-changeset-no-major --self-test: ${checked} assertions ` +
      '(frontmatter dialects measured against @changesets/parse + the pre/exit exemption switch in both directions + the #7005 diff scoping over real temp git repos + the #4690 pins + the LEVEL axis on #16044\'s two real heads + the wiring).',
  );

  return SELF_TEST_VERDICT;
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

/**
 * The guard is INVERTED so the dispatch chain below keeps its indentation:
 * the imported case is the empty first branch, and every mode that was here
 * before is untouched in the `else if` chain.
 *
 * Measured before this landed: importing this module for its exports ran the
 * whole gate inside the importer, and then `main()`'s trailing
 * `process.exit(exitCode)` ended that process mid-import — carrying status 0.
 * The importer never reached the statement after its own `import()`, and a
 * caller reading the status alone cannot tell that apart from a clean import.
 *
 * Nothing imports this file today (every reference in `.github/**`,
 * `package.json` and `scripts/**` spawns it as `node scripts/...`), so the
 * guard silences no census: the only top-level statement it moves behind
 * `isEntrypoint` is CLI dispatch.
 */
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
          '\n✗ check-changeset-no-major self-test: selfTest() returned without reaching its verdict,\n'
              + 'so no success line was printed. Exiting 0 here would report a self-test\n'
              + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
  }
} else if (argv.includes('--list')) {
  list();
} else {
  main(argv);
}
