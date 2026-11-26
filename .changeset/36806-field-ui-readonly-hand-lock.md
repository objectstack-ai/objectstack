---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/lint': patch
'@objectstack/metadata-core': patch
'@objectstack/platform-objects': patch
'@object-ui/core': minor
'@object-ui/types': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
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

- **`uiReadonly: true` / `uiReadonlyWhen`.** These console surfaces lock the field: the create and edit dialogs (the field is left off them and out of the payload they submit, so a create from the console lands on the field's `defaultValue`, and a `required` field therefore needs one), the record page's inline edit and stage path, the highlight-strip chip, grid inline edit and its multi-row save, kanban drag between columns grouped by the field, calendar drag, and the line-item grid (a `uiReadonly` child field is not a derived column, and an authored column over it is locked; a `uiReadonlyWhen` one locks its cell per row). The Gantt, the timesheet cell, the kanban swimlane drag and the in-app assistant do not read the keys yet. The engine never reads either key, so REST, import, declarative and script actions, and flows write the field, and the object's validations (a `state_machine`, for one) judge each write.
- **`uiReadonlyWhen` is judged on an existing record only** (the create dialog does not read it, nor does a new line-item row), over the host's predicate scope on every surface. Grids and list views fetch the operands of a shown or dragged field's lock predicates. A predicate that cannot be evaluated LOCKS the field (no server judges the hand lock), the edit dialog refuses to submit until it is fixed, and `os validate` checks it as it checks `readonlyWhen`.
- **Refused: `uiReadonly: true` beside `readonly: true`** (at `['uiReadonly']`, at every door that parses a field: `defineStack`, `os validate`, metadata save). Keep one: `readonly` when no client may write the field, `uiReadonly` when people at the console may not. `uiReadonlyWhen` beside `readonlyWhen` is accepted.
- **Kanban: a `readonly` lane field no longer drags.** The board read no field lock before, so a card grouped by a `readonly` field could be dragged and its PATCH was silently stripped. The board now reads both locks.
- **`@object-ui/core` exports the one verdict:** `fieldReadOnlyByHand(def, record?, context?)`, `fieldStaticallyReadOnlyByHand(def)`, `fieldHasConditionalHandLock(def)`. `resolveFieldRuleState` takes `uiReadonlyWhen` in its rules and `uiReadonly` in its statics. The import wizard's target mapping and the Studio/designer reads stay on the raw `readonly`.
- **MCP `describe_object`** reports `uiReadonly` and `uiReadonlyWhen` as their own keys where set (never folded into `readonly`, which tells an agent to leave the field out of a write), on the HTTP and the stdio transport, and the tool description names them.
- **Censuses and Studio.** The FLS reference scrub classifies both keys (`@objectstack/metadata-core`: `uiReadonly` kept, `uiReadonlyWhen` an expression position). A caller denied a field the `uiReadonlyWhen` reads is served the field with `uiReadonly: true` in place of the predicate, so the lock never opens for them. The Studio field form offers both rows beside Read-only and Read-only when, with their labels and help translated in every metadata-forms locale pack (`@objectstack/platform-objects`).
