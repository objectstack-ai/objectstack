---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

feat(spec): the view and dashboard authoring forms offer the audience gate, `requiredPermissions`

Clause-②: no
Metadata-protocol: none

A list view's and a dashboard's `requiredPermissions` (the capabilities a caller must all hold to be served the item) has been enforced by the server's `/meta` read gate since it landed, but no authoring form offered it, so only a source file could set it. Both forms now carry the row; no key, value or gate changes.

- **`@objectstack/spec`.** `viewForm`'s "Navigation & sharing" section gains a `requiredPermissions` row (tags), and `dashboardForm` a new "Access" section holding the same row. The hint states the gate's rules in an administrator's words: every capability listed is required, an empty list is no gate, one capability granted to several permission sets is how to serve several groups, a position passes on what its permission sets grant, and the gate applies to the person setting it too (a capability they do not hold, or a misspelt one, locks them out of the item as well).
- **`@objectstack/platform-objects`.** The `metadataForms` bundles carry the new rows; zh-CN (「所需权限」), ja-JP (「必要な権限」) and es-ES ("Permisos requeridos") carry translated labels and hints; the other seven locales fall back to the English source until translated.
- **`@object-ui/app-shell`.** The console's zh-CN overlay for the two forms carries the same rows, so Studio's view inspector and the dashboard settings panel show them in Chinese.

Nothing to migrate.
