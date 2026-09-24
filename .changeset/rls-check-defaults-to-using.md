---
"@objectstack/plugin-security": patch
---

A row-level security policy that declares no `check` now holds INSERTs and UPDATEs to its `using` (#19942).

The published contract has always said this. `RowLevelSecurityPolicySchema.check` reads "defaults to USING clause if not specified", and PostgreSQL treats a policy without `WITH CHECK` the same way. The write gate did not do it. It compiled only the policies that declared `check`, so a policy with `using` alone never checked a write. With `using: "record.status != 'closed'"`, a caller could INSERT a closed row, and the row was stored even though the same caller could not then read it.

**Writes that are now refused.** A single-row INSERT, or a by-id UPDATE, whose resulting row falls outside the `using` of every applicable write-class policy (`insert`, `update` or `all`), when none of those policies declares a `check`. The refusal is the existing row-level CHECK denial: `403 PERMISSION_DENIED`, and nothing is stored. There is no transition switch. If a write should be allowed to leave a policy's scope, declare a `check` on that policy.

The platform's own permission sets are affected in one way. The `_self` policies with `operation: 'all'` (`user_id == current_user.id`) now refuse a write that sets `user_id` to another user, on the self-service tables a member may write (`sys_user_preference`, and the revoke patch on `sys_api_key`). For example, a member can no longer create a preference row for someone else, or re-own their API key by adding `user_id` to a revoke patch. Before this change, both writes were admitted, although the second one had `user_id` stripped later.

**What does not change.**

- If any applicable policy declares `check`, only the declared checks decide, exactly as before. A policy with `using` alone that sits beside them adds nothing to the check.
- The platform's ownership floor (`owner_only_writes`) takes part in a defaulted check only when the by-id write gate kept it for that write. A record share at edit depth, a `public_read_write` object and a covering controlled-by-parent master gate still replace the floor, so those writes are not refused again on the new row.
- `select` policies never gate a write's new row.
- Bulk updates without a single id are still scoped by the `using` where clause and are not checked row by row.
- The `modifyAllRecords` bypass on private and platform-global objects still skips the check.
