# ADR-0048: Cross-package metadata collision — package-id identity, namespace install gate, package-scoped resolution

**Status**: Revised (2026-06-13) — supersedes the original *per-item collision
detection* framing. The runtime guard shipped under the original proposal is
**retained as a same-package authoring backstop**; the strategic direction for
the app-marketplace era is revised below.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package as first-class citizen), [ADR-0005](./0005-metadata-customization-overlay.md) (artifact vs runtime overlay precedence), [ADR-0008](./0008-metadata-repository-and-change-log.md) (metadata repository, `MetaRef` identity), [ADR-0010](./0010-metadata-protection-model.md) (package provenance / `_packageId` stamping)
**Consumers**: `@objectstack/objectql` (`SchemaRegistry.registerItem`, `ObjectQL.registerApp`, install path), `@objectstack/console` / `objectui` (routing + metadata resolution), package authors, CLI/CI install path, the app marketplace registry.
**Surfaced by**: ADR-0046 review (doc naming) → generalised to all bare-named metadata → re-examined through the app-marketplace install lens.
**Addenda**: [2026-08-08 — publish-time / marketplace namespace exclusivity](#addendum-2026-08-08-publish-time--marketplace-namespace-exclusivity) (**Proposed**; additive to §3.2, supersedes nothing).

---

## TL;DR

The metadata registry key is `org/type/name` — it has **no package
coordinate** (`refKey` in `packages/metadata-core/src/types.ts`). Objects
dodge collisions because their names are namespace-prefixed (`crm_account`)
and map to physical tables; a clash fails **loudly** at the DB. But
**bare-named UI/automation metadata** (`page`, `dashboard`, `flow`, `app`,
`action`, `doc`) is not container-scoped at resolution time: two installed
packages that each define a `page` named `home` produce the same logical key,
and the read path **silently returns whichever package registered first**.

The original decision was *per-item collision detection* at registration time
— turn the silent shadow into a loud error. That guard shipped and **stays**
as a cheap backstop. But re-examined for an **app marketplace**, per-item
detection is the wrong terminal design: two independent vendors that both ship
a `page/home` would be *unable to coexist*, and a marketplace whose packages
can't be installed together on common names is not a marketplace.

**Revised decision.** Treat the problem as one of **identity and scoped
resolution**, not write-time clash detection:

1. **Package id is the global identity and the routing/container key.** It is
   reverse-domain (`com.acme.crm`), so the vendor is baked in — two vendors'
   CRMs (`com.acme.crm` vs `com.beta.crm`) never collide, even though both
   want the word "crm". It is URL-safe and already the platform's dependency
   identity.
2. **`namespace` stays the object prefix, enforced unique *per installation*
   at install time.** A package whose namespace is already owned by a
   *different* installed package is **refused** — making explicit and early a
   constraint the object/table layer already enforces implicitly (a duplicate
   `CREATE TABLE crm_account` fails loudly at the DB).
3. **Resolution is package-scoped, keyed on the package id.** A bare name
   resolves within the caller's package first (`getItem(type, name,
   currentPackageId?)`; items already carry `_packageId`). Because package ids
   are globally unique, two packages shipping `page/home` coexist and each
   caller resolves to its own — a cross-package clash *cannot mis-resolve* for
   any caller carrying its package id.
4. **The per-item cross-package throw retires.** Distinct packages are always
   disambiguable by package id, so what the original guard flagged as a
   collision is now the *supported* coexistence case. Same-package writes
   overwrite (idempotent reload); the `os lint` namespace-prefix rule keeps
   authoring hygiene.
5. **Namespace rename-on-install is an explicit non-goal for now** (deep
   rewrite of every object name, cross-reference, and formula). v1 is
   *refuse-on-conflict*; rename is a separate future work item.
6. **The package-id URL is transparent; a per-tenant namespace alias is an
   optional sugar** (`/apps/crm` → `com.acme.crm`), never the stored identity.

## 1. Context

### 1.1 The registry key carries no package coordinate

Metadata identity is `(org, type, name)`:

```ts
// packages/metadata-core/src/types.ts
export function refKey(ref: Pick<MetaRef, 'org' | 'type' | 'name'>): string {
  return `${ref.org}/${ref.type}/${ref.name}`;
}
```

Nothing in that key says *which package* a `system/page/home` came from. For
objects this is harmless: object names are validated against a namespace
prefix in the kernel (`validateNamespacePrefix` in
`packages/spec/src/stack.zod.ts`) because they become physical table names, so
two packages cannot both ship `account` — and if they tried, the second
`CREATE TABLE` fails **loudly** at the database.

Bare-named UI/automation metadata has no such backstop. `page`, `dashboard`,
`flow`, `app`, `action`, and (as of ADR-0046) `doc` only require
`SnakeCaseIdentifierSchema`. Two packages can each legitimately declare a
`page` named `home`.

### 1.2 The silence is in the *read*, not the write

In the objectql `SchemaRegistry`, generic (non-object) metadata is stored
under a **composite** key when a package id is present:

```ts
// packages/objectql/src/registry.ts — registerItem()
const storageKey = packageId ? `${packageId}:${baseName}` : baseName;
collection.set(storageKey, item);
```

So `crm` and `hr` both shipping `page/home` do **not** overwrite one map entry
— they sit under `crm:home` and `hr:home`. The write keeps the package
coordinate. The corruption is one layer up, at **read** time, which throws it
away:

```ts
// getItem() — returns the FIRST composite key matching `:<name>`
for (const [key, item] of collection) {
  if (key.endsWith(`:${name}`)) return item as T;
}
```

`getItem('page', 'home')` takes **no package/app context** and returns
whichever entry the `Map` iterates first — i.e. whichever package registered
first. The other package's `home` is unreachable, with no error. The frontend
mirrors this exactly: `pages.find(p => p.name === pageName)` in `objectui` is
the same first-match-wins bug over the merged list.

**The root cause is context-free resolution + a missing package coordinate in
the address — not a write conflict.**

### 1.3 Why the marketplace lens changes the answer

The original ADR optimised for "don't touch the installed base" and chose
write-time detection. Run that forward in a marketplace:

- Vendor A ships `page/home`. Vendor B ships `page/home`. They never
  coordinate — that is the definition of a marketplace.
- A tenant installs A, then B → the **second install fails** with
  `MetadataCollisionError`.

For common names (`home`, `dashboard`, `settings`, `main`, `report`) this is
frequent. *Loud failure is correct for a single-repo authoring mistake; it is
the wrong behaviour for two independent vendors.* The `warn` escape hatch only
re-introduces the silent shadow it set out to kill.

### 1.4 Two "package names" — pick the right field

| field | shape | role | collision profile |
| --- | --- | --- | --- |
| **package id** (`manifest.id`) | reverse-domain `com.acme.crm` | global identity; dependency resolution already keys on it | vendor baked in → structurally safe |
| **namespace** (`manifest.namespace`) | short snake_case `crm` | mandatory object prefix (`crm_account`); URL-pretty | "land-grab" word; **most** collision-prone |
| package display name (`manifest.name`) | "Acme CRM" | human label | n/a (not an identifier) |

`namespace` is the *worst* candidate for a global unique key — everyone wants
`crm`. `package id` is the durable identity. This split drives the decision.

### 1.5 What is *not* a collision (must keep working)

- **Same-package reload** (dev reload, idempotent install) — same owner.
- **Runtime / DB overlay (ADR-0005)** — a `sys_metadata` row overlaying a
  packaged artifact; the sanctioned override path.
- **Object ownership / extension** — `own` / `extend` via `registerObject`,
  never through this guard.
- **Navigation contributions (ADR-0029)** — `appNavContributions`, not a
  duplicate `app` registration.
- **Deliberate cross-package references** — a package referencing another's
  page/app *by qualified reference* (see §3.3).

## 2. Goals & non-goals

**Goals**
- Make two independently-authored marketplace packages **coexist** even when
  they share bare names — without either silently shadowing the other.
- Give UI/automation metadata the same collision-safety objects already enjoy,
  by reusing the package container rather than renaming every artifact.
- Keep the cheap, shipped runtime guard as a backstop for the narrow
  same-package case.
- Zero false positives on overlays, same-package reloads, objects, and nav
  contributions.

**Non-goals**
- **Namespace rename-on-install.** Out of scope for v1 (see §3.5).
- Retrofitting `namespace_`-prefix *renames* onto existing bare-named artifacts
  (`page`, `flow`, …) — the container, not the artifact name, carries the
  scope.
- Changing the `org/type/name` key shape of `sys_metadata` rows.
- Cross-**org** overlay semantics (unchanged; ADR-0005 governs them).

## 3. Decision

### 3.1 Package id is the identity and the routing/container key

The route/container coordinate for an installed package's UI is its **package
id** (`manifest.id`, reverse-domain). With the current **one-app-per-package**
invariant, the app *is* the package container:

```
/apps/<packageId>/page/home          → com.acme.crm's home
/apps/<packageId>/dashboard/sales     → that package's dashboard
```

Reverse-domain ids are URL-safe (`.` is an unreserved path character) and make
two vendors' "crm" packages structurally distinct. This aligns app routing
with the identity the platform already uses for dependency resolution
(`packageId: 'com.acme.crm'`).

> **Identity vs display.** `packageId` is the key; the human label stays in
> `app.label` / `manifest.name` (i18n). The URL is `/apps/com.acme.crm`; the
> app switcher still shows "Sales CRM".

### 3.2 Namespace is the object prefix, gated unique-per-install

`manifest.namespace` remains the mandatory object-name prefix
(`${namespace}_${shortName}`, kernel-validated). The install path **refuses**
a package whose namespace is already owned by a *different* installed package
in the same installation, with an actionable error naming both packages.

This is not new work attributable to this ADR — the object/table layer
*already* requires per-install namespace uniqueness (two packages with
namespace `crm` both try to create `crm_account` and the second fails at the
DB). The gate just makes that constraint **explicit and early** (a clean
pre-install check) instead of a half-applied install blowing up at
`CREATE TABLE`.

Note the gate is **not load-bearing for routing** under §3.1 — routing keys on
the globally-unique package id, which is correct with or without the gate
(local dev, build-time, federation). The gate serves the object/table layer
and is the basis for the optional per-tenant alias (§3.6). Reserved namespaces
(`base`, `system`, `sys`) are exempt, as today.

### 3.3 Resolution is package-scoped (prefer-local, qualify-to-cross)

`getItem`/route resolution resolves a bare name **within the current package
first**, keyed on the **package id**:

- Within `/apps/<packageId>/…`, a bare `page/home` resolves to *this
  package's* `home`. The current package id is already known from the route and
  from React context (`activeApp._packageId`), so this is a single-field
  scoping — `getItem(type, name, currentPackageId?)` — not a signature change
  at every call site. Items already carry their owner (`_packageId`, ADR-0010),
  so the match is `_packageId === currentPackageId`.
- A **deliberate cross-package reference** uses a qualified form
  (`<packageId>:<name>`) — the only place a second package's metadata is
  reachable, and it is explicit.

The disambiguation rests on the **package id being globally unique**, *not* on
the namespace gate: two packages legitimately ship `page/home`, store under
distinct composite keys (`com.acme.crm:home`, `com.acme.hr:home`), and each
caller resolves to its own package's item. **A cross-package clash on
`page/home` therefore cannot mis-resolve for any caller that carries its
package id** — which every routed UI surface does. A *context-free* read
(`getItem` with no package id) is best-effort: it returns the first match and
the caller is expected to pass the package id when it cares.

### 3.4 Per-item cross-package detection retires; same-package overwrite stays

The original proposal's per-item guard threw `MetadataCollisionError` whenever
two **different** packages registered the same `(type, name)`. Under
package-scoped resolution that is exactly the case we now *support*: package
ids are always distinct, so prefer-local always disambiguates two different
packages — there is no unresolvable cross-package clash to detect. The
cross-package **throw is retired**; two distinct packages coexist on the same
bare name by construction.

What remains is the narrow, genuinely-ambiguous case the guard still earns its
keep on: **a write with no real package provenance** (a `sys_metadata`/runtime
overlay) is governed by the ADR-0005 overlay precedence (artifact-vs-DB warning,
unchanged), and **same-package re-registration** simply overwrites (idempotent
reload). Authoring-time hygiene — an author shipping two `page/home` in one
package — stays covered by the `naming/namespace-prefix` lint in `os lint`.

### 3.5 Namespace rename-on-install is deferred (non-goal)

Renaming a colliding namespace on install would require rewriting **every**
object name (`crm_account` → `acme_account`), every cross-reference, and every
formula / view / flow that names `crm_account`. That is a deep rewrite, not a
URL change. v1 is **refuse-on-conflict** (§3.2). Rename-on-install is recorded
as future work, not part of this decision.

### 3.6 The package-id URL is transparent; a friendly alias is optional

A reverse-domain URL — `/apps/com.acme.crm/page/home` — is **self-describing**:
vendor (`acme`), product (`crm`), and surface are legible at a glance, the way
Android package names, Java FQNs, and `k8s` `namespace/name` are. For a host
that runs third-party packages this is a feature, not noise: "which package is
this page from?" is answerable from the URL alone — a trust, support, and
debugging win — and one vendor's `crm` cannot be mistaken for another's.

Its one real cost is **length**. When a short URL is wanted, a host MAY expose a
**per-tenant friendly alias** — `/apps/crm` resolving to `com.acme.crm` —
because the namespace gate (§3.2) makes the namespace unique *within a tenant*.
The alias is a tenant-local presentation convenience layered over the canonical
package-id route; it is **never** the stored identity. Canonical = package id
(robust, coordination-free); alias = namespace (pretty, tenant-scoped). The
alias is optional and out of scope for the phases below.

## 4. Consequences

- **Two vendors' packages coexist.** `com.acme.crm` and `com.beta.crm` install
  side by side; each `home` page is reachable under its own
  `/apps/<packageId>/…` container. The marketplace becomes viable for
  common-named packages.
- **Cross-package safety becomes structural, not detected.** Package-scoped
  resolution (§3.3) keyed on the unique package id means two packages never
  mis-resolve a shared bare name, so the `O(every page/dashboard/flow)`
  per-item registration scan is retired. The remaining install-time work is a
  single `O(1)`-per-package namespace check for the object/table layer (§3.2).
- **Object and UI metadata share one scope model.** The package container
  scopes both; the long-standing "objects are safe, UI metadata isn't"
  asymmetry disappears, with **zero artifact renames**.
- **A namespace land-grab is now a clear, early install error** rather than a
  `CREATE TABLE` failure mid-install or a silent first-registered-wins read.
- **Local development is unaffected** until install: a dev can use namespace
  `crm` locally; the conflict is only adjudicated when installing into an
  installation that already owns `crm`.
- No change to the `sys_metadata` key shape, the overlay model, or object/nav
  paths.

## 5. Implementation phasing

Status legend: **[done]** shipped · **[proposed]** not yet built ·
**[deferred]** out of scope here.

- **[done]** Authoring lint: `naming/namespace-prefix` in `os lint` (warns on
  non-prefixed `app`/`page`/`dashboard`/`flow`/`action`/`report`/`dataset`;
  exempts the namespace-named app per ADR-0019 and `sys_` names; warning-only).
- **[done] Phase 1 — install-time namespace gate.** `NamespaceConflictError` +
  the gate in `SchemaRegistry.installPackage` (refuses a package whose
  `manifest.namespace` is already owned by a different installed package;
  same-package reload and shareable `base`/`system`/`sys` exempt;
  `OS_METADATA_COLLISION=warn` downgrades). Tests:
  `registry-namespace-install-gate.test.ts`.
- **[done] Phase 2 (backend) — package-scoped resolution.**
  `getItem(type, name, currentPackageId?)` prefers the current package's
  composite entry, keeping ADR-0005 overlay precedence; backward compatible.
  The per-item **cross-package throw is retired** (§3.4) — two distinct
  packages coexist on the same bare name. Tests:
  `registry-prefer-local-resolution.test.ts`; the original
  `*-cross-package-collision.test.ts` are rewritten from "throws" to
  "coexists + prefer-local resolves".
- **[done] Phase 2 (frontend) — prefer-local in objectui.**
  `preferLocal(list, name, ownerPackageId)` keyed on `_packageId`, wired at the
  page/dashboard/report/header bare-name sites.
- **[proposed] Phase 2 (frontend, remaining) — package-id routing.** Move the
  `/apps/:appName` segment to the package id and select the active app by
  `_packageId` (closing the app-selection ambiguity that `appName` leaves
  open). Optional: the per-tenant namespace alias (§3.6).
- **[proposed] Phase 3 — qualified cross-package references.** Define and
  document the `<packageId>:<name>` reference form for the deliberate
  cross-package case (nav contributions, shared pages); resolution falls back
  to it after the prefer-local lookup.
- **[deferred] Phase 4 — namespace rename-on-install.** Out of scope here;
  separate ADR if/when pursued.

## 6. Notes

- The `metadata-core` repository (`refKey`, `put`) is the conceptual root of
  the missing package coordinate; its optimistic-concurrency `parentVersion`
  check already rejects a blind base-layer double-create with `ConflictError`.
  The genuinely *silent* path was the objectql `SchemaRegistry` read
  resolution — which §3.3 makes package-scoped.
- `objectui` route inventory (for Phase 2): metadata reachable by name divides
  into (a) already-safe — `object`/`view` (kernel namespace), `component`
  (`:ns/:name` segment), `doc` (ADR-0046 authoring prefix), marketplace/package
  routes (already keyed on `packageId`); (b) package-scoped via this ADR —
  `page`/`dashboard`/`report`; (c) one-off — `app` (now keyed on `packageId`);
  (d) intentionally global — `action`, Studio's `metadata/:type/:name` admin.

---

## Addendum (2026-08-08): publish-time / marketplace namespace exclusivity

> **Status of this addendum: Proposed.** It is **additive to §3.2** and
> **supersedes no text above** — §§1–6 stand verbatim, the install-time gate's
> semantics are unchanged, and §3.5 (namespace rename-on-install) stays
> deferred. What it adds is a **second, earlier checkpoint** in front of the
> install gate: a global `namespace → publisher` exclusive registration made at
> **marketplace publish time**.
>
> **Ruling this addendum executes** (maintainer-approved fleet decision,
> 2026-08-06, issue #1825 — quoted verbatim):
>
> 「准——立 ADR-0048 addendum,定 publish-time / marketplace 全局命名空间独占注册契约。
> 起步口径:保留粒度从**纯 namespace** 起步(不含 version-range,复杂度不前置);
> 共享命名空间(base/system/sys)白名单、存量 grandfathering、install-time 反查
> 平台注册表三个 open question 在 ADR 内逐条定。」
>
> *(Approved — establish an ADR-0048 addendum defining the publish-time /
> marketplace global namespace exclusive-registration contract. Starting
> position: reservation granularity starts at the **bare namespace** (no
> version-range — do not front-load that complexity); the three open questions —
> shared-namespace whitelist (base/system/sys), grandfathering of existing
> packages, and install-time reverse lookup against the platform registry — are
> each settled inside the ADR.)*
>
> The same disposition also fixed: reservation granularity = pure namespace;
> shared-namespace whitelist aligned with the install gate's `base`/`system`/
> `sys`; existing packages grandfathered first-come; rename/transfer stays
> **deferred**. This addendum honours all four.

### A.0 Where the surface actually stands today (verified against `main`, 2026-08-08)

Recording the measured state, because the whole addendum is a claim about a gap:

- **Install time is the only enforcement point that exists.**
  `SchemaRegistry.installPackage()` in `packages/objectql/src/registry.ts`
  refuses a package whose `manifest.namespace` is already owned by a
  *different* installed package (`NamespaceConflictError`), exempting shareable
  platform namespaces via `isShareableNamespace()` (`RESERVED_NAMESPACES =
  {base, system}` plus `sys`) and same-package reload, with
  `OS_METADATA_COLLISION=warn` as the documented downgrade. Pinned by
  `packages/objectql/src/registry-namespace-install-gate.test.ts`; surfaced on
  the service contract as `PackageService`'s `namespaceConflicts` /
  `conflicts` (`packages/spec/src/contracts/package-service.ts`).
- **Publish time has zero namespace surface — not partial, none.**
  `PackageSchema` (`packages/spec/src/cloud/package.zod.ts`) carries
  `manifestId`, `ownerOrgId`, `visibility`, `publisher`, and listing metadata,
  and has **no `namespace` field at all**; `CreatePackageRequestSchema` does
  not accept one; `objectstack package publish`
  (`packages/cli/src/commands/package/publish.ts`) derives and transmits
  `manifest_id` only. The namespace never leaves the artifact.
- **The marketplace review pipeline** (enterprise-side, outside this repo)
  today checks the `manifest_id` **reserved-prefix** rule and nothing about
  namespaces. Adding the namespace uniqueness check to it is exactly
  **minimal version A** below.

So the exposure is precise: two vendors can each publish a package claiming
namespace `crm`, both listings are valid, and the collision is only discovered
by the **tenant** — the one party who cannot fix it — at the moment they try to
install the second one.

### A.1 Decision

#### D1 — The reserved unit is the bare `namespace`. No version-range.

The reservation record is keyed on the namespace string alone, as validated by
`manifest.namespace` today (`/^[a-z][a-z0-9_]{1,19}$/`,
`packages/spec/src/kernel/manifest.zod.ts`):

```
reservation := {
  namespace:        'crm',              // the key — globally unique
  publisherOrgId:   <sys_package.owner_org_id>,
  claimedByManifestId: 'com.acme.crm',  // the manifest that first claimed it
  claimedAt:        <ISO-8601>,
  grandfathered:    false,              // see D4
}
```

Rationale on the three axes:

- **Real business need (实际业务需求).** The thing that breaks is a physical
  table name — `crm_account` — and a table name has no version axis. Two
  versions of the *same* vendor's package never collide (same owner); two
  vendors' packages collide at *every* version pair. A version-range dimension
  would therefore be reserved capacity that no real conflict can consume.
- **Long-term soundness (长远合理性).** `(namespace, version-range)` would let
  vendor A own `crm@1.x` and vendor B own `crm@2.x`. Since the install gate is
  per-installation and version-blind, a tenant installing A@1 and B@2 still
  collides — the finer key would grant reservations the enforcement layer
  cannot honour, which is worse than no key at all. Granularity can only be
  *widened* later (a range is a refinement of the whole); starting narrow is
  the reversible direction.
- **AI-mistake prevention (防 AI 犯错).** One key, one owner, one answer to
  "who owns `crm`?". A range-keyed registry has an interval-overlap predicate
  at its heart, and an agent asked to "check the namespace is free" would have
  to know that "free" is a function of the version being published. The bare
  key makes the wrong answer unrepresentable.

#### D2 — The reservation is held by the **publisher**, not by the package

A publish is rejected when the namespace is reserved by a **different**
`publisherOrgId`. Within one publisher it is allowed, and merely records an
additional `claimedByManifestId` under the existing reservation.

This is deliberate and is the only place the publish gate is *looser* than the
install gate. The reason is which conflicts are **resolvable by someone**:

- *Cross-vendor* collision is unresolvable by any party — neither vendor can be
  made to yield, and the tenant is the one who suffers. That is the case the
  registry exists to make impossible, and it hard-fails.
- *Same-vendor* collision (a vendor publishing `com.acme.crm2` as the successor
  to a retired `com.acme.crm`, reusing namespace `crm`) is entirely within one
  party's control. Blocking it would permanently strand a vendor's own
  namespace behind their own deprecated package, with no transfer flow to
  escape through (transfer is deferred — §A.4). The install gate still refuses
  to co-install the two, which is the correct outcome for a successor pair, and
  the publish response carries a warning naming the sibling.

#### D3 — Shared-namespace whitelist: exactly the install gate's set, and it is *unreservable*

`base`, `system`, `sys` — i.e. `RESERVED_NAMESPACES ∪ {'sys'}`, the identical
set `isShareableNamespace()` already exempts. Two distinct rules apply to them,
and conflating the two is the trap:

1. **They are never reserved and never conflict.** A publish carrying one of
   them neither creates a reservation nor consults one, exactly mirroring the
   install gate's exemption. This is required for correctness, not convenience:
   `sys_*` objects are contributed by many packages by design
   (`registerNamespace` is intentionally many-to-one), so an exclusivity check
   over them would reject the platform's own composition.
2. **They are restricted by publisher tier, not by first-come.** Only
   `publisher: 'objectstack'` (the first-party tier already in
   `PackagePublisherSchema`) may publish a package whose namespace is in the
   whitelist. Anyone else is rejected. Exemption from *exclusivity* must not
   read as *open season*: `manifest.zod.ts` already states these are
   "platform-reserved" and that `sys_`-prefixed object names belong to the
   platform, and without rule 2 the whitelist would be the single cheapest way
   for a third party to ship objects that shadow platform tables.

Rationale on the three axes: **real need** — the platform genuinely ships many
packages under `sys`, so the whitelist must exist; **long-term soundness** —
deriving it from the same constant the install gate uses means the two gates
cannot drift into disagreeing about what is shareable, which is the drift the
issue's acceptance criterion ("compose without drift") names; **AI-mistake
prevention** — an agent generating a manifest that picks `system` as a
"neutral-sounding" namespace is refused at publish with a tier reason, instead
of silently acquiring shadowing rights.

#### D4 — Grandfathering: first-come, frozen, and shrink-only

When the registry is switched on, back-fill it rather than starting empty:

1. For every namespace appearing in already-published marketplace packages,
   award the reservation to the publisher of the **earliest published version**
   carrying it (first-come). Ties break on `sys_package.created_at`, then on
   `manifest_id` lexicographically, so the back-fill is deterministic and
   re-runnable.
2. Every *other* publisher already shipping that namespace is recorded as a
   **grandfathered claim** (`grandfathered: true`). A grandfathered claim
   permits **new versions of the packages that already existed** under that
   namespace, and permits nothing else — in particular it does **not** permit a
   *new* package to take the namespace.
3. The grandfathered set is **closed at switch-on and shrink-only** thereafter.
   No new entry can ever be created; entries leave when the package is
   unlisted or migrates off the namespace.

Rationale on the three axes: **real need** — retroactively invalidating a
published package breaks tenants who already installed it, and this addendum
must not create an outage to close a future hole; **long-term soundness** —
first-come is the only rule that needs no adjudicator, and a shrink-only
exception list is the same ratchet shape the repo uses everywhere else (an
exception that cannot grow eventually costs nothing); **AI-mistake
prevention** — the alternative rules all require judgement ("who deserves
`crm`?"), and a judgement call in a gate is a call an agent will make wrongly
and confidently.

A grandfathered pair remains **un-co-installable** — the install gate says so
today and continues to. That is the pre-existing state being preserved, not a
regression introduced here. Note also the expected size: third-party publishing
is not open (§A.5), so at switch-on the corpus is first-party plus internal, and
the grandfathered set is expected to be empty or near-empty. If the back-fill
finds a non-trivial set, that is evidence the switch-on is late.

#### D5 — Install-time cross-check of the platform registry: **advisory, fail-open, never authoritative**

The contract is defined here; the implementation is deferred to the
enterprise-side card.

`PackageService` gains an **optional** namespace-registry lookup port. When a
host has a platform connection (`@objectstack/cloud-connection`), the install
path MAY resolve `namespace → { publisherOrgId, grandfathered }` and compare it
against the incoming artifact's provenance. On mismatch it emits a **warning and
a trust signal** in the install surface — *"this package claims namespace `crm`,
which is reserved on the ObjectStack Marketplace by another publisher"* — and
**installs anyway**. On lookup failure, timeout, or no platform connection, it
**fails open silently**: no warning, no block, no log noise.

This is a refusal to make the remote registry load-bearing, for three reasons:

- **Local development and air-gapped installs must keep working.** §4's "Local
  development is unaffected until install" is a load-bearing property of this
  ADR, and a hard remote check would repeal it.
- **The local correctness property is already fully enforced locally.** The
  invariant that matters — *no two installed packages in this installation
  share a namespace* — is completely decided by Phase 1's in-process gate with
  no network involved. The registry adds **provenance** ("who is the legitimate
  owner of this name in the world"), which is a trust signal, not a correctness
  one. A trust signal that can hard-fail an install turns a marketplace outage
  into a total install outage across every tenant.
- **Sideloading is the case this addresses, and sideloading is a deliberate
  act.** The user installing an artifact from outside the marketplace has
  already stepped outside it; what they lack is *information*, and information
  is what the advisory check gives them.

Rationale on the three axes: **real need** — the only scenario this covers is a
sideloaded artifact squatting a marketplace name, which is a trust problem, not
a data-integrity one; **long-term soundness** — the advisory can be promoted to
blocking later behind an explicit host policy, whereas a blocking check cannot
be relaxed once tenants depend on it; **AI-mistake prevention** — "advisory,
fail-open" is stated here as the contract so an implementer cannot reasonably
read the deferred card as licence to add a network dependency to the install
path.

#### D6 — The per-tenant alias (§3.6) is unaffected, and stays tenant-local

The friendly alias `/apps/crm → com.acme.crm` is unchanged. Making it explicit,
because the issue asked how alias and exclusivity interact:

- The alias is derived from the **installed** namespace, whose uniqueness within
  the tenant is guaranteed by the local install gate — not by the global
  reservation.
- The global registry is **never consulted to resolve a route**. Route
  resolution stays offline and canonical-package-id-keyed (§3.1/§3.3).
- A tenant cannot alias a namespace it has not installed, and a global
  reservation confers no alias anywhere.

Global reservation and tenant alias therefore do not interact at all: one is a
publish-time authority record, the other a tenant-local presentation
convenience. That non-interaction is the design, not an oversight.

### A.2 The publish-time check — minimal version A

The pipeline gains exactly one check. Stated as an algorithm so the enterprise
implementation and this repo's gate cannot drift:

```
onPublish(manifestId, namespace, publisherOrgId, publisherTier):

  if (namespace is absent)                       -> allow      # namespace is optional today
  if (namespace ∈ {base, system, sys})                          # D3
      return publisherTier === 'objectstack'
        ? allow                                                 # no reservation written
        : reject NAMESPACE_RESERVED_PLATFORM

  r := registry.lookup(namespace)                               # D1
  if (r is null)                 -> registry.claim(...); allow  # first claim wins
  if (r.publisherOrgId === publisherOrgId)                      # D2
      -> registry.addManifest(manifestId); allow (+warn if new manifestId)
  -> reject NAMESPACE_ALREADY_RESERVED { namespace, ownerPublisher, since }
```

Notes that are part of the contract:

- **`namespace` must travel with the publish payload.** It does not today
  (§A.0), so `PackageSchema` / `CreatePackageRequestSchema` gain a `namespace`
  field mirroring `manifest.namespace`, and the CLI reads it off the artifact
  the way it already reads `manifest.id`. This is the one open-side schema
  change the contract implies, and it is the first item of the deferred card —
  without it, the enterprise gate has nothing to check.
- **Only `visibility: 'marketplace'` publishes are gated.** `private` and `org`
  packages never enter the global namespace, are never checked, and never
  create a reservation. A private package is protected by the install gate
  alone, exactly as today.
- **The rejection is a first-class error code**, registered in the ADR-0112
  ledger (`packages/spec/src/api/error-code-ledger.zod.ts`) alongside the
  existing `PACKAGE_PUBLISH_FAILED` / `MANIFEST_CONFLICT` family, so a client
  can distinguish "your namespace is taken" from a generic publish failure. The
  names above are the proposed spellings; registration lands with the
  implementation card, not with this ADR.
- **The error must name the remedy**, on the precedent of
  `NamespaceConflictError`'s message: which namespace, who holds it, since
  when, and that the fix is to choose another namespace (the manifest field and
  every object-name prefix) — not to retry.

### A.3 Open / commercial boundary

Aligned with the cloud ADR-0016 iron rule **强制免费、治理收费** (*mandatory
things are free; governance is paid*), as this repo already applies it in
ADR-0105 D12 — the split is **code vs. activation**, not code vs. code.

**Open, in this repo (free):**
- `manifest.namespace` and its validation; the `namespace` field on the publish
  payload schemas.
- The install-time gate, `NamespaceConflictError`, `isShareableNamespace()`,
  the shareable-namespace constant, and `OS_METADATA_COLLISION=warn` —
  unchanged.
- The advisory lookup **port** and its fail-open semantics (D5), plus the error
  codes and this contract.

**Enterprise / marketplace (governance, paid):**
- The reservation registry itself — storage, the publish-time gate, ownership
  records, the D4 back-fill and grandfathered ledger, dispute handling, and any
  future transfer administration.

The iron rule is satisfied because the free half is the half that keeps an
installation **correct**: any deployment, on any tier, offline or not, is fully
protected from a namespace collision corrupting its schema, because the local
gate refuses the install. The paid half prevents a collision from being
*discovered late* and provides an operated global authority to adjudicate names
— a hosted governance service, which is precisely what 治理收费 designates. A
deployment without it is never unsafe, only less informed.

### A.4 Non-goals (explicit)

- **Version-range reservation granularity** — D1; not deferred pending design,
  actively rejected as a starting position.
- **Namespace rename / ownership transfer** — remains **deferred**, as in the
  original issue (「暂不考虑」) and reaffirmed in the 2026-08-06 disposition. A
  reservation is created and released; it is never moved between publishers.
  D2's publisher-scoped key is what keeps the absence of a transfer flow from
  stranding a vendor's own name.
- **Namespace rename-on-install** — unchanged non-goal, §3.5.
- **Squatting policy and dispute adjudication** — operational marketplace
  policy, not a protocol decision; out of scope for this ADR.
- **Any change to install-gate semantics**, its shareable set, its
  same-package-reload exemption, or the `OS_METADATA_COLLISION=warn` downgrade.
- **Enforcement outside the marketplace.** Local dev, private registries, and
  sideloading are not policed and are not intended to be (D5).

### A.5 Activation precondition (hard)

> **The `namespace → publisher` uniqueness check MUST land before third-party
> publishing opens.** It is an acceptance criterion for opening third-party
> publishing, not a follow-up to it.

Recorded verbatim from the same issue thread:
「**三方 publisher 开放前必须完成 namespace→publisher 唯一性检查**」 (*the
namespace→publisher uniqueness check must be completed before third-party
publisher access opens*).

The ordering is not stylistic. Every package published before the check exists
becomes, by D4, a **grandfathered** entry that the registry can never revoke —
so each day the gate is late permanently enlarges a set that is otherwise
shrink-only. While publishing is first-party only, that set is bounded by our
own discipline; the moment it is open, it is bounded by nothing. Conversely,
building the gate earlier than this buys nothing: with no third-party
publishers there is no cross-vendor collision to prevent, which is exactly why
the work sat on hold. This addendum therefore draws the **contract** now and
lets the enterprise-side implementation be scheduled against the opening date.

### A.6 Phasing

Status legend as in §5.

- **[proposed] Phase A1 — carry the namespace to publish.** `namespace` on
  `PackageSchema` / `CreatePackageRequestSchema`; `objectstack package publish`
  reads it off the artifact manifest. Open-side, this repo. Prerequisite for
  everything below.
- **[proposed] Phase A2 — the publish-time gate (minimal version A).** §A.2's
  algorithm in the marketplace review pipeline, plus the reservation store.
  Enterprise-side. **This is the item bound by §A.5.**
- **[proposed] Phase A3 — grandfathering back-fill.** D4's deterministic
  back-fill, run once at switch-on, emitting the closed grandfathered set as a
  reviewable artifact. Enterprise-side.
- **[deferred] Phase A4 — advisory install-time cross-check.** D5's optional
  port and its fail-open advisory. Contract fixed here; implementation
  scheduled independently, and explicitly *not* a precondition for A2.
- **[non-goal] rename / transfer of a reservation** — §A.4.

### A.7 Consequences

- **A namespace collision becomes the publisher's problem at publish time**,
  where exactly one party can fix it cheaply (pick another namespace before
  anything ships), instead of the tenant's problem at install time, where
  nobody can.
- **Two gates, one vocabulary.** Both keyed on the bare namespace, both
  exempting the same `base`/`system`/`sys` set from the same constant. The
  issue's "compose without drift" criterion is met by construction rather than
  by convention.
- **The gates are deliberately asymmetric in exactly one respect** (D2:
  publisher-scoped vs package-scoped). This is documented rather than
  accidental, and it is the loose direction — publish never accepts something
  install would have to refuse *between different vendors*; it accepts one
  vendor's successor package, which install correctly refuses to co-install.
- **The install path acquires no network dependency** (D5), so offline, local,
  and air-gapped installs behave identically to today.
- **A grandfathered exception set exists but cannot grow** (D4), so the cost of
  switching the registry on late is bounded at switch-on and decays thereafter.
- **Open-source deployments lose nothing.** They keep the gate that prevents
  corruption; what they do not get is the global authority that would have told
  them earlier.
