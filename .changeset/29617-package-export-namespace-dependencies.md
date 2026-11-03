---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

feat(spec,runtime): a package export carries its namespace and its dependencies, so a reinstalled `.custom` pair keeps both

Clause-②: yes (widening)
Metadata-protocol: added

`GET /packages/:id/export` answered a package's items and its `id`, `name`, `version` and `label`, and nothing of the two install-manifest keys an install of the export decides by. A `.custom` pair exported and reinstalled through `POST /api/v1/marketplace/install-local` therefore lost its namespace (the install door derives one from the id, so the pair landed under `custom` instead of, for example, `showcase_custom`) and its edge to its base, which orders the pair's install after the base (ADR-0141 D5) and admits its `overrides` declarations at the managed install (ADR-0146 D2).

- **Spec.** `PackageExportManifestSchema` declares two more optional fixed keys, `namespace` and `dependencies`, each the install manifest's own declaration (`ManifestSchema.shape.namespace` / `.dependencies`), so an export refuses exactly what an install would. The schema stays open for the per-type collections.
- **Runtime.** The export writes both from the package's registry row, as the row's manifest declares them, and writes neither when the row declares none.

Nothing to do for existing exports: an export taken before this change still installs as before. Export the package again to carry both keys. `type` is still not written, and `POST /api/v1/packages` still refuses an export; the install-local door is the one that reinstalls an export.
