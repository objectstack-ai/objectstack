#!/usr/bin/env node
/**
 * Launch-window guard: rejects any changeset that declares a `major` bump.
 *
 * Run:  node scripts/check-changeset-no-major.mjs
 *       node scripts/check-changeset-no-major.mjs --self-test   # verify the checker itself
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
 * Exits with code 1 (and a clear list of offenders) if any changeset frontmatter
 * bumps a package `major`.
 *
 * RC EXEMPTION: when Changesets is in pre-release mode (`.changeset/pre.json`
 * with `"mode": "pre"`, entered via `changeset pre enter <tag>`), a `major`
 * bump only ever produces a `X.0.0-<tag>.N` PRE-RELEASE version — nothing final
 * publishes until `changeset pre exit`. Accumulating the next major's breaking
 * changes is precisely what an RC window is FOR, so this guard stands aside for
 * the duration and re-arms automatically once pre-mode is exited. The pending
 * majors are still printed (informationally) so the RC curator can eyeball them.
 *
 * ESCAPE HATCH: outside pre-mode, when a major release is genuinely intended,
 * gate this check off in CI with the `allow-major` PR label (see
 * `.github/workflows/pr-automation.yml`).
 *
 * The script intentionally has zero third-party dependencies so it can run in
 * minimal CI environments before `pnpm install`.
 *
 * ## What `--self-test` covers, and what it does NOT (#6923)
 *
 * Read this before trusting a green tick from this file. The self-test is new;
 * the enforcing half it fixtures is still, on CI, unexecuted.
 *
 *   COVERED — every decision this file makes, driven through the pure `judge()`
 *   on synthetic corpora: the frontmatter dialects, the pre-mode/exit-mode
 *   switch in BOTH directions, the unreadable-`pre.json` fallthrough, and the
 *   rendered text of the offenders report.
 *
 *   NOT COVERED — the CI path. `.changeset/pre.json` says `"mode": "pre"`, so
 *   the real scan below takes the exemption branch and exits 0 on every run;
 *   the `enforce` verdict has never been produced by a CI invocation of this
 *   script and still is not after #6923. What changed is that it is now
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
 * ## RESIDUAL: an unreadable `.changeset/` still exits 0
 *
 * `readChangesets()` returns `null` when the directory cannot be read at all,
 * and `judge()` turns that into `no-changeset-dir` → exit 0. That is the #4690
 * shape — a gate that could not read its input reporting as "no violations" —
 * and it is pinned below as current behaviour, not endorsed. It is recorded
 * rather than fixed here because flipping it is a behaviour change to the
 * enforcing half on the eve of the window where that half re-arms. The refactor
 * does make it *distinguishable*: `no-changeset-dir` (could not read) and
 * `clean` (read, found nothing) are now separate verdicts, which is the
 * prerequisite for changing it. Filed as #7006.
 *
 * ## RESIDUAL: the enforcing half judges the STOCK, not the PR's diff
 *
 * Unrelated to the fixtures, measured by them, and deliberately not changed
 * here. This script reads the whole `.changeset` directory with no branch
 * point, so its verdict is a function of what main carries. At `changeset pre
 * exit` there are 171 major-declaring changesets still on disk (measured at
 * `d3e53f2d8`; pre-mode `changeset version` records them in `pre.json` rather
 * than deleting them), and every unlabelled PR open in the window between that
 * exit and the final `changeset version` would go red listing files it never
 * touched. That is #6129's direction by another route, and what to do about it
 * decides what this guard MEANS — whether it polices the author or the tree —
 * so it is a contract call. Filed as #7005.
 */

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
 * a clean tree in pre-mode prints the ordinary tick, never the RC notice):
 *
 *   no-changeset-dir  the directory could not be read at all      -> exit 0 (see RESIDUAL)
 *   clean             read it, no `major` declared anywhere       -> exit 0
 *   exempt            majors pending, but pre-mode is active      -> exit 0 + notices
 *   enforce           majors pending, pre-mode is NOT active      -> exit 1
 *
 * `pre` is whatever `.changeset/pre.json` parsed to, or `null` when it is
 * absent, unreadable or malformed. All three of those collapse to `enforce`,
 * which is the safe direction: an exemption is a licence to promote every
 * package in the repo to a new major, and handing one out because a file could
 * not be read is the #4690 anti-pattern pointed at the release train.
 *
 * @param {{
 *   changesets: Map< string, string > | null,
 *   pre: { mode?: string, tag?: string } | null,
 * }} input
 * @returns {{ verdict: string, offenders: { file: string, majors: string[] }[], tag: string | null }}
 */
export function judge({ changesets, pre }) {
  if (!changesets) return { verdict: 'no-changeset-dir', offenders: [], tag: null };

  const offenders = [];
  for (const [name, text] of changesets) {
    const majors = majorPackagesIn(text);
    if (majors.length) offenders.push({ file: `.changeset/${name}`, majors });
  }

  if (offenders.length === 0) return { verdict: 'clean', offenders: [], tag: null };
  if (pre?.mode === 'pre') return { verdict: 'exempt', offenders, tag: pre.tag ?? 'unknown' };
  return { verdict: 'enforce', offenders, tag: null };
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
    case 'no-changeset-dir':
      stdout.push('No .changeset directory found — nothing to check.');
      return { exitCode: 0, stdout, stderr };

    case 'clean':
      stdout.push('✓ No `major` bumps in pending changesets.');
      return { exitCode: 0, stdout, stderr };

    // RC exemption: in Changesets pre-release mode a `major` only yields a
    // `X.0.0-<tag>.N` pre-release — the intended product of an RC window — and
    // nothing final ships until `changeset pre exit`. Surface the pending majors
    // for the RC curator, but do not fail. The guard re-arms once pre-mode
    // exits: `changeset pre exit` rewrites pre.json's mode to `"exit"`
    // (@changesets/pre@2.0.2, changesets-pre.cjs.js:117), which is not `pre`.
    case 'exempt':
      stdout.push(
        `✓ Changesets is in pre-release mode (tag: ${result.tag}) — ` +
          '`major` bumps are the expected product of an RC window; skipping the no-major guard.',
      );
      for (const { file, majors } of result.offenders) {
        stdout.push(`::notice file=${file}::pending major in ${file}: ${majors.join(', ')}`);
      }
      return { exitCode: 0, stdout, stderr };

    case 'enforce':
      stderr.push('⛔ Changeset(s) declare a `major` bump.\n');
      for (const { file, majors } of result.offenders) {
        stderr.push(`   ${file}`);
        for (const pkg of majors) stderr.push(`     - ${pkg}: major`);
      }
      stderr.push(
        '\nEvery publishable package is in the Changesets `fixed` (lockstep) group, so a single\n' +
          '`major` promotes the ENTIRE monorepo to a new major version. During the launch window\n' +
          'ship breaking changes as `minor` instead (they do not burn a major version number).\n' +
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
 * `null` — never an empty Map — when the directory cannot be read, so the two
 * facts stay distinguishable downstream. `README.md` is documentation, never a
 * changeset.
 *
 * An individual file that cannot be read is deliberately NOT caught: it throws,
 * which is loud. Swallowing it would drop a changeset from the scan and report
 * the remainder as a pass.
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

// ── The scan ─────────────────────────────────────────────────────────────────

function main() {
  const result = judge({ changesets: readChangesets(REPO_ROOT), pre: readPre(REPO_ROOT) });
  const { exitCode, stdout, stderr } = render(result);
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

  /** A corpus of changesets, as `judge` wants it. */
  const corpus = (files) => new Map(Object.entries(files));

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
  // it directly.
  const pending = corpus({ 'a.md': MAJOR, 'b.md': MINOR });

  const exempt = judge({ changesets: pending, pre: { mode: 'pre', tag: 'rc' } });
  assert(exempt.verdict === 'exempt', `pre-mode with a pending major ⇒ exempt — got ${exempt.verdict}`);
  assert(exempt.offenders.length === 1 && exempt.offenders[0].file === '.changeset/a.md', 'the exempt verdict still names the offender, so the RC curator can see it');
  assert(render(exempt).exitCode === 0, 'pre-mode exits 0');
  assert(
    render(exempt).stdout.some((l) => l.includes('pre-release mode (tag: rc)')) &&
      render(exempt).stdout.some((l) => l === '::notice file=.changeset/a.md::pending major in .changeset/a.md: @objectstack/spec'),
    'pre-mode prints the RC notice AND one ::notice per offender',
  );
  assert(render(exempt).stderr.length === 0, 'pre-mode writes nothing to stderr — it is not a complaint');
  assert(judge({ changesets: pending, pre: { mode: 'pre' } }).tag === 'unknown', 'a pre.json with no tag reports the tag as `unknown` rather than `undefined`');

  // THE ENFORCING HALF. `changeset pre exit` rewrites mode to `"exit"`
  // (@changesets/pre@2.0.2), so this exact input is the shape of the first run
  // after the window closes.
  const enforced = judge({ changesets: pending, pre: { mode: 'exit' } });
  assert(enforced.verdict === 'enforce', `mode "exit" with a pending major ⇒ enforce — got ${enforced.verdict}`);
  assert(render(enforced).exitCode === 1, 'the enforcing half exits 1 — the whole point of the guard, and unreached on CI while the repo is in pre-mode');
  assert(
    render(enforced).stderr.some((l) => l.includes('⛔ Changeset(s) declare a `major` bump.')) &&
      render(enforced).stderr.includes('   .changeset/a.md') &&
      render(enforced).stderr.includes('     - @objectstack/spec: major'),
    'the offenders report names every offending file and every package in it',
  );
  assert(
    render(enforced).stderr.some((l) => l.includes('allow-major')),
    'the offenders report names the `allow-major` escape hatch — a red with no route out is a wall, not a gate',
  );
  assert(
    !render(enforced).stderr.some((l) => l.includes('.changeset/b.md')),
    'a `minor`-only changeset is not listed as an offender',
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
    assert(judge({ changesets: pending, pre }).verdict === 'enforce', `${label} ⇒ enforce, never an exemption`);
  }

  // ── Order of operations is contract ───────────────────────────────────────
  const cleanInPre = judge({ changesets: corpus({ 'a.md': MINOR }), pre: { mode: 'pre', tag: 'rc' } });
  assert(cleanInPre.verdict === 'clean', 'no majors in pre-mode ⇒ the ordinary tick, not the RC notice');
  assert(
    render(cleanInPre).stdout.length === 1 && render(cleanInPre).stdout[0] === '✓ No `major` bumps in pending changesets.',
    'a clean tree prints exactly one line and never mentions the RC window',
  );
  assert(judge({ changesets: corpus({ 'a.md': MINOR }), pre: { mode: 'exit' } }).verdict === 'clean', 'no majors outside pre-mode ⇒ clean');
  assert(judge({ changesets: corpus({}), pre: null }).verdict === 'clean', 'an empty .changeset directory ⇒ clean (read it, found nothing)');

  // ── Missing input is distinguishable from empty input (#4690) ─────────────
  const unreadable = judge({ changesets: null, pre: { mode: 'exit' } });
  assert(unreadable.verdict === 'no-changeset-dir', 'a directory that could not be read is its OWN verdict, not `clean`');
  assert(
    render(unreadable).exitCode === 0,
    'RESIDUAL pinned, not endorsed: an unreadable .changeset still exits 0 (#4690 shape). Filed as #7006 — flip this assertion together with the behaviour, never alone',
  );
  assert(render({ verdict: 'something-new' }).exitCode === 1, 'an unknown verdict exits 1 — a guard that cannot classify itself prints no tick');
  assert(render(undefined).exitCode === 1, 'no verdict at all exits 1');

  // ── The readers actually reach the real tree ──────────────────────────────
  // The phantom-pass risk specific to THIS script: `readChangesets` resolves
  // `.changeset` from the script's own location, and if that resolution ever
  // broke, every run would return `no-changeset-dir` and print a tick forever.
  {
    const real = readChangesets(REPO_ROOT);
    assert(real instanceof Map, 'reader: the real .changeset directory is reachable from this script (a null here is a permanent silent pass)');
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
    writeFileSync(join(empty, '.changeset', 'x.md'), MAJOR);
    writeFileSync(join(empty, '.changeset', 'README.md'), MAJOR);
    const scanned = readChangesets(empty);
    assert(scanned.size === 1 && scanned.has('x.md'), 'reader: end to end, a real directory yields exactly its changesets');
    assert(judge({ changesets: scanned, pre: readPre(empty) }).verdict === 'exempt', 'end to end: a real directory + a real pre.json reach the exemption');
    writeFileSync(join(empty, '.changeset', 'pre.json'), '{"mode":"exit"}');
    assert(judge({ changesets: readChangesets(empty), pre: readPre(empty) }).verdict === 'enforce', 'end to end: the same directory with mode "exit" reaches the enforcing half');
  } finally {
    rmSync(empty, { recursive: true, force: true });
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
  //     `skip-changeset` exemptions are deliberate. Moving the real scan into
  //     lint.yml would silently revoke the escape hatch the offenders report
  //     tells authors to use.
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
      'wiring: `check:changeset-gate-self-tests` must invoke this file ONLY with `--self-test` — the real scan belongs in pr-automation.yml, where its `allow-major` exemption is',
    );

    // The real scan's home. If this moves or vanishes, the guard stops guarding
    // and nothing else in the repo would say so.
    const prAutomationPath = join(REPO_ROOT, '.github/workflows/pr-automation.yml');
    assert(existsSync(prAutomationPath), 'wiring: .github/workflows/pr-automation.yml must exist — it is where the REAL scan runs');
    const prAutomation = uncommented(existsSync(prAutomationPath) ? readFileSync(prAutomationPath, 'utf8') : '');
    assert(
      /run: node scripts\/check-changeset-no-major\.mjs\s*$/m.test(prAutomation),
      'wiring: pr-automation.yml must still invoke the real scan (`node scripts/check-changeset-no-major.mjs`) — the self-test fixtures replace none of the enforcement',
    );
    assert(
      !/check-changeset-no-major\.mjs/.test(uncommented(lintYaml)),
      'wiring: lint.yml must NOT invoke this script directly — the self-test reaches it through `check:changeset-gate-self-tests`, and a real scan here would bypass the `allow-major` escape hatch its own error message prescribes',
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check-changeset-no-major --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-changeset-no-major --self-test: ${checked} assertions ` +
      '(frontmatter dialects measured against @changesets/parse + the pre/exit exemption switch in both directions + the #4690 reader pins + the wiring).',
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
