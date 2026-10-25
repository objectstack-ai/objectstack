# ADR-0142: An ownership queue is a platform primitive — a queue entity, membership through the existing recipient kinds, claim through the ownership-transfer gate, and declarative assignment rules evaluated on insert

**Status**: Proposed (2026-10-25). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by the
maintainer's merge, and ⛔ the one PR under [Execution plan](#execution-plan-after-acceptance) is cut after that merge,
never before it. Until a published `@objectstack/*` release carries that PR, HotCRM keeps the STOPGAP module this record
exists to retire. **This record declares; it implements nothing** — no schema, no code, no changeset.
**Decided by**: one maintainer ruling and one triage grade on
[#25769](https://github.com/objectstack-ai/objectstack/issues/25769), executed here as written and ⛔ not re-opened:

- Ruling on decision **D6** of the whole-project assessment (Tesla, director thread, 2026-10-25T09:23Z), whose options
  were "A = queue/assignment rules are a real platform need, file the objectstack card, hotcrm deletes its STOPGAP after
  it lands; B = it is legitimate app logic". Verbatim, untranslated:
  > 「D4 · 固定发版日 没必要；其他同意 ，npm dist-tag 手工清理 应该立一张管理者维护的卡」

  「其他同意」 was read as **A** and the director thread said so back to the maintainer at 09:25Z. Queue and assignment
  rules are platform.
- Triage grade on the card ([`6396200200`](https://github.com/objectstack-ai/objectstack/issues/25769#issuecomment-6396200200)),
  verbatim: *"ADR first (the queue entity, membership, claim and assignment rules; Tier H, the maintainer approves the
  shape). Then the spec keys, which re-admit the reserved `queue` approver type and sharing principal. Then the server
  runtime."*
- Project rule **D5** of the same ruling, landed in the pm-dispatch skill by #25795 at `5f5f0b42`
  (`.claude/skills/pm-dispatch/references/cross-repo-coordination.md`), verbatim: 「`main` 有 `ui/` 起,新 spec 键不再先行、
  取代上句次序:与首个读者同 PR,hotcrm 读者同合并批。」 — a spec key lands with its first reader, so the later spec + server
  phase is **one** PR.

**Builds on**: [ADR-0019](./0019-approval-as-flow-node.md) (approval is a flow node; approver resolution, `queue`
included, "moved nearly verbatim under the node"), [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md)
(a capability plugin owns its `sys_*` objects and its behaviour), [ADR-0049](./0049-no-unenforced-security-properties.md)
(enforced / `experimental` / absent — no fourth state), [ADR-0056](./0056-permission-model-landing-verification.md) D3, D5,
[ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) D1, D3, D5 (scope depth on `owner_id`;
pre-resolved membership sets; the comparison table's "Public Group/Queue" row),
[ADR-0058](./0058-expression-and-predicate-surface.md) D1–D3 (one CEL compiler; the pushdown subset; live membership
resolves as a pre-resolved `current_user.*` set, never a stored static filter),
[ADR-0073](./0073-automation-execution-identity.md) D2, D3 (`runAs` is posture; attribution ≠ ownership),
[ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) (what a hook is for),
[ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert instance),
[ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) D1 (a sharing rule is hybrid: shape is
metadata, a recipient naming a real team or queue is config), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md)
D2, [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D3, D8 (positions are flat; teams receive sharing and
never carry capability), [ADR-0111](./0111-record-share-management-authority-and-verb-boundary.md) D3, D7 (a share widens
rows, never verbs; no inert recipient), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) D1, D3,
[ADR-0117](./0117-owning-business-unit-record-stamp.md) D1, D4 (a second ownership anchor beside `owner_id`; changing it
is a transfer-class write), [ADR-0118](./0118-non-user-actor-contract.md) D2, D3 (absence is never system; a system
context is constructed explicitly at an entry point),
[ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D1, D3, D4, D6 (no NULL organization;
definitions live in the registry and assignments are organization rows; catalog items are referenced by name;
`sharing_rule` under regime C with two sources), and **[ADR-0138](./0138-guest-model-anonymous-principal-doors-grants-and-organization.md) D1**
— accepted and binding: *"Ownership of a guest-written row is the business scenario's own metadata … the object's hooks,
record-change flows and assignment rules run as they do for any insert. The platform stamps nothing on a guest insert
and declares no organization-level default owner"*, with the maintainer's words in its Alternatives:
「访客写进来的记录归本组织声明的一个内部人,这个没必要吧,应该是每个业务场景在元数据级别自己处理吧」. This record amends
nothing in D1: an assignment rule is the scenario's own metadata, declared by the package or the organization, and the
platform still declares no default owner (D5 below says exactly where the two meet).
**Consumers**: `@objectstack/spec` (`security/sharing.zod.ts`, `automation/approval.zod.ts`, `contracts/sharing-service.ts`,
`kernel/metadata-plugin.zod.ts`, `stack.zod.ts`), `@objectstack/objectql` (the insert pipeline in `engine.ts`; the injected
columns in `registry.ts`), `@objectstack/plugin-security` (the owner anchor and transfer gate; the claim admission; the public-form strip),
`@objectstack/plugin-sharing` (the owner match in `SharingService` — the access path; `expandRecipient`; the two recompute
modules; the new objects), `@objectstack/plugin-approvals` (`resolveApproverSpec`), `@objectstack/lint`
(`validate-org-axis-red-lines.ts`, `validate-approval-approvers.ts`), the dogfood conformance matrix, the `objectui`
Console (a queue picker, a Claim affordance) and HotCRM.
**Evidence**: every anchor into this repository was read at `origin/main` `5f5f0b42`, the base of this record's branch.
HotCRM was read from a read-only clone of `objectstack-ai/hotcrm` at `8f52859`; its anchors are spelled cross-repo
(`hotcrm:…`), which `scripts/check-adr-symbol-anchors.mjs` reports and does not judge.

---

## TL;DR

1. **A queue is a named set of people that records can sit in.** It has the two sources `sharing_rule` has under
   ADR-0131 D6 regime C: a package declares a `queue` (a metadata type, code, sealed) and an organization authors its own
   as `sys_queue` rows. Its members are written with the recipient vocabulary the sharing engine already expands —
   `user`, `team`, `position`, `business_unit`, `unit_and_subordinates` — and expanded by the expanders that exist today.
   No new principal kind.
2. **A record sits in a queue when its `owner_id` is empty and a new system-managed column `queue` names one.** The owner
   anchor stays a `sys_user` lookup and every reader of it is untouched. Members of the queue read and edit the records
   sitting in it through one pre-resolved membership set, added to the owner match where `plugin-sharing` builds it — the
   form ADR-0057 D3 and ADR-0058 D3 already prescribe for access that follows live membership.
3. **Claim is an update of `owner_id` to the caller, adjudicated by the existing transfer gate** (step 3.5 of
   `packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts#registerAuthzMiddleware`), which gains two
   narrow admitted cases: a caller taking an unowned record the sharing service positively admits them to (a queue
   member on a record sitting in their queue is the common case), and an owner releasing their own record back to its
   queue. The claim is
   written conditionally on the owner still being empty, so a race has one winner. Moving a record to another queue is a
   transfer-class write and needs `allowTransfer`. Nothing goes around the gate, and no hook spells ownership as a status
   change any more.
4. **An assignment rule is declared metadata — criteria → a queue or a user, with `round_robin` and `least_loaded` as
   named strategies over the queue's members.** It evaluates once, on insert, after every `beforeInsert` hook and before
   the write, only for a row that still has no owner; a writer-supplied, middleware-stamped or hook-set owner is respected.
   Its reads run under an explicit system context pinned to the row's organization. An empty pool never blocks intake: the
   row sits in the queue, visibly, and the platform logs once.
5. **The two reserved members return only with all of that in place.** The `queue` approver type resolves to the queue's
   members; the `queue` sharing recipient expands to them and is recomputed when membership moves. Each is authorable on
   the day its runtime branch is enforced and pinned — not before (ADR-0049, ADR-0078, Prime Directive #10).
6. **The first consumer is HotCRM.** The platform replaces its intake round-robin for cases and leads, its self-claim
   gesture and its triage sharing rule. It does **not** replace the escalation hand-off, which re-routes on an update —
   a finding, carried as merge question 5.

---

## Context

### 1. What the platform does today (measured at `5f5f0b42`)

**The owner anchor is system-managed, and the gate adjudicates it before any hook runs.** Step 3.5 of the authz
middleware (`packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts#registerAuthzMiddleware`): on INSERT
an empty `owner_id` is stamped with the acting user, batch rows included; a supplied owner that is not the acting user is
a forge, denied without the transfer grant (`allowTransfer`, or `modifyAllRecords` which implies it). On UPDATE a supplied
`owner_id` is a transfer, or a disown when null, denied without the grant; the single-id echo of an unchanged owner is
tolerated by reading the caller's pre-image; a bulk change-set carrying `owner_id` fails closed. A guest is stamped with
nothing and refused whatever it supplies (ADR-0138 D1). Under delegation both principals must hold the grant (ADR-0090
D10). The middleware wraps the whole operation, so a `beforeInsert` hook that writes `owner_id` into the payload is
invisible to it — the step's own text says a hook "runs inside the engine's operation, after this middleware". The
permission bit's description records the same fact from the spec side: `allowTransfer` is *"ENFORCED via the
insert/update owner_id guard"* and *"the dedicated M2 `transfer` operation will reuse the same bit"*
(`packages/spec/src/security/permission.zod.ts#ObjectPermissionSchema`). `transfer` is a member of the explain vocabulary
(`packages/spec/src/security/explain.zod.ts#ExplainOperationSchema`), resolves to the `allowTransfer` grant bit
(`packages/core/src/security/effective-object-permissions.ts#GRANT_BITS`), and is **not** an engine operation: the
engine's dispatch vocabulary test lists it among the verbs that never reach the engine
(`packages/objectql/src/engine-middleware-operation-vocabulary.test.ts#DESTRUCTIVE_LIFECYCLE_VERBS`), and the explain
engine defers a `transfer` to the by-id update of `owner_id` (`packages/plugins/plugin-security/src/explain-engine.ts`).

**Every reader of the owner anchor reads `owner_id`, a lookup to `sys_user`; the owner match is built in
`plugin-sharing`, and one ownership gate reads `created_by`.** The injected column is
`packages/spec/src/data/injected-system-column-provenance.ts#OWNER_FIELD_DEF` — `type: 'lookup'`, `reference: 'sys_user'`,
`readonly: false` — provisioned by `packages/objectql/src/registry.ts#applySystemFields` under `ownership: 'user'` (the
default) and withheld under `business_unit`, `org` and `none`. Its readers: the scope-depth grants (`own` resolves to
`owner_id IN [me]`; `packages/spec/src/security/permission.zod.ts#ObjectAccessScopeSchema`, ADR-0057 D1), which the
middleware only **stashes** as a depth (`__readScope` / `__writeScope`, step 2.6) for the sharing service to build the
owner match from — `packages/plugins/plugin-sharing/src/sharing-service.ts#buildReadFilter` (the `ownerMatch`, OR'd with
the caller's `sys_record_share` ids), `packages/plugins/plugin-sharing/src/sharing-service.ts#buildWriteFilter`, and
`packages/plugins/plugin-sharing/src/sharing-service.ts#checkEdit`, whose ownership fast path
`packages/plugins/plugin-sharing/src/sharing-service.ts#matchesOwnerScope` — shared with `checkDelete` — *"Returns
`false` when the record has no owner value"*; every "my records" view filter (`{current_user_id}`); the messaging
audience `owner_of:`
(`packages/services/service-messaging/src/recipient-resolver.ts#DEFAULT_OWNER_FIELDS`); the ADR-0117 `follow_owner`
policy (not landed — the column it stamps is "provisioned but inert", the registry's own words); and the seed-ownership
claim, whose NULL arm since #23354 re-owns only the ids a seed reported landing on, so an unowned row left by a guest or
a form stays as its writer left it (`packages/plugins/plugin-security/src/claim-seed-ownership.ts#claimSeedOwnership`).
The by-id write path carries a second gate on ownership that does **not** read `owner_id`: the platform floor
`owner_only_writes` / `owner_only_deletes` is `created_by == current_user.id`
(`packages/plugins/plugin-security/src/platform-ownership-policies.ts#OWNERSHIP_FLOOR_PREDICATE`, "a second
implementation of ownership" in its own header), checked at step 2.7 and replaced only when the sharing write verdict is
`allow` (`packages/plugins/plugin-security/src/security-plugin-sharing-verdicts.ts#resolvePreImageFloorDrop`). A
guest-written row has no `created_by`, so anyone editing it must reach `allow`. Pre-resolved membership sets have a
producer contract: `packages/spec/src/contracts/rls-membership-resolver.ts#IRlsMembershipResolver` (ADR-0105 D11) fills
`ExecutionContext.rlsMembership` under keys a policy reads as `IN (current_user.<key>)`. The spec's polymorphic pointer
shape is `referenceVia` (`packages/spec/src/data/field.zod.ts`), and `owner_id` is not one.

**The insert pipeline, in order** (`packages/objectql/src/engine.ts`): the middleware; field defaults
(`packages/objectql/src/engine.ts#applyFieldDefaults`); the `beforeInsert` hooks; the organization derivation for a
system write (`packages/objectql/src/engine.ts#resolveSystemInsertOrganization`, ADR-0131 D9 — so a hook runs before
the row's organization is final when the writer
named none); the driver write; the `afterInsert` hooks. A hook sees `previous`, `dispatch.mode` (`record` or `per-row`),
`session`, `user` and `api` (`packages/spec/src/data/hook.zod.ts#HookContextSchema`), and declares `runAs` with the
flow's two values plus `inherit` (`packages/spec/src/data/hook.zod.ts#HookSchema`).

**The two reserved members, as the code holds them.**

| Member | Declared | Enforced | Guarded |
|:--|:--|:--|:--|
| approver `queue` (`packages/spec/src/automation/approval.zod.ts#ApproverType`) | still parses; comment: *"Re-admit only together with a real ownership-queue implementation (queue entity + membership + claim)"* | `packages/plugins/plugin-approvals/src/approval-service.ts#resolveApproverSpec` has no queue branch: it warns *"approver type 'queue' is not implemented — the slot resolves to nobody"* and returns the literal `queue:<value>` slot, which no reader addresses | `packages/spec/src/automation/approval.zod.ts#NON_AUTHORABLE_APPROVER_TYPES` (published as `xEnumDeprecated` on `#ApprovalNodeApproverSchema`), `#APPROVER_VALUE_BINDINGS` `queue: { source: 'unsupported' }`, `#APPROVER_ORG_SCOPED` `queue: false`; the `xRef.map` keeps `queue` so stored rows render |
| sharing recipient `queue` | absent from the authorable enum `packages/spec/src/security/sharing.zod.ts#ShareRecipientType`; carried by the runtime union `packages/spec/src/contracts/sharing-service.ts#SharingRuleRecipientType` — *"reserved: no `sys_queue` yet, `expandRecipient` returns `[]`, deliberately not authorable"* | `packages/plugins/plugin-sharing/src/sharing-rule-service.ts#expandRecipient` falls through to `return []` ("treat as no-op until queue impl lands"); the recompute modules exclude it by name (`packages/plugins/plugin-sharing/src/bu-tree-recompute.ts#BU_TREE_RECIPIENT_TYPES`; `packages/plugins/plugin-sharing/src/recipient-membership-recompute.ts#RECIPIENT_MEMBERSHIP_SOURCES`) | the lint red-line table says *"If it ever becomes authorable it is a work-distribution list, not a BU node — but this table is the place to re-decide that, in `ShareRecipientType` order"* (`packages/lint/src/validate-org-axis-red-lines.ts#validateOrgAxisRedLines`); migration 17 records it as *"runtime-reserved and deliberately non-authorable"* (`packages/spec/src/migrations/entries/semantic/17.sharing-rule-recipient-reconcile.ts#entry`); the dogfood `sharing-rules` row names it as *"the one runtime `SharingRuleRecipientType` member deliberately absent"* and asks to be re-checked when the enum moves (`packages/qa/dogfood/test/authz-conformance.matrix.ts#AUTHZ_CONFORMANCE`); `packages/plugins/plugin-sharing/src/access-level.ts` still says the recipient *"was removed"* |

No `sys_queue`, no `queue` metadata type and no assignment-rule concept exists anywhere under `packages/spec/src` (zero
hits for `assignment_rule` / `AssignmentRule`). The word `queue` already names something else in this tree: the job-queue
service capability (`packages/spec/src/kernel/platform-capabilities.ts`, `@objectstack/service-queue`) and its table
`sys_job_queue` (`packages/platform-objects/src/audit/sys-job-queue.object.ts`). D9 keeps the two apart.

**Membership already has one vocabulary and one set of expanders.** The five rule-wide recipient kinds resolve through
`PositionGraphService` (`sys_user_position` ∪ the better-auth `sys_member.role` transition source;
`packages/plugins/plugin-sharing/src/position-graph.ts#PositionGraphService`), `TeamGraphService` (`sys_team_member`;
`packages/plugins/plugin-sharing/src/team-graph.ts#TeamGraphService`) and `BusinessUnitGraphService` (one unit's
members, or the subtree; `packages/plugins/plugin-sharing/src/business-unit-graph.ts#BusinessUnitGraphService`), each
scoped to the rule's organization. The sixth kind, `field`, expands per record
(`packages/plugins/plugin-sharing/src/sharing-rule-service.ts#expandRecipientForRecord`) and is not a set of people. The
membership objects: `packages/plugins/plugin-security/src/objects/sys-user-position.object.ts#SysUserPosition` (`user_id`,
`position` as a machine name, `organization_id`, `business_unit_id`, a validity window),
`packages/platform-objects/src/identity/sys-team.object.ts#SysTeam` with
`packages/platform-objects/src/identity/sys-team-member.object.ts#SysTeamMember`, and
`packages/platform-objects/src/identity/sys-business-unit.object.ts#SysBusinessUnit` with
`packages/platform-objects/src/identity/sys-business-unit-member.object.ts#SysBusinessUnitMember`. The approvals engine
carries a **second** position expander (`packages/plugins/plugin-approvals/src/approval-service.ts#expandPositionUsers`),
which `position-graph.ts`'s header says is "deliberately NOT identical" — a duplication this record does not add to.

**`sharing_rule` is the precedent for a thing with two sources.** The metadata type is code-only in the registry
(`allowRuntimeCreate: false`, `packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY`), declared
rules are read from the registry on every evaluation and never materialised as rows
(`packages/plugins/plugin-sharing/src/declared-sharing-rules.ts#createDeclaredSharingRuleSource`, ADR-0131 D2), an
organization authors its own in `packages/plugins/plugin-sharing/src/objects/sys-sharing-rule.object.ts#SysSharingRule`,
a same-name row is refused, and the declared shape translates into the runtime row shape
(`packages/plugins/plugin-sharing/src/declared-sharing-rules.ts#translateDeclaredSharingRule`: `sharedWith{type,value}`
→ `recipient_type` / `recipient_id`, CEL `condition` →
`criteria` through the one canonical compiler `packages/formula/src/cel-to-filter.ts#compileCelToFilter`, ADR-0058 D1). A
position is the precedent for a catalog item referenced **by name** from organization rows (ADR-0131 D3/D4:
`sys_user_position.position` is a text machine name; `packages/spec/src/identity/position.zod.ts#PositionSchema`), and
ADR-0131 D3 states the split this record reuses: *"Assignments are organization rows, in every posture."*

**Concurrency primitives available to a cursor.** `IDataDriver.updateMany(object, query, data)` is an optional driver
method (`packages/spec/src/contracts/data-driver.ts`) with a declaration site in `driver-memory`, `driver-mongodb`,
`driver-sql` and `driver-turso`; `driver-sqlite-wasm` declares none of its own and its tests call the one it is built on.
Every shipped driver therefore answers it, and the contract still allows a driver that does not. A conditional update —
"set the cursor to N+1 where it still reads N" — is expressible with it; no atomic increment exists. The data path has one
conditional-update contract already: `PATCH` and `DELETE` take an opt-in `If-Match` header or `expectedVersion` token
(`packages/spec/src/api/protocol.zod.ts`, `packages/rest/src/crud-routes.ts`) and answer **409 `CONCURRENT_UPDATE`** when
it differs from the row's `updated_at` (`packages/metadata-protocol/src/protocol.ts#ConcurrentUpdateError`) — compared in
`updateData` over the existence probe, before `engine.update`, so it is compare-then-write, not atomic.

### 2. The pull — HotCRM at `8f52859`

HotCRM's `AGENTS.md` rules 1–2 forbid exactly what it had to do: a platform gap is filed upstream, never compensated, and
a platform defect means waiting for the fix (`hotcrm:AGENTS.md`). The module
`hotcrm:src/service/objects/_case-assignment.ts` (587 lines) opens with "⛔ This module is a STOPGAP. It is the code to
delete" and carries three factories composed into the case hook set (`hotcrm:src/service/objects/case.hook.ts`):

| Factory | Trigger | What it does | Why it is shaped so |
|:--|:--|:--|:--|
| `hotcrm:src/service/objects/_case-assignment.ts#createCaseRoundRobinAssign` (`case_auto_assign`) | `beforeInsert`, priority 250, `runAs: 'system'` | if `owner_id` is empty: read holders of position `service_agent` (`sys_user_position`, pinned to the row's organization when it names one), count each holder's cases with `status $nin ['resolved','closed']`, stamp the least-loaded one into the payload; empty pool or any failure → leave ownerless, swallow | runs after the guest owner strip at priority 200 (`case_sla_defaults` sets `input.owner_id = null`); stamps in the payload because the gate never sees a hook's write (door ①); elevates because the anonymous caller reads nothing |
| `hotcrm:src/service/objects/_case-assignment.ts#createCaseEscalationReassign` (`case_escalation_reassign`) | `beforeUpdate`, 250, `runAs: 'system'` | on the status TRANSITION to `escalated` (not the state), hand the case to the least-loaded holder of `service_manager`; record the former owner in `escalated_from`; idempotent when the owner is already a manager; skipped on `dispatch.mode === 'per-row'` | an `afterUpdate` write through `ctx.api` would be a fresh operation the gate sees and would need `crm_case.allowTransfer`; the SLA sweep (`case_sla_monitor`) reaches this hook by performing the same transition |
| `hotcrm:src/service/objects/_case-assignment.ts#createCaseSelfClaim` (`case_self_claim`) | `beforeUpdate`, 260 | a PERSON (never a system or seed write) moving an unowned, not-closed case to `in_progress` / `waiting_customer` / `waiting_support` (`#CLAIMABLE_TARGET_STATUSES`) is stamped as its owner; an explicit `owner_id` in the payload wins | the gate refuses a caller-supplied `owner_id` upstream of the hook phase, so "an agent may set the owner to themselves" has no adjudicable spelling; the Claim button is a screen flow whose `update_record` writes only `status` (`hotcrm:src/service/flows/case-actions.flow.ts`, `hotcrm:src/service/actions/case.actions.ts#ClaimCaseAction`) and a test pins that it never carries `owner_id` (`hotcrm:test/claim-case-one-owner-writer.test.ts`) |

Around them: the pinned `unassigned_triage` tab filters `owner_id is_null` and `status not_in ['resolved','closed']`
(`hotcrm:src/service/views/case.view.ts`); the criteria rule `case_unassigned_triage_sharing` shares
`record.owner_id == null && record.status != "resolved" && record.status != "closed"` with position `service_agent` at
`edit`, self-limiting the moment a claim lands (`hotcrm:src/service/sharing/case.sharing.ts`);
`case_escalated_from_sharing` keeps the former owner on the case through a `field` recipient. The same shape for leads:
`lead_auto_assign` (`hotcrm:src/sales/objects/lead.hook.ts`, `beforeInsert` 250, `runAs: 'system'`) assigns an ownerless
lead to the holder of `sales_rep` with the fewest `is_converted: false` leads; `lead_assignment`
(`hotcrm:src/sales/flows/lead-assignment.flow.ts`) is the downstream record-change flow that alerts the owner the hook
chose — it assigns nothing itself, and its header records that an ownerless lead has *"nobody to alert: the business
declares no recipient for ownerless intake (no queue, no position …)"*. The behavioural pins:
`hotcrm:test/case-assignment.test.ts`, `hotcrm:test/ownership-model.test.ts`,
`hotcrm:test/unassigned-case-triage-reach.test.ts`, `hotcrm:test/flow-sla-ownerless-assignment.test.ts`. The product
documentation promises the gap to customers (`hotcrm:content/docs/administration/setup.mdx`: *"there is no territory
routing and no queue"*).

Two facts the shape below is built around. "Open" differs per object — cases count `status $nin ['resolved','closed']`,
leads count `is_converted: false` — so **load is a predicate the rule declares**, not a platform constant. And the empty
pool is HotCRM's first-install norm: position membership is runtime data, so the hook is a no-op until someone holds the
position, and the app made that state visible with a view rather than refusing intake.

### 3. Why now, and for whom

The maintainer ruled A: a queue is a platform need. The reference app is the corpus AI authors copy most, and today it
teaches "write a hook that counts rows to pick an owner, and spell a claim as a status change" — while its own rules say
never compensate. Two reserved enum members have waited on this since #3508, each with a comment naming the condition for
its return. ADR-0138 D1 already names *assignment rules* as one of the scenario's three instruments for owning a
guest-written row, so the word is in an accepted record with no mechanism behind it. This record supplies the shape;
the spec + server PR supplies the mechanism; HotCRM deletes two of its three factories, `lead_auto_assign`, the triage
rule, the claim-writer test and the covered cases of its other pins once a release carries it (D8).

---

## Decision

### D1 — The queue entity: a metadata type `queue` and a system object `sys_queue`, under regime C

A **queue** is a named, organization-scoped set of people that records of any `ownership: 'user'` object can sit in. It
has the two sources `sharing_rule` has (ADR-0131 D6, the 2026-10-19 regime-C note):

- **Declared.** A package declares queues in a new stack key `queues` (metadata type `queue`, singular; a registry entry
  modelled on `sharing_rule`'s — `allowRuntimeCreate: false`, `domain: 'security'`; `position`'s entry allows runtime
  creation and is not the model), read from the registry on every
  use and never materialised as rows (ADR-0131 D2). Managed, read-only, clonable; switched off by an `active` bit of
  `sys_metadata_activation` of type `queue` — regime C exactly as the sharing-rule note charts it. A declared queue's
  members may name **positions only**: a position is a catalog item a package can know by name; a user, team or
  business unit is an organization's own row (ADR-0086 D1's hybrid line, drawn where that record draws it; merge
  question 18).
- **Authored.** An organization authors its own in `sys_queue` (`managedBy: 'config'`, `organization_id` NOT NULL,
  ADR-0131 D1) with members in `sys_queue_member` rows (one row per member specification: `queue`, `recipient_type`,
  `recipient_id`, `organization_id`). Any of the five set-valued kinds is allowed (D2).
- **One namespace, by name.** A queue is referenced everywhere by its machine name (ADR-0131 D4): the `queue` column (D3),
  an assignment rule's target (D5), an approver's `value` (D6), a sharing recipient's `value` (D7). Resolution reads the
  registry first, then the organization's `sys_queue` rows; a `sys_queue` row taking a declared queue's name is refused,
  a declaration arriving over an authored row is reported loudly at load — the same-name discipline of the sharing-rule
  note. A name that resolves nowhere fails closed for that reference and is reported by name (ADR-0131 D4) — as a 422
  for a caller's write (D9), as an empty expansion for an approver or recipient (D6, D7), and as a row left ownerless
  for an assignment rule (D5): never a refused insert.

**Owner package.** `@objectstack/plugin-sharing` owns `sys_queue`, `sys_queue_member`, the cursor state object of D5
(`sys_assignment_cursor`) and one **queue service** behind a spec contract (`packages/spec/src/contracts/`, beside
`sharing-service.ts`): resolve a queue by name in an organization, expand its members, test one user's membership, list
the queues a user belongs to. ADR-0029 D1 places the sharing objects there, ADR-0057's comparison table lists
"Public Group/Queue" in the sharing row, and the expanders and both recompute modules live there already.
The access path (D3) is written where the owner match is built, in `SharingService`, so it crosses no plugin boundary;
`plugin-security`'s gate consumes the contract through the kernel for the claim admission (D4) and the explain reasons.
When no queue service is registered, no queue exists: every queue-dependent admission below fails closed (ADR-0056 D3's
posture: owner enforcement never depends on which plugins loaded), and a stack that declares `queues` or
`assignmentRules` in a composition that registers no queue service is **refused at boot by name** — by the engine, which
is always present, at `kernel:ready`, in the fail-fast shape of ADR-0093 D5, naming the key and the missing service — a
declared queue nothing resolves, or a rule nothing evaluates, is the silently inert instance ADR-0078 forbids (merge
question 17). Both keys
join the engine's stack-collection list (`METADATA_ARRAY_KEYS`, beside `sharingRules` and `positions`), and both types
join the `metadata_type` vocabulary of `sys_metadata_activation`
(`packages/platform-objects/src/system/sys-metadata-activation.object.ts`). Merge question 2 carries the shape and the
owner together.

### D2 — Membership: the existing recipient kinds, the existing expanders, one expander for every consumer

A member specification is `{ type, value }` with `type` drawn from the five set-valued members of
`ShareRecipientType` — `user`, `team`, `position`, `business_unit`, `unit_and_subordinates` — and `value` the id or
machine name that kind already takes in a sharing rule. `field` is excluded: it is record-relative and names no set of
people. ⛔ No new principal vocabulary: nothing measured requires one, and HotCRM's three pools are positions.

**Expansion** is the union of each member's expansion through the services Context §1 names, scoped to the queue's
organization, de-duplicated and **ordered** (user id ascending) so that every consumer — the access path (D3), the claim
admission (D4), the assignment pool (D5), the approver slate (D6), the sharing recipient (D7) — reads **one** function
of the queue service. The approvals engine's `queue` branch calls it rather than growing a third position expander. An
empty expansion is a fact, not a fault: the consumers below each say what they do with it.

**Membership moves, and three things follow it.** A write to `sys_queue_member`, and a write to any membership table a
queue's members read (`sys_user_position`, `sys_team_member`, `sys_business_unit_member`, the BU tree), changes who is in
the queue. The access path needs no recompute (it is resolved per request); the sharing grants that name a queue are
recomputed by the module that owns the moved source — `recipient-membership-recompute.ts` gains `sys_queue_member` as a
source and its rule selection looks through queues (a position write re-evaluates the rules whose recipient is a queue
naming that position); `bu-tree-recompute.ts` treats a `queue` recipient as BU-tree-reading exactly when the queue has a
`business_unit` or `unit_and_subordinates` member, and its header table gains that row. Approver slates are resolved at
node entry and need nothing.

### D3 — Where a queued record sits: `owner_id` empty, a system-managed `queue` column, one pre-resolved access set

**The column.** `applySystemFields` injects `queue` — a text column holding a queue machine name, `system: true`,
`readonly: false` like `owner_id`, not a lookup (a declared queue has no row to point at) — on exactly the objects it
injects `owner_id` on (`ownership: 'user'`), and withholds it under the other three tiers. An eligible object that
declares its own field named `queue` is **refused at registration** with a prescription (rename the business field, or
leave the `user` tier); `owner_id`'s "author's declaration wins" rule is not copied, because a skipped anchor would leave
every admission below silently inapplicable (merge question 15). It lands **with its writers** in the one PR: ⛔ not
provisioned ahead of them, which is the inert-column state ADR-0117's `owning_business_unit_id` is in today and ADR-0078
forbids.

**The meaning.** A record **sits in** queue Q when `queue == Q` and `owner_id` is empty. When an owner is set, `queue`
names the record's **home queue**: the target of a release (D4) and a reporting dimension, conferring no access. The
owner anchor is untouched: `owner_id` stays a `sys_user` lookup, empty while the record sits, so every reader in Context
§1 keeps its meaning — a sitting record is "owned by nobody" to scope depth, to "my records", to `owner_of:`, to the
seed claim, to ADR-0117's future stamp. Merge question 1 states what the two other placements would have cost.

**Who writes it.** `queue` is system-managed the way `owner_id` is, adjudicated in the same step:
- an assignment rule stamps it (D5), as the platform;
- a claim and a release leave it unchanged (D4);
- a **move** — a supplied `queue` that differs from the pre-image on update — is a transfer-class write (ADR-0117 D4's
  reading for the other anchor): denied without the transfer grant, and refused with `QUEUE_NOT_FOUND` when the named
  queue does not resolve in the row's organization;
- on insert, a supplied `queue` is admitted when the caller holds the transfer grant **or is a member of that queue**;
  otherwise refused in the same shape as a foreign owner. The INSERT arm's stamp is unchanged, so a member's insert
  naming a queue is an **owned record with a home queue** — today's outcome for an agent-logged case in HotCRM. Parking a
  new record in one write (`owner_id` empty, `queue` set) needs the grant; a member parks in two, insert then release
  (D4). Merge question 13 carries the alternative, a stamp that stands down for a member's queue;
- a guest never supplies it, through both halves ADR-0138 D1 names: the step-3.5 guest branch refuses it at the endpoint
  doors, and the public-form door strips it with the other server-managed anchors —
  `packages/spec/src/security/public-form.ts#PUBLIC_FORM_SERVER_MANAGED_FIELDS` gains `queue`, the list that already
  pre-registers `owning_business_unit_id` for the same reason;
- `owner_id` and `queue` may be supplied together only under the transfer grant.

**Who sees it.** The members of Q read and edit the records sitting in Q through one more pre-resolved membership set,
`current_user.queues` — the queue names the caller belongs to in the active organization, computed by the queue service
from the caller's positions, teams and units against the queues' member specifications; the queue service is the
registered `IRlsMembershipResolver` for that one key, so an authored policy or view can read it too. The disjunct
`owner_id IS NULL AND queue IN (current_user.queues)` lands at four sites: beside the `ownerMatch` of `buildReadFilter`;
in `buildWriteFilter`'s update arm beside the share ids, never its delete arm; in `checkEdit` as a positive basis of its
own, tested before the public-OWD `abstain` and apart from `matchesOwnerScope`, the fast path `checkDelete` shares; and
in the explain engine. A sitting record then answers `allow`, which lifts the `created_by` floor through
`resolvePreImageFloorDrop` with no change there — the guest-written case a member edits passes this way, and on an open
OWD too, where that floor would otherwise refuse every non-creator. This is the form ADR-0057 D3 gives every rollup and
ADR-0058 D3 names for *"ownership that depends on live role membership"* — not a stored static filter, not a
materialised share per record per member. It widens **rows, never verbs** (ADR-0111 D3): a member with no `allowEdit`
on the object still cannot edit a sitting record, and delete is never conferred — which is why the disjunct stays out of
the two delete paths. HotCRM's self-limiting rule — shared while unowned, gone the instant a claim lands — is this path's
semantics, built in. Merge question 3 carries the alternatives.

**The explain engine** reports the new disjunct as its own reason (`queue-membership`) on `read`, `update` and `transfer`,
so a Console can answer "why can I see this".

### D4 — Claim, release and move go through the transfer gate

**Claim** is an update of `owner_id` to the caller's own id, by id, on an unowned record the sharing service positively
admits. The UPDATE arm of step 3.5 gains one admitted case ahead of the grant check: the pre-image's `owner_id` is empty,
the supplied `owner_id` is the caller's id as a scalar, the operation addresses one record by id (a bulk change-set
carrying `owner_id` keeps failing closed), and the sharing verdict for this row is `allow` — a queue member through D3's
basis, an `edit` share, or `modifyAllRecords`. The gate reads the verdict step 2.7 obtained where it asked one, stashed
on the operation context beside the depth; where 2.7 did not ask — a delegated write, or no floor policy in the caller's
collection — the gate asks `resolveSharingWriteVerdict` itself, one read on those paths only. A by-id update is reached
two more ways, and
neither licenses a claim: passage through the `created_by` floor where sharing abstains (so a disown stays reversible
only under the grant), and an app-authored update widener, which retracts the sharing middleware's refusal without
authorising the write. No membership is re-tested, a record with no `queue` is claimable by whoever holds a positive
basis, and HotCRM's claimant set (*"a write carrying a real user id claims for that user, whoever they are"*: the agent,
the manager on the escalation share, the admin) is kept. Under delegation both principals pass the same gate, and the
delegated by-id write keeps the `created_by` floor whatever the verdict, so a delegated claim of a guest-written record
is refused. Merge question 14 carries the alternatives. Explain gains the reason `queue-claim`.

**One owner.** The write is conditional on the pre-image — "where `owner_id` is still empty" — so two callers claiming
at once produce exactly one owner. The engine has no such primitive on its by-id update today (the by-id branch reads the
prior record and calls `driver.update(object, id, data)`); the PR adds a **by-id write precondition**, an engine-internal
equality predicate (`expect: { <field>: <value> }`, reachable from no data door — merge question 16) with two users: the
claim (`{ owner_id: null }`, set by
the gate on the operation context as it sets the depth today) and D5's cursor (`{ version }`). The engine lowers the
write to the driver's conditional `updateMany(object, { where: { id, ...expect } }, data)` where the driver has it; one
affected row is re-read by id and the by-id branch continues unchanged — hooks, formulas, the per-record event, the
roll-up, the response — at the cost of one read; zero rows answer **409 `CONCURRENT_UPDATE`** — the data path's existing
code for "another writer got there first", with "the record was taken" as its message — the distinction the engine
already draws between a by-id miss and a predicate update that matched nothing. The existing `expectedVersion` check is
untouched by the PR (merge question 16). Where the
driver has no `updateMany`, the precondition degrades to the pre-image check and the write goes through unconditionally,
logged once per process at `warn`; every shipped driver has it (Context §1).

**Release** is an update of `owner_id` to null by the current owner on a record whose `queue` is set: admitted when the
pre-image's `owner_id` is the caller and `queue` is unchanged — whether or not the owner is still a member of that queue,
because ownership is not membership and the released record then becomes visible to the queue's current members. The
record sits in its home queue again. Releasing a record that has no home queue stays what it is today, a disown that
needs the grant.

**Move** is a write to `queue` (D3): transfer-class, `allowTransfer` or `modifyAllRecords`. A dispatcher moves a sitting
record between queues or parks an owned record in one by setting `owner_id` to null and `queue` to the target in one
write under the grant.

Everything else at the step is unchanged: a foreign owner on insert or update needs the grant, the echo is tolerated,
the guest is refused, the referential-integrity clear is exempt. The refusals stay `PERMISSION_DENIED` (403) through
`packages/plugins/plugin-security/src/errors.ts#PermissionDeniedError`; their messages name the condition that failed
("claim only an unowned record the sharing model admits you to"; "release only your own record, back to its queue"; "moving a
record between queues requires the transfer grant") and, per AGENTS.md's runtime-string rule, no tracker number.

⛔ No hook spells ownership. A claim is an ordinary update of `owner_id` the gate adjudicates; the Console's Claim
affordance sends `{ owner_id: <self> }`. Whether it should also be a dedicated verb is merge question 6.

### D5 — Assignment rules: declared, criteria → queue or user, two named strategies, evaluated once on insert

**Shape.** A new metadata type `assignment_rule` (stack key `assignmentRules`; regime C as a behavioural type — disable
by the activation bit, clone under a new name), declared per object:

```
assignment_rule
  name, label, object, active
  entries[]            ordered; the first whose criteria match wins
    name
    criteria?          CEL over `record.*`, interpreted against the row in flight; absent = always
    assignTo           { type: 'queue', value: QUEUE_NAME } | { type: 'user', value: USER_ID }
    strategy?          'round_robin' | 'least_loaded'   — only with a queue target; absent = park in the queue
    load?              CEL pushdown predicate over the object — REQUIRED with 'least_loaded', refused otherwise
```

`criteria` is the record-interpretation backend of ADR-0058 (the row is not stored yet); `load` is the pushdown backend,
lowered by the one canonical compiler, and a `load` the compiler cannot lower is an authoring-time compile error
(ADR-0058 D2) — never a rule that silently counts everything. A declared rule whose `assignTo` names a `user` id names
organization data in package metadata; `os lint` reports it at `warning` (ADR-0086 D1), and it is refused outright when
the id does not resolve at load.

**When, and on which rows.** The engine evaluates the object's active rules **once per inserted row, after every
`beforeInsert` hook has run and before the write** — the seam at which `resolveSystemInsertOrganization` already sits —
and only for a row whose `owner_id` and `queue` are both empty at that moment. A writer-supplied owner was adjudicated by
the gate; a middleware-stamped owner is the acting user's own record; a hook that set or cleared an owner spoke for the
scenario first — ADR-0138 D1 item 3's order (hooks, then assignment rules) is kept literally, and HotCRM's guest strip
at priority 200 keeps preceding assignment without change. An update never evaluates a rule (merge question 5). A writer
cannot opt an owned insert into assignment in this record (merge question 4).

**As which identity.** The evaluation is a platform step, not app automation: its reads — the queue's members, each
candidate's load count, the cursor — run under an explicit system context constructed at the seam (ADR-0118 D3), pinned
to the row's organization: the context's `tenantId`, the row's own column, or the one `resolveSystemInsertOrganization`
derives when neither names it (ADR-0131 D9). The system principal is the
**actor** of nothing visible: the row's audit columns record the writer, and the owner the rule chose is ownership, not
attribution (ADR-0073 D3). A row with no organization — the lean-embedding exception of ADR-0131 D9 — evaluates no rule
and is logged once. ⛔ No `runAs` on an assignment rule; `runAs` is a hook's and a flow's declaration (ADR-0073 D2), and
this is neither.

**The strategies.** Over the queue's ordered member expansion in the row's organization:
- `least_loaded` — for each member, count the object's rows in the organization with `owner_id` = member matching `load`;
  the smallest count wins; a tie goes to the earlier member in the ordering. Within one batch the counts are adjusted
  locally as rows are assigned; across concurrent inserts the count is approximate, as HotCRM's is today. HotCRM's intake
  arithmetic, as a declaration.
- `round_robin` — the member after the cursor. The cursor is one row of `sys_assignment_cursor` per (rule, entry,
  organization), holding the last member id and a version; it advances through D4's precondition (`expect: { version }`
  as read), and a lost race re-reads and retries. A member set that changed since the last
  assignment is handled by position: the next member after the last id in the current ordering. Where the driver has no
  `updateMany`, the precondition degrades as D4 says: the cursor advances unconditionally, two concurrent inserts may
  pick the same member, and the platform logs once at `warn` — approximate fairness, visible, never a refused insert
  and never a count the rule did not declare. Merge question 7 carries the alternatives.
- no strategy — the row **parks**: `queue` = Q, `owner_id` empty.

**The empty pool, the missing queue, and every other failure.** A queue whose expansion is empty parks the row — it sits
in Q, visibly, for whoever administers the queue, and the engine logs once per rule per process at `warn`, naming the
queue and the remedy (staff it). A declared rule's declared-queue target is validated at load, as a `user` id is; a
target that resolves nowhere in the row's organization at insert (an authored queue that exists in one organization of
several) leaves the row ownerless with `queue` unset and logs once at `warn` naming the queue and the organization — not
`QUEUE_NOT_FOUND`, which is a caller's refusal (D9). A read that fails during evaluation leaves the row as it was before
evaluation (ownerless, `queue` set when the entry had already chosen one) and logs at `warn`. Intake is never refused by
assignment: that is HotCRM's contract,
AGENTS.md's level for a functional degradation, and the opposite of a silent no-op because the parked row is the
visible state. A rule's authoring-time counterpart is the `approval-approvers-may-resolve-empty` shape: `os lint`
reports a rule whose queue is declared with no position member at all, and cannot report runtime membership.

**What the rule writes.** `owner_id` (when a member was chosen) and `queue` (always, for a queue target). Nothing else:
no "assigned by" column, no stamp of the rule's name (open item 3).

### D6 — Re-admission of the `queue` approver type

The type becomes authorable in the PR that makes **all** of the following true, and not before (ADR-0049's enforce-or-
remove gate; Prime Directive #10):

1. D1 and D2 are landed: a queue resolves by name in the request's organization (or the targeted one under
   ADR-0105 D9), and the queue service expands it.
2. `resolveApproverSpec` gains the queue branch: the slate is the queue's expansion; an empty expansion warns as the
   graph types do ("expanded to nobody") and then returns `[]` as the person types do — a new combination, because the
   graph path writes the `type:value` literal after its warning and this branch must not. The `queue:<id>` literal slot
   is never written again; a slot a stored request already holds stays as stored, decidable by the override, exactly as
   ADR-0090 D3's `role:` slots are. The node's `onEmptyApprovers` decides the empty slate.
3. The spec drops `queue` from `NON_AUTHORABLE_APPROVER_TYPES` and so from `xEnumDeprecated`; `APPROVER_VALUE_BINDINGS.queue`
   becomes a real binding — a kind the designer contract does not have today, "a catalog item **or** an organization row,
   one name" (open item 1); `APPROVER_ORG_SCOPED.queue` becomes `true` (a queue is an organization's); the deprecation
   comment and the `@deprecated` tag go; the xRef `map` keeps `queue`.
4. `packages/lint/src/validate-approval-approvers.ts` adds `queue` to its group-routed set (a queue is a group whose
   membership is runtime data and can be empty, so a queue-only node is reported as `approval-approvers-may-resolve-empty`
   like a position-only one); its `approval-approver-type-unsupported` arm stops firing for `queue` by construction once
   the binding is no longer `unsupported`, and the hint that waited on this is deleted.
5. A test drives a stored `queue` approver through the real service to a slate of the queue's members, and the
   cross-organization integration suite gains the queue case.

What it resolves to at runtime: the queue's members at node entry, in the request's organization. Re-admission is not an
ADR-0087 conversion: the enum member never left, no stored shape changes, and the designer annotation is not a protocol
surface. The generated reference page re-renders from the enum's description.

### D7 — Re-admission of the `queue` sharing recipient

The recipient becomes authorable in the same PR when **all** of the following hold:

1. `expandRecipient` returns the queue's expansion for `recipient_type: 'queue'` — never `[]` for a queue with members;
   an empty queue grants nothing and warns once, as an empty unit does
   (`packages/plugins/plugin-sharing/src/sharing-rule-service.ts#warnOnEmptyUnitExpansion`'s shape). The declared-rule
   translator maps `sharedWith.type: 'queue'` through
   (`packages/plugins/plugin-sharing/src/declared-sharing-rules.ts#translateDeclaredSharingRule`).
2. `ShareRecipientType` gains `queue`, in that enum's order, with the doc line the other members have; the authorable enum
   and the runtime union `SharingRuleRecipientType` are then the same seven members, and
   `packages/spec/src/contracts/sharing-service.test.ts` — which today pins "the authoring enum plus the reserved
   `queue`" with an `@ts-expect-error` on `queue` — flips to equality.
3. The recompute modules cover it as D2 states: `sys_queue_member` becomes a membership source, position and team writes
   look through queues, and the BU-tree module treats a queue with a BU-kind member as BU-tree-reading. A queue recipient
   whose grants are not recomputed when its membership moves is the unbounded revocation gap the BU module's header
   describes, and is not admitted.
4. The lint red-line table re-decides `queue` where its own comment says to: a declared queue's members are positions
   (D1), a flat kind the table already admits on a platform-global object (`tenancy.enabled: false`), so the `queue`
   recipient is admitted there at lint time; an organization-authored queue is not readable at lint time, and one whose
   members include a BU kind is refused on a global object at runtime by the same predicate, read through the queue.
5. The other readers move with the enum: `SysSharingRule.recipient_type`'s select options (whose comment says `queue`
   "was removed"; `packages/plugins/plugin-sharing/src/field-recipient.test.ts` holds them a superset of the enum), the
   `SharingLevel` comment in `sharing.zod.ts` that cites the drop, `access-level.ts`'s stale sentence, the dogfood
   `sharing-rules` row's summary (its note demands the re-transcription) and the authorable-surface snapshot; the
   migration-17 entry keeps its text as the record of protocol 17's state.

What it resolves to at runtime: grants materialised per member, rule-wide, as `team` and `position` are today — and
re-materialised when the queue's membership moves. ⛔ The recipient does not confer queue-sitting access; that is D3's
path. A rule naming a queue shares *its criteria's records* with *the queue's people*, which is a different sentence.

### D8 — The first consumer: what the platform replaces, what HotCRM deletes, what is not covered

| HotCRM today (`8f52859`) | Under this record | HotCRM's act after a published release |
|:--|:--|:--|
| `case_auto_assign` — least-loaded over position `service_agent`, open = `status $nin ['resolved','closed']` | a declared queue (members: position `service_agent`) and an `assignment_rule` on `crm_case`, one entry, no criteria, `least_loaded`, `load: record.status != "resolved" && record.status != "closed"` | delete the factory and its hook registration |
| `lead_auto_assign` — least-loaded over `sales_rep`, open = `is_converted: false` | a queue (position `sales_rep`) and a rule on `crm_lead`, `least_loaded`, `load: record.is_converted == false` | delete the hook; `lead_assignment` is unchanged (it reads the owner the platform chose) |
| `case_self_claim` + the `claim_case` screen flow writing `status` | the gate's claim admission (D4), with the same claimant set — anyone the sharing model positively admits to the unowned case: the agent through the queue, the manager through the escalation share, the admin through Modify All; reopening a resolved unowned case by claiming it keeps working, since the admission reads no status; the Claim affordance writes `{ owner_id: <self> }` (with or without a status) | delete the factory; re-point the flow or the action; delete `claim-case-one-owner-writer.test.ts`, whose premise inverts |
| `case_unassigned_triage_sharing` | D3's access path (members see what sits in their queue; it stops at the claim). One difference: the rule's criteria hid `resolved` and `closed` unowned cases; the access path shows every sitting record and the view filters | delete the rule; keep the view's status filter |
| the existing ownerless backlog (`owner_id` NULL, no `queue`) | not reached by D3's path until `queue` is set; claimable by whoever holds a positive basis (D4) | one system write under the transfer grant — `queue` = the intake queue where `owner_id IS NULL` — on `crm_case` and `crm_lead`, in the card that adopts the release |
| `unassigned_triage` view | still valid (`owner_id is_null`); better as `queue equals <intake queue>` plus `owner_id is_null` | re-point the filter |
| the guest owner strip in `case_sla_defaults` | the platform already refuses a guest-supplied owner (ADR-0138 D1); the strip is redundant, not wrong | HotCRM's call |
| `case_escalation_reassign` — re-route on the transition to `escalated`, `escalated_from` stamp, the SLA sweep's dependency | **not covered**: this record evaluates rules on insert only | keep, until merge question 5 is decided the other way or a later record takes update-time routing |
| the lead flow's "nobody to alert for ownerless intake" | **not covered**: a queue is not a messaging audience here (merge question 8) | unchanged |

The HotCRM card that deletes the STOPGAP is filed beside #25769 and unblocks when a published release carries the PR, not
at merge (the card's own words; HotCRM `AGENTS.md` rule 2: *merged is not available in the pin*).

### D9 — Names, codes, and what is deliberately not changed

- **Names.** Metadata types `queue` and `assignment_rule` (singular); stack keys `queues`, `assignmentRules`; objects
  `sys_queue`, `sys_queue_member`, `sys_assignment_cursor`; the column `queue`; the pre-resolved set `current_user.queues`;
  strategy values `round_robin`, `least_loaded`. The job-queue service capability named `queue` and its table
  `sys_job_queue` are a different noun — a work queue of jobs, not of people — and nothing here touches them; the two
  words co-exist as `sys_team` and `team` do.
- **Codes** (ADR-0112 D1, D3 — registered in the ledger by the PR): `PERMISSION_DENIED` 403 for a refused claim, release,
  move or supplied queue; `CONCURRENT_UPDATE` 409 for a lost claim race — the ledger's existing code for a write another
  writer beat, so the verb carries one 409, not two (ADR-0112 D1); one new code, `QUEUE_NOT_FOUND` 422, only for a
  caller-supplied `queue` that resolves nowhere in the row's organization. A rule's unresolved target is never a refusal
  (D5). D3's registration refusal is thrown at `registerObject`, a door Studio and the metadata API reach at request
  time, so it carries the ADR-0112 envelope the registry's other field refusals carry — `INVALID_METADATA`, 422, as
  `ObjectFieldTypeRefusedError` does; D1's boot refusal is reached by no request and stays a startup report.
- **Unchanged.** The owner anchor's type and every reader of it; the gate's existing arms; the insert pipeline's order
  (one step is added, none moved); `ownership` tiers; teams never carry capability (ADR-0090 D8 — a queue is a sharing
  and distribution set, bindable to no permission set); the approval node's other types; the `field` recipient; the
  `owner_of:` audience; ADR-0138 D1 in full.

---

## Consequences

**Positive**
- Intake routing becomes a declaration an AI author can read and `os lint` can check, replacing two row-counting hooks
  per object in the reference app and the pattern they teach.
- A claim is adjudicated once, in the gate, under the record's real state — no status gesture, no second writer of
  ownership, and the race is settled by the write.
- The two reserved enum members stop being the oldest declared-but-unenforced items in the security spec, each returning
  behind a test, and the comments that waited on this are deleted rather than extended.
- One expander serves five consumers; membership changes reach sharing grants through the recompute modules that already
  own that problem.

**Negative / costs, stated plainly**
- Two new metadata types, three new system objects, one new injected column, one new pre-resolved set, one new seam in
  the insert pipeline, one by-id write precondition in the engine, one new binding kind in the designer contract: a
  cross-package PR of size L, as the card estimated.
- Every `ownership: 'user'` object gains a column it may never use (the same cost `owning_business_unit_id` already pays).
- `current_user.queues` is one more per-request resolution; a tenant with many queues of BU-kind members pays a BU-tree
  read per request unless cached with the other sets.
- The claim's one-owner guarantee and round-robin's fairness are exact only where a driver implements `updateMany` (every
  shipped driver does); elsewhere both degrade to the pre-image check with one log line.
- A queue member can take an unowned record anyone shared with them at `edit`; that is the sharing author's declared
  breadth, and HotCRM's contract today (merge question 14).
- HotCRM keeps one of its three factories (the escalation hand-off) until update-time routing is decided.

---

## Alternatives considered

1. **It is legitimate app logic (the assessment's B).** Not chosen: the maintainer ruled A, and the app that would keep
   it says in its own rules that it may not.
2. **The owner column points at the queue (Salesforce).** A record "owned by a queue" needs `owner_id` to hold a non-user
   principal — a polymorphic owner. Every reader in Context §1 assumes a `sys_user` lookup: the OWD and scope-depth
   filters, "my records", `owner_of:`, the seed claim, ADR-0117's stamp. Each would learn to skip or resolve a queue
   owner, and the FK to `sys_user` would go. The whole cost lands on the oldest readers; D3's stamp costs one column and
   one disjunct.
3. **A queue-item join object (Dataverse).** A second row per queued record, a join on every "what sits in my queue"
   read, and a lifecycle to keep in step with the record's own deletes and moves. It keeps the record's columns untouched,
   which is its only advantage over D3, and D3's column is injected by the same mechanism the other anchors use.
4. **Members see queued records through a platform-generated sharing rule per queue.** Reuses the materialiser; costs a
   `sys_record_share` row per sitting record per member, re-materialised on every membership write, and a rule the
   organization did not author in its own table. ADR-0058 D3 names the pre-resolved set for exactly this class.
5. **A platform "assignment hook" helper instead of a metadata type.** Would bless the hook shape; keeps ownership a body
   of code no lint can read (ADR-0077 §3's friction tier) and leaves the empty-pool and identity rules to each author.
6. **A dedicated `claim` verb now.** No engine operation exists for `transfer` either; the update spelling needs no new
   dispatch vocabulary and is what the gate already adjudicates. Merge question 6 keeps the door open.
7. **Member kinds limited to the three flat kinds (`user`, `team`, `position`).** Simpler recompute; refuses the
   departmental queue ("the Shanghai support desk") that ADR-0057's BU tree exists to express. Merge question 9.

---

## Open items (not blocking acceptance; each becomes a reading on the PR)

1. **The two-source binding kind** for a queue in the designer contract (`ApproverValueBinding` has `record` and
   `registry`; a regime-C type needs "both, by name") — the PR adds it and the Console's picker lists both sources.
2. **The cost of `current_user.queues`** on a tenant with many authored queues — measured on the dogfood stack before the
   set is cached or indexed.
3. **Provenance of an assignment** — whether a Console needs "which rule placed this record" (an audit event, never a
   column on the business row), decided with the first Console card.
4. **A `field` target for assignment** (`assignTo: { type: 'field', value: 'account_owner_id' }` — route to the account's
   owner), the analogue of the `field` recipient; not in the card, noted as the next pull.
5. **The dogfood matrix** gains rows for the claim admission, the access path and the two re-admitted members, each on an
   `enforced` row naming its site.

## Open questions for the maintainer's merge decision

These are the points this record decided where the ruling and the triage grade were silent. Merging accepts them; an
objection names the number.

1. **Where a queued record sits — a system-managed `queue` column with `owner_id` empty (ServiceNow's shape), not an owner
   pointing at a queue (Salesforce) and not a queue-item join object (Dataverse).** The recommendation costs one injected
   text column on `ownership: 'user'` objects and one disjunct in the access filter; it keeps `owner_id` a `sys_user`
   lookup so none of its readers change. The Salesforce shape costs a polymorphic owner and a change in every reader
   (Alternatives 2); the join object costs a second row and a join per read (Alternatives 3). A later move from the
   column to a join object would be a migration of one column; the reverse would be a table drop.
2. **Queue as metadata and data under regime C, owned by `plugin-sharing`.** Metadata only cannot serve the organization
   that staffs its own desk in Setup; data only cannot ship HotCRM's intake queue with the package. Regime C is the shape
   the maintainer already ruled for `sharing_rule`, and the one new piece is the by-name resolution across both sources
   that positions already have. The owner could instead be `plugin-security` (it holds the gate and `sys_user_position`);
   the expanders, both recompute modules and the owner match the access path extends are all in `plugin-sharing`, so that
   placement adds no dependency. Cheap to flip before the PR.
3. **Members see sitting records through a pre-resolved set (`current_user.queues`), not through materialised shares.**
   The set is the ADR-0057 D3 / ADR-0058 D3 form for live-membership access, needs no recompute and ends at the claim by
   construction. Materialised shares reuse `sys_record_share` and its listing surfaces at the cost of a row per record per
   member and a recompute on every membership write (Alternatives 4). An explicit sharing rule naming the `queue`
   recipient stays available for the different sentence D7 describes.
4. **Assignment applies only to a row that is ownerless after hooks — no writer opt-in on an owned insert.** Salesforce's
   "assign using active assignment rules" option is a DML header this record does not add: it would need a request option
   through every data door and a decision about an agent's own records. The reversible direction; adding the option later
   needs no undo. Cost: an integration that wants its named owner overridden by the rule must leave the owner empty.
5. **Update-time re-routing is out of scope — HotCRM keeps `case_escalation_reassign`.** The card says *on insert*;
   HotCRM's escalation hand-off routes on a status transition and the SLA sweep depends on it. Taking it in would make
   `assignment_rule` an update-time trigger with a transition predicate, a re-entrancy rule and a per-row dispatch rule —
   the size of a second record. The maintainer may take it now; the shape would be an entry-level `on: ['insert','update']`
   with a `when` transition predicate, evaluated under the same seam's `beforeUpdate` twin.
6. **Claim is an update of `owner_id` the gate admits, not a dedicated operation.** No new dispatch vocabulary, no new
   REST route, explainable as `transfer` today; the Console's affordance is one field. A dedicated verb
   (`POST /data/:object/:id/claim`) would be discoverable and could carry a status in one gesture; it needs the M2
   `transfer` operation the permission bit's own comment still calls future. Either spelling needs D4's by-id precondition
   for one owner. Adding the verb later changes nothing here.
7. **Round-robin's cursor is a state row advanced by the by-id precondition, degrading to an unconditional advance
   (approximate fairness, one `warn`) where the driver has no `updateMany`.** Deriving the cursor from the newest
   assigned record needs no state but admits the same duplicate pick everywhere and a scan per insert; parking the row
   instead would turn a missing driver method into unassigned work; refusing `round_robin` at authoring for such a
   composition would make a declared rule's validity depend on the deployment. The recommendation keeps the declaration
   portable and the degradation loud.
8. **A queue is not a messaging audience in this record.** `notify`'s audience grammar (`user:` / `role:` / `team:` /
   `owner_of:`) gains no `queue:` spec; HotCRM's "nobody to alert for ownerless intake" stays open. Adding `queue:` is one
   branch in `RecipientResolver` reading the same expander and could ride the PR; it was left out because the card does
   not name it and the audience grammar is a different surface's contract.
9. **All five set-valued recipient kinds are admitted as queue members, with the BU-tree recompute extended to queues.**
   Three flat kinds would cost less recompute (Alternatives 7) and refuse the departmental queue. A declared queue is
   positions-only either way.
10. **The assignment seam sits in the engine after the `beforeInsert` hooks and before the write, as a kernel contract
    the engine calls when registered.** The alternative is a platform-bound hook at a reserved priority: no engine change,
    but ordering would rest on a numeric convention an app hook can outrank, and the spec reserves no priority band. The
    seam gives "after every hook, before the write" by construction and sits where the organization is derived.
11. **Assignment rules are declared only; organization-authored rules are deferred.** HotCRM's pull is a package
    declaration; Setup-authored routing is a second door with a criteria builder and the regime-C same-name discipline.
    Deferred by name, with the authored `sys_queue` already in place as the data half a later `sys_assignment_rule` would
    target.
12. **`load` is required with `least_loaded`, with no platform default.** "Open" differs per object in the first
    consumer; a default such as "every row" would count closed work and be exactly the silent inert instance ADR-0078
    forbids. Cost: one more line per rule.
13. **A member's insert that names a queue is an owned record with a home queue; the INSERT stamp does not stand down.**
    The alternative — suppress the stamp when a member supplies `queue` and no owner, so the record sits at once — gives
    the Console a one-write "log straight into intake" at the price of a second way to produce an ownerless row without
    the grant and a stamp rule that no longer holds for every insert. The recommendation keeps the stamp rule every
    reader of Context §1
    relies on and today's HotCRM outcome; the cost is two writes (insert, release) for a member who wants the record to
    sit, one for a grant holder.
14. **Who may claim: anyone the sharing service positively admits to the unowned pre-image — queue basis, `edit` share
    or Modify All — not queue members only, and not mere passage through step 2.7.** This is the first consumer's pinned
    contract ("whoever they are": the agent through the queue, the manager through the escalation share, the admin), it
    covers the existing backlog once `queue` is backfilled, and it adds a read only where step 2.7 asked no verdict. The
    narrower reading — the caller must be a member of the queue the pre-image names — refuses the escalation desk and
    every legacy row without a grant. The wider reading — any caller 2.7 passes — would let the creator re-own a
    disowned record on an object where sharing abstains, with no grant, and let an app-authored update widener license
    claims by declaration. Cost of the recommendation: an `edit` share on an ownerless record is also a licence to own
    it, and an app-authored widener alone is not.
15. **An eligible object that declares its own `queue` field is refused at registration, with a prescription.** `queue`
    is a plain business word; a `user`-owned object with its own `queue` picklist is ordinary modelling, and today
    `applySystemFields` lets a declared `owner_id` win over injection. Copying that rule would leave the anchor silently
    absent and every admission inapplicable (ADR-0078); a suffixed name (`owner_queue`) avoids the collision at the price
    of a less legible column whose name differs from the type's. The recommendation is loud and names the fix; its cost
    is an upgrade-time refusal for an app that already has the field.
16. **The by-id write precondition (`expect`) is engine-internal — set by the gate for a claim and by the assignment seam
    for the cursor, reachable from no data door — and the data API's existing optimistic concurrency stays where it is.**
    `PATCH` and `DELETE` already take `If-Match` / `expectedVersion` and answer 409 `CONCURRENT_UPDATE`, compared in
    `updateData` before `engine.update` (Context §1): compare-then-write. The alternative lowers that check onto the same
    precondition (`expect: { updated_at: <token> }`), making today's optimistic concurrency atomic for every client
    already sending the token; its cost is moving the comparison into the write while preserving what the protocol
    layer settles around it — the probe-first ordering (404 before 409), the token normalisation, and the conflict's
    re-read of the row under the caller's context for `currentVersion` / `currentRecord` — on a queue card. The
    recommendation leaves the data path's shape alone; its cost is that the existing check stays non-atomic. Lowering
    it later is additive.
17. **A stack that declares `queues` or `assignmentRules` with no queue service registered is refused at boot, not
    warned about.** AGENTS.md says *"An `if (!service)` composition branch is usually functional and belongs at
    `warn`"*, and a loud warning would keep a lean composition booting; but this degraded state is not cosmetic — every insert the rules cover parks nowhere and every claim fails
    closed, with the declaring package none the wiser — and ADR-0093 D5 is the precedent for failing fast on a degraded
    middle state. Cost of the recommendation: a composition that ships such a package and deliberately omits
    `plugin-sharing` cannot boot until it drops the keys or adds the plugin. Cost of the warning: ADR-0078's inert
    instance, alive for the process's lifetime behind one log line.
18. **A declared queue's members are positions only; users, teams and business units join a queue through authored
    `sys_queue_member` rows.** Drafter-derived, not ruled: ADR-0131 D3 makes positions environment-level catalog items
    and assignments organization rows, ADR-0131 D4 has packages name catalog items by machine name, and ADR-0086 D1
    calls a packaged sharing rule's recipient that names a real team the config half of a hybrid artifact. The
    alternative lets a declared queue name any of the five kinds with `os lint` at `warning` — the treatment D5 already
    gives a declared rule's `assignTo: user` — so a package could ship a desk staffed by a named team; its cost is
    organization ids inside sealed package metadata that resolve on no other install, and a config binding inside an
    artifact the organization cannot edit, only clone. Recommendation: positions only.

---

## Verification notes

- **The approvals-side site.** The queue fallthrough is in
  `packages/plugins/plugin-approvals/src/approval-service.ts#resolveApproverSpec`, not in `approver-address.ts`, which
  holds the slot-address readers (`packages/plugins/plugin-approvals/src/approver-address.ts#positionAddresses` and
  siblings) and carries no queue handling. The record cites the service.
- **"the `owner_id` system field (`registry.ts` `applySystemFields`)"** — the injection site holds; the column
  definition itself is `packages/spec/src/data/injected-system-column-provenance.ts#OWNER_FIELD_DEF`, re-exported through
  `@objectstack/metadata-core` and `@objectstack/objectql`. Both are cited.
- **"`lead_auto_assign` … (`lead-assignment.flow.ts`)"** — the flow assigns nothing; it is the record-change flow that
  alerts the owner the hook chose. The assigner is the hook. D8 maps them separately.
- **Two records carry the number 0019** (`0019-app-as-consumer-unit.md`, `0019-approval-as-flow-node.md`; a known
  collision in `scripts/check-adr-anchors.mjs`). This record's ADR-0019 is the approval record, linked by filename.
- **ADR numbering.** `0136` and `0140` were taken by proposals that never landed and are not reused; `0141` is the newest
  landed record, and a read-only listing of the open pull requests at drafting time found none claiming `0142`. This
  record is `0142`.
- **"The platform stamps the organization after the `beforeInsert` hooks"** (HotCRM's reading of ADR-0131) holds for a
  system write that named none: `packages/objectql/src/engine.ts#resolveSystemInsertOrganization` is called after the
  hook phase and before the driver write. It is why D5's seam is placed there.
- **ADR-0138 D1** is consistent with every decision above: the platform declares no default owner; the assignment rule is
  the scenario's declaration; a guest's row stays ownerless when no rule and no hook sets an owner; a parked row is the
  visible form of that state.

---

## Execution plan (after acceptance)

1. **One PR, spec + server (L; `packages/spec`, `objectql`, `plugin-security`, `plugin-sharing`, `plugin-approvals`,
   `lint`, `qa/dogfood`), on this card** — ruling D5: a spec key lands with its first reader. Spec: the `queue` and
   `assignment_rule` types, their registry entries and their `BUILTIN_METADATA_TYPE_SCHEMAS` bindings
   (`packages/spec/src/kernel/metadata-type-schemas.ts`), the `queues` / `assignmentRules` stack keys, the queue-service
   contract, `ShareRecipientType` + `queue`, the approver-type changes of D6, `queue` in
   `PUBLIC_FORM_SERVER_MANAGED_FIELDS`, the ledger entry for `QUEUE_NOT_FOUND`; two hand-authored liveness ledgers,
   `packages/spec/liveness/queue.json` and `packages/spec/liveness/assignment_rule.json`, every property classified with
   evidence (the liveness gate has no generator); regenerated artifacts per AGENTS.md's spec table for the rest. Server:
   `sys_queue`, `sys_queue_member`, `sys_assignment_cursor`, the queue service and its `queues` membership-resolver key
   in `plugin-sharing`, with the access path at D3's four sites; the `queue` column in `applySystemFields` with its
   writers and the registration refusal for a declared `queue`; the gate's claim / release / move admissions and explain
   reasons in `plugin-security`; in `objectql`, the by-id write precondition with its readback, the assignment seam and
   the two strategies behind the contract, the two keys in `METADATA_ARRAY_KEYS`, the `kernel:ready` boot refusal and
   the two activation types; the `expandRecipient` branch and both recompute extensions; the approvals branch and the
   approver lint's group-routed set; the lint red-line row; the dogfood rows; tests for every admission and every
   refusal — the form-door strip of `queue`, the registration refusal, the boot refusal, the 409 on a lost claim and the
   readback on a won one, the empty pool, the unresolved target, the cursor under concurrency, the approver lint's queue
   case, and both re-admitted members end to end. Changeset: `minor` on every package named, with the two enum additions
   called out.
2. **HotCRM card (its own lane; blocked on a published release)**: D8's table — delete `_case-assignment.ts`'s two
   covered factories, `lead_auto_assign`, the triage sharing rule and the inverted test; declare two queues and two
   rules; backfill `queue` on the ownerless backlog; re-point the Claim affordance and the triage view; keep the
   escalation hand-off pending merge question 5.
3. **Console (objectui, its own lane)**: a queue picker for the approver and recipient types reading both sources; a
   Claim affordance sending `{ owner_id: <self> }`; a "sitting in queue" filter.
4. **Docs**: the authoring guide states how to declare a queue and an assignment rule, the `load` requirement, what a
   parked record is and who sees it, how a claim is spelled, and that a queue is not a messaging audience.

## References

- [#25769](https://github.com/objectstack-ai/objectstack/issues/25769) — the card; triage grade `6396200200`; the D6
  ruling of 2026-10-25T09:23Z quoted above; #25795 (ruling D5 landed in the pm-dispatch skill)
- ADR-0019 (approval as flow node), ADR-0029, ADR-0049, ADR-0056, ADR-0057 (ERP authorization core), ADR-0058,
  ADR-0073, ADR-0077, ADR-0078, ADR-0086, ADR-0087, ADR-0090, ADR-0093 (D5, the fail-fast boot guard), ADR-0105,
  ADR-0111, ADR-0112, ADR-0117, ADR-0118, ADR-0131, ADR-0138
- `packages/plugins/plugin-security/src/security-plugin-authz-middleware.ts` (steps 2.6, 2.7, 3.5, the public-form strip),
  `packages/plugins/plugin-security/src/platform-ownership-policies.ts`, `packages/plugins/plugin-security/src/security-plugin-sharing-verdicts.ts`,
  `packages/plugins/plugin-security/src/claim-seed-ownership.ts`, `packages/plugins/plugin-security/src/explain-engine.ts`,
  `packages/plugins/plugin-security/src/errors.ts`
- `packages/spec/src/security/permission.zod.ts`, `packages/spec/src/security/explain.zod.ts`,
  `packages/spec/src/security/sharing.zod.ts`, `packages/spec/src/security/public-form.ts`,
  `packages/spec/src/contracts/sharing-service.ts`, `packages/spec/src/contracts/sharing-service.test.ts`,
  `packages/spec/src/contracts/rls-membership-resolver.ts`,
  `packages/spec/src/contracts/data-driver.ts`, `packages/spec/src/automation/approval.zod.ts`,
  `packages/spec/src/data/injected-system-column-provenance.ts`, `packages/spec/src/data/hook.zod.ts`,
  `packages/spec/src/identity/position.zod.ts`, `packages/spec/src/kernel/metadata-plugin.zod.ts`,
  `packages/spec/src/kernel/metadata-type-schemas.ts`, `packages/spec/liveness/README.md`,
  `packages/spec/src/migrations/entries/semantic/17.sharing-rule-recipient-reconcile.ts`
- `packages/objectql/src/registry.ts` (`applySystemFields`), `packages/objectql/src/engine.ts`,
  `packages/objectql/src/engine-middleware-operation-vocabulary.test.ts`, `packages/core/src/security/effective-object-permissions.ts`,
  `packages/formula/src/cel-to-filter.ts`
- `packages/plugins/plugin-sharing/src/sharing-service.ts`, `packages/plugins/plugin-sharing/src/sharing-plugin.ts`,
  `packages/plugins/plugin-sharing/src/sharing-rule-service.ts`,
  `packages/plugins/plugin-sharing/src/field-recipient.test.ts`, `packages/plugins/plugin-sharing/src/bu-tree-recompute.ts`,
  `packages/plugins/plugin-sharing/src/recipient-membership-recompute.ts`, `packages/plugins/plugin-sharing/src/declared-sharing-rules.ts`,
  `packages/plugins/plugin-sharing/src/position-graph.ts`, `packages/plugins/plugin-sharing/src/team-graph.ts`,
  `packages/plugins/plugin-sharing/src/business-unit-graph.ts`, `packages/plugins/plugin-sharing/src/access-level.ts`,
  `packages/plugins/plugin-sharing/src/objects/sys-sharing-rule.object.ts`
- `packages/plugins/plugin-approvals/src/approval-service.ts`, `packages/plugins/plugin-approvals/src/approver-address.ts`
- `packages/lint/src/validate-org-axis-red-lines.ts`, `packages/lint/src/validate-approval-approvers.ts`,
  `packages/qa/dogfood/test/authz-conformance.matrix.ts`, `packages/services/service-messaging/src/recipient-resolver.ts`,
  `packages/platform-objects/src/system/sys-metadata-activation.object.ts`
- `packages/plugins/plugin-security/src/objects/sys-user-position.object.ts`, `packages/platform-objects/src/identity/sys-team.object.ts`,
  `packages/platform-objects/src/identity/sys-team-member.object.ts`, `packages/platform-objects/src/identity/sys-business-unit.object.ts`,
  `packages/platform-objects/src/identity/sys-business-unit-member.object.ts`
- HotCRM at `8f52859`: `src/service/objects/_case-assignment.ts`, `src/service/objects/case.hook.ts`,
  `src/sales/objects/lead.hook.ts`, `src/sales/flows/lead-assignment.flow.ts`, `src/service/views/case.view.ts`,
  `src/service/sharing/case.sharing.ts`, `src/service/actions/case.actions.ts`, `src/service/flows/case-actions.flow.ts`,
  `AGENTS.md`, `content/docs/administration/setup.mdx`, and the five tests named in Context §2
