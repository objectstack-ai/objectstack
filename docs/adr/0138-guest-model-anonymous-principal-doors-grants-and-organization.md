# ADR-0138: The guest model — one anonymous principal, a closed list of doors, one grants channel, one organization rule, and a fate for every declared guest key

**Status**: Proposed (2026-10-08). The eight answers are ruled; this record transcribes them into
contracts, each with its enforcement point. It becomes **Accepted** only when every item under
[Acceptance criteria](#acceptance-criteria) holds: the maintainer's approval of this record and the
G2 sweep recorded. The one letter the first ruling left open, [D2b](#d2b--the-anonymous-door--elevated-flow-combination-a-publish-refusal),
is ruled R by the supplement, and D1 is revised to A′ by the same supplement. ⛔ Nothing in
`packages/**`, `content/docs/**` or `skills/**` changes before acceptance; the execution cards are
cut after it ([Execution plan](#execution-plan-after-acceptance)).
**Decided by**: the maintainer's ruling on [#22146](https://github.com/objectstack-ai/objectstack/issues/22146)
(comment [`6054113537`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6054113537),
decision batch #290 item 1, 2026-10-08, 「22146 同意」): **A on all eight questions, and G2 on the
measurement gap**, as the `domain:spec` seat's decision request
([`6052740067`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052740067))
states them, with two clarifications (Q4 and Q2, carried into D4 and D2b). D2b's must-answer comes
from ruling A on [#22147](https://github.com/objectstack-ai/objectstack/issues/22147)
([`6053767508`](https://github.com/objectstack-ai/objectstack/issues/22147#issuecomment-6053767508)).
The ruling supplement
[`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963)
(2026-10-08, maintainer 「D1 A′ D2b R」) revises D1 to A′, under which the platform declares no
default owner, and rules D2b R, a publish refusal with a prescription. D9 records the maintainer's ruling of 2026-08-08 (Option A, landed as commit
`f586f1a89`).
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove: every
declared thing below names its enforcer), [ADR-0056](./0056-permission-model-landing-verification.md)
D2 (anonymous default-deny), [ADR-0073](./0073-automation-execution-identity.md) D2/D3/D5 and M2
(`runAs` as posture; attribution is not ownership), [ADR-0078](./0078-no-silently-inert-metadata.md)
(no silently-inert metadata), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (the
disposition vocabulary), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D9/D10/D11/D12
(audience anchors, principal taxonomy, the external dial, delegated administration),
[ADR-0096](./0096-execution-surface-identity-admission.md) (identity admission),
[ADR-0106](./0106-metadata-plane-fls-object-schema-masking.md) D7 (metadata-plane fallback set),
[ADR-0121](./0121-declarative-endpoint-routing-namespace-and-channel-split.md) D6 (anonymous
endpoints carry an armed rate limit), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md)
D3/D9 (the catalog is environment-level; a write's organization is derived or refused),
[ADR-0041](./0041-flow-trigger-family.md) (the signed inbound-hook channel),
[ADR-0046](./0046-package-docs-as-metadata.md) §6.7 (the public book audience gate).
**Amends, on acceptance**: ADR-0090 D9 (the `guest` anchor's bindings become enforced — D3 and D4
here) and ADR-0056 D2 (its explicit exposures become a closed list — D2 here). **Leaves unchanged**:
ADR-0106 D7, ADR-0121 D6, ADR-0096 D5 and E1, ADR-0135. The back-pointer lines are written out under
[Acceptance criteria](#acceptance-criteria) and land with the accepting change, not before it.
**Consumers**: `@objectstack/core` (`security/`), `@objectstack/plugin-security`,
`@objectstack/runtime`, `@objectstack/rest`, `@objectstack/metadata-core` (the form doors' rule),
`@objectstack/plugin-sharing` (D8), `@objectstack/service-automation` (D2b), and `@objectstack/spec`
for the contract changes the cards carry after acceptance (D2b's publish refusal, D8's retirement).
**Card**: [#22146](https://github.com/objectstack-ai/objectstack/issues/22146) (round 3 of 3: measurement,
decision, this draft). ⛔ Classes, positions and functions only: door-level readings that would
work as an exploit recipe stay private, as [#21158](https://github.com/objectstack-ai/objectstack/issues/21158)'s did.

---

## TL;DR

The platform already has an anonymous principal: a request with no session reaches the runtime as
the **guest** (`principalKind: 'guest'`, `positions: ['guest']`, never `isSystem`). What it lacked
was a model around that principal: which doors may serve it, how an administrator grants it
anything, which organization it acts in, who owns what it writes, and what becomes of the guest
keys declared over the years. Those answers lived in seven places, two of them declared and not
enforced, one only in a code comment, and one never answered. This record puts them in one place.

| | Question | Ruled | Contract in this record | Enforced by |
|:--|:--|:--|:--|:--|
| [D1](#d1--identity-and-ownership-the-guest-is-a-principal-never-an-owner) | identity and ownership | A′ (supplement) | the guest never owns a record and a forged owner is refused; who owns a guest-written row is the business scenario's own metadata; the platform stamps nothing and declares no default | the guest branch of the owner-anchor stamp in `SecurityPlugin` (card E3) |
| [D2](#d2--the-closed-list-of-doors) | the doors | A, plus a must-answer | five door classes; everything else answers 401, decided per domain | `shouldDenyAnonymous` at each domain's entry; the conformance matrix (card E2) |
| [D2b](#d2b--the-anonymous-door--elevated-flow-combination-a-publish-refusal) | anonymous door × elevated flow | R (supplement) | publish refuses an anonymous flow endpoint whose target runs as `system`, in both directions, with a prescription; no door triggers an elevated flow directly | the publish path, in both directions (card E2) |
| [D3](#d3--the-grants-channel-adr-0090-d9-enforced) | the grants channel | A | the `guest` anchor's bindings resolve for the guest; an empty set denies all; no second channel | the anonymous branch of `resolveAuthzContext` (card E1) |
| [D4](#d4--the-organization-a-guest-acts-in) | organization | A, with the form doors kept as they are | resolved only when the organization is unique; refused on a multi-organization deployment until D5 exists | the guest entry's organization step, sharing ADR-0131 D9's predicate (card E1) |
| [D5](#d5--the-public-site-binding-shape-only-built-when-demand-arrives) | public-site binding | A | the shape only; nothing declared | — nothing is declared, so nothing needs an enforcer |
| [D6](#d6--disclosure-and-explain-unchanged) | disclosure and explain | A | unchanged | `getMetadataReadableFields`; `derivePosture` |
| [D7](#d7--abuse-limits-adr-0121-d6-unchanged) | abuse limits | A | ADR-0121 D6 unchanged; the webhook signature vocabulary is a follow-up card | `policyGate` |
| [D8](#d8--the-fate-of-every-declared-guest-key) | every declared guest key | A | one fate per key, with its ADR-0087 disposition | per row |
| [D9](#d9--the-two-named-context-entries-the-2026-08-08-option-a-ruling-recorded) | the two named context entries | the 2026-08-08 ruling | recorded here; until now only a code comment | `assembleExecutionContext`, `assembleExecutionContextOrGuest` |

The ruling's own summary, verbatim: *"Q1 the guest never owns a record (writes go to a declared
default owner) · Q2 the closed list of five door classes, everything else 401 by domain · Q3
ADR-0090 D9 enforced: the guest anchor's bindings resolve for anonymous requests, an empty set denies
all · Q4 as above · Q5 the site-binding shape declared in the ADR, built when demand arrives · Q6
ADR-0106 D7 and the explain engine's EXTERNAL posture unchanged · Q7 ADR-0121 D6 unchanged, the
webhook signature vocabulary a separate card with its executor · Q8 every declared guest key gets an
enforce-or-remove fate with ADR-0087 dispositions (`sys_record_share`'s `guest` recipient on its own
card) · G2 the static door-class reading suffices to rule; the booted per-class anonymous sweep is an
acceptance precondition of the ADR's third round, run in an environment that permits the probe."*

The supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963) then ruled the two letters the draft asked for, verbatim
「D1 A′ D2b R」: D1 keeps its invariant and loses the organization-level default owner, and D2b is a
publish refusal with a prescription.

---

## Context

### Why one record

The maintainer named the demand that this card rests on: 「最为一个元数据开发平台,guest 是常见的需求吧?」
and asked for the whole model in one ADR: 「guest 是不是应该完整的重新设计并开adr」. The scenarios
are the ones this platform's customers have: the pre-login half of a customer portal, public forms,
public catalogs (products, positions, locations), token-addressed lookups (order tracking,
unsubscribe, confirmation), and partner webhooks. Each earlier record answered one door or one
key, so no record could say what a guest may do as a whole, and two of its pieces had been declared
without an enforcer.

### Where the anonymous principal is declared today — re-measured at `7b926f7600`

Every row below was re-read at `origin/main` `7b926f7600` (2026-10-08). Each anchor is a symbol, so
the gate that reads this registry fails when one moves.

| Where | What it says | State at `7b926f7600` |
|:--|:--|:--|
| ADR-0056 D2 — `packages/core/src/security/anonymous-deny.ts#shouldDenyAnonymous` | one `!userId && !isSystem → 401` decision, shared by every HTTP seam | **enforced** — today's floor |
| ADR-0090 D9 / D10 — `packages/spec/src/identity/position.zod.ts#GUEST_POSITION`, `#AUDIENCE_ANCHOR_POSITIONS` | the built-in `guest` position, held implicitly and exclusively by unauthenticated principals; the anchors packages suggest and never own; the human / agent / guest taxonomy | the taxonomy is **enforced** (`packages/spec/src/kernel/execution-context.zod.ts#principalKind`). The grants half is **declared, not enforced**: `packages/core/src/security/resolve-authz-context.ts#resolveAuthzContext` returns for a request with no user before any position or binding is resolved, so a set bound to `guest` grants nothing ([#21158](https://github.com/objectstack-ai/objectstack/issues/21158), closed and folded into #22146) |
| the 2026-08-08 Option A ruling — `packages/core/src/security/assemble-execution-context.ts#assembleExecutionContext`, `#assembleExecutionContextOrGuest` | two named entries: fail-closed, and the explicit guest envelope | **enforced**; recorded only in that module's doc comment. D9 records it |
| ADR-0096 D5 / E1 — `packages/plugins/plugin-security/src/security-plugin.ts#isPrincipalLessContext` | the principal-less hand-off and strict mode | open, under [#21908](https://github.com/objectstack-ai/objectstack/issues/21908). Not a guest path: the guest envelope carries a position, so the predicate is false for it and the guest reaches every gate |
| ADR-0106 D7 — `packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin.getMetadataReadableFields` | a caller resolving no set takes the configured fallback set on the metadata plane | **enforced** |
| ADR-0121 D6 — `packages/spec/src/api/endpoint-publish-gate.ts#policyGate` | `authRequired: false` publishes only with an armed `rateLimit`; signature keys named as a future vocabulary, not promised | **enforced** |
| the public form doors — `packages/metadata-core/src/anonymous-form-intake.ts#anonymousFormIntakeUnavailability`, `packages/rest/src/rest-server.ts#RestServer.registerFormEndpoints` | which forms are open, withdrawal, and the organization a submission lands in (the deployment's default organization; on a walled posture an organization-walled object is withheld) | **enforced**; a posture of its own (`publicFormGrant`: insert and read-back on that object only), not the guest envelope |
| the runtime face's anonymous `object_operation` path — `packages/runtime/src/security/resolve-execution-context.ts#resolveExecutionContext`, `packages/runtime/src/endpoint-executor.ts#BuildEndpointExecutionContextInput` | the card read the executor as threading no principal | **changed since the card was filed — no gap.** The runtime face takes the guest entry, so an anonymous request an `authRequired: false` endpoint admits executes as the guest and is refused at the CRUD gate while nothing is granted ([#22147](https://github.com/objectstack-ai/objectstack/issues/22147) ruling C; pinned by PR #22177, `6ed0c0f3e5`) |
| "which organization does a guest act in" | — | **unruled** until D4; only the form doors answered for themselves |

Three further facts from the measurement round
([`6052668454`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052668454)),
re-checked at the same head, shape the decisions:

- **`GUEST_POSITION` composes vocabulary; enforcement keys on the literal.** At `7b926f7600` the
  constant is read twice outside its declaration and re-export: to build `AUDIENCE_ANCHOR_POSITIONS`
  and the built-in position's display text
  (`packages/plugins/plugin-security/src/builtin-positions.ts#securityBuiltinPositions`). Every
  enforcing reader keys on the string `'guest'`: the envelope
  (`packages/core/src/security/assemble-execution-context.ts#entryFields`), explain's `EXTERNAL` floor
  (`packages/plugins/plugin-security/src/explain-engine.ts#derivePosture`), the anchor binding tier
  (`packages/spec/src/security/high-privilege.ts#describeAnchorForbiddenBits`, called from
  `packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin.assertAudienceAnchorBindingGate`),
  and delegated administration (`packages/plugins/plugin-security/src/delegated-admin-gate.ts#ANCHOR_POSITIONS`).
- **Two guest values are declared with nothing behind them.** A package may suggest a `guest`
  binding (`packages/plugins/plugin-security/src/objects/sys-audience-binding-suggestion.object.ts#anchor`),
  and confirming it binds a set that grants nothing; and `sys_record_share` offers a `guest`
  recipient (`packages/plugins/plugin-sharing/src/objects/sys-record-share.object.ts#recipient_type`,
  `packages/spec/src/contracts/sharing-service.ts#RecordShareRecipientType`) that the grant refuses.
- **G2 — the booted sweep was not run.** The round's booted per-door-class anonymous sweep stopped
  at the environment's safety check, and nothing was worked around. The static door-class reading
  shows every class answering a denial or a narrow door. The maintainer ruled G2: that reading
  suffices to rule, and the booted sweep is an acceptance precondition of this record.

### How the mainstream platforms model it

Recorded from each platform's public documentation by the measurement round (2026-10-08).

| Platform | Anonymous principal | How it is granted anything | Site binding | Records a guest creates | Default |
|:--|:--|:--|:--|:--|:--|
| Salesforce Experience Cloud | a guest user and guest profile per site | the profile's object permissions plus guest sharing rules; secure guest-user policy forces private sharing defaults and caps guest access at read | the site | assigned to a named internal default owner | denied until granted |
| ServiceNow | the `guest` user | the same ACLs as any user, including path-based ACLs on scripted REST endpoints | the portal | — | scripted REST requires authentication unless unchecked |
| Microsoft Power Pages | the Anonymous Users web role (one per site) | table permissions, effective only when linked to a web role | the site | — | no table access until a permission is linked; an admin control can disable anonymous data access |
| Odoo | the public user (`auth='public'`); `auth='none'` is reserved for infrastructure | access rights and record rules (group-less rules apply to the public user) | per-website public user (multi-website) | — | access rules decide |
| Supabase | the `anon` Postgres role | row-level-security policies whose `TO` clause names `anon` | — (the project) | — | RLS on with no policy denies |
| Hasura | the configured unauthorized role | that role's per-table permissions | — | — | with an admin secret set, unauthenticated requests are refused unless the role is configured |

Sources: Salesforce, [Protecting your data: secure Experience Cloud guest user access](https://www.salesforce.com/blog/protecting-your-data-essential-actions-to-secure-experience-cloud-guest-user-access/)
and the *Secure Guest User* guide on `resources.docs.salesforce.com`;
ServiceNow, [product documentation](https://www.servicenow.com/docs/) (*Scripted REST APIs*, *Add a
path-based ACL for a scripted REST API*, *Configure tables to work with guests*); Power Pages,
[Assign table permissions](https://learn.microsoft.com/power-pages/security/assign-table-permissions)
and [Disable anonymous access](https://learn.microsoft.com/power-pages/security/disable-anonymous-access);
Odoo, [Web controllers — `http.route` `auth`](https://www.odoo.com/documentation/18.0/developer/reference/backend/http.html);
Supabase, [Row level security](https://supabase.com/docs/guides/auth/row-level-security)
and [API keys](https://supabase.com/docs/guides/api/api-keys); Hasura,
[Unauthenticated access](https://hasura.io/docs/latest/auth/authentication/unauthenticated-access/).

**The convergence.** Every one of them ships a first-class anonymous principal that runs the same
evaluation pipeline as a signed-in principal, denies by default, and is granted only by explicit,
administrator-confirmed configuration, usually bound to a site. This platform's guest envelope is
already that principal. Its gaps were the grants channel (D3), the organization (D4, D5) and
ownership (D1), not the principal.

---
## Decision

Each decision states its contract, its enforcement point, and what is left to its execution card.
A contract this record states but no code enforces yet is **Proposed**, exactly as the record is;
it becomes binding with its card, and not one declared thing here goes without an enforcer
(ADR-0049).

### D1 — Identity and ownership: the guest is a principal, never an owner

*Ruled: Q1 A, revised to **A′** by the supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963).*

1. **The guest is a principal.** An unauthenticated request served by a guest-entry door (D2,
   classes 4 and 5) executes as the envelope D9 records: `principalKind: 'guest'`,
   `positions: ['guest']`, `isSystem: false`, no `userId`. It is never the system principal and
   never principal-less.
2. **The guest never owns a record.** No ownership column takes a guest value, and the guest
   carries no `userId` for an owner gate to match.
3. **Ownership of a guest-written row is the business scenario's own metadata.** The door's
   declaration may name an owner or an assignment target, and the object's hooks, record-change
   flows and assignment rules run as they do for any insert. The platform stamps nothing on a guest
   insert and declares no organization-level default owner. A guest-supplied owner is a forgery and
   is refused.
4. **Attribution is not ownership** (ADR-0073 D3). The audit records the guest as the actor that
   wrote the row. Whoever the scenario makes the row's owner is not recorded as having acted.
5. **Empty state: the owner stays unset.** When nothing in the scenario sets it, a guest-written
   row keeps no owner, exactly as the public form doors' intake does today; hooks and flows may set
   it. The form's authoring read states the absence on the channel that already carries the intake
   advisory (`packages/metadata-core/src/anonymous-form-intake.ts#anonymousFormIntakeUnavailableMessage`).
   There is no publish refusal: nothing that serves today starts refusing.

**Enforced by**: the guest branch of the owner-anchor stamp in
`packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin`, the step that stamps an
absent `owner_id` with the acting user and refuses a forged one. For a guest it never writes the
guest and never the system principal, refuses a forged owner, and leaves the owner unset unless the
scenario sets it. For the form doors, its `publicFormGrant` branch strips a supplied owner
(`packages/spec/src/security/public-form.ts#PUBLIC_FORM_SERVER_MANAGED_FIELDS`) and leaves it unset,
as it does today. **Card**: E3.

### D2 — The closed list of doors

*Ruled: Q2 A, plus the must-answer that D2b states.*

An unauthenticated request is served by exactly these five door classes. Each derives its own
narrow authorization from a declaration; none derives it from a deployment posture.

| # | Door class | What admits the request | What it runs as | Enforced by |
|:--|:--|:--|:--|:--|
| 1 | the public form doors (resolve and submit) | the form's `sharing` declaration: enabled, anonymous, a public link naming the slug | the form grant: insert and read-back on that one object, nothing else | `packages/rest/src/rest-server.ts#RestServer.registerFormEndpoints`; the `publicFormGrant` branch of `packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin` |
| 2 | share links | the capability token | after validation, a read of that one record | `packages/plugins/plugin-sharing/src/share-link-routes.ts#registerShareLinkRoutes` |
| 3 | the public book and doc metadata reads | `book.audience: 'public'` | reachability only; the ADR-0046 §6.7 gate authorizes the read | `packages/rest/src/meta-item-read-gate.ts#isPublicAudienceRead` |
| 4 | `authRequired: false` endpoints of `type: 'object_operation'` | the endpoint declaration, with the armed rate limit ADR-0121 D6 requires | the guest envelope (D9), under the guest's grants (D3) | `packages/runtime/src/security/resolve-execution-context.ts#resolveExecutionContext`; the CRUD gate |
| 5 | `authRequired: false` endpoints of `type: 'flow'` | the same | the guest envelope at the door; inside, the flow's own declared `runAs`, which publish never lets be `system` behind this door (D2b) | the same, then `@objectstack/service-automation` |

**Everything else answers 401** (`UNAUTHENTICATED`). The decision is taken once per **domain**, as the
domain's first statement, never surface by surface:
`packages/core/src/security/anonymous-deny.ts#shouldDenyAnonymous` reads `userId`, which the guest
envelope does not carry, so the envelope the runtime face assembles for every sessionless request
(D9) is refused in every domain except at the two endpoint classes above. A new surface is therefore
401 until this list names it, and naming a new door class is an amendment of this record.

**Outside the guest model by construction**, and not on the list:

- the control-plane allowlist (`packages/core/src/security/auth-gate.ts#isAuthGateAllowlisted`:
  sign-in, health, readiness, discovery, and the current-user reads the ADR-0069 remediation screen
  needs). It is infrastructure that serves no business data, the role Odoo gives `auth='none'`;
- the signed inbound-hook channel of ADR-0041
  (`packages/triggers/trigger-api/src/api-trigger.ts#verifySignature`). Its per-flow secret is the
  credential, and a missing or bad signature answers 401;
- MCP, which admits an OAuth token or an API key and never an anonymous caller.

**The adoption rule of D9, closed.** D9's ruling lets a surface adopt the guest entry only when its
product semantics serve anonymous principals. D2 turns that sentence into a list: classes 4 and 5
take the guest envelope; classes 1 to 3 take their own declared grant; nothing else serves a guest.

**Enforced by**: `shouldDenyAnonymous` at each domain's entry, today; and the authorization
conformance matrix (`packages/qa/dogfood/test/authz-conformance.matrix.ts#AUTHZ_CONFORMANCE`), whose
rows already fail on a deleted deny call or an unclassified route. Card E2 records the five classes
there. ⛔ No new gate script. **Card**: E2.

### D2b — The anonymous door × elevated flow combination: a publish refusal

*Must-answer added to Q2 by ruling A on #22147 ([`6053767508`](https://github.com/objectstack-ai/objectstack/issues/22147#issuecomment-6053767508)),
pointer [`6053819337`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6053819337).
Ruled **R** by the supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963).* The reasoning is in
[D2b on the four axes](#d2b-on-the-four-axes); Option M is under
[Alternatives considered](#alternatives-considered).

**The question.** An anonymous request admitted at an `authRequired: false` endpoint of
`type: 'flow'` whose target flow declares `runAs: 'system'` runs that flow's data steps as the
system principal, by the flow author's explicit declaration (ADR-0073 D2). Ruling A on #22147 kept
that, changing nothing in code, and routed the hazard here: the `runAs` description itself
(`packages/spec/src/automation/flow.zod.ts#runAs`) prescribes `system` for user-less triggers, so an
author who follows it opens an anonymous system-level door whose only brake is ADR-0121 D6's rate
limit. The ruling named two answers, verbatim: *"a publish refusal with a prescription, or allowed
only once ADR-0073 M2's `automation` posture lands"*; the answer also says which doors may trigger
an elevated flow, and how loudly publish says so.

**The decision.** Publish refuses an `authRequired: false` endpoint of `type: 'flow'` whose target
flow declares `runAs: 'system'`, in both directions, because either item can be the last one edited:
the endpoint's publish reads its target's `runAs`, and a flow's publish that sets `runAs: 'system'`
reads the anonymous endpoints that target it. The prescription names what serves each scenario
instead: an authenticated endpoint for a partner that can hold a credential; the signed inbound-hook
channel (ADR-0041) for a partner webhook; a public form for anonymous intake; and, once ADR-0073 M2
lands, `runAs: 'automation'`.

- *Which doors may trigger an elevated flow directly:* none.
- *How loudly publish says so:* a refusal; the publish fails.

**The indirect path, recorded and not decided.** A guest-written row fires record-change flows: a
form submission today, an endpoint create once D3's channel opens. Such a flow runs under its own
declared `runAs`, as every flow fired by a write without a user does (ADR-0073's amendment of
2026-07-28: under `user` its data steps are refused; under `system` they run elevated). The refusal
does not reach that path, because the trigger is the write and not the door. Covering it would be a
third shape, which neither ruled option stated.

**Enforced by**: the publish path, in both directions. The cross-item read sits where both items
are readable at publish, beside the per-endpoint `packages/spec/src/api/endpoint-publish-gate.ts#policyGate`,
which reads one endpoint only. The refusal narrows the accept set, so card E2 registers one ADR-0087
semantic entry with it. Until E2 lands, ruling A on #22147 governs and today's combination stands,
unchanged. **Card**: E2.

### D3 — The grants channel: ADR-0090 D9, enforced

*Ruled: Q3 A.*

1. **The bindings resolve.** At an anonymous request served by a guest-entry door (D2, classes 4
   and 5), the guest envelope carries the permission sets bound to the `guest` anchor position, as
   bound in the organization D4 resolves. They are read by the one binding reader every position
   uses — today the position-bound read inside
   `packages/core/src/security/resolve-authz-context.ts#resolveUserAuthzGrants`; once ADR-0131 C3
   lands, the position's own declared sets. There is no guest-specific storage and no second reader.
2. **Empty state: deny-all.** With nothing bound, the guest holds no set, and an empty set list
   answers no at every gate (the ADR-0056 D2 deny baseline). This is today's behaviour, now as the
   declared empty state rather than as the side effect of a missing channel.
3. **One channel.** Nothing else reaches the guest: not the authenticated baseline (applied only to
   a caller with a `userId`), not the `everyone` anchor (authenticated members only, ADR-0090 D5),
   not the position-name fold that the ruling recorded on #13419 retires. Card E1 pins each of the
   three.
4. **The binding tier stands.** A set bound to `guest` must pass the strictest anchor tier:
   explicit objects only, no wildcard, read-mostly with create case by case, no view-all or
   modify-all, no system permissions (ADR-0090 D9; `describeAnchorForbiddenBits`, enforced by
   `SecurityPlugin.assertAudienceAnchorBindingGate`). A delegated administrator never binds an anchor
   (ADR-0090 D12; `ANCHOR_POSITIONS`). Unchanged.
5. **How a deployment grants.** An administrator binds a low-privilege set to `guest`, directly or
   by confirming a package's suggestion
   (`packages/plugins/plugin-security/src/suggested-audience-bindings.ts#confirmAudienceBindingSuggestion`).
   Packages suggest; they never bind (ADR-0090 D9).
6. **Row scope: one pipeline.** The guest's grant is evaluated by the same row-level pipeline as
   every caller, with no guest special case. The guest owns nothing (D1), so it reaches rows only
   through the object's declared sharing model and through share links — ADR-0090 D9's division of
   labour (the guest position answers which object classes are reachable at all, share links answer
   which records), and D11's statement that the guest is not an OWD audience. Card E1 pins the
   guest's row scope for each sharing model before it lands; a result that departs from that
   division of labour is that card's finding to raise, not a choice to make silently.
7. **The organization comes first.** Bindings are organization-scoped today. With no organization
   resolved, the binding read would gather every organization's bindings, the class the grant rule
   in `resolveUserAuthzGrants` exists to stop. So D3 never resolves a binding without D4's
   organization; where D4 refuses, D3 is never reached.

**Enforced by**: the anonymous branch of `resolveAuthzContext`, which today returns before any
position or binding is resolved. That branch is the declared-not-enforced point; it resolves the
`guest` anchor's bindings in D4's organization, and the set resolution in
`packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin.resolvePermissionSetsForContextUnmemoized`
then treats them as any requested set. **Card**: E1.

### D4 — The organization a guest acts in

*Ruled: Q4 A, with clarification (1).*

1. **Unique, or refused.** A guest-entry door with no declared organization binding of its own
   resolves the guest's organization on the server, never from anything the client sends. When the
   deployment holds exactly one organization, the guest acts in it. Otherwise the request is
   refused, loudly, with a message naming the missing site binding (D5). It is never answered by a
   silent pick.
2. **One predicate.** This is the predicate ADR-0131 D9 already uses for a write's organization —
   derived when exactly one organization exists, refused otherwise
   (`packages/objectql/src/tenancy/system-write-organization.ts#resolveSystemWriteOrganization`) — and
   the guest entry asks the same one, never a second spelling of it.
3. **Applied where it is needed.** D4 is asked where the guest's organization matters: to resolve
   D3's grants and to scope the guest's data operations. A door that needs neither of these — a flow running under its own declared posture — is untouched by D4.
4. **Clarification (1), verbatim in substance.** The public form doors' declared binding to the
   deployment's default organization (`packages/metadata-core/src/anonymous-form-intake.ts`) stays as
   it is. D4's rule — resolve only when the organization is unique; refuse on a multi-organization
   deployment until D5's site binding exists — governs only the doors that have no declared binding
   of their own. Nothing that serves today starts refusing.
5. **ADR-0131 alignment.** No guest write lands without an organization (ADR-0131 D1, D9): it lands
   in the organization D4 resolves, or it is refused. On a walled deployment with several
   organizations the answer is the same refusal until D5 exists; the form doors keep the walled-posture
   behaviour `anonymousFormIntakeUnavailability` already states.

**Enforced by**: the guest entry's organization step, sharing `resolveSystemWriteOrganization`'s
predicate, delivered with D3 because D3 cannot resolve without it. The refusal's code comes from the
ADR-0112 catalog. **Card**: E1.

### D5 — The public-site binding: shape only, built when demand arrives

*Ruled: Q5 A.* ⛔ This record declares no metadata type and reserves no key.

When a deployment needs more than one organization's guest traffic, the binding that answers D4
declaratively has this shape, the shape every platform in the comparison binds a site with:

| Element | Meaning | Constraint |
|:--|:--|:--|
| match | a host name or a path prefix | resolved before anything else in the request |
| organization | the organization a matched request acts in | answers D4 for that request |
| guest grants | the guest permission sets for that site | through D3's channel and its anchor tier, never around it |
| allowed doors | the door classes the site opens | a subset of D2's list; it narrows, never adds a class |

Built implementation-first (ADR-0049, ADR-0078): the card that builds it declares the type with its
enforcer in the same change. The measured demand at `7b926f7600` is none: the repository's example
apps open public forms on a single organization, and the measurement round found the same in the
hotcrm tree. The trigger is a named deployment that needs it.

### D6 — Disclosure and explain: unchanged

*Ruled: Q6 A.* ADR-0106 D7 stands: a caller resolving no set takes the configured fallback set on
the metadata plane (`SecurityPlugin.getMetadataReadableFields`). The explain engine's posture for
the guest stays `EXTERNAL` (`derivePosture`). One consequence is recorded rather than decided: once
D3 lands, a guest with bindings is no longer a zero-set caller, so D7's fallback applies only to a
guest with nothing bound.

### D7 — Abuse limits: ADR-0121 D6 unchanged

*Ruled: Q7 A.* An `authRequired: false` endpoint publishes only with an armed rate limit
(`policyGate`), unchanged. The webhook signature vocabulary (an HMAC, a timestamp, a replay window)
does **not** enter `packages/spec/src/api/endpoint.zod.ts#ApiEndpointSchema` with this record: a key
with no executor is the metadata ADR-0078 forbids. It is a follow-up card, filed with its executor
([Follow-ups](#follow-ups-named-not-filed)). Partner webhooks are served today by the signed
inbound-hook channel (`verifySignature`), which verifies an HMAC and has no timestamp or replay
window; the follow-up decides whether endpoints gain the vocabulary or webhooks keep that channel.

### D8 — The fate of every declared guest key

*Ruled: Q8 A.* Each key gets one fate under ADR-0049 (enforce or remove) and, where something moves,
an ADR-0087 disposition. Measured at `7b926f7600`.

| Key | Where | State | Fate | ADR-0087 |
|:--|:--|:--|:--|:--|
| `GUEST_POSITION` | `packages/spec/src/identity/position.zod.ts#GUEST_POSITION` | live: composes the anchor vocabulary and the built-in position's display text; no enforcing reader reads the constant, all key on the literal `'guest'` | **keep** | none — nothing moves |
| `AUDIENCE_ANCHOR_POSITIONS` | `packages/spec/src/identity/position.zod.ts#AUDIENCE_ANCHOR_POSITIONS` | live: registers the built-in positions, resolves install-time suggestions, excludes the anchors from test personas | **keep** | none |
| the `guest` value of a binding suggestion's anchor | `packages/plugins/plugin-security/src/objects/sys-audience-binding-suggestion.object.ts#anchor` | declared: a confirmed `guest` suggestion binds a set that grants nothing today | **enforce** — live once D3 lands | none — no key or value moves |
| `principalKind: 'guest'` | `packages/spec/src/kernel/execution-context.zod.ts#principalKind`, `packages/spec/src/security/explain.zod.ts#principalKind` | live | **keep** | none |
| the two named context entries | `packages/core/src/security/assemble-execution-context.ts#assembleExecutionContext`, `#assembleExecutionContextOrGuest` | live | **keep**, recorded by D9 | none |
| the fallback permission set's guest reading | ADR-0106 D7: guest-facing deployments point the fallback set at their guest set | live | **keep** (D6) | none |
| the form doors' `guest_portal` set name | `packages/rest/src/rest-server.ts#RestServer.registerFormEndpoints`; the reference declaration is `examples/app-crm/src/security/sales-positions.ts#GuestPortalProfile` | live: the form doors' context names that set, and the result masker resolves it where a deployment registers one. Not on the card's list; recorded so that no guest reading is left without a fate | **keep**, as part of the form doors' own posture (D2 class 1, kept as it is by D4's clarification). Whether it folds into D3's channel is a question card E1 measures; nothing that serves today changes | none |
| `sys_record_share`'s `guest` recipient | `packages/plugins/plugin-sharing/src/objects/sys-record-share.object.ts#recipient_type`; `packages/spec/src/contracts/sharing-service.ts#RecordShareRecipientType` | declared only: an author can choose it, and the grant refuses it (ADR-0078) | **remove**, on its own card (E4) | expected `not-required (no-migration-prescription)`; `registered` instead if E4's census finds a stored metadata surface carrying the value |

**Why removal for the record-share recipient.** ADR-0090 D11 says guest access flows through the
guest position and share links only, which leaves a record-level share to "the guest" no enforcer to
gain. The sharing-rule vocabulary already retired the same recipient: the ADR-0087 ledger entry
`sharing-rule-recipient-reconcile` prescribes "delete the rule and expose the records through a
public form or a share link". The row-level value is the last remnant of that recipient. If E4's
census finds a named consumer, the fate reopens on that card, not here.

### D9 — The two named context entries (the 2026-08-08 Option A ruling, recorded)

*Ruled by the maintainer on 2026-08-08 (Option A), landed as commit `f586f1a89` (#7259). Until this
record the ruling lived only in the doc comment of
`packages/core/src/security/assemble-execution-context.ts`.*

Every transport assembles an inbound request's execution context in one place, and an
unauthenticated request has exactly two named outcomes:

- **`assembleExecutionContext`, the default, fail-closed entry.** No resolved principal yields no
  context, and the surface answers 401. Every surface uses it unless serving anonymous principals is
  part of its product semantics.
- **`assembleExecutionContextOrGuest`, the explicit guest entry.** No resolved principal yields the
  guest envelope: `principalKind: 'guest'`, `positions: ['guest']`, `isSystem: false`, no user, no
  authentication-policy gate, no localization, no posture rung, and today no organization (D4
  supplies one). Its consumers are live: explain's `EXTERNAL` floor, and the endpoint doors of D2.

**The adoption rule is the ruling's**: a surface adopts the guest entry only when its product
semantics serve anonymous principals, because handing a guest envelope to a surface that answered
401 turns an authentication failure into an authorization evaluation. D2 closes the set of such
surfaces.

Rejected on 2026-08-08 and not reopened here: **Option B**, the guest envelope everywhere, which
would make anonymous service the default posture of every new surface; and **Option C**, no context
everywhere, which would delete the guest principal, the `guest` position and explain's `EXTERNAL`
floor. Each breaks a live consumer.

---

## D2b on the four axes

The reasoning recorded for the ruled letter, R ([D2b](#d2b--the-anonymous-door--elevated-flow-combination-a-publish-refusal)).
The table compares it with Option M, which the supplement did not take
([Alternatives considered](#alternatives-considered)).

### The four axes

| Axis | Option R | Option M |
|:--|:--|:--|
| **Real business need** (measured) | At `7b926f7600`, `examples/` holds zero `authRequired: false` declarations (one comment mentions the key). The repository's partner-webhook example, `showcase_inbound_task_webhook`, takes the signed inbound-hook channel with `runAs: 'system'`, which neither option touches. A refusal closes no measured in-repo use. Not measured: deployments outside this repository; the cloud tree was not read. | Keeps a shape with no measured in-repo user open until M2. M2's own trigger is a first real consumer (ADR-0073, Scope), so the interim has no date. |
| **Long-term soundness** | A contract tightening that is final for `system`; when M2 lands it adds `automation` to the prescription. The cost is one cross-item check in the publish path: the endpoint reads its flow, and the flow reads its endpoints. | Matches ADR-0073's target exactly (`automation` is the default for user-less triggers) and the two-year picture drawn on #22147. It takes two changes, an advisory now and a refusal at M2, and the second waits on an unscheduled milestone. |
| **Preventing AI authoring errors** | Strongest. The `runAs` description prescribes `system` for user-less triggers; an AI that follows it is stopped at publish with the prescription in hand. What is declared is what is enforced. | Weaker until M2: an advisory leaves publish green, and an automated authoring loop reads green as done. After M2 it is the same as R. |
| **Startup focus** | One refusal in the existing publish path: no new gate script and no new key. It narrows the accept set, so its card carries an ADR-0087 semantic entry. | A staged transition. The startup axis admits a staged path only on named external-user evidence, and none was measured. Two changes instead of one. |

**Ruled R** by the supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963): card E2 implements it, with the registered ADR-0087
semantic entry, and D2's class 5 row records it. ⛔ M not taken: an advisory interim with no date,
which an automated authoring loop reads as done.

---

## Enforcement map

Every declared thing in this record, and what enforces it. A row reading "card" is Proposed until
that card lands; no row is declared without an enforcer.

| Declared | Where | Enforced by | Status |
|:--|:--|:--|:--|
| anonymous default-deny | ADR-0056 D2; D2 | `shouldDenyAnonymous`, at each domain's entry | enforced |
| the guest envelope | D9 | `assembleExecutionContextOrGuest` (through `entryFields`) | enforced |
| the fail-closed default entry | D9 | `assembleExecutionContext` | enforced |
| the five door classes | D2 | the enforcer named in each row of D2's table | enforced per door |
| the list itself | D2 | the conformance matrix, `AUTHZ_CONFORMANCE` | card E2 records it |
| no `system` flow behind an anonymous flow door | D2b | the publish path, in both directions | card E2 |
| the guest's grants, and deny-all when none | D3 | the anonymous branch of `resolveAuthzContext` | card E1 |
| the anchor binding tier | ADR-0090 D9; D3 | `describeAnchorForbiddenBits`, through `assertAudienceAnchorBindingGate` | enforced |
| no delegated binding of an anchor | ADR-0090 D12 | `ANCHOR_POSITIONS` | enforced |
| the guest's organization | D4 | the guest entry's organization step, with `resolveSystemWriteOrganization`'s predicate | card E1 |
| the form doors' organization | D4, clarification (1) | `anonymousFormIntakeUnavailability`; the engine's write derivation | enforced |
| the guest owns nothing; a forged owner refused; the owner unset unless the scenario sets it | D1 | the guest branch of the owner-anchor stamp, and the `publicFormGrant` branch, in `SecurityPlugin` | card E3; the form doors' strip is enforced today |
| anonymous endpoints carry an armed rate limit | ADR-0121 D6; D7 | `policyGate` | enforced |
| metadata disclosure to a zero-set caller | ADR-0106 D7; D6 | `getMetadataReadableFields` | enforced |
| the guest's explain posture | D6 | `derivePosture` | enforced |
| the record-share `guest` recipient | removed by D8 | its removal; until then, the grant's refusal | card E4 |
| the site binding | D5 | nothing, because nothing is declared | — |
| the webhook signature vocabulary | not declared (D7) | nothing, because nothing is declared | follow-up F1 |

---

## Consequences

- **One record instead of seven places.** The anonymous principal's doors, grants, organization,
  ownership and keys are read here, and the 2026-08-08 ruling gets a record (D9). The code keeps its
  pointer to the decision (Prime Directive #13); card E2 points the module doc of
  `assemble-execution-context.ts` at this record.
- **Bindings confirmed while inert start granting (D3).** A set bound to `guest` today, directly or
  through a confirmed suggestion, grants nothing. On the release that lands E1 it grants what it says,
  to anonymous callers at the guest-entry doors. Every such binding passed the strictest anchor tier,
  and the administrator who confirmed it believed it granted, so D3 honours a declaration rather than
  widening one. The change is still visible: E1's changeset names it, and E1 counts the population
  on the reference apps before it lands.
- **A multi-organization deployment's anonymous endpoints answer a located refusal** where they need
  an organization, until D5 is built. Today those requests are refused at the CRUD gate with nothing
  granted, so no request that is served today stops being served.
- **The guest is one principal on one pipeline.** No guest special case enters the row-level
  evaluator, the CRUD gate or the masker; what differs for the guest is what it holds (D3) and where
  it acts (D4), both resolved before any gate runs.
- **Not measured, and named:** the booted per-class sweep (G2, an acceptance precondition); the
  guest's row scope for each sharing model (E1's pins); the anonymous surfaces of the cloud
  repository, which this round did not read.

## What the ruling did not settle

Stated so that approving this record approves these readings knowingly.

1. **The spelling of D5's binding** belongs to the card that builds it. This record fixes its shape
   and reserves no key.
2. **The indirect path** (record-change flows fired by a guest-written row) lies outside D2b's
   refusal, as stated there: recorded, not decided.
3. **The guest's row scope** is stated as a contract (one pipeline, no special case, ADR-0090 D9's
   division of labour); its measured outcome per sharing model is E1's pin.

## Alternatives considered

The letters the ruling did not take, from the decision request
([`6052740067`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052740067)):

- **Q1 B — the guest as owner.** Rows that nobody inside the organization can manage, and an owner
  column holding a principal that never signs in.
- **Q1 A as first drafted — an organization-level default owner** (superseded by A′,
  [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963); the maintainer: 「访客写进来的记录归本组织声明的一个内部人,这个没必要吧,应该是每个业务场景在元数据级别自己处理吧」).
  Ownership policy is business logic that differs per scenario (territory, queue, round-robin,
  product line), so an organization-level constant is wrong in most deployments and pre-empts the
  scenario's own hook. On Salesforce and ServiceNow the assignment rule does the work and an
  organization default is only the fallback. A silent stamp hides a missing assignment, and the
  draft needed a new declaration, an empty-state rule and a site-binding element to carry it.
- **Q2 B — every surface that declares `authRequired: false` open to the guest.** Each new surface
  becomes a door nobody reviewed.
- **Q3 B — keep D9 declared and unenforced.** Administrators keep being told a binding grants when
  it does not. **Q3 C — retire the guest anchor's bindings.** The guest demand the maintainer named
  cannot be served at all.
- **Q4 B — always the default organization.** On a multi-organization deployment a guest's data could
  land in another tenant. **Q4 C — build a per-site mapping now.** A capability ahead of its demand.
- **Q5 B — declare a `site` metadata type now.** A type with no measured demand.
- **Q7 B — fold the signature vocabulary in here.** Keys without an executor (ADR-0078).
- **Q8 B — change every key in this record's change.** This record carries no code; the ruling
  places every code change after acceptance.
- **D2b M — allowed only once ADR-0073 M2's `automation` posture lands** (not taken by the
  supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963)). Until M2, today's combination would have stood with a publish
  advisory; at M2, `system` behind an anonymous door would have become a refusal prescribing
  `automation`. An advisory interim with no date is one an automated authoring loop reads as done,
  and the transition is staged with no named external-user evidence. The stricter reading of the
  ruled words, refused until M2 lands, is R's interim exactly.
- **G1 — run the booted sweep before ruling.** One more round of waiting, against a static reading
  whose failure direction is safe: every door class reads as a denial or a narrow door.

## Acceptance criteria

This record moves from Proposed to Accepted when all four hold; the third is met:

1. **The maintainer approves this record** (`docs/adr/**` is a Tier H surface, Prime Directive #14).
2. **G2 — the booted per-door-class anonymous sweep**, run in an environment that permits the probe.
   For each of D2's five classes, and for the everything-else class, a booted reference deployment's
   anonymous answer (its status class, and what is served) matches D2's table. The readings stay
   private, as #21158's did; the card records a class-level result only. ⛔ This record names no
   driver and no probe.
3. **D2b is chosen — met.** The supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963) ruled R, and D2b records it.
4. **The back-pointers land with the accepting change**, one status-line continuation each, in the
   form ADR-0042 and ADR-0046 use for a decision amended in part:

   ```text
   ADR-0090 status line:
   · **Amended** (DATE, ADR-0138 D3/D4) — D9's `guest` anchor bindings resolve for anonymous
     requests, in the organization ADR-0138 D4 resolves; an empty set denies all.

   ADR-0056 status line:
   · **Amended** (DATE, ADR-0138 D2) — D2's explicit public exposures are a closed list of five
     door classes; every other surface answers 401, decided per domain.
   ```

   No line is added to ADR-0106, ADR-0121, ADR-0096 or ADR-0135: this record leaves their decisions
   as they are.

## Execution plan (after acceptance)

The seat cuts these cards from the accepted record. ⛔ None is filed before acceptance, and ⛔ none
changes `packages/spec` before it.

| Card | Decisions | What lands | Pins | ADR-0087 disposition | Order |
|:--|:--|:--|:--|:--|:--|
| **E1** — the grants channel | D3, D4 | the guest entry resolves D4's organization, then the `guest` anchor's bindings; the located refusal where D4 refuses | no binding: denied on class 4; a bound read set: that object only; the baseline, `everyone` and the name fold never reach the guest; a multi-organization deployment: the located refusal; the form doors unchanged; the guest's row scope for each sharing model; the bindings that start granting, counted on the reference apps | none: no authorable key, accept set or stored shape moves; the changeset names the bindings that start granting | first |
| **E2** — the closed list and denial by domain, and D2b | D2, D2b, D9's pointer | the five classes recorded in the conformance matrix; any face of a listed domain that still decides per face moved to the domain-level deny; D2b's publish refusal in both directions, with its prescription; the module doc of `assemble-execution-context.ts` cites this record | a new route in a governed domain answers 401; each class's admission; D2b refused in both directions (an anonymous flow endpoint naming a `system` flow, and a flow set to `system` while an anonymous endpoint names it), each refusal carrying the prescription | `registered`, one new semantic entry: the publish refusal narrows the accept set, and no conversion can choose a posture for the author | after acceptance |
| **E3** — the stamp's guest branch | D1 | the owner-anchor stamp's guest branch: never the guest, never the system principal, a forged owner refused, the owner unset unless the scenario sets it | a guest insert with nothing in the scenario setting an owner leaves it unset; an owner set by a hook, flow or assignment rule stands; a guest-supplied owner refused at an endpoint and stripped at the form doors; the owner column never holds the guest or the system principal | none: no new key, and nothing moves | after E1, which opens guest inserts at the endpoint doors |
| **E4** — retire `sys_record_share`'s `guest` recipient | D8 | the select option and the contract's union member removed, translations regenerated, following the `spec-property-retirement` playbook where it applies | the value refused with its prescription; a census showing no stored row carries it | expected `not-required (no-migration-prescription)`; `registered` if the census finds a stored metadata surface carrying the value | independent |

## Follow-ups, named, not filed

- **F1 — the webhook signature vocabulary** (an HMAC, a timestamp, a replay window), filed with its
  executor (D7).
- **F2 — the site binding** (D5), built when a named deployment needs it.
- **F3 — ADR-0073 M2**, which adds `runAs: 'automation'` to D2b's prescription when it lands;
  ADR-0073's own trigger, a first real consumer, governs it.

## References

- Card: [#22146](https://github.com/objectstack-ai/objectstack/issues/22146) — the measurement round
  ([`6052668454`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052668454)),
  the decision request and seat verdict
  ([`6052740067`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052740067)),
  the pointers ([`6052731596`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052731596),
  [`6053819337`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6053819337)),
  the ruling ([`6054113537`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6054113537)),
  and its supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963) (D1 A′, D2b R).
- [#22147](https://github.com/objectstack-ai/objectstack/issues/22147): ruling C
  ([`6051299672`](https://github.com/objectstack-ai/objectstack/issues/22147#issuecomment-6051299672)),
  the guest at `authRequired: false` endpoints; ruling A
  ([`6053767508`](https://github.com/objectstack-ai/objectstack/issues/22147#issuecomment-6053767508)),
  the elevated-flow must-answer; PR #22177 (`6ed0c0f3e5`), the pins.
- [#21158](https://github.com/objectstack-ai/objectstack/issues/21158), closed and folded into #22146;
  [#21908](https://github.com/objectstack-ai/objectstack/issues/21908), the principal-less hand-off;
  [#21967](https://github.com/objectstack-ai/objectstack/issues/21967),
  [#21980](https://github.com/objectstack-ai/objectstack/issues/21980) and
  [#21331](https://github.com/objectstack-ai/objectstack/issues/21331), the form doors' intake rules;
  [#13419](https://github.com/objectstack-ai/objectstack/issues/13419), the position-name fold.
- The 2026-08-08 Option A ruling: commit `f586f1a89` (#7259).
