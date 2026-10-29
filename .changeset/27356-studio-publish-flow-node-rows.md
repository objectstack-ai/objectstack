---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): the publish review names the flow steps that changed instead of "Also changed: ~ nodes"

Clause-②: no
Metadata-protocol: none

- **Before.** Expanding a flow draft in the publish review compared every top-level key other than `fields` whole. A flow keeps all of its steps in one `nodes` list, so any step edit read "Also changed: ~ nodes".
- **Now.** A flow's steps are compared one by one, matched by `id`: a row per step added, changed or removed, led by the step's label with its id beside it, and a changed step names the properties that differ (`config` one level down, as `config.fields`). `edges` and the flow's other keys stay under "Also changed:".
- **Unchanged.** A reorder alone, or a step list not keyed by `id`, keeps the `nodes` row, so a draft that differs never reads as unchanged. Other item types are compared as before.
