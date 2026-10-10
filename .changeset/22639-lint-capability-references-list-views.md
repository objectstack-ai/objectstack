---
"@objectstack/lint": minor
---

feat(lint): `validateCapabilityReferences` resolves the capabilities a list view or a dashboard requires (#22639)

Clause-②: no

- The `/meta` read gate now serves a list view or a dashboard only to a user who holds every capability its `requiredPermissions` names, so a misspelled name hides the item from everyone. `validateCapabilityReferences` resolves those names like every other carrier's: a dashboard's, a view container's `list` and each `listViews` entry, a view item's `config`, a flattened list view's, and an object's own `listViews` entries. An unresolved name warns `capability-reference-unknown` at its own path (for example `views[0].listViews.legal_review.requiredPermissions`).
- It is a warning, as for objects, fields, apps and actions: a single package's lint cannot see a capability another installed package declares.
