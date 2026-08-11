---
"@objectstack/spec": minor
"@objectstack/plugin-hono-server": patch
---

feat(spec): `userActions.create` / `.import` accept the same CEL-predicate object form as `edit` / `delete` (#7692)

#3076 (objectui#2614) gave `userActions.edit` and `userActions.delete` a
boolean-or-predicates union so the built-in row affordances could be gated on
record state. `create` and `import` were left as bare booleans, and there was no
other lever for them — which means a child object's related-list `[+ New]` button
could not be gated on the parent record's state at all, while the row `Edit` /
`Delete` beside it could. On a frozen parent the row actions correctly grey out
and `[+ New]` still renders; the server-side guard rejects the insert, so this is
an affordance leak rather than a data-integrity hole, but it is one an app has no
way to close.

Both keys now take the union `edit` / `delete` already carry — the **same**
`RowCrudActionOverrideSchema`, not a new dialect:

```ts
userActions: {
  create: { visibleWhen: 'record.version_status == "draft"' },
  import: { enabled: true, disabledWhen: 'record.frozen == true' },
}
```

`enabled` keeps the bare boolean's meaning (omitted → the `managedBy` bucket
default), `visibleWhen` is fail-closed and `disabledWhen` fail-soft, exactly as
for the row pair. `resolveCrudAffordances` carries the predicates through as
`createPredicates` / `importPredicates`, alongside the existing
`editPredicates` / `deletePredicates`.

**What `record.*` binds to differs between the two positions, and the schema says
so rather than implying symmetry it does not have.** `edit` / `delete` evaluate
per row against that row's own record. `create` / `import` gate a record that does
not exist yet, so they evaluate once per toolbar against the record in scope where
the toolbar renders — the host (parent) record on a record page's related list,
and nothing at all on a standalone object list, where a predicate reading
`record.*` therefore hides the button under the fail-closed rule.

Back-compatible: the boolean forms parse and resolve exactly as before, and the
boolean-only path still produces no predicate keys. Unknown keys inside the object
form are rejected, same as for `edit` / `delete`.

`@objectstack/plugin-hono-server` tracks the widened producer: the `/me/permissions`
managed-write clamp tested `create` with a bare `!== true`, which would have clamped
away a legitimate `create: { enabled: true, visibleWhen: … }` opt-in; it now reads
`create` through the same opt-in helper as `edit` / `delete`.

The renderer half — the related-list toolbar honouring `create.visibleWhen` — is
objectui's downstream card and is not part of this change.
