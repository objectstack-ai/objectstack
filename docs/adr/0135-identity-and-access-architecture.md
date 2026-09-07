# ADR-0135: Identity and access architecture — the open half, mirrored from cloud ADR-0024

**Status**: The DECISION is Accepted — it is `objectstack-ai/cloud` ADR-0024, accepted there on
2026-06-25, and its mechanism half is implemented in this repository today. ⚠️ This **file** is a
mirror awaiting the maintainer's hand-merge (`docs/adr/**` is a governed surface, AGENTS.md Prime
Directive #14), so merging it settles the RECORD, not the decision. ⛔ Nothing below is decided
here: a clause that cloud ADR-0024 did not decide is not decided by this file either.
**Decided**: 2026-06-25, by the founder, in `objectstack-ai/cloud`
`docs/adr/0024-identity-and-access-architecture.md` (Status: Accepted there).
**Mirrored**: 2026-09-07, under the maintainer's ruling of 2026-09-02 on
[#14496](https://github.com/objectstack-ai/objectstack/issues/14496) — verbatim and untranslated,
「ok」 to option 2: mirror the open half, ⛔ do not move files, ⛔ do not renumber. Recorded by
[#14506](https://github.com/objectstack-ai/objectstack/issues/14506).
**Shape**: [ADR-0079](./0079-record-display-name.md) — the same cross-repo split, the same
Provenance-section discipline.
**Builds on**: [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (the one
platform-admin derivation this record's D5 leans on), [ADR-0092](./0092-sys-user-profile-field-delegation.md)
(the identity write guard that keeps the generic data path out of a better-auth table),
[ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) and
[ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (membership lifecycle and
org scope), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) and
[ADR-0108](./0108-membership-grade-is-not-a-capability-channel.md) (authorization is derived in
the environment, and a membership grade is not a capability channel).
**Consumers**: `@objectstack/plugin-auth` (the whole package), `@objectstack/platform-objects`
(the `identity/` object set), `@objectstack/core` (`security/resolve-authz-context.ts`).

---

## Provenance — read this before citing this file

**This file records, in this repository, decisions taken in `objectstack-ai/cloud` ADR-0024 on
2026-06-25.** The cloud record is the original. It is not superseded, not moved and not
renumbered; it keeps the commercial half of the same decision, and where this file and the cloud
record differ, **the cloud record is the decision and this file is the bug** — say so in an issue
and this file gets corrected.

Three facts make that disclosure load-bearing rather than decorative.

1. **Why the record is split at all.** AGENTS.md Prime Directive #13 states the rule this file
   obeys: *an ADR lives in the repository whose code it governs*; decisions that draw the
   open/closed or commercial boundary live in `cloud`, and when such a decision's **mechanism
   half** governs open code here, this repository carries its own ADR with its own number, a
   Provenance section naming the cloud record and its date, and the commercial half left where it
   was. That rule was itself adopted by the 2026-09-02 ruling cited above.

2. **This file was written from the cloud record's decision list and from the code that
   implements it**, by a seat that could not open the `cloud` repository. What is quoted here is
   quoted from *this* tree; what is attributed to cloud ADR-0024 is attributed at the granularity
   the ruling's execution card carried (its decision letters and their headings), never at
   sentence granularity. Every mechanism claim below carries a symbol anchor into this tree, so a
   reader can check the mechanism half without cloud access. The attribution half is what cloud
   access would check.

3. **⚠️ A bare `ADR-0024` in this repository's code does NOT resolve to this record — it never
   did, and this file does not change that.** `docs/adr/0024-mcp-connectors.md` is a real,
   unrelated record in this registry, and the two numbering series are independent, which is
   exactly why AGENTS.md forbids the bare form and requires `cloud ADR-NNNN`. The same trap sits
   one number away: cloud ADR-0071 is the env-side SCIM mechanism, while this registry's `0071`
   is the dataset semantic-layer depth record. Re-pointing the identity surface's existing bare
   citations at this record is
   [#14361](https://github.com/objectstack-ai/objectstack/issues/14361)'s job and ⛔ was
   deliberately not done in the change that added this file: on the commit that introduced it,
   `git grep -n -E "ADR-0024" -- packages/plugins/plugin-auth/src packages/platform-objects/src/identity`
   minus the `cloud ADR-0024` spellings still measured **64** citing lines.

---

## Context

An ObjectStack environment is a running system with its own database, its own metadata and its
own users. Two questions had to be answered together, and answering either one alone produces an
architecture that cannot hold: **where does an identity come from**, and **where is the decision
made about what that identity may do**.

The tempting answer for a multi-environment product is one central directory: users sign in once,
the platform knows everybody, environments ask it. That answer forecloses the two properties this
platform is built to keep — an environment that can be self-hosted with no vendor in the loop,
and a customer whose employees already live in the customer's own identity provider. cloud
ADR-0024 chose the other direction, and the mechanism half of that choice is what this repository
implements: authentication runs *in* the environment, federation is something the environment's
operator configures, and authorization is never delegated at all.

---

## Decision

Each clause below is cloud ADR-0024's, restated in this repository's words, with the code that
enforces it. The lettering is the cloud record's, kept so that a citation of `cloud ADR-0024 D5.2`
and a citation of this record's D5.2 name the same clause.

### D1 — Identity is per-environment, and never centralised

Every environment authenticates its own users. The authentication stack runs **inside** the
environment process; there is no central authentication service that an environment must reach in
order to sign a user in. An environment cut off from every other ObjectStack deployment still
works.

The mechanism is better-auth, mounted by the environment's own plugin
(`packages/plugins/plugin-auth/src/auth-plugin.ts#AuthPlugin`) and built in-process
(`packages/plugins/plugin-auth/src/auth-manager.ts#AuthManager`). It persists through the
environment's **own** data engine rather than any remote store: the vendor's model names are
bridged onto this platform's system objects by
`packages/plugins/plugin-auth/src/objectql-adapter.ts#AUTH_MODEL_TO_PROTOCOL`, so the directory is
a set of tables in the environment's database.

### D2 — Two user populations, two sources of truth

The people who reach an environment are not one population. Some identities are **owned by an
external directory** — an identity provider the operator registered; others are **the
environment's own**. Each population keeps its own source of truth, and the platform does not
collapse the two into a single authority: the environment's tables hold a row for both, but for a
managed identity that row is a mirror, and the directory that owns it remains the authority for
the facts it owns.

The distinction is a first-class column, not an inference:
`packages/platform-objects/src/identity/sys-user.object.ts#source` carries exactly two values,
`idp_provisioned` and `env_native`, and its declaration states the split it exists for —
federated-SSO JIT provisioning on one side, local signup and app end-users on the other. The
provider links that justify a value live in
`packages/platform-objects/src/identity/sys-account.object.ts`.

### D4 — Source-of-truth marking: managed vs env-native

Which side of D2 a row is on must be **marked**, and the marking must be produced by the system
rather than typed by an operator, because everything downstream gates on it.

Two markings do that work, at two levels:

- **The table** is marked as owned by the auth vendor —
  `packages/platform-objects/src/identity/sys-user.object.ts#managedBy`,
  `packages/platform-objects/src/identity/sys-member.object.ts#managedBy`,
  `packages/platform-objects/src/identity/sys-sso-provider.object.ts#managedBy` all declare
  `better-auth`. Under [ADR-0092](./0092-sys-user-profile-field-delegation.md) that declaration is
  what makes the generic data path fail-closed on those tables.
- **The row** is marked with its provenance — `sys_user.source`, stamped automatically as accounts
  are linked and never edited by hand. Two writers keep it true, because the two creation paths do
  not share a seam: better-auth's `account.create.after` hook in
  `packages/plugins/plugin-auth/src/auth-manager.ts`, and an ObjectQL `afterInsert` hook on
  `sys_account` in `packages/plugins/plugin-auth/src/auth-plugin.ts` for adapter-level creates
  that bypass the vendor hook. Both are idempotent, both fail open on the write, and both log
  loudly when the stamp does not land — a row that silently keeps the wrong `source` is how a
  managed user is offered the local-password action D5.2 exists to hide.

### D5 — Identity comes from the IdP; authorization is decided in the environment

Authentication may be delegated. **Authorization never is.** What a signed-in principal may do is
derived from the environment's own grant tables at the moment it is asked, from evidence the
environment stores — never from a claim the identity provider asserted, and never from a role
string carried in on a token.

`packages/core/src/security/resolve-authz-context.ts#resolveUserAuthzGrants` is that derivation,
and `#hasPlatformAdminStanding` is its id-shaped projection: platform standing is an unscoped,
in-window `sys_user_permission_set` grant of `admin_full_access`, held now — the ADR-0068 D2
definition, read from this environment's tables. Organization grade is read the same way, from
`sys_member`, through the one predicate every consumer asks
(`packages/plugins/plugin-auth/src/invitation-role-cap.ts#isOrgAdminGrade`), and
`packages/plugins/plugin-auth/src/member-role-canonical.ts#registerMemberRoleCanonicalization`
normalises the stored spelling before any guard judges it.

### D5.2 — The local user-management surface under SSO, split by population

An environment that has adopted SSO still needs a user-management surface, and that surface is
**split by the D2/D4 population**, not switched off wholesale:

- **Managed identities hold no local credential**, so the actions that would mint or change one
  are hidden for them rather than merely failing:
  `packages/platform-objects/src/identity/sys-user.object.ts#change_my_password` and
  `#change_my_email` are visible only when the row's `source` is not `idp_provisioned`. The point
  is not tidiness — a managed user who could self-mint a password would have a route around
  enforced SSO.
- **Break-glass keeps a local credential reachable.** An environment-native owner, or an
  SSO-onboarded user setting an *initial* password, goes through
  `packages/plugins/plugin-auth/src/set-initial-password.ts#runSetInitialPassword`; the admin-side
  equivalent is `packages/platform-objects/src/identity/sys-user.object.ts#set_user_password`.
  Gaining a local credential flips the row back to `env_native` (D4's stamp), so the owner never
  loses self-service password management.
- **An environment may never be left with zero administrators who can sign in.**
  `packages/plugins/plugin-auth/src/last-admin-guard.ts#registerLastAdminGuard` holds that
  invariant across every write shape that could take the last administrator away — a ban, a row
  delete, and the revocations that leave the user row untouched — and it refuses for **every**
  context, `isSystem` included, because the paths that actually lock an organization out are the
  system ones.

### D6 — SSO per production environment, configured in the environment

A production environment federates login to the customer's own identity provider, and that
federation is **configured in the environment** by its operator — not provisioned centrally.

`packages/platform-objects/src/identity/sys-sso-provider.object.ts#SysSsoProvider` is the
registered-provider table, backed by `@better-auth/sso`, env-global and admin-only. Every mutation
routes through the vendor's own endpoints rather than the generic data layer, so config validation
and secret handling run: `packages/plugins/plugin-auth/src/register-sso-provider.ts`, with the
model bridged at the adapter layer (`packages/plugins/plugin-auth/src/auth-schema-config.ts`
records why the bridge sits there and not on the plugin's `schema` option).

**Domain verification is opt-in** — the clause this repository's code cites as `ADR-0024 ②`. When
the environment turns it on, `@better-auth/sso` mounts a DNS-TXT proof-of-ownership challenge and
refuses a login through a provider whose email domain is not proven, which stops an organization
admin from registering a provider for a domain they do not control. It is off by default, because
turning it on changes the register-then-login flow. The surface is
`packages/platform-objects/src/identity/sys-sso-provider.object.ts#request_domain_verification`,
`#verify_domain` and `#domain_verified`.

⚠️ **The SCIM half of "SSO + SCIM per production environment" is not restated here.** Its
mechanism record is `cloud ADR-0071`, mirrored into this repository by its own card; this file
records only that the same environment-side posture applies to it — the SCIM models are bridged
into the environment's tables by the same adapter map D1 names, and the D5.2 guard judges a SCIM
deprovision exactly as it judges an admin one.

### D7 — Portability and self-host are preserved

Nothing above requires the vendor's cloud. Every mechanism in D1–D6 is in this repository under
Apache-2.0, and each optional piece is switched on by an environment variable in a self-hosted
deployment — `OS_SSO_ENABLED` for the external-IdP relying party,
`OS_SSO_DOMAIN_VERIFICATION` for D6's opt-in check — resolved in
`packages/plugins/plugin-auth/src/auth-manager.ts`. A self-hosted environment therefore reaches
the same identity architecture as a hosted one; what a hosted environment adds is entitlement and
lifecycle, which is cloud ADR-0024's half.

### D9 — Environment users live in the environment; organization membership goes through better-auth

A user of an environment is a row in that environment's `sys_user`, and their membership of an
organization is a row in that environment's `sys_member` — backed by better-auth's organization
plugin (`packages/platform-objects/src/identity/sys-member.object.ts#SysMember`), reached through
the same adapter bridge as every other identity model
(`packages/plugins/plugin-auth/src/objectql-adapter.ts#AUTH_MODEL_TO_PROTOCOL`). Membership is
therefore maintained by the auth stack's own endpoints, and read — never re-spelled — by the
guards that judge administrative standing.

---

## What stays in `cloud` ADR-0024

These clauses are the same decision's commercial half. They are **not** recorded here, and code in
this repository that means one of them must keep citing `cloud ADR-0024`:

| Clause | Subject |
|---|---|
| D3 | cloud-as-IdP hub |
| D5.1 | the cloud operator-portal membership gate |
| D8 | billing |
| D10 | production/development metering and population lifecycle |
| V1 | the roadmap and the commercial framing |

⚠️ Consequence for [#14361](https://github.com/objectstack-ai/objectstack/issues/14361): a bare
`ADR-0024` citation in this tree is **not** mechanically re-pointable at this record. Some of
today's citations mean a clause above — `packages/plugins/plugin-auth/src/auth-manager.ts` cites
`ADR-0024 V1` for the SSO default-role provisioning — and those keep the `cloud ADR-0024`
spelling. The re-pointing is per-site and semantic.

## What this record does NOT settle

- **Anything cloud ADR-0024 did not decide.** This file adds no clause. Where the mechanism in
  this tree is richer than the decision (the ADR-0092 write guard, the ADR-0095 tenant wall, the
  ADR-0091 validity window), that richness belongs to those records, and is cited here only as the
  thing D4 and D5 lean on.
- **The attribution itself, against the cloud original.** See Provenance point 2: this file was
  written without cloud access. A difference between it and cloud ADR-0024 is this file's bug.
- **The SCIM mechanism** — `cloud ADR-0071` and its own mirror record.
- **Whether any individual bare `ADR-0024` citation should move.** That is #14361's per-site call,
  and the table above is why it cannot be a search-and-replace.

## Consequences

- A reader who follows an `ADR-0024` citation out of `plugin-auth` or `platform-objects/identity`
  now has somewhere in *this* registry to land — once #14361 re-points the citations that mean the
  open half. Until then the citation still resolves to `docs/adr/0024-mcp-connectors.md`, which is
  the defect this record is a precondition for fixing, not one it fixes by itself.
- The open half of the identity architecture becomes reviewable by anyone who can read this
  repository, including a self-hosting customer who has no access to `cloud`.
- `cloud` ADR-0024 gains a one-line pointer naming this record's number — filed as a `cloud` chore
  by the seat that accepts this PR, since the number is only knowable once this file merges.
