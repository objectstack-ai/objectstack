# ADR-0095: Authorization Kernel Chain — Tenant Isolation as Layer 0, a Monotonic Posture Ladder, Capability-Derived Posture

**Status**: Accepted (2026-07-14) — implemented: D1 tenant Layer 0 (`plugin-security/src/tenant-layer.ts`), D2/D3 posture ladder (`core/src/security/posture-ladder.ts`), locked by `authz-matrix-gate.test.ts` + `posture-ladder.test.ts` (#2920 B1–B4)
· **Amended** (2026-10-18, ruling of record 6250748677 on #24164, letter E′) — D1: Layer 0 is inert on 22 of the 23 platform objects that are to declare a default row scope, and walls the 23rd, `sys_user_preference`, to its organisation; on all 23, Layer 1 silence is to mean the object's declared default row scope, a protocol key (#24338), not no filter. See the note under D1.
· **Amended** (2026-10-23, ruling of record 6355206139 on #25233, letter B) — D2: the `EXTERNAL` rung admits explicit grants only (shares and share links, sharing rules, and held position and permission-set grants with their RLS evaluated), never the OWD baseline; the resolver returns it for a holder of the `external` organization role (#25541). See the note under D2.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0002](./0002-environment-database-isolation.md) (environment-per-database), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (scope depth), [ADR-0066](./0066-unified-authorization-model.md) (unified authz model, superuser bypass), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (permission model v2), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (tenancy service)
**Scopes**: the "cross-tenant RLS does not exist here" claim in [ADR-0073](./0073-automation-execution-identity.md) (see Context)
**Tracking**: framework#2920 (tasks B0–B4)
**Consumers**: `@objectstack/plugin-security`, `@objectstack/core` (`resolve-authz-context`), `@objectstack/plugin-sharing`, dogfood conformance suite

---

## TL;DR

Three decisions restructure the authorization kernel's hot path. The chain is
**behavior-preserving by contract** — every step lands behind a
`role × object × expected-visible-rows` matrix snapshot gate, and any delta the
gate exposes is a bug to chase, not a feature — with one deliberate exception
called out in D1 (resolving a spec-vs-implementation divergence found while
drafting this ADR).

1. **D1 — Tenant isolation becomes Layer 0.** The `org_id` tenant filter moves
   out of the business-RLS compile pass into an independent, always-first,
   AND-composed layer with its own code path. A business-RLS bug can no longer
   weaken tenant isolation, because the two no longer share a compiler, a merge
   step, or a bypass bit.
2. **D2 — A monotonic posture ladder.** Principal tiering becomes an explicit
   enum `PLATFORM_ADMIN > TENANT_ADMIN > MEMBER > EXTERNAL`, resolved once in
   `resolveAuthzContext`. Each rung maps to **exactly one** row-visibility
   injection rule; visibility is strictly nested down the ladder. The
   `EXTERNAL` rung's semantics are defined and test-locked now (explicit grants
   only, never OWD; channel list amended 2026-10-23, see D2); its enforcement
   path shipped with the `external` organization role (#25233).
3. **D3 — Posture derives from capabilities, never from roles.** The
   platform-admin tier derives from held capabilities
   (`viewAllRecords`/`modifyAllRecords`), and better-auth `role='admin'` is
   demoted to *one source that grants* the platform-admin position — never a
   parallel adjudication track (the #2836 class of composition conflict).

**Rejected**: a Postgres-native RLS backstop for Layer 0 (`SET LOCAL` GUC +
`CREATE POLICY`). Recorded in Alternatives with the rationale; not scheduled.

---

## Context

### Where tenant isolation actually lives today

Two deployment topologies coexist, and the honest statement of this ADR's
scope depends on distinguishing them:

- **Physically isolated (cloud, default)** — one database per environment
  (ADR-0002); the environment is implicit in the connection. ADR-0073's claim
  that "the hard problem (cross-tenant RLS) does not exist in this
  architecture" is true **for this topology** and remains true.
- **Shared-DB multi-org (`tenancy.mode = 'multi'`)** — a self-hosted EE
  deployment with `@objectstack/organizations` active (ADR-0093): multiple
  organizations share one database, isolated by `organization_id` stamping and
  in-DB row filtering. **This is the load-bearing case for Layer 0.** In
  `single` mode the tenant policies are stripped and this ADR's Layer 0 is a
  no-op by construction — behavior unchanged.

In the multi-org topology, tenant isolation today is smeared across two
half-seams, neither of which is a single always-first invariant:

1. **A permission-set RLS policy.** `tenant_isolation` is a wildcard
   (`object: '*'`) row policy carried by the seeded permission sets
   (`plugin-security/src/objects/default-permission-sets.ts`), compiled by the
   same `RLSCompiler.compileFilter` pass as every business RLS policy and
   merged with them.
2. **A driver-level tenant scope.** The SQL driver applies `applyTenantScope`
   keyed off `options.tenantId` when callers pass it — an independent seam,
   but one that depends on every call site remembering to thread the tenant id.

### The structural weaknesses this ADR closes

**W1 — The merge step can widen tenant scope (spec-vs-impl divergence).**
ADR-0066's precedence rule documents "RLS: OR within an object, **AND with
tenant-global**". The implementation does not do this: `compileFilter`
OR-combines **all** applicable policies — the wildcard `tenant_isolation`
policy is just one disjunct (`rls-compiler.ts`, "Multiple policies:
OR-combine"). A permissive business policy (e.g. an admin-authored
`status == 'public'` row rule) is therefore, at the RLS layer, sufficient by
itself to admit rows from **other organizations**; whether a given deployment
is actually exposed then depends on the driver half-seam catching it. A
security invariant must not depend on which of two loosely-coupled seams
happens to fire.

**W2 — One bypass bit short-circuits both layers.** The posture-gated
superuser bypass (`security-plugin.ts` `computeRlsFilter`, ADR-0066 ①) skips
*all* wildcard RLS — business scoping **and** tenant isolation — with a single
check. The gate is correct today, but structurally the strongest boundary in
the system (the tenant wall) and the weakest (a business row rule) hang off
the same short-circuit.

**W3 — Principal tiering is implicit.** "Who is a platform admin / org admin /
member" is derived in scattered places: unscoped `admin_full_access` grants
(`resolve-authz-context.ts`), better-auth `role='admin'` normalized to
`org_admin` via `mapMembershipRole`, capability bits consulted in
`permission-evaluator.ts`. There is no enum, no single derivation point, and
"short-circuit order = security boundary" exists only as code layout. The
#2836 incident (a platform admin who is also an org owner loses `sys_user`
edit because an explicit per-object deny out-composes a wildcard allow) is
what dual-track adjudication produces.

**W4 — No external tier exists, even as a reserved concept.** The sharing
chain (`plugin-sharing/sharing-service.ts`) has no external/portal principal
concept at all. When one arrives, bolting it on without a reserved rung would
repeat W3.

## Decisions

### D1 — Tenant isolation is Layer 0: its own code path, always first, AND-composed

`plugin-security` gains a dedicated tenant-scope module (working name
`tenant-layer.ts`) that computes the Layer 0 filter **outside** the RLS
compiler:

- **Input**: the ADR-0093 `tenancy` service (`mode`, `isolationActive`) and
  the resolved authz context's `organization_id`.
- **Rule**: on a tenant-scoped object (has `organization_id`, tenancy not
  disabled) in `multi` mode with isolation active, the filter
  `organization_id == ctx.organization_id` is **AND-composed unconditionally**
  onto every read and write — before, and independently of, whatever Layer 1
  (business RLS) contributes. In `single` mode Layer 0 contributes nothing
  (parity with today's policy stripping).
- **Fail-closed**: a missing `organization_id` on the context in `multi` mode
  denies (the same class of answer as today's `RLS_DENY_FILTER` sentinel).
- **Exemption** is a Layer 0 rule, not an RLS-compiler short-circuit: only a
  `PLATFORM_ADMIN`-posture caller (D2/D3) on an object whose **posture
  permits it** (platform-global `tenancy.enabled:false`, `private`, or
  better-auth-managed — exactly the ADR-0066 ① gate, restated) crosses the
  tenant wall. Layer 1's bypass no longer implies Layer 0's.
- **The wildcard `tenant_isolation` policy retires** from the seeded
  permission sets once Layer 0 enforces; the RLS compiler then never sees a
  tenant policy, and the OR-merge (W1) is closed **by construction** rather
  than by auditing every policy. The driver-level `applyTenantScope` seam is
  unchanged (defense in depth, now behind a real first line).

**Behavior contract (as built).** The extraction is behavior-preserving under
the matrix gate — every `role × object × operation` cell is identical or a
same-visibility filter simplification (duplicate-OR dedup; dead org-clause
removal on non-tenant objects) — **except four deliberate deltas**. All four are
the same structural defect (the tenant policy sharing the OR-merge / a
`==`-blind field net with business RLS) resolving toward stronger, more correct
isolation; the matrix suite (`plugin-security/authz-matrix-gate.test.ts`) gains
an explicit, annotated cell for each:

- **(a) W1 read.** A permissive business policy (e.g. `status == 'public'`) no
  longer OR-widens tenant scope: a foreign-org public row becomes **invisible**
  (`Layer0(org) AND Layer1(status==public)`). *The* headline W1 fix.
- **(b) W1 write (its twin).** The same OR-merge silently widened a *restrictive*
  write policy: `owner_only_writes` (`created_by == me`) was OR'd with the tenant
  policy, so a member's by-id write resolved to `org OR created_by` = **any row
  in their org**. Layer 0 AND-composes the tenant scope, so the write narrows to
  **owner-only**, as authored. (Release-notes BREAKING — see Consequences.)
- **(c) Platform-global object.** A member reading a `tenancy.enabled:false`
  global object was scoped by a *phantom* `organization_id` filter — the seeded
  tenant policy uses canonical `==`, which the field-existence/tenancy-disabled
  net (`extractTargetField`, single-`=`/`IN` only) cannot parse, so the
  tenancy-disabled skip never fired and the policy compiled against a column the
  object lacks. Layer 0 decides "tenant object?" **directly** from the field set
  + posture (not via `extractTargetField`), so a global object correctly
  contributes nothing and its **catalog is visible**. (The broader
  `extractTargetField` `==` blind spot still affects Layer-1 *business* policies
  and is tracked separately — out of scope for D1.)
- **(e) No active organization.** A write by a principal with no active org on a
  tenant object is now **fail-closed by Layer 0** (was owner-scoped only).

**Not touched.** `computeWriteCheckFilter` gains no tenant post-image check: the
seeded `tenant_isolation` carried only a `using` clause (never a `check`), so
there is no post-image tenant behavior to preserve; insert tenant placement is
owned by the enterprise auto-stamp, and update/delete targeting is enforced by
the Layer 0 pre-image path. Adding a mandatory post-image tenant check would
risk denying legitimate inserts before the auto-stamp runs — a regression, not a
fix — so it is deliberately excluded from D1.

> **Amended 2026-10-18 (#24339; ruling of record 6250748677 on #24164, letter E′
> — the maintainer's 「同意」) — Layer 1 silence on the platform identity objects.**
> Layer 0 is inert on 22 of the 23 objects the ruling names, which carry no
> `organization_id` column: the seven SCIM projections (`sys_scim_user`,
> `sys_scim_subject`, `sys_scim_projection_grant`, `sys_scim_identity_tombstone`,
> `sys_scim_group`, `sys_scim_group_member`, `sys_scim_connection_binding`),
> `sys_verification`, `sys_jwks`, `sys_organization`, `sys_user`, `sys_session`,
> `sys_account`, `sys_team_member`, `sys_two_factor`, `sys_api_key`,
> `sys_device_code`, `sys_oauth_access_token`, `sys_oauth_refresh_token`,
> `sys_oauth_consent`, `sys_oauth_application` and `sys_audit_log`. The 23rd,
> `sys_user_preference`, carries the organisation column, so Layer 0 bounds it to
> its organisation and its declared default is to apply inside that wall
> (measured: `scripts/platform-object-tenancy-census.json`, held to the tree by
> `scripts/check-platform-object-tenancy-census.mjs`). On all 23, Layer 1
> silence (no held set carries a row policy for the object) is to mean the
> object's declared default row scope, not no filter. The default is a protocol
> key on the object (`ObjectSchema.defaultRowScope`, #24338); the platform
> objects are to declare it themselves (#24341), the one collection point is to
> apply it (#24340), and the registry is to refuse an `extend` contributor that
> sets or loosens it (#24341). Mainstream precedent: Salesforce OWD on the
> object; Dataverse ownership type on the table; PostgreSQL
> `CREATE POLICY ON table`.

### D2 — A monotonic posture ladder, resolved once

`resolveAuthzContext` resolves and carries an explicit posture:

```ts
enum AuthzPosture {
  PLATFORM_ADMIN = 3, // crosses the tenant wall where object posture permits (D1)
  TENANT_ADMIN   = 2, // all rows within the organization
  MEMBER         = 1, // business RLS (ownership / unit depth / sharing) within the organization
  EXTERNAL       = 0, // explicit grants only — shares, sharing rules, grant RLS; never the OWD baseline
}
```

- **Exactly one injection rule per rung.** Each rung maps to one row-visibility
  rule; a request's effective read filter is `Layer0(posture, object) AND
  Layer1(rung rule)`. No rung consults another rung's rule; there is no
  "admin OR member" composition.
- **Strict nesting is the tested invariant**: for every object, the visible-row
  set at rung *n* is a superset of rung *n−1*. The
  `resolve-authz-context.test.ts` suite upgrades from per-case assertions to a
  `role × object × expected-rows` matrix snapshot asserting the nesting.
- **EXTERNAL — the channel list (amended 2026-10-23, ruling of record
  6355206139 on #25233, letter B).** An EXTERNAL principal is a member of the
  organization's member pool who holds the `external` organization role. It
  reaches rows through explicit grants only:
  - shares, share links included;
  - sharing rules (the grants they materialise);
  - the position and permission-set grants it holds, with their row-level
    security evaluated, so a predicate such as
    `supplier in current_user.<key>` reaches it as it reaches a member.

  It never reaches the internal OWD baseline: its org-wide default is
  owner-only on every object unless a held grant's RLS (`using`) speaks for
  that object and operation class, and its writes carry the member's
  owner-only floor (`external_default`). A `controlled_by_parent` detail is
  not floored on its own; its rows follow the master, which is. Nor does it
  reach the everyone-anchored default sets or the member directory. A
  misconfiguration can only *shrink* its visibility, never widen it. The
  resolver stamps `audience: 'external'` on a holder and `derivePosture`
  returns `EXTERNAL` (#25515, #25541).

  One limit, named: an object with no `owner_id` whose effective model is
  public is under no OWD for any principal, so an external holding an
  RLS-less grant on it reads every row. Reaching such an object takes an
  administrator's explicit grant.

  _Originally (2026-07-14): "an EXTERNAL principal sees only rows explicitly
  shared to it — sharing rules and OWD-derived baselines never apply … No
  external principal type exists today, so the resolver cannot yet return
  `EXTERNAL`." Sharing rules now apply; the deny-by-default direction
  stands._

### D3 — Posture derives from capabilities, never from roles

- `PLATFORM_ADMIN` posture is **derived** from held capability grants — the
  same evidence the superuser bypass already trusts
  (`viewAllRecords`/`modifyAllRecords` via unscoped `admin_full_access`-class
  grants; `permission-evaluator.ts` `hasSuperuserReadBypass`/
  `hasSuperuserWriteBypass`). The read/write distinction stays where it is
  today: posture selects the tier; the per-side capability bit still gates the
  per-side bypass.
- `TENANT_ADMIN` derives from org-admin capability grants (today's
  `organization_admin` set), with better-auth `role='admin'` demoted to **one
  source that grants that position** (the existing `mapMembershipRole`
  normalization becomes a grant-provisioning concern, not an
  enforcement-time input).
- `EXTERNAL` (2026-10-23, #25233) derives from the reserved `org_external`
  position, which the resolver projects from `sys_member.role = external` in
  the active organization. As with `role='admin'` above, the role is the one
  source of a position; enforcement reads the posture, never the role. It is
  the one rung whose evidence is an identity position rather than a
  capability bit, and it outranks `TENANT_ADMIN` (only `PLATFORM_ADMIN`
  precedes it). ADR-0099 I3 records the exception.
- **No enforcement-time code path may consult the better-auth role directly.**
  This removes dual-track adjudication: #2836-class conflicts (explicit deny
  from one track out-composing a wildcard allow from the other) become
  impossible because there is one track.

## Sequencing and the matrix gate (implementation contract)

The chain is strictly serial — `D1 → D2 → D3` (#2920's B1 → B2 → B4) — and
each step lands only behind the snapshot gate:

0. **Gate first.** The existing conformance matrix
   (`packages/qa/dogfood/test/authz-conformance.matrix.ts`) is integration-layer;
   before D1 begins, an equivalent `role × object × expected-visible-rows`
   snapshot must run at the **unit layer** (inside `plugin-security`'s test
   suite) so the loop is minutes, not a dogfood boot.
1. **D1** extracts Layer 0 (touches `rls-compiler.ts` call sites,
   `computeRlsFilter`, the seeded permission sets, `resolve-authz-context.ts`).
2. **D2** introduces the enum and rewires the injection rules (touches
   `resolve-authz-context.ts`, its test matrix).
3. **D3** re-anchors derivation (touches `resolve-authz-context.ts`,
   `permission-evaluator.ts`, membership-role handling in `plugin-auth`).

## Consequences

**Positive.**
- Tenant isolation becomes an invariant with one owner, one code path, and an
  explicit exemption rule — not a policy that merges with its inferiors (W1)
  nor a rider on their bypass bit (W2).
- The security boundary ("who sees what tier of rows") becomes an enumerable,
  snapshot-tested ladder — the property the "explainable authorization" track
  needs the kernel to have.
- One adjudication track for admin-ness ends the #2836 class.
- The EXTERNAL rung's deny-by-default semantics are decided once, ahead of
  need, instead of under portal-feature deadline pressure.

**Negative / accepted.**
- The seeded permission sets change (the `tenant_isolation` policy retires from
  `organization_admin` / `member_default` / `viewer_readonly`). Environments that
  customized seeded sets keep their overlays (ADR-0094 semantics), but the diff
  is visible; release notes must call it out.
- **Four behavior deltas ship (release-notes BREAKING), all W1-class** — see the
  D1 behavior contract for the enumerated cells. The load-bearing one for
  operators is **(b)**: a deployment that relied on *members editing each other's
  records within the org* (the OR-merge silently permitting it) will find member
  by-id writes now restricted to records they own (`created_by`); grant an
  explicit per-object edit set where org-wide editing is intended. Deltas (a) W1
  read, (c) global-catalog visibility for members, and (e) fail-closed no-org
  writes are each toward stronger/correcter isolation. These ship loudly.
- `resolveAuthzContext` gains one more derived field; hot-path cost is one
  enum computation over already-loaded grants (negligible).

**Neutral / explicitly out of scope.**
- `single`-mode deployments: Layer 0 is inert; nothing changes.
- The driver-level `applyTenantScope` seam and ADR-0002 physical isolation are
  untouched — Layer 0 sits between them and business RLS.
- Business RLS semantics (ownership, ADR-0057 depth, sharing, CEL) are
  untouched; only the tenant policy leaves that layer.

## Alternatives considered

- **Keep the policy-shaped tenant filter and fix the merge (AND the wildcard
  in the compiler).** Rejected: it repairs W1 but leaves W2 (shared bypass)
  and keeps the invariant inside the machinery it must be independent of; the
  next compiler change re-opens the question. The ADR-0094 lesson applies:
  enforce structurally, not by auditing the glue.
- **Postgres-native RLS backstop for Layer 0** (`ENABLE ROW LEVEL SECURITY` +
  `tenant_isolation` policy on `org_id = current_setting('app.org_id')`, with
  `SET LOCAL` per transaction). **Rejected — maintainer decision, 2026-07-14.**
  The cloud topology is already physically isolated per environment
  (ADR-0002); the only beneficiary is the EE shared-DB mode, and the cost is a
  PG-only defense line (SQLite/MySQL excluded, portability contract broken for
  the layer), GUC/pooling hazards (PgBouncer transaction mode vs `SET LOCAL`),
  a doubled test matrix, and BYPASSRLS credential management. Revisit only if
  a shared-database SaaS topology ships as a first-class product.
- **Store posture on the user record.** Rejected: posture must be *derived*
  from grants at resolve time — a stored tier is a second writable authority
  that can drift from the grants (the ADR-0094 one-authority rule, applied to
  a computed fact).
- **Model EXTERNAL as a very-restricted MEMBER (no new rung).** Rejected: the
  member rung's rule composes OWD baselines and sharing; external safety
  demands the *absence* of those sources, which a data-driven restriction of
  the member rule cannot guarantee fail-closed. A rung whose rule never
  consults OWD can.

## References

- framework#2920 (tracking; B0 = this ADR, B1 = D1, B2 = D2, B4 = D3) ·
  #2836 (dual-track adjudication incident) · #2909 / ADR-0094 (structural
  one-authority precedent).
- Code (current state): `packages/plugins/plugin-security/src/rls-compiler.ts`
  (OR-merge), `packages/plugins/plugin-security/src/security-plugin.ts`
  (`computeRlsFilter`, posture-gated bypass),
  `packages/plugins/plugin-security/src/objects/default-permission-sets.ts`
  (`tenant_isolation` wildcard policy),
  `packages/core/src/security/resolve-authz-context.ts`,
  `packages/plugins/plugin-security/src/permission-evaluator.ts`,
  `packages/qa/dogfood/test/authz-conformance.matrix.ts`.
- ADR-0002 (physical isolation), ADR-0066 (precedence rule this ADR makes
  true; superuser bypass gate), ADR-0073 (claim scoped by this ADR),
  ADR-0093 (`tenancy` service consumed by Layer 0).
