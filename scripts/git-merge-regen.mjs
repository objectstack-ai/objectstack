#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `merge=os-regen` — the merge driver for generator-owned artifacts (#4675).
 *
 * ## The problem
 *
 * `packages/spec`'s checked-in artifacts are sorted arrays and append-only
 * ledgers. Two PRs each adding a few lines is a set union, semantically
 * composable — but git sees a text conflict. Measured on one afternoon
 * (2026-08-02): four merges, nine conflicts across those files, and NOT ONE of
 * them was a real semantic conflict. Every correct resolution was the same
 * three steps: throw away both sides, re-run the generator, re-run the gates —
 * a dozen-plus minutes each, on a `main` moving fast enough that the rerun could
 * itself go stale.
 *
 * ## Why this driver does not regenerate
 *
 * The obvious implementation — "on conflict, run the generator" — is wrong, and
 * measurably so. Git invokes merge drivers **while** it is merging, in index
 * order, and the worktree still holds the pre-merge sources at that moment.
 * `packages/spec/spec-changes.json` sorts before `packages/spec/src/...`
 * (`'p' < 'r'`), so a driver that shelled out to `gen:spec-changes` would read a
 * `src/migrations/registry.ts` with the incoming side's retirements MISSING and
 * write a confidently wrong artifact. Verified directly:
 *
 *     driver invoked for packages/spec/spec-changes.json
 *     worktree src/registry.ts at that moment:  <ours only — theirs not merged>
 *
 * That is worse than the conflict it replaces. A conflict marker is a visible
 * error; a plausible-looking generated file is an invisible one, and this repo
 * already has the scar: on #4687 a `gen:api-surface` run against an incomplete
 * `dist` silently dropped an unrelated `./studio` export and ratcheted a
 * baseline exemption in to cover the hole. Nothing failed. It was caught by
 * diffing generated files against `main`.
 *
 * ## What it does instead
 *
 * Defer. The driver resolves the path (no text merge, no markers, exit 0) and
 * records it in `$GIT_DIR/os-regen-pending`. Regeneration happens later, from
 * the fully-merged tree — the only state in which it is correct — and the
 * `pre-commit` hook refuses the commit until it has. So the rework disappears
 * without the artifact's currency ever resting on someone remembering.
 *
 * The content left behind is OURS, chosen only because git pre-fills it there.
 * It is a placeholder, not an answer: correctness comes from the mandatory
 * regeneration, and three independent things enforce it — the pending marker,
 * the `pre-commit` hook, and the `check:*` gates that already run on every PR.
 *
 * ## Usage
 *
 *   node scripts/git-merge-regen.mjs %O %A %B %P   # invoked by git, never by hand
 *   node scripts/git-merge-regen.mjs --self-test   # reconcile + end-to-end merge proof
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OWNER,
  DRIVER_NAME,
  GIT_SETTINGS,
  NOT_DRIVER_MANAGED,
  PENDING_MARKER,
  REGEN_ARTIFACTS,
  ROOT_OWNER,
  entryForPath,
  ownerDir,
  ownerOf,
  ownerRunCommand,
} from './regen-artifacts.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function gitDir(cwd = process.cwd()) {
  // In a linked worktree this resolves to `.git/worktrees/<name>`, which is what
  // we want: the marker is per-worktree, so parallel agents never see each
  // other's pending regenerations.
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }).trim();
}

/** Record `path` as needing regeneration. Idempotent — a path is listed once. */
function markPending(path, cwd = process.cwd()) {
  const marker = join(gitDir(cwd), PENDING_MARKER);
  const existing = existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [];
  if (existing.includes(path)) return marker;
  appendFileSync(marker, `${path}\n`);
  return marker;
}

function drive(argv) {
  // %O %A %B %P — ancestor, ours (also the OUTPUT file), theirs, pathname.
  const path = argv[3];
  if (!path) {
    console.error('git-merge-regen: no %P pathname — check the `merge.os-regen.driver` config.');
    return 1;
  }

  const entry = entryForPath(path);
  if (!entry) {
    // `.gitattributes` routed a path here that the table does not own. Refusing
    // is the only safe answer: resolving it would silently keep one side of a
    // file nobody proved is regenerable.
    console.error(
      `git-merge-regen: ${path} is mapped to merge=os-regen but is absent from scripts/regen-artifacts.mjs.\n`
        + '  Leaving it CONFLICTED rather than guessing. Run `node scripts/git-merge-regen.mjs --self-test`.',
    );
    return 1;
  }

  markPending(path);

  const dist = entry.readsDist
    ? '\n     (this one is built from dist/*.d.ts — the regeneration will refuse on a stale build)'
    : '';
  // The json-schema/ tree is gitignored, so a merge never carries it: whatever is
  // on disk describes one side of the merge. Name the prerequisite here rather
  // than let the reader discover it from the generator's refusal (#4723).
  const tree = entry.readsSchemaTree
    ? '\n     (this one renders from the gitignored packages/spec/json-schema/ tree —'
      + '\n      run `pnpm --filter @objectstack/spec gen:schema` first, or it will refuse)'
    : '';
  console.error(
    `  ⟳ ${path}\n`
      + `     not text-merged — it is generated. Regenerate from the merged tree:\n`
      + `       ${ownerRunCommand(ownerOf(entry), entry.gen)}${dist}${tree}\n`
      + `     The pre-commit hook will not let this commit through until you do.`,
  );
  return 0;
}

/* ------------------------------------------------------------------ self-test */

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  return false;
}

/** `.gitattributes` and the table must name the same paths — in both directions. */
function reconcileAttributes() {
  const file = join(REPO_ROOT, '.gitattributes');
  if (!existsSync(file)) return fail('.gitattributes is missing — the driver is mapped to nothing.');
  const mapped = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .filter((l) => /\bmerge=os-regen\b/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);

  const declared = REGEN_ARTIFACTS.map((e) => e.path);
  const missing = declared.filter((p) => !mapped.includes(p));
  const extra = mapped.filter((p) => !declared.includes(p));
  let ok = true;
  if (missing.length) {
    ok = fail(`declared in regen-artifacts.mjs but not mapped in .gitattributes: ${missing.join(', ')}\n`
      + '  Those paths still text-merge — the table says otherwise.');
  }
  if (extra.length) {
    ok = fail(`mapped to merge=os-regen but not declared in regen-artifacts.mjs: ${extra.join(', ')}\n`
      + '  The driver refuses unknown paths, so those merges would CONFLICT with no explanation.');
  }
  // A path cannot be both driver-managed and deliberately excluded.
  const overlap = NOT_DRIVER_MANAGED.map((e) => e.path).filter((p) => declared.includes(p));
  if (overlap.length) ok = fail(`listed as BOTH driver-managed and NOT_DRIVER_MANAGED: ${overlap.join(', ')}`);
  if (ok) console.log(`✓ .gitattributes ↔ regen-artifacts.mjs agree on ${declared.length} path(s)`);
  return ok;
}

/** Where an owner's manifest lives, repo-relative, given a resolved directory. */
function manifestFor(dir) {
  return dir === '.' ? 'package.json' : `${dir}/package.json`;
}

/**
 * Every `gen:`/`check:` the table names must still exist **in the manifest of the
 * row's declared owner**, or the driver's advice is a dead command.
 *
 * Resolution read `packages/spec/package.json` and nothing else until #13585, which
 * made a root-owned artifact unregisterable and said so in a way that pointed at the
 * wrong repair — "you named a script that does not exist" when the truth was "this
 * artifact is not owned by packages/spec". Two things follow from that, and the
 * second is the one worth guarding:
 *
 *   - resolution reads the owner's manifest, whichever that is; and
 *   - the refusal NAMES the manifests it searched, so the reader can see that the
 *     lookup went somewhere else rather than conclude the script is missing.
 *
 * It stays exact in the direction that matters. A name is looked for in ONE
 * manifest — the declared owner's — never in "any manifest that has it", so a row
 * that names a root-only script while claiming a package owner still fails, and the
 * command the driver prints for it is the command the `pre-commit` gate spawns.
 */
function reconcileScripts() {
  const workspace = workspacePackages(REPO_ROOT);
  const byOwner = new Map();
  for (const e of REGEN_ARTIFACTS) {
    const owner = ownerOf(e);
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(e);
  }

  const dead = [];
  const unresolved = [];
  const searched = [];
  for (const [owner, entries] of byOwner) {
    const dir = ownerDir(owner, workspace);
    const file = dir === null ? null : join(REPO_ROOT, manifestFor(dir));
    if (file === null || !existsSync(file)) {
      unresolved.push(`${owner} — declared by ${entries.map((e) => e.path).join(', ')}`);
      continue;
    }
    searched.push(`${owner} (${manifestFor(dir)})`);
    const scripts = JSON.parse(readFileSync(file, 'utf8')).scripts ?? {};
    for (const e of entries) {
      for (const name of [e.gen, e.check]) {
        if (!scripts[name]) dead.push(`${e.path} → ${name}   [owner ${owner}, ${manifestFor(dir)}]`);
      }
    }
  }

  if (unresolved.length) {
    return fail(`owner(s) named by the table resolve to no manifest:\n  ${unresolved.join('\n  ')}\n`
      + '  An owner is a workspace package name, or ROOT_OWNER for the root manifest.\n'
      + '  Unresolved is a REFUSAL, not a skip: those rows\' scripts were never verified.');
  }
  if (dead.length) {
    return fail(`script(s) named by the table do not exist in their declared owner:\n  ${dead.join('\n  ')}\n`
      + `  Manifests searched: ${searched.join(', ')}\n`
      + `  A row that declares no \`owner\` defaults to ${DEFAULT_OWNER}, so this can mean the row is\n`
      + '  in the wrong package rather than that the script is gone. If ROOT tooling owns the\n'
      + '  artifact, declare it — `owner: ROOT_OWNER` in scripts/regen-artifacts.mjs. ⛔ Do NOT move\n'
      + '  the scripts into a package to satisfy the lookup: that lets this tool decide code ownership.');
  }
  console.log(`✓ all ${REGEN_ARTIFACTS.length * 2} gen:/check: names resolve in their declared owner`
    + ` (${searched.join(', ')})`);
  return true;
}

/**
 * The owner-resolution rule itself, pinned — the half a live tree cannot show.
 *
 * `reconcileScripts` above is green on this tree for the same reason it was green
 * before #13585: every row is spec-owned, so it exercises exactly one manifest and
 * would keep passing if the loosening were reverted. These cases read the REAL root
 * manifest through the same functions the driver and the `pre-commit` gate use, so
 * the root path is measured on every run rather than the first time somebody
 * registers a root-owned artifact.
 *
 * The two-way case is the third one. A permissive lookup — "resolve the name in any
 * manifest" — passes every other assertion here and fails that one, which is the
 * whole difference between a resolution and a search.
 */
function reconcileOwnership() {
  const workspace = workspacePackages(REPO_ROOT);
  const rootScripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const specDir = ownerDir(DEFAULT_OWNER, workspace);
  const specScripts = specDir === null
    ? {}
    : JSON.parse(readFileSync(join(REPO_ROOT, manifestFor(specDir)), 'utf8')).scripts ?? {};
  // A name this repo defines at the ROOT and nowhere else. Asserted, not assumed:
  // if it ever moves into a package, the assertion below says so instead of quietly
  // testing nothing.
  const rootOnly = 'check:merge-driver';

  const cases = [
    ['ROOT_OWNER is the root manifest\'s own name', rootScripts.name === ROOT_OWNER],
    ['the root manifest resolves to the repo root', ownerDir(ROOT_OWNER, workspace) === '.'],
    [`${DEFAULT_OWNER} resolves to a workspace directory`, specDir !== null && specDir !== '.'],
    ['a row with no owner defaults to DEFAULT_OWNER', ownerOf({ path: 'x' }) === DEFAULT_OWNER],
    ['a declared owner is used verbatim', ownerOf({ owner: ROOT_OWNER }) === ROOT_OWNER],
    [`${rootOnly} exists in the root manifest`, Boolean(rootScripts.scripts?.[rootOnly])],
    // ⭐ The two-way case: resolution is per-owner, not "wherever the name turns up".
    [`${rootOnly} is NOT resolvable under ${DEFAULT_OWNER}`, !specScripts[rootOnly]],
    ['an unknown owner refuses rather than skipping', ownerDir('@objectstack/not-a-package', workspace) === null],
    ['the root command takes no --filter', ownerRunCommand(ROOT_OWNER, 'gen:x') === 'pnpm gen:x'],
    [
      'a package command filters to its owner',
      ownerRunCommand(DEFAULT_OWNER, 'gen:x') === `pnpm --filter ${DEFAULT_OWNER} gen:x`,
    ],
    ['a spawn asks for silence', ownerRunCommand(ROOT_OWNER, 'check:x', { silent: true }) === 'pnpm -s check:x'],
  ];

  const failures = cases.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length) return fail(`owner resolution:\n  ${failures.join('\n  ')}`);
  console.log(`✓ owner resolution: ${cases.length} case(s) pinned, root manifest read as ${ROOT_OWNER}`);
  return true;
}

/**
 * The hook must be executable **in the index**, not just on this disk. Git
 * silently ignores a non-executable hook — it prints an `advice.ignoredHook`
 * hint and proceeds, so the deferred regeneration stops being mandatory and
 * nothing fails. Caught exactly that way while testing this change: both e2e
 * commits went through with the hook installed and inert.
 */
function hookIsExecutable() {
  try {
    const mode = execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];
    if (mode !== '100755') {
      return fail(`.githooks/pre-commit is mode ${mode || '<untracked>'} in the index, not 100755.\n`
        + '  Git IGNORES a non-executable hook — the pre-commit half is disarmed and says nothing.\n'
        + '  Fix: git update-index --chmod=+x .githooks/pre-commit');
    }
    console.log('✓ .githooks/pre-commit is executable in the index (100755)');
    return true;
  } catch (err) {
    return fail(`could not stat .githooks/pre-commit: ${err?.message ?? err}`);
  }
}

/**
 * The driver registered in THIS clone must resolve — here, now (#4868).
 *
 * Every other check in this self-test builds a throwaway repo and registers its own
 * driver into it, so all of them stayed green for weeks while the real
 * `merge.os-regen.driver` in the shared `.git/config` pointed at a DELETED worktree
 * and every real merge of a `merge=os-regen` path died with MODULE_NOT_FOUND. The
 * self-test and the live merge path were simply not the same path. This check reads
 * the live one, which is the only reason it can catch that class of failure.
 *
 * It fails in three distinguishable ways, all of which have happened or are one
 * `pnpm install` away:
 *   - the script the value names does not exist (the dangling-worktree bug);
 *   - it exists but lives outside this worktree (bound to someone else's worktree —
 *     green for whoever installed last, broken for everyone else, so this is the
 *     check that catches the bug *before* the other worktree is removed);
 *   - the value has drifted from what `setup-git-hooks.mjs` registers.
 */
function registeredDriverResolves() {
  const { key, value: expected } = GIT_SETTINGS.find((s) => s.key === `merge.${DRIVER_NAME}.driver`);

  let actual = '';
  try {
    actual = execFileSync('git', ['config', '--get', key], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    actual = ''; // unset — `git config --get` exits 1
  }

  if (!actual) {
    // A supported state, not a failure: git falls back to a text merge, which is
    // exactly the pre-#4675 behaviour. `pnpm install` registers it.
    console.log(`✓ ${key} is unregistered — merges text-merge as they did before #4675`);
    return true;
  }

  const expansion = expandDriverScript(actual);
  if (expansion.skip) {
    console.log(`✓ ${key} not checked for resolution (${expansion.skip})`);
    return true;
  }
  if (expansion.error) return fail(`could not expand ${key} ("${actual}"): ${expansion.error}`);

  const script = expansion.path;
  if (!existsSync(script)) {
    return fail(`${key} names a script that does not exist:\n`
      + `    ${script}\n`
      + `  Registered value: ${actual}\n`
      + '  Every merge touching a merge=os-regen path in this clone dies with MODULE_NOT_FOUND,\n'
      + '  and git leaves the path CONFLICTED with ours in it and no conflict markers.\n'
      + '  Fix: pnpm install  (re-registers the driver for this worktree)');
  }

  const root = realpath(REPO_ROOT);
  if (relative(root, realpath(script)).startsWith('..')) {
    return fail(`${key} points OUTSIDE this worktree:\n`
      + `    ${script}\n`
      + `  Linked worktrees share one .git/config, so this is bound to another worktree and\n`
      + '  breaks for everyone the moment that one is removed.\n'
      + '  Fix: pnpm install  (re-registers the driver for this worktree)');
  }

  if (actual !== expected) {
    return fail(`${key} has drifted from what setup-git-hooks.mjs registers.\n`
      + `    registered: ${actual}\n`
      + `    expected:   ${expected}\n`
      + '  Fix: pnpm install');
  }

  console.log(`✓ merge.${DRIVER_NAME}.driver resolves in THIS worktree (${relative(root, realpath(script))})`);
  return true;
}

/**
 * Expand the driver value's script path the way git will: git hands a merge driver
 * command to a shell, so `$(git rev-parse --show-toplevel)` is only meaningful once
 * a shell has run it, from inside the worktree being merged.
 */
function expandDriverScript(value) {
  // Drop the trailing %O %A %B %P placeholders; what remains is `node <script>`.
  const command = value.replace(/(\s+%[A-Za-z])+\s*$/, '');
  const expr = /^\s*node\s+(\S.*)$/.exec(command)?.[1];
  if (!expr) return { skip: `not a \`node <script>\` command: "${value}"` };
  try {
    return {
      path: execFileSync('sh', ['-c', `printf '%s' ${expr}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (err) {
    // No POSIX shell (some Windows setups). Git could not run the driver either,
    // so there is nothing this check could assert that would still be true.
    if (err?.code === 'ENOENT') return { skip: 'no POSIX shell available to expand it' };
    return { error: err?.stderr?.toString().trim() || err?.message || String(err) };
  }
}

/** Best-effort realpath: symlinked checkouts otherwise read as "outside the worktree". */
function realpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Prove the driver end to end against real git: a conflicting change on both
 * sides of a mapped path must come out resolved, marker-free, and recorded.
 * Asserting the behaviour rather than the wiring is the point — the wiring
 * (`%P` order, git-dir resolution in a worktree) is exactly what silently rots.
 */
function endToEnd() {
  const dir = mkdtempSync(join(tmpdir(), 'os-regen-selftest-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q', '--initial-branch=main', '.');
    git('config', 'user.email', 'selftest@objectstack.ai');
    git('config', 'user.name', 'self-test');
    git('config', 'merge.os-regen.name', 'regenerate instead of text-merging');
    // Absolute on purpose, and NOT the value we register in a real clone: this temp
    // repo is not the ObjectStack worktree, so the registered
    // `$(git rev-parse --show-toplevel)` would resolve to `dir` — which has no
    // scripts/. Here we want the driver under test, i.e. this clone's copy.
    // Checking the value real clones get is `registeredDriverResolves()`'s job (#4868).
    git('config', 'merge.os-regen.driver', `node "${join(REPO_ROOT, 'scripts/git-merge-regen.mjs')}" %O %A %B %P`);

    const target = REGEN_ARTIFACTS[0].path;
    mkdirSync(join(dir, dirname(target)), { recursive: true });
    writeFileSync(join(dir, '.gitattributes'), `${target} merge=os-regen\n`);
    writeFileSync(join(dir, target), '["base"]\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'incoming');
    writeFileSync(join(dir, target), '["base","theirs"]\n');
    git('commit', '-qam', 'theirs');

    git('checkout', '-q', 'main');
    writeFileSync(join(dir, target), '["base","ours"]\n');
    git('commit', '-qam', 'ours');

    git('merge', 'incoming', '-m', 'merge');

    const merged = readFileSync(join(dir, target), 'utf8');
    if (/^<{7}|^={7}$|^>{7}/m.test(merged)) return fail(`self-test: conflict markers survived in ${target}`);
    if (git('status', '--porcelain').match(/^(UU|AA)/m)) return fail('self-test: path left conflicted after merge');

    const marker = join(gitDir(dir), PENDING_MARKER);
    if (!existsSync(marker)) return fail(`self-test: no pending marker written at ${marker}`);
    if (!readFileSync(marker, 'utf8').includes(target)) return fail(`self-test: ${target} absent from the pending marker`);

    console.log(`✓ end-to-end: conflicting ${target} merged without markers and recorded as pending`);
    return true;
  } catch (err) {
    return fail(`self-test: ${err?.stderr?.toString() || err?.message || err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) {
  console.log('git-merge-regen --self-test\n');
  const results = [
    reconcileAttributes(),
    reconcileScripts(),
    reconcileOwnership(),
    hookIsExecutable(),
    registeredDriverResolves(),
    endToEnd(),
  ];
  console.log(
    results.every(Boolean)
      ? `\n✓ merge driver wiring is consistent (${NOT_DRIVER_MANAGED.length} path(s) deliberately excluded).`
      : '\n✗ merge driver wiring is inconsistent — see above.',
  );
} else {
  try {
    process.exit(drive(process.argv.slice(2)));
  } catch (err) {
    // Non-zero leaves the path conflicted with OURS in it and no markers. That
    // is a degraded state a human must look at — which is the right outcome for
    // "the driver itself broke", and never a silently-wrong artifact.
    console.error(`git-merge-regen: ${err?.message ?? err}\n  Leaving the path conflicted.`);
    process.exit(1);
  }
}
