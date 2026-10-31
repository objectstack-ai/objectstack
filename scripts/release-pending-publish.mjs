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
 *   node scripts/release-pending-publish.mjs annotate-shipped [--head REV] [--no-deepen]
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
 * `annotate-shipped` -- the WRITING half of the same measurement (#23818). The
 * root `version` script runs it ahead of `changeset version`, so every cut
 * records what the previous one left out, with no human step and no refusal.
 * `unconsumed` above reads the leak after the landing and only warns. That is
 * how 18.0.0-next.2 shipped 11 changesets with no CHANGELOG entry while the
 * report worked exactly as built: run 38841989023 named all 11 and their 10
 * commits, and the publish started three minutes later. Pre mode played no
 * part -- @changesets/cli v3 moves what a prerelease pass consumes into
 * `.changeset/pre/`, so the top-level read is right in either mode. Refusing
 * such a landing is not the remedy: `main` takes a changeset-bearing landing
 * about every twenty minutes (77 of 111 landings in the 24 h to
 * 2026-10-16T08Z), so a Version Packages PR almost never reaches the merge
 * queue current, and a refusal would block nearly every release to protect a
 * CHANGELOG line.
 *
 * So the next cut writes the line. The step finds the LAST version commit on
 * HEAD's first-parent chain (`select`'s definition), takes the changesets that
 * sat unconsumed in that commit's tree (the set `unconsumed` reports, read here
 * from the tree alone), and gives each one still pending a lead line right
 * after its frontmatter:
 *
 *     **Shipped in VERSION**, whose CHANGELOG missed this entry; listed here one prerelease late.
 *
 * ("release" in place of "prerelease" for a version with no prerelease tag).
 * `changeset version` then renders that line as the entry's first line under
 * the next version. The frontmatter is byte-unchanged. A changeset whose first
 * body line already starts with `**Shipped in` is left as it is, so a second
 * run, or a line written by hand, is never doubled. It annotates only when
 * VERSION is on npm: a version commit nobody published shipped nothing, and its
 * changesets then land in the next CHANGELOG correctly with no note.
 *
 * ⛔ It never blocks a release. The `version` script joins it with `;`, not
 * `&&`, and the mode exits 0 on every path. When it cannot decide -- no version
 * commit, history it cannot reach, an unreadable tree or `pre.json`, npm
 * unreadable -- it prints a `::warning::` and annotates nothing; one changeset
 * it cannot parse is skipped with its own warning. A shallow clone (the
 * version-pr job checks out at depth 1) is deepened in place, bounded:
 * `git fetch --no-tags --deepen=N origin HEAD-SHA` with N = 100, 200, 400, 800,
 * 1600, until the version commit and its first parent are both present. That is
 * all the history the step reads; the changesets come from that commit's tree.
 * `--no-deepen` turns the fetch off.
 *
 * `createChangelogAttribution` -- not a mode: the commit each CHANGELOG entry
 * names, for `scripts/changeset-changelog.mjs`, the generator
 * `.changeset/config.json` loads (#25638). The stock generator names the
 * newest commit that added a changeset file, and a revert of a version commit
 * re-adds every changeset the cut consumed, so 260 of 18.1.0's 265 entries
 * named #25605's revert. An add whose bytes are exactly what the previous
 * delete removed is a restoration; the entry names the add before it. A
 * shallow clone is deepened as above, to the last version commit (every
 * delete that matters lies after it) and on while a restoration's first add
 * is still beyond the boundary. ⛔ Like `annotate-shipped` it never stops the
 * version pass: what it cannot decide keeps the stock commit, with a warning.
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
 * A read the Actions API answers with a 5xx or drops (a named connection
 * failure) is retried under the shared policy (`retryingReads`); a read still
 * failing that way after the retries ends the sweep with a `::warning::`, a
 * NOT READ job-summary section and exit 0 (`deferredSweep`) -- nothing judged,
 * nothing cancelled, and the next push sweeps again. A 4xx, any other error
 * and a cancel that did not land still fail the job.
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
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The sweep's reads retry a transient answer through the ONE policy the
// citation gate measured and the release gate's full-battery read already uses
// (`BOARD_READ_RETRY` and its reader; see `retryingReads` below). Imported,
// never copied.
// ⛔ This import puts `check-issue-citations.mjs` and its own imports in THIS
// file's load closure, and release.yml runs this file off a bare checkout with
// no install step. Measured when it was added: every module in that closure
// imports only `node:*` builtins and runs nothing at load -- the same closure
// `scripts/ci/scheduled-full-run.mjs` already loads in the `full-battery` job.
import { boardReadBudget, readBoard, readFailure } from './check-issue-citations.mjs';
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
 * The changesets pending in one commit's tree, and those of them a 2.x
 * `pre.json` does not record as consumed -- read from that tree alone, so it
 * needs no history and answers in a shallow clone. Pending means `changeset
 * version` would still read it. Throws on a rev that is not a commit and on a
 * `pre.json` that is not JSON or whose `changesets` is not a list of ids.
 */
export function pendingChangesetsAt({ cwd, rev }) {
  const sha = gitOk(cwd, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
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

  const pending = blobs.map((e) => e.path).filter((path) => isChangesetFile(path.slice(CHANGESET_DIR.length + 1)));
  const unrecorded = pending.filter((path) => !recorded.has(path.slice(CHANGESET_DIR.length + 1, -'.md'.length)));
  return { sha, pending, unrecorded, recordedInPreState: pending.length - unrecorded.length };
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
  const at = pendingChangesetsAt({ cwd, rev: versionCommit });
  const unconsumed = [];
  for (const path of at.unrecorded) {
    const added = gitOk(cwd, ['log', '--no-renames', '--diff-filter=A', '--max-count=1', '--format=%H %s', at.sha, '--', path]).trim();
    const space = added.indexOf(' ');
    unconsumed.push(
      added === ''
        ? { path, commit: null, subject: null }
        : { path, commit: space === -1 ? added : added.slice(0, space), subject: space === -1 ? '' : added.slice(space + 1) },
    );
  }
  return {
    versionCommit: at.sha,
    pending: at.pending.length,
    recordedInPreState: at.recordedInPreState,
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
// annotate-shipped: the next cut records what the last one left out
// ─────────────────────────────────────────────────────────────────────────────

/** How a changeset already carrying the note begins its body, by this step or by hand. */
export const SHIPPED_MARK = '**Shipped in ';

/** The lead line for a changeset whose code shipped in `version` with no CHANGELOG entry. */
export function shippedLeadLine(version) {
  const kind = /-/.test(version) ? 'prerelease' : 'release';
  return `${SHIPPED_MARK}${version}**, whose CHANGELOG missed this entry; listed here one ${kind} late.`;
}

/** Commits per deepening round for a shallow clone: 3,100 in all, then it gives up and warns. */
export const DEEPEN_ROUNDS = Object.freeze([100, 200, 400, 800, 1600]);

/**
 * `text` with `line` as the first line of its body, right after the
 * frontmatter, every other byte unchanged. `already` when the first non-blank
 * body line starts with SHIPPED_MARK; `unparseable` when there is no
 * `---`-fenced frontmatter to put it after.
 */
export function withLeadLine(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  if (lines[0] !== '---') return { state: 'unparseable' };
  const close = lines.indexOf('---', 1);
  if (close < 0) return { state: 'unparseable' };
  const head = `${lines.slice(0, close + 1).join(eol)}${eol}`;
  if (!text.startsWith(head)) return { state: 'unparseable' };
  const body = text.slice(head.length);
  const first = body.split(eol).find((l) => l.trim() !== '');
  if (first !== undefined && first.trimStart().startsWith(SHIPPED_MARK)) return { state: 'already' };
  return { state: 'annotated', text: `${head}${eol}${line}${eol}${body.startsWith(eol) ? '' : eol}${body}` };
}

/**
 * Orders two CLI versions (`X.Y.Z` or `X.Y.Z-tag.N`): negative when `a` is
 * older, positive when newer, 0 when equal. A prerelease sorts before its
 * release; prerelease identifiers compare numerically where both are numbers.
 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = v.split('-', 2);
    return { core: core.split('.').map(Number), pre: pre === undefined ? null : pre.split('.') };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === null || y.pre === null) return x.pre === y.pre ? 0 : x.pre === null ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const nx = /^\d+$/.test(x.pre[i]);
    const ny = /^\d+$/.test(y.pre[i]);
    if (nx && ny && Number(x.pre[i]) !== Number(y.pre[i])) return Number(x.pre[i]) - Number(y.pre[i]);
    if (x.pre[i] !== y.pre[i]) return nx ? -1 : ny ? 1 : x.pre[i] < y.pre[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The last version commit on `head`'s first-parent chain, read WITHOUT
 * assuming full history: `found` needs the commit and its first parent both
 * present, because a graft-boundary commit has no parent and would read as the
 * version's introduction. `need-history` = the walk reached the shallow
 * boundary first; `none` = this history has no version commit, with the reason.
 *
 * A commit that moves the version BACK (a reverted cut: `git revert` of an
 * unpublished version commit, as 18.1.0's `74fa3cb6d` was by #25605) did not
 * introduce the version it returns to. The walk passes over it and over the
 * reverted cut's span, and keeps looking for the forward commit that did.
 * Read as a version commit, it made every changeset the revert restored look
 * shipped in the version main went back to.
 */
export function locateLastVersionCommit({ cwd, head }) {
  const shallow = gitOk(cwd, ['rev-parse', '--is-shallow-repository']).trim() !== 'false';
  const headSha = gitOk(cwd, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const version = versionAt(cwd, headSha);
  if (version === null) return { state: 'none', headSha, reason: `${headSha.slice(0, 10)} carries no ${CLI_MANIFEST}` };
  const touching = gitOk(cwd, ['log', '--first-parent', '--format=%H', headSha, '--', CLI_MANIFEST]).split('\n').filter(Boolean);
  let reverted = false;
  for (const commit of touching) {
    const here = versionAt(cwd, commit);
    if (reverted) {
      // Inside a reverted cut's span: commits carrying the version it undid.
      if (here !== version) continue;
      reverted = false;
    }
    if (here !== version) {
      return {
        state: 'none',
        headSha,
        reason: `the first-parent walk from ${headSha.slice(0, 10)} reached ${commit.slice(0, 10)} carrying ${here} before finding where ${version} was introduced`,
      };
    }
    const parent = git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^1`]);
    if (parent.status !== 0) {
      return shallow
        ? { state: 'need-history', headSha, version }
        : { state: 'none', headSha, reason: `${CLI_MANIFEST} first appears in the root commit ${commit.slice(0, 10)}, so no version commit ever moved it` };
    }
    const before = versionAt(cwd, parent.stdout.trim());
    if (before === version) continue;
    if (before === null) {
      return { state: 'none', headSha, reason: `${CLI_MANIFEST} is created at ${commit.slice(0, 10)}, and its creation is not a release` };
    }
    if (compareVersions(before, version) > 0) {
      reverted = true;
      continue;
    }
    return { state: 'found', headSha, version, from: before, versionCommit: commit };
  }
  return shallow
    ? { state: 'need-history', headSha, version }
    : { state: 'none', headSha, reason: `no first-parent commit of ${headSha.slice(0, 10)} introduces ${CLI_PACKAGE}@${version}` };
}

function commitCount(cwd, rev) {
  return Number(gitOk(cwd, ['rev-list', '--count', rev]).trim());
}

/**
 * Annotate, in the working tree, every changeset the last version commit left
 * unconsumed and that is still pending -- or decide not to, with the reason.
 * Never throws. Verdicts: `done` (written, possibly zero), `unshipped` (the
 * version is not on npm: nothing shipped), `undecided` (a warning; nothing
 * written).
 */
export function annotateShipped({ cwd, head = 'HEAD', npmStateOf, deepen = true, remote = 'origin', rounds = DEEPEN_ROUNDS }) {
  const result = {
    verdict: 'undecided',
    reason: null,
    version: null,
    from: null,
    versionCommit: null,
    npm: null,
    deepenedBy: 0,
    annotated: [],
    already: [],
    gone: [],
    unparseable: [],
  };
  try {
    const root = gitOk(cwd, ['rev-parse', '--show-toplevel']).trim();
    let at = locateLastVersionCommit({ cwd: root, head });
    for (const by of deepen ? rounds : []) {
      if (at.state !== 'need-history') break;
      const step = deepenBy({ root, rev: at.headSha, by, remote });
      if (step.failed) {
        result.reason = `the clone is shallow and ${step.failed}`;
        return result;
      }
      result.deepenedBy += by;
      if (!step.gained) {
        result.reason = `the clone is shallow and deepening it from ${remote} gained no history`;
        return result;
      }
      at = locateLastVersionCommit({ cwd: root, head });
    }
    if (at.state === 'need-history') {
      result.reason = deepen
        ? `the last version commit is not within the ${result.deepenedBy} commits this step may fetch into a shallow clone`
        : 'the clone is shallow and --no-deepen was given, so the last version commit is out of reach';
      return result;
    }
    if (at.state === 'none') {
      result.reason = `no version commit to read: ${at.reason}`;
      return result;
    }
    Object.assign(result, { version: at.version, from: at.from, versionCommit: at.versionCommit });
    result.npm = npmStateOf(at.version);
    if (result.npm === 'absent') {
      result.verdict = 'unshipped';
      return result;
    }
    if (result.npm !== 'present') {
      result.reason = `npm could not say whether ${CLI_PACKAGE}@${at.version} is published`;
      return result;
    }
    const line = shippedLeadLine(at.version);
    const writes = [];
    for (const path of pendingChangesetsAt({ cwd: root, rev: at.versionCommit }).unrecorded) {
      const abs = join(root, path);
      if (!existsSync(abs)) {
        result.gone.push(path);
        continue;
      }
      const text = readFileSync(abs, 'utf8');
      const out = withLeadLine(text, line);
      if (out.state === 'already') result.already.push(path);
      else if (out.state === 'unparseable') result.unparseable.push(path);
      else writes.push({ path, abs, text, next: out.text });
    }
    const written = [];
    try {
      for (const w of writes) {
        writeFileSync(w.abs, w.next);
        written.push(w);
      }
    } catch (err) {
      for (const w of written) {
        try {
          writeFileSync(w.abs, w.text);
        } catch {
          // The warning below names the failure; a second one here adds nothing.
        }
      }
      result.reason = `a write failed (${err instanceof Error ? err.message : err}); the ${written.length} written before it were put back`;
      return result;
    }
    result.annotated = writes.map((w) => w.path);
    result.verdict = 'done';
    return result;
  } catch (err) {
    result.verdict = 'undecided';
    result.reason = err instanceof Error ? err.message : String(err);
    result.annotated = [];
    return result;
  }
}

/** The step's log lines -- pure, so each one is pinned. Warnings are `::warning::` lines. */
export function describeAnnotate(result) {
  const tail = 'Annotated nothing; the version pass goes on without it.';
  if (result.verdict === 'undecided') return [commandData(`::warning::annotate-shipped: ${result.reason}. ${tail}`)];
  const vc = result.versionCommit.slice(0, 10);
  if (result.verdict === 'unshipped') {
    return [
      `annotate-shipped: the last version commit ${vc} brought ${CLI_PACKAGE} to ${result.version}, which is not on npm, so nothing shipped without a CHANGELOG entry. Annotated nothing.`,
    ];
  }
  const n = result.annotated.length + result.already.length + result.gone.length + result.unparseable.length;
  const deepened = result.deepenedBy > 0 ? ` (the shallow clone was deepened by ${result.deepenedBy} commits to read it)` : '';
  return [
    `annotate-shipped: the last version commit ${vc} (${result.from} -> ${result.version}) left ${n} changeset(s) unconsumed${deepened}: ` +
      `${result.annotated.length} annotated, ${result.already.length} already annotated, ${result.gone.length} no longer pending, ${result.unparseable.length} unreadable.`,
    ...result.annotated.map((p) => `  annotated  ${p}`),
    ...result.already.map((p) => `  already    ${p}`),
    ...result.gone.map((p) => `  gone       ${p}`),
    ...result.unparseable.map((p) =>
      commandData(`::warning::annotate-shipped: ${p} shipped in ${result.version} with no CHANGELOG entry, but it has no frontmatter fence this step can read, so it was not annotated.`),
    ),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// changelog attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One bounded `git fetch --deepen` of a shallow clone. `failed` is the reason
 * the fetch failed, or null; `gained` says whether it brought any history.
 */
function deepenBy({ root, rev, by, remote }) {
  const before = commitCount(root, rev);
  const fetched = git(root, ['fetch', '--no-tags', '--quiet', `--deepen=${by}`, remote, rev]);
  if (fetched.status !== 0) {
    return { failed: `\`git fetch --deepen=${by} ${remote}\` failed (${fetched.stderr.trim().split('\n').pop() || `exit ${fetched.status}`})`, gained: false };
  }
  return { failed: null, gained: commitCount(root, rev) !== before };
}

/**
 * Every add and delete of a `.changeset/` file on `head`'s history, newest
 * first, per path: `{ status: 'A' | 'D', sha, parent, boundary }`, `parent`
 * being the first parent. Renames are off, as in `unconsumedChangesets`. Merge
 * commits list no paths, so an add is the commit that wrote the file, as
 * `@changesets/git` reads it. `boundary` marks a shallow clone's graft
 * commit: git diffs it against nothing, so it reads as adding every file it
 * carries, and its adds prove nothing.
 */
export function changesetFileEvents({ cwd, head = 'HEAD' }) {
  const out = gitOk(cwd, [
    '-c', 'core.quotePath=false',
    'log', '--no-renames', '--diff-filter=AD', '--name-status', '--format=%x00%H %P', head, '--', `${CHANGESET_DIR}/`,
  ]);
  const shallowFile = resolve(cwd, gitOk(cwd, ['rev-parse', '--git-path', 'shallow']).trim());
  const grafts = new Set(existsSync(shallowFile) ? readFileSync(shallowFile, 'utf8').split('\n').filter(Boolean) : []);
  const events = new Map();
  for (const chunk of out.split('\0')) {
    const [header, ...lines] = chunk.split('\n');
    const [sha, parent] = header.trim().split(' ');
    if (!sha) continue;
    for (const line of lines) {
      const m = /^([AD])\t(.+)$/.exec(line);
      if (!m) continue;
      if (!events.has(m[2])) events.set(m[2], []);
      events.get(m[2]).push({ status: m[1], sha, parent: parent || null, boundary: grafts.has(sha) });
    }
  }
  return events;
}

/** The blob a path has at a commit; null when the commit or the path is not there. */
function blobAt(cwd, rev, path) {
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}:${path}`]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The commit a changeset's CHANGELOG entry names. `stock` is what
 * `changeset version` hands the changelog generator: `@changesets/git`'s
 * newest commit that added the file. That is right until a commit RESTORES a
 * changeset an earlier commit deleted -- a `git revert` of a version commit
 * re-adds every changeset the cut consumed, byte for byte -- and then every
 * one of them names the restoring commit. 18.1.0 shipped that way: #25605
 * reverted the first cut, and 260 of the re-cut's 265 entries named the
 * revert.
 *
 * So an add whose blob is exactly the blob the previous delete removed is a
 * restoration, and the walk passes over it, and over that delete, to the add
 * before. A changeset written afresh under a consumed one's name has other
 * bytes and keeps its own add. Anything the walk cannot match to an add in
 * this history keeps `stock`.
 *
 * `kept` / `passed-over` carry `commit`; `need-history` = a restoration whose
 * earlier add lies beyond a shallow clone's boundary, or on it.
 */
export function attributeChangeset({ cwd, events, path, stock }) {
  const list = events.get(path) ?? [];
  let i = typeof stock === 'string' && stock !== '' ? list.findIndex((e) => e.status === 'A' && e.sha.startsWith(stock)) : -1;
  if (i === -1) return { state: 'kept', commit: stock ?? null, passedOver: [] };
  const passedOver = [];
  for (;;) {
    const del = list[i + 1];
    if (!del || del.status !== 'D') break;
    if (del.parent === null) return { state: 'need-history', commit: list[i].sha, passedOver };
    const restored = blobAt(cwd, list[i].sha, path);
    const removed = blobAt(cwd, del.parent, path);
    if (removed === null) return { state: 'need-history', commit: list[i].sha, passedOver };
    if (restored !== removed) break;
    const earlier = list[i + 2];
    if (!earlier || earlier.boundary) return { state: 'need-history', commit: list[i].sha, passedOver };
    if (earlier.status !== 'A') break;
    passedOver.push(list[i].sha);
    i += 2;
  }
  return { state: passedOver.length > 0 ? 'passed-over' : 'kept', commit: list[i].sha, passedOver };
}

/**
 * The attribution `scripts/changeset-changelog.mjs` puts in front of the stock
 * changelog generator: `attribute(changeset)` answers the commit its entry
 * names, memoised per changeset id. ⛔ It never throws and never stops the
 * version pass: whatever it cannot decide keeps `changeset.commit`, with one
 * `::warning::`.
 *
 * The history it reads: every delete that matters lies after the last version
 * commit, because a changeset a published cut consumed is never pending again
 * (a revert restores only an UNPUBLISHED cut, as #25607 reads it). So a
 * shallow clone is first deepened to that commit, as `annotate-shipped` does,
 * and again, in the same bounded rounds, while a restoration's earlier add is
 * still beyond the boundary.
 */
export function createChangelogAttribution({ cwd, head = 'HEAD', deepen = true, remote = 'origin', rounds = DEEPEN_ROUNDS, log = console.log } = {}) {
  const memo = new Map();
  const announced = new Set();
  let ctx = null;
  let broken = null;
  const warn = (text) => log(commandData(`::warning::changeset-changelog: ${text}`));
  const roundsLeft = [...(deepen ? rounds : [])];
  const isShallow = (root) => gitOk(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false';
  const deepenOnce = () => {
    const by = roundsLeft.shift();
    if (by === undefined || !ctx.shallow) return false;
    const step = deepenBy({ root: ctx.root, rev: ctx.headSha, by, remote });
    if (step.failed || !step.gained) {
      roundsLeft.length = 0;
      return false;
    }
    ctx.shallow = isShallow(ctx.root);
    ctx.events = changesetFileEvents({ cwd: ctx.root, head: ctx.headSha });
    return true;
  };
  const prepare = () => {
    const root = gitOk(cwd, ['rev-parse', '--show-toplevel']).trim();
    const headSha = gitOk(root, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
    ctx = { root, headSha, shallow: isShallow(root), events: null };
    ctx.events = changesetFileEvents({ cwd: root, head: headSha });
    while (ctx.shallow && locateLastVersionCommit({ cwd: root, head: headSha }).state === 'need-history') {
      if (!deepenOnce()) {
        // A boundary commit's deletes are invisible, so inside an unread span
        // a restoration cannot be told from a first add.
        throw new Error(`the last version commit is beyond this shallow clone's history${deepen ? ` after the bounded deepening` : ' and deepening is off'}, so a changeset a revert restored cannot be told from one added afresh`);
      }
    }
  };
  return (changeset) => {
    const stock = changeset && changeset.commit;
    const id = changeset && changeset.id;
    if (typeof stock !== 'string' || stock === '' || typeof id !== 'string' || broken) return stock;
    if (memo.has(id)) return memo.get(id);
    let answer = stock;
    try {
      if (ctx === null) prepare();
      const path = `${CHANGESET_DIR}/${id}.md`;
      let r = attributeChangeset({ cwd: ctx.root, events: ctx.events, path, stock });
      while (r.state === 'need-history' && deepenOnce()) r = attributeChangeset({ cwd: ctx.root, events: ctx.events, path, stock });
      if (r.state === 'need-history') {
        warn(`${path} was restored by ${r.commit.slice(0, 10)}, and the commit that first added it is beyond this clone's history; its entry names ${stock.slice(0, 7)}.`);
      } else {
        answer = r.commit;
        for (const sha of r.passedOver) {
          if (announced.has(sha)) continue;
          announced.add(sha);
          log(`changeset-changelog: ${sha.slice(0, 10)} restores changesets an earlier commit deleted; each of their entries names the commit that first added it.`);
        }
      }
    } catch (err) {
      broken = err instanceof Error ? err.message : String(err);
      warn(`${broken}. Every entry from here on names the commit @changesets/git found.`);
    }
    memo.set(id, answer);
    return answer;
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

/**
 * A read that was still answering a transient failure (an HTTP 5xx, or a named
 * connection failure) when its retry ladder or the run's retry budget ran out.
 * The sweep defers on it; every other failed read stays a plain `Error`.
 */
export class TransientReadFailure extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'TransientReadFailure';
  }
}

/**
 * `http` with every GET retried only when the failure is transient, through the
 * shared policy (`BOARD_READ_RETRY` in `./check-issue-citations.mjs`, whose
 * docblock is the measurement):
 *
 *   retried   an HTTP 5xx, or a named connection failure (ECONNRESET,
 *             UND_ERR_SOCKET) -- 3 attempts per read, 500 / 1000 ms apart, and
 *             at most 4 retries across every read of the `budget`'s run;
 *   final     any other answer (a 4xx is answered at once, unchanged), and any
 *             other thrown error, rethrown unchanged.
 *
 * A read whose ladder or budget is spent on a transient answer comes back with
 * `unread` set -- the failure, its text naming the last answer and the attempts
 * -- and `expectOk` throws it as a `TransientReadFailure`. A write (the cancel)
 * passes through untouched: it is sent once, and its answer is judged where it
 * always was.
 */
export function retryingReads(http, budget = boardReadBudget()) {
  return async (method, path) => {
    if (method !== 'GET') return http(method, path);
    let last = null;
    const read = await readBoard(
      async () => {
        last = null;
        last = await http(method, path);
        return { ok: last.status === 200, status: last.status, headers: null, json: async () => last.body };
      },
      path,
      undefined,
      budget,
    );
    if (read.stoppedBy === 'answer') return last;
    return { status: read.status, body: read.status === null ? null : last.body, unread: readFailure(`GET ${path}`, read, budget.policy) };
  };
}

function expectOk(res, what) {
  if (res.unread) throw new TransientReadFailure(`${what}: ${res.unread.message}`, { cause: res.unread });
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

function requireEnv(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The sweep's outcome when its read is still failing transiently after the
 * retries -- pure. `log` is the `::warning::` line, `summary` the job-summary
 * section.
 *
 * ⛔ Exit 0 here, and only here. The sweep runs on every push to main and
 * re-reads every waiting run from scratch, so a read the API would not answer
 * is work deferred to the next push, never lost: nothing was judged, so nothing
 * was cancelled. A red job for it read as "main red" on main's health board,
 * five times in one day, for a platform 502. A 4xx, a body that does not add
 * up, any other thrown error and a cancel that did not land still fail the job.
 */
export function deferredSweep({ workflow, error }) {
  const why =
    `${error.message}. Nothing was judged and nothing was cancelled; the next push to main runs this sweep again ` +
    'and re-reads every waiting run, so the work is deferred, not lost.';
  return {
    log: `::warning::the stale-prompts sweep of ${workflow} could not read the Actions API this run: ${commandData(why)}`,
    summary: [`### Waiting approval prompts of ${workflow}: NOT READ this run`, '', `- ${why}`],
  };
}

/**
 * The sweep: read every waiting run, judge it, cancel the stale push-lane
 * prompts. Answers the exit code. `env`, `http`, `versionCommits`,
 * `npmStateOf`, `now`, `sleep`, `log` and `warn` are injectable so `--self-test`
 * drives the whole path offline -- the defaults are the live job's.
 */
export async function sweep({
  workflow,
  dryRun,
  env = process.env,
  http = null,
  versionCommits = null,
  npmStateOf = (v) => npmState(v),
  now = Date.now(),
  sleep,
  log = console.log,
  warn = console.error,
}) {
  const repo = requireEnv('GITHUB_REPOSITORY', env);
  const currentRunId = env.GITHUB_RUN_ID || '';
  const raw = http ?? makeHttp({ apiUrl: env.GITHUB_API_URL || 'https://api.github.com', token: requireEnv('GITHUB_TOKEN', env), dryRun });
  // ONE retry budget for the whole sweep: a flapping API costs it at most the
  // policy's per-run retries (4, so at most 3 s of backoff), never that many per read.
  const reads = retryingReads(raw, boardReadBudget({ sleep }));
  const summarise = (lines) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  };

  let read;
  try {
    read = await collectWaitingRuns({ http: reads, repo, workflow, versionCommits: versionCommits ?? versionCommitsOf({ cwd: process.cwd() }), currentRunId, now });
  } catch (error) {
    if (!(error instanceof TransientReadFailure)) throw error;
    const deferred = deferredSweep({ workflow, error });
    warn(deferred.log);
    summarise(deferred.summary);
    return 0;
  }
  for (const a of read.anomalies) log(`::warning::${a}`);
  const { runs } = read;
  const verdict = judgeWaitingRuns({ runs, currentRunId, npmStateOf });

  const waiting = runs.filter((r) => r.status === 'waiting').length;
  const lines = [`### Waiting approval prompts (${waiting} waiting run(s) of ${workflow})`, '', describeReadings(read)];
  const failures = [];
  for (const c of verdict.cancel) {
    const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${c.id}`;
    if (dryRun) {
      log(`would cancel run ${c.id}: Publish ${c.version} -- ${c.reason}`);
      lines.push(`- would cancel [${c.id}](${url}): \`Publish ${c.version}\`, ${c.reason}`);
      continue;
    }
    const res = await reads('POST', `/repos/${repo}/actions/runs/${c.id}/cancel`);
    if (res.status === 202) {
      log(`::warning::cancelled run ${c.id}: its "Publish ${c.version} to npm" prompt was still waiting, and ${c.reason}. Approving it would have published nothing, and it held the release-publish group ahead of any real prompt.`);
      lines.push(`- cancelled [${c.id}](${url}): \`Publish ${c.version}\`, ${c.reason}`);
    } else if (res.status === 409) {
      log(`run ${c.id} finished before it could be cancelled (HTTP 409) -- nothing waiting there any more.`);
      lines.push(`- [${c.id}](${url}) finished before the cancel landed`);
    } else {
      failures.push(`cancel of run ${c.id} answered HTTP ${res.status}`);
    }
  }
  for (const k of verdict.keep) {
    if (k.npm === 'unknown') log(`::warning::run ${k.id} waits to publish ${k.version}, and npm could not be read to judge it.`);
    lines.push(`- kept ${k.id}: \`Publish ${k.version}\`, ${k.reason}`);
  }
  for (const u of verdict.untouched) {
    if (u.version && u.npm === 'present') {
      log(`::warning::run ${u.id} (${u.event}) waits to publish ${u.version}, which is already on npm. Not cancelled: ${u.reason}.`);
    }
    lines.push(`- untouched ${u.id}: ${u.reason}`);
  }
  if (waiting === 0) lines.push('- none waiting');
  log(lines.join('\n'));
  summarise(lines);

  if (failures.length > 0) {
    for (const f of failures) log(`::error::${f}`);
    return 1;
  }
  return 0;
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
  'annotate-shipped -> the next.2 shape: each changeset the last version commit left unconsumed gets the lead line once, frontmatter byte-unchanged': 5,
  'annotate-shipped -> a second run writes nothing': 2,
  'annotate-shipped -> a changeset whose first body line already says Shipped in is left byte-identical': 2,
  'annotate-shipped -> outside pre mode, where the version pass deletes what it consumes': 2,
  'annotate-shipped -> a reverted cut is not a version commit: the walk reads the forward cut before it': 3,
  'annotate-shipped -> a depth-1 clone deepens itself to the version commit; with no reachable history it warns, annotates nothing and exits 0': 4,
  'annotate-shipped -> no version commit, an unpublished or unreadable version, an error anywhere: a warning or a plain line, nothing written, exit 0': 5,
  'changelog attribution -> a revert of a version commit restores its changesets: each entry names the commit that first added it, through the generator changeset version loads': 5,
  'changelog attribution -> a shallow clone deepens itself to the first add; with no history to fetch, or nothing to decide, the stock commit stays and the version pass goes on': 4,
  'changelog fold -> on the stable cut each prerelease section of the cycle folds into the stable section: an entry is its summary, not its commit, and a dependency bump is superseded': 4,
  'changelog fold -> the stable section is kept whole, and so is every older cycle; a prerelease section carrying an entry the stable section lacks stays': 5,
  'changelog fold -> armed only on an exit-mode cut, for the CHANGELOGs whose top was a prerelease before the version pass wrote': 3,
  'the sweep -> a transient read is retried under one budget, still failing it defers with a warning and exit 0, and a 4xx or a failed cancel stays red': 10,
});
const SELF_TEST_BATTERY_FLOOR = 35;

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

    // ── annotate-shipped (#23818) ────────────────────────────────────────
    // The 18.0.0-next.2 sequence, reduced, in @changesets/cli v3's pre-mode
    // layout: the Version Packages PR is cut from a base carrying two pending
    // changesets and moves them into `.changeset/pre/`; main then takes two
    // landings carrying three more; the queue lands the PR as a squash on top
    // of them (the version commit), and one more landing follows it.
    const q = fixture();
    const qPut = (path, text = `---\n'${CLI_PACKAGE}': patch\n---\n\n${path}\n`) => {
      mkdirSync(dirname(join(q.dir, path)), { recursive: true });
      writeFileSync(join(q.dir, path), text);
    };
    const qRead = (path) => readFileSync(join(q.dir, path), 'utf8');
    const SCRIPT = fileURLToPath(import.meta.url);
    const cli = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, 'annotate-shipped', ...args], { cwd, encoding: 'utf8' });
    const shipped = npmOf(['18.0.0-next.2', '17.7.0']);
    const annotate = (cwd, over = {}) => annotateShipped({ cwd, npmStateOf: shipped, ...over });
    const LATE = ['.changeset/late-one.md', '.changeset/late-three.md', '.changeset/late-two.md'];
    q.writeCli('18.0.0-next.1');
    qPut('.changeset/README.md', 'what a changeset is\n');
    qPut(PRE_STATE, `${JSON.stringify({ mode: 'pre', tag: 'next' })}\n`);
    qPut('.changeset/pre/consumed-by-next-1.md');
    qPut('.changeset/a.md');
    qPut('.changeset/b.md');
    q.commit('base: two changesets pending in pre mode');
    q.g('checkout', '-q', '-b', 'version-pr');
    for (const name of ['a', 'b']) q.g('mv', `.changeset/${name}.md`, `.changeset/pre/${name}.md`);
    q.writeCli('18.0.0-next.2');
    q.commit('chore: version packages (next), as cut');
    q.g('checkout', '-q', 'main');
    qPut('.changeset/late-one.md');
    q.commit('a landing after the cut');
    qPut('.changeset/late-two.md');
    qPut('.changeset/late-three.md', `---\n'${CLI_PACKAGE}': minor\n'@objectstack/spec': patch\n---\nfeat: a summary line right under the fence\n\nmore prose\n`);
    q.commit('a landing carrying two changesets');
    q.g('merge', '-q', '--squash', 'version-pr');
    const qLanded = q.commit('chore: version packages (next) (landed behind main)');
    qPut('.changeset/after-the-cut.md');
    const qHead = q.commit('a landing after the version commit');
    const qBefore = Object.fromEntries([...LATE, '.changeset/after-the-cut.md', '.changeset/pre/a.md'].map((p) => [p, qRead(p)]));
    const LINE = '**Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry; listed here one prerelease late.';
    // The hand-written form a seat adds (it cites its card); the step must read it as already annotated.
    const HAND = '**Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.';

    battery('annotate-shipped -> the next.2 shape: each changeset the last version commit left unconsumed gets the lead line once, frontmatter byte-unchanged');
    const first = annotate(q.dir);
    check(
      first.verdict === 'done' && first.versionCommit === qLanded && first.from === '18.0.0-next.1' && first.version === '18.0.0-next.2' &&
        first.annotated.join() === LATE.join(),
      'the last version commit is the queue-landed squash, and exactly the three late changesets are annotated',
    );
    check(
      qRead('.changeset/late-one.md') === `---\n'${CLI_PACKAGE}': patch\n---\n\n${LINE}\n\n.changeset/late-one.md\n` &&
        qRead('.changeset/late-three.md') === `---\n'${CLI_PACKAGE}': minor\n'@objectstack/spec': patch\n---\n\n${LINE}\n\nfeat: a summary line right under the fence\n\nmore prose\n`,
      'byte-exact: the line goes right after the frontmatter, set off by blank lines; the frontmatter and every body byte are unchanged',
    );
    check(
      qRead('.changeset/after-the-cut.md') === qBefore['.changeset/after-the-cut.md'] && qRead('.changeset/pre/a.md') === qBefore['.changeset/pre/a.md'],
      'a changeset added after the version commit, and one the cut consumed into pre/, are untouched',
    );
    check(
      shippedLeadLine('18.0.0-next.2') === LINE && shippedLeadLine('17.7.0').endsWith('listed here one release late.') && !/#\d/.test(LINE),
      'the line names the version, says "release" for a version with no prerelease tag, and carries no card number',
    );
    const crlf = withLeadLine(`---\r\n'x': patch\r\n---\r\n\r\nsummary\r\n`, LINE);
    check(
      crlf.state === 'annotated' && crlf.text === `---\r\n'x': patch\r\n---\r\n\r\n${LINE}\r\n\r\nsummary\r\n` &&
        withLeadLine('summary with no frontmatter\n', LINE).state === 'unparseable' && withLeadLine("---\n'x': patch\n", LINE).state === 'unparseable',
      'a CRLF changeset keeps its line endings; one with no frontmatter fence is unparseable, never guessed at',
    );

    battery('annotate-shipped -> a second run writes nothing');
    const annotatedBytes = Object.fromEntries(LATE.map((p) => [p, qRead(p)]));
    const second = annotate(q.dir);
    check(second.verdict === 'done' && second.annotated.length === 0 && second.already.join() === LATE.join(), 'the second run finds all three already annotated');
    check(LATE.every((p) => qRead(p) === annotatedBytes[p]), 'and every file is byte-identical to the first run\'s output: the line is never doubled');

    battery('annotate-shipped -> a changeset whose first body line already says Shipped in is left byte-identical');
    q.g('checkout', '-q', '--', '.changeset');
    const handText = `---\n'${CLI_PACKAGE}': patch\n---\n\n${HAND}\n\n.changeset/late-two.md\n`;
    writeFileSync(join(q.dir, '.changeset/late-two.md'), handText);
    const third = annotate(q.dir);
    check(
      third.already.join() === '.changeset/late-two.md' && third.annotated.join() === '.changeset/late-one.md,.changeset/late-three.md' &&
        ['.changeset/late-one.md', '.changeset/late-three.md'].every((p) => qRead(p).split(LINE).length === 2),
      'the hand-annotated one is "already"; the other two are annotated, once each, on disk',
    );
    check(qRead('.changeset/late-two.md') === handText, 'and the hand-written line is not rewritten or doubled');

    battery('annotate-shipped -> outside pre mode, where the version pass deletes what it consumes');
    const s = fixture();
    const sPut = (path) => {
      mkdirSync(dirname(join(s.dir, path)), { recursive: true });
      writeFileSync(join(s.dir, path), `---\n'${CLI_PACKAGE}': minor\n---\n\n${path}\n`);
    };
    s.writeCli('17.6.0');
    sPut('.changeset/x.md');
    s.commit('base: one changeset pending');
    s.g('checkout', '-q', '-b', 'version-pr');
    s.g('rm', '-q', '.changeset/x.md');
    s.writeCli('17.7.0');
    s.commit('chore: version packages');
    s.g('checkout', '-q', 'main');
    sPut('.changeset/y.md');
    s.commit('a landing after the cut');
    s.g('merge', '-q', '--squash', 'version-pr');
    s.commit('chore: version packages (landed behind main)');
    const stable = annotate(s.dir);
    check(stable.verdict === 'done' && stable.annotated.join() === '.changeset/y.md', 'a 17.6.0 -> 17.7.0 cut landed behind one changeset -> y.md alone is annotated');
    check(
      readFileSync(join(s.dir, '.changeset/y.md'), 'utf8').includes('**Shipped in 17.7.0**, whose CHANGELOG missed this entry; listed here one release late.'),
      'with the "release" form of the line',
    );

    battery('annotate-shipped -> a reverted cut is not a version commit: the walk reads the forward cut before it');
    // The 18.1.0 shape: a 17.7.0 cut left y.md unconsumed (above); the next cut
    // (17.8.0) consumed every pending changeset, was never published, and was
    // reverted, which restored them all and moved the CLI back to 17.7.0.
    const rv = fixture();
    const rPut = (path) => {
      mkdirSync(dirname(join(rv.dir, path)), { recursive: true });
      writeFileSync(join(rv.dir, path), `---\n'${CLI_PACKAGE}': minor\n---\n\n${path}\n`);
    };
    rv.writeCli('17.6.0');
    rPut('.changeset/x.md');
    rv.commit('base: one changeset pending');
    rv.g('checkout', '-q', '-b', 'version-pr');
    rv.g('rm', '-q', '.changeset/x.md');
    rv.writeCli('17.7.0');
    rv.commit('chore: version packages');
    rv.g('checkout', '-q', 'main');
    rPut('.changeset/y.md');
    rv.commit('a landing after the cut');
    rv.g('merge', '-q', '--squash', 'version-pr');
    const rForward = rv.commit('chore: version packages (landed behind main)');
    rPut('.changeset/z.md');
    rv.commit('a landing after 17.7.0');
    rv.g('rm', '-q', '.changeset/y.md', '.changeset/z.md');
    rv.writeCli('17.8.0');
    const rCut = rv.commit('chore: version packages (17.8.0, never published)');
    rv.g('revert', '--no-edit', rCut);
    const rRevert = gitOk(rv.dir, ['rev-parse', 'HEAD']).trim();
    const afterRevert = annotate(rv.dir);
    check(
      locateLastVersionCommit({ cwd: rv.dir, head: rRevert }).versionCommit === rForward && compareVersions('17.8.0', '17.7.0') > 0 &&
        compareVersions('18.0.0-next.2', '18.0.0') < 0 && compareVersions('18.0.0-next.10', '18.0.0-next.2') > 0,
      'the revert back to 17.7.0 is passed over with the reverted 17.8.0 cut; the 17.7.0 cut is the version commit, and versions order numerically',
    );
    check(
      afterRevert.verdict === 'done' && afterRevert.versionCommit === rForward && afterRevert.annotated.join() === '.changeset/y.md',
      'so only y.md, which 17.7.0 really left unconsumed, is annotated',
    );
    check(
      !readFileSync(join(rv.dir, '.changeset/z.md'), 'utf8').includes(SHIPPED_MARK),
      'and z.md, which the revert restored but 17.7.0 never carried, is not stamped as shipped in 17.7.0',
    );

    battery('changelog attribution -> a revert of a version commit restores its changesets: each entry names the commit that first added it, through the generator changeset version loads');
    // add -> version -> revert -> re-cut, the 18.1.0 shape (#25638), with a
    // changeset name a published cut consumed and a later changeset reused.
    const ca = fixture();
    const cPut = (id, body) => {
      mkdirSync(join(ca.dir, CHANGESET_DIR), { recursive: true });
      writeFileSync(join(ca.dir, CHANGESET_DIR, `${id}.md`), `---\n'${CLI_PACKAGE}': minor\n---\n\n${body}\n`);
    };
    ca.writeCli('0.9.0');
    cPut('n', 'feat: n, first written');
    const cN1 = ca.commit('feat: n, first written');
    // l is the 1.0.0 cut's leak (annotate-shipped's case): added before it,
    // left pending by it, so its first add is older than the version commit.
    cPut('l', 'fix: l, left unconsumed by 1.0.0');
    const cL = ca.commit('fix: l');
    ca.commit('a landing between', 'between.txt');
    ca.g('rm', '-q', `${CHANGESET_DIR}/n.md`);
    ca.writeCli('1.0.0');
    ca.commit('chore: version packages (1.0.0, published)');
    cPut('n', 'feat: n, written afresh under a consumed name');
    const cN2 = ca.commit('feat: n again');
    cPut('a', 'feat: a\n\nwith a body');
    const cA = ca.commit('feat: a');
    cPut('b', 'fix: b');
    const cB = ca.commit('fix: b');
    ca.g('rm', '-q', `${CHANGESET_DIR}/n.md`, `${CHANGESET_DIR}/a.md`, `${CHANGESET_DIR}/b.md`, `${CHANGESET_DIR}/l.md`);
    ca.writeCli('1.1.0');
    const cCut = ca.commit('chore: version packages (1.1.0, never published)');
    ca.g('revert', '--no-edit', cCut);
    const cRevert = gitOk(ca.dir, ['rev-parse', 'HEAD']).trim();
    cPut('c', 'fix: c, landed after the revert');
    const cC = ca.commit('fix: c');
    // `@changesets/git`'s getCommitsThatAddFiles: the newest add of each path.
    const stockOf = (dir, id) => gitOk(dir, ['log', '--diff-filter=AC', '--follow', '--max-count=1', '--format=%H', '--', `${CHANGESET_DIR}/${id}.md`]).trim();
    check(
      ['n', 'a', 'b', 'l'].every((id) => stockOf(ca.dir, id) === cRevert) && stockOf(ca.dir, 'c') === cC,
      'the fixture reproduces the defect: the stock lookup names the revert for every changeset it restored',
    );
    const caEvents = changesetFileEvents({ cwd: ca.dir });
    const caOf = (id) => attributeChangeset({ cwd: ca.dir, events: caEvents, path: `${CHANGESET_DIR}/${id}.md`, stock: stockOf(ca.dir, id) });
    check(
      caOf('a').state === 'passed-over' && caOf('a').commit === cA && caOf('a').passedOver.join() === cRevert && caOf('b').commit === cB &&
        caOf('l').commit === cL,
      'a restored changeset names the commit that first added it, passing over the revert and the cut it undid',
    );
    check(
      caOf('n').commit === cN2 && caOf('n').commit !== cN1 && caOf('c').state === 'kept' && caOf('c').commit === cC,
      'a changeset written afresh under a name a published cut consumed keeps its own add; one landed after the revert is untouched',
    );
    const caLog = [];
    const { changelogFunctions } = await import('./changeset-changelog.mjs');
    const recut = changelogFunctions({ cwd: ca.dir, log: (line) => caLog.push(line) });
    const releaseLine = await recut.getReleaseLine({ id: 'a', summary: 'feat: a\n\nwith a body', releases: [], commit: cRevert }, 'minor', null);
    const depLine = await recut.getDependencyReleaseLine(
      [{ id: 'b', summary: 'fix: b', releases: [], commit: cRevert }, { id: 'c', summary: 'fix: c', releases: [], commit: cC }],
      [{ name: '@objectstack/spec', newVersion: '1.1.0' }],
      null,
    );
    check(
      releaseLine === `- ${cA.slice(0, 7)}: feat: a\n  \n  with a body` &&
        depLine === `- Updated dependencies [${cB.slice(0, 7)}]\n- Updated dependencies [${cC.slice(0, 7)}]\n  - @objectstack/spec@1.1.0`,
      'the re-cut through scripts/changeset-changelog.mjs: the stock line format, each line naming its own commit, dependency lines included',
    );
    check(
      caLog.length === 1 && caLog[0].includes(cRevert.slice(0, 10)) && !caLog[0].startsWith('::'),
      'the restoring commit is named once, as a plain line',
    );

    battery('changelog attribution -> a shallow clone deepens itself to the first add; with no history to fetch, or nothing to decide, the stock commit stays and the version pass goes on');
    ca.g('config', 'uploadpack.allowReachableSHA1InWant', 'true');
    // Depth 3 = c's landing, the revert and the cut: the history `@changesets/git`
    // deepens to before it answers, the revert and its parent present.
    const caClone = () => {
      const d = mkdtempSync(join(tmpdir(), 'release-pending-publish-shallow-'));
      dirs.push(d);
      gitOk(tmpdir(), ['clone', '-q', '--depth', '3', '--branch', 'main', `file://${ca.dir}`, d]);
      return d;
    };
    const aOf = (attribute) => attribute({ id: 'a', commit: cRevert });
    const caDeepened = createChangelogAttribution({ cwd: caClone(), rounds: [1, 1, 3, 1, 1, 1], log: () => {} });
    check(
      aOf(caDeepened) === cA && caDeepened({ id: 'l', commit: cRevert }) === cL,
      'a shallow clone fetches history in bounded rounds to the version commit, and on past a graft commit that only seems to add the leak, then names each first add',
    );
    const stuckLog = [];
    check(
      aOf(createChangelogAttribution({ cwd: caClone(), deepen: false, log: (line) => stuckLog.push(line) })) === cRevert &&
        stuckLog.length === 1 && stuckLog[0].startsWith('::warning::changeset-changelog:'),
      'with no history to fetch, the stock commit stays, with one warning',
    );
    const notRepo = mkdtempSync(join(tmpdir(), 'release-pending-publish-not-git-'));
    dirs.push(notRepo);
    const brokenLog = [];
    const broken = createChangelogAttribution({ cwd: notRepo, log: (line) => brokenLog.push(line) });
    check(
      aOf(broken) === cRevert && broken({ id: 'b', commit: cRevert }) === cRevert && brokenLog.length === 1 && /^::warning::/.test(brokenLog[0]),
      'outside any git repository: never a throw, every entry keeps its stock commit, one warning',
    );
    const plain = createChangelogAttribution({ cwd: ca.dir, log: () => {} });
    check(
      plain({ id: 'a' }) === undefined && plain({ id: 'gone', commit: cC }) === cC && plain({ id: 'c', commit: cC }) === cC,
      'no stock commit, a changeset this history never added, a changeset nothing restored: the stock answer, unchanged',
    );

    // The stable cut out of pre mode (#26079, ruling A′): the generator folds
    // the cycle's prerelease sections into the stable section the version pass
    // writes, instead of leaving them as a second copy below it.
    const { foldPrereleaseSections, prepareFold } = await import('./changeset-changelog.mjs');
    const OLD_CYCLE = [
      '## 1.1.0', '', '### Minor Changes', '', '- 1111111: old feature', '',
      '## 1.1.0-next.0', '', '### Minor Changes', '', '- 1111111: old feature', '',
    ].join('\n');
    const STABLE_SECTION = [
      '## 1.2.0', '', '### Minor Changes', '',
      '- aaaaaaa: feature A', '  with a second line', '- bbbbbbb: feature B', '- ccccccc: feature C', '',
      '### Patch Changes', '', '- Updated dependencies [aaaaaaa, bbbbbbb, ccccccc]', '  - @demo/core@1.2.0', '',
    ].join('\n');
    const NEXT_1 = [
      '## 1.2.0-next.1', '', '### Minor Changes', '', '- 9999999: feature B', '',
      '### Patch Changes', '', '- Updated dependencies [bbbbbbb]', '  - @demo/core@1.2.0-next.1', '',
    ].join('\n');
    const NEXT_0 = ['## 1.2.0-next.0', '', '### Minor Changes', '', '- aaaaaaa: feature A', '  with a second line', ''].join('\n');
    const changelog = (...sections) => `# @demo/pkg\n\n${sections.join('\n')}`;
    const stableCut = changelog(STABLE_SECTION, NEXT_1, NEXT_0, OLD_CYCLE);
    const folded = changelog(STABLE_SECTION, OLD_CYCLE);

    battery('changelog fold -> on the stable cut each prerelease section of the cycle folds into the stable section: an entry is its summary, not its commit, and a dependency bump is superseded');
    const f = foldPrereleaseSections(stableCut, '1.2.0-next.1');
    check(f.folded.join() === '1.2.0-next.1,1.2.0-next.0' && f.kept.length === 0, `both prerelease sections of the cycle fold (folded: ${f.folded.join()})`);
    check(f.text === folded, 'the folded file is the stable section, then the older cycle, and nothing else');
    check(!f.text.includes('9999999'), 'an entry naming another commit than its stable line still folds: the summary is the entry');
    check(!f.text.includes('@demo/core@1.2.0-next.1'), "a prerelease's dependency bump does not hold its section back");

    battery('changelog fold -> the stable section is kept whole, and so is every older cycle; a prerelease section carrying an entry the stable section lacks stays');
    check(f.text.includes(STABLE_SECTION), 'the new stable section is byte-identical to what the version pass wrote');
    check(f.text.endsWith(OLD_CYCLE), "an older cycle's stable section and its prerelease sections are byte-identical (存量不横扫)");
    check(foldPrereleaseSections(folded, '1.1.0').text === folded, 'a cut whose top was a stable section changes nothing');
    const noStable = changelog(NEXT_1, NEXT_0);
    check(foldPrereleaseSections(noStable, '1.2.0-next.0').text === noStable, 'a file that does not open with a stable section changes nothing');
    const amended = NEXT_0.replace('feature A', 'feature A, amended');
    const fa = foldPrereleaseSections(changelog(STABLE_SECTION, NEXT_1, amended, OLD_CYCLE), '1.2.0-next.1');
    check(
      fa.folded.join() === '1.2.0-next.1' && fa.kept.length === 1 && fa.text === changelog(STABLE_SECTION, amended, OLD_CYCLE),
      'a prerelease section carrying an entry the stable section does not reproduce is kept whole; the rest fold',
    );

    battery('changelog fold -> armed only on an exit-mode cut, for the CHANGELOGs whose top was a prerelease before the version pass wrote');
    const fd = mkdtempSync(join(tmpdir(), 'release-pending-publish-fold-'));
    dirs.push(fd);
    gitOk(fd, ['init', '-q']);
    for (const d of ['.changeset', 'a', 'b']) mkdirSync(join(fd, d));
    writeFileSync(join(fd, 'a', 'CHANGELOG.md'), changelog(NEXT_1, NEXT_0, OLD_CYCLE));
    writeFileSync(join(fd, 'b', 'CHANGELOG.md'), changelog(OLD_CYCLE));
    gitOk(fd, ['add', '.']);
    check(prepareFold({ cwd: fd, log: () => {} }) === null, 'no .changeset/pre.json -> not armed');
    writeFileSync(join(fd, '.changeset', 'pre.json'), '{"mode":"exit","tag":"next"}');
    const foldLog = [];
    const armed = prepareFold({ cwd: fd, log: (line) => foldLog.push(line) });
    check(armed !== null && [...armed.tops.keys()].join() === 'a/CHANGELOG.md', 'an exit-mode cut -> armed for a/ only: b/ already opens with a stable section');
    // What `changeset version` writes: the new stable section above the old top.
    writeFileSync(join(fd, 'a', 'CHANGELOG.md'), stableCut);
    writeFileSync(join(fd, 'b', 'CHANGELOG.md'), folded);
    armed?.apply();
    check(
      readFileSync(join(fd, 'a', 'CHANGELOG.md'), 'utf8') === folded && readFileSync(join(fd, 'b', 'CHANGELOG.md'), 'utf8') === folded &&
        foldLog.length === 1 && /folded 2 prerelease section\(s\) in 1 CHANGELOG/.test(foldLog[0]),
      'after the write, a/ is folded, b/ is untouched, and one plain line says so',
    );

    battery('annotate-shipped -> a depth-1 clone deepens itself to the version commit; with no reachable history it warns, annotates nothing and exits 0');
    q.g('checkout', '-q', '--', '.changeset');
    q.g('config', 'uploadpack.allowReachableSHA1InWant', 'true');
    q.g('branch', '-f', 'annotate-head', qHead);
    const shallowClone = () => {
      const d = mkdtempSync(join(tmpdir(), 'release-pending-publish-shallow-'));
      dirs.push(d);
      gitOk(tmpdir(), ['clone', '-q', '--depth', '1', '--branch', 'annotate-head', `file://${q.dir}`, d]);
      return d;
    };
    const deep = shallowClone();
    const deepened = annotate(deep, { rounds: [1, 1, 2, 4] });
    check(
      deepened.verdict === 'done' && deepened.deepenedBy > 0 && deepened.versionCommit === qLanded && deepened.annotated.join() === LATE.join() &&
        LATE.every((p) => readFileSync(join(deep, p), 'utf8').split(LINE).length === 2),
      `a depth-1 clone fetches history in bounded rounds until the version commit and its parent are present, then annotates the same three (deepened by ${deepened.deepenedBy})`,
    );
    const cut = shallowClone();
    gitOk(cut, ['remote', 'set-url', 'origin', `file://${join(tmpdir(), 'release-pending-publish-no-such-remote')}`]);
    const unreachable = annotate(cut);
    check(
      unreachable.verdict === 'undecided' && /--deepen/.test(unreachable.reason) && unreachable.annotated.length === 0 &&
        gitOk(cut, ['status', '--porcelain']).trim() === '',
      'origin unreachable -> undecided, naming the failed fetch, and the working tree is untouched',
    );
    const cutCli = cli(cut);
    check(
      cutCli.status === 0 && cutCli.stdout.startsWith('::warning::annotate-shipped:') && /Annotated nothing/.test(cutCli.stdout),
      'and the CLI says so in a warning and exits 0',
    );
    const noDeepen = annotate(shallowClone(), { deepen: false });
    check(noDeepen.verdict === 'undecided' && /--no-deepen/.test(noDeepen.reason), '--no-deepen in a shallow clone -> undecided, never a graft-boundary guess');

    battery('annotate-shipped -> no version commit, an unpublished or unreadable version, an error anywhere: a warning or a plain line, nothing written, exit 0');
    const none = fixture();
    writeFileSync(join(none.dir, 'README.md'), 'no CLI here\n');
    none.commit('a repository with no CLI manifest');
    const noManifest = annotate(none.dir);
    const born = fixture();
    born.writeCli('1.0.0');
    born.commit('the manifest is born here');
    born.commit('a landing', 'x.txt');
    const rootOnly = annotate(born.dir);
    const later = fixture();
    later.commit('before the CLI', 'y.txt');
    later.writeCli('1.0.0');
    later.commit('the manifest is created');
    const createdOnly = annotate(later.dir);
    check(
      [noManifest, rootOnly, createdOnly].every((r) => r.verdict === 'undecided' && r.annotated.length === 0) &&
        /carries no packages\/cli\/package\.json/.test(noManifest.reason) && /root commit/.test(rootOnly.reason) && /creation is not a release/.test(createdOnly.reason),
      'no manifest, a manifest born in the root commit, a manifest created later: each is "no version commit", undecided',
    );
    q.g('checkout', '-q', '--', '.changeset');
    const unpublished = annotateShipped({ cwd: q.dir, npmStateOf: npmOf([]) });
    check(
      unpublished.verdict === 'unshipped' && unpublished.annotated.length === 0 && gitOk(q.dir, ['status', '--porcelain']).trim() === '' &&
        /not on npm/.test(describeAnnotate(unpublished)[0]) && !describeAnnotate(unpublished)[0].startsWith('::'),
      'the last version is not on npm -> nothing shipped, a plain line, nothing written',
    );
    const unreadableNpm = annotateShipped({ cwd: q.dir, npmStateOf: () => 'unknown' });
    check(
      unreadableNpm.verdict === 'undecided' && /npm could not say/.test(unreadableNpm.reason) && gitOk(q.dir, ['status', '--porcelain']).trim() === '',
      'npm unreadable -> undecided, nothing written',
    );
    const notGit = mkdtempSync(join(tmpdir(), 'release-pending-publish-not-git-'));
    dirs.push(notGit);
    const notGitCli = cli(notGit);
    check(
      notGitCli.status === 0 && notGitCli.stdout.startsWith('::warning::annotate-shipped:'),
      'run outside any git repository -> a warning and exit 0: the step never stops the version pass',
    );
    const badPre = fixture();
    badPre.writeCli('1.0.0');
    badPre.commit('base');
    mkdirSync(join(badPre.dir, '.changeset'), { recursive: true });
    writeFileSync(join(badPre.dir, PRE_STATE), '{ not json');
    badPre.writeCli('1.1.0');
    badPre.commit('a version commit whose pre.json is not JSON');
    const badPreResult = annotate(badPre.dir, { npmStateOf: () => 'present' });
    check(
      badPreResult.verdict === 'undecided' && /is not JSON/.test(badPreResult.reason) && /^::warning::/.test(describeAnnotate(badPreResult)[0]),
      'an unreadable pre.json at the version commit -> undecided with the reason, as a warning',
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

  battery('the sweep -> a transient read is retried under one budget, still failing it defers with a warning and exit 0, and a 4xx or a failed cancel stays red');
  {
    // The incident's read: the jobs listing of a COMPLETED push run that
    // carried a version commit (run 40078805767, 18.1.0, re-read on every push
    // inside the read-back window to verify the targeting), next to a waiting
    // push-lane prompt for a version already on npm. `answers` scripts each
    // path's answers in order; the last one repeats.
    const sweepWith = async (answers = {}, { npm = ['1.1.0', '1.2.0'] } = {}) => {
      const calls = [];
      const slept = [];
      const logged = [];
      const warned = [];
      const seenBy = new Map();
      const http = async (method, path) => {
        calls.push(`${method} ${path}`);
        const u = new URL(path, 'https://api.invalid');
        const key = `${method} ${u.pathname}`;
        const n = seenBy.get(key) ?? 0;
        seenBy.set(key, n + 1);
        const scripted = answers[key];
        if (scripted) {
          const a = scripted[Math.min(n, scripted.length - 1)];
          if (a instanceof Error) throw a;
          if (a !== 'pass') return a;
        }
        if (method === 'POST') return { status: 202, body: null };
        let m;
        if (u.pathname.endsWith('/actions/workflows/release.yml/runs')) {
          if (u.searchParams.get('status') === 'waiting') return { status: 200, body: { total_count: 0, workflow_runs: [] } };
          const at = { v6: [pushRun(301, 'completed', 2)], v5: [pushRun(201, 'waiting', 1)] }[u.searchParams.get('head_sha')] ?? [];
          return { status: 200, body: { workflow_runs: at } };
        }
        const direct = {
          301: carrying(301, 'completed', 2, [prompt('1.2.0', 'completed')]),
          201: carrying(201, 'waiting', 1, [prompt('1.1.0')], ['release']),
        };
        if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) return { status: 200, body: direct[m[1]] };
        if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) return { status: 200, body: { jobs: direct[m[1]].jobs } };
        if ((m = /\/actions\/runs\/(\d+)\/pending_deployments$/.exec(u.pathname))) return { status: 200, body: direct[m[1]].pending };
        return { status: 404, body: null };
      };
      const dir = mkdtempSync(join(tmpdir(), 'release-pending-publish-sweep-'));
      dirs.push(dir);
      const summaryFile = join(dir, 'summary.md');
      writeFileSync(summaryFile, '');
      let exit = null;
      let threw = null;
      try {
        exit = await sweep({
          workflow: 'release.yml',
          dryRun: false,
          env: { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '900', GITHUB_STEP_SUMMARY: summaryFile },
          http,
          versionCommits: [vc('v6', '1.2.0'), vc('v5', '1.1.0')],
          npmStateOf: npmOf(npm),
          now: NOW,
          sleep: async (ms) => { slept.push(ms); },
          log: (line) => logged.push(line),
          warn: (line) => warned.push(line),
        });
      } catch (err) {
        threw = err;
      }
      const summary = readFileSync(summaryFile, 'utf8');
      const count = (re) => calls.filter((c) => re.test(c)).length;
      return { exit, threw, calls, slept, logged, warned, summary, count };
    };
    const JOBS_301 = 'GET /repos/o/r/actions/runs/301/jobs';
    const CANCEL_201 = /^POST \/repos\/o\/r\/actions\/runs\/201\/cancel$/;
    const bad = { status: 502, body: { message: 'Server Error' } };
    const ok = 'pass';

    const control = await sweepWith();
    check(
      control.exit === 0 && control.threw === null && control.count(CANCEL_201) === 1 && control.slept.length === 0 && control.warned.length === 0,
      'the control: every read answers -> the stale prompt is cancelled, exit 0, no backoff and no warning',
    );

    const blip = await sweepWith({ [JOBS_301]: [bad, ok] });
    check(
      blip.exit === 0 && blip.threw === null && blip.count(/runs\/301\/jobs/) === 2 && blip.slept.join() === '500' &&
        blip.count(CANCEL_201) === 1 && /cancelled \[201\]/.test(blip.summary) && blip.warned.length === 0,
      "a 502 then a 200 on a carried run's jobs listing (the incident's read) -> retried once after 500 ms, and swept: the stale prompt is cancelled, exit 0",
    );

    const down = await sweepWith({ [JOBS_301]: [bad] });
    check(
      down.exit === 0 && down.threw === null && down.count(/runs\/301\/jobs/) === 3 && down.slept.join() === '500,1000' &&
        down.count(/^POST /) === 0,
      "a 502 on every attempt -> the read's ladder is spent (3 attempts, 500 + 1000 ms), nothing is judged or cancelled, and the sweep exits 0",
    );
    check(
      down.warned.length === 1 && down.warned[0].startsWith('::warning::the stale-prompts sweep of release.yml could not read the Actions API') &&
        /listing run 301's jobs: GET \/repos\/o\/r\/actions\/runs\/301\/jobs\?filter=latest&per_page=100 -> HTTP 502 after 3 attempts/.test(down.warned[0]) &&
        !down.warned[0].includes('\n') && /NOT READ this run/.test(down.summary) && /the next push to main runs this sweep again/.test(down.summary),
      'and it says so: one ::warning:: line naming the read, the answer and the attempts, and a NOT READ section in the job summary',
    );

    const reset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    const dropped = await sweepWith({ [JOBS_301]: [reset, ok] });
    check(
      dropped.exit === 0 && dropped.threw === null && dropped.count(/runs\/301\/jobs/) === 2 && dropped.slept.join() === '500' && dropped.count(CANCEL_201) === 1,
      'a connection reset (ECONNRESET on the cause) then a 200 -> retried, and swept',
    );
    const unnamed = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) });
    const dns = await sweepWith({ [JOBS_301]: [unnamed, ok] });
    check(
      dns.exit === null && dns.threw === unnamed && dns.count(/runs\/301\/jobs/) === 1 && dns.slept.length === 0,
      'a thrown error that is not a named connection failure -> rethrown unchanged on the first attempt (a red job)',
    );

    const missing = await sweepWith({ [JOBS_301]: [{ status: 404, body: { message: 'Not Found' } }] });
    check(
      missing.exit === null && !(missing.threw instanceof TransientReadFailure) &&
        /listing run 301's jobs answered HTTP 404/.test(String(missing.threw && missing.threw.message)) &&
        missing.count(/runs\/301\/jobs/) === 1 && missing.slept.length === 0 && missing.count(/^POST /) === 0,
      'a 404 -> fatal at once: one request, no backoff, nothing cancelled, and the error is not a deferral (a red job)',
    );

    // Five reads each answer one 502 first (the waiting list, both direct
    // reads, both jobs listings): the run's budget of 4 retries covers the
    // first four, and the fifth read's first 502 is final.
    const flap = {};
    const FLAPPING = ['workflows/release.yml/runs', 'runs/301', 'runs/301/jobs', 'runs/201', 'runs/201/jobs'];
    for (const p of FLAPPING) flap[`GET /repos/o/r/actions/${p}`] = [bad, ok];
    const flapping = await sweepWith(flap);
    check(
      flapping.exit === 0 && flapping.slept.length === 4 && flapping.slept.every((ms) => ms === 500) && flapping.count(/^POST /) === 0 &&
        flapping.warned.length === 1 && /after 1 attempt \(this run's budget of 4 retries is spent\)/.test(flapping.warned[0]),
      "a flapping API -> ONE budget for the whole sweep: 4 retries, then the next 5xx defers (exit 0) -- at most 3 s of backoff a run, never a ladder per read",
    );

    const cancel502 = await sweepWith({ 'POST /repos/o/r/actions/runs/201/cancel': [bad] });
    check(
      cancel502.exit === 1 && cancel502.count(CANCEL_201) === 1 && cancel502.slept.length === 0 &&
        cancel502.logged.some((l) => l === '::error::cancel of run 201 answered HTTP 502'),
      'a cancel answering 502 -> sent once, never retried, and the job fails as before',
    );

    // ⛔ The publish guard's reads keep their semantics: `in-flight` reads
    // through the bare HTTP layer, so an unreadable answer is in flight at once.
    const gateCalls = [];
    const guarded = await publishInFlight({
      http: async (method, path) => {
        gateCalls.push(path);
        return bad;
      },
      repo: 'o/r',
      workflow: 'release.yml',
      version: '1.1.0',
      versionCommit: 'c'.repeat(40),
      walk: [{ versionCommit: 'c'.repeat(40), version: '1.1.0', tips: ['c'.repeat(40)] }].values(),
    });
    check(
      guarded.state === 'in-flight' && guarded.reason === 'unreadable' && /answered HTTP 502/.test(guarded.detail) && gateCalls.length === 1,
      'the publish guard (in-flight) on a 502 -> still unreadable, so in flight, after its one request: the retry and the deferral are the sweep\'s alone',
    );
  }

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
  if (mode === 'annotate-shipped') {
    // ⛔ Exit 0 on every path. This step runs inside the version pass, and it
    // must never be the reason a release does not happen: anything it cannot
    // decide is a warning and an untouched tree.
    try {
      const head = flag(rest, '--head') || 'HEAD';
      const result = annotateShipped({ cwd: process.cwd(), head, deepen: !rest.includes('--no-deepen'), npmStateOf: (v) => npmState(v) });
      console.log(describeAnnotate(result).join('\n'));
    } catch (err) {
      console.log(commandData(`::warning::annotate-shipped: ${err && err.message ? err.message : err}. Annotated nothing; the version pass goes on without it.`));
    }
    process.exitCode = 0;
    return;
  }
  if (mode === 'sweep') {
    const exit = await sweep({ workflow: flag(rest, '--workflow') || 'release.yml', dryRun: rest.includes('--dry-run') });
    if (exit !== 0) process.exit(exit);
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
  throw new Error(`unknown mode ${JSON.stringify(mode)} -- expected select, npm-state, unconsumed, annotate-shipped, sweep, in-flight or --self-test`);
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`::error::release-pending-publish: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}
