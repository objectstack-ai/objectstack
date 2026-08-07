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
// Two diff statuses are judged, and the second one is why the rule is phrased
// about the SET of empty declarations rather than about added files:
//
//   A  added, empty at head                     -> violation (a new empty file)
//   M  empty at head, NON-empty at base         -> violation (emptied in place)
//   M  empty at head, already empty at base     -> exempt    (stock, untouched)
//   *  non-empty at head                        -> ok
//
// Row 2 costs a few lines and removes the obvious bypass: taking a stock
// non-empty changeset and deleting its frontmatter entries produces a brand-new
// empty declaration -- exactly the harm -- while `--diff-filter=A` alone sees
// nothing. Row 3 is what keeps the stock exempt even when a PR edits an existing
// empty file's prose, which is a legitimate thing to do and releases nothing new.
//
// ## Missing input is a failure, never a pass (#4690)
//
// An unresolvable base ref exits 1 rather than 0. A gate that cannot read its
// input has verified nothing, and exiting 0 there is the #4690 anti-pattern --
// a check that skips silently and reads as "no violations" in every checks list.
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
 * The entry regex is deliberately the SAME shape `check-changeset-no-major.mjs`
 * uses to find `major` bumps. Two gates reading the same block must agree on
 * what counts as a declaration, or one of them is judging a different file than
 * it appears to.
 *
 * A file with no opening `---` fence declares nothing either, and is reported as
 * its own kind so the message can say which of the two shapes it is.
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
    // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*([A-Za-z]+)\s*$/.exec(lines[j]);
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

// ── The scan ─────────────────────────────────────────────────────────────────

/**
 * Judge the changesets this diff introduces.
 *
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{ violations: {file: string, kind: string}[], exempt: string[], ok: string[] }}
 */
export function scan({ cwd, base, head = 'HEAD' }) {
  const out = git(['diff', '--name-status', '--diff-filter=AM', base, head, '--', '.changeset/*.md'], cwd);

  const violations = [];
  const exempt = [];
  const ok = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [status, file] = line.split('\t');
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

    // Modified. Exempt only if it was ALREADY an empty declaration at base --
    // i.e. this PR did not create the empty declaration, it inherited it.
    const baseText = showOrNull(base, file, cwd);
    if (baseText !== null && isEmptyDeclaration(baseText)) exempt.push(file);
    else violations.push({ file, kind: 'emptied' });
  }

  return { violations, exempt, ok };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const KIND_NOTE = {
  'added-empty': 'new file, empty frontmatter -- declares no package',
  'added-unfenced': 'new file, no frontmatter block at all -- declares no package',
  emptied: 'existing changeset emptied by this PR -- declares no package any more',
};

function report(violations) {
  console.error('This PR adds an empty-frontmatter changeset:\n');
  for (const { file, kind } of violations) console.error(`   ${file}\n     ${KIND_NOTE[kind]}`);
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
    // the row that keeps the exemption honest under `--diff-filter=AM`.
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

    // ── Parser unit rows ─────────────────────────────────────────────────────
    assert(isEmptyDeclaration('---\n---\n\nbody\n'), 'parser: the canonical empty shape is empty');
    assert(isEmptyDeclaration('\n---\n\n---\n\nbody\n'), 'parser: blank lines around/inside the fence stay empty');
    assert(!isEmptyDeclaration(DECLARING), 'parser: a declaring changeset is not empty');
    assert(
      !isEmptyDeclaration("---\n'@objectstack/cli': patch\n---\n\nbody\n"),
      'parser: single-quoted package names count as a declaration',
    );
    assert(
      !isEmptyDeclaration('---\n"@objectstack/spec": minor\n"@objectstack/cli": patch\n---\n\nbody\n'),
      'parser: multiple declarations count',
    );
    assert(declaredBumpsIn('no fence here\n').fenced === false, 'parser: a fenceless file reports fenced=false');

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
      if (base) break;
    }
    if (!base) {
      console.error('⛔ check-empty-changeset: no base to diff against (tried origin/main, main).');
      console.error("   Pass one explicitly: --base <ref-or-sha>. Missing input is a failure, never a pass (#4690).");
      process.exit(1);
    }
  }

  const { violations, exempt, ok } = scan({ cwd: REPO_ROOT, base, head });
  if (violations.length) {
    report(violations);
    process.exit(1);
  }
  const parts = [`${ok.length} declaring changeset(s) added`];
  if (exempt.length) parts.push(`${exempt.length} pre-existing empty changeset(s) touched but exempt`);
  console.log(`✓ No empty-frontmatter changeset introduced by this diff (${parts.join(', ')}).`);
}
