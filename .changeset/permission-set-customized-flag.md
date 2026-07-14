---
"@objectstack/plugin-security": minor
---

Surface a `customized` flag on `sys_permission_set` so Setup can tell — at a glance — which packaged permission sets have an environment overlay (ADR-0094).

- The env projector stamps `customized: true` on a `managed_by:'package'` row while an overlay shadows its shipped baseline, and clears it when the overlay is removed (the data-door "reset"). Env-authored rows are never flagged (an env set is the definition, not a customization of one).
- The new read-only boolean field is added to `sys_permission_set` and to the "All" Setup list view (alongside `managed_by`), so a packaged-but-customized set is visible without opening the Studio layered diff.
