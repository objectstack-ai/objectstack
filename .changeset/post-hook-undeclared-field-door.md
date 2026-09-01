---
'@objectstack/objectql': minor
'@objectstack/lint': patch
---

Refuse an undeclared field a `before*` hook writes, identically on every driver

**BREAKING** accept-set narrowing at the post-hook write door, shipped as `minor`
under the repo's launch-window convention for breaking changes.

**Bump level, argued**: `@objectstack/objectql` is `minor`, not `patch`. A
`before*` hook or an L2 (`language:'js'`) body writing a key the object never
declares **used to succeed** on the `memory` family — the value reached the
store and persisted as a shadow column — and now **throws**, `INVALID_FIELD` /
**400**, on every driver. That is a narrowing of the accept set on the record
payload, a surface every hook body touches; it is not an instrument or a message
fix, and a hook that relied on either driver-dependent outcome stops working at
run time. The same-package sibling `.changeset/hook-input-symbol-key-refusal.md`
argues exactly this shape — "used to succeed, and now throw. That is a narrowing
of the accept set" — to `minor`, and the launch-window convention is what keeps
it off `major` (pre-1.0 lockstep semantics: a breaking change does not burn a
major version while the stack versions in lockstep — see
`scripts/check-changeset-no-major.mjs`). `patch` would under-declare a change
that turns a passing hook into a throwing one.

`'@objectstack/lint': patch` is deliberate and stays. That half of the diff is
message and comment prose only: `validateHookBodyWrites` reports the same
findings on the same bodies at the same severity, with wording that now names
the runtime refusal instead of the driver split this change retires.

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

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed. This narrows which run-time record payload the engine accepts after the `before*` hooks have run; an undeclared key was never a declarable metadata surface, so `objectstack migrate meta` has nothing in a stored source to rewrite. The remedy for an affected hook body is to declare the field on the object or stop writing it, which is authoring guidance, not a mechanical rewrite of stored metadata. -->

