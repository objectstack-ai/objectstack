---
'@objectstack/objectql': patch
---

fix(objectql): a `secret` field's `sys_secret` row is written only with the record that names it, and released when that record's column lets go of it (#27495)

Clause-②: no
Metadata-protocol: none

- **Written with the record.** The credential pass still seals the value before validation, so the row carries its `secret:` ref when validation and the post-image permission check judge it. The `sys_secret` row itself is now written immediately before the record's own driver write, after every pass that can refuse the write. A create or update refused for any reason (validation, an option outside the list, a required field, a `before*` hook, the permission check) writes no credential row, a row `insertMany` culls writes none, and a statement the driver refuses takes back the row it was given.
- **Released when the column lets go.** A committed update that clears a `secret` field with `null`, or replaces its value, removes the `sys_secret` row the field named before. The removal is verified first: no row of that column may still name the handle (a predicate update shares one handle across every row it matched), the handle must be that column's own, and the delete rides the record's transaction where one is open. A removal that cannot be confirmed keeps the row and logs one `error` line naming the column; `objectstack secret orphans` reports such rows.
- **Unchanged.** What a read returns (the mask), what `resolveSecret` / `resolveSecretField` return for a stored value, an echoed mask (still a no-op), and the refusal a caller receives. Credential rows left behind before this release are not swept; they stay report-only through `objectstack secret orphans`.
