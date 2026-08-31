---
'@objectstack/objectql': patch
'@objectstack/lint': patch
---

Refuse an undeclared field a `before*` hook writes, identically on every driver

The declared-field door (#8682 on insert, #8738 on update) runs before the
`before*` hooks — deliberately, so a payload about to be refused never consumes
an autonumber (#8737). That left the payload the hooks themselves produce
unjudged: a key a `beforeInsert` / `beforeUpdate` hook or an L2 (`language:'js'`)
body wrote went straight to the driver, and the drivers disagreed. `memory`
accepted it and stored a shadow column; `driver-sql` threw a raw `SQLITE_ERROR`
with no `status` and the bound statement and its values quoted back in the
message; `sqlite-wasm` threw a bare `Error` with neither. One app and one hook
meant different things on two deployments, and nothing in the app could tell
which one it was running on.

The same check now runs a second time over the post-hook payload, before any
statement is built, so a hook-written undeclared key is refused with the caller
path's envelope — `INVALID_FIELD` / **400**, `Unknown field 'x' on object 'y'` —
on every driver, because none of them is reached. The existing pre-hook door is
unchanged and stays exactly where it is.

This is a security fix as well as a consistency one: `fieldPermissions` is keyed
by declared field name and reports only fields explicitly marked non-editable, so
a key the object never declares can carry no entry and could never be gated by
field-level security. On `memory`-family stores such a value was persisted where
no view, formula, index or permission could name it.

The platform's own stamps are unaffected. `created_at` / `updated_at` — the two
the built-in audit hook writes unconditionally, because SQL drivers create them
as built-in columns on every table — are already tolerated by this check
alongside `id`; every other stamp (`created_by`, `updated_by`, `tenant_id`) is
guarded by an explicit declaration test in the hook that writes it.
