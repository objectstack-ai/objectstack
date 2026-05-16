# ADR-0005: Metadata Customization Overlay (Artifact + sys_metadata Delta)

**Status**: Accepted (2026-05-16)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (Package as first-class citizen), [ADR-0004](./0004-cloud-multi-kernel.md) (Cloud + per-project kernels)
**Consumers**: `@objectstack/objectql`, `@objectstack/runtime`, `@objectstack/rest`, `apps/studio`, all customer-facing tenants

---

## Context

Studio ships an in-browser editor for views and dashboards. Customers expect "Save" to persist.
Until today, the runtime did not:

1. `PUT /api/v1/meta/view/<name>` in **project-kernel mode** updated only the in-memory registry and returned `200 { success: true, message: "Saved to memory registry (project kernel — sys_metadata is control-plane only)" }`. The change vanished on restart.
2. `GET /api/v1/meta/view/<name>` skipped `sys_metadata` entirely in project-kernel mode (`packages/objectql/src/protocol.ts:357`, `:369`).
3. `loadMetaFromDb()` returned `{ loaded: 0 }` early in project-kernel mode (`:1230`), so even if rows existed they would never be hydrated.

Worse, a separate detour — Studio's "Duplicate View" calls `POST /api/v1/data/sys_view` — wrote rows to a **physical projection table** (`sys_view`, 21 flat columns) that has nothing to do with the metadata protocol path. The same applies to `sys_flow`, `sys_agent`, `sys_tool`, `sys_object`. Each of these tables duplicates a Zod schema already defined in `@objectstack/spec` (`ui/view.zod.ts`, `automation/flow.zod.ts`, etc.) and goes out of sync the moment the spec evolves.

Three different things were tangled into one place:

| concern | wrong home | right home |
|---|---|---|
| view edit-form contract | hand-written 21 fields in `sys-view.object.ts` | Zod `ViewSchema` in `@objectstack/spec` |
| out-of-box view storage | "supposed to be" `sys_view` (but was only in-memory) | compiled artifact `dist/objectstack.json` → `SchemaRegistry` |
| customer overlay storage | not implemented (silent loss) | `sys_metadata` row, scoped by `project_id` |

## Decision

**Three layers, three sources of truth. No physical projection tables.**

```
 COMPILE TIME
   defineStack(...) ──bundle──► dist/objectstack.json         (immutable; full metadata)

 BOOT
   artifact ──load──► SchemaRegistry / MetadataService        (in-memory; out-of-box defaults)
   sys_metadata customizations ──load via loadMetaFromDb──► overlay (per project)

 RUNTIME READ   getMetaItem(type, name)
   1. sys_metadata WHERE (type, name, project_id, state='active')         ← overlay (wins)
   2. SchemaRegistry / MetadataService                                    ← artifact default

 RUNTIME WRITE  PUT  /api/v1/meta/{type}/{name}                           ← whitelist: view, dashboard
   - upsert sys_metadata (full JSON in `metadata` column, `scope='project'`)
   - update SchemaRegistry + MetadataService for immediate read
   - history snapshot via sys_metadata trackHistory

 RUNTIME RESET  DELETE /api/v1/meta/{type}/{name}
   - delete sys_metadata row     → next read falls through to artifact
   - registry refresh from MetadataService for immediate effect
```

### Design principles (binding)

1. **One Zod schema per metadata type.** Every metadata type (`view`, `dashboard`, `flow`, `agent`, `tool`, `object`, `report`, `skill`, `rag-pipeline`, `action`, ...) has exactly one definition source: the Zod schema in `@objectstack/spec`. **No mirrored `*.object.ts` is permitted in `packages/platform-objects/src/metadata/`.**
2. **Artifact is immutable at runtime.** Out-of-box defaults always come from the compiled artifact, never written back to.
3. **Customizations are full-JSON deltas, not field-level patches.** Phase 1 stores the entire item document. A finer-grained patch model (RFC 7396, 3-way merge) is out of scope — `MetadataOverlaySchema` in `metadata-customization.zod.ts` already specifies it; we keep that model available for future phases but do **not** implement merge yet.
4. **Forms render from Zod, not from physical tables.** Studio's view/dashboard editors generate their forms from `@objectstack/spec` Zod schemas through `z.toJSONSchema()`. Forms never reflect a `*.object.ts` shape.
5. **Whitelist by type.** Only types explicitly enabled for overlay can be saved through `PUT /api/v1/meta/*`. Phase 1 ships with `view` and `dashboard` enabled; other types return `400 customization_not_allowed`.

### Storage shape

`sys_metadata` schema (`packages/platform-objects/src/metadata/sys-metadata.object.ts`) is the storage substrate. No schema changes needed in Phase 1:

| column | role |
|---|---|
| `id` | UUID |
| `type` | metadata type (e.g. `view`, `dashboard`) |
| `name` | item name (snake_case) |
| `project_id` | scope key — `NULL` for platform-global, set for per-project overlays |
| `scope` | label `'project'` or `'platform'` (cosmetic; project_id is authoritative) |
| `metadata` | **full JSON document** (entire view/dashboard payload) |
| `state` | `'active'` (or `'archived'` for soft-delete) |
| `version` | monotonic counter for optimistic concurrency |
| `created_at` / `updated_at` | audit timestamps |

The existing unique index `(type, name, project_id)` already enforces "one customization per item per project". Multi-tenant (per-organization) refinement is **Phase 2** — see Open Questions.

### Read order

`getMetaItem` is rewritten to query in this order:

1. `sys_metadata` overlay row (`project_id = this.projectId ?? null`).
2. In-memory `SchemaRegistry` (control-plane kernels only — project kernels skip because the registry is process-global).
3. `MetadataService` (artifact source on project kernels; runtime-registered items on control plane).

### Whitelist enforcement

Implemented in `saveMetaItem` and `deleteMetaItem`:

```ts
const OVERLAY_ALLOWED_TYPES = new Set(['view', 'views', 'dashboard', 'dashboards']);
if (this.projectId !== undefined && !OVERLAY_ALLOWED_TYPES.has(request.type)) {
  throw new Error('[customization_not_allowed] ...');
}
```

Single-kernel deployments (no `projectId`) keep their existing behaviour (any type writable).

### Deprecation of duplicated metadata `*.object.ts`

Five files in `packages/platform-objects/src/metadata/` duplicate a Zod schema that already exists in `@objectstack/spec` and contributed nothing but drift risk. They are marked `@deprecated` immediately and slated for removal in the next major release:

| deprecated `*.object.ts` | canonical Zod schema |
|---|---|
| `metadata/sys-view.object.ts` | `spec/src/ui/view.zod.ts` |
| `metadata/sys-flow.object.ts` | `spec/src/automation/flow.zod.ts` |
| `metadata/sys-agent.object.ts` | `spec/src/ai/agent.zod.ts` |
| `metadata/sys-tool.object.ts` | `spec/src/ai/tool.zod.ts` |
| `metadata/sys-object.object.ts` | `spec/src/data/object.zod.ts` |

`sys-metadata.object.ts` and `sys-metadata-history.object.ts` are retained — they are the storage substrate, not duplicates of any metadata type.

`MetadataProjector` (`packages/metadata/src/projection/metadata-projector.ts`) becomes dead code under this ADR. It is left in place for one release as a no-op safety net, and removed in the next major along with the deprecated objects.

## Consequences

### Positive

- `PUT /api/v1/meta/view/<name>` and `PUT /api/v1/meta/dashboard/<name>` now **persist** in project-kernel mode. The silent loss is gone.
- Customizations survive restart, because `loadMetaFromDb` no longer short-circuits on project kernels.
- `DELETE /api/v1/meta/{view,dashboard}/<name>` provides a "reset to factory default" semantic without restarting the kernel.
- The duplicated `*.object.ts` files no longer mislead developers into thinking the metadata flows through a physical projection table.
- Zod-first prime directive enforced at the binding layer, not just code review.

### Negative / accepted trade-offs

- **Full-document replacement, not patch.** A customer who changed one column width still ships a full view JSON. Diff/merge tooling is a follow-up phase, gated on the customer scenarios that actually need it.
- **Per-organization isolation deferred to Phase 2.** Phase 1 scopes overlays by `project_id` only. In single-tenant per-project deployments this is identical to "single overlay per environment". A `(project_id, organization_id)` composite scope is planned once the auth context plumbs `organization_id` end-to-end.
- **Package upgrade conflicts not detected.** If a customer overlay references a field the package later removes, the overlay will hide the new value but `getMetaItem` returns the customer JSON unchanged. A `validateCustomizationAgainstArtifact()` boot pass is planned for the phase that introduces in-place package upgrades.
- **Studio data-plane writes (`POST /api/v1/data/sys_view`) still work** during the deprecation window. After Studio is cut over to `PUT /api/v1/meta/view/<name>`, a one-time migration script translates surviving rows into `sys_metadata` overlay rows.

### Open questions

1. **Organization-level overlay** vs project-level: Phase 2 work. Requires (a) auth context propagation, (b) composite unique index, (c) read-order extension `org → project → artifact`.
2. **Artifact source** (`local-file` vs `artifact-api` vs OCI layer): out of scope for this ADR — see `MetadataPluginConfigSchema.bootstrap` in `metadata-plugin.zod.ts`. Cache invalidation when a new artifact ships in production will be a separate ADR.
3. **Studio Zod-to-form pipeline**: Phase 6. Studio currently has bespoke form components per metadata type. Migrating to a shared Zod-driven renderer is independent of this ADR but completes the principle.
4. **Security objects (`sys-role`, `sys-permission-set`)**: candidates for a separate ADR (Phase 5b). They mix "role definition" (metadata-like) and "role assignment" (runtime data) in the same table — the split mirrors the customization/data divide formalised here.

## Verification

- Unit:`saveMetaItem` upserts on `(type, name, project_id)`; `deleteMetaItem` removes the row; whitelist enforced.
- Integration: PUT writes a row; GET returns the overlaid value; restart preserves; DELETE returns to artifact default.
- Browser E2E: Studio dashboard edit + save + reload demonstrates persistence in `examples/app-crm`.
- SQL: `sys_metadata` rows visible with `type='dashboard'`, `scope='project'`, `metadata` containing the full JSON document.

---

## References

- `packages/objectql/src/protocol.ts` — `getMetaItem`, `saveMetaItem`, `deleteMetaItem`, `loadMetaFromDb` (this ADR's primary site)
- `packages/rest/src/rest-server.ts` — `PUT/GET/DELETE /api/v1/meta/:type/:name` routes
- `packages/spec/src/api/protocol.zod.ts` — `ObjectStackProtocol` interface (`deleteMetaItem` added)
- `packages/spec/src/kernel/metadata-plugin.zod.ts` — `MetadataTypeRegistryEntrySchema.supportsOverlay` (future hook for the whitelist)
- `packages/spec/src/kernel/metadata-customization.zod.ts` — pre-existing `MetadataOverlaySchema` (kept; field-level patches are a future phase, not implemented here)
- `packages/platform-objects/src/metadata/sys-{view,flow,agent,tool,object}.object.ts` — files marked `@deprecated` by this ADR
- `examples/app-crm` — primary E2E reference workspace

---

## Addendum — 2026-05-16: Phase 4 list-merge gate fix + overlay id-stripping rule

Two implementation issues were discovered during browser E2E verification with `examples/app-crm` and fixed:

### 1. List endpoint did not include overlay rows in project kernels

`getMetaItems(type)` in `packages/objectql/src/protocol.ts` was gated by
`if (this.projectId === undefined)` before consulting `sys_metadata`. Project
kernels — which are precisely where overlays live — therefore returned only
artifact entries. `GET /api/v1/meta/view` listed 16 artifact items and zero
overlays even when overlay rows existed.

**Fix:** removed the gate. List responses now merge artifact entries with
overlay rows from `sys_metadata` for the active organization.

### 2. Overlay payload must not inherit the source artifact's `id`

When the Console "Duplicate view" action stored a new overlay, it spread the
source view spec verbatim into the overlay payload. Artifact views include an
internal `id` field, so the duplicate overlay (stored under a new `name` like
`all_leads_copy_xxx`) carried `id='all_leads'` from the source. The Console
tab-bar dedup logic keys on `id`, so the duplicate silently shadowed the
original tab.

**Rule (now binding):** **overlay specs are name-keyed only**. Clients must
strip the `id` field from any source spec before persisting an overlay. The
Console additionally normalises loaded overlays via `id: spec.name || spec.id`
as defence-in-depth.

### Verified operations (browser E2E)

After the fixes, all view-CRUD operations were verified end-to-end in
`examples/app-crm` against `sys_metadata`:

| Operation | Storage check |
|---|---|
| Duplicate | new row appears with clean `name`-keyed identity |
| Pin | `isPinned=1` persisted |
| Rename | `label` persisted |
| Set as default | `isDefault=1` persisted (other rows cleared) |
| Delete | row removed, tab disappears, URL navigates away |
| Reload | overlay tab survives page refresh |
| GET `/api/v1/meta/view/:name` | returns full merged spec |

---

## Addendum — 2026-05-16 (b): deprecated metadata objects deleted

The five deprecated metadata-projection objects (`sys_object`, `sys_view`,
`sys_flow`, `sys_agent`, `sys_tool`) were **removed entirely** in this cycle:

- Deleted: `packages/platform-objects/src/metadata/sys-{object,view,flow,agent,tool}.object.ts`
- Deleted: `packages/metadata/src/projection/` (`MetadataProjector` class and re-exports)
- Removed from `packages/metadata/src/plugin.ts` `queryableMetadataObjects` array — only `sys_metadata` + `sys_metadata_history` remain (the ADR-0005 storage substrate)
- Removed from Setup app navigation (`packages/platform-objects/src/apps/setup.app.ts` "Platform" group): `Objects / Views / Flows / Agents / AI Tools` entries are gone. The remaining Platform entries are `Apps / Packages / Installations / All Metadata`
- `DatabaseLoader.enableProjection` option and `projector` field deleted; save/delete paths no longer fan out to projection tables
- `service-ai/ai-conversation.object.ts` `agent_id` field switched from `Field.lookup('sys_agent', …)` to `Field.text` since the lookup target no longer exists — AI agents are metadata-only and identified by `name` inside `sys_metadata`
- New idempotent cleanup migration: `dropProjectionTables(driver)` exported from `@objectstack/metadata/migrations`, drops the five stale tables from databases provisioned before this cycle

After the change, `/api/v1/data/sys_view` (and the four siblings) returns **404
object_not_found**. All metadata customisation flows through the overlay
endpoints (`PUT/GET/DELETE /api/v1/meta/{type}/:name`) backed by
`sys_metadata` JSON rows only.
