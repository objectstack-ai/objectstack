# ADR-0034: Runtime editing reuses studio's per-item draft → publish → version model (retire `sys_view` / `sys_report` / `sys_dashboard`)

**Status**: Implemented (2026-06-06) — see [#1533](https://github.com/objectstack-ai/objectui/pull/1533) (chrome + view-create seam) and [#1534](https://github.com/objectstack-ai/objectui/pull/1534) (retire `sys_*`, drop the flag).
**Author**: ObjectUI renderer team
**Consumers**: `@object-ui/app-shell` (ObjectView / ReportView / DashboardView + metadata-admin), `@object-ui/data-objectstack` (metadata client), and the ObjectStack backend (`/api/v1/meta/*`).

---

## TL;DR

The console edits the same artifacts — **views, reports, dashboards** — in **two unrelated stores**:

- **Studio** → the metadata overlay: `PUT /meta/:type/:name` with `mode: 'draft' | 'publish'`, plus `publish()`, history and rollback. Drafts are **per item** and invisible to runtime until published; publish is available **per item** (`client.publish(type, name)`) and as a batch **app publish** (`/packages/:id/publish-drafts`).
- **Runtime** → bespoke per-type tables `sys_view` / `sys_report` / `sys_dashboard`: immediate writes, no draft/publish/history, each with its own column layout (`toSysViewPayload`).

PRs #1496/#1504/#1505 unified the **editing UI** (both render the same spec-driven inspector); #1508 gave the report/dashboard editors the admin gate that view editing already had. **Persistence is still split.**

**Decision:** make the runtime editors reuse studio's model exactly. A runtime edit **saves a per-item draft** (invisible to other users, visible in the editor's own live preview), and an explicit **Publish** promotes it to the active overlay and records a version. No bespoke tables, no new scope dimension. Because the runtime panels already emit the spec draft and the runtime already *reads* views/reports/dashboards from the metadata layer (`MetadataProvider.readType('view'|'report'|'dashboard')`), this is mostly a write-path switch.

`sys_view`/`sys_report`/`sys_dashboard` are retired. Per-user personalization (a `user` overlay for **views only**) is explicitly **out of scope** here — a later, additive change.

## Why this model (low-code rationale)

- **One system, one mental model.** A view/report/dashboard behaves identically whether edited in studio or at runtime: same draft, same publish, same version/history/rollback.
- **Solves the real use case.** "I'm editing a dashboard, only half done — stage it, don't publish, don't let users see it." A **per-item draft** does exactly this: invisible to users, resumable by the editor (`GET …?state=draft`).
- **Immediacy *and* staging coexist.** The editing admin sees their own changes live in the panel's preview (driven by the local draft); other users keep seeing the **published** value until Publish. Per-item publish means staging one dashboard blocks nothing else.
- **Governance upgrade.** Runtime edits gain validation, history and rollback they never had.
- **No new backend for v1.** Reuses `/meta` draft/publish as-is.

### Draft vs publish — a property of the change, not the screen

`draft → publish` exists for **staging** and **atomic multi-item app releases**; forcing the two-step onto a trivial one-field tweak is friction (studio already mitigates with auto-save). So:

- **Default = save-as-draft + explicit Publish** (matches studio; satisfies the "stage half-done work" need). The editor's live preview keeps it feeling immediate.
- Batch **app publish** stays available for releasing many items together.
- **Always versioned** on publish.

This unifies the UX in *both* surfaces rather than making runtime a special case.

## What changes (before → after)

| | Before | After |
|---|---|---|
| Save (view) | `dataSource.create/update('sys_view', toSysViewPayload(...))` | `metadataClient.save('view', name, draft, { mode:'draft' })` |
| Save (report/dashboard) | `adapter.update('sys_report'|'sys_dashboard', name, schema)` | `metadataClient.save(type, name, draft, { mode:'draft' })` |
| Publish | — (writes were immediately live) | `metadataClient.publish(type, name)` → active overlay + version |
| Read (others) | `sys_*` merged with metadata | metadata **active** value (already the read path) |
| Read (editor, resume) | n/a | `metadataClient.get(type, name, { state:'draft' })` |
| Shape adapters | `toSysViewPayload` / `fromSysViewRecord` / report+dashboard adapters | deleted |

Runtime panels gain a small **draft/publish chrome** (Save draft · Publish · "unpublished changes" indicator · discard draft) — the same affordances studio's `ResourceEditPage` already has, reused.

## Rollout (flagged, reversible, back-compat)

1. **(done)** Unify the editing UI (#1496/#1503/#1504/#1505) and gate report/dashboard editing (#1508).
2. **(done)** Seam — `persistRuntimeMetadata` / `publishRuntimeMetadata` (#1513/#1514), behind the `VITE_RUNTIME_EDIT_VIA_META` flag (default off) routing to the legacy `sys_*` writes; flag on → `metadataClient` draft/publish.
3. **(done)** UI — the draft/publish chrome on the runtime panels (#1515), plus the view-create path through the seam (#1517).
4. **(done)** Verified in a real environment (the app-showcase backend): save→draft→publish→version, resume-on-open, discard, and rename-via-overlay all confirmed end-to-end (#1518).
5. **(done)** Retire — the flag and all legacy `sys_*` write/read/fallback paths + shape adapters were removed (#1534); runtime editing is now metadata-only. The system was pre-launch, so **no data migration** was needed. Note: the physical `sys_view`/`sys_report`/`sys_dashboard` tables/object-schemas turned out **never to have existed** on this backend (only the metadata overlay + `sys_metadata` were ever used), so there were no tables to drop.

## Risks

- 🔴 **Not verifiable in CI/sandbox.** This changes *where* edits persist and *how* they are read; there is no running backend here, so the round trip must be verified in a real environment. Mitigation: feature flag (default off) + per-item, reversible steps.
- 🔴 **Data migration.** Existing `sys_*` rows must move to published overlays without loss; dual-read window + rollback.
- 🟡 **Immediacy expectation.** Editors must understand Save = draft, Publish = live; the live preview and a clear "unpublished changes" indicator cover this.
- 🟡 **Permissions.** Writing/publishing metadata requires admin/publish rights — already aligned with the #1508 admin gate.
- 🟡 **Multi-tenant.** Writes/migration must stay correctly scoped to the org/env overlay.

## Out of scope

- **Per-user personalization** (a `user` overlay for views) — a later, additive change. v1 is admin editing of the shared definition only.

## Appendix: persistence call sites (the seam targets)

| Panel | Today | File |
|---|---|---|
| ObjectView | `dataSource.create/update('sys_view', toSysViewPayload(...))` (`handleViewConfigSave` / `handleViewCreate`; `persistViewPatch` for incremental toolbar state) | `packages/app-shell/src/views/ObjectView.tsx` |
| ReportView | `adapter.update('sys_report', name, schema)` (`saveSchema`) | `packages/app-shell/src/views/ReportView.tsx` |
| DashboardView | `adapter.updateDashboard(name, schema)` / `adapter.update('sys_dashboard', …)` (`saveSchema`) | `packages/app-shell/src/views/DashboardView.tsx` |

---

## Amendment (2026-06-07): record `page` joins the model (#1541)

Record pages now author through the same per-item `/meta` draft → publish →
version model — via **Studio**, not a bespoke runtime editor. The end-user
runtime "design this page" entry is intentionally deferred; the Studio path is
the supported authoring surface.

What shipped:

- **Seam** — `RuntimeArtifactType` gained `'page'` (#1571), plus pure helpers
  `recordPageName(object, existing?)` / `recordPageEnvelope(object, schema, name?)`
  in `runtime-metadata-persistence.ts` (forward-looking; for a future runtime
  entry — the Studio path uses `ResourceEditPage`'s own draft/publish chrome).
- **Create** — the Studio "New page" form was identity-only (label/name/icon/
  description), so a record page couldn't be created or bound to an object. The
  `page` resource anchor now exposes **Object / Page type (default `record`) /
  Kind**, mirroring `view` (#1572). Root cause was objectui-side config, not the
  protocol — the page *edit* form and the protocol schema already carried the
  full field set.
- **Seed** — a generic async `createSeed` hook on `MetadataResourceConfig`; the
  `page` resource seeds a new record page's `regions` from
  `buildDefaultPageSchema(objectDef)` so authoring starts from the auto-generated
  default detail layout, not a blank canvas (#1574).
- **Edit + publish** — the existing `PagePreview` WYSIWYG canvas + draft/publish/
  version chrome (`MetadataResourceEditPage`) handle composition and release.
- **Render** — `usePageAssignment` already resolves a published record page over
  the synthesized default (`RecordDetailView.effectivePage`), so a published page
  renders on that object's records.

Net: create (bound + seeded) → design in PagePreview → publish → renders on
records — entirely through Studio, no `sys_page` table, no runtime end-user
editor.
