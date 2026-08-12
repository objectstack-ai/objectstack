---
"@objectstack/plugin-security": patch
---

fix(plugin-security): a by-id write target must be inside the caller's readable set when only select-scope RLS is authored

An object whose row narrowing is authored as `operation: 'select'` rules only had an
**open by-id write path**. A low-privilege user could `PATCH` records they could not
read — 200, values persisted — on the object itself and on a `controlled_by_parent`
detail, while the read side correctly hid the same rows (404 on GET, absent from list).

The cause was a single missing scope. The by-id write pre-image gate, the
controlled_by_parent master check and the bulk write filter all compose the RLS filter
for the **write** operation. With no update-scope policy applicable to the caller,
that filter compiled to nothing and every one of those row gates became a no-op at
once; an open sharing model (`public_read_write`) then admitted the write. Deriving the
detail's access from the same permissive master verdict spread it to details as well.

An empty write-class policy collection now **derives its scope from the caller's
`select` narrowing** — the same policies, compiled by the same compiler, that the read
path enforces. "You cannot mutate what you cannot see" holds by construction on all
three gates, and the explain engine reports the same narrowing for `update`/`delete`
that it reports for `read` instead of "No RLS policy applies".

Migration-visible change: on an object narrowed by select-only RLS, a by-id or bulk
`update`/`delete` of a row **outside the caller's readable set** is now refused
(`PERMISSION_DENIED`, 403) where it previously succeeded. Reads, inserts, and any
object that **does** author an update- or delete-scope policy are unaffected — where a
write-class predicate exists it keeps deciding alone, so app-authored write wideners
behave exactly as before. Callers holding a read-side superuser bypass
(`viewAllRecords` on a posture-permitting object) are not newly narrowed. An app that
relied on the previous behaviour should author an explicit `operation: 'update'` policy
expressing the wider write scope it intends.
