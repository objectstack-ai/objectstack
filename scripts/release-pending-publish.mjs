#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-pending-publish -- WHICH commit a release publishes, WHICH push queues
 * its approval prompt, and WHICH waiting prompts are no longer a release
 * (ADR-0125 D1, as amended 2026-09-29).
 *
 *   node scripts/release-pending-publish.mjs select --event push --head SHA --before SHA
 *   node scripts/release-pending-publish.mjs select --event workflow_dispatch --head SHA
 *   node scripts/release-pending-publish.mjs npm-state VERSION
 *   node scripts/release-pending-publish.mjs sweep --workflow release.yml [--dry-run]
 *   node scripts/release-pending-publish.mjs --self-test
 *
 * ## The measured failure (#20613)
 *
 * ADR-0125 D1 gated the publish job on ONE predicate -- "main's
 * `@objectstack/cli` version is not on npm" -- and said it is true only just
 * after a Version Packages PR merges. It is true from that merge until the
 * publish FINISHES, and main takes ~18 landings a working day, so on the 17.5.0
 * release every landing in between queued its own `Publish 17.5.0` job, and
 * every one of them checked out `github.sha` of ITS push. Measured:
 *
 *   version commit   8c87d26a  (chore: version packages), landed inside the
 *                               merge-queue batch pushed as 3a89d459
 *   shipped from     0f6dcac5  (run 36536081716), eight landings later
 *   git log --first-parent 8c87d26a..0f6dcac5   8 PRs, one `feat(spec)!`,
 *                                                changesets unconsumed
 *
 * The concurrency group on the publish job made it worse, and the mechanics were
 * read off the runs, not assumed: the job that holds `release-publish-<ref>`
 * waits at the `release` environment WHILE HOLDING it, and every later publish
 * job pends behind it, each one evicting the pending job before it. A prompt
 * left waiting after its version shipped therefore holds the group and HIDES the
 * next real one -- the 17.4.0 prompt of run 34308599522 waited 20 days, was the
 * only visible prompt when 17.5.0 was queued, and was approved by mistake.
 * 17.5.0 left one exactly like it: run 36539819278 started waiting at 08:11Z on
 * 2026-09-29, after `@objectstack/cli@17.5.0` reached npm at 07:58:57Z.
 *
 * ## What each mode answers
 *
 * `select` -- THE predicate. The version commit is the newest commit on the
 * head's FIRST-PARENT chain at which `packages/cli/package.json`'s version
 * differs from its first parent's: the landing that brought main to the version
 * it carries. It is computed on both release events, because the publish job
 * checks out THAT commit on both. Whether a deployment is queued differs:
 *
 *   push              pending ⇔ the version commit is IN this push
 *                     (not an ancestor of `before`) AND the version is not on
 *                     npm. A later landing carries no version commit, so it
 *                     queues nothing and evicts nothing.
 *   workflow_dispatch pending ⇔ the version is not on npm. A dispatch is a
 *                     human act, not repeated per landing, and it is the repair
 *                     lane for a version-push audit that never queued (D4).
 *
 * A push range that cannot be read -- `before` all zeros, `before` absent from
 * the clone, `before` not an ancestor of the head (a force-push) -- answers
 * NOT pending with a reason, never a guess: the repair dispatch covers it.
 * A SHALLOW clone is refused outright: at the graft boundary the oldest fetched
 * commit has no parent, reads as "the version changed here", and would be
 * returned as the version commit -- a confident wrong answer.
 *
 * `npm-state` -- present / absent / unknown for one version, from `npm view`'s
 * exit status and its `E404`. The caller decides what `unknown` means: the
 * audit keeps its old reading (not on npm), the publish guard proceeds with a
 * warning, because `changeset publish` skips an already-published version by
 * itself and an unreachable registry cannot publish anything either.
 *
 * `sweep` -- the waiting-prompt half. Lists this workflow's runs that are
 * `waiting`, and CANCELS a run only when ALL of these hold:
 *
 *   - it is not the calling run;
 *   - its event is `push` (a dispatch is a human's own act, and the D4 `force`
 *     repair legitimately waits for a version whose CLI is already on npm --
 *     the run object does not expose its inputs, so no dispatch is touched);
 *   - one of its jobs is `waiting` and named `Publish VERSION to npm (awaiting
 *     approval)` -- the approval screen ADR-0125 D2 defines;
 *   - its pending deployments include the `release` environment;
 *   - VERSION is present on npm.
 *
 * Such a job has run no step: GitHub holds the WHOLE job at the environment, so
 * cancelling it never interrupts a publish. And if an approval lands in the
 * second between the read and the cancel, the job's own guard refuses anyway --
 * a push-lane job whose version is already on npm stops before it builds.
 * Permission: `actions: write` for the cancel (the reads need `actions: read`).
 * Rejecting instead is not available to a workflow: the pending-deployments
 * review endpoint answers only a REQUIRED REVIEWER of the environment, and the
 * workflow token is not one -- nor should it be.
 *
 * `--dry-run` reports what `sweep` would cancel and refuses any non-GET request
 * at the HTTP layer, so it is safe to point at the live repository.
 *
 * ## Why the pins live here, not in the workflow
 *
 * The production path runs a handful of times a year, on a runner, against a
 * history nobody can rewind. `--self-test` builds throwaway repositories for the
 * sequences that matter (a version commit then two landings, a merge-queue
 * batch, a published version, a force-push, a shallow clone) and asserts the
 * selected sha; it is wired in lint.yml as the only instrument on this logic.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

export const CLI_MANIFEST = 'packages/cli/package.json';
export const CLI_PACKAGE = '@objectstack/cli';

/** The approval screen ADR-0125 D2 defines, as `release.yml`'s `publish` job names it. */
export const PUBLISH_JOB_NAME = /^Publish (\S+) to npm \(awaiting approval\)$/;

const ZERO_SHA = /^0{40}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// git
// ─────────────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function gitOk(cwd, args) {
  const r = git(cwd, args);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

/** `git merge-base --is-ancestor`: true / false, and anything else throws. */
function isAncestor(cwd, ancestor, descendant) {
  const r = git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git merge-base --is-ancestor ${ancestor} ${descendant} exited ${r.status}: ${r.stderr.trim()}`);
}

/** The CLI version a commit carries, read from the object database; null when the file is absent. */
export function versionAt(cwd, rev) {
  const r = git(cwd, ['show', `${rev}:${CLI_MANIFEST}`]);
  if (r.status !== 0) return null;
  const version = JSON.parse(r.stdout).version;
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${CLI_MANIFEST} at ${rev} carries no "version" string`);
  }
  return version;
}

/**
 * The version commit for `head`: the newest first-parent commit at which the
 * CLI version differs from its first parent's. Throws on a shallow clone and on
 * a history that never introduces the head's version.
 */
export function findVersionCommit({ cwd, head }) {
  if (gitOk(cwd, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
    throw new Error(
      'refusing to select a version commit in a shallow clone: at the graft boundary the oldest fetched ' +
        'commit has no parent and would read as the commit that changed the version. Check out with fetch-depth: 0.',
    );
  }
  const headSha = gitOk(cwd, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const version = versionAt(cwd, headSha);
  if (version === null) throw new Error(`${headSha} carries no ${CLI_MANIFEST}`);

  const touching = gitOk(cwd, ['log', '--first-parent', '--format=%H', headSha, '--', CLI_MANIFEST])
    .split('\n')
    .filter(Boolean);
  for (const commit of touching) {
    const here = versionAt(cwd, commit);
    if (here !== version) {
      throw new Error(
        `first-parent walk from ${headSha} reached ${commit} carrying ${here} before finding where ${version} ` +
          'was introduced -- the walk is not reading the history it claims to.',
      );
    }
    const parent = git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^1`]);
    const before = parent.status === 0 ? versionAt(cwd, parent.stdout.trim()) : null;
    if (before !== version) return { version, versionCommit: commit, head: headSha };
  }
  throw new Error(`no first-parent commit of ${headSha} introduces ${CLI_PACKAGE}@${version}`);
}

/**
 * Is the version commit part of THIS push? `in-push` / `earlier` / `unreadable`.
 * Unreadable is a verdict with a reason, never an exception: a force-push or a
 * branch creation is a real event on a real push, and the answer to it is
 * "queue nothing, say why".
 */
export function rangeState({ cwd, versionCommit, before, head }) {
  if (!before || ZERO_SHA.test(before)) {
    return { state: 'unreadable', detail: `before is ${before ? 'the all-zero sha' : 'empty'}: the push has no prior tip to measure from` };
  }
  if (git(cwd, ['cat-file', '-e', `${before}^{commit}`]).status !== 0) {
    return { state: 'unreadable', detail: `before ${before} is not in this clone (a force-push dropped it from every ref?)` };
  }
  if (!isAncestor(cwd, before, head)) {
    return { state: 'unreadable', detail: `before ${before} is not an ancestor of ${head}: the push rewrote the branch` };
  }
  return isAncestor(cwd, versionCommit, before)
    ? { state: 'earlier', detail: `${versionCommit} was already on the branch at ${before}` }
    : { state: 'in-push', detail: `${versionCommit} landed in ${before}..${head}` };
}

/** The whole predicate over already-measured inputs -- pure, so every row of it is pinned. */
export function decidePending({ event, range, npm }) {
  if (npm === 'present') return { pending: false, reason: 'published' };
  if (event === 'workflow_dispatch') return { pending: true, reason: 'dispatch-unpublished' };
  if (event !== 'push') throw new Error(`no release predicate for event "${event}"`);
  if (range.state === 'in-push') return { pending: true, reason: 'carries-version-commit' };
  if (range.state === 'earlier') return { pending: false, reason: 'version-commit-landed-earlier' };
  if (range.state === 'unreadable') return { pending: false, reason: 'range-unreadable' };
  throw new Error(`unknown range state "${range.state}"`);
}

export function select({ cwd, event, head, before, npmStateOf }) {
  const found = findVersionCommit({ cwd, head });
  const npm = npmStateOf(found.version);
  const range =
    event === 'push'
      ? rangeState({ cwd, versionCommit: found.versionCommit, before, head: found.head })
      : { state: 'not-a-push', detail: `event ${event} has no push range` };
  return { ...found, event, before: before || null, npm, range, ...decidePending({ event, range, npm }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// npm
// ─────────────────────────────────────────────────────────────────────────────

/** Classify one `npm view` result. Exported for the self-test; `npmState` is the live caller. */
export function classifyNpmView(version, { status, stdout, stderr }) {
  if (status === 0) {
    const printed = String(stdout).trim();
    if (printed === version) return 'present';
    if (printed === '') return 'absent';
    return 'unknown';
  }
  return /\bE404\b/.test(String(stderr)) ? 'absent' : 'unknown';
}

export function npmState(version, run = spawnSync) {
  if (!VERSION_SHAPE.test(version)) throw new Error(`not a version: ${JSON.stringify(version)}`);
  const r = run('npm', ['view', `${CLI_PACKAGE}@${version}`, 'version'], { encoding: 'utf8' });
  if (r.error) return 'unknown';
  return classifyNpmView(version, r);
}

// ─────────────────────────────────────────────────────────────────────────────
// The waiting-prompt sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Judge waiting runs -- pure. Each run is `{ id, event, status, jobs: [{ name,
 * status }], environments: [name] }`; every run lands in exactly one of
 * `cancel` / `keep` / `untouched`, with its reason.
 */
export function judgeWaitingRuns({ runs, currentRunId, npmStateOf }) {
  const cancel = [];
  const keep = [];
  const untouched = [];
  for (const run of runs) {
    const id = String(run.id);
    if (id === String(currentRunId)) {
      untouched.push({ id, reason: 'the calling run' });
      continue;
    }
    // ⛔ The mid-flight guard. A run whose publish job was approved is
    // `in_progress`, and cancelling THAT is the half-published fixed group the
    // publish job's concurrency comment forbids. Only a job GitHub is still
    // holding at the environment -- no step run -- is ever a candidate.
    if (run.status !== 'waiting') {
      untouched.push({ id, reason: `run status ${run.status}, not waiting` });
      continue;
    }
    const prompts = run.jobs.filter((j) => j.status === 'waiting' && PUBLISH_JOB_NAME.test(j.name));
    if (prompts.length === 0) {
      untouched.push({ id, reason: 'no publish job waiting at an environment' });
      continue;
    }
    if (!run.environments.includes('release')) {
      untouched.push({ id, reason: 'not waiting on the release environment' });
      continue;
    }
    const versions = [...new Set(prompts.map((j) => PUBLISH_JOB_NAME.exec(j.name)[1]))];
    if (versions.length !== 1) {
      untouched.push({ id, reason: `${versions.length} different publish prompts in one run; not judged` });
      continue;
    }
    const version = versions[0];
    const npm = npmStateOf(version);
    const entry = { id, event: run.event, version, npm };
    if (run.event !== 'push') {
      untouched.push({
        ...entry,
        reason: 'a dispatch is a human act, and a force repair waits for a version whose CLI is on npm by design',
      });
      continue;
    }
    if (npm === 'present') {
      cancel.push({ ...entry, reason: `${CLI_PACKAGE}@${version} is already on npm` });
    } else {
      keep.push({
        ...entry,
        reason: npm === 'absent' ? 'a live release waiting for its approval' : 'npm could not be read, so nothing is judged stale',
      });
    }
  }
  return { cancel, keep, untouched };
}

function makeHttp({ apiUrl, token, dryRun }) {
  return async (method, path) => {
    // Structural, not a flag checked later: a dry run cannot reach a write.
    if (dryRun && method !== 'GET') throw new Error(`--dry-run refuses ${method} ${path}`);
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'objectstack-release-pending-publish',
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };
}

function expectOk(res, what) {
  if (res.status !== 200) {
    throw new Error(`${what} answered HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body;
}

/** Read every waiting run of one workflow into `judgeWaitingRuns`' shape. `http` is injectable. */
export async function collectWaitingRuns({ http, repo, workflow }) {
  const list = expectOk(
    await http('GET', `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=waiting&per_page=100`),
    `listing ${workflow}'s waiting runs`,
  );
  const runs = [];
  for (const r of list.workflow_runs) {
    const jobs = expectOk(
      await http('GET', `/repos/${repo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`),
      `listing run ${r.id}'s jobs`,
    );
    const pending = expectOk(
      await http('GET', `/repos/${repo}/actions/runs/${r.id}/pending_deployments`),
      `reading run ${r.id}'s pending deployments`,
    );
    runs.push({
      id: r.id,
      event: r.event,
      status: r.status,
      headSha: r.head_sha,
      jobs: jobs.jobs.map((j) => ({ name: j.name, status: j.status })),
      environments: pending.map((p) => p.environment && p.environment.name).filter(Boolean),
    });
  }
  return { runs, total: list.total_count };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function sweep({ workflow, dryRun }) {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const token = requireEnv('GITHUB_TOKEN');
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  const currentRunId = process.env.GITHUB_RUN_ID || '';
  const http = makeHttp({ apiUrl, token, dryRun });

  const { runs, total } = await collectWaitingRuns({ http, repo, workflow });
  if (total > runs.length) {
    console.log(`::warning::${total} waiting runs, only the first ${runs.length} judged.`);
  }
  const verdict = judgeWaitingRuns({ runs, currentRunId, npmStateOf: (v) => npmState(v) });

  const lines = [`### Waiting approval prompts (${runs.length} waiting run(s) of ${workflow})`, ''];
  const failures = [];
  for (const c of verdict.cancel) {
    const url = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${c.id}`;
    if (dryRun) {
      console.log(`would cancel run ${c.id}: Publish ${c.version} -- ${c.reason}`);
      lines.push(`- would cancel [${c.id}](${url}): \`Publish ${c.version}\`, ${c.reason}`);
      continue;
    }
    const res = await http('POST', `/repos/${repo}/actions/runs/${c.id}/cancel`);
    if (res.status === 202) {
      console.log(`::warning::cancelled run ${c.id}: its "Publish ${c.version} to npm" prompt was still waiting, and ${c.reason}. Approving it would have published nothing, and it held the release-publish group ahead of any real prompt.`);
      lines.push(`- cancelled [${c.id}](${url}): \`Publish ${c.version}\`, ${c.reason}`);
    } else if (res.status === 409) {
      console.log(`run ${c.id} finished before it could be cancelled (HTTP 409) -- nothing waiting there any more.`);
      lines.push(`- [${c.id}](${url}) finished before the cancel landed`);
    } else {
      failures.push(`cancel of run ${c.id} answered HTTP ${res.status}`);
    }
  }
  for (const k of verdict.keep) {
    if (k.npm === 'unknown') console.log(`::warning::run ${k.id} waits to publish ${k.version}, and npm could not be read to judge it.`);
    lines.push(`- kept ${k.id}: \`Publish ${k.version}\`, ${k.reason}`);
  }
  for (const u of verdict.untouched) {
    if (u.version && u.npm === 'present') {
      console.log(`::warning::run ${u.id} (${u.event}) waits to publish ${u.version}, which is already on npm. Not cancelled: ${u.reason}.`);
    }
    lines.push(`- untouched ${u.id}: ${u.reason}`);
  }
  if (runs.length === 0) lines.push('- none waiting');
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

  if (failures.length > 0) {
    for (const f of failures) console.log(`::error::${f}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test
// ─────────────────────────────────────────────────────────────────────────────

// Set as the self-test's LAST statement, after its success line prints, and
// read at the dispatch: a `return` above the verdict prints nothing and would
// otherwise exit 0 -- a self-test that never finished, reported as one that
// passed.
let selfTestReachedVerdict = false;

// The battery roster, pinned by NAME with a per-battery floor (the
// check-agent-model-declared.mjs shape). A deleted or renamed battery names
// itself in the refusal; a pinned total would not.
const SELF_TEST_BATTERIES = Object.freeze({
  'a version commit then two landings -> ONE pending publish, pinned to the version commit': 4,
  'a merge-queue batch carrying the version commit -> the version commit, not the head': 2,
  'a published version -> nothing pending on either release event': 2,
  'a dependency-only edit of the CLI manifest -> still the version commit': 1,
  'a non-linear landing -> the merge that brought the version onto the branch': 2,
  'an unreadable push range -> nothing pending, never a guess': 3,
  'the repair dispatch -> pending exactly while the version is off npm': 2,
  'a shallow clone -> refused, never a graft-boundary answer': 1,
  'npm view -> present / absent / unknown': 5,
  'a waiting prompt -> cancelled only on the push lane, only when its version is on npm': 9,
  'an event with no release predicate -> refused': 1,
});
const SELF_TEST_BATTERY_FLOOR = 11;

function selfTest() {
  let failed = 0;
  let current = null;
  const seen = new Map();
  const battery = (name) => {
    current = name;
    if (!seen.has(name)) seen.set(name, 0);
  };
  const check = (ok, message) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if (ok) {
      console.log(`  ✓ ${message}`);
    } else {
      failed += 1;
      console.error(`  ✗ ${message}`);
    }
  };
  const throws = (fn, pattern) => {
    try {
      fn();
      return false;
    } catch (err) {
      return pattern.test(String(err && err.message));
    }
  };

  const dirs = [];
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-pending-publish-'));
    dirs.push(dir);
    const g = (...args) =>
      gitOk(dir, [
        '-c', 'user.name=fixture',
        '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false',
        '-c', 'core.hooksPath=/dev/null',
        ...args,
      ]);
    g('init', '-q', '-b', 'main');
    const writeCli = (version, extra = {}) => {
      mkdirSync(join(dir, 'packages', 'cli'), { recursive: true });
      writeFileSync(join(dir, CLI_MANIFEST), `${JSON.stringify({ name: CLI_PACKAGE, version, ...extra }, null, 2)}\n`);
    };
    const commit = (message, file = null) => {
      if (file) writeFileSync(join(dir, file), `${message}\n`);
      g('add', '-A');
      g('commit', '-q', '-m', message);
      return g('rev-parse', 'HEAD').trim();
    };
    return { dir, g, writeCli, commit };
  };
  const npmOf = (published) => (version) => (published.includes(version) ? 'present' : 'absent');

  try {
    // ── the 17.5.0 sequence, reduced ─────────────────────────────────────
    const r = fixture();
    r.writeCli('1.0.0');
    const base = r.commit('base');
    r.writeCli('1.1.0');
    const v = r.commit('chore: version packages');
    const l1 = r.commit('landing one', 'one.txt');
    const l2 = r.commit('landing two', 'two.txt');
    const off = npmOf([]);

    battery('a version commit then two landings -> ONE pending publish, pinned to the version commit');
    const pushes = [
      select({ cwd: r.dir, event: 'push', before: base, head: v, npmStateOf: off }),
      select({ cwd: r.dir, event: 'push', before: v, head: l1, npmStateOf: off }),
      select({ cwd: r.dir, event: 'push', before: l1, head: l2, npmStateOf: off }),
    ];
    check(pushes[0].pending && pushes[0].versionCommit === v, 'the push that lands the version commit is pending, on the version commit');
    check(!pushes[1].pending && pushes[1].reason === 'version-commit-landed-earlier', 'the first later landing queues nothing');
    check(!pushes[2].pending && pushes[2].reason === 'version-commit-landed-earlier', 'the second later landing queues nothing');
    check(
      pushes.filter((p) => p.pending).length === 1 && pushes.every((p) => p.versionCommit === v),
      'across the three pushes: exactly one pending publish, and every push names the same version commit',
    );

    battery('a merge-queue batch carrying the version commit -> the version commit, not the head');
    const batch = select({ cwd: r.dir, event: 'push', before: base, head: l2, npmStateOf: off });
    check(batch.pending, 'a batch whose range contains the version commit is pending');
    check(batch.versionCommit === v && batch.head === l2, 'and it publishes the version commit, not the batch head');

    battery('a published version -> nothing pending on either release event');
    const on = npmOf(['1.1.0']);
    const pubPush = select({ cwd: r.dir, event: 'push', before: base, head: v, npmStateOf: on });
    check(!pubPush.pending && pubPush.reason === 'published', 'the version push itself queues nothing once the version is on npm');
    const pubDispatch = select({ cwd: r.dir, event: 'workflow_dispatch', head: l2, npmStateOf: on });
    check(!pubDispatch.pending && pubDispatch.reason === 'published', 'the repair dispatch queues nothing either');

    battery('the repair dispatch -> pending exactly while the version is off npm');
    const dispatch = select({ cwd: r.dir, event: 'workflow_dispatch', head: l2, npmStateOf: off });
    check(dispatch.pending && dispatch.reason === 'dispatch-unpublished', 'a dispatch on an unpublished version is pending without a push range');
    check(dispatch.versionCommit === v, 'and it too publishes the version commit, not the head it was dispatched on');

    battery('a dependency-only edit of the CLI manifest -> still the version commit');
    r.writeCli('1.1.0', { dependencies: { 'left-pad': '1.3.0' } });
    const dep = r.commit('deps: cli gains a dependency');
    const afterDep = select({ cwd: r.dir, event: 'push', before: l2, head: dep, npmStateOf: off });
    check(
      afterDep.versionCommit === v && !afterDep.pending,
      'a commit that touches packages/cli/package.json without moving its version is not the version commit',
    );

    battery('an unreadable push range -> nothing pending, never a guess');
    const zero = select({ cwd: r.dir, event: 'push', before: '0'.repeat(40), head: v, npmStateOf: off });
    check(!zero.pending && zero.reason === 'range-unreadable', 'before = the all-zero sha (branch creation) -> unreadable');
    const missing = select({ cwd: r.dir, event: 'push', before: 'f'.repeat(40), head: v, npmStateOf: off });
    check(!missing.pending && missing.reason === 'range-unreadable', 'before absent from the clone -> unreadable');
    r.g('checkout', '-q', '-b', 'rewritten', base);
    const orphanTip = r.commit('the tip a force-push threw away', 'gone.txt');
    r.g('checkout', '-q', 'main');
    const forced = select({ cwd: r.dir, event: 'push', before: orphanTip, head: v, npmStateOf: off });
    check(!forced.pending && forced.reason === 'range-unreadable', 'before not an ancestor of the head (a force-push) -> unreadable');

    // ── a non-linear landing ─────────────────────────────────────────────
    battery('a non-linear landing -> the merge that brought the version onto the branch');
    const n = fixture();
    n.writeCli('2.0.0');
    const nBase = n.commit('base');
    n.g('checkout', '-q', '-b', 'side');
    n.writeCli('2.1.0');
    const sideBump = n.commit('version on a side branch');
    n.g('checkout', '-q', 'main');
    const m1 = n.commit('main moves on', 'm1.txt');
    n.g('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const merge = n.g('rev-parse', 'HEAD').trim();
    const nonLinear = select({ cwd: n.dir, event: 'push', before: m1, head: merge, npmStateOf: off });
    check(
      nonLinear.versionCommit === merge && nonLinear.versionCommit !== sideBump && nonLinear.versionCommit !== nBase,
      'the version commit is the merge on the first-parent chain, not the side-branch bump',
    );
    check(nonLinear.pending, 'and a push carrying that merge is pending');

    battery('a shallow clone -> refused, never a graft-boundary answer');
    const shallowDir = mkdtempSync(join(tmpdir(), 'release-pending-publish-shallow-'));
    dirs.push(shallowDir);
    gitOk(tmpdir(), ['clone', '-q', '--depth', '1', `file://${r.dir}`, shallowDir]);
    check(
      throws(() => findVersionCommit({ cwd: shallowDir, head: 'HEAD' }), /shallow clone/),
      'a depth-1 clone -- whose only commit has no parent -- is refused, not answered',
    );
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }

  battery('npm view -> present / absent / unknown');
  check(classifyNpmView('1.1.0', { status: 0, stdout: '1.1.0\n', stderr: '' }) === 'present', 'exit 0 printing the version -> present');
  check(classifyNpmView('1.1.0', { status: 1, stdout: '', stderr: 'npm error code E404\n' }) === 'absent', 'E404 -> absent');
  check(classifyNpmView('1.1.0', { status: 0, stdout: '', stderr: '' }) === 'absent', 'exit 0 printing nothing (no matching version) -> absent');
  check(classifyNpmView('1.1.0', { status: 1, stdout: '', stderr: 'npm error code ETIMEDOUT\n' }) === 'unknown', 'a network error -> unknown, never absent');
  check(
    npmState('1.1.0', () => ({ status: 0, stdout: '1.1.0\n', stderr: '' })) === 'present' &&
      throws(() => npmState('1.1.0; rm -rf /', () => ({ status: 0 })), /not a version/),
    'npmState runs the classifier, and refuses a non-version argument before spawning',
  );

  battery('a waiting prompt -> cancelled only on the push lane, only when its version is on npm');
  const prompt = (version, status = 'waiting') => ({ name: `Publish ${version} to npm (awaiting approval)`, status });
  const run = (id, over = {}) => ({
    id,
    event: 'push',
    status: 'waiting',
    jobs: [{ name: 'Release integrity (audit + no-mint backfill)', status: 'completed' }, prompt('1.1.0')],
    environments: ['release'],
    ...over,
  });
  const judged = judgeWaitingRuns({
    currentRunId: 900,
    npmStateOf: (version) => ({ '1.1.0': 'present', '1.2.0': 'absent', '1.3.0': 'unknown' })[version],
    runs: [
      run(101),
      run(102, { jobs: [prompt('1.2.0')] }),
      run(103, { event: 'workflow_dispatch' }),
      run(900),
      run(104, { status: 'in_progress', jobs: [prompt('1.1.0', 'in_progress')] }),
      run(105, { jobs: [prompt('1.1.0', 'in_progress')] }),
      run(106, { environments: ['staging'] }),
      run(107, { jobs: [prompt('1.3.0')] }),
      run(108, { jobs: [{ name: 'Publish ${{ needs.release-integrity.outputs.cli-version }} to npm (awaiting approval)', status: 'waiting' }] }),
    ],
  });
  const where = (id) =>
    judged.cancel.some((c) => c.id === String(id))
      ? 'cancel'
      : judged.keep.some((c) => c.id === String(id))
        ? 'keep'
        : judged.untouched.some((c) => c.id === String(id))
          ? 'untouched'
          : 'nowhere';
  check(where(101) === 'cancel', 'a push-lane prompt for a version already on npm -> cancelled');
  check(where(102) === 'keep', 'a push-lane prompt for a version NOT on npm -> kept (a live release)');
  check(where(103) === 'untouched', 'a dispatch prompt, even for a published version -> untouched (a human act; D4 force waits by design)');
  check(where(900) === 'untouched', 'the calling run -> untouched');
  check(where(104) === 'untouched', 'an approved, running publish -> untouched (never cancelled mid-flight)');
  check(where(105) === 'untouched', 'a waiting run whose publish job is not the waiting one -> untouched');
  check(where(106) === 'untouched', 'a prompt on another environment -> untouched');
  check(where(107) === 'keep', 'npm unreadable -> kept, never judged stale on a guess');
  check(where(108) === 'untouched', 'an unevaluated job name is no prompt -> untouched');

  battery('an event with no release predicate -> refused');
  check(
    throws(() => decidePending({ event: 'schedule', range: { state: 'in-push' }, npm: 'absent' }), /no release predicate/),
    'schedule is the bookkeeping lane and has no publish predicate at all',
  );

  // ── the floor: every declared battery ran, at or above its pin ─────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = (message) => {
    failed += 1;
    console.error(`✗ self-test floor: ${message}`);
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) floor(`battery "${name}" registered ${count} case(s) but is not declared.`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floor(
        count === 0
          ? `battery "${name}" DID NOT RUN -- 0 cases, ${SELF_TEST_BATTERIES[name]} pinned.`
          : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}.`,
      );
    }
  }

  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  if (failed > 0) {
    console.error(`\n✗ release-pending-publish self-test: ${failed} failure(s) across ${declared.length} batteries.`);
    process.exit(1);
  }
  console.log(`\n✓ release-pending-publish self-test: ${total} cases across ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

async function main(argv) {
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ release-pending-publish self-test: selfTest() returned without reaching its verdict, so no ' +
          'success line was printed. Exiting 0 here would report a self-test that never finished as one that passed.',
      );
      process.exit(1);
    }
    return;
  }
  const [mode, ...rest] = argv;
  if (mode === 'select') {
    const event = flag(rest, '--event');
    const head = flag(rest, '--head');
    const before = flag(rest, '--before') || '';
    if (!event || !head) throw new Error('select needs --event and --head');
    if (event === 'push' && before && !FULL_SHA.test(before)) throw new Error(`--before is not a full sha: ${before}`);
    const result = select({ cwd: process.cwd(), event, head, before, npmStateOf: (v) => npmState(v) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === 'npm-state') {
    if (!rest[0]) throw new Error('npm-state needs a version');
    process.stdout.write(`${npmState(rest[0])}\n`);
    return;
  }
  if (mode === 'sweep') {
    await sweep({ workflow: flag(rest, '--workflow') || 'release.yml', dryRun: rest.includes('--dry-run') });
    return;
  }
  throw new Error(`unknown mode ${JSON.stringify(mode)} -- expected select, npm-state, sweep or --self-test`);
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`::error::release-pending-publish: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}
