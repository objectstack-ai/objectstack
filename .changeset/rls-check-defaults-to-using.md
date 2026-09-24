---
"@objectstack/plugin-security": minor
---

fix(plugin-security)!: a row-level security policy that declares no `check` now holds INSERTs and UPDATEs to its `using` (#19942)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement change on the write gate: no authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. The remedy for a newly refused write is to declare `check` on the policy, or to fix the data. -->

**BREAKING**: this narrows the set of writes the write gate accepts. A write that is admitted today can be refused after this change. It ships as `minor` under the launch-window convention, the same way the insert-side `check` reorder did (#16805).

The published contract has always said this. `RowLevelSecurityPolicySchema.check` reads "defaults to USING clause if not specified", and PostgreSQL treats a policy without `WITH CHECK` the same way. The write gate did not do it. It compiled only the policies that declared `check`, so a policy with only a `using` never checked a write. With `using: "record.status != 'closed'"`, a caller could INSERT a closed row. The row was stored even though the same caller could not read it afterwards.

**Writes that are now refused.** Each refusal is the existing row-level CHECK denial, `403 PERMISSION_DENIED`, and nothing is stored. There is no transition switch.

- **Any policy with only a `using`.** A single-row INSERT, or a by-id UPDATE, is refused when its resulting row falls outside the `using` of every applicable write-class policy (`insert`, `update` or `all`) and none of those policies declares a `check`. To let a write move a row outside a policy's scope, declare a `check` on that policy.
- **The platform's `_self` policies.** These have `operation: 'all'` and `using: user_id == current_user.id`. They now refuse a write that sets `user_id` to another user, on the self-service tables a member may write: `sys_user_preference`, and the revoke patch on `sys_api_key`. A member can no longer create a preference row for someone else. A member can no longer re-own their API key by adding `user_id` to a revoke patch. Before this change both writes were admitted, and the second one had `user_id` stripped later.
- **Re-pointing `created_by` under the ownership floor.** This is a by-id UPDATE that changes `created_by` while the floor still applies to that write. The readonly strip used to remove the new value, and the update was admitted. It is now refused with 403. The new row is judged before that strip runs (#16790).
- **A `using` that does not compile.** This applies to an `insert` or `all` policy that has only a `using`. That `using` is now also the insert check, and the policy fails closed: every insert it governs is refused. Before this change the insert was admitted, because no check ran.

**What does not change.**

- If any applicable policy declares `check`, only the declared checks decide, exactly as before. A policy with only a `using` alongside them adds nothing to the check.
- The platform's ownership floor (`owner_only_writes`) is part of a defaulted check only when the by-id write gate kept it for that write. A record share at edit depth, a `public_read_write` object, or a covering controlled-by-parent master gate still replaces the floor. Those writes are not refused again on the new row.
- `select` policies never gate a write's new row.
- Bulk updates without a single id are still scoped by the `using` where clause and are not checked row by row.
- The `modifyAllRecords` bypass on private and platform-global objects still skips the check.
