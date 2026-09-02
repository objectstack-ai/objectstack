---
'@objectstack/lint': minor
---

Resolve an app navigation entry's `viewName` against its object's list views at `validate` and `build`

`AppNavigationItemSchema.viewName` is documented as *"Default list view to open"*, so an
unresolvable name never failed — it **fell back**. A nav entry keeping its authored label and
icon would open a different view, and nothing said so: `os validate --json` reported
`valid: true` and `os build` was green. The decay mode was worse than the typo mode — renaming
a list view silently degraded every nav entry pointing at it, with every gate green and the
diff reading correctly in review.

`lintViewRefs` now walks `app.navigation` (and the `areas[]` container) recursively and reports
`view-ref-nav-view-missing` as an **error** when a `viewName` resolves to no list view on the
object it names. This extends #2554's existing rule to the second, more travelled door into the
same `listViews` namespace rather than adding a new rule class.

Resolution mirrors the runtime matcher (objectui's `resolveViewId`) in all three directions —
exact id, short name retried as `<object>.<name>`, and qualified name with the prefix stripped —
so a name that works at runtime is never reported. The accept set narrows only where the stack
itself declares the object's list views: an entry is skipped when the `viewName` is interpolated,
when `recordId` is set (the schema documents `viewName` as ignored there), when the item carries
`requiresObject`, or when this stack contributed no list view for that object.
