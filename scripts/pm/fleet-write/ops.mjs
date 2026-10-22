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
 * An op is only what this table names. There is no row for a merge of a pull,
 * a review submission, a direct branch or ref write (`/git/**`, `/branches/**`,
 * `/contents/**`), a workflow-file write, a run cancel or delete, a whole-run
 * or single-job re-run, a cache or artifact write, a release, or any
 * organization / administration endpoint, so a payload naming one is refused
 * at the validator with zero writes — the `--self-test` of `validate.mjs` pins
 * that every path spelled here stays clear of those families and that the
 * table's one `PUT` (`pr_update_branch`, below) reaches no whole-set replace
 * of labels or assignees. The one re-run the table has re-runs a run's FAILED
 * jobs alone, once, on a closed list of workflows (`run_rerun_failed`, below).
 *
 * ## The one row that moves a branch — `pr_update_branch`
 *
 * `PUT /repos/{o}/{r}/pulls/{n}/update-branch` is GitHub's own base sync: the
 * PLATFORM merges the pull's base into its head and authors that merge commit
 * as the identity that asked — through the relay, `objectstack-fleet[bot]`;
 * as bare REST under a seat's session token, the seat's personal account, the
 * identity exchange every other relay write already refuses. The relay sends
 * no ref write of its own. GitHub's permission ledger (the file cited below)
 * lists the endpoint under `pull_requests: write`, server-to-server, with no
 * additional permission, so the row spends `pull-requests` and the mint step
 * widens nothing. `expected_head_sha` is REQUIRED and full-length (`FIELDS`,
 * kind `sha`): a short or malformed sha is refused by the validator before the
 * dispatch, never left to the platform's 422; a stale one IS the platform's
 * 422. How the executor tells that 422 from the "nothing to merge" one, and
 * how it confirms a 202, is `execute.mjs`'s (`confirmUpdateBranch`).
 *
 * ## The rows whose LATER requests read the FIRST's answer — `pr_create` with `assignees` or `labels`
 *
 * A pull request's assignees and labels are written on its issue endpoints,
 * `POST /repos/{o}/{r}/issues/{n}/assignees` and `POST /repos/{o}/{r}/issues/{n}/labels`,
 * and `{n}` exists only once the create has answered. So a `pr_create`
 * carrying `assignees` or `labels` is TWO or THREE requests in one action:
 * the draft create, then the assignee POST, then the label POST — each later
 * leg's path spelled with the placeholder `answerPlaceholder('number')` and
 * carrying `fromAnswer: 'number'`. The executor fills the placeholder from
 * the CREATE's answer, the action's first (a positive integer at that field;
 * ⛔ never from the request, never from a later leg's answer) and refuses to
 * send the leg at all when that answer carries none, a FAILED action that
 * says the leg was NOT SENT. Each leg also carries what its answer must
 * list: `assigned`, the logins — GitHub's documentation of the endpoint says
 * an assignee the caller cannot apply is "silently ignored", with the 201
 * still answered; `labelled`, the names — the labels endpoint answers the
 * pull's whole label set, so a name sent and not listed is a write that did
 * not land. Either way a 2xx whose answer lacks one sent is a FAILED action
 * naming it, never a quiet partial. Both legs are `issues: write`
 * (`alsoSpends`), a grant every stroke's token carries as a literal mint
 * input, so the row stays `pull-requests` and the mint widens nothing. Why
 * the assignee and the label ride the create's stroke rather than a second
 * write: a seat's second write is a second permission verdict in its own
 * session, measured to vary on an identical command, and both are part of
 * opening the pull, not a later act — a dev's `skip-changeset` is a
 * declaration about the diff the pull opens with. `validate.mjs --self-test`
 * pins that these are the TWO descriptors carrying `fromAnswer` and that
 * neither is the first request of its action; `execute.mjs --self-test` pins
 * the fill, the refusal to send and the landing.
 *
 * ## The governed-review follow-up — `pr_create` and `pr_ready` on a Tier H diff
 *
 * A Tier H governed surface (`GOVERNED_SURFACES` rows with tier `H` in
 * `check-governed-merges.mjs`: `docs/adr/**`, `skills/**`, `AGENTS.md`,
 * `CLAUDE.md`, `docs/NORTH-STAR.md`, `.github/workflows/**`) lands only on an
 * APPROVED review by an account in `GOVERNED_APPROVERS`
 * (`check-governed-queue-guard.mjs`, the ONE list of those accounts). The
 * platform summons a code owner only when a pull is opened READY or marked
 * ready for review — measured on this repository's own Tier H pulls, the
 * CODEOWNERS request arrived at `ready_for_review` and never at the draft
 * create — and every relay `pr_create` is a draft (forced above), held draft
 * until that approval. So without this follow-up a seat-driven Tier H pull
 * waits on an approver nobody told. The rows `pr_create` and `pr_ready`
 * therefore carry `governedReview: true`, and the executor, once the row's own
 * requests have landed, reads the pull's file list in full
 * (`GOVERNED_REVIEW_FILES_PAGE_SIZE` per page, at most
 * `GOVERNED_REVIEW_FILES_PAGE_CAP` pages — the endpoint's own ceiling; a walk
 * that would need more is a truncated SUBSET and a FAILED action, never a
 * quiet "not governed"), asks the register (`governedPathsIn` +
 * `landingTierOf`, scoped to `payload.repo` through `repoIdForSlug`) and, on a
 * Tier H hit, sends what `governedReviewRequests` spells: ONE
 * `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers` naming every
 * `GOVERNED_APPROVERS` account not already requested, assigned or holding a
 * submitted review (the union the H43 patrol reads as covered — so a re-run,
 * a `pr_ready` after a `pr_create`, or the platform's own CODEOWNERS request
 * landing first costs zero writes), and — because GitHub answers 422 to a
 * request naming the pull's own author — ONE
 * `POST /repos/{o}/{r}/issues/{n}/assignees` for the author when the author is
 * itself a missing approver. Each answer is judged as the legs above are:
 * `requested` against the pull's pending requests, `assigned` against its
 * assignees; a 2xx lacking a login sent is a FAILED action naming it. A Tier
 * S diff (`.claude/**` alone — it lands on a seat's review of record) and an
 * ungoverned diff send nothing, and the row says which. The reads are unpaced
 * GETs; the writes are paced like every other write verb and are outside the
 * rule ⑤ count (`strokePacing` counts a stroke's spelled requests; these two
 * are conditional and at most two per pull). Both rows spend `issues: write`
 * for the assignee fallback (`alsoSpends`), a literal grant on every stroke.
 * `execute.mjs --self-test` pins the plan, the writes and both refusals;
 * `validate.mjs --self-test` pins the two rows and the two endpoints against
 * the refused families. ⛔ This is an ACTION, not a judge: no gate, check-run
 * or patrol row is added by it — the H43 row in `check-half-states.mjs` keeps
 * reading the gap it closes.
 *
 * ## The permissions the relay's token is narrowed to
 *
 * Read from GitHub's own permission ledger for server-to-server tokens
 * (`github/docs`, `src/github-apps/data/fpt-2022-11-28/server-to-server-permissions.json`):
 * every `/issues/**` write here is `issues: write` — `pr_create`'s assignees
 * and labels legs and the governed-review follow-up's assignee fallback on
 * `pr_create` and `pr_ready` spend it as `alsoSpends`; `/pulls/**` and the
 * ready / draft GraphQL mutations are `pull-requests: write`; the two
 * auto-merge mutations (`enablePullRequestAutoMerge` /
 * `disablePullRequestAutoMerge`) additionally require `contents: write` —
 * measured on the first live use, where a token without it answered
 * "Resource not accessible by integration" — and those two rows are the ONLY
 * spenders of it: the table has no contents op (no direct file, ref or branch
 * write; `pr_update_branch` is the platform's own merge, `pull_requests: write`
 * in that ledger); arming auto-merge on a pull that changes
 * `.github/workflows/**` also requires `workflows: write` — measured: the
 * relay's `automerge_enable` on such a pull answered "refusing to allow a
 * GitHub App to create or update workflow … without `workflows` permission" —
 * so that row spends it (`alsoSpends`), the one row that does; it is a
 * literal grant on every stroke, and a seat may enqueue a pull that changes a
 * workflow file. The human floor of pm-dispatch `SKILL.md` (security and
 * permission boundaries stay a human's) is lowered for this ONE boundary by
 * the maintainer's own ruling, comment 6104822731 (「22708 A」), so this grant
 * is not a drift. The grant also reaches workflow-file writes through
 * `/contents/**` and `/git/**`; `REFUSED_PATH_FAMILIES` refuses both for every
 * row. The workflow-run dispatch (`workflow_dispatch`) and the failed-jobs
 * re-run (`run_rerun_failed`), both below, are `actions: write`, the two rows
 * spending it; the sender gate's
 * `GET /repos/{o}/{r}/collaborators/{login}/permission` is `metadata: read`.
 * `PERMISSIONS` is that set and nothing wider. The workflow declares the five
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
 * artifact, secret and variable endpoints. So the row is fenced five ways:
 * `workflow` is a closed enum — `WORKFLOW_DISPATCH_ALLOWLIST`, one file name
 * per entry, matched whole, joined only by a PR that adds the entry here and
 * never at request time; its `inputs` are closed per file (below); `ref` is a
 * closed enum of exactly `WORKFLOW_DISPATCH_REF`; a stroke carrying this op
 * carries exactly that one action (`alone`), so the wider token serves one
 * request and nothing beside it; and the grant is minted only for such a
 * stroke — the validator writes `permission_actions=write` for it and an empty
 * value for every other stroke, and the mint action skips an empty
 * `permission-*` input, so every other stroke's token is what it was before
 * this row. `REFUSED_PATH_FAMILIES` refuses every other `actions/*` path, and
 * `validate.mjs --self-test` pins that the dispatch call and
 * `run_rerun_failed`'s re-run call (below) are the only two the table reaches.
 * The dispatch answers 204 with no body, so the run it starts
 * is read back by the SEAT (`dispatch.mjs`): the newest `workflow_dispatch`
 * run of that file created since the dispatch.
 *
 * ## The second row whose token carries `actions: write` — `run_rerun_failed`
 *
 * `POST /repos/{repo}/actions/runs/{run_id}/rerun-failed-jobs` starts a new
 * ATTEMPT of a completed run in which the jobs that failed, and the jobs that
 * need them, run again, and the jobs that passed are carried over as they
 * were. Measured on run 39713789453's attempt 2: the passed jobs were listed
 * in it at once as `completed`, keeping attempt 1's start times; the failed
 * shard was listed at once and started two seconds later; and the aggregate
 * job that needs every shard was listed only when its need finished, 16
 * minutes later. It spends the `actions: write` `workflow_dispatch` spends, so
 * it is fenced the same way. These are the six fences:
 *
 *   - the WORKFLOW: the run's `path` is one of `RERUN_FAILED_WORKFLOWS`, a
 *     closed list matched whole and joined only by a PR that adds the path
 *     here — never a request-time input, since the payload carries no key
 *     that names a workflow;
 *   - the EVENT: the run's `event` is `pull_request` — a push, merge-group,
 *     schedule, release or `workflow_dispatch` run is refused;
 *   - ONCE: the run's `run_attempt` is 1. A second failure is real, and a
 *     re-send after a landing meets attempt 2 here and is refused;
 *   - FAILED: the run is `completed` with `conclusion` `failure`;
 *   - ALONE: a stroke carrying it carries exactly that one action (`alone`),
 *     so the wider token serves one request;
 *   - the GRANT: `actions: write` is minted for that stroke alone, through the
 *     `STROKE_SCOPED_PERMISSIONS` output `workflow_dispatch` already uses — the
 *     validator writes `permission_actions=write` for either op's stroke and an
 *     empty value for every other, so the workflow names neither op.
 *
 * The payload is `run_id` and nothing else: no workflow, attempt, job or
 * debug-logging key exists for it, and the POST carries no body. The first
 * four fences are facts about the RUN, not the request, so the EXECUTOR judges
 * them (`RERUN_FAILED_FENCES`) on `GET /repos/{repo}/actions/runs/{run_id}`,
 * read immediately before the POST. A run that changed between the seat's
 * request and the relay's run, for example re-run by a person meanwhile, is
 * refused THERE with zero writes. The seat's wrapper
 * (`scripts/pm/rerun-failed.mjs`) reads the same four before it dispatches.
 * That is an early refusal naming the fence that fails, and it never replaces
 * the executor's.
 *
 * The 201 the POST answers is an acceptance, not a landing. The executor reads
 * the run again until it shows `run_attempt` 2, then that attempt's job list,
 * and the action LANDS only on what `rerunFailedReadBack` judges there. Every
 * job that concluded `failure` in attempt 1 and is listed in attempt 2 must be
 * `queued` or `in_progress`, and at least one must be. A failed job not yet
 * listed is NAMED, not failed: a job is created when its needs finish
 * (measured above). A read-back that never sees attempt 2 inside its window is
 * a FAILED action, never a success. `REFUSED_PATH_FAMILIES` carves out exactly
 * `runs/{digits}/rerun-failed-jobs`; the whole-run `rerun`, a job's `rerun`,
 * cancel, delete, logs, caches, artifacts, secrets and variables all stay
 * refused, and `validate.mjs --self-test` pins each.
 *
 * ## A workflow's inputs are CLOSED per file — `WORKFLOW_DISPATCH_INPUTS`
 *
 * An input picks which of a workflow's lanes the run takes, so the inputs are
 * part of the allowlist, never a value a seat chooses: each allowlisted file
 * carries its ONE inputs object beside its name, and a file joins the list by
 * the PR that spells both here. `null` is a workflow that declares no inputs —
 * the platform refuses inputs on such a workflow, so an action naming it
 * carries no `inputs` key. An object is the exact `inputs` an action naming
 * that file must carry: every key, every value, nothing beside it — a missing
 * key, another value or any other key is refused by name with zero writes.
 * The seat SPELLS the inputs rather than having them filled in, so a payload
 * says which lane it starts and a stroke that does not say so is refused; the
 * request body is built from this table, never from the action, so what
 * leaves is this spelling even where the two would differ.
 *
 * `release.yml` is on the list for its bookkeeping lane alone (the maintainer's
 * ruling, comment 6139629628, item 5: a seat refreshes the Version Packages PR
 * through the relay after each fix lands on `main`). Its entry is
 * `{ refresh_version_pr: true }`: the `version-pr` job runs on a dispatch
 * carrying it, and `release-integrity`, `stale-prompts`, `full-battery` and
 * `publish` refuse such a dispatch in their own `if:` (`docker` runs only on a
 * publish `release-integrity` or `publish` reports). `force` is not in the
 * entry and `refresh_version_pr: false` is not its value, so the
 * publish-repair lane — a dispatch WITHOUT `refresh_version_pr` — is
 * unreachable from the relay. `validate.mjs --self-test` reads the workflow
 * from disk: it pins every input here declared there, and evaluates every
 * job's `if:` for the relay's dispatch, so a guard edited there, or a job
 * added there, that the dispatch would start reds that self-test.
 *
 * On the wire every value is a STRING (`dispatchInputsOnTheWire`): `"true"`
 * is the spelling measured to start the bookkeeping lane alone (runs
 * 38351525685 and 38357219168, each answering `Version PR maintenance` success
 * and the other five jobs skipped). A JSON boolean on that endpoint is not
 * measured, so it is never sent.
 *
 * ## The one row whose token reaches a SECOND repository — `transfer`
 *
 * GitHub's `transferIssue` mutation (GraphQL only; REST has no transfer
 * endpoint) needs `issues: write` on the repository the card is in AND on the
 * one it moves to, so a transfer stroke's token is minted for both. That is
 * the only widening of the token's repository reach the relay makes (the one
 * per-stroke widening of its permissions is the `actions` grant of
 * `workflow_dispatch` and `run_rerun_failed`, above), and it is fenced four ways: the target is
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
 * The workflow files a `workflow_dispatch` may start, each with the ONE inputs
 * object an action naming it carries (header: "A workflow's inputs are CLOSED
 * per file"). `null`: the workflow declares no inputs, and the action carries
 * no `inputs` key. An object: the action's `inputs`, spelled exactly.
 * `validate.mjs --self-test` pins every key here to an input the file declares
 * under its `workflow_dispatch` trigger, with the type the value has.
 */
export const WORKFLOW_DISPATCH_INPUTS = Object.freeze({
  'shard-timings-refresh.yml': null,
  // The bookkeeping lane alone — never `force`, never `refresh_version_pr: false` (the publish-repair lane).
  'release.yml': Object.freeze({ refresh_version_pr: true }),
});
/**
 * The workflow files a `workflow_dispatch` may start — one file name per
 * entry, matched whole (never a path, never a glob), joined only by a PR that
 * adds the entry, with its inputs, to `WORKFLOW_DISPATCH_INPUTS` above.
 * `validate.mjs --self-test` pins that every entry is a file under
 * `.github/workflows/` declaring a `workflow_dispatch` trigger.
 */
export const WORKFLOW_DISPATCH_ALLOWLIST = Object.freeze(Object.keys(WORKFLOW_DISPATCH_INPUTS));
/**
 * The `inputs` object the dispatch request sends for a closed entry — every
 * value as a string, the spelling measured on the dispatch endpoint (header).
 * Pure; `null` for an entry that declares none.
 */
export function dispatchInputsOnTheWire(declared) {
  if (declared === null || declared === undefined) return null;
  return Object.fromEntries(Object.entries(declared).map(([name, value]) => [name, String(value)]));
}
/** The one ref a `workflow_dispatch` may start a run at. ⛔ Never a free string. */
export const WORKFLOW_DISPATCH_REF = 'main';
/** The shape of the dispatch call — one of the two `actions/*` paths the table reaches. */
export const WORKFLOW_DISPATCH_PATH_SHAPE = /\/actions\/workflows\/[^/]+\/dispatches$/;

/**
 * The workflows a `run_rerun_failed` may re-run the failed jobs of — the run's
 * own `path`, as `GET /actions/runs/{id}` answers it, matched WHOLE (measured
 * on run 39713789453: `.github/workflows/ci.yml`, no ref suffix). Joined only
 * by a PR that adds the path here; ⛔ never a key of the payload.
 * `validate.mjs --self-test` pins every entry to a workflow on disk that runs
 * on `pull_request`.
 */
export const RERUN_FAILED_WORKFLOWS = Object.freeze(['.github/workflows/ci.yml']);
/** The one event whose run a `run_rerun_failed` may re-run: a pull request's. */
export const RERUN_FAILED_EVENT = 'pull_request';
/** The one attempt it may re-run — once: a second failure is real. The read-back wants the attempt after it. */
export const RERUN_FAILED_ATTEMPT = 1;
/** The state the run must be in: completed, and failed. */
export const RERUN_FAILED_STATUS = 'completed';
export const RERUN_FAILED_CONCLUSION = 'failure';
/** The job states the read-back accepts for a job attempt 1 failed — the ruling's two, nothing beside them. */
export const RERUN_FAILED_RERUN_STATES = Object.freeze(['queued', 'in_progress']);
/** The shape of the re-run call — the other `actions/*` path the table reaches; the run id is digits alone. */
export const RERUN_FAILED_PATH_SHAPE = /\/actions\/runs\/\d+\/rerun-failed-jobs$/;

/**
 * The four fences on the RUN (the header's `run_rerun_failed` section), each
 * judged on the run's own answer: `fence` its name, `wants` what the relay
 * re-runs, `reads` the field(s) the failure sentence quotes, `holds` the
 * predicate. The other two fences — alone in its stroke, the stroke-scoped
 * grant — are the validator's. The executor judges these on the read taken
 * immediately before the POST; the seat's wrapper judges them earlier, as an
 * advisory refusal.
 */
export const RERUN_FAILED_FENCES = Object.freeze([
  Object.freeze({
    fence: 'workflow',
    wants: `a run whose path is one of ${RERUN_FAILED_WORKFLOWS.join(', ')} — a closed list, matched whole`,
    reads: (run) => run?.path,
    holds: (run) => typeof run?.path === 'string' && RERUN_FAILED_WORKFLOWS.includes(run.path),
  }),
  Object.freeze({
    fence: 'event',
    wants: `a ${RERUN_FAILED_EVENT} run — never a push, merge_group, schedule, release or workflow_dispatch one`,
    reads: (run) => run?.event,
    holds: (run) => run?.event === RERUN_FAILED_EVENT,
  }),
  Object.freeze({
    fence: 'once',
    wants: `run_attempt ${RERUN_FAILED_ATTEMPT} — a run is re-run at most once, and a second failure is real`,
    reads: (run) => run?.run_attempt,
    holds: (run) => run?.run_attempt === RERUN_FAILED_ATTEMPT,
  }),
  Object.freeze({
    fence: 'failed',
    wants: `status ${RERUN_FAILED_STATUS} with conclusion ${RERUN_FAILED_CONCLUSION}`,
    reads: (run) => `status ${run?.status ?? null}, conclusion ${run?.conclusion ?? null}`,
    holds: (run) => run?.status === RERUN_FAILED_STATUS && run?.conclusion === RERUN_FAILED_CONCLUSION,
  }),
]);

/** The fences a run's answer fails: `[{ fence, wants, got }]`, in `RERUN_FAILED_FENCES` order; `[]` when all four hold. Pure. */
export function rerunFailedFenceFailures(run) {
  return RERUN_FAILED_FENCES.filter((f) => !f.holds(run)).map((f) => ({ fence: f.fence, wants: f.wants, got: f.reads(run) ?? null }));
}

/** The sentence a fence refusal prints — every failing fence by name, what the run read and what the relay re-runs. Pure. */
export function rerunFailedFenceText(failures) {
  return failures.map((f) => `fence \`${f.fence}\`: the run reads ${JSON.stringify(f.got)}, and the relay re-runs only ${f.wants}`).join('; ');
}

/** The names of the jobs that concluded `failure` in one attempt's job list — the jobs the read-back looks for. Pure. */
export function failedJobNames(jobs) {
  const out = [];
  for (const j of Array.isArray(jobs) ? jobs : []) {
    if (j?.conclusion === RERUN_FAILED_CONCLUSION && typeof j.name === 'string' && !out.includes(j.name)) out.push(j.name);
  }
  return out;
}

/**
 * What LANDED means for a `run_rerun_failed` (the header's section): `failed`
 * the job names attempt 1 failed, `run` the run read again after the POST,
 * `jobs` its attempt-2 job list. Answers `{ ok, pending, attempt, rerun,
 * notListed, other, why }`:
 *
 *   rerun      `[{ name, id, status }]` — each failed job listed in attempt 2 `queued` or `in_progress`;
 *   notListed  the failed names attempt 2 does not list yet — NAMED, never failed: a job is created when
 *              its needs finish (measured, header), so an aggregate job behind a re-running shard is absent;
 *   other      `[{ name, id, status, conclusion }]` — a failed job listed in any other state;
 *   ok         attempt 2, at least one `rerun`, and no `other`;
 *   pending    not landed YET — attempt 2 not seen, nothing re-running listed, or a job still in a pre-queue
 *              state (`waiting`, `requested`, `pending`) — the executor re-reads inside its window;
 *   neither    a FAILED action: a failed job listed `completed` in attempt 2 was not re-run as asked.
 *
 * Pure.
 */
export function rerunFailedReadBack({ failed = [], run = null, jobs = [] } = {}) {
  const want = RERUN_FAILED_ATTEMPT + 1;
  const attempt = run?.run_attempt ?? null;
  if (attempt !== want) {
    return { ok: false, pending: true, attempt, rerun: [], notListed: [...failed], other: [], why: `the run reads run_attempt ${JSON.stringify(attempt)}, not ${want} — the re-run has not shown as a new attempt` };
  }
  const listed = (Array.isArray(jobs) ? jobs : []).filter((j) => j && typeof j.name === 'string' && (j.run_attempt === undefined || j.run_attempt === want));
  const rerun = [];
  const notListed = [];
  const other = [];
  for (const name of failed) {
    const named = listed.filter((j) => j.name === name);
    if (named.length === 0) {
      notListed.push(name);
      continue;
    }
    const live = named.find((j) => RERUN_FAILED_RERUN_STATES.includes(j.status));
    if (live) rerun.push({ name, id: live.id ?? null, status: live.status });
    else other.push({ name, id: named[0].id ?? null, status: named[0].status ?? null, conclusion: named[0].conclusion ?? null });
  }
  const settled = other.filter((j) => j.status === RERUN_FAILED_STATUS);
  if (settled.length) {
    return { ok: false, pending: false, attempt, rerun, notListed, other, why: `attempt ${want} lists ${settled.map((j) => `\`${j.name}\` (job ${j.id}) ${j.status}${j.conclusion ? ` ${j.conclusion}` : ''}`).join(', ')} — a job attempt ${RERUN_FAILED_ATTEMPT} failed, not ${RERUN_FAILED_RERUN_STATES.join(' or ')}, so it was not re-run as asked` };
  }
  if (other.length) return { ok: false, pending: true, attempt, rerun, notListed, other, why: `attempt ${want} lists ${other.map((j) => `\`${j.name}\` (job ${j.id}) ${j.status}`).join(', ')} — not ${RERUN_FAILED_RERUN_STATES.join(' or ')} yet` };
  if (rerun.length === 0) return { ok: false, pending: true, attempt, rerun, notListed, other, why: `attempt ${want} lists none of the ${failed.length} job(s) attempt ${RERUN_FAILED_ATTEMPT} failed yet` };
  return { ok: true, pending: false, attempt, rerun, notListed, other, why: '' };
}

/** The read-back line a landing prints: the new attempt and its job ids, then what is not listed yet. Pure. */
export function rerunFailedLandedText(v) {
  const jobs = v.rerun.map((j) => `\`${j.name}\` job ${j.id} ${j.status}`).join(', ');
  const later = v.notListed.length ? ` · not listed yet: ${v.notListed.map((n) => `\`${n}\``).join(', ')} (a job is listed when its needs finish)` : '';
  return `attempt ${v.attempt} · re-run: ${jobs}${later}`;
}

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
/** A full commit sha, as GitHub spells one — the only shape `expected_head_sha` takes. */
export const SHA_SHAPE = /^[0-9a-f]{40}$/;
/** The container variable's shape; group 1 is the tail `session_` is prefixed to. */
export const CONTAINER_SESSION_SHAPE = /^cse_([A-Za-z0-9]{6,})$/;
export const TARGET_REPO_SHAPE = new RegExp(`^${TARGET_OWNER}/[A-Za-z0-9_.-]+$`);

/**
 * The typed vocabulary. `kind` is one of:
 *   `int`   a positive integer (never a numeric string);
 *   `str`   a non-empty string of at most `max` UTF-8 bytes;
 *   `list`  an array of 1..`max` non-empty strings, each at most `itemMax` bytes;
 *   `enum`  one of `values`;
 *   `sha`   a full commit sha — exactly 40 lowercase hex characters, never a
 *           short one (that is refused here, not by the platform's 422);
 *   `inputs` a JSON object naming at least one input, each value a JSON
 *           boolean (the one type an allowlisted input has) — its keys and
 *           values are then judged against the row's `closedInputs` entry.
 */
export const FIELDS = Object.freeze({
  issue: Object.freeze({ kind: 'int' }),
  pull: Object.freeze({ kind: 'int' }),
  comment_id: Object.freeze({ kind: 'int' }),
  body: Object.freeze({ kind: 'str', max: MAX_BODY_BYTES }),
  title: Object.freeze({ kind: 'str', max: MAX_TITLE_BYTES }),
  head: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  base: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  expected_head_sha: Object.freeze({ kind: 'sha' }),
  labels: Object.freeze({ kind: 'list', max: MAX_LABELS_PER_ACTION, itemMax: MAX_LABEL_BYTES }),
  assignees: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  reviewers: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  team_reviewers: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS }),
  state: Object.freeze({ kind: 'enum', values: Object.freeze(['open', 'closed']) }),
  state_reason: Object.freeze({ kind: 'enum', values: Object.freeze(['completed', 'not_planned', 'duplicate', 'reopened']) }),
  target_repo: Object.freeze({ kind: 'enum', values: TRANSFER_TARGETS }),
  run_id: Object.freeze({ kind: 'int' }),
  workflow: Object.freeze({ kind: 'enum', values: WORKFLOW_DISPATCH_ALLOWLIST }),
  ref: Object.freeze({ kind: 'enum', values: Object.freeze([WORKFLOW_DISPATCH_REF]) }),
  inputs: Object.freeze({ kind: 'inputs' }),
});

/**
 * The App permissions the relay token is narrowed to — the union of every
 * row's `permission` and `alsoSpends`, plus the sender gate's read.
 * `contents: write` is spent by the two auto-merge rows alone (GitHub's
 * requirement for those mutations); no row writes a file, a ref or a branch
 * itself — `pr_update_branch`'s merge is the platform's, under
 * `pull-requests`. `workflows: write` is spent by the `automerge_enable` row
 * alone (`alsoSpends`: a pull changing `.github/workflows/**` is enqueued only
 * by a token carrying it), a literal grant on every stroke by the
 * maintainer's ruling, comment 6104822731 (header). `actions: write` is spent
 * by the `workflow_dispatch` and `run_rerun_failed` rows alone, and minted
 * only for a stroke carrying one of them (`STROKE_SCOPED_PERMISSIONS`).
 */
export const PERMISSIONS = Object.freeze({ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write' });

/**
 * The permissions minted ONLY for a stroke carrying an op that spends them —
 * `actions: write`, the `workflow_dispatch` and `run_rerun_failed` rows'
 * alone, each of which travels alone in its stroke. `validate.mjs`
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
 * The placeholder a `fromAnswer` descriptor's path carries for the field the
 * executor fills from the previous request's answer (header) — spelled here
 * once, read by the table below and by `execute.mjs`'s `fillFromAnswer`.
 */
export const answerPlaceholder = (field) => `{${field}}`;

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
 *                 one action — `workflow_dispatch`'s and `run_rerun_failed`'s,
 *                 the two rows spending `actions: write` (header above);
 *   `closedInputs` (optional) the per-workflow closed inputs —
 *                 `WORKFLOW_DISPATCH_INPUTS`, `workflow_dispatch`'s alone: the
 *                 action's `inputs` must be exactly the entry its `workflow`
 *                 names, and absent where that entry is `null` (header above);
 *   `alsoSpends`  (optional) grants the row spends beside `permission` —
 *                 each a literal mint input, never a stroke-scoped one
 *                 (`validate.mjs --self-test` pins it): `pr_create`'s
 *                 assignees and labels legs, LATER requests, the governed-review
 *                 follow-up's assignee fallback on `pr_create` and `pr_ready`, and
 *                 `automerge_enable` on a pull that changes `.github/workflows/**`
 *                 (header above);
 *   `governedReview` (optional) true for a row whose landed requests are followed
 *                 by the governed-review follow-up (header above) — `pr_create`
 *                 and `pr_ready`, the two moments a seat opens or readies a pull;
 *                 the executor reads the pull's files and sends what
 *                 `governedReviewRequests` spells, on a Tier H hit alone;
 *   `requests`    the request descriptors the executor issues, in order:
 *                 `{ verb, path, body?, idempotent404?, graphql?, updateBranch?, rerunFailed?, fromAnswer?, assigned?, labelled? }`
 *                 — a `graphql` descriptor names the mutation and the pull (or
 *                 the issue and target) whose node ids it needs; a pull's
 *                 descriptor also carries `landed`, its `PR_LANDED_STATE`
 *                 entry, which is how the executor tells a landing from a
 *                 bare 200; an `updateBranch` descriptor carries the pull and
 *                 the expected head `confirmUpdateBranch` (execute.mjs) judges
 *                 the answer against; a `rerunFailed` descriptor carries the
 *                 run whose fences the executor reads before the POST and
 *                 whose new attempt it reads back after it
 *                 (`confirmRerunFailed`, execute.mjs); a `fromAnswer` descriptor names the
 *                 field of its action's FIRST request's answer that fills the
 *                 `answerPlaceholder` in its path (`fillFromAnswer`,
 *                 execute.mjs); an `assigned` descriptor lists the logins its
 *                 answer's `assignees` must carry, and a `labelled` one the
 *                 names its answer (the label set) must carry, for the request
 *                 to have landed (`requestLanded`, execute.mjs).
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
  // With `assignees` or `labels`, two or three requests in one action (header): the create, then the assignee
  // POST and the label POST at the number the create ANSWERED — the executor fills `answerPlaceholder('number')`
  // from that first answer and judges each leg's answer against `assigned` / `labelled`. Both legs are
  // `issues: write`, a literal grant on every stroke's token. A dev's `skip-changeset` rides here.
  pr_create: Object.freeze({
    permission: 'pull-requests',
    alsoSpends: Object.freeze(['issues']),
    required: Object.freeze(['title', 'head', 'base']),
    optional: Object.freeze(['body', 'assignees', 'labels']),
    // The draft open is the moment the platform's CODEOWNERS is silent (header: "The governed-review follow-up").
    governedReview: true,
    // `draft: true` is FORCED — a seat cannot open a ready PR through the relay.
    requests: (a, repo) => [
      { verb: 'POST', path: `/repos/${repo}/pulls`, body: { title: a.title, head: a.head, base: a.base, ...('body' in a ? { body: a.body } : {}), draft: true } },
      ...('assignees' in a ? [{ verb: 'POST', path: `${issues(repo, answerPlaceholder('number'))}/assignees`, body: { assignees: [...a.assignees] }, fromAnswer: 'number', assigned: [...a.assignees] }] : []),
      ...('labels' in a ? [{ verb: 'POST', path: `${issues(repo, answerPlaceholder('number'))}/labels`, body: { labels: [...a.labels] }, fromAnswer: 'number', labelled: [...a.labels] }] : []),
    ],
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
  // The base sync — GitHub's own update-branch action (header): the platform merges the pull's base into
  // its head and authors the merge commit as the App, so the relay writes no ref itself. `expected_head_sha`
  // is REQUIRED and full-length; the validator refuses a short one before the dispatch. The executor confirms
  // a 202 by polling the head off that sha and measures a 422 as a no-op only when the compare says the head
  // is not behind its base (`confirmUpdateBranch`, execute.mjs) — never by the answer's spelling.
  pr_update_branch: Object.freeze({
    permission: 'pull-requests',
    required: Object.freeze(['pull', 'expected_head_sha']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'PUT', path: `${pulls(repo, a.pull)}/update-branch`, body: { expected_head_sha: a.expected_head_sha }, updateBranch: { pull: a.pull, expectedHeadSha: a.expected_head_sha } }],
  }),
  // `issues` is the assignee fallback of the governed-review follow-up (header), a literal grant on every stroke.
  pr_ready: Object.freeze({
    permission: 'pull-requests',
    alsoSpends: Object.freeze(['issues']),
    required: Object.freeze(['pull']),
    optional: Object.freeze([]),
    governedReview: true,
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
  // A pull changing `.github/workflows/**` needs `workflows: write` on the enqueuing token
  // too — a literal grant on every stroke, by the maintainer's ruling (comment 6104822731).
  automerge_enable: Object.freeze({
    permission: 'contents',
    alsoSpends: Object.freeze(['workflows']),
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
  // `workflow` and `ref` are closed enums, and so are a workflow's `inputs`: exactly its `WORKFLOW_DISPATCH_INPUTS`
  // entry, absent where that is null. The body's `inputs` is built from the TABLE's entry, never from the action.
  workflow_dispatch: Object.freeze({
    permission: 'actions',
    required: Object.freeze(['workflow', 'ref']),
    optional: Object.freeze(['inputs']),
    alone: true,
    closedInputs: WORKFLOW_DISPATCH_INPUTS,
    requests: (a, repo) => {
      const inputs = dispatchInputsOnTheWire(Object.hasOwn(WORKFLOW_DISPATCH_INPUTS, a.workflow) ? WORKFLOW_DISPATCH_INPUTS[a.workflow] : null);
      return [{ verb: 'POST', path: `/repos/${repo}/actions/workflows/${enc(a.workflow)}/dispatches`, body: { ref: a.ref, ...(inputs ? { inputs } : {}) } }];
    },
  }),
  // The second row whose token carries `actions: write`, minted for a stroke carrying this op alone — see the header.
  // `run_id` is its one key. The four fences on the run (`RERUN_FAILED_FENCES`) are judged by the executor on the run's
  // own answer, read immediately before this POST, and the POST carries NO body: the platform's optional
  // debug-logging flag is never sent.
  run_rerun_failed: Object.freeze({
    permission: 'actions',
    required: Object.freeze(['run_id']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'POST', path: `/repos/${repo}/actions/runs/${a.run_id}/rerun-failed-jobs`, rerunFailed: { runId: a.run_id } }],
  }),
});

export const OP_NAMES = Object.freeze(Object.keys(OPS));

/** The rows the governed-review follow-up runs after (header) — derived from the table, never listed. */
export const GOVERNED_REVIEW_OPS = Object.freeze(OP_NAMES.filter((op) => OPS[op].governedReview === true));
/** The page size the follow-up walks a pull's file list at — GitHub's maximum for `/pulls/{n}/files`. */
export const GOVERNED_REVIEW_FILES_PAGE_SIZE = 100;
/** The most pages it walks: the endpoint lists at most 3,000 files, so a walk past this cap is a truncated SUBSET. */
export const GOVERNED_REVIEW_FILES_PAGE_CAP = 30;
/**
 * The requests the governed-review follow-up sends for ONE pull, spelled here so the validator's refused-family
 * pin covers them: a `requested_reviewers` POST naming `reviewers` (its answer, the pull, must list every login
 * sent — `requested`) and an issue-assignees POST naming `assignees` (its answer must list every login sent —
 * `assigned`, the same judgment as `pr_create`'s assignees leg). An empty list sends nothing. Pure.
 */
export function governedReviewRequests(repo, pull, { reviewers = [], assignees = [] } = {}) {
  return [
    ...(reviewers.length ? [{ verb: 'POST', path: `${pulls(repo, pull)}/requested_reviewers`, body: { reviewers: [...reviewers] }, requested: [...reviewers] }] : []),
    ...(assignees.length ? [{ verb: 'POST', path: `${issues(repo, pull)}/assignees`, body: { assignees: [...assignees] }, assigned: [...assignees] }] : []),
  ];
}

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
  // Every `actions/*` path but the dispatch call (`WORKFLOW_DISPATCH_PATH_SHAPE`) and the failed-jobs
  // re-run (`RERUN_FAILED_PATH_SHAPE`), then the run, job, cache, artifact, secret / variable / runner
  // and workflow enable / disable endpoints `actions: write` would otherwise reach, each named — a
  // loosened catch-all still reds on them. The run family refuses every run path but exactly
  // `runs/{digits}/rerun-failed-jobs`: the whole-run `rerun`, cancel, delete, logs and attempts stay refused.
  /\/actions\/(?!workflows\/[^/]+\/dispatches$|runs\/\d+\/rerun-failed-jobs$)/,
  /\/actions\/runs\/(?!\d+\/rerun-failed-jobs$)/,
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
