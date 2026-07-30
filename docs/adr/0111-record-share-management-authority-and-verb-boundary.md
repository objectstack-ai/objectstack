# ADR-0111: Record-share management authority and the verb boundary — sharing needs "who may manage a share" and "which verbs a level grants"

**Status**: Accepted (2026-07-30) — **P0 + P1 implemented**. P0 (D1/D2/D4/D5/D6/D7/D9): `canManageShares` + `hasWriteBypass`, verified by the #3902 Mallory reproduction. P1 (D3, the verb boundary): `canDelete` + verb-split `buildWriteFilter` in `plugin-sharing/src/sharing-service.ts`, routed by the middleware and `/security/explain`, verified by the "edit share cannot delete" suite in `plugin-sharing/src/sharing-service.test.ts`. **D8 (share-link rulings) and the DEPTH management extension (D1 D-future) are not yet implemented** — they land as the follow-up PRs this ADR's rollout section names.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — a security property that parses but enforces nothing is worse than absent), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (DEPTH scopes + the `sys_record_share` / `sys_sharing_rule` split), [ADR-0066](./0066-unified-authorization-model.md) (unified capability model; `modifyAllRecords` super-user bit), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata — a persisted share level or recipient type that no gate consults is exactly this), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (D1 secure-default OWD, D4 retired aliases, D10 delegated identity intersection), [ADR-0091](./0091-grant-lifecycle-and-recertification.md) (time-boxed grants — the lifecycle axis this ADR deliberately does not re-open)
**Consumers**: `@objectstack/plugin-sharing` (`sharing-service.ts`, `sharing-rule-service.ts`, `share-link-service.ts`, `sharing-plugin.ts`), `@objectstack/plugin-security` (`ISecurityService` — a write-bypass probe), `@objectstack/rest` (`rest-server.ts` sharing / sharing-rule / share-link routes), `@objectstack/spec` (`contracts/sharing-service.ts`, `security/capabilities.ts`)
**Surfaced by**: [#3902](https://github.com/objectstack-ai/objectstack/issues/3902) (the `/shares` endpoint has no authorization of its own; `edit`-level share also opens delete), found while evaluating [#3865](https://github.com/objectstack-ai/objectstack/issues/3865) / #3901 (retiring the `full` access level). Widened during that evaluation to the `/sharing/rules` surface, the recipient-type and grant-target lattice, and share links.

---

## TL;DR

Record sharing shipped as a **data layer without an authorization layer of its own.** Every share-management route (`/data/:object/:id/shares`, `/sharing/rules`) authenticates the caller and then hands the request to a service that runs **entirely as `SYSTEM_CTX`** — no "may this caller see this record?", no "may this caller manage sharing on it?", no "does this grant even do anything?". The sharing tables are the one place in the platform where access-control data is written with access control switched off.

Two independent defects both reduce to the same missing model — sharing has no concept of **(a) who may manage a share** and **(b) which verbs a share level actually grants**:

1. **The management surface is unauthenticated-in-effect (P0).** Any signed-in user can revoke anyone's share (`revoke(shareId)` deletes by id, checking neither caller nor that the share belongs to the record in the URL), enumerate who-can-see-what on records they don't own, write self-grants, and — most severe — **define and evaluate an org-wide sharing rule** that materialises `sys_record_share` grants across an entire object. Row-level security happens to blunt the read/write payoff in the default CRM config, but that is a second layer coincidentally holding, not a guarantee sharing makes — and revoke/enumerate/rule-define need no such payoff to do damage.

2. **`edit`-level share also grants delete (P1).** `update` and `delete` share one `canEdit` gate, and `canEdit` accepts an `edit` share. So one "edit" grant silently confers delete — the opposite error from the retired `full` level (which promised delete and gave nothing): here we **give more than we say.** Every comparable platform treats edit and delete as distinct verbs.

**Decision — ten rulings across five faces.** Sharing gains a first-class **management-authority** concept (`canManageShares`) and a **`manage_sharing` capability**, both enforced in the *service*, not just at the route. The **verb boundary** is made explicit: a share widens *which rows* a principal reaches, never *which verbs* they may use — delete leaves the share gate entirely. Grants that would enforce nothing are refused at write time rather than persisted as inert rows. The tightenings (D3, D7) are breaking and land directly, fail-closed, with a deny-log + `explain` + changelog migration path rather than a config escape hatch.

---

## Context

### The shape today

Record sharing has three surfaces, all mounted by `@objectstack/plugin-sharing` and all wired through the REST layer:

| Surface | Routes | Service | Caller authorization today |
|---|---|---|---|
| Per-record shares | `GET/POST/DELETE /data/:object/:id/shares[/:shareId]` | `SharingService` | `enforceAuth` only (is-authenticated); service runs `SYSTEM_CTX` |
| Sharing rules | `GET/POST/GET/DELETE/POST /sharing/rules[/:idOrName][/evaluate]` | `SharingRuleService` | `enforceAuth` only; service runs `SYSTEM_CTX` |
| Share links | `POST/GET/DELETE /api/v1/share-links` + public resolve | `ShareLinkService` | Hardened (Finding-2): create checks real visibility, list is self-scoped, revoke is creator-only |

`enforceAuth` (`rest-server.ts`) does exactly one thing: reject anonymous requests (and auth-gated sessions). It makes **no object-level or record-level decision** — by design; it is the anonymous-deny seam shared by every data/meta route. The per-route authorization is supposed to live past it. For the share and sharing-rule surfaces, nothing lives past it: the handler resolves the service and calls `listShares` / `grant` / `revoke` / `defineRule` / `evaluateRule`, each of which reads and writes `sys_record_share` / `sys_sharing_rule` under a hard-coded `SYSTEM_CTX` that bypasses the very enforcement this plugin installs.

`SYSTEM_CTX` is correct *inside* the plugin's own machinery — the rule evaluator, boot backfills, and the read-filter middleware must not deadlock on their own gates. The defect is that the **externally reachable** entry points inherit it too, so an HTTP caller borrows system authority the moment their request crosses into the service.

### Why this is one ADR and not two bug fixes

#3902 filed two issues and named their common root: the sharing layer lacks a model of *who may manage sharing* and *which verbs belong to which level.* Once we started writing that model down, the same gap turned out to have more than two exits:

- The **sharing-rule** surface is the same unauthorized-service pattern as `/shares`, and strictly worse in blast radius — a rule is an object-wide grant generator, not a single row.
- The **recipient-type** field accepts four values (`group` / `position` / `unit_and_subordinates` / `guest`) that **no gate ever consults** — only `recipient_type: 'user'` is enforced. A `group` share persists and enforces nothing: ADR-0078's silently-inert trap, the same one #3865 just cleared for the `full` *level*, reappearing on the *recipient* axis. The vocabulary is also inconsistent across three files (contract says `role`, the object says `position`, rules say `team`/`business_unit`/`queue`).
- **`grant()` never checks the object's `sharingModel`.** A share written against a `public_read_write` object, a bypass object, or an object with no `owner_id` is a row no gate will ever read — the *inverse* of #3865 (there we said "delete" and gave nothing; here an admin clicks "share" and nothing is shared).
- The manual-grant **upsert key** ignores `source`, so a manual grant silently overwrites a rule-materialised row, and the next reconciliation pass fights it.
- **Share links** already resolved their Finding-2 hardening, but leave two policy decisions implicit: mint-authority equals mere visibility (any viewer of a `publicSharing` object can mint an external capability token — viewers hold re-share power by default), and a record's owner/admin **cannot** revoke a link someone else minted on their record.

All of these are "sharing has no authority/verb model." They belong in one decision record.

### What comparable platforms do

The design is not novel; three mature platforms converge, and the divergences are the exact points we must decide.

**Who may manage a share:**

| Platform | Who can grant / revoke a manual share |
|---|---|
| Salesforce | Record owner, roles **above** the owner in the hierarchy, "Modify All" on the object, and holders of the **"Manage Sharing"** user permission. Manual shares are removed automatically on owner change. |
| Dataverse | Anyone with the **`Share` privilege** on the table (the privilege itself carries a depth: User / BU / parent-child BU / Org). A principal may share **only access levels it itself holds** — you cannot grant Write if you only have Read. |
| Odoo | No end-user manual sharing at all; record rules are admin-configured metadata. |

**Which verbs a share level grants** — unanimous that edit ≠ delete:

| Platform | Delete vs edit in sharing |
|---|---|
| Salesforce | Read-Only / Read-Write sharing **cannot** delete. Delete is owner / hierarchy / Modify All only. |
| Dataverse | `Delete` is an independent privilege, a separate bit in the access mask, distinct from `Write`. |
| Odoo | Record rules split `write` and `unlink` into two independent booleans. |

Two takeaways shape the decision:

1. **Delete belongs to ownership + depth + super-user, never to a share level.** This is the same conclusion `access-level.ts` already reached in prose for the retired `full` — "record sharing widens which rows a principal reaches, never which verbs." D3 turns that comment into enforced behaviour.
2. **The mature model for a per-verb grant is a capability mask AND-ed with object CRUD (Dataverse), not another share level.** If ObjectStack ever wants a per-record delete grant, it is a mask, not a fourth `access_level`. We reserve that direction and build none of it here.

---

## Decision

### D1 — Sharing gains a first-class management-authority predicate

Introduce `canManageShares(object, recordId, context): Promise<boolean>` on `ISharingService`. It answers *"may this caller add or remove shares on this record?"* and is the single gate every management operation consults. Baseline (MVP) authority:

- `context.isSystem` → **true** (the plugin's own machinery is unaffected).
- Caller is the record **owner** (`owner_id === context.userId`) → **true**.
- Caller holds **`modifyAllRecords`** on the object → **true**. Resolved by a late-bound probe on `ISecurityService` (see D2), mirroring how `SharingService` already late-binds the enterprise `hierarchy-scope-resolver`. When plugin-security is absent, the probe returns false and authority **fails closed to owner-only** — a degraded security stack never widens sharing authority.
- Otherwise → **false**.

**Explicitly not** `getEffectiveScope(...) === 'org'`: that helper returns `'org'` for the "no permission set even mentions this object" case (a compatibility fail-*open* baked into the read path). Reusing it as a management gate would be a fresh hole. Management authority keys off the **explicit** `modifyAllRecords` bit only.

**DEPTH is a named direction, not in the MVP.** Salesforce (roles above the owner) and Dataverse (the `Share` privilege's BU depth) both let hierarchy managers share subordinates' records. ObjectStack's `__writeScope` (`unit` / `unit_and_below` / `own_and_reports`) is computed today only inside the engine middleware, not on the REST management path; plumbing it here is real work behind the enterprise `hierarchy-scope-resolver`. The MVP is owner + `modifyAllRecords`; D-future records the DEPTH extension so the model has a place for it.

**Grant may never exceed the granter's own level** (Dataverse's rule). A caller who may manage sharing but is not owner/super-user may only grant a level they themselves hold on the record. In the MVP this is trivially satisfied (only owner/super-user pass the gate, and both hold every level), but the constraint is stated now so the DEPTH extension inherits it rather than bolting it on later.

### D2 — Management authority is enforced in the SERVICE, and the security probe is a contract

The gate lives in `SharingService`, not in the REST handler. This repo's own idiom, stated at the `/security/explain` route: *"Caller authorization lives in the SERVICE, not here."* A route-only check protects exactly the routes that remembered to write it; a service check protects every present and future caller (REST, GraphQL, internal callers that pass a non-system context, a future MCP tool).

`canManageShares` needs a super-user probe it does not own. Add to `ISecurityService` a narrow method — `hasWriteBypass(object, context): Promise<boolean>` — that resolves the caller's permission sets and answers the `modifyAllRecords` question using the evaluator's existing `hasSuperuserWriteBypass`. It fails closed (a resolution error → false), same posture as `getReadFilter`. plugin-sharing consumes it via the same late-bound `getService('security')` lookup it uses for the hierarchy resolver.

### D3 — The verb boundary: a share widens rows, never verbs; `edit` does not grant delete

Split the write gate by verb. `canEdit` stops being the delete gate.

- `update` → gated by `canEdit` as today (ownership/depth **or** a write-level share).
- `delete` → gated by ownership + write-DEPTH + `modifyAllRecords` **only**. A share `access_level` — `edit` or the tolerated legacy `full` — **does not** open delete.

Concretely: `canEdit` grows a sibling `canDelete(object, recordId, context)` (or `canEdit` takes a `verb: 'update' | 'delete'`), and the bulk path splits symmetrically — `buildWriteFilter` gains a verb parameter so a `delete({multi:true})` scopes to the owner/depth set **without** OR-ing in shared record ids, while `update({multi:true})` keeps today's behaviour. The sharing middleware in `sharing-plugin.ts` routes `op === 'delete'` to the delete gate.

**No new `delete` access level.** Consistent with `access-level.ts`'s stated principle and with #3865's direction (we are *removing* a verb-promising level, not adding one). A future per-record delete grant, if ever needed, is a capability mask AND-ed with object CRUD (the Dataverse shape), authored deliberately under its own ADR — not a fourth enum member.

### D4 — Revoke is symmetric with grant, and validates share ownership

`revoke` currently deletes by `shareId` alone, ignoring both the caller and the `(object, recordId)` in the URL. It gains three checks:

1. **Load the share first.** If it does not exist, or its `object_name` / `record_id` do not match the path, → **404** (do not confirm the existence of a share on a record the caller may not be able to see).
2. **`canManageShares(object, recordId, context)`** must pass — the *same* gate as grant. No separate "granter" exception: Salesforce and Dataverse both make revoke authority symmetric with grant authority, and a "granter may always revoke" carve-out is semantically odd precisely when it matters (the granter has since lost management authority). Symmetry is simpler, auditable, and matches both references.
3. **`source !== 'manual'` → refuse (409).** Rule/team/inherited rows are materialised by the evaluator; a manual revoke of one is undone on the next reconciliation pass — the UI would report "revoked" while access silently returns. Only `manual` shares are manually revocable; a rule-derived grant is removed by editing/deactivating the rule.

### D5 — Listing is management-gated; "shares that concern me" is a separate, self-scoped surface

`GET /data/:object/:id/shares` requires `canManageShares` (record not visible → 404; visible but not manageable → 403). This matches Salesforce, whose Sharing Detail page is owner/hierarchy/admin-only — an ordinary user who can *see* a record cannot enumerate *who else* can. Leaking the recipient list is both an information disclosure and the exact enumeration that hands an attacker the `shareId` D4 now protects.

The legitimate "what has been shared **with me** / **by me**" need is served **not** by this endpoint but by `/data/sys_record_share` with a **self-scope filter**. `sys_record_share` is on the sharing bypass list (the enforcement middleware skips it to avoid recursion), so today its `enable.apiMethods: ['get','list']` exposes **every** share row to any caller. We narrow it: the middleware special-cases `sys_record_share` for non-system callers to AND `{ $or: [{ recipient_id: me }, { granted_by: me }] }` into every read. The Setup admin list views (already gated behind `manage_platform_settings` navigation) run under an admin context and are unaffected; a plain user sees only rows that name them.

### D6 — The sharing-rule surface requires `manage_sharing`, enforced in the service

`/sharing/rules` (list, create, get, delete, evaluate) is tenant-wide sharing administration, not a per-record operation — a rule generates grants across an entire object. It requires the **`manage_sharing` capability** (D9), checked in `SharingRuleService` (not just the route, per D2). `evaluateRule` is included: triggering a materialisation pass is a privileged action, not a read. This closes the most severe exit — self-service object-wide elevation via a self-authored rule.

The Studio authoring path (`/data/sys_sharing_rule`, `managedBy: 'config'`) is already governed by object-level CRUD and its `manage_platform_settings` navigation gate; D6 brings the **programmatic REST** surface up to the same posture.

### D7 — No inert grants: recipient type, target model, and source coexistence

Three write-time refusals so a persisted share always means something:

1. **`recipientType` is narrowed to `user`** at the grant boundary; anything else → **400**. The `group` / `position` / `unit_and_subordinates` / `guest` values are not enforced by any gate today — persisting them is the ADR-0078 inert-metadata trap. The vocabulary is consolidated to one list in the contract; non-`user` principals become a documented *future direction* (delivered via rule materialisation, which already expands `team` / `business_unit` into per-user rows), not an accepted-but-ignored input on the manual surface.
2. **`grant()` validates the object is in an enforcing posture** — `effectiveSharingModel` is `private` or `read` **and** the object has an `owner_id` field. Otherwise → **422** (`SHARING_NOT_ENABLED`): a share on a public / bypass / owner-less object enforces nothing. `controlled_by_parent` is refused explicitly (Salesforce parity — a detail record is not independently shareable; its access follows the master).
3. **Manual and rule shares coexist by `source`.** The upsert key becomes `(object, record, recipient, source)` so a manual grant no longer clobbers a `source: 'rule'` row and vice versa. When multiple rows grant the same recipient, the widest `access_level` wins (Salesforce's RowCause model — grants are additive, never subtractive).

### D8 — Share-link re-share semantics are made explicit

Two policy rulings on the already-hardened link surface:

1. **Mint authority = record visibility AND the object's `publicSharing` opt-in.** A `publicSharing`-enabled object deliberately delegates re-share power to anyone who can see the record; this is now a **stated** decision rather than an emergent one. Objects that do not opt in cannot be link-shared at all. (A future tightening to require share-management authority for minting is recorded as D-future, not taken now — it would break existing `publicSharing` flows.)
2. **A record's share-manager may revoke any link on that record.** Today `revokeLink` is creator-or-system only, so a record owner / `modifyAllRecords` admin cannot kill a link someone else minted on their record. Revoke authority becomes: creator **or** `canManageShares(link.object, link.recordId, context)` **or** system.

### D9 — A dedicated `manage_sharing` capability

Add `manage_sharing` (scope `org`) to the platform capability registry (`spec/security/capabilities.ts`). It gates the sharing-rule surface (D6) and becomes the non-owner, non-super-user path to `canManageShares` in the DEPTH extension. Rationale: the surfaces currently borrow `manage_platform_settings` (a broad platform-admin power) for their Setup navigation, which over-scopes sharing administration to full platform admins. Salesforce ships an analogous standalone **"Manage Sharing"** permission. Seeded `managed_by: 'platform'`, granted to the admin permission set by default so existing admin flows are unchanged.

### D10 — Migration: tighten directly, fail closed, with a visible trail

D3 and D7 are breaking (a deployment relying on `edit`-share delete, or on inert non-`user` grants "succeeding", changes behaviour). We tighten **directly**, without a warn-only observation window or a config escape valve:

- **Precedent**: ADR-0090 D1 flipped the default OWD to `private` — a larger tightening — directly. ADR-0049's culture is fail-closed over warn-and-allow; a "warn but permit" state is itself the anti-pattern that ADR forbids.
- **Blast radius is narrow**: delete-via-share requires the caller to *also* hold object-level delete CRUD *and* to be relying on a share rather than ownership — a small intersection, most likely unused.
- **The escape hatch would be the bug**: a flag that re-opens delete-via-share or inert grants would make the semantic divergence permanent, and the gate *is* the security property.

Buffers instead of a valve: (1) every fail-closed denial logs a specific reason (`delete denied: an edit-level share does not grant delete; delete requires ownership, write depth, or Modify All`); (2) `/security/explain` already explains record-level delete decisions — the release note points admins at it; (3) the changelog carries an explicit breaking-change entry for both D3 and D7.

---

## Consequences

**Positive**
- The sharing tables stop being the one write surface with authorization disabled. Revoke-anyone's-share, enumerate-anyone's-access, and self-authored org-wide elevation all close.
- Enforcement lives in the service, so the fix covers every caller, not just the three routes that exist today.
- `edit` and `delete` become distinct verbs, matching Salesforce / Dataverse / Odoo, and the "sharing widens rows, not verbs" principle is enforced rather than merely documented.
- A share that persists always enforces something — the ADR-0078 inert-metadata class is closed on the recipient and target axes, matching what #3865 did for the level axis.
- `manage_sharing` right-sizes sharing administration below full platform admin.

**Negative / costs**
- Two breaking changes (D3, D7). Mitigated by narrow blast radius, deny-logging, `explain`, and changelog per D10.
- A new cross-plugin contract method (`ISecurityService.hasWriteBypass`) — small, fails closed, mirrors the existing `getReadFilter` posture.
- The MVP does not give hierarchy managers share-management authority (D1 DEPTH is deferred); until the extension lands, a manager sharing a subordinate's record is done by an admin or the owner.

**Neutral / explicitly out of scope**
- **Time-boxed / recertifiable shares** — owned by ADR-0091; this ADR does not touch the lifecycle axis.
- **External / guest identity sharing** — the `guest` recipient is removed by D7; its reintroduction rides ADR-0090 D11 + the portal-identity follow-up (parking-lot #2776 item 6).
- **Scale hardening** (the `buildReadFilter` 5000-grant cap, async share recalculation) — parking-lot #2776 item 3; the cap is a separate small issue, not a decision here.
- **Request-body schema validation** on the sharing routes (the hand-plucked field mapping) — tracked by #3877 / #3899.
- **Segregation-of-duties, ERP dimension restrictions** — parking-lot items 2 / 4; no overlap.

## Rollout

1. **This ADR** (Proposed → Accepted).
2. **P0 PR** — the authorization face, non-breaking where it only *adds* a gate that should always have been there: `canManageShares` + `ISecurityService.hasWriteBypass` (D1/D2), revoke ownership+symmetry checks (D4), list gating + `sys_record_share` self-scope (D5), sharing-rule `manage_sharing` enforcement (D6), grant input narrowing + posture validation (D7), the `manage_sharing` capability (D9). Ships with the #3902 reproduction (Mallory ①②③) as integration tests plus plugin-sharing unit tests.
3. **P1 PR** — the verb boundary (D3): split `canEdit`/`canDelete` and `buildWriteFilter` by verb, route `delete` in the middleware, deny-logging. Breaking; carries the changelog entry.
4. **Follow-ups** — share-link re-share rulings (D8) and, if pulled, the DEPTH management extension (D1 D-future). Each its own small PR.
