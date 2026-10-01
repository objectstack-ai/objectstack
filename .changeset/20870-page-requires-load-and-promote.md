---
'@objectstack/metadata-protocol': minor
---

A stored page whose `requires` names a plugin the deployment's console does not load is reported when the page loads, and a draft → active promotion re-stamps an html page's `requires` with the save door's own computation (ADR-0080 §5: `requires` is validated at save and load, and derived from the source).

Clause-②: no

**At load.** The boot hydration of stored metadata (`loadMetaFromDb`) prints one `warn` line for each stored page whose `requires` lists a namespace no component in the deployment's SDUI component manifest carries, naming the page and every such namespace under the marker `[page_requires_plugin_absent]`. It is a report, never a refusal: the page has already loaded when the line is printed, and it is served. The manifest is read through the same `SDUI_MANIFEST_SERVICE` key the save door reads; `os serve` registers it before any plugin initialises, so it is there when stored pages load. A host that registers no manifest judges no page at load, exactly as it judges none at save.

**At promotion.** `publishMetaItem` and `publishPackageDrafts` now store the promoted body with the `requires` that an active save of the same body would store, computed against the manifest registered at the moment of the publish. Before, the draft's `requires` was carried into the active row as it was. A draft saved before the host had a manifest reached `active` with no `requires`, and an agreeing list kept the draft's own spelling (its order and any repeats). Nothing is newly refused: wherever the runtime authoring gate runs, it already refused a draft whose source does not compile, or whose `requires` disagrees with its source, and it still does. A host with no manifest promotes the draft as written.

`SysMetadataRepository.promoteDraft` takes an optional `deriveActiveBody(draftBody)` that derives the active row's body from the draft row it promotes. When it is omitted, the draft body is promoted unchanged, as before.
