---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): let system writes materialize sharing rules — drop the `isSystem` skips in `bindRuleHooks` (#13533)

A criteria sharing rule declares a promise: `status == "approved"` means the
named recipients can see the record. `bindRuleHooks` did not keep that promise
when the platform was the writer. Its `afterInsert` and `afterUpdate` hooks
returned early on `ctx.session.isSystem`, so a system-context write that moved a
record INTO a rule's criteria materialized no `sys_record_share` row at all.

The path that made this a real outage rather than a boot-time curiosity is
approval write-back. An approval node with `lockRecord: true` mirrors the
decision onto the subject record under a system context — that is the only write
that can land while the record is locked — so a manager approving a leave
request produced exactly the skip above. A teammate who relied on the rule could
not see the record, and nothing repaired it until somebody ran
`POST /api/v1/sharing/rules/:id/evaluate` or restarted the server. The failure
was invisible from a manager or admin view, which reads through the profile's
`viewAllRecords` grant and never consults a sharing rule at all.

**What changes.** A system write now materializes exactly as a user write does —
grants on the way into a rule's criteria, revokes on the way out, per record,
synchronously with the write. Three early returns are gone: the two on
`afterInsert` / `afterUpdate`, and the one on the `beforeUpdate` / `beforeDelete`
row-set stash they depended on (without that stash an `after` hook reads the row
set as *unbounded*, which would have turned every single-row system update into
an object-wide revoke plus an asynchronous re-grant). The INFO line that
announced the skip — `[sharing-rule] sharing materialisation skipped for isSystem
writes; re-evaluate rules or restart to backfill` — is retired with it, along
with the unexported `SYSTEM_WRITE_SKIP_NOTICE` constant.

**What does not change.** `afterDelete` still skips system writes, on separate
grounds: what it skips is revocation, and `record-share-cascade.ts` delivers that
on every sharing-capable object, stashing for system writes on its own account.
The `kernel:bootstrapped` boot backfill still runs and is still needed — it
reaches rows no hook saw, and it is the only pass that purges a deactivated
rule's grants. No new option, flag or declarative switch: the fix is the removal.

No published export moves; `SYSTEM_WRITE_SKIP_NOTICE` was never re-exported from
the package entry point.
