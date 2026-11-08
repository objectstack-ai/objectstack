# ADR-0152: A SCIM group grants only an ordinary permission set, through a per-connection mapping row a platform administrator saves

**Status**: Accepted — implemented, 2026-11-08, recording the maintainer's ruling of 2026-11-08 on [#30959](https://github.com/objectstack-ai/objectstack/issues/30959) (ruling record [`6718345088`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6718345088), verbatim: 「以上都同意」), which accepted every recommendation of the seat's decision analysis [`6710730984`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6710730984): fork 1 (a), fork 2 no, fork 3 (i). The mechanism landed before this record, in [#31443](https://github.com/objectstack-ai/objectstack/pull/31443) (merge `ed4b8322`, landing record [`6724527199`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6724527199)); evidence: `packages/plugins/plugin-auth/src/scim-group-projection.ts` + `packages/plugins/plugin-auth/src/scim-group-projection.test.ts`. `docs/adr/` is Tier H (Prime Directive #14): this record lands by the maintainer's hand.
- **Date**: 2026-11-08
- **Card**: [#30959](https://github.com/objectstack-ai/objectstack/issues/30959) (p1, `domain:server`), the card's second and last PR. The card body's Expected and Acceptance were written before the ruling; where the two differ, the ruling binds ([D2](#d2--an-identity-provider-group-never-confers-administrator-standing)).
- **Decided by**: the maintainer, 2026-11-08, verbatim and untranslated: 「以上都同意」 — given on the evaluation write-up that followed the seat's analysis `6710730984`, and recorded on the card as ruling record `6718345088`. The three forks and the options ruled are the analysis's; [Decision](#decision) restates each in the ruling record's own terms.
- **Builds on**: [ADR-0134](./0134-env-side-scim-provisioning.md) (the open half of `cloud ADR-0071`: `@better-auth/scim` is the mechanism, the env is the Service Provider, and D4 left group→role mapping a declared, unwired seam whose filling is "a later decision with its own record" — this is that record), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D12 as amended by ruling of record 6228728551 (the organization boundary an organization administrator's assignments stay inside), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) D2 (the platform-administrator gate both mapping doors run), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the envelope every refusal answers in), `cloud ADR-0024` D5.2 (break-glass, the invariant the last-administrator guard enforces).
- **Amends**: [ADR-0134](./0134-env-side-scim-provisioning.md) D4 — one pointer line under D4 naming this record; D4's text and ADR-0134's status line are unchanged, so the mirror stays equal to `cloud ADR-0071`.
- **Leaves unchanged**: the SCIM user lifecycle of ADR-0134 D3 (`active: false` disables through this platform's `identity.reconcileUser` hook; `DELETE` never erases the user); a provisioned member's organization role (the default standing of ADR-0134 D4); every grant made by hand; the delegated-administration gate an organization administrator's own assignments pass; the last-administrator guard's judgement.
- **Consumers**: `@objectstack/plugin-auth` (the vendor `projection`, the two mapping doors, the last-admin guard's texts), `@objectstack/platform-objects` (`sys_idp_group_mapping`), `@objectstack/plugin-security` (the boundary predicate served on the `security` service), `@objectstack/spec` (one `PLATFORM_OBJECTS_BY_PACKAGE` row and one optional `ISecurityService` member), `objectstack-ai/cloud` (cloud#3667, Enterprise SCIM provisioning, the card's named consumer).

---

## Provenance

The decision was taken on #30959 in four recorded steps, each a comment on the card:

1. **Reading** [`6710719058`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6710719058) — measured on `origin/main` `658d84f5` through real `AuthManager.handleRequest()` doors: a SCIM group push wrote only `sys_scim_*` rows and granted nothing (R1); the last-administrator guard refuses the revoke direction but not the grant direction (R2); a projection wired by a throwaway probe showed what any mapping must do to work at all (R3).
2. **Analysis** [`6710730984`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6710730984) — three forks, each with options and a recommendation: where the mapping lives, whether an IdP group may confer administrator standing, and which ADR change records the answer.
3. **Ruling** [`6718345088`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6718345088) — 「以上都同意」: fork 1 = (a), fork 2 = no, fork 3 = (i).
4. **Build** [#31443](https://github.com/objectstack-ai/objectstack/pull/31443), merged as `ed4b8322` (landing record [`6724527199`](https://github.com/objectstack-ai/objectstack/issues/30959#issuecomment-6724527199)).

⛔ **This record decides nothing the ruling did not.** [Decision](#decision) carries the three ruled forks.
[The mechanism as landed](#the-mechanism-as-landed) records what the build PR implemented as **facts about the
mechanism**, each anchored into code, the way ADR-0134 records its vendor-version fact; a reader who wants to change
one of those facts changes code and this section, not the decision.

---

## Context

ADR-0134 D4 provisioned every IdP-pushed user at the deployment's default standing and left the vendor's
`projection` option unset: "An IdP may push groups; they land, they are visible, and they grant nothing." The card's
named consumer (cloud#3667, Enterprise SCIM provisioning on live Okta / Entra ID) needs the opposite — the IdP's
group decides what a member may do here — and reading `6710719058` R1 measured the gap: a mapped-group assertion
was red on `main` (`expected 0 to be greater than 0`).

Two measured facts shaped every option, and both stay true under the decision:

- **Every SCIM write runs as the system.** The delegated-administration gate that keeps an organization
  administrator's assignments inside the organization boundary short-circuits on a system write, so it never sees
  a projected grant (`6710730984`, R3 item 5). The card's "grants go through the existing assignment doors" cannot
  hold at projection time; the boundary can only be enforced where the mapping is **saved**.
- **The vendor's transaction adapter cannot address the grant table.** A projection that writes
  `sys_user_permission_set` through the vendor's `context.database` fails with "Model not found in schema", and the
  vendor turns that into a SCIM 500 on every user write (`6710730984`, R3 item 2).

---

## Decision

### D1 — Storage: one platform-object row per mapping, per SCIM connection

Ruled fork 1 = (a). A mapping is a row of a platform object, keyed by the SCIM connection and one group, with typed
columns — never a settings value and never an authorable spec key. Its writer is the platform administrator who
mints the SCIM connection's credential, through the same gate; no new population gains SCIM administration.

The ruling carries one build note: the row's source is shaped so it can also hold an SSO provider's IdP group claim,
so [#30967](https://github.com/objectstack-ai/objectstack/issues/30967) item 3 reuses this object and no second
mapping model grows. The SSO half itself is #30967's and is not decided here.

### D2 — An identity provider group never confers administrator standing

Ruled fork 2 = no. In V1 a mapping names only an ordinary permission set inside the organization boundary. A mapping
that names a set outside it is **refused at save**, judged by the criteria of
`packages/plugins/plugin-security/src/delegated-admin-gate.ts#organizationBoundaryFailure`: `admin_full_access`,
the organization-administrator sets, the MCP agent ceiling sets, a set with a superuser wildcard bit, a set with an
`adminScope`, and a set with a capability not scoped to the organization. No organization-role mapping is offered:
a provisioned member keeps the default standing of ADR-0134 D4.

Two consequences come with the ruling:

- The card's Acceptance line "a mapping that would remove the last admin is refused as a SCIM 403" is replaced by
  "a mapping that names an administrator set is refused at save". A projected grant never carries administrator
  standing, so the last-administrator guard never fires on one.
- The last-administrator guard's texts that sent an operator to "the SCIM group mapping" are corrected, because no
  mapping can move administrator standing.

### D3 — The record: this ADR, plus one pointer line in ADR-0134 D4

Ruled fork 3 = (i). ADR-0134 is a mirror of `cloud ADR-0071` and states that it is not a re-decision, so D4 is not
rewritten in place; it gains one line pointing here. Its own last sentence asks for exactly this: "Filling the seam
is a later decision with its own record."

---

## The mechanism as landed

Facts read on `origin/main` after `ed4b8322`. Each clause names the code that makes it true.

**Storage.** `packages/platform-objects/src/identity/sys-idp-group-mapping.object.ts#SysIdpGroupMapping` declares
`sys_idp_group_mapping`: `source_kind` (closed select, V1 value `scim` — the seam D1's build note names),
`source_id` (the SCIM connection), `group_external_id` or `group_display_name` (a row names exactly one),
`permission_set`, `organization_id`. Its data API is list-only, so the doors below are its only writer. The
platform-object roster gains the row in `packages/spec/src/system/constants/platform-object-names.ts#PLATFORM_OBJECTS_BY_PACKAGE`.

**Writer.** `POST /api/v1/auth/admin/scim/set-group-mapping` and `POST /api/v1/auth/admin/scim/delete-group-mapping`
(`packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts#IDP_GROUP_MAPPING_SET_PATH`,
`packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts#runSetIdpGroupMapping`,
`packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts#runDeleteIdpGroupMapping`) run behind the
platform-administrator gate that guards `/admin/scim/mint-credential`. The grant's organization is the one that owns
the connection's live credentials (`packages/plugins/plugin-auth/src/scim-connection-service.ts#scimCredentialIsLive`),
never a value the caller names; a connection whose live credentials name no organization or two is refused. Saving
or deleting a mapping re-projects the connection's provisioning domains at once
(`packages/plugins/plugin-auth/src/auth-manager.ts#reconcileScimProjectionDomain`, the vendor's
`reconcileSCIMProjection`), so a group's current members gain or lose the set without waiting for their next SCIM
change.

**Admin boundary at save.** The save door asks plugin-security's own predicate, lifted verbatim from a private method
to a module function (`packages/plugins/plugin-security/src/delegated-admin-gate.ts#organizationBoundaryFailure`) and
served as an optional member of the registered `security` service
(`packages/spec/src/contracts/security-service.ts#ISecurityService`). plugin-auth takes no package dependency on
plugin-security and keeps no copy of the list. A refused save answers `400 VALIDATION_FAILED` on `permissionSet`
with code `rule_violation` and stores nothing; with no `security` service to ask, nothing can be shown inside the
boundary and the save is refused `503`.

**Projection.** `scim({ projection })` in `packages/plugins/plugin-auth/src/auth-manager-plugin-list.ts` takes
`packages/plugins/plugin-auth/src/scim-group-projection.ts#createScimGroupProjection`:

- `roles.map` returns the ids of the connection's mapping rows that match the pushed group
  (`packages/plugins/plugin-auth/src/scim-group-projection.ts#mappingMatchesGroup`): by external id when the row
  names one, else by exact display name. An unmapped group maps to nothing and grants nothing.
- `roles.exists`, and `reconcileUser` again before every insert, re-judge the boundary at grant time, so a set
  redefined with an administrator bit after its mapping was saved grants nothing (warned once).
- `reconcileUser` (`packages/plugins/plugin-auth/src/scim-group-projection.ts#reconcileProjectedGrants`) makes the
  user's projected grants equal the vendor's desired set, idempotently, writing `sys_user_permission_set` through
  the ObjectQL engine inside the SCIM request's engine transaction
  (`packages/plugins/plugin-auth/src/objectql-adapter.ts#withSystemContext`), so the audit actor is
  `svc:scim:CONNECTION_ID` and a refused write rolls the whole SCIM mutation back. An engine refusal is rethrown as
  the vendor's `APIError` (`packages/plugins/plugin-auth/src/objectql-adapter.ts#withValidationErrorMapping`), never
  left to become a SCIM 500.
- A projected grant carries the reason marker
  `packages/plugins/plugin-auth/src/scim-group-projection.ts#scimGroupProjectionReason` for its provisioning domain.
  Reconcile removes only rows carrying that exact marker, so a grant made by hand — the same set included — is never
  removed, and a set the user already holds by hand is not written again.

**Last-administrator guard.** `packages/plugins/plugin-auth/src/last-admin-guard.ts#registerLastAdminGuard`'s
refusal texts no longer name a SCIM group mapping as a source of administrator standing; they tell the operator to
grant another account administrator standing first.

**Pins.** `packages/plugins/plugin-auth/src/scim-group-projection.test.ts` drives the real producer
(`AuthManager.handleRequest()` with a real SCIM bearer over the pinned vendor, a real ObjectQL engine, the real
plugin-security `security` service): a mapped push grants and a removal revokes, an administrator set and an
out-of-boundary set are refused at save, an unmapped group grants nothing, hand-made grants are never touched, and a
save or delete applies to current members at once.

---

## The vendor-version fact, measured

The projection is a vendor seam, so its behaviour is a version fact. Measured 2026-11-08 on `origin/main` `69244406`,
in this worktree's installed package:

- **The pin is 1.7.12.** `packages/plugins/plugin-auth/package.json` declares `"@better-auth/scim": "1.7.12"`,
  `pnpm-workspace.yaml` overrides `'@better-auth/scim@<2.0.0': '1.7.12'`, and the installed package's own
  `package.json` reports `1.7.12`. ADR-0134's version table names 1.7.2 as the pin; that table is ADR-0134's dated
  measurement and is left as written.
- **The seam's shape at 1.7.12.** `SCIMProjection` carries an optional `roles` member (`map`, `exists`) and a
  required `reconcileUser`, which the vendor documents as receiving "the complete effective state" and as having to
  be idempotent.
- **Only an `APIError` reaches the IdP as itself.** The vendor runs the projection inside
  `runSCIMApplicationCallback`, which rethrows an `APIError` unchanged and wraps any other throw as a SCIM
  `INTERNAL_SERVER_ERROR` with the detail "SCIM projection reconciliation failed". That is why the landed projection
  maps an engine refusal to `APIError`: an IdP retries a 500 and treats a 4xx as final.

---

## Consequences

- An organization's IdP group can now drive what its members may do here, without a redeploy and without a
  hand-made grant per member, which is what the card's consumer asked for.
- Administrator standing stays decided inside the platform: no IdP group membership, however scoped, mints an
  administrator, and a wrong mapping is refused loudly at save instead of silently granting.
- The boundary lives at save and is re-judged at grant time; it does not depend on the delegated-administration gate,
  which a system write never reaches.
- The mapping is runtime data in the environment, consistent with ADR-0134 D2's "connections are runtime data, not
  boot config".

## What this record does not decide

- ⛔ The SSO half: an SSO provider's group claim feeding the same object is
  [#30967](https://github.com/objectstack-ai/objectstack/issues/30967) item 3's.
- ⛔ A multi-organization SCIM mode. A mapping's organization is the one that owns the connection; ADR-0134 D3's
  seam stays a seam.
- ⛔ An organization-role mapping, or any mapping that confers administrator standing. Opening either is a new
  decision with its own record.
- ⛔ A Console surface for mappings. The two doors are the only writer today.
- ⛔ Anything in `cloud ADR-0071`'s closed half (D5, D6, the closed half of D7).

## References

- [#30959](https://github.com/objectstack-ai/objectstack/issues/30959) — the card; reading `6710719058`, analysis
  `6710730984`, ruling record `6718345088`, landing record `6724527199`.
- [#31443](https://github.com/objectstack-ai/objectstack/pull/31443) — the build.
- [ADR-0134](./0134-env-side-scim-provisioning.md) — the SCIM mirror whose D4 seam this record fills.
- [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D12 — the organization boundary.
- `cloud ADR-0071` — *Enterprise Identity — SCIM v1*, the original decision ADR-0134 mirrors.
- `cloud ADR-0024` D5.2 — break-glass.
