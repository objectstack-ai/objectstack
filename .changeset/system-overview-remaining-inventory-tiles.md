---
"@objectstack/platform-objects": patch
---

fix(platform-objects): stop the System Overview date bar from windowing the "Organizations" and "Packages Installed" tiles (#7613)

Finishes Row 1 of the shipped **System Overview** board. #7531 fixed "Total
Users" and "Active Sessions"; the identical defect was still live on the other
two tiles of the same inventory row.

The board declares a `created_at` global filter defaulting to `last_7_days`, and
a dashboard-level filter is broadcast into *every* widget's analytics query
(#2501). A `created_at` column exists on `sys_organization` and
`sys_package_installation` alike, so the broadcast landed on both:

- **"Organizations"** reported organizations created in the last 7 days, under a
  description that says "Total organizations on the platform".
- **"Packages Installed"** reported installations created in the last 7 days
  with `status: 'installed'`, under a description that says "Active package
  installations across projects".

Both tiles now opt out with `filterBindings: { created_at: false }`. On
"Packages Installed" that opt-out is orthogonal to the widget's existing
`filter: { status: 'installed' }` and both stand — the predicate decides *which*
installations count, the opt-out decides *how many*.

The date bar is untouched where it belongs: all six `sys_audit_log` widgets
(rows 2-4) still inherit it, which is what it was added for. No labels changed
and no translation keys move — the fix is to the queries, not the wording.

Behaviour change to be aware of when upgrading: on any instance older than the
selected window both tiles will now read **higher** than before. On a fresh
datastore every row is recent, so the windowed count and the true total coincide
and neither number moves.
