---
'@objectstack/plugin-auth': minor
---

The bulk identity import admits `manager_id`, resolved in a second pass keyed on the importer's identity key

`POST /api/v1/auth/admin/import-users` now reads a `manager_id` column. Until
this change it matched `manager_id` **0** times — against a positive control of
`email` at 73 — so a CSV naming everyone's manager built the org chart for
nobody, silently: the column was dropped on create (the identity write path
composes its own better-auth body) and filtered out on upsert (it is not in
`SYS_USER_IMPORT_UPDATE_FIELDS`). With
`POST /api/v1/auth/admin/set-user-manager` shipped, the import surface was the
one remaining route that could populate the column at scale and did not.

**What the cell holds is an identity key, not a user id.** A CSV author has the
manager's email or phone number, never their `usr_…` id, so the cell is read
with the same key the importer already keys rows by. One spelling, `manager_id`
— the phone column's three historical aliases are debt this key does not
inherit.

**The pass is SECOND, and that is load-bearing.** A manager named in row 40 may
be created by row 90, so the links are applied after the row engine has
returned and every row in the batch exists. A resolve inside the per-row write
would refuse exactly that input and would appear to work only on a file whose
rows happened to arrive in dependency order. A manager who is *not* in the file
is resolved against the directory instead, so an org chart can be grown one
batch at a time.

**Every refusal is the write surface's, applied per row.** The importer calls
`applyUserManagerLink` — the same derivation `POST /admin/set-user-manager`
runs — so self-assignment, a link that closes a cycle, a chain past the depth
cap, a manager provably outside every organization the user belongs to, and any
identity whose `sys_user.source` is `idp_provisioned` are refused on import
exactly as they are on the endpoint, with the endpoint's own `reason`
discriminator carried through. There is no second copy of those predicates.

**A manager problem never costs the row its identity.** The user is created
either way; the failure is reported on that row — `rows[].manager` carries the
machine-readable outcome in the shape `rows[].delivery` already uses
(`unresolved`, or the refusal's own `reason`), and `rows[].error` carries the
sentence. It is ⛔ not a whole-import failure and ⛔ not a silent skip, and an
engine fault while linking is reported the same way rather than turning a 200
that created N users into a 500 that reports none of them. No `rows[].code` is
stamped for a manager outcome: a row-level code would have to be registered in
the `packages/spec` error-code ledger, which this change is fenced out of, so
the machine-readable half lives on `rows[].manager` instead of on a code the
vocabulary does not carry.

**New on the response.** `data.summary.manager` is
`{ linked, unresolved, refused }`, beside `data.summary.delivery`, and the
run-level `sys_audit_log` row records the same split. Row objects are typed as
the newly exported `IdentityImportRowResult`, whose `manager` member is an
`ImportManagerOutcome`.

**Unchanged, deliberately.** `SYS_USER_PROFILE_EDIT_FIELDS` and
`SYS_USER_IMPORT_UPDATE_FIELDS` are untouched — the import reaches the column
by system context, the same way it already reaches `phone_number` and `role`,
and the same way the admin endpoint does. `manager_id` keeps `readonly: true`
on the column. Nothing derives a manager from org-unit membership. A dry run
does not run the pass at all and reports zeroes rather than half-answering
about links it could not evaluate.
