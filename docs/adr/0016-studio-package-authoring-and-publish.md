# ADR-0016: Studio Package Authoring & One-Click Publish

**Status**: Partially implemented (revised 2026-05-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type, org overlay), [ADR-0006 v4](./0006-project-environment-split.v4.md) (drop project, unify on package), [ADR-0008](./0008-metadata-repository-and-change-log.md) (Repository/ChangeLog/Cache/Registry, four write surfaces), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection)
**Consumers**: `@objectstack/spec/cloud`, `@objectstack/runtime`, `@objectstack/metadata`, `@objectstack/rest`, `@objectstack/cli`, `../objectui` (Studio)

---

> **Revision note (2026-05-30) — read §9 first.** §§1–8 below capture the
> original *cloud-publish* vision (draft `sys_package_version` sealing,
> `package_version_id` binding, one-click publish to a cloud control plane).
> The first shipped slice **pivoted to a local-first path** that needs no cloud
> account, no draft-version sealing, and no `package_version_id`. The two key
> divergences from the original design are:
>
> 1. **Binding is on `package_id`, not `package_version_id`.** Studio saves bind
>    a metadata row directly to its owning package (`package_id`); there is no
>    draft-version workspace in the MVP. Wherever §§1–8 say
>    `package_version_id` for the *Studio authoring binding*, read `package_id`.
>    `package_version_id` remains reserved for the future cloud seal/publish
>    pipeline (§3.5, §4 Phase 4).
> 2. **Distribution is local export/import, not cloud publish.** A package is
>    exported to a self-contained JSON manifest and imported on another server
>    with zero cloud auth (§9.2). Cloud one-click publish (§3.6 step 5) is
>    deferred.
>
> §9 documents what actually shipped; §§1–8 remain the north star for the cloud
> phase.

---

## 0. Context

Studio is a metadata-driven admin app that already lets a user browse and
edit metadata visually. Two recent changes set the stage for a cloud
authoring loop:

- A sidebar **package scope** selector (`active_package`) was added; it now
  lists only third-party (non-kernel) packages, with a "no package" option.
- Recently-viewed tracking was fixed for metadata routes.

But the **authoring → publish closed loop is not yet implemented**. Today:

1. Studio create/edit (`objectui:ResourceEditPage.tsx`) calls
   `client.save(type, name, item, { force, mode:'draft' })` with **no
   `packageId`**. Per ADR-0003 this produces a **runtime/overlay** row
   (`env_id` set, `package_id` NULL, loaded under sentinel `'sys_metadata'`,
   `provenance='runtime'`). It is env-local — it never becomes part of a
   shippable package.
2. There are **two publish paths** (per ADR-0006 v4):
   - `os publish -e <env>` → `POST /cloud/environments/:id/metadata` →
     env **revision** (legacy).
   - `os package publish` → `POST /cloud/packages` → `POST
     /cloud/packages/:id/versions` → install (strategic, Phase B).
   Neither is reachable from Studio. The user must drop to the CLI and author
   metadata in local files, not in the visual editor.

The user's goal: **inside Studio, select (or create) a package, visually
author metadata that is bound to that package, preview it, then one-click
publish it to the cloud** — without leaving the browser and without writing
local files.

## 1. Goals & Non-goals

### Goals

- A first-class **cloud authoring workspace** for a package that lives in the
  control plane (not in env-local overlay rows).
- Studio binds created/edited metadata to the selected package's authoring
  workspace instead of producing an env-local overlay.
- A **preview** mechanism so authors see their in-progress package running in
  a real environment before publishing.
- A **one-click publish** action that seals the workspace into an immutable
  `sys_package_version` and installs it into a chosen environment.
- **CLI parity**: `os package publish` and the Studio button hit the same
  control-plane endpoints (ADR-0006 v4 Phase B).
- Reuse existing schema as much as possible — minimal new protocol surface.

### Non-goals

- Marketplace listing / monetization (separate `service-marketplace`).
- Multi-author concurrent editing / locking semantics beyond ADR-0010.
- Replacing the local-files + `os publish` flow for power users; both
  coexist (ADR-0006 v4 "two flows, one schema").
- Git-style branching of package versions (single active draft per package
  per org for v1).

## 2. Decision

Introduce a **draft package version as the cloud authoring workspace**, and
make the Studio `active_package` selector the **authoring target**.

1. **Draft `sys_package_version` = authoring workspace.** A package may have
   at most **one active `draft` version per org** (ADR-0003 already defines
   `status ∈ {draft, published, deprecated}`). The draft is mutable; metadata
   rows bound to it carry `package_version_id = <draft.id>`.

2. **Selector designates the authoring target.** When a package is selected in
   the sidebar, Studio create/edit binds the row to that package's draft
   version (`package_version_id`). When **"no package"** is selected, the
   existing behavior holds: a NULL-package **env-local overlay**
   (`provenance='runtime'`). This makes the user's earlier question — *"is
   creating without a package allowed?"* — an explicit, intentional choice:
   no-package = personal/env customization; package = shippable artifact.

3. **Preview via draft install.** A dev/sandbox environment installs the draft
   version (`allowDraft`, per ADR-0003) so authors see their package running
   live. Preview installs are flagged and never auto-promoted to production.

4. **One-click publish.** The publish action:
   1. **Seals** the draft → `published` (freeze `manifest_json`, compute
      checksum, assign immutable semver).
   2. **Upserts** `sys_package_installation` into the chosen target
      environment (pointer swap to the new `package_version_id`).
   3. Opens a fresh `draft` for continued authoring (next version).
   This reuses ADR-0006 v4 Phase B endpoints — no new publish pipeline.

5. **One schema, two write surfaces (ADR-0008).** Package-bound edits and
   env-local overlays are the same `sys_metadata` shape, discriminated by
   `package_version_id`. The ChangeLog records both; the Registry resolves
   precedence (published < draft-preview < env overlay, see §3.4).

## 3. Detailed design

### 3.1 Schema reuse (no new tables)

Everything needed already exists from ADR-0003:

| Concern | Existing artifact | Use in this ADR |
|---|---|---|
| Authoring workspace | `sys_package_version` `status='draft'` | The mutable draft per package/org |
| Binding | `sys_metadata.package_version_id` | Set to draft id on package-bound edits |
| Env-local overlay | `sys_metadata` with NULL package | Unchanged "no package" path |
| Install/preview | `sys_package_installation` (+ `allowDraft`) | Preview + publish target |
| Sealing | `sys_package_version.manifest_json` + checksum | Frozen on publish |

New protocol surface is limited to **a draft-resolution helper** and an
optional `is_preview` flag on installation (see §3.5). No new top-level
metadata type is introduced.

### 3.2 Authoring-target resolution

Studio needs the **draft version id** for the selected package. Resolution
order when the user selects package `P` in org `O`:

1. If `P` has an active `draft` version for `O` → use it.
2. Else **lazily create** a draft (`status='draft'`, base = latest
   `published` version's manifest, or empty if first version) and use it.

The draft id is held in Studio app context (alongside `active_package`) and
attached to every save while that package is the authoring target.

### 3.3 Studio save flow change

`ResourceEditPage` save changes from:

```ts
client.save(type, name, item, { force, mode: 'draft' });
```

to (when a package is the authoring target):

```ts
client.save(type, name, item, {
  force,
  mode: 'draft',
  packageVersionId: activeDraftVersionId, // binds to the package draft
});
```

When "no package" is selected, `packageVersionId` is omitted → unchanged
env-local overlay. The REST `save` handler routes the row to
`package_version_id` instead of `env_id`.

### 3.4 Resolution precedence (Registry)

For a given `MetaRef = {org, type, name}` the Registry (ADR-0008) resolves in
order of increasing specificity:

1. **Platform-global** (both `env_id` and `package_id` NULL).
2. **Published package version** installed in the env (`package_version_id`,
   immutable, locked per ADR-0010).
3. **Draft-preview** (the draft version installed for preview in this env) —
   shadows the published row so authors see work-in-progress.
4. **Env-local overlay** (`env_id` set, NULL package) — highest precedence,
   personal customization, unchanged.

Draft-preview rows are only visible in environments that explicitly installed
the draft (`allowDraft` + `is_preview`); production envs never see drafts.

### 3.5 API surface

Reuse ADR-0006 v4 Phase B endpoints; add only what is missing:

| Action | Endpoint | Notes |
|---|---|---|
| Resolve/ensure draft | `POST /cloud/packages/:id/draft` | Idempotent; returns active draft version (lazily creates per §3.2) |
| Bind metadata to draft | `POST /api/v1/metadata/:type/:name` (existing save) | Now accepts `packageVersionId` |
| Preview install | `POST /cloud/environments/:envId/installations` | `{ packageVersionId, isPreview: true }` (allowDraft) |
| Publish (seal) | `POST /cloud/packages/:id/versions` | Seals draft → published; freezes manifest + checksum |
| Install to target | `POST /cloud/environments/:envId/installations` | `{ packageVersionId }` pointer swap |

`isPreview` is the one **new field** on `sys_package_installation`
(boolean, default false) — distinguishes preview installs from production so
they can be listed/garbage-collected separately.

### 3.6 Studio UX flow

1. **Select / create package.** Sidebar `active_package` selector gains a
   "+ New package" item → small wizard (id `com.acme.foo`, name, version
   `0.1.0`). Creating sets it as authoring target and ensures a draft (§3.2).
2. **Author.** Create/edit objects, views, flows, etc. Each save binds to the
   draft (§3.3). Provenance badge shows **Draft (package)** vs **Runtime
   (env-local)** vs **Published (locked)** (ADR-0010 lock state drives
   editability).
3. **Preview.** "Preview" button installs the draft into the author's
   sandbox env (`isPreview`) and opens the running app.
4. **Review / diff.** Show the ChangeLog (ADR-0008) for the draft: what was
   added/changed vs the last published version.
5. **Publish.** "Publish" button → pick target environment → seal draft →
   install. Success toast links to the running app and the new version.

### 3.7 CLI parity

`os package publish` performs the same three control-plane calls (seal →
version → install). The Studio button and the CLI are interchangeable; both
go through `POST /cloud/packages/:id/versions`. Local-files authors keep
using `os publish` / `os package publish`; Studio authors never touch files.

### 3.8 Protection interplay (ADR-0010)

- **Draft** rows: editable/deletable (L3 `_lock` absent).
- On **publish**, the sealed version's rows inherit the package
  `metadataDefaults.lock` (L2) → installed published rows are **read-only** in
  consuming envs; customization happens via env-local overlay (path 4 in
  §3.4), exactly as today.
- Platform/kernel packages (`scope ∈ {system, cloud}`) remain excluded from
  the authoring selector — you cannot author into a kernel package.

## 4. Phasing

This realizes "Phase 5 Builder UX" of ADR-0006 v4 inside Studio, layered on
the already-shipped Phase B package endpoints.

- **Phase 1 — Binding.** REST `save` accepts `packageVersionId`; metadata
  router writes `package_version_id`. `POST /cloud/packages/:id/draft`
  (resolve/ensure draft). Studio attaches the active draft id to saves.
- **Phase 2 — Provenance UX.** Provenance badges (draft / published / runtime)
  in `ResourceListPage` + `ResourceEditPage`; "+ New package" wizard in the
  sidebar selector.
- **Phase 3 — Preview.** `isPreview` installation field; "Preview" button +
  sandbox install + open-app.
- **Phase 4 — Publish.** "Publish" button → env picker → seal + install;
  ChangeLog diff view; auto-open next draft.
- **Phase 5 — Polish.** GC of stale preview installs; multi-version history
  browsing; CLI/Studio parity tests.

## 5. Consequences

### Positive

- Closes the visual authoring → publish loop entirely in the browser.
- No new metadata type; reuses ADR-0003 draft versions and ADR-0006 v4
  endpoints. One `sys_metadata` shape, one publish pipeline.
- Makes "no package" an explicit, meaningful choice (env-local customization)
  rather than an accidental default.
- Studio and CLI converge on the same control-plane contract.

### Negative

- Introduces a stateful "authoring target" (active draft) in Studio context
  that must be kept consistent with the sidebar selector.
- Preview installs add lifecycle/GC burden (mitigated by `isPreview` flag).
- Draft-preview resolution adds a precedence layer to the Registry (§3.4).

### Neutral

- Local-files + `os publish` flow is unaffected; both surfaces coexist.
- Lock semantics are unchanged — published artifacts stay read-only, overlay
  customization path is preserved.

## 6. Alternatives considered

1. **Author directly as env-local overlays, then "promote" to a package.**
   Rejected: promotion would have to reverse-engineer package membership from
   loose overlay rows, re-introducing the ADR-0003 problem of packages with no
   identity. Binding at author time is cleaner.
2. **A dedicated new "authoring session" table.** Rejected: `sys_package_version`
   with `status='draft'` already is the mutable workspace; a parallel table
   would duplicate ADR-0003 and fork the publish pipeline.
3. **Git-backed package source in the browser.** Rejected for v1: heavyweight;
   the control-plane draft already provides atomic seal/version semantics.
4. **Multiple concurrent drafts per package.** Deferred: single active draft
   per package/org keeps resolution unambiguous; branching can come later.

## 7. Open questions

- **Draft conflict / multi-author.** If two admins edit the same package
  draft, do we need optimistic locking on `sys_package_version` rows beyond
  ADR-0010 L3? (Lean: row-level `_version` check; defer real collaboration.)
- **Preview env provisioning.** Does each author get an auto-provisioned
  sandbox env, or reuse their current env with preview installs? (Lean:
  reuse current env + `isPreview`, with a visible banner.)
- **Versioning UX.** Auto-bump semver on publish, or prompt? (Lean: prompt with
  suggested patch bump.)
- **Cross-package references.** If draft package A references metadata owned by
  published package B, how is the dependency recorded in `manifest_json`?
  (Likely an extension of ADR-0003 dependency edges — out of scope here.)

## 9. Implemented MVP (revision 2026-05-30) — local-first authoring & distribution

The first shipped slice deliberately avoids the cloud control plane so a user
can author a package and move it between servers with **no account, no draft
sealing, and no network publish**. It realizes the *author → bind → list →
distribute* loop locally; the cloud seal/publish pipeline (§§2–4) layers on top
later without re-modelling.

### 9.1 Binding on `package_id` (not `package_version_id`)

Studio's save flow (`ResourceEditPage`) now passes the **owning package id**:

```ts
client.save(type, name, item, {
  force,
  mode: 'draft',
  packageId: activePackageId, // binds the row to the package directly
});
```

The REST `save` handler / metadata router persists `package_id` on the
`sys_metadata` row. When **"no package"** is selected, `packageId` is omitted
and the row stays an env-local overlay (`package_id` NULL), exactly as §2.2
describes. There is **no draft `sys_package_version`** in the MVP — a package
is a flat collection of `package_id`-tagged metadata. This keeps resolution
trivial (registry items and overlay rows both carry `_packageId`) and defers
versioning/sealing to the cloud phase.

> Migration note: earlier drafts of this ADR (and some code comments) referred
> to `package_version_id` as the Studio binding. The implemented binding is
> `package_id`. `package_version_id` is reserved for sealed cloud versions.

### 9.2 Local export / import (zero cloud auth)

A package is portable as a single self-contained JSON manifest.

| Action | Endpoint | Behaviour |
|---|---|---|
| **Export** | `GET /api/v1/packages/:id/export` | Assembles a manifest `{ id, name, version, label?, <pluralKey>: [...] }` from every `package_id`-bound metadata item (objects, views, apps, flows, …). `datasources`/`emailTemplates` are excluded (host-specific). Top-level `_`-prefixed provenance keys are stripped. |
| **Import** | `POST /api/v1/marketplace/install-local` | Accepts an **inline** `{ manifest }` body. Skips the cloud-URL guard and cloud fetch entirely; derives `packageId`/`version` from the manifest. Still requires an authenticated local session and runs the conflict check. |

Studio surfaces both: an **Export** action in the package detail sheet
(downloads `<id>.package.json` via a Blob) and an **Import** button in the
Packages page toolbar (hidden file input → POST inline manifest → result
banner). See §9.4 for the page entry point.

Export item-set note: export trusts the **query-level `packageId` filter** in
`getMetaItems` rather than re-filtering by `_packageId === packageId`, because
objects are tagged with a provenance sentinel (`_packageId='sys_metadata'`),
not the package id. Re-filtering on equality would wrongly drop objects.

### 9.3 Register-before-persist (hot-register is a hard error on inline import)

On an **inline** import the manifest is **hot-registered into the live engine
*before* anything is persisted**. If hot-registration fails (e.g. the package's
objects conflict with already-registered objects — which is exactly what
happens when re-importing onto the *source* server), the request fails with
**422 and nothing is written**. This guarantees an import either fully takes
effect in the running process or leaves no partial state behind.

(The pre-existing *cloud-fetch* import path stays lenient — a hot-register
failure there only warns, because the persisted rows will be picked up on the
next boot.)

### 9.4 Packages page entry point

Studio gained a dedicated **Packages page** (`PackagesPage.tsx`) — a full list
of installed packages with a detail sheet — not just the sidebar `active_package`
switcher. The page is the home for: viewing a package's metadata, **enable /
disable**, **export**, and **import**. The sidebar selector remains the
*authoring-target* picker (which `package_id` new saves bind to); the Packages
page is the *management* surface.

### 9.5 Enable / disable hides metadata from the console

`PATCH /api/v1/packages/:id/disable` (and `/enable`) flips the package's
`enabled`/`status` flags and **persists the choice across restarts** (§9.7). A
disabled package's metadata must stop surfacing in the console (app switcher,
view lists, dashboards, …). This is enforced in two layers of the read path:

1. `SchemaRegistry.listItems(type, …)` filters out items whose owning package
   is disabled (via `isPackageDisabled(_packageId)`), for every type **except**
   `package` (the Packages page must still list disabled packages so they can
   be re-enabled) and `object`/`objects` (filtering object *schemas* would
   break data queries that depend on them).
2. `getMetaItems` re-applies the same filter to the **final merged set**,
   because the `sys_metadata` DB-overlay merge and the MetadataService merge can
   re-introduce a disabled package's items after the registry filter ran. Apps
   and views persisted as overlay rows were leaking back without this second
   pass.

Disable is reversible and non-destructive: items stay registered and reappear
on enable. Disable state survives restarts (§9.7).

### 9.6 `tools` / `skills` round-trip on export & import

Export (`assemblePackageManifest`) is driven by the canonical
`PLURAL_TO_SINGULAR` map, and import consumption by
`engine.registerApp`'s `metadataArrayKeys`. Both now include `tools` (→ `tool`)
and `skills` (→ `skill`), and `PLURAL_TO_SINGULAR` gained those entries (so the
reverse `SINGULAR_TO_PLURAL` and export round-trip them automatically).
`ObjectStackDefinition` also gained a top-level `tools` field next to `agents`
and `skills` for authoring completeness. This covers **metadata** round-trip and
visibility (`getMetaItems('tool' | 'skill')`); turning an imported tool
definition into an *executable* `ToolRegistry` entry (handler wiring) is a
deeper AI-runtime concern and remains out of scope.

### 9.7 Persisting package disable state across restarts

The `SchemaRegistry` is rebuilt from the compiled artifact on every boot (always
enabled), so disable state would otherwise be lost. Persistence is local-first:

1. `SchemaRegistry.setInitialDisabledPackageIds(ids)` seeds a set of ids that
   `installPackage` honors — any package whose id is in the set is installed in
   the `disabled` state. Because the set lives on the registry for its lifetime,
   **every** registration path (boot artifact, marketplace rehydrate, local
   import) honors it uniformly — no fragile post-boot re-application hook.
2. `packages/runtime/src/package-state-store.ts` persists the disabled-id set to
   `<OS_HOME>/package-state/<environmentId>.json`, keyed per environment so
   disables never leak between environments.
3. `AppPlugin.init` reads the persisted set and seeds the registry **before** the
   manifest is decomposed.
4. The `enable`/`disable` HTTP handlers (`handlePackages`) write the new state to
   the store after flipping the registry flag.

### 9.8 Known gaps / deferred

- **CLI export/import** (`os package export` / `import`) — deferred; only the
  REST + Studio surfaces ship in the MVP.
- **Executable tool wiring on import** — imported `tool` metadata is visible and
  re-exportable, but not registered as an executable `ToolRegistry` handler (§9.6).
- **Cloud one-click publish** (§3.6 step 5, delegated auth) — deferred to the
  cloud phase; the local path above is the interim distribution mechanism.

## 10. References

- [ADR-0003](./0003-package-as-first-class-citizen.md) — Package + versioned releases
- [ADR-0005](./0005-metadata-customization-overlay.md) — One Zod source, org overlay
- [ADR-0006 v4](./0006-project-environment-split.v4.md) — Drop project, unify on package; Phase B publish
- [ADR-0008](./0008-metadata-repository-and-change-log.md) — Repository/ChangeLog/Cache/Registry
- [ADR-0010](./0010-metadata-protection-model.md) — L1/L2/L3 protection
- `packages/cli/src/commands/package/publish.ts` — CLI publish (seal → version → install)
- `../objectui/.../metadata-admin/ResourceEditPage.tsx` — Studio save flow (binding point)
- `../objectui/.../layout/UnifiedSidebar.tsx` — `active_package` selector (authoring target)
- `packages/runtime/src/http-dispatcher.ts` — `assemblePackageManifest` + `GET /packages/:id/export` (§9.2)
- `packages/runtime/src/cloud/marketplace-install-local-plugin.ts` — inline-manifest import + register-before-persist (§9.2–9.3)
- `packages/objectql/src/registry.ts` — `isPackageDisabled` + `listItems` disabled-package filter (§9.5); `setInitialDisabledPackageIds` + `installPackage` disable seeding (§9.7)
- `packages/objectql/src/protocol.ts` — `getMetaItems` final-merge disabled-package filter (§9.5)
- `packages/objectql/src/engine.ts` — `registerApp` consumes `tools` / `skills` (§9.6)
- `packages/spec/src/shared/metadata-collection.zod.ts` — `PLURAL_TO_SINGULAR` gains `tools` / `skills` (§9.6)
- `packages/spec/src/stack.zod.ts` — top-level `tools` on `ObjectStackDefinition` (§9.6)
- `packages/runtime/src/package-state-store.ts` — per-environment disable-state file (§9.7)
- `packages/runtime/src/app-plugin.ts` — seeds persisted disable state before manifest decompose (§9.7)
- `../objectui/.../metadata-admin/PackagesPage.tsx` — Packages page + Export/Import UI (§9.4)
