---
"@objectstack/lint": minor
---

Validate dashboard filter field-existence at build time (extend ADR-0021, #3365).

`validateWidgetBindings` now checks that every dashboard-level filter (`dateRange`
+ each `globalFilters[]`) resolves to a real field on each bound widget's dataset
object. Since #2501 wired these filters into every widget's analytics query, a
filter field absent on a widget's object — e.g. a `dateRange` bound to
`close_date` inherited by an account/contact widget over a different object —
emitted invalid SQL (`no such column: close_date`) and crashed the widget at
render time. That build-decidable invariant previously escaped `os validate` /
`os build` and failed only when a user opened the dashboard.

It now fails the build (new rule `dashboard-filter-field-unknown`) with a message
naming the dashboard, widget, filter, field, and object, unless the widget opts
out via `filterBindings: { <name>: false }` or re-targets to an existing field —
mirroring the field-existence invariant ADR-0032 enforces for CEL references.
Effective-field resolution matches the runtime (`filterBindings` re-target /
opt-out, legacy `targetWidgets` allow-list, filter default). Registry-injected
system fields (e.g. `created_at`, the `dateRange` default) and objects outside
the validated stack never false-positive.
