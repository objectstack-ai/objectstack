# ADR-0134: Env-side SCIM provisioning — `@better-auth/scim` is the mechanism, and this platform writes the deactivation

**Status**: Proposed (2026-09-07). This file is a **MIRROR** of the open, mechanism half of
`cloud ADR-0071` (*Enterprise Identity — SCIM v1*, `cloud:docs/adr/0071-enterprise-identity-scim-v1.md`,
Status there: **Proposed**, 2026-06-27, founder to accept). It is Proposed for the same reason the
original is, and it additionally awaits this repo's own hand-merge, which is the acceptance act for a
governed surface (Prime Directive #14). ⛔ **Merging this file does not accept the cloud decision** —
acceptance stays with the founder, in `cloud`.
**Original decision**: `cloud ADR-0071`, 2026-06-27, entered the `cloud` repo through its PR #2356.
**Mirrored by**: [#14507](https://github.com/objectstack-ai/objectstack/issues/14507), under the
maintainer's 2026-09-02 ruling on [#14496](https://github.com/objectstack-ai/objectstack/issues/14496)
(verbatim, untranslated: 「ok」 to option 2 — 镜像开源半边，⛔ 不搬文件、⛔ 不重编号).
**Precedent for the shape**: [ADR-0079](./0079-record-display-name.md), the first record in this repo
written from a decision whose contemporaneous original lives in `cloud`.
**Consumers**: `@objectstack/plugin-auth` (`packages/plugins/plugin-auth/src/auth-manager.ts`,
`packages/plugins/plugin-auth/src/scim-connection-service.ts`,
`packages/plugins/plugin-auth/src/user-ban-write.ts`,
`packages/plugins/plugin-auth/src/last-admin-guard.ts`,
`packages/plugins/plugin-auth/src/admin-ban-endpoints.ts`), `@objectstack/platform-objects` (the eight
`sys_scim_*` identity objects), `@objectstack/spec` (`packages/spec/src/system/auth-config.zod.ts`,
`packages/spec/src/identity/scim.zod.ts`).

---

## Provenance — read this before citing this file

**The decision recorded here was not taken here.** It was taken on **2026-06-27** in the sibling
`objectstack-ai/cloud` repository, as `cloud ADR-0071`, and it covers more than this file does. This
file restates only the half whose **mechanism is open-source code in THIS repository**, in this
repository's own words, with an anchor into the code for every clause.

Four facts make that disclosure operational rather than decorative:

1. **`ADR-0071` is an ambiguous string in this repo, and this file does not fix that.**
   `docs/adr/0071-*` here is [ADR-0071 — Dataset semantic-layer depth](./0071-dataset-semantic-layer-depth.md),
   an unrelated record. Identity code that writes a bare `ADR-0071` today therefore cites, by this
   repo's own convention, the wrong document. **Always write `cloud ADR-0071` for the SCIM record**,
   and `ADR-0134` for this one. Re-pointing the existing bare citations is
   [#14361](https://github.com/objectstack-ai/objectstack/issues/14361)'s work and is deliberately
   ⛔ **not** done by this file.

2. **The commercial half stays in `cloud` and is NOT restated here.** See
   [What stays in the cloud record](#what-stays-in-the-cloud-record). Where this file and the cloud
   original differ, **the cloud original is the decision** and this file is the bug — file an issue and
   this file gets corrected.

3. **This file was written without opening the cloud original.** Its author had no read access to
   `objectstack-ai/cloud`. Every clause below was written from (a) the enumeration of the cloud record's
   open half carried on [#14507](https://github.com/objectstack-ai/objectstack/issues/14507), and (b)
   **first-hand reading of the implementing code and of the pinned vendor package in this tree**. Treat
   the *emphasis and phrasing* as this author's; the *code anchors* are checked mechanically by
   `pnpm check:adr-symbol-anchors`.

4. **⛔ Nothing is decided here that the cloud record did not decide.** Where this platform's
   enforcement has moved since 2026-06-27 — and on the deactivation path it has — the movement is
   recorded as a **fact about the mechanism**, in
   [The vendor-version fact, measured](#the-vendor-version-fact-measured), not as a new decision.

---

## Context

SCIM 2.0 (RFC 7643 / RFC 7644) is how an enterprise identity provider — Okta, Microsoft Entra,
OneLogin — pushes user and group lifecycle into an application: create on hire, update on move,
deactivate on leave. Without it, an enterprise buyer's offboarding is a manual checklist, which is
exactly the control their auditors ask about.

Two questions had to be settled before any of it could be built, and they are the two this mirror
carries: **who implements the SCIM Service Provider**, and **where it runs**. Everything downstream —
which tables exist, which endpoints mount, what a deactivation means — follows from those.

The V1 scope was deliberately narrow: one organization, users and their enabled/disabled state, with
group-driven authorization left as a declared seam rather than a half-built feature.

---

## Decision

The numbering is the cloud record's, kept so a reader can hold the two documents side by side. D5, D6
and the closed half of D7 are **not** restated — see
[What stays in the cloud record](#what-stays-in-the-cloud-record).

### D1 — Adopt `@better-auth/scim` as the mechanism; do not build a SCIM server

SCIM 2.0 is a large, fussy protocol (filter grammar, PATCH path expressions, ETag concurrency,
ListResponse pagination, per-provider ingress quirks). This platform **consumes** an implementation of
it and owns the integration, never the protocol engine.

- The plugin is mounted from `@better-auth/scim` inside `packages/plugins/plugin-auth/src/auth-manager.ts`,
  behind the single effectiveness predicate `packages/plugins/plugin-auth/src/auth-manager.ts#resolveScimEnabled`.
- The library's seven models are **bridged**, not reimplemented: they are declared as platform objects
  (`packages/platform-objects/src/identity/sys-scim-user.object.ts#SysScimUser`,
  `packages/platform-objects/src/identity/sys-scim-subject.object.ts#SysScimSubject`,
  `packages/platform-objects/src/identity/sys-scim-group.object.ts#SysScimGroup`,
  `packages/platform-objects/src/identity/sys-scim-group-member.object.ts#SysScimGroupMember`,
  `packages/platform-objects/src/identity/sys-scim-projection-grant.object.ts#SysScimProjectionGrant`,
  `packages/platform-objects/src/identity/sys-scim-identity-tombstone.object.ts#SysScimIdentityTombstone`,
  `packages/platform-objects/src/identity/sys-scim-connection-binding.object.ts#SysScimConnectionBinding`)
  and mapped camelCase → snake_case by
  `packages/plugins/plugin-auth/src/objectql-adapter.ts#AUTH_MODEL_TO_PROTOCOL`. Every one of them
  carries `managedBy: 'better-auth'` and a full schema lock: the vendor owns their shape.
- The one table this platform owns outright is the credential store behind the app-owned bearer
  verifier — `packages/platform-objects/src/identity/sys-scim-connection-credential.object.ts#SysScimConnectionCredential`,
  minted and verified by `packages/plugins/plugin-auth/src/scim-connection-service.ts#verifyScimBearerToken`,
  which persists only a keyed one-way digest.
- The SCIM vocabulary this platform states in its own spec is the **protocol schema constants**, not an
  engine: `packages/spec/src/identity/scim.zod.ts#SCIM_SCHEMAS`.

**Consequence accepted with the decision:** the vendor's behaviour is a moving input, not a constant.
See [The vendor-version fact, measured](#the-vendor-version-fact-measured) — that section exists because
this decision put a third party on the deactivation path.

### D2 — The SCIM Service Provider lives in the ENV, never in the cloud control plane

The environment that holds the users **is** the SCIM Service Provider. The IdP points its provisioning
connector at the deployment itself. There is no cloud-side SCIM relay, and no shape in which a
cloud-managed deployment and a self-hosted one differ on this: **the mechanism is identical, and it is
in this repository.**

- The protocol surface mounts inside the env's own auth route, under the prefix
  `packages/plugins/plugin-auth/src/auth-manager.ts#SCIM_PROTOCOL_PATH_PREFIX`, and requests are
  recognised as protocol traffic by `packages/plugins/plugin-auth/src/auth-manager.ts#isScimProtocolPath`.
- It is switched per environment, by the operator, without touching the application bundle: the
  authorable key `packages/spec/src/system/auth-config.zod.ts#scim` is tri-state, and when it is left
  unset the `OS_SCIM_ENABLED` environment variable decides (absent ⇒ off). An explicit value in the
  bundle wins over the env var (maintainer ruling 2026-08-31); the resolution has exactly one
  implementation, `packages/plugins/plugin-auth/src/auth-manager.ts#resolveScimEnabled`.
- Connections are **runtime data, not boot config**: the bearer token presented by the IdP is resolved
  against a `sys_scim_connection_credential` row at request time by
  `packages/plugins/plugin-auth/src/scim-connection-service.ts#verifyScimBearerToken`. A deployment
  therefore onboards an IdP without a redeploy and without a central registry.

### D3 — Single-organization mode; deactivate with `active:false`, never `DELETE`

**One provisioning domain per environment in V1.** The SCIM tables carry no organization column: they
are scoped by connection and provisioning domain. The single optional organization pointer in the whole
family is on the platform-owned credential row
(`packages/platform-objects/src/identity/sys-scim-connection-credential.object.ts#organization_id`,
described in code as the scope "when provisioning is org-scoped") — a declared seam for a later
multi-organization mode, not a V1 capability.

**Deprovisioning removes the membership and keeps the user record.** A departed identity is
*disabled*, not erased: audit trails, ownership stamps and history must keep resolving to a real user
row. Concretely, on the pinned vendor (measured below):

- `active: false` on a SCIM `/Users` resource ⇒ the account is **disabled** and its sessions are
  **revoked**.
- A SCIM `DELETE /Users/{id}` does **not** delete the platform user. The vendor tombstones the SCIM
  source (`packages/platform-objects/src/identity/sys-scim-identity-tombstone.object.ts#SysScimIdentityTombstone`),
  which leaves the user with no active source; the aggregate turns inactive and the deprovision arrives
  through the **same** disable path as `active: false`. Re-provisioning the same external identity is
  recognised through the tombstone and re-links the same user.

**⭐ The disable is written by THIS platform, not by the vendor.** This is the clause the mirror exists
to state correctly, and it is the one place where the cloud record's 2026-06-27 wording no longer
describes the mechanism (see the next section for the measurement). As enforced here:

- `packages/plugins/plugin-auth/src/auth-manager.ts#reconcileScimUserLifecycle` is this platform's
  implementation of the vendor's optional `identity.reconcileUser` host hook. It receives the aggregate
  lifecycle state inside the vendor's transaction and lands the disable through
  `packages/plugins/plugin-auth/src/user-ban-write.ts#applyUserBan`, stamped with
  `packages/plugins/plugin-auth/src/user-ban-write.ts#SCIM_DEACTIVATION_BAN_REASON`. Reactivation lifts
  **only** a ban carrying that reason (`packages/plugins/plugin-auth/src/user-ban-write.ts#applyUserUnban`);
  an administrator's ban is not the IdP's to lift.
- That write is **field for field** the write the `admin` mount makes
  (`packages/plugins/plugin-auth/src/admin-ban-endpoints.ts#runAdminBanUser`,
  `packages/plugins/plugin-auth/src/admin-ban-endpoints.ts#runAdminUnbanUser`), sharing one callable
  (`packages/plugins/plugin-auth/src/user-ban-write.ts#UserBanWriter`) — so the `admin` plugin's
  sign-in refusal enforces both halves identically. This is why **effective SCIM still requires the
  `admin` plugin**: it supplies the column and the refusal, even though it no longer supplies the
  writer. `packages/plugins/plugin-auth/src/auth-manager.ts#assertScimAdminCoherence` refuses, loudly
  and at construction, the one incoherent corner — effective SCIM beside an explicit
  `packages/spec/src/system/auth-config.zod.ts#admin` of `false`.
- The break-glass last-administrator guard
  (`packages/plugins/plugin-auth/src/last-admin-guard.ts#registerLastAdminGuard`, `cloud ADR-0024` D5.2)
  is an **engine** hook on the user table, so it judges the SCIM write exactly as it judges the admin
  mount's: an IdP that deactivates the last administrator gets a SCIM error, and the account stays
  enabled. Because the vendor runs the host hook inside its transaction, the vendor's own
  `active: false` write rolls back with the refusal — the SCIM resource keeps reading `active: true`
  for the account that stayed enabled.

**The sentence a code comment should carry, in place of "runs through the better-auth admin plugin":**

> A SCIM `active: false` disables the account through **this platform's** `identity.reconcileUser` hook
> (`auth-manager.ts` → `user-ban-write.ts`, ADR-0134 D3); the `admin` plugin supplies the column and the
> `BANNED_USER` sign-in refusal, and the vendor revokes the sessions.

### D4 — V1 provisions the default standing; group→role mapping is a declared, unwired seam

An IdP-provisioned user arrives with the deployment's **default standing** and nothing more. No SCIM
fact is read as an authorization grant in V1.

The seam is real and is deliberately left empty, on both sides:

- **Vendor side.** `@better-auth/scim` exposes an optional role projection on its options — an
  application supplies a mapper from a SCIM authorization source to opaque application role slugs, plus
  an existence check. `packages/plugins/plugin-auth/src/auth-manager.ts` passes **no** projection member
  to `scim({...})`; it passes connections, the bearer authentication callback, and the identity hook of
  D3, and nothing else.
- **Platform side.** The group and grant tables are provisioned and kept in sync by the vendor
  (`packages/platform-objects/src/identity/sys-scim-group.object.ts#SysScimGroup`,
  `packages/platform-objects/src/identity/sys-scim-group-member.object.ts#SysScimGroupMember`,
  `packages/platform-objects/src/identity/sys-scim-projection-grant.object.ts#SysScimProjectionGrant`),
  and **no ObjectStack code reads them**. An IdP may push groups; they land, they are visible, and they
  grant nothing.

That is the decision, not an oversight: a group→role mapping is an authorization contract, and V1
declines to invent one. Filling the seam is a later decision with its own record.

### D7 (open half) — SCIM conformance / smoke coverage runs in this repo's CI

The half of D7 whose mechanism is open code: **the provisioning surface is exercised by tests that run
in this repository's ordinary CI test lane** (`.github/workflows/ci.yml`), against the real vendor —
not by a hand-maintained description of what it should do.

The coverage that discharges it today:

- `packages/plugins/plugin-auth/src/scim-deactivation-reconcile-user.test.ts` — the D3 lifecycle end to
  end through `@better-auth/scim` itself over a real engine: disable, re-enable, and the last-
  administrator refusal with its positive control.
- `packages/plugins/plugin-auth/src/scim-transaction-scope.test.ts` — that a SCIM protocol request
  really opens an engine transaction, so the D3 rollback is a fact and not a hope.
- `packages/plugins/plugin-auth/src/scim-case-insensitive-identifier.test.ts` — identifier handling at
  the protocol ingress.
- `packages/plugins/plugin-auth/src/better-auth-schema-parity.test.ts` — that the bridged `sys_scim_*`
  objects still mirror the installed vendor schema, which is what makes D1's "bridge, do not
  reimplement" checkable rather than aspirational.
- `packages/plugins/plugin-auth/src/credential-at-rest-posture.test.ts` — that the D2 connection
  credential is never stored recoverably.

⚠️ **Stated honestly:** there is no separate SCIM conformance *harness* in this repo, and no run of a
third-party SCIM compliance suite. The open half of D7 is discharged by the named package tests above.
A real-IdP end-to-end run is the closed half and stays in `cloud` — see below.

---

## The vendor-version fact, measured

D1 put a third party on the deactivation path, so the mechanism's truth is a **version fact** and has to
be dated. The cloud record of 2026-06-27 describes deactivation as `active:false` → ban via the admin
plugin → session revocation. That was true of the vendor **then** and is **not** true of the vendor
**now**.

Measured 2026-09-07, in this worktree, on the packages themselves (not on any prior report):

| `@better-auth/scim` | occurrences of the substring `ban` in `dist/index.mjs` | `identity.reconcileUser` host hook |
| --- | --- | --- |
| 1.6.30 (last 1.6.x published; 1.6.31 is a 404) | **14** — including `resolveSCIMActiveDeactivation`, which sets `banned: true` and `banReason` to the literal `Deactivated via SCIM` | absent |
| 1.7.0 | **0** | present |
| 1.7.1 | **0** | present |
| **1.7.2 — the version pinned by this repo** | **0** | present |

The pin: `packages/plugins/plugin-auth/package.json` declares `^1.7.2` and `pnpm-lock.yaml` resolves it
to exactly **1.7.2**; the installed package's own `package.json` reports `1.7.2`.

At 1.7.2 the vendor's reconciliation path calls the optional host hook `identity.reconcileUser` with the
aggregate state and then, when the aggregate is inactive, deletes the user's sessions. **It writes no
ban.** Read as a decision boundary:

- **The decision is unchanged.** `active:false` still means *account disabled + sessions revoked*, and
  `DELETE` still never erases the user.
- **The author of the disable moved**, from the vendor to this platform, and this repo has taken that
  half back: `packages/plugins/plugin-auth/src/auth-manager.ts#reconcileScimUserLifecycle` +
  `packages/plugins/plugin-auth/src/user-ban-write.ts#applyUserBan`, judged at the engine by the
  break-glass guard. Nothing here defers to
  [#14360](https://github.com/objectstack-ai/objectstack/issues/14360): the wiring is on `main` and the
  measurement above is this file's own.
- **Session revocation stayed with the vendor** and is deliberately not part of this platform's ban
  write; the admin mount revokes explicitly instead.

⛔ Do not "simplify" this record by deleting the version column. A record that says only "the admin
plugin bans" reads as current, and it is the exact sentence that let an IdP deactivation land as a
no-op once already.

---

## What stays in the cloud record

Cited as `cloud ADR-0071`, ⛔ never restated here and ⛔ never given an `ADR-0134` number:

- **D5 — the open/closed boundary**: which part of Enterprise Identity is open mechanism and which part
  is closed governance.
- **D6 — the commercial repositioning**: paid Enterprise Identity is *governed / supported / auditable*
  SCIM, not "SCIM at all".
- **The closed half of D7**: the real-IdP end-to-end run against `cloud`'s staging environment.
- **The Enterprise Identity pillar framing** the record sits inside.

A one-line pointer from `cloud ADR-0071` back to this number is filed by the seat that accepts this
file, ⛔ not by this file.

## Non-goals

- ⛔ **Not** a re-decision. Every clause above is `cloud ADR-0071`'s, restated with this repo's anchors.
- ⛔ **Not** the citation repair. The bare `ADR-0071` references in identity code and generated docs are
  [#14361](https://github.com/objectstack-ai/objectstack/issues/14361)'s work.
- ⛔ **Not** a multi-organization SCIM design, and ⛔ not a group→role authorization model. Both are D3's
  and D4's declared seams; filling either is a new decision.
- ⛔ **Not** a narrowing of SCIM's dependency on the `admin` plugin. Whether the dependency can shrink to
  the actions it actually needs is measured separately by
  [#14150](https://github.com/objectstack-ai/objectstack/issues/14150).

## References

- `cloud ADR-0071` — *Enterprise Identity — SCIM v1*
  (`cloud:docs/adr/0071-enterprise-identity-scim-v1.md`), 2026-06-27. The original decision.
- `cloud ADR-0024` D5.2 — break-glass, the invariant the last-administrator guard enforces.
- [ADR-0079](./0079-record-display-name.md) — the precedent for a record written here from a `cloud`
  original, and for this file's Provenance section.
- [ADR-0071](./0071-dataset-semantic-layer-depth.md) — **an unrelated record that happens to hold this
  repo's number 0071.** Named here so nobody resolves `ADR-0071` to it by accident.
- [#14496](https://github.com/objectstack-ai/objectstack/issues/14496) — the mirror-or-move ruling.
  [#14507](https://github.com/objectstack-ai/objectstack/issues/14507) — this file's card.
