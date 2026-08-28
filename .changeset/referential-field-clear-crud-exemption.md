---
"@objectstack/plugin-security": minor
---

feat(security): the referential FK-clear write is exempt from the object-level CRUD check (#12597)

**This changes which deletes succeed** — an observable behavioural contract
change on the delete path, which is why it ships `minor` rather than as a
patch-grade defect repair.

Deleting a record makes the engine clear every optional lookup that points at it
(`deleteBehavior: 'set_null'`). That cleanup `UPDATE` is engine-owned referential
integrity, and it has carried the server-derived `__referentialFieldClear` marker
since #3023 — but the marker reached only the ownership-anchor guard, so the
write still had to pass the **object-level CRUD check** on the referencing
object. Consequence, measured on a real deployment across 17 role×object pairs: a
role with full delete rights on A and no grant at all on B could delete an A only
while B was **empty**. The moment a real row referenced it, the delete failed with
one generic "you do not have permission", and nothing on any permission screen
showed that deleting A also required write authority on B.

**What is exempt: the object-level CRUD grant check, and nothing else.** A marked
`update` skips that one gate (both the caller's grant and the ADR-0090 D10
delegator half of the same question). Everything else in the security middleware
runs unchanged and is pinned test-by-test:

- field-level security on the FK column still refuses;
- the RLS `using` row scope on the referencing object still refuses;
- the RLS post-image `check` still refuses — so a deployment declaring
  `product != null` keeps getting a truthful refusal instead of a silent clear;
- declared validation rules keep firing (they were never in this path);
- a caller without delete rights on the target is still refused;
- an ordinary, unmarked update on the referencing object is untouched.

⛔ Deliberately **not** `isSystem`: that bypass is total (see
`content/docs/permissions/system-context.mdx` — "Elevation is total, and it is not
granular"), and it would have switched off all three guards above. ⛔ The
`cascade` arm — deleting whole referencing rows — is **unchanged** and still
requires the caller's own delete authority on those rows.

The write is not elevated at all, so audit attribution is unchanged: the cleanup
`UPDATE` still runs under the operator's identity and lands in the ledger as that
operator (`user_id` / `actor`, and the `updated_by` stamp).

No authorable surface changes, and no metadata needs migrating: a deployment that
was working around this by granting write access on referencing tables can narrow
those grants, but nothing forces it to.
