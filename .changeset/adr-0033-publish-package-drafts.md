---
"@objectstack/objectql": minor
"@objectstack/runtime": patch
---

feat(metadata): publish a whole app's drafts in one shot (ADR-0033)

After an AI builds an app, its metadata is drafted (bound to an app package) and
had to be published one item at a time. The package-level `POST /packages/:id/publish`
needs the `metadata` service (503 when absent, e.g. the showcase) and reads the
in-memory registry, not the drafts.

- `protocol.publishPackageDrafts({ packageId })` promotes every `sys_metadata`
  draft row bound to the package to active by reusing the per-item
  `publishMetaItem` primitive (overridable/lock guards + runtime registry
  refresh). Per-item failures are collected, not fatal. No `metadata`-service
  dependency.
- `POST /api/v1/packages/:id/publish-drafts` exposes it (distinct from the
  registry-based `/publish`), returning `{ success, publishedCount, failedCount, published, failed }`.

Verified live: an AI-built `app.asset_management` (4 drafts) published in one call —
all 4 promoted to active, drafts cleared, draft objects became queryable.
