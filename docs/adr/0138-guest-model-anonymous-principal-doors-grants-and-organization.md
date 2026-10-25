# ADR-0138: The guest model — one anonymous principal, a closed list of doors, one grants channel, one organization rule, and a fate for every declared guest key

**Status**: Accepted (2026-10-13), accepted by the maintainer's approval of the pull request that
lands this text with criterion 4's two back-pointers (`docs/adr/**` is Tier H, Prime Directive #14);
with it, all four [Acceptance criteria](#acceptance-criteria) hold. Proposed 2026-10-08; revised
2026-10-09 under the G2 ruling. The eight answers are ruled; this record transcribes them into
contracts, each with its enforcement point. The one letter the first ruling left open,
[D2b](#d2b--the-anonymous-door--elevated-flow-combination-a-publish-refusal), is ruled R by the
supplement, and D1 is revised to A′ by the same supplement. The G2 sweep was measured on
2026-10-09: classes 1 to 5 matched D2, and the everything-else class did not. The G2 ruling added a
sixth class to D2, the `acl: 'public_read'` file download, and held acceptance until the
everything-else class was closed and re-measured. Four defect cards closed it, and under the
criterion-2 ruling the re-measurement is a test in the repository, green on `main`
([criterion 2](#acceptance-criteria)). The execution cards are cut from the accepted record
([Execution plan](#execution-plan-after-acceptance)), and every change this record decides lands
through them. The four defect cards landed before it: they enforce ADR-0056 D2 and ADR-0104, which
were already Accepted.
· **Amended** (2026-10-13, ruling C on [#23266](https://github.com/objectstack-ai/objectstack/issues/23266),
[`6148183570`](https://github.com/objectstack-ai/objectstack/issues/23266#issuecomment-6148183570),
maintainer 「同意」) — D3 item 6: the guest reaches rows only through share links (and, when it
exists, an explicit guest sharing rule), never through the object's sharing model; ADR-0090 D9 and
D11 are unchanged.
· **Amended** (2026-10-14, ruling C on [#23267](https://github.com/objectstack-ai/objectstack/issues/23267),
[`6159279205`](https://github.com/objectstack-ai/objectstack/issues/23267#issuecomment-6159279205),
maintainer 「23267 我们的系统 和 salesforce 类似，暂时没有 没有公开站点或门户的产品计划」) — D3 item 5: the
guest's bind door is built implementation-first, when a named deployment needs to grant the guest on
a public surface; until then no door binds a set to `guest`, and the record carries the door's shape.
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
default owner, and rules D2b R, a publish refusal with a prescription. The G2 ruling
[`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686)
(2026-10-09, decision batch #300 item 1, letter A, maintainer 「同意」) answers the measured sweep:
D2 gains class 6, and the everything-else class is closed and re-measured before acceptance. The
criterion-2 ruling
[`6134095444`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6134095444)
(2026-10-12, decision batch #331, letter A, maintainer 「同意」) makes that re-measurement a test in
the repository, run on `main` with the dogfood battery. D9 records the maintainer's ruling of
2026-08-08 (Option A, landed as commit `f586f1a89`).
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
[ADR-0046](./0046-package-docs-as-metadata.md) §6.7 (the public book audience gate),
[ADR-0104](./0104-field-runtime-value-shape-contract.md) D3 wave 2 (the anonymous capability URL
demoted to the opt-in `acl: 'public_read'`, D2's class 6).
**Amends**, from acceptance: ADR-0090 D9 (the `guest` anchor's bindings become enforced — D3 and D4
here) and ADR-0056 D2 (its explicit exposures become a closed list — D2 here). **Leaves unchanged**:
ADR-0104 (D2 names its `public_read` door as class 6 and changes nothing in it), ADR-0106 D7,
ADR-0121 D6, ADR-0096 D5 and E1, ADR-0135. The back-pointer lines are written out under
[Acceptance criteria](#acceptance-criteria) and landed with the accepting change.
**Consumers**: `@objectstack/core` (`security/`), `@objectstack/plugin-security`,
`@objectstack/runtime`, `@objectstack/rest`, `@objectstack/metadata-core` (the form doors' rule),
`@objectstack/plugin-sharing` (D8), `@objectstack/service-automation` (D2b),
`@objectstack/service-storage` (D2's class 6), and `@objectstack/spec` for the contract changes the
cards carry after acceptance (D2b's publish refusal, D8's retirement).
**Card**: [#22146](https://github.com/objectstack-ai/objectstack/issues/22146) (rounds 1 to 3:
measurement, decision, the draft; then the G2 sweep and the D2 revision under its ruling; then the
in-repo sweep and this acceptance under the criterion-2 ruling). ⛔ Classes,
positions and functions only: door-level readings that would work as an exploit recipe stay
private, as [#21158](https://github.com/objectstack-ai/objectstack/issues/21158)'s did.

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
| [D2](#d2--the-closed-list-of-doors) | the doors | A, plus a must-answer; class 6 added by the G2 ruling | six door classes; everything else answers 401, decided per domain | `shouldDenyAnonymous` at each domain's entry; the conformance matrix (card E2) |
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

The G2 ruling [`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686)
(maintainer 「同意」) answered the measured sweep: classes 1 to 5 match D2, and the everything-else
class does not. D2 gains a sixth class, the `acl: 'public_read'` file download that ADR-0104 already
rules, and acceptance waited until the everything-else class was closed and re-measured. Four
defect cards closed it, and the criterion-2 ruling
[`6134095444`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6134095444)
made the re-measurement a test in the repository, which answers as D2 states, class by class, on
`main` ([criterion 2](#acceptance-criteria)). The first ruling's summary above still says five door
classes, because it is quoted as it was ruled.

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
  (`packages/spec/src/security/high-privilege.ts#describeAnchorForbiddenBits`; at `7b926f7600` an
  engine write gate on `sys_position_permission_set` called it, and that table was retired by #15204
  stage 8 and the gate deleted by #23403, so on `main` its `guest` tier has no caller until item 5's
  bind door),
  and delegated administration (`packages/plugins/plugin-security/src/delegated-admin-gate.ts#ANCHOR_POSITIONS`).
- **Two guest values are declared with nothing behind them.** A package may suggest a `guest`
  binding (`packages/plugins/plugin-security/src/objects/sys-audience-binding-suggestion.object.ts#anchor`),
  and confirming it binds a set that grants nothing; and `sys_record_share` offers a `guest`
  recipient (`packages/plugins/plugin-sharing/src/objects/sys-record-share.object.ts#recipient_type`,
  `packages/spec/src/contracts/sharing-service.ts#RecordShareRecipientType`) that the grant refuses.
- **G2 — the booted sweep was not run.** The round's booted per-door-class anonymous sweep stopped
  at the environment's safety check, and nothing was worked around. The static door-class reading
  shows every class answering a denial or a narrow door. The maintainer ruled G2: that reading
  suffices to rule, and the booted sweep is an acceptance precondition of this record. The sweep
  was run on 2026-10-09, and its re-measurement is the in-repo sweep; both class-level results are
  recorded under [criterion 2](#acceptance-criteria).

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
A contract this record states but no code enforces yet becomes binding with its card, and not one
declared thing here goes without an enforcer (ADR-0049).

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

*Ruled: Q2 A, plus the must-answer that D2b states. Class 6 added by the G2 ruling
[`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686).*

An unauthenticated request is served by exactly these six door classes. Each derives its own
narrow authorization from a declaration; none derives it from a deployment posture.

| # | Door class | What admits the request | What it runs as | Enforced by |
|:--|:--|:--|:--|:--|
| 1 | the public form doors (resolve and submit) | the form's `sharing` declaration: enabled, anonymous, a public link naming the slug | the form grant: insert and read-back on that one object, nothing else | `packages/rest/src/rest-server.ts#RestServer.registerFormEndpoints`; the `publicFormGrant` branch of `packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin` |
| 2 | share links | the capability token | after validation, a read of that one record | `packages/plugins/plugin-sharing/src/share-link-routes.ts#registerShareLinkRoutes` |
| 3 | the public book and doc metadata reads | `book.audience: 'public'` | reachability only; the ADR-0046 §6.7 gate authorizes the read | `packages/rest/src/meta-item-read-gate.ts#isPublicAudienceRead` |
| 4 | `authRequired: false` endpoints of `type: 'object_operation'` | the endpoint declaration, with the armed rate limit ADR-0121 D6 requires | the guest envelope (D9), under the guest's grants (D3) | `packages/runtime/src/security/resolve-execution-context.ts#resolveExecutionContext`; the CRUD gate |
| 5 | `authRequired: false` endpoints of `type: 'flow'` | the same | the guest envelope at the door; inside, the flow's own declared `runAs`, which publish never lets be `system` behind this door (D2b) | the same, then `@objectstack/service-automation` |
| 6 | the `acl: 'public_read'` file download (ADR-0104 D3 wave 2) | the file's own `acl: 'public_read'` (`packages/services/service-storage/src/objects/system-file.object.ts#acl`), an explicit opt-in: the upload routes create a file `private` | a read of that one file's bytes, nothing else; no principal is evaluated | `packages/services/service-storage/src/storage-routes.ts#registerStorageRoutes`, at the download gate `#authorizeDownload` that both download routes call |

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
- MCP, which admits an OAuth token or an API key and never an anonymous caller;
- the token-addressed and raw-app surfaces the criterion-2 ruling ordered classified explicitly,
  and the two more the in-repo sweep's population held, each named with its reason under
  [criterion 2](#acceptance-criteria).

**The adoption rule of D9, closed.** D9's ruling lets a surface adopt the guest entry only when its
product semantics serve anonymous principals. D2 turns that sentence into a list: classes 4 and 5
take the guest envelope; classes 1 to 3 and 6 take their own declaration; nothing else serves a
guest.

**Enforced by**: `shouldDenyAnonymous` at each domain's entry, today; and the authorization
conformance matrix (`packages/qa/dogfood/test/authz-conformance.matrix.ts#AUTHZ_CONFORMANCE`), whose
rows already fail on a deleted deny call or an unclassified route. Card E2 records the six classes
there. ⛔ No new gate script. **Card**: E2.

**Measured on 2026-10-09, not held then; held on `main` now (G2).** The booted sweep found three families outside this
list that served an anonymous caller instead of answering 401: the `/i18n` dispatcher domain, the
API-description endpoints, and storage download of a file with no scope and no field owner. Each had
its own defect card, and acceptance waited on all three ([criterion 2](#acceptance-criteria)). The
in-repo sweep found a fourth before it landed, the settings REST family. All four are closed, and the
everything-else class answers 401 throughout on `main`. The same 2026-10-09 sweep found
`acl: 'public_read'` files served anonymously; that is ADR-0104's ruled opt-in, listed above as
class 6.

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
   modify-all, no system permissions (ADR-0090 D9; `describeAnchorForbiddenBits`). The predicate
   runs where a binding is made: for `everyone`, when a suggestion is confirmed
   (`confirmAudienceBindingSuggestion`) and on every derivation of the anchor
   (`readAcceptedEveryoneSets`); for `guest`, no door binds a set today (item 5), and the bind door
   runs it when built. The engine gate that once applied it to `sys_position_permission_set` rows
   retired with that table (#15204 stage 8; the gate was deleted by #23403). A delegated administrator never binds an anchor
   (ADR-0090 D12; `ANCHOR_POSITIONS`). Unchanged.
5. **How a deployment grants: implementation-first.** The bind door is built when a named
   deployment needs to grant the guest on a public surface (a site or portal) and the class-1 form
   doors cannot serve it. Until then E1's reader stays at the declared empty state (item 2),
   because no door binds a set to `guest`: a save of the packaged `guest` position answers 403
   `NOT_OVERRIDABLE`, the package door refuses a built-in position name, and
   `packages/plugins/plugin-security/src/suggested-audience-bindings.ts#confirmAudienceBindingSuggestion`
   refuses a `guest` row, which the suggestion sync never produces.
   **The door's shape.** An act of the environment's administrator, never of a package (ADR-0090
   D9), writes one confirmed `sys_audience_binding_suggestion` row for anchor `guest` (D8's `guest`
   value, live with this door), `package_id` optional, scoped to the public surface that publishes
   the door: the binding carries the app or site it serves, and the anchor stays one identity. The
   security plugin re-derives the `guest` definition from the accepted rows, as it does
   `everyone`'s, and on every write and every derivation runs
   `describeAnchorForbiddenBits(set, 'guest')` and refuses the bypass list's objects (those record
   sharing never scopes, declared once in `@objectstack/spec/security`; today plugin-sharing's
   `SharingService` holds the list). No caller writes an anchor's definition
   ([#22801](https://github.com/objectstack-ai/objectstack/issues/22801) ruling A,
   [`6108478638`](https://github.com/objectstack-ai/objectstack/issues/22801#issuecomment-6108478638)),
   so ⛔ opening that door (`PUT /meta/position/guest`) is refused: it reverses the seal and misses
   environment kernels. The row half stays item 6: share links and, when built, an explicit guest
   sharing rule (read-only, criteria-based, the strictest lint tier), the only shape in which D8's
   retired `guest` recipient returns. **Re-read when the door is built:** item 4's guest tier, which
   no door runs today (the engine gate that carried it guarded `sys_position_permission_set` rows,
   retired by #15204 stage 8, and was deleted by #23403), and objectui's pin that a guest row offers no Accept
   (`objectui:packages/app-shell/src/components/SuggestedBindingsPanel.tsx`). Amended by ruling C
   on [#23267](https://github.com/objectstack-ai/objectstack/issues/23267)
   ([`6159279205`](https://github.com/objectstack-ai/objectstack/issues/23267#issuecomment-6159279205)).
6. **Row scope: one pipeline.** The guest's grant is evaluated by the same row-level pipeline as
   every caller, except that the guest never takes the pipeline's sharing-model (OWD) branch:
   neither `sharingModel` nor `externalSharingModel`. The guest owns nothing (D1), so it reaches
   rows only through share links (and, when it exists, an explicit guest sharing rule), never
   through the object's sharing model — ADR-0090 D9's division of labour (the guest position
   answers which object classes are reachable at all, share links answer which records), and D11's
   statement that the guest is not an OWD audience. Card E1 pins the guest's row scope for each
   sharing model before it lands: with a bound read set and no share link, `private`,
   `public_read`, `public_read_write` and `controlled_by_parent` each read zero rows. This scope is
   the maintainer's ruling C on [#23266](https://github.com/objectstack-ai/objectstack/issues/23266)
   ([`6148183570`](https://github.com/objectstack-ai/objectstack/issues/23266#issuecomment-6148183570)),
   which answered the finding E1 raised under this item; the explicit guest sharing rule is named
   by that ruling and not built.
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

If this is built later, the binding is opened by the organization administrator inside their own
organization, never declared by the package (ruling A `6386464761`: 「若将来建，绑定由组织管理员开，不由包声明」).

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

Every declared thing in this record, and what enforces it. A row reading "card" becomes binding when
that card lands; no row is declared without an enforcer.

| Declared | Where | Enforced by | Status |
|:--|:--|:--|:--|
| anonymous default-deny | ADR-0056 D2; D2 | `shouldDenyAnonymous`, at each domain's entry | enforced; the four families the sweeps found were closed before acceptance (criterion 2) |
| the guest envelope | D9 | `assembleExecutionContextOrGuest` (through `entryFields`) | enforced |
| the fail-closed default entry | D9 | `assembleExecutionContext` | enforced |
| the six door classes | D2 | the enforcer named in each row of D2's table | enforced per door |
| the list itself | D2 | the conformance matrix, `AUTHZ_CONFORMANCE` | card E2 records it |
| no `system` flow behind an anonymous flow door | D2b | the publish path, in both directions | card E2 |
| the guest's grants, and deny-all when none | D3 | the anonymous branch of `resolveAuthzContext` | card E1 |
| no door binds a set to `guest` until the bind door is built | D3 item 5 (amended) | the anchors' seal (`NOT_OVERRIDABLE`; the package door's built-in names) and `confirmAudienceBindingSuggestion`'s refusal of a `guest` row | enforced; the door is follow-up F4 |
| the anchor binding tier | ADR-0090 D9; D3 | `describeAnchorForbiddenBits`: for `everyone` through `confirmAudienceBindingSuggestion` and `readAcceptedEveryoneSets`; for `guest`, through the bind door when it is built (no door binds a set to `guest`, the row above) | enforced for `everyone`; `guest`: follow-up F4 |
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
- **Bindings confirmed while inert start granting (D3).** A set bound to `guest` before E1 granted
  nothing. On the release that lands E1 it grants what it says,
  to anonymous callers at the guest-entry doors. Every such binding passed the strictest anchor tier,
  and the administrator who confirmed it believed it granted, so D3 honours a declaration rather than
  widening one. The change is still visible: E1's changeset names it, and its count on the reference
  apps found none. None can arise before D3 item 5's door is built: until then no door binds a set
  to `guest`.
- **A multi-organization deployment's anonymous endpoints answer a located refusal** where they need
  an organization, until D5 is built. Today those requests are refused at the CRUD gate with nothing
  granted, so no request that is served today stops being served.
- **The guest is one principal on one pipeline.** The row-level evaluator carries one guest special
  case: the guest never takes its sharing-model (OWD) branch, so it reaches rows only through share
  links (and, when it exists, an explicit guest sharing rule; D3 item 6). No guest special case
  enters the CRUD gate or the masker; what differs for the guest there is what it holds (D3) and
  where it acts (D4), both resolved before any gate runs.
- **Class 6 changes nothing that serves today.** `authorizeDownload` already honours ADR-0104's
  opt-in. Listing it in D2 makes the re-measurement read a `public_read` download as a door and
  not as a gap, and [#22431](https://github.com/objectstack-ai/objectstack/issues/22431), the defect
  card for files with no scope and no field owner, keeps that door anonymous.
- **Measured since the draft:** the booted per-class sweep (G2, 2026-10-09), not met then, and its
  re-measurement, the in-repo sweep, met on `main` ([criterion 2](#acceptance-criteria)).
  **Not measured, and named:** the guest's row scope for each sharing model (E1's pins), and the
  anonymous surfaces of the cloud repository, which no round has read.

## What the ruling did not settle

Stated so that approving this record approves these readings knowingly.

1. **The spelling of D5's binding** belongs to the card that builds it. This record fixes its shape
   and reserves no key.
2. **The indirect path** (record-change flows fired by a guest-written row) lies outside D2b's
   refusal, as stated there: recorded, not decided.
3. **The guest's row scope** is no longer open: ruling C on
   [#23266](https://github.com/objectstack-ai/objectstack/issues/23266)
   ([`6148183570`](https://github.com/objectstack-ai/objectstack/issues/23266#issuecomment-6148183570))
   settled it as share links only, never the object's sharing model (D3 item 6), and E1 pins it: with
   a bound read set and no share link, `private`, `public_read`, `public_read_write` and
   `controlled_by_parent` each read zero rows.

## Alternatives considered

The letters the rulings did not take, from the decision requests
([`6052740067`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052740067),
and for the G2 result [`6074404262`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074404262)):

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
- **G2 result B — accept now, and close the three families under E2** (not taken by the G2 ruling
  [`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686)).
  In the ruling's words, *"an Accepted record with a known, measured gap empties the word, and sets
  the precedent for the next record"*.
- **G2 result C — as A, without public cards** (not taken by the same ruling). In the ruling's words,
  *"the code is open source and the three families read from it, so function-level cards add little
  exposure and keep the fixes in the ordinary queue"*.

## Acceptance criteria

This record moved from Proposed to Accepted when all four held. All four hold:

1. **The maintainer approves this record** (`docs/adr/**` is a Tier H surface, Prime Directive #14)
   — met by the approval of the pull request that lands this text.
2. **G2 — the booted per-door-class anonymous sweep, evidenced by a test in the repository — met.**
   For each of D2's six classes, and for the everything-else class, a booted reference deployment's
   anonymous answer (its status class, and what is served) matches D2's table. The manual
   re-measurement was refused by the safety check of two environments
   ([`6092511536`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6092511536),
   [`6110151111`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6110151111)),
   and the criterion-2 ruling
   [`6134095444`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6134095444)
   made the evidence a test in the repository instead of a one-off sweep: the anonymous sweep of the
   dogfood authorization-conformance family,
   `packages/qa/dogfood/test/anonymous-door-sweep.dogfood.test.ts`, judged by its closed
   classification `packages/qa/dogfood/test/anonymous-door-sweep.classification.ts#classify`. It
   runs on `main` with the dogfood battery (`Dogfood Regression Gate`). It boots the showcase, reads
   the registered route table off the running server, sends one unauthenticated request per route,
   and asserts the class-level outcome D2 states for each of the six classes and 401 for everything
   else; each class is also asserted on a real subject, admitted and refused. The readings stay
   private, as #21158's did: the suite asserts and prints class-level results only, and this record
   names the suite and its classification, never a route-level reading.
   - **The classification the suite holds.** Every row carries its reason in the classification
     file, and a row that claims no route on the boot is red as stale.
     - **D2's six door classes**, as D2's table names them. Class 3 has no route of its own: it
       rides the shared metadata read routes, which answer 401 for every subject the audience gate
       does not admit. Classes 4 and 5 are the declared `authRequired: false` endpoints, which no
       route table lists, so the suite reads them from the metadata service.
     - **Outside the guest model by construction: D2's own three.** The control-plane allowlist, by
       its own predicate `isAuthGateAllowlisted`, never a copy of its paths. The ADR-0041 signed
       inbound hook, held to 401 without a signature, as D2 states. MCP
       (`packages/runtime/src/domains/mcp.ts#handleMcpRequest`), held to 401, as D2 states.
     - **Outside the guest model by construction: the five the criterion-2 ruling ordered
       classified explicitly.**
       - The approvals plugin's token-addressed action pages, ADR-0043
         (`packages/plugins/plugin-approvals/src/approval-service.ts#ApprovalService.peekActionToken`,
         `#ApprovalService.redeemActionToken`): the single-use action token is the whole credential,
         and a decision binds the approver that token names, never a guest.
       - The OAuth and OpenID well-known documents, RFC 8414 and RFC 9728
         (`packages/plugins/plugin-auth/src/auth-plugin.ts#AuthPlugin.registerOidcDiscoveryRoutes`):
         public by standard, read by an OAuth or MCP client before it holds any token, and carrying
         no business data.
       - The runtime-config bootstrap reads
         (`packages/cloud-connection/src/runtime-config-plugin.ts#RuntimeConfigPlugin`): the
         console's pre-sign-in branding and runtime posture, and no tenant data.
       - The MCP skill read (`packages/runtime/src/domains/mcp.ts#handleMcpSkillRequest`, serving
         `packages/mcp/src/skill-md.ts#renderSkillMarkdown`, ADR-0036 Amendment C): generic
         instructions and the environment's MCP URL, never a tenant's schema or data.
       - The dev-only metadata HMR stream
         (`packages/metadata/src/routes/hmr-routes.ts#registerMetadataHmrRoutes`): a build-tool door
         mounted only under an explicit development posture (`#isDevMetadataEndpointEnabled`), never
         on a production deployment.
     - **Outside the guest model by construction: two more the suite's population held**, which the
       round-5 list did not name.
       - The discovery documents, at the two spellings `isAuthGateAllowlisted` does not name
         literally: the REST root (`packages/rest/src/rest-server.ts#RestServer.registerDiscoveryEndpoints`)
         and the dispatcher's well-known document
         (`packages/runtime/src/dispatcher-plugin.ts#createDispatcherPlugin`). They play the
         allowlist's discovery role.
       - The local storage adapter's signed byte URLs
         (`packages/services/service-storage/src/local-storage-adapter.ts#LocalStorageAdapter.verifyToken`):
         the signed, expiring token an authorized upload or download mints is the credential, the
         role a cloud store's presigned URL plays, and no principal is evaluated.
     - **Middleware:** the server-wide registration that wraps every route (request context, CORS,
       error shaping). It answers no request of its own and is not swept.
     - **Everything else, with no tolerance list.** A route nothing above claims must answer 401
       with an error envelope and nothing served, so a new anonymous door nobody classified turns
       the suite red. A route moves into a door class or an outside family only by an amendment of
       this record, and the classification follows that amendment.
   - **One status, two codes.** The everything-else 401s carry two codes: `UNAUTHENTICATED`, the
     one D2 names, and `AUTH_REQUIRED` on the storage family's refusals, a code the ADR-0112 ledger
     registers for `@objectstack/service-storage`. D2 decides the status. The suite asserts the
     status, the error envelope and that nothing is served, and pins no code.
   - **Measured on 2026-10-09, not met.** One reference deployment, the showcase, was booted from
     `origin/main` `abd254508b` (the report
     [`6074331185`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074331185),
     reviewed in [`6074404262`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074404262)):
     - **Classes 1 to 5 match D2's table.** Class 4 is denied with no grant bound: D3's empty
       state, reached today as a side effect of E1 being unbuilt. Class 5 matches in admission and
       narrowness; D2b's refusal is not built yet (E2, the record's own interim).
     - **The `acl: 'public_read'` file download** was served anonymously, as ADR-0104 rules, while
       D2 did not yet name it. The G2 ruling adds it as class 6.
     - **The everything-else class does not match.** Three families outside the list served an
       anonymous caller instead of answering 401:
       - the `/i18n` dispatcher domain: `packages/runtime/src/domains/i18n.ts#handleI18nRequest`
         makes no `shouldDenyAnonymous` call, unlike every other dispatcher domain (ADR-0056 D2);
       - the API-description endpoints, `packages/rest/src/rest-server.ts#RestServer.registerOpenApiEndpoints`;
       - storage download of a file with no scope and no field owner, through the download routes of
         `packages/services/service-storage/src/storage-routes.ts#registerStorageRoutes`.
   - **What remained, by the G2 ruling
     [`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686).**
     Three defect cards, public and at function level:
     [#22432](https://github.com/objectstack-ai/objectstack/issues/22432) (the `/i18n` dispatcher
     domain, with an objectui companion for the Console's sign-in page),
     [#22430](https://github.com/objectstack-ai/objectstack/issues/22430) (the API-description
     endpoints) and [#22431](https://github.com/objectstack-ai/objectstack/issues/22431) (storage
     download of a file with no scope and no field owner; an `acl: 'public_read'` file stays
     anonymous). Then, verbatim: *"When the three cards have landed, the everything-else class is
     re-measured on a booted reference deployment; when it answers 401 throughout, the acceptance PR
     opens, with acceptance criterion 4's two back-references. ADR-0138 stays Proposed until then."*
   - **Met on `main`, 2026-10-13.** The three cards are closed: #22431 and #22430 on 2026-10-09,
     #22432 on 2026-10-10. The in-repo sweep found a fourth family before it landed, the settings
     REST family (`packages/services/service-settings/src/settings-routes.ts#registerSettingsRoutes`),
     closed by [#23142](https://github.com/objectstack-ai/objectstack/issues/23142) on 2026-10-13. The
     suite landed as `8323cad97` (PR #23137). On `main` CI run
     [38363741526](https://github.com/objectstack-ai/objectstack/actions/runs/38363741526), head
     `8323cad97`, `Dogfood Regression Gate` concluded `success` on its three shards and its
     aggregate, and again on run
     [38372006085](https://github.com/objectstack-ai/objectstack/actions/runs/38372006085), head
     `150da61aa`:
     - **Classes 1 to 6 match D2's table**, each on a real subject, admitted and refused. Class 4 is
       still denied with no grant bound (D3's empty state, until E1); class 5 admits the guest at
       the door and serves the flow's output only (D2b's refusal is E2's).
     - **Every outside family answers as D2 states**, where D2 states an answer.
     - **The everything-else class answers 401 throughout**, with an error envelope and nothing
       served.
3. **D2b is chosen — met.** The supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963) ruled R, and D2b records it.
4. **The back-pointers land with the accepting change — met.** They landed with it, one status-line
   continuation each, in the form ADR-0042 and ADR-0046 use for a decision amended in part, as the
   two lines below with DATE filled:

   ```text
   ADR-0090 status line:
   · **Amended** (DATE, ADR-0138 D3/D4) — D9's `guest` anchor bindings resolve for anonymous
     requests, in the organization ADR-0138 D4 resolves; an empty set denies all.

   ADR-0056 status line:
   · **Amended** (DATE, ADR-0138 D2) — D2's explicit public exposures are a closed list of six
     door classes; every other surface answers 401, decided per domain.
   ```

   No line is added to ADR-0104, ADR-0106, ADR-0121, ADR-0096 or ADR-0135: this record leaves their
   decisions as they are.

## Execution plan (after acceptance)

The seat cuts these cards from the accepted record. ⛔ None is filed before acceptance, and ⛔ none
changes `packages/spec` before it. The three defect cards the G2 ruling ordered (#22432, #22430,
#22431) and the fourth the in-repo sweep found (#23142; [criterion 2](#acceptance-criteria)) are
not execution cards of this record: they enforce ADR-0056 D2 and ADR-0104, which were already
Accepted, and they landed before acceptance.

| Card | Decisions | What lands | Pins | ADR-0087 disposition | Order |
|:--|:--|:--|:--|:--|:--|
| **E1** — the grants channel | D3, D4 | the guest entry resolves D4's organization, then the `guest` anchor's bindings; the located refusal where D4 refuses | no binding: denied on class 4; a bound read set: that object only; the baseline, `everyone` and the name fold never reach the guest; a multi-organization deployment: the located refusal; the form doors unchanged; the guest's row scope for each sharing model; the bindings that start granting, counted on the reference apps | none: no authorable key, accept set or stored shape moves; the changeset names the bindings that start granting | first |
| **E2** — the closed list and denial by domain, and D2b | D2, D2b, D9's pointer | the six classes recorded in the conformance matrix; any face of a listed domain that still decides per face moved to the domain-level deny; D2b's publish refusal in both directions, with its prescription; the module doc of `assemble-execution-context.ts` cites this record | a new route in a governed domain answers 401; each class's admission; D2b refused in both directions (an anonymous flow endpoint naming a `system` flow, and a flow set to `system` while an anonymous endpoint names it), each refusal carrying the prescription | `registered`, one new semantic entry: the publish refusal narrows the accept set, and no conversion can choose a posture for the author | after acceptance |
| **E3** — the stamp's guest branch | D1 | the owner-anchor stamp's guest branch: never the guest, never the system principal, a forged owner refused, the owner unset unless the scenario sets it | a guest insert with nothing in the scenario setting an owner leaves it unset; an owner set by a hook, flow or assignment rule stands; a guest-supplied owner refused at an endpoint and stripped at the form doors; the owner column never holds the guest or the system principal | none: no new key, and nothing moves | after E1, which opens guest inserts at the endpoint doors |
| **E4** — retire `sys_record_share`'s `guest` recipient | D8 | the select option and the contract's union member removed, translations regenerated, following the `spec-property-retirement` playbook where it applies | the value refused with its prescription; a census showing no stored row carries it | expected `not-required (no-migration-prescription)`; `registered` if the census finds a stored metadata surface carrying the value | independent |

## Follow-ups, named, not filed

- **F1 — the webhook signature vocabulary** (an HMAC, a timestamp, a replay window), filed with its
  executor (D7).
- **F2 — the site binding** (D5), built when a named deployment needs it.
- **F3 — ADR-0073 M2**, which adds `runAs: 'automation'` to D2b's prescription when it lands;
  ADR-0073's own trigger, a first real consumer, governs it.
- **F4 — the guest's bind door** (D3 item 5), built when a named deployment needs to grant the
  guest on a public surface and the class-1 form doors cannot serve it; its shape and the two items
  it re-reads are recorded in D3 item 5.

## References

- Card: [#22146](https://github.com/objectstack-ai/objectstack/issues/22146) — the measurement round
  ([`6052668454`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052668454)),
  the decision request and seat verdict
  ([`6052740067`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052740067)),
  the pointers ([`6052731596`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6052731596),
  [`6053819337`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6053819337)),
  the ruling ([`6054113537`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6054113537)),
  and its supplement [`6056614963`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6056614963) (D1 A′, D2b R);
  the G2 sweep ([`6074331185`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074331185)),
  its review and decision request
  ([`6074404262`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074404262)),
  and the G2 ruling ([`6074960686`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6074960686));
  the refused manual re-measurements
  ([`6092511536`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6092511536),
  [`6110151111`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6110151111)),
  the criterion-2 ruling ([`6134095444`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6134095444)),
  and the in-repo sweep's landing
  ([`6140706427`](https://github.com/objectstack-ai/objectstack/issues/22146#issuecomment-6140706427);
  PR #23137, `8323cad97`).
- The defect cards the G2 ruling ordered:
  [#22432](https://github.com/objectstack-ai/objectstack/issues/22432), the `/i18n` dispatcher domain
  (with an objectui companion); [#22430](https://github.com/objectstack-ai/objectstack/issues/22430),
  the API-description endpoints; [#22431](https://github.com/objectstack-ai/objectstack/issues/22431),
  storage download of a file with no scope and no field owner. The fourth, which the in-repo sweep
  found: [#23142](https://github.com/objectstack-ai/objectstack/issues/23142), the settings REST
  family.
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
