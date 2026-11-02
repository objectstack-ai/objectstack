# ADR-0147: Membership-scoped RLS (`FIELD in current_user.org_user_ids`) lowers to an engine-internal organization-member semi-join leaf, not a pre-resolved id array; the visible set stays exactly what it is

**Status**: Proposed — 2026-11-02. `docs/adr/` is Tier H (Prime Directive #14): the record lands on a
`GOVERNED_APPROVERS` approval, and the execution cards under [Execution plan](#execution-plan-after-acceptance)
are cut after acceptance and ⛔ never before it. **This record declares; it implements nothing.**
- **Date**: 2026-11-02
- **Card**: [#29360](https://github.com/objectstack-ai/objectstack/issues/29360), filed from the design the
  [#29281](https://github.com/objectstack-ai/objectstack/issues/29281) developer returned (os-dev-report
  [`6577634380`](https://github.com/objectstack-ai/objectstack/issues/29281#issuecomment-6577634380), its `design`
  field, D-a to D-g) and the `domain:server` seat's ruling
  [`6577690137`](https://github.com/objectstack-ai/objectstack/issues/29281#issuecomment-6577690137) item 4.
- **The bar this record is held to** (triage, verbatim intent of
  [`6580364238`](https://github.com/objectstack-ai/objectstack/issues/29360#issuecomment-6580364238) and
  [`6575719368`](https://github.com/objectstack-ai/objectstack/issues/29281#issuecomment-6575719368)): the redesign keeps
  exactly the set #29281 holds, no wider and no narrower; a change to who can see whom is a security boundary and goes
  to the maintainer first. [D-0](#d-0--the-same-set-invariant) states it as a decision of its own.
- **Builds on**: [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) (the engine-internal
  semi-join leaf, its brand device, its position rules and its executor seam). This record **revisits two of its
  prohibitions for this one leaf and nothing else**: D1's "⛔ No second leaf" ([D-a](#d-a--predicate-shape-the-spelling-stays-the-lowering-is-a-sibling-leaf-of-readableids))
  and D3's "⛔ No `DriverCapabilities` bit returns" ([D-d](#d-d--driver-obligations-compile-or-the-exact-array-floor-chosen-up-front-never-a-refusal)),
  [ADR-0055](./0055-master-detail-controlled-by-parent.md) and [ADR-0056](./0056-permission-model-landing-verification.md)
  (the RLS compiler's deliberate lack of a subquery form, unchanged here), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md)
  D2 / D11 (`accessible_org_ids`; the `rls-membership-resolver` seam), [ADR-0091](./0091-grant-lifecycle-and-recertification.md) (validity windows), [ADR-0049](./0049-no-unenforced-security-properties.md)
  (enforce-or-remove), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the refusal envelope).
- **Amends**: three places, each by a dated, append-only pointer note and nothing else —
  [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) D1 ("No second leaf") and D3 ("No
  `DriverCapabilities` bit returns"), each revisited for this one leaf; and
  [ADR-0057-erp-authorization-core-business-units-and-scope-depth](./0057-erp-authorization-core-business-units-and-scope-depth.md)
  D3's "mirroring the `org_user_ids` cap" (the cap it cites no longer exists). That record's Status line also gains one
  inline `· **Amended**` entry pointing at the note, after its ADR-0131 entry. ADR-0139's Status line does not move.
- **Leaves unchanged**: the authoring spelling of every RLS predicate, `defaultRowScope` and shipped permission set; the
  RLS compiler's closed pushdown form set and its lack of an authorable subquery form; `ReadableIds` (ADR-0139) and
  its six consumers; the `rlsMembership` contract ([D-f](#d-f--the-same-class-rlsmembership-is-out-of-scope-with-the-reason));
  `accessible_org_ids`, `positions` and `queues`.
- **Consumers**: `@objectstack/spec` (the leaf's declaration, the `rls.zod.ts` and `execution-context.zod.ts` prose,
  the conformance case-set), `@objectstack/formula` (the CEL lowering), `@objectstack/plugin-security` (the RLS
  compiler, the in-process judges, the explainer), `@objectstack/objectql` (the executor seam and the floor
  substitution), `@objectstack/core` (the request resolver and the one materialiser), `@objectstack/driver-sql` and the
  drivers that inherit it, `@objectstack/driver-turso`, `@objectstack/driver-memory`, `@objectstack/driver-mongodb`,
  `@objectstack/driver-odata`, `@objectstack/service-analytics` (its native-SQL read-scope compiler), and the context
  builders and carriers [D-e](#d-e--org_user_ids-as-a-value-the-census-and-who-moves) names.

---

## TL;DR

`sys_user` is scoped `id == current_user.id || id in current_user.org_user_ids`. On every authenticated request the
resolver reads the active organization's `sys_member` rows into `org_user_ids`, and the predicate lowers to
`{ id: { $in: [...] } }`, one bound parameter per member. Since PR #29356 (`f72bc9e5`, #29281) the list is exact at any
size, read to completion past its first 1,000 rows. Two costs remain. The completion read sits on every request that
resolves an organization with more than 1,000 members, including requests that never touch `sys_user`. And past the
backend's bound-parameter limit every `sys_user` read fails with a 500 (measured on #29281: better-sqlite3 served
32,000 members and refused 40,000; the Postgres protocol caps a statement at 65,535 parameters).

**Decision.** The spelling stays. The compiler lowers `FIELD in current_user.org_user_ids` to a second branded
engine-internal comparand, a sibling of ADR-0139's `ReadableIds`, named `OrgMemberIds`. It means exactly
the set the list holds today: the caller, plus every non-blank `user_id` of the active organization's `sys_member` rows,
read with system authority and filtered by nothing else. The SQL family compiles it to `IN (SELECT user_id FROM
sys_member WHERE …)`. Every other evaluator (a driver that does not compile it, a federated object, an in-process
judge, the analytics raw-SQL read-scope compiler) is handed the exact array instead, computed by the completion read
#29356 landed. No evaluator refuses it. The request path then stops reading the organization's membership on every
request. ⛔ No set changes: an option that would make anyone see
anyone they do not see today is listed under [Alternatives](#alternatives-considered) as rejected.

## Context

### The mechanism today (read on `origin/main` `cafe8ee6`)

- **The predicate.** `packages/platform-objects/src/identity/sys-user.object.ts` declares the `defaultRowScope`
  `id == current_user.id || id in current_user.org_user_ids`; the shipped sets in
  `packages/plugins/plugin-security/src/objects/default-permission-sets.ts` carry the same two arms as
  `sys_user_self` and `sys_user_org_members`. RLS policies OR-combine on reads.
- **The lowering.** `packages/plugins/plugin-security/src/rls-compiler.ts#RLSCompiler` builds the `current_user` it
  resolves against in `#userContextOf`, copying `org_user_ids` from the execution context. The CEL lowering
  (`packages/formula/src/cel-to-filter.ts#lowerMembership`) emits `{ FIELD: { $in: value } }`; a context with no
  array yields `unresolved-variable` and the policy fails closed, own row included. `!(FIELD in …)` lowers to `$not`
  around the same `$in`.
- **The list.** `packages/core/src/security/resolve-authz-context.ts#resolveUserAuthzGrants` is the one place the array
  is computed. Its first leg reads `sys_member { organization_id: <active org> }` through `#tryFind` with
  `{ isSystem: true }` and no `tenantId`, so with system authority and outside the driver's tenant wall, bounded at
  `#ORG_MEMBERS_FIRST_READ_ROWS` (1,000). A read that comes back at the bound is completed by
  `#readOrganizationMembersToCompletion` (keyset pages of `#ORG_MEMBERS_PAGE_ROWS`, 10,000 rows of `id` and
  `user_id`), loud on a failed or non-advancing page. The members' `user_id`s are kept when they are non-empty strings,
  and the caller is added unconditionally. No validity window, status, role or ban filter applies.
- **Its inputs.** The active organization is the one `#vetOrganizationClaim` admits: a session whose membership in the
  claimed organization ended is re-resolved with no active organization, and then the list is `[caller]`. A principal
  with no caller resolves `[]`.
- **The rule the spec states.** `packages/spec/src/security/rls.zod.ts` says "Subquery-shaped needs are pre-resolved by
  the runtime (§7.3.1)" in its module header, and again in the predicate grammar's "does not lower" paragraph and its
  "Dynamic membership" paragraph. `packages/spec/src/kernel/execution-context.zod.ts#ExecutionContextSchema` documents
  `org_user_ids` as "Pre-resolved so RLS expressions can scope visibility of identity tables … without needing subquery
  support", and `rlsMembership` as the bag for every other such set.

### Why no existing form serves

`ReadableIds` (`packages/spec/src/data/readable-ids.ts#ReadableIds`) is the only semi-join leaf. Its meaning is "the ids
of object P **this caller may read**". ADR-0139 D2 composes its inner scope from `canReadObject` and `getReadFilter`
for the reading caller, and D3 applies the driver's tenant wall to its subquery. Neither is the membership read above,
which asks no security service and runs outside the wall. And it projects P's `id`, where this set is `sys_member.user_id`.

### What it costs

The per-request read grows with the organization, and it is paid by every request that resolves the organization,
whatever the request reads. The `IN` list grows linearly in statement size and planning cost, up to the backend's
bound-parameter ceiling, past which the read fails. The same shape bounds every pre-resolved membership set; that
class is [D-f](#d-f--the-same-class-rlsmembership-is-out-of-scope-with-the-reason)'s subject.

## Decision

### D-0 — The same-set invariant

The visible set is today a fixed function of the resolution's inputs, and every lowering this record admits answers
membership in **exactly** that set:

- **S(org, caller)** = `{ caller } ∪ { m.user_id : m ∈ sys_member, m.organization_id = org, m.user_id is a non-empty
  string }`, where `org` is the active organization the resolver vetted and `caller` is the user the list was resolved
  for.
- With no active organization, **S** = `{ caller }`. With no caller, the context carries today's empty array. With
  neither an array nor the leaf's anchor ([D-a](#d-a--predicate-shape-the-spelling-stays-the-lowering-is-a-sibling-leaf-of-readableids)) on the context, the predicate
  stays `unresolved-variable` and fails closed, as today.
- **Every driver, every posture, both polarities, every size.** `FIELD in current_user.org_user_ids` and
  `!(FIELD in current_user.org_user_ids)` select the same rows as the literal array S would, on every driver and
  in-process judge, in `single`, `isolated` and `group` posture, under and over 1,000 members.

⛔ An option that changes S, wider or narrower, is not chosen in this record. It is listed under
[Alternatives](#alternatives-considered) as rejected, with the set change it makes. Changing S is a decision of its own,
put to the maintainer first. One thing does change, and it is the inputs' age, not the rule: the leaf reads `sys_member`
when the read runs, where the array was read when the request was resolved ([Consequences](#consequences), O4).

### D-a — Predicate shape: the spelling stays; the lowering is a sibling leaf of `ReadableIds`

- **The authoring spelling is unchanged**: `FIELD in current_user.org_user_ids`, on any field of any object. The shipped
  `sys_user` scope is the main case, not the only one. No operator, no CEL function, no lint vocabulary and no
  stored predicate changes, and nothing is migrated.
- **The lowering.** The RLS compiler lowers that one comparand to `{ FIELD: { $in: OrgMemberIds.of(anchor) } }`. That
  is a second branded comparand value, declared in `packages/spec/src/data/` beside `ReadableIds`, with ADR-0139 D1's
  device unchanged. Its brand is a `Symbol.for` key, non-enumerable, and the value is frozen. A copy that crosses JSON,
  structured clone or a serializing wire arrives unbranded and is refused as a non-list comparand, ⛔ never dropped. It
  is legal only as a `$in` comparand, and only on `find`, `findOne`, `count` and `aggregate` `where`. It composes under
  `$and`, `$or` and `$not` like any `$in`. No request can spell it.
- **The anchor** is `{ organizationId, callerId }`, the two inputs of S, captured where the resolver builds the list
  today: after `#vetOrganizationClaim` and after any claim-drop re-resolution, from the same values. It is engine-internal
  (not authorable, not a request field, and not suppliable through `rlsMembership`: `org_user_ids` stays in
  `packages/spec/src/contracts/rls-membership-resolver.ts#RESERVED_RLS_MEMBERSHIP_KEYS`), and its representation on the
  context is the spec card's, as ADR-0139 left the brand's to its E1. ⛔ It is never re-derived from the reading
  context's `userId` or `tenantId` at compile time ([D-c](#d-c--the-caller-arm-ored-in-from-the-anchor)).
- **An array wins.** A context that carries a materialised `org_user_ids` array lowers the array exactly as today. So
  every context a producer hand-builds with an array answers as it does now, and only a context that carries the anchor
  and no array takes the leaf.
- **A second leaf, so ADR-0139 D1 is revisited for it.** D1 ends "⛔ No second leaf, no `EXISTS`, no correlated
  form". This record adds exactly one more leaf and keeps the other two prohibitions. D1's reason for one leaf is that
  one brand carries one meaning, so no composer has to ask which meaning it holds. That reason is kept by giving the
  second meaning its **own** brand, never a mode of `ReadableIds`
  ([Alternatives](#alternatives-considered)). ADR-0139 D1 carries a dated pointer to this record; nothing else in D1
  moves.
- **It is not a `ReadableIds` variant.** It asks no security service and composes no caller scope. Its inner read is
  fixed ([D-b](#d-b--the-inner-filter-exactly-todays-read)), so it arrives at the engine's executor seam already
  composed, and the seam passes it through rather than composing it. ⛔ No `EXISTS`, no correlated form: SQL drivers
  compile it in the list's own position:

  ```sql
  (FIELD = :caller OR FIELD IN (SELECT user_id FROM sys_member
                                WHERE organization_id = :org
                                  AND user_id IS NOT NULL AND user_id <> ''))
  ```

  With no active organization the leaf composes to the plain `$in: [caller]`, and no subquery is issued.
- **The name.** `OrgMemberIds` is the proposed name, a new export of `@objectstack/spec` beside `ReadableIds` (O1).

### D-b — The inner filter: exactly today's read

The subquery is the resolver's own read, restated as SQL, with nothing added:

- `organization_id = anchor.organizationId`, and **system authority**: no RLS on `sys_member`, no OWD, no sharing, no
  field-level security. The resolver reads `sys_member` the same way (`#tryFind` with `{ isSystem: true }`).
- **No tenant wall.** Unlike ADR-0139 D3, the driver ⛔ does not apply its tenant scope
  (`packages/drivers/driver-sql/src/sql-driver.ts#applyTenantScope`) to this subquery, and the anchor's organization is
  never replaced by the wall. Today's read runs outside the wall. In `isolated` posture the wall would repeat the
  equality. In `group` posture the wall is `organization_id IN accessible_org_ids`, and as the inner scope it would
  widen S to every accessible organization's members. Its only lawful effect is redundancy, and anything more changes S.
- **No validity, status, role or ban filter.** Today's list reads none, and adding one narrows S. (`accessible_org_ids`
  does pass its rows through ADR-0091's validity check. `sys_member` declares no validity bound today, so the two agree
  on every stored row; the asymmetry is recorded as O3 and kept.)
- **The blank-id guard** `user_id IS NOT NULL AND user_id <> ''` is today's non-empty-string filter. It also makes the
  negation NULL-safe: `FIELD NOT IN (subquery)` over a subquery holding one NULL is UNKNOWN for every row, so
  `!(id in current_user.org_user_ids)` would answer nothing where the array answers every non-member.
- **Same datasource.** The subquery reads `sys_member` on the datasource the outer object is bound to. An outer object
  on another datasource takes the floor ([D-d](#d-d--driver-obligations-compile-or-the-exact-array-floor-chosen-up-front-never-a-refusal)).
- The read is index-backed: `sys_member` declares a unique `(organization_id, user_id)` index
  (`packages/platform-objects/src/identity/sys-member.object.ts`).

### D-c — The caller arm, OR-ed in from the anchor

The list adds the caller whether or not the caller has a `sys_member` row in the active organization. The leaf ORs
`anchor.callerId` in. So `FIELD in current_user.org_user_ids` stays true for the caller in every predicate that names
it, not only in `sys_user`'s scope, where the `id == current_user.id` arm already covers the caller's own row. And its
negation stays false for the caller. The caller is the anchor's, ⛔ never the compiling context's `userId`. The
explainer's delegated context (`packages/plugins/plugin-security/src/explain-engine.ts#buildContextForUser` and the
inheritance after it) carries the **live principal's** list under the **delegator's** `userId`, so a caller re-derived
at compile time would swap one id in S.

### D-d — Driver obligations: compile, or the exact-array floor, chosen up front, never a refusal

ADR-0139 D3's "compile or refuse loudly" would narrow S here. Every `sys_user` read on a refusing driver would fail,
where today it answers. So this leaf's rule is **compile, or the floor**. The floor is the exact array S(anchor),
computed by #29356's completion read through `#resolveUserAuthzGrants` and materialised at most once per request. On
the floor path the evaluator is handed `$in: S` and answers exactly as today. ⛔ No evaluator refuses the leaf, and no
`sys_user` read fails because of it.

| Evaluator | Answer |
|:--|:--|
| `driver-sql`; `driver-sqlite-wasm` and the local Turso transport, which inherit it | compiles, in `packages/drivers/driver-sql/src/sql-driver.ts#applyFilterCondition`, with no tenant scope on the subquery (D-b) |
| the Turso remote transport (`packages/drivers/driver-turso/src/remote-transport.ts`) | compiles (the same SQL) |
| `driver-memory` | evaluates in process: reads the organization's `sys_member` rows with the guard and member-tests them, unbounded |
| `driver-mongodb` (`packages/drivers/driver-mongodb/src/mongodb-filter.ts#translateFilter`, which refuses `ReadableIds`) | **floor**; a `$lookup` compilation is a follow-up card (O2) |
| `driver-odata` (`packages/drivers/driver-odata/src/odata-driver.ts`, which refuses `ReadableIds`) | **floor** |
| a driver this repository does not ship | **floor**, unless it declares that it compiles the leaf |
| an outer object bound to another datasource than `sys_member` | **floor**: no driver evaluates a subquery across two datasources (ADR-0139 D5.3's reason) |
| the in-process judges, the plugin-security callers of `packages/formula/src/matches-filter.ts#matchesFilterCondition` that judge a compiled RLS predicate: the write gate's `check` (`packages/plugins/plugin-security/src/rls-check-stored-form.ts`, `packages/plugins/plugin-security/src/security-plugin-rls-filter.ts`), a field permission's `when` (`packages/plugins/plugin-security/src/security-plugin-object-inputs.ts`) and the explainer (`packages/plugins/plugin-security/src/explain-engine.ts`) | **floor** |
| the analytics native-SQL read-scope compiler, `packages/services/service-analytics/src/read-scope-sql.ts#compileScopedFilterToSql`, which compiles `getReadFilter`'s answer into its own SQL. Today it binds one parameter per `$in` member, throws on a non-array `$in` and refuses a `ReadableIds` leaf at entry | **floor**, chosen up front like every other row. Handed the leaf, it would refuse every analytics read of `sys_user` (and of any object whose RLS names `org_user_ids`) that answers today, the narrowing this record forbids. Compiling the subquery in its own dialect is a later card in that package's lane; until then the floor holds |

- **Chosen up front.** The engine picks the leaf or the floor before the driver call, from a declaration the driver
  makes and the engine consults. ⛔ It never catches a refusal and retries with the array (ADR-0139 D5: "the probe is
  chosen up front, never reached by catching a refusal"). ADR-0139 D3 needed no capability bit because a refusal was
  its answer. Here a refusal is excluded, so the engine must know before the call. A declaration the engine reads to
  choose the plan is consulted, so it is not the inert bit ADR-0049 removes. **This revisits ADR-0139 D3's "⛔ No
  `DriverCapabilities` bit returns" for this one leaf:** D3's reason (a bit the engine does not consult is inert)
  holds for `ReadableIds`, whose answer is compile-or-refuse, and fails here, where a refusal is excluded. ADR-0139 D3
  carries a dated pointer to this record; `ReadableIds` keeps D3 as written. The declaration's name and shape are fixed by
  the S1 spec card (O1).
- **Every occurrence, nested ones included.** The choice is made for every occurrence of the leaf in the filter an
  evaluator receives, including one inside a `ReadableIds` leaf's composed `scope`. That happens when the parent P is
  `sys_user` or any object whose RLS names `org_user_ids`, and ADR-0139 D2 composes P's scope from `getReadFilter(P)`:
  `packages/plugins/plugin-audit/src/parent-record-read-gate.ts`,
  `packages/services/service-storage/src/attachment-access-hooks.ts` and `controlled_by_parent`. `driver-sql` compiles
  a composed scope recursively (`packages/drivers/driver-sql/src/sql-driver.ts#readableIdsSubquery`), so the leaf
  compiles there too. The engine's floor substitution descends into composed scopes the same way, so a floor
  evaluator never meets a leaf nested one level down.
- **What the explainer publishes.** The explainer publishes the composed predicate as `ExplainDecisionSchema.readFilter`
  (`packages/spec/src/security/explain.zod.ts#ExplainDecisionSchema`). As a floor evaluator it materialises the array,
  and it **publishes the array**, today's wire shape. ⛔ It never publishes the leaf, which would cross the wire
  unbranded as the anchor's bare shape. A `readFilter` consumer reads the same artifact before and after, so no card
  owes a Clause-② for it.
- **The floor keeps today's costs.** That means the per-read completion and the backend's own ceiling: OData's request
  length, and MongoDB's 16 MB document bound, which is documented, not measured. On the floor path a read past that
  ceiling still fails loudly. The floor card owes it the remedy text #29356's review left open (should-fix 3: the
  refusal names the driver, the organization's member count and the remedy). On the SQL family the leaf removes the
  ceiling.

### D-e — `org_user_ids` as a value: the census, and who moves

Read on `origin/main` `cafe8ee6`. The card's list is corrected below: two of its entries read nothing, and it missed
the automation, sharing and transport carriers.

| Class | Site | Does today | After this record |
|:--|:--|:--|:--|
| **The materialiser** | `packages/core/src/security/resolve-authz-context.ts#resolveUserAuthzGrants` | computes S exactly (first read, completion) | **keeps the array, default unchanged**: it is the floor's source and the value readers' source. It gains an opt-out that only the request path uses (name: the server card's) |
| **The request path** | `packages/core/src/security/resolve-authz-context.ts#resolveAuthzContextInScope` | copies the array into every request's context | **moves**: stamps the anchor and issues no membership read. The array is materialised lazily, at most once per request (the request's grants memo), and only when a floor or a value reader asks |
| Context builders | `ScopedContext[SEED_USER_GRANTS]` in `packages/objectql/src/engine.ts`, keyed by `packages/objectql/src/hook-run-as.ts#SEED_USER_GRANTS` (run-as `'user'` hooks; `packages/objectql/src/hook-wrappers.ts` delegates to it), `packages/services/service-automation/src/plugin.ts` (run setup), `packages/services/service-automation/src/run-resume.ts` (resume re-seeding), `packages/plugins/plugin-audit/src/mention-recipient-gate.ts#contextForMentionedUser`, `packages/plugins/plugin-security/src/explain-engine.ts#buildContextForUser` | seed a context with the array for engine reads | **move to the anchor**: each builds one user's context in one vetted organization, the same pair the array used. A builder whose context crosses JSON or persistence before its reads keeps the array; run resume re-seeds at resume, so it is safe |
| Carriers | `packages/core/src/security/assemble-execution-context.ts` (the transport key list and the envelope), the explainer's delegated inheritance (D-c), `packages/services/service-automation/src/runtime-identity.ts#runOrgUserIds`, `packages/plugins/plugin-sharing/src/share-link-service.ts`, `packages/plugins/plugin-sharing/src/sharing-plugin.ts`, `packages/runtime/src/domains/share-links.ts` | copy the field between contexts | **carry the anchor** wherever they carry the array today, in the same change |
| Presence probes | `Array.isArray(ctx.org_user_ids)` as "needs peers" in `ScopedContext[SEED_USER_GRANTS]` (`packages/objectql/src/engine.ts`) and run resume; `runOrgUserIds` | treat a missing array as unresolved | **read the anchor as present**. Otherwise they re-seed (a cost) or, in `runOrgUserIds`, answer `undefined`, the policy drops out, and S narrows to nothing. The server card pins it |
| Value readers | the in-process judges (D-d); CEL evaluated in process in hooks and flows that read `current_user.org_user_ids` | read the ids | **keep the array**, materialised lazily |
| Not readers | `packages/plugins/plugin-hono-server/src/current-user-endpoints.ts` (a comment; its read is system, by id); the approvals and sharing `exec-context-annotation.pin.ts` files (type pins); the lint vocabulary in `packages/lint/src/validate-rls-predicate-enforceability.ts` and `rule-explanations.ts` (the spelling is unchanged) | — | no change |

### D-f — The same class: `rlsMembership` is out of scope, with the reason

Every `rlsMembership` key is a pre-resolved per-request array, so it has the same bind ceiling
(`packages/spec/src/kernel/execution-context.zod.ts#ExecutionContextSchema`, `rlsMembership`;
`packages/spec/src/contracts/rls-membership-resolver.ts#RLS_MEMBERSHIP_RESOLVER_SERVICE`). **This record does not let a
resolver return a leaf.** A resolver is app code. A leaf it returned would name an inner object and an inner filter for
the engine to run with system authority, and that is a general subquery door by another route, which ADR-0139 rejects,
plus a trust question this record cannot answer: who vouches for the inner scope? Nor can the same-set bar be checked
for it, because each resolver's set is the app's own definition. The ceiling stays for resolver keys. A future record
may admit a declared, platform-composed leaf per key. `accessible_org_ids`, `positions` and `queues` are bounded by the
caller's own memberships, not by an organization's size, and are out of scope too.

### D-g — Acceptance

- **The visible set is identical before and after**, for organizations under and over 1,000 members, at every step of
  the execution plan.
- **PR #29356's two pins stay byte-unchanged and green at every step:**
  `packages/core/src/security/resolve-authz-context.org-members-past-first-read.test.ts` (it exercises the
  materialiser, whose default does not change) and
  `packages/plugins/plugin-security/src/sys-user-org-members-past-first-read.test.ts` (by search and by id, on a real
  `driver-sql` with the shipped `member_default`).
- **New pins**, each on the leaf path and on the floor path:
  - **Group posture**: a member of organization A with access to organization B, active in A, sees A's members and ⛔
    none of B's.
  - **NULL `user_id` negation**: with a `sys_member` row of the organization whose `user_id` is NULL,
    `!(id in current_user.org_user_ids)` answers every non-member, as the array does.
  - **Caller arm**: a caller with no `sys_member` row in the active organization is in S (`x in` is true for the
    caller, and the negation is false).
  - **No active organization**: S is `{ caller }`, and no subquery is issued.
  - **Delegation**: a delegated explanation's S carries the live principal, not the delegator.
  - **Floor parity**: a floor evaluator and the SQL family answer the same rows on the same fixture.
  - **Analytics**: a native-SQL analytics query over `sys_user` answers the same rows as a direct `find` of
    `sys_user` for the same caller (the floor path of `compileScopedFilterToSql`), and is never refused.
  - **Nested**: a `ReadableIds` leaf whose parent is `sys_user` (an attachment or activity row about a user record)
    answers the same rows on the SQL family, where the inner leaf compiles, and on a floor evaluator, where the
    substitution descends.
  - **Explain**: `readFilter` carries the array, byte-identical to today's for the same fixture.
- **The ceiling, on the SQL family**: an organization of 40,000 members, which better-sqlite3 refuses today, answers its
  members. That is the ceiling's removal; the set is still S.

## Consequences

- **Positive.** The request path issues no read of the **organization's** membership, on any request. (Leg 1 of
  `#resolveUserAuthzGrants` still reads the caller's own `sys_member` rows, `{ user_id }`, on every request for
  `accessible_org_ids` and the roles; that read is bounded by one user's memberships and does not move.) On the SQL family the bind-parameter
  ceiling goes, and a `sys_user` read is one statement, so `find`, `count` and `aggregate` agree by construction.
- **Cost, named.** Every `sys_user` read carries an index-backed subquery. Spec gains one leaf and one driver
  declaration (two new public names, O1). The engine gains a floor substitution. Five driver packages get a compile or
  floor answer, the analytics read-scope compiler takes the floor, and the D-e sites move. That is roughly four cards
  over four lanes
  ([Execution plan](#execution-plan-after-acceptance)).
- **Failure surface.** Unchanged in kind: a `sys_member` outage still fails every request's resolution (503) through
  Leg 1's own read. A failure of the leaf's subquery fails that read with the driver's error envelope, never a shorter
  list.
- **Freshness.** The leaf reads `sys_member` when the read runs. With the opt-in cross-request grants cache on
  (`OS_AUTHZ_GRANTS_CACHE_TTL_MS`, `packages/core/src/security/resolve-user-grants-cache.ts`), the array could be as
  old as its cache entry, and the leaf never is. The rule is the same; its inputs are newer (O4).
- **Floor evaluators** keep today's per-read cost and their own ceiling until they compile (O2).
- **Each execution card declares its own Clause-②.** The SQL-family card turns a past-ceiling 500 into an answer.

## Alternatives considered

- **Generalise `ReadableIds`** with a projected column and a fixed system scope: rejected. Its one meaning, "the ids of
  P this caller may read", is its safety argument. Two meanings under one brand make every composer branch. And the
  natural generalisation, the caller's read scope on `sys_member`, makes S a function of the caller's grants on
  `sys_member`, which S's definition does not read: a set change.
- **The tenant wall as the inner scope**: rejected. In `group` posture it widens S to every accessible organization's
  members (D-b).
- **A validity-window, status, role or ban filter on the inner read**: rejected. Each narrows S, since today's list reads
  none. Adding one is a decision for the maintainer.
- **Refuse on a driver that does not compile it** (ADR-0139 D3 as written): rejected. It fails every `sys_user` read on
  MongoDB and OData, which narrows S to an error.
- **Catch the refusal and fall back to the array**: rejected. That is a silent re-entry and a second read; the plan is
  chosen up front (D-d).
- **`EXISTS` or a correlated subquery**: rejected (ADR-0139 D1). `IN (subquery)` sits in the list's own position, so the
  shared `$not` lowering and the three-valued semantics carry over unchanged.
- **An authorable operator or CEL function** (`$inMembers`, `isMember()`): rejected. Authorable means AI-writable; it
  would open a spelling to keep closed and serve no set the existing spelling cannot.
- **Re-derive the caller from the compiling context**: rejected. It swaps the delegator for the principal (D-c).
- **Raise the bound, or keep paging on every request**: that is #29356's interim. It stays only as the floor.
- **A materialised member column on `sys_user`**: rejected. `sys_user` has no organization column, and the column would
  be stale the moment a membership changes (ADR-0055 (c)'s reason).
- **Resolver-returned leaves**: deferred (D-f).

## Open items (not blocking acceptance; each becomes a reading on its card)

- **O1** — Names. The leaf's proposed name is `OrgMemberIds`. The driver's compile declaration is named by the S1
  spec card. Both are new public names in `@objectstack/spec`; naming is the lane seat's call, with no separate
  maintainer gate.
- **O7** — The analytics read-scope compiler takes the floor. Compiling the leaf in its own SQL is a later card in the
  `service-analytics` lane, measured against the floor-parity pin.
- **O2** — `driver-mongodb`: the cost of a `$lookup` compilation is unprototyped (shared with ADR-0139 O3). It takes
  the floor until measured.
- **O3** — `org_user_ids` reads no ADR-0091 validity window where `accessible_org_ids` applies one. Since `sys_member`
  declares no bound today, no stored row is answered differently. This record keeps the asymmetry: closing it would
  change S on the day `sys_member` gains a bound, and that is the maintainer's decision.
- **O4** — Freshness against the opt-in grants cache (Consequences). The rule is the same; only the inputs' age
  differs, inside the cache's accepted staleness contract. Not a set change.
- **O5** — Ceilings. SQLite: 32,000 members served and 40,000 refused, measured on #29281 (better-sqlite3). Postgres:
  65,535, documented. OData and MongoDB floor ceilings: unmeasured.
- **O6** — `packages/plugins/plugin-auth/src/admin-set-user-manager.ts` quotes ADR-0057 D3's "mirroring the
  `org_user_ids` cap". The quotation stays accurate as a quotation, and the request-path card carries the comment's
  correction.

## Acceptance criteria

The maintainer approves this record (Tier H), with the three pointer notes it carries: ADR-0139 D1 ("No second
leaf"), ADR-0139 D3 ("No `DriverCapabilities` bit returns"), and ADR-0057-erp D3's "`org_user_ids` cap" bullet. Each is
append-only and dated. ADR-0057-erp's Status line carries the one inline `· **Amended**` entry that points at its note;
ADR-0139's Status line does not move.

## Execution plan (after acceptance)

The `domain:spec` lane cuts S1, and the `domain:server` lane cuts V1 to V4, from the accepted record. ⛔ None is filed
before acceptance, and none changes `packages/spec` before it. Every card keeps PR #29356's two pins byte-unchanged and
green (D-g).

| Card | Decisions | What lands | Pins (red before, green after) | Order |
|:--|:--|:--|:--|:--|
| **S1** — the leaf | D-0, D-a, D-d | the leaf beside `packages/spec/src/data/readable-ids.ts`; the comparand door admits the branded value and refuses the unbranded one; the driver's compile declaration; the `rls.zod.ts` §7.3.1 exception prose (module header, the "does not lower" paragraph, "Dynamic membership"); the `execution-context.zod.ts` `org_user_ids` and `rlsMembership` prose; the per-driver conformance case-set (compiles, or floor) | a JSON round-trip of a `where` holding the leaf is refused; the plain-object spelling is refused 400; the case-set holds the NULL-negation, caller-arm and no-active-organization cases | first |
| **V1** — lowering and floor | D-a to D-d | `cel-to-filter.ts` and `rls-compiler.ts` lower the comparand to the leaf when the context carries the anchor and no array; the engine seam passes a composed leaf through, or substitutes the exact array for a floor evaluator or a federated object, descending into composed `ReadableIds` scopes; the in-process judges and the explainer take the array (the explainer publishes it); the analytics read-scope compiler (`domain:services`, `service-analytics`) is handed the floor | group posture; NULL `user_id` negation; caller arm; no active organization; an array on the context still lowers the array; nested; analytics; explain `readFilter` unchanged | after S1 |
| **V2** — SQL family and memory | D-b, D-d | `driver-sql` compiles the leaf with no tenant scope on the subquery; wasm and local Turso inherit it; the remote transport compiles it; `driver-memory` evaluates it; MongoDB and OData declare the floor | floor parity; `count` equals the rows served; 40,000 members answer on better-sqlite3; the floor's past-ceiling refusal names the driver, the count and the remedy | after V1 |
| **V3** — the request path | D-e | `resolveAuthzContextInScope` stamps the anchor and reads no membership; the lazy materialisation; the context builders, carriers and presence probes of D-e; the `admin-set-user-manager.ts` comment (O6) | a request in a 1,005-member organization issues no membership read unless a reader asks; run-as, automation, mention and delegated-explain contexts answer the same S | after V2 |
| **V4** — MongoDB compiles (optional) | D-d, O2 | `$lookup` compilation, measured | floor parity, now on the leaf path | after V2; its own card |
