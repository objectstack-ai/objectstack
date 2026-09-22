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
 * submission, a branch or ref write, a contents or workflow write, a release,
 * or any organization / administration endpoint, so a payload naming one is
 * refused at the validator with zero writes — the `--self-test` of
 * `validate.mjs` pins that every path spelled here stays clear of those
 * families and that no row issues a whole-set `PUT`.
 *
 * ## The permissions the relay's token is narrowed to
 *
 * Read from GitHub's own permission ledger for server-to-server tokens
 * (`github/docs`, `src/github-apps/data/fpt-2022-11-28/server-to-server-permissions.json`):
 * every `/issues/**` write here is `issues: write`; `/pulls/**` and the
 * pull-request GraphQL mutations are `pull-requests: write`; the sender gate's
 * `GET /repos/{o}/{r}/collaborators/{login}/permission` is `metadata: read`.
 * `PERMISSIONS` is that set and nothing wider; the workflow declares exactly it
 * on `actions/create-github-app-token`.
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

/** The seat-side transport selector and its three values. */
export const TRANSPORT_ENV = 'OS_FLEET_TRANSPORT';
export const TRANSPORTS = Object.freeze(['direct', 'dispatch', 'auto']);

/** The session id a dispatch carries; a seat sets it to its own `session_…`. */
export const SESSION_ENV = 'OS_FLEET_SESSION';

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
});

/** The App permissions the relay token is narrowed to — the union of every row's `permission`, plus the sender gate's read. */
export const PERMISSIONS = Object.freeze({ issues: 'write', 'pull-requests': 'write', metadata: 'read' });

const issues = (repo, n) => `/repos/${repo}/issues/${n}`;
const pulls = (repo, n) => `/repos/${repo}/pulls/${n}`;
const enc = (s) => encodeURIComponent(s);

/**
 * A GraphQL mutation on a pull request, keyed by the op. The executor resolves
 * the pull's node id with `GET /repos/{repo}/pulls/{n}` and sends
 * `POST /graphql` with `{ query, variables: { id } }`.
 */
const PR_MUTATIONS = Object.freeze({
  pr_ready: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
  pr_draft: 'mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
  automerge_enable: `mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: ${MERGE_METHOD} }) { pullRequest { number autoMergeRequest { enabledAt mergeMethod } } } }`,
  automerge_disable: 'mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { number autoMergeRequest { enabledAt } } } }',
});

/**
 * The closed op list. Each row:
 *   `permission`  the App permission the row spends (a key of `PERMISSIONS`);
 *   `required`    keys that must be present;
 *   `optional`    keys that may be; anything else on the action is refused;
 *   `atLeastOne`  (optional) of these keys, at least one must be present;
 *   `requests`    the request descriptors the executor issues, in order:
 *                 `{ verb, path, body?, idempotent404?, graphql? }` — a
 *                 `graphql` descriptor names the mutation and the pull whose
 *                 node id it needs.
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
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'markPullRequestReadyForReview', query: PR_MUTATIONS.pr_ready, pull: a.pull } }],
  }),
  pr_draft: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'convertPullRequestToDraft', query: PR_MUTATIONS.pr_draft, pull: a.pull } }],
  }),
  automerge_enable: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'enablePullRequestAutoMerge', query: PR_MUTATIONS.automerge_enable, pull: a.pull } }],
  }),
  automerge_disable: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    requests: (a) => [{ verb: 'POST', path: '/graphql', graphql: { mutation: 'disablePullRequestAutoMerge', query: PR_MUTATIONS.automerge_disable, pull: a.pull } }],
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
  /\/actions\/workflows/,
  /\/releases/,
  /^\/orgs\//,
  /^\/admin\//,
  /\/collaborators\//,
  /\/keys/,
  /\/hooks/,
]);

/** The GraphQL mutations the table may name — anything else in a `graphql` descriptor is a bug this pins. */
export const ALLOWED_MUTATIONS = Object.freeze(['markPullRequestReadyForReview', 'convertPullRequestToDraft', 'enablePullRequestAutoMerge', 'disablePullRequestAutoMerge']);
