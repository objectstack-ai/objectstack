#!/usr/bin/env node
/**
 * Launch-window guard: a PR may not INTRODUCE a changeset that declares a
 * `major` bump.
 *
 * Run:  node scripts/check-changeset-no-major.mjs --base <ref-or-sha> [--head <ref>]
 *       node scripts/check-changeset-no-major.mjs              # base defaults to origin/main
 *       node scripts/check-changeset-no-major.mjs --self-test  # verify the checker itself
 *       node scripts/check-changeset-no-major.mjs --list       # audit the whole .changeset dir
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
 * urgent is that the window ENDS. Measured on `origin/main` @ `d3e53f2d8`, with
 * `pre.json` still at `"mode": "pre"`:
 *
 *   total .changeset/*.md (excl README):  1552
 *   FILES declaring a major:               171
 *   total major package entries:           222
 *   pre.changesets recorded:              1279
 *
 * Those files are on disk because pre-mode `changeset version` does not delete
 * the changesets it consumes — it records them in `pre.json.changesets` so the
 * final release can re-apply them. Only the POST-EXIT `changeset version`
 * deletes them. So `changeset pre exit` rewrites the mode to `"exit"`
 * (@changesets/pre@2.0.2, `changesets-pre.cjs.js:117`), that commit lands on
 * main, and from that moment until the Version PR merges, the stock-scoped guard
 * would have failed EVERY unlabelled PR in the repo — each one listing 171 files
 * it never touched, with `allow-major` as the only route out. That label's own
 * error message says "a whole-stack major release is genuinely intended", which
 * is false for a PR fixing a typo, so the escape hatch would have meant
 * something different from what it says for the duration of the window.
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
 * `R` is where this file diverges from its two siblings by one letter:
 * `check-empty-changeset.mjs` and `check-adr-0087-registration.mjs` both use
 * `--diff-filter=AM`. Measured on git 2.43.0, renaming `.changeset/old.md` to
 * `.changeset/new.md` while flipping its bump to `major` reports as
 * `R075 .changeset/old.md .changeset/new.md` and is dropped entirely by `AM` —
 * a silent bypass. `AMR` plus reading the base side at the OLD path closes it
 * and costs nothing, because a pure rename compares equal and stays exempt. The
 * two siblings have the same hole in their own directions; filed separately
 * rather than fixed here, because their fixtures and messages are theirs.
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
 * ## What `--self-test` covers, and what it does NOT (#6923, still true)
 *
 * Read this before trusting a green tick from this file. The enforcing half it
 * fixtures is still, on CI, unexecuted — and #7005 did not change that.
 *
 *   COVERED — every decision this file makes: the frontmatter dialects, the
 *   pre-mode/exit-mode switch in BOTH directions, the diff scoping driven
 *   through real temp git repositories (including a real `refs/pull/N/merge`
 *   shape with a base branch that keeps moving), and the rendered text of the
 *   offenders report.
 *
 *   NOT COVERED — the CI path. `.changeset/pre.json` says `"mode": "pre"`, so
 *   the real scan below still takes the exemption branch and exits 0 on every
 *   run; the `enforce` verdict has never been produced by a CI invocation of
 *   this script and still is not after #7005. What #6923 changed is that it is
 *   produced by fixtures on every PR, in a job with no label exemption
 *   (`check:changeset-gate-self-tests`, lint.yml's ESLint job — #6509/PR #6917).
 *   Fixtured is not the same as executed, and this note exists so the next
 *   reader does not read one as the other.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Frontmatter ──────────────────────────────────────────────────────────────

/**
 * Extract the YAML frontmatter block (between the first two `---` fences) and
 * return the list of `major`-bumped package names declared in it.
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
 * @param {string} text
 * @returns {string[]}
 */
export function majorPackagesIn(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines
  if (lines[i]?.trim() !== '---') return [];

  const majors = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') break; // end of frontmatter
    if (/^\s*#/.test(lines[j])) continue; // a whole-line YAML comment declares nothing
    // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
    // with an optionally quoted bump value and an optional trailing ` # comment`.
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?(?:\s+#.*)?\s*$/.exec(lines[j]);
    if (m && m[2].toLowerCase() === 'major') majors.push(m[1].trim());
  }
  return majors;
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
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{ introduced: { file: string, majors: string[] }[], exempt: string[], base: string }}
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
    const majors = majorPackagesIn(headText);
    if (majors.length === 0) continue;

    // `A` means the path is not at the branch point at all, so there is nothing
    // to read and nothing it could already have declared.
    const baseText = status === 'A' ? null : showOrNull(from, basePath, cwd);
    const already = baseText === null ? [] : majorPackagesIn(baseText);
    // Per PACKAGE, not per file: adding a second `major` entry to a changeset
    // that already declared one is still introducing that second one.
    const added = majors.filter((pkg) => !already.includes(pkg));

    if (added.length) introduced.push({ file, majors: added });
    else exempt.push(file);
  }

  return { introduced, exempt, base: from };
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
    // (@changesets/pre@2.0.2, changesets-pre.cjs.js:117), which is not `pre`.
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
  process.exit(exitCode);
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
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
  caught('a leading blank line before the fence', '\n' + MAJOR, ['@objectstack/spec']);
  caught('two leading blank lines', '\n\n' + MAJOR, ['@objectstack/spec']);
  caught('a leading blank line, single-quoted', "\n---\n'@objectstack/spec': major\n---\n\nbody\n", ['@objectstack/spec']);

  // ── What must NOT be caught, each paired with its control ─────────────────
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
  const cleanInPre = judge({ introduced: [], pre: { mode: 'pre', tag: 'rc' } });
  assert(cleanInPre.verdict === 'clean', 'a diff introducing no major, in pre-mode ⇒ the ordinary tick, not the RC notice');
  assert(
    render(cleanInPre).stdout.length === 1 && render(cleanInPre).stdout[0] === '✓ This diff introduces no `major` bump.',
    'a clean diff prints exactly one line and never mentions the RC window',
  );
  assert(judge({ introduced: [], pre: { mode: 'exit' } }).verdict === 'clean', 'a diff introducing no major, outside pre-mode ⇒ clean');

  // ── #7005 ITSELF, stated as one assertion against the REAL stock ──────────
  //
  // The card's acceptance criterion, driven on the actual pending directory
  // rather than on a synthetic stand-in for it: with N major-declaring
  // changesets really on disk and pre-mode really exited, a PR that introduces
  // none of them is CLEAN. Before #7005 this exact input was `enforce` and every
  // unlabelled PR in the repo went red listing all N.
  //
  // The control is what keeps it from being vacuous — if the stock ever stops
  // containing a major, the assertion below would pass for the wrong reason, so
  // the count is asserted non-zero first and named in the message.
  {
    const realStock = readChangesets(REPO_ROOT);
    assert(realStock instanceof Map, 'reader: the real .changeset directory is reachable from this script (it is what `--list` audits)');
    const stockMajors = [...(realStock ?? new Map()).entries()].filter(([, text]) => majorPackagesIn(text).length > 0);
    assert(
      stockMajors.length > 0,
      'control (#7005): the real .changeset stock must actually contain major-declaring changesets, or the assertion below is green for the wrong reason',
    );
    assert(
      judge({ introduced: [], pre: { mode: 'exit' } }).verdict === 'clean',
      `#7005: ${stockMajors.length} major-declaring changeset(s) are pending on disk and pre-mode is exited, and a PR that introduces none of them is still CLEAN — stock-scoped, this was \`enforce\` for every unlabelled PR in the repo`,
    );
    // And the other direction, so the pair cannot both be satisfied by a gate
    // that simply stopped enforcing: one introduced major, same stock, is red.
    assert(
      judge({ introduced: [{ file: '.changeset/mine.md', majors: ['@objectstack/spec'] }], pre: { mode: 'exit' } }).verdict === 'enforce',
      '#7005 control: the same exited pre-mode with ONE introduced major is still `enforce` — the fix narrows the gate, it does not disarm it',
    );
    const only = render(judge({ introduced: [{ file: '.changeset/mine.md', majors: ['@objectstack/spec'] }], pre: { mode: 'exit' } }));
    assert(
      only.stderr.includes('   .changeset/mine.md') && !only.stderr.some((l) => stockMajors.some(([name]) => l.includes(name))),
      '#7005: the report names ONLY the changeset this diff introduced, never one of the pending stock files',
    );
  }

  // ── Missing input is a failure, never a pass (#4690 / #7006) ──────────────
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
  {
    const real = readChangesets(REPO_ROOT);
    assert(real !== null && real.size > 0, `reader: the real .changeset directory is non-empty — got ${real === null ? 'null' : real.size} entries`);
    assert(real !== null && !real.has('README.md'), 'reader: .changeset/README.md is documentation, never a changeset');
    assert(existsSync(join(REPO_ROOT, '.changeset', 'README.md')), 'reader: control — that README really exists, so the exclusion above is exercised rather than vacuous');
    assert(real !== null && [...real.keys()].every((k) => k.endsWith('.md')), 'reader: only .md files are read (pre.json and config.json are not changesets)');
    const realPre = readPre(REPO_ROOT);
    assert(realPre !== null && typeof realPre === 'object', 'reader: the real .changeset/pre.json is readable and parses');
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
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  // ── The diff scoping, on real temp git repositories ───────────────────────
  //
  // The sibling's convention (`check-empty-changeset.mjs`), for the sibling's
  // reason: this gate's whole subject is now a diff between two commits, so a
  // fixture that is not two real commits would be testing an imitation of the
  // code path that ships.

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
    // dropped entirely by the two siblings' `--diff-filter=AM`.
    {
      const long = '\n\nbody long enough for git to score this as a rename rather than an add plus a delete\n';
      const oldMinor = '---\n"@objectstack/spec": minor\n---' + long;
      const newMajor = '---\n"@objectstack/spec": major\n---' + long;
      const { dir, base } = makeRepo({ '.changeset/old.md': oldMinor }, { '.changeset/old.md': null, '.changeset/new.md': newMajor });
      const raw = git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir);
      assert(
        /^R\d/.test(raw.trim()),
        `control: git must really report this as a rename, or the row below is about an ordinary add — got ${JSON.stringify(raw.trim())}`,
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
  }

  if (failures.length > 0) {
    console.error(`✗ check-changeset-no-major --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-changeset-no-major --self-test: ${checked} assertions ` +
      '(frontmatter dialects measured against @changesets/parse + the pre/exit exemption switch in both directions + the #7005 diff scoping over real temp git repos + the #4690 pins + the wiring).',
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  selfTest();
} else if (argv.includes('--list')) {
  list();
} else {
  main(argv);
}
