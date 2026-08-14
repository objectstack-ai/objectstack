# ADR-0029: Kernel Object Ownership — First-Party Capabilities as Plugins That Own Their Data, and Decomposing the `platform-objects` Monolith

**Status**: Accepted — K0/K1/K2/D7 implemented; K3 (pending ADR-0030/storage) + K4 cleanup remaining (proposed 2026-06-01 · calibrated 2026-06-12) · **Amended** (2026-08-09, [#6853](https://github.com/objectstack-ai/objectstack/issues/6853) — **D9**: a tenant `sys_metadata` overlay of an `object` registers as its own `overlay` contributor layer instead of taking the packaged `own` slot and splicing the packaged definition out. D3's single-owner invariant is unchanged. **Design only — nothing is implemented yet**; see **"Amendment (2026-08-09, #6853)"** at the end for the measurement, the semantics, the blast radius, and what is deliberately left open.)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package as first-class citizen), [ADR-0019](./0019-app-as-consumer-unit.md) (app as the consumer-facing unit), [ADR-0025](./0025-plugin-package-distribution.md) (plugin package distribution + dependencies)
**Related**: [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) (metadata naming & namespace isolation) **depends on** this ADR — its D5/D6 (reserved `sys` namespace, single-owner-per-object, apps-cannot-define-kernel) assume the kernel is properly owned. This ADR is sequenced **first** and is independently valuable; ADR-0028 owns the naming model, this ADR owns kernel object *ownership*.
**Consumers**: `@objectstack/platform-objects` (decomposed), `@objectstack/plugins/plugin-auth` · `plugin-audit` · `plugin-sharing` · `plugin-approvals` · `plugin-webhooks`, `@objectstack/services/service-job` · `service-ai` · `service-settings` · `plugin-email`, `@objectstack/objectql` (`SchemaRegistry` ownership + `RESERVED_NAMESPACES`), `@objectstack/runtime` (bootstrap / load-order), `@objectstack/spec` (manifest `scope`, reserved-namespace enforcement)

---

## TL;DR

Every `sys_*` kernel object is defined in the **`platform-objects` monolith**,
even though the plugins that conceptually own them — `plugin-auth`,
`service-job`, `service-settings`, … — only declare `namespace:'sys'` in their
manifests. Ownership *declaration* is split from object *definition*: plugins are
hollowed into behavior-only shells whose data model lives elsewhere. That
contradicts the microkernel principle that a (even first-party) capability is a
plugin shipping **its own data model + behavior** as one cohesive unit.

This ADR makes first-party capabilities own their kernel objects:

1. **A first-party capability is a plugin that owns its `sys_*` objects + its
   behavior.** `plugin-auth` owns `sys_user`/`sys_session`/`sys_organization`,
   `plugin-audit` owns `sys_audit_log`, `service-job` owns `sys_job`, etc.
2. **Small core, everything else a capability plugin.** A short *core-mandatory*
   list (identity/org hub + metadata store) stays always-present; the rest
   (audit, jobs, email, approvals, sharing, AI, webhooks) becomes
   independently-installable capability plugins.
3. **`sys` is one shared, reserved namespace with single-owner *per object*** —
   not single-owner-per-namespace and not a monolith owner. The existing
   `own`/`extend` model already enforces one owner per object name.
4. **The hub problem is solved by dependencies + load-order, not by
   centralization.** `sys_user`/`sys_organization` are core-mandatory; capability
   plugins declare a `dependency` on them and the loader sequences owners before
   referencers.
5. **`platform-objects` is decomposed** — shrinks to the core-mandatory slice (or
   dissolves into the capability plugins behind a thin re-export facade).

This is **template-transparent** (apps only *reference* `sys_*`; resolution is
unchanged) and therefore the lowest-risk, independently-shippable foundation for
the larger naming refactor in ADR-0028.

---

## Context

### The problem

The codebase scan found the kernel is a monolith with split ownership:

| Finding | Evidence |
|:--|:--|
| **All `sys_*` objects are defined in `platform-objects`** — identity, audit, security, metadata, system domains. | `platform-objects/src/{identity,audit,security,metadata,system}/**` |
| Plugins **declare** `namespace:'sys'`, `scope:'system'` but **define no objects** — the data model lives in `platform-objects`. | `plugin-auth/src/manifest.ts:58-67`; `service-job`, `service-settings` manifests |
| `sys` is a **shared** namespace co-claimed by ~14 packages with no arbiter at the namespace level. | `objectql/src/registry.ts:346-389` (`namespaceRegistry: Map<ns, Set<pkgId>>`) |
| The `own`/`extend` ownership model is fully implemented: **one owner per object** (second `own` throws), extenders merge by `priority` (owner 100, extender 200). **No package extends a `sys_` object today.** | `objectql/src/registry.ts:406-518`; `object.zod.ts:856-897` |
| ~60 lookup fields converge on the **hub objects `sys_user` / `sys_organization`**, referenced from every domain (incl. `service-ai`'s `ai_conversations.user_id`). | scan |
| `RESERVED_NAMESPACES = {'base','system'}` — `sys` is **not** reserved. "Apps may reference but never define `sys_*`" is documented intent with **no enforcing validator**. | `registry.ts:13`; `manifest.zod.ts:66-70` |
| `scope: cloud\|system\|project` and `managedBy: platform\|config\|system\|append-only\|better-auth` already mark system data. | `manifest.zod.ts:133`; `object.zod.ts:354-385` |
| The **`setup` admin app is a static monolith** that hard-references every `sys_*` object as nav entries — and its own comment notes it was made static *because* the objects were centralized (the older `@objectstack/plugin-setup` that assembled it at runtime was deleted). | `platform-objects/src/apps/setup.app.ts` |
| `manifest.contributes.menus` exists in the schema but is **consumed nowhere** — a vestigial, unimplemented contribution point. No app-navigation merge / `appExtensions` analog to `objectExtensions` exists. | `manifest.zod.ts` (`contributes.menus`); no consumer found |

### How mainstream platforms structure the kernel

| System | Microkernel? | Who owns kernel/standard objects | First-party features |
|:--|:--|:--|:--|
| **VS Code** | Yes — tiny core | Core owns the editor model | **Even built-in languages ship as extensions** that own their contributions |
| **Kubernetes** | Yes — small API core | Core API objects | Capabilities added via API-extensions / CRDs + controllers (each owns its types) |
| **Salesforce** | Platform core | Standard objects owned by core, **not packageable** | Clouds (Sales/Service) ship as managed first-party units; standard objects stay core |
| **ServiceNow** | Platform core | `sys_*` base tables shipped by the platform | **Plugins** (activatable feature sets) add and own their own tables; CMDB/user stay core |

**Consensus this ADR adopts:** keep the core small; let first-party capabilities
be plugins that own their data; reserve a platform namespace for kernel objects
that packages may extend but not redefine.

---

## Decision

### D1 — A first-party capability is a plugin that owns its data *and* behavior

The unit of a capability is a plugin that ships its `sys_*` object definitions
alongside its services/hooks/flows — not a behavior shell pointing at a shared
data monolith. Ownership *declaration* (`manifest`) and object *definition*
(`*.object.ts`) live in the same package. Concretely:

| Capability plugin | Owns (`own`) |
|:--|:--|
| `plugin-auth` (or a base `plugin-identity`) | `sys_user`, `sys_session`, `sys_organization`, `sys_account`, `sys_team*`, `sys_member`, `sys_oauth_*`, `sys_two_factor`, `sys_api_key`, `sys_device_code`, `sys_jwks`, `sys_invitation`, `sys_department*`, `sys_user_preference` |
| `plugin-audit` | `sys_audit_log`, `sys_activity`, `sys_comment`, `sys_presence`, `sys_attachment`, `sys_notification` |
| `plugin-approvals` | `sys_approval_request`, `sys_approval_action` |
| `plugin-sharing` | `sys_role`, `sys_permission_set`, `sys_*_permission_set`, `sys_sharing_rule`, `sys_record_share`, `sys_share_link` |
| `service-job` | `sys_job`, `sys_job_run`, `sys_job_queue`, `sys_report_schedule` |
| `plugin-email` | `sys_email`, `sys_email_template` |
| `plugin-webhooks` | `sys_webhook`, `sys_webhook_delivery` |
| `service-ai` | `ai_*` (already owns these; folded under the contract per ADR-0028) |
| core / `plugin-metadata` | `sys_metadata*`, `sys_view_definition`, `sys_setting*`, `sys_saved_report` |

(Exact assignment of security objects — under `plugin-sharing` vs a dedicated
`plugin-rbac` — to settle in implementation.)

### D2 — Small core; everything else is a capability plugin

Split kernel objects into two tiers by a clear criterion:

- **Core-mandatory** — referenced by (almost) everything and has no meaningful
  "disabled" state: the **identity/org hub** (`sys_user`, `sys_organization`) and
  the **metadata store** (`sys_metadata*`). Always present; owned by a
  foundational base package (`plugin-identity` + core metadata) that cannot be
  uninstalled.
- **Capability** — has a coherent on/off boundary: audit, jobs, email,
  approvals, sharing, AI, webhooks. Independently installable/disablable; each
  owns its `sys_*` objects. When disabled, its objects simply aren't registered.

### D3 — `sys` is one shared, reserved namespace, single-owner *per object*

The invariant is **single-owner-per-object-name** (already enforced — a second
`own` throws), **not** single-owner-per-namespace and **not** one monolith owner.
Many first-party plugins co-contribute into the one `sys` namespace; each object
name has exactly one owner. Collision safety comes from the object-level `own`
check plus the install-time identifier registry (ADR-0028 D6). Other plugins may
`extend` a `sys_*` object (add fields/indexes via `objectExtensions`, merged by
priority) — the supported way to augment kernel objects.

### D4 — Reserve `sys`; apps reference but cannot define kernel objects

Add `sys` to `RESERVED_NAMESPACES`. Enforce structurally in `registerObject`: a
`scope:'project'` / `type:'app'` package attempting to `own`/define an object in
a reserved kernel namespace is rejected (the `sys_`-prefix *exemption* becomes a
*prohibition* for apps). Apps may still `extend` kernel objects. This converts
the documented "reference-but-not-define" intent into a real boundary.

### D5 — Hub + load-order, not centralization

The two forces that historically drove the monolith are addressed without it:

1. **Hub references** — `sys_user` / `sys_organization` are core-mandatory (D2);
   every capability plugin declares an explicit `dependency` on the base identity
   package rather than embedding the objects.
2. **Bootstrap order** — the loader sequences an object's owner to register
   before any referencer, via the existing `dependencies` + plugin-loading
   `loadOrder`. Owning a `sys_*` object is just another declared dependency edge —
   which is precisely the plugin system's job.

### D6 — Decompose `platform-objects`

`platform-objects` shrinks to the **core-mandatory** slice (identity/org hub +
metadata + shared base field-sets/mixins) — or dissolves entirely into the
capability plugins behind a thin **re-export facade** that preserves the current
import surface during migration. Shared schema fragments (audit/system field
mixins, common lookups) move to a small `platform-objects-base` (or `spec`)
module that capability plugins import, so decomposition does not duplicate them.

### D7 — Shared admin surfaces are "shell + slots"; capability plugins contribute navigation

Decomposition breaks the premise that lets the `setup` app be a static monolith
(it hard-references every `sys_*` object, and was made static *because* the
objects were centralized). The fix mirrors `own`/`extend` at the UI layer:

- The `setup` app is **owned by a base package** (revived `plugin-setup` or the
  base tier) and defines only the **shell + stable group/category anchors
  ("slots")** — `Overview`, `Apps`, `People & Org`, `Access Control`,
  `Automation`, `Security`, `Developer`, … It does **not** enumerate capability
  objects.
- Each capability plugin **contributes** its nav entries into a named slot via a
  declarative **navigation contribution** — the UI-layer analog of
  `objectExtensions`. This finally implements the vestigial
  `manifest.contributes.menus` (or a proper `appExtensions` /
  `navigationContributions` schema): `{ app: 'setup', group: 'security', items:
  [...], priority }`.
- The loader **merges contributions into the owning app by group id + priority**,
  exactly as object extenders merge (owner shell first, contributions by
  ascending priority).
- Each entry stays **gated by the existing nav fields** `requiresObject` /
  `requiredPermissions` (already in the App nav schema, e.g.
  `requiresObject: 'sys_package_installation'`). This doubles as the
  enable/disable mechanism: a disabled capability registers no objects, so its
  gated menu entries simply don't render — no dangling links.

This is the general extension point a marketplace needs anyway: any app
(third-party included) becomes navigation-extensible, not just `setup`. Scope
for this ADR is the `setup` app and first-party capability contributions;
generalizing app-extension to arbitrary apps is a follow-up. References inside
contributions follow ADR-0028's naming model (`sys.audit_log`, etc.).

### D8 — An object's i18n resources migrate with its ownership

A kernel object is more than its schema: it has **localized labels, field help,
and list-view names**. Today these live in `platform-objects` as generated
bundles (`src/apps/translations/*.objects.generated.ts`, produced by
`os i18n extract` against `scripts/i18n-extract.config.ts`, loaded at runtime by
the `platform-objects` plugin). The generated entries are keyed by **object
name** (`sys_webhook: {...}`) and loaded globally, so they keep working at
runtime regardless of which package owns the object — but their **source of
truth** stays wrongly attached to the monolith.

Therefore object migration must carry the i18n resources, not just the schema:

- The owning plugin becomes the **source of truth** for its objects'
  translations — it owns the extract config entry and ships the generated
  bundle(s), and contributes them at runtime (e.g. via `i18n.loadTranslations`
  or `manifest.translations`), exactly as `platform-objects` does today.
- When an object leaves `platform-objects`, it is removed from
  `scripts/i18n-extract.config.ts`; **regenerating before the plugin owns its
  extraction would silently drop locales** — so the plugin-side i18n extraction
  must land in the same step (or the object stays in the extract set
  transitionally, explicitly tracked).
- A plugin that currently has **no i18n infrastructure** (e.g. `plugin-webhooks`,
  whose `sys_webhook_delivery` ships inline labels only) must gain one as part of
  taking ownership of a localized object — this is real, recurring work in every
  K2 domain move and must be budgeted, not assumed free.

Pilot note: the first pilot (webhooks) moves the schema and removes the object
from the monolith extract config, but **defers building plugin-side i18n
extraction** — the existing generated entries remain valid at runtime
(object-name-keyed), and the plugin-owned i18n bundle is the explicit next sub-task
before any regeneration.

---

## Migration plan (template-transparent, independently shippable)

Apps only *reference* `sys_*`; resolution is unchanged throughout, so existing
templates are unaffected. This sequence can land **before** and independently of
the ADR-0028 naming flip.

- **K0 — Ownership model readiness.** Confirm `own`/`extend` + `dependencies` +
  `loadOrder` cover cross-package ownership with the hub dependency edges; add an
  install-time check that every `sys_*` object resolves to exactly one owner.
  *Exit:* registry resolves the full current kernel identically with explicit
  single owners; no resolution diffs.
- **K1 — Base identity + reserved namespace + setup shell.** Extract the
  core-mandatory hub (`sys_user`/`sys_organization`/`sys_metadata*`) into the
  always-present base package; add `sys` to `RESERVED_NAMESPACES`; wire dependency
  edges. Implement the **navigation-contribution mechanism** (D7) and reduce the
  `setup` app to its shell + group anchors owned by the base package; the existing
  hard-coded entries become base-package contributions for now. No capability
  object moves owner yet beyond the hub.
  *Exit:* identity/auth bootstrap green; load-order deterministic; `setup` renders
  identically, now assembled from contributions.
- **K2 — Move ownership to capability plugins (incrementally, one domain at a
  time).** For each domain (audit → jobs → email → approvals → sharing →
  webhooks), relocate the `*.object.ts` definitions into the owning plugin and
  switch its manifest from "declare `namespace:'sys'`" to actual `own`, and move
  that domain's `setup` nav entries out of the base shell into the plugin as
  navigation contributions (D7). **Migrate the object's i18n resources with it**
  (see D8). Keep a `platform-objects` re-export facade so importers don't break
  mid-migration (where the dependency direction forbids a facade — e.g. a leaf
  plugin `platform-objects` already depends on — do a clean move instead and
  update the importers).
  *Exit per domain:* that domain's objects resolve to the new owner; its setup
  menu entries render via its own contribution; its translations load from the
  owning plugin (no localization regression); its tests green; cross-domain
  lookups to the hub still resolve.
- **K3 — Boundary enforcement.** Flip the app-cannot-define-kernel check
  warn→error. Classify the scattered `ai`/`mail`/`branding`/`prefs`/`feat`/… —
  each object either folds into the kernel contract (owned by its capability
  plugin) or becomes an ordinary prefixed package. Delete `nope`.
  *Exit:* no app defines a `sys_*` object; quasi-kernel namespaces classified.
- **K4 — Remove the facade.** Once all importers reference capability plugins
  directly, drop the `platform-objects` re-export facade (or reduce
  `platform-objects` to the base slice).
  *Exit:* `platform-objects` contains only core-mandatory + shared base, or is
  gone.

---

## Consequences

**Positive**

- First-party capabilities become true plugins (data + behavior in one unit) —
  the platform "dogfoods" its own extensibility model; what ships the kernel is
  the same mechanism third parties use.
- Capabilities gain a real on/off boundary (audit/jobs/email/… can be omitted),
  shrinking minimal deployments and clarifying dependencies.
- Single-owner-per-object + reserved `sys` gives the kernel the same
  collision-safety apps already enjoy, and lays the foundation ADR-0028 needs.
- Ownership declaration and definition are reunited; the "shell plugin" smell is
  removed.

**Negative / costs**

- Non-trivial internal refactor of `platform-objects` and ~8 plugins; load-order
  and the `sys_user`/`sys_organization` hub dependency must be gotten right or
  bootstrap breaks (mitigated by K0/K1 gating + the re-export facade).
- More packages and dependency edges to maintain.
- Risk of circular dependencies if a "capability" object is over-eagerly made to
  reference another capability's object; the hub must stay in the base tier and
  cross-capability references should be minimized (or go through the hub).

**Neutral / open**

- Exact home of the security/RBAC objects (`plugin-sharing` vs `plugin-rbac`).
- Whether the base tier is a dedicated `plugin-identity` or stays inside
  `platform-objects-base`.
- Whether disabled capabilities should hard-remove their tables or leave them
  dormant (interacts with `managedBy` and uninstall semantics).
- The navigation-contribution schema (D7): revive/extend the vestigial
  `manifest.contributes.menus` vs add a first-class `appExtensions` /
  `navigationContributions` collection — and how far to generalize app-extension
  beyond the `setup` app (arbitrary third-party apps) in this ADR vs a follow-up.

---

## Alternatives considered

- **Keep the monolith (`platform-objects` owns all).** Simplest, no load-order
  work, but perpetuates the shell-plugin smell and the namespace-without-arbiter
  fragility; rejected as the long-term shape (it is the historical artifact this
  ADR addresses).
- **One owner, others `extend`.** `platform-objects` keeps `own`ership and
  capability plugins only add fields via `objectExtensions`. Preserves a single
  definition site but still hollows the plugins (they own behavior, not their
  core data) — a half-measure; rejected in favor of true per-capability
  ownership.
- **Per-domain sub-namespaces (`identity`, `audit`, …) instead of one `sys`.**
  This is a *naming/reference-surface* question owned by ADR-0028 (rejected there
  on industry practice + the hub cross-reference graph). Ownership distribution
  (this ADR) is orthogonal and does not require sub-namespaces.

---

## Amendment (2026-08-09, #6853): a tenant overlay of an object is its own contributor LAYER, not a second `own`

**Ruling**: maintainer, 2026-08-09, on [#6853](https://github.com/objectstack-ai/objectstack/issues/6853).
Direction **B approved in principle**; direction A (reconstruct the packaged
definition inside the delete-time heal) **rejected**; the stop-the-bleed guard
shipped separately as [#7012](https://github.com/objectstack-ai/objectstack/issues/7012).
The ruling was explicit that B's semantics are *designed in the amendment, not
guessed* — this section is that design, and merging it is what ratifies it
(`docs/adr/**` is maintainer-merged, [#6741](https://github.com/objectstack-ai/objectstack/issues/6741)).

**Status of the work**: **design only — nothing here is implemented.** Every
file:line below was read on `2f3e79351` (this repo moves; the measurement report
on #6853 cites `51f2bb8c3`, and the symbols have moved since). The implementation
is a separate card, gated on this record being accepted.

**The block amended is D3** ("`sys` is one shared, reserved namespace,
single-owner *per object*"). That block is **left standing as written** (Prime
Directive #13 — an accepted record is not silently edited to make the past look
like it always said the present), so this section is where the present tense
lives. D3's invariant is **not weakened**: after this amendment there is still
exactly one `own` contributor per object name, and `assertSingleOwnerPerObject`
is unchanged. What changes is that a tenant overlay stops *borrowing* that slot.

---

### 1. What the code does today, measured

An object's registry entry is a list of `ObjectContributor`s keyed by name
(`packages/objectql/src/registry.ts:38-44`), and `registerObject` accepts exactly
two kinds — `own` and `extend` (`:1070-1075`, the vocabulary at
`packages/spec/src/data/object.zod.ts:2435`).

A tenant overlay of an `object` reaches that verb through two seams, and both
pass **two arguments only**, so `ownership` takes its default `'own'`:

| seam | call | when |
|:--|:--|:--|
| `applyObjectRegistryMutation` | `packages/metadata-protocol/src/protocol.ts:7897-7911` | every `saveMetaItem` write-through |
| `loadMetaFromDb` | `packages/metadata-protocol/src/protocol.ts:11670-11673` | **every boot**, no authorization gate |

When the row's `package_id` equals the packaged owner's id, `registerObject`
takes the re-registration branch at `registry.ts:1157-1160` and **splices the
packaged contributor out of the list**. The packaged definition is *destroyed at
write time* — it is not shadowed, and no second copy exists anywhere in the
registry. Four consequences follow, all measured end-to-end in the 08:12Z report
on #6853 (P0-P6) and re-read in the source here:

1. **The packaged body is gone.** Measured (P1): `fields` went from
   `[…, name, amount, packaged_only]` to `[…, name, overlay_only]`, contributor
   `provenance` from `package` to `org`, on a list of length 1 throughout.
2. **It re-happens on every boot** (P6), through `loadMetaFromDb`, silently:
   `{"loaded":1,"errors":0,"invalid":0}` with no warning.
3. **`isArtifactBacked` starts lying.** It asks `getArtifactItem('object', …)`
   (`protocol.ts:7535-7540`), whose object branch resolves the **merged** object
   and rejects it when `_provenance === 'org'` (`registry.ts:1727-1733`, predicate
   at `:844-846`). Since the overlay is now the *owner*, the merged body carries
   the tenant's provenance, so the predicate answers `false` for a name a code
   package still ships.
4. **Two gates that read that predicate silently disarm.** `saveMetaItem`'s
   two-tier gate (`protocol.ts:8460-8472`) stops refusing — `object` declares
   `allowOrgOverride: false, allowRuntimeCreate: true`
   (`packages/spec/src/kernel/metadata-plugin.zod.ts:628`), so the *first* write
   is refused and every later one is admitted through the wrong tier. And tier 3
   of `restoreArtifactRegistryView` (`protocol.ts:8259-8272`), whose comment says
   in as many words that it never retires a code-shipped object, fires:
   `objectContributors` goes empty, `getObject` answers `null`, and data CRUD
   404s on a table the package still ships, until the process restarts (P3/P6).

A fifth shape belongs to the same mechanism. When the row's `package_id`
**differs** from the packaged owner's, the ownership rule at `:1149-1155` throws,
the throw is caught and `console.warn`-ed at `protocol.ts:7906-7910`, and
`saveMetaItem` still reports success — the write-side silent discard filed as
[#6995](https://github.com/objectstack-ai/objectstack/issues/6995), which the
ruling requires this model to answer (§ D9.6).

### 2. Why the overlay ever became an `own`

Not by decision. `registerObject` had two kinds and the overlay is neither, so it
took the default — and then the *re-registration* branch (written for HMR and
metadata rebuilds replaying the **same** package's object) treated a different
layer's body as a replay of the same one.

The borrowed slot carries authority the overlay measurably never uses:

- **It claims no namespace.** `registerObject` calls `registerNamespace` only when
  a namespace argument is passed (`:1136-1138`); both overlay seams pass none, so
  `namespaceRegistry` keeps the package's entry. What the splice *does* destroy is
  the owner contributor's own `namespace` field (measured `''` where the package
  had `'myapp'`, P5) — inert today only because `computeFQN` is identity
  (`:61-63`).
- **It does not decide package membership.** `getAllObjects(packageId)` matches
  *any* contribution's `packageId` (`:1307`), owner or not.
- **It owns no table.** The physical table is the packaged owner's, created by
  its schema sync; an overlay's new fields ride ADR-0045 additive materialization.

The one thing ownership gave it was *a place in the list*. That is a storage
question, and D9 answers it as one.

---

### D9 — a tenant overlay registers as an `overlay` contributor; the packaged `own` contributor is never removed

#### D9.1 — a third contributor kind, loader-set and never authorable

`ObjectContributor.ownership` gains `'overlay'`, and the vocabulary
`ObjectOwnershipEnum` (`packages/spec/src/data/object.zod.ts:2435`) gains it too
— one vocabulary, not a parallel list (Prime Directive #8).

That enum is **loader-facing, not author-facing**, and this amendment binds it to
stay that way. Measured: `ObjectOwnershipEnum` has no runtime consumer at all in
this repo (`registry.ts` imports only the `ObjectOwnership` *type*), and the two
existing kinds are set at exactly three call sites — `own` by the package loader
(`packages/objectql/src/engine.ts:2920`, `:2933`, `:3147`, `:3157`) and `extend`
by the `objectExtensions` loop (`engine.ts:2956`, priority from the manifest
entry). No author ever writes `ownership: 'own'`; a package author declares
`objectExtensions: [{ extend: '…' }]` and the loader picks the kind. `'overlay'`
is therefore set by the two hydration seams and by nothing else, and the enum's
docblock must say so alongside the existing warning that separates it from the
record-`ownership` model (`object.zod.ts:1385-1392`).

This is the "hard to get wrong" property doing real work: the new kind adds **no
authoring surface**, so no hand-written or AI-written metadata can reach for it,
correctly or otherwise.

#### D9.2 — resolution: the overlay replaces the BASE layer; extenders still fold on top

`resolveObject` (`registry.ts:1206-1234`) selects its base layer as
`overlay ?? owner` instead of `owner`, then folds `extend` contributions exactly
as it does today.

This is deliberately **bit-for-bit what today's splice already produces**. Today
the overlay *is* the owner, so the fold runs over the overlay body; under D9 the
fold runs over the same overlay body selected by kind. The resolved schema —
including its `_provenance: 'org'`, which every registry-direct consumer reads —
is unchanged. **The resolved object does not move; only what the registry
remembers does.**

That is the argument for replace-semantics over the two alternatives, and it is
the one the ruling asked for:

- **Overlay as `extend` is refused.** `mergeObjectDefinitions` merges fields
  additively (`registry.ts:86-108`; `merged.fields = { ...base.fields,
  ...extension.fields }` at `:91`) and has no expression for *removal* at all.
  An overlay that drops a packaged field would silently stop dropping it — the
  measured overlay body carried `overlay_only` and neither `amount` nor
  `packaged_only`; as an extender the resolved object would carry all three.
  That is an authoring-visible behaviour change to stored tenant metadata that
  nobody asked for, arriving as a silent re-appearance of deleted fields.
- **A second `own` is refused** — see § 4.

##### D9.2a — AMENDMENT (2026-08-13, #8460): an extender's SCALAR yields to a diverged base

D9.2 above says the fold runs "exactly as it does today", and for `fields`,
`validations` and `indexes` it still does. For the three **scalars** — `label`,
`pluralLabel`, `description` — it no longer does, and this clause is the
difference.

**Ruling (maintainer, 2026-08-13, option A — "tenant wins"):** an extender's
scalar applies only while the fold's base still carries the **packaged owner's**
value. A base whose scalar has diverged from the owner's has been authored by
the tenant, and the extender **yields**.

Why this had to be decided rather than left to D9.2's "last writer wins": D9.2
makes the tenant's overlay the *base* of the fold, so last-writer-wins meant a
code package's `objectExtensions` scalar overwrote the tenant's own Studio
rename *inside* the fold. The tenant's value was then absent from the document
every read serves — `PUT /meta/object/:name` answered `200`, `?layers=true`
showed the saved value under `overlay`, and no read a writable form derives from
ever showed it (#8037, #8027/#8045, and the severe half of #8284).

The mechanism is **comparison-based provenance**, and is deliberately the *same*
mechanism [#8284](https://github.com/objectstack-ai/objectstack/issues/8284)
established one layer up for the i18n catalog — the same predicate, imported by
`SchemaRegistry` from `@objectstack/spec`, not a second copy free to drift. One
sentence now governs both layers: **an explicit override beats a packaged
default.**

Binding consequences:

- **No provenance flag and no migration.** Nothing is stamped on the document;
  the question is answered from two values at fold time. A flag threaded through
  the fold was explicitly rejected.
- **The comparison is against the packaged owner ALONE**, never against the
  owner with extenders already folded on (D9.6's `resolveOwnerLayer`) — that
  body reports every extender's scalar as "unchanged" and would yield nothing,
  ever.
- **Computed once, over the base the fold starts from**, never re-derived from
  the running merge. Re-deriving would make one extender's scalar look
  "authored" to the next and silently invert extender-vs-extender precedence,
  which D9.3 reserves to declared priority.
- **Conservative edges** (inherited from the shared predicate): an absent base,
  a non-string or empty value, and inexact equality all mean "no opinion", so
  this can only ever *withhold* an extender's scalar from a value that provably
  diverged. A tenant who renames an object to exactly the packaged string is a
  no-op, by construction.
- **Idempotence (#8027) is preserved.** A base that already carries an
  extender's scalar reads as diverged, so the extenders yield and the value
  stays what the first fold produced — the same answer, reached by yielding
  instead of by re-applying.
- **The accepted cost is the point, not a regression:** a package can no longer
  relabel an object a tenant has deliberately renamed. There is **no escape
  hatch**, by ruling. Note the honest edge this implies: because the write path
  persists the served body verbatim (ADR-0005 §Validation), a tenant who
  round-trips an object *without* renaming it freezes the extender's current
  scalar into the overlay row, and a later change to the package's extension
  scalar will not reach that tenant. That follows from comparison-based
  provenance with no flags, which is what the ruling required; it is recorded
  here rather than papered over.
- Options B (status quo — the extension keeps winning) and C (refuse the write)
  were considered and **rejected**. Dropping scalars from the fold entirely
  (#8284's arm B) remains rejected and is not this clause.

#### D9.3 — selection is by KIND; priority stays descriptive

`contributors.sort((a, b) => a.priority - b.priority)` (`:1189`) totals the whole
list, so the overlay needs a priority for deterministic ordering:
`DEFAULT_OVERLAY_PRIORITY = 150`, between `DEFAULT_OWNER_PRIORITY = 100` and
`DEFAULT_EXTENDER_PRIORITY = 200` (`:31-32`), so a `getObjectContributors()` read
lists the stack in layer order.

It is **not** the selection rule. Base selection asks the kind, never "highest
priority wins", because extender priority is author-declared (`ext.priority ?? 200`,
`engine.ts:2944`) and a package could otherwise re-rank a tenant's overlay by
declaring `priority: 140`. Declared numbers order *peers*; they must not be able
to change *which layer is the base*.

#### D9.4 — `computeFQN` is untouched, and the namespace loss is repaired for free

`computeFQN` is identity (`:61-63`); the overlay layer shares the owner's key and
this amendment introduces **no namespace dimension** — an overlay is a layer over
one object name, not a second object. The measured namespace loss (P5) is not
fixed by a rule but by subtraction: the packaged owner's contributor is no longer
removed, so its `namespace` field survives. Any future de-identity-ing of
`computeFQN` (ADR-0028's territory) inherits one key per object and therefore one
overlay slot per object, unchanged.

#### D9.5 — `assertSingleOwnerPerObject` is unchanged, and gains one violation class

`assertSingleOwnerPerObject` (`:1355-1379`) counts `ownership === 'own'`. Overlays
are not owners, so it keeps reading exactly one owner per object name — literally
the D3 sentence, with no exemption list. This matters beyond tidiness: ADR-0028's
D5/D6 (reserved `sys`, single-owner-per-object, apps-cannot-define-kernel)
**depend on** this ADR, and an ownership rule with a "unless it is an overlay"
clause would make their premise conditional.

One class is added: an **orphan overlay** — a contributor list holding an
`overlay` and no `own` — is a violation, in the same shape as the existing
"extenders but no owner". It is reachable (uninstall the packaged owner while a
tenant row for its object exists) and must be loud rather than silent, because
`resolveObject` would otherwise warn once and answer `undefined` for a name the
tenant can still see in `sys_metadata`. The removal rule that keeps it rare is
D9.7.

#### D9.6 — artifact identity is read from the OWNER contributor, never from the merged object

This is the clause that makes `isArtifactBacked` stop lying, and it is **not**
implied by D9.2 — it has to be decided, because D9.2 deliberately leaves the
merged body identical, `_provenance: 'org'` included.

`getArtifactItem(type, name)`'s object branch (`registry.ts:1727-1733`) currently
resolves `getObject(name)` — the merged body — and applies the
`_packageId`/`isTenantAuthored` test to it. Under D9 it applies that test to the
**owner contributor's definition**. Consequences:

- packaged object, tenant overlay present → owner is the package
  (`_provenance: 'package'`) → **artifact-backed: true** (today: false);
- runtime-authored object, no package layer → the owner *is* the tenant's row
  (`_provenance: 'org'`, or the `'sys_metadata'` sentinel) → **false**,
  unchanged, which is what keeps cloud#970 closed (an app the user just built
  must stay editable);
- everything non-`object` → untouched.

**The authoring-visible consequence, stated plainly.** With the predicate honest,
`saveMetaItem`'s gate refuses an overlay write to a packaged object with
`NOT_OVERRIDABLE` **every time**, not only the first — because `object` declares
`allowOrgOverride: false`. Today the first write is refused, and by destroying the
evidence it admits every subsequent write through the `allowRuntimeCreate` tier.
So this is the declared contract being enforced consistently, not a new
restriction; but a deployment that has been living in the post-first-write state
will see writes start being refused. The documented operator hatch
(`OS_METADATA_WRITABLE=object`, `protocol.ts:7380`) is the same one door as
before, and it now has to stay open for the *life* of the customization rather
than only for its first save. Deployments that cannot accept that must move the
customization into a package — which is the position ADR-0005's whitelist has
always taken for `object`.

#### D9.7 — removal, and why #6853's "restoration" question dissolves

- **Removing the overlay** (`SchemaRegistry.removeObjectOverlay(name)`, the
  layer-addressed sibling of #6818's name-addressed `unregisterObject`) drops the
  `overlay` contributor and nothing else. The packaged owner is already there, at
  its own priority, in its own namespace, with its own definition — so
  *restoration is not a re-registration at all*. This is the whole point of the
  direction: #6853's measured wall (the heal needs
  `(definition, packageId, namespace, ownership, priority)` and three of the five
  no longer exist when it runs) disappears, because the judgement moves to the
  moment the information is still in hand — **write time, where the packaged
  owner is one lookup away — instead of delete time, where it has been
  destroyed.**
- **Removing the object** (`unregisterObject`, `:1482-1520`) keeps its ADR-0029
  extender guard verbatim. Tier 3 of `restoreArtifactRegistryView` then reads:
  a packaged `own` survives → remove the overlay layer only; no packaged owner →
  remove the entry, as today.
- **Uninstalling the owning package** (`unregisterObjectsByPackage`, `:1385-1415`)
  takes the object's overlay layer with the owner it layers over. Nothing durable
  is lost: the layer is a runtime projection of a `sys_metadata` row that is not
  touched, and a re-install re-hydrates it. D9.5's orphan violation is the
  backstop for the seam this rule cannot reach by package id (a sentinel-bound
  layer over a package-bound owner).

#### D9.8 — the write-path discriminator, and where it lives

At each hydration seam the kind is chosen by asking the registry a question it
can answer:

```
packaged `own` contributor already registered for this name?
  yes -> register as `overlay`   (a layer over the code definition)
  no  -> register as `own`       (a runtime-authored object; today's behaviour,
                                  keyed by the row's package_id or the sentinel)
```

Both seams — `applyObjectRegistryMutation` and `loadMetaFromDb` — sit **after**
package registration in the real boot order (measured in P6), so the lookup is
answerable. The same discriminator is owed to the two metadata-service ingest
paths that also register `'own'` from a reloaded body
(`packages/objectql/src/plugin.ts:688-693`, `:765-770`); left alone they re-open
the splice through a third door.

#### D9.9 — #6995: the row's `package_id` is provenance on the layer, never an ownership claim

Because an overlay makes no ownership claim, `registerObject`'s "already owned by
package X" throw stops being reachable from the overlay seams at all, and the
silent-discard-with-success-receipt cannot recur. What replaces it, by the row's
binding `P` against the packaged owner's id `O`:

| case | verdict |
|:--|:--|
| `P == O` | the normal case — one overlay layer over `O`'s object. |
| `P` empty / absent (the `'sys_metadata'` sentinel) | **accepted.** A package-less env-wide overlay is ADR-0005's platform-global shape; the row addresses the object by name and the registry knows who owns it. Today this throws (measured, P2) — that refusal was an artefact of the borrowed slot, not a decision. |
| `P == Q`, some other package | **refused at the producer, loudly.** On the write path `saveMetaItem` returns an error (an ADR-0112-registered code minted by the implementation card) instead of a success receipt; at boot the row is not layered and is counted in `loadMetaFromDb`'s per-record `errors` with its reason — which that seam already does today (`protocol.ts:11706-11708`), and which is why #6995 is a **write-path** divergence and not a boot-path one. |

The last row is a real decision, not bookkeeping, and the reason is a store
asymmetry worth recording: the overlay-uniqueness index keys on
`(type, name, organization_id, COALESCE(package_id, ''))` (ADR-0005 amendment
2026-08-09, #6825), so `sys_metadata` can legitimately hold two active rows for
one `(type, name)` bound to two packages. For every other type that is fine —
two packages really can ship `page/home`. For `object` it is not representable:
`computeFQN` is identity, so the registry holds exactly one entry per object name
and could never serve two. Refusing the mis-bound row is what keeps the two
stores in agreement instead of letting `sys_metadata` describe a shape the
registry cannot hold. **At most one overlay layer per object name** in the
env-wide scope; per-org rows never enter the process-wide registry at all
(#6602, unchanged by this amendment).

---

### 4. The shape that was rejected: a second, owning kind

The ruling named the alternative as "a new ownership kind" — a contributor that
*also* owns, with `assertSingleOwnerPerObject` taught to accept two. Rejected:

- **It grants authority nothing consumes.** § 2 measured what ownership carries
  (namespace registration, the `_packageId` stamp at `:1314`, the table) and the
  overlay uses none of it.
- **It makes D3 conditional.** Every consumer of `getObjectOwner` (`:1332-1335`)
  would have to be re-read to decide *which* owner it means, and ADR-0028's
  D5/D6 rest on D3 being unconditional. An assertion with an exemption clause is
  an assertion that has to be re-litigated at every call site.
- **It re-opens the question the layer model closes.** "Two owners, one table"
  has no answer for who the table belongs to on uninstall; "one owner, one
  overlay layer" has the obvious one.

Rejecting it costs nothing that direction B wants: replace-semantics is
orthogonal to ownership, and D9.2 delivers replace without claiming an owner.

### 5. Blast radius, measured

Every site that reads `ObjectContributor.ownership` on `2f3e79351`, and what D9
does to it:

| site | today | under D9 |
|:--|:--|:--|
| `registry.ts:1075` default priority | `own ? 100 : 200` | third arm, `DEFAULT_OVERLAY_PRIORITY = 150` |
| `registry.ts:1116-1130` `provisionPrimary` / `provisionSearchCompanion` | gated on `own` | **gate becomes "is this a BASE layer" (`own` or `overlay`)**. Missing this is a silent regression: the overlay body *is* the resolved base, so skipping title provisioning would change `nameField` on every overlaid object. |
| `:1148-1155` second-owner throw | overlay hits it (#6995) | unreachable from the overlay seams |
| `:1157-1160` same-package `own` splice | **destroys the packaged body** | untouched; the overlay never enters this branch |
| `:1167-1170` same-package `extend` splice | — | mirrored for `overlay`: at most one layer, replaced on re-write |
| `:1217` base selection | `find(own)` | `find(overlay) ?? find(own)` |
| `:1228` extender fold | folds `extend` | unchanged |
| `:1314` `getAllObjects` `_packageId` stamp | the overlay's id | the packaged owner's id (the same value whenever `P == O`) |
| `:1332-1335` `getObjectOwner` | — | unchanged; keeps meaning "the package that owns the table" |
| `:1355-1379` `assertSingleOwnerPerObject` | — | unchanged + orphan-overlay class (D9.5) |
| `:1385-1415` `unregisterObjectsByPackage` | — | overlay layer leaves with its base (D9.7) |
| `:1482-1520` `unregisterObject` | — | extender guard unchanged; tier 3 calls the layer-addressed verb first |
| `:1727-1733` `getArtifactItem` object branch | reads the merged body | reads the owner contributor (D9.6) |
| `spec/data/object.zod.ts:2435` | `['own','extend']` | third value + the "loader-set, never authored" clause |
| `protocol.ts:7897-7911`, `:11670-11673` | register `'own'` | D9.8 discriminator |
| `objectql/src/plugin.ts:688`, `:765` | register `'own'` | D9.8 discriminator |

`ObjectContributor` is exported (`packages/objectql/src/index.ts:28`,
`core.ts:24`), so the widened union is a public type change for `objectui` /
`cloud` consumers and belongs in a minor with a changeset.

### 6. Deliberately left open for the implementation card

1. **Late install.** A package registering an object a tenant row already owns
   (`own` under the sentinel) still throws "already owned by". Recommended
   default: the code layer becomes the owner and the tenant contribution is
   re-classified as its overlay layer — the only outcome that loses nothing —
   but it is a second discriminator and wants its own measurement.
2. **The wire error code** for D9.9's mis-bound row: ADR-0112 makes `error.code`
   a closed vocabulary, so the code is minted with the implementation, not here.
3. **#7012's tier-3 package-binding guard.** Once D9 lands, `isArtifactBacked` is
   honest and that guard becomes redundant — but redundant is not wrong, and it
   fails in the cheap direction (REGISTER WIDE / RETIRE NARROW). Whether to
   retire it is a measured call for the card that lands D9, not a promise made
   here.
4. **Sequencing.** D9 is a runtime-representation change with no stored-format
   change: `sys_metadata` rows are untouched, so there is no ADR-0087 conversion
   and no migration. It can land after #7012 without coordinating with it.

### 7. Consequences

**Positive**

- A packaged object's definition survives a tenant overlay, so `isArtifactBacked`
  answers about the code layer instead of about whatever last overwrote it, and
  the two gates that read it stop silently disarming.
- The delete-time restoration problem (#6853) dissolves rather than being solved:
  nothing is destroyed, so nothing needs reconstructing from values that no
  longer exist.
- #6995's silent discard becomes either a legitimate layer (package-less rows) or
  a loud refusal (mis-bound rows); `saveMetaItem`'s receipt stops disagreeing
  with the registry.
- ADR-0005's overlay model — layers coexist, resolution decides — finally applies
  to `object` the way it already applies to every other type, instead of being
  approximated by a destructive in-place overwrite.

**Negative / costs**

- A third contributor kind is a permanent widening of the registry's vocabulary,
  and every future contributor walk has one more case to consider (§ 5 is the
  current census; it will grow).
- The honest gate refuses repeat overlay writes that today succeed (D9.6). This
  is the declared contract, and it is still a behaviour change a live deployment
  can feel.
- Two ingest paths (`plugin.ts:688`, `:765`) must adopt the discriminator or the
  splice returns through a third door — a coupling that is easy to miss because
  those paths are about metadata-service reloads, not about tenant overlays.

**Neutral / open**

- Whether an overlay layer should ever be *authorable* (a package shipping a
  layer over another package's object). D9.1 says no, on the "no new authoring
  surface" axis; if a real business case appears, it is a separate decision, not
  a widening of this one.

### 8. Anchors

`packages/objectql/src/registry.ts` is registered against ADR-0029 in
`scripts/adr-anchors.json` by this change. It was **unanchored**, which is the
recurrence shape Prime Directive #13 names and the same one #6825's amendment
found for ADR-0005: the file that implements D3 (the `own` splice at `:1157-1160`,
`assertSingleOwnerPerObject` at `:1355`, the extender guard at `:1490`) never said
which decision an author editing it was standing on — so the splice could be read
as an ordinary re-registration convenience, which is precisely how it came to
destroy a packaged definition.

`packages/metadata-protocol/src/protocol.ts` is deliberately **not** anchored to
ADR-0029 here. Its ADR-0029 relationship today is the defect this amendment
describes, not a realized decision; it earns its anchor with the implementation
that makes D9.8 true there.

### 9. What was verified, and what has no coverage

This amendment is prose, and **prose has no test coverage** — there is no
reverse-verification to report and none is manufactured. What was verified is
that every claim above matches the tree at `2f3e79351`: the two hydration seams
and their argument counts, the splice branch, the base-layer selection in
`resolveObject`, the additive-only `mergeObjectDefinitions`, the identity
`computeFQN`, the `own`-gated `provisionPrimary`, the merged-body read inside
`getArtifactItem`'s object branch, the `own`-only count in
`assertSingleOwnerPerObject`, the three `registerObject` kind call sites in
`engine.ts`, the zero runtime consumers of `ObjectOwnershipEnum`, and `object`'s
`allowOrgOverride: false` / `allowRuntimeCreate: true` registry entry. The
runtime behaviour it reasons about (P0-P6) was measured on #6853 at `51f2bb8c3`
and is cited, not re-derived.

The single-owner assertion is exercised by
`packages/objectql/src/registry-single-owner.test.ts` and the removal verb by
`registry-unregister-object.test.ts` /
`packages/metadata-protocol/src/protocol.delete-object-registry-unregister.test.ts`;
under D9 all three keep their current expectations, which is a consequence of
D9.2/D9.5 and a check the implementation card should confirm rather than a claim
this record can make on its own.
