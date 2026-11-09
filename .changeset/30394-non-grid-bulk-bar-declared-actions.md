---
'@object-ui/plugin-list': minor
'@object-ui/plugin-grid': minor
---

fix(plugin-list)!: a list's selection bar over a non-grid view (kanban, calendar, gallery, …) draws only actions the object declares, by the grid's own rule; an undeclared bare `bulkActions` name draws nothing and warns once in development (#30394)

Clause-②: yes (narrowing) — `@object-ui/plugin-grid` exports `resolveBulkActions` and `useUndeclaredActionNamesWarning` (with the `ActionLabelResolver`, `NamedActionDef`, `UndeclaredActionNameKey`, `UndeclaredActionNamesAddress` and `UndeclaredActionNamesBasis` types) so `@object-ui/plugin-list` reuses the grid's fold and warning instead of a second copy; the warning's address gains an optional `component`, defaulting to `ObjectGrid`, so the grid's message is byte-identical.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` teaches no handler-only bulk action name (searched for `bulkActions` examples); `content/docs/ui/**` already names only declared actions.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, export or stored row changes shape: `bulkActions` keeps its `string[]` form and meaning, and plugin-grid's new exports add, never retire. What narrows is the non-grid bar's draw set, back to the spec's own sentence (a bare name names an action the object declares). Whether an undeclared name was a misspelling or an action still to declare is a judgement about the view, so no rewrite derives the fix; the development warning names each name. -->

- **Before.** The bar ListView draws itself for every view but the grid mapped each `bulkActions` member straight to a button, labelled by the humanized name, whether or not the object declared it. A name the object does not declare (a misspelling, or an action a disabled package withholds from the served object) showed a button that toasted "not executable" on click. The grid stopped drawing such names in #30169.
- **Now.** The bar folds the names through the grid's `resolveBulkActions`: a name the object declares draws under that action's label (through the app's i18n bundle), the built-in `delete` keeps its own path and gate, and any other name draws nothing. In development the console logs one warning per list naming the key, the view and each name (`[ObjectUI] ListView bulkActions: kanban (objectName: …) — …`), the grid's own message. A bar with nothing left to draw is not shown.
- **Remedy.** Declare the named action on the object, or remove the name from `bulkActions`. An action withheld by a disabled package needs nothing: it draws again when the package is enabled.
