// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/ops — the ONE frozen table of what a fleet-write relay may do.
 *
 * A cloud seat cannot hold the fleet App's identity (its egress proxy replaces
 * every `Authorization` header and refuses the `/app/**` mint path), so a seat
 * that must write as `objectstack-fleet[bot]` sends ONE `repository_dispatch`
 * to the board repo and a workflow there executes the writes with a token the
 * runner minted. Everything that crosses that boundary is spelled here, once:
 *
 *   - `PAYLOAD_KEYS`      the closed envelope a seat sends (`client_payload`);
 *   - `OPS`               the closed op list, each with its REQUIRED keys, its
 *                         OPTIONAL keys, the endpoint(s) it becomes and the App
 *                         permission it spends;
 *   - `FIELDS`            the typed vocabulary those keys draw from — integer
 *                         numbers, byte-capped strings, capped string lists,
 *                         closed enums;
 *   - the LIMITS          the seat-side packer, the validator and the
 *                         executor all read: action count, caps, and the
 *                         platform's own `client_payload` ceilings.
 *
 * `validate.mjs` reads this table to REFUSE a payload; `execute.mjs` reads it
 * to ISSUE the requests; `dispatch.mjs` reads it to PACK a stroke. None of the
 * three restates a key, a cap or an endpoint, so the whitelist has exactly one
 * spelling and a fourth op is one row here — reviewed as one row, with its
 * permission beside it.
 *
 * ## What is refused BY CONSTRUCTION
 *
 * An op is only what this table names. There is no row for a merge, a review
 * submission, a branch or ref write, a contents or workflow-file write, a run
 * cancel / re-run / delete, a cache or artifact write, a release, or any
 * organization / administration endpoint, so a payload naming one is
 * refused at the validator with zero writes — the `--self-test` of
 * `validate.mjs` pins that every path spelled here stays clear of those
 * families and that no row issues a whole-set `PUT`.
 *
 * ## The permissions the relay's token is narrowed to
 *
 * Read from GitHub's own permission ledger for server-to-server tokens
 * (`github/docs`, `src/github-apps/data/fpt-2022-11-28/server-to-server-permissions.json`):
 * every `/issues/**` write here is `issues: write`; `/pulls/**` and the
 * ready / draft GraphQL mutations are `pull-requests: write`; the two
 * auto-merge mutations (`enablePullRequestAutoMerge` /
 * `disablePullRequestAutoMerge`) additionally require `contents: write` —
 * measured on the first live use, where a token without it answered
 * "Resource not accessible by integration" — and those two rows are the ONLY
 * spenders of it: the table has no contents op (no file, ref or branch write);
 * the one workflow-run dispatch (`workflow_dispatch`, below) is `actions: write`,
 * the one row spending it; the sender gate's
 * `GET /repos/{o}/{r}/collaborators/{login}/permission` is `metadata: read`.
 * `PERMISSIONS` is that set and nothing wider. The workflow declares the four
 * grants every stroke gets as literal `permission-*` inputs on
 * `actions/create-github-app-token`, and the one grant a stroke gets only when
 * it spends it (`STROKE_SCOPED_PERMISSIONS`) as an input read from the
 * validator's output; `validate.mjs --self-test` pins both spellings equal to
 * this table.
 *
 * ## The one row whose token carries `actions: write` — `workflow_dispatch`
 *
 * `POST /repos/{repo}/actions/workflows/{file}/dispatches` starts a run of a
 * workflow file at a ref and needs `actions: write` on the token — a grant that
 * also reaches cancelling, re-running and deleting runs, and the cache,
 * artifact, secret and variable endpoints. So the row is fenced four ways:
 * `workflow` is a closed enum — `WORKFLOW_DISPATCH_ALLOWLIST`, one file name
 * per entry, matched whole, joined only by a PR that adds the entry here and
 * never at request time; `ref` is a closed enum of exactly
 * `WORKFLOW_DISPATCH_REF`; a stroke carrying this op carries exactly that one
 * action (`alone`), so the wider token serves one request and nothing beside
 * it; and the grant is minted only for such a stroke — the validator writes
 * `permission_actions=write` for it and an empty value for every other stroke,
 * and the mint action skips an empty `permission-*` input, so every other
 * stroke's token is what it was before this row. The op sends no `inputs`: the
 * one allowlisted workflow declares none and the platform refuses inputs on a
 * workflow that declares none, so a workflow with inputs joins the list by the
 * PR that also spells its inputs here. `REFUSED_PATH_FAMILIES` refuses every
 * other `actions/*` path, and `validate.mjs --self-test` pins that the dispatch
 * call is the only one the table reaches. The dispatch answers 204 with no
 * body, so the run it starts is read back by the SEAT (`dispatch.mjs`): the
 * newest `workflow_dispatch` run of that file created since the dispatch.
 *
 * ## The one row whose token reaches a SECOND repository — `transfer`
 *
 * GitHub's `transferIssue` mutation (GraphQL only; REST has no transfer
 * endpoint) needs `issues: write` on the repository the card is in AND on the
 * one it moves to, so a transfer stroke's token is minted for both. That is
 * the only widening of the token's repository reach the relay makes (the one
 * widening of its permissions is the next section), and it is fenced four ways: the target is
 * a closed enum — `TRANSFER_TARGETS`, the fleet's governed-repository roster
 * reused from `check-governed-merges.mjs`, never a second roster and never
 * free text; the target is never the source; a stroke carrying a transfer
 * carries transfers alone, to ONE target; and the executor gates the sender on
 * BOTH repositories before the first write. Every other op keeps the
 * single-repository token — `validate.mjs` computes the list the workflow
 * mints for (`tokenRepositoriesOf`) and its `--self-test` pins both halves.
 * The mutation never sets `createLabelsIfMissing` (GitHub's default is false):
 * a label with no same-named label on the target is dropped, never created
 * there. Comments and assignees travel with the card and the old URL
 * redirects — GitHub's documented transfer semantics.
 *
 * ## The platform's `client_payload` ceilings — pinned, with their source
 *
 * "The maximum number of top-level properties is 10. The total size of the
 * JSON payload must be less than 64KB." — the `client_payload` parameter of
 * `POST /repos/{owner}/{repo}/dispatches` in GitHub's REST OpenAPI description
 * (`github/rest-api-description`, `descriptions/api.github.com/api.github.com.json`,
 * read 2026-09-22; the rendered page is
 * https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event).
 * `event_type` is capped at 100 characters there too. The validator refuses at
 * these ceilings BEFORE the dispatch leaves, so a payload the platform would
 * reject with a 422 is refused locally with the reason.
 */

import { GOVERNED_REPOS } from '../check-governed-merges.mjs';

/**
 * The relay's four files, repo-relative — the population a card touching any
 * of them implicates (the dispatch derivation reads these literals as path
 * leads, so a bare `fleet-write/…` spelling would name nothing from the repo
 * root). `validate.mjs --self-test` checks each one is on disk.
 */
export const RELAY_FILES = Object.freeze([
  'scripts/pm/fleet-write/ops.mjs',
  'scripts/pm/fleet-write/validate.mjs',
  'scripts/pm/fleet-write/execute.mjs',
  'scripts/pm/fleet-write/dispatch.mjs',
]);

/** The board repository every relay lands on; `payload.repo` names the TARGET. */
export const RELAY_REPO = 'objectstack-ai/objectstack';

/** The `event_type` the relay workflow listens for — and nothing else. */
export const RELAY_EVENT_TYPE = 'fleet-write';

/** The one organization the App is installed on; a target outside it is refused. */
export const TARGET_OWNER = 'objectstack-ai';

/**
 * The repositories a `transfer` may move a card to — the fleet's governed
 * roster, reused, so a repository joins the fleet in ONE place and becomes a
 * transfer target there. `validate.mjs --self-test` pins that every entry is
 * in `TARGET_OWNER`.
 */
export const TRANSFER_TARGETS = Object.freeze(GOVERNED_REPOS.map((r) => r.slug));

/**
 * The workflow files a `workflow_dispatch` may start — one file name per
 * entry, matched whole (never a path, never a glob), joined only by a PR that
 * adds the entry here. `validate.mjs --self-test` pins that every entry is a
 * file under `.github/workflows/` declaring a `workflow_dispatch` trigger.
 */
export const WORKFLOW_DISPATCH_ALLOWLIST = Object.freeze(['shard-timings-refresh.yml']);
/** The one ref a `workflow_dispatch` may start a run at. ⛔ Never a free string. */
export const WORKFLOW_DISPATCH_REF = 'main';
/** The shape of the one `actions/*` path the table reaches — the dispatch call, nothing beside it. */
export const WORKFLOW_DISPATCH_PATH_SHAPE = /\/actions\/workflows\/[^/]+\/dispatches$/;

/** The seat-side transport selector and its three values. */
export const TRANSPORT_ENV = 'OS_FLEET_TRANSPORT';
export const TRANSPORTS = Object.freeze(['direct', 'dispatch', 'auto']);

/**
 * The session id a dispatch carries. A cloud seat's is READ FROM THE CONTAINER
 * (`CONTAINER_SESSION_ENV` below); this variable OVERRIDES it — for a local
 * checkout, or a test — and an explicit value that is malformed is refused,
 * never replaced by the container's.
 */
export const SESSION_ENV = 'OS_FLEET_SESSION';
/**
 * The container's own name for the seat's session: the cloud harness sets
 * `CLAUDE_CODE_REMOTE_SESSION_ID=cse_<id>` in every cloud seat container
 * measured, and `session_<id>` — the same tail — is the seat's id in the shape
 * `SESSION_SHAPE` takes. Read only when `SESSION_ENV` is absent; a subagent
 * dev runs in its PM's container and so inherits the DISPATCHING seat's id,
 * which is the identity the envelope should carry.
 */
export const CONTAINER_SESSION_ENV = 'CLAUDE_CODE_REMOTE_SESSION_ID';

/** The merge method the auto-merge op arms. ⛔ Never a free string. */
export const MERGE_METHOD = 'SQUASH';

export const MAX_ACTIONS = 20;
export const MAX_REQUEST_ID_CHARS = 64;
export const MAX_TITLE_BYTES = 256;
export const MAX_BODY_BYTES = 60_000;
/** GitHub's own cap on a label name. */
export const MAX_LABEL_BYTES = 50;
/** GitHub's own cap on a login. */
export const MAX_LOGIN_CHARS = 39;
export const MAX_REF_BYTES = 255;
/** Names per list-valued key; ten assignees is the platform's own cap, twenty labels is ours. */
export const MAX_LABELS_PER_ACTION = 20;
export const MAX_LOGINS_PER_ACTION = 10;

/** The platform's ceilings on `client_payload`, quoted in the header. */
export const CLIENT_PAYLOAD_MAX_TOP_LEVEL = 10;
export const CLIENT_PAYLOAD_MAX_BYTES = 64 * 1024;
export const EVENT_TYPE_MAX_CHARS = 100;

/** The envelope. Every key required, nothing else admitted. */
export const PAYLOAD_KEYS = Object.freeze(['request_id', 'repo', 'session', 'actions']);

export const REQUEST_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SESSION_SHAPE = /^session_[A-Za-z0-9]{6,}$/;
/** The container variable's shape; group 1 is the tail `session_` is prefixed to. */
export const CONTAINER_SESSION_SHAPE = /^cse_([A-Za-z0-9]{6,})$/;
export const TARGET_REPO_SHAPE = new RegExp(`^${TARGET_OWNER}/[A-Za-z0-9_.-]+$`);

/**
 * The typed vocabulary. `kind` is one of:
 *   `int`   a positive integer (never a numeric string);
 *   `str`   a non-empty string of at most `max` UTF-8 bytes;
 *   `list`  an array of 1..`max` non-empty strings, each at most `itemMax` bytes;
 *   `enum`  one of `values`.
 */
export const FIELDS = Object.freeze({
  issue: Object.freeze({ kind: 'int' }),
  pull: Object.freeze({ kind: 'int' }),
  comment_id: Object.freeze({ kind: 'int' }),
  body: Object.freeze({ kind: 'str', max: MAX_BODY_BYTES }),
  title: Object.freeze({ kind: 'str', max: MAX_TITLE_BYTES }),
  head: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  base: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  labels: Object.freeze({ kind: 'list', max: MAX_LABELS_PER_ACTION, itemMax: MAX_LABEL_BYTES }),
  assignees: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  reviewers: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  team_reviewers: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  state: Object.freeze({ kind: 'enum', values: Object.freeze(['open', 'closed']) }),
  state_reason: Object.freeze({ kind: 'enum', values: Object.freeze(['completed', 'not_planned', 'duplicate', 'reopened']) }),
  target_repo: Object.freeze({ kind: 'enum', values: TRANSFER_TARGETS }),
  workflow: Object.freeze({ kind: 'enum', values: WORKFLOW_DISPATCH_ALLOWLIST }),
  ref: Object.freeze({ kind: 'enum', values: Object.freeze([WORKFLOW_DISPATCH_REF]) }),
});

/**
 * The App permissions the relay token is narrowed to — the union of every
 * row's `permission`, plus the sender gate's read. `contents: write` is spent
 * by the two auto-merge rows alone (GitHub's requirement for those mutations);
 * no row writes a file, a ref or a branch. `actions: write` is spent by the
 * `workflow_dispatch` row alone, and minted only for a stroke carrying it
 * (`STROKE_SCOPED_PERMISSIONS`).
 */
export const PERMISSIONS = Object.freeze({ issues: 'write', 'pull-requests': 'write', contents: 'write', metadata: 'read', actions: 'write' });

/**
 * The permissions minted ONLY for a stroke carrying an op that spends them —
 * `actions: write`, the `workflow_dispatch` row's alone. `validate.mjs`
 * computes a stroke's permission set (`tokenPermissionsOf`) and writes each of
 * these to `$GITHUB_OUTPUT` as `permission_<name>=<level>` or empty; the
 * workflow's mint step reads that output for exactly these inputs, and
 * `actions/create-github-app-token` skips an empty `permission-*` input
 * (`lib/get-permissions-from-inputs.js`: an empty value returns the set
 * unchanged), so every other stroke's token carries the literal grants alone.
 */
export const STROKE_SCOPED_PERMISSIONS = Object.freeze(['actions']);

const issues = (repo, n) => `/repos/${repo}/issues/${n}`;
const pulls = (repo, n) => `/repos/${repo}/pulls/${n}`;
const enc = (s) => encodeURIComponent(s);

/**
 * A GraphQL mutation on a pull request, keyed by the op. The executor resolves
 * the pull's node id with `GET /repos/{repo}/pulls/{n}` and sends
 * `POST /graphql` with `{ query, variables: { id } }`.
 *
 * The two auto-merge rows also select `isInMergeQueue` and
 * `isMergeQueueEnabled` (`PullRequest`, both `Boolean!`): on a branch behind a
 * merge queue, arming a pull whose checks are already green enqueues it at
 * once and the answer carries NO `autoMergeRequest` — the relay's own landings
 * on this repository read `auto-merge off` while GitHub recorded
 * `added_to_merge_queue` in the same second — so the queue half is what lets
 * `PR_LANDED_STATE` judge that answer as landed. They are the fields
 * `gh pr merge` reads to take its merge-queue path, which it does under a
 * workflow token holding only `contents` and `pull-requests`. `mergeMethod`
 * is never judged: GitHub ignores it on a merge-queue branch (the input's
 * documentation) and the answer there names `MERGE` for a `SQUASH` request.
 */
const PR_MUTATIONS = Object.freeze({
  pr_ready: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
  pr_draft: 'mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
  automerge_enable: `mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: ${MERGE_METHOD} }) { pullRequest { number autoMergeRequest { enabledAt mergeMethod } isInMergeQueue isMergeQueueEnabled } } }`,
  automerge_disable: 'mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { number autoMergeRequest { enabledAt } isInMergeQueue isMergeQueueEnabled } } }',
});

const isObject = (v) => v !== null && typeof v === 'object';

/**
 * What LANDED means for each pull-request mutation: the state the answer's
 * `pullRequest` must show. A 200 carrying `data` and no `errors` says only
 * that GitHub accepted the request — `enablePullRequestAutoMerge` has answered
 * exactly that with `autoMergeRequest: null` on a pull it never armed nor
 * queued — so the executor judges every one of these rows against its entry
 * here and reports a FAILED action, naming what the answer showed, when the
 * state is not there. Each entry:
 *
 *   `wants`   the requested state, in the words the failure prints;
 *   `fields`  the `pullRequest` fields `holds` reads — each one must be in the
 *             row's selection set (`execute.mjs --self-test` pins it), since
 *             a field the query never asked for is absent, not false;
 *   `holds`   the predicate over the answer's `pullRequest`.
 *
 * `automerge_disable` asks for auto-merge off and nothing more: disabling does
 * not dequeue a queued pull, and its row prints `in the merge queue` when the
 * answer says so — failing there would stop a stroke's later `pr_draft`, the
 * second half of the disarm AGENTS.md prescribes.
 */
export const PR_LANDED_STATE = Object.freeze({
  pr_ready: Object.freeze({ wants: 'ready for review (isDraft false)', fields: Object.freeze(['isDraft']), holds: (pr) => pr.isDraft === false }),
  pr_draft: Object.freeze({ wants: 'a draft (isDraft true)', fields: Object.freeze(['isDraft']), holds: (pr) => pr.isDraft === true }),
  automerge_enable: Object.freeze({
    wants: 'auto-merge armed (an autoMergeRequest) or the pull in the merge queue (isInMergeQueue true)',
    fields: Object.freeze(['autoMergeRequest', 'isInMergeQueue']),
    holds: (pr) => isObject(pr.autoMergeRequest) || pr.isInMergeQueue === true,
  }),
  automerge_disable: Object.freeze({ wants: 'auto-merge off (autoMergeRequest null)', fields: Object.freeze(['autoMergeRequest']), holds: (pr) => pr.autoMergeRequest === null }),
});

/**
 * The transfer mutation. The executor resolves both node ids first —
 * `GET /repos/{repo}/issues/{n}` (refusing a pull request, or a card no longer
 * on `repo`) and `GET /repos/{target}` — then sends
 * `{ query, variables: { issueId, repositoryId } }`. `createLabelsIfMissing`
 * is deliberately absent: GitHub's default (false) drops a label the target
 * does not carry instead of creating it there.
 */
const TRANSFER_MUTATION = 'mutation($issueId: ID!, $repositoryId: ID!) { transferIssue(input: { issueId: $issueId, repositoryId: $repositoryId }) { issue { number url repository { nameWithOwner } } } }';

/**
 * What a seat reads when a transfer fails at the mint or at the mutation —
 * spelled once, printed by the executor's summary and by the door.
 */
export function transferRemedy(source, target) {
  return (
    `a transfer needs the fleet App installed on BOTH ${source} and ${target} with issues write on each: a failed mint, a target whose ` +
    `node id cannot be read, or "Resource not accessible by integration" / "Could not resolve to a Repository" on the mutation means ` +
    `the installation does not cover ${target} — the maintainer adds it to the objectstack-fleet App's repository access. ` +
    '⛔ Not rebuilt by hand meanwhile — an installation gap is a setting to fix, not a refusal; the rebuild recipe is for a target ' +
    'outside TRANSFER_TARGETS or a move GitHub refuses outright (another organization, a private card into a public repository).'
  );
}

/**
 * The closed op list. Each row:
 *   `permission`  the App permission the row spends (a key of `PERMISSIONS`);
 *   `required`    keys that must be present;
 *   `optional`    keys that may be; anything else on the action is refused;
 *   `atLeastOne`  (optional) of these keys, at least one must be present;
 *   `secondRepo`  (optional) the key naming a SECOND repository the token
 *                 must reach — `transfer`'s alone (header above);
 *   `alone`       (optional) true for a row whose stroke carries exactly that
 *                 one action — `workflow_dispatch`'s alone (header above);
 *   `requests`    the request descriptors the executor issues, in order:
 *                 `{ verb, path, body?, idempotent404?, graphql? }` — a
 *                 `graphql` descriptor names the mutation and the pull (or
 *                 the issue and target) whose node ids it needs; a pull's
 *                 descriptor also carries `landed`, its `PR_LANDED_STATE`
 *                 entry, which is how the executor tells a landing from a
 *                 bare 200.
 */
export const OPS = Object.freeze({
  comment: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'body']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'POST', path: `${issues(repo, a.issue)}/comments`, body: { body: a.body } }],
  }),
  comment_edit: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['comment_id', 'body']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'PATCH', path: `/repos/${repo}/issues/comments/${a.comment_id}`, body: { body: a.body } }],
  }),
  labels_add: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'labels']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'POST', path: `${issues(repo, a.issue)}/labels`, body: { labels: [...a.labels] } }],
  }),
  labels_remove: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'labels']),
    optional: Object.freeze([]),
    // One directed DELETE per name — the additive verb, never the whole-set
    // replace. A 404 here is the label already being gone: idempotent success.
    requests: (a, repo) => a.labels.map((name) => ({ verb: 'DELETE', path: `${issues(repo, a.issue)}/labels/${enc(name)}`, idempotent404: true })),
  }),
  assign: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'assignees']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'POST', path: `${issues(repo, a.issue)}/assignees`, body: { assignees: [...a.assignees] } }],
  }),
  unassign: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'assignees']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'DELETE', path: `${issues(repo, a.issue)}/assignees`, body: { assignees: [...a.assignees] } }],
  }),
  issue_patch: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue']),
    optional: Object.freeze(['title', 'body', 'state', 'state_reason']),
    atLeastOne: Object.freeze(['title', 'body', 'state', 'state_reason']),
    requests: (a, repo) => {
      const body = {};
      for (const k of ['title', 'body', 'state', 'state_reason']) if (k in a) body[k] = a[k];
      return [{ verb: 'PATCH', path: issues(repo, a.issue), body }];
    },
  }),
  issue_create: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['title', 'body']),
    optional: Object.freeze(['labels', 'assignees']),
    requests: (a, repo) => {
      const body = { title: a.title, body: a.body };
      if ('labels' in a) body.labels = [...a.labels];
      if ('assignees' in a) body.assignees = [...a.assignees];
      return [{ verb: 'POST', path: `/repos/${repo}/issues`, body }];
    },
  }),
  pr_create: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['title', 'head', 'base']),
    optional: Object.freeze(['body']),
    // `draft: true` is FORCED — a seat cannot open a ready PR through the relay.
    requests: (a, repo) => [{ verb: 'POST', path: `/repos/${repo}/pulls`, body: { title: a.title, head: a.head, base: a.base, ...('body' in a ? { body: a.body } : {}), draft: true } }],
  }),
  pr_request_reviewers: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze(['reviewers', 'team_reviewers']),
    atLeastOne: Object.freeze(['reviewers', 'team_reviewers']),
    requests: (a, repo) => {
      const body = {};
      if ('reviewers' in a) body.reviewers = [...a.reviewers];
      if ('team_reviewers' in a) body.team_reviewers = [...a.team_reviewers];
      return [{ verb: 'POST', path: `${pulls(repo, a.pull)}/requested_reviewers`, body }];
    },
  }),
  pr_ready: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'markPullRequestReadyForReview', query: PR_MUTATIONS.pr_ready, pull: a.pull, landed: PR_LANDED_STATE.pr_ready } }],
  }),
  pr_draft: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'convertPullRequestToDraft', query: PR_MUTATIONS.pr_draft, pull: a.pull, landed: PR_LANDED_STATE.pr_draft } }],
  }),
  // The two auto-merge mutations spend `contents` — GitHub requires `contents: write`
  // on the token for enable/disablePullRequestAutoMerge, over and above `pull-requests`.
  automerge_enable: Object.freeze({
    permission: 'contents',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'enablePullRequestAutoMerge', query: PR_MUTATIONS.automerge_enable, pull: a.pull, landed: PR_LANDED_STATE.automerge_enable } }],
  }),
  automerge_disable: Object.freeze({
    permission: 'contents',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'disablePullRequestAutoMerge', query: PR_MUTATIONS.automerge_disable, pull: a.pull, landed: PR_LANDED_STATE.automerge_disable } }],
  }),
  // The one row whose token reaches a second repository — see the header.
  // `issue`, never `pull`: a pull request does not transfer.
  transfer: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'target_repo']),
    optional: Object.freeze([]),
    secondRepo: 'target_repo',
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'transferIssue', query: TRANSFER_MUTATION, issue: a.issue, target_repo: a.target_repo } }],
  }),
  // The one row whose token carries `actions: write`, minted for a stroke carrying this op alone — see the header.
  // `workflow` and `ref` are closed enums; the body carries no `inputs` (the allowlisted workflow declares none).
  workflow_dispatch: Object.freeze({
    permission: 'actions',
    required: Object.freeze(['workflow', 'ref']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'POST', path: `/repos/${repo}/actions/workflows/${enc(a.workflow)}/dispatches`, body: { ref: a.ref } }],
  }),
});

export const OP_NAMES = Object.freeze(Object.keys(OPS));

/**
 * The families no row may ever reach — pinned by `validate.mjs --self-test`
 * over every path every op can spell. A future row that reaches one reds
 * there, which is what "refused by construction" means mechanically.
 */
export const REFUSED_PATH_FAMILIES = Object.freeze([
  /\/merge$/,
  /\/pulls\/[^/]+\/reviews/,
  /\/git\//,
  /\/branches\//,
  /\/contents\//,
  // Every `actions/*` path but the one dispatch call (`WORKFLOW_DISPATCH_PATH_SHAPE`), then the run,
  // job, cache, artifact, secret / variable / runner and workflow enable / disable endpoints
  // `actions: write` would otherwise reach, each named — a loosened catch-all still reds on them.
  /\/actions\/(?!workflows\/[^/]+\/dispatches$)/,
  /\/actions\/runs\//,
  /\/actions\/jobs\//,
  /\/actions\/caches/,
  /\/actions\/artifacts/,
  /\/actions\/workflows\/[^/]+\/(enable|disable)$/,
  /\/actions\/(secrets|variables|permissions|runners|oidc)/,
  /\/releases/,
  /^\/orgs\//,
  /^\/admin\//,
  /\/collaborators\//,
  /\/keys/,
  /\/hooks/,
]);

/** The GraphQL mutations the table may name — anything else in a `graphql` descriptor is a bug this pins. */
export const ALLOWED_MUTATIONS = Object.freeze(['markPullRequestReadyForReview', 'convertPullRequestToDraft', 'enablePullRequestAutoMerge', 'disablePullRequestAutoMerge', 'transferIssue']);
