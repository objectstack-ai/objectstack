---
"@objectstack/spec": minor
---

feat(spec): a list view and a dashboard take `requiredPermissions`, the audience gate, declared now and not enforced yet

Clause-②: yes (widening)

- **What is new.** `ListViewSchema` and `DashboardSchema` each accept `requiredPermissions`: a list of capability names (the names permission sets grant through `systemPermissions`) a user must ALL hold. It is the same key, with the same shape (`string[]`, optional, no default) and the same meaning, as `requiredPermissions` on an app, a navigation item and an action. Before this release both schemas refused the key as an unrecognized key. Because a list view's shape is shared, the key reaches every list-view door: a view container's `list` and `listViews` entries, an object's `listViews`, and a view item's `config`.
- **Not enforced yet.** No server reads either key in this release. A gated list view or dashboard is still served to every user who can read it, so do not rely on the key to keep a view or a dashboard from an audience yet. The key's description says so, and `os lint` / `os validate` warn (`liveness-planned-property`) when a dashboard or a view container's `list` sets it. Enforcement on the `/meta` reads of `view` and `dashboard` (the list read and the by-name read) is the separate enforcing change (#22639).
- **"Or" is a capability, not a new shape.** There is no any-of form: an object such as `{ anyOf: [...] }` is refused. To serve one view or dashboard to two audiences, declare one capability (for example `clm_legal_workbench.view`), grant it to both permission sets, and list that one name. `content/docs/permissions/capabilities.mdx` shows the pattern.
- **Nothing to migrate.** Every document that parsed before parses the same way; only a document that sets the new key, which was refused before, now parses.
