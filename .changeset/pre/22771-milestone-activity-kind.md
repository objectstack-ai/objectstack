---
'@objectstack/plugin-audit': patch
---

A `sys_activity` row that an `activityMilestones` entry fired carries `metadata.kind: 'milestone'`, so a reader can tell a milestone from an ordinary update or a finished task

Clause-②: no

ADR-0052 §5 keeps `sys_activity.type` domain-neutral and puts a row's domain kind in
`metadata.kind`. A fired milestone keeps the `type` its declaration names: `completed`, or
`updated` when it names none. Nothing on the served row said it was a milestone. So a "Case
resolved" milestone declared with `type: 'completed'` read as a finished task, and a feed that
hides completed tasks hid it too.

The CRUD mirror now writes `metadata.kind: 'milestone'` on every row a milestone fires. `type` is
unchanged, and a row that no milestone fired carries no `kind`.

The kind is served by the same rule as the text beside it. "A milestone fired" means that a
watched field entered its declared value, so:

- **A reader served every field that a declared milestone watches** is served `metadata.kind`.
- **A reader not served one of those fields** is served the row without `metadata.kind`, just as
  it is served the change without that field.
- **A row an app writes itself** keeps its own `metadata.kind` for every reader, as written.

The rest of the redaction is unchanged. The provenance declaration (`metadata.text_sources`) is
never served, and a change key the reader is not served is dropped. Rows written before this change
carry no kind, and this change does not backfill them. Nothing you author changes: no key, option,
export or type is added or removed.
