---
"@objectstack/plugin-security": patch
---

perf(security): batch the derived half of `bootstrapSystemCapabilities`, unnarrowed (#11520)

`bootstrapSystemCapabilities` reconciles two halves. #11451 batched the CURATED
half into one `$in` read carrying the #8470 predicate and left the DERIVED
half — the union of every `systemPermissions` string that nothing declares —
reading one row at a time, so a rebuild cost `1 + derived` round trips.

That residue was filed rather than fixed for a reason that has since expired.
Two objections stood: narrowing the derived read to the platform bucket answers
a different question and reverses ruled ground, and batching it *unnarrowed*
needed an unbounded read. #11518 removed the second one — `readNamePage` now
asks for one row more than its page budget and reports the overflow as
`truncated` = "could not answer", degrading loudly to the per-item read — so
the wide batched read became bounded without becoming a different question.

The derived half now consults its own `buildExistingByName` index, built with
**no predicate**: the read emits `{ name: { $in: … } }` under `seedCtx()`
(`{ isSystem: true }`, the same context the per-item read used), and unscoped
`resolveOwnOrganizationRow` returns the FIRST row with no bucket filter — so
the index resolves to the same lowest-`id` row installation-wide that
`tryFind(…, 1)[0]` returned under #4363's `ORDER BY id ASC`. A steady-state
rebuild costs 2 reads at every derived size instead of `1 + derived`.

⛔ The first objection still stands and is now pinned rather than only
documented: the derived read is **not** narrowed to `organization_id: null`.
Doing so would silence #8751's `platformStampedInOrg` anomaly signal in exactly
the case its doc says it is counted for, and would seed the platform bucket in
the case #8552 ruled must be left alone. A new test asserts the derived read's
key set is `name` and nothing else.

One behaviour change, in the direction #10946 chose deliberately for the
curated half: a derived name whose existence read **cannot answer** is now
DECLINED (counted in `unreadable`) instead of being read as absent. The old
`tryFind` swallowed a failed read into `[]`, which routed the name to its
insert branch — a duplicate placeholder wherever the read failed but the write
did not, refused only where the unique index happens to exist, and silent
either way because the `blockedCurated` diagnostic is curated-only. The
`unreadable` counter and its summary warning now cover both halves; the warning
reports the whole definition set as its total rather than the curated count.
