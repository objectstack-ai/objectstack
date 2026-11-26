---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@object-ui/core': minor
'@object-ui/types': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-calendar': patch
'@object-ui/app-shell': patch
---

feat(spec,ui): a field can be read-only by hand at the console while actions, imports, the API and flows keep writing it (`uiReadonly` / `uiReadonlyWhen`)

Clause-②: yes (widening: two new optional authorable keys `Field.uiReadonly` and `Field.uiReadonlyWhen`)
Metadata-protocol: added
Skills-docs: follow-up #37405

A status column that only moves through actions, or a field an integration fills, used to have no honest declaration: `readonly: true` also strips every client write, so the action, the import and the API lost the field too. Fields now carry two lock tiers:

| | server lock: no client writes | hand lock: no person edits at the console |
|:--|:--|:--|
| always | `readonly` | `uiReadonly` |
| conditional | `readonlyWhen` | `uiReadonlyWhen` (CEL, the same scope as `readonlyWhen`) |

- **`uiReadonly: true` / `uiReadonlyWhen`.** Every console surface a person edits through locks the field: the create and edit dialogs (the field is left off them and out of the payload they submit, so a create from the console lands on the field's `defaultValue`), the record page's inline edit and stage path, the highlight-strip chip, grid inline edit and its multi-row save, kanban drag between columns grouped by the field, calendar drag, and the line-item grid (a `uiReadonly` child field is not a column; a `uiReadonlyWhen` one locks its cell per row). The engine never reads either key, so REST, import, declarative and script actions, and flows write the field, and the object's validations (a `state_machine`, for one) judge each write.
- **Refused: `uiReadonly: true` beside `readonly: true`** (at `['uiReadonly']`, at every door that parses a field: `defineStack`, `os validate`, metadata save). Keep one: `readonly` when no client may write the field, `uiReadonly` when people at the console may not. `uiReadonlyWhen` beside `readonlyWhen` is accepted.
- **Kanban: a `readonly` lane field no longer drags.** The board read no field lock before, so a card grouped by a `readonly` field could be dragged and its PATCH was silently stripped. The board now reads both locks.
- **`@object-ui/core` exports the one verdict:** `fieldReadOnlyByHand(def, record?, context?)`, `fieldStaticallyReadOnlyByHand(def)`, `fieldHasConditionalHandLock(def)`. `resolveFieldRuleState` takes `uiReadonlyWhen` in its rules and `uiReadonly` in its statics. The import wizard's target mapping and the Studio/designer reads stay on the raw `readonly`.
- **MCP `describe_object`** reports `uiReadonly` and `uiReadonlyWhen` as their own keys where set (never folded into `readonly`, which tells an agent to leave the field out of a write), on the HTTP and the stdio transport, and the tool description names them.
