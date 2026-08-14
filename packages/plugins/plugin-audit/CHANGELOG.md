# @objectstack/plugin-audit

## 17.0.0

### Major Changes

- be90dea: fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

  Attachments derive their visibility from the parent record; comments derived
  nothing. On the _same_ record, with the _same_ user, the two answered
  differently:

  ```
  user: rep2 (does NOT own and cannot read the opportunity)
  GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
  GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
  GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                     → 200, 1 row
  POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
  ```

  `sys_comment` is public, has no owner column, and hides its parent inside a
  string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
  RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
  every object in every app carried that org-wide readable, org-wide writable
  side-channel — a deployment that carefully authored OWD, sharing rules and RLS
  on its records still leaked their discussion.

  `AuditPlugin` now installs the same two-part kit `service-storage` installs for
  `sys_attachment`, keyed off `thread_id`'s parent:

  - **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
    query with the threads whose record the caller can actually read (resolved
    through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
    decide). `count()` is filtered identically to `find()`, so a list `total`
    cannot leak the hidden rows' existence either.
  - **write** — `beforeInsert` requires READ on the record the thread names;
    `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
    or to hold EDIT on that record. `author_id` is server-stamped from the
    session, so a client-supplied value never wins.

  Everything fails CLOSED: a `thread_id` that names no record — the dangling
  `"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
  itself — is refused on write and excluded on read, and a filter that cannot be
  computed denies all rather than falling open. Refusals answer **403
  `RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
  permission condition takes a catalogued code rather than a new synonym), with
  `error.object` naming the record's object.

  **Breaking for deployments that depended on the gap.** Reads that used to
  return other people's comments now return fewer rows (or none), and writes that
  used to 201 now 403. Specifically:

  - Listing `sys_comment` without being able to read the parent record → the row
    is gone, not merely unlabelled. Panels that render a thread must be reached by
    a principal who can read the record.
  - Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
    usable at all: creating one is refused, and existing rows become invisible to
    everyone but system context. Migrate free-form threads to a real record
    reference (or keep them under a system-context surface).
  - Deleting or editing another user's comment now requires EDIT on the record.
    Note also that `sys_comment` delete already needed a permission set carrying
    `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
  - Posting a comment no longer requires the client to send `author_id` (it is
    stamped); a client that sends someone else's is silently corrected rather than
    believed.

  Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
  an object has comments at all, and anonymous callers are still refused with 401
  before any of this runs.

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

- 344a22a: refactor(plugin-audit)!: retire `export` and `permission_change` from the `sys_audit_log` action enum — two declared actions nothing has ever written (#8147, #7675, ADR-0049/ADR-0087)

  <!-- adr-0087: registered audit-log-action-enum-retired -->

  **BREAKING** (shipped as `minor` under the launch-window lockstep convention).

  `sys_audit_log.action` declared ten actions. Two of them named events this
  platform does not record, and has never recorded. Enumerating every
  `sys_audit_log` writer in the repo finds exactly two:

  - `plugin-audit/src/audit-writers.ts` — the generic hook writer, whose
    `actionFor()` maps `afterInsert`/`afterUpdate`/`afterDelete` to
    `create`/`update`/`delete` and **nothing else**;
  - `plugin-auth/src/admin-import-users.ts` — the admin user-import run-level row.

  Neither has ever emitted `export` or `permission_change`. The cost was not a
  dormant string: `sys_audit_log` ships **list views** filtered on those values and
  the platform dashboard ships **metric widgets** counting them, so an operator got
  a permanently empty "Permission Changes" tile and an Auth view whose filter could
  never match, while an auditor reading the enum believed the platform captured
  permission changes and data exports. That is false compliance on a compliance
  surface — the sharpest form of ADR-0049 declared-≠-enforced.

  Maintainer ruling 2026-08-12 (#7675) split the finding in two: build the cheap
  writers (`login`/`logout` in #8144, `config_change` in #8145) and retire the enum
  values with no feature behind them. 原则记录:空 widget + 永远查不到东西的过滤器
  是可见产品缺陷;审计面宁窄勿谎。

  ### Migration: FROM → TO

  | Wrote                                                                | Write instead                                                                                                                                                                 |
  | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | a filter, saved query or dashboard on `action = 'permission_change'` | filter the permission objects' own `create` / `update` rows by `object_name` — a grant or binding write is an ordinary record write and the generic writer already ledgers it |
  | a filter, saved query or dashboard on `action = 'export'`            | delete it — no export feature ever wrote an audit row, so it returned nothing on every deployment                                                                             |
  | a `switch` / badge map with arms for either value                    | delete those arms; an exhaustive `switch` over the action type now fails to compile if they stay                                                                              |

  Every such query returned an empty result set before this change and returns the
  same empty result set after it. What changed is that the contract stops promising
  otherwise.

  ⚠️ **Existing rows are untouched and must stay untouched.** The enum is not
  enforced on this object — `validateRecord` skips `readonly` fields and every
  `sys_audit_log` field is `readonly: true` — so stored history parses and reads
  back exactly as written. Audit history is append-only; do not migrate or delete
  rows to satisfy a schema narrowing.

  ### Also in this change

  - `auth_events` list view: filter narrowed to `['login', 'logout']`.
  - `config_changes` list view: `export` dropped from the filter.
  - `plugin-audit`'s generated translation bundles regenerated for all four locales.
  - ADR-0087 registration as the semantic migration `audit-log-action-enum-retired`
    (D3 step 17). An enum-VALUE retirement, so nothing lands in
    `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are byte-identical by
    construction — no authorable key and no def changed.

  ### `import` is deliberately NOT retired

  The 2026-08-12 ruling named `import` alongside the other two on the stated
  premise 无此 feature. That premise is measurably false and the value stays:
  `plugin-auth`'s admin user-import writes a real run-level row on every run
  (`action: 'import'`, `record_id: null`), pinned by case W4 of
  `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`. Retiring
  it would make the enum deny a value the platform writes — and silently, since
  the enum is unenforced here. Referred back for a maintainer ruling on #8147.

- 4827e91: refactor(plugin-audit)!: retire `restore` from the `sys_audit_log` action enum — the last declared action with no writer anywhere (#8315, #7675, ADR-0049/ADR-0087)

  <!-- adr-0087: registered audit-log-action-restore-retired -->

  **BREAKING** (shipped as `minor` under the launch-window lockstep convention).

  `sys_audit_log.action` declared `restore`. Nothing has ever written it, and the
  record-level audit writer **structurally cannot**: `actionFor()` in
  `plugin-audit/src/audit-writers.ts` is typed
  `'create' | 'update' | 'delete' | null` and its caller early-returns on `null`.
  A tree-wide search finds no other producer. There is no undelete capability
  behind the value either — soft delete/restore is unbuilt and parked (#1883,
  #3146).

  This is the third and last value retired from this enum under the maintainer
  ruling of 2026-08-12 on #7675 (原则记录:空 widget + 永远查不到东西的过滤器是可见
  产品缺陷;审计面宁窄勿谎), after `export` and `permission_change` in #8147.

  ### What made it a card and not a tidy-up

  Two shipped declarations asserted the opposite, so a declaration-reading audit
  scored the action as covered:

  - the `writes_only` list view offered `restore` as a filter value — a choice an
    operator can pick that returns nothing, on every deployment that has ever run;
  - the module docblock of `plugin-audit/src/auth-event-audit.ts` named `restore`
    among the actions the writer emits — the ADR-0049 declared-≠-enforced shape in
    its purest form: a sentence sitting next to a mechanism, contradicted by that
    mechanism's own type signature, with nothing in CI able to tell.

  Both are corrected. The invariant the comment was really claiming — _every
  declared action has a writer_ — is now a pin test with the writer inventory
  written as literals, instead of prose.

  ### Migration: FROM → TO

  | Wrote                                                         | Write instead                                                                                   |
  | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------- |
  | a filter, saved query or dashboard on `action = 'restore'`    | delete it — no restore event has ever been recorded, so it returned nothing on every deployment |
  | a `switch` / badge map / filter-dropdown option for `restore` | delete that arm; an exhaustive `switch` over the action type now fails to compile if it stays   |

  Every such query returned an empty result set before this change and returns the
  same empty result set after it. What changed is that the contract stops promising
  otherwise.

  ⚠️ **Existing rows are untouched and must stay untouched.** The enum is not
  enforced on this object — `validateRecord` skips `readonly` fields and every
  `sys_audit_log` field is `readonly: true` — so stored history parses and reads
  back exactly as written. Audit history is append-only; do not migrate or delete
  rows to satisfy a schema narrowing.

  ⚠️ **Not a product stance against undelete.** If the restore capability lands
  (#1883 / #3146 restart), this value returns **with its writer** — the emission
  point, its tests, and the view that surfaces it — never as a bare enum row again.

  ### Also in this change

  - `writes_only` list view: filter narrowed to `['create', 'update', 'delete']`,
    which is now exactly what `actionFor()` can emit.
  - `plugin-audit`'s generated translation bundles regenerated for all four locales
    (via `check-i18n-bundles --write` — not hand-edited).
  - ADR-0087 registration as the semantic migration
    `audit-log-action-restore-retired` (D3 step 17), a separate entry from #8147's
    `audit-log-action-enum-retired` per `entries/README.md`. An enum-VALUE
    retirement, so nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface
    ratchets are byte-identical by construction — no authorable key and no def
    changed.

- fec2f0e: feat(audit): sign-in and sign-out are recorded in `sys_audit_log`, with the actor and the tenant (#8144)

  `sys_audit_log.action` declares `login` and `logout`, the shipped `auth_events`
  list view filters on them, and two System Overview dashboard widgets chart them —
  but **nothing in the platform ever wrote either row**. The audit writers subscribe
  to the ObjectQL CRUD lifecycle, so `create`/`update`/`delete`/`restore` were the
  only actions that could ever materialize. On a fresh boot, signing in and then
  querying `GET /api/v1/data/sys_audit_log?$filter={"action":"login"}` returned
  **total 0**, and the `auth_events` view was empty by construction.

  The whole trace a sign-in left behind was one **unattributed** `update sys_user`
  row (`user_id` null) diffing `last_login_at` — a compliance ledger recording that
  somebody, unknown, had signed in.

  Both halves are fixed:

  - **`login` on every session creation.** The writer is wired to better-auth's
    `session.create` database hook rather than to the `/sign-in/email` endpoint, so
    it covers every way a session is minted — email sign-in, sign-up auto-sign-in,
    SSO, OAuth callback, magic link, email OTP, passkey. The row carries the actor
    (`user_id`), the tenant (`tenant_id` + the RLS `organization_id`), the session
    it is about, and the client fingerprint better-auth recorded (IP, user agent).
    An impersonation session keeps the subject on `user_id` and names the
    impersonating admin on `actor`, so it cannot be misread as a self-service login.
  - **`logout` on sign-out.** Scoped to `POST /sign-out` deliberately: a session row
    is also deleted by admin revokes, `/revoke-session`, bans, user erasure and
    better-auth's own collection of expired rows, and recording any of those as
    `logout` would name an action the user never took. Those revocations already
    carry their own cause on the ADR-0069 D4 session tombstone.
  - **The `last_login_at` write is now attributed.** It goes out through the
    platform's existing attribution channel (`ExecutionContext.attributedUserId`),
    so the row names the person who signed in. It is attribution only — the write
    still authorizes as the system, and nothing about who may touch `sys_user`
    changes. The row is kept rather than suppressed: a login from a new address is
    exactly what a compliance ledger is read for.

  The audit plugin now registers the `audit` service, the ledger's write ingress
  for events that are not CRUD. `@objectstack/plugin-auth` resolves it lazily and
  takes no dependency on the audit package — a deployment without the audit plugin
  installed writes no auth rows, exactly as before.

  No API, schema or enum changes: `login`/`logout` were already declared members of
  the `action` enum, and `sys_audit_log` remains `get`/`list`-only over HTTP.

- f243727: remove(plugin-audit): drop the kernel's built-in assignment notifications; move the policy to user-space automation (#3403)

  **Breaking (behavioral).** `plugin-audit` no longer emits a `collab.assignment`
  notification when an owner/assignee field changes on a record. Deciding that an
  assignment warrants a bell is a business policy, not a platform default — the
  kernel version guessed "who is the assignee" from field names (`owner_id`,
  `assigned_to`, `assignee_id`, `owner`, `assignee`), which misfired on system
  records like `sys_file` and spammed users with "…assigned to you" noise on file
  uploads (#3402).

  **What was removed:** the `writeAssignmentNotifications` writer, the `OWNER_FIELDS`
  heuristic, and the `messages.assignedToYou` translation key (en / zh-CN / ja-JP /
  es-ES). **Unaffected:** `sys_audit_log` / `sys_activity` capture, and `@mention`
  notifications (`collab.mention`) — those remain platform behavior. The
  `owner_of:` messaging audience and `service-messaging`'s `DEFAULT_OWNER_FIELDS`
  are a separate, caller-requested mechanism and are unchanged.

  **FROM → TO migration.** If you relied on the automatic bell, configure an
  automation flow on the target object (`record-after-update` / `record-after-create`
  trigger + a `notify` node). The `condition` can read the pre-update row via
  `previous`, and `notify`'s `recipients` / `title` / `actionUrl` all interpolate
  record fields. Ready-made example: `showcase_task_assigned_notify` in
  `examples/app-showcase/src/automation/flows/index.ts`:

  ```ts
  { id: 'start', type: 'start', config: {
      objectName: 'your_object',
      triggerType: 'record-after-update',
      condition: 'assignee != previous.assignee',
  } },
  { id: 'notify_assignee', type: 'notify', config: {
      topic: 'task.assigned',
      recipients: ['{record.assignee}'],
      channels: ['inbox'],
      title: 'New assignment: {record.title}',
      actionUrl: '/your_object/{record.id}',
  } },
  ```

  Notes on parity: the flow template renders a single language (the kernel version
  localized the title to the recipient's locale); a flow fires on every real change
  (the `previous` condition already gates that) and, unless you add an actor guard,
  also notifies self-assignments — the kernel version suppressed those.

- 04b9776: feat(plugin-audit)!: retire `sys_comment.visibility` and `sys_comment.reply_count` (#4756, ADR-0049)

  Both fields were modelled with **zero** runtime consumers — nothing in this repo,
  in `objectui`, or in `cloud` ever read or maintained either one. ADR-0049
  enforce-or-remove; maintainer decision: remove both. Same disposition, and for
  the same stated reason, as `sys_attachment.share_type` / `sys_attachment.visibility`
  in #2755 ("attachment access is derived from the parent record").

  **REMOVED — `sys_comment.visibility`** (`'public' | 'internal' | 'private'`,
  defaulted `'public'`).

  This one is a **security-looking key with no gate behind it**, which is the
  primary reason it goes rather than stays. No code path consulted it: not
  `enforceFeedsCapability`, not the record-level gates added in #4630, not the
  REST layer, not objectui's discussion panel. A comment an author marked
  `private` was visible to exactly the same people as a `public` one — an app
  author (or an AI authoring metadata) reading the field list would reasonably
  believe otherwise, and get a silent security failure instead of an error. That
  is the Prime Directive #10 trap in its textbook shape.

  There is **no replacement key**: after #4630, who can see a comment is decided
  by the record-level permissions of the record its `thread_id` names — one
  coherent rule. A per-row enum layered on top would be a second source of truth
  for the same question. The enum's only genuinely missing meaning ("hidden from
  external/portal principals") depends on external principals existing at all,
  which waits on ADR-0090 D11's `externalSharingModel`; today there is nobody to
  hide a comment from. This does not foreclose that design — when portals land,
  a visibility key can return **enforce-first**, with a real gate and tests.

  **FROM → TO:** stop sending `visibility` on `sys_comment` writes; to restrict
  who sees a discussion, restrict who can read the record `thread_id` points at.

  **REMOVED — `sys_comment.reply_count`** (`number`, `defaultValue: 0`,
  `readonly: true`).

  Never incremented anywhere, and `readonly` meant an author could not set it by
  hand either, so every row read `0` forever — a UI binding an "N replies" badge
  to it rendered `0` for every thread. Deliberately **not** replaced by an
  `afterInsert`/`afterDelete` roll-up: the predicate/bulk write-hook gaps tracked
  by #4770 / #4778 / #4779 (a hook that returns early without a single-record id
  lets the whole bulk operation through) are exactly where a hook-maintained
  counter drifts — a bulk delete of replies would never decrement it. A counter
  that drifts is worse than no counter, because both the UI and an AI reading the
  record trust it. If a badge needs the number, aggregate `parent_id` children at
  read time; a designed roll-up can be revisited once #4775's family has settled
  bulk-hook semantics.

  **FROM → TO:** replace reads of `reply_count` with a count of `sys_comment` rows
  whose `parent_id` is the comment's id.

  **Stored data.** Existing databases keep both columns as **unmanaged leftovers**
  — no migration, matching #2755. What changes where:

  - **Reads are loud everywhere.** The read-axis gates (#4134 / #4226) resolve
    field names from the object schema, not from the table, so a filter, sort,
    `select` or `expand` naming `visibility` / `reply_count` now answers
    `400 INVALID_FIELD` on every deployment, leftover column or not. A "0 replies"
    badge that silently lied becomes an error that names itself.
  - **Writes are loud on new databases only.** A database provisioned after this
    change has no such column, so the write fails at the driver and is mapped to
    the same `400 INVALID_FIELD` envelope. On a pre-existing database the leftover
    column still accepts a value nothing will ever read — record validation does
    not reject undeclared keys. Dropping the two columns is an optional manual
    cleanup, not a requirement.

### Patch Changes

- 690ccf2: fix(objectql): a by-id `update()`/`delete()` against a nonexistent record answers 404 `RECORD_NOT_FOUND` instead of a 400 from further down the pipeline (#7867)

  Nothing on the action-body write path ever asked whether the target row existed.
  `ctx.api.object(name).update({ id, … })` reached `ObjectQL.update()`'s by-id
  branch through `buildSandboxApi` → `ObjectRepository`, and that branch had **no
  existence gate at all**: `engine.update()` on a ghost id was a silent no-op that
  resolved `null`, so the write ran on into validation, the driver and the hook
  chain and died on whichever complained first.

  **Which one it died on varied with the object's declarations**, which is why the
  defect read as several unrelated bugs:

  - a **hooked** object → `400` `HookConditionError`, from an `afterUpdate`
    condition reading `previous` on a row nobody read;
  - an **unhooked** object → `400` `VALIDATION_FAILED` "X is required", because
    with no prior row a PATCH is validated as if it were a whole record.

  The 400 class varied; the missing 404 was the constant. Measured on one showcase
  stack, same id, same object, same second: `POST /actions/showcase_task/
showcase_mark_done/<ghost>` answered 400 while `PATCH /data/showcase_task/
<ghost>` answered 404. Both answer **404 `RECORD_NOT_FOUND`** now.

  `delete()` had the same shape and was the worse of the two: with no gate it
  reported success for a row that was never there, so a typo'd id, an
  already-deleted row and a real deletion were indistinguishable.

  **This is not a `previous`-binding bug.** `if (priorRecord) hookContext.previous
= …` is correct and is untouched — ADR-0058 Addendum II / #4649 require that an
  absent row leave `previous` UNBOUND rather than fabricated. It was behaving
  correctly on a path that should never have been entered, so the fix removes the
  producer rather than specializing what it produced.

  **Where the gate went, and why there.** At the engine, in the by-id branches of
  `update()` and `delete()` — the one point all three action-body write faces
  funnel through (`ctx.api.object()`, its context-less repo-facade fallback, and
  `ctx.engine.update()`). A repository-level gate would have closed one of the
  three and made `ql.update(o, { id })` and `ctx.api.object(o).update({ id })`
  answer one ghost id two different ways. Two sibling paths already gated
  correctly — `protocol.updateData`/`deleteData` (#4435) and `callData`'s ObjectQL
  fallback (#5138) — and all three now throw the **same** `recordNotFoundError`,
  which moved to `@objectstack/core` so the engine can reach it without importing
  `@objectstack/metadata-protocol` (forbidden in the `/core` closure by ADR-0076
  D2's boundary ratchet). `@objectstack/metadata-protocol` re-exports it unchanged.

  Existence is asked with a pre-write read, never off the write's own result:
  `IDataDriver.update` declares no not-found signal, and the engine's post-write
  readback is `null` for a second reason (a write that moves the row out of the
  caller's row scope), so reading either would answer 404 to a write that landed.

  **Behaviour change worth knowing about — the by-id prior-row read is now
  unconditional.** #5284 (update) and #5929 (delete) had narrowed it to "does
  anything CONSUME the prior row?", skipping the read for objects with no hook, no
  prior-reading validation rule and no roll-up. Existence is a consumer that
  demand list never enumerated and the one consumer every by-id write has, and no
  cheaper question answers it — so the skip and the gate are mutually exclusive.
  The measured cost is small: #5929's own record enumerates the global hook
  registrants (plugin-sharing, service-storage, plugin-auth, plugin-audit), so on
  any kernel that loads them the demand was already true for every object and the
  narrowing skipped nothing. The read is genuinely new only for a bare
  `@objectstack/objectql/core` embedder — which is buying a 404 it did not have.

  Three read-count pins measured the old skip and now measure the read, each
  recording what changed and why at its own site: #5284's and #5929's in
  `packages/objectql`, and #5860's `sys_job_queue` case in `@objectstack/plugin-audit`.
  The DISPATCH half all three are actually about — the per-object `hasHooksFor`
  question, the `excludeObjects` subtraction, and the retired
  `sys_fetch_previous_*` builtins — is untouched and still pinned.

  One further case encoded the old silent no-op as correct: `@objectstack/plugin-auth`'s
  #5941 last-admin-guard test deleted a `sys_account` id that was never seeded and
  asserted it RESOLVED, to show the guard does not write-guard that object. It now
  deletes a REAL row — which states the same thing more strongly — and separately
  pins that a ghost id there is refused by the ENGINE rather than by the guard.

  **Scope.** By-id only. A `multi: true` predicate write matching zero rows still
  resolves "0 rows affected" — the same line both sibling paths draw.

  `@objectstack/runtime`: the sandbox error passthrough now also carries `status`
  alongside `code` and `fields`, so an error that names its own HTTP status keeps
  it across the QuickJS boundary. Without it the action surface answered the right
  diagnosis at the wrong status (`{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`);
  `domains/actions.ts` already honoured `.status` first — the number simply never
  arrived. A permission refusal thrown inside a body likewise keeps its 403 now
  instead of flattening to 400.

- c8ff269: fix(plugin-audit): consume the engine's bound `ctx.previous` and record one normalised view on both sides of the diff (#6656)

  `plugin-audit` used to fetch its own pre-image. `captureBefore`, registered on
  `beforeUpdate` / `beforeDelete`, issued a `ql.findOne` for the target row and
  stashed it on `ctx.__previous`, because `HookContext.previous` was "officially
  typed but not always populated by the engine itself". That is no longer true on
  any path this plugin registers for, so the read is retired and the writer reads
  the contract value.

  **The read that goes away** (measured with a counting driver on the audited
  object, `driver.findOne` per write):

  | write                                | before | after |
  | :----------------------------------- | -----: | ----: |
  | single-id `update()`                 |      2 |     1 |
  | single-id `delete()`                 |      2 |     1 |
  | predicate `update()`, 3 matched rows |      3 |     0 |
  | predicate `delete()`, 3 matched rows |      3 |     0 |

  The predicate column is the larger half and was pure waste. #5574 binds
  `input.id` on every per-row _before_ context, which defeated the handler's own
  `if (!id) return` bulk guard — so it read every matched row, and every result
  was discarded, because `__previous` landed on the per-row _before_ context while
  the per-row _after_ contexts (the ones the writer actually runs on) never saw
  it. The engine's own matched-row read is untouched and still serves both phases,
  so the ledger is unchanged.

  **What the ledger records changes, and deliberately.** The two sides of an audit
  diff came from two different pipelines: `before` through the engine's read path
  (credentials masked, formulas hydrated, file references resolved) and `after`
  from the raw write result. That asymmetry — not the redundant read — is why a
  write that touched one field recorded phantom "changes" for every secret, file
  and formula field on the record. Retiring the read makes both sides
  same-source; the writer now also gives them one view, so the surface levels
  upward rather than down to raw store contents:

  - **Credential fields are masked on both sides.** Single-id delete `old_value`
    still reads `••••••••` for a `secret` field — that face is byte-identical.
    Change detection still runs on the raw values, so rotating a secret is still
    recorded as a change; only the recorded values are masked.
  - **A pre-existing leak is closed.** The stored `secret:` ref was already
    reaching `sys_audit_log.new_value` on every create and update, and a
    `password` field — which ADR-0100 stores in cleartext at rest — was landing
    there **in plaintext**, in the audit ledger and in the `sys_activity` summary
    rendered in the record feed. Both now record the mask.
  - **Virtual (`formula`) fields leave the full snapshots.** `ctx.result` carries
    hydrated formulas (#5504) and the raw pre-image structurally cannot, so
    create `new_value` would have described a field delete `old_value` could
    never carry. Only genuinely virtual fields are dropped: `autonumber` and
    `summary` are stored columns present and equal on both sides, and they stay
    in the snapshot.

  Two consequences worth naming, both narrowing single-id delete to what bulk
  delete already did: its `old_value` now records a file field's stored id rather
  than the resolved `{id, name, size, url}` object, and drops formula values. An
  object whose label field is a formula falls back to the record id in the
  `sys_activity` label on delete for the same reason.

  No audit coverage is removed: the plugin keeps its `afterInsert` / `afterUpdate`
  / `afterDelete` registrations, which is what holds the engine's pre-image demand
  gates open, and every one of them keeps the `excludeObjects` face from #5860.

- 0f8d16a: perf(plugin-audit): 审计跳过名单上到注册面,平台内部表不再为白读买单 (#5860)

  plugin-audit 的五个写入注册(`captureBefore` 的 `beforeUpdate`/`beforeDelete`,
  `writeAudit` 的 `afterInsert`/`afterUpdate`/`afterDelete`)此前**不带任何对象范围**,
  因而在引擎眼里全部是全局 hook。"哪些对象要审计"这个知识一直存在 —— `SKIP_OBJECTS`
  —— 但它停在 handler 内部的早退里,注册面上看不见。于是按对象计算需求的两道门只能保守
  判真:#5284 的单 id `update()` 前置行门、#5038 的批量门,对 `sys_job_queue`、
  `sys_job_run`、`sys_upload_session`、`ai_traces` 这些表同样判"需要",每次写入白读一遍
  行集,而 handler 的第一行就返回了。放大倍数最刺眼的是 `sys_job_queue`:每条队列消息
  至少三次写入(publish / lease / terminal),自 #5160 起每封邮件都走它。

  现在这五个注册带上 `excludeObjects`(#5928 / PR #6575 落地的声明式排除面),名单由
  `SKIP_OBJECTS` **派生**而非重抄,两个面不可能各自漂移。handler 内的早退**保留**为纵深
  防御 —— 它护住的是每一个非 hook 调用方 —— 所以审计写入的行为逐位守恒,变的只是引擎
  能看见的范围。

  **为什么是减法而不是允许列表**:对象全集在运行期是开放的。`/meta` PUT 会把新对象注册进
  运行中的引擎,而 `SchemaRegistry.registerObject` 不发任何事件,插件侧没有可订阅的通道去
  追平一份枚举出来的名单 —— 那样的名单会在启动时冻结,此后新建的对象**静默**不被审计,对
  合规插件是无声的倒退。排除面没有这个失败模式:安装时没人听说过的对象默认被审计。这条性质
  已单独钉在测试里。

  顺带,`writeCommentMentions` 收为 `{ object: 'sys_comment' }` —— 它的 handler 第一行本就
  拒绝其他对象,这是一个封闭的单名允许列表,现有契约一直表达得了。行为不变,但它不再出现在
  其他任何对象的 `afterInsert` 需求里。

- c5e7bd9: fix(plugin-audit): say where the audit system tables were provisioned, and stop skipping provisioning silently (#4887)

  `AuditPlugin.provisionSystemTables()` created `sys_audit_log` / `sys_activity` /
  `sys_comment` at `kernel:ready` and then said **nothing** — not on success, and
  not when it skipped the work entirely (`typeof engine.syncObjectSchema !==
'function'` returned silently). `syncObjectSchema()` itself returns `void` and
  has three silent exits of its own — the object is not in the registry, no driver
  resolves for it, or the resolved driver has no `syncSchema` — none of which
  throw. So "provisioned three tables" and "provisioned nothing at all" produced
  byte-identical logs, and the only way to tell them apart was to go looking in a
  database.

  #4887 is what that costs. `sys_audit_log` and `sys_activity` were reported as
  never provisioned because they were absent from the primary SQLite file, with
  the silent `typeof` bail named as the likely cause. Neither was true:
  `sys_audit_log` (`lifecycle.class: 'audit'`) and `sys_activity`
  (`lifecycle.class: 'telemetry'`) are routed by **ADR-0057 §3.6** to the
  dedicated `telemetry` datasource whenever one is registered, and `os dev`
  registers one by default as a _sibling file_ (`dev.db` → `dev.telemetry.db`).
  Both tables had been created — in the other store. `sys_comment` carries no
  lifecycle class, stays on the primary, and was the one that "existed". Nothing
  in the log connected those three facts.

  Provisioning now reports itself:

  - **Wholesale skip is a `warn`, naming the consequence** — the tables stay
    lazy-created on first WRITE, so an env that READS one first (the home page
    activity feed queries `sys_activity` before any mutation) logs "no such
    table" until something writes.
  - **One `info` line per boot listing where each table landed** —
    `sys_audit_log→telemetry, sys_activity→telemetry, sys_comment→sqlite`,
    resolved through the engine's own `getDriverForObject`, so the log states the
    routing rather than leaving it to be inferred.
  - **A second `info` line when the ADR-0057 split is in effect**, saying
    explicitly that those tables live in a different store — on SQLite, a
    different _file_ — and that anything reading them without naming the object
    (raw SQL against the default datasource) will report "no such table" even
    though provisioning succeeded.
  - **An object that resolves to no driver is a `warn`** — `syncObjectSchema()`
    returns without issuing any DDL in that case and throws nothing, so the
    per-object `catch` never fires; from outside the engine this is the only place
    it can be observed.

  Behaviour is otherwise unchanged: the same three objects are synced, per-object
  failures stay isolated, and an engine without on-demand DDL still degrades
  instead of failing `start()`.

- 83f7743: fix(plugin-audit): localize select option labels in the tracked-change activity summary (#7289)

  `sys_activity.summary` is composed at **write time** and shipped verbatim to
  every consumer at once — the record discussion feed, console home activity, the
  header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI.
  `displayFieldValue` rendered a select/picklist value by scanning `field.options[]`
  and returning the matching option's **authored** `label`. `field.options` comes
  from `engine.getSchema(name)`, which is locale-independent metadata, while the
  shipped bundles carry those same labels under
  `objects.<object>.fields.<field>.options.<value>` (`sys_audit_log.fields.action.options.create = "创建"`).
  Nothing on this path read them.

  After #7230 localized the field label, that left a zh-CN workspace with

  ```
  阶段: Proposal → Closed Won
  ```

  — a half-localized string at the bottom of a fully-localized page. The tracked-change
  branch now resolves the option label through the same locale-bound translator its
  field label already uses, on the bundles' own key shape, with the authored label as
  the fallback. A bundle miss returns `undefined`, so the authored label and then
  `String(value)` answer exactly as before: the change can only replace an authored
  label with that label's translation, never the reverse.

  **The fired-milestone branch is deliberately left alone**, and the opt-out is by
  construction rather than by omission — `renderMilestoneSummary` passes no option
  resolver, so a select token there still renders its authored label byte-for-byte.
  A milestone summary is an author-written sentence with no bundle key of its own,
  and #7290 ruled leaving templates untranslated a contract decision. #7290's own
  change (a reference id → the referenced record's title) is locale-_independent_
  data — the same string in every locale — which is why it could be added to an
  untranslated sentence; an option label is locale-_dependent_ rendering, so reading
  the bundle there would guarantee a split sentence (`Deal moved to 已赢单`) in
  exactly the case the bundle exists for. The tracked-change branch has the opposite
  geometry: its frame is fully localized, so there the authored value is the mismatch.

  **Read cost is unchanged.** This is a bundle lookup, not I/O: zero added reads on
  every write shape, so the #6656 / PR #6977 retirement (2 → 1 reads per single-id
  write, 3 → 0 per predicate write) that #7291 and #7333 preserved still stands,
  and `displayFieldValue` stays synchronous.

  Historical rows keep their write-time composition; only new writes improve.

- 0162c81: fix(plugin-audit): stop mirroring `sys_job_queue` traffic into the audit ledger (#5193)

  `SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
  from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, _"stop the
  amplifier"_. Its group (2) already listed `sys_job`, `sys_job_run` and
  `sys_automation_run`; `sys_job_queue` — the highest-volume table of that same
  family — was the one sibling missing, so every durable queue message was
  mirrored into both sinks.

  The audit hooks register for **all** objects (`afterInsert` / `afterUpdate` /
  `afterDelete`) and there is no "writes made under a system context are not
  audited" exemption, so `DbQueueAdapter`'s own writes were recorded like user
  edits. One message costs at least three of them — the publish insert, the lease
  `pending → running` update and the terminal `→ completed` update, plus one retry
  update per failure and the reaper's periodic DELETE of completed rows — each
  producing an `sys_audit_log` **and** an `sys_activity` row. Since queue-backed
  email delivery landed, that ran on every single mail. Each `beforeUpdate` also
  paid an extra `findOne` snapshot of the row it was about to change.

  `sys_job_queue` is engine-owned plumbing (`managedBy: 'engine-owned'`,
  `enable.apiMethods: ['get', 'list']`, `lifecycle.class: 'transient'`) that no
  user can write, so those rows carried no compliance value — only noise and write
  amplification. Nothing else changes: the exemption is one name in one list, and
  ordinary business objects are audited exactly as before.

  Operators who charted queue throughput off `sys_activity` should read
  `sys_job_queue` directly instead — it is the system of record for queue state,
  and unlike the audit sinks it is exposed for reading (`get` / `list`).

- 055f0c9: fix(plugin-audit): stop mirroring chunked-upload progress into the audit ledger (#5202)

  `SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
  from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, _"stop the
  amplifier"_. `sys_upload_session` was the second table missing from group (2)
  for the same reason `sys_job_queue` was (#5193): it declares
  `lifecycle.class: 'transient'` and its own object comment says what the rows are
  worth — _"an upload session is ephemeral state, never business truth"_
  (ADR-0057 / #2970 item 4) — but nothing connected that declaration to the
  exemption list, which is hand-written.

  The audit hooks register for **all** objects and there is no "writes made under
  a system context are not audited" exemption, so `StorageMetadataStore`'s own
  writes were recorded like user edits. A chunked upload of N parts costs 1 + N
  writes — the `createSession()` insert plus one `updateSession()` per chunk — and
  then a terminal status update and the row's removal, each producing an
  `sys_audit_log` **and** an `sys_activity` row: 2 × (1 + N) rows for one file,
  with a `beforeUpdate` snapshot read apiece. Each of those rows was also unusually
  fat, because `updateSession()` writes the merged **full** record, so the `parts`
  JSON blob that grows with every chunk rode along in each diff's `old_value` /
  `new_value`.

  Nothing else changes: the exemption is one name in one list, and ordinary
  business objects are audited exactly as before. In particular `sys_file` stays
  audited — it declares `transient` too, but only to reap tombstones and
  unfinished uploads; its rows are mostly permanent business truth and keep their
  compliance value.

  Operators who tracked upload activity through `sys_activity` should read
  `sys_upload_session` (in-progress state) and `sys_file` (the durable record of
  what was actually stored) instead.

- a946efd: fix(plugin-audit): the localized-summary tests stop charging a cold module load to one test's timeout (#4186)

  `audit-writers.test.ts` resolved `@objectstack/core` and its translation
  bundle with `await import(...)` inside the first localized test's helper, so
  that single test paid the whole cold-start cost — resolution plus vite
  transform of a large barrel — while every later case ran warmed in ~1ms.

  That cost is real work being billed to a per-test timeout budget. The file
  already carried a `{ timeout: 20_000 }` override for exactly this reason (its
  comment measured the cold start at ~5s on a 4-vCPU runner). Under a full-repo
  `pnpm test`, where a dozen packages' vitest workers compete, the cold start
  grew past that bound too and the case failed at 20s — reproducibly in CI-like
  load, never in isolation, which is the worst shape a red test can have: it
  tracks machine load rather than code.

  Both imports are now static. The same work happens during collection, which no
  single test's timeout is charged for, so the previously failing case runs in
  1ms and the timeout override is gone — the default timeout is now an honest
  bound, and a case that exceeds it is a real hang rather than a slow import.

- 5777b1a: fix(plugin-audit): localize the tracked-change activity label and render lookup titles instead of raw ids (#7230)

  `sys_activity.summary` is composed at write time and shipped verbatim to every
  feed surface at once — the record discussion feed, console home activity, the
  header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI. Its
  tracked-change branch (ADR-0052 §5b, `"<label>: <old> → <new>"`) was producing
  strings like `Rating Owner: ∅ → oBK25…` at the bottom of an otherwise
  fully-localized page. Two independent causes, both fixed here:

  - **The label was never localized.** `renderTrackedChangeSummary` was the one
    summary branch never handed the locale-bound `translate` its three siblings
    (`messages.activityCreated` / `messages.activityDeleted` /
    `messages.activityUpdated`, plus the object label via `displayLabelFor`) all
    resolve through — an oversight against ADR-0053 / #3039 write-time
    localization. The field label now resolves through the same translator, on the
    bundles' own key shape (`objects.<object>.fields.<field>.label`), and falls
    back to the authored `label`, then the machine key, exactly as before.
  - **A reference value printed its raw id.** `displayFieldValue` resolved
    select/picklist option labels only, so a `lookup` / `master_detail` / `user`
    value fell through to `String(value)` — the stored 32-char id. It now renders
    the referenced record's title, resolved through ADR-0079's
    `resolveDisplayField` (`nameField` → deprecated `displayNameField` alias →
    derivation) rather than a local name-guessing heuristic.

  The `∅ →` notation is unchanged, and so is every other summary branch. The
  change is restore-invariant: an id that cannot be resolved — a target removed
  out of band, an unregistered object, a failing read — renders exactly as it did
  before.

  **Read cost, measured with a counting driver** (the same technique that measured
  #6656 / PR #6977's retirement of the redundant pre-image read from this write
  path, and pinned as cases in `audit-lookup-summary.test.ts`):

  - **0 added reads** on every create, every delete, every update that moves no
    tracked reference field, and every update that moves an _untracked_ one —
    including on rows that do carry references. #6977's counts (1 `findOne` per
    single-id write, 0 per predicate write) are untouched.
  - **1 read per distinct target object** on an update that does move a tracked
    reference: both sides of the change are answered by a single
    `id: { $in: [...] }` selecting only the id and title columns, however many
    tracked reference fields point at that object.

  Historical `sys_activity` rows keep their original write-time composition — only
  new writes improve.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 3e8e669: fix(plugin-audit): forward the caller's full execution envelope to the `sys_comment` sharing gates (#7141)

  `callerContext()` in `comment-access-hooks.ts` rebuilt a five-field projection
  of the caller's `ExecutionContext` (`userId` / `tenantId` / `positions` /
  `permissions` / `isSystem`) before handing it to `ISharingService.canEdit`,
  whose contract declares the **full** envelope and whose doc block tells callers
  they "MUST NOT rebuild a subset of it" (#6523 / the #6206 ruling). #7136 (PR
  #7140) widened the return _annotation_; this is the body.

  The projection was doing two jobs at once and only one of them was correct:

  - **Dropping the middleware-private keys was correct**, and is preserved.
    plugin-security's middleware stamps the access DEPTH it resolved for the
    object of the operation in flight — `sys_comment` — onto the context in place
    (`sc.__readScope = …`), while these gates ask the sharing service about the
    **parent record's** object. Forwarding that whole would hand one object's
    widening to another object's owner-match, the stale-scope leak
    `resolveWriteScopeForSharing` was extracted to prevent. The keys are now
    dropped by the `__` **prefix** rather than by name, which also covers the
    engine's other operation-private markers on that channel (`__expandRead`
    waives the object-level CRUD check, `__referentialFieldClear` the
    referential-clear write) and cannot go stale when a fifth key is added.
  - **Dropping the principal fields was the defect.** Two of them decide the
    verdict this gate then trusts:

    - `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
      probe `SharingService.canEdit` consults last, is documented to fail CLOSED
      on a delegated context and implements that by reading exactly
      `context?.onBehalfOf?.userId`. Stripped, the guard could never fire on this
      path, and the `/mcp` OAuth agent principal that `resolve-execution-context`
      builds _with_ the delegation link reached the bypass probe looking like an
      ordinary direct call.
    - `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090 D10
      rule "an agent's grants are EXACTLY its scope-derived ceiling" on
      `principalKind === 'agent'`. Stripped, the additive human baseline was
      appended to an agent's ceiling here, so the sets the bypass probe evaluated
      were a superset of what the user consented to.

    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
    `rlsMembership` were dropped by the same projection and are forwarded now for
    the same reason.

  The same envelope-minus-private-keys rule is applied to the read side's
  parent-record probe, which spread the whole operation context into a `find` on
  a different object.

  No access depth is synthesised for the parent object: absent depth leaves the
  sharing owner-match at its narrowest (`own`), which is the safe direction and
  byte-for-byte what the projection produced. Resolving the parent's own depth
  would WIDEN this gate and is deliberately left as a separate decision.

  Enforcement effect: a delegated (`onBehalfOf`-carrying) principal is now refused
  where the contract says it is refused. No caller gains access.

- 62b6a2f: docs(spec,plugin-audit): record that the parent-record write gates match ownership at `own` BY DESIGN (#7144)

  Documentation only — no gate changes what it returns for any input.

  `ISharingService`'s write gates widen ownership "by write DEPTH", but that depth
  is an INPUT the caller supplies: the CRUD middleware resolves it for the object
  of the operation in flight and stamps it on the operation context. The
  `sys_comment` gates (`@objectstack/plugin-audit`) and the `sys_attachment` kit
  (`@objectstack/service-storage`) ask this service about the PARENT record's
  object, so the stamped depth belongs to a different object and is dropped — and
  the owner-match runs at its narrowest, `own`. A caller whose write depth on the
  parent is `unit` / `unit_and_below` / `org` can therefore edit that parent
  directly and is refused when editing a comment or attachment on it.

  That divergence is deliberate and runs in the restrictive direction (refusals,
  never a leak). The contract now says so, and — the part that matters for anyone
  tempted to "fix" it — says WHY the alternative is not merely unimplemented:
  `ISecurityService.resolveWriteScope`, the only tool a package outside
  `plugin-security` has for the parent's depth, fails OPEN, because
  `getEffectiveScope` returns `'org'` when no permission set mentions the object
  at all — indistinguishable from a genuine `modifyAllRecords` holder. Handed to a
  write gate as the depth it becomes authoritative on its own and the owner-match
  short-exits `true` for every owned row of that object. Inheriting the parent's
  edit authority starts with a depth primitive that can tell "org depth" from
  "nothing matched", not with these gates.

- 8af76ae: The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

  - `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
  - Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
  - New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- e18e3da: 审计行写失败改为 `error` 级,并只报一次

  按 AGENTS.md「Degradation log levels」的判据,审计写失败属 **durability / data-consistency** 类而非 functional 类:被审计的那次写入本身成功、数据已落库、接口返回 200,从外面看一切正常,只有记录「谁做的」的 `sys_audit_log` 行没有落地,而且没有任何重试。这正是 #4420 在合规账本上的同一形状,因此原先的 `WARN Audit write failed` 升级为 `error`。

  这条 `error` 同时给出**后果**与**修复方向**:审计轨迹已不完整;`sys_audit_log` 受 ADR-0057 §3.6 生命周期分流,注册了 `telemetry` 数据源时会被路由过去(`os dev` 默认以兄弟 SQLite 文件形式提供一个),所以出现 "no such table" 通常意味着该次写入执行在了与建表处**不同**的数据源连接上;`OS_TELEMETRY_DB=0` 可让所有 lifecycle-classed 对象留在主数据源。

  审计写发生在**每一次**数据变更上,因此该 `error` 全进程**只报一次**(后续失败降为 `debug`,细节仍可通过提高日志级别取回)—— 每次失败都报一遍会训练所有人略过 `error`,而这正是当初让 #4420 的 `warn` 无人阅读的反射。

  写入点提取为具名的 `persistAuditTrailRow`,并登记进 `scripts/check-durability-degradation-log-level.mjs` 的 `DURABILITY_CRITICAL_CALLEES`,由 `pnpm check:durability-log-level` 守住该级别,防止日后被悄悄改回 `warn`。

- a8dcc37: fix(service-messaging,plugin-audit): the service that writes `sys_notification` is the one that declares it (#4154)

  `MessagingService.emit()` writes `sys_notification` on every call — it is the
  pipeline's single ingress (ADR-0030 L2). But the object was contributed to the
  manifest by **`AuditPlugin`**, parked there with a comment saying it would stay
  "until that [ADR-0030] migration lands". The migration landed; the parking did
  not move.

  That left a real deployment hole, because `AuditPlugin` is an **optional** pair
  in the CLI's plugin table. Install messaging without audit and nothing registers
  the object, so the engine has no schema to issue DDL from and every `notify()`
  fails with `no such table: sys_notification`. AuditPlugin never wrote the row
  itself — it deliberately routes through this service's `emit()` ingress
  (`getMessaging()` in `audit-writers.ts`), and its own exclusion list already
  annotates the object as "messaging-owned (ADR-0030)".

  The contribution now lives with the writer, matching how every other
  service-owned platform object is handled in this repo — `service-job` imports
  `SysJob`/`SysJobRun`, `service-queue` imports `SysJobQueue`, `rest` imports
  `SysImportJob`. Ownership of the _definition_ is unchanged: the object stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`, because
  owning a definition and contributing it to a running kernel are different
  things. It is also added to the service's `provisionSystemTables`, so the table
  is created with the rest of the pipeline it heads rather than lazily on the
  first write.

  Found while migrating `notifications.hono.integration.test.ts` to in-memory
  SQLite in #4065: that suite had to register the object itself to boot, which was
  the deployment bug in miniature. The workaround is deleted in this change — the
  suite now boots messaging alone and passes, which is the proof the product
  declares what it writes.

- 3c03725: fix(plugin-audit): `activityMilestones` summary tokens render referenced record titles, not raw ids (#7290)

  ADR-0052 §5b.2 lets an object declare a semantic milestone whose summary
  interpolates `{token}`s from the record — `{ field: 'stage', value:
'closed_won', summary: 'Deal won by {owner}' }`. A token naming a `lookup` /
  `master_detail` / `user` field was interpolated with no title map, so it fell
  through to the raw stored id and the record timeline read `Deal won by oBK25…`.

  The milestone branch takes **precedence** over the tracked-change branch, so on
  every object that declares `activityMilestones` this was the string users saw,
  and #7230's fix to the tracked-change branch never reached them.

  A reference token now renders the referenced record's title, resolved through
  ADR-0079's `resolveDisplayField`. The author's template wording is untouched —
  only what a token resolves to changes — and the change is restore-invariant: an
  id with no resolvable title (target removed out of band, unregistered object,
  failing read) renders exactly as it did before. The empty-token rule is
  unchanged too: an empty value still renders as the empty string, not `∅`.

  **Read cost.** `matchMilestone` was split into detection and rendering so the
  read plan is built from the tokens of the template that actually **fired**, and
  only then. Measured with a copy-returning counting driver: every create, every
  delete, every update of a milestone-declaring object that fires no milestone,
  and every fired milestone whose template names no reference token all add
  **zero** reads; a fired milestone with reference tokens costs **one read per
  distinct target object** (two tokens onto the same object are one batched
  `id: { $in: [...] }`), paid only on the transition itself. The alternative
  placement — resolving before knowing whether a milestone fired — was measured at
  **3 reads on a write that fires nothing**, and was rejected: it is the shape
  #6656's Option A+ ruling was obtained to remove from this write path.

  A target object that designates a credential field as its title is **not read
  at all** — the same `collectMaskedReadFields` predicate the ledger masks with,
  so no secret can reach a user-facing summary through this path.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

- 3415a61: refactor(plugin-sharing,plugin-audit): enforcement implementations annotate the full `ExecutionContext` (#7136)

  The consumer half of #6523. That change converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with `SharingExecutionContext`, the six-field shape the contracts used to name,
  so nothing they could _read_ had widened.

  `SharingService`, `SharingRuleService`, the sharing exec-context seam and
  plugin-audit's comment-access gates now declare `ExecutionContext` on all 27 of
  those parameters — plus the two return types that produce the contexts feeding
  them — and the casts the narrow annotation forced are gone:

  - `exec-context-seam.testkit.ts` resolved a REAL context and then had to force
    it into the narrow type — `{ ...authz, isSystem: false } as unknown as
SharingExecutionContext`. It now returns what it resolved, so a drift in
    `resolveAuthzContext`'s output reaches the tests that trust this seam instead
    of being absorbed by a double cast.
  - `SharingRuleService`'s system context is typed as the envelope and passed as
    itself, retiring `SYSTEM_CTX as any` at all 10 of its call sites — an erasure
    on an enforcement input switches checking off for the whole argument, not
    just for the readonly-array mismatch that provoked it.
  - The `(context as any).userId` / `.tenantId` reads in `SharingService` now read
    declared fields.

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is affected.

  Two casts are deliberately kept, and are now documented where they sit:
  `__readScope` / `__writeScope` are private keys plugin-security's middleware
  stamps onto the context it forwards and are not fields of the envelope, and
  `organizationId` is not on the envelope at all — that spelling has its own
  history (#5858 / `check:org-identifier`) and was held out of this change.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module,
  `exec-context-annotation.pin.ts`: it hands each enforcement parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [48fcf70]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [3ec8186]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [b1863a5]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [5fa04fb]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [ad878e7]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [c497d26]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [bbdbf28]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [db31402]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [10c4ea9]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [8e17759]
- Updated dependencies [2ef1807]
- Updated dependencies [c519533]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [2b63a00]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [6fde910]
- Updated dependencies [60ae58e]
- Updated dependencies [9c82b89]
- Updated dependencies [7f62706]
- Updated dependencies [60cbf9d]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [b5f9397]
- Updated dependencies [1b2eb1b]
- Updated dependencies [afa6aa5]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [b7d3be4]
- Updated dependencies [afb83d3]
- Updated dependencies [2a0d65e]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [245d1dc]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [2ad1eba]
- Updated dependencies [881a3cc]
- Updated dependencies [199ec47]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [edff010]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [290d944]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [127f091]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [3670cf9]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [fce8e49]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [1eadac0]
- Updated dependencies [7777e8f]
- Updated dependencies [c804f19]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b86cf6]
- Updated dependencies [9b26699]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [dbe92a7]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [e1fa8d5]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [a6cd2c1]
- Updated dependencies [fc3a819]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [75fd301]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [fdca3a1]
- Updated dependencies [1507ba3]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [bf42e76]
- Updated dependencies [edbf873]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [1cae606]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [e3c8ed0]
- Updated dependencies [643b7c7]
- Updated dependencies [fa6dd59]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [55bbefc]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [f1da948]
- Updated dependencies [b9cc17d]
- Updated dependencies [255f2d7]
- Updated dependencies [b4ad984]
- Updated dependencies [bfe689b]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [0d24078]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [de43f94]
- Updated dependencies [5b8f95b]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
- Updated dependencies [4b0ebdb]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [37a8f2b]
- Updated dependencies [e50e479]
- Updated dependencies [c41828d]
- Updated dependencies [3fb42d2]
- Updated dependencies [8e08bc3]
- Updated dependencies [441d79f]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [4df747c]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [31fb03d]
- Updated dependencies [47a4e67]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [77fadbf]
- Updated dependencies [8dd98bf]
- Updated dependencies [4fedb11]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [89d7b35]
- Updated dependencies [1ee48bc]
- Updated dependencies [94f7b6a]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [5487c20]
- Updated dependencies [a841151]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4e74c18]
- Updated dependencies [8b90d68]
- Updated dependencies [4ac12ef]
- Updated dependencies [478f1fd]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [2680cd3]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [5f0852f]
- Updated dependencies [e787608]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [d56bcdb]
- Updated dependencies [26bb053]
- Updated dependencies [ee3bde1]
- Updated dependencies [098b629]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [d86815e]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [0a5dc29]
- Updated dependencies [e13fd91]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [50185a8]
- Updated dependencies [f8cfbb4]
- Updated dependencies [d6bd5a1]
- Updated dependencies [6e6c872]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [488b66c]
- Updated dependencies [148d451]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [6ad13bb]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [551f899]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [54f479a]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [89be40c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [f46e987]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [e3a6f6e]
- Updated dependencies [c9bf940]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a682670]
- Updated dependencies [dadb43f]
- Updated dependencies [2b52bc8]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/objectql@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0

## 17.0.0-rc.6

### Patch Changes

- c8ff269: fix(plugin-audit): consume the engine's bound `ctx.previous` and record one normalised view on both sides of the diff (#6656)

  `plugin-audit` used to fetch its own pre-image. `captureBefore`, registered on
  `beforeUpdate` / `beforeDelete`, issued a `ql.findOne` for the target row and
  stashed it on `ctx.__previous`, because `HookContext.previous` was "officially
  typed but not always populated by the engine itself". That is no longer true on
  any path this plugin registers for, so the read is retired and the writer reads
  the contract value.

  **The read that goes away** (measured with a counting driver on the audited
  object, `driver.findOne` per write):

  | write                                | before | after |
  | :----------------------------------- | -----: | ----: |
  | single-id `update()`                 |      2 |     1 |
  | single-id `delete()`                 |      2 |     1 |
  | predicate `update()`, 3 matched rows |      3 |     0 |
  | predicate `delete()`, 3 matched rows |      3 |     0 |

  The predicate column is the larger half and was pure waste. #5574 binds
  `input.id` on every per-row _before_ context, which defeated the handler's own
  `if (!id) return` bulk guard — so it read every matched row, and every result
  was discarded, because `__previous` landed on the per-row _before_ context while
  the per-row _after_ contexts (the ones the writer actually runs on) never saw
  it. The engine's own matched-row read is untouched and still serves both phases,
  so the ledger is unchanged.

  **What the ledger records changes, and deliberately.** The two sides of an audit
  diff came from two different pipelines: `before` through the engine's read path
  (credentials masked, formulas hydrated, file references resolved) and `after`
  from the raw write result. That asymmetry — not the redundant read — is why a
  write that touched one field recorded phantom "changes" for every secret, file
  and formula field on the record. Retiring the read makes both sides
  same-source; the writer now also gives them one view, so the surface levels
  upward rather than down to raw store contents:

  - **Credential fields are masked on both sides.** Single-id delete `old_value`
    still reads `••••••••` for a `secret` field — that face is byte-identical.
    Change detection still runs on the raw values, so rotating a secret is still
    recorded as a change; only the recorded values are masked.
  - **A pre-existing leak is closed.** The stored `secret:` ref was already
    reaching `sys_audit_log.new_value` on every create and update, and a
    `password` field — which ADR-0100 stores in cleartext at rest — was landing
    there **in plaintext**, in the audit ledger and in the `sys_activity` summary
    rendered in the record feed. Both now record the mask.
  - **Virtual (`formula`) fields leave the full snapshots.** `ctx.result` carries
    hydrated formulas (#5504) and the raw pre-image structurally cannot, so
    create `new_value` would have described a field delete `old_value` could
    never carry. Only genuinely virtual fields are dropped: `autonumber` and
    `summary` are stored columns present and equal on both sides, and they stay
    in the snapshot.

  Two consequences worth naming, both narrowing single-id delete to what bulk
  delete already did: its `old_value` now records a file field's stored id rather
  than the resolved `{id, name, size, url}` object, and drops formula values. An
  object whose label field is a formula falls back to the record id in the
  `sys_activity` label on delete for the same reason.

  No audit coverage is removed: the plugin keeps its `afterInsert` / `afterUpdate`
  / `afterDelete` registrations, which is what holds the engine's pre-image demand
  gates open, and every one of them keeps the `excludeObjects` face from #5860.

- 0f8d16a: perf(plugin-audit): 审计跳过名单上到注册面,平台内部表不再为白读买单 (#5860)

  plugin-audit 的五个写入注册(`captureBefore` 的 `beforeUpdate`/`beforeDelete`,
  `writeAudit` 的 `afterInsert`/`afterUpdate`/`afterDelete`)此前**不带任何对象范围**,
  因而在引擎眼里全部是全局 hook。"哪些对象要审计"这个知识一直存在 —— `SKIP_OBJECTS`
  —— 但它停在 handler 内部的早退里,注册面上看不见。于是按对象计算需求的两道门只能保守
  判真:#5284 的单 id `update()` 前置行门、#5038 的批量门,对 `sys_job_queue`、
  `sys_job_run`、`sys_upload_session`、`ai_traces` 这些表同样判"需要",每次写入白读一遍
  行集,而 handler 的第一行就返回了。放大倍数最刺眼的是 `sys_job_queue`:每条队列消息
  至少三次写入(publish / lease / terminal),自 #5160 起每封邮件都走它。

  现在这五个注册带上 `excludeObjects`(#5928 / PR #6575 落地的声明式排除面),名单由
  `SKIP_OBJECTS` **派生**而非重抄,两个面不可能各自漂移。handler 内的早退**保留**为纵深
  防御 —— 它护住的是每一个非 hook 调用方 —— 所以审计写入的行为逐位守恒,变的只是引擎
  能看见的范围。

  **为什么是减法而不是允许列表**:对象全集在运行期是开放的。`/meta` PUT 会把新对象注册进
  运行中的引擎,而 `SchemaRegistry.registerObject` 不发任何事件,插件侧没有可订阅的通道去
  追平一份枚举出来的名单 —— 那样的名单会在启动时冻结,此后新建的对象**静默**不被审计,对
  合规插件是无声的倒退。排除面没有这个失败模式:安装时没人听说过的对象默认被审计。这条性质
  已单独钉在测试里。

  顺带,`writeCommentMentions` 收为 `{ object: 'sys_comment' }` —— 它的 handler 第一行本就
  拒绝其他对象,这是一个封闭的单名允许列表,现有契约一直表达得了。行为不变,但它不再出现在
  其他任何对象的 `afterInsert` 需求里。

- 83f7743: fix(plugin-audit): localize select option labels in the tracked-change activity summary (#7289)

  `sys_activity.summary` is composed at **write time** and shipped verbatim to
  every consumer at once — the record discussion feed, console home activity, the
  header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI.
  `displayFieldValue` rendered a select/picklist value by scanning `field.options[]`
  and returning the matching option's **authored** `label`. `field.options` comes
  from `engine.getSchema(name)`, which is locale-independent metadata, while the
  shipped bundles carry those same labels under
  `objects.<object>.fields.<field>.options.<value>` (`sys_audit_log.fields.action.options.create = "创建"`).
  Nothing on this path read them.

  After #7230 localized the field label, that left a zh-CN workspace with

  ```
  阶段: Proposal → Closed Won
  ```

  — a half-localized string at the bottom of a fully-localized page. The tracked-change
  branch now resolves the option label through the same locale-bound translator its
  field label already uses, on the bundles' own key shape, with the authored label as
  the fallback. A bundle miss returns `undefined`, so the authored label and then
  `String(value)` answer exactly as before: the change can only replace an authored
  label with that label's translation, never the reverse.

  **The fired-milestone branch is deliberately left alone**, and the opt-out is by
  construction rather than by omission — `renderMilestoneSummary` passes no option
  resolver, so a select token there still renders its authored label byte-for-byte.
  A milestone summary is an author-written sentence with no bundle key of its own,
  and #7290 ruled leaving templates untranslated a contract decision. #7290's own
  change (a reference id → the referenced record's title) is locale-_independent_
  data — the same string in every locale — which is why it could be added to an
  untranslated sentence; an option label is locale-_dependent_ rendering, so reading
  the bundle there would guarantee a split sentence (`Deal moved to 已赢单`) in
  exactly the case the bundle exists for. The tracked-change branch has the opposite
  geometry: its frame is fully localized, so there the authored value is the mismatch.

  **Read cost is unchanged.** This is a bundle lookup, not I/O: zero added reads on
  every write shape, so the #6656 / PR #6977 retirement (2 → 1 reads per single-id
  write, 3 → 0 per predicate write) that #7291 and #7333 preserved still stands,
  and `displayFieldValue` stays synchronous.

  Historical rows keep their write-time composition; only new writes improve.

- 5777b1a: fix(plugin-audit): localize the tracked-change activity label and render lookup titles instead of raw ids (#7230)

  `sys_activity.summary` is composed at write time and shipped verbatim to every
  feed surface at once — the record discussion feed, console home activity, the
  header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI. Its
  tracked-change branch (ADR-0052 §5b, `"<label>: <old> → <new>"`) was producing
  strings like `Rating Owner: ∅ → oBK25…` at the bottom of an otherwise
  fully-localized page. Two independent causes, both fixed here:

  - **The label was never localized.** `renderTrackedChangeSummary` was the one
    summary branch never handed the locale-bound `translate` its three siblings
    (`messages.activityCreated` / `messages.activityDeleted` /
    `messages.activityUpdated`, plus the object label via `displayLabelFor`) all
    resolve through — an oversight against ADR-0053 / #3039 write-time
    localization. The field label now resolves through the same translator, on the
    bundles' own key shape (`objects.<object>.fields.<field>.label`), and falls
    back to the authored `label`, then the machine key, exactly as before.
  - **A reference value printed its raw id.** `displayFieldValue` resolved
    select/picklist option labels only, so a `lookup` / `master_detail` / `user`
    value fell through to `String(value)` — the stored 32-char id. It now renders
    the referenced record's title, resolved through ADR-0079's
    `resolveDisplayField` (`nameField` → deprecated `displayNameField` alias →
    derivation) rather than a local name-guessing heuristic.

  The `∅ →` notation is unchanged, and so is every other summary branch. The
  change is restore-invariant: an id that cannot be resolved — a target removed
  out of band, an unregistered object, a failing read — renders exactly as it did
  before.

  **Read cost, measured with a counting driver** (the same technique that measured
  #6656 / PR #6977's retirement of the redundant pre-image read from this write
  path, and pinned as cases in `audit-lookup-summary.test.ts`):

  - **0 added reads** on every create, every delete, every update that moves no
    tracked reference field, and every update that moves an _untracked_ one —
    including on rows that do carry references. #6977's counts (1 `findOne` per
    single-id write, 0 per predicate write) are untouched.
  - **1 read per distinct target object** on an update that does move a tracked
    reference: both sides of the change are answered by a single
    `id: { $in: [...] }` selecting only the id and title columns, however many
    tracked reference fields point at that object.

  Historical `sys_activity` rows keep their original write-time composition — only
  new writes improve.

- 3e8e669: fix(plugin-audit): forward the caller's full execution envelope to the `sys_comment` sharing gates (#7141)

  `callerContext()` in `comment-access-hooks.ts` rebuilt a five-field projection
  of the caller's `ExecutionContext` (`userId` / `tenantId` / `positions` /
  `permissions` / `isSystem`) before handing it to `ISharingService.canEdit`,
  whose contract declares the **full** envelope and whose doc block tells callers
  they "MUST NOT rebuild a subset of it" (#6523 / the #6206 ruling). #7136 (PR
  #7140) widened the return _annotation_; this is the body.

  The projection was doing two jobs at once and only one of them was correct:

  - **Dropping the middleware-private keys was correct**, and is preserved.
    plugin-security's middleware stamps the access DEPTH it resolved for the
    object of the operation in flight — `sys_comment` — onto the context in place
    (`sc.__readScope = …`), while these gates ask the sharing service about the
    **parent record's** object. Forwarding that whole would hand one object's
    widening to another object's owner-match, the stale-scope leak
    `resolveWriteScopeForSharing` was extracted to prevent. The keys are now
    dropped by the `__` **prefix** rather than by name, which also covers the
    engine's other operation-private markers on that channel (`__expandRead`
    waives the object-level CRUD check, `__referentialFieldClear` the
    referential-clear write) and cannot go stale when a fifth key is added.
  - **Dropping the principal fields was the defect.** Two of them decide the
    verdict this gate then trusts:

    - `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
      probe `SharingService.canEdit` consults last, is documented to fail CLOSED
      on a delegated context and implements that by reading exactly
      `context?.onBehalfOf?.userId`. Stripped, the guard could never fire on this
      path, and the `/mcp` OAuth agent principal that `resolve-execution-context`
      builds _with_ the delegation link reached the bypass probe looking like an
      ordinary direct call.
    - `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090 D10
      rule "an agent's grants are EXACTLY its scope-derived ceiling" on
      `principalKind === 'agent'`. Stripped, the additive human baseline was
      appended to an agent's ceiling here, so the sets the bypass probe evaluated
      were a superset of what the user consented to.

    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
    `rlsMembership` were dropped by the same projection and are forwarded now for
    the same reason.

  The same envelope-minus-private-keys rule is applied to the read side's
  parent-record probe, which spread the whole operation context into a `find` on
  a different object.

  No access depth is synthesised for the parent object: absent depth leaves the
  sharing owner-match at its narrowest (`own`), which is the safe direction and
  byte-for-byte what the projection produced. Resolving the parent's own depth
  would WIDEN this gate and is deliberately left as a separate decision.

  Enforcement effect: a delegated (`onBehalfOf`-carrying) principal is now refused
  where the contract says it is refused. No caller gains access.

- 62b6a2f: docs(spec,plugin-audit): record that the parent-record write gates match ownership at `own` BY DESIGN (#7144)

  Documentation only — no gate changes what it returns for any input.

  `ISharingService`'s write gates widen ownership "by write DEPTH", but that depth
  is an INPUT the caller supplies: the CRUD middleware resolves it for the object
  of the operation in flight and stamps it on the operation context. The
  `sys_comment` gates (`@objectstack/plugin-audit`) and the `sys_attachment` kit
  (`@objectstack/service-storage`) ask this service about the PARENT record's
  object, so the stamped depth belongs to a different object and is dropped — and
  the owner-match runs at its narrowest, `own`. A caller whose write depth on the
  parent is `unit` / `unit_and_below` / `org` can therefore edit that parent
  directly and is refused when editing a comment or attachment on it.

  That divergence is deliberate and runs in the restrictive direction (refusals,
  never a leak). The contract now says so, and — the part that matters for anyone
  tempted to "fix" it — says WHY the alternative is not merely unimplemented:
  `ISecurityService.resolveWriteScope`, the only tool a package outside
  `plugin-security` has for the parent's depth, fails OPEN, because
  `getEffectiveScope` returns `'org'` when no permission set mentions the object
  at all — indistinguishable from a genuine `modifyAllRecords` holder. Handed to a
  write gate as the depth it becomes authoritative on its own and the owner-match
  short-exits `true` for every owned row of that object. Inheriting the parent's
  edit authority starts with a depth primitive that can tell "org depth" from
  "nothing matched", not with these gates.

- 3c03725: fix(plugin-audit): `activityMilestones` summary tokens render referenced record titles, not raw ids (#7290)

  ADR-0052 §5b.2 lets an object declare a semantic milestone whose summary
  interpolates `{token}`s from the record — `{ field: 'stage', value:
'closed_won', summary: 'Deal won by {owner}' }`. A token naming a `lookup` /
  `master_detail` / `user` field was interpolated with no title map, so it fell
  through to the raw stored id and the record timeline read `Deal won by oBK25…`.

  The milestone branch takes **precedence** over the tracked-change branch, so on
  every object that declares `activityMilestones` this was the string users saw,
  and #7230's fix to the tracked-change branch never reached them.

  A reference token now renders the referenced record's title, resolved through
  ADR-0079's `resolveDisplayField`. The author's template wording is untouched —
  only what a token resolves to changes — and the change is restore-invariant: an
  id with no resolvable title (target removed out of band, unregistered object,
  failing read) renders exactly as it did before. The empty-token rule is
  unchanged too: an empty value still renders as the empty string, not `∅`.

  **Read cost.** `matchMilestone` was split into detection and rendering so the
  read plan is built from the tokens of the template that actually **fired**, and
  only then. Measured with a copy-returning counting driver: every create, every
  delete, every update of a milestone-declaring object that fires no milestone,
  and every fired milestone whose template names no reference token all add
  **zero** reads; a fired milestone with reference tokens costs **one read per
  distinct target object** (two tokens onto the same object are one batched
  `id: { $in: [...] }`), paid only on the transition itself. The alternative
  placement — resolving before knowing whether a milestone fired — was measured at
  **3 reads on a write that fires nothing**, and was rejected: it is the shape
  #6656's Option A+ ruling was obtained to remove from this write path.

  A target object that designates a credential field as its title is **not read
  at all** — the same `collectMaskedReadFields` predicate the ledger masks with,
  so no secret can reach a user-facing summary through this path.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

- 3415a61: refactor(plugin-sharing,plugin-audit): enforcement implementations annotate the full `ExecutionContext` (#7136)

  The consumer half of #6523. That change converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with `SharingExecutionContext`, the six-field shape the contracts used to name,
  so nothing they could _read_ had widened.

  `SharingService`, `SharingRuleService`, the sharing exec-context seam and
  plugin-audit's comment-access gates now declare `ExecutionContext` on all 27 of
  those parameters — plus the two return types that produce the contexts feeding
  them — and the casts the narrow annotation forced are gone:

  - `exec-context-seam.testkit.ts` resolved a REAL context and then had to force
    it into the narrow type — `{ ...authz, isSystem: false } as unknown as
SharingExecutionContext`. It now returns what it resolved, so a drift in
    `resolveAuthzContext`'s output reaches the tests that trust this seam instead
    of being absorbed by a double cast.
  - `SharingRuleService`'s system context is typed as the envelope and passed as
    itself, retiring `SYSTEM_CTX as any` at all 10 of its call sites — an erasure
    on an enforcement input switches checking off for the whole argument, not
    just for the readonly-array mismatch that provoked it.
  - The `(context as any).userId` / `.tenantId` reads in `SharingService` now read
    declared fields.

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is affected.

  Two casts are deliberately kept, and are now documented where they sit:
  `__readScope` / `__writeScope` are private keys plugin-security's middleware
  stamps onto the context it forwards and are not fields of the envelope, and
  `organizationId` is not on the envelope at all — that spelling has its own
  history (#5858 / `check:org-identifier`) and was held out of this change.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module,
  `exec-context-annotation.pin.ts`: it hands each enforcement parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [10c4ea9]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [dbe92a7]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [1507ba3]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [9bc846b]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [d13f627]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [d86815e]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [e13fd91]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- c5e7bd9: fix(plugin-audit): say where the audit system tables were provisioned, and stop skipping provisioning silently (#4887)

  `AuditPlugin.provisionSystemTables()` created `sys_audit_log` / `sys_activity` /
  `sys_comment` at `kernel:ready` and then said **nothing** — not on success, and
  not when it skipped the work entirely (`typeof engine.syncObjectSchema !==
'function'` returned silently). `syncObjectSchema()` itself returns `void` and
  has three silent exits of its own — the object is not in the registry, no driver
  resolves for it, or the resolved driver has no `syncSchema` — none of which
  throw. So "provisioned three tables" and "provisioned nothing at all" produced
  byte-identical logs, and the only way to tell them apart was to go looking in a
  database.

  #4887 is what that costs. `sys_audit_log` and `sys_activity` were reported as
  never provisioned because they were absent from the primary SQLite file, with
  the silent `typeof` bail named as the likely cause. Neither was true:
  `sys_audit_log` (`lifecycle.class: 'audit'`) and `sys_activity`
  (`lifecycle.class: 'telemetry'`) are routed by **ADR-0057 §3.6** to the
  dedicated `telemetry` datasource whenever one is registered, and `os dev`
  registers one by default as a _sibling file_ (`dev.db` → `dev.telemetry.db`).
  Both tables had been created — in the other store. `sys_comment` carries no
  lifecycle class, stays on the primary, and was the one that "existed". Nothing
  in the log connected those three facts.

  Provisioning now reports itself:

  - **Wholesale skip is a `warn`, naming the consequence** — the tables stay
    lazy-created on first WRITE, so an env that READS one first (the home page
    activity feed queries `sys_activity` before any mutation) logs "no such
    table" until something writes.
  - **One `info` line per boot listing where each table landed** —
    `sys_audit_log→telemetry, sys_activity→telemetry, sys_comment→sqlite`,
    resolved through the engine's own `getDriverForObject`, so the log states the
    routing rather than leaving it to be inferred.
  - **A second `info` line when the ADR-0057 split is in effect**, saying
    explicitly that those tables live in a different store — on SQLite, a
    different _file_ — and that anything reading them without naming the object
    (raw SQL against the default datasource) will report "no such table" even
    though provisioning succeeded.
  - **An object that resolves to no driver is a `warn`** — `syncObjectSchema()`
    returns without issuing any DDL in that case and throws nothing, so the
    per-object `catch` never fires; from outside the engine this is the only place
    it can be observed.

  Behaviour is otherwise unchanged: the same three objects are synced, per-object
  failures stay isolated, and an engine without on-demand DDL still degrades
  instead of failing `start()`.

- 0162c81: fix(plugin-audit): stop mirroring `sys_job_queue` traffic into the audit ledger (#5193)

  `SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
  from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, _"stop the
  amplifier"_. Its group (2) already listed `sys_job`, `sys_job_run` and
  `sys_automation_run`; `sys_job_queue` — the highest-volume table of that same
  family — was the one sibling missing, so every durable queue message was
  mirrored into both sinks.

  The audit hooks register for **all** objects (`afterInsert` / `afterUpdate` /
  `afterDelete`) and there is no "writes made under a system context are not
  audited" exemption, so `DbQueueAdapter`'s own writes were recorded like user
  edits. One message costs at least three of them — the publish insert, the lease
  `pending → running` update and the terminal `→ completed` update, plus one retry
  update per failure and the reaper's periodic DELETE of completed rows — each
  producing an `sys_audit_log` **and** an `sys_activity` row. Since queue-backed
  email delivery landed, that ran on every single mail. Each `beforeUpdate` also
  paid an extra `findOne` snapshot of the row it was about to change.

  `sys_job_queue` is engine-owned plumbing (`managedBy: 'engine-owned'`,
  `enable.apiMethods: ['get', 'list']`, `lifecycle.class: 'transient'`) that no
  user can write, so those rows carried no compliance value — only noise and write
  amplification. Nothing else changes: the exemption is one name in one list, and
  ordinary business objects are audited exactly as before.

  Operators who charted queue throughput off `sys_activity` should read
  `sys_job_queue` directly instead — it is the system of record for queue state,
  and unlike the audit sinks it is exposed for reading (`get` / `list`).

- 055f0c9: fix(plugin-audit): stop mirroring chunked-upload progress into the audit ledger (#5202)

  `SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
  from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, _"stop the
  amplifier"_. `sys_upload_session` was the second table missing from group (2)
  for the same reason `sys_job_queue` was (#5193): it declares
  `lifecycle.class: 'transient'` and its own object comment says what the rows are
  worth — _"an upload session is ephemeral state, never business truth"_
  (ADR-0057 / #2970 item 4) — but nothing connected that declaration to the
  exemption list, which is hand-written.

  The audit hooks register for **all** objects and there is no "writes made under
  a system context are not audited" exemption, so `StorageMetadataStore`'s own
  writes were recorded like user edits. A chunked upload of N parts costs 1 + N
  writes — the `createSession()` insert plus one `updateSession()` per chunk — and
  then a terminal status update and the row's removal, each producing an
  `sys_audit_log` **and** an `sys_activity` row: 2 × (1 + N) rows for one file,
  with a `beforeUpdate` snapshot read apiece. Each of those rows was also unusually
  fat, because `updateSession()` writes the merged **full** record, so the `parts`
  JSON blob that grows with every chunk rode along in each diff's `old_value` /
  `new_value`.

  Nothing else changes: the exemption is one name in one list, and ordinary
  business objects are audited exactly as before. In particular `sys_file` stays
  audited — it declares `transient` too, but only to reap tombstones and
  unfinished uploads; its rows are mostly permanent business truth and keep their
  compliance value.

  Operators who tracked upload activity through `sys_activity` should read
  `sys_upload_session` (in-progress state) and `sys_file` (the durable record of
  what was actually stored) instead.

- e18e3da: 审计行写失败改为 `error` 级,并只报一次

  按 AGENTS.md「Degradation log levels」的判据,审计写失败属 **durability / data-consistency** 类而非 functional 类:被审计的那次写入本身成功、数据已落库、接口返回 200,从外面看一切正常,只有记录「谁做的」的 `sys_audit_log` 行没有落地,而且没有任何重试。这正是 #4420 在合规账本上的同一形状,因此原先的 `WARN Audit write failed` 升级为 `error`。

  这条 `error` 同时给出**后果**与**修复方向**:审计轨迹已不完整;`sys_audit_log` 受 ADR-0057 §3.6 生命周期分流,注册了 `telemetry` 数据源时会被路由过去(`os dev` 默认以兄弟 SQLite 文件形式提供一个),所以出现 "no such table" 通常意味着该次写入执行在了与建表处**不同**的数据源连接上;`OS_TELEMETRY_DB=0` 可让所有 lifecycle-classed 对象留在主数据源。

  审计写发生在**每一次**数据变更上,因此该 `error` 全进程**只报一次**(后续失败降为 `debug`,细节仍可通过提高日志级别取回)—— 每次失败都报一遍会训练所有人略过 `error`,而这正是当初让 #4420 的 `warn` 无人阅读的反射。

  写入点提取为具名的 `persistAuditTrailRow`,并登记进 `scripts/check-durability-degradation-log-level.mjs` 的 `DURABILITY_CRITICAL_CALLEES`,由 `pnpm check:durability-log-level` 守住该级别,防止日后被悄悄改回 `warn`。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- be90dea: fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

  Attachments derive their visibility from the parent record; comments derived
  nothing. On the _same_ record, with the _same_ user, the two answered
  differently:

  ```
  user: rep2 (does NOT own and cannot read the opportunity)
  GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
  GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
  GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                     → 200, 1 row
  POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
  ```

  `sys_comment` is public, has no owner column, and hides its parent inside a
  string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
  RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
  every object in every app carried that org-wide readable, org-wide writable
  side-channel — a deployment that carefully authored OWD, sharing rules and RLS
  on its records still leaked their discussion.

  `AuditPlugin` now installs the same two-part kit `service-storage` installs for
  `sys_attachment`, keyed off `thread_id`'s parent:

  - **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
    query with the threads whose record the caller can actually read (resolved
    through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
    decide). `count()` is filtered identically to `find()`, so a list `total`
    cannot leak the hidden rows' existence either.
  - **write** — `beforeInsert` requires READ on the record the thread names;
    `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
    or to hold EDIT on that record. `author_id` is server-stamped from the
    session, so a client-supplied value never wins.

  Everything fails CLOSED: a `thread_id` that names no record — the dangling
  `"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
  itself — is refused on write and excluded on read, and a filter that cannot be
  computed denies all rather than falling open. Refusals answer **403
  `RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
  permission condition takes a catalogued code rather than a new synonym), with
  `error.object` naming the record's object.

  **Breaking for deployments that depended on the gap.** Reads that used to
  return other people's comments now return fewer rows (or none), and writes that
  used to 201 now 403. Specifically:

  - Listing `sys_comment` without being able to read the parent record → the row
    is gone, not merely unlabelled. Panels that render a thread must be reached by
    a principal who can read the record.
  - Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
    usable at all: creating one is refused, and existing rows become invisible to
    everyone but system context. Migrate free-form threads to a real record
    reference (or keep them under a system-context surface).
  - Deleting or editing another user's comment now requires EDIT on the record.
    Note also that `sys_comment` delete already needed a permission set carrying
    `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
  - Posting a comment no longer requires the client to send `author_id` (it is
    stamped); a client that sends someone else's is silently corrected rather than
    believed.

  Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
  an object has comments at all, and anonymous callers are still refused with 401
  before any of this runs.

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

- 04b9776: feat(plugin-audit)!: retire `sys_comment.visibility` and `sys_comment.reply_count` (#4756, ADR-0049)

  Both fields were modelled with **zero** runtime consumers — nothing in this repo,
  in `objectui`, or in `cloud` ever read or maintained either one. ADR-0049
  enforce-or-remove; maintainer decision: remove both. Same disposition, and for
  the same stated reason, as `sys_attachment.share_type` / `sys_attachment.visibility`
  in #2755 ("attachment access is derived from the parent record").

  **REMOVED — `sys_comment.visibility`** (`'public' | 'internal' | 'private'`,
  defaulted `'public'`).

  This one is a **security-looking key with no gate behind it**, which is the
  primary reason it goes rather than stays. No code path consulted it: not
  `enforceFeedsCapability`, not the record-level gates added in #4630, not the
  REST layer, not objectui's discussion panel. A comment an author marked
  `private` was visible to exactly the same people as a `public` one — an app
  author (or an AI authoring metadata) reading the field list would reasonably
  believe otherwise, and get a silent security failure instead of an error. That
  is the Prime Directive #10 trap in its textbook shape.

  There is **no replacement key**: after #4630, who can see a comment is decided
  by the record-level permissions of the record its `thread_id` names — one
  coherent rule. A per-row enum layered on top would be a second source of truth
  for the same question. The enum's only genuinely missing meaning ("hidden from
  external/portal principals") depends on external principals existing at all,
  which waits on ADR-0090 D11's `externalSharingModel`; today there is nobody to
  hide a comment from. This does not foreclose that design — when portals land,
  a visibility key can return **enforce-first**, with a real gate and tests.

  **FROM → TO:** stop sending `visibility` on `sys_comment` writes; to restrict
  who sees a discussion, restrict who can read the record `thread_id` points at.

  **REMOVED — `sys_comment.reply_count`** (`number`, `defaultValue: 0`,
  `readonly: true`).

  Never incremented anywhere, and `readonly` meant an author could not set it by
  hand either, so every row read `0` forever — a UI binding an "N replies" badge
  to it rendered `0` for every thread. Deliberately **not** replaced by an
  `afterInsert`/`afterDelete` roll-up: the predicate/bulk write-hook gaps tracked
  by #4770 / #4778 / #4779 (a hook that returns early without a single-record id
  lets the whole bulk operation through) are exactly where a hook-maintained
  counter drifts — a bulk delete of replies would never decrement it. A counter
  that drifts is worse than no counter, because both the UI and an AI reading the
  record trust it. If a badge needs the number, aggregate `parent_id` children at
  read time; a designed roll-up can be revisited once #4775's family has settled
  bulk-hook semantics.

  **FROM → TO:** replace reads of `reply_count` with a count of `sys_comment` rows
  whose `parent_id` is the comment's id.

  **Stored data.** Existing databases keep both columns as **unmanaged leftovers**
  — no migration, matching #2755. What changes where:

  - **Reads are loud everywhere.** The read-axis gates (#4134 / #4226) resolve
    field names from the object schema, not from the table, so a filter, sort,
    `select` or `expand` naming `visibility` / `reply_count` now answers
    `400 INVALID_FIELD` on every deployment, leftover column or not. A "0 replies"
    badge that silently lied becomes an error that names itself.
  - **Writes are loud on new databases only.** A database provisioned after this
    change has no such column, so the write fails at the driver and is mapped to
    the same `400 INVALID_FIELD` envelope. On a pre-existing database the leftover
    column still accepts a value nothing will ever read — record validation does
    not reject undeclared keys. Dropping the two columns is an optional manual
    cleanup, not a requirement.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- a946efd: fix(plugin-audit): the localized-summary tests stop charging a cold module load to one test's timeout (#4186)

  `audit-writers.test.ts` resolved `@objectstack/core` and its translation
  bundle with `await import(...)` inside the first localized test's helper, so
  that single test paid the whole cold-start cost — resolution plus vite
  transform of a large barrel — while every later case ran warmed in ~1ms.

  That cost is real work being billed to a per-test timeout budget. The file
  already carried a `{ timeout: 20_000 }` override for exactly this reason (its
  comment measured the cold start at ~5s on a 4-vCPU runner). Under a full-repo
  `pnpm test`, where a dozen packages' vitest workers compete, the cold start
  grew past that bound too and the case failed at 20s — reproducibly in CI-like
  load, never in isolation, which is the worst shape a red test can have: it
  tracks machine load rather than code.

  Both imports are now static. The same work happens during collection, which no
  single test's timeout is charged for, so the previously failing case runs in
  1ms and the timeout override is gone — the default timeout is now an honest
  bound, and a case that exceeds it is a real hang rather than a slow import.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- a8dcc37: fix(service-messaging,plugin-audit): the service that writes `sys_notification` is the one that declares it (#4154)

  `MessagingService.emit()` writes `sys_notification` on every call — it is the
  pipeline's single ingress (ADR-0030 L2). But the object was contributed to the
  manifest by **`AuditPlugin`**, parked there with a comment saying it would stay
  "until that [ADR-0030] migration lands". The migration landed; the parking did
  not move.

  That left a real deployment hole, because `AuditPlugin` is an **optional** pair
  in the CLI's plugin table. Install messaging without audit and nothing registers
  the object, so the engine has no schema to issue DDL from and every `notify()`
  fails with `no such table: sys_notification`. AuditPlugin never wrote the row
  itself — it deliberately routes through this service's `emit()` ingress
  (`getMessaging()` in `audit-writers.ts`), and its own exclusion list already
  annotates the object as "messaging-owned (ADR-0030)".

  The contribution now lives with the writer, matching how every other
  service-owned platform object is handled in this repo — `service-job` imports
  `SysJob`/`SysJobRun`, `service-queue` imports `SysJobQueue`, `rest` imports
  `SysImportJob`. Ownership of the _definition_ is unchanged: the object stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`, because
  owning a definition and contributing it to a running kernel are different
  things. It is also added to the service's `provisionSystemTables`, so the table
  is created with the rest of the pipeline it heads rather than lazily on the
  first write.

  Found while migrating `notifications.hono.integration.test.ts` to in-memory
  SQLite in #4065: that suite had to register the object itself to boot, which was
  the deployment bug in miniature. The workaround is deleted in this change — the
  suite now boots messaging alone and passes, which is the proof the product
  declares what it writes.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- f243727: remove(plugin-audit): drop the kernel's built-in assignment notifications; move the policy to user-space automation (#3403)

  **Breaking (behavioral).** `plugin-audit` no longer emits a `collab.assignment`
  notification when an owner/assignee field changes on a record. Deciding that an
  assignment warrants a bell is a business policy, not a platform default — the
  kernel version guessed "who is the assignee" from field names (`owner_id`,
  `assigned_to`, `assignee_id`, `owner`, `assignee`), which misfired on system
  records like `sys_file` and spammed users with "…assigned to you" noise on file
  uploads (#3402).

  **What was removed:** the `writeAssignmentNotifications` writer, the `OWNER_FIELDS`
  heuristic, and the `messages.assignedToYou` translation key (en / zh-CN / ja-JP /
  es-ES). **Unaffected:** `sys_audit_log` / `sys_activity` capture, and `@mention`
  notifications (`collab.mention`) — those remain platform behavior. The
  `owner_of:` messaging audience and `service-messaging`'s `DEFAULT_OWNER_FIELDS`
  are a separate, caller-requested mechanism and are unchanged.

  **FROM → TO migration.** If you relied on the automatic bell, configure an
  automation flow on the target object (`record-after-update` / `record-after-create`
  trigger + a `notify` node). The `condition` can read the pre-update row via
  `previous`, and `notify`'s `recipients` / `title` / `actionUrl` all interpolate
  record fields. Ready-made example: `showcase_task_assigned_notify` in
  `examples/app-showcase/src/automation/flows/index.ts`:

  ```ts
  { id: 'start', type: 'start', config: {
      objectName: 'your_object',
      triggerType: 'record-after-update',
      condition: 'assignee != previous.assignee',
  } },
  { id: 'notify_assignee', type: 'notify', config: {
      topic: 'task.assigned',
      recipients: ['{record.assignee}'],
      channels: ['inbox'],
      title: 'New assignment: {record.title}',
      actionUrl: '/your_object/{record.id}',
  } },
  ```

  Notes on parity: the flow template renders a single language (the kernel version
  localized the title to the recipient's locale); a flow fires on every real change
  (the `previous` condition already gates that) and, unless you add an actor guard,
  also notifies self-assignments — the kernel version suppressed those.

### Patch Changes

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

- f531a26: ADR-0085 #2548 follow-ups surfaced by the real-backend browser pass:

  - **lint**: new `field-group-shadowed` warning in `validate-semantic-roles` — a
    declared fieldGroup whose every visible member is hoisted into the detail
    highlight strip (or is the record title) renders on forms but silently never
    on detail pages (detail bodies hide the first 4 highlightFields). Warning
    tier, same as the other semantic-role rules.
  - **plugin-audit**: feed/audit summaries ("Created … / Deleted … / Updated …")
    now name the object by its display label ("Semantic Zoo") instead of its API
    name ("showcase_semantic_zoo") — these strings render verbatim in the record
    Discussion feed and Setup dashboards. Falls back to the API name when the
    object definition isn't resolvable. Existing stored rows are unchanged.

- f531a26: Localize activity summaries to the workspace default locale (#3039). Activity
  writers previously hardcoded English verbs and the object API name
  (`Created person_qualification "OC-00001"`). The writer now resolves the
  ADR-0053 `localization.locale` setting per write (memoized per tenant/user
  scope), renders the verb through new `messages.activityCreated/Updated/Deleted`
  i18n templates (en, zh-CN, ja-JP, es-ES shipped), and names the object by its
  localized label (`objects.{name}.label`) with fallback to the authored def
  label, then the API name. Missing i18n/settings services or bundle keys
  degrade to the previous English summaries.
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Minor Changes

- e2fa074: feat(data): make object `enable.feeds`/`enable.activities` real opt-out gates; define the `enable.trackHistory` contract (#2707)

  `ObjectSchema.enable.{files,trackHistory,activities,feeds}` were parsed but
  (mostly) unconsumed — an author setting them got nothing, silently. Per the
  enforce-or-remove doctrine, each flag now has a defined enforcement contract:

  - `enable.activities` — opt-OUT writer gate. Spec default flips
    `false → true`; plugin-audit keeps mirroring CRUD into the `sys_activity`
    timeline unless the object declares an explicit `activities: false`
    (behavior-preserving for every existing stack; the off-switch is the
    per-object lever for activity-row growth, ADR-0057). The compliance
    `sys_audit_log` row is NOT gated.
  - `enable.feeds` — opt-OUT with server-side enforcement. Spec default flips
    `false → true`; an explicit `feeds: false` now rejects `sys_comment`
    creation targeting that object at the engine hook seam
    (403 `FEEDS_DISABLED`, fail-closed like `CLONE_DISABLED`).
  - `enable.trackHistory` — was misclassified `dead` in the liveness ledger:
    the console has gated the record History tab on it since 2026-05.
    Reclassified live with the two-grain contract documented (object flag =
    History-tab master switch; per-field `trackHistory` = diff selector; audit
    _capture_ stays unconditional as a compliance ledger).
  - `enable.files` — stays dead + authorWarn (reserved for the future generic
    Attachments panel; use `Field.file`/`Field.image` meanwhile). Its
    `describe()` now says so instead of advertising a capability that
    doesn't exist.

  The default flips can't be avoided: with `default(false)`, compiled output
  materializes `false` for every object with an `enable` block, making
  "author explicitly opted out" indistinguishable from "schema default" — so
  opt-out semantics require the default to be `true` (same posture as
  `trash`/`mru`/`clone`). Liveness ledger + reference docs regenerated;
  compile-time authorWarn now fires only for `enable.files`.

- 23c8668: feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

  The last dead ObjectCapabilities flag gets its enforcement contract.
  `enable.files` is opt-IN (spec default stays `false`): the generic record
  Attachments panel is a new surface, not an existing behavior.

  - plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
    join rows may only target objects that explicitly declare
    `enable: { files: true }` — anything else (absent block, absent flag,
    explicit false, unknown object) rejects fail-closed with
    403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
  - `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
    (generic data routes bypass `sendError`'s `.status` passthrough — the
    #2707 lesson, applied at introduction time).
  - `Field.file` / `Field.image` are deliberately independent: they store
    the file URL in the record's own column and never create
    `sys_attachment` rows, so field-level attachments work regardless of
    this flag.
  - Liveness ledger: `enable.files` dead→live, authorWarn dropped —
    ObjectCapabilities is now 100% live. The compile-time
    liveness-dead-property warning no longer fires for it; `describe()` and
    the reference docs state the real contract.

  Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
  download/delete over the presigned three-step storage flow), rendered on
  record pages when the flag is true.

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.2.10

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
