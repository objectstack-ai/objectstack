---
"@objectstack/metadata-protocol": minor
"@objectstack/plugin-security": minor
---

Make the `sys_permission_set` data record a pure projection of the metadata layer (ADR-0094; framework#2875) — one authoritative store for permission-set definitions, retiring the two-store split-brain behind the #2857 display-freshness class.

- **`@objectstack/metadata-protocol`**: new `registerMutationProjector(type, fn)` — an awaited, best-effort per-type hook invoked after persistence inside `saveMetaItem` / `publishMetaItem` / `deleteMetaItem`, so a derived data-plane read-model is already consistent when the write returns (outcome surfaced as `projectionApplied` on the response). Complements the fire-and-forget `onMetadataMutation` listeners.
- **`@objectstack/plugin-security`**: every non-system data-door write on `sys_permission_set` (Setup CRUD, bulk imports, any ObjectQL path) is redirected into the metadata store by an engine middleware; the record is written only by the projector. Boot reconciliation projects env overlays onto records (Studio-created sets now appear in Setup), backfills legacy data-door-only records into metadata once, and re-projects drifted records from the effective body (metadata wins). The projector also syncs the metadata manager's in-memory `permission` entry, so evaluator resolution and the Setup display can no longer disagree.

Behavior changes: "deleting" an artifact-backed permission set through the data door now resets it to its declared body instead of removing the row; renaming a set through the data door is rejected (`400`) — clone to a new name instead; record edits that predate this change and are shadowed by a metadata definition are discarded (loud warning) at first boot, since they were never enforced.

Moved exports (from `@objectstack/plugin-security`): `upsertEnvPermissionSet` now lives in `permission-set-projection.js` (still re-exported from the package root) and **creates** missing records; `projectEnvPermissionOnMutation` / `subscribeEnvPermissionProjection` are replaced by `projectPermissionMutation` / `registerPermissionSetProjection`.
