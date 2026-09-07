#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Git environment isolation, and the tripwire for the damage it prevents (#16624).
 *
 *   node scripts/git-env.mjs --self-test
 *
 * ## The measured incident this file exists for
 *
 * A gate's `--self-test` builds a throwaway git corpus to prove a red-first
 * pair: `git init` in a temp dir, `git add -A`, then a resolver one frame down
 * asks `git ls-files` what the corpus tracks. From a plain shell that is inert.
 * From INSIDE A GIT HOOK it is not. Git exports the repository's location into
 * every child it runs -- `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` -- and a
 * `git` child that inherits them operates on THE REAL REPOSITORY no matter what
 * `cwd` it was handed, because those variables outrank `cwd`.
 *
 * Measured once, on a real box, during an os-regen merge lap where `pre-commit`
 * runs such a gate:
 *
 *   - `git add -A` wrote the repository's index: 8,190 paths staged as deleted.
 *   - `git init`, with an inherited `GIT_DIR` and a cwd outside any work tree,
 *     wrote `core.bare = true` into the SHARED `.git/config` -- the file every
 *     linked worktree on that machine reads. The primary checkout then answered
 *     "fatal: this operation must be run in a work tree" and `git worktree list`
 *     reported it as bare, FOR EVERY AGENT ON THE BOX.
 *   - The self-test printed `ok` throughout. Both writes were silent at the
 *     point of damage and the symptom surfaced in other sessions, with nothing
 *     pointing back.
 *
 * ⭐ The blast radius is the point: a worktree isolates the checkout and four
 * ref namespaces, and `.git/config` is in NEITHER list. One agent's test is
 * enough to brick git for every agent sharing the clone.
 *
 * ## The rule, and its one boundary
 *
 * `gitFreeEnv()` is for a git child that must operate on the repository named
 * by its `cwd` and arguments ALONE -- `init`, `add`, `ls-files`, `status`,
 * `commit` against a throwaway tree. It removes every `GIT_`-prefixed key,
 * which is the landed shape and deliberately blunter than a list of the
 * location variables: a list has to be maintained against git's, and the one it
 * misses is the one that bites.
 *
 * ⛔ It is NOT for a child that talks to a remote. Measured on this repo's own
 * agent containers: the ambient environment carries `GIT_CONFIG_COUNT` with
 * `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` pairs that rewrite GitHub remotes
 * (`url.<https>.insteadOf`) and disable interactive credentials, plus
 * `GIT_SSL_CAINFO` naming the proxy CA bundle. Strip those and a `fetch`,
 * `clone` or `push` in the child loses its transport configuration. So the rule
 * is stated by what the child DOES, never by which script it lives in: a local
 * child gets `gitFreeEnv()`; a network child keeps the ambient environment and
 * must not be pointed at a throwaway tree in the first place.
 *
 * ## Two halves, and why both
 *
 * `gitFreeEnv()` covers the children a caller spawns ITSELF. It cannot cover a
 * child spawned one frame down inside a shared library that passes no
 * environment of its own. `withoutGitEnv()` covers that case by detaching the
 * PROCESS for the duration of a callback and restoring afterwards, so a
 * self-test can protect calls it does not own. Use both where both apply: the
 * explicit env is the load-bearing one, the process-level detach is the net
 * under everything it cannot reach.
 *
 * ## The tripwire
 *
 * `sharedGitConfigVerdict()` answers the question the incident left unanswered
 * for hours: is this clone's shared config still sane? It is deliberately not a
 * repo-wide gate -- it is a cheap predicate any entrypoint can call to make a
 * `core.bare` flip LOUD at the moment someone next touches the clone, because
 * at the moment of damage nothing said a word.
 *
 * ⚠️ Measured, and the reason the predicate reads `core.bare` rather than
 * trusting an exit code: with `core.bare = true` on a normal checkout,
 * `git rev-parse --is-inside-work-tree` PRINTS `false` AND EXITS 0. A caller
 * that only checks the exit status sees a healthy clone. `git status` is the
 * one that fails, with exit 128, long after the useful moment.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

/* The rule, as a string, so a caller can print it in its own failure text
 * instead of restating it and drifting from this file. */
export const GIT_ENV_ISOLATION_RULE = [
  'A git child that operates on a THROWAWAY repository must be spawned with a',
  'GIT_*-stripped environment (`gitFreeEnv()` from scripts/git-env.mjs).',
  'Git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE into every child it runs,',
  'and those outrank `cwd`: under a hook, an inheriting `git add -A` writes THE',
  'REPOSITORY’s index and an inheriting `git init` can write core.bare into the',
  'SHARED .git/config, which every linked worktree reads.',
  '⛔ Never strip for a child that fetches, clones or pushes -- GIT_CONFIG_* and',
  'GIT_SSL_* carry the transport configuration.',
].join('\n  ');

/**
 * A copy of `base` with every `GIT_`-prefixed key removed.
 *
 * Returns a NEW object; `process.env` is not mutated. Pass the result as the
 * `env` option of every `git` child that must stay inside its own `cwd`.
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function gitFreeEnv(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

/**
 * The keys `gitFreeEnv` removed from `base`, sorted. Reporting-only: a caller
 * that wants to SAY what it detached from, and the self-test's evidence that
 * the strip is doing something on a hook-shaped environment.
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {string[]}
 */
export function gitEnvKeys(base = process.env) {
  return Object.keys(base).filter((key) => key.startsWith('GIT_')).sort();
}

/**
 * Run `fn` with every `GIT_*` variable removed from `process.env`, then restore
 * exactly what was there -- including keys that were absent, which are deleted
 * again rather than reinstated as `undefined`.
 *
 * Restoration runs in a `finally`, so a throwing callback still leaves the
 * process as it found it. Synchronous on purpose: an async version would let a
 * second task observe the detached window, which is a worse bug than the one
 * this closes.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withoutGitEnv(fn) {
  const saved = Object.fromEntries(gitEnvKeys().map((key) => [key, process.env[key]]));
  for (const key of Object.keys(saved)) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) process.env[key] = value;
  }
}

/* The remedy this repo can actually apply to a flipped shared config, printed
 * with the alarm so the reader is not left to derive it under stress. */
export const SHARED_BARE_REPAIR = 'git -C <the checkout> config core.bare false';

/**
 * Is this clone's shared `.git/config` still describing a working checkout?
 *
 * Reads `core.bare` directly, for the measured reason in the header: under a
 * `core.bare = true` flip, `rev-parse --is-inside-work-tree` prints `false` and
 * exits 0, so an exit-code check reports a healthy clone.
 *
 * Verdicts:
 *   ok         `core.bare` is false (or unset, which git reads as false)
 *   bare       `core.bare` is true on a clone that has a work tree -- the
 *              incident shape, and the only one that raises an alarm
 *   unknown    git could not be asked (no git, not a repository, config
 *              unreadable). ⛔ Reported as unknown, never as ok: this predicate
 *              exists because silence was the failure, so it does not
 *              manufacture a reassuring answer out of a question it could not
 *              put.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{ verdict: 'ok' | 'bare' | 'unknown', bare: boolean | null, detail: string }}
 */
export function sharedGitConfigVerdict({ cwd = process.cwd() } = {}) {
  const ask = (args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: gitFreeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  };
  /* ⚠️ The COMMON dir, absolutely -- and both halves of that are measured.
   *
   * COMMON, because the damaged file is the SHARED one and a linked worktree
   * must reach the same verdict as the primary: `--absolute-git-dir` from a
   * linked worktree answers with that worktree's own private directory, whose
   * basename is the worktree name, so the layout test below would read every
   * linked worktree as a bare repository and the alarm would never fire from
   * the very place agents work. ⭐ It is also the half that matters: under the
   * flip the linked worktrees keep working and only the PRIMARY checkout dies,
   * so the session that can see the damage is usually not the one suffering it.
   *
   * ABSOLUTELY, because a bare `--git-common-dir` degrades to the relative
   * `.git`. `--show-toplevel` cannot carry any of this: it is exactly what
   * stops working (exit 128, "this operation must be run in a work tree").
   *
   * `--path-format` needs git 2.31; the fallback keeps this predicate useful on
   * an older one rather than turning every answer into `unknown`. */
  const gitDir = ask(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ?? ask(['rev-parse', '--absolute-git-dir']);
  if (gitDir === null) {
    return { verdict: 'unknown', bare: null, detail: `not a git repository, or git is unavailable, at ${cwd}` };
  }
  const raw = ask(['config', '--get', 'core.bare']);
  /* An unset key is git's default of false -- `--get` exits 1 for it, which the
   * `ask` above turns into null. Absent and "false" are the same answer here. */
  const bare = raw === 'true';
  if (!bare) return { verdict: 'ok', bare: false, detail: `core.bare=${raw ?? '<unset>'} (shared config in ${gitDir})` };
  /* A repository that really IS bare has no work tree to lose, and raising an
   * alarm over it would be a false positive on a legitimate state -- this repo
   * creates such repositories on purpose (release rehearsals, merge fixtures).
   *
   * ⚠️ The discriminator is the LAYOUT, not a git query, and that is forced:
   * under the flip every read that names a work tree has already stopped
   * working, which is the damage itself. A git directory named `.git` with a
   * populated directory beside it is a checkout; a bare repository is
   * conventionally `<name>.git` and has no sibling tree. Convention, stated as
   * such -- the cost of the rare miss is a false alarm the reader can dismiss
   * in one command, against a silence that cost a machine-wide outage. */
  const worktreeRoot = dirname(gitDir);
  const looksLikeCheckout = basename(gitDir) === '.git'
    && existsSync(worktreeRoot)
    && readdirSync(worktreeRoot).some((entry) => entry !== '.git');
  if (!looksLikeCheckout) {
    return { verdict: 'ok', bare: true, detail: `a genuinely bare repository at ${gitDir} -- no work tree to lose` };
  }
  return {
    verdict: 'bare',
    bare: true,
    detail: `core.bare=true while a work tree exists at ${worktreeRoot} (shared config in ${gitDir})`,
  };
}

/**
 * The loud text for a `bare` verdict, or `null` when there is nothing to say.
 *
 * Written as a paragraph rather than a one-liner on purpose: the reader of this
 * message is, by construction, someone whose checkout just stopped working for
 * a reason that is not in front of them.
 *
 * @param {{ verdict: string, detail: string }} verdict
 * @returns {string | null}
 */
export function formatSharedGitConfigAlarm(verdict) {
  if (verdict.verdict !== 'bare') return null;
  return [
    '',
    '⛔ SHARED GIT CONFIG DAMAGED: core.bare is true on a checkout that has a work tree.',
    `   ${verdict.detail}`,
    '',
    '   Every linked worktree of this clone reads that one config file, so this breaks',
    '   git for every agent sharing it: `git status` answers "fatal: this operation must',
    '   be run in a work tree" and `git worktree list` reports the checkout as bare.',
    '',
    '   The known cause is a git child that inherited GIT_DIR from a hook and ran',
    '   `git init` against a throwaway directory. The rule that prevents it:',
    `   ${GIT_ENV_ISOLATION_RULE.split('\n').join('\n   ')}`,
    '',
    `   Repair: ${SHARED_BARE_REPAIR}`,
    '   Then check what else that child wrote: `git status --porcelain` on the shared',
    '   checkout should be empty, and `git ls-files | wc -l` should match the tree.',
    '',
  ].join('\n');
}

/* ───────────────────────────────── self-test ───────────────────────────── */

const SELF_TEST_VERDICT = 'git-env self-test reached its verdict';

/* A floor, not an equality: adding cases is ordinary work. A battery BELOW its
 * floor means cases stopped running, which is the failure this whole file is
 * about -- an instrument that reports success while doing nothing. */
const SELF_TEST_CASE_FLOOR = 21;

export function selfTest() {
  let failures = 0;
  let cases = 0;
  const t = (name, ok, detail = '') => {
    cases += 1;
    if (!ok) failures += 1;
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `\n        ${detail}` : ''}`);
  };

  // 1. The strip itself, provoked in BOTH directions -- a rule that only ever
  //    says "removed" is not a rule.
  const hookLike = { PATH: '/usr/bin', GIT_DIR: '/repo/.git', GIT_WORK_TREE: '/repo', GIT_INDEX_FILE: '/repo/.git/index', HOME: '/root' };
  const stripped = gitFreeEnv(hookLike);
  t('gitFreeEnv removes every GIT_* key', Object.keys(stripped).filter((k) => k.startsWith('GIT_')).length === 0, JSON.stringify(Object.keys(stripped)));
  t('gitFreeEnv keeps every non-GIT_ key', stripped.PATH === '/usr/bin' && stripped.HOME === '/root');
  t('gitFreeEnv does not mutate its input', hookLike.GIT_DIR === '/repo/.git');
  t('gitEnvKeys names what was stripped, sorted', gitEnvKeys(hookLike).join(',') === 'GIT_DIR,GIT_INDEX_FILE,GIT_WORK_TREE', gitEnvKeys(hookLike).join(','));
  t('gitEnvKeys on an environment with none answers empty', gitEnvKeys({ PATH: '/usr/bin' }).length === 0);

  // 2. ⭐ THE PROPERTY, against real git: a child spawned with a bogus GIT_DIR
  //    in its environment does NOT operate on the directory it was handed. This
  //    is the failure itself, reproduced deliberately in a place that can
  //    afford it, so the fix below is measured against a demonstrated red
  //    rather than against an argument.
  const victim = mkdtempSync(join(tmpdir(), 'git-env-victim-'));
  const corpus = mkdtempSync(join(tmpdir(), 'git-env-corpus-'));
  try {
    // A stand-in for the shared checkout: a real repository with a real index.
    execFileSync('git', ['init', '-q'], { cwd: victim, env: gitFreeEnv() });
    writeFileSync(join(victim, 'kept.txt'), 'the file the victim tracks\n');
    execFileSync('git', ['add', '-A'], { cwd: victim, env: gitFreeEnv() });
    /* Committed on purpose: a staged-but-uncommitted path that `-A` drops from
     * the index leaves no `D` row to read, because `--cached` compares against
     * HEAD. The incident's 8,190 rows were deletions OF COMMITTED FILES, so the
     * victim needs a HEAD for this to reproduce the shape rather than a milder
     * cousin of it. Identity passed with `-c` because the environment is
     * stripped. */
    execFileSync('git', [
      '-c', 'user.name=git-env self-test', '-c', 'user.email=self-test@objectstack.invalid',
      'commit', '-q', '-m', 'the commit the victim would lose',
    ], { cwd: victim, env: gitFreeEnv() });
    const victimBefore = execFileSync('git', ['ls-files'], { cwd: victim, encoding: 'utf8', env: gitFreeEnv() }).trim();
    t('the victim repository starts with exactly its own file staged', victimBefore === 'kept.txt', victimBefore);

    writeFileSync(join(corpus, 'corpus.txt'), 'the throwaway corpus file\n');
    /* ⚠️ GIT_DIR ALONE, deliberately -- that is the incident's shape and the
     * only one that reproduces it. With GIT_WORK_TREE also set, git resolves
     * the work tree to the victim and `-A` never looks at the directory it was
     * handed, so the victim's index comes back UNCHANGED and this case passes
     * while proving nothing. Measured here before the spelling was settled.
     * With GIT_DIR alone, git takes `cwd` as the work tree: every one of the
     * victim's tracked files is absent from it and `git add -A` stages them ALL
     * as deleted -- 8,190 of them, on the day this was found. */
    const leaky = { ...process.env, GIT_DIR: join(victim, '.git') };

    // 2a. THE RED. Exactly what the incident did: spawn against the corpus dir
    //     while a hook's variables are in the environment.
    let redReached = false;
    let leakedIndex = '';
    try {
      execFileSync('git', ['init', '-q'], { cwd: corpus, env: leaky, stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('git', ['add', '-A'], { cwd: corpus, env: leaky, stdio: ['ignore', 'pipe', 'pipe'] });
      redReached = true;
      leakedIndex = execFileSync('git', ['diff', '--cached', '--name-status'], {
        cwd: victim, encoding: 'utf8', env: gitFreeEnv(),
      }).trim();
    } catch {
      redReached = false;
    }
    const victimAfterLeak = execFileSync('git', ['ls-files'], { cwd: victim, encoding: 'utf8', env: gitFreeEnv() }).trim();
    t(
      '⛔ RED: an inherited GIT_DIR makes `git add -A` write THE VICTIM’s index, not the directory it was handed'
        + ' -- the measured incident, reproduced',
      redReached && /^D\s+kept\.txt/m.test(leakedIndex),
      `victim staged changes after the leak: ${JSON.stringify(leakedIndex)}`,
    );
    t(
      '⛔ RED: the leaky `git init` created NO repository in the directory it was pointed at',
      !existsSync(join(corpus, '.git')),
    );

    // 2b. THE GREEN, same two commands, same environment, one difference.
    const corpus2 = mkdtempSync(join(tmpdir(), 'git-env-corpus-'));
    try {
      writeFileSync(join(corpus2, 'corpus.txt'), 'the throwaway corpus file\n');
      const guarded = gitFreeEnv(leaky);
      execFileSync('git', ['init', '-q'], { cwd: corpus2, env: guarded });
      execFileSync('git', ['add', '-A'], { cwd: corpus2, env: guarded });
      const staged = execFileSync('git', ['ls-files'], { cwd: corpus2, encoding: 'utf8', env: guarded }).trim();
      t('⭐ GREEN: with gitFreeEnv the corpus gets its OWN repository', existsSync(join(corpus2, '.git')));
      t('⭐ GREEN: ...and stages its OWN file', staged === 'corpus.txt', staged);
      const victimAfterGuard = execFileSync('git', ['ls-files'], { cwd: victim, encoding: 'utf8', env: gitFreeEnv() }).trim();
      t('⭐ GREEN: ...and the victim’s index is untouched by it', victimAfterGuard === victimAfterLeak, victimAfterGuard);
    } finally {
      rmSync(corpus2, { recursive: true, force: true });
    }

    // 3. The tripwire, both verdicts, on a repository this test owns.
    const healthy = sharedGitConfigVerdict({ cwd: victim });
    t('the tripwire reads a healthy checkout as ok', healthy.verdict === 'ok' && healthy.bare === false, JSON.stringify(healthy));
    t('a healthy verdict raises no alarm text', formatSharedGitConfigAlarm(healthy) === null);
    execFileSync('git', ['config', 'core.bare', 'true'], { cwd: victim, env: gitFreeEnv() });
    const flipped = sharedGitConfigVerdict({ cwd: victim });
    t('⭐ the tripwire reads a core.bare flip on a checkout WITH a work tree as an alarm', flipped.verdict === 'bare', JSON.stringify(flipped));
    const alarm = formatSharedGitConfigAlarm(flipped) ?? '';
    t(
      'the alarm names the damage, the blast radius and the repair',
      alarm.includes('core.bare is true') && alarm.includes('every agent sharing it') && alarm.includes(SHARED_BARE_REPAIR),
      alarm.slice(0, 120),
    );
    /* ⚠️ The case that stops the tripwire being an exit-code check. Under the
     * flip that is still in place, `rev-parse --is-inside-work-tree` succeeds. */
    const rp = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: victim, encoding: 'utf8', env: gitFreeEnv() }).trim();
    t(
      '⚠️ measured: under the flip `rev-parse --is-inside-work-tree` still EXITS 0 -- an exit-code check would report health',
      rp === 'false',
      `printed "${rp}" with exit 0`,
    );
    /* ⭐ THE CASE THAT MATTERS MOST, and the one that caught a real defect in
     * this predicate's first spelling. Under the flip the PRIMARY checkout is
     * the one that dies while linked worktrees keep working -- so the session
     * that can still run anything is a linked one, and the predicate is useless
     * unless it reaches the same verdict from there. Reading `--absolute-git-dir`
     * instead of the COMMON dir answered with the linked worktree's own private
     * directory and classified the damage as a healthy bare repository. */
    const linked = join(dirname(victim), `${basename(victim)}-linked`);
    let linkedVerdict = null;
    try {
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'tripwire-probe', linked], { cwd: victim, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      linkedVerdict = sharedGitConfigVerdict({ cwd: linked });
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
    t(
      '⭐ the tripwire reads the flip from a LINKED WORKTREE too -- the only session still able to ask',
      linkedVerdict !== null && linkedVerdict.verdict === 'bare',
      JSON.stringify(linkedVerdict),
    );
    execFileSync('git', ['config', 'core.bare', 'false'], { cwd: victim, env: gitFreeEnv() });
    t('...and the tripwire clears once the flip is repaired', sharedGitConfigVerdict({ cwd: victim }).verdict === 'ok');
  } finally {
    rmSync(victim, { recursive: true, force: true });
    rmSync(corpus, { recursive: true, force: true });
  }

  // 4. `withoutGitEnv` restores what it detached, absent keys included.
  const priorDir = process.env.GIT_DIR;
  process.env.GIT_DIR = '/a/hook/exported/this';
  const inside = withoutGitEnv(() => gitEnvKeys().length);
  t('withoutGitEnv detaches the process for the callback', inside === 0, String(inside));
  t('withoutGitEnv restores what it detached', process.env.GIT_DIR === '/a/hook/exported/this');
  if (priorDir === undefined) delete process.env.GIT_DIR;
  else process.env.GIT_DIR = priorDir;
  t('withoutGitEnv leaves a key that was ABSENT absent', !('GIT_ENV_SELFTEST_ABSENT' in process.env)
    && withoutGitEnv(() => true) && !('GIT_ENV_SELFTEST_ABSENT' in process.env));

  if (cases < SELF_TEST_CASE_FLOOR) {
    console.error(
      `\n✗ git-env self-test registered ${cases} case(s), below its pinned floor of ${SELF_TEST_CASE_FLOOR}.`
        + '\n  Cases that used to run no longer do -- find what stopped registering, do not lower the floor.',
    );
    failures += 1;
  }
  if (failures) {
    console.error(`\n❌ git-env --self-test: ${failures} failure(s) of ${cases} case(s)`);
    process.exit(1);
  }
  console.log(`\n✅ git-env --self-test: ${cases} cases -- the strip, the leak it prevents (red AND green against real git), and the shared-config tripwire`);
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  /* The `if` body is BRACED so the trailing `else` cannot re-bind to the inner
   * refusal, per the landed `scripts/pm/check-label-desc-cap.mjs` precedent. */
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ git-env self-test: selfTest() returned without reaching its verdict, so no success\n'
          + 'line was printed. Exiting 0 here would report a self-test that never finished as one\n'
          + 'that passed.\n',
      );
      process.exit(1);
    }
  } else {
    console.log('git-env is a library. The rule it carries:\n  ' + GIT_ENV_ISOLATION_RULE);
    console.log('\nRun `node scripts/git-env.mjs --self-test`.');
  }
}
