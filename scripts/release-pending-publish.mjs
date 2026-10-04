#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-pending-publish -- WHICH commit a release publishes, WHICH push queues
 * its approval prompt, WHICH waiting prompts are no longer a release
 * (ADR-0125 D1, as amended 2026-09-29), and WHETHER a version's publish, or its
 * publishing run's image build, is in flight, so neither backfill (the
 * Releases, the runtime image) writes beside it.
 *
 *   node scripts/release-pending-publish.mjs select --event push --head SHA --before SHA
 *   node scripts/release-pending-publish.mjs select --event workflow_dispatch --head SHA
 *   node scripts/release-pending-publish.mjs npm-state VERSION
 *   node scripts/release-pending-publish.mjs unconsumed --version-commit SHA --version VERSION
 *   node scripts/release-pending-publish.mjs unconsumed --version-commit SHA --json
 *   node scripts/release-pending-publish.mjs sweep --workflow release.yml [--dry-run]
 *   node scripts/release-pending-publish.mjs in-flight --version VERSION --version-commit SHA --head SHA --workflow release.yml
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
 * `unconsumed` -- what the version commit ships WITHOUT a CHANGELOG entry
 * (#21361). The Version Packages PR cannot be refreshed while it is queued,
 * and the merge queue lands it on top of the current main. So the version
 * commit's tree carries every landing since the PR's last refresh, and the PR
 * deleted, and turned into CHANGELOG entries, only the changesets that existed
 * at that refresh. The later ones stay in `.changeset/`: their code ships under
 * the new version, and its CHANGELOG does not name them. Measured on every
 * release since 17.3.0, with the version commit and what it left behind:
 *
 *   17.3.0  8a1bad8b8   4 changesets from  3 commits
 *   17.4.0  7e6337007  13 changesets from 13 commits
 *   17.5.0  8c87d26a5   8 changesets from  7 commits (two breaking)
 *   17.6.0  617f25f8a   1 changeset  from  1 commit  (748b24072, #21270)
 *   17.2.0  e7d2cc67f   none -- and 17.1.0 and 17.0.0 none either
 *
 * The answer: every pending changeset in the version commit's tree, each named
 * with the commit that added it. "Pending" is what `changeset version` itself
 * would read there: a top-level `.changeset/*.md` that `@changesets/read`
 * (1.0.1, the version pnpm-lock resolves) does not skip, so not a dotfile and
 * not README.md (any case), AGENTS.md, CLAUDE.md or GEMINI.md. Pre mode is
 * read both ways it has been stored: today's `@changesets/cli` MOVES a
 * consumed changeset into `.changeset/pre/`, which is not top-level; the 2.x
 * shape the 17.0.0 release candidates carry KEPT it in place and listed its id
 * in `.changeset/pre.json`'s `changesets`, and a listed id counts as consumed.
 * A changeset `changeset version` skips on purpose -- every package it names
 * in `ignore`, or private with `privatePackages.version: false` -- would be
 * reported too; `.changeset/config.json` configures neither today.
 *
 * The commit that added it is `@changesets/git`'s own lookup, the newest
 * `--diff-filter=A` commit for that path, with renames off so a rename counts
 * as the add of the new path. The walk starts AT the version commit, so the
 * commit it names is always the version commit or an ancestor of it: a
 * changeset that landed after the version commit is in another tree and is
 * never this release's. A SHALLOW clone is refused, as `select` refuses one:
 * at the graft boundary every older changeset would read as added by the
 * boundary commit -- a confident wrong commit, never an empty answer.
 *
 * The report never refuses a release: it is a `::warning::` and a job-summary
 * section, and `release.yml` runs it in the push (or dispatch) that queues the
 * publish, where the approver reads it. `--json` prints the measurement alone.
 *
 * `npm-state` -- present / absent / unknown for one version, from `npm view`'s
 * exit status and its `E404`. The caller decides what `unknown` means: the
 * audit keeps its old reading (not on npm), the publish guard proceeds with a
 * warning, because `changeset publish` skips an already-published version by
 * itself and an unreachable registry cannot publish anything either.
 *
 * `sweep` -- the waiting-prompt half. Finds this workflow's `waiting` runs
 * (`collectWaitingRuns`), and CANCELS a run only when ALL of these hold:
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
 * `in-flight` -- the backfills' guard. `release-integrity` backfills
 * the GitHub Releases of a version whose whole fixed group is on npm, and npm
 * settles BEFORE the publish job reaches its own "Create GitHub Releases"
 * step. So a landing audited in that window used to write the same Releases
 * the publish job was writing. Measured on 17.6.0: the publish job of run
 * 36955885276 created its Releases 03:03:47Z -> 03:05:42Z, the backfill of run
 * 36958423332 (a later landing) started writing them at 03:04:37Z, and five
 * tags got two Release objects each. The two writers are in different runs,
 * so no `needs:` edge can order them; this read is the guard.
 *
 * It answers `in-flight` or `clear` for ONE version. In flight means another
 * run of this workflow holds a job named `Publish VERSION to npm (awaiting
 * approval)` whose status is neither `completed` nor `waiting` (a job GitHub
 * holds at the `release` environment has run no step, and runs none before a
 * human approves it; an approved one is `queued`, then `in_progress`). A status
 * this script does not know is in flight. The runs read are the union of two
 * readings, because the run-list status filter is not trusted alone (see
 * `collectWaitingRuns`): the runs the `in_progress` and `queued` filters list,
 * which is where a dispatch (repair-lane) publish is found, and the push run
 * at the version commit or the first-parent commits after it, which is where
 * the push-lane publish runs. Each candidate is then read directly, with its
 * jobs. Any answer it cannot read -- a non-200, a malformed body, a filter
 * counting more runs than it listed, a version-commit walk that disagrees with
 * the audit -- answers `in-flight` with reason `unreadable`, so nothing is
 * backfilled off a guess and the next landing reads again. A push run it
 * cannot find is not unreadable: the filters still speak for it, and a guard
 * that blocked on it would block the repair of that version for good.
 *
 * The same read answers the image backfill (`docker` in the answer, beside the
 * publish job's top-level verdict). `release-integrity` requests the runtime
 * image of a version whose whole group is on npm and whose image is missing,
 * and npm settles before the publishing run's own `docker` job even exists:
 * that job is `needs: [release-integrity, publish]`, so GitHub creates it when
 * the publish job completes. Measured on 17.6.0: run 36955885276's publish job
 * completed at 03:05:45Z and its docker job was created that second and built
 * 03:05:49Z -> 03:10:02Z, while the backfill of run 36958423332, requested by
 * an audit that read the image missing at about 03:04Z, built 03:05:48Z ->
 * 03:09:18Z. Both pushed the 17.6.0 tag. So the image is in flight in a run
 * that holds the version's publish job past the `release` environment (not
 * `waiting`) until every docker job of that run is `completed` -- including
 * while it has none yet. A publish held at the environment builds nothing
 * before a human approves it, so it is not in flight for the image either, and
 * an unreadable read answers `in-flight` with reason `unreadable` here too.
 *
 * It skips writes and refuses nothing: the audit leaves `releases-missing` and
 * `image-missing` unset, says why, and stays green. Read-only by construction:
 * it runs over the `--dry-run` HTTP layer, so a non-GET cannot leave it.
 * Permission: `actions: read`.
 *
 * ## Why the pins live here, not in the workflow
 *
 * The production path runs a handful of times a year, on a runner, against a
 * history nobody can rewind. `--self-test` builds throwaway repositories for the
 * sequences that matter (a version commit then two landings, a merge-queue
 * batch, a published version, a force-push, a shallow clone) and asserts the
 * selected sha, and drives the sweep's read through a stubbed API; it is wired
 * in lint.yml as the only instrument on this logic.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
// The changesets a version commit did not consume
// ─────────────────────────────────────────────────────────────────────────────

export const CHANGESET_DIR = '.changeset';
/** Where the 2.x pre mode listed the ids it had consumed but kept in place. */
export const PRE_STATE = '.changeset/pre.json';

/** The basenames `@changesets/read` 1.0.1 skips inside `.changeset/` (its `ignoredMdFiles`). */
const CHANGESET_SKIPPED = Object.freeze([/^README\.md$/i, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^GEMINI\.md$/]);

/** Is this top-level `.changeset/` basename one `changeset version` reads as a changeset? */
export function isChangesetFile(basename) {
  return !basename.startsWith('.') && basename.endsWith('.md') && !CHANGESET_SKIPPED.some((p) => p.test(basename));
}

/**
 * Every pending changeset in the version commit's tree, each with the commit
 * that added it. Pending means `changeset version` would still read it, so the
 * version commit did not consume it. Throws on a shallow clone, on a rev that
 * is not a commit, and on a `pre.json` whose `changesets` is not a list of ids.
 */
export function unconsumedChangesets({ cwd, versionCommit }) {
  if (gitOk(cwd, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
    throw new Error(
      'refusing to name the commits that added changesets in a shallow clone: at the graft boundary every older ' +
        'changeset reads as added by the boundary commit. Check out with fetch-depth: 0.',
    );
  }
  const sha = gitOk(cwd, ['rev-parse', '--verify', `${versionCommit}^{commit}`]).trim();
  // `--full-tree`: paths from the repository root whatever the cwd. A tree
  // with no `.changeset/` lists nothing, which is the answer "none pending".
  const blobs = gitOk(cwd, ['ls-tree', '-z', '--full-tree', sha, '--', `${CHANGESET_DIR}/`])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      return { type: entry.slice(0, tab).split(' ')[1], path: entry.slice(tab + 1) };
    })
    .filter((e) => e.type === 'blob');

  let recorded = new Set();
  if (blobs.some((e) => e.path === PRE_STATE)) {
    const text = gitOk(cwd, ['show', `${sha}:${PRE_STATE}`]);
    let state;
    try {
      state = JSON.parse(text);
    } catch (err) {
      throw new Error(`${PRE_STATE} at ${sha} is not JSON (${err instanceof Error ? err.message : err})`);
    }
    if (state && state.changesets !== undefined) {
      if (!Array.isArray(state.changesets) || !state.changesets.every((id) => typeof id === 'string')) {
        throw new Error(`${PRE_STATE} at ${sha} carries a "changesets" that is not a list of changeset ids`);
      }
      recorded = new Set(state.changesets);
    }
  }

  const pending = blobs.filter((e) => isChangesetFile(e.path.slice(CHANGESET_DIR.length + 1)));
  const unconsumed = [];
  let recordedInPreState = 0;
  for (const { path } of pending) {
    if (recorded.has(path.slice(CHANGESET_DIR.length + 1, -'.md'.length))) {
      recordedInPreState += 1;
      continue;
    }
    const added = gitOk(cwd, ['log', '--no-renames', '--diff-filter=A', '--max-count=1', '--format=%H %s', sha, '--', path]).trim();
    const space = added.indexOf(' ');
    unconsumed.push(
      added === ''
        ? { path, commit: null, subject: null }
        : { path, commit: space === -1 ? added : added.slice(0, space), subject: space === -1 ? '' : added.slice(space + 1) },
    );
  }
  return {
    versionCommit: sha,
    pending: pending.length,
    recordedInPreState,
    unconsumed,
    commits: new Set(unconsumed.map((c) => c.commit ?? `unknown:${c.path}`)).size,
  };
}

/** A workflow command's message: `%`, CR and LF are the three characters the runner unescapes. */
function commandData(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * The report over a measurement -- pure, so its every line is pinned. `log` is
 * printed to the step's log (the first line the `::warning::` when there is a
 * finding), `summary` is appended to the job summary.
 */
export function describeUnconsumed({ version, report }) {
  const short = report.versionCommit.slice(0, 10);
  if (report.unconsumed.length === 0) {
    const kept =
      report.recordedInPreState > 0 ? ` (${report.recordedInPreState} kept in place and recorded as consumed in ${PRE_STATE})` : '';
    const line = (sha) =>
      `Changesets: the version commit ${sha} consumed every changeset in its tree${kept}, so ${version}'s CHANGELOG leaves out no landed change.`;
    return { log: [line(short)], summary: ['', line(`\`${short}\``)] };
  }
  const n = report.unconsumed.length;
  const by = (c) => (c.commit ? c.commit.slice(0, 10) : 'commit not found');
  const warning =
    `::warning::${n} changeset(s) from ${report.commits} commit(s) are still in the tree of the version commit ${short}, ` +
    `which did not consume them: their code ships in ${version}, and the CHANGELOG.md files ${version} publishes do not ` +
    `name them. The next Version Packages PR lists them under the next version. Name them in the ${version} release ` +
    `notes. ${report.unconsumed.map((c) => `${c.path} (${by(c)})`).join(', ')}`;
  return {
    log: [
      commandData(warning),
      ...report.unconsumed.map((c) => `  ${c.path}  added by ${c.commit ? `${c.commit.slice(0, 10)} ${c.subject}` : 'a commit this history does not show'}`),
    ],
    summary: [
      '',
      `### ${n} changeset(s) ship in ${version} without a CHANGELOG entry`,
      '',
      `The version commit \`${short}\` still carries these in its tree: it did not consume them, so the`,
      `\`CHANGELOG.md\` files ${version} publishes do not name them, while their code is in this release.`,
      `The next Version Packages PR lists them under the next version. Name them in the ${version} release notes.`,
      '',
      ...report.unconsumed.map((c) =>
        c.commit ? `- \`${c.path}\`, added by \`${c.commit.slice(0, 10)}\`: ${c.subject}` : `- \`${c.path}\`, added by a commit this history does not show`,
      ),
    ],
  };
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

// GitHub fails a job after 30 days at an environment, so a push run created
// earlier no longer waits (bar a re-run, which only the filter reaches).
export const WAITING_READ_BACK_DAYS = 30;
// At most 5 landings per push across the 2,509 main pushes of the 29 days to
// 2026-09-30, so the push that carried a version commit ends well inside 20.
export const PUSH_WALK = 20;
/** A runaway cap only: 3 version commits landed in the 30 days to 2026-09-30. */
export const MAX_VERSION_COMMITS = 20;

/**
 * The version commits on `head`'s first-parent chain, newest first and lazily,
 * each with the first-parent commits from it toward `head` (at most `walk`).
 * Under ADR-0125 D1 as amended, only the push that carries a version commit
 * queues a push-lane publish, and that push's tip is one of those commits.
 */
export function* versionCommitsOf({ cwd, head = 'HEAD', walk = PUSH_WALK }) {
  if (gitOk(cwd, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
    throw new Error('refusing to list version commits in a shallow clone: the graft boundary reads as a version change. Check out with fetch-depth: 0.');
  }
  const chain = gitOk(cwd, ['rev-list', '--first-parent', head]).split('\n').filter(Boolean);
  const at = new Map(chain.map((c, i) => [c, i]));
  for (const commit of gitOk(cwd, ['log', '--first-parent', '--format=%H', head, '--', CLI_MANIFEST]).split('\n').filter(Boolean)) {
    const version = versionAt(cwd, commit);
    const parent = git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^1`]);
    if (version === null || version === (parent.status === 0 ? versionAt(cwd, parent.stdout.trim()) : null)) continue;
    const i = at.get(commit);
    yield { versionCommit: commit, version, tips: chain.slice(Math.max(0, i - walk + 1), i + 1).reverse() };
  }
}

/**
 * Every waiting run of one workflow, in `judgeWaitingRuns`' shape; `http` and
 * `now` are injectable. The `?status=waiting` filter answered the job token an
 * empty list on 2026-09-29 (runs 36579512725, 36579680181) while it listed a
 * waiting run to another reader, for a reason still unmeasured, so it is never
 * the only reading: each version commit's push run is also found by `head_sha`,
 * newest first until one was created before the bound, and must carry that
 * version's publish job. Every run either reading names is read directly, and
 * only that read's status is judged. The cost follows releases, not runs; what
 * cannot be found or does not add up lands in `anomalies`, printed as warnings.
 */
export async function collectWaitingRuns({
  http,
  repo,
  workflow,
  versionCommits,
  currentRunId = '',
  now = Date.now(),
  readBackDays = WAITING_READ_BACK_DAYS,
  maxVersionCommits = MAX_VERSION_COMMITS,
}) {
  const listPath = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`;
  const list = expectOk(await http('GET', `${listPath}?status=waiting&per_page=100`), `listing ${workflow}'s waiting runs`);
  const filtered = { total: list.total_count, ids: list.workflow_runs.map((r) => String(r.id)) };
  const anomalies = [];
  if (filtered.total > filtered.ids.length) {
    anomalies.push(`the status=waiting filter counts ${filtered.total} waiting runs but listed ${filtered.ids.length}.`);
  }

  const cutoff = now - readBackDays * 86_400_000;
  const targeted = { days: readBackDays, probes: 0, stop: 'history', pushes: [] };
  const expected = new Map();
  for (const { versionCommit, version, tips } of versionCommits) {
    if (targeted.pushes.length === maxVersionCommits) {
      targeted.stop = 'cap';
      break;
    }
    let found = [];
    for (const sha of tips) {
      targeted.probes += 1;
      const page = expectOk(
        await http('GET', `${listPath}?head_sha=${sha}&per_page=100&exclude_pull_requests=true`),
        `listing ${workflow}'s runs at ${sha}`,
      );
      found = page.workflow_runs.filter((r) => r.event === 'push');
      if (found.length > 0) break;
    }
    if (found.length > 0 && found.every((r) => Date.parse(r.created_at) < cutoff)) {
      targeted.stop = 'bound';
      break;
    }
    targeted.pushes.push({ version, versionCommit, runs: found.map((r) => String(r.id)) });
    if (found.length === 0) {
      anomalies.push(
        `no push run of ${workflow} at version commit ${versionCommit} (${version}) or the ${tips.length - 1} first-parent ` +
          'commit(s) after it: a publish prompt of that push is invisible to this read.',
      );
    }
    for (const r of found) expected.set(String(r.id), { version, versionCommit });
  }
  if (targeted.stop === 'cap') {
    anomalies.push(
      `the version-commit walk stopped at its cap of ${maxVersionCommits} before reaching a push run older than ` +
        `${readBackDays} days: an older push-lane prompt is seen only if the status=waiting filter lists it.`,
    );
  }

  const runs = [];
  for (const id of new Set([...filtered.ids, ...expected.keys()])) {
    const r = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}`), `reading run ${id}`);
    const run = { id: r.id, event: r.event, status: r.status, headSha: r.head_sha, jobs: [], environments: [] };
    runs.push(run);
    // A run still in flight may not have named its publish job yet, and the
    // calling run is judged untouched whatever it holds: neither is checked.
    const carried = expected.get(id);
    const verify = carried && id !== String(currentRunId) && (r.status === 'waiting' || r.status === 'completed');
    if (r.status !== 'waiting' && !verify) continue;
    const jobs = expectOk(
      await http('GET', `/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`),
      `listing run ${id}'s jobs`,
    );
    run.jobs = jobs.jobs.map((j) => ({ name: j.name, status: j.status }));
    if (verify && !run.jobs.some((j) => j.name === `Publish ${carried.version} to npm (awaiting approval)`)) {
      anomalies.push(
        `run ${id}, found as the push that carried version commit ${carried.versionCommit}, has no "Publish ${carried.version} ` +
          'to npm" job: it is not that push, or that push queued no publish.',
      );
    }
    if (r.status !== 'waiting') continue;
    if (!filtered.ids.includes(id)) {
      anomalies.push(`the status=waiting filter omitted run ${id}, which a direct read answers waiting.`);
    }
    const pending = expectOk(
      await http('GET', `/repos/${repo}/actions/runs/${id}/pending_deployments`),
      `reading run ${id}'s pending deployments`,
    );
    run.environments = pending.map((p) => p.environment && p.environment.name).filter(Boolean);
  }
  return { runs, filtered, targeted, anomalies };
}

/** The readings behind a sweep verdict, as one summary line printed on every run. */
export function describeReadings({ runs, filtered, targeted }) {
  const stop = {
    bound: `a push run older than ${targeted.days} days`,
    history: 'the start of history',
    cap: 'CUT SHORT at the version-commit cap',
  }[targeted.stop];
  const pushes = targeted.pushes.map((p) => `${p.version} ${p.versionCommit.slice(0, 10)} -> ${p.runs.join('+') || 'NOT FOUND'}`);
  const direct = runs.map((r) => `${r.id} ${r.status}`).join(', ') || 'none';
  return (
    `- readings: \`?status=waiting\` total_count ${filtered.total}, listed [${filtered.ids.join(', ')}]; ` +
    `version-commit pushes back to ${stop} [${pushes.join(', ')}] in ${targeted.probes} head_sha probe(s); direct: ${direct}`
  );
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

  const versionCommits = versionCommitsOf({ cwd: process.cwd() });
  const read = await collectWaitingRuns({ http, repo, workflow, versionCommits, currentRunId });
  for (const a of read.anomalies) console.log(`::warning::${a}`);
  const { runs } = read;
  const verdict = judgeWaitingRuns({ runs, currentRunId, npmStateOf: (v) => npmState(v) });

  const waiting = runs.filter((r) => r.status === 'waiting').length;
  const lines = [`### Waiting approval prompts (${waiting} waiting run(s) of ${workflow})`, '', describeReadings(read)];
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
  if (waiting === 0) lines.push('- none waiting');
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

  if (failures.length > 0) {
    for (const f of failures) console.log(`::error::${f}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Is this version's publish, or its image build, in flight? (the backfills' guard)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The publish job statuses that are NOT in flight: `completed` (it ran) and
 * `waiting` (held at the `release` environment, no step run). Every other
 * status, named here or not, is in flight.
 */
export const PUBLISH_SETTLED_JOB_STATUSES = Object.freeze(['completed', 'waiting']);

/** The run-list filters read for a publish in flight. */
export const IN_FLIGHT_RUN_FILTERS = Object.freeze(['in_progress', 'queued']);

/**
 * `release.yml`'s `docker` job as the jobs API names it: `Docker image` while
 * it is skipped, `Docker image / <the called job>` once the reusable workflow
 * it calls runs. Measured: run 36955885276's `Docker image / Build & push
 * ghcr.io/objectstack-ai/objectstack`, run 37148267152's skipped `Docker image`.
 * A rename that this misses reads as "not yet created", so the image counts as
 * in flight until the publishing run completes: late, never early.
 */
export const DOCKER_JOB_NAME = /^Docker image(?: \/ .+)?$/;

/**
 * The publishing run's image build -- pure, one run. A run is the version's
 * publishing run when it holds the version's publish job past the `release`
 * environment (any status but `waiting`: approved, running or done). Its
 * `docker` job is `needs: [release-integrity, publish]`, so GitHub creates it
 * only when the publish job completes: until every docker job of the run is
 * `completed`, including while there is none yet, the image is in flight.
 * Null when the run is not that version's publishing run.
 */
function dockerInFlightIn(run, publishName) {
  const publish = run.jobs.find((j) => j.name === publishName && j.status !== 'waiting');
  if (!publish) return null;
  const docker = run.jobs.filter((j) => DOCKER_JOB_NAME.test(j.name));
  if (docker.length > 0 && docker.every((j) => j.status === 'completed')) return null;
  return {
    run: String(run.id),
    event: run.event,
    publish: publish.status,
    docker: docker.length === 0 ? 'not yet created' : docker.map((j) => j.status).join('+'),
  };
}

/**
 * Judge the runs read for one version -- pure. Each run is `{ id, event,
 * status, jobs }`; `jobs` may be null only for a completed run. A run that is
 * not completed and was not read past its status answers `unreadable`.
 *
 * Two answers from one read: the top level is the publish job's (the Releases
 * backfill's guard), and `docker` is the image build of that version's
 * publishing run (the image backfill's guard), each `in-flight` or `clear`.
 * A completed run is settled for both: its jobs, the docker job included,
 * have all finished.
 */
export function judgePublishInFlight({ version, runs, currentRunId }) {
  const name = `Publish ${version} to npm (awaiting approval)`;
  const inFlight = [];
  const building = [];
  for (const run of runs) {
    const id = String(run.id);
    if (id === String(currentRunId) || run.status === 'completed') continue;
    if (!Array.isArray(run.jobs)) {
      const detail = `run ${id} is ${run.status} and its jobs were not read`;
      return { state: 'in-flight', reason: 'unreadable', detail, inFlight, docker: { state: 'in-flight', reason: 'unreadable', detail, inFlight: building } };
    }
    for (const job of run.jobs) {
      if (job.name === name && !PUBLISH_SETTLED_JOB_STATUSES.includes(job.status)) {
        inFlight.push({ run: id, event: run.event, status: job.status });
      }
    }
    const image = dockerInFlightIn(run, name);
    if (image) building.push(image);
  }
  const docker =
    building.length > 0
      ? {
          state: 'in-flight',
          reason: 'docker-in-flight',
          detail: `image build not finished in ${building
            .map((b) => `run ${b.run} (${b.event}, publish job ${b.publish}, Docker image ${b.docker})`)
            .join(', ')}`,
          inFlight: building,
        }
      : { state: 'clear', reason: 'none-in-flight', detail: `no other run is still building ${version}'s image after publishing it`, inFlight: building };
  if (inFlight.length > 0) {
    const where = inFlight.map((f) => `run ${f.run} (${f.event}, job ${f.status})`).join(', ');
    return { state: 'in-flight', reason: 'publish-in-flight', detail: `"${name}" is in flight in ${where}`, inFlight, docker };
  }
  return { state: 'clear', reason: 'none-in-flight', detail: `no other run holds "${name}" in flight`, inFlight, docker };
}

/**
 * The runs `judgePublishInFlight` needs, read through `http`; throws on any
 * answer it cannot read. `tips` is the version commit followed by the
 * first-parent commits after it (`versionCommitsOf`), where the push run that
 * carried it is found.
 */
export async function collectPublishRuns({ http, repo, workflow, tips, currentRunId = '' }) {
  const listPath = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`;
  const listed = (page, what) => {
    if (!page || !Array.isArray(page.workflow_runs)) throw new Error(`${what} answered no workflow_runs list`);
    return page.workflow_runs;
  };
  const ids = new Set();
  const filters = [];
  for (const status of IN_FLIGHT_RUN_FILTERS) {
    const what = `listing ${workflow}'s ${status} runs`;
    const page = expectOk(await http('GET', `${listPath}?status=${status}&per_page=100&exclude_pull_requests=true`), what);
    const runs = listed(page, what);
    if (typeof page.total_count !== 'number' || page.total_count > runs.length) {
      throw new Error(`${what}: total_count ${page.total_count} but ${runs.length} listed, so the rest are unread`);
    }
    for (const r of runs) ids.add(String(r.id));
    filters.push(`${status} [${runs.map((r) => r.id).join(', ')}]`);
  }
  let pushRuns = [];
  for (const sha of tips) {
    const what = `listing ${workflow}'s runs at ${sha}`;
    const page = expectOk(await http('GET', `${listPath}?head_sha=${sha}&per_page=100&exclude_pull_requests=true`), what);
    pushRuns = listed(page, what).filter((r) => r.event === 'push').map((r) => String(r.id));
    if (pushRuns.length > 0) break;
  }
  for (const id of pushRuns) ids.add(id);

  const runs = [];
  for (const id of ids) {
    if (id === String(currentRunId)) continue;
    const r = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}`), `reading run ${id}`);
    const run = { id: String(r.id), event: r.event, status: r.status, jobs: null };
    if (r.status !== 'completed') {
      const what = `listing run ${id}'s jobs`;
      const jobs = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`), what);
      if (!jobs || !Array.isArray(jobs.jobs)) throw new Error(`${what} answered no jobs list`);
      run.jobs = jobs.jobs.map((j) => ({ name: j.name, status: j.status }));
    }
    runs.push(run);
  }
  const readings =
    `filters ${filters.join('; ')}; push run at the version commit ${pushRuns.join('+') || 'NOT FOUND'} ` +
    `(${tips.length} commit(s) walked); direct: ${runs.map((r) => `${r.id} ${r.status}`).join(', ') || 'none'}`;
  return { runs, pushRuns, readings };
}

/**
 * The guard's whole answer for one version, never a throw: whatever cannot be
 * read answers `in-flight` with reason `unreadable`, for the publish job and
 * the image build alike, so the caller backfills nothing off a guess. `walk`
 * yields the version commits of the head (`versionCommitsOf`); the first must
 * be the one the caller names.
 */
export async function publishInFlight({ http, repo, workflow, version, versionCommit, walk, currentRunId = '' }) {
  try {
    const first = walk.next().value;
    if (!first || first.versionCommit !== versionCommit || first.version !== version) {
      throw new Error(
        `the version-commit walk names ${first ? `${first.versionCommit} (${first.version})` : 'nothing'}, ` +
          `the caller ${versionCommit} (${version}): two readers of one history disagree`,
      );
    }
    const read = await collectPublishRuns({ http, repo, workflow, tips: first.tips, currentRunId });
    const verdict = judgePublishInFlight({ version, runs: read.runs, currentRunId });
    if (read.pushRuns.length === 0) {
      const note = `; no push run of ${workflow} was found at the version commit, so the run-list filters alone speak for it`;
      if (verdict.state === 'clear') verdict.detail += note;
      if (verdict.docker.state === 'clear') verdict.docker.detail += note;
    }
    return { version, ...verdict, readings: read.readings };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      version,
      state: 'in-flight',
      reason: 'unreadable',
      detail,
      inFlight: [],
      docker: { state: 'in-flight', reason: 'unreadable', detail, inFlight: [] },
      readings: '',
    };
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
  'the version-commit list -> newest first, each with the commits its push can end on': 4,
  'the waiting-runs read -> a run the status filter omits is still judged, and a short or contradictory read is flagged': 13,
  'an event with no release predicate -> refused': 1,
  'a Version Packages PR landing behind main -> each changeset it did not consume, with the commit that added it': 4,
  'a version commit that consumed every changeset -> none (the control)': 2,
  'only what changeset version reads is a changeset -> README, AGENTS, dotfiles, pre/ and non-.md files are not': 2,
  'a 2.x pre.json -> the ids it lists are consumed, the rest are not, and a malformed list is refused': 2,
  'the commit that added it -> the newest add, a rename included, never a landing after the version commit': 3,
  'a shallow clone or an unresolvable version commit -> refused, never a boundary commit or an empty answer': 2,
  'the report -> a warning naming every changeset with its commit, a summary section, or a plain line for none': 4,
  "a publish of the version in another run -> in flight until it completes, and an unreadable read is in flight": 12,
  "the publishing run's image build -> in flight from the approval until its docker job completes, and an unreadable read is in flight": 12,
});
const SELF_TEST_BATTERY_FLOOR = 22;

async function selfTest() {
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

    battery('the version-commit list -> newest first, each with the commits its push can end on');
    const listed = [...versionCommitsOf({ cwd: r.dir, head: 'main' })];
    check(
      listed.map((c) => c.versionCommit).join() === [v, base].join(),
      'newest first: the bump, then the commit that created the manifest; the dependency-only edit is not one',
    );
    check(
      listed[0].version === '1.1.0' && listed[0].tips.join() === [v, l1, l2, dep].join(),
      'each carries the first-parent commits from it toward the head, oldest first',
    );
    check(
      versionCommitsOf({ cwd: r.dir, head: 'main', walk: 2 }).next().value.tips.join() === [v, l1].join(),
      'the commits after it stop at the walk cap',
    );
    check(throws(() => versionCommitsOf({ cwd: shallowDir }).next(), /shallow clone/), 'a shallow clone is refused here too');

    // ── the changesets a version commit did not consume ──────────────────
    // The 17.6.0 sequence, reduced: the Version Packages PR is refreshed on a
    // base carrying two changesets, main takes two more landings while it is
    // queued, and the queue lands it as a squash on top of them.
    const c = fixture();
    const put = (path, text = `---\n'${CLI_PACKAGE}': patch\n---\n\n${path}\n`) => {
      mkdirSync(dirname(join(c.dir, path)), { recursive: true });
      writeFileSync(join(c.dir, path), text);
    };
    const unconsumedAt = (rev) => unconsumedChangesets({ cwd: c.dir, versionCommit: rev });
    const paths = (report) => report.unconsumed.map((u) => u.path).join();
    c.writeCli('1.0.0');
    put('.changeset/README.md', 'what a changeset is\n');
    put('.changeset/config.json', '{}\n');
    put('.changeset/one.md');
    put('.changeset/two.md');
    c.commit('base: two changesets pending');
    c.g('checkout', '-q', '-b', 'version-pr');
    c.g('rm', '-q', '.changeset/one.md', '.changeset/two.md');
    c.writeCli('1.1.0');
    const refreshed = c.commit('chore: version packages (as last refreshed)');
    c.g('checkout', '-q', 'main');
    put('.changeset/three.md');
    const late1 = c.commit('a landing after the refresh');
    put('.changeset/four.md');
    put('.changeset/five.md');
    const late2 = c.commit('a landing carrying two changesets');
    c.g('merge', '-q', '--squash', 'version-pr');
    const landed = c.commit('chore: version packages (landed by the queue)');

    battery('a Version Packages PR landing behind main -> each changeset it did not consume, with the commit that added it');
    const behind = unconsumedAt('main');
    check(
      findVersionCommit({ cwd: c.dir, head: 'main' }).versionCommit === landed && behind.versionCommit === landed,
      'the queue-landed squash is the version commit select names, and the report reads that commit',
    );
    check(
      paths(behind) === '.changeset/five.md,.changeset/four.md,.changeset/three.md',
      'it names exactly the three changesets that landed after the refresh, and neither one it consumed',
    );
    check(
      behind.unconsumed.map((u) => u.commit).join() === [late2, late2, late1].join() &&
        behind.unconsumed[2].subject === 'a landing after the refresh',
      'each with the commit that added it, and that commit\'s subject -- two of them from one commit',
    );
    check(behind.pending === 3 && behind.commits === 2, 'counted as 3 changesets from 2 commits');

    battery('a version commit that consumed every changeset -> none (the control)');
    const control = unconsumedAt(refreshed);
    check(control.unconsumed.length === 0, 'the Version Packages PR landed with nothing behind it names no changeset');
    check(control.pending === 0 && control.recordedInPreState === 0, 'and its README.md and config.json are not counted as pending');

    battery('only what changeset version reads is a changeset -> README, AGENTS, dotfiles, pre/ and non-.md files are not');
    c.g('checkout', '-q', '-b', 'odd-names', refreshed);
    for (const p of ['readme.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.draft.md', 'pre/moved.md', 'nested/deep.md', 'notes.txt', 'real.md']) {
      put(`.changeset/${p}`);
    }
    const odd = unconsumedAt(c.commit('odd names under .changeset/'));
    check(odd.pending === 1 && paths(odd) === '.changeset/real.md', 'of nine files under .changeset/, only real.md is pending');
    check(
      ['README.md', 'Readme.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.x.md', 'x.mdx', 'x.json'].every((b) => !isChangesetFile(b)) &&
        isChangesetFile('x.md') && isChangesetFile('agents.md'),
      "the filter is @changesets/read's: README any case, the three agent files exactly, dotfiles and non-.md out",
    );

    battery('a 2.x pre.json -> the ids it lists are consumed, the rest are not, and a malformed list is refused');
    c.g('checkout', '-q', '-b', 'pre-mode', refreshed);
    put(PRE_STATE, `${JSON.stringify({ mode: 'pre', tag: 'rc', initialVersions: {}, changesets: ['kept'] })}\n`);
    put('.changeset/kept.md');
    put('.changeset/fresh.md');
    const pre = unconsumedAt(c.commit('rc: one changeset consumed in place, one not'));
    check(
      pre.pending === 2 && pre.recordedInPreState === 1 && paths(pre) === '.changeset/fresh.md',
      'kept.md, listed in pre.json, is consumed; fresh.md is not',
    );
    put(PRE_STATE, `${JSON.stringify({ mode: 'pre', tag: 'rc', changesets: 'kept' })}\n`);
    const malformed = c.commit('rc: a pre.json whose changesets is not a list');
    check(throws(() => unconsumedAt(malformed), /not a list of changeset ids/), 'a "changesets" that is not a list of ids is refused, not read as empty');

    battery('the commit that added it -> the newest add, a rename included, never a landing after the version commit');
    c.g('checkout', '-q', '-b', 'history', refreshed);
    put('.changeset/again.md');
    c.commit('again.md, first add');
    c.g('rm', '-q', '.changeset/again.md');
    c.commit('again.md, removed');
    put('.changeset/again.md');
    const readded = c.commit('again.md, added again');
    put('.changeset/old-name.md');
    c.commit('old-name.md added');
    c.g('mv', '.changeset/old-name.md', '.changeset/new-name.md');
    const renamed = c.commit('old-name.md renamed to new-name.md');
    const history = unconsumedAt(renamed);
    check(history.unconsumed.find((u) => u.path === '.changeset/again.md')?.commit === readded, 'a changeset removed and added again -> the commit that added it last');
    check(history.unconsumed.find((u) => u.path === '.changeset/new-name.md')?.commit === renamed, 'a renamed changeset -> the commit that put it at its current path');
    c.g('checkout', '-q', 'main');
    put('.changeset/six.md');
    const after = c.commit('a landing after the version commit');
    check(
      paths(unconsumedAt(landed)) === paths(behind) && unconsumedAt(after).unconsumed.some((u) => u.path === '.changeset/six.md' && u.commit === after),
      "a changeset that lands after the version commit is not that release's -- the next tree's",
    );

    battery('a shallow clone or an unresolvable version commit -> refused, never a boundary commit or an empty answer');
    const shallowChangesets = mkdtempSync(join(tmpdir(), 'release-pending-publish-shallow-'));
    dirs.push(shallowChangesets);
    gitOk(tmpdir(), ['clone', '-q', '--depth', '1', `file://${c.dir}`, shallowChangesets]);
    check(
      throws(() => unconsumedChangesets({ cwd: shallowChangesets, versionCommit: 'HEAD' }), /shallow clone/),
      'a depth-1 clone -- where every changeset would read as added by its one commit -- is refused',
    );
    check(throws(() => unconsumedAt('f'.repeat(40)), /exited/), 'a version commit the clone does not have is refused');
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

  battery('the waiting-runs read -> a run the status filter omits is still judged, and a short or contradictory read is flagged');
  const NOW = Date.parse('2026-09-30T00:00:00Z');
  const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();
  const pushRun = (id, status, days) => ({ id, status, event: 'push', created_at: ago(days), head_sha: 'a'.repeat(40) });
  const carrying = (id, status, days, jobs, environments = []) => ({
    ...pushRun(id, status, days),
    jobs,
    pending: environments.map((name) => ({ environment: { name } })),
  });
  const vc = (versionCommit, version, tips = [versionCommit]) => ({ versionCommit, version, tips });
  const readWith = async ({ filter = [], filterTotal, tips = {}, direct = {}, commits = [], maxVersionCommits }) => {
    const calls = [];
    const http = async (method, path) => {
      calls.push(path);
      const u = new URL(path, 'https://api.invalid');
      let m;
      if (u.pathname.endsWith('/actions/workflows/release.yml/runs')) {
        if (u.searchParams.get('status') === 'waiting') {
          return { status: 200, body: { total_count: filterTotal ?? filter.length, workflow_runs: filter } };
        }
        const at = tips[u.searchParams.get('head_sha')] ?? [];
        return at === 'fail' ? { status: 502, body: 'bad gateway' } : { status: 200, body: { workflow_runs: at } };
      }
      if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) return { status: 200, body: direct[m[1]] };
      if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) return { status: 200, body: { jobs: direct[m[1]].jobs ?? [] } };
      if ((m = /\/actions\/runs\/(\d+)\/pending_deployments$/.exec(u.pathname))) return { status: 200, body: direct[m[1]].pending ?? [] };
      return { status: 404, body: null };
    };
    const read = await collectWaitingRuns({
      http,
      repo: 'o/r',
      workflow: 'release.yml',
      versionCommits: commits,
      currentRunId: 900,
      now: NOW,
      ...(maxVersionCommits ? { maxVersionCommits } : {}),
    });
    return { read, calls };
  };
  const directReads = (calls) => calls.filter((c) => /\/actions\/runs\/\d+$/.test(c)).map((c) => c.split('/').pop());

  const pin = await readWith({
    commits: [vc('v5', '1.1.0', ['v5', 'm5', 't5'])],
    tips: { t5: [pushRun(201, 'waiting', 1)] },
    direct: { 201: carrying(201, 'waiting', 1, [prompt('1.1.0')], ['release']) },
  });
  const pinVerdict = judgeWaitingRuns({ runs: pin.read.runs, currentRunId: 900, npmStateOf: npmOf(['1.1.0']) });
  check(
    pinVerdict.cancel.map((c) => c.id).join() === '201',
    'the filtered read is empty, and the push that carried the version commit waits on a version already on npm -> cancel',
  );
  check(
    pin.read.anomalies.length === 1 && /omitted run 201/.test(pin.read.anomalies[0]),
    "and the filter's omission is a warning naming that run",
  );
  check(
    pin.read.targeted.probes === 3 && pin.read.targeted.pushes[0].runs.join() === '201',
    'a version commit landed mid-batch is found at the push tip two commits later',
  );

  const quiet = await readWith({
    commits: [vc('v6', '1.2.0'), vc('v5', '1.1.0'), vc('v4', '1.0.0'), vc('v3', '0.9.0')],
    tips: { v6: [pushRun(301, 'completed', 2)], v5: [pushRun(302, 'completed', 10)], v4: [pushRun(303, 'completed', 40)] },
    direct: {
      301: carrying(301, 'completed', 2, [prompt('1.2.0', 'completed')]),
      302: carrying(302, 'completed', 10, [prompt('1.1.0', 'completed')]),
    },
  });
  const quietLine = describeReadings(quiet.read);
  check(
    quiet.read.anomalies.length === 0 && /total_count 0/.test(quietLine) && /1\.2\.0 v6 -> 301/.test(quietLine) &&
      /older than 30 days/.test(quietLine) && /301 completed, 302 completed/.test(quietLine),
    "nothing waiting -> no warning, and the summary names the filter's total_count, each version-commit push run, and why the walk stopped",
  );
  check(
    quiet.read.targeted.stop === 'bound' && !quiet.calls.some((c) => /head_sha=v3/.test(c)) && directReads(quiet.calls).join() === '301,302',
    'the walk stops at the first push run older than the bound: no older version commit is probed, and that run is not read',
  );

  const lost = await readWith({ commits: [vc('v7', '1.3.0', ['v7', 'x1'])] });
  check(
    lost.read.anomalies.some((a) => /no push run of release\.yml at version commit v7 \(1\.3\.0\)/.test(a)) &&
      /1\.3\.0 v7 -> NOT FOUND/.test(describeReadings(lost.read)),
    'no push run at the version commit or the commits after it -> a warning, and the summary says NOT FOUND',
  );

  const wrong = await readWith({
    commits: [vc('v8', '1.4.0')],
    tips: { v8: [pushRun(501, 'completed', 3)] },
    direct: { 501: carrying(501, 'completed', 3, [{ name: 'Publish ${{ needs.release-integrity.outputs.cli-version }} to npm (awaiting approval)', status: 'completed' }]) },
  });
  check(
    wrong.read.anomalies.some((a) => /run 501, found as the push that carried version commit v8, has no "Publish 1\.4\.0/.test(a)),
    'a push run with no publish job for that version -> a warning: it is not the push that carried it, or nothing was queued',
  );

  const self = await readWith({ commits: [vc('v9', '1.5.0')], tips: { v9: [pushRun(900, 'in_progress', 0)] }, direct: { 900: pushRun(900, 'in_progress', 0) } });
  check(
    self.read.anomalies.length === 0 && !self.calls.some((c) => /900\/jobs/.test(c)) &&
      judgeWaitingRuns({ runs: self.read.runs, currentRunId: 900, npmStateOf: npmOf([]) }).untouched.some((u) => u.id === '900'),
    'the calling run carrying the version commit -> not checked for its publish job, judged untouched',
  );

  const short = await readWith({
    commits: [vc('v6', '1.2.0'), vc('v5', '1.1.0')],
    maxVersionCommits: 1,
    tips: { v6: [pushRun(301, 'completed', 2)] },
    direct: { 301: carrying(301, 'completed', 2, [prompt('1.2.0', 'completed')]) },
  });
  check(
    short.read.anomalies.some((a) => /version-commit walk stopped at its cap of 1/.test(a)) && /CUT SHORT/.test(describeReadings(short.read)),
    'the version-commit cap reached before the bound -> a warning, and the summary says the walk was cut short',
  );

  const over = await readWith({ filterTotal: 150 });
  check(over.read.anomalies.some((a) => /counts 150 waiting runs but listed 0/.test(a)), 'a filter total_count above what it listed -> a warning');

  const raced = await readWith({ filter: [pushRun(401, 'waiting', 1)], direct: { 401: pushRun(401, 'completed', 1) } });
  check(
    judgeWaitingRuns({ runs: raced.read.runs, currentRunId: 900, npmStateOf: npmOf(['1.1.0']) }).untouched.some((u) => u.id === '401') &&
      !raced.calls.some((c) => /401\/(jobs|pending)/.test(c)),
    'a run the filter calls waiting but a direct read answers completed -> judged on the direct read (untouched), its jobs never read',
  );

  const both = await readWith({
    filter: [pushRun(201, 'waiting', 1)],
    commits: [vc('v5', '1.1.0')],
    tips: { v5: [pushRun(201, 'waiting', 1)] },
    direct: { 201: carrying(201, 'waiting', 1, [prompt('1.1.0')], ['release']) },
  });
  check(
    directReads(both.calls).join() === '201' && both.read.anomalies.length === 0,
    'a run both readings name -> read once, and no warning when they agree',
  );

  let refused = false;
  try {
    await readWith({ commits: [vc('v5', '1.1.0')], tips: { v5: 'fail' } });
  } catch (err) {
    refused = /runs at v5 answered HTTP 502/.test(String(err && err.message));
  }
  check(refused, 'a probe answering non-200 -> the read throws (a red job), never a partial answer');

  battery("a publish of the version in another run -> in flight until it completes, and an unreadable read is in flight");
  {
    const job = (version, status) => ({ name: `Publish ${version} to npm (awaiting approval)`, status });
    const integrity = { name: 'Release integrity (audit + no-mint backfill)', status: 'completed' };
    const judge = (runs) => judgePublishInFlight({ version: '17.6.0', runs, currentRunId: 900 });
    const flying = judge([{ id: 36955885276, event: 'push', status: 'in_progress', jobs: [integrity, job('17.6.0', 'in_progress')] }]);
    check(
      flying.state === 'in-flight' && flying.reason === 'publish-in-flight' && /run 36955885276 \(push, job in_progress\)/.test(flying.detail),
      'the 17.6.0 window: another run\'s "Publish 17.6.0" job is in_progress -> in flight, naming that run',
    );
    check(
      judge([{ id: 1, event: 'workflow_dispatch', status: 'in_progress', jobs: [job('17.6.0', 'queued')] }]).state === 'in-flight' &&
        judge([{ id: 2, event: 'push', status: 'in_progress', jobs: [job('17.6.0', 'some_new_status')] }]).state === 'in-flight',
      'an approved job still waiting for a runner (queued) -> in flight, and a status this script does not know -> in flight',
    );
    check(
      judge([
        { id: 3, event: 'push', status: 'waiting', jobs: [integrity, job('17.6.0', 'waiting')] },
        { id: 4, event: 'push', status: 'in_progress', jobs: [job('17.6.0', 'completed'), { name: 'Docker image / Build & push', status: 'in_progress' }] },
        { id: 5, event: 'push', status: 'completed', jobs: null },
      ]).state === 'clear',
      'held at the release environment (waiting), finished in a run still running, or in a completed run -> clear',
    );
    check(
      judge([
        { id: 900, event: 'push', status: 'in_progress', jobs: [job('17.6.0', 'in_progress')] },
        { id: 6, event: 'push', status: 'in_progress', jobs: [job('17.7.0', 'in_progress')] },
        { id: 7, event: 'push', status: 'in_progress', jobs: [{ name: 'Publish ${{ needs.release-integrity.outputs.cli-version }} to npm (awaiting approval)', status: 'queued' }] },
      ]).state === 'clear',
      'the calling run, another version\'s publish, and an unevaluated job name -> clear',
    );
    check(
      judge([{ id: 8, event: 'push', status: 'in_progress', jobs: null }]).reason === 'unreadable',
      'a run still running whose jobs were never read -> unreadable, never clear',
    );

    const flightWith = async ({ filters = {}, totals = {}, tips = {}, direct = {}, fail = null, walk } = {}) => {
      const calls = [];
      const http = async (method, path) => {
        calls.push(`${method} ${path}`);
        if (fail && fail.test(path)) return { status: 502, body: 'bad gateway' };
        const u = new URL(path, 'https://api.invalid');
        let m;
        if (u.pathname.endsWith('/actions/workflows/release.yml/runs')) {
          const status = u.searchParams.get('status');
          if (status) {
            const runs = filters[status] ?? [];
            return { status: 200, body: { total_count: totals[status] ?? runs.length, workflow_runs: runs } };
          }
          return { status: 200, body: { total_count: 0, workflow_runs: tips[u.searchParams.get('head_sha')] ?? [] } };
        }
        if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) return { status: 200, body: direct[m[1]] };
        if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) return { status: 200, body: { jobs: direct[m[1]].jobs ?? [] } };
        return { status: 404, body: null };
      };
      const answer = await publishInFlight({
        http,
        repo: 'o/r',
        workflow: 'release.yml',
        version: '17.6.0',
        versionCommit: 'c'.repeat(40),
        walk: walk ?? [{ versionCommit: 'c'.repeat(40), version: '17.6.0', tips: ['c'.repeat(40), 'dcc5ef4c', 't2'] }].values(),
        currentRunId: 36958423332,
      });
      return { answer, calls };
    };
    const runAt = (id, event, status, jobs) => ({ id, event, status, head_sha: 'x', jobs });

    // The 17.6.0 race, as the runs answered it: the audit of 36958423332 at
    // 03:04Z, the publish of 36955885276 (pushed at dcc5ef4c) still running.
    const window = await flightWith({
      tips: { dcc5ef4c: [runAt(36955885276, 'push', 'in_progress')] },
      direct: { 36955885276: runAt(36955885276, 'push', 'in_progress', [integrity, job('17.6.0', 'in_progress')]) },
    });
    check(
      window.answer.state === 'in-flight' && window.answer.reason === 'publish-in-flight' &&
        /push run at the version commit 36955885276/.test(window.answer.readings),
      'the status filters list nothing, and the push run at the version commit holds the publish in flight -> in flight',
    );
    const dispatched = await flightWith({
      filters: { in_progress: [runAt(77, 'workflow_dispatch', 'in_progress')] },
      direct: { 77: runAt(77, 'workflow_dispatch', 'in_progress', [job('17.6.0', 'in_progress')]) },
    });
    check(dispatched.answer.state === 'in-flight', 'a repair-lane publish, which only the in_progress filter lists -> in flight');
    const quietFlight = await flightWith({
      filters: { in_progress: [runAt(36958423332, 'push', 'in_progress')] },
      tips: { [`${'c'.repeat(40)}`]: [runAt(55, 'push', 'completed')] },
      direct: { 55: runAt(55, 'push', 'completed') },
    });
    check(
      quietFlight.answer.state === 'clear' && !quietFlight.calls.some((c) => /\/(55|36958423332)\/jobs/.test(c)) &&
        !quietFlight.calls.some((c) => /runs\/36958423332$/.test(c)) && quietFlight.calls.every((c) => c.startsWith('GET ')),
      'nothing in flight -> clear; the completed push run\'s jobs and the calling run are never read; every request is a GET',
    );
    const lostPush = await flightWith();
    check(
      lostPush.answer.state === 'clear' && /no push run of release\.yml was found/.test(lostPush.answer.detail),
      'no push run found at the version commit -> clear on the filters, and the answer says so (never a permanent block)',
    );
    const unread = await Promise.all([
      flightWith({ fail: /status=queued/ }),
      flightWith({ totals: { in_progress: 150 } }),
      flightWith({ tips: { dcc5ef4c: [runAt(36955885276, 'push', 'in_progress')] }, direct: { 36955885276: runAt(36955885276, 'push', 'in_progress') }, fail: /\/jobs/ }),
    ]);
    check(
      unread.every((u) => u.answer.state === 'in-flight' && u.answer.reason === 'unreadable') &&
        /answered HTTP 502/.test(unread[0].answer.detail) && /total_count 150 but 0 listed/.test(unread[1].answer.detail),
      'a filter answering non-200, a filter counting more runs than it listed, or jobs answering non-200 -> unreadable, so in flight',
    );
    const disagree = await Promise.all([
      flightWith({ walk: [{ versionCommit: 'd'.repeat(40), version: '17.6.0', tips: [] }].values() }),
      flightWith({ walk: (function* shallow() { throw new Error('refusing to list version commits in a shallow clone'); })() }),
    ]);
    check(
      disagree.every((d) => d.answer.reason === 'unreadable' && d.calls.length === 0) &&
        /two readers of one history disagree/.test(disagree[0].answer.detail) && /shallow clone/.test(disagree[1].answer.detail),
      'a walk naming another version commit, or one refusing a shallow clone -> unreadable before any request',
    );
    let readOnly = false;
    try {
      await makeHttp({ apiUrl: 'https://api.invalid', token: 'x', dryRun: true })('POST', '/repos/o/r/actions/runs/1/cancel');
    } catch (err) {
      readOnly = /--dry-run refuses POST/.test(String(err && err.message));
    }
    check(readOnly, 'the HTTP layer in-flight runs over refuses a non-GET before it is sent');

    // The same read, asked about the publishing run's image build. Opened in
    // this block on purpose: it reuses the stub API above rather than a copy.
    battery("the publishing run's image build -> in flight from the approval until its docker job completes, and an unreadable read is in flight");
    const docker = (status, name = 'Docker image / Build & push ghcr.io/objectstack-ai/objectstack') => ({ name, status });
    const run176 = (jobs, status = 'in_progress') => ({ id: 36955885276, event: 'push', status, jobs: [integrity, ...jobs] });
    const publishing = judge([run176([job('17.6.0', 'in_progress')])]);
    check(
      publishing.docker.state === 'in-flight' && publishing.docker.reason === 'docker-in-flight' &&
        /run 36955885276 \(push, publish job in_progress, Docker image not yet created\)/.test(publishing.docker.detail),
      'the 17.6.0 audit at 03:04Z: the publish job runs and its docker job does not exist yet -> the image is in flight, naming the run',
    );
    const between = judge([run176([job('17.6.0', 'completed')])]);
    check(
      between.state === 'clear' && between.docker.state === 'in-flight' && /Docker image not yet created/.test(between.docker.detail),
      'the publish job completed and GitHub has not created the docker job yet -> the publish is clear, the image still in flight',
    );
    check(
      ['queued', 'in_progress', 'waiting', 'some_new_status'].every((s) => judge([run176([job('17.6.0', 'completed'), docker(s)])]).docker.state === 'in-flight') &&
        judge([run176([job('17.6.0', 'completed'), docker('queued', 'Docker image')])]).docker.state === 'in-flight',
      'the docker job queued, in_progress, waiting or in a status this script does not know, under either of its names -> in flight',
    );
    check(
      judge([run176([job('17.6.0', 'completed'), docker('completed')])]).docker.state === 'clear' &&
        judge([run176([job('17.6.0', 'completed'), docker('completed', 'Docker image')])]).docker.state === 'clear' &&
        judge([{ id: 36955885276, event: 'push', status: 'completed', jobs: null }]).docker.state === 'clear',
      'a completed docker job, in a run still finishing or in a completed run -> clear, so the image probe alone decides the backfill',
    );
    const held = judge([{ id: 3, event: 'workflow_dispatch', status: 'waiting', jobs: [integrity, job('17.6.0', 'waiting')] }]);
    check(
      held.state === 'clear' && held.docker.state === 'clear',
      'a publish held at the release environment builds nothing before a human approves it -> clear for the image too',
    );
    check(
      judge([
        { id: 900, event: 'push', status: 'in_progress', jobs: [job('17.6.0', 'completed')] },
        { id: 6, event: 'push', status: 'in_progress', jobs: [job('17.7.0', 'completed')] },
        { id: 7, event: 'push', status: 'in_progress', jobs: [{ name: 'Publish ${{ needs.release-integrity.outputs.cli-version }} to npm (awaiting approval)', status: 'completed' }, docker('in_progress')] },
      ]).docker.state === 'clear',
      "the calling run, another version's publishing run, and a run whose skipped publish job names no version -> clear",
    );
    const unreadJobs = judge([{ id: 8, event: 'push', status: 'in_progress', jobs: null }]);
    check(
      unreadJobs.docker.state === 'in-flight' && unreadJobs.docker.reason === 'unreadable',
      'a run still running whose jobs were never read -> unreadable for the image too, never clear',
    );

    const pushedAt = { dcc5ef4c: [runAt(36955885276, 'push', 'in_progress')] };
    const imageWindow = await flightWith({
      tips: pushedAt,
      direct: { 36955885276: runAt(36955885276, 'push', 'in_progress', [integrity, job('17.6.0', 'completed')]) },
    });
    check(
      imageWindow.answer.state === 'clear' && imageWindow.answer.docker.state === 'in-flight' && imageWindow.answer.docker.reason === 'docker-in-flight',
      'through the whole read: the push run at the version commit has published and not built its image -> the publish clear, the image in flight',
    );
    const imageBuilt = await flightWith({
      tips: pushedAt,
      direct: { 36955885276: runAt(36955885276, 'push', 'in_progress', [integrity, job('17.6.0', 'completed'), docker('completed')]) },
    });
    check(imageBuilt.answer.state === 'clear' && imageBuilt.answer.docker.state === 'clear', '...and once that docker job completed -> clear for both');
    const dispatchedImage = await flightWith({
      filters: { in_progress: [runAt(77, 'workflow_dispatch', 'in_progress')] },
      direct: { 77: runAt(77, 'workflow_dispatch', 'in_progress', [job('17.6.0', 'completed'), docker('in_progress')]) },
    });
    check(dispatchedImage.answer.docker.state === 'in-flight', "a repair-lane run's image build, which only the in_progress filter lists -> in flight");
    const unreadImage = await Promise.all([
      flightWith({ fail: /status=queued/ }),
      flightWith({ tips: pushedAt, direct: { 36955885276: runAt(36955885276, 'push', 'in_progress') }, fail: /\/jobs/ }),
      flightWith({ walk: (function* shallow() { throw new Error('refusing to list version commits in a shallow clone'); })() }),
    ]);
    check(
      unreadImage.every((u) => u.answer.docker.state === 'in-flight' && u.answer.docker.reason === 'unreadable'),
      'a filter answering non-200, jobs answering non-200, or a shallow clone -> the image is unreadable, so in flight',
    );
    const lostImage = await flightWith();
    check(
      lostImage.answer.docker.state === 'clear' && /no push run of release\.yml was found/.test(lostImage.answer.docker.detail),
      'no push run found and nothing in flight -> the image is clear on the filters, and the answer says so',
    );
  }

  battery('an event with no release predicate -> refused');
  check(
    throws(() => decidePending({ event: 'schedule', range: { state: 'in-push' }, npm: 'absent' }), /no release predicate/),
    'schedule is the bookkeeping lane and has no publish predicate at all',
  );

  battery('the report -> a warning naming every changeset with its commit, a summary section, or a plain line for none');
  // The 17.6.0 instance, as the measurement answered it on the real history.
  const v176 = {
    versionCommit: '617f25f8a4c4d7e23ceb63f2bbb8c1e5cd22ad2e',
    pending: 1,
    recordedInPreState: 0,
    unconsumed: [
      {
        path: '.changeset/21110-scheduled-work-host-reason.md',
        commit: '748b2407235a6a32d2cd7f61f36e1f69f95d775e',
        subject: "feat(types,automation): a host's per-kernel scheduled-work OFF reports its own reason (#21270)",
      },
    ],
    commits: 1,
  };
  const told = describeUnconsumed({ version: '17.6.0', report: v176 });
  check(
    told.log[0].startsWith('::warning::1 changeset(s) from 1 commit(s) are still in the tree of the version commit 617f25f8a4,') &&
      told.log[0].endsWith('.changeset/21110-scheduled-work-host-reason.md (748b240723)') &&
      /their code ships in 17\.6\.0/.test(told.log[0]),
    'one warning line names the version commit, the release, and each changeset with the commit that added it',
  );
  check(
    told.summary.includes('### 1 changeset(s) ship in 17.6.0 without a CHANGELOG entry') &&
      told.summary.includes(
        "- `.changeset/21110-scheduled-work-host-reason.md`, added by `748b240723`: feat(types,automation): a host's per-kernel scheduled-work OFF reports its own reason (#21270)",
      ),
    'the job summary gets a section headed by the count, one line per changeset with its commit and subject',
  );
  const escaped = describeUnconsumed({
    version: '1.1.0',
    report: { ...v176, unconsumed: [{ path: '.changeset/100%-done.md', commit: null, subject: null }] },
  });
  check(
    !escaped.log[0].includes('\n') && escaped.log[0].includes('.changeset/100%25-done.md (commit not found)') &&
      escaped.summary.includes('- `.changeset/100%-done.md`, added by a commit this history does not show'),
    "the warning escapes what the runner unescapes (a '%'), and a changeset with no add commit is still named",
  );
  const none = describeUnconsumed({ version: '17.2.0', report: { ...v176, unconsumed: [], commits: 0, recordedInPreState: 3, pending: 3 } });
  check(
    none.log.length === 1 && !none.log[0].includes('::') && none.log[0].includes('617f25f8a4') &&
      /consumed every changeset/.test(none.log[0]) && /3 kept in place and recorded as consumed in \.changeset\/pre\.json/.test(none.log[0]),
    'nothing unconsumed -> one plain line, no annotation, still naming the version commit it read',
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
    await selfTest();
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
  if (mode === 'unconsumed') {
    const versionCommit = flag(rest, '--version-commit');
    if (!versionCommit) throw new Error('unconsumed needs --version-commit');
    const json = rest.includes('--json');
    const version = flag(rest, '--version');
    if (!json && !version) throw new Error('unconsumed needs --version for its report (or --json for the measurement alone)');
    const report = unconsumedChangesets({ cwd: process.cwd(), versionCommit });
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return;
    }
    const { log, summary } = describeUnconsumed({ version, report });
    console.log(log.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
    return;
  }
  if (mode === 'sweep') {
    await sweep({ workflow: flag(rest, '--workflow') || 'release.yml', dryRun: rest.includes('--dry-run') });
    return;
  }
  if (mode === 'in-flight') {
    const version = flag(rest, '--version');
    const versionCommit = flag(rest, '--version-commit');
    const head = flag(rest, '--head');
    const workflow = flag(rest, '--workflow');
    if (!version || !versionCommit || !head || !workflow) throw new Error('in-flight needs --version, --version-commit, --head and --workflow');
    if (!VERSION_SHAPE.test(version)) throw new Error(`--version is not a version: ${version}`);
    if (!FULL_SHA.test(versionCommit)) throw new Error(`--version-commit is not a full sha: ${versionCommit}`);
    const result = await publishInFlight({
      // `dryRun: true` is the read-only guarantee: the HTTP layer refuses any non-GET.
      http: makeHttp({ apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com', token: requireEnv('GITHUB_TOKEN'), dryRun: true }),
      repo: requireEnv('GITHUB_REPOSITORY'),
      workflow,
      version,
      versionCommit,
      walk: versionCommitsOf({ cwd: process.cwd(), head }),
      currentRunId: process.env.GITHUB_RUN_ID || '',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(`unknown mode ${JSON.stringify(mode)} -- expected select, npm-state, unconsumed, sweep, in-flight or --self-test`);
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`::error::release-pending-publish: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}
