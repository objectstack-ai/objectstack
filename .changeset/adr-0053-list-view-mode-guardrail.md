---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
on an object list view ("views" mode — where the `ViewTabBar` is the only nav
control) they are silently dropped. This lands the phase-4 guardrail as a
layered defence, so the wrong-context authoring mistake is caught without
breaking existing metadata:

- **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
  minus `userFilters`. Object built-in `listViews` and `defineView`
  `list`/`listViews` now use it, so `userFilters` on an object list view is a
  `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
- **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
  throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
  on a stray `userFilters`.
- **Author/CI (actionable):** new `@objectstack/lint` rule
  `validateListViewMode`, wired into `os validate`, reports the wrong-context
  field PRE-parse (before the schema strips it) with a fix hint.

Closes the schema half of objectui #2219; supersedes the interim runtime warn in
objectui #2220.
