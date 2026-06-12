# ADR-0048: Cross-package metadata collision — detect, don't silently overwrite

**Status**: Proposed (2026-06-13)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package as first-class citizen), [ADR-0005](./0005-metadata-customization-overlay.md) (artifact vs runtime overlay precedence), [ADR-0008](./0008-metadata-repository-and-change-log.md) (metadata repository, `MetaRef` identity), [ADR-0010](./0010-metadata-protection-model.md) (package provenance / `_packageId` stamping)
**Consumers**: `@objectstack/objectql` (`SchemaRegistry.registerItem`, `ObjectQL.registerApp`), package authors, CLI/CI install path
**Surfaced by**: ADR-0046 review (doc naming) — generalised here into its own work item.

---

## TL;DR

The metadata registry key is `org/type/name` — it has **no package
coordinate** (`refKey` in `packages/metadata-core/src/types.ts`). Object
names dodge collisions because the kernel namespace-prefix-validates them
(they map to physical table names). But **bare-named UI/automation metadata
is not prefix-validated**: `page`, `dashboard`, `flow`, `app`, `action`,
`doc` only require snake_case. So two installed packages that each define a
`page` named `home` produce the same logical key, and the second
registration **silently shadows the first** — worse than the object case,
which fails loudly at the DB.

**Decision:** detect cross-package same-key collisions in the code-defined
**base layer** at registration time and raise an explicit, actionable error
naming both packages and the type/name. Do **not** retrofit
namespace-prefix enforcement onto every existing bare-named type (large
migration cost). Prefix stays a *recommended convention* — and brand-new
types can be strict from day one.

## 1. Context

### 1.1 The registry key carries no package coordinate

Metadata identity is `(org, type, name)`:

```ts
// packages/metadata-core/src/types.ts
export function refKey(ref: Pick<MetaRef, 'org' | 'type' | 'name'>): string {
  return `${ref.org}/${ref.type}/${ref.name}`;
}
```

Nothing in that key says *which package* a `system/page/home` came from.
For objects this is harmless: object names are validated against a
namespace prefix in the kernel (`validateNamespacePrefix` in
`packages/spec/src/stack.zod.ts`) because they become physical table names,
so two packages cannot both ship `account` — and if they tried, the second
`CREATE TABLE` fails **loudly** at the database.

Bare-named UI/automation metadata has no such backstop. `page`,
`dashboard`, `flow`, `app`, `action`, and (as of ADR-0046) `doc` only
require `SnakeCaseIdentifierSchema`. Two packages can each legitimately
declare a `page` named `home`.

### 1.2 How the silent shadowing actually happens

In the objectql `SchemaRegistry`, generic (non-object) metadata lives in a
two-level map and is stored under a **composite** key when a package id is
present:

```ts
// packages/objectql/src/registry.ts — registerItem()
const storageKey = packageId ? `${packageId}:${baseName}` : baseName;
collection.set(storageKey, item);
```

So `crm` and `hr` both shipping `page/home` do **not** overwrite the same
map entry — they sit under `crm:home` and `hr:home`. The shadowing surfaces
one layer up, at **read** time:

```ts
// getItem() — returns the FIRST composite key matching `:<name>`
for (const [key, item] of collection) {
  if (key.endsWith(`:${name}`)) return item as T;
}
```

`getItem('page', 'home')` returns whichever entry the `Map` iterates first
— i.e. **whichever package was registered first**. The other package's
`home` is unreachable by name, with no error and no warning. It is
last-write-wins (here, *first-registered-wins*) and entirely silent — the
exact failure ADR-0046's review flagged for `doc`, generalised to every
bare-named type.

### 1.3 What is *not* a collision (and must keep working)

The same `(type, name)` is written more than once for entirely legitimate
reasons. The guard must not break these:

- **Same-package reload.** Re-registering a package (dev reload, idempotent
  install) re-writes `crm:home` with `crm`'s own value. Same owner — not a
  collision.
- **Runtime / DB overlay (ADR-0005).** A runtime-authored row in
  `sys_metadata` overlays a packaged artifact. It is registered under the
  **bare** key with no real package provenance (or carries the
  `'sys_metadata'` rehydration sentinel as `_packageId`). This is the
  sanctioned override path; `registerItem` already emits an artifact-vs-DB
  *shadowing warning* for it and must continue to allow it.
- **Object ownership / extension.** Objects use a separate
  contributor model (`own` / `extend`, `registerObject`) and never flow
  through this guard.
- **Navigation contributions (ADR-0029).** A package injecting nav items
  into an app it does not own uses `appNavContributions`, not a duplicate
  `app` registration.

The bug is specifically a **base-layer collision between two different code
packages**. Provenance is already available to tell them apart:
ADR-0010 stamps every artifact-registered item with `_packageId`
(`applyProtection`), and the registration call passes the owning package id
explicitly.

## 2. Goals & non-goals

**Goals**
- Make a cross-package base-layer collision a loud, actionable failure at
  registration/install time, naming both packages and the type/name.
- Cost-cheap: piggyback on the registration path, which already reads the
  collection by key.
- Zero false positives on overlays, same-package reloads, objects, and nav
  contributions.

**Non-goals**
- Retrofitting namespace-prefix enforcement onto existing bare-named types
  (`page`, `flow`, …). That is a breaking rename for every shipped package
  and is out of scope.
- Changing the `org/type/name` key shape or adding a package column to
  `sys_metadata`.
- Cross-**org** overlay semantics (unchanged; ADR-0005 governs them).

## 3. Decision

### 3.1 Detect, error, name the culprits

At registration time, when a code package registers a bare-named generic
item, refuse it if a **different** code package already owns the same
`(type, name)` in the base layer. The error names both packages, the type,
and the name, and points at the fix.

Detection lives at the single choke point that every installed package's
metadata arrays pass through — `SchemaRegistry.registerItem`
(`packages/objectql/src/registry.ts`). `ObjectQL.registerApp` (and the
nested-plugin loop) delegate to it, so guarding it once covers manifest
metadata and plugin metadata alike. The check:

> `registerItem` is called with a real `packageId`, **and** an existing
> entry for the same `(type, name)` carries a *different* real `_packageId`
> (truthy, and not the `'sys_metadata'` sentinel) → `MetadataCollisionError`.

Same-package writes (`owner === incoming`), bare/overlay rows (no real
owner), and the `'sys_metadata'` sentinel are all excluded, so the
legitimate cases in §1.3 pass through untouched. Detection scans the live
collection — exactly as `getItem`/`unregisterItem` already do — so there is
no parallel index to drift across `reset`/`unregister`.

### 3.2 Policy is `error` by default, `warn` as an escape hatch

`collisionPolicy` defaults to `'error'`. A `'warn'` mode (constructor option
or `OS_METADATA_COLLISION=warn`) downgrades to a logged warning and lets the
registration proceed, for deliberate, temporary migrations (e.g. renaming a
colliding page across two packages in flight). The default is loud; the
opt-out is explicit and discoverable from the error message itself.

### 3.3 Why detection over prefix enforcement

Two ways to kill the collision:

1. **Prefix enforcement** — require every bare-named type's `name` to start
   with the package namespace, like objects. Closes the hole at the source,
   but renames the entire installed base (every `page`/`flow`/`action` in
   every shipped package and pilot), breaks cross-references, and forces a
   coordinated migration. High cost, high blast radius.
2. **Collision detection** (this ADR) — leave existing names alone; make the
   *clash* an error. Near-zero migration cost, the registration path already
   reads the key, and the failure is actionable.

We choose (2). Prefixing remains the **recommended convention** — the error
message literally suggests `<namespace>_<name>` — and may be surfaced as a
non-fatal *lint warning* in the CLI later, but it is **not retroactively
enforced** on legacy types.

### 3.4 New types can be strict from day one

A type introduced *after* this ADR has no installed base to migrate, so it
can adopt namespace-prefix validation immediately at the spec layer and get
both guarantees (no collision *and* self-describing names). ADR-0046's
`doc` is the first candidate: its CLI already enforces namespace-prefixed
snake_case names at build time, so `doc` is effectively prefix-strict at the
authoring boundary while this ADR's registry guard is its runtime backstop.
The general rule: **legacy types → detect; new types → prefix-strict +
detect.**

## 4. Consequences

- A genuine cross-package clash now fails fast at boot/install with a
  message identifying both packages — instead of a coin-flip over which
  package's `home` page a user sees. The hazard moves from *silent at read*
  to *loud at registration*.
- Package authors who unknowingly relied on first-registered-wins will get
  an error; the fix (rename with a namespace prefix, or `warn` during
  migration) is in the message.
- No change to the key shape, the overlay model, or object/nav paths.
- Follow-ups (not in this ADR): a CLI lint that flags non-prefixed
  bare-named metadata as a warning; prefix-strict spec validation for the
  next net-new bare-named type.

## 5. Implementation notes

- `packages/objectql/src/registry.ts`: `MetadataCollisionError` (exported),
  `isRealPackage` helper (excludes the `'sys_metadata'` sentinel),
  `collisionPolicy` option + `OS_METADATA_COLLISION` env, the guard in
  `registerItem`, and `findOtherPackageOwner` (live-collection scan).
- Tests: `registry-cross-package-collision.test.ts` (unit — error/warn,
  same-package reload, overlay, sentinel, distinct names) and
  `engine-cross-package-collision.test.ts` (end-to-end through
  `ObjectQL.registerApp`).
- The `metadata-core` repository (`refKey`, `put`) is the *conceptual* root
  of the missing package coordinate, but its optimistic-concurrency
  `parentVersion` check already rejects a blind base-layer double-create
  with `ConflictError`; the genuinely *silent* path is the objectql
  `SchemaRegistry` read resolution, which is where enforcement lands.
