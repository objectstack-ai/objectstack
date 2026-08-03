---
"@objectstack/plugin-approvals": patch
---

fix(approvals): the record lock now holds for predicate (`multi`) updates (#4778)

The ADR-0019 record lock — "while a record has a pending `sys_approval_request`,
block edits to it" — was enforced only for updates that reach the hook with an
`input.id`. The engine extracts that id from a **scalar** `where.id` alone; an
operator object (`{ $in: [...] }`) or any other predicate is a multi-row write
that routes to `updateMany` and arrives with no id. The hook opened with
`if (!id) return`, so it read *"no row was resolved"* as *"there is nothing to
authorize"* when the truth was *"nothing was ever queried"*.

Rewriting the very same edit as `multi: true` therefore walked straight past the
lock:

```ts
// rec_1 carries a pending approval, lockRecord is not disabled
await ql.update('crm_opportunity', { amount: 999 }, { where: { id: 'rec_1' } });                       // RECORD_LOCKED
await ql.update('crm_opportunity', { amount: 999 }, { where: { id: { $in: ['rec_1'] } }, multi: true }); // went through
await ql.update('crm_opportunity', { amount: 999 }, { where: { name: 'x' }, multi: true });              // went through
```

No privilege was needed for that bypass — not an `admin` role, not `isSystem`,
not `lockRecord: false`, not a whitelisted `approvalStatusField`. Every caller
shape that can spell a predicate (SDK, ObjectQL, a flow's `update_record`) could
produce it. It is the same fail-open reasoning fixed for `sys_attachment`
(#4757) and `sys_comment` (#4630), in the one place where it needed no
privilege at all.

**The hook now resolves the rows a write touches before deciding.** By-id writes
are unchanged (the driver writes by primary key, so the rest of `where` must not
narrow the verdict). A predicate write is decided by intersecting the caller's
predicate with the records that are actually locked — which is also what keeps
it cheap: the query is bounded by the object's **pending approvals**, never by
the update's match set, so a mass update of 50 000 unlocked rows costs one
bookkeeping probe and is allowed. An unscoped `multi` update over the whole
table reaches every locked row of the object and is refused while any is held.

**Fail-closed, both ways.** Past 1 000 locked records — the bound the attachment
and comment guards use — or if the intersection query fails, the write is
refused rather than allowed: the lock could not prove the write misses a locked
row. The approvals bookkeeping being unreadable at all stays the one fail-open,
as before: this hook is global over every object, so a kernel without
`sys_approval_request` would otherwise refuse every update in the deployment.
Both the bookkeeping and the match-set resolution are read under a **system**
context — a guard's own input must never be narrowed by the caller's
visibility, since a locked row you cannot read is still a row you may not write.

**Every exemption moved with the guard**, which is the other way this class of
fix goes wrong — a guard extended to more rows that carries only its deny rules
turns a fail-open into a false-positive. `isSystem`, the `admin` override, the
`approvalStatusField` status mirror, `lockRecord: false` and the owning run's
`flowRunId` (#3456 / #3712) all decide a predicate write exactly as they decide
a by-id write, each pinned by tests on both predicate shapes. Refusals now name
the record and object that are locked.
