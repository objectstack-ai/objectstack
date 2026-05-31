# ADR-0019: App as the Consumer-Facing Unit

**Status**: Proposed (v3 — narrowed to the consumer-surface decision)
**Date**: 2026-05-31
**Deciders**: ObjectStack Protocol Architects
**Builds on**: ADR-0003 (Package as First-Class Citizen), ADR-0006 (Three-Layer Tenancy), ADR-0016 (Studio Package Authoring & Publish)
**Consumers**: `@objectstack/spec/kernel` (`plugin.zod.ts`), `@objectstack/spec/cloud` (`marketplace.zod.ts`), the Console `marketplace` UI, the Studio publish flow, `docs/design/marketplace-publishing.md`

> **Revision history**
> - **v1/v2** explored a much larger scheme: a metadata/code *plane* split,
>   a "consumer App must be pure metadata" mandate (D6), a capability-by-
>   reference contract (D7), and auto-reviewed Marketplace trust lanes.
> - **v3 deliberately narrows this ADR to its one cheap, certain, high-value
>   part: the consumer surface.** The larger scheme was dropped from scope
>   because the design review found its premises did not hold (consumer apps
>   legitimately contain code — e.g. L2 sandboxed-JS hooks — so "pure metadata"
>   is not real; and auto-review was dropped as a requirement). The remaining
>   hard problems (capability registry/versioning, sandbox hardening, shared
>   data model, data migration) are recorded in §Out of scope as a *separate,
>   gated* bet, not part of this decision.

---

## Context

ADR-0003 made the **package** a first-class versioned artifact, but said
nothing about the **consumer mental model** — what a non-developer sees,
installs, opens, and removes.

Today that surface is muddy. `manifest.zod.ts` exposes a **Package** that can be
any of ten `type`s and may contain *0, 1, or N apps* (a "suite").
`package-registry.zod.ts` codifies it:

> **Package**: the unit of installation. **App**: a UI navigation shell *inside*
> a package. A package may contain zero apps (driver), one app (typical), or
> multiple apps (suite).

The reference implementation **HotCRM** is the worst case: one `type: app`
package aggregating 13 sub-plugins, each with its own namespace. A consumer
cannot tell what they installed, what "opening" means, or what uninstall
removes. This is the Microsoft-Office "suite contains applications" model — and
its inherent confusion.

The Apple model is the opposite and the target: **there is no user-visible
container above the app**. The thing you download *is* the one you open *is* the
one you remove — one noun. Even iWork ships as three separate apps, not a suite.

---

## Decision

### D1 — The App is the only consumer-facing unit

The thing a user downloads, opens, and uninstalls is exactly one **App**. The
word "package" is retained as an internal / developer / control-plane term (the
ADR-0003 artifact) but is **never surfaced to consumers**. A Marketplace
**listing is an App listing**.

### D2 — Only `type: app` is consumer-installable; everything else is invisible

The package `type` enum is unchanged, but a semantic split is layered over it:

| Tier | Types | Consumer-installable? | In consumer Marketplace? |
|---|---|---|---|
| **Consumer unit** | `app` | Yes | Yes (App listing) |
| **Internal contribution** | `plugin`, `driver`, `server`, `ui`, `theme`, `agent`, `objectql`, `module`, `adapter` | No | No |

Internal contributions are the "frameworks inside the `.app` bundle": they ship
inside an App or are operator-provisioned, and are never independently browsed
or installed by a consumer. The consumer Marketplace filters to `type: app` via
`isConsumerInstallable(type)` (`packages/spec/src/kernel/plugin.zod.ts`).

### D3 — Suites fold into a single App (no aggregator above App)

The "package contains N apps (suite)" shape is removed from the consumer model.
A vertical solution that today aggregates many plugins MUST resolve to **one
App** whose internal plugins are invisible. A developer who genuinely wants
independent products ships them as **independent Apps** (the iWork route), never
as a wrapper that surfaces N apps.

### D4 — An App owns a set of namespaces; uninstall removes the set

An App declares and owns a set of namespaces; uninstall is atomic over that set.
(The runtime already supports this: `objectql/src/registry.ts` keys namespaces
as `Map<namespace, Set<packageId>>`.) Folding a suite like HotCRM therefore
needs no object rename — the single App simply owns the namespaces its former
sub-plugins used.

---

## Scope of this ADR (what lands)

- **Decision**: D1–D4 above — the consumer surface is one App.
- **Code (landed)**:
  - `CONSUMER_INSTALLABLE_TYPES` + `isConsumerInstallable(type)` in
    `plugin.zod.ts` — the single source of truth (additive, non-breaking).
  - `MarketplaceListingSchema.packageType` constrained to
    `CONSUMER_INSTALLABLE_TYPES` (`marketplace.zod.ts`) — the data contract now
    **cannot represent a non-App consumer listing**, so the "consumers see only
    Apps" guarantee is enforced at the schema level rather than left to a query
    filter that could be forgotten.
- **Follow-up (thin, surfaces outside this package)**: have the Console
  `marketplace` UI / cloud catalog populate `packageType` from the manifest
  (the catalog is cloud-served and proxied verbatim by
  `runtime/cloud/marketplace-proxy-plugin.ts`), and fold HotCRM to a single App
  (D3/D4). Both consume the same `isConsumerInstallable` predicate.

Nothing in this ADR changes the runtime, the registry, or how packages execute.

---

## Out of scope (explored, deferred — a separate gated bet)

The following were explored in v1/v2 and **deliberately removed** from this
decision. They form a distinct, multi-quarter platform investment that should
get its own ADR and an explicit go/no-go — they are **not** prerequisites for
D1–D4:

- **Metadata/code runtime planes** (hot-loadable sandboxed source vs npm code
  baked into the server image). Useful as a *descriptive* mental model; not a
  decision here.
- **"Consumer App must be pure metadata" (old D6).** Dropped — apps legitimately
  carry code-bearing metadata such as L2 sandboxed-JS hooks
  (`data/hook.zod.ts`: `body.language: 'js'` with declared `capabilities`).
  "Pure metadata" is not a real boundary.
- **Capability-by-reference contract + open capability registry + install gate
  (old D7).** The real long-term hard problem (versioning / semantic drift); the
  current mechanism is the closed `CAPABILITY_PROVIDERS` table in
  `runtime/src/cloud/capability-loader.ts` plus an inert `provides/requires`
  schema.
- **Auto-reviewed Marketplace trust lanes.** Dropped as a requirement.
- **The runtime safety boundary** for self-serve code-bearing apps: the **L2
  hook sandbox + capability/permission enforcer**
  (`core/src/security/plugin-permission-enforcer.ts`). If a self-serve,
  code-bearing Marketplace is ever pursued, *this* — not review, not a purity
  rule — is the load-bearing wall, and its hardness must be proven first.
- **Shared/published data model + inter-App dependencies** (cross-app data
  sharing without a "suite").
- **Metadata-with-data migration framework** (backfill, destructive-change
  confirmation, reversible uninstall of object data).

---

## Consequences

**Positive**
- One noun for consumers: install = open = uninstall, the model everyone already
  knows from their phone. Cheap, low-risk, independently shippable.
- The confusing "package / suite" abstraction disappears from the consumer view.
- No runtime, registry, or execution changes — the blast radius of this ADR is
  the Marketplace/Console listing surface plus one additive predicate.

**Negative / costs**
- HotCRM and any existing suite-style packages must fold to a single App (D3/D4).
- "Publish a standalone consumer plugin" is no longer a consumer path; plugins
  ship inside an App or are operator-provisioned.

---

## Alternatives considered

1. **Keep the suite model, improve the install UX.** Rejected: a 1-to-N noun is
   a structural problem; wording cannot fix it.
2. **Expose both "App" and "Suite" as consumer units.** Rejected: reintroduces
   the container-above-app this ADR removes.
3. **The full v1/v2 scheme (planes + purity + capability contract + trust
   lanes).** Deferred — see §Out of scope. Its premises did not hold and its
   hard parts are a separate, gated investment.

---

## References

- ADR-0003 — Package as First-Class Citizen with Versioned Releases
- ADR-0006 — Three-Layer Tenancy (Organization, Project, Environment)
- ADR-0016 — Studio Package Authoring & Publish
- `packages/spec/src/kernel/plugin.zod.ts` (`isConsumerInstallable`)
- `packages/spec/src/cloud/marketplace.zod.ts`
- `docs/design/marketplace-publishing.md`
