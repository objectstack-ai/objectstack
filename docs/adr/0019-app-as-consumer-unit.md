# ADR-0019: App as the Consumer-Facing Unit

**Status**: Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2026-05-31, v3 narrowed to the consumer-surface decision). Landed in spec: `CONSUMER_INSTALLABLE_TYPES` / `isConsumerInstallable` and the `MarketplaceListingSchema.packageType` narrowing. Pending: the Console marketplace filling `packageType` from the manifest; the `defineStack` check that holds a module package to at most one app ([#32586](https://github.com/objectstack-ai/objectstack/issues/32586)); HotCRM split into a suite that surfaces its sales, service and marketing apps, one per package (hotcrm#2417). · **Amended** (2026-11-12, [#32585](https://github.com/objectstack-ai/objectstack/issues/32585), maintainer ruling 「改成 Salesforce 模式」) — D3's fold reversed: a suite (one install: an app package plus the module packages it composes) may surface more than one app, each defined by a different package of the suite, and an app package still defines at most one app. `type: app` is not renamed (「同意」); D3 gains one terminology table for app package, module, app and suite. D1 and D2 are unchanged. Until this amendment the Pending clause ended "HotCRM folded to a single App (D3/D4)"; see the amendment note under D3.
**Shares its number with**: [`0019-approval-as-flow-node`](./0019-approval-as-flow-node.md) (Collapse Approval into Flow — approval as a durable-pause node) — an unrelated decision under the same number. Numbers are never reassigned (AGENTS.md Prime Directive 13); cite this record unambiguously as `ADR-0019-app-as-consumer-unit`.
**Date**: 2026-05-31
**Deciders**: ObjectStack Protocol Architects
**Builds on**: ADR-0003 (Package as First-Class Citizen), ADR-0006 (Three-Layer Tenancy), ADR-0016 (Studio Package Authoring & Publish)
**Consumers**: `@objectstack/spec/kernel` (`plugin.zod.ts`), `@objectstack/spec/cloud` (`marketplace.zod.ts`), the Console `marketplace` UI, the Studio publish flow, `docs/design/marketplace-publishing.md`
**Related**: [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) (2026-10-25) — the separate, gated decision §Out of scope asks for on "Shared/published data model + inter-App dependencies", taken for the dependency half only (a declared `manifest.dependencies` entry plus a pre-install check; the shared data model half stays out of scope). Additive cross-reference under ADR-0130 D2's recording convention; this record's text is unchanged.

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
> - **Amended 2026-11-12** (#32585, maintainer ruling): D3 no longer folds a
>   suite into a single app. A suite may surface several apps, each defined by
>   a different package. D1 and D2 are unchanged. See the amendment note under
>   D3.

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

> *Amended 2026-11-12 (D3 amendment note).* The maintainer's ruling
> 「改成 Salesforce 模式」 moves the target inside one install: a suite may
> surface several apps, switched from the app launcher. At the listing nothing
> moves: one listing still installs one app package (D1, D2).

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

### D3 — ~~Suites fold into a single App~~ A suite may surface several apps, one per package (no aggregator above App; amended 2026-11-12)

The "package contains N apps (suite)" shape is removed from the consumer model.
~~A vertical solution that today aggregates many plugins MUST resolve to **one
App** whose internal plugins are invisible.~~ *Reversed 2026-11-12 — see the
amendment note at the end of this section.* A developer who genuinely wants
independent products ships them as **independent Apps** (the iWork route), never
as a wrapper that surfaces N apps.

> **Amendment note (2026-11-12, [#32585](https://github.com/objectstack-ai/objectstack/issues/32585), maintainer ruling) — D3's fold reversed: a suite
> may surface several apps, each defined by a different package.** Decided by the maintainer on
> 2026-11-12, as #32585 records it, verbatim and untranslated. On the direction for HotCRM's menu
> split, offered A (one app with areas, D3 as accepted), B′ (a suite may surface several apps, each
> owned by one module package) and C (several apps in one `type: app` package), the maintainer
> answered 「改成 Salesforce 模式」, which is B′.
> Asked 「type: app（主包），是否建议改为 type: solution（主包）」, the seat recommended keeping
> `type: app` and fixing the confusion in wording only, and the maintainer answered 「同意」.
>
> **The rule.** A suite (one install: an app package plus the module packages it composes) MAY
> surface more than one app, provided each app is defined by a different package of the suite, and
> an app package defines at most one app. A product that is genuinely independent still ships as
> its own app package (the iWork route stays). Read per package: no package of a suite defines
> more than one app.
>
> **What is reversed, and what stands.**
>
> - Reversed: the heading's "Suites fold into a single App" and the struck sentence. A vertical
>   solution is no longer folded into one app.
> - The first sentence stands, per package: one package that holds N apps is still the removed
>   shape. That sentence calls the shape a suite. The suite of the table below is several
>   packages, each with at most one app.
> - The last sentence stands: the iWork route.
> - D1 (the consumer listing is an app listing) and D2 (only `type: app` is consumer-installable)
>   are unchanged: one marketplace listing still installs one app package. A suite is no second
>   consumer unit. It has no listing and no package type of its own.
> - D4 is not amended.
>
> **Why one app per package**, recorded as reasons. Each was measured on 18.3.0 for #32585. On
> `main` at `874166b6`, reasons 1 and 3 were read from the code again, and reason 2 and the
> single-app rule were probed once, not kept as a test.
>
> 1. **The Console addresses an app by its package id.**
>    [ADR-0048](./0048-cross-package-metadata-collision.md) §3.1 makes the package id the route
>    key (`/apps/<packageId>`), on its one-app-per-package invariant. The Console links to an app
>    by that id and answers the first app that carries it, so apps that share a package id leave
>    all but the first reachable only by name:
>    `ui/packages/app-shell/src/utils/appRoute.ts#appRouteSegment`, `#matchAppBySegment`, `#appAddressSegment`.
>    The server reads the key the same way. Read by its package id, a package that holds more than
>    one app answers as absent:
>    `packages/metadata-protocol/src/protocol-package-scope.ts#resolveAppPackageIdKey`.
> 2. **An app may not name another package's object.** `defineStack` refuses an app's own
>    navigation entry whose object its package does not define, and still refuses it when a sibling
>    package of the same artifact defines that object:
>    `packages/spec/src/stack.zod.ts#validateCrossReferences`, `#DefineStackOptions.artifactObjects`.
>    [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) §1.5 measured the refusal and
>    named the seam: "navigation crosses only through contributions". #32585 cites HotCRM's sales
>    app for it, `hotcrm:src/sales/apps/crm.app.ts`. An app housed apart from its objects is a
>    shell that only contributions can fill. One measured exception: an entry that declares
>    `requiresObject` is not judged by that check. The key is the capability gate that hides an
>    entry whose object the runtime has not registered (`packages/spec/src/ui/app.zod.ts#requiresObject`).
> 3. **Disabling a module removes the app that module owns.** A module of an installed app
>    package is the one read-only package an administrator may switch off, and a disabled
>    package's items leave the list read and answer as absent by name, its app among them, each
>    judged by its own package: `packages/runtime/src/domains/packages.ts#isDisableableAppModule`
>    and `packages/metadata-protocol/src/protocol-authoring-refusals.ts#isItemOfDisabledPackage`.
>    The hotcrm plan builds on it (M11; the plan is hotcrm#2417 comment 6814732293). An app in the
>    app package cannot be disabled with the module whose objects it shows.
>
> **One vocabulary.** Wording only: no protocol change, and `type: app` is not renamed (「同意」
> above).
>
> | What it is | 中文 | English |
> |---|---|---|
> | a `type: app` package | 应用包 (主包 in a suite) | app package |
> | a `type: module` package | 模块 | module |
> | an entry in `apps[]` | 应用 | app |
> | one install of an app package with its modules | 套件 | suite, a descriptive word, not a package type |
>
> Where this record writes "App" for the consumer unit, the thing listed, installed and
> uninstalled (D1, D2, D4), that is the app package of this table. What a user opens is an app, and
> a suite may offer more than one.
>
> **Enforced today, and not yet.** `defineStack` refuses an app package that defines more than one
> app, `STACK_SINGLE_APP_VIOLATION` (`packages/spec/src/stack.zod.ts#validateSingleApp`). That
> function returns nothing for any other package type, so a module package that defines two apps
> builds on `main` at `874166b6` (`packages/spec/src/stack.test.ts` pins the same answer for a
> `driver` package). For modules the rule is declared and not yet enforced. The check is
> [#32586](https://github.com/objectstack-ai/objectstack/issues/32586), which waits for this
> amendment.
>
> **Not decided here.** Several apps in one `type: app` package (option C) is not ruled, and the
> three reasons above contradict it. Per-position app visibility and a per-position default app
> are a platform capability with no ruling.
>
> **Records that restate D3.**
> [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) D2 says D1–D3 "stand verbatim
> and unamended", and
> [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) lists the consumer
> model as unchanged. Both are readings of their dates, 2026-09-01 and 2026-10-25, and this
> amendment edits neither record. ADR-0130 D2's line stands as drawn: the release artifact never
> appears in the consumer marketplace, is never an install target a consumer selects, and is
> never partially uninstalled. What ADR-0130 calls a suite is a container a consumer browses or
> installs, and that stays removed. Its "exactly one consumer-visible consequence" gains a second:
> a module the app package brought may surface an app of its own.

### D4 — An App owns a set of namespaces; uninstall removes the set

An App declares and owns a set of namespaces; uninstall is atomic over that set.
(The runtime already supports this: `objectql/src/registry.ts` keys namespaces
as `Map<namespace, Set<packageId>>`.) Folding a suite like HotCRM therefore
needs no object rename — the single App simply owns the namespaces its former
sub-plugins used.

> *Note 2026-11-12 (D3 amendment note).* D4's rule is not amended. Its last
> sentence illustrates the rule with the fold that D3 no longer requires.

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
  `runtime/cloud/marketplace-proxy-plugin.ts`), and ~~fold HotCRM to a single App
  (D3/D4)~~ *(reversed 2026-11-12: HotCRM becomes a suite that surfaces several
  apps, one per package; see the D3 amendment note)*. Both consume the same
  `isConsumerInstallable` predicate.

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

> *Amended 2026-11-12 (D3 amendment note).* For a suite, the first bullet's
> "install = open = uninstall" holds for install and uninstall, which name the
> app package. Open names one of the suite's apps.

**Negative / costs**
- ~~HotCRM and any existing suite-style packages must fold to a single App (D3/D4).~~
  *Reversed 2026-11-12 (D3 amendment note).* A suite that surfaces several apps
  houses each one in a different package: HotCRM's sales, service and marketing
  apps sit in its app package, its service module and its marketing module
  (hotcrm#2417). A package that defines two apps still folds them into one or
  moves one to a package of its own.
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
4. **(2026-11-12, #32585) One app with areas, several apps across a suite's
   packages, or several apps in one app package.** Offered to the maintainer
   as A, B′ and C for HotCRM's menu split. B′ was ruled (「改成 Salesforce 模式」)
   and is D3 as amended. A is D3 as accepted. C is not ruled, and the three
   reasons under D3 contradict it. This narrows alternative 1's rejection: one
   install may surface several apps, and one package still may not. Alternative
   2 stands: a suite is no second consumer unit.

---

## References

- ADR-0003 — Package as First-Class Citizen with Versioned Releases
- ADR-0006 — Three-Layer Tenancy (Organization, Project, Environment)
- ADR-0016 — Studio Package Authoring & Publish
- `packages/spec/src/kernel/plugin.zod.ts` (`isConsumerInstallable`)
- `packages/spec/src/cloud/marketplace.zod.ts`
- `docs/design/marketplace-publishing.md`
- Cited by the 2026-11-12 amendment note under D3: ADR-0048 §3.1 (the package
  id is the route key), ADR-0130 §1.5 and D2 (navigation crosses only through
  contributions; the release artifact is never consumer-facing), ADR-0141
