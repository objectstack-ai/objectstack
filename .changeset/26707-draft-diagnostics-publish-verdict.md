---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a draft's `_diagnostics` reports what its publish will refuse (#26707)

Clause-②: no (the draft verdict reports more; no accepted value is refused)
Metadata-protocol: none

A draft the runtime authoring gate refuses at publish (a flow edge whose condition does not parse, an API-triggered flow with no secret, an RLS predicate over a field the database cannot filter, a summary field with no operations, a dashboard global filter on an unknown field, a dataset `include` that names an unknown relationship) used to read `_diagnostics.valid: true` on the draft read, so the editors and the Problems tab called it valid and the refusal arrived only at Publish, where one such draft rolls back the whole package release.

- **One rule set.** The draft read (`GET /api/v1/meta/:type/:name?state=draft`, and the `previewDrafts` read of a pending draft) now runs the same runtime authoring gate the publish runs, on the stored draft body, with the same package scope, the same pending in-package drafts (so a reference to a sibling draft the same Publish-all lands is not an error) and the same restored credential paths. Each refusal is added to `_diagnostics.errors` with the gate's rule id as `code` and the publish's own `message`, and `valid` becomes `false`. ⛔ No rule is restated.
- **The draft still saves.** No draft save is refused; publish refuses exactly what it refused before; package publish keeps its atomic rollback.
- **Paths.** A gate path inside the item (`objects.invoice.fields.total.summaryOperations`) is served item-relative (`fields.total.summaryOperations`); a gate path that names a place rather than a key (a flow edge) is served as the gate wrote it.
- **Not covered.** The save-door refusals (they refuse the save itself, so no stored draft carries them), the plugin authoring gates and the package build probes that `publish-drafts` runs, and the list reads and the diagnostics sweep, which keep their read-time verdicts.
