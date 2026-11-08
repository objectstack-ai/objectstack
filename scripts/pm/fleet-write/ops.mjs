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
 * `/contents/**`) but one mailbox branch's DELETE (below), a workflow-file write, a run cancel or delete, a whole-run
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
 * ## The one row that deletes a ref — `mailbox_branch_delete`
 *
 * A cloud seat opens its mailbox on a branch it pushed (`mailbox-open.mjs
 * --head`) and cannot delete it, so the relay does, by the maintainer's ruling
 * (comment 6674408912, letter A), which opens this ONE row and nothing else.
 * `DELETE /repos/{o}/{r}/git/refs/heads/{branch}` is `contents: write`,
 * server-to-server, no additional permission (the ledger cited below): a
 * grant every stroke already carries for the auto-merge rows, so the mint
 * widens nothing. The row creates no ref and writes no content: the `/git/`
 * family of `REFUSED_PATH_FAMILIES` refuses every path but exactly one
 * `refs/heads/` ref of `MAILBOX_BRANCH_SHAPE` (`claude/mailbox-*`), held there
 * before the dispatch too. The fences, listed HERE only, are facts about the
 * pull and the ref, judged by the executor on the pull's own `GET`, the open
 * pulls on that head and the ref, the last three reads before the DELETE
 * (`mailboxBranchPreflight`): the pull is closed, carries `pm:mailbox`, its
 * head is `branch` on this repository, no OPEN pull has that head (the DELETE
 * would close it), and the ref points at the pull's `head.sha` (a commit pushed
 * after the close is not the mailbox's; a ref already absent fences nothing).
 * Anything else is refused, the DELETE not sent. It lands only when the ref
 * reads back absent (`confirmMailboxBranch`): a ref already gone (the DELETE's
 * 422) is an idempotent landing, one still there FAILED.
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
 * ## The governed-review follow-up — `pr_ready` on a Tier H diff, ⛔ never the draft open
 *
 * A Tier H governed surface (`GOVERNED_SURFACES` rows with tier `H` in
 * `check-governed-merges.mjs`: `docs/adr/**`, `skills/**`, `AGENTS.md`,
 * `CLAUDE.md`, `docs/NORTH-STAR.md`, `.github/workflows/**`) lands only on an
 * APPROVED review by an account in `GOVERNED_APPROVERS`
 * (`check-governed-queue-guard.mjs`, the ONE list of those accounts). WHEN a
 * human is asked to look is the owning seat's act, never the relay's: a pull
 * reaches an approver only once the seat's `## 席位核对` ACCEPT and a
 * `## Contract review` PASS on the pull's CURRENT head are both on its thread,
 * and then as the seat's own hand-off stroke — `pr_request_reviewers` below,
 * naming the approvers it owes, and `assign` for an approver who is the pull's
 * author (pm-dispatch SKILL.md, ACCEPT 之后的路径分叉 ③). The maintainer,
 * verbatim: 「应该是开发完了你审核通过才会推送给我审核」. So the draft open
 * summons nobody: a `pr_create` is the create plus the legs the caller spelled,
 * nothing reads the pull's files there, and a dev's `pr_create` carries the
 * claim's `Account:` as its `assignees` (ruling A on #29828, os-dev.md rule 2;
 * hand-over is the seat's) — the seat's own account is never requested on a
 * pull as a reviewer. The one follow-up left is `pr_ready`. The platform
 * summons a code owner only when a pull is opened READY or marked ready for
 * review — measured on this repository's own Tier H pulls, the CODEOWNERS
 * request arrived at `ready_for_review` and never at the draft create — and a
 * Tier H pull is readied only after an approver has already approved it, so
 * the follow-up there costs zero writes when the hand-off was made and names
 * the one approver still uncovered when it was not. The row `pr_ready`
 * therefore carries `governedReview: true`, and the executor, once the row's own
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
 * a `pr_ready` after the seat's hand-off, or the platform's own CODEOWNERS
 * request landing first costs zero writes), and — because GitHub answers 422 to a
 * request naming the pull's own author — ONE
 * `POST /repos/{o}/{r}/issues/{n}/assignees` for the author when the author is
 * itself a missing approver. Each answer is judged as the legs above are:
 * `requested` against the pull's pending requests, `assigned` against its
 * assignees; a 2xx lacking a login sent is a FAILED action naming it. A Tier
 * S diff (`.claude/**` alone — it lands on a seat's review of record) and an
 * ungoverned diff send nothing, and the row says which. The reads are unpaced
 * GETs; the writes are paced like every other write verb and are outside the
 * rule ⑤ count (`strokePacing` counts a stroke's spelled requests; these two
 * are conditional and at most two per pull). The row spends `issues: write`
 * for the assignee fallback (`alsoSpends`), a literal grant on every stroke.
 * `execute.mjs --self-test` pins the plan, the writes and both refusals, and
 * that `pr_create` sends none of it; `validate.mjs --self-test` pins the one
 * row and the two endpoints against the refused families. ⛔ This is an
 * ACTION, not a judge: no gate, check-run or patrol row is added by it — the
 * H43 row in `check-half-states.mjs` reads the gap left once the hand-off is
 * due (ACCEPT and a same-head PASS on the thread, and nobody asked).
 *
 * ## The permissions the relay's token is narrowed to
 *
 * Read from GitHub's own permission ledger for server-to-server tokens
 * (`github/docs`, `src/github-apps/data/fpt-2022-11-28/server-to-server-permissions.json`):
 * every `/issues/**` write here is `issues: write` — `pr_create`'s assignees
 * and labels legs and the governed-review follow-up's assignee fallback on
 * `pr_ready` spend it as `alsoSpends`; `/pulls/**` and the
 * ready / draft GraphQL mutations are `pull-requests: write`; the two
 * auto-merge mutations (`enablePullRequestAutoMerge` /
 * `disablePullRequestAutoMerge`) additionally require `contents: write` —
 * measured on the first live use, where a token without it answered
 * "Resource not accessible by integration" — and beside those two rows only
 * `mailbox_branch_delete`'s one ref DELETE (above) spends it: no row writes a
 * file or creates or moves a ref (`pr_update_branch` is the platform's own
 * merge, `pull_requests: write` in that ledger); arming auto-merge on a pull that changes
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
 * row, the one mailbox ref DELETE aside (above). The workflow-run dispatch (`workflow_dispatch`) and the failed-jobs
 * re-run (`run_rerun_failed`), both below, are `actions: write`, the two rows
 * spending it; the five advisory rows that write (`advisory_report`,
 * `advisory_create`, `advisory_collaborators_add`, `advisory_versions` and
 * `advisory_state`, below) are `repository-advisories: write`, and the one
 * that reads (`advisory_read`, below) spends the same grant at `read` alone
 * (its row's `grant`), the six rows spending it; the sender gate's
 * `GET /repos/{o}/{r}/collaborators/{login}/permission` is `metadata: read`.
 * `PERMISSIONS` is that set and nothing wider. The workflow declares the five
 * grants every stroke gets as literal `permission-*` inputs on
 * `actions/create-github-app-token`, and the two grants a stroke gets only
 * when it spends one (`STROKE_SCOPED_PERMISSIONS`) as inputs read from the
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
 * it is fenced the same way. These are the seven fences:
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
 *   - the HEAD: the run's `head_sha` is its pull request's CURRENT head. The
 *     pull is the run's `pull_requests[0].number`, and its head is read with
 *     the pull's own `GET /repos/{repo}/pulls/{n}`, never from the copy the
 *     run embeds. `ci.yml`'s concurrency group is keyed by the pull number
 *     with `cancel-in-progress: true`, so a stale head's re-run would cancel
 *     the current head's run. A run with no `pull_requests` entry (a fork
 *     pull request's run, or the field empty) is refused by name;
 *   - ALONE: a stroke carrying it carries exactly that one action (`alone`),
 *     so the wider token serves one request;
 *   - the GRANT: `actions: write` is minted for that stroke alone, through the
 *     `STROKE_SCOPED_PERMISSIONS` output `workflow_dispatch` already uses — the
 *     validator writes `permission_actions=write` for either op's stroke and an
 *     empty value for every other, so the workflow names neither op.
 *
 * The payload is `run_id` and nothing else: no workflow, attempt, job or
 * debug-logging key exists for it, and the POST carries no body. The first
 * five fences are facts about the RUN and its pull, not the request, so the
 * EXECUTOR judges them (`RERUN_FAILED_FENCES`) on
 * `GET /repos/{repo}/actions/runs/{run_id}` and then the pull's
 * `GET /repos/{repo}/pulls/{n}`, the last two reads before the POST. A run
 * that changed between the seat's request and the relay's run, for example
 * re-run by a person meanwhile, or a pull that a push moved on, is refused
 * THERE with zero writes. The seat's wrapper (`scripts/pm/rerun-failed.mjs`)
 * reads the same five before it dispatches. That is an early refusal naming
 * the fence that fails, and it never replaces the executor's.
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
 * ## The two rows that write an issue's hierarchy — `sub_issue_add` and `sub_issue_remove`
 *
 * An epic's queue is its parent's open sub-issues, and the half-state patrol
 * reads a parent's `sub_issues_summary`; the link both reads see is written by
 * `POST /repos/{o}/{r}/issues/{parent}/sub_issues` and taken back by
 * `DELETE /repos/{o}/{r}/issues/{parent}/sub_issue`, each with the body
 * `{ sub_issue_id }` — the child's REST `id`, never its number (GitHub's REST
 * OpenAPI description, operations `issues/add-sub-issue` and
 * `issues/remove-sub-issue`, read 2026-10-29). GitHub's permission ledger (the
 * file cited below) lists both under `issues: write`, server-to-server, with
 * no additional permission, so both rows spend `issues`, a literal grant on
 * every stroke: the mint widens nothing, and neither row travels `alone`.
 *
 * The payload carries two issue NUMBERS — `issue` the parent, `sub_issue` the
 * child — and never an id: the executor resolves the child's `id` from the
 * child's own `GET /repos/{o}/{r}/issues/{child}`, the read its fences need
 * anyway, so the action speaks the vocabulary every other row speaks and a
 * seat never hand-copies an opaque id. An action naming one issue as both is
 * refused by the validator (`distinct`). `replace_parent`, the add endpoint's
 * flag that moves a child off its current parent, is never sent: a move is a
 * remove from the old parent and an add to the new one, two actions a seat
 * names.
 *
 * The fences (`SUB_ISSUE_FENCES`) are facts about the two cards, so the
 * EXECUTOR judges them on its own reads immediately before the write
 * (`subIssuePreflight`, `execute.mjs`) — a card moved, or a link another actor
 * wrote, between the seat's request and the run is refused there with zero
 * writes:
 *
 *   - PARENT and CHILD: each number answers `GET /repos/{o}/{r}/issues/{n}`
 *     as an issue — never a pull request — on the stroke's own repository (a
 *     transferred card answers from its new home and is refused by name), the
 *     child with an integer `id`;
 *   - FREE (`sub_issue_add`): the child's own
 *     `GET /repos/{o}/{r}/issues/{child}/parent` answers 404 (no parent —
 *     measured 2026-10-29: "No parent issue found"; the issue's own answer
 *     omits `parent_issue_url` then, so absence is read on this endpoint,
 *     never inferred from a missing field) or this parent. A child under
 *     ANOTHER parent is refused naming it; one under THIS parent is a measured
 *     no-op — nothing sent, landed only when the parent's list reads it back;
 *   - LISTED (`sub_issue_remove`): the parent's own sub-issue list
 *     (`GET /repos/{o}/{r}/issues/{parent}/sub_issues`, every page) lists the
 *     child's `id`. A child it does not list is refused, never sent as a
 *     DELETE the platform might answer either way.
 *
 * The write's answer is an acceptance, not a landing: the action LANDS only
 * on `subIssueReadBack` — the parent's list, read whole after the write,
 * lists the child's `id` (add) or no longer does (remove), re-read inside a
 * bounded window. A list that never settles is a FAILED action saying
 * UNCONFIRMED: read the parent, ⛔ never re-send. Neither row carries prose or
 * creates or moves a card, so neither is content-creating for rule ⑤ nor
 * annotated, and neither carries a `body` the seat reads back — the
 * executor's read-back IS the confirmation, as for `pr_update_branch`.
 * `validate.mjs --self-test` pins both rows, the fences and the read-back's
 * judgment; `execute.mjs --self-test` pins the reads, the one write, every
 * refusal and the landing.
 *
 * ## The rows that write a security advisory — no advisory text on a public surface
 *
 * Private vulnerability reporting is on for this repository, and GitHub lets
 * only an administrator, a security manager or an advisory's own
 * collaborators see an unpublished advisory. A seat account must not write to
 * GitHub itself (the suspension `fleet-token.mjs` records), so a seat files a
 * finding and moves its state through the relay, and reads the advisory under
 * its own account once it is a collaborator — a read a cloud seat turned out
 * unable to make, so it reads through the relay too, sealed (`advisory_read`,
 * the next section). The maintainer's scope, verbatim
 * as the body of issue 29160 (the card that filed these rows) records it:
 * 「按这个范围更新 #29160：上报正文经中继并读事件文件，加人、接受、关闭只改状态，读取用席位自己的账号，发布留给我。先测令牌。」
 * Its clause 「发布留给我」 is SUPERSEDED. Told that the relay did not let an
 * advisory be set to published, so the seat had handed over a list to publish
 * by hand, the maintainer ruled, verbatim as the body of issue 30110 records it:
 * 「中继不允许把公告设为已发布 ，立卡解决」. WHAT is published is unchanged and
 * stays the maintainer's, by the standing rule 「哪些高危要发布应该在我版本发布前决策吧」:
 * the maintainer decides the list before each release, and the relay only
 * carries out a list the maintainer approved — the seat's half of that lives
 * in pm-dispatch's `references/security-findings.md`, never here.
 *
 *   row                          request                                         the payload carries
 *   `advisory_report`            `POST …/security-advisories/reports`            `summary`, `description`; optional `severity`, `cwe_ids`
 *   `advisory_create`            `POST …/security-advisories`                    the report's keys, and `packages`
 *   `advisory_collaborators_add` `GET`, then `PATCH …/security-advisories/{id}`  `ghsa_id` and logins
 *   `advisory_versions`          `GET`, then `PATCH …/security-advisories/{id}`  `ghsa_id` and `versions`: package, range, patched versions
 *   `advisory_state`             `GET`, then `PATCH …/security-advisories/{id}`  `ghsa_id` and `draft`, `closed` or `published`
 *
 * `advisory_create` is the maintainer's naming of a second way in, verbatim
 * as the body of issue 29410 records it: 「立一张 skills 卡，我现在就派发，然后你再试」.
 * GitHub caps the NEW private reports an account files per day, and every
 * relay report is filed as the one App, so the whole fleet's reports share
 * one quota. Creating an advisory is the repository's own act, not a report:
 * the endpoint takes the same `repository-advisories: write` grant and
 * creates the advisory in `draft` directly — the state a report reaches only
 * once accepted. That the App's token may create one, and that the cap on
 * reports does not reach it, are documentation readings the first live run
 * confirms (below).
 *
 * Publishing a fixed advisory is three strokes, each alone. A fixed advisory
 * here is `closed` once its fix merges, so `advisory_state` first moves it back
 * to `draft` (the reopen); `advisory_versions` then sets each affected
 * package's vulnerable range and patched versions; and `advisory_state` last
 * moves it to `published`. The versions row carries NO prose: its one key
 * beside the id is `versions`, a capped list of closed entries, each exactly
 * `package` (`NPM_PACKAGE_SHAPE`), `vulnerable_version_range`
 * (`ADVISORY_VERSION_RANGE_SHAPE`: one comparator, or a lower bound then an
 * upper bound, each an operator, one space and a release version) and
 * `patched_versions` (`ADVISORY_PATCHED_VERSIONS_SHAPE`: one to
 * `MAX_ADVISORY_PATCHED_VERSIONS` release versions, a comma and a space
 * between). `advisoryVersionEntryFailure` judges each, and also refuses a pair
 * whose bounds do not rise and a patched version inside its own range. Its
 * PATCH body is `{ vulnerabilities }` alone: per entry the npm ecosystem, the
 * name and the two version strings, never a vulnerable function.
 *
 * `published` is reached by ONE row and ONE transition: `advisory_state`, from
 * `draft` alone, and only once the executor's own GET reads at least one
 * `vulnerabilities` entry, every one in the versions row's spelling (the
 * `versions` fence, `ADVISORY_FENCES`) — the versions are set first. No other
 * field takes it as a value, and no body but the executor's `{ state }` can
 * carry it: the report's and the draft's bodies are the row's, holding no state
 * (the endpoint creates a draft and takes none), the versions row's is its
 * entries alone, and the other two PATCH bodies are the executor's
 * (`validate.mjs --self-test` pins every one). Editing an advisory's summary or
 * description, listing advisories, removing a collaborator, the CVE request and
 * the temporary fork are out of reach of every row, and reading an advisory's text
 * is one row's alone, which seals it (`advisory_read`, the next section):
 * `REFUSED_PATH_FAMILIES` refuses each `security-advisories` path but one
 * advisory's (`ADVISORY_PATH_SHAPE`), the reports endpoint
 * (`ADVISORY_REPORTS_PATH_SHAPE`) and the bare collection
 * (`ADVISORY_CREATE_PATH_SHAPE`), and the self-test pins that the
 * collection is reached by `advisory_create`'s `POST` alone, never a `GET`.
 * A draft names its affected packages and nothing else of them: each is one
 * `vulnerabilities` entry, the npm ecosystem and the name
 * (`ADVISORY_CREATE_ECOSYSTEM`, `NPM_PACKAGE_SHAPE`), with no version range,
 * vulnerable function, credit, CVSS vector, CVE id or private fork.
 *
 * What may NOT cross. The relay's run log and step summary are public, so:
 *
 *   - the payload never rides a step's `env:` — GitHub prints a step's
 *     environment into the log — and `validate.mjs` and `execute.mjs` read
 *     `client_payload` from the event file (`$GITHUB_EVENT_PATH`) for EVERY
 *     op, so a report's or a draft's `summary` and `description` travel in the
 *     payload and are printed nowhere;
 *   - a refusal names the key and the byte count and ⛔ never echoes a value:
 *     `summary` and `description` are `str` fields, which never echo, and the
 *     other advisory fields are `quiet` (`FIELDS`), so a value that fails is
 *     described by its type and size alone — a value in the wrong key may be
 *     prose;
 *   - the executor prints no field of an advisory's answer but its id, its
 *     `state` and the logins `collaborating_users` names, each only in its own
 *     shape (`advisoryPrintable`), and the platform's `message` only when it
 *     is one the relay knows (`ADVISORY_PLATFORM_MESSAGES`) — never a
 *     summary, a description, a vulnerability, a credit, a CVE or CWE, a URL
 *     or the answer's body. Of the versions it prints COUNTS alone — entries
 *     and packages, never a name or a version, which are the unpublished
 *     advisory's until the publish. `advisoryReportLandedText`,
 *     `advisoryCreateLandedText`, `advisoryLandedText`,
 *     `advisoryVersionsLandedText`, `advisoryStateLandedText` and
 *     `advisoryFenceText` are the only spellings of an advisory row. An id
 *     exposes no content, but it is public in the log. A draft's package names
 *     and the versions row's entries are `quiet` too: a refusal never echoes one.
 *
 * The executor's five paths (`execute.mjs`, in the shape of the hierarchy rows'):
 *
 *   - `advisory_report` is one POST of the row's body. It LANDS on a 2xx
 *     whose answer carries a `ghsa_id` (`advisoryReportReadBack`); the row and
 *     a notice annotation name that id, so the seat follows with
 *     `advisory_collaborators_add` — the App is the submitter, so the finding
 *     seat is not a collaborator on its own;
 *   - `advisory_create` is one POST of the row's body to the collection, and
 *     nothing is read first. It LANDS on a 2xx whose answer carries a
 *     `ghsa_id` and reads state `draft` (`advisoryCreateReadBack`); a 2xx
 *     without an id is UNCONFIRMED and one in another state FAILED, neither
 *     ever re-sent. The row and a notice annotation name the id, so the seat
 *     follows with `advisory_collaborators_add` exactly as after a report;
 *   - `advisory_collaborators_add` reads the advisory first (`ADVISORY_FENCES`,
 *     judged by `advisoryPreflight` on the executor's own `GET`) and refuses
 *     with nothing sent unless the read answers 200 with the advisory the
 *     action names in `triage` or `draft` (`ADVISORY_OPEN_STATES`). The logins
 *     are compared case-insensitively (`advisoryCollaboratorPlan`): nothing
 *     missing is a no-op with nothing sent; otherwise the PATCH sends the
 *     EXISTING logins plus the missing ones, so the merge holds whether the
 *     platform replaces the list or merges it. It LANDS only when the answer
 *     lists every login sent (`advisoryReadBack`);
 *   - `advisory_versions` reads the advisory the same way and refuses with
 *     nothing sent unless it reads `draft` (`ADVISORY_VERSIONS_STATES`) and the
 *     `versions` fence holds. The PATCH REPLACES the whole list — GitHub's own
 *     example of the call: "To add vulnerable versions, include existing
 *     versions in the array" — so every package the advisory already lists
 *     must be one the action names, and no listed entry may be another
 *     ecosystem's, nameless, or carry `vulnerable_functions`, which this row
 *     does not write and the PATCH would drop. It LANDS only when the answer,
 *     still `draft`, lists exactly the entries sent (`advisoryVersionsReadBack`);
 *   - `advisory_state` reads the advisory the same way and refuses an illegal
 *     transition with nothing sent (`ADVISORY_TRANSITIONS`: `draft` from
 *     `triage` — the accept — or from `closed` — the reopen; `closed` from
 *     `triage` or `draft`; `published` from `draft` alone, through the
 *     `versions` fence; nothing from `published` or `withdrawn`, and a state
 *     the table does not name fails closed). Its PATCH body is `{ state }` and
 *     nothing else, and it LANDS only when the answer shows that state
 *     (`advisoryStateReadBack`) — a publish only when the published answer
 *     also lists exactly the entries the preflight read: the advisory read back
 *     as `published`, with the versions it was sent. A landed publish alone
 *     earns a notice annotation naming the id (`relayAdvisoryAnnotationMessage`,
 *     `dispatch.mjs`): it is public once published, which is the point.
 *
 * Each row travels `alone` and spends `repository-advisories: write`, a grant
 * minted only for its stroke (`STROKE_SCOPED_PERMISSIONS`), so every other
 * stroke's token stays as it was. Measured on 2026-11-02 with the relay's own
 * mint action against a control token minted without the grant (run
 * 41415522766, recorded in the card's body): the narrowed mint succeeds, and
 * the grant is what opens an advisory's read and its PATCH (200 with it, 403
 * without). The action warns `Unexpected input(s)
 * 'permission-repository-advisories'` on such a run, because its `action.yml`
 * does not declare the input, and it still passes it to the mint
 * (`lib/get-permissions-from-inputs.js`): the warning is expected, and not one
 * to "fix" by removing the input. The first live run after merge decides the
 * rest: a valid report filed by the App and whom it records as the reporter,
 * a real account added and whether the PATCH replaces the list, the two
 * transitions by the App, and whether a report needs the grant at all (both
 * tokens reached the reports endpoint's 422); for `advisory_create`, whether
 * the App's token creates a draft at all, whether one `vulnerabilities` entry
 * of an ecosystem and a name is the least the endpoint accepts, and whether
 * three drafts land in one hour where reports stop at one a day. A refusal
 * on any of them is a FAILED action carrying `ADVISORY_ACCESS_REMEDY`, and ⛔
 * never a retry under an un-narrowed token: the reading goes to the maintainer.
 *
 * What a publish needs on the platform, read 2026-11-04 from GitHub's REST
 * description (`github/rest-api-description`, operation
 * `security-advisories/update-repository-advisory`) and the permission ledger
 * cited above: the one PATCH takes `state` (`published`, `closed` or `draft`)
 * and `vulnerabilities` (per entry `package`, `vulnerable_version_range`,
 * `patched_versions`, `vulnerable_functions`), under `repository_advisories:
 * write` alone, server-to-server, with no additional permission; the
 * description's own refused move is `published` → `draft` (422, "Invalid state
 * transition"). The App's PATCH of `state` is measured: `triage` → `draft` and
 * `draft` → `closed` landed on the live runs after these rows merged (runs
 * 41443030055 and 41443112178). NOT measured, so the first live publish after
 * merge confirms each: that the platform takes `closed` → `draft` (the
 * description names that move neither way), that it takes `draft` →
 * `published` and the versions from the App, that it answers the versions in
 * the spelling sent, and whether it needs them before it publishes — the relay
 * needs them either way. A refusal is a FAILED action carrying
 * `ADVISORY_ACCESS_REMEDY`; a token that cannot reopen or publish is a fork for
 * the maintainer, ⛔ never a widened grant.
 *
 * The sender gate does NOT change for these rows: write, maintain or admin on
 * the target passes, by the maintainer's ruling, verbatim as the body of issue
 * 29160 records it: 「所有车队账户都能发这个操作」. It is recorded here because
 * of what it admits: any fleet account with write on the target can add
 * itself to an advisory whose id it holds.
 *
 * ## The one row that READS an advisory — `advisory_read`, sealed to a key the seat alone holds
 *
 * The scope above has a seat read an advisory under its own account. The live
 * run after 29160 merged showed a cloud seat cannot: its `gh` speaks with a
 * token holding no repository-advisories permission (403, "Resource not
 * accessible by integration"), and its egress proxy replaces every
 * `Authorization` header. The App can read one, but only inside the relay's
 * run, whose log, annotations and step summary anyone may read. So the read
 * leaves the run as ciphertext alone, by the maintainer's naming, verbatim as
 * the body of issue 29420 records it: 「按一次性密钥立卡」.
 *
 *   row             request                                          the payload carries
 *   `advisory_read` `GET …/security-advisories/{id}`, and nothing else  `ghsa_id` and `public_key`
 *
 * The seat (`dispatch.mjs`) generates an X25519 key pair in its own process
 * for each read, puts the public half in the action, and keeps the private
 * half in memory — never exported, never written, gone when the process
 * exits. No key is stored anywhere: not in the repository, not as a secret.
 * `public_key` is its own closed kind (`FIELDS`, kind `x25519`): base64 SPKI
 * DER of exactly `ADVISORY_READ_PUBLIC_KEY_CHARS` characters in its one
 * spelling, a key a shared secret can be derived with — judged by
 * `advisoryReadKeyFailure` before any request, a refusal naming the key and
 * the byte count alone.
 *
 * The executor reads the advisory, judges `ADVISORY_READ_FENCES` on that
 * answer, and seals `ADVISORY_READ_FIELDS` of it as the platform answered
 * them (`advisoryReadPlaintext`) with `sealAdvisoryRead`: a fresh X25519 key
 * of its own, HKDF-SHA256 over the shared secret, AES-256-GCM under a random
 * nonce, with the request id, the action's index and the id as associated
 * data, so a sealed answer opens for the read that asked for it and no other.
 * Node's own `crypto`, and nothing else. The sealed answer leaves the run on
 * ONE channel, the one a seat container can read: notice annotations on the
 * job's check run, at most `ADVISORY_READ_MAX_PARTS` of
 * `ADVISORY_READ_PART_CHARS` characters (`advisoryReadParts`), inside the
 * runner's measured caps — ten notices a step and a message cut at 4,096
 * characters (`actions/runner`, `ExecutionContext.cs`). An answer too large
 * for them is a FAILED action naming byte counts alone. The seat reassembles
 * the parts, opens them with its private key (`openAdvisoryRead`), and prints
 * the text to its own stdout, and only on `--reveal`.
 *
 * ⛔ What crosses the public run: the HTTP status, the byte and part counts,
 * and the ciphertext. NOT the id — the row's call is `ADVISORY_READ_CALL`, a
 * placeholder where every other row prints its path — nor the state, the
 * platform's `message` unless `ADVISORY_PLATFORM_MESSAGES` names it, or any
 * field of the answer. A seal that fails is a FAILED action that prints
 * nothing of the answer and emits no part. The action LANDS only on a 200
 * whose answer passes every fence and whose seal succeeded and fit. It writes
 * nothing, so `dispatch.mjs` has no byte read-back for it: opening the parts
 * IS its read-back.
 *
 * The grant: the row's `grant` is `read`, so its stroke's token carries
 * `repository-advisories: read` and never write. GitHub documents this GET
 * under a read grant; what was measured is the write grant's read (run
 * 41415522766, above), so the first live read is the measurement of record.
 * A refusal there is a FAILED action carrying `ADVISORY_READ_ACCESS_REMEDY`:
 * raising the row to write is the maintainer's ruling, ⛔ never a retry under
 * a wider token.
 *
 * The sender gate is `target-write`, by the maintainer's ruling, verbatim as
 * the body of issue 29644 records it: 「同意改成对仓库有写权限,立卡派发修复」.
 * Every stroke passes the target-write gate before its first request
 * (`execute.mjs`, the sender gate), and the executor then holds a read to the
 * row's `senderGate`, a key of `ADVISORY_READ_SENDER_GATES`; `target-write`
 * asks nothing more: write, maintain or admin on the target, the gate the
 * five rows above keep. The ruling settles the question this row landed
 * with, whether a read should instead need the sender on the advisory's own
 * `collaborating_users`. That gate excluded no one, since a sender with write
 * on the target can add itself to any advisory whose id it holds (above), and
 * the first live reads were each refused at it (runs 41545143476,
 * 41545259848 and 41546082963) for a sender the advisory's write-grant GET
 * already listed (run 41546190167). Why the fence refused them is
 * unmeasured; one hypothesis is that the read-grant answer omits
 * `collaborating_users`. The table holds that one value, and any other, the
 * retired `collaborator` among them, fails closed with nothing sealed.
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

import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

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
 * The pull request a run's `head` fence reads: the run's `pull_requests[0].number`, or `null` when the run names
 * none (a fork pull request's run, whose `pull_requests` the platform leaves empty, or a missing field). Pure.
 */
export function rerunFailedPullNumber(run) {
  const n = Array.isArray(run?.pull_requests) ? run.pull_requests[0]?.number : undefined;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const shortHead = (sha) => (typeof sha === 'string' ? sha.slice(0, 10) : null);

/**
 * The five fences on the RUN and its pull (the header's `run_rerun_failed`
 * section): `fence` its name, `wants` what the relay re-runs, `reads` the
 * field(s) the failure sentence quotes, `holds` the predicate. Each takes
 * `(run, pull)`: `run` the run's own answer, `pull` the answer of
 * `GET /repos/{repo}/pulls/{n}` for the pull `rerunFailedPullNumber` names,
 * or `null` when the run names none. ⛔ The `head` fence never reads the copy
 * of the pull the run embeds. The other two fences — alone in its stroke, the
 * stroke-scoped grant — are the validator's. The executor judges these on the
 * two reads taken immediately before the POST; the seat's wrapper judges them
 * earlier, as an advisory refusal.
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
  Object.freeze({
    fence: 'head',
    wants:
      "a run whose head_sha is its pull request's CURRENT head (the pull named by pull_requests[0], read with its own GET, " +
      "never the run's embedded copy), since ci.yml's concurrency group is keyed by the pull number and a stale head's re-run cancels the current head's run",
    reads: (run, pull) => {
      const n = rerunFailedPullNumber(run);
      if (n === null) return "no pull_requests entry — a fork pull request's run, or none";
      return `head_sha ${shortHead(run?.head_sha)}, and pull #${n}'s own GET answers #${pull?.number ?? null} at head ${shortHead(pull?.head?.sha)}`;
    },
    holds: (run, pull) => {
      const n = rerunFailedPullNumber(run);
      return n !== null && typeof run?.head_sha === 'string' && run.head_sha !== '' && pull?.number === n && pull?.head?.sha === run.head_sha;
    },
  }),
]);

/**
 * The fences a run's answer and its pull's fail: `[{ fence, wants, got }]`, in `RERUN_FAILED_FENCES` order; `[]`
 * when all five hold. `pull` is the pull's own answer, or `null` when the run names no pull. Pure.
 */
export function rerunFailedFenceFailures(run, pull = null) {
  return RERUN_FAILED_FENCES.filter((f) => !f.holds(run, pull)).map((f) => ({ fence: f.fence, wants: f.wants, got: f.reads(run, pull) ?? null }));
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

/** The two modes of the hierarchy rows (header: "The two rows that write an issue's hierarchy") — the descriptor's `subIssue.mode`. */
export const SUB_ISSUE_MODES = Object.freeze(['add', 'remove']);

const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
/** `owner/name` an issue answer says it is on NOW (its `repository_url`), or null. Pure. */
const answeredRepo = (json) => /\/repos\/([^/]+\/[^/]+)$/.exec(String(json?.repository_url ?? ''))?.[1] ?? null;

/**
 * Why one `GET /repos/{repo}/issues/{n}` answer is NOT a card a hierarchy link may name — or null when it is an
 * issue on `repo` answering as #`number` with an integer `id`. `answer` is `{ status, json }`. Pure.
 */
export function subIssueCardFailure(answer, repo, number) {
  if (!answer || answer.status !== 200 || !isObject(answer.json)) return `#${number} could not be read (HTTP ${answer?.status ?? 'none'})`;
  const card = answer.json;
  if (card.pull_request) return `#${number} is a pull request — only an issue is a parent or a sub-issue`;
  const at = answeredRepo(card);
  if (!sameRepo(at, repo)) return `#${number} no longer answers from ${repo}: ${at ? `it answers from ${at}${Number.isInteger(card.number) ? ` as #${card.number}` : ''} — transferred` : 'its repository could not be read'}`;
  if (!Number.isSafeInteger(card.id) || card.id < 1) return `#${number} answers with no integer id, so no sub_issue_id can be sent for it`;
  return null;
}

/**
 * Does the child's own parent read (`GET /repos/{repo}/issues/{child}/parent`, `{ status, json }`) name THIS
 * parent — the add's measured no-op? Pure.
 */
export function subIssueAlreadyHere({ repo, parentNumber, childParent } = {}) {
  return childParent?.status === 200 && isObject(childParent.json) && childParent.json.number === parentNumber && sameRepo(answeredRepo(childParent.json), repo);
}

/**
 * The fences on the two cards (the header's hierarchy section), each judged on what the executor READ —
 * `ctx` is `{ mode, repo, parentNumber, childNumber, parent, child, childParent, list }`: `parent` and `child`
 * the two issue answers, `childParent` the child's parent read (add), `list` the parent's sub-issue list read
 * whole (remove) as `{ items }` or `{ fail }`. A read the executor did not take is `undefined`, and a fence
 * whose read is missing FAILS, naming that — an unread fact is never a pass. `modes` the rows a fence binds.
 */
export const SUB_ISSUE_FENCES = Object.freeze([
  Object.freeze({
    fence: 'parent',
    modes: SUB_ISSUE_MODES,
    wants: "the parent number answering as an issue — never a pull request — on the stroke's own repository",
    fails: (c) => subIssueCardFailure(c.parent, c.repo, c.parentNumber),
  }),
  Object.freeze({
    fence: 'child',
    modes: SUB_ISSUE_MODES,
    wants: "the child number answering as an issue with an integer id — never a pull request — on the stroke's own repository",
    fails: (c) => subIssueCardFailure(c.child, c.repo, c.childNumber),
  }),
  Object.freeze({
    fence: 'free',
    modes: Object.freeze(['add']),
    wants: "a child with no parent (its parent read answers 404) or this parent already — the relay never sends replace_parent",
    fails: (c) => {
      const r = c.childParent;
      if (r === undefined) return "the child's parent was not read, because the cards above did not pass";
      if (r?.status === 404) return null;
      if (r?.status === 200 && isObject(r.json)) {
        if (subIssueAlreadyHere(c)) return null;
        const at = answeredRepo(r.json) ?? 'an unknown repository';
        return `#${c.childNumber} is already a sub-issue of ${at}#${r.json.number ?? '?'} — remove it there first (a sub_issue_remove), the relay never moves it`;
      }
      return `the child's parent read answered HTTP ${r?.status ?? 'none'}${typeof r?.json?.message === 'string' ? ` (${r.json.message})` : ''}, neither a parent nor 404`;
    },
  }),
  Object.freeze({
    fence: 'listed',
    modes: Object.freeze(['remove']),
    wants: "a child the parent's own sub-issue list lists, by its id",
    fails: (c) => {
      if (c.list === undefined) return "the parent's sub-issue list was not read, because the cards above did not pass";
      if (c.list?.fail) return c.list.fail;
      const id = c.child?.json?.id;
      const items = Array.isArray(c.list?.items) ? c.list.items : [];
      return items.some((i) => i?.id === id) ? null : `#${c.parentNumber}'s sub-issue list (${items.length}) does not list #${c.childNumber} (id ${id ?? '?'})`;
    },
  }),
]);

/** The fences `ctx` fails for its mode: `[{ fence, wants, got }]` in `SUB_ISSUE_FENCES` order; `[]` when all hold. Pure. */
export function subIssueFenceFailures(ctx = {}) {
  return SUB_ISSUE_FENCES.filter((f) => f.modes.includes(ctx.mode)).map((f) => ({ fence: f.fence, wants: f.wants, got: f.fails(ctx) })).filter((f) => f.got !== null);
}

/** The sentence a hierarchy fence refusal prints — every failing fence by name, what was read, what the relay links. Pure. */
export function subIssueFenceText(failures) {
  return failures.map((f) => `fence \`${f.fence}\`: ${f.got}, and the relay links only ${f.wants}`).join('; ');
}

/**
 * What LANDED means for a hierarchy row (the header's section): the parent's sub-issue list, read whole after
 * the write, lists the child's `id` (add) or does not (remove). `items` the list's entries. Answers
 * `{ ok, listed, count, why }`. Pure.
 */
export function subIssueReadBack({ mode, childId, items = [] } = {}) {
  const list = Array.isArray(items) ? items : [];
  const listed = list.some((i) => i?.id === childId);
  const ok = mode === 'add' ? listed : mode === 'remove' ? !listed : false;
  const why = ok ? '' : mode === 'add' ? `the parent's sub-issue list (${list.length}) does not list the child's id ${childId}` : mode === 'remove' ? `the parent's sub-issue list (${list.length}) still lists the child's id ${childId}` : `no hierarchy mode ${JSON.stringify(mode)}`;
  return { ok, listed, count: list.length, why };
}

/** The row a landed hierarchy action prints: the link as the parent's list reads it back. Pure. */
export function subIssueLandedText({ mode, parentNumber, childNumber, childId, count, noop = false }) {
  if (mode === 'add') return `${noop ? 'no-op, nothing sent: ' : ''}#${childNumber} (id ${childId}) is a sub-issue of #${parentNumber} · its list reads ${count} sub-issue(s)${noop ? ' — the child already answered to this parent' : ''}`;
  return `#${childNumber} (id ${childId}) is no longer a sub-issue of #${parentNumber} · its list reads ${count} sub-issue(s)`;
}

/**
 * One repository advisory's id (header: "The rows that write a security advisory"): `GHSA` and three groups
 * of four lowercase letters or digits. It is spelled into a path, so the field kind `ghsa` admits this and nothing else.
 */
export const GHSA_ID_SHAPE = /^GHSA(-[0-9a-z]{4}){3}$/;
/** The path of ONE advisory — one of the three `security-advisories` paths a row reaches (`REFUSED_PATH_FAMILIES`). */
export const ADVISORY_PATH_SHAPE = /\/security-advisories\/GHSA(-[0-9a-z]{4}){3}$/;
/** The private-report endpoint — the second, `advisory_report`'s POST. */
export const ADVISORY_REPORTS_PATH_SHAPE = /\/security-advisories\/reports$/;
/**
 * The collection itself — the third, `advisory_create`'s POST, which creates a DRAFT. The same path answers the list
 * to a `GET`; no row spells that verb on it (`validate.mjs --self-test` pins the verbs every row sends here).
 */
export const ADVISORY_CREATE_PATH_SHAPE = /^\/repos\/[^/]+\/[^/]+\/security-advisories$/;
/** The one ecosystem a draft's `vulnerabilities` entry names: every package this fleet ships is an npm package. */
export const ADVISORY_CREATE_ECOSYSTEM = 'npm';
/** An npm package name, scoped or not, as the registry spells one — the only shape a draft's package takes. */
export const NPM_PACKAGE_SHAPE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** The states an advisory takes a collaborator in through the relay: an unpublished, open advisory's. */
export const ADVISORY_OPEN_STATES = Object.freeze(['triage', 'draft']);
/** The state a publish lands in — reached by `advisory_state` from `draft` alone, through the `versions` fence (header). */
export const ADVISORY_PUBLISHED_STATE = 'published';
/**
 * The transitions `advisory_state` may make, as target → the states it may leave (header): accepting a report is
 * `triage` → `draft` and reopening a closed advisory `closed` → `draft`; closing is `triage` or `draft` → `closed`;
 * publishing is `draft` → `published`, once the versions are set (the `versions` fence of `ADVISORY_FENCES`). Nothing
 * leaves `published` or `withdrawn`. Its keys are the field's closed enum; a state it does not name fails closed.
 */
export const ADVISORY_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['triage', 'closed']),
  closed: Object.freeze(['triage', 'draft']),
  [ADVISORY_PUBLISHED_STATE]: Object.freeze(['draft']),
});
/** The states `advisory_state` may ask for — exactly `ADVISORY_TRANSITIONS`' keys. */
export const ADVISORY_SETTABLE_STATES = Object.freeze(Object.keys(ADVISORY_TRANSITIONS));
/**
 * A state refused BY NAME as a value, with why — none since the maintainer's ruling that the relay publishes
 * (header): `published` left this table for `ADVISORY_TRANSITIONS`. Kept as the field's `named` refusals.
 */
export const ADVISORY_REFUSED_STATES = Object.freeze({});
/** The states `advisory_versions` writes in: a draft — a closed advisory is reopened to one first (header). */
export const ADVISORY_VERSIONS_STATES = Object.freeze(['draft']);

/** One release version as the versions row spells one: MAJOR.MINOR.PATCH, no leading zero, no pre-release or build tag. */
const RELEASE_VERSION = '(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})';
/** A release version, whole. */
export const ADVISORY_VERSION_SHAPE = new RegExp(`^${RELEASE_VERSION}$`);
/**
 * A `vulnerable_version_range` in the spelling of GitHub's own example (`>= 1.0.0, < 1.0.1`): ONE comparator — an
 * operator, one space, a release version — or a lower bound (`>`, `>=`) then an upper bound (`<`, `<=`), a comma and
 * a space between. `advisoryVersionEntryFailure` also requires a pair's bounds to rise.
 */
export const ADVISORY_VERSION_RANGE_SHAPE = new RegExp(`^(?:(?:<|<=|>|>=|=) ${RELEASE_VERSION}|(?:>|>=) ${RELEASE_VERSION}, (?:<|<=) ${RELEASE_VERSION})$`);
/** Release versions one `patched_versions` names, at most. */
export const MAX_ADVISORY_PATCHED_VERSIONS = 5;
/** A `patched_versions`: one release version (GitHub's example: `1.0.1`) or a few, a comma and a space between. */
export const ADVISORY_PATCHED_VERSIONS_SHAPE = new RegExp(`^${RELEASE_VERSION}(?:, ${RELEASE_VERSION}){0,${MAX_ADVISORY_PATCHED_VERSIONS - 1}}$`);
/** The keys one `versions` entry carries — exactly these three, each required (header). */
export const ADVISORY_VERSION_KEYS = Object.freeze(['package', 'vulnerable_version_range', 'patched_versions']);

/** Two release versions compared: negative, zero or positive. Pure; each must already be in `ADVISORY_VERSION_SHAPE`. */
export function compareReleaseVersions(a, b) {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const COMPARATOR = /^(<=|>=|<|>|=) (\S+)$/;
const COMPARATOR_HOLDS = Object.freeze({ '<': (d) => d < 0, '<=': (d) => d <= 0, '>': (d) => d > 0, '>=': (d) => d >= 0, '=': (d) => d === 0 });

/** A range in `ADVISORY_VERSION_RANGE_SHAPE` as its comparators, `[{ op, version }]`; null for any other value. Pure. */
export function advisoryRangeComparators(range) {
  if (typeof range !== 'string' || !ADVISORY_VERSION_RANGE_SHAPE.test(range)) return null;
  return range.split(', ').map((c) => {
    const [, op, version] = COMPARATOR.exec(c);
    return { op, version };
  });
}

/** Does a release version lie inside a range — every one of its comparators holding? Pure. */
export function inAdvisoryRange(version, comparators) {
  return comparators.every((c) => COMPARATOR_HOLDS[c.op](compareReleaseVersions(version, c.version)));
}

const describedQuietly = (v) =>
  typeof v === 'string' ? `a string of ${Buffer.byteLength(v, 'utf8')} byte(s)` : Array.isArray(v) ? `an array of ${v.length} item(s)` : v === null ? 'null' : isObject(v) ? 'an object' : typeof v;
const KEY_NAME_SHAPE = /^[a-z_]{1,40}$/;

/**
 * Why one `versions` entry is not one the relay sends, as a sentence whose subject is `where`, or null when it is
 * one (header): exactly `ADVISORY_VERSION_KEYS`; `package` an npm name (`NPM_PACKAGE_SHAPE`, at most
 * `MAX_NPM_PACKAGE_CHARS`); `vulnerable_version_range` in `ADVISORY_VERSION_RANGE_SHAPE`, a pair's lower bound below
 * its upper; `patched_versions` in `ADVISORY_PATCHED_VERSIONS_SHAPE`, each version once and none inside the entry's
 * own range. ⛔ The sentence never carries a value — a refusal reaches the public run log, and before the publish a
 * package and its versions are the unpublished advisory's; a key is named only in a key's shape. Pure; never throws.
 */
export function advisoryVersionEntryFailure(entry, where = 'the entry') {
  if (!isObject(entry) || Array.isArray(entry)) return `${where} must be an object of ${ADVISORY_VERSION_KEYS.join(', ')}, got ${describedQuietly(entry)}`;
  const extra = Object.keys(entry).filter((k) => !ADVISORY_VERSION_KEYS.includes(k));
  if (extra.length) return `${where} carries ${extra.map((k) => (KEY_NAME_SHAPE.test(k) ? k : '(a key not echoed)')).join(', ')} — an entry is exactly ${ADVISORY_VERSION_KEYS.join(', ')}`;
  const missing = ADVISORY_VERSION_KEYS.filter((k) => !Object.hasOwn(entry, k));
  if (missing.length) return `${where} has no ${missing.join(' or ')} — an entry carries all three`;
  const name = entry.package;
  if (typeof name !== 'string' || Buffer.byteLength(name, 'utf8') > MAX_NPM_PACKAGE_CHARS || !NPM_PACKAGE_SHAPE.test(name)) return `${where}.package must be an npm package name, got ${describedQuietly(name)} that is not one — not echoed`;
  const range = advisoryRangeComparators(entry.vulnerable_version_range);
  if (!range) {
    return `${where}.vulnerable_version_range must be one comparator, or a lower bound then an upper bound — an operator, one space and a release version each, as in ">= 1.0.0, < 1.0.1" — got ${describedQuietly(entry.vulnerable_version_range)} that is not one — not echoed`;
  }
  if (range.length === 2 && compareReleaseVersions(range[0].version, range[1].version) >= 0) return `${where}.vulnerable_version_range has a lower bound that is not below its upper bound`;
  const patched = entry.patched_versions;
  if (typeof patched !== 'string' || !ADVISORY_PATCHED_VERSIONS_SHAPE.test(patched)) {
    return `${where}.patched_versions must be one to ${MAX_ADVISORY_PATCHED_VERSIONS} release versions, a comma and a space between, as in "1.0.1" — got ${describedQuietly(patched)} that is not one — not echoed`;
  }
  const versions = patched.split(', ');
  if (new Set(versions).size !== versions.length) return `${where}.patched_versions names a version twice`;
  const inside = versions.filter((v) => inAdvisoryRange(v, range)).length;
  if (inside) return `${where}.patched_versions names ${inside} version(s) inside the entry's own vulnerable_version_range — a patched version is never a vulnerable one`;
  return null;
}

/** The `vulnerabilities` a versions PATCH sends for the action's entries: per entry the npm ecosystem, the name and the two strings. Pure. */
export function advisoryVersionsOnTheWire(versions) {
  return versions.map((v) => ({ package: { ecosystem: ADVISORY_CREATE_ECOSYSTEM, name: v.package }, vulnerable_version_range: v.vulnerable_version_range, patched_versions: v.patched_versions }));
}

/**
 * An advisory answer's `vulnerabilities`, as the versions row spells an entry: `{ total, entries, foreign, functions }`
 * — `entries` the npm entries naming a package, as `{ package, vulnerable_version_range, patched_versions }` exactly as
 * the platform answered them; `foreign` the count of entries of another ecosystem or naming no package; `functions` the
 * count carrying a non-empty `vulnerable_functions`. Pure; an answer with no list reads as none.
 */
export function advisoryVersionsOf(json) {
  const list = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities : [];
  const entries = [];
  let foreign = 0;
  let functions = 0;
  for (const v of list) {
    if (Array.isArray(v?.vulnerable_functions) && v.vulnerable_functions.length > 0) functions++;
    if (v?.package?.ecosystem !== ADVISORY_CREATE_ECOSYSTEM || typeof v.package.name !== 'string' || v.package.name === '') {
      foreign++;
      continue;
    }
    entries.push({ package: v.package.name, vulnerable_version_range: v.vulnerable_version_range ?? null, patched_versions: v.patched_versions ?? null });
  }
  return { total: list.length, entries, foreign, functions };
}

const versionKey = (v) => JSON.stringify([v?.package ?? null, v?.vulnerable_version_range ?? null, v?.patched_versions ?? null]);

/**
 * How two lists of entries differ, as a multiset — order is the platform's, never judged: `{ same, missing, extra }`,
 * `missing` the count of `want`'s entries `got` does not list, `extra` the count `got` lists beyond them. Pure.
 */
export function advisoryVersionsDiff(want = [], got = []) {
  const pool = new Map();
  for (const v of got) pool.set(versionKey(v), (pool.get(versionKey(v)) ?? 0) + 1);
  let missing = 0;
  for (const v of want) {
    const n = pool.get(versionKey(v)) ?? 0;
    if (n > 0) pool.set(versionKey(v), n - 1);
    else missing++;
  }
  const extra = [...pool.values()].reduce((a, b) => a + b, 0);
  return { same: missing === 0 && extra === 0, missing, extra };
}

const entriesText = (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`;
const packagesText = (entries) => {
  const n = new Set(entries.map((v) => v.package)).size;
  return `${n} package${n === 1 ? '' : 's'}`;
};
/** The severities a report or a draft may carry — GitHub's own enum for both. */
export const ADVISORY_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);
/** A weakness id as a report or a draft carries one, `CWE-` and a number. */
export const CWE_ID_SHAPE = /^CWE-[1-9][0-9]{0,4}$/;
/** GitHub's own login shape: what an advisory row prints of a login, and the only shape it prints one in. */
export const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** An advisory state as the platform spells one: what an advisory row prints of a state. */
export const ADVISORY_STATE_SHAPE = /^[a-z_]{1,20}$/;
/**
 * The platform `message`s an advisory row may quote on a refusal — a closed list, matched whole, because a
 * message is part of the answer's body, and the row prints nothing of that body it has not named (header).
 */
export const ADVISORY_PLATFORM_MESSAGES = Object.freeze(['Not Found', 'Resource not accessible by integration', 'Validation Failed', 'Forbidden', 'Bad credentials', 'Requires authentication']);

/**
 * What an advisory row may print of a value: the value when it has `shape` — the id's, a state's or a login's —
 * and otherwise a placeholder that names what the value failed to be, ⛔ never the value. So a field of an
 * advisory's answer reaches a row only in the shape of one of the three it may print. Pure.
 */
export function advisoryPrintable(value, shape, what) {
  return typeof value === 'string' && shape.test(value) ? value : `(not a${/^[aeiou]/.test(what) ? 'n' : ''} ${what})`;
}

/** The platform's `message` as an advisory row may quote it: ` (the platform: …)` for a listed one, else nothing. Pure. */
export function advisoryPlatformText(message) {
  return typeof message === 'string' && ADVISORY_PLATFORM_MESSAGES.includes(message) ? ` (the platform: ${message})` : '';
}

const printLogins = (logins) => (logins.length ? logins.map((l) => advisoryPrintable(l, LOGIN_SHAPE, 'login')).join(', ') : 'none');
const twoXX = (answer) => Number.isInteger(answer?.status) && answer.status >= 200 && answer.status < 300;
const advisoryShaped = (json) => isObject(json) && !Array.isArray(json);

/** The logins an advisory answer's `collaborating_users` lists, in the platform's order; `[]` for none or `null`. Pure. */
export function advisoryCollaboratorLogins(json) {
  return Array.isArray(json?.collaborating_users) ? json.collaborating_users.map((u) => (typeof u?.login === 'string' ? u.login : null)).filter(Boolean) : [];
}

/** What a refused advisory request prints after its status (header): the reading goes to the maintainer, ⛔ never a wider token. */
export const ADVISORY_ACCESS_REMEDY =
  'the relay token carries repository-advisories write for this stroke alone, and what the App may do to a report, ' +
  'a draft, its collaborators, its versions and its state is decided by the first live run — put this reading to the maintainer; ⛔ never ' +
  're-send it under a wider or un-narrowed token';

/**
 * The fences on the advisory (the header's section), each judged on the executor's own `GET` of it — `ctx` is
 * `{ ghsaId, answer, from, to, versions }`: `answer` that read's `{ status, json }`, `from` the states the action may
 * act in (`ADVISORY_OPEN_STATES` for the collaborators, `ADVISORY_VERSIONS_STATES` for the versions,
 * `ADVISORY_TRANSITIONS[to]` for a state change), `to` the state asked for, if any, and `versions` the versions row's
 * entries, if any. A target the transitions do not name has no `from` and fails closed. A fence whose read did not
 * answer an advisory FAILS, naming that — an unread fact is never a pass. `got` is built by `advisoryPrintable` and
 * counts alone: a fence sentence carries the id, the state, numbers and nothing else of the answer.
 */
const advisoryRead = (c) => c.answer?.status === 200 && advisoryShaped(c.answer.json);
const fromOf = (c) => (Array.isArray(c.from) ? c.from : c.to ? [] : ADVISORY_OPEN_STATES);
const setsVersions = (c) => Array.isArray(c.versions);
const publishes = (c) => c.to === ADVISORY_PUBLISHED_STATE;
export const ADVISORY_FENCES = Object.freeze([
  Object.freeze({
    fence: 'read',
    wants: () => "the advisory's own GET answering 200 with an advisory",
    fails: (c) => (advisoryRead(c) ? null : `the advisory's GET answered HTTP ${c.answer?.status ?? 'none'}${c.answer?.status === 200 ? ' with no advisory' : ''}`),
  }),
  Object.freeze({
    fence: 'advisory',
    wants: () => 'the advisory the action names, by its ghsa_id',
    fails: (c) => {
      if (!advisoryRead(c)) return 'not judged, because the advisory was not read';
      return c.answer.json.ghsa_id === c.ghsaId ? null : `the answer names ${advisoryPrintable(c.answer.json.ghsa_id, GHSA_ID_SHAPE, 'advisory id')}`;
    },
  }),
  Object.freeze({
    fence: 'state',
    wants: (c) => {
      if (!c.to) return `an unpublished advisory — state ${fromOf(c).join(' or ')}; never published, closed or withdrawn`;
      const to = advisoryPrintable(c.to, ADVISORY_STATE_SHAPE, 'advisory state');
      return fromOf(c).length ? `a move to ${to} from ${fromOf(c).join(' or ')} alone` : `no move to ${to} — the relay's transitions name none, so it fails closed`;
    },
    fails: (c) => {
      if (!advisoryRead(c)) return 'not judged, because the advisory was not read';
      return fromOf(c).includes(c.answer.json.state) ? null : `the advisory reads state ${advisoryPrintable(c.answer.json.state, ADVISORY_STATE_SHAPE, 'advisory state')}`;
    },
  }),
  // The versions (header): judged for the versions row, whose PATCH replaces the whole list, and for a publish, which
  // needs them set first; any other action passes it untouched. Counts alone — never a package name or a version.
  Object.freeze({
    fence: 'versions',
    wants: (c) =>
      setsVersions(c)
        ? 'a list the action may replace whole — every package the advisory lists named by the action, every listed entry an npm package with a name and no vulnerable_functions, which this row does not write and the PATCH would drop'
        : "versions set first — at least one vulnerabilities entry, every one an npm package with a vulnerable_version_range and patched_versions in the versions row's spelling",
    fails: (c) => {
      if (!setsVersions(c) && !publishes(c)) return null;
      if (!advisoryRead(c)) return 'not judged, because the advisory was not read';
      const listed = advisoryVersionsOf(c.answer.json);
      if (setsVersions(c)) {
        const named = new Set(c.versions.map((v) => v?.package));
        const dropped = new Set(listed.entries.map((v) => v.package).filter((name) => !named.has(name))).size;
        const lacks = [
          ...(listed.foreign ? [`${entriesText(listed.foreign)} of another ecosystem or naming no package`] : []),
          ...(listed.functions ? [`${entriesText(listed.functions)} carrying vulnerable_functions`] : []),
          ...(dropped ? [`${dropped} listed package(s) the action does not name`] : []),
        ];
        return lacks.length ? `the advisory lists ${entriesText(listed.total)}: ${lacks.join('; ')}` : null;
      }
      if (listed.total === 0) return 'the advisory lists no vulnerabilities entry';
      const unspelled = listed.foreign + listed.entries.filter((v) => advisoryVersionEntryFailure(v) !== null).length;
      return unspelled ? `${unspelled} of the advisory's ${entriesText(listed.total)} carry no npm package, version range or patched versions in the versions row's spelling` : null;
    },
  }),
]);

/** The fences `ctx` fails: `[{ fence, wants, got }]` in `ADVISORY_FENCES` order; `[]` when all hold. Pure. */
export function advisoryFenceFailures(ctx = {}) {
  return ADVISORY_FENCES.map((f) => ({ fence: f.fence, wants: f.wants(ctx), got: f.fails(ctx) })).filter((f) => f.got !== null);
}

/** The sentence an advisory fence refusal prints — every failing fence by name, what was read, what the relay writes to. Pure. */
export function advisoryFenceText(failures) {
  return failures.map((f) => `fence \`${f.fence}\`: ${f.got}, and the relay writes only to ${f.wants}`).join('; ');
}

/**
 * The PATCH's list (the header's section): `existing` the logins `collaborating_users` reads, `requested` the
 * action's. Answers `{ existing, missing, merged }` — `missing` the requested logins not already there, compared
 * case-insensitively and each once, in the action's order and spelling; `merged` the existing logins as the
 * platform lists them, then the missing ones: the whole list the PATCH sends, so an existing collaborator is
 * never dropped by omission. `missing` empty is the no-op. Pure.
 */
export function advisoryCollaboratorPlan({ existing = [], requested = [] } = {}) {
  const have = new Set(existing.map((l) => l.toLowerCase()));
  const missing = [];
  for (const login of requested) {
    if (have.has(login.toLowerCase())) continue;
    have.add(login.toLowerCase());
    missing.push(login);
  }
  return { existing: [...existing], missing, merged: [...existing, ...missing] };
}

/**
 * What LANDED means for `advisory_collaborators_add` (the header's section): the PATCH answered 2xx with an
 * advisory whose `collaborating_users` lists every login sent — each `missing` one added, and each `existing` one
 * kept. `answer` is the PATCH's `{ status, json }`. Answers `{ ok, listed, notAdded, dropped, why }`; `why` names
 * logins alone. Pure.
 */
export function advisoryReadBack({ existing = [], missing = [], answer } = {}) {
  const listed = advisoryCollaboratorLogins(answer?.json);
  const has = (login) => listed.some((l) => l.toLowerCase() === login.toLowerCase());
  const notAdded = missing.filter((l) => !has(l));
  const dropped = existing.filter((l) => !has(l));
  if (!twoXX(answer)) return { ok: false, listed, notAdded, dropped, why: `HTTP ${answer?.status ?? 'none'}` };
  if (!advisoryShaped(answer.json)) return { ok: false, listed, notAdded, dropped, why: `HTTP ${answer.status}, but the answer is not an advisory, so no collaborator can be read back` };
  const lacks = [
    ...(notAdded.length ? [`${printLogins(notAdded)} not added`] : []),
    ...(dropped.length ? [`${printLogins(dropped)} dropped — a collaborator before this PATCH and missing from its answer`] : []),
  ];
  if (lacks.length) return { ok: false, listed, notAdded, dropped, why: `HTTP ${answer.status}, but the answer lists ${printLogins(listed)} — ${lacks.join('; ')}` };
  return { ok: true, listed, notAdded, dropped, why: '' };
}

/**
 * The row a landed `advisory_collaborators_add` prints — the id, the state and the logins, and nothing else of
 * the answer, each in its own shape (`advisoryPrintable`). `noop` an action that sent nothing: every login was
 * already there. Pure.
 */
export function advisoryLandedText({ ghsaId, state, logins = [], added = [], noop = false }) {
  const head = `${advisoryPrintable(ghsaId, GHSA_ID_SHAPE, 'advisory id')} · state ${advisoryPrintable(state, ADVISORY_STATE_SHAPE, 'advisory state')} · collaborators ${printLogins(logins)}`;
  return noop ? `no-op, nothing sent: ${head} — every login asked for is already a collaborator` : `${head} · added ${printLogins(added)}`;
}

/**
 * What LANDED means for `advisory_state` (the header's section): the PATCH answered 2xx with the advisory the
 * action names, in the state it asked for — and, for a publish, listing exactly `versions`, the entries the
 * preflight's GET read: the advisory read back as `published`, with the versions it was sent. Answers
 * `{ ok, why, ghsaId?, entries? }` — `ghsaId` and `entries` (the count) on a landed publish alone, for its row and
 * its annotation; `why` carries the id, the state and counts alone. Pure.
 */
export function advisoryStateReadBack({ ghsaId, to, answer, versions = [] } = {}) {
  if (!twoXX(answer)) return { ok: false, why: `HTTP ${answer?.status ?? 'none'}` };
  if (!advisoryShaped(answer.json)) return { ok: false, why: `HTTP ${answer.status}, but the answer is not an advisory, so its state cannot be read back` };
  if (answer.json.ghsa_id !== ghsaId) return { ok: false, why: `HTTP ${answer.status}, but the answer names ${advisoryPrintable(answer.json.ghsa_id, GHSA_ID_SHAPE, 'advisory id')}` };
  if (answer.json.state !== to) return { ok: false, why: `HTTP ${answer.status}, but the answer reads state ${advisoryPrintable(answer.json.state, ADVISORY_STATE_SHAPE, 'advisory state')}, not ${to}` };
  if (to !== ADVISORY_PUBLISHED_STATE) return { ok: true, why: '' };
  const listed = advisoryVersionsOf(answer.json);
  const diff = advisoryVersionsDiff(versions, listed.entries);
  if (listed.foreign || !diff.same) {
    return { ok: false, why: `HTTP ${answer.status}, the answer reads state ${to}, but it lists ${entriesText(listed.total)} — ${diff.missing} of the ${entriesText(versions.length)} read before the publish missing, ${diff.extra + listed.foreign} other` };
  }
  return { ok: true, why: '', ghsaId, entries: listed.total };
}

/** The row a landed `advisory_state` prints: the id and the move, and for a publish the count of entries — nothing else. Pure. */
export function advisoryStateLandedText({ ghsaId, from, to, entries = null }) {
  const head = `${advisoryPrintable(ghsaId, GHSA_ID_SHAPE, 'advisory id')} · state ${advisoryPrintable(from, ADVISORY_STATE_SHAPE, 'advisory state')} → ${advisoryPrintable(to, ADVISORY_STATE_SHAPE, 'advisory state')}`;
  return Number.isInteger(entries) ? `${head} · ${entriesText(entries)}, each with its versions` : head;
}

/**
 * What LANDED means for `advisory_versions` (the header's section): the PATCH answered 2xx with the advisory the
 * action names, still `draft`, listing exactly the entries sent — order is the platform's. Answers
 * `{ ok, why, entries }`; `why` carries the id, the state and counts alone, ⛔ never a name or a version. Pure.
 */
export function advisoryVersionsReadBack({ ghsaId, sent = [], answer } = {}) {
  if (!twoXX(answer)) return { ok: false, why: `HTTP ${answer?.status ?? 'none'}` };
  if (!advisoryShaped(answer.json)) return { ok: false, why: `HTTP ${answer.status}, but the answer is not an advisory, so its versions cannot be read back` };
  if (answer.json.ghsa_id !== ghsaId) return { ok: false, why: `HTTP ${answer.status}, but the answer names ${advisoryPrintable(answer.json.ghsa_id, GHSA_ID_SHAPE, 'advisory id')}` };
  if (!ADVISORY_VERSIONS_STATES.includes(answer.json.state)) {
    return { ok: false, why: `HTTP ${answer.status}, but the answer reads state ${advisoryPrintable(answer.json.state, ADVISORY_STATE_SHAPE, 'advisory state')}, not ${ADVISORY_VERSIONS_STATES.join(' or ')}` };
  }
  const listed = advisoryVersionsOf(answer.json);
  const diff = advisoryVersionsDiff(sent, listed.entries);
  if (listed.foreign || !diff.same) {
    return { ok: false, why: `HTTP ${answer.status}, but the answer lists ${entriesText(listed.total)} — ${diff.missing} of the ${entriesText(sent.length)} sent missing or answered in another spelling, ${diff.extra + listed.foreign} other` };
  }
  return { ok: true, why: '', entries: listed.total };
}

/** The row a landed `advisory_versions` prints: the id, the state and counts — never a package name or a version. Pure. */
export function advisoryVersionsLandedText({ ghsaId, state, versions = [] }) {
  return `${advisoryPrintable(ghsaId, GHSA_ID_SHAPE, 'advisory id')} · state ${advisoryPrintable(state, ADVISORY_STATE_SHAPE, 'advisory state')} · versions set: ${entriesText(versions.length)} across ${packagesText(versions)}`;
}

/**
 * What LANDED means for `advisory_report` (the header's section): a 2xx whose answer carries a `ghsa_id` in its
 * shape. Answers `{ ok, ghsaId, state, why }` — `ghsaId` null unless it has that shape; `why` carries the status
 * alone. A 2xx without an id is NOT a landing and NOT a refusal: a report may have been filed, so ⛔ never re-sent.
 * Pure.
 */
export function advisoryReportReadBack(answer) {
  const json = answer?.json;
  const ghsaId = advisoryShaped(json) && typeof json.ghsa_id === 'string' && GHSA_ID_SHAPE.test(json.ghsa_id) ? json.ghsa_id : null;
  const state = advisoryShaped(json) ? json.state : null;
  if (!twoXX(answer)) return { ok: false, ghsaId: null, state: null, why: `HTTP ${answer?.status ?? 'none'}` };
  if (!ghsaId) return { ok: false, ghsaId, state, why: `HTTP ${answer.status}, but the answer carries no advisory id — UNCONFIRMED: a report may have been filed; ⛔ do not re-send, ask the maintainer to read the repository's reports` };
  return { ok: true, ghsaId, state, why: '' };
}

/** The row a landed `advisory_report` prints: the id the platform gave it and its state, and the next stroke. Pure. */
export function advisoryReportLandedText({ ghsaId, state }) {
  return `reported ${advisoryPrintable(ghsaId, GHSA_ID_SHAPE, 'advisory id')} · state ${advisoryPrintable(state, ADVISORY_STATE_SHAPE, 'advisory state')} — add whoever works it with advisory_collaborators_add`;
}

/** The one state a created advisory may answer in — the endpoint's default, and the only one a draft has. */
export const ADVISORY_CREATED_STATE = 'draft';

/**
 * What LANDED means for `advisory_create` (the header's section): a 2xx whose answer carries a `ghsa_id` in its shape
 * AND reads state `draft`. Answers `{ ok, ghsaId, state, why }`. A 2xx without an id is UNCONFIRMED — a draft may
 * have been created, so ⛔ never re-sent; a 2xx whose id reads any other state is a FAILED action naming the id and
 * that state, in their shapes alone. Pure.
 */
export function advisoryCreateReadBack(answer) {
  const json = answer?.json;
  const ghsaId = advisoryShaped(json) && typeof json.ghsa_id === 'string' && GHSA_ID_SHAPE.test(json.ghsa_id) ? json.ghsa_id : null;
  const state = advisoryShaped(json) ? json.state : null;
  if (!twoXX(answer)) return { ok: false, ghsaId: null, state: null, why: `HTTP ${answer?.status ?? 'none'}` };
  if (!ghsaId) return { ok: false, ghsaId, state, why: `HTTP ${answer.status}, but the answer carries no advisory id — UNCONFIRMED: a draft advisory may have been created; ⛔ do not re-send, ask the maintainer to read the repository's draft advisories` };
  if (state !== ADVISORY_CREATED_STATE) return { ok: false, ghsaId, state, why: `HTTP ${answer.status}, but ${ghsaId} reads state ${advisoryPrintable(state, ADVISORY_STATE_SHAPE, 'advisory state')}, not ${ADVISORY_CREATED_STATE} — ⛔ do not re-send, put the id to the maintainer` };
  return { ok: true, ghsaId, state, why: '' };
}

/** The row a landed `advisory_create` prints: the id the platform gave it and its state, and the next stroke. Pure. */
export function advisoryCreateLandedText({ ghsaId, state }) {
  return `created ${advisoryPrintable(ghsaId, GHSA_ID_SHAPE, 'advisory id')} · state ${advisoryPrintable(state, ADVISORY_STATE_SHAPE, 'advisory state')} — add whoever works it with advisory_collaborators_add`;
}

// ---------------------------------------------------------------------------
// `advisory_read` (header: "The one row that READS an advisory") — the key, the seal, the parts, the fences.
// ---------------------------------------------------------------------------

/** The one key type `public_key` names: X25519, as base64 SPKI DER. */
export const ADVISORY_READ_KEY_TYPE = 'x25519';
/** X25519's SPKI DER header: the 12 bytes before the 32-byte key, `MCowBQYDK2VuAyEA` in base64. */
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_RAW_BYTES = 32;
/** `public_key`'s length: 44 bytes of DER, 60 base64 characters with their one pad. */
export const ADVISORY_READ_PUBLIC_KEY_CHARS = 60;
/** `public_key`'s one spelling: the header, then the key, its last character's two spare bits clear, then the pad. */
export const ADVISORY_READ_PUBLIC_KEY_SHAPE = /^MCowBQYDK2VuAyEA[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

const allZero = (buf) => buf.every((b) => b === 0);

/**
 * Why `value` is not a `public_key`, or null when it is one: a string of exactly
 * `ADVISORY_READ_PUBLIC_KEY_CHARS` characters in `ADVISORY_READ_PUBLIC_KEY_SHAPE`, parsed as an X25519 key, with
 * which a trial derivation yields a non-zero secret — a low-order point, the all-zero key among them, is refused
 * here. ⛔ The reason never carries the value: the validator prints it into a public log. Never throws.
 */
export function advisoryReadKeyFailure(value) {
  if (typeof value !== 'string') return 'is not a string';
  if (value.length !== ADVISORY_READ_PUBLIC_KEY_CHARS) return `is not ${ADVISORY_READ_PUBLIC_KEY_CHARS} characters long`;
  if (!ADVISORY_READ_PUBLIC_KEY_SHAPE.test(value)) return 'is not an X25519 public key in base64 SPKI DER, its one spelling';
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return 'does not parse as a public key';
  }
  if (key.asymmetricKeyType !== ADVISORY_READ_KEY_TYPE) return 'is not an X25519 key';
  let shared = null;
  try {
    shared = diffieHellman({ privateKey: generateKeyPairSync(ADVISORY_READ_KEY_TYPE).privateKey, publicKey: key });
    return allZero(shared) ? 'is a key no secret can be derived with (a low-order point)' : null;
  } catch {
    return 'is a key no secret can be derived with (a low-order point)';
  } finally {
    shared?.fill(0);
  }
}

/** The sealed answer's format version — its first byte. */
export const ADVISORY_READ_SEAL_VERSION = 1;
/** The scheme, named once for a reader: what `sealAdvisoryRead` does and `openAdvisoryRead` undoes. */
export const ADVISORY_READ_SCHEME = 'X25519 key agreement · HKDF-SHA256 · AES-256-GCM, a fresh ephemeral key and nonce per seal';
const ADVISORY_READ_INFO = 'fleet-write:advisory_read:v1';
const ADVISORY_READ_NONCE_BYTES = 12;
const ADVISORY_READ_TAG_BYTES = 16;
/** What a seal adds to the plaintext: the version byte, the ephemeral key, the nonce and the tag — 61 bytes. */
export const ADVISORY_READ_SEAL_OVERHEAD = 1 + X25519_RAW_BYTES + ADVISORY_READ_NONCE_BYTES + ADVISORY_READ_TAG_BYTES;

const rawX25519 = (key) => key.export({ format: 'der', type: 'spki' }).subarray(X25519_SPKI_PREFIX.length);
const x25519FromRaw = (raw) => createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
/** The AES key, from the shared secret and both public keys; an all-zero secret is refused, never used. */
function advisoryReadAesKey(shared, ephemeralRaw, recipientRaw) {
  if (allZero(shared)) throw new Error('the shared secret is all zeros');
  const info = Buffer.concat([Buffer.from(ADVISORY_READ_INFO, 'utf8'), ephemeralRaw, recipientRaw]);
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), info, 32));
}

/**
 * The associated data a sealed answer is bound to: the request id, the action's index and the advisory's id. The
 * seat knows all three, so it opens the answer to ITS read and no other; none of them is sent. Pure.
 */
export function advisoryReadAad({ requestId, action, ghsaId }) {
  return Buffer.from(`${ADVISORY_READ_INFO} request=${requestId} action=${action} ghsa_id=${ghsaId}`, 'utf8');
}

/**
 * Seal `plaintext` (a string, sealed as its UTF-8 bytes) to `publicKey` (a `public_key` value) under `aad`:
 * version ‖ ephemeral X25519 key ‖ nonce ‖ ciphertext ‖ tag, as base64url without padding. The shared secret
 * and the AES key are zeroed after use. Throws on any failure, with a message that carries nothing of the
 * plaintext — and the executor prints its own fixed sentence, never the message.
 */
export function sealAdvisoryRead({ plaintext, publicKey, aad }) {
  const recipient = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  const ephemeral = generateKeyPairSync(ADVISORY_READ_KEY_TYPE);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const ephemeralRaw = rawX25519(ephemeral.publicKey);
  let key = null;
  try {
    key = advisoryReadAesKey(shared, ephemeralRaw, rawX25519(recipient));
    const nonce = randomBytes(ADVISORY_READ_NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: ADVISORY_READ_TAG_BYTES });
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return Buffer.concat([Buffer.from([ADVISORY_READ_SEAL_VERSION]), ephemeralRaw, nonce, body, cipher.getAuthTag()]).toString('base64url');
  } finally {
    shared.fill(0);
    key?.fill(0);
  }
}

/** Why a sealed answer did not open — the one sentence, which carries nothing of what was sealed. */
export const ADVISORY_READ_OPEN_FAILED = 'the sealed answer does not open with this key — tampered, truncated, or sealed for another read';
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Open a sealed answer with `privateKey` (the seat's in-memory `KeyObject`) under `aad`: the plaintext string,
 * byte for byte what was sealed. Throws `ADVISORY_READ_OPEN_FAILED` for anything else — a sealed answer that is
 * not canonical base64url, of another version, too short, tampered with, sealed to another key or bound to
 * another read. The private key is read, never exported.
 */
export function openAdvisoryRead({ sealed, privateKey, aad }) {
  const box = typeof sealed === 'string' && /^[A-Za-z0-9_-]+$/.test(sealed) ? Buffer.from(sealed, 'base64url') : null;
  if (!box || box.toString('base64url') !== sealed || box.length < ADVISORY_READ_SEAL_OVERHEAD || box[0] !== ADVISORY_READ_SEAL_VERSION) throw new Error(ADVISORY_READ_OPEN_FAILED);
  const ephemeralRaw = box.subarray(1, 1 + X25519_RAW_BYTES);
  const nonce = box.subarray(1 + X25519_RAW_BYTES, 1 + X25519_RAW_BYTES + ADVISORY_READ_NONCE_BYTES);
  const body = box.subarray(1 + X25519_RAW_BYTES + ADVISORY_READ_NONCE_BYTES, box.length - ADVISORY_READ_TAG_BYTES);
  const tag = box.subarray(box.length - ADVISORY_READ_TAG_BYTES);
  let shared = null;
  let key = null;
  let opened = null;
  try {
    shared = diffieHellman({ privateKey, publicKey: x25519FromRaw(ephemeralRaw) });
    key = advisoryReadAesKey(shared, ephemeralRaw, rawX25519(createPublicKey(privateKey)));
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: ADVISORY_READ_TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    opened = strictUtf8.decode(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    opened = null;
  } finally {
    shared?.fill(0);
    key?.fill(0);
  }
  if (opened === null) throw new Error(ADVISORY_READ_OPEN_FAILED);
  return opened;
}

/**
 * The fields of an advisory's answer `advisory_read` seals, copied as the platform answered them — the text the
 * card names (summary, description, vulnerabilities) and what places it (the ids, the state, the severity, the
 * weakness ids, the credits). Not `collaborating_users`, whose user objects are kilobytes of URLs each, nor any
 * URL, timestamp or private fork.
 */
export const ADVISORY_READ_FIELDS = Object.freeze(['ghsa_id', 'cve_id', 'state', 'severity', 'summary', 'description', 'vulnerabilities', 'cwe_ids', 'credits']);

/** What is sealed: `ADVISORY_READ_FIELDS` of the answer that it carries, in that order, as one JSON text. Pure. */
export function advisoryReadPlaintext(json) {
  const picked = {};
  for (const field of ADVISORY_READ_FIELDS) if (Object.hasOwn(json, field)) picked[field] = json[field];
  return JSON.stringify(picked);
}

/** The characters one notice part carries — under the runner's 4,096-character cut, with room for its prefix. */
export const ADVISORY_READ_PART_CHARS = 4000;
/** The most parts a read emits — the runner keeps ten notices a step, and a read's stroke emits no other. */
export const ADVISORY_READ_MAX_PARTS = 10;
/** The most sealed characters a read can return, and so the largest answer: 40,000 characters, 29,939 bytes of plaintext. */
export const ADVISORY_READ_MAX_SEALED_CHARS = ADVISORY_READ_PART_CHARS * ADVISORY_READ_MAX_PARTS;

/** A sealed answer cut into its parts, in order; null when it is empty or over `ADVISORY_READ_MAX_SEALED_CHARS`. Pure. */
export function advisoryReadParts(sealed) {
  if (typeof sealed !== 'string' || sealed.length === 0 || sealed.length > ADVISORY_READ_MAX_SEALED_CHARS) return null;
  const parts = [];
  for (let at = 0; at < sealed.length; at += ADVISORY_READ_PART_CHARS) parts.push(sealed.slice(at, at + ADVISORY_READ_PART_CHARS));
  return parts;
}

/**
 * The sender gates a read may be held to (header) — the row's `senderGate` is a key of this table. One, by the
 * maintainer's ruling: `target-write`, the gate every stroke already passed, write, maintain or admin on the
 * target, and nothing more. The table stays so that a row naming any other value fails closed.
 */
export const ADVISORY_READ_SENDER_GATES = Object.freeze({
  'target-write': 'a sender with write, maintain or admin on the target',
});

/**
 * The fences on a read, each judged on the executor's own GET — `ctx` is `{ ghsaId, answer, gate }`. A fence
 * whose read did not answer an advisory FAILS, naming that. ⛔ No sentence carries the answer's id, its state,
 * any field of it or the gate's value: an answer naming another advisory is said to, and no more.
 */
const readGateOf = (c) => (Object.hasOwn(ADVISORY_READ_SENDER_GATES, c.gate) ? c.gate : null);
export const ADVISORY_READ_FENCES = Object.freeze([
  Object.freeze({
    fence: 'read',
    wants: () => "the advisory's own GET answering 200 with an advisory",
    fails: (c) => (advisoryRead(c) ? null : `the advisory's GET answered HTTP ${c.answer?.status ?? 'none'}${c.answer?.status === 200 ? ' with no advisory' : ''}`),
  }),
  Object.freeze({
    fence: 'advisory',
    wants: () => 'the advisory the action names, by its ghsa_id',
    fails: (c) => {
      if (!advisoryRead(c)) return 'not judged, because the advisory was not read';
      return c.answer.json.ghsa_id === c.ghsaId ? null : 'the answer names another advisory';
    },
  }),
  Object.freeze({
    fence: 'sender',
    wants: (c) => ADVISORY_READ_SENDER_GATES[readGateOf(c)] ?? 'a sender gate the table names',
    // `target-write` was judged before this GET, on the stroke (header), so it asks nothing of the answer; any other value is closed.
    fails: (c) => (readGateOf(c) === 'target-write' ? null : 'the row names no sender gate the table knows, so no read is sealed'),
  }),
]);

/** The read fences `ctx` fails: `[{ fence, wants, got }]` in `ADVISORY_READ_FENCES` order; `[]` when all hold. Pure. */
export function advisoryReadFenceFailures(ctx = {}) {
  return ADVISORY_READ_FENCES.map((f) => ({ fence: f.fence, wants: f.wants(ctx), got: f.fails(ctx) })).filter((f) => f.got !== null);
}

/** The sentence a read fence refusal prints — every failing fence, what was read, what the relay seals for. Pure. */
export function advisoryReadFenceText(failures) {
  return failures.map((f) => `fence \`${f.fence}\`: ${f.got}, and the relay seals only for ${f.wants}`).join('; ');
}

/** The call a read's row and log print — the path with the id left out, ⛔ never the path itself (header). Pure. */
export function advisoryReadCall(repo) {
  return `GET /repos/${repo}/security-advisories/{ghsa_id}`;
}

/** What a refused read prints after its status: the grant is the first live read's to measure, ⛔ never widened by hand. */
export const ADVISORY_READ_ACCESS_REMEDY =
  'the relay token carries repository-advisories READ for this stroke alone — GitHub documents this read under it, and the ' +
  'first live read measures it; put this reading to the maintainer, whose ruling it is to raise the row to write — ⛔ never ' +
  're-send it under a wider or un-narrowed token';

/** What a read whose seal failed prints: nothing of the answer, and no part emitted. */
export const ADVISORY_READ_SEAL_FAILED = 'the seal failed, so nothing of the answer was emitted — ⛔ the text never leaves another way; re-send the read with a fresh key';

/**
 * What a read whose GET never reached the platform prints — `rest` answers status 0 when the call threw before any
 * answer — and the status its row carries in place of a number. The platform judged nothing, so there is no HTTP
 * status to print and no grant to remedy (`ADVISORY_READ_ACCESS_REMEDY` is a refusal's, and none came); ⛔ nor the
 * exception's message, which can carry the request's path and so the id.
 */
export const ADVISORY_READ_UNREACHED =
  "REFUSED before any fence: the advisory's GET did not reach the platform (the runner's call threw before any answer), so no grant, " +
  'advisory or sender was judged and nothing was sealed or emitted — re-send the read with a fresh key';
export const ADVISORY_READ_UNREACHED_STATUS = 'not reached';

/** What a read too large for the channel prints: the counts, and nothing of the answer. Pure. */
export function advisoryReadOverCapText({ plaintextBytes, sealedChars }) {
  return (
    `the sealed answer is ${sealedChars} character(s) (${plaintextBytes} byte(s) of the answer), over the ${ADVISORY_READ_MAX_SEALED_CHARS} the run's ` +
    `notices carry (${ADVISORY_READ_MAX_PARTS} of ${ADVISORY_READ_PART_CHARS}) — nothing was emitted; ⛔ the text never leaves another way, put the reading to the maintainer`
  );
}

/** The row a landed read prints: counts alone — ⛔ no id, no state, no field. Pure. */
export function advisoryReadLandedText({ plaintextBytes, sealedChars, parts }) {
  return `sealed ${plaintextBytes} byte(s) of the answer to the seat's one-time key — ${sealedChars} character(s) in ${parts} notice part(s), which only that seat's process opens`;
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
/** The one branch name `mailbox_branch_delete` takes — `claude/mailbox-` and a lower-case slug, no `/` (header). */
export const MAILBOX_BRANCH_SHAPE = /^claude\/mailbox-[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** The label a mailbox PR carries — `mailbox-open.mjs` re-exports it, so it has one spelling. */
export const MAILBOX_LABEL = 'pm:mailbox';
/** Names per list-valued key; ten assignees is the platform's own cap, twenty labels is ours. */
export const MAX_LABELS_PER_ACTION = 20;
export const MAX_LOGINS_PER_ACTION = 10;
/** A private report's `summary` — GitHub's own cap of 1,024 characters, held in bytes, which is never more. */
export const MAX_ADVISORY_SUMMARY_BYTES = 1024;
/** A private report's `description` — the body cap; GitHub's own is 65,535 characters, past the payload's ceiling. */
export const MAX_ADVISORY_DESCRIPTION_BYTES = MAX_BODY_BYTES;
/** Weakness ids per report, and the longest one (`CWE-` and five digits). */
export const MAX_CWE_IDS = 10;
export const MAX_CWE_ID_CHARS = 9;
/** Packages per draft advisory — one `vulnerabilities` entry each — and the registry's own cap on a name. */
export const MAX_ADVISORY_PACKAGES = 10;
export const MAX_NPM_PACKAGE_CHARS = 214;
/** Entries per `advisory_versions` — a package may take more than one, one per release line it was fixed on. */
export const MAX_ADVISORY_VERSION_ENTRIES = 10;

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
 *           values are then judged against the row's `closedInputs` entry;
 *   `ghsa`  one repository advisory's id, `GHSA_ID_SHAPE` exactly — it is
 *           spelled into a path; a refusal names the shape and never echoes
 *           the value, which a public run log would otherwise carry;
 *   `x25519` one X25519 public key, base64 SPKI DER in its one spelling,
 *           judged by `advisoryReadKeyFailure` (header: "The one row that
 *           READS an advisory") — a refusal names the key, the byte count and
 *           what the value failed to be, and never echoes it;
 *   `versions` an array of 1..`max` closed entries — exactly `package`,
 *           `vulnerable_version_range` and `patched_versions` — each judged by
 *           `advisoryVersionEntryFailure` (header: "The rows that write a
 *           security advisory"), no entry twice; a refusal names the entry and
 *           the key, ⛔ never a value.
 *
 * Two modifiers, both for the advisory rows (header: "The rows that write
 * a security advisory"): `shape` holds each item of a `list` to a
 * pattern, named by `itemWhat`; `quiet` makes an `enum` or `list` refusal
 * describe a failing value by its type and size, ⛔ never echo it — a value in
 * the wrong key may be an advisory's prose, and a refusal reaches the public
 * run log. `named` is an `enum`'s values refused BY NAME, each with its
 * reason. A `str` refusal never echoes, so `summary` and `description` need
 * neither; `shape` on a `str` holds it to a pattern, named by `what`
 * (`branch`, `mailbox_branch_delete`'s, alone).
 */
export const FIELDS = Object.freeze({
  issue: Object.freeze({ kind: 'int' }),
  pull: Object.freeze({ kind: 'int' }),
  comment_id: Object.freeze({ kind: 'int' }),
  body: Object.freeze({ kind: 'str', max: MAX_BODY_BYTES }),
  title: Object.freeze({ kind: 'str', max: MAX_TITLE_BYTES }),
  head: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  base: Object.freeze({ kind: 'str', max: MAX_REF_BYTES }),
  branch: Object.freeze({ kind: 'str', max: MAX_REF_BYTES, shape: MAILBOX_BRANCH_SHAPE, what: 'a claude/mailbox-* branch — claude/mailbox- and a lower-case slug' }),
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
  // The child of a hierarchy link, by NUMBER — the executor resolves its REST id (header: "The two rows that write an issue's hierarchy").
  sub_issue: Object.freeze({ kind: 'int' }),
  // The advisory rows' keys (header: "The rows that write a security advisory"). A report's or a draft's prose is
  // `summary` and `description`, read from the event file and printed nowhere; every other key is quiet.
  summary: Object.freeze({ kind: 'str', max: MAX_ADVISORY_SUMMARY_BYTES }),
  description: Object.freeze({ kind: 'str', max: MAX_ADVISORY_DESCRIPTION_BYTES }),
  severity: Object.freeze({ kind: 'enum', values: ADVISORY_SEVERITIES, quiet: true }),
  cwe_ids: Object.freeze({ kind: 'list', max: MAX_CWE_IDS, itemMax: MAX_CWE_ID_CHARS, shape: CWE_ID_SHAPE, itemWhat: 'a weakness id, CWE- and a number', quiet: true }),
  // A draft's affected packages, by npm name alone — each one `vulnerabilities` entry, never a version range.
  packages: Object.freeze({ kind: 'list', max: MAX_ADVISORY_PACKAGES, itemMax: MAX_NPM_PACKAGE_CHARS, shape: NPM_PACKAGE_SHAPE, itemWhat: 'an npm package name', quiet: true }),
  ghsa_id: Object.freeze({ kind: 'ghsa' }),
  collaborators: Object.freeze({ kind: 'list', max: MAX_LOGINS_PER_ACTION, itemMax: MAX_LOGIN_CHARS, shape: LOGIN_SHAPE, itemWhat: 'a GitHub login', quiet: true }),
  // The versions row's entries — a package and its two version strings each, no prose; quiet like every advisory key.
  versions: Object.freeze({ kind: 'versions', max: MAX_ADVISORY_VERSION_ENTRIES, quiet: true }),
  advisory_state: Object.freeze({ kind: 'enum', values: ADVISORY_SETTABLE_STATES, quiet: true, named: ADVISORY_REFUSED_STATES }),
  // The seat's one-time public key for ONE read (header: "The one row that READS an advisory") — its own kind.
  public_key: Object.freeze({ kind: 'x25519' }),
});

/**
 * The App permissions the relay token is narrowed to — the union of every
 * row's `permission` and `alsoSpends`, plus the sender gate's read.
 * `contents: write` is spent by the two auto-merge rows (GitHub's
 * requirement for those mutations) and `mailbox_branch_delete`'s one ref
 * DELETE (header); no row writes a file or creates or moves a ref —
 * `pr_update_branch`'s merge is the platform's, under `pull-requests`. `workflows: write` is spent by the `automerge_enable` row
 * alone (`alsoSpends`: a pull changing `.github/workflows/**` is enqueued only
 * by a token carrying it), a literal grant on every stroke by the
 * maintainer's ruling, comment 6104822731 (header). `actions: write` is spent
 * by the `workflow_dispatch` and `run_rerun_failed` rows alone, and minted
 * only for a stroke carrying one of them (`STROKE_SCOPED_PERMISSIONS`).
 * `repository-advisories: write` is spent by the five advisory rows that
 * write alone, and minted only for a stroke carrying one of them, the same
 * way; `advisory_read` spends that grant at `read` (its row's `grant`), so a
 * read's stroke is minted the lower level and never write.
 */
export const PERMISSIONS = Object.freeze({ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write', 'repository-advisories': 'write' });

/**
 * The permissions minted ONLY for a stroke carrying an op that spends them —
 * `actions: write`, the `workflow_dispatch` and `run_rerun_failed` rows'
 * alone, and `repository-advisories`, the six advisory rows' alone — at
 * write, or at the row's `grant` (`advisory_read`'s `read`); each of those
 * rows travels alone in its stroke. `validate.mjs`
 * computes a stroke's permission set (`tokenPermissionsOf`) and writes each of
 * these to `$GITHUB_OUTPUT` as `permission_<name>=<level>` or empty (a hyphen
 * in the name spelled `_`); the workflow's mint step reads that output for
 * exactly these inputs, and `actions/create-github-app-token` skips an empty
 * `permission-*` input (`lib/get-permissions-from-inputs.js`: an empty value
 * returns the set unchanged), so every other stroke's token carries the
 * literal grants alone.
 */
export const STROKE_SCOPED_PERMISSIONS = Object.freeze(['actions', 'repository-advisories']);

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
 *   `grant`       (optional) the level the row spends it at, when lower than
 *                 `PERMISSIONS` holds — `advisory_read`'s `read` alone, on a
 *                 stroke-scoped permission (header above);
 *   `senderGate`  (optional) the sender gate a read is held to —
 *                 `advisory_read`'s, a key of `ADVISORY_READ_SENDER_GATES`
 *                 (header above); any other value fails closed;
 *   `required`    keys that must be present;
 *   `optional`    keys that may be; anything else on the action is refused;
 *   `atLeastOne`  (optional) of these keys, at least one must be present;
 *   `secondRepo`  (optional) the key naming a SECOND repository the token
 *                 must reach — `transfer`'s alone (header above);
 *   `alone`       (optional) true for a row whose stroke carries exactly that
 *                 one action — `workflow_dispatch`'s and `run_rerun_failed`'s,
 *                 the two rows spending `actions: write`, and
 *                 the six advisory rows', the ones spending
 *                 `repository-advisories` (header above);
 *   `closedInputs` (optional) the per-workflow closed inputs —
 *                 `WORKFLOW_DISPATCH_INPUTS`, `workflow_dispatch`'s alone: the
 *                 action's `inputs` must be exactly the entry its `workflow`
 *                 names, and absent where that entry is `null` (header above);
 *   `alsoSpends`  (optional) grants the row spends beside `permission` —
 *                 each a literal mint input, never a stroke-scoped one
 *                 (`validate.mjs --self-test` pins it): `pr_create`'s
 *                 assignees and labels legs, LATER requests, the governed-review
 *                 follow-up's assignee fallback on `pr_ready`, and
 *                 `automerge_enable` on a pull that changes `.github/workflows/**`
 *                 (header above);
 *   `governedReview` (optional) true for a row whose landed requests are followed
 *                 by the governed-review follow-up (header above) — `pr_ready`
 *                 alone, the moment a seat readies a pull; ⛔ never `pr_create`:
 *                 the draft open summons nobody, a human is asked at the seat's
 *                 hand-off (`pr_request_reviewers`, after ACCEPT + same-head PASS);
 *                 the executor reads the pull's files and sends what
 *                 `governedReviewRequests` spells, on a Tier H hit alone;
 *   `distinct`    (optional) two keys the action must give different values —
 *                 the hierarchy rows' `issue` and `sub_issue`: an issue is
 *                 never its own sub-issue (header above);
 *   `requests`    the request descriptors the executor issues, in order:
 *                 `{ verb, path, body?, idempotent404?, graphql?, updateBranch?, rerunFailed?, subIssue?, advisoryRead?, fromAnswer?, assigned?, labelled? }`
 *                 — a `graphql` descriptor names the mutation and the pull (or
 *                 the issue and target) whose node ids it needs; a pull's
 *                 descriptor also carries `landed`, its `PR_LANDED_STATE`
 *                 entry, which is how the executor tells a landing from a
 *                 bare 200; an `updateBranch` descriptor carries the pull and
 *                 the expected head `confirmUpdateBranch` (execute.mjs) judges
 *                 the answer against; a `rerunFailed` descriptor carries the
 *                 run whose fences the executor reads before the POST and
 *                 whose new attempt it reads back after it
 *                 (`confirmRerunFailed`, execute.mjs); a `subIssue` descriptor
 *                 carries the mode, the parent and the child whose fences the
 *                 executor reads before the write, whose `id` is the body it
 *                 sends, and whose listing it reads back after it
 *                 (`subIssuePreflight` / `confirmSubIssue`, execute.mjs) — it
 *                 carries no `body`, the id is the child's answer's; an
 *                 `advisoryCollaborators` descriptor carries the advisory's id
 *                 and the logins to add, whose fences the executor reads
 *                 before the PATCH, whose merged list is the body it sends,
 *                 and whose answer it reads back (`advisoryPreflight` /
 *                 `confirmAdvisory`, execute.mjs) — it carries no
 *                 `body` either; an `advisoryVersions` descriptor carries the
 *                 advisory's id and the entries, whose fences the executor
 *                 reads before the PATCH and whose answer it reads back — its
 *                 `body` is the table's, the entries on the wire; an
 *                 `advisoryState` descriptor carries the id and the state
 *                 asked for, the executor's `{ state }` its body; an
 *                 `advisoryRead` descriptor carries the
 *                 advisory's id and the seat's public key, whose GET the
 *                 executor fences, seals and emits as notice parts and prints
 *                 nothing else of (`advisoryReadAction`, execute.mjs); a `fromAnswer` descriptor names the
 *                 field of its action's FIRST request's answer that fills the
 *                 `answerPlaceholder` in its path (`fillFromAnswer`,
 *                 execute.mjs); an `assigned` descriptor lists the logins its
 *                 answer's `assignees` must carry, and a `labelled` one the
 *                 names its answer (the label set) must carry, for the request
 *                 to have landed (`requestLanded`, execute.mjs); a
 *                 `mailboxBranch` descriptor carries the pull and the branch
 *                 the executor fences before the DELETE and reads back after
 *                 it (`mailboxBranchPreflight`, execute.mjs).
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
    // ⛔ No `governedReview` here (header: "The governed-review follow-up"): the draft open summons nobody. A human
    // sees the pull at the seat's hand-off — `pr_request_reviewers` after ACCEPT + a same-head PASS — and a dev's
    // create carries the claim's `Account:` as `assignees` (ruling A on #29828); never a reviewer request on the seat.
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
  // The one row that deletes a ref — see the header. `branch` is held to `MAILBOX_BRANCH_SHAPE` before the dispatch;
  // the pull's fences are the executor's, on its own answers immediately before the DELETE; the ref is read back absent.
  mailbox_branch_delete: Object.freeze({
    permission: 'contents',
    required: Object.freeze(['pull', 'branch']),
    optional: Object.freeze([]),
    requests: (a, repo) => [{ verb: 'DELETE', path: `/repos/${repo}/git/refs/heads/${a.branch}`, mailboxBranch: { pull: a.pull, branch: a.branch } }],
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
  // The two hierarchy rows — see the header. `issue` the parent, `sub_issue` the child, both NUMBERS; the body
  // `{ sub_issue_id }` is built by the executor from the child's own answer, after the fences, and never carries
  // `replace_parent`. Both spend `issues: write` (GitHub's ledger), a literal grant: no `alone`, no scoped mint.
  sub_issue_add: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'sub_issue']),
    optional: Object.freeze([]),
    distinct: Object.freeze(['issue', 'sub_issue']),
    requests: (a, repo) => [{ verb: 'POST', path: `${issues(repo, a.issue)}/sub_issues`, subIssue: { mode: 'add', parent: a.issue, child: a.sub_issue } }],
  }),
  sub_issue_remove: Object.freeze({
    permission: 'issues',
    required: Object.freeze(['issue', 'sub_issue']),
    optional: Object.freeze([]),
    distinct: Object.freeze(['issue', 'sub_issue']),
    // `sub_issue`, singular: the platform's remove path, not a typo of the add's.
    requests: (a, repo) => [{ verb: 'DELETE', path: `${issues(repo, a.issue)}/sub_issue`, subIssue: { mode: 'remove', parent: a.issue, child: a.sub_issue } }],
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
  // `run_id` is its one key. The five fences on the run and its pull (`RERUN_FAILED_FENCES`) are judged by the executor
  // on their own answers, read immediately before this POST, and the POST carries NO body: the platform's optional
  // debug-logging flag is never sent.
  run_rerun_failed: Object.freeze({
    permission: 'actions',
    required: Object.freeze(['run_id']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'POST', path: `/repos/${repo}/actions/runs/${a.run_id}/rerun-failed-jobs`, rerunFailed: { runId: a.run_id } }],
  }),
  // The five rows that write a security advisory — see the header. Each travels alone, and its token alone carries
  // `repository-advisories: write`, minted for that stroke only. The sender gate is unchanged, by the maintainer's
  // ruling (the body of issue 29160): 「所有车队账户都能发这个操作」 — so any fleet account with write on the target
  // can add itself to an advisory whose id it holds; an id exposes no content, but it is in the public run log.
  // The report: ONE POST of its body, which names no state, so never `published`. Its
  // prose reaches the runner through the event file and is printed nowhere; the row and the annotation name the id.
  advisory_report: Object.freeze({
    permission: 'repository-advisories',
    required: Object.freeze(['summary', 'description']),
    optional: Object.freeze(['severity', 'cwe_ids']),
    alone: true,
    requests: (a, repo) => [
      {
        verb: 'POST',
        path: `/repos/${repo}/security-advisories/reports`,
        body: { summary: a.summary, description: a.description, ...(a.severity !== undefined ? { severity: a.severity } : {}), ...(a.cwe_ids !== undefined ? { cwe_ids: [...a.cwe_ids] } : {}) },
        advisoryReport: true,
      },
    ],
  }),
  // The draft: ONE POST of its body to the collection, which creates an advisory in `draft` — the endpoint's default
  // and the only state it creates in, so the body names no state. Its prose rides the event file like a report's;
  // each package is one `vulnerabilities` entry naming the npm ecosystem and the name, with no version range, credit,
  // CVSS vector, CVE id or private fork. The row and the annotation name the id the platform gave it.
  advisory_create: Object.freeze({
    permission: 'repository-advisories',
    required: Object.freeze(['summary', 'description', 'packages']),
    optional: Object.freeze(['severity', 'cwe_ids']),
    alone: true,
    requests: (a, repo) => [
      {
        verb: 'POST',
        path: `/repos/${repo}/security-advisories`,
        body: {
          summary: a.summary,
          description: a.description,
          vulnerabilities: a.packages.map((name) => ({ package: { ecosystem: ADVISORY_CREATE_ECOSYSTEM, name } })),
          ...(a.severity !== undefined ? { severity: a.severity } : {}),
          ...(a.cwe_ids !== undefined ? { cwe_ids: [...a.cwe_ids] } : {}),
        },
        advisoryCreate: true,
      },
    ],
  }),
  // The collaborators: the id and the logins, no prose. The body `{ collaborating_users }` is the executor's — the
  // existing logins plus the missing ones, after its fences on the advisory's own GET — never the action's.
  advisory_collaborators_add: Object.freeze({
    permission: 'repository-advisories',
    required: Object.freeze(['ghsa_id', 'collaborators']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'PATCH', path: `/repos/${repo}/security-advisories/${a.ghsa_id}`, advisoryCollaborators: { ghsaId: a.ghsa_id, add: [...a.collaborators] } }],
  }),
  // The versions: the id and closed entries — `package`, `vulnerable_version_range`, `patched_versions` — and no prose.
  // The body `{ vulnerabilities }` is the table's, from the action's entries alone: per entry the npm ecosystem, the name
  // and the two version strings, never a vulnerable function, a summary or a description. The executor sends it only
  // after its own GET reads a draft whose whole list the action may replace (the `versions` fence), and it lands only
  // when the answer lists exactly the entries sent.
  advisory_versions: Object.freeze({
    permission: 'repository-advisories',
    required: Object.freeze(['ghsa_id', 'versions']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [
      {
        verb: 'PATCH',
        path: `/repos/${repo}/security-advisories/${a.ghsa_id}`,
        body: { vulnerabilities: advisoryVersionsOnTheWire(a.versions) },
        advisoryVersions: { ghsaId: a.ghsa_id, versions: a.versions.map((v) => ({ ...v })) },
      },
    ],
  }),
  // The state: accept a report or reopen a closed advisory (`draft`), close (`closed`) or publish (`published`), each
  // from the states `ADVISORY_TRANSITIONS` names and nothing else. The body `{ state }` is the executor's, sent only
  // after its own GET shows a transition the table allows — a publish only through the `versions` fence too — and a
  // landed publish is the one landing of this row the run annotates, naming the id: it is public once published.
  advisory_state: Object.freeze({
    permission: 'repository-advisories',
    required: Object.freeze(['ghsa_id', 'advisory_state']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'PATCH', path: `/repos/${repo}/security-advisories/${a.ghsa_id}`, advisoryState: { ghsaId: a.ghsa_id, to: a.advisory_state } }],
  }),
  // The one row that READS an advisory — see the header. ONE GET, nothing written; the executor seals the answer to the
  // seat's one-time key and prints nothing of it, not even the id. It spends repository-advisories at READ alone and
  // travels alone. ⚖ The sender gate is `target-write`, the gate the five rows above keep (`ADVISORY_READ_SENDER_GATES`),
  // by the maintainer's ruling, verbatim: 「同意改成对仓库有写权限,立卡派发修复」 (the header says why). ⛔ The grant stays
  // `read`: a read refused under it is the maintainer's to rule on, never a raise to write.
  advisory_read: Object.freeze({
    permission: 'repository-advisories',
    grant: 'read',
    senderGate: 'target-write',
    required: Object.freeze(['ghsa_id', 'public_key']),
    optional: Object.freeze([]),
    alone: true,
    requests: (a, repo) => [{ verb: 'GET', path: `/repos/${repo}/security-advisories/${a.ghsa_id}`, advisoryRead: { ghsaId: a.ghsa_id, publicKey: a.public_key } }],
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
  // Every `/git/` path but ONE `refs/heads/` ref of `MAILBOX_BRANCH_SHAPE` — `mailbox_branch_delete`'s DELETE (header).
  new RegExp(`/git/(?!refs/heads/${MAILBOX_BRANCH_SHAPE.source.slice(1, -1)}$)`),
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
  // Every `security-advisories` path but exactly ONE advisory's (`ADVISORY_PATH_SHAPE`), the private-report endpoint
  // (`ADVISORY_REPORTS_PATH_SHAPE`) and the bare collection (`ADVISORY_CREATE_PATH_SHAPE`, the create of a draft):
  // anything after the collection but those two, an advisory's CVE request and its temporary fork stay out of reach
  // of any row. The collection's list is the same path under `GET`, which no row sends (the self-test pins the verbs);
  // the one GET a row sends is `advisory_read`'s, of one advisory's path.
  /\/security-advisories(?!\/(?:GHSA(-[0-9a-z]{4}){3}|reports)$|$)/,
  /^\/orgs\//,
  /^\/admin\//,
  /\/collaborators\//,
  /\/keys/,
  /\/hooks/,
]);

/** The GraphQL mutations the table may name — anything else in a `graphql` descriptor is a bug this pins. */
export const ALLOWED_MUTATIONS = Object.freeze(['markPullRequestReadyForReview', 'convertPullRequestToDraft', 'enablePullRequestAutoMerge', 'disablePullRequestAutoMerge', 'transferIssue']);
