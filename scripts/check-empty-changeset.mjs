#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-empty-changeset -- a PR may not ADD an empty-frontmatter changeset.
//
//   node scripts/check-empty-changeset.mjs --base <ref-or-sha> [--head <ref>]
//   node scripts/check-empty-changeset.mjs              # base defaults to origin/main
//   node scripts/check-empty-changeset.mjs --self-test  # verify the checker itself
//   node scripts/check-empty-changeset.mjs --list       # audit the whole .changeset dir
//
// `--base` names the BRANCH POINT to judge against, not the first commit of the
// diff: the scan always starts at `merge-base(<base>, <head>)`. See "Where the
// diff starts" below -- getting this wrong is #6129, and it is worth reading.
//
// ## The rule (#5471)
//
// An empty-frontmatter changeset -- a `.changeset/*.md` whose frontmatter block
// declares no `"<package>": <bump>` entry at all -- is REJECTED when a PR newly
// introduces one. Everything already on the base commit is exempt, forever and
// without a list; see "The exemption" below.
//
// ## Why (measured, not argued)
//
// #5471 took three empty changesets that `changeset version` had already
// CONSUMED (`adr-0044-revise-service-owned-note`, `ci-node-22-pin`,
// `duplicate-fix-guard`) and grepped a sentence of each body across every
// CHANGELOG.md in the repo: 0 hits each. A non-empty control changeset's first
// sentence hit 2 (packages/spec, packages/cli). The mechanism is plain -- an
// empty frontmatter names no package, a summary is attached to a RELEASE, and
// zero releases means zero attachment points -- but the point is that it was
// measured rather than assumed.
//
// So against the `skip-changeset` label the ledger is entirely one-directional:
//
//                                      | label | empty changeset
//   satisfies the Check Changeset gate |  yes  |  yes
//   produces a CHANGELOG entry         |  no   |  no    (measured)
//   is an input to changesets/action   |  NO   |  YES
//   can trigger #4898                  |  no   |  YES
//
// The last row is the whole case. An empty changeset is a REAL INPUT to
// changesets/action: when every pending changeset is empty the action takes its
// `hasChangesets && !hasNonEmptyChangesets` branch, prints "All changesets are
// empty; not creating PR" and returns in 0 seconds -- no version PR, no publish,
// and the Release run still goes GREEN. That is #4898, which silently stalled
// 17.0.0-rc.2. The label cannot do that, because it produces no input at all.
//
// An empty changeset therefore buys nothing the label does not, and uniquely
// carries the risk. #5292 / PR #5467 responded by rewriting the PRESCRIPTION to
// call it a LAST RESORT; the prose did not hold. Empty files kept accruing at
// roughly ten a day after that text merged, and the `skills/**` precedent chain
// (#4607 / #5130 / #5451 -> PR #5799, `77adf297f`, landed a day AFTER the
// downgrade) kept copying the downgraded route out of `git log`, where the
// prescription is not visible. #5947 is that self-replicating author-side trap.
// This gate closes it mechanically instead of asking authors to read a comment.
//
// ## The exemption: computed from the diff, never from a list
//
// The base commit's empty changesets are exempt because the gate never looks at
// them -- it judges only what the PR's own diff introduces. That is deliberately
// NOT a hardcoded roster: the ruling on #5471 exempts the whole existing stock
// (182 files at `efedd289f`, measured; the issue body's 172 was two days older),
// and a roster of 182 names would be a high-water mark that rots on the first
// merge. "Absent-or-non-empty at base" is the same statement with no maintenance.
//
// Three diff statuses are judged, and everything after the first row is why the
// rule is phrased about the SET of empty declarations rather than about added
// files ("at base" below always means at the MERGE BASE, see the next section):
//
//   A  added, empty at head                       -> violation (a new empty file)
//   M  empty at head, NON-empty at base           -> violation (emptied in place)
//   M  empty at head, already empty at base       -> exempt    (stock, untouched)
//   R  empty at head, NON-empty at the OLD path   -> violation (renamed and emptied)
//   R  empty at head, already empty at that path  -> exempt    (stock, moved)
//   R  empty at head, OLD path is README.md       -> violation (not inherited from
//                                                   documentation; see the scan)
//   *  non-empty at head                          -> ok
//
// Row 2 costs a few lines and removes the obvious bypass: taking a stock
// non-empty changeset and deleting its frontmatter entries produces a brand-new
// empty declaration -- exactly the harm -- while `--diff-filter=A` alone sees
// nothing. Row 3 is what keeps the stock exempt even when a PR edits an existing
// empty file's prose, which is a legitimate thing to do and releases nothing new.
//
// Rows 4 and 5 are that same argument one status letter along (#7045). Git's
// rename detection is on by default (`diff.renames`, since git 2.9), so emptying
// a stock changeset and `git mv`-ing it in one commit is reported as `R`, and
// `--diff-filter=AM` -- what this file passed until #7045 -- DROPPED that row
// entirely. The gate never saw the file, so row 2's bypass simply reopened under
// a different letter. Measured on git 2.43.0, renaming `.changeset/old.md` to
// `.changeset/new.md` while emptying its frontmatter reports
//
//   R077<TAB>.changeset/old.md<TAB>.changeset/new.md
//
// and the same diff under `--diff-filter=AM` prints nothing at all. `AMR`, plus
// reading the base side at the OLD path (field 2 of an `R` row, not field 3),
// closes it and costs nothing: row 5 leaves a PURE move of a stock empty changeset
// exempt, so nobody goes red for tidying a filename. `check-changeset-no-major.mjs`
// made the identical one-letter correction first, off the same measurement
// (#7005 / PR #7048); this file and `check-adr-0087-registration.mjs` followed in
// #7045 because each of the three owns its own fixtures and its own messages.
//
// ## Where the diff starts (#6129)
//
// "What the PR introduces" is a claim about ONE SIDE of a fork, so the scan
// starts at `merge-base(base, head)` and never at `base` itself. Two things go
// wrong when it starts at `base`, and they were measured in temp repos rather
// than reasoned about:
//
//   - Fed a FROZEN commit (CI used to hand this script
//     `github.event.pull_request.base.sha`, pinned when the PR was opened),
//     every changeset main gained while the PR sat open reads as `A` -- added by
//     this PR. A merged PR's empty changeset then goes red against an author who
//     never touched the file. Note the merge base does NOT rescue that spelling:
//     a frozen base.sha is already an ANCESTOR of head, so it IS its own merge
//     base. The caller has to stop pinning; that is the workflow's half of #6129.
//   - Fed a moving BRANCH (`origin/main`, this script's own default), a two-dot
//     diff misreads DELETIONS on the base branch as additions on this one. The
//     live trigger is queued: `changeset pre exit` deletes every consumed
//     changeset from main, and the next `pnpm check:empty-changeset` on any
//     branch that has not rebased then reports all ~182 stock empties as brand
//     new. Measured on a temp repo: 2 fixtures deleted on main -> 2 violations
//     two-dot, 0 from the merge base.
//
// One rule covers both, and it is idempotent: `merge-base(X, head)` is `X` again
// whenever `X` is already the branch point, so a caller that hands over an
// exact merge base loses nothing by this.
//
// ## Missing input is a failure, never a pass (#4690)
//
// An unresolvable base ref exits 1 rather than 0. So does a base with no merge
// base against head at all (unrelated histories) -- it is the same fact one step
// later, and falling back to the raw base there would quietly restore the bug
// above. A gate that cannot read its input has verified nothing, and exiting 0
// there is the #4690 anti-pattern -- a check that skips silently and reads as
// "no violations" in every checks list.
//
// Zero third-party dependencies, so it can run in a minimal CI environment.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Frontmatter ──────────────────────────────────────────────────────────────

/**
 * The bump entries declared in a changeset's YAML frontmatter.
 *
 * The entry regex is deliberately the SAME shape `check-changeset-no-major.mjs`,
 * `check-adr-0087-registration.mjs` and `objectui-changeset-digest.mjs` use.
 * Four readers of the same block must agree on what counts as a declaration, or
 * one of them is judging a different file than it appears to. That agreement is
 * asserted mechanically in this file's self-test (see "the family reads one
 * block one way"), not merely claimed here (#7004).
 *
 * A file with no opening `---` fence declares nothing either, and is reported as
 * its own kind so the message can say which of the two shapes it is.
 *
 * ## Why a comment-bearing entry is this gate's FALSE-RED half (#7004)
 *
 * The regex used to end `([A-Za-z]+)\s*$`, which accepts nothing after the bump
 * word. So `"@objectstack/spec": major # keep` — a real major to
 * @changesets/parse@0.4.3 — declared nothing here, and a PR that added a
 * perfectly valid changeset was rejected as empty-frontmatter under #5471. Same
 * anchor, same miss, for a QUOTED bump value (`: "major"`).
 *
 * The opposite direction was this gate's FALSE-GREEN half, and it is the one
 * that mattered more: a whole-line comment containing a colon (`# note: major`)
 * is entry-shaped, so a frontmatter block holding only comments parsed as a
 * declaration of a package named `# note` — i.e. as NON-empty. That is exactly
 * the #4898 input this gate exists to refuse.
 *
 * @param {string} text
 * @returns {{ fenced: boolean, packages: string[] }}
 */
export function declaredBumpsIn(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines
  if (lines[i]?.trim() !== '---') return { fenced: false, packages: [] };

  const packages = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') break; // end of frontmatter
    if (/^\s*#/.test(lines[j])) continue; // a whole-line YAML comment declares nothing
    // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
    // with an optionally quoted bump value and an optional trailing ` # comment`.
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?(?:\s+#.*)?\s*$/.exec(lines[j]);
    if (m) packages.push(m[1].trim());
  }
  return { fenced: true, packages };
}

/** @param {string} text */
const isEmptyDeclaration = (text) => declaredBumpsIn(text).packages.length === 0;

/** `.changeset/README.md` is documentation, never a changeset. */
const isChangesetFile = (p) => p.startsWith('.changeset/') && p.endsWith('.md') && !p.endsWith('/README.md');

// ── git helpers ──────────────────────────────────────────────────────────────

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** File contents at a rev, or `null` when the path does not exist there. */
function showOrNull(rev, path, cwd) {
  try {
    return git(['show', `${rev}:${path}`], cwd);
  } catch {
    return null;
  }
}

/** Resolve a ref to a commit sha, or `null`. */
function resolveCommit(ref, cwd) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The commit the diff actually starts at: the merge base of `base` and `head`.
 * `null` when the two have no common ancestor -- the caller fails on that rather
 * than falling back to `base`, see "Where the diff starts" (#6129).
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
 * Judge the changesets this diff introduces.
 *
 * `base` is the branch point to judge against; the diff itself starts at
 * `merge-base(base, head)`, which is what makes the verdict a function of THIS
 * side of the fork alone (#6129). Resolving it HERE rather than in the caller is
 * deliberate: this is the function the self-test drives, and a correction that
 * lived in the CLI could be dropped from it without a single fixture noticing.
 *
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{ violations: {file: string, kind: string, from?: string}[], exempt: string[], ok: string[], base: string }}
 * @throws when `base` and `head` have no merge base (#4690: not a pass)
 */
export function scan({ cwd, base, head = 'HEAD' }) {
  const from = mergeBase(base, head, cwd);
  if (!from) {
    throw new Error(
      `no merge base between '${base}' and '${head}' -- the diff has no trustworthy starting point. ` +
        'Refusing to fall back to the raw base, which is the #6129 defect.',
    );
  }
  // `AMR`, not `AM`: an `R` row is where the row-2 bypass reappears under another
  // status letter -- see "Three diff statuses are judged" in the header (#7045).
  const out = git(['diff', '--name-status', '--diff-filter=AMR', from, head, '--', '.changeset/*.md'], cwd);

  const violations = [];
  const exempt = [];
  const ok = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    // `R` is `R<score>\t<old path>\t<new path>`; `A` and `M` are `<status>\t<path>`.
    // The status is read one character wide because the `R` letter carries a
    // similarity score, so `=== 'R'` on the whole field would never match.
    const status = fields[0][0];
    const file = status === 'R' ? fields[2] : fields[1];
    // Where the branch-point side is READ. For `A` the path is not there at all
    // and `showOrNull` answers null, which is the right answer; for `R` it is the
    // PRE-RENAME name, which is the whole reason an `R` row can be judged.
    const basePath = fields[1];
    if (!file || !isChangesetFile(file)) continue;

    const headText = showOrNull(head, file, cwd);
    if (headText === null) continue; // vanished under us; nothing to judge
    if (!isEmptyDeclaration(headText)) {
      ok.push(file);
      continue;
    }

    if (status === 'A') {
      violations.push({ file, kind: declaredBumpsIn(headText).fenced ? 'added-empty' : 'added-unfenced' });
      continue;
    }

    // Modified, or renamed. Exempt only if it was ALREADY an empty declaration at
    // the branch point -- i.e. this PR did not create the empty declaration, it
    // inherited it. `basePath` is what makes that read survive a rename: for `M`
    // it is the same path, for `R` it is the pre-rename one.
    //
    // ...and it is read ONLY when that path was itself a changeset. Git pairs
    // renames by CONTENT, not by name, so an `R` row can legitimately arrive as
    // `.changeset/README.md -> .changeset/anything.md` (measured, git 2.43.0).
    // README is documentation and declares nothing by definition; inheriting
    // "already empty at base" from it would hand out the exemption for free, on
    // a head file that really is a brand-new empty changeset. For `M` this guard
    // is a no-op, because `basePath` is the path already accepted above.
    const baseText = isChangesetFile(basePath) ? showOrNull(from, basePath, cwd) : null;
    if (baseText !== null && isEmptyDeclaration(baseText)) exempt.push(file);
    else if (status === 'R') violations.push({ file, kind: 'renamed-empty', from: basePath });
    else violations.push({ file, kind: 'emptied' });
  }

  return { violations, exempt, ok, base: from };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const KIND_NOTE = {
  'added-empty': 'new file, empty frontmatter -- declares no package',
  'added-unfenced': 'new file, no frontmatter block at all -- declares no package',
  emptied: 'existing changeset emptied by this PR -- declares no package any more',
  // #7045. Named apart from `emptied` because the head path is BRAND NEW: telling
  // an author "existing changeset emptied" while pointing at a filename that does
  // not exist at the branch point sends them looking for the wrong history. The
  // note stops at what is true for every `R` row -- what stood at the OLD path is
  // named separately, because it is not always a changeset (see the scan).
  'renamed-empty': 'renamed into this path, and empty here -- declares no package',
};

function report(violations) {
  console.error('This PR adds an empty-frontmatter changeset:\n');
  for (const { file, kind, from } of violations) {
    console.error(`   ${file}\n     ${KIND_NOTE[kind]}${from ? `\n     (the branch-point path is ${from} -- read the diff there)` : ''}`);
  }
  console.error(
    [
      '',
      'An empty-frontmatter changeset names no package, so its body reaches no CHANGELOG',
      "and it buys nothing the 'skip-changeset' label does not. What it does buy is a risk",
      'the label cannot carry: it is a REAL INPUT to changesets/action, and when every',
      'pending changeset is empty the action takes its "hasChangesets && !hasNonEmptyChangesets"',
      'branch, prints "All changesets are empty; not creating PR" and returns in 0 seconds --',
      'no version PR, no publish, and the Release run still goes GREEN. That is #4898, which',
      'silently stalled 17.0.0-rc.2.',
      '',
      'Pick by what this PR actually releases:',
      '',
      '  * It releases nothing (.github/, .claude/, skills/, docs/, content/, examples/,',
      '    tests-only, and the like)',
      "    -> delete the changeset and apply the 'skip-changeset' label (route 2). The label",
      '       is a gate-level exemption: it produces NO input for changesets/action.',
      '',
      '  * It releases something',
      "    -> name the packages in the frontmatter ('pnpm changeset').",
      '',
      'The empty changesets already on the base commit are EXEMPT and must not be cleaned up',
      'here -- this gate judges only what a PR newly introduces (#5471).',
    ].join('\n'),
  );
  for (const { file } of violations) {
    console.error(
      `::error file=${file}::${file} is an empty-frontmatter changeset. If this PR releases nothing, delete it and apply the 'skip-changeset' label instead; an empty changeset is a real input to changesets/action and an all-empty set stalls the release silently and greenly (#4898).`,
    );
  }
}

/** `--list`: the whole `.changeset` directory, empty vs declaring. */
function list() {
  const dir = join(REPO_ROOT, '.changeset');
  if (!existsSync(dir)) {
    console.log('No .changeset directory found.');
    return;
  }
  let empty = 0;
  let declaring = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!isChangesetFile(`.changeset/${name}`)) continue;
    const { packages } = declaredBumpsIn(readFileSync(join(dir, name), 'utf8'));
    if (packages.length === 0) {
      empty++;
      console.log(`EMPTY      .changeset/${name}`);
    } else {
      declaring++;
      console.log(`declares   .changeset/${name}  (${packages.join(', ')})`);
    }
  }
  console.log(`\n${empty + declaring} changeset(s): ${empty} empty-frontmatter, ${declaring} declaring.`);
  console.log('All of the above are EXEMPT for any PR that does not touch them -- this gate judges diffs, not stock.');
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Real temp git repositories driven through the SAME exported scan(), the
// check-nul-bytes.mjs convention. The gate's whole subject is a diff between two
// commits, so a fixture that is not two real commits would be testing an
// imitation of the code path that ships.

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  const EMPTY = '---\n---\n\ndocs(skills): tidy the published skill\n';
  const DECLARING = '---\n"@objectstack/spec": minor\n---\n\nfeat(spec): add a field\n';

  const repos = [];
  /**
   * @param {Record<string,string>} baseFiles files committed as the base
   * @param {Record<string,string|null>} headFiles head changes (null = delete)
   */
  const makeRepo = (baseFiles, headFiles) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-empty-changeset-'));
    repos.push(dir);
    const write = (rel, contents) => {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'selftest@example.invalid'], dir);
    git(['config', 'user.name', 'self test'], dir);
    git(['config', 'commit.gpgsign', 'false'], dir);
    for (const [rel, contents] of Object.entries(baseFiles)) write(rel, contents);
    git(['add', '-A'], dir);
    // `--allow-empty`: two fixtures below start from an empty base on purpose
    // (the PR's changeset is the repo's first file), and a base commit that
    // refused to exist would make those cases untestable rather than green.
    git(['commit', '-q', '-m', 'base', '--allow-empty', '--no-gpg-sign'], dir);
    const base = git(['rev-parse', 'HEAD'], dir).trim();
    for (const [rel, contents] of Object.entries(headFiles)) {
      if (contents === null) rmSync(join(dir, rel));
      else write(rel, contents);
    }
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'head', '--no-gpg-sign'], dir);
    return { dir, base };
  };

  /**
   * The CI shape, built for real (#6129): a base branch that KEEPS MOVING after
   * the PR forks off it, and the `refs/pull/N/merge` commit GitHub builds from
   * the two -- the very thing `actions/checkout` puts at HEAD on a
   * `pull_request` event when no `ref:` is given.
   *
   * Faking this with two linear commits would test an imitation of the code path
   * that ships: the whole defect lives in the difference between a merge commit's
   * two parents, so the fixture has to have two parents.
   *
   * @param {{ baseFiles?: Record<string,string>, prFiles?: Record<string,string|null>,
   *           driftFiles?: Record<string,string|null> }} opts
   * @returns {{ dir: string, pinned: string, mainTip: string }}
   *   `pinned` is what the event payload freezes as `base.sha` at PR-open time.
   */
  const makeMergeRefRepo = ({ baseFiles = {}, prFiles = {}, driftFiles = {} }) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-empty-changeset-mergeref-'));
    repos.push(dir);
    const apply = (files) => {
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
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'selftest@example.invalid'], dir);
    git(['config', 'user.name', 'self test'], dir);
    git(['config', 'commit.gpgsign', 'false'], dir);
    apply(baseFiles);
    git(['commit', '-q', '-m', 'base', '--allow-empty', '--no-gpg-sign'], dir);
    const pinned = git(['rev-parse', 'HEAD'], dir).trim(); // the frozen base.sha

    git(['checkout', '-q', '-b', 'pr'], dir);
    apply(prFiles);
    git(['commit', '-q', '-m', 'pr: this PR own side', '--allow-empty', '--no-gpg-sign'], dir);

    git(['checkout', '-q', 'main'], dir);
    apply(driftFiles);
    git(['commit', '-q', '-m', "main: somebody else's PR merged", '--allow-empty', '--no-gpg-sign'], dir);
    const mainTip = git(['rev-parse', 'HEAD'], dir).trim();

    // GitHub builds the merge ref exactly this way: base branch tip, merge the
    // PR head with --no-ff. Then detach, because CI stands ON the merge commit.
    git(['checkout', '-q', '-b', 'merge-ref', 'main'], dir);
    git(['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', 'Merge pr into main', 'pr'], dir);
    git(['checkout', '-q', '--detach', 'HEAD'], dir);
    return { dir, pinned, mainTip };
  };

  try {
    // ── RED 1: a PR that ADDS an empty-frontmatter changeset ─────────────────
    // The #5799 shape verbatim: a skills/** change declaring nothing, via a new
    // empty changeset. This is the case the gate exists for.
    {
      const { dir, base } = makeRepo(
        { '.changeset/README.md': '# Changesets\n', 'skills/demo/SKILL.md': 'v1\n' },
        { 'skills/demo/SKILL.md': 'v2\n', '.changeset/published-skill-tweak.md': EMPTY },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 1, 'RED 1: a newly added empty changeset must produce exactly one violation');
      assert(
        r.violations[0]?.file === '.changeset/published-skill-tweak.md',
        'RED 1: the violation must NAME the offending file',
      );
      assert(r.violations[0]?.kind === 'added-empty', 'RED 1: kind must be added-empty');
    }

    // ── GREEN 1: the stock. Empty changesets on base, untouched by the PR ────
    // The ruling's exemption, and the reason this gate reads a diff rather than
    // the directory: 182 such files sit on main and none of them may go red.
    {
      const { dir, base } = makeRepo(
        {
          '.changeset/stock-empty-a.md': EMPTY,
          '.changeset/stock-empty-b.md': EMPTY,
          '.changeset/README.md': '# Changesets\n',
          'src/app.ts': 'export const a = 1;\n',
        },
        { 'src/app.ts': 'export const a = 2;\n', '.changeset/real-release.md': DECLARING },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 1: pre-existing empty changesets left alone must not go red');
      assert(r.ok.includes('.changeset/real-release.md'), 'GREEN 1: the declaring changeset must be accepted');
    }

    // ── GREEN 2: a PR that adds a NON-empty changeset ────────────────────────
    {
      const { dir, base } = makeRepo(
        { 'packages/spec/src/index.ts': 'export const v = 1;\n' },
        { 'packages/spec/src/index.ts': 'export const v = 2;\n', '.changeset/adds-a-field.md': DECLARING },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 2: a declaring changeset must be accepted');
    }

    // ── GREEN 3: a skills/**-only PR carrying NO changeset (route 2) ─────────
    // The #5947 destination. Such a PR takes the `skip-changeset` label; this
    // gate must have nothing to say about it, label or no label.
    {
      const { dir, base } = makeRepo(
        { 'skills/objectstack-pm-dispatch/SKILL.md': 'two axes\n', '.changeset/stock-empty.md': EMPTY },
        { 'skills/objectstack-pm-dispatch/SKILL.md': 'three axes\n' },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 3: a skills-only PR with no changeset at all must be green here');
      assert(r.ok.length === 0 && r.exempt.length === 0, 'GREEN 3: an untouched .changeset dir must not even be read');
    }

    // ── RED 2: a stock NON-empty changeset EMPTIED in place ──────────────────
    // The bypass `--diff-filter=A` alone cannot see. A new empty declaration is
    // a new empty declaration however it was spelled.
    {
      const { dir, base } = makeRepo(
        { '.changeset/was-declaring.md': DECLARING },
        { '.changeset/was-declaring.md': EMPTY },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 1, 'RED 2: emptying an existing changeset must go red');
      assert(r.violations[0]?.kind === 'emptied', 'RED 2: kind must be emptied');
    }

    // ── GREEN 4: a stock EMPTY changeset whose prose is edited ───────────────
    // Still empty at base, so this PR created no new empty declaration. This is
    // the row that keeps the exemption honest under `--diff-filter=AMR`.
    {
      const { dir, base } = makeRepo(
        { '.changeset/stock-empty.md': EMPTY },
        { '.changeset/stock-empty.md': `${EMPTY}\nfixed a typo in the body\n` },
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 4: editing the body of an already-empty changeset must stay exempt');
      assert(r.exempt.includes('.changeset/stock-empty.md'), 'GREEN 4: it must be reported as exempt, not as ok');
    }

    // ── RED 3: a new changeset with no frontmatter fence at all ──────────────
    {
      const { dir, base } = makeRepo({}, { '.changeset/no-fence.md': 'just a body, no fence\n' });
      const r = scan({ cwd: dir, base });
      assert(r.violations[0]?.kind === 'added-unfenced', 'RED 3: an unfenced new changeset declares nothing -> red');
    }

    // ── GREEN 5: .changeset/README.md is not a changeset ─────────────────────
    {
      const { dir, base } = makeRepo({}, { '.changeset/README.md': '# Changesets\n\nhow to write one\n' });
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 5: .changeset/README.md must never be judged as a changeset');
    }

    // ── The `R` rows (#7045) ─────────────────────────────────────────────────
    //
    // Rows 4-6 of the header table. `--diff-filter=AM` -- what this file passed
    // until #7045 -- drops an `R` row wholesale, so RED 4 below was GREEN with a
    // violation sitting in the diff. Every case here carries a CONTROL asserting
    // that git really emitted `R`: rename detection is a SIMILARITY score, and a
    // short body degrades to add-plus-delete, at which point the case is about an
    // ordinary `A` and passes for a reason that has nothing to do with the fix.
    // Hence `RENAMEABLE` -- a body long enough to score, in every fixture below.
    const RENAMEABLE =
      'feat(spec): a body long enough that git scores the move as a rename rather\n' +
      'than as an add plus a delete -- the whole point of these cases is the `R`\n' +
      'status, and a short body silently turns them into `A` cases instead.\n';
    const RENAMEABLE_DECLARING = `---\n"@objectstack/spec": minor\n---\n\n${RENAMEABLE}`;
    const RENAMEABLE_EMPTY = `---\n---\n\n${RENAMEABLE}`;
    /** The `R` row for `old -> new`, or null. Fails loudly rather than quietly. */
    const renameRow = (dir, base, oldPath, newPath) =>
      git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir)
        .split('\n')
        .find((l) => new RegExp(`^R\\d+\t${oldPath}\t${newPath}$`).test(l)) ?? null;

    // ── RED 4: a stock non-empty changeset RENAMED AND EMPTIED in one commit ──
    // Exactly RED 2 with a `git mv` bolted on -- the same brand-new empty
    // declaration, spelled so that `AM` could not see it at all.
    {
      const { dir, base } = makeRepo(
        { '.changeset/was-declaring.md': RENAMEABLE_DECLARING },
        { '.changeset/was-declaring.md': null, '.changeset/now-renamed.md': RENAMEABLE_EMPTY },
      );
      const row = renameRow(dir, base, '\\.changeset/was-declaring\\.md', '\\.changeset/now-renamed\\.md');
      assert(row !== null, `RED 4 control: git must really report this as \`R\`, or the case below is an ordinary \`A\` -- got ${JSON.stringify(git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir))}`);
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 1, `RED 4: renaming a stock changeset while emptying it must go red (\`--diff-filter=AM\` dropped this row entirely) -- got ${JSON.stringify(r.violations)}`);
      assert(r.violations[0]?.file === '.changeset/now-renamed.md', 'RED 4: the violation names the HEAD path (field 3 of the `R` row)');
      assert(r.violations[0]?.kind === 'renamed-empty', 'RED 4: kind must be renamed-empty, not emptied -- the head path is brand new');
      assert(r.violations[0]?.from === '.changeset/was-declaring.md', 'RED 4: ...and it carries the BRANCH-POINT path (field 2), which is where the author has to look');
    }

    // ── GREEN 6: a PURE rename of a stock EMPTY changeset stays exempt ────────
    // The paired control, and the reason `AMR` costs nothing: moving a stock file
    // introduces no new empty declaration, so widening the filter must not turn
    // tidying a filename into a red. Note this case can ONLY be green through the
    // `R` path -- were the rename to degrade to add-plus-delete, the new path
    // would arrive as `A` + empty, which is RED 1.
    {
      const { dir, base } = makeRepo(
        { '.changeset/stock-empty.md': RENAMEABLE_EMPTY },
        { '.changeset/stock-empty.md': null, '.changeset/stock-empty-moved.md': RENAMEABLE_EMPTY },
      );
      assert(
        renameRow(dir, base, '\\.changeset/stock-empty\\.md', '\\.changeset/stock-empty-moved\\.md') !== null,
        'GREEN 6 control: git must really report this as `R`',
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, `GREEN 6: a pure move of a stock empty changeset must not go red -- got ${JSON.stringify(r.violations)}`);
      assert(r.exempt.join() === '.changeset/stock-empty-moved.md', `GREEN 6: it is exempt at its NEW path -- got ${JSON.stringify(r.exempt)}`);
    }

    // ── GREEN 7: a pure rename of a stock DECLARING changeset is simply ok ────
    {
      const { dir, base } = makeRepo(
        { '.changeset/stock-declaring.md': RENAMEABLE_DECLARING },
        { '.changeset/stock-declaring.md': null, '.changeset/stock-declaring-moved.md': RENAMEABLE_DECLARING },
      );
      assert(
        renameRow(dir, base, '\\.changeset/stock-declaring\\.md', '\\.changeset/stock-declaring-moved\\.md') !== null,
        'GREEN 7 control: git must really report this as `R`',
      );
      const r = scan({ cwd: dir, base });
      assert(r.violations.length === 0, 'GREEN 7: moving a changeset that still declares a package is nobody\'s violation');
      assert(r.ok.join() === '.changeset/stock-declaring-moved.md', `GREEN 7: it is simply ok -- got ${JSON.stringify(r.ok)}`);
    }

    // ── RED 5: an `R` row whose BASE side is README.md is not "inherited" ─────
    //
    // The fixture renames `.changeset/README.md` to a changeset filename, and the
    // general reason such a row is reachable at all is that git pairs renames by
    // CONTENT, not by name -- measured on git 2.43.0, where two identically-bodied
    // files paired across unrelated names, and the pathspec kept the pairing
    // inside `.changeset/`. Either way README declares nothing BY DEFINITION
    // (GREEN 5), so reading "already empty at base" off it would hand the
    // exemption out for free on a head file that is a brand-new empty changeset.
    // This is the case the `isChangesetFile(basePath)` guard in the scan exists
    // for; delete the guard and this row goes green as `exempt`.
    {
      const README = `# Changesets\n\n${RENAMEABLE}`;
      const { dir, base } = makeRepo(
        { '.changeset/README.md': README },
        { '.changeset/README.md': null, '.changeset/copied-the-readme.md': README },
      );
      assert(
        renameRow(dir, base, '\\.changeset/README\\.md', '\\.changeset/copied-the-readme\\.md') !== null,
        'RED 5 control: git must really pair the new changeset with README.md, or this case is about something else',
      );
      const r = scan({ cwd: dir, base });
      assert(
        r.violations.length === 1 && r.violations[0]?.file === '.changeset/copied-the-readme.md',
        `RED 5: a changeset paired with README.md by rename detection inherits NOTHING -- got ${JSON.stringify(r.violations)}`,
      );
      assert(r.exempt.length === 0, 'RED 5: and it is certainly not exempt');
    }

    // ── #6129: main drift must not move the verdict, in EITHER direction ─────
    //
    // The gate's contract is "same diff, same verdict" -- what a PR introduces
    // cannot depend on what OTHER PRs merged while it sat open. Two fixtures,
    // deliberately identical except for which side of the fork the offending
    // changeset is on, because a drift assertion on its own is satisfied by a
    // gate that has simply stopped looking.
    {
      const OFFENDER = '.changeset/an-empty-one.md';

      // DRIFT, must NOT fire: the empty changeset arrives on MAIN, from someone
      // else's merged PR. This PR touched nothing but source. Judged from the
      // base BRANCH the file is on both sides of the diff and invisible, which
      // is the point.
      const drift = makeMergeRefRepo({
        baseFiles: { '.changeset/README.md': '# Changesets\n', 'src/app.ts': 'export const v = 1;\n' },
        prFiles: { 'src/app.ts': 'export const v = 2;\n' },
        driftFiles: { [OFFENDER]: EMPTY },
      });
      const drifted = scan({ cwd: drift.dir, base: 'main' });
      assert(
        drifted.violations.length === 0,
        "#6129 DRIFT: an empty changeset that MAIN gained after this PR forked must not be reported against this PR",
      );

      // The same repo judged from the FROZEN base.sha -- what CI used to pass.
      // Asserted rather than merely described: this is the whole defect, and the
      // fixture is here to stop anyone re-pinning the base "because it is the
      // obvious commit to diff against". Note it stays wrong even now that the
      // scan takes a merge base, because a frozen ancestor IS its own merge base.
      const frozen = scan({ cwd: drift.dir, base: drift.pinned });
      assert(
        frozen.violations.length === 1 && frozen.violations[0]?.file === OFFENDER,
        "#6129 DRIFT: judged from the frozen base.sha the same repo blames this PR for main's file -- the defect, pinned",
      );
      assert(
        frozen.base === drift.pinned,
        '#6129 DRIFT: a frozen ancestor is its own merge base, so no merge base can rescue that spelling -- the CALLER must stop pinning',
      );

      // MUST fire: byte-identical drift on main, but this time the PR itself is
      // the one adding the empty changeset. A fix that made the drift case green
      // by looking at less would take this one green too.
      const own = makeMergeRefRepo({
        baseFiles: { '.changeset/README.md': '# Changesets\n', 'src/app.ts': 'export const v = 1;\n' },
        prFiles: { [OFFENDER]: EMPTY },
        driftFiles: { '.changeset/somebody-elses.md': DECLARING },
      });
      const owned = scan({ cwd: own.dir, base: 'main' });
      assert(
        owned.violations.length === 1 && owned.violations[0]?.file === OFFENDER,
        '#6129 OWN SIDE: an empty changeset this PR really adds must still go red, drift or no drift',
      );
      assert(
        owned.ok.length === 0,
        "#6129 OWN SIDE: main's own changeset must not be counted as introduced by this PR either",
      );

      // Same diff, same verdict -- stated as one assertion rather than left to be
      // inferred from the two above. `mainTip` advancing is exactly what turned
      // PR #6117 from red at 02:22Z into green at 02:39Z.
      assert(
        scan({ cwd: drift.dir, base: 'main' }).violations.length ===
          scan({ cwd: drift.dir, base: drift.mainTip }).violations.length,
        '#6129: the verdict must not depend on how far the base branch has run ahead',
      );
    }

    // ── #6129, the other half: a base branch that DELETES ────────────────────
    // Not the CI shape -- an ordinary branch and the default `--base origin/main`
    // of `pnpm check:empty-changeset`. `changeset pre exit` deletes every consumed
    // changeset from main, and a two-dot diff then reads each one still sitting on
    // an un-rebased branch as newly added AND empty. This is the fixture that goes
    // red if the merge base is taken back out of scan() itself.
    {
      const dir = mkdtempSync(join(tmpdir(), 'check-empty-changeset-deleted-'));
      repos.push(dir);
      const write = (rel, contents) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), contents);
      };
      git(['init', '-q', '-b', 'main'], dir);
      git(['config', 'user.email', 'selftest@example.invalid'], dir);
      git(['config', 'user.name', 'self test'], dir);
      git(['config', 'commit.gpgsign', 'false'], dir);
      write('.changeset/stock-empty-a.md', EMPTY);
      write('.changeset/stock-empty-b.md', EMPTY);
      write('src/app.ts', 'export const v = 1;\n');
      git(['add', '-A'], dir);
      git(['commit', '-q', '-m', 'base', '--no-gpg-sign'], dir);
      const fork = git(['rev-parse', 'HEAD'], dir).trim();

      git(['checkout', '-q', '-b', 'feature'], dir);
      write('src/app.ts', 'export const v = 2;\n');
      git(['add', '-A'], dir);
      git(['commit', '-q', '-m', 'feature: source only', '--no-gpg-sign'], dir);

      git(['checkout', '-q', 'main'], dir);
      rmSync(join(dir, '.changeset/stock-empty-a.md'));
      rmSync(join(dir, '.changeset/stock-empty-b.md'));
      git(['add', '-A'], dir);
      git(['commit', '-q', '-m', 'main: changeset pre exit, consumed changesets deleted', '--no-gpg-sign'], dir);
      git(['checkout', '-q', 'feature'], dir);

      const r = scan({ cwd: dir, base: 'main' });
      assert(
        r.violations.length === 0,
        '#6129 DELETED-ON-MAIN: stock empty changesets deleted on main must not read as added by a branch that merely still carries them',
      );
      assert(
        r.base === fork,
        '#6129 DELETED-ON-MAIN: the scan must start at the fork point, not at the moved branch tip',
      );
    }

    // ── #4690, one step later: no merge base at all is a failure ─────────────
    // Falling back to the raw base here would restore exactly the bug above, so
    // the scan throws and the CLI turns that into exit 1.
    {
      const { dir } = makeRepo({}, { 'a.txt': 'x\n' });
      const other = mkdtempSync(join(tmpdir(), 'check-empty-changeset-unrelated-'));
      repos.push(other);
      git(['init', '-q', '-b', 'main'], other);
      git(['config', 'user.email', 'selftest@example.invalid'], other);
      git(['config', 'user.name', 'self test'], other);
      git(['config', 'commit.gpgsign', 'false'], other);
      git(['commit', '-q', '-m', 'unrelated', '--allow-empty', '--no-gpg-sign'], other);
      const unrelated = git(['rev-parse', 'HEAD'], other).trim();
      git(['fetch', '-q', other, 'main'], dir);
      let threw = false;
      try {
        scan({ cwd: dir, base: unrelated });
      } catch {
        threw = true;
      }
      assert(threw, '#4690: unrelated histories have no merge base, and that is a failure rather than a silent pass');
    }

    // ── The consumer: this gate's own CI step (#6129) ────────────────────────
    //
    // A self-test that only ever drives scan() cannot see the half of #6129 that
    // lives in YAML -- and that half is where the false GREEN was. The count that
    // let PR #6117 through is a shell line in pr-automation.yml, so the fixture
    // for it has to read that file. Without this block the workflow could be
    // reverted to the frozen `base.sha` tomorrow with every assertion above still
    // green, which is precisely the "returns in a different shape" #6129 rules out.
    {
      const workflow = join(REPO_ROOT, '.github/workflows/pr-automation.yml');
      const present = existsSync(workflow);
      assert(present, 'consumer: .github/workflows/pr-automation.yml must exist -- it is the step this gate runs in');
      const yaml = present ? readFileSync(workflow, 'utf8') : '';

      assert(
        /git merge-base "refs\/remotes\/origin\/\$BASE_REF" HEAD/.test(yaml),
        'consumer: the Check Changeset job must derive its diff base from `git merge-base origin/<base ref> HEAD`',
      );
      // What this pins is the ENDPOINT ($MERGE_BASE), and the `A` is incidental to
      // it. Deliberately NOT widened to `AMR` alongside the scan (#7045): the
      // workflow's `A` is a route-detection COUNT -- "did this PR write a
      // changeset, or does it owe a `skip-changeset` label" -- not a violation
      // scan. A rename adds no changeset, so counting `R` there would hand the
      // label exemption to a PR that wrote nothing, which is the loosening
      // direction. `A` fails CLOSED here and that is the answer this count wants;
      // `AMR` in the scan fails closed there. Same family, opposite obligations.
      assert(
        /--diff-filter=A "\$MERGE_BASE" HEAD -- '\.changeset\/\*\.md'/.test(yaml),
        'consumer: the changeset COUNT must diff from $MERGE_BASE (never the frozen base.sha) -- that count going green on main drift is #6129',
      );
      // Every `--base` handed to this script, not just the one that exists today:
      // a second call site added later with a pinned sha is the same bug again.
      const bases = [...yaml.matchAll(/check-empty-changeset\.mjs --base (\S+)/g)].map((m) => m[1]);
      assert(bases.length === 1, 'consumer: exactly one `check-empty-changeset.mjs --base` call site is expected in the workflow');
      assert(
        bases.every((b) => b === '"$MERGE_BASE"'),
        'consumer: every `check-empty-changeset.mjs --base` in the workflow must be handed $MERGE_BASE',
      );
      // The endpoint rule itself, independent of the spellings above: no diff in
      // this workflow may start at the payload's frozen base.sha. Comment lines
      // are excluded because the rule is about what RUNS -- and because the
      // workflow's own note on why `git diff base.sha...HEAD` is not a fix would
      // otherwise be the first thing this catches (it was).
      const pinnedDiffs = yaml
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .filter((line) => /\bgit diff\b/.test(line) && /BASE_SHA|base\.sha/.test(line));
      assert(
        pinnedDiffs.length === 0,
        `consumer: no \`git diff\` in the workflow may use the frozen base.sha as an endpoint (found ${pinnedDiffs.length})`,
      );

      // ── The label race, and the half of #6378 that also lives in YAML ──────
      //
      // Same argument as the block above, one defect along: the fix for #6378 is
      // shell and `if:` expressions in pr-automation.yml, so nothing that drives
      // scan() can see it being undone. Two live label reads (a fast path at
      // ~+10s from PR creation, and a settling one that waits out the window)
      // are what turn the route-2 first run green; a later edit that deletes the
      // second, or that lets the FIRST one pronounce a verdict, restores a gate
      // that was red-by-construction 22 times in one day.
      //
      // What is pinned here is deliberately the SHAPE OF THE EXEMPTION, never
      // its permissiveness: read the assertions below as one sentence -- the
      // exemption may be established only by a label really observed, the wait
      // may be charged only to a PR that would otherwise fail, every step that
      // can fail a PR over the changeset rule must honour both reads, and the
      // failure must stay a failure.
      const settle = /steps\.changeset_count\.outputs\.added == '0'/.test(yaml);
      assert(
        settle,
        'consumer: the settling label read must be conditioned on `steps.changeset_count.outputs.added == \'0\'` -- the wait #6378 introduces is charged ONLY to a PR headed for red, and un-conditioning it taxes every run instead',
      );
      // The condition above is a substring test, so it would go on passing if a
      // later edit bolted an unrelated `|| <anything>` onto it and quietly taxed
      // every run again. #6434 legitimately adds ONE disjunct -- the unusable diff
      // base, which is the other way a PR arrives at red and which the count
      // cannot speak for, because the counting step is skipped on that path. So
      // the whole condition is pinned, not just its first term: exactly these two
      // ways in, and no third without an argument.
      const settleIf = yaml.match(
        /steps\.labels\.outputs\.skip != 'true'\s*\n\s*&& \(steps\.changeset_count\.outputs\.added == '0'\s*\n\s*\|\| steps\.diffbase\.outputs\.base_error != ''\)/,
      );
      assert(
        settleIf !== null,
        "consumer: the settling read's condition must be exactly `no fast-path label AND (added == '0' OR base_error != '')` -- both disjuncts are ways of being headed for RED, which is the only thing that may buy the #6378 wait",
      );

      // Both reads, one matcher. A divergence (say a substring `grep -q` on one
      // path) would be a gate that exempts on one read and enforces on the
      // other, and `skip-changeset-audit` would newly buy an exemption on
      // whichever path drifted.
      const matchers = [...yaml.matchAll(/grep -qxF 'skip-changeset'/g)];
      assert(
        matchers.length === 2,
        `consumer: exactly two live \`grep -qxF 'skip-changeset'\` reads are expected (the fast path and the settling read); found ${matchers.length}`,
      );

      // Every step of this job that can FAIL a PR must honour both reads. Scoped
      // by what a step RUNS, never by its name: it shells out to a `check-*.mjs`
      // gate, or it contains a literal `exit 1` outside a comment.
      //
      // #6434 widened this boundary, and the widening is the point rather than an
      // accident of it. The predicate used to be "runs a `check-*.mjs` OR emits
      // the no-changeset error", which described the four steps that existed and
      // nothing else. `Resolve the diff base` sat outside it carrying two `exit
      // 1`s of its own -- deliberately, on the argument that "the git base is
      // unavailable" is not a changeset verdict and so was never label-exempt.
      // That argument is sound about the VERDICT and wrong about its ADDRESS: the
      // step ran before the settling read, so on a PR whose `skip-changeset` label
      // landed in the ordinary +10..45s window it could red a run the job was
      // about to exempt. #6434 moved that verdict to `Require a usable diff base`,
      // which honours both reads, and the boundary here moved with it.
      //
      // Naming `exit 1` instead of one specific error string is what makes the
      // rule outlive the steps it was written for: the gap #6434 closed existed
      // precisely because the old predicate could not see a failing step it had
      // not been told about, and the next one added here would have been invisible
      // the same way. Residual, stated rather than implied: a step that fails by
      // running a command that returns non-zero, with no literal `exit 1` and no
      // `check-*.mjs`, is still outside this set. That is a smaller hole than the
      // one it replaces, not no hole.
      const jobText = yaml.slice(yaml.indexOf('\n  changeset-check:'));
      const chunks = jobText
        .split(/\n(?=      - name: )/)
        .map((c) => c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'))
        .filter((c) => /node scripts\/check-\S+\.mjs/.test(c) || /\bexit 1\b/.test(c));
      assert(
        chunks.length === 5,
        `consumer: expected 5 failable steps in the Check Changeset job, found ${chunks.length} -- a new one that this rule cannot see is a new way to red an exempt PR`,
      );
      // The step whose relocation #6434 IS. Pinned in the negative as well as the
      // positive: base resolution reports into an output and the verdict is taken
      // downstream, so re-introducing an `exit 1` here would restore the fast-path
      // -only failure this card exists to remove. The count above would catch that
      // as a 6th failable step; this says which one and why, so the next reader
      // gets the reason and not just an arithmetic mismatch.
      const diffbaseStep = jobText
        .split(/\n(?=      - name: )/)
        .map((c) => c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'))
        .find((c) => /- name: Resolve the diff base/.test(c));
      assert(
        diffbaseStep !== undefined && !/\bexit 1\b/.test(diffbaseStep),
        'consumer: `Resolve the diff base` must not fail on the spot -- it runs BEFORE the settling read, so its verdict would be taken on the fast path alone and would red a PR whose skip-changeset label was still in flight (#6434). It reports `base_error` and the adjudication step below decides.',
      );
      assert(
        diffbaseStep !== undefined && /base_error=/.test(diffbaseStep),
        'consumer: `Resolve the diff base` must report an unusable base as a `base_error` output -- dropping it silently would leave the downstream adjudication permanently un-triggerable, i.e. a gate that passes because it never runs (#4690)',
      );
      const unguarded = chunks.filter((c) => !/steps\.labels_settled\.outputs\.skip != 'true'/.test(c));
      assert(
        unguarded.length === 0,
        `consumer: every changeset-verdict step must honour the settling read as well as the fast path (${unguarded.length} do not) -- a step guarded only by the fast path re-arms itself on exactly the PRs #6378 rescued`,
      );
      const halfGuarded = chunks.filter((c) => !/steps\.labels\.outputs\.skip != 'true'/.test(c));
      assert(
        halfGuarded.length === 0,
        `consumer: every changeset-verdict step must honour the fast-path read too (${halfGuarded.length} do not) -- dropping it makes an already-labelled PR pay a whole job (#5580)`,
      );

      // ── The same race, one label along (#5620) ───────────────────────────────
      //
      // `allow-major` is the launch-window guard's escape hatch, and it was read
      // from `github.event.pull_request.labels` for exactly as long as the
      // `skip-changeset` half was: same frozen snapshot, same permanent red under
      // `rerun_failed_jobs`, which replays the payload. It is pinned HERE, beside
      // the skip-changeset reads, because it is the same defect in the same job
      // and a second home for it would be one more thing to remember.
      //
      // Two properties of this one make the pin worth more than usual, not less.
      // It is DORMANT -- check-changeset-no-major.mjs stands aside for the whole
      // pre-release window -- so no CI run can currently exercise the live read
      // and a revert to the payload would be invisible until `changeset pre exit`
      // re-arms the guard, which is the day whole-stack majors are being argued
      // about. And it has no settling read to fall back on, by the argument in
      // the workflow; the position of the read is doing that work instead.
      //
      // What is pinned is the SHAPE OF THE EXEMPTION, never its permissiveness:
      // no payload read anywhere, exactly one live read, the guard consuming that
      // read, and an input that could not be read still RUNNING the guard.
      assert(
        !/contains\(github\.event\.pull_request\.labels\.\*\.name, 'allow-major'\)/.test(yaml),
        "consumer: the allow-major exemption must never be read from `github.event.pull_request.labels` -- that snapshot is frozen when the event fires and `rerun_failed_jobs` replays it, so the red it produces cannot be re-run green (#5620)",
      );
      const allowMajorReads = [...yaml.matchAll(/grep -qxF 'allow-major'/g)];
      assert(
        allowMajorReads.length === 1,
        `consumer: exactly one live \`grep -qxF 'allow-major'\` read is expected in the workflow; found ${allowMajorReads.length}. The matcher is whole-line and fixed for the same two reasons as the skip-changeset reads: \`contains(<array>, ...)\` matched an array ELEMENT, so a substring match would newly exempt an \`allow-major-audit\` label, and a piped \`grep -q\` can take SIGPIPE under pipefail.`,
      );
      const namedSteps = jobText
        .split(/\n(?=      - name: )/)
        .map((c) => c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'));
      const majorGuard = namedSteps.find((c) => /- name: Guard against accidental major bumps/.test(c));
      assert(
        majorGuard !== undefined && /steps\.allow_major\.outputs\.allow != 'true'/.test(majorGuard),
        'consumer: the launch-window major guard must take its exemption from the LIVE allow-major read (`steps.allow_major.outputs.allow`) -- reading the event payload there is #5620 itself',
      );
      const allowMajorStep = namedSteps.find((c) => /grep -qxF 'allow-major'/.test(c));
      assert(
        allowMajorStep !== undefined
          && /steps\.labels\.outputs\.skip != 'true'/.test(allowMajorStep)
          && /steps\.labels_settled\.outputs\.skip != 'true'/.test(allowMajorStep),
        'consumer: the live allow-major read must honour both skip-changeset reads -- a PR the changeset gate exempts must not buy an API call for a guard that will not run',
      );
      // The tolerance direction, pinned by POSITION rather than by counting the
      // enforcing branches: `allow=true` may be written once, and only downstream
      // of the grep that actually observed the label. Every other exit -- no PR
      // number, an unreadable label list -- reaches the guard (#4690).
      const allowLines = (allowMajorStep ?? '').split('\n');
      const grepAt = allowLines.findIndex((l) => /grep -qxF 'allow-major'/.test(l));
      const allowTrueAt = allowLines.map((l, i) => (/allow=true/.test(l) ? i : -1)).filter((i) => i >= 0);
      assert(
        grepAt >= 0 && allowTrueAt.length === 1 && allowTrueAt[0] > grepAt,
        `consumer: the live allow-major read must write \`allow=true\` exactly once and only after the label was really observed (found ${allowTrueAt.length} at ${JSON.stringify(allowTrueAt)}, grep at ${grepAt}) -- an exemption handed out because the label list could not be read is the #4690 anti-pattern, and here it would wave a whole-stack major through`,
      );

      // The hard constraint of #6378, stated as structure: none of this may have
      // made the gate softer. A PR with no changeset and no label still has to
      // hit a real non-zero exit, and no step of this job may be excused from
      // its own failure.
      assert(
        /::error::This PR adds no changeset[\s\S]{0,900}?\n\s+exit 1\n/.test(yaml),
        'consumer: the "no changeset" verdict must still exit 1 -- #6378 removes a structural FALSE red, it does not relax the gate',
      );
      // The same constraint for #6434, and the reason it is written as a POSITIVE
      // is the asymmetry that makes the negative one above worthless on its own:
      // "the diff base no longer reds an exempt PR" is satisfied just as well by a
      // step that stopped running, or by an adjudication whose `if:` can never be
      // true. So the exempt direction is not asserted at all -- what is asserted
      // is that the enforcing direction survived, in the one place it now lives.
      const adjudication = jobText
        .split(/\n(?=      - name: )/)
        .map((c) => c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'))
        .find((c) => /- name: Require a usable diff base/.test(c));
      assert(adjudication !== undefined, 'consumer: the unusable-diff-base verdict step must exist (#6434) -- without it `base_error` is written and never read, which is a gate deleted rather than relocated');
      assert(
        /steps\.diffbase\.outputs\.base_error != ''/.test(adjudication ?? '') && /\n\s+exit 1\n/.test(adjudication ?? ''),
        "consumer: the unusable-diff-base verdict must fire on `base_error != ''` and exit 1 -- #6434 relocates a failure past the settling read, it does not forgive one. A PR the label reads did not exempt is still failed over a base that could not be resolved (#4690).",
      );
      assert(
        !/continue-on-error/.test(yaml),
        'consumer: no step in pr-automation.yml may carry `continue-on-error` -- that would turn this gate into a warning, which is the one outcome #6378 rules out',
      );
    }

    // ── The second consumer: where THIS SELF-TEST runs (#6509) ───────────────
    //
    // Everything above pins the job that runs the REAL scan. This block pins the
    // job that runs the self-test, and it exists because for a long time they
    // were the same job -- which made the assertions above skippable by a label.
    //
    // The defect, stated once. `changeset-check` is exempt WHOLESALE when a PR
    // carries `skip-changeset`, and a PR that edits a CI-internal script is the
    // textbook case for that label (it releases nothing; the workflow itself
    // prescribes the label for exactly that). So a PR editing this file was
    // routinely the PR that skipped this file's own fixtures. Measured specimen,
    // not a worry: PR #6876 (#5620, merged) added the five `allow-major`
    // assertions above and NONE of them executed on its own CI -- it carried the
    // label, and on run 31289894461 the step that runs `--self-test` reports
    // `conclusion: skipped`. Both directions of that gap are real, and they are
    // not symmetric: a BROKEN assertion is merely deferred onto the next
    // unlabelled PR (an unrelated author eats the red), while a DELETED one is
    // silent forever, because nothing afterwards remembers it existed.
    //
    // The fix is wiring, so the fixture for it has to read the wiring. Without
    // this block `lint.yml`'s step could be deleted tomorrow with every
    // assertion above still green -- the same "phantom check" shape (#4690) this
    // whole family is written against.
    //
    // What is pinned is the property that closes the gap, not the step's prose:
    // the self-test halves run in a job NO PR-level exemption reaches, and the
    // merge-base-dependent halves stay out of it.
    //
    // RESIDUAL, recorded rather than implied. This assertion is run BY the step
    // it pins, so a PR that deletes that step AND carries `skip-changeset` is
    // still not caught -- both places that would have run it are gone in the
    // same diff. That is a strictly smaller hole than the one it replaces (which
    // swallowed EVERY labelled PR, including one that merely edits an
    // assertion), it is a deletion visible in a `.github/**` diff rather than a
    // silent no-op, and closing it entirely would need a gate outside this
    // family asserting this family's wiring, which is a coupling with its own
    // cost. Stated so the next reader inherits the fact and not a false sense of
    // closure.
    {
      const lintPath = join(REPO_ROOT, '.github/workflows/lint.yml');
      const lintPresent = existsSync(lintPath);
      assert(lintPresent, 'consumer: .github/workflows/lint.yml must exist -- it is where this self-test runs unconditionally (#6509)');
      const lintYaml = lintPresent ? readFileSync(lintPath, 'utf8') : '';
      const uncommented = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

      // Scoped to the `lint` job: `typecheck` is a separate required job with a
      // separate purpose, and a step landing there instead would be a different
      // fact than the one asserted here.
      const lintJobStart = lintYaml.indexOf('\n  lint:');
      const lintJobEnd = lintYaml.indexOf('\n  typecheck:');
      const lintJob = lintJobStart === -1 ? '' : lintYaml.slice(lintJobStart, lintJobEnd === -1 ? undefined : lintJobEnd);
      const lintSteps = lintJob.split(/\n(?=      - name: )/).map(uncommented);
      const wiredSteps = lintSteps.filter((s) => /run: pnpm check:changeset-gate-self-tests\b/.test(s));
      assert(
        wiredSteps.length === 1,
        `consumer: the ESLint job of lint.yml must run \`pnpm check:changeset-gate-self-tests\` exactly once (found ${wiredSteps.length}) -- that step is the only place these two checkers' fixtures are executed on a PR carrying \`skip-changeset\` (#6509)`,
      );
      // The load-bearing half. A conditioned step is the defect again with one
      // more hop: whatever the condition reads, it is a way for a PR to arrange
      // that this self-test does not run on it.
      assert(
        wiredSteps.every((s) => !/^\s*if:/m.test(s)),
        'consumer: the changeset-family self-test step in lint.yml must carry NO `if:` -- an exemptable self-test is #6509 itself, and the exemption it must not have is the one that hid PR #6876\'s five assertions',
      );
      // Same property, one level up: a label read anywhere in this workflow
      // would mean some step of it can be waived by the author of the PR under
      // test.
      assert(
        !/skip-changeset/.test(uncommented(lintYaml)),
        'consumer: lint.yml must not read the `skip-changeset` label anywhere -- the whole point of running the self-tests here is that this workflow has no PR-level exemption',
      );
      // And one level up again: "runs on every PR" is what "unconditional"
      // means in practice. A `paths:` filter is a condition written in the
      // trigger instead of in an `if:`, and it would silently restore the gap
      // for every PR whose file list misses the glob.
      const onBlock = uncommented((lintYaml.match(/\non:\n([\s\S]*?)\n(?=[A-Za-z_])/) ?? ['', ''])[1]);
      assert(
        /^\s+pull_request:/m.test(onBlock),
        'consumer: lint.yml must keep its `pull_request:` trigger -- a self-test that does not run on pull requests is not wired at all (#6509)',
      );
      assert(
        !/\bpaths(-ignore)?\s*:/.test(onBlock),
        'consumer: lint.yml must carry no `paths:`/`paths-ignore:` filter -- a path-filtered trigger is an exemption written one level up, and this self-test may not have one (#6509)',
      );

      // The other half of the split: the merge-base-dependent scans stay out of
      // this job. `check:empty-changeset` / `check:adr-0087-registration` chain
      // the REAL scan, whose verdict is a function of the PR's diff; this job
      // has no branch point, so running one here reads stock and reports main's
      // drift against the author -- #6129 in the false-RED direction.
      const strayScans = uncommented(lintYaml)
        .split('\n')
        .filter((l) => /check-empty-changeset\.mjs|check-adr-0087-registration\.mjs|pnpm check:empty-changeset\b|pnpm check:adr-0087-registration\b/.test(l));
      assert(
        strayScans.length === 0,
        `consumer: lint.yml must invoke these gates ONLY through \`pnpm check:changeset-gate-self-tests\` (found ${strayScans.length} direct invocation(s)) -- the real scans need $MERGE_BASE and this job has no branch point, which is #6129 in the false-RED direction`,
      );

      // What that pnpm script actually is. The step above is a name; this is the
      // thing the name resolves to, and it is where "self-test halves only" and
      // "BOTH of them" are actually true or false.
      const pkgPath = join(REPO_ROOT, 'package.json');
      const pkgPresent = existsSync(pkgPath);
      assert(pkgPresent, 'consumer: the repository root package.json must exist -- it carries the script lint.yml runs');
      let wiring = '';
      try {
        wiring = JSON.parse(pkgPresent ? readFileSync(pkgPath, 'utf8') : '{}').scripts?.['check:changeset-gate-self-tests'] ?? '';
      } catch {
        wiring = '';
      }
      assert(
        /check-empty-changeset\.mjs --self-test/.test(wiring),
        'consumer: `check:changeset-gate-self-tests` must run `check-empty-changeset.mjs --self-test` -- the step in lint.yml is only as real as the script it resolves to',
      );
      assert(
        /check-adr-0087-registration\.mjs --self-test/.test(wiring),
        'consumer: `check:changeset-gate-self-tests` must run `check-adr-0087-registration.mjs --self-test` too -- both checkers live in the same exempted job and both were unwired by it (#6509).',
      );
      // The third member of the family, added in #6923. It was absent from this
      // step until then for a stated reason -- it had no `--self-test` to run --
      // and that reason expired the moment it grew one. Its REAL scan stays in
      // pr-automation.yml (its `allow-major` escape hatch lives there), so what
      // joins this step is the self-test half only, exactly like the other two.
      assert(
        /check-changeset-no-major\.mjs --self-test/.test(wiring),
        'consumer: `check:changeset-gate-self-tests` must run `check-changeset-no-major.mjs --self-test` as well -- it is the third checker of this family, and its fixtures land in the same exemption-free job (#6923)',
      );
      assert(
        !/check-(?:empty-changeset|adr-0087-registration|changeset-no-major)\.mjs(?! --self-test)/.test(wiring),
        'consumer: every invocation in `check:changeset-gate-self-tests` must carry `--self-test` -- chaining a real scan into the lint job is the #6129 direction this split exists to avoid',
      );
    }

    // ── Parser unit rows ─────────────────────────────────────────────────────
    assert(isEmptyDeclaration('---\n---\n\nbody\n'), 'parser: the canonical empty shape is empty');
    assert(isEmptyDeclaration('\n---\n\n---\n\nbody\n'), 'parser: blank lines around/inside the fence stay empty');
    assert(!isEmptyDeclaration(DECLARING), 'parser: a declaring changeset is not empty');
    // The row above is EMPTY either way — with or without the leading-blank-line
    // skip (#6923) an unread fence yields no packages — so it cannot fail on
    // that skip's removal. This is the direction that can: a DECLARING file
    // opening with a blank line, which @changesets/parse@0.4.3 reads as a real
    // release. Deleting the preamble turns exactly this one red (the gate then
    // rejects a valid changeset as empty-frontmatter), and it is the behavioural
    // half of the family's fence-preamble agreement asserted further down
    // (#7044).
    assert(!isEmptyDeclaration('\n' + DECLARING), 'parser: a DECLARING changeset opening with a blank line is not empty (#6923/#7044)');
    assert(!isEmptyDeclaration('\n\n' + DECLARING), 'parser: two leading blank lines do not hide a declaration (#6923/#7044)');
    assert(
      !isEmptyDeclaration("---\n'@objectstack/cli': patch\n---\n\nbody\n"),
      'parser: single-quoted package names count as a declaration',
    );
    assert(
      !isEmptyDeclaration('---\n"@objectstack/spec": minor\n"@objectstack/cli": patch\n---\n\nbody\n'),
      'parser: multiple declarations count',
    );
    assert(declaredBumpsIn('no fence here\n').fenced === false, 'parser: a fenceless file reports fenced=false');

    // ── THE FIX (#7004): comments and quoted bump values ─────────────────────
    //
    // This gate's FALSE-RED half. Every fixture here is a changeset that
    // @changesets/parse@0.4.3 reads as a real release; before #7004 each one
    // declared nothing to this parser, so a PR adding a perfectly valid
    // changeset was rejected as empty-frontmatter under #5471.
    //
    // Predicted direction on reverse verification: restoring the old anchor
    // (`([A-Za-z]+)\s*$`) turns exactly these red — `isEmptyDeclaration` goes
    // true and the gate rejects a valid file.
    const declares = (label, text, expected) => {
      const { packages } = declaredBumpsIn(text);
      assert(
        packages.length === expected.length && expected.every((p) => packages.includes(p)),
        `parser: ${label} ⇒ ${JSON.stringify(expected)} — got ${JSON.stringify(packages)}`,
      );
    };
    declares('a trailing YAML comment (#7004)', '---\n"@objectstack/spec": minor # keep\n---\n\nbody\n', ['@objectstack/spec']);
    declares('a trailing comment after a tab (#7004)', '---\n"@objectstack/spec": minor\t# keep\n---\n\nbody\n', ['@objectstack/spec']);
    declares('a trailing comment containing a colon (#7004)', '---\n"@objectstack/spec": minor # note: keep\n---\n\nbody\n', [
      '@objectstack/spec',
    ]);
    declares('a double-quoted bump value (#7004)', '---\n"@objectstack/spec": "minor"\n---\n\nbody\n', ['@objectstack/spec']);
    declares('a single-quoted bump value (#7004)', '---\n"@objectstack/spec": \'minor\'\n---\n\nbody\n', ['@objectstack/spec']);
    declares('a quoted bump value AND a comment (#7004)', '---\n"@objectstack/spec": "minor" # keep\n---\n\nbody\n', ['@objectstack/spec']);
    assert(
      !isEmptyDeclaration('---\n"@objectstack/spec": minor # keep\n---\n\nbody\n'),
      'parser: a comment-bearing declaration is NOT an empty changeset — the #7004 false-RED, stated in this gate own vocabulary',
    );

    // The other direction, and this gate FALSE-GREEN half. A whole-line comment
    // containing a colon is entry-shaped; it used to parse as a package named
    // `# note`, so a frontmatter block of nothing but comments read as NON-empty
    // and sailed through the very check that exists to refuse it (#4898).
    assert(
      isEmptyDeclaration('---\n# note: minor\n---\n\nbody\n'),
      'parser: a frontmatter holding only a colon-bearing comment IS empty — it declares no package (#7004 false-GREEN half)',
    );
    assert(
      isEmptyDeclaration('---\n   # note: minor\n# another: patch\n---\n\nbody\n'),
      'parser: indented and repeated comment lines are still no declaration (#7004)',
    );
    assert(
      declaredBumpsIn('---\n# note: minor\n---\n\nbody\n').fenced === true,
      'parser: control — that comment-only fixture IS fenced, so the emptiness above is about the entries and not a missing fence',
    );
    declares('control — a real entry beside a colon-bearing comment line', '---\n# note: minor\n"@objectstack/real": patch\n---\n\nbody\n', [
      '@objectstack/real',
    ]);

    // YAML needs whitespace before an inline `#`, so this is the scalar
    // `minor# keep` and @changesets/parse THROWS on it. Reading it as no
    // declaration is agreement with changesets, not a residual gap.
    assert(
      isEmptyDeclaration('---\n"@objectstack/spec": minor# keep\n---\n\nbody\n'),
      'parser: `minor# keep` (no space before #) is not a YAML comment — changesets throws on it, so declaring nothing here agrees with it (#7004)',
    );

    // ── The family reads one block one way (#7004) ───────────────────────────
    //
    // Until now that claim was four prose comments asserting each other. It is
    // the load-bearing invariant of this family — the moment two of these
    // parsers disagree, one gate is judging a different file than it appears to
    // — so it is checked against the actual file text instead.
    //
    // #7004 is what a comment-only invariant costs: the trailing-comment gap
    // reached all four carriers at once, and the fourth
    // (`objectui-changeset-digest.mjs`) was not even named in the report,
    // because nothing mechanical connected it to the other three.
    {
      const FAMILY = [
        'scripts/check-changeset-no-major.mjs',
        'scripts/check-empty-changeset.mjs',
        'scripts/check-adr-0087-registration.mjs',
        'scripts/objectui-changeset-digest.mjs',
      ];
      const literals = new Map();
      for (const rel of FAMILY) {
        const path = join(REPO_ROOT, rel);
        assert(existsSync(path), `family: ${rel} must exist — it is one of the four readers of a changeset frontmatter block`);
        const src = existsSync(path) ? readFileSync(path, 'utf8') : '';
        const found = src.match(/\/\^\\s\*\["'\]\?.*?\/\.exec\(/g) ?? [];
        // Anti-vacuous-green (#6983): an extraction that stops matching yields
        // an empty set, and "all zero literals agree" is a green that judged
        // nothing at all. So each file is asserted to have yielded exactly one.
        assert(found.length === 1, `family: exactly one entry regex must be extractable from ${rel} — found ${found.length} (the extraction went stale, and the agreement below would compare nothing)`);
        if (found.length === 1) literals.set(rel, found[0]);
      }
      const distinct = new Set(literals.values());
      assert(
        distinct.size === 1,
        `family: all four changeset frontmatter parsers must use a byte-identical entry regex — found ${distinct.size} distinct spellings: ${JSON.stringify([...literals])}`,
      );
      // And the shared spelling must actually be the comment-aware one, so this
      // block cannot go green on four identically-STALE copies.
      assert(
        [...distinct][0]?.includes('(?:\\s+#.*)?'),
        'family: the shared entry regex must carry the `(?:\\s+#.*)?` trailing-comment arm — four identical copies of the OLD anchor would satisfy the agreement check above while re-opening #7004',
      );
      for (const rel of FAMILY) {
        const src = existsSync(join(REPO_ROOT, rel)) ? readFileSync(join(REPO_ROOT, rel), 'utf8') : '';
        assert(
          /\/\^\\s\*#\/\.test\(lines\[[ij]\]\)\) continue;/.test(src),
          `family: ${rel} must skip whole-line YAML comments — without it a colon-bearing comment parses as a package named \`# note\` (#7004)`,
        );
      }

      // ── … and they agree on WHERE that block may START (#7044) ────────────
      //
      // The second row of the same dialect table, and the standing proof that a
      // ONE-ROW agreement check is not a family agreement check. #6923 taught
      // three of these four to skip leading blank lines before the fence; the
      // fourth (`objectui-changeset-digest.mjs`) still required the fence on
      // line 1 when #7004 came through and aligned the entry regex — so a
      // changeset opening with a single blank line read as release-nothing
      // there and dropped out of the release digest, while
      // @changesets/parse@0.4.3 honoured its `major`. That is #4731's harm
      // (a breaking change vanishing from the record) reached through the one
      // row nothing mechanical was holding. Three alignment passes went over
      // this family and none of them could see it. This block is the mechanism
      // that was missing.
      //
      // The four cannot share the fence TEST itself, and that is by design: the
      // three gates return early on an unfenced file, while the digest falls
      // through and treats the whole text as body. What they must share is the
      // CURSOR — a skip that advances `i`, then a fence tested at `lines[i]`.
      // Both halves are asserted per file, because a preamble sitting dead
      // beside a surviving `lines[0]` test is #7044 again with the fix already
      // in the file.
      const preambles = new Map();
      for (const rel of FAMILY) {
        const src = existsSync(join(REPO_ROOT, rel)) ? readFileSync(join(REPO_ROOT, rel), 'utf8') : '';
        // Comment lines are blanked (not dropped — indices stay meaningful):
        // two of these files QUOTE the old `lines[0]` spelling in their headers
        // while explaining why it was wrong, and a scan that reads prose finds
        // the defect it is hunting inside the account of its own fix.
        const srcLines = src.split('\n').map((l) => (/^\s*(?:\/\/|\/?\*)/.test(l) ? '' : l));
        const fenceAt = srcLines.findIndex((l) => /lines\[[^\]]+\]\?\.trim\(\) [!=]== '---'/.test(l));
        // Anti-vacuous-green (#6983), same discipline as the entry regex above:
        // an extraction that finds nothing must fail here rather than hand the
        // two assertions below an empty set to agree about.
        assert(
          fenceAt > 0,
          `family: an opening-fence test must be extractable from ${rel} — found none, so the extraction went stale and the preamble agreement below would judge nothing`,
        );
        if (fenceAt <= 0) continue;
        assert(
          /lines\[i\]\?\.trim\(\) [!=]== '---'/.test(srcLines[fenceAt]),
          `family: ${rel} must test the opening fence at the cursor the blank-line skip advanced, never at a literal line index — \`lines[0]\` IS #7044: the changeset opens with one blank line, the fence is on line 2, and the entire block reads as absent (found: ${JSON.stringify(srcLines[fenceAt].trim())})`,
        );
        // The statement immediately above it, extracted by POSITION rather than
        // by content — so the agreement asserted next is a real comparison and
        // not a regex agreeing with itself.
        const above = [...srcLines.slice(0, fenceAt)].reverse().find((l) => l.trim() !== '') ?? '';
        preambles.set(rel, above.trim());
      }
      assert(
        preambles.size === FAMILY.length,
        `family: a fence preamble had to be extracted from all ${FAMILY.length} parsers — got ${preambles.size}`,
      );
      const distinctPreambles = new Set(preambles.values());
      assert(
        distinctPreambles.size === 1,
        `family: all four parsers must carry a byte-identical leading-blank-line preamble immediately before their fence test — found ${distinctPreambles.size} distinct spellings: ${JSON.stringify([...preambles])}`,
      );
      // And the shared statement must be the SKIP, so this cannot go green on
      // four identical copies of something else sitting in that position.
      assert(
        [...distinctPreambles][0] === "while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines",
        `family: the shared statement before the fence test must be the leading-blank-line skip itself (#6923) — found ${JSON.stringify([...distinctPreambles][0])}`,
      );
    }

    // ── Missing input is a failure, never a pass (#4690) ─────────────────────
    {
      const { dir } = makeRepo({}, { 'a.txt': 'x\n' });
      assert(resolveCommit('definitely-not-a-ref', dir) === null, 'unresolvable base must resolve to null (-> exit 1)');
    }
  } finally {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-empty-changeset --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-empty-changeset --self-test: ${checked} assertions over real temp git repos (real scan() path)`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  selfTest();
} else if (argv.includes('--list')) {
  list();
} else {
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
      console.error(`⛔ check-empty-changeset: --base '${requested}' does not resolve to a commit.`);
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
      console.error('⛔ check-empty-changeset: no base to diff against (tried origin/main, main).');
      console.error("   Pass one explicitly: --base <ref-or-sha>. Missing input is a failure, never a pass (#4690).");
      process.exit(1);
    }
  }

  let result;
  try {
    result = scan({ cwd: REPO_ROOT, base, head });
  } catch (error) {
    console.error(`⛔ check-empty-changeset: ${error instanceof Error ? error.message : String(error)}`);
    console.error('   Missing input is a failure, never a pass (#4690).');
    process.exit(1);
  }
  const { violations, exempt, ok, base: from } = result;
  // The starting commit is printed on both verdicts, and it is not decoration:
  // #6129 hid for as long as it did because nothing in any log said where the
  // diff began, so a gate reading the wrong side of a fork looked exactly like a
  // gate reading the right one.
  console.log(`Diffing ${head} from ${from.slice(0, 9)} (merge base with ${baseLabel}).`);
  if (violations.length) {
    report(violations);
    process.exit(1);
  }
  const parts = [`${ok.length} declaring changeset(s) added`];
  if (exempt.length) parts.push(`${exempt.length} pre-existing empty changeset(s) touched but exempt`);
  console.log(`✓ No empty-frontmatter changeset introduced by this diff (${parts.join(', ')}).`);
}
