#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-rehearsal-clone.mjs — refuse a doomed `pnpm run version` rehearsal
 * with a diagnosis instead of letting it hang, and (in a throwaway clone)
 * repair the clone so the rehearsal runs (#9555).
 *
 *   node scripts/pm/release-rehearsal-clone.mjs [<repo>]            # diagnose only (default)
 *   node scripts/pm/release-rehearsal-clone.mjs --prepare [<repo>]  # diagnose, then repair
 *   node scripts/pm/release-rehearsal-clone.mjs --self-test         # verify the verdicts offline
 *
 * `<repo>` defaults to the current directory. Exit codes: **0** the clone is fit
 * for a rehearsal · **2** unfit, findings printed · **1** usage / environment.
 *
 * ## The trap this exists to end (measured 2026-08-18, this container)
 *
 * `changeset version` resolves an add-commit for every consumed changeset to
 * build changelog links. `@changesets/git` (v4.0.0, the version this repo's
 * pnpm-lock resolves) does it per path with
 *
 *     git log --diff-filter=A --max-count=1 --pretty=format:%H:%p <path>
 *
 * and then branches on whether that commit has a PARENT. A parentless commit is
 * treated as possibly the boundary of a shallow clone rather than the real add,
 * so it calls `deepenCloneBy({ by: 50 })` (`git fetch --deepen=50`) and retries
 * those paths — accepting them only once the repo is no longer shallow. The
 * retry sits in a `do … while (true)` with no attempt counter and no progress
 * check, so a deepen that gains nothing loops forever.
 *
 * In an agent container every clone descends from `/home/user/objectstack`,
 * which is itself shallow, so `.git/shallow` is inherited and EVERY
 * `.changeset/*.md` resolves to the parentless boundary commit. What decides
 * hang-vs-finish is then whether deepening can gain history, and all three
 * shapes available here gain none — **silently, exiting 0**:
 *
 *   | deepen attempt                              | measured        | history gained |
 *   |---------------------------------------------|-----------------|----------------|
 *   | no remote configured at all                 | 0.009 s, exit 0 | none           |
 *   | origin = the local shallow checkout         | 0.36 s,  exit 0 | none           |
 *   | `git fetch --unshallow` from that same source | 0.275 s, exit 0 | none         |
 *
 * So the loop is genuinely infinite rather than slow, it prints no error, and it
 * burns CPU the whole time — five changeset paths did not resolve in 30 s wall
 * (22.6 s user). That is what makes it expensive: it reads as O(packages ×
 * changesets) progress. The first attempt on the filing card was allowed to run
 * 70 minutes; diagnosis cost ~2.5 h across two attempts.
 *
 * ## The two remedies, both measured on the real tree (127 changesets)
 *
 *   1. **Unshallow from the real remote** — `git fetch --unshallow` against
 *      github.com in a throwaway clone: 10.2 s, +36 MB, 9952 commits, repo no
 *      longer shallow; all 127 changesets then resolve in 3.9 s **to their real
 *      add-commits**, so a rehearsal's changelog links are the ones a real cut
 *      would produce. Preferred when the network is reachable.
 *   2. **The offline scaffold** — give every changeset an add-commit that has a
 *      parent, by untracking and re-adding `.changeset` as two commits. The net
 *      tree is unchanged (asserted here: identical tree hash before and after);
 *      all 127 changesets resolve in 3.5 s, but they all resolve to the SAME
 *      fabricated commit, so changelog links are placeholders. Costs no network.
 *
 * `--prepare` applies remedy 2 (plus the base-branch fix below) and is refused
 * on anything that looks like a real working checkout — see "Safety" — because
 * fabricated commits belong only in a clone that is about to be deleted.
 *
 * ## The second symptom, which arrives FIRST
 *
 * `changeset status` never reaches the loop above; it dies earlier in
 * `getDivergedCommit(config.baseBranch)`, which is `git merge-base main HEAD`.
 * A throwaway clone of a container checkout inherits that checkout's current
 * branch and has **no local `main` at all** ("fatal: Not a valid object name
 * main"); a worktree of it has a `main` stale enough to share no merge base.
 * The workaround that looks like it works is the expensive one: `--since
 * origin/main` exits 0 and reports NOTHING, because `@changesets/read` uses
 * `sinceRef` to restrict which changesets it reads at all — an empty plan
 * ("releases by type: {}") reads exactly like "no packages to release". One
 * `git branch -f main HEAD` inside the throwaway clone restores the real answer.
 *
 * ## Not a production defect, and not wired into `pnpm run version`
 *
 * `cut-rc.yml` and `release.yml` check out with `fetch-depth: 0`, so the real
 * cut has full history and never enters this branch. This is a LOCAL rehearsal
 * trap — but a throwaway-clone rehearsal is the prescribed verification route
 * for release-machinery changes, so it sits on the path of every card in that
 * area. The refusal is therefore a preflight the recipe runs (see
 * `docs/releases-maintenance.md`, "Rehearsing the version pass"), not a prefix
 * on the `version` script: that script is declared territory of the
 * `@changesets/cli` v3 migration epic and is not this card's to edit. If that
 * lane wants the refusal to be unmissable, the whole wiring is one prefix —
 * `node scripts/pm/release-rehearsal-clone.mjs --check && changeset version && …`
 * — and it costs ~1.1 s on a full-history checkout of this repo (126 changesets,
 * one `git log` each), which is what every CI checkout of it is.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = 'scripts/pm/release-rehearsal-clone.mjs';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Commit identity for the scaffold commits — a throwaway clone often has none. */
const SCAFFOLD_ID = [
  '-c', 'user.name=objectstack release rehearsal',
  '-c', 'user.email=rehearsal@objectstack.invalid',
  '-c', 'commit.gpgsign=false',
  // A rehearsal clone may inherit `core.hooksPath`; the scaffold is bookkeeping
  // inside a disposable clone and must not be judged by the repo's hooks. This
  // is deliberately NOT `--no-verify`, which would also disable them for any
  // commit a caller makes later in the same process.
  '-c', 'core.hooksPath=/nonexistent',
];

function git(repo, args, { allowFail = false, identity = false } = {}) {
  const argv = ['-C', repo, ...(identity ? SCAFFOLD_ID : []), ...args];
  try {
    const stdout = execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout: String(stdout), stderr: '' };
  } catch (err) {
    if (!allowFail) {
      throw new Error(`git ${args.join(' ')} failed in ${repo}:\n${String(err.stderr || err.message).trim()}`);
    }
    return { ok: false, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

function isGitRepo(repo) {
  return existsSync(repo) && git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).stdout.trim() === 'true';
}

function isShallow(repo) {
  return git(repo, ['rev-parse', '--is-shallow-repository'], { allowFail: true }).stdout.trim() === 'true';
}

/**
 * The changeset files `changeset version` will resolve add-commits for.
 * `README.md` and `config.json` are changesets' own bookkeeping and are not
 * consumed as changesets, so they are excluded — the verdict must be about the
 * files that actually enter the loop.
 */
function changesetPaths(repo) {
  const out = git(repo, ['ls-files', '--', '.changeset/*.md'], { allowFail: true }).stdout;
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((p) => !/(^|\/)README\.md$/i.test(p));
}

/** The exact resolution `@changesets/git` performs, per path. */
function addCommit(repo, path) {
  const out = git(repo, ['log', '--diff-filter=A', '--max-count=1', '--pretty=format:%H:%p', '--', path], {
    allowFail: true,
  }).stdout.trim();
  const [sha = '', parents = ''] = out.split(':');
  return { sha: sha.trim(), parents: parents.trim() };
}

function classifyRemote(name, url) {
  if (url.startsWith('file://')) {
    let path = url;
    try {
      path = fileURLToPath(url);
    } catch {
      path = url.slice('file://'.length);
    }
    return { name, url, kind: 'local', path };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^[^/\\]+@[^:]+:/.test(url)) return { name, url, kind: 'network' };
  return { name, url, kind: 'local', path: resolve(url) };
}

function remotes(repo) {
  const names = git(repo, ['remote'], { allowFail: true }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return names.map((name) => {
    const url = git(repo, ['remote', 'get-url', name], { allowFail: true }).stdout.trim();
    const remote = classifyRemote(name, url);
    if (remote.kind === 'local') {
      remote.reachable = isGitRepo(remote.path) || existsSync(join(remote.path, 'HEAD'));
      remote.shallow = remote.reachable ? isShallow(remote.path) : null;
    }
    return remote;
  });
}

/** changesets' configured base branch — the ref `changeset status` diverges from. */
function baseBranch(repo) {
  try {
    const cfg = JSON.parse(readFileSync(join(repo, '.changeset', 'config.json'), 'utf8'));
    if (typeof cfg.baseBranch === 'string' && cfg.baseBranch.trim()) return cfg.baseBranch.trim();
  } catch {
    /* fall through to the changesets default */
  }
  return 'main';
}

/**
 * Can `git fetch --deepen` gain history here? Measured, not assumed: a fetch
 * with no remote, or from a source that is itself shallow, exits 0 and gains
 * nothing — which is exactly the state that turns the retry into an infinite
 * loop.
 */
function deepenCapability(repoRemotes) {
  if (repoRemotes.length === 0) {
    return { verdict: 'none', why: 'no remote is configured — `git fetch --deepen=50` exits 0 and fetches nothing (measured 0.009 s)' };
  }
  const network = repoRemotes.filter((r) => r.kind === 'network');
  if (network.length > 0) {
    return {
      verdict: 'maybe',
      why: `remote '${network[0].name}' is a network URL, so deepening can gain history — but only over repeated 50-commit fetches`,
    };
  }
  const usable = repoRemotes.filter((r) => r.kind === 'local' && r.reachable && r.shallow === false);
  if (usable.length > 0) {
    return { verdict: 'yes', why: `local remote '${usable[0].name}' has full history` };
  }
  const shallowSources = repoRemotes.filter((r) => r.kind === 'local' && r.shallow === true);
  if (shallowSources.length > 0) {
    return {
      verdict: 'none',
      why: `every remote is a local clone that is ITSELF shallow ('${shallowSources[0].name}' → ${shallowSources[0].path}); deepening from it exits 0 and lands on the same parentless boundary (measured 0.36 s, no commits gained)`,
    };
  }
  return { verdict: 'none', why: 'no remote resolves to a readable repository, so deepening cannot gain history' };
}

function diagnose(repo) {
  const facts = {
    repo,
    shallow: isShallow(repo),
    changesets: changesetPaths(repo),
    remotes: remotes(repo),
    baseBranch: baseBranch(repo),
  };
  facts.parentless = facts.changesets.filter((p) => {
    const { sha, parents } = addCommit(repo, p);
    return sha !== '' && parents === '';
  });
  facts.deepen = deepenCapability(facts.remotes);
  // Whether the offline scaffold is even offerable here. `--prepare` refuses to
  // fabricate commits in anything that looks like a real checkout (see
  // `prepareRefusal`), so the advice must not name a command that will then
  // refuse — that is how a diagnosis loses its reader.
  facts.throwaway = facts.remotes.every((r) => r.kind !== 'network');

  const findings = [];

  // HANG-VERSION. Note the predicate is NOT "the clone is shallow": a shallow
  // clone whose changesets were all added after the boundary resolves on the
  // first pass and never enters the retry. The parentless add-commits are what
  // the loop reacts to, so they are what this asks about.
  if (facts.shallow && facts.parentless.length > 0) {
    const terminal = facts.deepen.verdict === 'none';
    findings.push({
      id: 'HANG-VERSION',
      headline: terminal
        ? '`changeset version` cannot terminate in this clone'
        : '`changeset version` will thrash in this clone before it finishes',
      detail: [
        `${facts.parentless.length} of ${facts.changesets.length} changeset(s) resolve to a PARENTLESS add-commit — the shallow boundary, not the real add.`,
        `e.g. ${facts.parentless[0]} → ${addCommit(repo, facts.parentless[0]).sha || '(none)'} (no parent)`,
        `@changesets/git answers that by deepening and retrying, in a loop with no attempt limit; here ${facts.deepen.why}.`,
        terminal
          ? 'So the retry never makes progress, no error is ever printed, and the process spins at full CPU until it is killed.'
          : 'So it terminates eventually, but each pass costs a network fetch and the run looks identical to a hang while it happens.',
      ],
      remedies: facts.throwaway
        ? [
            `git -C ${repo} fetch --unshallow    # faithful add-commits; measured 10.2 s / +36 MB on this repo`,
            `node ${SELF} --prepare ${repo}    # offline scaffold; identical tree hash, placeholder links`,
          ]
        : [
            `git -C ${repo} fetch --unshallow    # faithful add-commits; measured 10.2 s / +36 MB on this repo`,
            `# this is a real checkout (network remote), so the offline scaffold is NOT offered here —`,
            `# clone it to a scratch directory first and run \`node ${SELF} --prepare <clone>\` on the clone.`,
          ],
    });
  }

  // STATUS-BASE-BRANCH.
  const base = facts.baseBranch;
  const baseExists = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], { allowFail: true }).ok;
  const mergeBase = baseExists ? git(repo, ['merge-base', base, 'HEAD'], { allowFail: true }) : null;
  if (!baseExists || !mergeBase.ok) {
    findings.push({
      id: 'STATUS-BASE-BRANCH',
      headline: `\`changeset status\` cannot answer here — local '${base}' ${baseExists ? 'shares no merge base with HEAD' : 'does not exist'}`,
      detail: [
        `changesets resolves its plan from \`git merge-base ${base} HEAD\` (getDivergedCommit), which fails in this clone.`,
        'The workaround that looks green is the trap: `--since origin/main` exits 0 and reports NOTHING, because @changesets/read',
        'uses sinceRef to restrict which changesets it reads at all — an empty plan reads as "no packages to release".',
      ],
      remedies: facts.throwaway
        ? [`git -C ${repo} branch -f ${base} HEAD    # a throwaway clone: point the base branch at HEAD`]
        : [`git -C ${repo} fetch origin ${base}:${base}    # a real checkout: fetch the base branch (never force it to HEAD)`],
    });
  }

  return { facts, findings };
}

function printReport(facts, findings, { stream = process.stdout } = {}) {
  const w = (line) => stream.write(`${line}\n`);
  const remoteSummary =
    facts.remotes.length === 0
      ? 'none'
      : facts.remotes
          .map((r) => `${r.name} → ${r.url} (${r.kind}${r.kind === 'local' ? (r.shallow ? ', itself shallow' : r.reachable ? ', full history' : ', unreadable') : ''})`)
          .join('; ');
  w(`release-rehearsal-clone: ${facts.repo}`);
  w(`  shallow: ${facts.shallow ? 'yes' : 'no'} · changesets: ${facts.changesets.length} · parentless add-commits: ${facts.parentless.length}`);
  w(`  base branch: ${facts.baseBranch} · remotes: ${remoteSummary}`);
  if (findings.length === 0) {
    w('');
    w('✓ FIT — a `pnpm run version` rehearsal can run here.');
    return;
  }
  for (const f of findings) {
    w('');
    w(`✗ UNFIT — ${f.headline}  [${f.id}]`);
    for (const line of f.detail) w(`    ${line}`);
    w('  Fix (choose one):');
    for (const r of f.remedies) w(`    ${r}`);
  }
  w('');
  w(`  Background: ${SELF}'s header, and docs/releases-maintenance.md → "Rehearsing the version pass".`);
}

/**
 * Safety: `--prepare` fabricates commits, so it runs ONLY where fabricated
 * commits are harmless — a throwaway clone taken from a local path, with a
 * clean tree. A checkout with a network remote is somebody's real working copy
 * (in this container, `/home/user/objectstack` itself is shallow AND has a
 * github.com origin), and the right answer there is `fetch --unshallow`, never
 * two scaffold commits on a live branch.
 */
function prepareRefusal(repo, facts) {
  const network = facts.remotes.filter((r) => r.kind === 'network');
  if (network.length > 0) {
    return [
      `refusing to fabricate commits in ${repo}: remote '${network[0].name}' is ${network[0].url}, so this is a real checkout, not a throwaway clone.`,
      `  Unshallow it instead:  git -C ${repo} fetch --unshallow    (measured 10.2 s / +36 MB)`,
      '  Or clone it to a scratch directory first and prepare THAT clone.',
    ].join('\n');
  }
  const dirty = git(repo, ['status', '--porcelain'], { allowFail: true }).stdout.trim();
  if (dirty) {
    return [
      `refusing to fabricate commits in ${repo}: the working tree has uncommitted changes.`,
      '  The scaffold commits `.changeset` wholesale; commit or clean the tree first.',
    ].join('\n');
  }
  return null;
}

function prepare(repo, facts, findings) {
  const applied = [];
  const hang = findings.find((f) => f.id === 'HANG-VERSION');
  if (hang) {
    const beforeHead = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
    const beforeTree = git(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    git(repo, ['rm', '-r', '--cached', '--quiet', '.changeset'], { identity: true });
    git(repo, ['commit', '-q', '-m', 'replay scaffold: untrack .changeset'], { identity: true });
    git(repo, ['add', '.changeset'], { identity: true });
    git(repo, ['commit', '-q', '-m', 'replay scaffold: re-add .changeset'], { identity: true });
    const afterTree = git(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    if (afterTree !== beforeTree) {
      git(repo, ['reset', '--hard', '--quiet', beforeHead], { allowFail: true, identity: true });
      throw new Error(
        `scaffold changed the tree (${beforeTree} → ${afterTree}) — rolled back to ${beforeHead}.\n` +
          '  The scaffold is only safe while it is a no-op on content; something under .changeset was untracked or ignored.',
      );
    }
    applied.push(`scaffold: .changeset re-added over two commits (tree unchanged: ${beforeTree})`);
  }
  const status = findings.find((f) => f.id === 'STATUS-BASE-BRANCH');
  if (status) {
    git(repo, ['branch', '-f', facts.baseBranch, 'HEAD'], { identity: true });
    applied.push(`base branch: ${facts.baseBranch} forced to HEAD`);
  }
  return applied;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      [
        `${SELF} — is this clone fit for a \`pnpm run version\` rehearsal?`,
        '',
        `  node ${SELF} [<repo>]            diagnose only (default; mutates nothing)`,
        `  node ${SELF} --prepare [<repo>]  diagnose, then repair a THROWAWAY clone`,
        `  node ${SELF} --self-test         verify the verdicts offline`,
        '',
        '  exit 0 = fit · 2 = unfit (findings printed) · 1 = usage/environment',
        '',
      ].join('\n'),
    );
    return 0;
  }
  if (args.includes('--self-test')) return selfTest();

  const doPrepare = args.includes('--prepare');
  // `--check` is accepted as an explicit spelling of the default so a caller can
  // wire the refusal into a command chain and read as intentional.
  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length > 1) {
    process.stderr.write(`✗ expected at most one <repo> argument, got ${positional.length}\n`);
    return 1;
  }
  const repo = resolve(positional[0] ?? process.cwd());
  if (!isGitRepo(repo)) {
    process.stderr.write(`✗ not a git working tree: ${repo}\n`);
    return 1;
  }

  let { facts, findings } = diagnose(repo);
  printReport(facts, findings);

  if (!doPrepare || findings.length === 0) return findings.length === 0 ? 0 : 2;

  const refusal = prepareRefusal(repo, facts);
  if (refusal) {
    process.stderr.write(`\n✗ ${refusal}\n`);
    return 2;
  }
  process.stdout.write('\n--prepare:\n');
  let applied;
  try {
    applied = prepare(repo, facts, findings);
  } catch (err) {
    process.stderr.write(`\n✗ ${err.message}\n`);
    return 1;
  }
  for (const line of applied) process.stdout.write(`    ${line}\n`);

  ({ facts, findings } = diagnose(repo));
  process.stdout.write('\nre-check:\n');
  printReport(facts, findings);
  return findings.length === 0 ? 0 : 2;
}

/* ── self-test ─────────────────────────────────────────────────────────────
 *
 * Fixtures are real git repositories, and both directions are pinned: a clone
 * in the trapped state must REFUSE with the diagnosis, and a clone that is fine
 * — including a SHALLOW one whose changesets were added after the boundary —
 * must pass, quickly and without being touched. A guard that fires on
 * `--is-shallow-repository` alone would fail that second half, which is why the
 * predicate is the parentless add-commit instead.
 */

const SELF_PATH = fileURLToPath(import.meta.url);

function runSelf(args) {
  try {
    const stdout = execFileSync(process.execPath, [SELF_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: String(stdout), stderr: '' };
  } catch (err) {
    return { status: err.status ?? 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

function fixtureCommit(repo, message) {
  git(repo, ['add', '-A'], { identity: true });
  git(repo, ['commit', '-q', '-m', message], { identity: true });
}

function writeFile(repo, rel, body) {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/**
 * A source repo shaped like this one: a `.changeset` directory whose entries
 * were added over several commits, then more work on top.
 */
function makeSource(root, name, { branch = 'main', changesetsInLastCommit = false } = {}) {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(root, ['init', '-q', '-b', 'main', repo]);
  writeFile(repo, '.changeset/config.json', `${JSON.stringify({ baseBranch: 'main' }, null, 2)}\n`);
  writeFile(repo, '.changeset/README.md', '# Changesets\n');
  writeFile(repo, 'src.txt', 'v1\n');
  fixtureCommit(repo, 'base');
  if (!changesetsInLastCommit) {
    writeFile(repo, '.changeset/one.md', '---\n"@scope/a": patch\n---\n\nfirst\n');
    fixtureCommit(repo, 'add changeset one');
    writeFile(repo, '.changeset/two.md', '---\n"@scope/b": minor\n---\n\nsecond\n');
    fixtureCommit(repo, 'add changeset two');
    writeFile(repo, 'src.txt', 'v2\n');
    fixtureCommit(repo, 'later work');
    writeFile(repo, 'src.txt', 'v3\n');
    fixtureCommit(repo, 'later work 2');
  } else {
    writeFile(repo, 'src.txt', 'v2\n');
    fixtureCommit(repo, 'later work');
    writeFile(repo, '.changeset/one.md', '---\n"@scope/a": patch\n---\n\nfirst\n');
    fixtureCommit(repo, 'add changeset one');
  }
  if (branch !== 'main') {
    git(repo, ['checkout', '-q', '-b', branch], { identity: true });
    writeFile(repo, 'src.txt', 'branch work\n');
    fixtureCommit(repo, 'branch work');
  }
  return repo;
}

function cloneOf(root, source, name, { depth = 0 } = {}) {
  const dest = join(root, name);
  const args = ['clone', '--quiet'];
  if (depth > 0) args.push(`--depth=${depth}`);
  args.push(`file://${source}`, dest);
  git(root, args);
  return dest;
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-clone-selftest-'));
  let failures = 0;
  const t = (name, cond, extra = '') => {
    if (cond) {
      process.stdout.write(`  ✓ ${name}\n`);
    } else {
      failures += 1;
      process.stdout.write(`  ✗ ${name}${extra ? `\n      ${extra.replace(/\n/g, '\n      ')}` : ''}\n`);
    }
  };

  try {
    const source = makeSource(root, 'source');

    // ── C1: the trapped shape refuses, and the check itself mutates nothing.
    // This is the container's shape exactly — a throwaway clone taken from a
    // checkout that is ITSELF shallow, so deepening from it gains nothing while
    // still exiting 0.
    const shallowSource = cloneOf(root, source, 'shallow-source', { depth: 1 });
    const trapped = cloneOf(root, shallowSource, 'trapped');
    t('fixture: a clone of a shallow checkout is itself shallow', isShallow(trapped));
    t(
      'fixture: its changeset add-commits really are parentless',
      addCommit(trapped, '.changeset/one.md').parents === '' && addCommit(trapped, '.changeset/one.md').sha !== '',
    );
    const headBefore = git(trapped, ['rev-parse', 'HEAD']).stdout.trim();
    const treeBefore = git(trapped, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    const check = runSelf([trapped]);
    t('C1 trapped clone → exit 2 (refusal), not 0', check.status === 2, `exit=${check.status}\n${check.stdout}`);
    t('C1 refusal names the mechanism and both remedies', /HANG-VERSION/.test(check.stdout) && /fetch --unshallow/.test(check.stdout) && /--prepare/.test(check.stdout), check.stdout);
    t('C1 refusal names the deepen dead end it measured', /itself shallow/.test(check.stdout), check.stdout);
    t('C1 the verdict is non-termination, not slowness', /cannot terminate/.test(check.stdout), check.stdout);
    t(
      'C1 the diagnosis mutates nothing',
      git(trapped, ['rev-parse', 'HEAD']).stdout.trim() === headBefore &&
        git(trapped, ['rev-parse', 'HEAD^{tree}']).stdout.trim() === treeBefore,
    );

    // ── C2: a healthy clone passes, and is not slowed.
    const healthy = cloneOf(root, source, 'healthy');
    const startedAt = Date.now();
    const healthyRun = runSelf([healthy]);
    const healthyMs = Date.now() - startedAt;
    t('C2 full clone → exit 0 (fit)', healthyRun.status === 0, `exit=${healthyRun.status}\n${healthyRun.stdout}${healthyRun.stderr}`);
    t('C2 fit verdict is stated, not implied', /✓ FIT/.test(healthyRun.stdout), healthyRun.stdout);
    t(`C2 a healthy tree is not slowed (${healthyMs} ms < 10000)`, healthyMs < 10_000);

    // ── C3: a SHALLOW clone whose changesets sit after the boundary is fit.
    // This is the no-crying-wolf half: `--is-shallow-repository` is true here.
    const lateSource = makeSource(root, 'source-late', { changesetsInLastCommit: true });
    const shallowButFine = cloneOf(root, lateSource, 'shallow-fine', { depth: 2 });
    const fineRun = runSelf([shallowButFine]);
    t('C3 shallow clone with parented add-commits → exit 0', fineRun.status === 0, `exit=${fineRun.status}\n${fineRun.stdout}`);
    t('C3 and it reports itself shallow while still passing', /shallow: yes/.test(fineRun.stdout), fineRun.stdout);

    // ── C4: --prepare repairs the trapped clone, leaving the tree byte-identical.
    const prep = runSelf(['--prepare', trapped]);
    t('C4 --prepare → exit 0', prep.status === 0, `exit=${prep.status}\n${prep.stdout}${prep.stderr}`);
    t(
      'C4 --prepare leaves the tree hash unchanged',
      git(trapped, ['rev-parse', 'HEAD^{tree}']).stdout.trim() === treeBefore,
    );
    t('C4 --prepare gives every changeset a parented add-commit', addCommit(trapped, '.changeset/one.md').parents !== '');
    t('C4 a re-check of the prepared clone is fit', runSelf([trapped]).status === 0);
    t('C4 the working tree is clean afterwards', git(trapped, ['status', '--porcelain']).stdout.trim() === '');

    // ── C5: the base-branch symptom, which `changeset status` hits first.
    const branchSource = makeSource(root, 'source-branch', { branch: 'work' });
    const noMain = cloneOf(root, branchSource, 'no-main');
    const noMainRun = runSelf([noMain]);
    t('C5 clone with no local base branch → exit 2', noMainRun.status === 2, `exit=${noMainRun.status}\n${noMainRun.stdout}`);
    t('C5 refusal names the silent-empty --since trap', /STATUS-BASE-BRANCH/.test(noMainRun.stdout) && /reports NOTHING/.test(noMainRun.stdout), noMainRun.stdout);
    const noMainPrep = runSelf(['--prepare', noMain]);
    t('C5 --prepare creates the base branch', noMainPrep.status === 0 && git(noMain, ['merge-base', 'main', 'HEAD'], { allowFail: true }).ok, noMainPrep.stdout + noMainPrep.stderr);

    // ── C6: --prepare refuses to fabricate commits in a real checkout.
    const realish = cloneOf(root, source, 'realish', { depth: 1 });
    git(realish, ['remote', 'set-url', 'origin', 'https://github.com/objectstack-ai/objectstack']);
    const realishHead = git(realish, ['rev-parse', 'HEAD']).stdout.trim();
    const realishRun = runSelf(['--prepare', realish]);
    t('C6 --prepare on a network-remote checkout → exit 2', realishRun.status === 2, `exit=${realishRun.status}`);
    t('C6 it refuses by name and points at --unshallow', /refusing to fabricate commits/.test(realishRun.stderr) && /fetch --unshallow/.test(realishRun.stderr), realishRun.stderr);
    t('C6 nothing was committed', git(realish, ['rev-parse', 'HEAD']).stdout.trim() === realishHead);
    const realishCheck = runSelf([realish]);
    t(
      'C6 the diagnosis for a real checkout does not advise the --prepare it would refuse',
      !realishCheck.stdout.includes(`--prepare ${realish}`) &&
        /fetch --unshallow/.test(realishCheck.stdout) &&
        /clone it to a scratch directory/.test(realishCheck.stdout),
      realishCheck.stdout,
    );

    // ── C7: --prepare refuses on a dirty tree.
    const dirty = cloneOf(root, source, 'dirty', { depth: 1 });
    writeFile(dirty, 'src.txt', 'uncommitted work\n');
    const dirtyHead = git(dirty, ['rev-parse', 'HEAD']).stdout.trim();
    const dirtyRun = runSelf(['--prepare', dirty]);
    t('C7 --prepare on a dirty tree → exit 2', dirtyRun.status === 2, `exit=${dirtyRun.status}`);
    t('C7 nothing was committed', git(dirty, ['rev-parse', 'HEAD']).stdout.trim() === dirtyHead);

    // ── C8: no remote at all is still a refusal — the measured silent no-op.
    const orphan = cloneOf(root, source, 'orphan', { depth: 1 });
    git(orphan, ['remote', 'remove', 'origin']);
    const orphanRun = runSelf([orphan]);
    t('C8 shallow clone with no remote → exit 2', orphanRun.status === 2, `exit=${orphanRun.status}\n${orphanRun.stdout}`);
    t('C8 and it says deepening fetches nothing', /no remote is configured/.test(orphanRun.stdout), orphanRun.stdout);

    // ── C9: usage.
    t('C9 a non-repository argument → exit 1, not a verdict', runSelf([join(root, 'nope')]).status === 1);
    t('C9 --help → exit 0', runSelf(['--help']).status === 0);

    // ── C10: wiring. A refusal nobody runs is the failure mode this card exists
    // to end, so the two places that invoke it are pinned here.
    const doc = join(REPO_ROOT, 'docs', 'releases-maintenance.md');
    const lint = join(REPO_ROOT, '.github', 'workflows', 'lint.yml');
    if (existsSync(doc)) {
      t('C10 the rehearsal doc names this script', readFileSync(doc, 'utf8').includes(SELF));
    }
    if (existsSync(lint)) {
      const body = readFileSync(lint, 'utf8');
      t('C10 lint.yml still runs this self-test', body.includes(SELF) && body.includes('--self-test'));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write(failures === 0 ? '\n✓ self-test passed\n' : `\n✗ self-test: ${failures} failure(s)\n`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = main(process.argv);
