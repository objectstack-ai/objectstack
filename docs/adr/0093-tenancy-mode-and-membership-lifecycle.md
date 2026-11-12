# ADR-0093: Tenancy mode as a first-class capability, and a single owner for the user→membership lifecycle

**Status**: Accepted (2026-07-13) — implemented: `tenancy` kernel service (`plugin-auth/src/tenancy-service.ts`), membership reconciler (`reconcile-membership.ts`), locked by `dogfood/test/membership-reconciler.dogfood.test.ts` · **Amended** (2026-11-08, [ADR-0151](./0151-ai-service-account-a-headless-agent-is-a-registered-principal-of-its-own.md) D1, proposed, adopted by its merge) — D7's machine / service-account row: the first-class marker it waited on is `sys_user.principal_kind`. The membership reconciler never binds an account of kind `agent`, whose one membership its registration creates. · **Amended** (2026-11-11, maintainer ruling 6796108313) — D8.1 reversed: under every tenancy posture, a person's data access requires a current membership in the organization, judged on each request; see the amendment note under D8.
- **Date:** 2026-07-13
- **Deciders:** ObjectStack Protocol Architects
- **Implementation:** #2882 (Phase 0 — tactical create-user bind, merged) → this PR (Phases 1–3 — `tenancy` service, fail-fast boot guard, membership reconciler, consumer migration, backfill, docs). One revision from the original plan, ratified in D2: the endpoint-level create-user bind **delegates to the shared reconciler** (one implementation, two call sites) instead of being deleted. Runtime verification confirmed the hook fires for `admin.createUser`, but better-auth *defers* `user.create.after` post-commit (#1881), so the endpoint keeps its delegated call to report `organizationId` / `membershipCreated` deterministically in its response. Cloud-host semantics (personal-org hook precedence, multi-org non-binding, D5 blast radius) verified against `objectstack-ai/cloud` — see D2/D3/D5.
- **Relates to:** [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (org-scoped identity optionality), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (platform-admin gate), [ADR-0092](./0092-sys-user-profile-field-delegation.md) (identity write guard), the default-org bootstrap (`plugin-auth/src/ensure-default-organization.ts`, referenced in code as "cloud ADR-0081 D1" — identified 2026-09-04: that record is **cloud ADR-0081**, *Organization Management — Open Basics, Enterprise `@objectstack/organizations`*, Accepted 2026-07-09 in the `objectstack-ai/cloud` repo's own ADR series, where its **D1** is this bootstrap; it predates *this* repo's series because it lives in that one, where it is current), #2766 (admin user management), PR #2882 (single-org create-user membership bind — the tactical fix this ADR generalizes)

## TL;DR

Two structural gaps produced the bug fixed in PR #2882, and will keep producing
siblings of it until closed:

1. **"Every new user gets an organization membership" is not owned by anyone.**
   It is re-implemented (or forgotten) per creation path: invite ✅, add-member ✅,
   SSO JIT ✅, cloud host hook ✅, `/admin/create-user` ❌ (fixed tactically in
   #2882), `/admin/import-users` ❌, self-signup ❓ (undefined). Each new creation
   path is a new place to forget the invariant.
2. **"What tenancy mode is this deployment in?" has no single answer.** At least
   four independent signals answer it today — the `OS_MULTI_ORG_ENABLED` env flag,
   the `org-scoping` service probe, counting `sys_organization` rows (PR #2882's
   heuristic), and the frontend `features.multiOrgEnabled` / `features.organization`
   pair — and they can disagree. The worst disagreement is silent: requesting
   multi-org without the enterprise package installed degrades to **zero tenant
   isolation with only a console warning** (`serve.ts`), an ADR-0049-class
   unenforced security property.

Decision:

- **D1** — The membership invariant is: *in any deployment where the organization
  capability is on, every human user ends the creation pipeline with ≥ 1
  `sys_member` row, unless the deployment's membership policy says otherwise.*
  Policy is explicit, not emergent: `auto` (default) / `invite-only`.
- **D2** — One owner: plugin-auth composes a **membership reconciler** into
  better-auth's `user.create.after` database hook — the one seam every creation
  path (signup, admin create, import, SSO JIT) already flows through. Host hooks
  chain first and win; the reconciler yields to any membership that already
  exists. Endpoint-level binds (PR #2882) are retired in favor of it.
- **D3** — Target-org resolution consumes the tenancy service (D4), never data
  shape: `single` mode → the default org; `multi` mode → the framework does not
  guess (invite / JIT / host hooks own it). The "exactly one org row" counting
  heuristic from PR #2882 is retired.
- **D4** — A **`tenancy` kernel service** becomes the single source of truth:
  `{ mode, isolationActive, requested, degraded, defaultOrgId() }`. plugin-auth
  registers the baseline; `@objectstack/organizations` upgrades it. The
  service-layer consumers migrate to it (SecurityPlugin RLS stripping,
  `/auth/config` features, the reconciler); the two sites that sit *beneath* or
  *before* the service — the SQL driver's dev-warning gate and the `serve.ts`
  boot guard — keep reading the env flag by design (see D4).
- **D5** — The degraded middle state **fails fast**: `OS_MULTI_ORG_ENABLED=true`
  without a working `@objectstack/organizations` refuses to boot. The only escape
  hatch is an explicit `OS_ALLOW_DEGRADED_TENANCY=1`, which brands the deployment
  `degraded: true` on the surfaces that don't require shipping console UI: a loud
  **terminal boot warning** and `features.degradedTenancy` in `/auth/config`.
  (A Setup-dashboard banner was considered and **descoped** — see D5.)
- **D6** — A bounded, idempotent **backfill** binds pre-existing member-less users
  to the default org on `kernel:ready` — single-org mode only, once per
  deployment (recorded in the `sys_migration` ledger).
- **D7** — Edge-case ledger: existing memberships always win; platform-admin
  bootstrap keeps its own path; phone-only users bind like anyone else;
  multi-org backfill is explicitly refused.
- **D8** — Non-goals: single-org membership still does **not** gate data access
  *(reversed 2026-11-11 — membership gates data access under every posture;
  see the D8 amendment note)*; RLS strip semantics, the dual frontend feature
  flags, and better-auth's ownership of member CRUD are all unchanged.
- **D9** *(recording, not a new ruling)* — The `session.create.before` hook
  resolves a session's `activeOrganizationId` from the caller's `sys_member`
  row (owner-preferred, else oldest), only when the draft lacks one,
  best-effort, opt-out via `autoActiveOrganization: false`. Shipped behaviour,
  previously cited in code as an unqualified "ADR-0081 D1" — the record is
  cloud ADR-0081 (identified 2026-09-04), and written without that qualifier
  the number collides with this repo's ADR-0081; anchored here because it reads exactly
  the invariant D1 states and D2 owns.

## Context

### How the platform got here

The single-org / multi-org split is an open-core seam: the open framework ships
member-management basics (better-auth org plugin, invitations, the default-org
bootstrap), while `@objectstack/organizations` (enterprise) adds the multi-tenant
runtime — `organization_id` auto-stamping, per-org seed replay, and the
`org-scoping` service whose *presence* SecurityPlugin probes at `start()` to
decide whether wildcard `tenant_isolation` RLS policies apply or are stripped.

This seam is sound. What grew up around it is not:

**Membership creation is distributed.** better-auth owns `sys_member` rows for
its own flows (invite-accept, add-member, SSO `organizationProvisioning`). The
cloud host injects a `user.create.after` hook that provisions a personal org per
new user. The open framework bootstraps a Default Organization for the platform
admin. But the framework itself never took ownership of the general invariant —
so paths that create users *outside* better-auth's org flows (`/admin/create-user`,
`/admin/import-users`, plain email signup) produce **member-less users**. In
single-org mode a member-less user is degraded in concrete ways:

- the `session.create.before` hook resolves `activeOrganizationId` from the
  user's `sys_member` row (recorded as D9) — no row ⇒ **null active org for
  every session**, so better-auth org endpoints can't resolve an org for them
  and `{current_org_id}` navigation tokens fall back;
- the Setup app's Members list omits them, right next to an Invite flow that
  *does* create membership — the operator-visible inconsistency reported against
  PR #2882.

**Mode detection is ambient.** `resolveMultiOrgEnabled()` (env), the
`org-scoping` probe (service graph), `sys_organization` row-count (data), and
`features.*` (frontend) are four cached-at-different-times views of one fact.
PR #2882 had to add the fourth precisely because no service exposed the first
two to an endpoint at request time. Ambient facts drift; drifted security facts
violate ADR-0049.

**The degraded state is silent.** `serve.ts` handles "multi-org requested,
enterprise package missing" with a `console.warn` and continues booting with
tenant RLS stripped. An operator who reads logs carefully knows their org
boundaries are inert; everyone else believes they are multi-tenant. This is the
platform's largest tenancy footgun and it costs one boot-time check to close.

### Why now

PR #2882 fixed one endpoint. The same fix is owed to `/admin/import-users`; the
signup question is open; and any future creation surface (SCIM, phone-OTP
first-login, marketplace flows) re-asks the same question. Fixing call sites
one-by-one is how the platform got here. The cheap moment to centralize is now,
while the set of creation paths is still enumerable.

## Decisions

### D1 — The membership invariant, stated once

> In a deployment where the organization capability is enabled, every **human**
> user must hold at least one `sys_member` row by the end of the creation
> pipeline, unless the deployment's membership policy opts out.

- **Policy knob:** `auth.membershipPolicy: 'auto' | 'invite-only'`, default
  `'auto'`.
  - `auto` — the reconciler (D2) binds new users to the resolved target org
    (D3) when no membership exists.
  - `invite-only` — the reconciler never auto-binds; membership is granted only
    through explicit flows (invite-accept, add-member, SSO JIT, host hooks).
    Deployments that run invite-only discipline choose it consciously instead
    of getting it as an accident of which endpoint created the user.
- Self-signup follows the same policy — no signup-specific membership branch.
  (Whether signup is *open at all* remains the existing, separate registration
  toggle; this ADR does not couple the two.)
- Default role for auto-bound users is `member`. Elevation is a separate,
  audited action (`update-member-role`), never part of creation.
- **`auto` joins; it never creates.** The reconciler binds a user to the one
  organization the deployment *already is* — it never mints an organization.
  This keeps the framework's deliberate B2B/invitation posture (documented in
  the cloud's `personal-org-hook.ts`: "the framework's SecurityPlugin
  deliberately does NOT auto-create a personal workspace per signup").
  Workspace-per-user is a *product* decision that stays with hosts (the cloud's
  personal-org hook); joining the sole existing org is *bookkeeping* the
  framework owns. The two must not be conflated when evaluating this default.

**Rejected alternative:** making membership strictly mandatory (no policy knob).
Rejected because invite-only single-org deployments are legitimate (a shared
service with app end-users who are deliberately *not* teammates), and a
framework that force-joins every end-user into the operator org would be wrong
for them.

> *Amended 2026-11-11 (D8 amendment note).* Under every tenancy posture a
> person's data access requires a current membership in the organization, so an
> invite-only deployment whose end-users are not teammates still gives each of
> them a membership — of the grade that fits, which for such a population is
> the `external` membership tier (the portal grade: no member defaults, never
> in a business unit, application data only through what is granted to it
> explicitly). What `invite-only` decides is *who grants* the membership and
> *when*, not whether a person who reaches the data holds one.

### D2 — One owner: the membership reconciler hook

plugin-auth composes a `user.create.after` step into `composeDatabaseHooks`,
exactly as the identity-source stamp (`account.create.after`) is composed today:

```
host user.create.after (if any)  →  framework membership reconciler
```

- **Coverage:** every creation path flows through better-auth's user pipeline —
  email signup, `/admin/create-user` (wrapper drives `authApi.createUser`),
  `/admin/import-users` (same), SSO JIT. One seam, all paths — including future
  ones, which inherit the invariant without knowing it exists.
- **Yield rule:** the reconciler first checks for *any* existing `sys_member`
  row for the user and no-ops if one exists. This makes host composition safe
  by construction: the cloud's personal-org provisioning hook runs first,
  creates the membership, and the framework reconciler sees it and yields.
  No double-membership, no ordering negotiation beyond "host first" (the
  existing composition contract).
- **Failure semantics:** best-effort. A failed bind logs a structured warning
  and never fails user creation — membership is recoverable bookkeeping; a
  created-but-unbindable user is strictly better than a failed signup. The
  D6 backfill is the self-healing net for exactly these misses. *(Amended: the
  backfill runs once per deployment (D6 note), so a bind that fails after it
  ran is not healed by it; under the D8 amendment that person reaches no data
  until an administrator adds them — see the amendment note's consequences.)*
- **Idempotency:** keyed on the `(organization_id, user_id)` unique index;
  the check-then-insert tolerates races because a lost race hits the unique
  index and is swallowed as "already bound".
- **Observability:** every reconciler outcome (`bound` / `yielded` /
  `policy-skip` / `no-target-org` / `failed`) emits one structured log line,
  and `bound` writes the same audit metadata PR #2882 introduced
  (`organizationId`, `membershipCreated`).
- **Endpoint delegation (revised from "retirement"):** the endpoint-level
  `bindUserToSoleOrganization` (PR #2882) now *delegates to the shared
  reconciler* — one implementation, two call sites — and this is ratified as
  the **final** state, not an interim one. Runtime verification confirmed the
  hook fires for `admin.createUser` (the created user's membership pre-existed
  when the endpoint-side call ran), so deletion would be *safe in the common
  case* — but better-auth defers `user.create.after` via
  `queueAfterTransactionHook` (post-commit, not awaited inline; framework
  #1881), so an endpoint that must *report* membership state in its response
  (`organizationId`, `membershipCreated`) cannot rely on the deferred hook
  having completed. The delegated endpoint call makes the response
  deterministic; both call sites are idempotent and yield-to-existing, so
  double-coverage never double-binds.

**Rejected alternatives:**
- *Per-endpoint helper calls* (status quo after #2882): every future endpoint
  re-must-remember; this is the failure mode being fixed.
- *ObjectQL lifecycle hook on `sys_user` insert*: better-auth adapter writes
  carry no request context, and the identity write guard (ADR-0092) already
  establishes that better-auth-managed tables are governed at the better-auth
  seam, not the engine seam. Follow the precedent.

### D3 — Target-org resolution consumes declared mode, never data shape

The reconciler asks the tenancy service (D4):

| `tenancy.mode` | Target org |
|:---|:---|
| `single` | `tenancy.defaultOrgId()` — the bootstrap org (stable `slug='default'`), or the sole org row if a deployment renamed it |
| `multi` | none — framework never guesses; invite / JIT / host hooks own membership |

The PR #2882 heuristic — *bind iff exactly one `sys_organization` row exists* —
was the correct call for an endpoint that had no better signal, and the wrong
long-term contract: it infers configuration from data shape, so a multi-org
deployment's transient first-boot state (one org created, second pending) is
indistinguishable from single-org. Mode is configuration; read it as such.

**Verified against the cloud host (the multi-org reality check):** the cloud
control plane attaches `createUserSignupOrgHook`
(`service-cloud/src/personal-org-hook.ts`) — a `user.create.after` hook that
provisions a personal org + `owner` membership per signup. Under this ADR's
composition it chains *first*; the framework reconciler then either finds the
membership and yields, or (multi mode) resolves no target org and no-ops. Both
sides are idempotent-on-existing-membership, which the cloud hook's own header
already relies on ("whichever runs first wins and the other no-ops"). "Framework
never guesses in multi mode" is therefore not a hedge — it is exactly the
division of labor the production host already assumes.

#### D3 amendment (2026-10-24) — Setup's Create User joins the administrator's current organization

Decided by the maintainer (「25626 按当前组织」): in multi mode an administrator
always works inside one current organization — the browser switches between
them — so a user they create from Setup belongs to that organization, the way
mainstream admin consoles behave. `POST /admin/create-user` under a walled
posture (`tenancy.isolationActive`) therefore joins the new user to the
**calling administrator's current (active) organization**, as `member`, through
better-auth's `addMember` (the Add Member act) inside the account's own
transaction; a refused join creates no user. There is no organization choice:
to add a user to another organization, switch to it first.

- `membershipPolicy: 'invite-only'` still joins — creating a user inside your
  organization is an explicit act, like Add Member (D1).
- An administrator with no current organization is refused
  (`400 NO_ACTIVE_ORGANIZATION`, "switch to an organization first"), never
  handed a member-less account.
- Single mode (a degraded wall included) is unchanged: the reconciler binds the
  default org.

This is not the reconciler guessing a tenant: the reconciler, and every other
creation path (self sign-up, bulk import, SSO JIT, host hooks), still binds
nothing in multi mode.

### D4 — The `tenancy` kernel service

Registered under the service name **`tenancy`**:

```ts
interface TenancyService {
  /** Resolved mode. Static after kernel:ready. */
  mode: 'single' | 'multi';
  /** True iff org-scoping (auto-stamp + tenant RLS) is actually active. */
  isolationActive: boolean;
  /** What the operator asked for (OS_MULTI_ORG_ENABLED). */
  requested: boolean;
  /** requested && !isolationActive — the D5 branded state. */
  degraded: boolean;
  /** Single mode: the default org id (bootstrapping it if absent). Multi: null. */
  defaultOrgId(): Promise<string | null>;
}
```

- **Registration:** plugin-auth registers the baseline implementation at
  `init()` (env flag + lazy default-org resolution).
  `@objectstack/organizations` **replaces** it during its own `init()` (it
  registers before SecurityPlugin per the existing ordering contract), setting
  `isolationActive: true`. Presence-probing of `org-scoping` remains for one
  deprecation cycle, then SecurityPlugin consumes `tenancy.isolationActive`.
- **Migration of consumers** — status as implemented (PRs #2884 / #2887):
  1. SecurityPlugin's RLS strip gate → `tenancy.isolationActive` — **done**
     (keeps a direct `org-scoping` probe as fallback for lean embeddings);
  2. auth-manager `/auth/config` `features.multiOrgEnabled` → `tenancy.mode`
     (+ new `features.degradedTenancy` ← `tenancy.degraded`) — **done**;
  3. the D2 reconciler → `tenancy.mode` + `defaultOrgId()` — **done**.
- **Deliberately NOT migrated** (ratified after implementation, not oversights):
  - *SQL driver's tenant-audit gate* keeps reading the env `requested` flag
    (`resolveMultiOrgEnabled()`). The driver is a low-level component that holds
    **no `PluginContext` / service-registry handle**, and the gate governs only a
    *dev-time* "you passed no tenantId" warning — never the enforcement path
    (`applyTenantScope`, which keys off `options.tenantId`). Threading a service
    reference (or an `isolationActive` boolean) down into the driver purely to
    fire a warning is the wrong coupling for the stakes; if ever migrated it
    should be *pushed in* at wiring time, not *pulled* by the driver reaching up.
  - *`serve.ts` boot guard* reads the env flag directly by necessity — it runs
    **before** plugin-auth registers the `tenancy` service (it is the code that
    decides whether to even load the org runtime). `requested` at boot IS the env
    flag; there is nothing to consume yet.
- `resolveMultiOrgEnabled()` remains the *input parser* for the env flag but
  stops being a decision point anywhere outside the tenancy implementation and
  the two boot/driver sites above (which are upstream of, or beneath, the service).

**Rejected alternative:** a kernel-built-in tenancy object. The kernel has no
tenancy concept today and should not grow one for what is an auth/organizations
concern; a service keeps the open-core seam where it already is.

### D5 — Degraded tenancy fails fast

At boot, when `tenancy.requested === true` and the organizations package fails
to load (missing, or its `init()` throws):

- **Default: refuse to boot.** Exit non-zero with an actionable error naming
  the package, the flag, and the two remedies (install the package / unset the
  flag). A deployment that *asked* for tenant isolation and cannot have it
  must not serve traffic pretending otherwise — this is ADR-0049 applied to
  deployment configuration.
- **Escape hatch:** `OS_ALLOW_DEGRADED_TENANCY=1` boots anyway, with
  `tenancy.degraded = true` surfaced where operators actually look **without
  shipping console UI**: a loud red **terminal boot warning** and
  `/auth/config` (`degradedTenancy: true`) for any tooling that reads it.
  Degraded operation becomes a visible, chosen state instead of one buried
  log line.
  - **Descoped: a Setup-dashboard banner.** The earlier draft also promised a
    console banner. That was cut deliberately: it lives in objectui (a separate
    repo/build), and this is an extreme misconfiguration a CE self-host reaches
    only by explicitly opting past a boot-time refusal — the terminal warning
    plus the API flag reach the operator who set the flag. The `degradedTenancy`
    field stays in `/auth/config` (zero-cost, API-visible) so a console *can*
    render a banner later without further framework work, but shipping that UI
    is not part of this ADR.
- **Rollout honesty:** some existing deployments are unknowingly degraded
  today; fail-fast will stop them on upgrade. That is the point — but the
  release notes must say so loudly, and the error message must make recovery
  a two-minute task. Shipping this in a minor release with a prominent
  BREAKING callout is acceptable; shipping it silently is not.
- **Blast radius (verified against the cloud repo):** the guard lives in the
  CLI's `serve.ts`, and the cloud does **not** boot through it — control-plane
  and per-env kernels come from the cloud's own `artifact-kernel-factory`,
  where `@objectstack/organizations` is a bundled workspace dependency that
  cannot fail to import. Self-hosted EE additionally *forces*
  `OS_MULTI_ORG_ENABLED=false` when the multi-org entitlement is absent
  (`objectos-ee/objectstack.config.ts`). The only deployments the guard can
  stop are **misconfigured CE self-hosts** — the flag set, the enterprise
  package absent — which were running with zero isolation while believing
  otherwise. That is precisely the population the guard exists to stop; it
  supports shipping in the next minor rather than waiting for a major.
- **Host-side follow-up (cloud repo):** the cloud's kernel factories carry the
  same silent `catch → warn` degradation pattern this decision removes from
  `serve.ts`. It is unreachable in practice there (bundled dependency), but as
  defense-in-depth the factories should *fail the kernel build* (throw — not
  `process.exit`, which would kill a multi-tenant host serving other envs)
  when multi-org is requested and the plugin cannot load. Tracked as a cloud
  PR alongside this one.

### D6 — Backfill for pre-existing member-less users

> *Amended (D7, one-time pass).* The pass below runs **once per deployment**:
> it records its verdict in the deployment ledger (`sys_migration` row
> `adr-0093-membership-backfill`, `plugin-auth/src/membership-backfill-ledger.ts`),
> and every later pass — the `app:seeded` re-run included — reads the record
> and does nothing. A verdict is recorded when the pass ran, when the policy was
> `invite-only` (so a later switch to `auto` never sweeps those users in), and
> when organizations exist but none is an unambiguous target. Without a readable
> ledger the pass does not run. The `kernel:ready` / `app:seeded` wording below
> describes the triggers; the ledger decides whether a trigger does anything.

On `kernel:ready`, **single mode + `membershipPolicy: 'auto'` only**:

- find users with zero `sys_member` rows (bounded scan, same pattern and
  limits as `backfillOrgAdminGrants`), bind each to `defaultOrgId()` with
  role `member`;
- idempotent, failure-isolated per user, one structured summary log
  (`scanned / bound / skipped`);
- ordered *after* `ensureDefaultOrganization` (which it composes with — the
  platform admin's own bind stays that helper's job, and the yield rule keeps
  them from colliding);
- opt-out: `OS_SKIP_MEMBERSHIP_BACKFILL=1` for operators who curate
  memberships manually.

The backfill **also re-runs on the app plugin's `app:seeded` hook** (#2996).
App seeds insert `sys_user` via a raw `engine.insert`, bypassing the
`user.create.after` reconciler, so seeded users depend on this backfill as
their only net. A seed bundle that overruns its inline budget
(`OS_INLINE_SEED_BUDGET_MS`) finishes in the background *after* `kernel:ready`,
so the one-shot `kernel:ready` pass would miss its users until the next
restart. Re-running when seeding settles closes that window. The re-run keeps
every property above — idempotent, self-guarding (no-op under `invite-only` /
multi-org), and disabled by the same `OS_SKIP_MEMBERSHIP_BACKFILL=1` opt-out.

Multi-org backfill is **refused by design** — there is no correct guess, and a
wrong org assignment in a tenant-isolated deployment is a data-exposure bug,
not a convenience. Multi-org operators repair membership through the existing
admin surfaces.

### D7 — Edge-case ledger

| Case | Ruling |
|:---|:---|
| User already has any membership | Reconciler and backfill always yield (existing rows win — same principle as `ensureDefaultOrganization`) |
| Platform admin bootstrap | Unchanged; `ensureDefaultOrganization` keeps owning the admin's `owner` bind. The reconciler would bind admins as `member` only if the bootstrap hasn't run, and the bootstrap's own yield check makes the sequence safe in either order |
| Phone-only / placeholder-email users | Bind normally — they are teammates; membership is not email-dependent |
| IdP-provisioned (SSO JIT) users | `organizationProvisioning` creates their membership before the reconciler sees them → yield. If JIT ever misses (no domain-matched org in single mode), the reconciler is the net |
| Impersonation sessions | No change — active-org resolution is session-time, membership is create-time |
| User leaves their only org | Allowed today, unchanged. The invariant governs *creation*, not the full lifecycle; a leave-then-rejoin flow is user intent |
| Machine / service accounts | Out of scope now; when a first-class service-account marker exists, it should exempt from auto-bind (tracked as a follow-up, not blocking) |

### D8 — Non-goals (explicit refusals)

1. ~~**Single-org membership still does not gate data access.** RLS stripping
   semantics are untouched; RBAC permission sets remain the single-org access
   authority. Making `sys_member` authorization-relevant in single mode is a
   different, larger decision — refused here to keep this ADR mechanical.~~
   *Reversed 2026-11-11 — see the amendment note at the end of this section.*
2. **The dual frontend flags keep their meaning.** `features.organization`
   (member management available) vs `features.multiOrgEnabled` (org management
   available) is a deliberate cloud ADR-0081 D1/D2 distinction — D1 keeps
   basic member management OPEN, D2 closes multi-org into the enterprise
   `@objectstack/organizations` package; only their *backing
   fact* moves to the tenancy service.
3. **better-auth keeps owning `sys_member` CRUD.** The reconciler writes
   through the system context exactly as `ensureDefaultOrganization` does; no
   new generic-CRUD opening on identity tables (ADR-0092 stands).
4. **No new org-resolution cleverness in multi mode.** Domain matching,
   actor-active-org inheritance, etc. remain the province of the flows that
   have real context (JIT, invites, host hooks).

> **Amendment note (2026-11-11, maintainer ruling 6796108313) — D8.1 reversed: a current membership
> is required for data access under every tenancy posture.** The rule: under every tenancy posture,
> a person's data access requires a current membership in the organization, judged on each request.
> `single` is no longer the exception D8.1 made of it. RBAC permission sets remain the access
> authority *inside* the organization; a current membership is what any of them applies under.
>
> - **One check, every posture.** The organization a session or an API key claims is kept only while
>   a current membership backs it (`vetOrganizationClaim`, `core/src/security/resolve-authz-context.ts`),
>   and that function no longer reads the posture; its third parameter is deprecated and ignored.
>   Membership is read once per request (`resolveUserAuthzGrants` → `accessible_org_ids`, ADR-0091
>   windows applied), so a membership that ends ends access on the next request.
> - **The organization's own wall under `single`.** `single` keeps no wall *between* organizations
>   (ADR-0105 D1). A person who holds no current membership in any organization, save the platform
>   operator, meets the Layer 0 verdict's deny (`computeTenantLayer0Verdict` with
>   `outsideEveryOrganization`, set from `isOutsideEveryOrganization` —
>   `core/src/security/tenant-layer0-verdict.ts` — which the wall's enforcers ask):
>   reads of the organization's tenant rows resolve to nothing and writes are refused
>   `403 PERMISSION_DENIED` naming the membership rule — the answers ADR-0123 already gives, and
>   the ones `isolated` and `group` give the same person. The verdict asks that person the same
>   rungs the walled ladder asks: an object outside tenancy is untouched, and an external object
>   whose organization scope is undeclared is refused (ADR-0015).
> - **Every person context carries the membership.** The predicate reads the membership set the
>   context carries (`accessible_org_ids`), so every person context the platform builds carries the
>   resolver's set: a request's; a flow run's — the two launch doors hand the run the request's, run
>   setup resolves it otherwise (a decider's afresh on a decision), and a run whose set cannot be
>   resolved takes an empty one; and a hook that runs as the user, whose grant seeding resolves it
>   the same way. A membership that cannot be read is not a current one.
> - **What keeps its existing rule.** System contexts. The platform operator (the `PLATFORM_ADMIN`
>   rung): platform standing is the deployment's, not a membership's (ADR-0131 D5). Objects outside
>   tenancy — identity tables and platform-global objects — sit outside the wall under every posture,
>   so a person's own account, session and invitation flows are unchanged. An anonymous guest
>   carries no person (ADR-0138).
> - **API keys.** An API key is its owner's credential (ADR-0090 D10, the 2026-09-16 note): the
>   principal it admits is its owner, so the owner's membership rule is the key's, under every
>   posture.
> - **Delegation.** A delegated operation runs in the live principal's organization only while the
>   delegator's own current membership backs it (ADR-0090 D10), under every posture.
>
> Consequences for this record — who can hold no membership, and what the operator does. Under
> `auto` a person gets a membership at creation (the D2 reconciler, which is best-effort: a failed
> bind logs a warning and never fails the creation) or from the D6 backfill, which runs once per
> deployment and is a no-op on every later trigger, the `app:seeded` re-run included. No later sweep
> exists, deliberately: a scan cannot tell a user who was never bound from a person whose
> membership ended, and binding the second would re-admit a person this rule excludes (D7). So these
> people hold no membership, and with it no data access, until an administrator adds them:
>
> - a user whose creation-time bind failed, or whom the backfill failed to bind;
> - a `sys_user` row inserted directly after the backfill recorded its verdict — an app seed's raw
>   insert bypasses the reconciler, including a seed bundle that finishes in the background after
>   `kernel:ready` recorded it;
> - a user created while the policy was `invite-only` (the recorded verdict means a later switch to
>   `auto` never sweeps them in), and every user of a deployment that runs `invite-only`;
> - every pre-existing member-less user while `OS_SKIP_MEMBERSHIP_BACKFILL=1` is set, or while the
>   ledger cannot be read;
> - a person removed from the organization: D7's "user leaves their only org" row stands as a
>   lifecycle fact, and leaving now also ends data access.
>
> The operator finds them by comparing users with members (Setup → Members, or `sys_user` against
> `sys_member`) and adds each through the member admin surfaces — an invitation, or
> `POST /api/v1/auth/organization/add-member` (platform administrator) — with the membership grade
> that fits the person (D1). The "Deferred" line's D8.1 entry is resolved by this note.

### D9 — The session's active organization is resolved from membership, here

> **This decision is a RECORDING, not a new ruling.** The behaviour below has
> shipped since before this ADR, and nothing about it changes. What changes is
> that it now has an anchor. The code carried it as **"ADR-0081 D1"**, a label
> inherited from **cloud ADR-0081** — *Organization Management — Open Basics,
> Enterprise `@objectstack/organizations`*, Accepted 2026-07-09 in the
> `objectstack-ai/cloud` repo's ADR series (identified 2026-09-04; the same
> record the *Relates to* line names for the default-org bootstrap). Written
> without that qualifier the number collides with this repo's
> [ADR-0081](./0081-trusted-react-page-tier.md) — the trusted `kind:'react'`
> page tier — so a reader following the citation landed in a document about
> React pages with no signal they were in the wrong record; the surviving
> citations elsewhere in this repo now carry the `cloud ` qualifier. The decision is
> restated here because this is the record that owns the fact it depends on:
> `sys_member` and the membership lifecycle (D1/D2).

On session create, plugin-auth stamps the session's `activeOrganizationId` from
the caller's membership. Mechanically (`AuthManager.composeDatabaseHooks` →
`defaultActiveOrg`):

- **Seam.** better-auth's `session.create.before` database hook. A
  host-supplied `session.create.before` chains **first** and keeps precedence,
  exactly as D2's reconciler yields to host hooks on `user.create.after`.
- **Selection.** Owner-preferred, else the oldest `sys_member` row for the
  user — one selection helper, so every call site resolves identically. The
  read runs through the system context, because the caller has no organization
  yet at this point.
- **Only when absent.** A draft session that already carries an
  `activeOrganizationId` is never overwritten.
- **Best-effort.** Failures are swallowed; login never fails on this
  bookkeeping.
- **Opt-out.** `auth.autoActiveOrganization: false` restores raw better-auth
  behaviour (sessions start org-less). Default `true`.
- **Ordering (#8245 / #8247).** The hook settles membership through D2's
  reconciler *before* resolving the organization, so a user's first session is
  not minted tenant-less by a race with better-auth's deferred
  `user.create.after`. This is an ordering change only — same reconciler, same
  policy, same target-org resolution — so it never widens who gets bound.

**Why it lives in this record.** The stamp is a *read* of the invariant D1
states and D2 owns: it can only resolve an organization when a `sys_member` row
exists, and which row exists is entirely decided by D1's policy and D2's
reconciler. Recording it anywhere else would separate the read from the write
that determines it.

**What it does NOT decide.** When no `sys_member` row exists the hook declines,
and the resulting session is authenticated with no active organization. That is
a legal, declared state, and its semantics belong to
[ADR-0123](./0123-no-active-organization-session-semantics.md) — not here. D9
records how the organization is *found*; ADR-0123 governs what happens when
there is none.

## Rollout

| Phase | Contents | Risk |
|:---|:---|:---|
| 0 (shipped) | PR #2882 — endpoint-level bind on `/admin/create-user` | none (idempotent, best-effort) |
| 1 | `tenancy` service + D5 fail-fast (+ `OS_ALLOW_DEGRADED_TENANCY`) | boot-blocking for unknowingly-degraded deployments — release-notes callout required |
| 2 | D2 reconciler (+ `membershipPolicy`), consumers migrate to `tenancy`, retire the #2882 endpoint bind and extend coverage to `/admin/import-users` for free | low — yield rule + idempotency make double-coverage safe during the transition |
| 3 | D6 backfill + docs (deployment guide: tenancy modes, membership policy, degraded state) | low — bounded, opt-out |

Phases 1 and 2 are independently shippable; 1 first is recommended because the
reconciler (2) consumes the service (1), and because 1 closes the only
security-relevant gap.

## Consequences

**Positive.** The membership invariant becomes unforgeable-by-omission — future
creation paths inherit it. Tenancy mode becomes a declared, queryable fact with
one implementation; the security-relevant "degraded" state becomes impossible
to enter silently. The class of bug behind PR #2882 is closed, not patched.

**Negative / accepted.** One more kernel service and one more config knob
(`membershipPolicy`). Fail-fast will halt upgrades for deployments that were
silently degraded — accepted deliberately; the alternative is leaving them
believing they are tenant-isolated. The reconciler adds one indexed read per
user creation (negligible; creation is rare and already multi-write).

**Deferred.** Service-account exemption (D7); any authorization role for
single-org membership (D8.1 — resolved 2026-11-11, see the D8 amendment note);
multi-org target-org policy beyond "don't guess" (D8.4).
