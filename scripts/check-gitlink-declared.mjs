#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-gitlink-declared (#17472) -- refuses an index entry whose mode is
// 160000 (a GITLINK, i.e. a submodule pointer) that no tracked `.gitmodules`
// row declares.
//
//   node scripts/check-gitlink-declared.mjs
//   node scripts/check-gitlink-declared.mjs --self-test   # verify the checker itself
//   node scripts/check-gitlink-declared.mjs --list        # every gitlink, judged
//
// ## The measured defect (#17472, out of #17154 / PR #17468)
//
// A nested git repository inside the checkout -- a linked worktree, a nested
// clone, a vendored repo -- is staged by `git add -A` as ONE index entry with
// mode 160000, at EXIT 0, with a single `warning:` line and a hint block:
//
//     git worktree add .worktrees/scratch HEAD
//     git add -A                      # exit 0
//     git ls-files --stage            # 160000 3c458b98... 0  .worktrees/scratch
//
// What lands is not the second checkout's content and not its `.git` file. It
// is a submodule-shaped row with NO `.gitmodules` row beside it, pointing at a
// commit that exists only in the one container that produced it. Every clone
// afterwards carries a dangling submodule pointer: `git submodule` tooling and
// CI checkouts trip on it, and nothing in the tree says where it came from.
//
// The signal git gives is a warning on stderr of a command that SUCCEEDS, so
// nothing downstream can act on it -- a caller reading the exit status is told
// the stage was clean, which is what it was told before the pointer existed.
//
// ## Why the rule is "undeclared", not "no gitlinks at all"
//
// A flat ban on mode 160000 is the stronger rule and it was rejected. It bans
// the LEGITIMATE case along with the accident, and the two are told apart by a
// fact already written down in every repository that has a real submodule:
// `.gitmodules`. `git submodule add` writes the declaration and the gitlink in
// one act, so a real submodule passes this gate the day it is added and needs
// no exemption, no allowlist and no flag. What cannot be defended is a pointer
// nothing declares -- and that is exactly the shape the accident produces,
// every time, because `git add -A` writes the gitlink and never the
// declaration.
//
// This repo has zero submodules: measured on `objectstack-ai/objectstack` at
// `7358c1c5b`, the index mode histogram is 8691 x 100644 and 34 x 100755 over
// 8725 tracked paths -- no other mode at all -- and no `.gitmodules` file
// exists. So the rule costs nothing today and is what keeps the first
// accidental pointer out.
//
// ## Why the INDEX, and why `.gitmodules` is read from the index too
//
// The subject is the STAGE. `git add -A` writes the index; a commit is built
// from the index; a clone gets what the commit carries. Reading the index is
// what lets this gate refuse the pointer at the moment it is created, before a
// commit exists to be rewritten -- and in CI the two are the same set, because
// a workflow checks out a commit and the index it populates equals that tree.
//
// The declaration is read from the index for the SAME reason, and this is the
// half that is easy to get wrong. `git config --blob :.gitmodules` reads stage
// 0 of the index; reading the working-tree file instead would let a
// `.gitmodules` that is present on disk and never staged vouch for a gitlink,
// and that combination is precisely the clone-side hazard this gate exists for:
// the clone receives the pointer and not the file that explains it. A
// declaration that does not travel with the commit declares nothing.
//
// ## What this gate is NOT
//
// It is not the untracked-signal half. PR #17468 closed that one by ignoring
// `.worktrees/`, which is where an agent's own worktree goes. This gate is the
// STAGE, and it is deliberately path-blind: the class generalises past any
// path -- a nested clone, a vendored repo, a worktree under a name no ignore
// rule covers -- so there is no path list here to fall out of date.
//
// It is also not a check on the working tree. A nested repository sitting on
// disk and never staged is not this gate's business; ignoring it is.
//
// ## Report-only, and why the refusal is not deferred
//
// The card's suggested shape was "report-only, then refusing". A staged rollout
// buys time to fix a backlog of existing findings, and there is no backlog: the
// tree carries zero gitlinks, so a report-only phase would be a phase in which
// this gate refuses nothing and finds nothing, and the day it starts refusing
// is the day it would first have been tested. The report half ships as `--list`
// -- which prints every gitlink and how each is judged, whether or not any is a
// finding -- and the default run refuses from the first commit.

// The reason is ONE line on purpose: the marker is matched line-by-line, so a reason wrapped across
// comment lines is captured only as far as its first newline and prints to a seat cut off mid-sentence.
// dispatch-gates: whole-tree-population -- the population is `git ls-files --stage`, the WHOLE index, and the verdict is about an entry's MODE, so any card that adds a path can move this gate and no card's file surface can narrow it; the two literals below are this gate's own subject names (a mode and a config file), never a file surface it reads.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';

/**
 * The index mode git gives a submodule pointer. Written as a string because
 * that is how `git ls-files --stage` prints it and how this gate compares it --
 * parsing it to a number would invite an octal reading of a value that is not
 * one.
 */
export const GITLINK_MODE = '160000';

/** The file a submodule is declared in, and the only thing that declares one. */
export const GITMODULES = '.gitmodules';

/**
 * The NUL delimiter `-z` uses, built from its byte value rather than written as
 * a literal: this file is inside `check:nul-bytes`' scan surface, and a raw NUL
 * here would make that gate fail on this one.
 */
const NUL = String.fromCharCode(0);

/**
 * One git invocation in `root`.
 *
 * The ambient git environment is deliberately NOT scrubbed. A `GIT_INDEX_FILE`
 * set by a caller names the index that caller is building, and the index this
 * gate should judge is whichever one is about to become a commit -- so a future
 * pre-commit wiring needs this to read the environment's index, not rediscover
 * its own. The self-test's fixture builder scrubs instead, where an inherited
 * value would silently retarget the fixture's own `git add`.
 */
function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

/**
 * Every index entry, as `{ mode, oid, stage, path }` -- every STAGE of it. A
 * conflicted index repeats a path at stages 1, 2 and 3, and dropping those here
 * would hide a conflicted gitlink from the gate entirely; `findOffenders` is
 * where one path becomes one finding.
 *
 * `-z` rather than newline-delimited, so a path holding a newline is one record
 * and not two. Each record is `<mode> <oid> <stage>\t<path>`.
 */
export function parseIndexEntries(stdout) {
  const entries = [];
  for (const record of String(stdout).split(NUL)) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, oid, stage] = record.slice(0, tab).split(' ');
    entries.push({ mode, oid, stage, path: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * The submodule paths `.gitmodules` declares, as `path -> submodule name`,
 * read out of the INDEX blob (see the header: a declaration that does not
 * travel with the commit declares nothing).
 *
 * `git config --get-regexp` is the parser rather than a hand-rolled INI reader,
 * because `.gitmodules` is git config syntax and git is already here: line
 * continuations, quoting and subsection-name escaping are its rules, and a
 * second reader of them would be a second dialect to keep in step.
 */
export function parseDeclaredPaths(stdout) {
  const declared = new Map();
  for (const record of String(stdout).split(NUL)) {
    if (!record) continue;
    const newline = record.indexOf('\n');
    if (newline < 0) continue;
    const key = record.slice(0, newline);
    const value = record.slice(newline + 1);
    // `submodule.<name>.path` -- the name may itself contain dots, so the
    // subsection is everything between the first and the last one.
    const name = key.slice('submodule.'.length, key.length - '.path'.length);
    // A trailing slash is not how `git submodule add` writes a path, but it
    // names the same entry; normalising here is cheaper than a finding whose
    // remedy is deleting one character.
    const path = value.endsWith('/') ? value.slice(0, -1) : value;
    if (path) declared.set(path, name);
  }
  return declared;
}

function declaredSubmodulePaths(root) {
  const stdout = git(root, ['config', '-z', '--blob', `:${GITMODULES}`, '--get-regexp', '^submodule\\..+\\.path$'], {
    // Exit 1 is "no key matched", which for a `.gitmodules` carrying no
    // submodule rows is an ordinary answer and not an error.
    allowFailure: true,
  });
  return parseDeclaredPaths(stdout ?? '');
}

/**
 * The gitlinks no declaration covers, at most one row per PATH.
 *
 * Deduplicated because an index in a CONFLICTED state carries the same path at
 * stages 1, 2 and 3, and a gate that printed one path three times would read as
 * broken to the person it is trying to help -- who would then go looking for
 * three pointers. One path is one finding whatever the merge is doing.
 */
export function findOffenders(gitlinks, declared) {
  const offenders = [];
  const seen = new Set();
  for (const entry of gitlinks) {
    if (declared.has(entry.path) || seen.has(entry.path)) continue;
    seen.add(entry.path);
    offenders.push(entry);
  }
  return offenders;
}

/**
 * The one scan. `main()`, `--list` and `--self-test` all go through here, so
 * the self-test exercises the real code path rather than a parallel imitation.
 */
export function scan(root) {
  const entries = parseIndexEntries(git(root, ['ls-files', '--stage', '-z']));
  const gitlinks = entries.filter((e) => e.mode === GITLINK_MODE);
  const gitmodulesStaged = entries.some((e) => e.path === GITMODULES);
  // Asked only when the file is in the index. `--blob :<path>` on a path the
  // index does not carry is an error, not an empty answer, and reading the
  // difference off an exit code would conflate it with "declares nothing".
  const declared = gitmodulesStaged ? declaredSubmodulePaths(root) : new Map();

  const offenders = findOffenders(gitlinks, declared);
  return { entries: entries.length, gitlinks, declared, gitmodulesStaged, offenders };
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/**
 * What the run actually looked at, so a green can be read for its SCOPE.
 *
 * The gitlink count is stated unconditionally, including `0 gitlink(s)`. That
 * zero is the informative case and not the boring one: it is what this repo
 * prints today, and a summary that named gitlinks only when it found some would
 * make "there are none" and "I did not look" render identically.
 */
export function summarise({ entries, gitlinks, declared, gitmodulesStaged }) {
  const where = gitmodulesStaged
    ? `${declared.size} submodule path(s) declared in ${GITMODULES}`
    : `no ${GITMODULES} in the index, so nothing is declared`;
  return `${entries} index entries -- ${gitlinks.length} gitlink(s) at mode ${GITLINK_MODE}; ${where}`;
}

function main() {
  const result = scan(repoRoot());
  const { offenders } = result;

  if (offenders.length === 0) {
    // The two greens are different facts and are printed differently: "nothing
    // to judge" must never render as "everything judged and clean".
    const verdict = result.gitlinks.length === 0 ? 'nothing to declare' : 'every gitlink is declared';
    console.log(`check-gitlink-declared: OK (${summarise(result)}; ${verdict}).`);
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'entry is a gitlink' : 'entries are gitlinks';
  console.error(`check-gitlink-declared: ${offenders.length} index ${plural} that ${GITMODULES} does not declare\n`);
  for (const o of offenders) {
    console.error(`  • ${o.path} -- mode ${o.mode}, commit ${o.oid.slice(0, 8)}`);
  }

  console.error(`
A mode-${GITLINK_MODE} index entry is a SUBMODULE POINTER. Staging a nested git
repository -- a linked worktree, a nested clone, a vendored checkout -- writes
exactly one of these, and \`git add -A\` does it at EXIT 0 with only a
\`warning:\` line, so nothing that reads a status ever sees it.

Undeclared, the pointer names a commit that exists in no clone of this
repository. Every later clone gets a path git reports as a submodule with
nowhere to fetch it from, and \`git submodule\` tooling and CI checkouts trip on
it. ${summarise(result)}.

Two fixes, and which one you want depends on what the path IS:

  • Not a submodule -- the usual case, and the whole reason this gate exists.
    Unstage it, and keep it out:

        git rm --cached ${offenders[0].path}

    then ignore the path (a worktree, a scratch clone and a vendored checkout
    all belong in \`.gitignore\`, not in the index).

  • A real submodule. Declare it, which is what \`git submodule add\` does in one
    act -- it writes the gitlink AND the ${GITMODULES} row:

        git rm --cached ${offenders[0].path}
        git submodule add <url> ${offenders[0].path}

    Committing ${GITMODULES} is not optional: this gate reads the declaration
    out of the index, because a declaration that does not travel with the commit
    does not reach the clone that needs it.

⛔ Do not silence this by adding the path to a skip list -- there is none, on
purpose. The rule is about what a CLONE receives, and a path-shaped exemption
would be the one shape that cannot be true of the next path.`);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Builds throwaway git repos in a temp dir -- never inside this checkout -- and
// runs `scan()`, the SAME function main() calls, over them. The forward fixture
// is the card's own measurement reproduced: a nested repository plus a literal
// `git add -A`, so what is judged is what git really writes, not an index this
// file assembled to its own taste.

const SELF_TEST_VERDICT = 'check-gitlink-declared self-test reached its verdict';

// ── The self-test's own battery roster and floor ───────────────────────────
//
// `failures.length === 0` alone would make "every case held" and "the cases
// never ran" print the same line. What is pinned is the registered NAMES, not a
// number: every section opens with `battery('<name>')`, every assertion is
// attributed to the battery most recently opened, and the floor requires the
// OPENED set to equal the DECLARED set with each battery at or above its own
// count. The counts are a FLOOR -- adding cases is ordinary work and must not
// red; a battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  'direction 2: a bare gitlink fails, and the message names the path': 9,
  'direction 1: a declared submodule passes': 6,
  'the declaration must be in the INDEX, not merely on disk': 4,
  'the green is not vacuous, and it states its own scope': 6,
  'the parsers, on the shapes git really emits': 8,
  'one path is one finding, whatever the index is doing': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 6;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/**
 * A hermetic git repo at `dir`.
 *
 * `core.excludesFile` is pointed at an empty file INSIDE `.git` (never in the
 * working tree, which is the surface under test): `git add -A` consults the
 * user's global excludes, and a developer whose global excludes happen to list
 * `vendor/` would make the forward fixture pass for the wrong reason.
 *
 * The child environment drops `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE`
 * for the reason the production helper deliberately keeps them: an inherited
 * `GIT_INDEX_FILE` would retarget this fixture's own `git add`, silently.
 */
function initFixtureRepo(dir) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const run = (args) => execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  mkdirSync(dir, { recursive: true });
  run(['init', '-q']);
  writeFileSync(join(dir, '.git', 'empty-excludes'), '');
  run(['config', 'core.excludesFile', join(dir, '.git', 'empty-excludes')]);
  run(['config', 'user.email', 'selftest@objectstack.invalid']);
  run(['config', 'user.name', 'check-gitlink-declared self-test']);
  run(['config', 'commit.gpgsign', 'false']);
  return run;
}

function writeFile(root, rel, contents) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function selfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    checked++;
    if (!cond) failures.push(msg);
  };

  const dir = mkdtempSync(join(tmpdir(), 'check-gitlink-declared-selftest-'));
  try {
    // ── direction 2: a bare gitlink fails ────────────────────────────────
    //
    // The card's measurement, reproduced. The nested repository is at
    // `vendor/thing` rather than under `.worktrees/`, deliberately: the
    // untracked-signal half (PR #17468) ignores that one path, and the class
    // this gate is about generalises past it.
    battery('direction 2: a bare gitlink fails, and the message names the path');
    const outer = join(dir, 'outer');
    const run = initFixtureRepo(outer);
    writeFile(outer, 'readme.md', '# outer\n');
    run(['add', 'readme.md']);
    run(['commit', '-qm', 'init']);

    const nested = join(outer, 'vendor/thing');
    const runNested = initFixtureRepo(nested);
    writeFile(nested, 'inner.txt', 'inner\n');
    runNested(['add', 'inner.txt']);
    runNested(['commit', '-qm', 'inner']);

    // The literal command from the card. It succeeds, which is the defect.
    run(['add', '-A']);

    // The fixture is asserted before the gate is: without this, a run in which
    // `git add -A` staged nothing at all would look exactly like a gate that
    // works.
    const staged = parseIndexEntries(execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: outer, encoding: 'utf8' }));
    const stagedGitlinks = staged.filter((e) => e.mode === GITLINK_MODE);
    assert(
      stagedGitlinks.length === 1 && stagedGitlinks[0].path === 'vendor/thing',
      `the fixture really stages ONE gitlink at vendor/thing, got ${JSON.stringify(stagedGitlinks.map((e) => `${e.mode} ${e.path}`))}`,
    );
    assert(
      staged.some((e) => e.path === 'readme.md' && e.mode === '100644'),
      'the fixture also carries an ordinary blob, so the mode filter has something to reject',
    );
    assert(!staged.some((e) => e.path === GITMODULES), `the fixture stages no ${GITMODULES} -- that is the whole shape`);
    assert(
      !staged.some((e) => e.path.startsWith('vendor/thing/')),
      'what lands is the POINTER, not the nested tree -- the magnitude the card corrected',
    );

    const bare = scan(outer);
    assert(bare.offenders.length === 1, `an undeclared gitlink is a finding, got ${bare.offenders.length}`);
    assert(bare.offenders[0]?.path === 'vendor/thing', `the finding names the path, got ${bare.offenders[0]?.path}`);
    assert(bare.offenders[0]?.mode === GITLINK_MODE, `the finding carries the mode, got ${bare.offenders[0]?.mode}`);
    assert(bare.gitmodulesStaged === false, `${GITMODULES} is reported absent from the index`);
    assert(
      summarise(bare).includes('1 gitlink(s)') && summarise(bare).includes(`no ${GITMODULES} in the index`),
      `the scope line states both halves, got "${summarise(bare)}"`,
    );

    // ── direction 1: a declared submodule passes ─────────────────────────
    //
    // The SAME index, plus the row `git submodule add` would have written. The
    // cure has to be green or the prescription in the failure text is untested
    // and an author who follows it lands in the same red.
    battery('direction 1: a declared submodule passes');
    writeFile(outer, GITMODULES, '[submodule "vendor/thing"]\n\tpath = vendor/thing\n\turl = https://example.invalid/thing.git\n');
    run(['add', GITMODULES]);

    const declaredRun = scan(outer);
    assert(declaredRun.offenders.length === 0, `a declared submodule is green, got ${declaredRun.offenders.length} finding(s)`);
    assert(declaredRun.gitlinks.length === 1, 'the gitlink is still there -- it is DECLARED, not gone');
    assert(declaredRun.gitmodulesStaged === true, `${GITMODULES} is reported present in the index`);
    assert(
      declaredRun.declared.get('vendor/thing') === 'vendor/thing',
      `the declaration is read back by path, got ${JSON.stringify([...declaredRun.declared])}`,
    );
    assert(
      summarise(declaredRun).includes('1 submodule path(s) declared'),
      `the scope line states what was declared, got "${summarise(declaredRun)}"`,
    );

    // A declaration for a DIFFERENT path must not cover this one -- otherwise
    // the rule is "a .gitmodules exists", which is not a rule at all.
    writeFile(outer, GITMODULES, '[submodule "elsewhere"]\n\tpath = vendor/other\n\turl = https://example.invalid/other.git\n');
    run(['add', GITMODULES]);
    assert(
      scan(outer).offenders.map((o) => o.path).join() === 'vendor/thing',
      'a declaration naming another path does not cover this gitlink',
    );

    // ── the declaration must be in the INDEX ─────────────────────────────
    //
    // The load-bearing half of reading `.gitmodules` from the index: on disk
    // and unstaged, it vouches for nothing, because the clone that receives the
    // pointer does not receive it.
    battery('the declaration must be in the INDEX, not merely on disk');
    const onDisk = join(dir, 'ondisk');
    const runOnDisk = initFixtureRepo(onDisk);
    writeFile(onDisk, 'readme.md', '# ondisk\n');
    runOnDisk(['add', 'readme.md']);
    runOnDisk(['commit', '-qm', 'init']);
    const nested2 = join(onDisk, 'vendor/thing');
    const runNested2 = initFixtureRepo(nested2);
    writeFile(nested2, 'inner.txt', 'inner\n');
    runNested2(['add', 'inner.txt']);
    runNested2(['commit', '-qm', 'inner']);
    runOnDisk(['add', '-A']);
    // Written AFTER the `git add -A`, which is the whole mechanism of the
    // fixture: staging it would make it the case above instead of this one.
    writeFile(onDisk, GITMODULES, '[submodule "vendor/thing"]\n\tpath = vendor/thing\n\turl = https://example.invalid/thing.git\n');

    const unstaged = scan(onDisk);
    assert(
      unstaged.offenders.map((o) => o.path).join() === 'vendor/thing',
      'an unstaged .gitmodules does not declare anything -- the clone never sees it',
    );
    assert(unstaged.gitmodulesStaged === false, 'the file is on disk and reported as absent from the INDEX');
    assert(unstaged.declared.size === 0, 'nothing is read out of a declaration the index does not carry');
    // ...and it really was on disk the whole time. Without this the assertion
    // above would also pass for a file that was never written.
    runOnDisk(['add', GITMODULES]);
    assert(scan(onDisk).offenders.length === 0, 'staging that very file turns the same tree green -- only the index changed');

    // ── the green is not vacuous ─────────────────────────────────────────
    battery('the green is not vacuous, and it states its own scope');
    const clean = join(dir, 'clean');
    const runClean = initFixtureRepo(clean);
    writeFile(clean, 'readme.md', '# clean\n');
    writeFile(clean, 'src/app.ts', 'export const a = 1;\n');
    runClean(['add', '-A']);
    runClean(['commit', '-qm', 'init']);
    const cleanRun = scan(clean);
    assert(cleanRun.offenders.length === 0, 'an ordinary tree is green');
    assert(cleanRun.gitlinks.length === 0, 'an ordinary tree carries no gitlink');
    assert(cleanRun.entries === 2, `the population is the whole index, got ${cleanRun.entries}`);
    assert(
      summarise(cleanRun).includes(`0 gitlink(s) at mode ${GITLINK_MODE}`),
      `the zero case still names the gitlink half, got "${summarise(cleanRun)}"`,
    );
    assert(
      summarise(cleanRun).includes(`no ${GITMODULES} in the index`),
      `the zero case says why nothing is declared, got "${summarise(cleanRun)}"`,
    );
    // The scan reads the index, not the commit: a gitlink that has been staged
    // and not yet committed is exactly the moment this gate exists for.
    const nested3 = join(clean, 'vendor/late');
    const runNested3 = initFixtureRepo(nested3);
    writeFile(nested3, 'inner.txt', 'inner\n');
    runNested3(['add', 'inner.txt']);
    runNested3(['commit', '-qm', 'inner']);
    runClean(['add', '-A']);
    assert(
      scan(clean).offenders.map((o) => o.path).join() === 'vendor/late',
      'a gitlink that is staged but not committed is already a finding -- the index is the subject',
    );

    // ── the parsers ──────────────────────────────────────────────────────
    battery('the parsers, on the shapes git really emits');
    const oneRecord = `100644 45b983be36b73c0788dc9cbcb76cbb80fc7bb057 0\treadme.md${NUL}`;
    assert(parseIndexEntries(oneRecord).length === 1, 'one NUL-terminated record parses to one entry');
    assert(parseIndexEntries(oneRecord)[0].path === 'readme.md', 'the path is everything after the TAB');
    assert(parseIndexEntries(oneRecord)[0].mode === '100644', 'the mode is the first field');
    assert(parseIndexEntries('').length === 0, 'an empty index parses to no entries');
    assert(
      parseIndexEntries(`160000 6efd0388dd9d83c7a36895de09dadb676c8a3e26 0\ta path\twith tabs${NUL}`)[0].path
        === 'a path\twith tabs',
      'a path containing a TAB survives -- the split is on the FIRST tab only',
    );
    assert(
      parseDeclaredPaths(`submodule.vendor/thing.path\nvendor/thing${NUL}`).get('vendor/thing') === 'vendor/thing',
      'a declaration record parses to path -> name',
    );
    assert(
      parseDeclaredPaths(`submodule.a.b.path\nvendor/x${NUL}`).get('vendor/x') === 'a.b',
      'a submodule NAME containing a dot is read whole',
    );
    assert(
      parseDeclaredPaths(`submodule.x.path\nvendor/x/${NUL}`).has('vendor/x'),
      'a trailing slash names the same entry',
    );

    // ── one path is one finding ───────────────────────────────────────────
    //
    // A conflicted index carries the same path at stages 1, 2 and 3. Asserted
    // on the pure function rather than on a real conflict fixture: the shape
    // under test is the ENTRY LIST, and building a submodule merge conflict to
    // produce it would test git's conflict machinery instead.
    battery('one path is one finding, whatever the index is doing');
    const conflicted = [1, 2, 3].map((stage) => ({ mode: GITLINK_MODE, oid: 'a'.repeat(40), stage: String(stage), path: 'vendor/thing' }));
    assert(findOffenders(conflicted, new Map()).length === 1, 'a path at three conflict stages is ONE finding');
    assert(
      findOffenders(conflicted, new Map([['vendor/thing', 'vendor/thing']])).length === 0,
      'a declaration covers every stage of the path it names',
    );
    assert(
      findOffenders(
        [{ mode: GITLINK_MODE, oid: 'b'.repeat(40), stage: '0', path: 'a' }, { mode: GITLINK_MODE, oid: 'c'.repeat(40), stage: '0', path: 'b' }],
        new Map(),
      ).map((o) => o.path).join() === 'a,b',
      'two distinct paths stay two findings, in index order',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases ───────────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now skips) '
        + 'and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ check-gitlink-declared --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-gitlink-declared --self-test: ${checked} assertions over throwaway git repos (real scan() path)`);

  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing.
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-gitlink-declared self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else if (process.argv.includes('--list')) {
  const result = scan(repoRoot());
  for (const entry of result.gitlinks) {
    const name = result.declared.get(entry.path);
    const verdict = name === undefined ? 'UNDECLARED' : `declared as "${name}"`;
    console.log(`${GITLINK_MODE}  ${entry.oid.slice(0, 8)}  ${entry.path}  ${verdict}`);
  }
  for (const [path, name] of result.declared) {
    if (result.gitlinks.some((e) => e.path === path)) continue;
    // Reported, never a finding: a declaration with no gitlink beside it is a
    // different defect with a different subject, and this gate refuses exactly
    // one thing.
    console.log(`------  --------  ${path}  declared as "${name}" with NO gitlink in the index`);
  }
  console.log(`\n${summarise(result)}`);
} else {
  main();
}
