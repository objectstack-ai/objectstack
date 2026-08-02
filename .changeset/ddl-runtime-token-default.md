---
"@objectstack/spec": patch
"@objectstack/objectql": patch
"@objectstack/driver-sql": patch
---

fix(driver-sql,spec,objectql): a `defaultValue` runtime token never becomes a column DEFAULT (#4560)

`Field.user({ defaultValue: 'current_user' })` is resolved by the **engine**, at
insert time, from the request's `ExecutionContext` — and with no authenticated
user (system / anonymous writes: seed replay, package install, boot
provisioning) `applyFieldDefaults` deliberately leaves the field **unset**
rather than stamp a bogus owner.

The SQL DDL had never heard of the token. `createColumn` passed any non-object
`defaultValue` straight through to `col.defaultTo(dv)`, so the column was
created as `DEFAULT 'current_user'` and the **database** overrode the engine's
decision: every insert that omitted the field stored the literal string
`current_user` in a `lookup('sys_user')` column — a value that is not any user's
id. `?expand` resolves it to nothing, and on an owner / approver field it is a
silent mis-attribution. Found by #4551's dangling-reference audit on its first
run against a real boot; #4441's referential check could never have caught it,
because it inspects the values a **caller** supplied and here nobody supplied
one.

**The token vocabulary is now declared once, in `@objectstack/spec/data`**
(`DEFAULT_VALUE_TOKENS`, `isRuntimeDefaultToken`, `isNowDefaultToken`,
`isCurrentUserDefaultToken`, `isAppResolvedDefaultToken`). The engine's
insert-time resolution and the driver's DDL read the same set, which is the
actual defect: `'NOW()'` was special-cased in the branch immediately above for
precisely this reason, and `current_user` — the same convention family — simply
had no entry anywhere the DDL could see. A token added to the set tomorrow is
excluded from literal column DEFAULTs automatically, rather than leaking its own
spelling into the database the way this one did.

**DDL, in one place** (`applyDeclaredColumnDefault`, shared by column creation
and the SQLite table rebuild):

- `'NOW()'` → the driver-native canonical default, exactly as before;
- any other runtime token → **no column default at all** (the engine owns it);
- Expression envelopes (`{ dialect, source }`) → unchanged, no default;
- a real literal → emitted verbatim, unchanged.

**Existing databases carry the wrong DEFAULT**, so it is corrected through the
managed schema-drift path (#2186) rather than a bespoke migration: a new
`default_mismatch` finding with a `drop_column_default` op, categorised `safe`
(the statement cannot fail and touches no rows). Dev boots with
`autoMigrate: 'safe'` reconcile it automatically; everywhere else it is reported
with an actionable hint and applied by `os migrate apply`. Postgres/MySQL use
`ALTER COLUMN … DROP DEFAULT`; SQLite, which cannot alter a default in place,
goes through the existing table rebuild — which now re-materialises every
column's default from **metadata**, so a sibling `defaultValue: 'NOW()'` column
keeps the default it always had instead of losing it to the rebuild.

**Rows already holding the bogus value are NOT rewritten.** That is #4551's
standing rule — report, never rewrite — so they stay visible to the
dangling-reference audit for operators to resolve deliberately.
